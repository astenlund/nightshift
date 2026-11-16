'use strict';

// The closing outside-documentation hold, which holds completion after triage on changes outside the documentation paths, and the
// applicability-call guidance that names each stale assessment's way forward around it. Lifecycle owns the gates that read them.

const { changedPaths, compareOnce, fileIdentity, fileSha256, freshAll, hash, inventoryVisible, snapshot } = require('./evidence');
const { CLOSING_TARGET } = require('./actions');
const { closureRoute, latestDispatchOf, lineageOf } = require('./continuation');
const { isReviewContext } = require('./records');
const { isClosed } = require('./statuses');
const { applicability } = require('./applicability');
const { governingArtifacts, isDocumentationPath, onlyGoverningArtifacts } = require('./documentation-paths');
const { originalInputsRetained } = require('./relevance');

// Lifecycle requires this module, so its own helpers are reached lazily.
const lifecycle = () => require('./lifecycle');
const closingCoverage = (state, key) => lifecycle().closingCoverageText(state, key, outsideDocumentationBaseline(state));
const latestClosingReview = (...args) => lifecycle().latestClosingReview(...args);
const reviewKind = (...args) => lifecycle().reviewKind(...args);
const completeAssessment = (...args) => lifecycle().completeAssessment(...args);
const coversDimensions = (...args) => lifecycle().coversDimensions(...args);
const requiresReview = (...args) => lifecycle().requiresReview(...args);
const reviewGateFailure = (...args) => lifecycle().reviewGateFailure(...args);
const sharesCumulativeAssessment = (...args) => lifecycle().sharesCumulativeAssessment(...args);
const leadEntry = (...args) => lifecycle().leadEntry(...args);
const staleCause = (...args) => lifecycle().staleCause(...args);

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

// The kind of condition a recorded decision settles; the closing hold no task assessment can settle is the only one.
const DECISION_KIND = 'closing-hold';

// The stored list is untrusted: an absent field holds no decisions, and a present value that is not a list is unreadable, which
// settles nothing and is reported as a structural failure rather than read as an empty list.
function decisionList(state) {
  if (state.userDecisions === undefined) return { readable: true, decisions: [] };
  return Array.isArray(state.userDecisions) ? { readable: true, decisions: state.userDecisions } : { readable: false, decisions: [] };
}

function recordedDecisions(state) {
  return decisionList(state).decisions;
}

// A path list for a text: at most twenty paths, with a count of the rest.
function listedPaths(paths) {
  return paths.slice(0, 20).join(', ') + (paths.length > 20 ? ` and ${paths.length - 20} more` : '');
}

// A decision is usable only with its identity, its kind and inputs whose digest still matches their files; anything else settles nothing.
function wellFormedDecision(decision) {
  const files = decision?.inputs?.files;
  return typeof decision?.id === 'string' && decision.condition?.kind === DECISION_KIND && Array.isArray(files) && files.length > 0
    && files.every(file => typeof file?.path === 'string' && (file.sha256 === null || typeof file.sha256 === 'string'))
    && typeof decision.inputs.digest === 'string' && hash(JSON.stringify(files)) === decision.inputs.digest;
}

// Whether every recorded path can be compared at all: each is absent or a regular project file. A path replaced by a directory, a link
// or another entry the runtime refuses to read cannot be compared, which differs from content that changed.
function comparableInputs(root, files) {
  try {
    for (const file of files) fileSha256(root, file.path);
    return true;
  } catch {
    // The refusal is the answer: the inputs cannot be compared.
    return false;
  }
}

// For each recorded decision, the recorded paths whose content on disk still matches the content the user decided on, compared as
// review freshness compares it; null when the decision is malformed or its inputs cannot be compared, so it settles nothing.
function decisionSettlements(root, state) {
  return recordedDecisions(state).map(decision => {
    if (!wellFormedDecision(decision) || !comparableInputs(root, decision.inputs.files)) return { decision, settled: null };
    const current = freshAll(root, decision.inputs.files.map(file => ({ digest: hash(JSON.stringify([file])), files: [file] })));
    return { decision, settled: decision.inputs.files.filter((_, index) => current[index] === true).map(file => file.path) };
  });
}

// Every path some applying decision settles. Decisions combine: each settles only its own paths.
function decidedPaths(root, state) {
  return new Set(decisionSettlements(root, state).flatMap(entry => entry.settled ?? []));
}

