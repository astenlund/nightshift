'use strict';

const { isDeepStrictEqual } = require('node:util');
const { requireCondition } = require('./errors');
const { changedPaths, fileIdentity, fresh, hash, projectFile, snapshot } = require('./evidence');
const { governingArtifacts, ignoresDocumentationPaths, partitionDocumentationChanges } = require('./documentation-paths');

// Decisions live beside assessments in reviews, but never become assessments themselves. They bind one immutable assessment
// and the exact later input scope and commitments examined. Missing, conflicting or unreadable evidence never grants coverage.
const identity = review => hash(JSON.stringify(review));
const commitment = task => ({ agreement: task.agreement, revision: task.requirementsRevision ?? 0 });

function validRelevanceTaskIds(ids) {
  return Array.isArray(ids) && ids.length > 0 && [...ids].every(id => typeof id === 'string' && id.trim()) && new Set(ids).size === ids.length;
}

function relevanceCoversTask(review, taskId) {
  if (!review.relevance) return false;
  requireCondition(validRelevanceTaskIds(review.relevance.taskIds), 'invalid-relevance', 'Relevance requires unique nonempty task ids');
  return review.relevance.taskIds.includes(taskId);
}

function hasGoverningInput(root, paths, governing) {
  if (governing === undefined) return true;
  if (typeof governing !== 'string' || !governing.trim() || !Array.isArray(paths)) return false;
  try {
    projectFile(root, governing);
    const expected = fileIdentity(root, governing).key;
    return paths.some(relative => fileIdentity(root, relative).key === expected);
  } catch {
    return false;
  }
}

// Known dispatches use registration order: importing an older result later cannot refresh or displace newer coverage.
// Records without complete dispatch history retain their original import-revision ordering.
function latestEntry(entries, state) {
  const dispatches = new Map((state?.workers ?? []).map((worker, index) => [worker.id, index]));
  const ordered = entries.every(entry => dispatches.has(entry.review.requestId));
  const rank = entry => ordered ? dispatches.get(entry.review.requestId) : entry.review.revision ?? 0;
  return [...entries].sort((left, right) => rank(right) - rank(left))[0];
}

// A decision needs a unique successor in registration order, or in the recorded legacy revision order.
// Ambiguous identity or a tied/unknown latest rank cannot choose a permissive answer.
function latestDecision(decisions, state) {
  if (!decisions.length) return null;
  const workers = state?.workers ?? [];
  const ids = decisions.map(review => review.requestId);
  if (new Set(ids).size !== ids.length) return null;
  if (workers.some(worker => ids.includes(worker.id) && workers.filter(other => other.id === worker.id).length !== 1)) return null;
  const positions = new Map(workers.map((worker, index) => [worker.id, index]));
  const registered = decisions.every(review => positions.has(review.requestId));
  const ranks = decisions.map(review => registered ? positions.get(review.requestId) : review.revision);
  if (ranks.some(rank => !Number.isSafeInteger(rank) || rank < 0)) return decisions.length === 1 ? decisions[0] : null;
  const maximum = Math.max(...ranks);
  const latest = decisions.filter((review, index) => ranks[index] === maximum);
  return latest.length === 1 ? latest[0] : null;
}

function snapshotChanges(before, after) {
  const valid = evidence => evidence?.inventory === true && Array.isArray(evidence.files) && hash(JSON.stringify(evidence.files)) === evidence.digest;
  if (!valid(before) || !valid(after)) return null;
  const left = new Map(before.files.map(file => [file.path, file]));
  const right = new Map(after.files.map(file => [file.path, file]));
  return [...new Set([...left.keys(), ...right.keys()])].filter(key => {
    const previous = left.get(key);
    const next = right.get(key);
    return !previous || !next || previous.sha256 !== next.sha256 && (!previous.blob || previous.blob !== next.blob);
  }).sort();
}

function differences(root, evidence) {
  if (!evidence || !Array.isArray(evidence.files) || evidence.files.length === 0 || hash(JSON.stringify(evidence.files)) !== evidence.digest) return null;
  if (new Set(evidence.files.map(file => file?.path)).size !== evidence.files.length || evidence.files.some(file => typeof file?.path !== 'string' || file.sha256 !== null && !/^[a-f0-9]{64}$/.test(file.sha256))) return null;
  if (evidence.inventory === true) return changedPaths(root, evidence);
  try {
    snapshot(root, evidence.files.map(file => file.path));
    return evidence.files.filter(file => !fresh(root, { files: [file], digest: hash(JSON.stringify([file])) })).map(file => file.path).sort();
  } catch {
    return null;
  }
}

