'use strict';

const path = require('node:path');
const { requireCondition } = require('./store');
const { workerIsActive } = require('./workers');

const POLLING_STATUSES = ['starting', 'running'];
const DEFAULT_WAIT_MS = 300000;
const POLL_INTERVAL_MS = 1000;

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to another principal.
    return error.code === 'EPERM';
  }
}

function projectRelative(root, file) {
  if (typeof file !== 'string' || !file) return null;
  return (path.isAbsolute(file) ? path.relative(root, file) : file).split(path.sep).join('/');
}

function deadlineReached(state, now) {
  return Boolean(state.limits?.deadlineUtc) && now >= Date.parse(state.limits.deadlineUtc);
}

// Read-only: observes the saved worker until it leaves its polling statuses, its runner process is gone,
// the run stops, the run deadline passes or the requested time elapses. It never changes ownership.
async function awaitWorker(store, request, dependencies = {}) {
  const timeoutMs = request.timeoutMs ?? DEFAULT_WAIT_MS;
  requireCondition(typeof request.workerId === 'string' && request.workerId.length > 0, 'invalid-request', 'wait names the saved workerId to observe');
  requireCondition(Number.isSafeInteger(timeoutMs) && timeoutMs >= 0, 'invalid-request', 'timeoutMs must be a nonnegative integer');
  const now = dependencies.now ?? Date.now;
  const sleep = dependencies.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const exists = dependencies.processExists ?? processExists;
  const initial = store.read(request.runId, { hydrate: false });
  requireCondition(initial, 'missing-state', 'No saved Nightshift run to observe');
  const runId = initial.id;
  const startedAt = now();
  const observe = () => {
    const state = store.read(runId, { hydrate: false });
    requireCondition(state, 'missing-state', 'The observed run is no longer saved');
    const worker = state.workers.find(candidate => candidate.id === request.workerId);
    requireCondition(worker, 'unknown-worker', 'No saved worker with this identity');
    return { state, worker };
  };
  while (true) {
    let { state, worker } = observe();
    let runnerAlive = null;
    if (POLLING_STATUSES.includes(worker.status) && Number.isSafeInteger(worker.runnerPid)) {
      runnerAlive = exists(worker.runnerPid);
      // Completion may have committed between the read and the probe; re-read before reporting a missing runner.
      if (!runnerAlive) ({ state, worker } = observe());
    }
    const polling = POLLING_STATUSES.includes(worker.status);
    const elapsedMs = now() - startedAt;
    const reason = !polling ? 'worker-result'
      : runnerAlive === false ? 'runner-missing'
      : ['complete', 'stopped'].includes(state.status) ? 'run-stopped'
      : deadlineReached(state, now()) ? 'deadline'
      : elapsedMs >= timeoutMs ? 'timeout'
      : null;
    if (reason) {
      return {
        runId, revision: state.revision, runStatus: state.status,
        workerId: worker.id, workerStatus: worker.status, active: workerIsActive(worker), runnerAlive,
        receipt: projectRelative(store.root, worker.receipt), evidence: worker.evidence ?? null,
        elapsedMs, reason,
      };
    }
    await sleep(Math.max(1, Math.min(POLL_INTERVAL_MS, timeoutMs - elapsedMs)));
  }
}

module.exports = { awaitWorker, processExists };
