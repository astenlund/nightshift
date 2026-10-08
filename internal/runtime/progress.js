'use strict';

const { createHash } = require('node:crypto');
const { requireCondition } = require('./errors');

const HASH = /^[a-f0-9]{64}$/;
const MAX_CREDITS = 65536;
const MAX_FRONTIER_BYTES = 8 * 1024 * 1024;
const MAX_RECOVERY_REVISIONS = 256;
const MAX_RECOVERY_BYTES = 16 * 1024 * 1024;
const CLOSING_CONTEXT = Symbol('established closing context');
const BASIS_KINDS = new Set(['execution-commitments', 'verification', 'fresh-assessment', 'repair-assessment', 'repair-closed']);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

function fingerprint(value) {
  return createHash('sha256').update((JSON.stringify(canonical(value)) ?? 'undefined')).digest('hex');
}

function encodedHash(state) {
  const { progress, stopRecovery, ...content } = state;
  return fingerprint(content);
}

function snapshotIdentity(snapshot) {
  requireCondition(snapshot && Array.isArray(snapshot.files) && HASH.test(snapshot.digest), 'progress-evidence-unavailable', 'Progress snapshot is missing or malformed');
  requireCondition(createHash('sha256').update(JSON.stringify(snapshot.files)).digest('hex') === snapshot.digest, 'progress-evidence-unavailable', 'Progress snapshot digest does not match its files');
  const files = snapshot.files.map(file => {
    requireCondition(typeof file.path === 'string' && (file.sha256 === null || HASH.test(file.sha256)), 'progress-evidence-unavailable', 'Progress snapshot file identity is malformed');
    return { path: file.path, sha256: file.sha256 };
  }).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return { files, inventory: snapshot.inventory === true, backlogOnly: snapshot.backlogOnly === true, includedPaths: [...new Set(snapshot.includedPaths ?? [])].sort(), excludedPaths: [...new Set(snapshot.excludedPaths ?? [])].sort() };
}

function validMarker(state) {
  const marker = state.progress;
  return marker?.schema === 2 && marker.runId === state.id && marker.atRevision === state.revision && Number.isSafeInteger(marker.atRevision) && marker.atRevision >= 0 && marker.status === 'current' && marker.reason === null && HASH.test(marker.token) && HASH.test(marker.frontierHash) && HASH.test(marker.encodedHash) && HASH.test(marker.reminderHash) && marker.encodedHash === encodedHash(state);
}

function validateFrontier(frontier, runId) {
  requireCondition(frontier?.schema === 2 && frontier.runId === runId && Array.isArray(frontier.credits) && frontier.credits.length <= MAX_CREDITS && Array.isArray(frontier.closingBasis) && frontier.closingBasis.length <= MAX_CREDITS, 'progress-frontier-unavailable', 'Progress frontier is missing, foreign or exceeds its bound');
  requireCondition(Buffer.byteLength(JSON.stringify(frontier)) <= MAX_FRONTIER_BYTES, 'progress-frontier-unavailable', 'Progress frontier exceeds its byte bound');
  requireCondition(frontier.credits.every((credit, index) => HASH.test(credit) && (index === 0 || frontier.credits[index - 1] < credit)), 'progress-frontier-unavailable', 'Progress credits must be sorted unique content identities');
  const credits = new Set(frontier.credits);
  requireCondition(frontier.closingBasis.every((credit, index) => HASH.test(credit) && credits.has(credit) && (index === 0 || frontier.closingBasis[index - 1] < credit)), 'progress-frontier-unavailable', 'Closing basis must be a sorted unique subset of credited achievements');
  return frontier;
}

function reminderHash(runId, reminder) {
  return fingerprint({ schema: 1, runId, reminder: reminder ?? null });
}

function closingBinding(runId, closingBasis) {
  return { schema: 1, runId, contextHash: fingerprint({ schema: 1, runId, closingBasis }) };
}

