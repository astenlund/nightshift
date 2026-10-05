#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { RunStore, requireCondition } = require('./store');
const { assertAction, commitmentsFor, findingKind, obligationBrief, sharesCumulativeAssessment, targetById, transition } = require('./lifecycle');
const { DEFAULT_REVIEW_TIMEOUT_MS, dispatchReview, readReceipt, validateBase, validateRequest } = require('./review');
const { exhaustedLimit, remainingTime, requireDispatchFits } = require('./limits');
const { prepareProbe, runProbe } = require('./probes');
const { scratchStatus } = require('./scratch');
const { awaitWorker } = require('./wait');
const { admitEntry, executionResources, savedResources } = require('../releases/entry');
const { isReadOnlyAction, isRuntimeAction, unknownActionMessage } = require('./actions');
const { ADOPTION_PROTOCOL, assertControllerClaim, controllerClaim, forbiddenReviewSessions, observeController } = require('./ownership');
const { reservedCheck, reservedOperation } = require('./operations');
const { continuesRecord, lineageOf, resolveContinuation } = require('./continuation');
const { information } = require('../releases/processes');

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

async function execute(root, request, dependencies = {}) {
  requireRuntimeAction(request);
  const store = new RunStore(root, { create: request.action === 'create' });
  try {
    if (request.action === 'create') {
      const resources = savedResources(dependencies.resourceContext);
      if (resources) requireCondition(request.controller?.session === resources.session, 'resource-owner-mismatch', 'Controller identity does not match its admitted session');
      const observation = observeController(store.root, request.controller, dependencies);
      requireCondition(observation.process, 'controller-claim-unavailable', observation.reason);
      // Every run created through the runtime carries the docs gate; only fixtures reproducing earlier releases create one without it.
      const created = store.create({ ...request, resources, resourceMode: resources ? 'bound' : 'development', controllerClaim: controllerClaim(request.controller, observation, 0), docsGate: true });

      // The scratch status carries the warning that .tmp is not ignored before any agent writes scratch there.
      return { ...created, controllerReady: true, scratch: scratchStatus(store.root) };
    }
    if (request.action === 'status') {
      const state = store.read(request.runId);
      requireCondition(state, 'missing-state', 'No saved Nightshift run');
      return obligationBrief(state);
    }
    if (request.action === 'history') return history(store, request);
    if (request.action === 'inspect') return store.read(request.runId);
    // Awaited so the store stays open until the observation finishes; the finally below closes it.
    if (request.action === 'wait') return await awaitWorker(store, request, dependencies);
    const state = store.read();
    requireCondition(state, 'missing-state', 'No saved Nightshift run; create or recover the authorized run first');
    requireCondition(request.runId === undefined || request.runId === state.id, 'wrong-run', 'Mutations must name the current active run');
    const resources = savedResources(dependencies.resourceContext);
    if (request.action === 'adopt') return obligationBrief(store.adopt(request, resources, dependencies));
    const currentResources = executionResources(state);
    if (currentResources) requireCondition(state.resourceMode === 'bound' && isDeepStrictEqual(currentResources, resources), 'bound-runtime-required', 'Mutate this run only through its exact retained resource binding for the current execution owner');
    else requireCondition(!resources, 'legacy-release-reconciliation', 'A bound runtime cannot silently adopt a legacy or development run');
    requireCondition(state?.controller.session === request.actor?.session && state.controller.host === request.actor?.host && state.revision === request.revision, 'stale-owner', 'Read current state and reconcile the controller identity before changing or dispatching work');
    assertAction(state, request);
    if (['claim-controller', 'resume'].includes(request.action)) {
      const observation = observeController(store.root, request.actor, dependencies);
      const claim = controllerClaim(request.actor, observation, state.revision + 1);
      const refreshed = store.update(request.actor, state.revision, request.action === 'resume' && !observation.process ? 'resume-claim-failed' : request.action, current => {
        if (request.action === 'resume') {
          requireCondition(current.status === 'stopped', 'invalid-resume', 'Only a stopped run needs explicit resumption');
          requireCondition(typeof request.authority === 'string' && request.authority.trim(), 'invalid-request', 'resume.authority must be nonempty text');
          if (observation.process) transition(current, request);
          current.controllerClaim = claim;
        } else transition(current, { ...request, claim });
      });

      return { ...obligationBrief(refreshed), controllerReady: Boolean(observation.process) };
    }
    assertControllerClaim(state, request, dependencies);
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
      const helperProcess = (dependencies.information ?? information)(process.pid, null, store.root);
      requireCondition(helperProcess?.found === true, 'operation-owner-unavailable', 'Cannot dispatch without identifying its actual helper process');
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
      });
      const updateWorker = change => store.update(request.actor, store.read().revision, 'dispatch-progress', current => {
        const worker = current.workers.find(candidate => candidate.id === id);
        Object.assign(worker, change);
      });
      try {
        updateWorker({ phase: 'preparing' });
        const result = await dispatchReview(store.root, {
          ...request.review, id, runId: registered.id, taskId: task.id, lens, candidates,
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
      const existing = task.reviews.find(candidate => candidate.requestId === review.requestId);
      if (existing) {
        const accepted = { ...existing };
        delete accepted.revision;
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
    const result = store.update(request.actor, request.revision, request.action, state => transition(state, prepared));
    return obligationBrief(result);
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

module.exports = { ADOPTION_PROTOCOL, execute };
