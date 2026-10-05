'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { workerIsActive } = require('./workers');
const { isDeepStrictEqual } = require('node:util');

const { requireCondition, text } = require('./store');
const { changedPaths, fileSha256, fresh, hash, inventorySnapshot, outsideGitWorktree, projectFile, projectInventory, snapshot } = require('./evidence');
const { exhaustedLimit } = require('./limits');
const { CLOSING_TARGET, unknownActionMessage } = require('./actions');
const { latestDispatchOf, lineageOf } = require('./continuation');
const { scratchFailure, scratchStatus } = require('./scratch');

const DIMENSIONS = Object.freeze({
  spec: ['intent-scope-acceptance', 'soundness-integration', 'failure-safety-recovery', 'clarity-consistency-proportionality'],
  code: ['requirements-ux', 'correctness-integration', 'security-data-safety', 'design-maintainability', 'performance-resources', 'tests-evidence'],
  docs: ['claim-accuracy', 'sweep-completeness', 'backlog-conventions', 'sibling-consistency', 'proportionality'],
});

const REPORT_DIRECTORY = '.nightshift/runs/reports/';

// Documentation a docs review alone covers: the Nightshift backlog (the four indexes, their history files and the record
// directories), Nightshift's durable reports, and Markdown files at the project root other than host instruction files. Only
// these paths can be relieved from code reassessment by a docs review, and a closing review covers edits to them alone.
// Governing specs, operating instructions, Markdown below the root and every other file stay under code assessment.
const BACKLOG_FILES = Object.freeze(['.nightshift/FEATURES.md', '.nightshift/BUGS.md', '.nightshift/QUICK_WINS.md', '.nightshift/PATTERNS.md', '.nightshift/FEATURES_HISTORY.md', '.nightshift/BUGS_HISTORY.md', '.nightshift/QUICK_WINS_HISTORY.md']);
const DOCUMENTATION_DIRECTORIES = Object.freeze(['.nightshift/features/', '.nightshift/bugs/', '.nightshift/patterns/', '.nightshift/reports/']);
// The hosts load these as operating instructions; matched case-insensitively, as Windows resolves them.
const HOST_INSTRUCTION_FILES = new Set(['agents.md', 'agents.override.md', 'claude.md', 'claude.local.md']);

function isRootDocumentation(file) {
  const name = file.toLowerCase();
  return !name.includes('/') && name.endsWith('.md') && !HOST_INSTRUCTION_FILES.has(name);
}

function isDocumentationPath(file) {
  return BACKLOG_FILES.includes(file) || DOCUMENTATION_DIRECTORIES.some(directory => file.startsWith(directory)) || isRootDocumentation(file);
}

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

function closingRecord(baseline) {
  return { id: CLOSING_TARGET, kind: 'closing', baseline, reviews: [], findings: [], checks: [], probeEvidence: [] };
}