function validClosingBinding(binding, runId) {
  return binding?.schema === 1 && binding.runId === runId && HASH.test(binding.contextHash);
}

function establishClosingContext(state, frontier) {
  Object.defineProperty(state, CLOSING_CONTEXT, { value: closingBinding(state.id, frontier.closingBasis), configurable: true });
}

function captureClosingBinding(state) {
  return state[CLOSING_CONTEXT] ? structuredClone(state[CLOSING_CONTEXT]) : null;
}

function boundContext(binding, state) {
  requireCondition(validClosingBinding(binding, state.id), 'progress-evidence-unavailable', 'Closing evidence has no established context binding');
  return { runId: state.id, contextHash: binding.contextHash };
}

function validateClosingTransition(before, after, frontier) {
  const same = require('node:util').isDeepStrictEqual;
  const context = closingBinding(after.id, frontier.closingBasis);
  const accept = (binding, previous, expected) => {
    requireCondition(validClosingBinding(binding, after.id) && (same(binding, previous) || same(binding, expected)), 'progress-evidence-unavailable', 'Closing evidence contradicts its established discharge context');
  };
  const old = before.closing;
  const current = after.closing;
  if (!current) return;
  const bindings = current.progressBindings ?? {};
  const previous = old?.progressBindings ?? {};
  if (current.retrospectiveEvidence) accept(bindings.retrospective, old?.retrospectiveEvidence ? previous.retrospective : null, context);
  if (current.reportEvidence) accept(bindings.report, old?.reportEvidence ? previous.report : null, bindings.retrospective);
  if (current.reportDelivery) accept(bindings.delivery, old?.reportDelivery ? previous.delivery : null, bindings.report);
  if (current.triageEvidence) accept(bindings.triage, old?.triageEvidence ? previous.triage : null, bindings.retrospective);
  const record = current.docs;
  if (!record) return;
  accept(record.progressBinding, old?.docs?.progressBinding, bindings.triage);
  for (const category of ['checks', 'reviews']) {
    for (const evidence of record[category] ?? []) {
      const prior = (old?.docs?.[category] ?? []).find(item => category === 'checks' ? item.attemptId === evidence.attemptId && item.name === evidence.name : item.requestId === evidence.requestId);
      if (category === 'checks' && !evidence.passed) continue;
      accept(evidence.progressBinding, prior?.progressBinding, record.progressBinding);
    }
  }
  const priorFindings = [...(old?.docs?.findings ?? []), ...(old?.carriedFindings ?? [])];
  for (const finding of record.findings ?? []) {
    const prior = priorFindings.find(item => item.id === finding.id);
    accept(finding.progressBinding, prior?.progressBinding, record.progressBinding);
    if (finding.validation) accept(finding.validation.progressBinding, prior?.validation?.progressBinding, finding.progressBinding);
    if (finding.pendingClosure) accept(finding.pendingClosure.progressBinding, prior?.pendingClosure?.progressBinding, finding.progressBinding);
    for (const closure of finding.closures ?? []) accept(closure.progressBinding, prior?.closures?.find(item => item.requestId === closure.requestId)?.progressBinding, finding.progressBinding);
  }
}

function validReminder(reminder, state) {
  return reminder?.schema === 2 && reminder.runId === state.id && HASH.test(reminder.token) && Number.isSafeInteger(reminder.reminders) && reminder.reminders >= 1 && reminder.reminders <= 3 && Number.isSafeInteger(reminder.atRevision) && reminder.atRevision >= 0 && reminder.atRevision <= state.revision;
}

function requirementContext(task, resolve = value => value) {
  return { id: task.id, kind: task.kind ?? 'code', requires: [...new Set(task.requires ?? [])].sort(), outcome: task.agreement?.outcome, decisions: [...new Set(task.agreement?.decisions ?? [])], spec: task.agreement?.spec ?? null, specTask: task.agreement?.specReviewTaskId ?? null, specContent: task.specAcceptance?.snapshot ? snapshotIdentity(resolve(task.specAcceptance.snapshot)) : task.agreement?.specSnapshot ? snapshotIdentity(resolve(task.agreement.specSnapshot)) : null };
}

