'use strict';

const { workerIsActive } = require('./workers');
const { isDeepStrictEqual } = require('node:util');

const { requireCondition, text } = require('./store');
const { fresh, projectFile } = require('./evidence');
const { exhaustedLimit } = require('./limits');

const DIMENSIONS = Object.freeze({
  spec: ['intent-scope-acceptance', 'soundness-integration', 'failure-safety-recovery', 'clarity-consistency-proportionality'],
  code: ['requirements-ux', 'correctness-integration', 'security-data-safety', 'design-maintainability', 'performance-resources', 'tests-evidence'],
});

function taskById(state, id) {
  text(id, 'taskId');
  const task = state.tasks.find(candidate => candidate.id === id);
  requireCondition(task, 'unknown-task', 'Task does not belong to the authorized queue');
  return task;
}

function unresolvedFindings(task) {
  return task.findings.filter(finding => !finding.disposition || finding.disposition === 'implement' && !finding.repaired);
}

function commitmentsFor(tasks) {
  return Object.fromEntries(tasks.map(task => [task.id, { agreement: structuredClone(task.agreement), revision: task.requirementsRevision ?? 0 }]));
}

function verificationGate(root, task) {
  const latest = new Map(task.checks.map(check => [check.name, check]));
  return (task.kind !== 'code' || latest.size > 0) && [...latest.values()].every(check => check.passed && fresh(root, check.snapshot));
}

function requiresReview(task) {
  return ['code', 'spec'].includes(task.kind) || task.reviews.length > 0;
}

function closingReady(state) {
  return !state.workers.some(workerIsActive) && (state.status === 'stopped' || !state.tasks.some(task => task.status !== 'complete' && !task.blocker && task.requires.every(id => taskById(state, id).status === 'complete')));
}

function resetClosing(state) {
  state.closing = { retrospectiveEvidence: null, triageEvidence: null };
}

function recordRetrospective(state, evidence) {
  text(evidence, 'retrospective.evidence');
  state.closing = { retrospectiveEvidence: evidence, triageEvidence: null };
}

function specReady(state, task) {
  if (task.kind !== 'code' || !Object.hasOwn(task.agreement, 'spec')) return true;
  if (typeof task.agreement.spec !== 'string' || !task.agreement.spec.trim()) return false;
  if (!task.agreement.specReviewTaskId && task.agreement.specReviewed === true) {
    const evidence = task.agreement.specSnapshot;
    return evidence?.files?.length === 1 && evidence.files[0].path === task.agreement.spec && typeof evidence.files[0].sha256 === 'string' && fresh(state.root, evidence);
  }
  const spec = state.tasks.find(candidate => candidate.id === task.agreement.specReviewTaskId);
  return spec?.kind === 'spec' && spec.status === 'complete' && spec.agreement.spec === task.agreement.spec && reviewGate(state.root, spec, state);
}

function reviewGate(root, task, state) {
  const candidates = state
    ? state.tasks.flatMap(owner => owner.reviews.filter(review => owner.id === task.id || task.kind === 'code' && owner.kind === 'code' && review.kind === 'code' && review.coveredTaskIds?.includes(task.id)))
    : task.reviews;
  const review = [...candidates].sort((left, right) => (right.revision ?? 0) - (left.revision ?? 0))[0];
  if (task.requirementsRevision !== undefined && (review?.revision ?? -1) < task.requirementsRevision) return false;
  if (!isDeepStrictEqual(review?.commitments?.[task.id], commitmentsFor([task])[task.id])) return false;
  if (!review || review.status !== 'complete' || review.strength !== 'strong' || review.independent !== true || review.broad !== true || !review.coverageEvidence?.trim() || !fresh(root, review.snapshot)) return false;
  const dimensions = DIMENSIONS[task.kind === 'spec' ? 'spec' : 'code'];
  if (!dimensions.every(dimension => review.dimensions.includes(dimension))) return false;
  if (!verificationGate(root, task)) return false;
  if (task.findings.some(finding => !finding.validation || finding.validation.verdict === 'unverified' || !finding.disposition)) return false;
  if (state && state.tasks.flatMap(owner => owner.findings).some(finding => finding.reviewRevision === review.revision && (!finding.validation || finding.validation.verdict === 'unverified' || !finding.disposition || finding.disposition === 'implement' && !finding.repaired))) return false;
  if (unresolvedFindings(task).length > 0) return false;
  return !task.findings.some(finding => finding.repaired && finding.repairRevision >= review.revision);
}

