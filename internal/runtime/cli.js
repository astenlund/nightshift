#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { RunStore, requireCondition } = require('./store');
const { ReviewStore } = require('./review-store');
const { isReviewContext } = require('./records');
const { REVIEW_TARGET, reviewInput, openReview, assertRepairScope } = require('./review-context');
const { assertAction, commitmentsFor, findingKind, obligationBrief, sameClosingRecord, sharesCumulativeAssessment, targetById, transition } = require('./lifecycle');
const { DEFAULT_REVIEW_TIMEOUT_MS, dispatchReview, readReceipt, validateBase, validateRequest } = require('./review');
const { exhaustedLimit, remainingTime, requireDispatchFits } = require('./limits');
const { prepareProbe, runProbe } = require('./probes');
const { scratchStatus } = require('./scratch');
const { awaitWorker } = require('./wait');
const { admitEntry, executionResources, savedResources } = require('../releases/entry');
const { isReadOnlyAction, isRuntimeAction, unknownActionMessage } = require('./actions');
const { ADOPTION_PROTOCOL, assertControllerClaim, controllerClaim, forbiddenReviewSessions, observeController } = require('./ownership');
const { reservedCheck, reservedOperation } = require('./operations');
const { acceptanceCheckpoint } = require('./acceptance-checkpoint');
const { continuesRecord, lineageOf, resolveContinuation } = require('./continuation');
const { information, inspectionFailureDetail } = require('../releases/processes');

function requireRuntimeAction(request) {
  requireCondition(isRuntimeAction(request?.action), 'invalid-request', unknownActionMessage(request?.action));
}

// Lead assessments a target accepts: a spec task its spec review, a lore task its code review, code and docs tasks either
// lens, and the closing record docs reviews only.
function leadKindsFor(target) {
  if (target.kind === 'closing') return ['docs'];
  if (target.kind === 'spec') return ['spec'];
  return target.kind === 'lore' ? ['code'] : ['code', 'docs'];
}

// The most revisions whose full state one history response returns.
const HISTORY_STATE_LIMIT = 10;

// Every transition of the run without its state, or the full states of one bounded revision range.
function history(store, request) {
  const id = request.runId ?? store.read()?.id;
  requireCondition(id, 'missing-state', 'No saved Nightshift run');
  if (request.fromRevision === undefined && request.toRevision === undefined) return store.transitions(id);
  const from = request.fromRevision;
  const to = request.toRevision ?? from;
  requireCondition(Number.isSafeInteger(from) && from >= 0 && Number.isSafeInteger(to) && to >= from && to - from < HISTORY_STATE_LIMIT, 'invalid-history-range',
    `History returns full states for fromRevision through toRevision, at most ${HISTORY_STATE_LIMIT} revisions; omit both to list every transition without state`);
  return store.history(id, { fromRevision: from, toRevision: to });
}

// A completed delivery cannot be adopted and its owning session may be gone, so another admitted session of the same project,
// in the run's resource mode and store, may record the recipient's reply to its morning report. Nothing else is opened to it.
function confirmCompletedReport(store, state, request, resources) {
  const { host, session } = request.actor ?? {};
  requireCondition(['claude', 'codex'].includes(host) && typeof session === 'string' && session.trim(), 'invalid-request', 'report-delivered.actor must name the confirming host session');
  const admitted = state.resourceMode === 'bound' ? resources?.session === session && resources.store === executionResources(state)?.store : !resources;
  requireCondition(admitted, 'bound-runtime-required', 'Confirm a completed delivery\'s report only through an admitted session of its resource mode and store');
  requireCondition(state.revision === request.revision, 'stale-state', 'Run changed; read current obligations before retrying');
  assertAction(state, request);

  return obligationBrief(store.update(request.actor, state.revision, request.action, current => transition(current, request), { recipientConfirmation: true }));
}

