#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { RunStore, requireCondition } = require('./store');
const { assertAction, commitmentsFor, obligationBrief, transition } = require('./lifecycle');
const { verifyCommand } = require('./evidence');
const { dispatchReview, readReceipt, validateBase, validateRequest } = require('./review');
const { exhaustedLimit, remainingTime } = require('./limits');
const { runProbe } = require('./probes');

async function execute(root, request, dependencies = {}) {
  const store = new RunStore(root, { create: request.action === 'create' });
  try {
    if (request.action === 'create') return store.create(request);
    if (request.action === 'status') {
      const state = store.read(request.runId);
      requireCondition(state, 'missing-state', 'No saved Nightshift run');
      return obligationBrief(state);
    }
    if (request.action === 'history') return store.history(request.runId ?? store.read()?.id);
    if (request.action === 'inspect') return store.read(request.runId);
    const state = store.read();
    requireCondition(state, 'missing-state', 'No saved Nightshift run; create or recover the authorized run first');
    requireCondition(state?.controller.session === request.actor?.session && state.controller.host === request.actor?.host && state.revision === request.revision, 'stale-owner', 'Read current state and reconcile the controller identity before changing or dispatching work');
    assertAction(state, request);
    if (request.action === 'dispatch') {
      validateRequest(request.review);
      validateBase(store.root, request.review?.baseSha);
      const id = randomUUID();
      const task = state.tasks.find(candidate => candidate.id === request.taskId);
      const coveredTasks = state.tasks.filter(candidate => candidate.id === task.id || task.kind === 'code' && candidate.kind === 'code' && candidate.status === 'complete');
      const registered = store.update(request.actor, state.revision, 'dispatch-started', current => {
        requireCondition(!current.baseSha || current.baseSha === request.review.baseSha, 'changed-base', 'Cumulative run review must retain its original base');
        current.baseSha = request.review.baseSha;
        current.workers.push({ id, session: null, role: request.review.kind === 'skeptic' ? 'skeptic' : 'reviewer', assignment: 'Assess ' + task.title, taskId: task.id, writes: [], status: 'starting', artifactDirectory: `.nightshift/runs/reviews/${id}`, runnerPid: process.pid });
      });
      const updateWorker = change => store.update(request.actor, store.read().revision, 'dispatch-progress', current => {
        const worker = current.workers.find(candidate => candidate.id === id);
        Object.assign(worker, change);
      });
      try {
        const result = await dispatchReview(store.root, {
          ...request.review, id, runId: registered.id, taskId: task.id,
          artifactPaths: request.review.artifactPaths ?? (task.agreement.spec ? [task.agreement.spec] : undefined),
          probeEvidence: task.probeEvidence ?? [],
          coveredTaskIds: coveredTasks.map(candidate => candidate.id),
          commitments: commitmentsFor(coveredTasks),
          requirements: request.review.requirements + '\n\nAccepted commitments covered by this cumulative assessment:\n' + JSON.stringify(coveredTasks.map(candidate => ({ id: candidate.id, agreement: candidate.agreement }))),
          onProcess: pid => updateWorker({ pid, status: 'running' }),
          onSession: session => updateWorker({ session }),
          onPrepared: assignment => updateWorker({ snapshotDigest: assignment.snapshot.digest, coveredTaskIds: assignment.coveredTaskIds, commitments: assignment.commitments, baseSha: assignment.baseSha }),
          onAttempt: () => store.update(request.actor, store.read().revision, 'model-attempt', current => {
            assertAction(current, request);
            requireCondition(!exhaustedLimit(current, { dispatch: true }), 'resource-limit', 'The authorized model-dispatch allowance has been reached');
            current.dispatches = (current.dispatches ?? 0) + 1;
          }),
          deadlineUtc: state.limits?.deadlineUtc,
          timeoutMs: remainingTime(state, request.review.timeoutMs ?? 900000),
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
      const evidence = runProbe(store.root, receipt, { ...probe, timeoutMs: remainingTime(state, probe.timeoutMs) });
      return store.update(request.actor, request.revision, 'probe-evidence', current => {
        const task = current.tasks.find(candidate => candidate.id === request.taskId);
        task.probeEvidence = [...(task.probeEvidence ?? []), evidence];
      });
    }
    let prepared = request.action === 'check' ? { ...request, evidence: verifyCommand(store.root, { ...request.check, timeoutMs: remainingTime(state, request.check?.timeoutMs ?? 120000) }) } : request;
    if (request.action === 'review') {
      const review = readReceipt(store.root, request.receipt, state, request.taskId);
      const task = state.tasks.find(candidate => candidate.id === request.taskId);
      requireCondition(review.kind === (task.kind === 'spec' ? 'spec' : 'code'), 'wrong-review-kind', 'Receipt kind does not match the lead-assessment boundary');
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
      prepared = { ...request, validation: { ...verdict, session: receipt.session, attributionVerified: true, snapshot: receipt.snapshot } };
    }
    const result = store.update(request.actor, request.revision, request.action, state => transition(state, prepared));
    return obligationBrief(result);
  } finally { store.close(); }
}

async function main() {
  const [root, requestFile] = process.argv.slice(2);
  requireCondition(root && requestFile, 'usage', `Usage: node ${path.basename(__filename)} <project-root> <request.json>`);
  const request = JSON.parse(fs.readFileSync(requestFile, 'utf8').replace(/^\uFEFF/, ''));
  process.stdout.write(JSON.stringify(await execute(root, request), null, 2) + '\n');
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(JSON.stringify({ error: error.code ?? 'operation-failed', message: error.message }) + '\n');
    process.exitCode = 1;
  });
}

module.exports = { execute };