function obligationBrief(state, root = state.root, options = {}) {
  const active = state.tasks.filter(task => task.status !== 'complete');
  const ready = active.filter(task => !task.blocker && task.requires.every(id => taskById(state, id).status === 'complete'));
  return {
    id: state.id, revision: state.revision, status: state.status, controller: state.controller,
    objective: state.objective, authority: state.authority, limits: state.limits, publication: state.publication,
    resourceMode: state.resourceMode ?? 'legacy', resources: state.resources ?? null,
    next: ready.map(task => ({
      id: task.id, title: task.title,
      stage: options.verifyFreshness !== false && !specReady(state, task) ? 'governing-spec-review' : task.stage,
      agreement: { source: task.agreement.source, outcome: task.agreement.outcome, decisions: task.agreement.decisions, spec: task.agreement.spec, specReviewTaskId: task.agreement.specReviewTaskId },
      unresolvedFindings: unresolvedFindings(task).map(finding => ({ id: finding.id, consequence: finding.consequence, verdict: finding.validation?.verdict ?? null, disposition: finding.disposition, evidence: finding.evidence.slice(0, 600) })),
      reviewCurrent: options.verifyFreshness === false ? 'reconcile at acceptance' : reviewGate(root, task, state),
    })),
    finalReconciliationPending: state.status === 'running' && active.length === 0,
    closing: { ready: closingReady(state), stage: state.closing?.triageEvidence ? 'complete' : state.closing?.retrospectiveEvidence ? 'triage' : 'retrospective' },
    blockers: active.filter(task => task.blocker).map(task => ({ id: task.id, blocker: task.blocker })),
    workers: state.workers.filter(workerIsActive),
    followups: state.followups.filter(item => item.status !== 'resolved'),
    rules: 'Continue authorized independent work and recovery. Every repair needs cumulative strong broad review. Validate every finding with a fresh skeptic before disposition. Preserve writer ownership. Update documentation, then retrospective, then follow-up triage. Missing or stale evidence is incomplete. Publication requires authority. Reconcile this record with actual files after compaction.',
  };
}

function assertAction(state, request) {
  const taskActions = ['start-task', 'add-spec-review', 'check', 'dispatch', 'probe', 'review', 'validate', 'dispose', 'repair', 'advance', 'block', 'unblock'];
  const task = taskActions.includes(request.action) ? taskById(state, request.taskId) : null;
  const bookkeeping = ['worker-finished', 'followup', 'resolve-followup', 'resume', 'stop', 'block', 'retrospective', 'triage'];
  requireCondition(state.status === 'running' || bookkeeping.includes(request.action), 'run-stopped', 'The run is stopped; explicit resumption is required before more work');
  if (!bookkeeping.includes(request.action)) {
    requireCondition(!exhaustedLimit(state, { dispatch: request.action === 'dispatch' }), 'resource-limit', exhaustedLimit(state, { dispatch: request.action === 'dispatch' }));
    if (state.mode === 'unattended' && request.action !== 'continuation') requireCondition(state.continuation?.verified === true, 'unverified-continuation', 'Verify the actual host continuation mechanism before unattended execution');
  }
  if (task && !['block', 'unblock', 'add-spec-review'].includes(request.action)) {
    requireCondition(!task.blocker, 'task-blocked', 'Resolve the recorded blocker before dependent work');
    requireCondition(task.requires.every(id => taskById(state, id).status === 'complete'), 'dependency-blocked', 'An upstream task remains incomplete');
    requireCondition(specReady(state, task), 'spec-review-required', 'Substantial implementation requires resolved independent spec assessment');
  }
  return task;
}

