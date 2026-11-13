'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { workerIsActive } = require('./workers');
const { isDeepStrictEqual } = require('node:util');

const { requireCondition, text } = require('./store');
const { withEvidenceComparisons, changedPaths, compareOnce, fileIdentity, fileSha256, fresh, freshAll, hash, inventorySnapshot, inventoryVisible, outsideGitWorktree, projectFile, projectInventory, snapshot } = require('./evidence');
const { exhaustedLimit } = require('./limits');
const { CLOSING_TARGET, unknownActionMessage } = require('./actions');
const { closureRoute, latestDispatchOf, lineageOf } = require('./continuation');
const { scratchFailure, scratchStatus } = require('./scratch');
const { isReviewContext, requireDelivery, recordKind } = require('./records');
const { isClosed } = require('./statuses');
const { latestDecision, relevanceCoversTask, applicability, assessedChanges, inputChanges, latestEntry: latestReview } = require('./applicability');
const { BACKLOG_FILES, DOCUMENTATION_DIRECTORIES, governingArtifacts, ignoresDocumentationPaths, isDocumentationPath, isRootDocumentation, onlyGoverningArtifacts, partitionDocumentationChanges } = require('./documentation-paths');
const { originalInputsRetained } = require('./relevance');
const { validReportDelivery } = require('./report-delivery');
const { invalidateContinuation, continuationForRequest } = require('./continuation-health');
const { currencyRefusal, receiptCurrency, recordedSurfaces, savedSurfaces, scopeOf, surfaceVerdicts, validateSurfaceAnswers } = require('./finding-scope');
const { linkValues, requireSpecReadiness, resolveGovernance, specLink, specReadinessStatus, usableSpec } = require('./spec-readiness');

const DIMENSIONS = Object.freeze({
  spec: ['intent-scope-acceptance', 'soundness-integration', 'failure-safety-recovery', 'clarity-consistency-proportionality'],
  code: ['requirements-ux', 'correctness-integration', 'security-data-safety', 'design-maintainability', 'performance-resources', 'tests-evidence'],
  docs: ['claim-accuracy', 'sweep-completeness', 'backlog-conventions', 'sibling-consistency', 'proportionality'],
});

const REPORT_DIRECTORY = '.nightshift/runs/reports/';

// Operations that act on the closing record; everything else about a task, such as its stages and blockers, does not apply to it.
const CLOSING_ACTIONS = Object.freeze(['dispatch', 'probe', 'check', 'review', 'validate', 'dialogue', 'dispose', 'repair']);

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

// Each closing record carries its own occurrence identity, so asynchronous closing work can tell an unchanged record from a
// replacement, including one under the same context, whether or not progress accounting is available.
function closingRecord(baseline, progressBinding) {
  return { id: CLOSING_TARGET, kind: 'closing', occurrence: randomUUID(), baseline, progressBinding: progressBinding ? structuredClone(progressBinding) : null, reviews: [], findings: [], checks: [], probeEvidence: [] };
}

// Whether asynchronous work pinned to a closing record still belongs to it. A record minted with an occurrence identity is
// fenced by it; an earlier record without one can only be identified through the accounting origin the work captured.
function sameClosingRecord(record, pinned, origin) {
  return record.occurrence ? pinned.closingOccurrence === record.occurrence : Boolean(pinned.progressOrigin) && pinned.progressOrigin === origin;
}

// The project inventory at triage, against which the changes since triage are judged: documentation changes need a closing review, and
// changes outside the documentation paths hold completion until a fresh task assessment covers them. An empty inventory is an
// empty baseline. When Git cannot inventory the project, only a project positively outside Git gets a baseline, read from its
// documentation files on disk, so completion can still tell whether tracking edits followed; otherwise null, which fails closed.
function triageBaseline(root, state) {
  try {
    const governing = [...new Set((state?.tasks ?? []).map(task => task.agreement?.spec).filter(file => typeof file === 'string'))];
    if (projectInventory(root, [], governing).length === 0) return { digest: hash(JSON.stringify([])), files: [], inventory: true, excludedPaths: [], includedPaths: [] };
    return inventorySnapshot(root, [], governing);
  } catch {
    try {
      return outsideGitWorktree(root) ? documentationBaseline(root) : null;
    } catch {
      // An unreadable or linked documentation entry leaves no baseline, which fails closed.
      return null;
    }
  }
}

// The documentation files present on disk, read without Git: the backlog index and history files, the root Markdown files other
// than host instruction files, and the documentation directories recursively.
function documentationFilesOnDisk(root) {
  const files = BACKLOG_FILES.filter(file => fs.existsSync(projectFile(root, file)));
  // A linked entry could hide a change, so it makes the documentation unreadable rather than skipped.
  const unlinked = entry => {
    if (entry.isSymbolicLink()) throw new Error(`Linked documentation entry ${entry.name}`);
    return entry.isFile();
  };
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (isRootDocumentation(entry.name) && unlinked(entry)) files.push(entry.name);
  }
  for (const directory of DOCUMENTATION_DIRECTORIES) {
    const absolute = projectFile(root, directory.slice(0, -1));
    if (!fs.existsSync(absolute)) continue;
    for (const entry of fs.readdirSync(absolute, { recursive: true, withFileTypes: true })) {
      if (unlinked(entry)) files.push(path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'));
    }
  }
  return files.sort();
}

function identitiesOnDisk(root, files) {
  return files.length === 0 ? [] : snapshot(root, files).files;
}

// The marker keeps the name it had when only the backlog was read from disk, so baselines saved by earlier releases still read.
function documentationBaseline(root) {
  const files = identitiesOnDisk(root, documentationFilesOnDisk(root));
  return { digest: hash(JSON.stringify(files)), files, backlogOnly: true };
}