async function execute(root, request, dependencies = {}) {
  requireRuntimeAction(request);
  const target = require('./targets').runtimeTarget(request);
  const creatingDelivery = request.action === 'handover' && Object.hasOwn(request, 'tasks');
  const openingReview = request.action === 'open-review';
  if (openingReview) reviewInput(request);
  const store = target.kind === 'review'
    ? new ReviewStore(root, { create: openingReview, contextId: request.reviewContextId })
    : new RunStore(root, { create: creatingDelivery });
  try {
    if (creatingDelivery || openingReview) {
      const resources = savedResources(dependencies.resourceContext);
      if (resources) requireCondition(request.controller?.session === resources.session, 'resource-owner-mismatch', 'Controller identity does not match its admitted session');
      const observation = observeController(store.root, request.controller, dependencies);
      requireCondition(observation.process, 'controller-claim-unavailable', observation.reason);
      if (openingReview) {
        const context = openReview(store, request, resources, resources ? 'bound' : 'development', controllerClaim(request.controller, observation, 0));
        return { ...context, reviewContextId: context.id, scratch: scratchStatus(store.root) };
      }
      // Every run created through the runtime carries the docs gate; only fixtures reproducing earlier releases create one without it.
      requireCondition(request.runId === undefined || store.read()?.id === request.runId, 'wrong-run', 'An acceptance selector must name the actual current delivery');
      const created = store.create({ ...request, resources, resourceMode: resources ? 'bound' : 'development', controllerClaim: controllerClaim(request.controller, observation, 0), docsGate: true, integration: dependencies.resourceContext?.integration });

      // The scratch status carries the warning that .tmp is not ignored before any agent writes scratch there.
      return { ...created, controllerReady: created.status === 'running', scratch: scratchStatus(store.root), acceptanceCheckpoint: acceptanceCheckpoint(created, request.controller, dependencies.resourceContext, dependencies.acknowledgementObserver) };
    }
    if (store.kind === 'review') request = { ...request, runId: store.contextId, taskId: request.taskId ?? REVIEW_TARGET };
    if (request.action === 'status') {
      const state = store.read(request.runId);
      requireCondition(state, 'missing-state', 'No saved Nightshift run');
      return { ...obligationBrief(state), acceptanceCheckpoint: acceptanceCheckpoint(state, request.actor, dependencies.resourceContext, dependencies.acknowledgementObserver) };
    }
    if (request.action === 'history') return history(store, request);
    if (request.action === 'inspect') return store.read(request.runId);
    // Awaited so the store stays open until the observation finishes; the finally below closes it.
    if (request.action === 'wait') return await awaitWorker(store, request, dependencies);
    let state = store.read();
    requireCondition(state, 'missing-state', 'No saved Nightshift run; create or recover the authorized run first');
    requireCondition(request.runId === undefined || request.runId === state.id, 'wrong-run', 'Mutations must name the current active run');
    const resources = savedResources(dependencies.resourceContext);
    if (request.action === 'adopt') return obligationBrief(store.adopt(request, resources, dependencies));
    const ownedBy = actor => state.controller.session === actor?.session && state.controller.host === actor?.host;
    if (request.action === 'report-delivered' && store.kind === 'delivery' && state.status === 'complete' && !ownedBy(request.actor)) return confirmCompletedReport(store, state, request, resources);
    const currentResources = executionResources(state);
    if (currentResources) requireCondition(state.resourceMode === 'bound' && isDeepStrictEqual(currentResources, resources), 'bound-runtime-required', 'Mutate this run only through its exact retained resource binding for the current execution owner');
    else requireCondition(!resources, 'legacy-release-reconciliation', 'A bound runtime cannot silently adopt a legacy or development run');
    requireCondition(state?.controller.session === request.actor?.session && state.controller.host === request.actor?.host && state.revision === request.revision, 'stale-owner', 'Read current state and reconcile the controller identity before changing or dispatching work');
    store.integration = dependencies.resourceContext?.integration;
    const acknowledgement = require('./acknowledgement');
    if (acknowledgement.needsAcknowledgement(state, request) && !acknowledgement.acknowledged(state) && store.integration?.usable === false) {
      const before = acknowledgement.outcomeIdentity(state);
      const observed = structuredClone(state);
      require('./continuation-health').observeIntegration(observed, store.integration);
      if (before !== acknowledgement.outcomeIdentity(observed)) {
        store.update(request.actor, state.revision, 'continuation', () => {});
        state = store.read();
        request = { ...request, revision: state.revision };
      }
    }
    require('./continuation-health').observeIntegration(state, store.integration);
    if (store.kind === 'review' && (request.action === 'repair' || request.action === 'dispose' && request.disposition === 'implement')) assertRepairScope(store.root, request.actor, state);
    assertAction(state, request);
    if (['claim-controller', 'resume'].includes(request.action)) {
      const observation = observeController(store.root, request.actor, dependencies);
      const claim = controllerClaim(request.actor, observation, state.revision + 1);
      const refreshed = store.update(request.actor, state.revision, request.action === 'resume' && !observation.process ? 'resume-claim-failed' : request.action, current => {
        if (request.action === 'resume') {
          requireCondition(current.status === 'stopped', 'invalid-resume', 'Only a stopped run needs explicit resumption');
          requireCondition(typeof request.authority === 'string' && request.authority.trim(), 'invalid-request', 'resume.authority must be nonempty text');
          if (observation.process) transition(current, request);
          if (store.kind === 'review') current.ownerObservation = claim;
          else current.controllerClaim = claim;
        } else transition(current, { ...request, claim });
      });

      return { ...obligationBrief(refreshed), controllerReady: Boolean(observation.process) };
    }
    const ownerObservation = assertControllerClaim(state, request, dependencies);
    if (store.kind === 'review') store.ownerObservation = ownerObservation;
    if (acknowledgement.needsAcknowledgement(state, request)) store.acknowledgementObservation = acknowledgement.establishAcknowledgement(state, dependencies.resourceContext, dependencies.acknowledgementObserver);
    if (request.action === 'dispatch') {
      // The runtime resolves a continuation from the run record; a request cannot supply it, which would skip the resume refusals.
      requireCondition(request.review?.continuation === undefined && request.review?.continuationContext === undefined, 'invalid-continuation', 'continuation and continuationContext are resolved by the runtime, not supplied with a request');
      validateRequest(request.review);
      validateBase(store.root, request.review.baseSha);
      const task = targetById(state, request.taskId);
      const continued = resolveContinuation(store.root, state, task, request.review);
      const candidates = continued?.candidates ?? request.review.candidates;
      const attemptTimeoutMs = request.review.timeoutMs ?? DEFAULT_REVIEW_TIMEOUT_MS;
      requireDispatchFits(state, dependencies.resourceContext, candidates.length, attemptTimeoutMs);
      const id = randomUUID();
      const closing = task.kind === 'closing';
      requireCondition(!closing || ['docs', 'skeptic'].includes(request.review.kind), 'wrong-review-kind', 'The closing record takes docs reviews and their skeptics only');
      let inspectionFailure = null;
      const helperProcess = (dependencies.information ?? information)(process.pid, null, store.root, { onFailure: cause => { inspectionFailure = cause; } });
      requireCondition(helperProcess?.found === true, 'operation-owner-unavailable', 'Cannot dispatch without identifying its actual helper process' + inspectionFailureDetail(inspectionFailure));
      // The closing review covers every task whose assessment tracking edits can stale; a task review covers its cumulative siblings.
      const coveredTasks = closing
        ? state.tasks.filter(candidate => ['code', 'docs', 'lore'].includes(candidate.kind))
        : state.tasks.filter(candidate => candidate.id === task.id || sharesCumulativeAssessment(task) && sharesCumulativeAssessment(candidate) && candidate.status === 'complete');
      const skepticFindings = continued?.findings.length ? continued.findings : request.review.findings;
      const assigned = request.review.kind === 'skeptic' ? (skepticFindings ?? []).map(finding => task.findings.find(saved => saved.id === finding?.id)) : [];
      const lens = assigned.length > 0 && assigned.every(finding => finding && findingKind(finding, task) === 'docs') ? 'docs' : undefined;
      const continuation = continued?.continuation;
      const registered = store.update(request.actor, state.revision, 'dispatch-started', current => {
        requireCondition(!current.baseSha || current.baseSha === request.review.baseSha, 'changed-base', 'Cumulative run review must retain its original base');
        current.baseSha = request.review.baseSha;
        // A resumed dispatch holds its known session from the start, so a concurrent resume of the same session is refused.
        const held = continuation?.kind === 'resumed' ? { session: continuation.session, host: candidates[0].host } : { session: null };
        current.workers.push({ id, ...held, role: request.review.kind === 'skeptic' ? 'skeptic' : 'reviewer', assignment: closing ? 'Assess the closing tracking edits' : 'Assess ' + task.title, taskId: task.id, writes: [], status: 'starting', phase: 'reserved', artifactDirectory: `.nightshift/runs/reviews/${id}`, runnerPid: process.pid, helperProcess, resources: currentResources, controller: { ...state.controller }, continues: continuesRecord(continuation), lineage: continuation?.lineage ?? id });
        if (closing && !isReviewContext(current)) {
          current.workers.at(-1).progressOrigin = require('./discharge').origin(current, 'record');
          current.workers.at(-1).progressBinding = structuredClone(task.progressBinding);
          current.workers.at(-1).closingOccurrence = task.occurrence ?? null;
        }
      });
      const updateWorker = change => store.update(request.actor, store.read().revision, 'dispatch-progress', current => {
        const worker = current.workers.find(candidate => candidate.id === id);
        Object.assign(worker, change);
      });
      try {
        updateWorker({ phase: 'preparing' });
        const result = await dispatchReview(store.root, {
          ...request.review, id, runId: registered.id, recordKind: store.kind, taskId: task.id, lens, candidates,
          continuation, continuationContext: continued?.continuationContext, findings: skepticFindings,
          resources: currentResources,
          controller: state.controller,
          forbiddenSessions: [...forbiddenReviewSessions(state)],
          resourceContext: dependencies.resourceContext,
          artifactPaths: request.review.artifactPaths ?? (task.agreement?.spec ? [task.agreement.spec] : undefined),
          probeEvidence: task.probeEvidence ?? [],
          coveredTaskIds: coveredTasks.map(candidate => candidate.id),
          commitments: commitmentsFor(coveredTasks),
          requirements: request.review.requirements + '\n\nAccepted commitments covered by this cumulative assessment:\n' + JSON.stringify(coveredTasks.map(candidate => ({ id: candidate.id, agreement: candidate.agreement }))),
          onProcess: pid => updateWorker({ pid, status: 'running', phase: 'launched', childProcess: (dependencies.information ?? information)(pid, null, store.root) }),
          // A resumed dispatch holds its known session from registration; a host reporting another one must not release that hold.
          onSession: continuation?.kind === 'resumed' ? undefined : session => updateWorker({ session }),
          onFinalizing: () => updateWorker({ phase: 'finalizing' }),
          onPrepared: assignment => updateWorker({ snapshotDigest: assignment.snapshot.digest, coveredTaskIds: assignment.coveredTaskIds, commitments: assignment.commitments, baseSha: assignment.baseSha }),
          onAttempt: () => store.update(request.actor, store.read().revision, 'model-attempt', current => {
            assertAction(current, request);
            requireCondition(!exhaustedLimit(current, { dispatch: true }), 'resource-limit', 'The authorized model-dispatch allowance has been reached');
            current.dispatches = (current.dispatches ?? 0) + 1;
            current.workers.find(worker => worker.id === id).phase = 'launching';
          }),
          deadlineUtc: state.limits?.deadlineUtc,
          operationDeadlineUtc: dependencies.resourceContext?.operationDeadlineUtc,
          timeoutMs: attemptTimeoutMs,
        }, dependencies);
        updateWorker({ host: result.receipt.host, model: result.receipt.model, effort: result.receipt.effort, session: result.receipt.session, status: 'complete', receipt: result.receiptFile });
        return result;
      } catch (error) {
        updateWorker({ status: error.code === 'termination-unverified' ? 'unverified' : 'failed', evidence: error.message });
        throw error;
      }
    }
    if (request.action === 'probe') {
      const receipt = readReceipt(store.root, request.receipt, state, request.taskId);
      const probe = receipt.probes.find(candidate => candidate.id === request.probeId);
      requireCondition(probe, 'unknown-probe', 'The independent assessor did not request this probe');
      const command = prepareProbe(store.root, probe);
      const result = await reservedOperation(store, request, run => runProbe(store.root, receipt, { ...command, timeoutMs: remainingTime(state, command.timeoutMs, dependencies.resourceContext) }, run), dependencies);

      return obligationBrief(result);
    }
    if (request.action === 'check') {
      const result = await reservedCheck(store, { ...request, check: { ...request.check, timeoutMs: remainingTime(state, request.check?.timeoutMs ?? 120000, dependencies.resourceContext) } }, dependencies);

      return obligationBrief(result);
    }
    let prepared = request;
    if (request.action === 'review') {
      const review = readReceipt(store.root, request.receipt, state, request.taskId);
      const task = targetById(state, request.taskId);
      requireCondition(leadKindsFor(task).includes(review.kind), 'wrong-review-kind', 'Receipt kind does not match the lead-assessment boundary');
      requireCondition(!review.dialogue, 'dialogue-receipt', 'A dialogue reply is evidence, not an assessment: import a reviewer reply with dialogue and a skeptic reply with validate');
      if (task.kind === 'closing' && !isReviewContext(state)) {
        const worker = state.workers.find(candidate => candidate.id === review.requestId);
        // Only a record without an occurrence identity needs the accounting origin, and unreadable accounting establishes none.
        let origin = null;
        if (!task.occurrence) {
          try {
            const accounting = new (require('./progress-store').ProgressStore)(store);
            origin = new (require('./provenance-store').ProvenanceStore)(accounting).read(store.read(undefined, { hydrate: false }))?.bindings?.record ?? null;
          } catch (error) {
            if (!(error instanceof require('./errors').RunError)) throw error;
          }
        }
        requireCondition(worker && isDeepStrictEqual(worker.progressBinding, task.progressBinding) && sameClosingRecord(task, worker, origin), 'closing-origin-changed', 'Assessment belongs to a replaced closing record');
      }
      const existing = task.reviews.find(candidate => candidate.requestId === review.requestId);
      if (existing) {
        const accepted = { ...existing };
        delete accepted.revision;
        delete accepted.progressBinding;
        requireCondition(isDeepStrictEqual(accepted, review), 'changed-review', 'This receipt identity was already imported with different contents');
        return obligationBrief(state);
      }
      prepared = { ...request, review };
    }
    if (request.action === 'validate') {
      const receipt = readReceipt(store.root, request.receipt, state, request.taskId);
      requireCondition(receipt.kind === 'skeptic', 'skeptic-required', 'Validation needs a skeptic assignment');
      const verdict = receipt.findings.find(finding => finding.id === request.findingId);
      requireCondition(verdict, 'missing-validation', 'Skeptic report did not validate this finding');
      // The validate transition refuses a confirmed verdict whose proposal is missing or blank.
      prepared = { ...request, validation: { ...verdict, repairProposal: verdict.repairProposal?.trim() ? verdict.repairProposal : null, session: receipt.session, requestId: receipt.requestId, lineage: lineageOf(receipt), dialogue: receipt.dialogue?.message ?? null, attributionVerified: true, snapshot: receipt.snapshot } };
    }
    if (request.action === 'dialogue') {
      const receipt = readReceipt(store.root, request.receipt, state, request.taskId);
      requireCondition(receipt.dialogue && receipt.kind !== 'skeptic', 'dialogue-receipt-required', 'The dialogue operation imports a reviewer\'s dialogue reply; a skeptic\'s reply is imported with validate');
      prepared = { ...request, reply: { requestId: receipt.requestId, lineage: lineageOf(receipt), session: receipt.session, message: receipt.dialogue.message, positions: receipt.positions, snapshot: receipt.snapshot } };
    }
    const result = store.update(request.actor, request.revision, request.action, (state, integration) => transition(state, prepared, integration));
    const brief = obligationBrief(result);
    return ['handover', 'continuation'].includes(request.action) ? { ...brief, acceptanceCheckpoint: acceptanceCheckpoint(result, request.actor, dependencies.resourceContext, dependencies.acknowledgementObserver) } : brief;
  } finally { store.close(); }
}

async function main() {
  const args = process.argv.slice(2);
  const [root, requestFile] = args[0] === '--development' ? args.slice(1) : args;
  requireCondition(root && requestFile, 'usage', `Usage: node ${path.basename(__filename)} <project-root> <request.json>`);
  const request = JSON.parse(fs.readFileSync(requestFile, 'utf8').replace(/^\uFEFF/, ''));
  requireRuntimeAction(request);
  const admitted = admitEntry(path.resolve(__dirname, '../..'), args, 0, { exactProject: true, diagnostic: isReadOnlyAction(request.action) });
  process.stdout.write(JSON.stringify(await execute(root, request, { resourceContext: admitted.context }), null, 2) + '\n');
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(JSON.stringify({ error: error.code ?? 'operation-failed', message: error.message }) + '\n');
    process.exitCode = 1;
  });
}

module.exports = { ADOPTION_PROTOCOL, CONTINUATION_OPTIONAL_ADMISSION: true, execute };