function inputChanges(root, review, kind = review.kind) {
  const snapshots = kind === 'spec' || isDeepStrictEqual(review.snapshot, review.contextSnapshot ?? review.snapshot) ? [review.snapshot] : [review.snapshot, review.contextSnapshot];
  const changes = snapshots.map(evidence => differences(root, evidence));
  return changes.some(paths => paths === null) ? null : [...new Set(changes.flat())].sort();
}

// The input changes a comparison of an assessment counts. On a run that ignores documentation paths, a code assessment's comparison
// sets changed documentation paths other than the governing artifacts aside as documentationPaths, at import and afterwards.
function assessedChanges(root, review, kind, state, governing, assessedKind = kind) {
  const changes = inputChanges(root, review, kind);
  if (changes === null || assessedKind !== 'code' || !ignoresDocumentationPaths(state)) return { changedPaths: changes, documentationPaths: [] };
  const { counted, ignored } = partitionDocumentationChanges(root, changes, governing);
  return { changedPaths: counted, documentationPaths: ignored };
}

function missingSpecInputs(root, review) {
  return review.snapshot.files.map(file => file.path).filter(file => !fileIdentity(root, file).exists).sort();
}

function applicability(root, review, task, owner, state = null) {
  const result = evaluateApplicability(root, review, task, owner, state);
  if (result.kind !== 'spec' || result.current || !['pending', 'reassess', 'unresolved'].includes(result.status)) return result;
  try {
    const missingPaths = missingSpecInputs(root, review);
    if (!missingPaths.length) return result;
    return { ...result, missingPaths, next: 'Restore the missing declared spec inputs, or reconcile the governing agreement and obtain a fresh assessment with the revised deciding scope: ' + missingPaths.join(', ') };
  } catch {
    return { ...result, current: false, status: 'structural-failure', changedPaths: null, next: 'Reconcile unreadable declared spec inputs before assessment' };
  }
}