// The project inventory at triage, against which a closing review must show documentation-only changes. An empty inventory is an
// empty baseline. When Git cannot inventory the project, only a project positively outside Git gets a baseline, read from its
// documentation files on disk, so completion can still tell whether tracking edits followed; otherwise null, which fails closed.
function triageBaseline(root) {
  try {
    if (projectInventory(root).length === 0) return { digest: hash(JSON.stringify([])), files: [], inventory: true, excludedPaths: [], includedPaths: [] };
    return inventorySnapshot(root);
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

function latestReview(entries) {
  return [...entries].sort((left, right) => (right.review.revision ?? 0) - (left.review.revision ?? 0))[0];
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

// Clearing closing evidence keeps the latest closing baseline, so the next triage can still tell whether tracking edits since it were
// reviewed, and keeps the closing findings that still owe something, which the next closing record takes over.
function resetClosing(state) {
  const baseline = state.closing?.docs ? state.closing.docs.baseline : state.closing?.carriedBaseline;
  const carried = carriedFindings(state);
  state.closing = { retrospectiveEvidence: null, reportEvidence: null, reportDelivery: null, triageEvidence: null, ...(baseline ? { carriedBaseline: baseline } : {}), ...(carried.length ? { carriedFindings: carried } : {}) };
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

// A completed strong independent assessment with broad evidenced coverage; a failed or partial one never counts. Neither does a
// continued one: a resumed or replacement reviewer verifies repairs and can raise findings, but only a fresh assessment passes a gate.
function completeAssessment(review) {
  return Boolean(review) && !review.continues && review.status === 'complete' && review.strength === 'strong' && review.independent === true && review.broad === true && Boolean(review.coverageEvidence?.trim());
}

function acceptableAssessment(review, task) {
  if (task.requirementsRevision !== undefined && (review?.revision ?? -1) < task.requirementsRevision) return false;
  if (!isDeepStrictEqual(review?.commitments?.[task.id], commitmentsFor([task])[task.id])) return false;
  return completeAssessment(review);
}

// The assessment a task's lead gate reads, with its owner: the latest of the task's own lead-kind assessments and, between tasks that
// share the cumulative assessment, the code reviews of other tasks that cover it.
function leadEntry(task, state) {
  const lead = leadKind(task);
  const entries = state
    ? state.tasks.flatMap(owner => owner.reviews
      .filter(review => owner.id === task.id ? reviewKind(review, owner) === lead : sharesCumulativeAssessment(task) && sharesCumulativeAssessment(owner) && review.kind === 'code' && review.coveredTaskIds?.includes(task.id))
      .map(review => ({ review, owner })))
    : task.reviews.filter(review => reviewKind(review, task) === lead).map(review => ({ review, owner: task }));
  return latestReview(entries);
}

// Returns null when the gate holds, 'stale' when the latest otherwise acceptable assessment no longer matches current inputs, and 'unmet' otherwise.
// Each gate counts only the findings and repairs of its own kind; a docs repair reaches this gate only through the files it changed.
function reviewGateFailure(root, task, state) {
  const lead = leadKind(task);
  const review = leadEntry(task, state)?.review;
  if (!acceptableAssessment(review, task)) return 'unmet';
  if (!fresh(root, review.snapshot) && !documentationRelief(root, task, state, review)) return 'stale';
  if (!DIMENSIONS[lead].every(dimension => review.dimensions.includes(dimension))) return 'unmet';
  if (!verificationGate(root, task)) return 'unmet';
  const findings = task.findings.filter(finding => findingKind(finding, task) === lead);
  if (!findings.every(settled) || findings.some(finding => finding.pendingClosure)) return 'unmet';
  if (state && state.tasks.flatMap(owner => owner.findings).some(finding => finding.reviewRevision === review.revision && (!settled(finding) || finding.pendingClosure))) return 'unmet';
  return findings.some(finding => finding.repaired && finding.repairRevision >= review.revision) ? 'unmet' : null;
}

function reviewGate(root, task, state) {
  return reviewGateFailure(root, task, state) === null;
}

// A code assessment stale only because documentation paths changed counts as current once a current docs review covers the task.
// Lore tasks gain this only from the closing docs review, since task-level docs reviews never cover them; a governing spec never gains it.
function documentationRelief(root, task, state, review) {
  if (!state || task.kind === 'spec' || review.snapshot?.inventory !== true) return false;
  const changed = changedPaths(root, review.snapshot);
  if (!changed || !changed.every(isDocumentationPath)) return false;
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
function closingRecordFailure(root, state) {
  const record = state.closing?.docs;
  if (!record) return null;
  const latest = latestReview(record.reviews.map(review => ({ review })))?.review;
  if (latest && (!completeAssessment(latest) || !DIMENSIONS.docs.every(dimension => latest.dimensions.includes(dimension)))) return 'unmet';
  if (!record.findings.every(settled) || record.findings.some(finding => finding.pendingClosure)) return 'unmet';
  if (record.findings.some(finding => finding.repaired && finding.repairRevision >= (latest?.revision ?? Infinity))) return 'unmet';
  return verificationGate(root, record) ? null : 'unmet';
}

const CLOSING_COVERAGE = Object.freeze({
  unreviewed: 'Changes since triage need a current, complete and resolved closing docs review',
  'outside-git': 'Documentation changed after triage in a project outside Git, where no independent review can be dispatched; revert those tracking edits, or make them in a Git worktree where a closing docs review can cover them',
  'no-baseline': 'The changes since triage cannot be established; record triage again once Git can inspect the project',
});

// Why completion lacks closing coverage, as a CLOSING_COVERAGE key, or null when it holds. Anything changed since triage needs a
// current resolved closing review, whether or not a task gate depends on it. A baseline read from disk belongs to a project outside
// Git, where no review can be dispatched, so any documentation change there fails closed; a missing or unreadable baseline fails closed too.
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

// Closures in a complete report of a continued lead end the pending closure of each finding of its lineage it records closed; an
// incomplete report's closures are not recorded. Every recorded closure stays on its finding as evidence.
function recordClosures(target, review, lineage, revision) {
  if (!review.continues || review.status !== 'complete') return;
  for (const closure of review.closures ?? []) {
    const finding = target.findings.find(candidate => candidate.id === closure.id);
    if (finding?.pendingClosure?.lineage !== lineage) continue;
    finding.closures = [...(finding.closures ?? []), { requestId: review.requestId, closed: closure.closed, evidence: closure.evidence, revision }];
    if (closure.closed) delete finding.pendingClosure;
  }
}

function latestByKind(owner) {
  const latest = new Map();
  for (const review of [...owner.reviews].sort((left, right) => (left.revision ?? 0) - (right.revision ?? 0))) latest.set(reviewKind(review, owner), review);
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
  const outdated = (failure, entry) => Boolean(entry) && (failure === 'stale' || !acceptableAssessment(entry.review, task) && !fresh(root, entry.review.snapshot));
  return [[reviewGateFailure(root, task, state), leadEntry(task, state)], [docsReviewFailure(root, task, state), latestReview(docsCandidates(task, state, false))]]
    .filter(([failure, entry]) => outdated(failure, entry))
    .map(([, entry]) => entry);
}

// What a target's review needs next, in order: validation and disposition, then repairs, then closures by resuming the reviewers that
// raised the repaired findings, then a fresh assessment of each kind whose latest assessment is a continued one. resumeTargets names
// the dispatch to resume, and the task it belongs to, for each lineage owing closures and, after a task's repair, for each latest
// assessment of another review kind, of this or any other task, that predates the repair and no longer matches current inputs: one
// its gate accepts and finds stale, or any other whose reviewed inputs changed. The raising reviewers reassess their own kinds, and a
// closing repair reopens no task, so neither adds stale targets. Stale targets depend on freshness: a lightweight brief marks them
// unevaluated.
function reviewProgress(root, state, target, options = {}) {
  const findings = target.findings;
  const latest = latestByKind(target);
  const freshDue = [...latest].filter(([, review]) => review.continues).map(([kind]) => kind);
  const owing = [...new Set(findings.filter(finding => finding.pendingClosure).map(finding => finding.pendingClosure.lineage))];
  const resumeTargets = owing.map(lineage => ({ requestId: latestDispatchOf(root, state, target, lineage), taskId: target.id, lineage, reason: 'pending-closure' }));
  const repair = target.kind === 'closing' ? null : latestRepair(target);
  const evaluateStale = repair !== null && repair.revision >= 0;
  if (evaluateStale && options.verifyFreshness !== false) {
    for (const task of [target, ...state.tasks.filter(task => task.id !== target.id)]) {
      for (const { review, owner } of staleGateEntries(root, task, state)) {
        const lineage = lineageOf(review);
        if (owing.includes(lineage) || repair.kinds.includes(reviewKind(review, owner)) || (review.revision ?? 0) >= repair.revision) continue;
        // A covering assessment can be what several tasks' gates read; it is resumed once.
        if (resumeTargets.some(item => item.lineage === lineage)) continue;
        resumeTargets.push({ requestId: latestDispatchOf(root, state, owner, lineage), taskId: owner.id, lineage, reason: 'stale-after-repair' });
      }
    }
  }
  const next = findings.some(finding => !finding.validation || finding.validation.verdict === 'unverified' || !finding.disposition) ? 'validate-and-dispose'
    : findings.some(finding => finding.disposition === 'implement' && !finding.repaired) ? 'repair'
      : owing.length > 0 ? 'resume'
        : freshDue.length > 0 ? 'fresh-assessment' : null;
  return { next, resumeTargets, freshDue, ...(evaluateStale && options.verifyFreshness === false ? { staleTargets: 'reconcile at acceptance' } : {}) };
}

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
    scratch: options.verifyFreshness === false ? 'reconcile at acceptance' : scratchStatus(root, state.baseSha ?? null),
    resourceMode: state.resourceMode ?? 'legacy', resources: state.resources ?? null,
    executionResources: require('../releases/entry').executionResources(state), controllerClaim: state.controllerClaim ?? null, adoption: state.adoption ?? null,
    next: ready.map(task => ({
      id: task.id, title: task.title,
      stage: options.verifyFreshness !== false && !specReady(state, task) ? 'governing-spec-review' : task.stage,
      agreement: { source: task.agreement.source, outcome: task.agreement.outcome, decisions: task.agreement.decisions, spec: task.agreement.spec, specReviewTaskId: task.agreement.specReviewTaskId },
      ...(typeof task.agreement.spec === 'string' ? { specAcceptance: specAcceptanceStatus(root, task, options) } : {}),
      unresolvedFindings: unresolvedFindings(task).map(finding => ({ id: finding.id, consequence: finding.consequence, verdict: finding.validation?.verdict ?? null, disposition: finding.disposition, pendingClosure: Boolean(finding.pendingClosure), evidence: finding.evidence.slice(0, 600) })),
      review: reviewProgress(root, state, task, options),
      reviewCurrent: options.verifyFreshness === false ? 'reconcile at acceptance' : reviewGate(root, task, state),
      ...(state.docsGate && sharesCumulativeAssessment(task) ? { docsReviewCurrent: options.verifyFreshness === false ? 'reconcile at acceptance' : docsGateFailure(root, task, state) === null } : {}),
    })),
    // An exemption is recorded as its task completes, so it is listed for every task rather than only for work still ahead.
    ...(state.docsGate ? { docsExemptions: state.tasks.filter(task => task.docsExemption).map(task => ({ taskId: task.id, reason: task.docsExemption.reason, revision: task.docsExemption.revision, current: options.verifyFreshness === false ? 'reconcile at acceptance' : fresh(root, task.docsExemption.snapshot) })) } : {}),
    finalReconciliationPending: state.status === 'running' && active.length === 0,
    closing: { ready: closingReady(state), stage: closingStage(state), ...(state.closing?.docs ? { docsReview: closingDocsBrief(state, root, options) } : {}), ...(state.closing?.carriedFindings?.length ? { carriedFindings: state.closing.carriedFindings.map(finding => finding.id) } : {}) },
    blockers: active.filter(task => task.blocker).map(task => ({ id: task.id, blocker: task.blocker })),
    workers: state.workers.filter(workerIsActive),
    followups: state.followups.filter(item => item.status !== 'resolved'),
    rules: `Continue authorized independent work and recovery. Every repair needs cumulative strong broad review: resume the reviewer that raised each repaired finding to record its closure, and pass a gate only on a fresh assessment. Validate every finding with a fresh skeptic before disposition. Preserve writer ownership. Update documentation and obtain its independent docs review, then retrospective, then follow-up triage; a handed-over run records its morning report before triage. Tracking edits after triage stay within the backlog and the other documentation a docs review alone covers, and need a closing docs review (task ${CLOSING_TARGET}) before completion. Missing or stale evidence is incomplete. Publication requires authority. Reconcile this record with actual files after compaction.`,
  };
}

function closingDocsBrief(state, root, options) {
  const record = state.closing.docs;
  const latest = latestReview(record.reviews.map(review => ({ review })))?.review;
  return {
    target: CLOSING_TARGET, baseline: Boolean(record.baseline), reviews: record.reviews.length,
    unresolvedFindings: record.findings.filter(finding => !settled(finding) || finding.pendingClosure).map(finding => finding.id),
    review: reviewProgress(root, state, record, options),
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

// Each changed path since the triage baseline, apart from user-owned files the review excluded, must be documentation a docs review covers.
function closingScopeFailure(root, record, review) {
  if (!record.baseline) return 'This closing record has no triage baseline, so a closing review cannot establish that only documentation paths changed';
  const excluded = new Set(review.contextSnapshot?.excludedPaths ?? []);
  const changed = changedPaths(root, record.baseline);
  if (!changed) return 'The difference from the triage baseline cannot be established';
  const outside = changed.filter(file => !excluded.has(file) && !isDocumentationPath(file));
  return outside.length === 0 ? null : `A closing review covers edits to the backlog, .nightshift/reports and root Markdown other than host instruction files only; these paths changed outside them since triage: ${outside.slice(0, 20).join(', ')}`;
}

function assertAction(state, request) {
  const taskActions = ['start-task', 'add-spec-review', 'check', 'dispatch', 'probe', 'review', 'validate', 'dialogue', 'dispose', 'repair', 'advance', 'block', 'unblock', 'spec-accepted'];
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
      // A replaced closing record hands its unsettled findings to the next one without their review, so the findings show the import too.
      requireCondition(!review.requestId || !task.reviews.some(previous => previous.requestId === review.requestId) && !task.findings.some(finding => finding.raisedBy?.requestId === review.requestId), 'duplicate-review', 'This assessment is already imported; reconcile its existing findings');
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
      const lineage = lineageOf(review) ?? null;
      for (const finding of review.findings) {
        text(finding.id, 'finding.id');
        text(finding.consequence, 'finding.consequence');
        text(finding.evidence, 'finding.evidence');
        const id = review.requestId ? `${review.requestId}:${finding.id}` : `${revision}:${finding.id}`;
        const relatedTo = task.findings.filter(existing => existing.localId === finding.id).map(existing => existing.id);
        task.findings.push({ ...finding, id, localId: finding.id, relatedTo, reviewRevision: revision, reviewKind: reviewKind(review, task), reviewer: review.session, raisedBy: { requestId: review.requestId ?? null, lineage }, validation: null, disposition: null, repaired: false });
      }
      recordClosures(task, review, lineage, revision);
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
      requireCondition(validation.verdict !== 'confirmed' || typeof validation.repairProposal === 'string' && validation.repairProposal.trim(), 'missing-repair-proposal', 'A confirmed verdict carries the approach a repair would take');
      // A new verdict replaces the proposal with it and returns the finding to disposition; a pending closure is kept, because the
      // repair it waits on is still in the change.
      if (validation.dialogue) finding.dialogue = [...(finding.dialogue ?? []), { requestId: validation.requestId, session: validation.session, role: 'skeptic', message: validation.dialogue, verdict: validation.verdict, evidence: validation.evidence, revision: state.revision + 1 }];
      finding.validation = validation;
      finding.disposition = null;
      finding.repaired = false;
      delete finding.repairRevision;
      break;
    }
    case 'dialogue': {
      const reply = request.reply;
      requireCondition(reply && fresh(state.root, reply.snapshot), 'stale-dialogue', 'Dialogue evidence must match current inputs');
      requireCondition(Array.isArray(reply.positions) && reply.positions.length > 0, 'invalid-dialogue-reply', 'A dialogue reply answers the findings it names');
      for (const position of reply.positions) {
        const finding = task.findings.find(candidate => candidate.id === position.id);
        requireCondition(finding && finding.raisedBy?.lineage === reply.lineage, 'foreign-finding', 'A reviewer answers only findings its lineage raised');
        finding.dialogue = [...(finding.dialogue ?? []), { requestId: reply.requestId, session: reply.session, role: 'reviewer', message: reply.message, position: position.position, evidence: position.evidence, revision: state.revision + 1 }];
      }
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
      Object.assign(finding, { obligation: request.obligation ?? null, disposition: request.disposition, reason: request.reason, route: request.route ?? null, dispositionRevision: state.revision + 1 });
      break;
    }
    case 'repair':
      requireCondition(Array.isArray(request.findingIds) && request.findingIds.length > 0, 'invalid-repair', 'Repair must name its findings');
      for (const id of request.findingIds) {
        const finding = task.findings.find(candidate => candidate.id === id);
        requireCondition(finding?.disposition === 'implement', 'unauthorized-repair', 'Repair requires a validated implement disposition');
        requireCondition(typeof finding.validation?.repairProposal === 'string' && finding.validation.repairProposal.trim(), 'repair-proposal-required', 'A repair needs the skeptic\'s recorded repair proposal; obtain one through a dialogue turn with the skeptic before editing');
      }
      for (const id of request.findingIds) {
        const finding = task.findings.find(candidate => candidate.id === id);
        // The reviewer that raised the finding, or its replacement, must verify the repair before any gate passes.
        Object.assign(finding, { repaired: true, repairRevision: state.revision + 1, pendingClosure: { lineage: finding.raisedBy?.lineage ?? null, requestId: finding.raisedBy?.requestId ?? null, revision: state.revision + 1 } });
      }
      task.lastRepair = { revision: state.revision + 1, kinds: [...new Set(request.findingIds.map(id => findingKind(task.findings.find(candidate => candidate.id === id), task)))] };
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
        requireCondition(unresolvedFindings(task).length === 0, 'review-required', 'Every finding needs a skeptic verdict, a disposition, any implemented repair and that repair\'s closure by the reviewer that raised it before leaving review');
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
      // Re-recorded triage starts a new closing record, so a closing review always follows the triage whose tracking edits it covers;
      // closing findings not yet settled or still pending closure move into it and must still be resolved there.
      if (state.docsGate) {
        const carried = carriedFindings(state);
        state.closing.docs = closingRecord(nextTriageBaseline(state.root, state));
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
      // Checked first, because an unresolved closing review also withholds the documentation relief the gates below depend on.
      requireCondition(closingRecordFailure(state.root, state) === null, 'closing-review-unresolved', 'The closing docs review is unresolved: its latest review is not a complete strong docs assessment covering all five dimensions, a finding is unsettled, a repair postdates its latest review or a check fails');
      const coverage = closingCoverageFailure(state.root, state);
      requireCondition(coverage === null, 'closing-review-required', CLOSING_COVERAGE[coverage]);
      // Closing findings already fail the closing record above; this also names task findings and any carried across a reset record.
      const pending = pendingClosures(state).map(finding => finding.id);
      requireCondition(pending.length === 0, 'closure-pending', `Each repaired finding needs closure by the reviewer that raised it or its replacement. Pending: ${pending.join(', ')}`);
      requireCondition(state.tasks.every(candidate => !requiresReview(candidate) || reviewGate(state.root, candidate, state)), 'stale-review', 'Final reviewed inputs changed');
      const undocumented = state.tasks.filter(candidate => docsGateFailure(state.root, candidate, state) !== null).map(candidate => candidate.id);
      requireCondition(undocumented.length === 0, 'docs-review-required', `Every code and docs task needs a current independent docs review or a fresh mechanical exemption; tracking edits after triage need a current closing docs review. Missing for: ${undocumented.join(', ')}`);
      requireCondition(state.tasks.every(candidate => verificationGate(state.root, candidate)), 'verification-required', 'Every registered check must pass on current inputs before final acceptance');
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
}

module.exports = { DIMENSIONS, assertAction, commitmentsFor, completeAssessment, findingKind, isDocumentationPath, obligationBrief, reportNotice, reviewGate, reviewProgress, sharesCumulativeAssessment, targetById, taskById, transition, unresolvedFindings };