// The outside-documentation hold: null while the condition is settled or not evaluated, otherwise its set as changedPaths, null when the
// set cannot be computed. Paths a recorded decision settles leave the set first, so every reader, the test of whether a task assessment
// settles the hold included, judges only the paths no decision settles. Every consumer reads this one predicate, never the raw set.
function outsideDocumentationHold(root, state) {
  const baseline = outsideDocumentationBaseline(state);
  if (baseline === undefined) return null;
  const changed = outsideDocumentationPaths(root, state, baseline);
  const decided = changed === null || recordedDecisions(state).length === 0 ? new Set() : decidedPaths(root, state);
  const paths = changed === null ? null : changed.filter(file => !decided.has(file));
  if (paths !== null && (paths.length === 0 || settlesOutsideDocumentation(root, state, paths))) return null;
  return { changedPaths: paths };
}

// Whether a recorded decision settles a path of the outside-documentation set, so that a re-recorded triage keeps the earlier
// baseline rather than absorbing paths only the user settled.
function decisionHoldsBaseline(root, state) {
  if (recordedDecisions(state).length === 0) return false;
  const baseline = outsideDocumentationBaseline(state);
  if (!baseline) return false;
  const changed = outsideDocumentationPaths(root, state, baseline);
  if (changed === null) return false;
  const decided = decidedPaths(root, state);
  return changed.some(file => decided.has(file));
}

// The condition identity of an unsettled hold that only the user's decision can settle: the digest of its paths with their current
// content, which record-decision recomputes so that a decision never binds paths the user was not briefed on.
function holdIdentity(root, hold) {
  try {
    return snapshot(root, hold.changedPaths).digest;
  } catch {
    // Paths that cannot be read as regular files have no identity a decision could bind; status reports none rather than failing.
    return null;
  }
}

// The settled paths of the closing coverage on a complete run, where the hold itself is not evaluated: paths a decision recorded
// before completion settles by their content on disk.
function decidedCoveragePaths(root, state) {
  return recordedDecisions(state).length === 0 ? new Set() : decidedPaths(root, state);
}

// The paths of an imported closing review's snapshot that a decision settles: the review's view of the path carries the content the
// decision recorded. A complete run's closing-scope check compares the review with its baseline, so the review's view is its comparand:
// its entry's content when it lists the path, and absence when an inventory snapshot does not, as for a file deleted from the index.
function decidedSnapshotPaths(state, evidence) {
  const entries = new Map((Array.isArray(evidence?.files) ? evidence.files : []).map(file => [file.path, file]));
  const settled = new Set();
  for (const decision of recordedDecisions(state)) {
    if (!wellFormedDecision(decision)) continue;
    for (const file of decision.inputs.files) {
      const entry = entries.get(file.path);
      const viewed = entry ? entry.sha256 : evidence?.inventory === true ? null : undefined;
      if (viewed !== undefined && viewed === file.sha256 || typeof entry?.blob === 'string' && entry.blob === file.blob) settled.add(file.path);
    }
  }
  return settled;
}