// Documentation paths that appeared, disappeared or changed bytes since a baseline read from disk; null when that cannot be established.
function changedDocumentationPaths(root, baseline) {
  try {
    const recorded = new Map(baseline.files.map(file => [file.path, file.sha256]));
    const present = new Map(identitiesOnDisk(root, documentationFilesOnDisk(root)).map(file => [file.path, file.sha256]));
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

function settled(finding) {
  return Boolean(finding.validation) && finding.validation.verdict !== 'unverified' && Boolean(finding.disposition) && !(finding.disposition === 'implement' && !finding.repaired);
}

// A repaired finding stays pending closure until the reviewer that raised it, or its replacement, records it closed; nothing else ends it.
function unresolvedFindings(task) {
  return task.findings.filter(finding => !finding.disposition || finding.disposition === 'implement' && !finding.repaired || finding.pendingClosure);
}

// Every finding of the run pending closure: on tasks, on the closing record, and carried across a replaced closing record.
function pendingClosures(state) {
  return [...state.tasks.flatMap(task => task.findings), ...(state.closing?.docs?.findings ?? []), ...(state.closing?.carriedFindings ?? [])].filter(finding => finding.pendingClosure);
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

function commitmentBindingFor(commitments) {
  return { taskIds: Object.keys(commitments), digest: require('./progress').fingerprint(commitments) };
}

function evidenceCommitmentsCurrent(state, task, evidence) {
  if (!evidence) return false;
  let binding = evidence.commitmentBinding;
  if (binding === undefined) {
    const worker = state.workers.find(candidate => candidate.id === evidence.requestId);
    if (worker?.commitments) binding = commitmentBindingFor(worker.commitments);
    else return state.tasks.every(candidate => (candidate.requirementsRevision ?? 0) === 0);
  }
  if (!binding || !Array.isArray(binding.taskIds) || new Set(binding.taskIds).size !== binding.taskIds.length || binding.taskIds.some(id => typeof id !== 'string') || typeof binding.digest !== 'string') return false;
  if (task.kind !== 'closing' && !binding.taskIds.includes(task.id)) return false;
  const tasks = binding.taskIds.map(id => state.tasks.find(candidate => candidate.id === id));
  if (tasks.some(candidate => !candidate)) return false;
  return commitmentBindingFor(commitmentsFor(tasks)).digest === binding.digest;
}

// A target's latest invocation of each named check: a later invocation supersedes an earlier one of the same name.
function latestChecks(target) {
  return [...new Map(target.checks.map(check => [check.name, check])).values()];
}

function verificationGate(root, task, snapshotCurrent = fresh) {
  const latest = latestChecks(task);
  return (task.kind !== 'code' || latest.length > 0) && latest.every(check => check.passed && !check.pending && snapshotCurrent(root, check.snapshot));
}

// What fails a target's verification gate, one entry per check: a code task with no recorded check is missing one.
function checkFailures(root, target) {
  const latest = latestChecks(target);
  if (target.kind === 'code' && latest.length === 0) return [{ name: null, reason: 'missing' }];
  const passing = latest.filter(check => check.passed && !check.pending);
  const current = new Map(freshAll(root, passing.map(check => check.snapshot)).map((isFresh, index) => [passing[index], isFresh]));

  return latest.map(check => ({ name: check.name, reason: check.pending ? 'pending' : !check.passed ? 'failed' : current.get(check) ? null : 'inputs-changed' })).filter(entry => entry.reason !== null);
}

function namedChecks(failures) {
  return failures.map(failure => (failure.name === null ? 'no check recorded' : `check "${failure.name}" ${failure.reason}`)).join(', ');
}

function verificationRefusal(root, targets, message) {
  const failing = targets.map(target => ({ target, failures: checkFailures(root, target) })).filter(entry => entry.failures.length > 0);

  return `${message}. Failing: ${failing.map(({ target, failures }) => `${target.id}: ${namedChecks(failures)}`).join('; ')}`;
}

function historicalDischarge(state, snapshotValid) {
  const current = (_root, value) => snapshotValid(value);
  const supportedWorker = worker => worker && typeof worker === 'object' && ['starting', 'running', 'unverified', 'complete', 'failed', 'stopped'].includes(worker.status) && ['implementer', 'reviewer', 'skeptic', 'peer', 'supervisor', 'operation'].includes(worker.role);
  const supportedTask = task => task && typeof task === 'object' && typeof task.id === 'string' && ['code', 'spec', 'docs', 'lore'].includes(task.kind) && Array.isArray(task.checks) && Array.isArray(task.reviews) && Array.isArray(task.findings);
  if (!state.tasks.every(supportedTask) || !state.workers.every(supportedWorker)) return false;
  if (!['complete', 'stopped'].includes(state.status) || !state.tasks.every(task => task.status === 'complete' && !task.blocker) || state.workers.some(workerIsActive)) return false;
  if (!state.closing?.retrospectiveEvidence || !state.closing.triageEvidence || state.handover && !state.closing.reportEvidence) return false;
  if (pendingClosures(state).length || carriedFindings(state).some(finding => !settled(finding))) return false;
  const assessed = (entry, task, kind) => {
    const review = entry?.review;
    const related = review ? entry.owner.reviews.filter(candidate => candidate.relevance && candidate.relevance.requestId === review.requestId && candidate.relevance.originalHash === require('./applicability').identity(review) && relevanceCoversTask(candidate, task.id)) : [];
    if (related.length && !latestDecision(related, state)) return false;
    const matching = related.filter(candidate => isDeepStrictEqual(candidate.commitments?.[task.id], commitmentsFor([task])[task.id]));
    const decision = latestDecision(matching, state);
    if (matching.length && !decision) return false;
    const retained = completeAssessment(review) && decision?.status === 'complete' && decision.attributionVerified === true && decision.independent === true && decision.strength === 'strong' && decision.applicability?.some(answer => answer.id === task.id && answer.outcome === 'preserve' && answer.evidence?.trim()) && snapshotValid(decision.snapshot) && snapshotValid(decision.contextSnapshot);
    return (acceptableAssessment(review, task) || retained) && review.attributionVerified === true && DIMENSIONS[kind].every(dimension => review.dimensions?.includes(dimension)) && snapshotValid(review.snapshot);
  };
  const governance = resolveGovernance(state.root, state.tasks);
  for (const task of state.tasks) {
    if (!verificationGate(state.root, task, current) || !task.findings.every(finding => settled(finding) && finding.validation.attributionVerified === true && ['confirmed', 'refuted'].includes(finding.validation.verdict))) return false;
    if (requiresReview(task)) {
      const entry = leadEntry(task, state);
      if (!assessed(entry, task, leadKind(task)) || task.findings.some(finding => finding.repaired && findingKind(finding, task) === leadKind(task) && finding.repairRevision >= entry.review.revision)) return false;
    }
    if (state.docsGate && sharesCumulativeAssessment(task)) {
      const exemption = task.docsExemption;
      if (!(exemption?.reason?.trim() && snapshotValid(exemption.snapshot))) {
        const entry = latestReview(docsCandidates(task, state, false), state);
        if (!assessed(entry, task, 'docs') || task.findings.some(finding => finding.repaired && findingKind(finding, task) === 'docs' && finding.repairRevision >= entry.review.revision)) return false;
      }
    }
    // The readiness routes judged on recorded evidence: the task's own reviewed snapshot while it has no link, otherwise its governing
    // spec task, linked or queued. Spec paths compare as readiness compares them, so a run discharged by equal strings stays discharged.
    if (task.kind === 'code' && task.agreement.spec) {
      if (!usableSpec(task.agreement.spec)) return false;
      const reviewed = !specLink(task) && task.agreement.specReviewed === true && snapshotValid(task.agreement.specSnapshot);
      const spec = governance.get(task.id)?.specTask;
      if (!reviewed && (!spec || spec.status !== 'complete' || !assessed(leadEntry(spec, state), spec, 'spec'))) return false;
    }
  }
  const closing = state.closing.docs;
  if (closing) {
    if (!closing.findings.every(settled) || !verificationGate(state.root, closing, current) || !snapshotValid(closing.baseline, true)) return false;
    const review = latestClosingReview(closing, state);
    if (review && (!completeAssessment(review) || review.attributionVerified !== true || !DIMENSIONS.docs.every(dimension => review.dimensions?.includes(dimension)) || !snapshotValid(review.snapshot))) return false;
    if (closing.findings.some(finding => finding.repaired && finding.repairRevision >= (review?.revision ?? Infinity))) return false;
  }
  return true;
}

// Every latest named check that no longer passes on current inputs, of every task, completed ones included, and of the closing
// record, which task and run acceptance would refuse: one whose run never collected a result, one that failed, or one whose
// inputs changed since it passed. Every brief carries the list, so the passing checks' inputs are judged in one batch.
function staleChecks(root, state) {
  const targets = state.closing?.docs ? [...state.tasks, state.closing.docs] : state.tasks;
  const latest = targets.flatMap(target => latestChecks(target).map(check => ({ taskId: target.id, check })));
  const passing = latest.filter(({ check }) => check.passed && !check.pending);
  const current = new Map(freshAll(root, passing.map(({ check }) => check.snapshot)).map((isFresh, index) => [passing[index].check, isFresh]));
  const reason = check => (check.pending ? 'pending' : !check.passed ? 'failed' : current.get(check) ? null : 'inputs-changed');
  return latest.map(({ taskId, check }) => ({ taskId, name: check.name, reason: reason(check) })).filter(entry => entry.reason !== null);
}

// A docs review never makes a task's code assessment required; only its kind or an imported code assessment does.
function requiresReview(task) {
  return ['code', 'spec'].includes(task.kind) || task.reviews.some(review => reviewKind(review, task) !== 'docs');
}

function closingReady(state) {
  if (isClosed(state)) return false;
  return !state.workers.some(workerIsActive) && (state.status === 'stopped' || !state.tasks.some(task => task.status !== 'complete' && !task.blocker && task.requires.every(id => taskById(state, id).status === 'complete')));
}

// Clearing closing evidence keeps the latest closing baseline, so the next triage can still tell whether tracking edits since it were
// reviewed, and keeps the closing findings that still owe something, which the next closing record takes over.
function resetClosing(state) {
  if (isReviewContext(state)) return;
  // A missing baseline is carried as null, so the next triage and the outside-documentation condition still treat it as missing.
  const carries = Boolean(state.closing?.docs) || state.closing?.carriedBaseline !== undefined;
  const baseline = state.closing?.docs ? state.closing.docs.baseline ?? null : state.closing?.carriedBaseline ?? null;
  const carried = carriedFindings(state);
  state.closing = { retrospectiveEvidence: null, reportEvidence: null, reportDelivery: null, triageEvidence: null, progressBindings: { retrospective: null, report: null, delivery: null, triage: null }, ...(carries ? { carriedBaseline: baseline } : {}), ...(carried.length ? { carriedFindings: carried } : {}) };
}

// The closing findings a replaced closing record must hand on: every one not yet settled or still pending closure. The closing gate
// requires each settled and closed, so replacing the record must carry that obligation rather than clear it.
function carriedFindings(state) {
  return [...(state.closing?.carriedFindings ?? []), ...(state.closing?.docs?.findings ?? []).filter(finding => !settled(finding) || finding.pendingClosure)];
}

function recordRetrospective(state, evidence) {
  text(evidence, 'retrospective.evidence');
  resetClosing(state);
  state.closing.retrospectiveEvidence = evidence;
  state.closing.progressBindings.retrospective = require('./progress').captureClosingBinding(state);
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
  return { recorded: true, delivered: validReportDelivery(state, evidence.sha256), path: evidence.path, current: reportIsCurrent(root, evidence) };
}

// The report and the follow-up triage are one hand-off, so the notice outlives delivery while a decision is pending.
// A closed record owes no notice: its close recorded the user's report and follow-up decisions, and every action the notice asks for
// would be refused as run-closed.
function reportNotice(state, root = state.root) {
  if (isClosed(state)) return null;
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

// A completed strong independent assessment with broad evidenced coverage; a failed or partial one never counts. Neither does a
// continued one: a resumed or replacement reviewer verifies repairs and can raise findings, but only a fresh assessment passes a gate.
function completeAssessment(review) {
  return Boolean(review) && !review.relevance && !review.continues && review.status === 'complete' && review.strength === 'strong' && review.independent === true && review.broad === true && typeof review.coverageEvidence === 'string' && Boolean(review.coverageEvidence.trim());
}

// Whether an assessment covers every dimension of its kind; a persisted value that is not a list covers none.
function coversDimensions(review, kind) {
  return Array.isArray(review.dimensions) && DIMENSIONS[kind].every(dimension => review.dimensions.includes(dimension));
}

function acceptableAssessment(review, task) {
  if (task.requirementsRevision !== undefined && (review?.revision ?? -1) < task.requirementsRevision) return false;
  if (!isDeepStrictEqual(review?.commitments?.[task.id], commitmentsFor([task])[task.id])) return false;
  return completeAssessment(review);
}

// The assessment a task's lead gate reads, with its owner: the latest of the task's own lead-kind assessments and, between tasks that
// share the cumulative assessment, the code reviews of other tasks that cover it.
function leadEntries(task, state) {
  const lead = leadKind(task);
  const entries = state
    ? state.tasks.flatMap(owner => owner.reviews
      .filter(review => !review.relevance && (owner.id === task.id ? reviewKind(review, owner) === lead : sharesCumulativeAssessment(task) && sharesCumulativeAssessment(owner) && review.kind === 'code' && review.coveredTaskIds?.includes(task.id)))
      .map(review => ({ review, owner })))
    : task.reviews.filter(review => !review.relevance && reviewKind(review, task) === lead).map(review => ({ review, owner: task }));
  return entries;
}

function leadEntry(task, state) {
  return latestReview(leadEntries(task, state), state);
}

// Returns null when the gate holds, 'stale' when the latest otherwise acceptable assessment no longer matches current inputs, and 'unmet' otherwise.
// Each gate counts only the findings and repairs of its own kind; a docs repair reaches this gate only through the files it changed.
function reviewGateFailure(root, task, state, { ignoreChecks = false } = {}) {
  const lead = leadKind(task);
  const entry = leadEntry(task, state);
  const review = entry?.review;
  if (!completeAssessment(review)) return 'unmet';
  const condition = applicability(root, review, task, entry.owner, state);
  if (!condition.current && !(condition.status === 'pending' && acceptableAssessment(review, task) && documentationRelief(root, task, state, review))) return 'stale';
  if (!coversDimensions(review, lead)) return 'unmet';
  if (!ignoreChecks && !verificationGate(root, task)) return 'unmet';
  const findings = task.findings.filter(finding => findingKind(finding, task) === lead);
  if (!findings.every(settled) || findings.some(finding => finding.pendingClosure)) return 'unmet';
  if (state && state.tasks.flatMap(owner => owner.findings).some(finding => {
    const decision = entry.owner.reviews.find(candidate => candidate.relevance && candidate.relevance.requestId === review.requestId && relevanceCoversTask(candidate, task.id) && candidate.revision === finding.reviewRevision);
    return (finding.reviewRevision === review.revision || decision) && (!settled(finding) || finding.pendingClosure);
  })) return 'unmet';
  return findings.some(finding => finding.repaired && finding.repairRevision >= review.revision) ? 'unmet' : null;
}

function reviewGate(root, task, state) {
  return reviewGateFailure(root, task, state) === null;
}

// Why an assessment no longer applies, from its applicability condition. The path list is null unless changed paths are the cause.
function staleCause(condition) {
  if (condition.changedPaths === null || condition.status === 'structural-failure' || condition.status === 'conflicting-decisions') return { kind: 'unestablished', changedPaths: null };
  if (condition.changedPaths.length > 0) return { kind: 'changed-inputs', changedPaths: condition.changedPaths, ...(condition.commitmentsChanged ? { commitmentsChanged: true } : {}) };
  if (condition.commitmentsChanged) return { kind: 'changed-commitments', changedPaths: null };

  return { kind: 'unmet', changedPaths: null };
}

function reviewGateCause(root, task, state) {
  const failure = reviewGateFailure(root, task, state);
  if (failure === null) return null;
  const checks = checkFailures(root, task);
  if (failure === 'stale') {
    const entry = leadEntry(task, state);

    return { ...staleCause(applicability(root, entry.review, task, entry.owner, state)), checks };
  }
  if (reviewGateFailure(root, task, state, { ignoreChecks: true }) === null) return { kind: 'check', checks };

  return { kind: 'unmet', changedPaths: null, checks };
}

function causeText(target, cause) {
  const reasons = {
    'changed-inputs': () => `changed inputs: ${cause.changedPaths?.join(', ')}${cause.commitmentsChanged ? ', and changed commitments' : ''}`,
    'changed-commitments': () => 'changed commitments',
    unestablished: () => 'a comparison that could not be established',
    check: () => `${cause.record ? `${cause.record}: ` : ''}${namedChecks(cause.checks)}`,
    unmet: () => 'unmet assurance',
  };

  const checks = cause.kind !== 'check' && cause.checks?.length ? `, and ${namedChecks(cause.checks)}` : '';

  return `${target.id}: ${reasons[cause.kind]()}${checks}`;
}

// On a review context or a run without the docs gate, a code assessment stale only because documentation paths changed counts as
// current once a current docs review covers the task. Lore tasks gain this only from the closing docs review, since task-level docs
// reviews never cover them; a governing spec never gains it. A docs-gated run never needs it: its code assessments ignore those paths.
function documentationRelief(root, task, state, review) {
  if (!state || ignoresDocumentationPaths(state) || task.kind === 'spec' || review.snapshot?.inventory !== true) return false;
  const changed = changedPaths(root, review.snapshot);
  // A changed governing artifact, or one whose identity cannot be established, stays counted and withholds the relief.
  if (!changed || !changed.every(isDocumentationPath) || partitionDocumentationChanges(root, changed, governingArtifacts([task], [review])).counted.length > 0) return false;
  return docsReviewFailure(root, task, state, { closingOnly: task.kind === 'lore' }) === null;
}

function docsCandidates(task, state, closingOnly) {
  const closing = state.closing?.docs;
  const fromClosing = (closing?.reviews ?? []).filter(review => !review.relevance && review.coveredTaskIds?.includes(task.id)).map(review => ({ review, owner: closing }));
  if (closingOnly) return fromClosing;
  const fromTasks = state.tasks.flatMap(owner => owner.reviews
    .filter(review => !review.relevance && review.kind === 'docs' && (owner.id === task.id || sharesCumulativeAssessment(task) && sharesCumulativeAssessment(owner) && review.coveredTaskIds?.includes(task.id)))
    .map(review => ({ review, owner })));
  return [...fromTasks, ...fromClosing];
}

// Whether the latest docs review covering the task is current, with the same conditions the code gate applies, plus the closing record's own findings and checks when it supplies that review.
function docsReviewFailure(root, task, state, { closingOnly = false } = {}) {
  const entry = latestReview(docsCandidates(task, state, closingOnly), state);
  if (!entry || !completeAssessment(entry.review)) return 'unmet';
  const { review, owner } = entry;
  if (!applicability(root, review, task, owner, state).current) return 'stale';
  if (!coversDimensions(review, 'docs')) return 'unmet';
  // The task's own docs findings, and those of the owning record: every one the closing record holds, or those this review raised on another task.
  const others = owner === task ? [] : owner.kind === 'closing' ? owner.findings : owner.findings.filter(finding => finding.reviewRevision === review.revision || owner.reviews.some(candidate => candidate.relevance && candidate.relevance.requestId === review.requestId && relevanceCoversTask(candidate, task.id) && candidate.revision === finding.reviewRevision));
  const findings = [...task.findings.filter(finding => findingKind(finding, task) === 'docs'), ...others];
  if (!findings.every(settled) || findings.some(finding => finding.pendingClosure || finding.repaired && finding.repairRevision >= review.revision)) return 'unmet';
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
function closingRecordFailure(root, state, { ignoreChecks = false } = {}) {
  const record = state.closing?.docs;
  if (!record) return null;
  const latest = latestClosingReview(record, state);
  if (latest && (!completeAssessment(latest) || !coversDimensions(latest, 'docs'))) return 'unmet';
  if (!record.findings.every(settled) || record.findings.some(finding => finding.pendingClosure)) return 'unmet';
  if (record.findings.some(finding => finding.repaired && finding.repairRevision >= (latest?.revision ?? Infinity))) return 'unmet';
  return ignoreChecks || verificationGate(root, record) ? null : 'unmet';
}

const CLOSING_COVERAGE = Object.freeze({
  unreviewed: 'Changes since triage need a current, complete and resolved closing docs review',
  'outside-git': 'Documentation changed after triage in a project outside Git, where no independent review can be dispatched; revert those tracking edits, or make them in a Git worktree where a closing docs review can cover them',
  'no-baseline': 'The changes since triage cannot be established; obtain a fresh cumulative task assessment of the whole inventory, then record triage again once Git can inspect the project',
});

function latestClosingReview(record, state) {
  return latestReview(record.reviews.filter(review => !review.relevance).map(review => ({ review })), state)?.review;
}

// Why completion lacks closing coverage, as a CLOSING_COVERAGE key, or null when it holds. Anything changed since triage needs a
// current resolved closing review, whether or not a task gate depends on it; on a complete run, where no task assessment can be
// dispatched, a change outside the documentation paths is never covered, while an unfinished run holds such a change with the
// outside-documentation hold instead. A baseline read from disk belongs to a project outside Git, where no review can be dispatched,
// so any documentation change there fails closed; a missing or unreadable baseline fails closed too.
function closingCoverageFailure(root, state) {
  const record = state.closing?.docs;
  if (!record) return null;
  if (!record.baseline) return 'no-baseline';
  if (record.baseline.backlogOnly) {
    const changed = changedDocumentationPaths(root, record.baseline);
    return changed === null ? 'no-baseline' : changed.length === 0 ? null : 'outside-git';
  }
  const changed = changedPaths(root, record.baseline);
  if (changed === null) return 'no-baseline';
  if (changed.length === 0) return null;
  const latest = latestClosingReview(record, state);
  const excluded = new Set(latest?.contextSnapshot?.excludedPaths ?? []);
  if (state.status === 'complete' && changed.some(file => !excluded.has(file) && !isDocumentationPath(file))) return 'unreviewed';
  return latest && closingAssessmentCurrent(root, state, latest) && closingRecordFailure(root, state) === null ? null : 'unreviewed';
}

// The closing baseline the outside-documentation condition reads, or undefined when the run has none to evaluate: before triage, on
// a complete or closed run, and for a project outside Git, whose baseline holds documentation files only. A missing baseline is null.
function outsideDocumentationBaseline(state) {
  if (isReviewContext(state) || isClosed(state) || state.status === 'complete' || !state.closing) return undefined;
  const record = state.closing.docs;
  if (!record && state.closing.carriedBaseline === undefined) return undefined;
  const baseline = record ? record.baseline : state.closing.carriedBaseline;
  return baseline?.backlogOnly ? undefined : baseline ?? null;
}

// The run's outside-documentation set: the paths changed since the closing baseline that are not documentation paths, apart from the
// paths the latest closing review excluded and its selected-only context paths absent from the baseline. Recomputed at every reading;
// null when it cannot be computed.
function outsideDocumentationPaths(root, state, baseline) {
  if (!baseline) return null;
  const changed = changedPaths(root, baseline);
  if (changed === null) return null;
  const latest = state.closing.docs ? latestClosingReview(state.closing.docs, state) : null;
  const excluded = new Set(latest?.contextSnapshot?.excludedPaths ?? []);
  const baselinePaths = new Set(baseline.files.map(file => file.path));
  const selectedOnly = Array.isArray(latest?.contextSnapshot?.includedOnlyPaths) ? latest.contextSnapshot.includedOnlyPaths : [];
  const contextOnly = new Set(selectedOnly.filter(file => !baselinePaths.has(file)));
  return changed.filter(file => !excluded.has(file) && !contextOnly.has(file) && !isDocumentationPath(file));
}

// Every task but a spec task can carry a code assessment.
function codeCarriers(state) {
  return state.tasks.filter(task => task.kind !== 'spec');
}

// Whether an inventory assessment's compared scope positively held a path, so that its current applicability speaks for the path's
// current state: no exclusion names it, and either a recorded snapshot lists it, or it is absent now and lay in the scope the assessment
// inventoried, because the assessment selected it or Git neither ignores it nor leaves it to a runtime-owned folder, so the assessment saw
// its absence. A present path the snapshots do not list was never seen, applicable or not. Anything that cannot be read is unseen.
function assessmentSawPath(root, review, file) {
  const evidence = [review.snapshot, review.contextSnapshot].filter(Boolean);
  if (evidence.some(item => (item.excludedPaths ?? []).includes(file))) return false;
  if (evidence.some(item => Array.isArray(item.files) && item.files.some(entry => entry.path === file))) return true;
  try {
    if (fileIdentity(root, file).exists) return false;
  } catch {
    // An entry whose identity cannot be established was not positively seen.
    return false;
  }
  if (evidence.some(item => (item.includedPaths ?? []).includes(file))) return true;
  return compareOnce(JSON.stringify(['inventory-visible', root, file]), () => inventoryVisible(root, file)) === true;
}

// Whether a settling assessment exists for the outside-documentation set: a complete, fresh code assessment of any task that can carry
// one, covering its dimensions, whose inventory scope positively held every path of the set, and whose applicability on current inputs
// reads applicable. In a run without such a task, a spec task's complete, fresh whole-spec assessment reading applicable settles it when
// every path of the set is that task's governing spec or a governing artifact named in the assessment's recorded commitments. A relevance
// decision never settles it, and neither does a docs review.
function settlesOutsideDocumentation(root, state, paths) {
  const applicable = (task, review, kind) => !review.relevance && reviewKind(review, task) === kind && completeAssessment(review) && coversDimensions(review, kind) && applicability(root, review, task, task, state).status === 'applicable';
  const carriers = codeCarriers(state);
  if (carriers.length > 0) {
    const sawEvery = review => review.snapshot?.inventory === true && paths.every(file => assessmentSawPath(root, review, file));
    return carriers.some(task => task.reviews.some(review => sawEvery(review) && applicable(task, review, 'code')));
  }
  return state.tasks.some(task => task.reviews.some(review => applicable(task, review, 'spec') && onlyGoverningArtifacts(root, paths, governingArtifacts([task], [review]))));
}

// The outside-documentation hold: null while the condition is settled or not evaluated, otherwise its set as changedPaths, null when the
// set cannot be computed. Every consumer reads this one predicate, never the raw set.
function outsideDocumentationHold(root, state) {
  const baseline = outsideDocumentationBaseline(state);
  if (baseline === undefined) return null;
  const paths = outsideDocumentationPaths(root, state, baseline);
  if (paths !== null && (paths.length === 0 || settlesOutsideDocumentation(root, state, paths))) return null;
  return { changedPaths: paths };
}

// The tasks on which a fresh code assessment settles the hold, those whose assessment would also cover more of the run's code gates the
// same edit staled listed first: a code or docs task's cumulative assessment covers its completed cumulative siblings.
function settlingCandidates(root, state) {
  const stale = new Set(codeCarriers(state).filter(task => requiresReview(task) && reviewGateFailure(root, task, state) === 'stale').map(task => task.id));
  const reach = candidate => [candidate, ...(sharesCumulativeAssessment(candidate) ? state.tasks.filter(task => task !== candidate && sharesCumulativeAssessment(task) && task.status === 'complete') : [])].filter(task => stale.has(task.id)).length;
  return codeCarriers(state).map((task, index) => ({ task, index, reach: reach(task) })).sort((left, right) => right.reach - left.reach || left.index - right.index).map(entry => entry.task.id);
}

// The kind of fresh assessment that settles the hold: code when the run has a task that can carry one, otherwise spec, on the first spec
// task whose governing artifacts include every path of the set, otherwise none, which leaves the user's decision. A set that cannot be
// computed names no spec task.
function holdSettlement(root, state, hold) {
  if (codeCarriers(state).length > 0) return { kind: 'code' };
  const spec = hold.changedPaths === null ? undefined : state.tasks.find(task => onlyGoverningArtifacts(root, hold.changedPaths, governingArtifacts([task], [leadEntry(task, state)?.review].filter(Boolean))));
  return spec ? { kind: 'spec', task: spec } : { kind: 'none' };
}

// The way forward from the hold, naming the settling step first and then the closing docs review the docs side requires.
function outsideDocumentationNext(root, state, hold) {
  if (hold.changedPaths === null) return CLOSING_COVERAGE['no-baseline'];
  const closingReview = `then a complete closing docs review (task ${CLOSING_TARGET}) covering every task and current on the final inputs`;
  const revert = 'Reverting these paths also settles the hold.';
  const settlement = holdSettlement(root, state, hold);
  // A dispatch need not select an ignored changed path on its own, and only an assessment whose scope held every path settles the hold.
  if (settlement.kind === 'code') return `Obtain a fresh code assessment on one of the tasks ${settlingCandidates(root, state).join(', ')}, passing the changed paths as artifactPaths, ${closingReview}. ${revert}`;
  if (settlement.kind === 'spec') return `Obtain a fresh whole-spec assessment on spec task ${settlement.task.id}, which settles the hold, ${closingReview}. ${revert}`;
  return `No task assessment can settle the hold, so it needs the user's decision: hold, stop or the administrative close. ${revert}`;
}

function outsideDocumentationStatus(root, state, hold) {
  return { changedPaths: hold.changedPaths, next: outsideDocumentationNext(root, state, hold) };
}

function outsideDocumentationRefusal(root, state, hold) {
  if (hold.changedPaths === null) return CLOSING_COVERAGE['no-baseline'];
  return `Paths outside the documentation paths changed since triage and hold completion until a fresh task assessment covers them or they are reverted: ${hold.changedPaths.slice(0, 20).join(', ')}. ${outsideDocumentationNext(root, state, hold)}`;
}

// The baseline a triage records. An earlier baseline of the run stands while the changes since it lack independent review, so
// recording triage again, even after something cleared the closing record, never absorbs unreviewed tracking edits. It also stands
// while the outside-documentation hold is unsettled, so no review that cannot settle it absorbs changes outside the documentation paths.
// Otherwise those changes are reviewed once a current resolved closing review covers them, or once a complete cumulative task assessment
// is fresh against the whole inventory, every path compared. The first triage, with no earlier closing record or carried baseline, takes
// the inventory. A missing earlier baseline, which fails closed, stays missing unless such a fresh task assessment shows the changes it
// could not establish reviewed, so recording triage again never absorbs them.
function nextTriageBaseline(root, state) {
  if (!state.closing.docs && state.closing.carriedBaseline === undefined) return triageBaseline(root, state);
  const earlier = state.closing.docs ? state.closing.docs.baseline ?? null : state.closing.carriedBaseline;
  const taskReviewed = () => {
    try {
      return state.tasks.some(task => task.reviews.some(review => reviewKind(review, task) !== 'spec' && review.snapshot?.inventory === true && completeAssessment(review) && fresh(root, review.snapshot)));
    } catch {
      // A Git failure leaves the changes unreviewed as far as this triage can tell, so the earlier baseline stands.
      return false;
    }
  };
  if (!earlier) return taskReviewed() ? triageBaseline(root, state) : null;
  if (outsideDocumentationHold(root, state)) return earlier;
  const closingReviewed = Boolean(state.closing.docs) && closingCoverageFailure(root, state) === null;
  return closingReviewed || taskReviewed() ? triageBaseline(root, state) : earlier;
}

// The repair step of the operating brief, carried by both kinds of status rules.
const REPAIR_RULE = 'Repair the property a finding keys on with the smallest change; before repairing a finding that reports misbehavior, run a failing check that reproduces it and rerun the same command under the same name on the same task after the repair, and again before a review once its inputs change, since only a current passing check carries its reproduction to reviewers, or, when no practical automated reproduction exists, record a reason and stand-in evidence; when a repair changes which record, status or case a decision or obligation reads, trace that state\'s readers and writers; and after a second missed case of the same kind after a repair, a repair undoing an earlier one or a repeated invariant violation, counting misses across repair attempts rather than findings one review reports together, fix the shared cause.';
// Each stale refusal names its way forward after these, by the applicability-call predicate.
const STALE_REVIEW = 'The latest assessment is stale on current inputs';
const STALE_DOCS_REVIEW = 'The latest docs review is stale on current inputs';

// Closures in a complete report of a continued lead end the pending closure of each finding of its lineage it records closed; an
// incomplete report's closures are not recorded. Every recorded closure stays on its finding as evidence.
function recordClosures(target, review, lineage, revision) {
  if (!review.continues || review.status !== 'complete') return;
  for (const closure of review.closures ?? []) {
    const finding = target.findings.find(candidate => candidate.id === closure.id);
    if (finding?.pendingClosure?.lineage !== lineage) continue;
    finding.closures = [...(finding.closures ?? []), { requestId: review.requestId, closed: closure.closed, evidence: closure.evidence, revision, ...(target.kind === 'closing' ? { progressBinding: structuredClone(finding.progressBinding) } : {}) }];
    if (closure.closed) delete finding.pendingClosure;
  }
}

function latestByKind(owner, state) {
  const latest = new Map();
  const reviews = owner.reviews.filter(review => !review.relevance);
  for (const kind of new Set(reviews.map(review => reviewKind(review, owner)))) {
    const entries = reviews.filter(review => reviewKind(review, owner) === kind).map(review => ({ review }));
    latest.set(kind, latestReview(entries, state).review);
  }
  return latest;
}

// A task's latest repair batch: its revision and the kinds of the findings it repaired. Each repair records it on its target, so
// neither re-validation, which clears a finding's repair state, nor closure, which ends its pending closure, erases it; a task
// repaired by an earlier release falls back to its findings' repair state.
function latestRepair(task) {
  if (task.lastRepair) return task.lastRepair;
  const repaired = task.findings.filter(finding => finding.repaired && finding.repairRevision !== undefined);
  const revision = Math.max(-1, ...repaired.map(finding => finding.repairRevision));
  return { revision, kinds: [...new Set(repaired.filter(finding => finding.repairRevision === revision).map(finding => findingKind(finding, task)))] };
}

// The assessments a task's code or spec gate and its docs gate read, each with its owner, that no longer match current inputs. A gate
// judges the currency of an assessment it accepts, so documentation relief and covering assessments count; it never reports stale one it
// does not accept, such as a continued, incomplete or narrow one, which is outdated once its reviewed inputs changed.
function staleGateEntries(root, task, state) {
  const outdated = (failure, entry) => Boolean(entry) && !applicability(root, entry.review, task, entry.owner, state).current && (failure === 'stale' || !acceptableAssessment(entry.review, task));
  return [[reviewGateFailure(root, task, state), leadEntry(task, state)], [docsReviewFailure(root, task, state), latestReview(docsCandidates(task, state, false), state)]]
    .filter(([failure, entry]) => outdated(failure, entry))
    .map(([, entry]) => entry);
}

// The task on which a fresh assessment of a kind covers a stale gate of the given task: the task itself while it is open, otherwise
// a ready open task sharing the cumulative assessment with it, the repaired target first, since a task review covers its completed
// cumulative siblings. A stale gate that no open task can cover needs an assessment on its own completed task, which reopens it before
// triage evidence exists; after triage it reopens it only when the import raises findings or is not an assessment its gate accepts.
function freshAssessmentTask(state, task, kind, target) {
  if (task.status !== 'complete') return task;
  if (!['code', 'docs'].includes(kind) || !sharesCumulativeAssessment(task)) return task;
  const ready = candidate => candidate.status !== 'complete' && !candidate.blocker && candidate.requires.every(id => taskById(state, id).status === 'complete');
  return [target, ...state.tasks].find(candidate => candidate.kind !== 'closing' && ready(candidate) && sharesCumulativeAssessment(candidate)) ?? task;
}

// What a target's review needs next, in order: validation and disposition, then repairs, then closures by resuming the reviewers that
// raised the repaired findings, then a fresh assessment of each kind whose latest assessment is a continued one. resumeTargets names
// the dispatch to resume, the task it belongs to and whether to resume or replace it, for each lineage owing closures. After a task's
// repair, freshTargets names the fresh assessments due because the repair left a latest assessment of another review kind, of this or
// any other task, predating it and no longer matching current inputs: one its gate accepts and finds stale, or any other whose reviewed
// inputs changed. Such a reviewer has nothing to close, so it is not resumed for closure. Each entry gives the kind, the task to dispatch
// it on, the tasks whose stale gates it covers, the stale assessments, each stale change with the applicability call that can settle it
// first, when one is available, and whether the dispatch reopens a completed task. The raising reviewers
// reassess their own kinds, and a closing repair reopens no task, so neither adds fresh targets. Fresh targets depend on freshness: a
// lightweight brief marks them unevaluated.
function reviewProgress(root, state, target, options = {}) {
  const findings = target.findings;
  const latest = latestByKind(target, state);
  const freshDue = [...latest].filter(([, review]) => review.continues).map(([kind]) => kind);
  const owing = [...new Set(findings.filter(finding => finding.pendingClosure).map(finding => finding.pendingClosure.lineage))];
  const resumeTargets = owing.map(lineage => {
    const requestId = latestDispatchOf(root, state, target, lineage);

    return { requestId, taskId: target.id, lineage, reason: 'pending-closure', continue: requestId ? closureRoute(root, state, requestId) : 'resume' };
  });
  const repair = target.kind === 'closing' ? null : latestRepair(target);
  const evaluateStale = repair !== null && repair.revision >= 0;
  let freshTargets = [];
  if (evaluateStale && options.verifyFreshness === false) freshTargets = 'reconcile at acceptance';
  else if (evaluateStale) {
    // Each stale change, with the assessment and owner it describes and the tasks whose stale gates it covers, for its applicability call.
    const judged = new Map();
    // After triage, an import on a completed task reopens it only when it raises findings or is not an assessment its gate accepts.
    const reopens = dispatchOn => dispatchOn.status === 'complete' && (state.closing?.triageEvidence ? 'if-findings' : true);
    for (const task of [target, ...state.tasks.filter(task => task.id !== target.id)]) {
      for (const { review, owner } of staleGateEntries(root, task, state)) {
        const kind = reviewKind(review, owner);
        const registered = state.workers?.find(worker => worker.id === review.requestId)?.registeredRevision;
        // Without a registration revision, a late import cannot prove that its assessment followed the repair.
        if (owing.includes(lineageOf(review)) || repair.kinds.includes(kind) || Number.isSafeInteger(registered) && registered >= repair.revision) continue;
        const dispatchOn = freshAssessmentTask(state, task, kind, target);
        // One assessment on a task covers every stale gate it reaches, such as a covering assessment several tasks' gates read.
        let entry = freshTargets.find(item => item.kind === kind && item.taskId === dispatchOn.id);
        const staleCondition = staleCause(applicability(root, review, task, owner, state));
        const change = { requestId: review.requestId ?? null, cause: staleCondition.kind, changedPaths: staleCondition.changedPaths };
        if (!entry) {
          entry = { kind, taskId: dispatchOn.id, covers: [], staleAssessments: [], staleChanges: [], reopens: reopens(dispatchOn) };
          freshTargets.push(entry);
        }
        if (!entry.covers.includes(task.id)) entry.covers.push(task.id);
        if (review.requestId && !entry.staleAssessments.includes(review.requestId)) entry.staleAssessments.push(review.requestId);
        let staleChange = entry.staleChanges.find(known => isDeepStrictEqual(known, change));
        if (!staleChange) {
          staleChange = change;
          entry.staleChanges.push(staleChange);
          judged.set(staleChange, { review, owner, taskIds: [] });
        }
        judged.get(staleChange).taskIds.push(task.id);
      }
    }
    const hold = judged.size > 0 ? outsideDocumentationHold(root, state) : null;
    for (const [staleChange, { review, owner, taskIds }] of judged) staleChange.applicabilityCall = applicabilityCall(root, state, owner, review, taskIds, hold);
  }
  const next = findings.some(finding => !finding.validation || finding.validation.verdict === 'unverified' || !finding.disposition || finding.disposition === 'implement' && !finding.repaired && !evidenceCommitmentsCurrent(state, target, finding.validation)) ? 'validate-and-dispose'
    : findings.some(finding => finding.disposition === 'implement' && !finding.repaired) ? 'repair'
      : owing.length > 0 ? 'resume'
        : freshDue.length > 0 ? 'fresh-assessment' : null;
  return { next, resumeTargets, freshDue, freshTargets };
}

// Whether a stale assessment's changed paths fall under the unsettled outside-documentation hold, so that the hold's way forward is its
// way forward and no applicability call is offered: a preserving call would pass its gate but cannot settle the hold. A set that cannot
// be computed may hold any change. Otherwise a changed path must lie in the set, and the element is held when a fresh assessment of its
// own kind settles the hold. A docs assessment never settles it, yet under the hold it still defers to the hold's way forward, as a code
// assessment does. A spec assessment is held only in a run whose hold a whole-spec assessment settles; in a run with a code task its own
// applicability call stays its way forward to readiness.
function heldBy(root, state, hold, changed, kind) {
  if (!hold || !Array.isArray(changed) || changed.length === 0) return false;
  if (hold.changedPaths === null) return true;
  if (!changed.some(file => hold.changedPaths.includes(file))) return false;
  return kind !== 'spec' || holdSettlement(root, state, hold).kind === 'spec';
}

// The applicability call that can settle a stale assessment for the given tasks: the owner holding it, on which the call is dispatched,
// the assessment it judges, the tasks within that assessment's coverage it judges, the latest dispatch of its lineage that produced a
// receipt, and whether to resume or replace that dispatch. Null when no call is available: an unestablished comparison, a reassess or
// unresolved answer already given on the current inputs and commitments, an assessment that is continued, incomplete or narrow, changed
// paths the unsettled outside-documentation hold holds (always for a code or docs assessment, and for a spec assessment only in a run
// whose hold a whole-spec assessment settles, as heldBy decides), original inputs that are not retained, or no request id or receipted
// dispatch.
// A changed commitment alone leaves the call available, since a preserving decision bound to the current commitments can settle it.
function applicabilityCall(root, state, owner, review, taskIds, hold) {
  if (!review.requestId || !completeAssessment(review) || !coversDimensions(review, reviewKind(review, owner))) return null;
  const judged = new Set();
  for (const id of taskIds) {
    const task = state.tasks.find(candidate => candidate.id === id);
    if (!task || !review.coveredTaskIds?.includes(id)) continue;
    const condition = applicability(root, review, task, owner, state);
    const cause = staleCause(condition);
    if (cause.kind === 'unestablished' || heldBy(root, state, hold, cause.changedPaths, reviewKind(review, owner))) return null;
    if (['reassess', 'unresolved'].includes(condition.status) && condition.decisionCurrent !== false) continue;
    judged.add(id);
  }
  if (judged.size === 0 || !originalInputsRetained(root, state, review)) return null;
  const resume = latestDispatchOf(root, state, owner, lineageOf(review));

  return resume ? { taskId: owner.id, requestId: review.requestId, taskIds: [...judged].sort(), resume, continue: closureRoute(root, state, resume) } : null;
}

// The way forward for a stale assessment of a task, naming the applicability call first exactly when one is available, otherwise the
// fresh cumulative assessment, or reconciliation for a comparison that could not be established.
function staleWayForward(root, state, task, entry, hold = outsideDocumentationHold(root, state)) {
  const cause = staleCause(applicability(root, entry.review, task, entry.owner, state));
  if (cause.kind === 'unestablished') return 'reconcile the comparison that could not be established, then obtain a fresh cumulative assessment';
  if (heldBy(root, state, hold, cause.changedPaths, reviewKind(entry.review, entry.owner))) return `obtain a fresh cumulative assessment, since an applicability call cannot settle the outside-documentation hold these changes fall under: ${outsideDocumentationNext(root, state, hold)}`;
  const call = applicabilityCall(root, state, entry.owner, entry.review, [task.id], hold);
  if (!call) return 'obtain a fresh cumulative assessment covering the changes, since no applicability call is available';
  const dispatch = call.continue === 'replace' ? `dispatch the independent replacement of ${call.resume}` : `resume ${call.resume}, or dispatch its independent replacement if it cannot be resumed,`;

  return `${dispatch} on ${call.taskId} for an applicability call on ${call.requestId} for ${call.taskIds.join(', ')}, with a fresh cumulative assessment as the fallback`;
}

function sentence(phrase) {
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

function requireReviewGate(root, task, state, message) {
  const cause = reviewGateCause(root, task, state);
  if (cause === null) return;
  const stale = ['changed-inputs', 'changed-commitments', 'unestablished'].includes(cause.kind) || reviewGateFailure(root, task, state) === 'stale';
  requireCondition(false, 'review-required', `${stale ? `${STALE_REVIEW}: ${staleWayForward(root, state, task, leadEntry(task, state))}` : message}. Cause: ${causeText(task, cause)}`);
}

// Why the docs review covering a task fails its gate, from the review that gate selected.
function docsCause(root, task, state, failure, options) {
  const entry = latestReview(docsCandidates(task, state, options?.closingOnly ?? false), state);
  if (failure !== 'stale') {
    const checks = entry?.owner.kind === 'closing' ? checkFailures(root, entry.owner) : [];

    return checks.length > 0 ? { kind: 'check', checks, record: entry.owner.id } : { kind: 'unmet', changedPaths: null };
  }

  return staleCause(applicability(root, entry.review, task, entry.owner, state));
}

function docsRefusal(root, task, state, failure, message, options) {
  const way = () => staleWayForward(root, state, task, latestReview(docsCandidates(task, state, options?.closingOnly ?? false), state));

  return `${failure === 'stale' ? `${STALE_DOCS_REVIEW}: ${way()}` : message}. Cause: ${causeText(task, docsCause(root, task, state, failure, options))}`;
}

function requireDocsGate(root, task, state, message) {
  const failure = docsGateFailure(root, task, state);
  requireCondition(failure === null, 'docs-review-required', failure === null ? '' : docsRefusal(root, task, state, failure, message));
}

function requireStandaloneAssessment(state, task) {
  if (requiresReview(task)) requireReviewGate(state.root, task, state, 'Standalone revision needs its current strong independent assessment and resolved repair obligations');
  // A purely mechanical standalone docs revision may record an inventory-bound exemption instead, honored only while current.
  const exempt = task.docsExemption && fresh(state.root, task.docsExemption.snapshot);
  if (!exempt && (task.kind === 'docs' || task.reviews.some(review => reviewKind(review, task) === 'docs'))) {
    const failure = docsReviewFailure(state.root, task, state);
    requireCondition(failure === null, 'docs-review-required', failure === null ? '' : docsRefusal(state.root, task, state, failure, 'Standalone documentation assurance must be current and resolved'));
  }
  requireCondition(unresolvedFindings(task).length === 0, 'review-required', 'Every standalone finding needs validation, disposition and any required repair closure');
  if (!verificationGate(state.root, task)) requireCondition(false, 'verification-required', verificationRefusal(state.root, [task], 'Standalone verification must pass on current inputs'));
}

// A closed record has nothing actionable left, so its brief reports its identity and closure without next tasks, freshness or acceptance.
function closedBrief(state) {
  return {
    id: state.id, kind: recordKind(state), ...(isReviewContext(state) ? { reviewContextId: state.id } : {}), revision: state.revision, status: state.status, controller: state.controller,
    objective: state.objective, authority: state.authority, stop: state.stop ?? null, hold: state.hold ?? null, closure: state.closure ?? null,
    resourceMode: state.resourceMode ?? 'legacy', resources: state.resources ?? null, executionResources: require('../releases/entry').executionResources(state),
    next: [], blockers: [], workers: [], followups: [],
    rules: 'This record is closed: the user dropped its remaining obligations through the administrative close action. It is read-only; nothing further is due.',
  };
}

// An assessment's applicability as status reports it: documentation relief where it still arises, and for a stale assessment the way
// forward the applicability-call predicate names. Reconciliation and missing spec inputs keep their own next step.
function assessmentCondition(root, task, state, entry, hold) {
  const { review, owner } = entry;
  const condition = applicability(root, review, task, owner, state);
  if (reviewKind(review, owner) === 'code' && condition.status === 'pending' && acceptableAssessment(review, task) && documentationRelief(root, task, state, review)) {
    return { ...condition, status: 'applicable-by-docs-review', current: true, reason: 'A current independent docs review covers documentation-only input changes', next: null };
  }
  if (condition.current || condition.missingPaths || staleCause(condition).kind === 'unestablished') return condition;
  return { ...condition, next: sentence(staleWayForward(root, state, task, entry, hold())) };
}

function assessmentApplicability(root, state) {
  let hold;
  const holdOnce = () => (hold === undefined ? (hold = outsideDocumentationHold(root, state)) : hold);
  return state.tasks.flatMap(task => {
    const entries = [leadEntry(task, state), latestReview(docsCandidates(task, state, false), state)].filter(Boolean);
    return entries.map(entry => ({ taskId: task.id, completed: task.status === 'complete', ...assessmentCondition(root, task, state, entry, holdOnce) }));
  });
}

function obligationBrief(state, root = state.root, options = {}) {
  return withEvidenceComparisons(() => buildObligationBrief(state, root, options));
}

function buildObligationBrief(state, root, options) {
  if (isClosed(state)) return closedBrief(state);
  const active = state.tasks.filter(task => task.status !== 'complete');
  const ready = active.filter(task => !task.blocker && task.requires.every(id => taskById(state, id).status === 'complete'));
  return {
    id: state.id, kind: recordKind(state), ...(isReviewContext(state) ? { reviewContextId: state.id } : {}), revision: state.revision, status: state.status, controller: state.controller,
    objective: state.objective, authority: state.authority, limits: state.limits, publication: state.publication, hold: state.hold ?? null,
    ...(!isReviewContext(state) ? { handover: state.handover ?? null, report: reportStatus(state, root), continuation: state.continuation ?? null, hookIntegration: state.hookIntegration ?? null, ...(state.kind === 'delivery' ? { acknowledgement: { status: state.acknowledgement?.status ?? 'pending', current: require('./acknowledgement').acknowledged(state), renewalRevision: state.acknowledgement?.renewalRevision ?? null, requiredAfter: state.acknowledgement?.requiredAfter ?? null } } : {}) } : {}),
    scratch: options.verifyFreshness === false ? 'reconcile at acceptance' : scratchStatus(root, state.baseSha ?? null),
    resourceMode: state.resourceMode ?? 'legacy', resources: state.resources ?? null,
    executionResources: require('../releases/entry').executionResources(state), ...(!isReviewContext(state) ? { controllerClaim: state.controllerClaim ?? null } : { ownerObservation: state.ownerObservation ?? null }), adoption: state.adoption ?? null,
    next: ready.map(task => ({
      id: task.id, title: task.title,
      stage: state.kind === 'delivery' && !require('./continuation-health').continuationOutcomeCurrent(state) ? 'continuation-observation' : task.stage,
      agreement: { source: task.agreement.source, outcome: task.agreement.outcome, decisions: task.agreement.decisions, spec: task.agreement.spec, specReviewTaskId: specLink(task) },
      ...(typeof task.agreement.spec === 'string' ? { specAcceptance: specAcceptanceStatus(root, task, options) } : {}),
      unresolvedFindings: unresolvedFindings(task).map(finding => ({ id: finding.id, consequence: finding.consequence, verdict: finding.validation?.verdict ?? null, validationCommitmentsCurrent: finding.validation ? evidenceCommitmentsCurrent(state, task, finding.validation) : null, disposition: finding.disposition, pendingClosure: Boolean(finding.pendingClosure), evidence: finding.evidence.slice(0, 600), ...(surfaceVerdicts(finding) ? { surfaceVerdicts: surfaceVerdicts(finding) } : {}) })),
      review: reviewProgress(root, state, task, options),
      reviewCurrent: options.verifyFreshness === false ? 'reconcile at acceptance' : reviewGate(root, task, state),
      ...(state.docsGate && sharesCumulativeAssessment(task) ? { docsReviewCurrent: options.verifyFreshness === false ? 'reconcile at acceptance' : docsGateFailure(root, task, state) === null } : {}),
    })),
    // An exemption is recorded as its task completes, so it is listed for every task rather than only for work still ahead.
    ...(state.docsGate || isReviewContext(state) ? { docsExemptions: state.tasks.filter(task => task.docsExemption).map(task => ({ taskId: task.id, reason: task.docsExemption.reason, revision: task.docsExemption.revision, current: options.verifyFreshness === false ? 'reconcile at acceptance' : fresh(root, task.docsExemption.snapshot) })) } : {}),
    assessmentApplicability: options.verifyFreshness === false ? 'unevaluated' : assessmentApplicability(root, state),
    staleChecks: options.verifyFreshness === false ? 'reconcile at acceptance' : staleChecks(root, state),
    ...(!isReviewContext(state) ? { specReadiness: specReadinessStatus(state, options, task => specAcceptanceStatus(root, task, options)) } : {}),
    finalReconciliationPending: !isReviewContext(state) && state.status === 'running' && active.length === 0,
    ...(!isReviewContext(state) ? { closing: { ready: closingReady(state), stage: closingStage(state), ...(state.closing?.docs ? { docsReview: closingDocsBrief(state, root, options) } : outsideDocumentationBrief(state, root, options)), ...(state.closing?.carriedFindings?.length ? { carriedFindings: state.closing.carriedFindings.map(finding => finding.id), carriedSurfaceVerdicts: findingSurfaceVerdicts(state.closing.carriedFindings) } : {}) } } : {}),
    blockers: active.filter(task => task.blocker).map(task => ({ id: task.id, blocker: task.blocker })),
    workers: state.workers.filter(workerIsActive),
    followups: state.followups.filter(item => item.status !== 'resolved'),
    rules: isReviewContext(state)
      ? `This is standalone revision, not a delivery run. Preserve attributed independent assessment, skeptical validation, dispositions, repair closure, freshness, owner identity and resources. ${REPAIR_RULE} No delivery closing, continuation, retrospective or triage is required. Report pending follow-ups and actual limits. Publication requires separate authority.`
      : `Continue authorized independent work and recovery. Every repair needs cumulative strong broad review: resume the reviewer that raised each repaired finding to record its closure, and pass a gate only on a fresh assessment. ${REPAIR_RULE} Validate every finding with a fresh skeptic before disposition. Preserve writer ownership. Update documentation and obtain its independent docs review, then retrospective, then follow-up triage; a handed-over run records its morning report before triage. Tracking edits after triage need a closing docs review (task ${CLOSING_TARGET}) before completion; edits outside the documentation paths after triage also hold completion until a fresh task assessment covers them or they are reverted. Missing or stale evidence is incomplete. Publication requires authority. Reconcile this record with actual files after compaction.`,
  };
}

function closingAssessmentCurrent(root, state, review) {
  if (!Array.isArray(review.coveredTaskIds)) return false;
  if (review.coveredTaskIds.length === 0) return inputChanges(root, review)?.length === 0;
  return review.coveredTaskIds.every(id => {
    const task = state.tasks.find(candidate => candidate.id === id);
    return task && applicability(root, review, task, state.closing.docs, state).current;
  });
}

function findingSurfaceVerdicts(findings) {
  return findings.filter(surfaceVerdicts).map(finding => ({ id: finding.id, surfaces: surfaceVerdicts(finding) }));
}

// The outside-documentation part of the closing status: present only while the hold is unsettled, or, with freshness verification
// skipped, wherever the condition is evaluated. It sits in closing.docsReview while a closing record exists, and directly in closing
// when a reset left only the carried baseline the hold is still judged against.
function outsideDocumentationBrief(state, root, options) {
  if (outsideDocumentationBaseline(state) === undefined) return {};
  if (options.verifyFreshness === false) return { outsideDocumentation: 'reconcile at acceptance' };
  const hold = outsideDocumentationHold(root, state);
  return hold ? { outsideDocumentation: outsideDocumentationStatus(root, state, hold) } : {};
}

function closingDocsBrief(state, root, options) {
  const record = state.closing.docs;
  const latest = latestClosingReview(record, state);
  return {
    target: CLOSING_TARGET, baseline: Boolean(record.baseline), reviews: record.reviews.length,
    unresolvedFindings: record.findings.filter(finding => !settled(finding) || finding.pendingClosure).map(finding => finding.id),
    surfaceVerdicts: findingSurfaceVerdicts(record.findings.filter(finding => !settled(finding) || finding.pendingClosure)),
    review: reviewProgress(root, state, record, options),
    current: options.verifyFreshness === false ? 'reconcile at acceptance' : Boolean(latest) && closingAssessmentCurrent(root, state, latest) && closingRecordFailure(root, state) === null,
    satisfied: options.verifyFreshness === false ? 'reconcile at acceptance' : closingCoverageFailure(root, state) === null && outsideDocumentationHold(root, state) === null,
    ...outsideDocumentationBrief(state, root, options),
  };
}

// The closing record is admitted once triage evidence exists on a running run, and on a complete run as owner bookkeeping;
// a stopped run is resumed first. Recorded limits bind it on every run, since nothing overrides or renews them.
function assertClosingAction(state, request) {
  requireCondition(CLOSING_ACTIONS.includes(request.action), 'invalid-closing-action', `The closing record accepts only ${CLOSING_ACTIONS.join(', ')}`);
  requireCondition(state.status !== 'stopped', 'run-stopped', 'The run is stopped; resume it under the user\'s authority before closing work');
  const record = targetById(state, request.taskId);
  requireCondition(state.status === 'complete' || state.closing.triageEvidence, 'closing-review-unavailable', 'A closing docs review is admitted once triage evidence is recorded');
  if (state.kind === 'delivery' && state.status === 'running' && !['review', 'validate', 'dialogue'].includes(request.action)) {
    requireCondition(require('./continuation-health').continuationOutcomeCurrent(state), 'continuation-observation-required', 'Attempt host continuation and record its outcome before new dependent closing execution');
  }
  const exhausted = exhaustedLimit(state, { dispatch: request.action === 'dispatch' });
  requireCondition(!exhausted, 'resource-limit', exhausted);
  return record;
}

// Why a closing review cannot be imported, or null. Its difference from the triage baseline must be established with well-formed
// selected-only provenance. On a complete run, where no task assessment can be dispatched, each changed path since the baseline, apart
// from user-owned files the review excluded, must also be a documentation path; an unfinished run admits any change, which the
// outside-documentation hold then holds until a fresh task assessment covers it or it is reverted.
function closingScopeFailure(record, review, confineToDocumentation) {
  if (!record.baseline) return 'This closing record has no triage baseline, so a closing review cannot establish that only documentation paths changed';
  const excluded = new Set(review.contextSnapshot?.excludedPaths ?? []);
  const changed = require('./applicability').snapshotChanges(record.baseline, review.contextSnapshot ?? review.snapshot);
  if (!changed) return 'The assessed difference from the triage baseline cannot be established';
  const baselinePaths = new Set(record.baseline.files.map(file => file.path));
  const selectedOnly = review.contextSnapshot?.includedOnlyPaths;
  if (selectedOnly !== undefined && (!Array.isArray(selectedOnly) || new Set(selectedOnly).size !== selectedOnly.length
    || selectedOnly.some(file => typeof file !== 'string' || !review.contextSnapshot.includedPaths?.includes(file) || !review.contextSnapshot.files.some(entry => entry.path === file)))) {
    return 'The closing context has malformed selected-only input provenance';
  }
  if (!confineToDocumentation) return null;
  const contextOnly = new Set(selectedOnly ?? []);
  const outside = changed.filter(file => !excluded.has(file) && !(contextOnly.has(file) && !baselinePaths.has(file)) && !isDocumentationPath(file));
  return outside.length === 0 ? null : `On a complete run, where no task assessment can be dispatched, a closing review covers edits to the backlog, .nightshift/reports and root Markdown other than host instruction files only; these paths changed outside them since triage: ${outside.slice(0, 20).join(', ')}`;
}

function assertAction(state, request) {
  // First, ahead of the closing-target route and the bookkeeping exemption, so no action reaches a closed record by any path.
  requireCondition(!isClosed(state), 'run-closed', 'This record is closed and read-only; nothing further can change it');
  if (['handover', 'continuation', 'invalidate-continuation', 'claim-controller', 'add-spec-review', 'retrospective', 'report', 'report-delivered', 'triage'].includes(request.action) || request.taskId === CLOSING_TARGET) requireDelivery(state, request.action);
  const taskActions = ['start-task', 'add-spec-review', 'check', 'dispatch', 'probe', 'review', 'validate', 'dialogue', 'dispose', 'repair', 'advance', 'block', 'unblock', 'spec-accepted'];
  if (taskActions.includes(request.action) && request.taskId === CLOSING_TARGET) return assertClosingAction(state, request);
  const task = taskActions.includes(request.action) ? taskById(state, request.taskId) : null;
  const bookkeeping = ['worker-finished', 'followup', 'resolve-followup', 'resume', 'hold', 'stop', 'block', 'retrospective', 'report', 'report-delivered', 'spec-accepted', 'triage', 'invalidate-continuation'];
  requireCondition(state.status === 'running' || bookkeeping.includes(request.action), 'run-stopped', 'The run is stopped; explicit resumption is required before more work');
  if (!bookkeeping.includes(request.action)) {
    requireCondition(!exhaustedLimit(state, { dispatch: request.action === 'dispatch' }), 'resource-limit', exhaustedLimit(state, { dispatch: request.action === 'dispatch' }));
    if (state.kind === 'delivery' && !['continuation', 'handover', 'claim-controller', 'review', 'validate', 'dialogue'].includes(request.action)) requireCondition(require('./continuation-health').continuationOutcomeCurrent(state), 'continuation-observation-required', 'Attempt host continuation and record its observed result or failure before dependent work');
  }
  if (task && !['review', 'block', 'unblock', 'add-spec-review', 'spec-accepted'].includes(request.action)) {
    requireCondition(!task.blocker, 'task-blocked', 'Resolve the recorded blocker before dependent work');
    requireCondition(task.requires.every(id => taskById(state, id).status === 'complete'), 'dependency-blocked', 'An upstream task remains incomplete');
  }
  return task;
}

function transition(state, request, integration = null) {
  const task = assertAction(state, request);
  const dischargeBefore = require('./discharge').capture(state);
  const canonical = ['start-task', 'repair'].includes(request.action) || request.action === 'dispose' && request.disposition === 'implement';
  if (canonical || !isReviewContext(state) && ['claim-controller', 'resume'].includes(request.action)) {
    if (isReviewContext(state)) require('./review-context').assertRepairScope(state.root, state.controller, state);
    else require('./project-ownership').assertCanonicalWriteScope(state);
  }
  switch (request.action) {
    case 'add-spec-review': {
      requireCondition(task.kind === 'code' && usableSpec(task.agreement.spec), 'missing-spec', 'A governing spec is required for this internal assessment');
      if (specLink(task)) break;
      const governing = resolveGovernance(state.root, state.tasks).get(task.id).specTask;
      requireCondition(!governing, 'duplicate-task', governing ? `Queued spec task ${governing.id} already governs this task; complete it, assess it or obtain the applicability call on it instead` : '');
      const id = task.id + '-governing-spec';
      requireCondition(!state.tasks.some(candidate => candidate.id === id), 'duplicate-task', 'The governing-spec task identity is already in use');
      state.tasks.push({ id, title: 'Assess governing spec for ' + task.title, kind: 'spec', requires: [], status: 'pending', stage: 'implementation', agreement: { source: task.agreement.source, outcome: task.agreement.outcome, spec: task.agreement.spec }, checks: [], reviews: [], findings: [], blocker: null });
      // Beside the agreement, as spec-accepted records acceptance: every validation and assessment binds the agreement, so a link there
      // would stale them while work proceeds before readiness. specReviewed stays as it is; the link replaces that route while it exists.
      task.specReviewTaskId = id;
      resetClosing(state);
      break;
    }
    case 'start-task':
      requireCondition(state.status === 'running' && task.status !== 'complete' && !task.blocker, 'task-blocked', 'Task is not actionable');
      requireCondition(task.requires.every(id => taskById(state, id).status === 'complete'), 'dependency-blocked', 'An upstream task remains incomplete');
      task.status = 'active';
      resetClosing(state);
      break;
    case 'check':
      requireCondition(request.evidence && fresh(state.root, request.evidence.snapshot), 'stale-evidence', 'Verification inputs changed or are missing');
      task.checks.push({ ...request.evidence, ...(task.kind === 'closing' ? { progressBinding: structuredClone(task.progressBinding) } : {}) });
      break;
    case 'review': {
      const review = request.review;
      if (review?.relevance) {
        const original = task.reviews.find(candidate => candidate.requestId === review.relevance.requestId && !candidate.relevance);
        requireCondition(original && require('./applicability').identity(original) === review.relevance.originalHash && lineageOf(original) === lineageOf(review), 'foreign-assessment', 'Relevance binds the unchanged original assessment and originating lineage');
        require('./relevance').validateRelevanceReport({ ...review, coverage: [], applicability: review.applicability }, { relevance: review.relevance });
      }
      requireCondition(review?.snapshot && Array.isArray(review.snapshot.files) && hash(JSON.stringify(review.snapshot.files)) === review.snapshot.digest, 'invalid-review', 'Review needs its original input snapshot');
      // A replaced closing record hands its unsettled findings to the next one without their review, so the findings show the import too.
      requireCondition(!review.requestId || !task.reviews.some(previous => previous.requestId === review.requestId) && !task.findings.some(finding => finding.raisedBy?.requestId === review.requestId), 'duplicate-review', 'This assessment is already imported; reconcile its existing findings');
      requireCondition(review.session && review.session !== state.controller.session && review.attributionVerified === true, 'unattributed-review', 'Independent reviewer attribution is required');
      requireCondition(Array.isArray(review.findings) && Array.isArray(review.dimensions), 'invalid-review', 'Review must contain findings and coverage');
      const closing = task.kind === 'closing';
      if (closing) review.progressBinding = structuredClone(task.progressBinding);
      if (closing) {
        const outside = closingScopeFailure(task, review, state.status === 'complete');
        requireCondition(!outside, 'closing-scope', outside);
      }
      const revision = state.revision + 1;
      const previous = task.reviews.at(-1);
      const candidate = { ...review, revision };
      const kind = reviewKind(review, task);
      const siblings = kind === 'docs' ? docsCandidates(task, state, false) : leadEntries(task, state);
      const superseded = !review.relevance && latestReview([...siblings, { review: candidate, owner: task }], state).review !== candidate;
      // The closing record reviews edits made after triage, so recording it must never clear the closing evidence it follows. An
      // import is historical when its inputs no longer match, compared as its gate compares them.
      const historical = assessedChanges(state.root, review, kind, state, governingArtifacts([task], [review])).changedPaths?.length !== 0 || (!closing && !isDeepStrictEqual(review.commitments?.[task.id], commitmentsFor([task])[task.id]));
      // After triage, a clean current import its gate accepts leaves a completed task complete with its exemption and the closing evidence.
      const keepsClosing = !closing && Boolean(state.closing?.triageEvidence) && task.status === 'complete' && !review.relevance && !historical && !superseded && review.findings.length === 0
        && acceptableAssessment(candidate, task) && coversDimensions(candidate, kind);
      if (!closing && !review.relevance && !historical && !superseded && !keepsClosing && (task.status !== 'complete' || previous?.snapshot?.digest !== review.snapshot.digest || !isDeepStrictEqual(previous?.commitments, review.commitments))) resetClosing(state);
      task.reviews.push({ ...review, revision });
      const lineage = lineageOf(review) ?? null;
      for (const finding of review.findings) {
        text(finding.id, 'finding.id');
        text(finding.consequence, 'finding.consequence');
        text(finding.evidence, 'finding.evidence');
        const id = review.requestId ? `${review.requestId}:${finding.id}` : `${revision}:${finding.id}`;
        const relatedTo = task.findings.filter(existing => existing.localId === finding.id).map(existing => existing.id);
        task.findings.push({ ...finding, ...recordedSurfaces(finding, review, kind === 'spec'), ...(closing ? { progressBinding: structuredClone(task.progressBinding) } : {}), id, localId: finding.id, relatedTo, reviewRevision: revision, reviewKind: kind, reviewer: review.session, raisedBy: { requestId: review.requestId ?? null, lineage }, validation: null, disposition: null, repaired: false });
      }
      if (!review.relevance && !historical) recordClosures(task, review, lineage, revision);
      if (closing || keepsClosing || (review.relevance || historical || superseded) && review.findings.length === 0) break;
      if (historical || review.relevance || superseded) resetClosing(state);
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
      const validationCurrency = receiptCurrency(state.root, { kind: 'skeptic', snapshot: validation.snapshot, contextSnapshot: validation.snapshot }, [scopeOf(finding)]);
      requireCondition(validationCurrency.current, 'stale-validation', currencyRefusal('Skeptic evidence inputs', validationCurrency));
      validateSurfaceAnswers(savedSurfaces(finding), validation);
      const commitmentBinding = validation.commitmentBinding === undefined ? commitmentBindingFor(commitmentsFor(state.tasks)) : validation.commitmentBinding;
      requireCondition(evidenceCommitmentsCurrent(state, task, { ...validation, commitmentBinding }), 'stale-validation', 'Skeptic evidence must match current accepted commitments');
      requireCondition(validation.verdict !== 'confirmed' || typeof validation.repairProposal === 'string' && validation.repairProposal.trim(), 'missing-repair-proposal', 'A confirmed verdict carries the approach a repair would take');
      // A new verdict replaces the proposal with it and returns the finding to disposition; a pending closure is kept, because the
      // repair it waits on is still in the change.
      if (validation.dialogue) finding.dialogue = [...(finding.dialogue ?? []), { requestId: validation.requestId, session: validation.session, role: 'skeptic', commitmentBinding, message: validation.dialogue, verdict: validation.verdict, evidence: validation.evidence, revision: state.revision + 1 }];
      finding.validation = { ...validation, commitmentBinding };
      if (task.kind === 'closing') finding.validation.progressBinding = structuredClone(finding.progressBinding);
      finding.disposition = null;
      finding.repaired = false;
      delete finding.repairRevision;
      break;
    }
    case 'dialogue': {
      const reply = request.reply;
      requireCondition(reply, 'stale-dialogue', 'Dialogue evidence must match current inputs');
      const dialogueCurrency = receiptCurrency(state.root, reply, (reply.positions ?? []).map(position => scopeOf(task.findings.find(candidate => candidate.id === position.id))));
      requireCondition(dialogueCurrency.current, 'stale-dialogue', currencyRefusal('Dialogue evidence inputs', dialogueCurrency));
      const commitmentBinding = reply.commitmentBinding === undefined ? commitmentBindingFor(commitmentsFor(state.tasks)) : reply.commitmentBinding;
      requireCondition(evidenceCommitmentsCurrent(state, task, { ...reply, commitmentBinding }), 'stale-dialogue', 'Dialogue evidence must match current accepted commitments');
      requireCondition(Array.isArray(reply.positions) && reply.positions.length > 0, 'invalid-dialogue-reply', 'A dialogue reply answers the findings it names');
      for (const position of reply.positions) {
        const finding = task.findings.find(candidate => candidate.id === position.id);
        requireCondition(finding && finding.raisedBy?.lineage === reply.lineage, 'foreign-finding', 'A reviewer answers only findings its lineage raised');
        finding.dialogue = [...(finding.dialogue ?? []), { requestId: reply.requestId, session: reply.session, role: 'reviewer', commitmentBinding, message: reply.message, position: position.position, evidence: position.evidence, revision: state.revision + 1 }];
      }
      break;
    }
    case 'dispose': {
      const finding = task.findings.find(candidate => candidate.id === request.findingId);
      requireCondition(finding?.validation && finding.validation.verdict !== 'unverified', 'unvalidated-finding', 'Missing evidence is unresolved');
      const dispositionCurrency = receiptCurrency(state.root, { kind: 'skeptic', snapshot: finding.validation.snapshot, contextSnapshot: finding.validation.snapshot }, [scopeOf(finding)]);
      requireCondition(dispositionCurrency.current, 'stale-validation', currencyRefusal('Skeptic evidence inputs', dispositionCurrency));
      requireCondition(evidenceCommitmentsCurrent(state, task, finding.validation), 'stale-validation', 'Skeptic inputs or accepted commitments changed before disposition');
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
      Object.assign(finding, { obligation: request.obligation ?? null, disposition: request.disposition, reason: request.reason, route: request.route ?? null, dispositionRevision: state.revision + 1 });
      break;
    }
    case 'repair':
      requireCondition(Array.isArray(request.findingIds) && request.findingIds.length > 0, 'invalid-repair', 'Repair must name its findings');
      for (const id of request.findingIds) {
        const finding = task.findings.find(candidate => candidate.id === id);
        requireCondition(finding?.disposition === 'implement', 'unauthorized-repair', 'Repair requires a validated implement disposition');
        requireCondition(evidenceCommitmentsCurrent(state, task, finding.validation), 'stale-validation', 'A material commitment change requires current validation and repair authority');
        requireCondition(typeof finding.validation?.repairProposal === 'string' && finding.validation.repairProposal.trim(), 'repair-proposal-required', 'A repair needs the skeptic\'s recorded repair proposal; obtain one through a dialogue turn with the skeptic before editing');
      }
      for (const id of request.findingIds) {
        const finding = task.findings.find(candidate => candidate.id === id);
        // The reviewer that raised the finding, or its replacement, must verify the repair before any gate passes.
        Object.assign(finding, { repaired: true, repairRevision: state.revision + 1, pendingClosure: { lineage: finding.raisedBy?.lineage ?? null, requestId: finding.raisedBy?.requestId ?? null, revision: state.revision + 1, ...(task.kind === 'closing' ? { progressBinding: structuredClone(finding.progressBinding) } : {}) } });
      }
      task.lastRepair = { revision: state.revision + 1, kinds: [...new Set(request.findingIds.map(id => findingKind(task.findings.find(candidate => candidate.id === id), task)))] };
      // Closing repairs are tracking edits after triage; they need a further closing review, not reopened tasks or new closing evidence.
      if (task.kind === 'closing') break;
      task.stage = 'review';
      task.status = 'active';
      resetClosing(state);
      delete task.docsExemption;
      if (task.resumeStage) task.resumeStage = task.kind === 'lore' ? 'retrospective' : 'documentation';
      break;
    case 'advance': {
      if (isReviewContext(state) && request.docsExemption !== undefined) {
        requireCondition(task.kind === 'docs' && !task.reviews.some(review => reviewKind(review, task) === 'docs'), 'invalid-exemption', 'Only a standalone docs revision without a docs assessment can record a mechanical exemption');
      }
      if (isReviewContext(state) && task.stage !== 'implementation') {
        if (request.docsExemption !== undefined) task.docsExemption = { reason: text(request.docsExemption, 'docsExemption'), snapshot: inventorySnapshot(state.root), revision: state.revision + 1 };
        requireStandaloneAssessment(state, task);
        text(request.evidence, 'revision.evidence');
        task.revisionEvidence = request.evidence;
        task.stage = 'complete';
        task.status = 'complete';
        break;
      }
      const stages = task.kind === 'lore' ? ['review', 'retrospective', 'complete'] : ['implementation', 'review', 'documentation', 'complete'];
      const current = stages.indexOf(task.stage);
      requireCondition(current >= 0 && current < stages.length - 1, 'invalid-stage', 'Task cannot advance');
      if (task.stage === 'implementation' && task.kind === 'code') {
        if (!verificationGate(state.root, task)) requireCondition(false, 'verification-required', verificationRefusal(state.root, [task], 'Implementation requires current passing verification for each named check'));
      }
      if (task.stage === 'review') {
        if (requiresReview(task)) requireReviewGate(state.root, task, state, 'A complete strong broad assessment and resolved findings are required');
        // A docs review loop leaves the review stage only once its own latest docs review is current and resolved.
        if (task.reviews.some(review => reviewKind(review, task) === 'docs')) {
          const failure = docsReviewFailure(state.root, task, state);
          requireCondition(failure === null, 'docs-review-required', failure === null ? '' : docsRefusal(state.root, task, state, failure, 'A complete strong docs review and resolved docs findings are required'));
        }
        requireCondition(unresolvedFindings(task).length === 0, 'review-required', 'Every finding needs a skeptic verdict, a disposition, any implemented repair and that repair\'s closure by the reviewer that raised it before leaving review');
        // A completed task returns from review straight to completion, skipping the documentation stage that holds its docs gate.
        if (task.resumeStage === 'complete') requireDocsGate(state.root, task, state, 'A reopened task completes again only with a current independent docs review covering it; the import cleared any mechanical exemption');
      }
      if (['documentation', 'retrospective'].includes(task.stage)) {
        if (requiresReview(task)) requireReviewGate(state.root, task, state, 'Reviewed work needs current cumulative assessment and applicable verification before task completion');
        if (!verificationGate(state.root, task)) requireCondition(false, 'verification-required', verificationRefusal(state.root, [task], 'Every registered check must pass on current inputs before task completion'));
        text(request.evidence, `${task.stage}.evidence`);
        if (request.docsExemption !== undefined) {
          requireCondition(state.docsGate && sharesCumulativeAssessment(task), 'invalid-exemption', 'Only a code or docs task of a run with the docs gate can record a mechanical exemption');
          task.docsExemption = { reason: text(request.docsExemption, 'docsExemption'), snapshot: inventorySnapshot(state.root), revision: state.revision + 1 };
        }
        requireDocsGate(state.root, task, state, 'Task completion needs a current independent docs review of the complete change, or a recorded mechanical exemption for a purely mechanical change');
      }
      const internalSpec = task.kind === 'spec' && state.tasks.some(owner => owner.kind === 'code' && linkValues(owner).includes(task.id));
      const refreshingCompleted = task.stage === 'review' && task.resumeStage === 'complete';
      // Older lore repairs persisted documentation as their resume target.
      const resumeStage = task.kind === 'lore' && task.resumeStage === 'documentation' ? 'retrospective' : task.resumeStage;
      const nextStage = task.stage === 'review' && internalSpec ? 'complete' : task.stage === 'review' && resumeStage ? resumeStage : stages[current + 1];
      // Spec readiness holds only completion, on both completing paths; everything before it proceeds.
      if (nextStage === 'complete') requireSpecReadiness(state, [task], 'Code task completion requires its governing spec to be ready');
      task[task.stage + 'Evidence'] = request.evidence ?? null;
      task.stage = nextStage;
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
        // A code task's amendment reopens the spec task that governs it, linked or queued, and never a structural link's target; a task
        // of another kind keeps the earlier effect on the task its agreement links.
        const spec = task.kind === 'code' ? resolveGovernance(state.root, state.tasks).get(task.id)?.specTask : state.tasks.find(candidate => candidate.id === task.agreement.specReviewTaskId);
        if (spec) {
          spec.agreement.decisions = [...(spec.agreement.decisions ?? []), request.evidence];
          spec.requirementsRevision = state.revision + 1;
          spec.status = 'pending';
          spec.stage = 'implementation';
        }
        if (task.agreement.spec && (task.kind === 'code' || !spec)) task.agreement.specReviewed = false;
        // Renewed after every spec-task change, since the scope hash covers a queued spec task.
        require('./acknowledgement').renewAcknowledgement(state, state.revision + 1, new Date().toISOString());
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
      state.closing.progressBindings ??= { retrospective: null, report: null, delivery: null, triage: null };
      state.closing.progressBindings.report = structuredClone(state.closing.progressBindings.retrospective);
      // A replaced report has not been delivered.
      state.closing.reportDelivery = null;
      state.closing.progressBindings.delivery = null;
      break;
    case 'report-delivered': {
      const evidence = state.handover && state.closing?.reportEvidence;
      requireCondition(evidence, 'report-required', 'Record the morning report before its delivery');
      text(request.authority, 'report-delivered.authority');
      requireCondition(reportIsCurrent(state.root, evidence), 'report-stale', 'The saved morning report is missing or changed; rewrite it and record the report again');
      if (!validReportDelivery(state, evidence.sha256)) {
        const owner = request.actor === undefined || state.controller.session === request.actor.session && state.controller.host === request.actor.host;
        state.closing.reportDelivery = { authority: request.authority, revision: state.revision + 1, sha256: evidence.sha256, ...(owner ? {} : { recordedBy: { host: request.actor.host, session: request.actor.session } }) };
        state.closing.progressBindings ??= { retrospective: null, report: null, delivery: null, triage: null };
        state.closing.progressBindings.delivery = structuredClone(state.closing.progressBindings.report);
      }
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
      state.closing.progressBindings ??= { retrospective: null, report: null, delivery: null, triage: null };
      state.closing.progressBindings.triage = structuredClone(state.closing.progressBindings.retrospective);
      // Re-recorded triage starts a new closing record, so a closing review always follows the triage whose tracking edits it covers;
      // closing findings not yet settled or still pending closure move into it and must still be resolved there.
      if (state.docsGate) {
        const carried = carriedFindings(state);
        state.closing.docs = closingRecord(nextTriageBaseline(state.root, state), state.closing.progressBindings.triage);
        state.closing.docs.findings.push(...carried);
        delete state.closing.carriedBaseline;
        delete state.closing.carriedFindings;
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
      delete state.hold;
      if (!isReviewContext(state)) transition(state, { action: 'invalidate-continuation', reason: 'Resumption requires a current observation of the host continuation mechanism' });
      break;
    case 'claim-controller':
      requireCondition(request.claim && isDeepStrictEqual(request.claim.controller, state.controller), 'invalid-controller-claim', 'A claim must be observed for the current controller');
      state.controllerClaim = request.claim;
      break;
    case 'invalidate-continuation': {
      invalidateContinuation(state, request.reason);
      break;
    }
    case 'continuation':
      state.continuation = continuationForRequest(state, request.mechanism, integration);
      break;
    case 'handover':
      text(request.authority, 'handover.authority');
      if (request.mechanism !== undefined) {
        // The mechanism travels with the handover so an earlier verified flag is never reused as proof, and one write leaves no partial transition.
        state.continuation = continuationForRequest(state, request.mechanism, integration);
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
      const { overlaps, assertWorkerWriteScope, requireOwnershipPath } = require('./project-ownership');
      worker.writes.forEach(target => requireOwnershipPath(state.root, target));
      requireCondition(!['reviewer', 'skeptic', 'peer', 'supervisor'].includes(worker.role) || worker.writes.length === 0, 'reviewer-write', 'Only assigned implementers can own project writes');
      if (isReviewContext(state) && worker.writes.length > 0) require('./review-context').assertRepairScope(state.root, state.controller, state, worker.writes);
      assertWorkerWriteScope(state, worker);
      // A worker declaring no writes stays registrable while another worker's reservation awaits reconciliation.
      for (const other of worker.writes.length > 0 ? state.workers.filter(workerIsActive) : []) {
        other.writes.forEach(owned => requireOwnershipPath(state.root, owned, 'writer-state-unavailable'));
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
    case 'hold':
      text(request.authority, 'hold.authority');
      text(request.reason, 'hold.reason');
      state.status = 'stopped';
      state.hold = { authority: request.authority, reason: request.reason, revision: state.revision + 1 };
      break;
    case 'stop':
      text(request.reason, 'stop.reason');
      requireCondition(['user-stop', 'resource-limit'].includes(request.kind), 'invalid-stop', 'A stop requires an explicit stop or exhausted resource limit');
      state.status = 'stopped';
      state.stop = { kind: request.kind, reason: request.reason };
      break;
    case 'complete': {
      requireCondition(state.tasks.every(candidate => candidate.status === 'complete'), 'unfinished-work', 'Queue still has incomplete work');
      requireCondition(state.workers.every(worker => !workerIsActive(worker)), 'active-workers', 'Workers remain active');
      if (isReviewContext(state)) {
        for (const target of state.tasks) requireStandaloneAssessment(state, target);
        state.status = 'complete';
        break;
      }
      requireSpecReadiness(state, state.tasks, 'Run completion requires every governing spec to be ready');
      // Checked first, because the closing record's own findings and checks hold completion whatever else is current.
      if (closingRecordFailure(state.root, state) !== null) {
        const record = state.closing.docs;
        const checks = checkFailures(state.root, record);
        const otherCauses = closingRecordFailure(state.root, state, { ignoreChecks: true }) !== null;
        requireCondition(false, 'closing-review-unresolved', `The closing docs review is unresolved:${checks.length > 0 ? ` ${record.id}: ${namedChecks(checks)}.` : ''}${otherCauses ? ' Its latest review is not a complete strong docs assessment covering all five dimensions, a finding is unsettled or a repair postdates its latest review' : ''}`);
      }
      // Without a closing record, the missing triage evidence refuses completion below.
      const hold = state.closing?.docs ? outsideDocumentationHold(state.root, state) : null;
      requireCondition(hold === null, 'closing-review-required', hold === null ? '' : outsideDocumentationRefusal(state.root, state, hold));
      const coverage = closingCoverageFailure(state.root, state);
      requireCondition(coverage === null, 'closing-review-required', CLOSING_COVERAGE[coverage]);
      // Closing findings already fail the closing record above; this also names task findings and any carried across a reset record.
      const pending = pendingClosures(state).map(finding => finding.id);
      requireCondition(pending.length === 0, 'closure-pending', `Each repaired finding needs closure by the reviewer that raised it or its replacement. Pending: ${pending.join(', ')}`);
      const gateFailures = state.tasks.filter(requiresReview).map(candidate => ({ candidate, cause: reviewGateCause(state.root, candidate, state) })).filter(entry => entry.cause !== null);
      if (gateFailures.length > 0) {
        const stale = cause => ['changed-inputs', 'changed-commitments', 'unestablished'].includes(cause.kind);
        const failed = ({ candidate, cause }) => causeText(candidate, cause) + (stale(cause) ? ` (way forward: ${staleWayForward(state.root, state, candidate, leadEntry(candidate, state))})` : '');
        requireCondition(false, gateFailures.every(entry => entry.cause.kind === 'check') ? 'verification-required' : 'stale-review', `Final reviewed inputs changed or their gates are unmet. ${gateFailures.map(failed).join('; ')}`);
      }
      const undocumented = state.tasks.map(candidate => ({ candidate, failure: docsGateFailure(state.root, candidate, state) })).filter(entry => entry.failure !== null);
      requireCondition(undocumented.length === 0, 'docs-review-required', `Every code and docs task needs a current independent docs review or a fresh mechanical exemption; tracking edits after triage need a current closing docs review. Missing for: ${undocumented.map(entry => causeText(entry.candidate, docsCause(state.root, entry.candidate, state, entry.failure)) + (entry.failure === 'stale' ? ` (way forward: ${staleWayForward(state.root, state, entry.candidate, latestReview(docsCandidates(entry.candidate, state, false), state))})` : '')).join('; ')}`);
      if (!state.tasks.every(candidate => verificationGate(state.root, candidate))) requireCondition(false, 'verification-required', verificationRefusal(state.root, state.tasks, 'Every registered check must pass on current inputs before final acceptance'));
      const scratch = scratchFailure(state.root, state.baseSha ?? null);
      requireCondition(scratch === null, 'committed-scratch', scratch);
      requireCondition(state.closing?.retrospectiveEvidence && state.closing?.triageEvidence, 'closing-required', 'Complete session retrospective and follow-up triage before final acceptance');
      // Checked here as well as at triage: a handover can arrive after triage was already recorded.
      requireCondition(reportSatisfied(state), 'report-required', 'A handed-over run records its morning report before final acceptance');
      state.status = 'complete';
      break;
    }
    default:
      requireCondition(false, 'invalid-request', unknownActionMessage(request.action));
  }
  require('./discharge').admittedAction(state, request, dischargeBefore);
}

module.exports = { causeText, docsCause, reviewGateCause, staleCause, DIMENSIONS, acceptableAssessment, assertAction, closingStage, commitmentBindingFor, commitmentsFor, completeAssessment, findingKind, historicalDischarge, isDocumentationPath, latestChecks, leadEntry, obligationBrief, reportNotice, reportStatus, reviewGate, reviewGateFailure, reviewProgress, sameClosingRecord, settled, sharesCumulativeAssessment, staleWayForward, targetById, taskById, transition, unresolvedFindings };
