'use strict';

const fs = require('node:fs');
const { isDeepStrictEqual } = require('node:util');
const { requireCondition, text } = require('./store');
const { projectFile } = require('./evidence');
const { workerIsActive } = require('./workers');
const processes = require('../releases/processes');
const { nativeEvidenceRequests, nativeWorkerTermination } = require('./native-worker-evidence');

const ADOPTION_PROTOCOL = 1;
// Closing duties survive process replacement and never grant canonical engineering.
const CLAIM_EXEMPT = new Set(['claim-controller', 'invalidate-continuation', 'resume', 'stop', 'block', 'unblock', 'followup', 'resolve-followup', 'worker-finished', 'continuation', 'handover', 'report', 'report-delivered', 'retrospective', 'triage', 'review', 'validate']);

function identity(value) {
  return value && ['claude', 'codex'].includes(value.host) && typeof value.session === 'string' && value.session.trim().length > 0;
}

function processIdentity(value) {
  return value && Number.isSafeInteger(value.pid) && value.pid > 0 && typeof value.created === 'string' && value.created.length > 0 && typeof value.name === 'string' && value.name.length > 0;
}

function observeController(root, actor, dependencies = {}) {
  requireCondition(identity(actor), 'invalid-controller', 'A supported host and actual nonempty session identity are required');
  try {
    const observed = (dependencies.nativeOwner ?? processes.nativeOwner)(actor.host, root);
    const alive = processIdentity(observed) && (dependencies.ownerAlive ?? processes.ownerAlive)(observed, root);
    if (alive === true) return { process: { pid: observed.pid, created: observed.created, name: observed.name }, reason: null };
  } catch {
    // A failed native observation never grants controller authority.
  }

  return { process: null, reason: 'The current native controller process could not be positively identified and observed alive' };
}

function controllerClaim(actor, observation, revision) {
  return { controller: { ...actor }, process: observation.process, reason: observation.reason, revision, observedAt: new Date().toISOString() };
}

function assertControllerClaim(state, request, dependencies) {
  if (CLAIM_EXEMPT.has(request.action)) return;
  const observation = observeController(state.root, request.actor, dependencies);
  requireCondition(observation.process && isDeepStrictEqual(state.controllerClaim?.controller, request.actor) && isDeepStrictEqual(state.controllerClaim?.process, observation.process), 'controller-claim-required', 'Obtain a successful claim-controller in this turn before engineering; a missing, failed or previous process claim grants no work');
}

function forbiddenReviewSessions(state) {
  return new Set([state.controller.session, ...(state.adoptions ?? []).map(item => item.previousController.session)]);
}

function readTermination(root, worker, state) {
  if (!worker.terminationPath) return null;
  try {
    const file = projectFile(root, worker.terminationPath);
    if (fs.statSync(file).size > 65536) return null;
    const result = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (result.runId !== state.id || result.workerId !== worker.id || !isDeepStrictEqual(result.helperProcess, worker.helperProcess) || result.descendantsReclaimed !== true) return null;

    return { path: worker.terminationPath, descendantsReclaimed: true, exitCode: result.exitCode, observedAt: result.observedAt };
  } catch {
    return null;
  }
}

function workerTermination(root, worker, state, dependencies = {}, nativePath) {
  const alive = dependencies.ownerAlive ?? processes.ownerAlive;
  if (!workerIsActive(worker)) {
    // A terminal record is the normal lifecycle authority, unless fresh process evidence contradicts it.
    if (worker.childProcess && alive(worker.childProcess, root) === true) return null;

    return { workerId: worker.id, kind: 'terminal-record', status: worker.status };
  }
  if (nativePath) return nativeWorkerTermination(root, nativePath, worker, state);
  if (!processIdentity(worker.helperProcess) || alive(worker.helperProcess, root) !== false) return null;
  if (worker.phase === 'reserved') return { workerId: worker.id, kind: 'pre-launch-helper-ended' };
  // A contained model/command result cannot account for surrounding preparation or finalization subprocesses.
  if (!['launching', 'launched', 'contained'].includes(worker.phase)) return null;
  const termination = readTermination(root, worker, state);
  if (termination) return { workerId: worker.id, kind: 'contained-termination', ...termination };
  if (worker.artifactDirectory && worker.role !== 'operation') {
    try {
      const directory = projectFile(root, worker.artifactDirectory);
      const attempts = fs.readdirSync(directory).filter(name => /^attempt-[1-9][0-9]*$/.test(name));
      if (attempts.length === 0 || attempts.length > 1000) return null;
      const evidence = [];
      for (const attempt of attempts) {
        const relative = worker.artifactDirectory + '/' + attempt + '/result.json';
        const file = projectFile(root, relative);
        if (fs.statSync(file).size > 32 * 1024 * 1024) return null;
        const result = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (result.exit?.descendantsReclaimed !== true) return null;
        evidence.push(relative);
      }

      return { workerId: worker.id, kind: 'native-attempts-terminated', paths: evidence };
    } catch {
      return null;
    }
  }

  return null;
}