function evaluateApplicability(root, review, task, owner, state = null) {
  const kind = review.kind ?? (owner.kind === 'spec' ? 'spec' : 'code');
  // A closing record's reviews are docs assessments, whatever an earlier record left unrecorded.
  const comparedKind = owner.kind === 'closing' ? 'docs' : kind;
  const { changedPaths, documentationPaths } = assessedChanges(root, review, comparedKind, state, governingArtifacts([task], [review]));
  const commitmentsChanged = !isDeepStrictEqual(review.commitments?.[task.id], commitment(task));
  const base = { requestId: review.requestId ?? null, kind, changedPaths, ...(documentationPaths.length > 0 ? { documentationPaths } : {}), commitmentsChanged };
  if (changedPaths === null) return { ...base, status: 'structural-failure', current: false, next: 'Reconcile missing, corrupt, unreadable or unsafe assessment evidence' };
  if (base.kind === 'spec' && (review.snapshot.files.some(file => file.sha256 === null) || !hasGoverningInput(root, review.snapshot.files.map(file => file.path), task.agreement?.spec))) return { ...base, status: 'structural-failure', current: false, next: 'Obtain a spec assessment of existing declared inputs that include the configured governing artifact' };
  const context = review.contextSnapshot ?? review.snapshot;
  if (base.kind !== 'spec' && !hasGoverningInput(root, context.files.filter(file => file.sha256 !== null).map(file => file.path), task.agreement?.spec)) return { ...base, status: 'structural-failure', current: false, next: 'Obtain an assessment whose recorded scope includes the configured governing artifact' };
  const related = (owner.reviews ?? []).filter(candidate => candidate.relevance?.requestId === review.requestId && candidate.relevance?.originalHash === identity(review));
  if (related.some(candidate => !validRelevanceTaskIds(candidate.relevance.taskIds))) {
    return { ...base, status: 'structural-failure', current: false, next: 'Reconcile malformed applicability task bindings' };
  }
  const scoped = related.filter(candidate => candidate.relevance.taskIds.includes(task.id));
  if (new Set(scoped.map(candidate => candidate.requestId)).size !== scoped.length || scoped.some(candidate =>
    candidate.attributionVerified !== true || candidate.independent !== true || candidate.strength !== 'strong' || !['complete', 'incomplete'].includes(candidate.status)
    || !Array.isArray(candidate.applicability) || candidate.applicability.length !== candidate.relevance.taskIds.length
    || new Set(candidate.applicability.map(answer => answer?.id)).size !== candidate.applicability.length
    || candidate.applicability.some(answer => !candidate.relevance.taskIds.includes(answer?.id) || !['preserve', 'reassess', 'unresolved'].includes(answer.outcome)
      || typeof answer.evidence !== 'string' || !answer.evidence.trim() || answer.outcome === 'preserve' && candidate.status !== 'complete'))) {
    return { ...base, status: 'structural-failure', current: false, next: 'Reconcile malformed applicability decisions' };
  }
  // A decision about an assessment is compared as that assessment is.
  const comparisons = scoped.map(candidate => ({ candidate, changes: assessedChanges(root, candidate, candidate.kind, state, governingArtifacts([task], [review, candidate]), comparedKind).changedPaths }));
  const failed = comparisons.find(entry => entry.changes === null);
  if (failed) return { ...base, changedPaths: null, status: 'structural-failure', current: false, decision: failed.candidate.requestId ?? null, next: 'Reconcile missing, corrupt, unreadable or unsafe applicability-decision evidence' };
  const decisions = comparisons.filter(entry => isDeepStrictEqual(entry.candidate.commitments?.[task.id], commitment(task)) && entry.changes.length === 0).map(entry => entry.candidate);
  const conflict = { ...base, status: 'conflicting-decisions', current: false, next: 'Reconcile applicability decision identity and ordering before selecting a successor' };
  if (decisions.length > 0) {
    const selected = latestDecision(decisions, state);
    if (!selected) return conflict;
    const answer = { ...selected.applicability.find(item => item.id === task.id), decision: selected.requestId };
    const current = answer.outcome === 'preserve';
    return { ...base, status: current ? 'applicable-by-decision' : answer.outcome, current, decision: answer.decision, reason: answer.evidence, next: current ? null : 'Obtain the pending cumulative assessment' };
  }
  if (changedPaths.length === 0 && !commitmentsChanged) return { ...base, status: 'applicable', current: true, next: null };
  const previous = latestDecision(scoped, state);
  if (scoped.length && !previous) return conflict;
  if (previous && previous.applicability.some(answer => answer.id === task.id && answer.outcome !== 'preserve')) {
    const answer = previous.applicability.find(item => item.id === task.id);
    return { ...base, status: answer.outcome, current: false, decision: previous.requestId, decisionCurrent: false,
      reason: 'An earlier independent applicability gap remains unsettled on the later inputs: ' + answer.evidence,
      next: 'Obtain current independent relevance or cumulative reassessment; input drift alone does not discharge the earlier judgment' };
  }
  return { ...base, status: 'pending', current: false, next: 'At a consequential acceptance boundary, resume or replace the originating reviewer for relevance, or obtain cumulative reassessment' };
}

// Historical completion does not reread today's files. A later check may match a candidate whose applicability was already
// independently preserved for every covered task. Several per-task decisions can together cover the same exact candidate.
function preservedSnapshots(review, owner, tasks, resolve, state = null) {
  const materialize = value => ({ ...value, snapshot: resolve(value.snapshot), ...(value.contextSnapshot ? { contextSnapshot: resolve(value.contextSnapshot) } : {}) });
  const originalHash = identity(materialize(review));
  const related = owner.reviews.filter(candidate => candidate.relevance?.originalHash === originalHash && candidate.relevance.requestId === review.requestId);
  if (related.some(candidate => !validRelevanceTaskIds(candidate.relevance.taskIds))) return [];
  const decisions = related.filter(candidate => ['complete', 'incomplete'].includes(candidate.status) && candidate.attributionVerified === true && candidate.independent === true && candidate.strength === 'strong').map(materialize);
  return decisions.filter(candidate => tasks.length > 0 && tasks.every(task => {
    const matching = decisions.filter(other => isDeepStrictEqual(other.snapshot, candidate.snapshot) && isDeepStrictEqual(other.contextSnapshot, candidate.contextSnapshot)
      && other.relevance.taskIds.includes(task.id) && isDeepStrictEqual(other.commitments?.[task.id], commitment(task)));
    const selected = latestDecision(matching, state);
    return selected?.status === 'complete' && selected.applicability?.filter(answer => answer.id === task.id).length === 1
      && selected.applicability.some(answer => answer.id === task.id && answer.outcome === 'preserve' && answer.evidence?.trim());
  })).map(candidate => candidate.snapshot);
}

module.exports = { latestDecision, missingSpecInputs, validRelevanceTaskIds, relevanceCoversTask, applicability, assessedChanges, commitment, differences, hasGoverningInput, identity, inputChanges, latestEntry, preservedSnapshots, snapshotChanges };
