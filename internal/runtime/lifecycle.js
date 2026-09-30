'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { workerIsActive } = require('./workers');
const { isDeepStrictEqual } = require('node:util');

const { requireCondition, text } = require('./store');
const { changedPaths, fileSha256, fresh, hash, inventorySnapshot, outsideGitWorktree, projectFile, projectInventory, snapshot } = require('./evidence');
const { exhaustedLimit } = require('./limits');
const { CLOSING_TARGET, unknownActionMessage } = require('./actions');

const DIMENSIONS = Object.freeze({
  spec: ['intent-scope-acceptance', 'soundness-integration', 'failure-safety-recovery', 'clarity-consistency-proportionality'],
  code: ['requirements-ux', 'correctness-integration', 'security-data-safety', 'design-maintainability', 'performance-resources', 'tests-evidence'],
  docs: ['claim-accuracy', 'sweep-completeness', 'backlog-conventions', 'sibling-consistency', 'proportionality'],
});

const REPORT_DIRECTORY = '.nightshift/runs/reports/';

// The Nightshift backlog: the four indexes, their history files and the record directories. Only these paths can be
// relieved from code reassessment by a docs review, because triage and tracking edits are confined to them.
const BACKLOG_FILES = Object.freeze(['.nightshift/FEATURES.md', '.nightshift/BUGS.md', '.nightshift/QUICK_WINS.md', '.nightshift/PATTERNS.md', '.nightshift/FEATURES_HISTORY.md', '.nightshift/BUGS_HISTORY.md', '.nightshift/QUICK_WINS_HISTORY.md']);
const BACKLOG_DIRECTORIES = Object.freeze(['.nightshift/features/', '.nightshift/bugs/', '.nightshift/patterns/']);

function isBacklogPath(file) {
  return BACKLOG_FILES.includes(file) || BACKLOG_DIRECTORIES.some(directory => file.startsWith(directory));
}

// Operations that act on the closing record; everything else about a task, such as its stages and blockers, does not apply to it.
const CLOSING_ACTIONS = Object.freeze(['dispatch', 'probe', 'check', 'review', 'validate', 'dispose', 'repair']);

function taskById(state, id) {
  text(id, 'taskId');
  const task = state.tasks.find(candidate => candidate.id === id);
  requireCondition(task, 'unknown-task', 'Task does not belong to the authorized queue');
  return task;
}

// A queue task, or the closing record when the reserved closing identity is named.
function targetById(state, id) {
  if (id !== CLOSING_TARGET) return taskById(state, id);
  requireCondition(state.closing?.docs, 'closing-review-unavailable', 'This run has no closing record; it is created when triage evidence is recorded');
  return state.closing.docs;
}

function closingRecord(baseline) {
  return { id: CLOSING_TARGET, kind: 'closing', baseline, reviews: [], findings: [], checks: [], probeEvidence: [] };
}

// The project inventory at triage, against which a closing review must show backlog-only changes. An empty inventory is an empty
// baseline. When Git cannot inventory the project, only a project positively outside Git gets a baseline, read from its backlog
// files on disk, so completion can still tell whether tracking edits followed; otherwise null, which fails closed.
function triageBaseline(root) {
  try {
    if (projectInventory(root).length === 0) return { digest: hash(JSON.stringify([])), files: [], inventory: true, excludedPaths: [], includedPaths: [] };
    return inventorySnapshot(root);
  } catch {
    try {
      return outsideGitWorktree(root) ? backlogBaseline(root) : null;
    } catch {
      // An unreadable or linked backlog entry leaves no baseline, which fails closed.
      return null;
    }
  }
}