function adoptState(state, request, resources, dependencies = {}) {
  requireCondition(identity(request.actor) && identity(request.previousController), 'invalid-controller', 'Adoption requires the adopting and expected former host/session identities');
  text(request.authority, 'adoption.authority');
  requireCondition(request.runId === state.id && request.revision === state.revision && isDeepStrictEqual(request.previousController, state.controller), 'stale-adoption', 'Read the current run, revision and former controller before adoption');
  requireCondition(!isDeepStrictEqual(request.actor, state.controller), 'self-adoption', 'The current owner resumes its own run instead of adopting it');
  requireCondition(['running', 'stopped'].includes(state.status), 'invalid-adoption', 'Only the current unfinished run can be adopted');
  const { executionResources } = require('../releases/entry');
  const previousResources = executionResources(state);
  requireCondition(['bound', 'development'].includes(state.resourceMode), 'legacy-release-reconciliation', 'Legacy run mode needs explicit reconciliation; adoption cannot infer it');
  if (state.resourceMode === 'bound') {
    requireCondition(resources && previousResources && resources.store === previousResources.store && resources.identity === previousResources.identity, 'adoption-resource-conflict', 'Adoption requires the same retained store and exact compatible release');
    requireCondition(resources.session === request.actor.session, 'resource-owner-mismatch', 'The admitted execution binding must name the adopting session');
  } else {
    requireCondition(resources === null && previousResources === null, 'adoption-resource-conflict', 'Development adoption cannot convert a bound or legacy run');
    if (state.operationReservations !== ADOPTION_PROTOCOL) text(request.quiescenceEvidence, 'adoption.quiescenceEvidence: factual accounting of legacy development operations');
  }
  const eligibility = { sourceStatus: state.status, controller: null, workers: [], quiescenceEvidence: request.quiescenceEvidence ?? null };
  if (state.status === 'running') {
    const claim = state.controllerClaim;
    requireCondition(isDeepStrictEqual(claim?.controller, state.controller) && processIdentity(claim?.process), 'controller-activity-unknown', 'The running source has no usable controller claim; stop it through its owner or preserve the blocked run');
    requireCondition((dependencies.ownerAlive ?? processes.ownerAlive)(claim.process, state.root) === false, 'controller-not-inactive', 'The exact former controller process is live or its inactivity is unknown');
    eligibility.controller = structuredClone(claim);
  }
  const nativeEvidence = nativeEvidenceRequests(state, request);
  for (const worker of state.workers) {
    const evidence = workerTermination(state.root, worker, state, dependencies, nativeEvidence.get(worker.id));
    requireCondition(evidence, 'worker-activity-unknown', 'Worker ' + worker.id + ' has active or uncertain work; reconcile attributable termination before adoption');
    eligibility.workers.push(evidence);
  }
  const adoption = { previousController: { ...state.controller }, controller: { ...request.actor }, previousExecutionResources: previousResources, executionResources: resources, authority: request.authority, observedRevision: state.revision, revision: state.revision + 1, observedAt: new Date().toISOString(), eligibility };
  state.adoptions = [...(state.adoptions ?? []), adoption];
  state.adoption = adoption;
  state.controller = { ...request.actor };
  state.executionResources = resources;
  state.status = 'stopped';
  state.mode = 'attended';
  state.controllerClaim = null;
  state.continuation = null;
  delete state.stopRecovery;
  state.stop ??= { kind: 'adopted', reason: 'Ownership adopted; reconcile saved termination evidence and explicitly resume before engineering' };
}

module.exports = { ADOPTION_PROTOCOL, adoptState, assertControllerClaim, controllerClaim, forbiddenReviewSessions, identity, observeController, processIdentity, workerTermination };