function transition(state, request) {
  const task = assertAction(state, request);
  switch (request.action) {
    case 'add-spec-review': {
      requireCondition(task.kind === 'code' && task.agreement.spec, 'missing-spec', 'A governing spec is required for this internal assessment');
      if (task.agreement.specReviewTaskId) break;
      const id = task.id + '-governing-spec';
      requireCondition(!state.tasks.some(candidate => candidate.id === id), 'duplicate-task', 'The governing-spec task identity is already in use');
      state.tasks.push({ id, title: 'Assess governing spec for ' + task.title, kind: 'spec', requires: [], status: 'pending', stage: 'implementation', agreement: { source: task.agreement.source, outcome: task.agreement.outcome, spec: task.agreement.spec }, checks: [], reviews: [], findings: [], blocker: null });
      task.agreement.specReviewTaskId = id;
      task.agreement.specReviewed = false;
      resetClosing(state);
      break;
    }
    case 'start-task':
      requireCondition(state.status === 'running' && task.status !== 'complete' && !task.blocker, 'task-blocked', 'Task is not actionable');
      requireCondition(task.requires.every(id => taskById(state, id).status === 'complete'), 'dependency-blocked', 'An upstream task remains incomplete');
      requireCondition(specReady(state, task), 'spec-review-required', 'Substantial work requires resolved independent spec review');
      task.status = 'active';
      resetClosing(state);
      break;
    case 'check':
      requireCondition(request.evidence && fresh(state.root, request.evidence.snapshot), 'stale-evidence', 'Verification inputs changed or are missing');
      task.checks.push(request.evidence);
      break;
    case 'review': {
      const review = request.review;
      requireCondition(review && fresh(state.root, review.snapshot), 'stale-review', 'Review inputs changed or are missing');
      requireCondition(!review.requestId || !task.reviews.some(previous => previous.requestId === review.requestId), 'duplicate-review', 'This assessment is already imported; reconcile its existing findings');
      requireCondition(review.session && review.session !== state.controller.session && review.attributionVerified === true, 'unattributed-review', 'Independent reviewer attribution is required');
      requireCondition(Array.isArray(review.findings) && Array.isArray(review.dimensions), 'invalid-review', 'Review must contain findings and coverage');
      const revision = state.revision + 1;
      const previous = task.reviews.at(-1);
      if (task.status !== 'complete' || previous?.snapshot?.digest !== review.snapshot.digest || !isDeepStrictEqual(previous?.commitments, review.commitments)) resetClosing(state);
      task.reviews.push({ ...review, revision });
      for (const finding of review.findings) {
        text(finding.id, 'finding.id');
        text(finding.consequence, 'finding.consequence');
        text(finding.evidence, 'finding.evidence');
        const id = review.requestId ? `${review.requestId}:${finding.id}` : `${revision}:${finding.id}`;
        const relatedTo = task.findings.filter(existing => existing.localId === finding.id).map(existing => existing.id);
        task.findings.push({ ...finding, id, localId: finding.id, relatedTo, reviewRevision: revision, reviewer: review.session, validation: null, disposition: null, repaired: false });
      }
      if (!['implementation', 'review'].includes(task.stage)) task.resumeStage = task.stage;
      task.stage = 'review';
      task.status = 'active';
      break;
    }
    case 'validate': {
      const finding = task.findings.find(candidate => candidate.id === request.findingId);
      requireCondition(finding, 'unknown-finding', 'Finding is not recorded');
      const validation = request.validation;
      requireCondition(validation?.session && ![state.controller.session, finding.reviewer].includes(validation.session) && validation.attributionVerified === true, 'skeptic-required', 'A fresh attributed skeptic must validate this finding');
      requireCondition(['confirmed', 'refuted', 'unverified'].includes(validation.verdict), 'invalid-verdict', 'Unknown skeptic verdict');
      text(validation.evidence, 'validation.evidence');
      requireCondition(fresh(state.root, validation.snapshot), 'stale-validation', 'Skeptic evidence must match current inputs');
      finding.validation = validation;
      finding.disposition = null;
      finding.repaired = false;
      delete finding.repairRevision;
      break;
    }
    case 'dispose': {
      const finding = task.findings.find(candidate => candidate.id === request.findingId);
      requireCondition(finding?.validation && finding.validation.verdict !== 'unverified', 'unvalidated-finding', 'Missing evidence is unresolved');
      requireCondition(fresh(state.root, finding.validation.snapshot), 'stale-validation', 'Skeptic evidence changed before disposition');
      requireCondition(['implement', 'defer', 'skip', 'refuted'].includes(request.disposition), 'invalid-disposition', 'Unknown finding disposition');
      text(request.reason, 'disposition.reason');
      requireCondition(request.disposition !== 'refuted' || finding.validation.verdict === 'refuted', 'invalid-disposition', 'Refutation needs concrete skeptic evidence');
      requireCondition(request.disposition !== 'defer' || typeof request.route === 'string' && request.route.trim(), 'missing-route', 'Deferred findings need a durable route');
      if (finding.validation.verdict === 'confirmed') {
        const obligation = request.obligation;
        requireCondition(['required', 'optional', 'out-of-scope'].includes(obligation?.classification), 'missing-authority-assessment', 'The controller must assess the finding against accepted commitments and repair authority');
        text(obligation.basis, 'obligation.basis');
        requireCondition(obligation.classification !== 'required' || request.disposition === 'implement', 'required-obligation', 'An agreed required obligation cannot be waived');
        requireCondition(obligation.classification !== 'out-of-scope' || request.disposition !== 'implement', 'unauthorized-repair', 'An out-of-scope finding does not authorize a repair');
      }
      Object.assign(finding, { obligation: request.obligation ?? null, disposition: request.disposition, reason: request.reason, route: request.route ?? null });
      break;
    }
    case 'repair':
      requireCondition(Array.isArray(request.findingIds) && request.findingIds.length > 0, 'invalid-repair', 'Repair must name its findings');
      for (const id of request.findingIds) {
        const finding = task.findings.find(candidate => candidate.id === id);
        requireCondition(finding?.disposition === 'implement', 'unauthorized-repair', 'Repair requires a validated implement disposition');
        Object.assign(finding, { repaired: true, repairRevision: state.revision + 1 });
      }
      task.stage = 'review';
      task.status = 'active';
      resetClosing(state);
      task.probeEvidence = [];
      if (task.resumeStage) task.resumeStage = task.kind === 'lore' ? 'retrospective' : 'documentation';
      break;
    case 'advance': {
      const stages = task.kind === 'lore' ? ['review', 'retrospective', 'complete'] : ['implementation', 'review', 'documentation', 'complete'];
      const current = stages.indexOf(task.stage);
      requireCondition(current >= 0 && current < stages.length - 1, 'invalid-stage', 'Task cannot advance');
      if (task.stage === 'implementation' && task.kind === 'code') {
        requireCondition(verificationGate(state.root, task), 'verification-required', 'Implementation requires current passing verification for each named check');
      }
      if (task.stage === 'review') requireCondition(reviewGate(state.root, task, state), 'review-required', 'A complete strong broad assessment and resolved findings are required');
      if (['documentation', 'retrospective'].includes(task.stage)) {
        if (requiresReview(task)) requireCondition(reviewGate(state.root, task, state), 'review-required', 'Reviewed work needs current cumulative assessment and applicable verification before task completion');
        requireCondition(verificationGate(state.root, task), 'verification-required', 'Every registered check must pass on current inputs before task completion');
        text(request.evidence, `${task.stage}.evidence`);
      }
      task[task.stage + 'Evidence'] = request.evidence ?? null;
      const internalSpec = task.kind === 'spec' && state.tasks.some(owner => owner.kind === 'code' && owner.agreement.specReviewTaskId === task.id);
      const refreshingCompleted = task.stage === 'review' && task.resumeStage === 'complete';
      // Older lore repairs persisted documentation as their resume target.
      const resumeStage = task.kind === 'lore' && task.resumeStage === 'documentation' ? 'retrospective' : task.resumeStage;
      task.stage = task.stage === 'review' && internalSpec ? 'complete' : task.stage === 'review' && resumeStage ? resumeStage : stages[current + 1];
      delete task.resumeStage;
      if (task.stage === 'complete') {
        task.status = 'complete';
        if (!refreshingCompleted) resetClosing(state);
        if (!refreshingCompleted && task.kind === 'lore' && closingReady(state)) recordRetrospective(state, request.evidence);
      }
      break;
    }
    case 'block':
      text(request.blocker?.reason, 'blocker.reason');
      text(request.blocker?.recoveryAttempted, 'blocker.recoveryAttempted');
      requireCondition(['user-decision', 'capability', 'resource', 'dependency'].includes(request.blocker.kind), 'invalid-blocker', 'Unknown blocking condition');
      task.blocker = request.blocker;
      if (task.status === 'complete') {
        task.status = 'active';
        task.stage = task.kind === 'lore' ? 'retrospective' : task.kind === 'docs' ? 'documentation' : 'review';
      }
      break;
    case 'unblock':
      text(request.evidence, 'unblock.evidence');
      requireCondition(task.blocker, 'not-blocked', 'Task has no recorded blocker to resolve');
      task.resolutions = [...(task.resolutions ?? []), { blocker: task.blocker, evidence: request.evidence }];
      if (task.blocker.kind === 'user-decision') {
        resetClosing(state);
        task.agreement.decisions = [...(task.agreement.decisions ?? []), request.evidence];
        if (request.updatedOutcome !== undefined) task.agreement.outcome = text(request.updatedOutcome, 'updatedOutcome');
        task.requirementsRevision = state.revision + 1;
        const spec = state.tasks.find(candidate => candidate.id === task.agreement.specReviewTaskId);
        if (spec) {
          spec.agreement.decisions = [...(spec.agreement.decisions ?? []), request.evidence];
          spec.requirementsRevision = state.revision + 1;
          spec.status = 'pending';
          spec.stage = 'implementation';
        } else if (task.agreement.spec) task.agreement.specReviewed = false;
      }
      task.blocker = null;
      break;
    case 'retrospective':
      requireCondition(state.status !== 'complete' && closingReady(state), 'closing-before-work', 'Finish actionable engineering and reconcile workers before session retrospective');
      recordRetrospective(state, request.evidence);
      break;
    case 'triage':
      requireCondition(state.status !== 'complete' && closingReady(state) && state.closing?.retrospectiveEvidence, 'retrospective-required', 'Session retrospective must precede follow-up triage');
      text(request.evidence, 'triage.evidence');
      state.closing.triageEvidence = request.evidence;
      break;
    case 'followup':
      text(request.item?.id, 'followup.id');
      text(request.item?.context, 'followup.context');
      text(request.item?.recommendation, 'followup.recommendation');
      requireCondition(!state.followups.some(item => item.id === request.item.id), 'duplicate-followup', 'Follow-up already exists');
      state.followups.push({ ...request.item, status: 'pending' });
      break;
    case 'resolve-followup': {
      const item = state.followups.find(candidate => candidate.id === request.followupId);
      requireCondition(item?.status === 'pending', 'unknown-followup', 'No pending follow-up with that identity');
      text(request.decision, 'followup.decision');
      text(request.authority, 'followup.authority');
      Object.assign(item, { status: 'resolved', decision: request.decision, authority: request.authority, route: request.route ?? null });
      break;
    }
    case 'resume':
      requireCondition(state.status === 'stopped', 'invalid-resume', 'Only a stopped run needs explicit resumption');
      text(request.authority, 'resume.authority');
      requireCondition(state.workers.every(worker => !workerIsActive(worker)), 'active-workers', 'Reconcile surviving workers before resuming');
      state.status = 'running';
      state.resumedBy = request.authority;
      delete state.stop;
      break;
    case 'continuation':
      requireCondition(request.mechanism?.verified === true, 'unverified-continuation', 'Unattended continuation requires observed host evidence');
      text(request.mechanism.evidence, 'continuation.evidence');
      state.continuation = request.mechanism;
      break;
    case 'worker': {
      const worker = request.worker;
      text(worker?.id, 'worker.id');
      text(worker.session, 'worker.session');
      text(worker.assignment, 'worker.assignment');
      requireCondition(['implementer', 'reviewer', 'skeptic', 'supervisor', 'peer'].includes(worker.role), 'invalid-worker', 'Unknown worker role');
      requireCondition(!state.workers.some(existing => existing.id === worker.id), 'duplicate-worker', 'Worker identity already exists');
      requireCondition(Array.isArray(worker.writes), 'invalid-worker', 'Worker must declare write ownership, including an empty list for reviewers');
      worker.writes.forEach(target => projectFile(state.root, target));
      requireCondition(!['reviewer', 'skeptic', 'peer', 'supervisor'].includes(worker.role) || worker.writes.length === 0, 'reviewer-write', 'Only assigned implementers can own project writes');
      const overlaps = (left, right) => {
        const a = process.platform === 'win32' ? left.toUpperCase() : left;
        const b = process.platform === 'win32' ? right.toUpperCase() : right;
        return a === b || a.startsWith(b + '/') || b.startsWith(a + '/');
      };
      for (const other of state.workers.filter(workerIsActive)) {
        requireCondition(!worker.writes.some(target => other.writes.some(owned => overlaps(target, owned))), 'writer-conflict', 'Another worker owns the requested paths');
      }
      if (worker.role === 'peer') {
        const lead = state.workers.find(existing => existing.id === worker.lead);
        requireCondition(lead?.role === 'reviewer' && lead.model === worker.model && lead.effort === worker.effort, 'peer-mismatch', 'Review peers must clone their lead model and effort');
      }
      state.workers.push({ ...worker, status: 'running' });
      break;
    }
    case 'worker-finished': {
      const worker = state.workers.find(existing => existing.id === request.workerId);
      requireCondition(worker && workerIsActive(worker), 'unknown-worker', 'No active worker with this identity');
      requireCondition(['complete', 'failed', 'stopped'].includes(request.status), 'invalid-worker', 'Unknown worker result status');
      text(request.evidence, 'worker.evidence');
      worker.status = request.status;
      worker.evidence = request.evidence;
      break;
    }
    case 'stop':
      text(request.reason, 'stop.reason');
      requireCondition(['user-stop', 'resource-limit'].includes(request.kind), 'invalid-stop', 'A stop requires an explicit stop or exhausted resource limit');
      state.status = 'stopped';
      state.stop = { kind: request.kind, reason: request.reason };
      break;
    case 'complete':
      requireCondition(state.tasks.every(candidate => candidate.status === 'complete'), 'unfinished-work', 'Queue still has incomplete work');
      requireCondition(state.workers.every(worker => !workerIsActive(worker)), 'active-workers', 'Workers remain active');
      requireCondition(state.tasks.every(candidate => specReady(state, candidate)), 'spec-review-required', 'Every governing spec still requires current independent assessment');
      requireCondition(state.tasks.every(candidate => !requiresReview(candidate) || reviewGate(state.root, candidate, state)), 'stale-review', 'Final reviewed inputs changed');
      requireCondition(state.tasks.every(candidate => verificationGate(state.root, candidate)), 'verification-required', 'Every registered check must pass on current inputs before final acceptance');
      requireCondition(state.closing?.retrospectiveEvidence && state.closing?.triageEvidence, 'closing-required', 'Complete session retrospective and follow-up triage before final acceptance');
      state.status = 'complete';
      break;
    default:
      requireCondition(false, 'unknown-action', 'Unknown lifecycle action');
  }
}

module.exports = { DIMENSIONS, assertAction, commitmentsFor, obligationBrief, reviewGate, taskById, transition, unresolvedFindings };