// The backlog files present on disk, read without Git: the index and history files, and the record directories recursively.
function backlogFilesOnDisk(root) {
  const files = BACKLOG_FILES.filter(file => fs.existsSync(projectFile(root, file)));
  for (const directory of BACKLOG_DIRECTORIES) {
    const absolute = projectFile(root, directory.slice(0, -1));
    if (!fs.existsSync(absolute)) continue;
    for (const entry of fs.readdirSync(absolute, { recursive: true, withFileTypes: true })) {
      // A linked entry could hide a change, so it makes the backlog unreadable rather than skipped.
      if (entry.isSymbolicLink()) throw new Error(`Linked backlog entry ${entry.name}`);
      if (entry.isFile()) files.push(path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'));
    }
  }
  return files.sort();
}

function identitiesOnDisk(root, files) {
  return files.length === 0 ? [] : snapshot(root, files).files;
}

function backlogBaseline(root) {
  const files = identitiesOnDisk(root, backlogFilesOnDisk(root));
  return { digest: hash(JSON.stringify(files)), files, backlogOnly: true };
}

// Backlog paths that appeared, disappeared or changed bytes since a baseline read from disk; null when that cannot be established.
function changedBacklogPaths(root, baseline) {
  try {
    const recorded = new Map(baseline.files.map(file => [file.path, file.sha256]));
    const present = new Map(identitiesOnDisk(root, backlogFilesOnDisk(root)).map(file => [file.path, file.sha256]));
    return [...new Set([...recorded.keys(), ...present.keys()])].filter(file => recorded.get(file) !== present.get(file)).sort();
  } catch {
    return null;
  }
}

// Code, docs and lore tasks keep a code assessment and spec tasks a spec assessment; a docs review is recorded beside either.
function leadKind(task) {
  return task.kind === 'spec' ? 'spec' : 'code';
}

// Records written before docs reviews existed carry no kind and belong to their owner's lead assessment.
function reviewKind(review, owner) {
  return review.kind ?? (owner.kind === 'closing' ? 'docs' : leadKind(owner));
}

function findingKind(finding, owner) {
  return finding.reviewKind ?? (owner.kind === 'closing' ? 'docs' : leadKind(owner));
}

function latestReview(entries) {
  return [...entries].sort((left, right) => (right.review.revision ?? 0) - (left.review.revision ?? 0))[0];
}

function settled(finding) {
  return Boolean(finding.validation) && finding.validation.verdict !== 'unverified' && Boolean(finding.disposition) && !(finding.disposition === 'implement' && !finding.repaired);
}

function unresolvedFindings(task) {
  return task.findings.filter(finding => !finding.disposition || finding.disposition === 'implement' && !finding.repaired);
}

// Code and docs tasks share one cumulative code assessment. A spec task keeps its own whole-spec assessment, which a
// later covering code review would otherwise displace, and a lore task's assessment covers its instruction proposal.
const CUMULATIVE_TASK_KINDS = Object.freeze(['code', 'docs']);

function sharesCumulativeAssessment(task) {
  return CUMULATIVE_TASK_KINDS.includes(task.kind);
}

function commitmentsFor(tasks) {
  return Object.fromEntries(tasks.map(task => [task.id, { agreement: structuredClone(task.agreement), revision: task.requirementsRevision ?? 0 }]));
}

// A native goal re-engages a controller whose models yield early; a Stop hook only resists a yield, which suffices where the host's models do not yield early.
const CONTINUATION_KINDS = Object.freeze({ goal: ['claude', 'codex'], 'stop-hook': ['claude'] });

function verifiedContinuation(state, mechanism) {
  requireCondition(mechanism?.verified === true && typeof mechanism.evidence === 'string' && mechanism.evidence.trim(), 'unverified-continuation', 'Unattended continuation requires observed host evidence');
  requireCondition(typeof mechanism.kind === 'string' && Object.hasOwn(CONTINUATION_KINDS, mechanism.kind), 'invalid-continuation-kind', `Continuation mechanism kind must be one of ${Object.keys(CONTINUATION_KINDS).join(', ')}`);
  requireCondition(CONTINUATION_KINDS[mechanism.kind].includes(state.controller.host), 'unsupported-continuation', `A ${mechanism.kind} mechanism cannot carry unattended work for a ${state.controller.host} controller; verify its native goal instead`);

  return { ...mechanism, runId: state.id, controller: { ...state.controller }, observedAt: new Date().toISOString() };
}

function verificationGate(root, task) {
  const latest = new Map(task.checks.map(check => [check.name, check]));
  return (task.kind !== 'code' || latest.size > 0) && [...latest.values()].every(check => check.passed && fresh(root, check.snapshot));
}

// A docs review never makes a task's code assessment required; only its kind or an imported code assessment does.
function requiresReview(task) {
  return ['code', 'spec'].includes(task.kind) || task.reviews.some(review => reviewKind(review, task) !== 'docs');
}

function closingReady(state) {
  return !state.workers.some(workerIsActive) && (state.status === 'stopped' || !state.tasks.some(task => task.status !== 'complete' && !task.blocker && task.requires.every(id => taskById(state, id).status === 'complete')));
}

// Clearing closing evidence keeps the latest closing baseline, so the next triage can still tell whether tracking edits since it were reviewed.
function resetClosing(state) {
  const baseline = state.closing?.docs ? state.closing.docs.baseline : state.closing?.carriedBaseline;
  state.closing = { retrospectiveEvidence: null, reportEvidence: null, reportDelivery: null, triageEvidence: null, ...(baseline ? { carriedBaseline: baseline } : {}) };
}

function recordRetrospective(state, evidence) {
  text(evidence, 'retrospective.evidence');
  resetClosing(state);
  state.closing.retrospectiveEvidence = evidence;
}

function closingStage(state) {
  if (!state.closing?.retrospectiveEvidence) return 'retrospective';
  if (!reportSatisfied(state)) return 'report';
  return state.closing.triageEvidence ? 'complete' : 'triage';
}

function reportSatisfied(state) {
  return !state.handover || Boolean(state.closing?.reportEvidence);
}

function reportEvidenceFor(root, relative) {
  text(relative, 'report.path');
  requireCondition(relative.startsWith(REPORT_DIRECTORY) && relative.endsWith('.md'), 'invalid-report', `The morning report is a Markdown file under ${REPORT_DIRECTORY}`);
  const sha256 = fileSha256(root, relative);
  requireCondition(sha256 !== null && fs.statSync(projectFile(root, relative)).size > 0, 'invalid-report', 'The morning report file is missing or empty');
  return { path: relative, sha256 };
}

function reportIsCurrent(root, evidence) {
  try {
    return fileSha256(root, evidence.path) === evidence.sha256;
  } catch {
    // An unreadable or unsafe report path is a stale report, never a current one.
    return false;
  }
}

function reportStatus(state, root = state.root) {
  if (!state.handover) return null;
  const evidence = state.closing?.reportEvidence ?? null;
  if (!evidence) return { recorded: false, delivered: false, path: null, current: null };
  return { recorded: true, delivered: state.closing.reportDelivery?.sha256 === evidence.sha256, path: evidence.path, current: reportIsCurrent(root, evidence) };
}

// The report and the follow-up triage are one hand-off, so the notice outlives delivery while a decision is pending.
function reportNotice(state, root = state.root) {
  const report = reportStatus(state, root);
  if (!report?.recorded) return null;
  const followups = state.followups.filter(item => item.status !== 'resolved').map(item => item.id);
  return report.delivered && followups.length === 0 ? null : { ...report, followups };
}

// The user's acceptance of a governing spec counts while the spec still has the content it was recorded against.
function specAcceptanceCurrent(root, task) {
  return Boolean(task.specAcceptance) && fresh(root, task.specAcceptance.snapshot);
}

function specAcceptanceStatus(root, task, options) {
  if (!task.specAcceptance) return { recorded: false, current: null };
  return { recorded: true, current: options.verifyFreshness === false ? 'reconcile at acceptance' : specAcceptanceCurrent(root, task) };
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

// A completed strong independent assessment with broad evidenced coverage; a failed or partial one never counts.
function completeAssessment(review) {
  return Boolean(review) && review.status === 'complete' && review.strength === 'strong' && review.independent === true && review.broad === true && Boolean(review.coverageEvidence?.trim());
}

function acceptableAssessment(review, task) {
  if (task.requirementsRevision !== undefined && (review?.revision ?? -1) < task.requirementsRevision) return false;
  if (!isDeepStrictEqual(review?.commitments?.[task.id], commitmentsFor([task])[task.id])) return false;
  return completeAssessment(review);
}

// Returns null when the gate holds, 'stale' when the latest otherwise acceptable assessment no longer matches current inputs, and 'unmet' otherwise.
// Each gate counts only the findings and repairs of its own kind; a docs repair reaches this gate only through the files it changed.
function reviewGateFailure(root, task, state) {
  const lead = leadKind(task);
  const candidates = state
    ? state.tasks.flatMap(owner => owner.reviews.filter(review => owner.id === task.id ? reviewKind(review, owner) === lead : sharesCumulativeAssessment(task) && sharesCumulativeAssessment(owner) && review.kind === 'code' && review.coveredTaskIds?.includes(task.id)))
    : task.reviews.filter(review => reviewKind(review, task) === lead);
  const review = latestReview(candidates.map(candidate => ({ review: candidate })))?.review;
  if (!acceptableAssessment(review, task)) return 'unmet';
  if (!fresh(root, review.snapshot) && !backlogRelief(root, task, state, review)) return 'stale';
  if (!DIMENSIONS[lead].every(dimension => review.dimensions.includes(dimension))) return 'unmet';
  if (!verificationGate(root, task)) return 'unmet';
  const findings = task.findings.filter(finding => findingKind(finding, task) === lead);
  if (!findings.every(settled)) return 'unmet';
  if (state && state.tasks.flatMap(owner => owner.findings).some(finding => finding.reviewRevision === review.revision && !settled(finding))) return 'unmet';
  return findings.some(finding => finding.repaired && finding.repairRevision >= review.revision) ? 'unmet' : null;
}

function reviewGate(root, task, state) {
  return reviewGateFailure(root, task, state) === null;
}

// A code assessment stale only because backlog paths changed counts as current once a current docs review covers the task.
// Lore tasks gain this only from the closing docs review, since task-level docs reviews never cover them; a governing spec never gains it.
function backlogRelief(root, task, state, review) {
  if (!state || task.kind === 'spec' || review.snapshot?.inventory !== true) return false;
  const changed = changedPaths(root, review.snapshot);
  if (!changed || !changed.every(isBacklogPath)) return false;
  return docsReviewFailure(root, task, state, { closingOnly: task.kind === 'lore' }) === null;
}

function docsCandidates(task, state, closingOnly) {
  const closing = state.closing?.docs;
  const fromClosing = (closing?.reviews ?? []).filter(review => review.coveredTaskIds?.includes(task.id)).map(review => ({ review, owner: closing }));
  if (closingOnly) return fromClosing;
  const fromTasks = state.tasks.flatMap(owner => owner.reviews
    .filter(review => review.kind === 'docs' && (owner.id === task.id || sharesCumulativeAssessment(task) && sharesCumulativeAssessment(owner) && review.coveredTaskIds?.includes(task.id)))
    .map(review => ({ review, owner })));
  return [...fromTasks, ...fromClosing];
}

// Whether the latest docs review covering the task is current, with the same conditions the code gate applies, plus the closing record's own findings and checks when it supplies that review.
function docsReviewFailure(root, task, state, { closingOnly = false } = {}) {
  const entry = latestReview(docsCandidates(task, state, closingOnly));
  if (!entry || !acceptableAssessment(entry.review, task)) return 'unmet';
  const { review, owner } = entry;
  if (!fresh(root, review.snapshot)) return 'stale';
  if (!DIMENSIONS.docs.every(dimension => review.dimensions.includes(dimension))) return 'unmet';
  // The task's own docs findings, and those of the owning record: every one the closing record holds, or those this review raised on another task.
  const others = owner === task ? [] : owner.kind === 'closing' ? owner.findings : owner.findings.filter(finding => finding.reviewRevision === review.revision);
  const findings = [...task.findings.filter(finding => findingKind(finding, task) === 'docs'), ...others];
  if (!findings.every(settled) || findings.some(finding => finding.repaired && finding.repairRevision >= review.revision)) return 'unmet';
  if (owner.kind === 'closing' && !verificationGate(root, owner)) return 'unmet';
  return null;
}

// Code and docs tasks of a run created with the docs gate need a current docs review to complete, or a mechanical exemption that is still fresh.
function docsGateFailure(root, task, state) {
  if (!state?.docsGate || !sharesCumulativeAssessment(task)) return null;
  if (task.docsExemption && fresh(root, task.docsExemption.snapshot)) return null;
  return docsReviewFailure(root, task, state);
}

// A closing record passes when its latest review, if any, is a complete docs assessment, every finding it holds is settled,
// no repair postdates its latest review, and its checks pass on current inputs.
function closingRecordFailure(root, state) {
  const record = state.closing?.docs;
  if (!record) return null;
  const latest = latestReview(record.reviews.map(review => ({ review })))?.review;
  if (latest && (!completeAssessment(latest) || !DIMENSIONS.docs.every(dimension => latest.dimensions.includes(dimension)))) return 'unmet';
  if (!record.findings.every(settled)) return 'unmet';
  if (record.findings.some(finding => finding.repaired && finding.repairRevision >= (latest?.revision ?? Infinity))) return 'unmet';
  return verificationGate(root, record) ? null : 'unmet';
}

const CLOSING_COVERAGE = Object.freeze({
  unreviewed: 'Changes since triage need a current, complete and resolved closing docs review',
  'outside-git': 'The backlog changed after triage in a project outside Git, where no independent review can be dispatched; revert those tracking edits, or make them in a Git worktree where a closing docs review can cover them',
  'no-baseline': 'The changes since triage cannot be established; record triage again once Git can inspect the project',
});

// Why completion lacks closing coverage, as a CLOSING_COVERAGE key, or null when it holds. Anything changed since triage needs a
// current resolved closing review, whether or not a task gate depends on it. A baseline read from disk belongs to a project outside
// Git, where no review can be dispatched, so any backlog change there fails closed; a missing or unreadable baseline fails closed too.
function closingCoverageFailure(root, state) {
  const record = state.closing?.docs;
  if (!record) return null;
  if (!record.baseline) return 'no-baseline';
  if (record.baseline.backlogOnly) {
    const changed = changedBacklogPaths(root, record.baseline);
    return changed === null ? 'no-baseline' : changed.length === 0 ? null : 'outside-git';
  }
  const changed = changedPaths(root, record.baseline);
  if (changed === null) return 'no-baseline';
  if (changed.length === 0) return null;
  const latest = latestReview(record.reviews.map(review => ({ review })))?.review;
  return latest && fresh(root, latest.snapshot) && closingRecordFailure(root, state) === null ? null : 'unreviewed';
}

// The baseline a triage records. An earlier baseline of the run stands while the changes since it lack independent review, so
// recording triage again, even after something cleared the closing record, never absorbs unreviewed tracking edits. Those changes
// are reviewed once a current resolved closing review covers them, or once a complete cumulative task assessment is fresh against
// the whole inventory; a missing earlier baseline, which already fails closed, gives way to the inventory at this triage.
function nextTriageBaseline(root, state) {
  const earlier = state.closing.docs ? state.closing.docs.baseline : state.closing.carriedBaseline;
  if (!earlier) return triageBaseline(root);
  const closingReviewed = Boolean(state.closing.docs) && closingCoverageFailure(root, state) === null;
  const taskReviewed = () => {
    try {
      return state.tasks.some(task => task.reviews.some(review => reviewKind(review, task) !== 'spec' && review.snapshot?.inventory === true && completeAssessment(review) && fresh(root, review.snapshot)));
    } catch {
      // A Git failure leaves the changes unreviewed as far as this triage can tell, so the earlier baseline stands.
      return false;
    }
  };
  return closingReviewed || taskReviewed() ? triageBaseline(root) : earlier;
}

const STALE_REVIEW = 'The latest assessment is stale: reviewed inputs changed after its import. Dispatch a current cumulative assessment that covers the changes';
const STALE_DOCS_REVIEW = 'The latest docs review is stale: reviewed inputs changed after its import. Dispatch a current docs review that covers the changes';

function requireReviewGate(root, task, state, message) {
  const failure = reviewGateFailure(root, task, state);
  requireCondition(failure === null, 'review-required', failure === 'stale' ? STALE_REVIEW : message);
}

function requireDocsGate(root, task, state, message) {
  const failure = docsGateFailure(root, task, state);
  requireCondition(failure === null, 'docs-review-required', failure === 'stale' ? STALE_DOCS_REVIEW : message);
}

function obligationBrief(state, root = state.root, options = {}) {
  const active = state.tasks.filter(task => task.status !== 'complete');
  const ready = active.filter(task => !task.blocker && task.requires.every(id => taskById(state, id).status === 'complete'));
  return {
    id: state.id, revision: state.revision, status: state.status, controller: state.controller,
    objective: state.objective, authority: state.authority, limits: state.limits, publication: state.publication,
    mode: state.mode, handover: state.handover ?? null, report: reportStatus(state, root), continuation: state.continuation ?? null,
    resourceMode: state.resourceMode ?? 'legacy', resources: state.resources ?? null,
    executionResources: require('../releases/entry').executionResources(state), controllerClaim: state.controllerClaim ?? null, adoption: state.adoption ?? null,
    next: ready.map(task => ({
      id: task.id, title: task.title,
      stage: options.verifyFreshness !== false && !specReady(state, task) ? 'governing-spec-review' : task.stage,
      agreement: { source: task.agreement.source, outcome: task.agreement.outcome, decisions: task.agreement.decisions, spec: task.agreement.spec, specReviewTaskId: task.agreement.specReviewTaskId },
      ...(typeof task.agreement.spec === 'string' ? { specAcceptance: specAcceptanceStatus(root, task, options) } : {}),
      unresolvedFindings: unresolvedFindings(task).map(finding => ({ id: finding.id, consequence: finding.consequence, verdict: finding.validation?.verdict ?? null, disposition: finding.disposition, evidence: finding.evidence.slice(0, 600) })),
      reviewCurrent: options.verifyFreshness === false ? 'reconcile at acceptance' : reviewGate(root, task, state),
      ...(state.docsGate && sharesCumulativeAssessment(task) ? { docsReviewCurrent: options.verifyFreshness === false ? 'reconcile at acceptance' : docsGateFailure(root, task, state) === null } : {}),
    })),
    // An exemption is recorded as its task completes, so it is listed for every task rather than only for work still ahead.
    ...(state.docsGate ? { docsExemptions: state.tasks.filter(task => task.docsExemption).map(task => ({ taskId: task.id, reason: task.docsExemption.reason, revision: task.docsExemption.revision, current: options.verifyFreshness === false ? 'reconcile at acceptance' : fresh(root, task.docsExemption.snapshot) })) } : {}),
    finalReconciliationPending: state.status === 'running' && active.length === 0,
    closing: { ready: closingReady(state), stage: closingStage(state), ...(state.closing?.docs ? { docsReview: closingDocsBrief(state, root, options) } : {}) },
    blockers: active.filter(task => task.blocker).map(task => ({ id: task.id, blocker: task.blocker })),
    workers: state.workers.filter(workerIsActive),
    followups: state.followups.filter(item => item.status !== 'resolved'),
    rules: `Continue authorized independent work and recovery. Every repair needs cumulative strong broad review. Validate every finding with a fresh skeptic before disposition. Preserve writer ownership. Update documentation and obtain its independent docs review, then retrospective, then follow-up triage; a handed-over run records its morning report before triage. Tracking edits after triage are backlog-only and need a closing docs review (task ${CLOSING_TARGET}) before completion. Missing or stale evidence is incomplete. Publication requires authority. Reconcile this record with actual files after compaction.`,
  };
}

function closingDocsBrief(state, root, options) {
  const record = state.closing.docs;
  const latest = latestReview(record.reviews.map(review => ({ review })))?.review;
  return {
    target: CLOSING_TARGET, baseline: Boolean(record.baseline), reviews: record.reviews.length,
    unresolvedFindings: record.findings.filter(finding => !settled(finding)).map(finding => finding.id),
    current: options.verifyFreshness === false ? 'reconcile at acceptance' : Boolean(latest) && fresh(root, latest.snapshot) && closingRecordFailure(root, state) === null,
    satisfied: options.verifyFreshness === false ? 'reconcile at acceptance' : closingCoverageFailure(root, state) === null,
  };
}

// The closing record is admitted once triage evidence exists on a running run, and on a complete run as owner bookkeeping;
// a stopped run is resumed first. Recorded limits bind it on every run, since nothing overrides or renews them.
function assertClosingAction(state, request) {
  requireCondition(CLOSING_ACTIONS.includes(request.action), 'invalid-closing-action', `The closing record accepts only ${CLOSING_ACTIONS.join(', ')}`);
  requireCondition(state.status !== 'stopped', 'run-stopped', 'The run is stopped; resume it under the user\'s authority before closing work');
  const record = targetById(state, request.taskId);
  requireCondition(state.status === 'complete' || state.closing.triageEvidence, 'closing-review-unavailable', 'A closing docs review is admitted once triage evidence is recorded');
  const exhausted = exhaustedLimit(state, { dispatch: request.action === 'dispatch' });
  requireCondition(!exhausted, 'resource-limit', exhausted);
  if (state.status === 'running' && state.mode === 'unattended') requireCondition(state.continuation?.verified === true, 'unverified-continuation', 'Verify the actual host continuation mechanism before unattended execution');
  return record;
}

// Each changed path since the triage baseline, apart from user-owned files the review excluded, must lie in the backlog.
function closingScopeFailure(root, record, review) {
  if (!record.baseline) return 'This closing record has no triage baseline, so a closing review cannot establish that only backlog paths changed';
  const excluded = new Set(review.contextSnapshot?.excludedPaths ?? []);
  const changed = changedPaths(root, record.baseline);
  if (!changed) return 'The difference from the triage baseline cannot be established';
  const outside = changed.filter(file => !excluded.has(file) && !isBacklogPath(file));
  return outside.length === 0 ? null : `A closing review covers backlog edits only; these paths changed outside the backlog since triage: ${outside.slice(0, 20).join(', ')}`;
}

function assertAction(state, request) {
  const taskActions = ['start-task', 'add-spec-review', 'check', 'dispatch', 'probe', 'review', 'validate', 'dispose', 'repair', 'advance', 'block', 'unblock', 'spec-accepted'];
  if (taskActions.includes(request.action) && request.taskId === CLOSING_TARGET) return assertClosingAction(state, request);
  const task = taskActions.includes(request.action) ? taskById(state, request.taskId) : null;
  const bookkeeping = ['worker-finished', 'followup', 'resolve-followup', 'resume', 'stop', 'block', 'retrospective', 'report', 'report-delivered', 'spec-accepted', 'triage', 'invalidate-continuation'];
  requireCondition(state.status === 'running' || bookkeeping.includes(request.action), 'run-stopped', 'The run is stopped; explicit resumption is required before more work');
  if (!bookkeeping.includes(request.action)) {
    requireCondition(!exhaustedLimit(state, { dispatch: request.action === 'dispatch' }), 'resource-limit', exhaustedLimit(state, { dispatch: request.action === 'dispatch' }));
    // A handover validates the mechanism it carries, as continuation does, so neither waits on an earlier verification.
    if (state.mode === 'unattended' && !['continuation', 'handover', 'claim-controller'].includes(request.action)) requireCondition(state.continuation?.verified === true, 'unverified-continuation', 'Verify the actual host continuation mechanism before unattended execution');
  }
  if (task && !['block', 'unblock', 'add-spec-review', 'spec-accepted'].includes(request.action)) {
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
      const closing = task.kind === 'closing';
      if (closing) {
        const outside = closingScopeFailure(state.root, task, review);
        requireCondition(!outside, 'closing-scope', outside);
      }
      const revision = state.revision + 1;
      const previous = task.reviews.at(-1);
      // The closing record reviews edits made after triage, so recording it must never clear the closing evidence it follows.
      if (!closing && (task.status !== 'complete' || previous?.snapshot?.digest !== review.snapshot.digest || !isDeepStrictEqual(previous?.commitments, review.commitments))) resetClosing(state);
      task.reviews.push({ ...review, revision });
      for (const finding of review.findings) {
        text(finding.id, 'finding.id');
        text(finding.consequence, 'finding.consequence');
        text(finding.evidence, 'finding.evidence');
        const id = review.requestId ? `${review.requestId}:${finding.id}` : `${revision}:${finding.id}`;
        const relatedTo = task.findings.filter(existing => existing.localId === finding.id).map(existing => existing.id);
        task.findings.push({ ...finding, id, localId: finding.id, relatedTo, reviewRevision: revision, reviewKind: reviewKind(review, task), reviewer: review.session, validation: null, disposition: null, repaired: false });
      }
      if (closing) break;
      delete task.docsExemption;
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
      task.probeEvidence = [];
      // Closing repairs are tracking edits after triage; they need a further closing review, not reopened tasks or new closing evidence.
      if (task.kind === 'closing') break;
      task.stage = 'review';
      task.status = 'active';
      resetClosing(state);
      delete task.docsExemption;
      if (task.resumeStage) task.resumeStage = task.kind === 'lore' ? 'retrospective' : 'documentation';
      break;
    case 'advance': {
      const stages = task.kind === 'lore' ? ['review', 'retrospective', 'complete'] : ['implementation', 'review', 'documentation', 'complete'];
      const current = stages.indexOf(task.stage);
      requireCondition(current >= 0 && current < stages.length - 1, 'invalid-stage', 'Task cannot advance');
      if (task.stage === 'implementation' && task.kind === 'code') {
        requireCondition(verificationGate(state.root, task), 'verification-required', 'Implementation requires current passing verification for each named check');
      }
      if (task.stage === 'review') {
        if (requiresReview(task)) requireReviewGate(state.root, task, state, 'A complete strong broad assessment and resolved findings are required');
        // A docs review loop leaves the review stage only once its own latest docs review is current and resolved.
        if (task.reviews.some(review => reviewKind(review, task) === 'docs')) {
          const failure = docsReviewFailure(state.root, task, state);
          requireCondition(failure === null, 'docs-review-required', failure === 'stale' ? STALE_DOCS_REVIEW : 'A complete strong docs review and resolved docs findings are required');
        }
        requireCondition(unresolvedFindings(task).length === 0, 'review-required', 'Every finding needs a skeptic verdict, a disposition and any implemented repair before leaving review');
        // A completed task returns from review straight to completion, skipping the documentation stage that holds its docs gate.
        if (task.resumeStage === 'complete') requireDocsGate(state.root, task, state, 'A reopened task completes again only with a current independent docs review covering it; the import cleared any mechanical exemption');
      }
      if (['documentation', 'retrospective'].includes(task.stage)) {
        if (requiresReview(task)) requireReviewGate(state.root, task, state, 'Reviewed work needs current cumulative assessment and applicable verification before task completion');
        requireCondition(verificationGate(state.root, task), 'verification-required', 'Every registered check must pass on current inputs before task completion');
        text(request.evidence, `${task.stage}.evidence`);
        if (request.docsExemption !== undefined) {
          requireCondition(state.docsGate && sharesCumulativeAssessment(task), 'invalid-exemption', 'Only a code or docs task of a run with the docs gate can record a mechanical exemption');
          task.docsExemption = { reason: text(request.docsExemption, 'docsExemption'), snapshot: inventorySnapshot(state.root), revision: state.revision + 1 };
        }
        requireDocsGate(state.root, task, state, 'Task completion needs a current independent docs review of the complete change, or a recorded mechanical exemption for a purely mechanical change');
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
        delete task.docsExemption;
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
        delete task.docsExemption;
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
    case 'report':
      requireCondition(state.handover, 'report-not-due', 'A morning report is due only after a recorded handover');
      requireCondition(closingReady(state) && state.closing?.retrospectiveEvidence, 'retrospective-required', 'Session retrospective must precede the morning report');
      state.closing.reportEvidence = reportEvidenceFor(state.root, request.path);
      // A replaced report has not been delivered.
      state.closing.reportDelivery = null;
      break;
    case 'report-delivered': {
      const evidence = state.handover && state.closing?.reportEvidence;
      requireCondition(evidence, 'report-required', 'Record the morning report before its delivery');
      text(request.authority, 'report-delivered.authority');
      requireCondition(reportIsCurrent(state.root, evidence), 'report-stale', 'The saved morning report is missing or changed; rewrite it and record the report again');
      if (state.closing.reportDelivery?.sha256 !== evidence.sha256) state.closing.reportDelivery = { authority: request.authority, revision: state.revision + 1, sha256: evidence.sha256 };
      break;
    }
    case 'spec-accepted': {
      requireCondition(state.status !== 'complete', 'run-complete', 'A spec acceptance belongs to unfinished work, and this run is complete');
      requireCondition(typeof task.agreement.spec === 'string' && task.agreement.spec.trim(), 'missing-spec', 'This task names no governing spec to accept');
      text(request.authority, 'spec-accepted.authority');
      const evidence = snapshot(state.root, [task.agreement.spec]);
      requireCondition(evidence.files[0].sha256 !== null, 'missing-spec', 'The governing spec file is missing');
      // Beside the agreement, never inside it: assessments bind the agreement, so acceptance there would stale every one of them.
      if (!specAcceptanceCurrent(state.root, task)) task.specAcceptance = { authority: request.authority, revision: state.revision + 1, snapshot: evidence };
      break;
    }
    case 'triage':
      requireCondition(state.status !== 'complete' && closingReady(state) && state.closing?.retrospectiveEvidence, 'retrospective-required', 'Session retrospective must precede follow-up triage');
      requireCondition(reportSatisfied(state), 'report-required', 'A handed-over run records its morning report before follow-up triage');
      text(request.evidence, 'triage.evidence');
      state.closing.triageEvidence = request.evidence;
      // Re-recorded triage starts a new closing record, so a closing review always follows the triage whose tracking edits it covers.
      if (state.docsGate) {
        state.closing.docs = closingRecord(nextTriageBaseline(state.root, state));
        delete state.closing.carriedBaseline;
      }
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
      transition(state, { action: 'invalidate-continuation', reason: 'Resumption requires a current observation of the host continuation mechanism' });
      break;
    case 'claim-controller':
      requireCondition(request.claim && isDeepStrictEqual(request.claim.controller, state.controller), 'invalid-controller-claim', 'A claim must be observed for the current controller');
      state.controllerClaim = request.claim;
      break;
    case 'invalidate-continuation': {
      text(request.reason, 'invalidate-continuation.reason');
      const same = state.mode === 'attended' && state.continuation?.verified === false && state.continuation.reason === request.reason && state.continuation.runId === state.id && isDeepStrictEqual(state.continuation.controller, state.controller);
      if (!same) state.continuation = { verified: false, reason: request.reason, runId: state.id, controller: { ...state.controller }, observedAt: new Date().toISOString() };
      state.mode = 'attended';
      break;
    }
    case 'continuation':
      state.continuation = verifiedContinuation(state, request.mechanism);
      break;
    case 'handover':
      text(request.authority, 'handover.authority');
      if (request.mechanism !== undefined) {
        // The mechanism travels with the handover so an earlier verified flag is never reused as proof, and one write leaves no partial transition.
        state.continuation = verifiedContinuation(state, request.mechanism);
        state.mode = 'unattended';
      }
      state.handover ??= { authority: request.authority, revision: state.revision + 1 };
      break;
    case 'worker': {
      const worker = request.worker;
      text(worker?.id, 'worker.id');
      text(worker.session, 'worker.session');
      text(worker.assignment, 'worker.assignment');
      requireCondition(worker.host === undefined || ['claude', 'codex'].includes(worker.host), 'unsupported-host', 'Worker host must be a supported native host');
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
      if (['reviewer', 'skeptic', 'peer'].includes(worker.role)) requireCondition(!require('./ownership').forbiddenReviewSessions(state).has(worker.session), 'nonindependent-worker', 'A current or former controller cannot be assigned independent review of this run');
      state.workers.push({ ...worker, host: worker.host ?? state.controller.host, status: 'running' });
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
    case 'complete': {
      requireCondition(state.tasks.every(candidate => candidate.status === 'complete'), 'unfinished-work', 'Queue still has incomplete work');
      requireCondition(state.workers.every(worker => !workerIsActive(worker)), 'active-workers', 'Workers remain active');
      requireCondition(state.tasks.every(candidate => specReady(state, candidate)), 'spec-review-required', 'Every governing spec still requires current independent assessment');
      // Checked first, because an unresolved closing review also withholds the backlog relief the gates below depend on.
      requireCondition(closingRecordFailure(state.root, state) === null, 'closing-review-unresolved', 'The closing docs review is unresolved: its latest review is not a complete strong docs assessment covering all five dimensions, a finding is unsettled, a repair postdates its latest review or a check fails');
      const coverage = closingCoverageFailure(state.root, state);
      requireCondition(coverage === null, 'closing-review-required', CLOSING_COVERAGE[coverage]);
      requireCondition(state.tasks.every(candidate => !requiresReview(candidate) || reviewGate(state.root, candidate, state)), 'stale-review', 'Final reviewed inputs changed');
      const undocumented = state.tasks.filter(candidate => docsGateFailure(state.root, candidate, state) !== null).map(candidate => candidate.id);
      requireCondition(undocumented.length === 0, 'docs-review-required', `Every code and docs task needs a current independent docs review or a fresh mechanical exemption; tracking edits after triage need a current closing docs review. Missing for: ${undocumented.join(', ')}`);
      requireCondition(state.tasks.every(candidate => verificationGate(state.root, candidate)), 'verification-required', 'Every registered check must pass on current inputs before final acceptance');
      requireCondition(state.closing?.retrospectiveEvidence && state.closing?.triageEvidence, 'closing-required', 'Complete session retrospective and follow-up triage before final acceptance');
      // Checked here as well as at triage: a handover can arrive after triage was already recorded.
      requireCondition(reportSatisfied(state), 'report-required', 'A handed-over run records its morning report before final acceptance');
      state.status = 'complete';
      break;
    }
    default:
      requireCondition(false, 'invalid-request', unknownActionMessage(request.action));
  }
}

module.exports = { DIMENSIONS, assertAction, commitmentsFor, findingKind, isBacklogPath, obligationBrief, reportNotice, reviewGate, sharesCumulativeAssessment, targetById, taskById, transition, unresolvedFindings };