// Each recorded decision as status and the completion result report it: its state is applies while it settles a path of the current
// set, lapsed once it settles none, and structural-failure when it is malformed or the set or its inputs cannot be compared; a closed
// record reads closed and skipped freshness verification reads reconcile at acceptance, neither comparing anything. Status names at most
// twenty settled paths beside their count.
function decisionStatus(root, state, options = {}) {
  const { readable, decisions } = decisionList(state);
  const reading = isClosed(state) ? 'closed' : options.verifyFreshness === false ? 'reconcile at acceptance' : null;
  const empty = { id: null, condition: null, authority: null, reason: null, revision: null };
  // An unreadable list is reported as one structural failure, so status shows that it holds something no reader can use.
  if (!readable) return [reading ? { ...empty, state: reading } : { ...empty, state: 'structural-failure', settledPaths: [], settledCount: 0 }];
  if (decisions.length === 0) return [];
  const settlements = reading ? null : decisionSettlements(root, state);
  const baseline = outsideDocumentationBaseline(state) ?? (state.status === 'complete' ? state.closing?.docs?.baseline ?? state.closing?.carriedBaseline : undefined);
  const changed = settlements && baseline && !baseline.backlogOnly ? outsideDocumentationPaths(root, state, baseline) : null;
  return decisions.map((decision, index) => {
    // Any entry, an object or not, is reported with what it holds; a non-object one is malformed and reads structural-failure below.
    const base = { id: decision?.id ?? null, condition: decision?.condition ?? null, authority: decision?.authority ?? null, reason: decision?.reason ?? null, revision: decision?.revision ?? null };
    if (reading) return { ...base, state: reading };
    const settled = settlements[index].settled;
    if (settled === null || changed === null) return { ...base, state: 'structural-failure', settledPaths: [], settledCount: 0 };
    const current = settled.filter(file => changed.includes(file));
    return { ...base, state: current.length > 0 ? 'applies' : 'lapsed', settledPaths: current.slice(0, 20), settledCount: current.length };
  });
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
function outsideDocumentationNext(root, state, hold, route = holdRoute(root, state, hold)) {
  if (route.kind === 'uncomputable') return closingCoverage(state, 'no-baseline');
  const closingReview = `then a complete closing docs review (task ${CLOSING_TARGET}) covering every task and current on the final inputs`;
  const revert = 'Reverting these paths also settles the hold.';
  // A dispatch need not select an ignored changed path on its own, and only an assessment whose scope held every path settles the hold.
  if (route.kind === 'assessment' && route.settlement.kind === 'code') return `Obtain a fresh code assessment on one of the tasks ${settlingCandidates(root, state).join(', ')}, passing the changed paths as artifactPaths, ${closingReview}. ${revert}`;
  if (route.kind === 'assessment') return `Obtain a fresh whole-spec assessment on spec task ${route.settlement.task.id}, which settles the hold, ${closingReview}. ${revert}`;
  if (route.kind === 'unreadable') return `No task assessment can settle the hold, and its paths cannot be read as regular files, so no recorded decision can bind them: replace them with regular files, after which the user's decision can be recorded, or the user may choose hold, stop or the administrative close. ${revert}`;
  return `No task assessment can settle the hold, so it needs the user's decision. Once the user decides, record it with record-decision on condition kind ${DECISION_KIND} and the identity status reports for the hold, ${closingReview}; the user may instead choose hold, stop or the administrative close. ${revert}`;
}

// How the hold can be settled: uncomputable when its set cannot be computed; by a task assessment, carrying its settlement; by the
// user's recorded decision when no task assessment can and its paths can be read, so that the decision has an identity to bind; or by
// neither while those paths cannot be read. Identity, every text and the operation read this one answer.
function holdRoute(root, state, hold) {
  if (hold.changedPaths === null) return { kind: 'uncomputable' };
  const settlement = holdSettlement(root, state, hold);
  if (settlement.kind !== 'none') return { kind: 'assessment', settlement };
  const identity = holdIdentity(root, hold);
  return identity === null ? { kind: 'unreadable' } : { kind: 'decision', identity };
}

function outsideDocumentationStatus(root, state, hold) {
  const route = holdRoute(root, state, hold);
  return { changedPaths: hold.changedPaths, next: outsideDocumentationNext(root, state, hold, route), ...(route.kind === 'decision' ? { identity: route.identity } : {}) };
}

function outsideDocumentationRefusal(root, state, hold, route = holdRoute(root, state, hold)) {
  if (route.kind === 'uncomputable') return closingCoverage(state, 'no-baseline');
  const settler = route.kind === 'decision' ? 'the user\'s recorded decision settles them' : route.kind === 'unreadable' ? 'they are replaced by regular files the user\'s decision can bind' : 'a fresh task assessment covers them';
  return `Paths outside the documentation paths changed since triage and hold completion until ${settler} or they are reverted: ${listedPaths(hold.changedPaths)}. ${outsideDocumentationNext(root, state, hold, route)}`;
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

// The way forward for a stale assessment as a sentence of its own, as status reports it.
function staleWayForwardSentence(root, state, task, entry, hold) {
  const phrase = staleWayForward(root, state, task, entry, hold);

  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

module.exports = { DECISION_KIND, applicabilityCall, codeCarriers, decidedCoveragePaths, decidedSnapshotPaths, decisionHoldsBaseline, decisionList, decisionStatus, heldBy, holdIdentity, holdRoute, holdSettlement, outsideDocumentationBaseline, outsideDocumentationBrief, outsideDocumentationHold, outsideDocumentationNext, outsideDocumentationRefusal, outsideDocumentationStatus, listedPaths, recordedDecisions, settlesOutsideDocumentation, staleWayForward, staleWayForwardSentence };