function findingSubject(finding) {
  return { severity: finding.severity, required: finding.required === true, consequence: finding.consequence, obligation: finding.obligation?.classification ?? null };
}

function usableReview(review, task) {
  const dimensions = { code: ['requirements-ux', 'correctness-integration', 'security-data-safety', 'design-maintainability', 'performance-resources', 'tests-evidence'], spec: ['intent-scope-acceptance', 'soundness-integration', 'failure-safety-recovery', 'clarity-consistency-proportionality'], docs: ['claim-accuracy', 'sweep-completeness', 'backlog-conventions', 'sibling-consistency', 'proportionality'] };
  const kind = review.kind ?? task.kind;
  return review.status === 'complete' && review.strength === 'strong' && review.independent === true && review.attributionVerified === true && review.broad === true && typeof review.coverageEvidence === 'string' && review.coverageEvidence.trim() && dimensions[kind]?.every(dimension => review.dimensions?.includes(dimension)) && (task.kind === 'closing' || (review.revision ?? -1) >= (task.requirementsRevision ?? 0) && require('node:util').isDeepStrictEqual(review.commitments?.[task.id], { agreement: task.agreement, revision: task.requirementsRevision ?? 0 }));
}

function semanticFacts(state, resolve = value => value) {
  requireCondition(Array.isArray(state.tasks), 'progress-evidence-unavailable', 'Progress task inventory is unavailable');
  const credits = new Set();
  const basis = new Set();
  let inClosing = false;
  const add = (kind, context, proof = null) => {
    const credit = fingerprint({ kind, context, proof });
    credits.add(credit);
    if (!inClosing && (BASIS_KINDS.has(kind) || kind === 'task-stage' && proof === 'complete')) basis.add(credit);
  };
  const proof = value => snapshotIdentity(resolve(value));
  const subjects = state.tasks.map(task => requirementContext(task, resolve));
  const targets = state.closing?.docs ? [...state.tasks, state.closing.docs] : state.tasks;
  for (const task of targets) {
    inClosing = task.kind === 'closing';
    if (task.baseline) proof(task.baseline);
    if (task.docsExemption?.snapshot) proof(task.docsExemption.snapshot);
    const context = inClosing ? boundContext(task.progressBinding, state) : requirementContext(task, resolve);
    if (task.kind !== 'closing') add('execution-commitments', context);
    if (task.status === 'active' || task.status === 'complete') add('task-started', context);
    const stages = task.kind === 'lore' ? ['review', 'retrospective', 'complete'] : ['implementation', 'review', 'documentation', 'complete'];
    const stageIndex = stages.indexOf(task.stage);
    requireCondition(task.kind === 'closing' || stageIndex >= 0, 'progress-evidence-unavailable', 'Progress task stage is unsupported');
    for (let index = 1; index <= stageIndex; index++) add('task-stage', context, stages[index]);
    for (const check of task.checks ?? []) {
      if (check.passed !== true || check.inputsUnchanged !== true || check.exitCode !== 0 || check.error || check.pending) continue;
      add('verification', inClosing ? boundContext(check.progressBinding, state) : context, { executable: check.executable, args: check.args, resourceMode: check.resourceMode ?? 'inherit', snapshot: proof(check.snapshot) });
    }
    for (const review of task.reviews ?? []) {
      if (!usableReview(review, task)) continue;
      add(review.continues ? 'repair-assessment' : 'fresh-assessment', inClosing ? boundContext(review.progressBinding, state) : context, { kind: review.kind ?? task.kind, dimensions: [...new Set(review.dimensions ?? [])].sort(), coveredTasks: [...new Set(review.coveredTaskIds ?? [task.id])].sort(), snapshot: proof(review.snapshot), surrounding: review.contextSnapshot ? proof(review.contextSnapshot) : null });
    }
    for (const finding of task.findings ?? []) {
      const owner = (task.reviews ?? []).find(review => review.requestId === finding.raisedBy?.requestId);
      if (!owner || (owner.revision ?? -1) < (task.requirementsRevision ?? 0)) continue;
      const subject = { context: inClosing ? boundContext(finding.progressBinding, state) : context, finding: findingSubject(finding), assessment: { kind: owner.kind ?? task.kind, snapshot: proof(owner.snapshot) } };
      const validation = finding.validation;
      if (validation?.attributionVerified === true && ['confirmed', 'refuted'].includes(validation.verdict)) {
        if (inClosing) boundContext(validation.progressBinding, state);
        add('finding-validated', subject, { verdict: validation.verdict, snapshot: proof(validation.snapshot) });
        if (finding.disposition) add('finding-disposed', subject, { disposition: finding.disposition, classification: finding.obligation?.classification ?? null, verdict: validation.verdict, snapshot: proof(validation.snapshot) });
      }
      if (finding.repaired === true && finding.disposition === 'implement') add('finding-repaired', subject);
      if (finding.repaired === true && !finding.pendingClosure) {
        for (const closure of finding.closures ?? []) {
          const assessment = (task.reviews ?? []).find(review => review.requestId === closure.requestId);
          if (closure.closed === true && closure.revision > (finding.repairRevision ?? -1) && assessment?.continues && usableReview(assessment, task)) add('repair-closed', subject, proof(assessment.snapshot));
        }
      }
    }
  }
  inClosing = false;
  const acknowledgement = state.acknowledgement;
  if (acknowledgement?.status === 'observed' && require('./acknowledgement').acknowledged(state)) {
    add('acknowledged', { runId: state.id, controller: acknowledgement.controller, scope: subjects, limits: state.limits });
  }
  const closing = state.closing;
  if (closing?.carriedBaseline) proof(closing.carriedBaseline);
  if (closing?.retrospectiveEvidence) add('retrospective', boundContext(closing.progressBindings?.retrospective, state));
  if (closing?.reportEvidence?.sha256 && HASH.test(closing.reportEvidence.sha256)) add('report', boundContext(closing.progressBindings?.report, state));
  if (closing?.reportDelivery?.sha256 && HASH.test(closing.reportDelivery.sha256)) add('report-delivered', boundContext(closing.progressBindings?.delivery, state));
  if (closing?.triageEvidence) add('triage', boundContext(closing.progressBindings?.triage, state));
  for (const followup of state.followups ?? []) {
    if (followup.status === 'resolved' && followup.decision) add('followup-resolved', { title: followup.title, context: followup.context }, { decision: followup.decision, route: followup.route ?? null });
  }
  return { credits: [...credits].sort(), closingBasis: [...basis].sort() };
}

function achievements(state, resolve) { return semanticFacts(state, resolve).credits; }

function controlDelta(before, after) {
  const delta = [];
  if (before.status === 'stopped' && after.status === 'running') delta.push({ kind: 'resumed', controller: after.controller });
  if (before.status !== 'complete' && after.status === 'complete') delta.push({ kind: 'completed' });
  if (fingerprint(before.controller) !== fingerprint(after.controller)) delta.push({ kind: 'owner-transferred', controller: after.controller });
  return delta;
}

module.exports = { HASH, MAX_CREDITS, MAX_FRONTIER_BYTES, MAX_RECOVERY_REVISIONS, MAX_RECOVERY_BYTES, canonical, fingerprint, encodedHash, snapshotIdentity, validMarker, validateFrontier, validReminder, reminderHash, closingBinding, validClosingBinding, establishClosingContext, captureClosingBinding, validateClosingTransition, requirementContext, findingSubject, semanticFacts, achievements, controlDelta };
