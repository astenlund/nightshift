'use strict';

const { requireCondition } = require('./errors');
const { applicability } = require('./applicability');
const { fileIdentity, fresh, hash, projectFile, relativeParts } = require('./evidence');
const { isReviewContext } = require('./records');

// A code task's link to its governing spec task. add-spec-review records it beside the agreement, so recording it never stales the
// validations and assessments that bind the agreement; handover and earlier records keep it inside the agreement. The value beside
// the agreement is read first, and a falsy value in either place is no link. Links are never rewritten or cleared.
function linkValues(task) {
  return [task?.specReviewTaskId, task?.agreement?.specReviewTaskId].filter(Boolean);
}

function specLink(task) {
  return linkValues(task)[0] ?? null;
}

// Every task some task links in either place. A linked task is internal to the run; an unlinked spec task is one the user agreed in
// the queue, which the acknowledgement scope covers and which can govern the code tasks over its spec.
function linkedTaskIds(tasks) {
  return new Set(tasks.flatMap(linkValues));
}

// A spec value a reader can compare: a nonblank string in the project-relative path grammar. Handover validates it; earlier records may not.
function usableSpec(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    relativeParts(value);
    return true;
  } catch {
    return false;
  }
}

// Two spec paths name the same file when the strings are equal or, with both files present, their file identities are equal, as the
// assessment gate compares governing inputs. The path grammar refuses alternate forms, so the second clause admits case variants of
// one file on a case-insensitive filesystem. An identity that cannot be established is no match.
function samePath(root, left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  if (left === right) return true;
  try {
    projectFile(root, left);
    projectFile(root, right);
    const first = fileIdentity(root, left);
    const second = fileIdentity(root, right);

    return first.exists && second.exists && !first.directory && first.key === second.key;
  } catch {
    return false;
  }
}

function requiresOf(task) {
  return Array.isArray(task?.requires) ? task.requires : [];
}

// Whether a task depends on another through requires edges, directly or through other tasks.
function dependsOn(byId, from, targetId) {
  const seen = new Set();
  const pending = [...requiresOf(from)];
  while (pending.length > 0) {
    const id = pending.pop();
    if (id === targetId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    pending.push(...requiresOf(byId.get(id)));
  }

  return false;
}

// The strongly connected components of more than one task over requires and governance edges, as a map from task id to component.
function cycleComponents(byId, governed) {
  const successors = id => [...requiresOf(byId.get(id)), ...(governed.get(id) ? [governed.get(id)] : [])].filter(next => byId.has(next));
  const index = new Map();
  const low = new Map();
  const stack = [];
  const onStack = new Set();
  const component = new Map();
  let counter = 0;
  let components = 0;
  const visit = id => {
    index.set(id, counter);
    low.set(id, counter);
    counter++;
    stack.push(id);
    onStack.add(id);
    for (const next of successors(id)) {
      if (!index.has(next)) {
        visit(next);
        low.set(id, Math.min(low.get(id), low.get(next)));
      } else if (onStack.has(next)) low.set(id, Math.min(low.get(id), index.get(next)));
    }
    if (low.get(id) !== index.get(id)) return;
    const members = [];
    let member;
    do {
      member = stack.pop();
      onStack.delete(member);
      members.push(member);
    } while (member !== id);
    if (members.length > 1) {
      members.forEach(item => component.set(item, components));
      components++;
    }
  };
  for (const id of byId.keys()) {
    if (!index.has(id)) visit(id);
  }

  return component;
}

// Which spec task governs each code task naming a usable spec, read afresh each time and persisting nothing. A link governs when it
// names a spec task over the same spec that does not require the code task; without a link, the one queued spec task over the same
// spec that does not require the code task governs. Governance is itself a dependency, so a governance edge on a cycle of requires
// and governance edges governs nothing: a linked task there is an unresolvable link, and a queued one leaves the code task without one.
// Each entry carries the link, the governing task or null, a structural reason for an unresolvable link, and for the queued route the
// eligible queued tasks and those excluded with their reason.
function resolveGovernance(root, tasks) {
  const byId = new Map(tasks.map(task => [task.id, task]));
  const linked = linkedTaskIds(tasks);
  const resolved = new Map();
  for (const task of tasks) {
    if (task.kind !== 'code' || !usableSpec(task.agreement?.spec)) continue;
    const spec = task.agreement.spec;
    const link = specLink(task);
    if (link) {
      const target = byId.get(link);
      const structural = !target ? 'missing-task' : target.kind !== 'spec' ? 'other-kind' : !samePath(root, target.agreement?.spec, spec) ? 'other-spec' : dependsOn(byId, target, task.id) ? 'requires-code-task' : null;
      resolved.set(task.id, { link, specTask: structural ? null : target, structural });
      continue;
    }
    const over = tasks.filter(candidate => candidate.kind === 'spec' && !linked.has(candidate.id) && samePath(root, candidate.agreement?.spec, spec));
    const excluded = over.filter(candidate => dependsOn(byId, candidate, task.id)).map(candidate => ({ id: candidate.id, reason: 'requires-code-task' }));
    const eligible = over.filter(candidate => !excluded.some(entry => entry.id === candidate.id));
    resolved.set(task.id, { link: null, specTask: eligible.length === 1 ? eligible[0] : null, structural: null, queued: eligible.map(candidate => candidate.id), excluded });
  }
  const governed = new Map([...resolved].filter(([, entry]) => entry.specTask).map(([id, entry]) => [id, entry.specTask.id]));
  const component = cycleComponents(byId, governed);
  for (const [id, entry] of resolved) {
    if (!entry.specTask || !component.has(id) || component.get(id) !== component.get(entry.specTask.id)) continue;
    resolved.set(id, entry.link ? { ...entry, specTask: null, structural: 'cycle' } : { ...entry, specTask: null, queued: [], excluded: [...entry.excluded, { id: entry.specTask.id, reason: 'cycle' }] });
  }

  return resolved;
}

const LINK_CAUSES = Object.freeze({
  'missing-task': 'names no task in the run',
  'other-kind': 'names a task that is not a spec task',
  'other-spec': 'names a spec task over a different spec',
  'requires-code-task': 'names a spec task that requires this task, directly or through other tasks',
  cycle: 'names a spec task on a cycle of requires and governance edges',
});

function linkCause(entry) {
  return `an unresolvable link: ${JSON.stringify(entry.link)} ${LINK_CAUSES[entry.structural]}`;
}

// Handover refuses a link that cannot govern its code task and a queue whose requires and governance edges form a cycle.
function assertHandoverGovernance(root, tasks) {
  const resolved = resolveGovernance(root, tasks);
  for (const [id, entry] of resolved) {
    requireCondition(!entry.structural, 'invalid-queue', `Task ${id} has ${entry.structural ? linkCause(entry) : ''}; agreement.specReviewTaskId must name a queued spec task over the same spec that does not require this task`);
    const cycle = entry.excluded?.find(item => item.reason === 'cycle');
    requireCondition(!cycle, 'invalid-queue', `Task ${id} and its queued spec task ${cycle?.id} lie on a cycle of requires and governance edges, so each would hold the other`);
  }
}

const READY = specTaskId => ({ ready: true, specTaskId, cause: null, next: null });
const unready = (specTaskId, cause, next) => ({ ready: false, specTaskId, cause, next });

// The way forward for a cause no runtime operation repairs, until the recorded-decision operation ships.
function userDecision(task) {
  const block = task.status === 'complete' ? '' : `block ${task.id} with kind user-decision, so the run pauses on that decision through the existing blocker, whose later unblock is a material amendment; `;

  return `ask the user to decide on the run: ${block}until the recorded-decision operation ships, the controller can also hold, stop, or close the run administratively once stopped`;
}

function capitalized(sentence) {
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

function reviewedSnapshot(root, task) {
  if (task.agreement.specReviewed !== true) return 'none';
  const evidence = task.agreement.specSnapshot;
  if (!evidence) return 'missing';
  if (!Array.isArray(evidence.files) || evidence.files.length !== 1 || evidence.files[0]?.path !== task.agreement.spec || typeof evidence.files[0].sha256 !== 'string' || hash(JSON.stringify(evidence.files)) !== evidence.digest) return 'malformed';

  return fresh(root, evidence) ? 'current' : 'stale';
}

function noRoute(snapshot, entry) {
  const reviewed = { none: 'no reviewed snapshot', missing: 'a missing reviewed snapshot', malformed: 'a malformed reviewed snapshot', stale: 'a stale reviewed snapshot' }[snapshot];
  const queued = entry.queued.length > 1 ? `several queued spec tasks over this spec (${entry.queued.join(', ')})` : 'no queued spec task over this spec';
  const excluded = entry.excluded.map(item => `${item.id}, excluded because it ${item.reason === 'cycle' ? 'lies on a cycle of requires and governance edges with this task' : 'requires this task'}`);

  return `no assessment route: no link, ${reviewed} and ${queued}${excluded.length ? `; ${excluded.join('; ')}` : ''}`;
}

// Whether a governing spec task settles its code task's readiness: complete, and its latest lead assessment passing its review gate
// with checks left out, which its own completion and run completion still verify, still matching its requirements and commitments,
// and following the latest material amendment of every code task it governs, so no route leaves readiness on an assessment the amendment postdates, even
// when the amendment could not reopen the spec task. Its caller turns any exception from malformed evidence into a structural cause.
function specTaskReadiness(state, spec, task, resolved) {
  const lifecycle = require('./lifecycle');
  const root = state.root;
  if (spec.status !== 'complete') {
    if (spec.blocker) return unready(spec.id, `spec task ${spec.id} is blocked (${spec.blocker.kind}: ${spec.blocker.reason})`, `Resolve the recorded blocker on ${spec.id}, then complete it`);
    const upstream = requiresOf(spec).filter(id => state.tasks.find(candidate => candidate.id === id)?.status !== 'complete');
    if (upstream.length > 0) return unready(spec.id, `spec task ${spec.id} is held by incomplete upstream work: ${upstream.join(', ')}`, `Complete ${upstream.join(', ')}, then ${spec.id}`);

    return unready(spec.id, `spec task ${spec.id} is not complete`, `Complete ${spec.id} with a current independent spec assessment, its findings settled and its checks passing`);
  }
  const entry = lifecycle.leadEntry(spec, state);
  const review = entry?.review;
  const freshAssessment = `Obtain a fresh independent spec assessment of ${spec.id}`;
  if (!lifecycle.completeAssessment(review)) return unready(spec.id, `spec task ${spec.id} has no complete independent spec assessment`, freshAssessment);
  const missing = lifecycle.DIMENSIONS.spec.filter(dimension => !(Array.isArray(review.dimensions) && review.dimensions.includes(dimension)));
  if (missing.length > 0) return unready(spec.id, `the assessment of ${spec.id} is missing the dimensions ${missing.join(', ')}`, freshAssessment);
  if (!lifecycle.acceptableAssessment(review, spec)) {
    const predates = spec.requirementsRevision !== undefined && (review.revision ?? -1) < spec.requirementsRevision;

    return unready(spec.id, predates ? `the assessment of ${spec.id} predates its requirements revision ${spec.requirementsRevision}` : `the assessment of ${spec.id} no longer matches its commitments`, freshAssessment);
  }
  // A dispatched assessment examined its inputs when it was registered, so a late import of one dispatched before the amendment
  // still predates it. A dispatch record without a usable registration cannot show when its inputs were examined, so it predates
  // every amendment; an assessment without any dispatch record is dated by its import.
  const worker = state.workers?.find(candidate => candidate.id === review.requestId);
  const registered = worker?.registeredRevision;
  const assessedAt = !worker ? review.revision ?? -1 : Number.isSafeInteger(registered) ? Math.min(registered, review.revision ?? registered) : -1;
  // Every code task this spec task governs shares its assessment, so an amendment to any of them holds them all, as reopening would.
  const governed = state.tasks.filter(candidate => candidate.id === task.id || resolved.get(candidate.id)?.specTask?.id === spec.id);
  const amended = governed.filter(candidate => candidate.requirementsRevision !== undefined && assessedAt < candidate.requirementsRevision);
  if (amended.length > 0) {
    return unready(spec.id, `the assessment of ${spec.id} predates the amendment of ${amended.map(candidate => `${candidate.id} at revision ${candidate.requirementsRevision}`).join(', ')}`, freshAssessment);
  }
  if (lifecycle.reviewGateFailure(root, spec, state, { ignoreChecks: true }) === null) return READY(spec.id);
  const condition = applicability(root, review, spec, entry.owner, state);
  if (!condition.current) {
    const changed = condition.changedPaths?.length ? ` after changes to ${condition.changedPaths.join(', ')}` : '';
    const cause = condition.status === 'pending' ? `the assessment of ${spec.id} awaits the reviewer's applicability call${changed}`
      : ['reassess', 'unresolved'].includes(condition.status) ? `the applicability call on ${spec.id} answered ${condition.status}${changed}`
        : `the assessment comparison of ${spec.id} failed structurally (${condition.status})`;

    const staleNext = ['pending', 'reassess', 'unresolved'].includes(condition.status) && !condition.missingPaths ? lifecycle.staleWayForward(root, state, spec, entry) : null;

    return unready(spec.id, cause, staleNext ? capitalized(staleNext) : condition.next ?? freshAssessment);
  }
  const own = spec.findings.filter(finding => lifecycle.findingKind(finding, spec) === 'spec');
  const raised = state.tasks.flatMap(owner => owner.findings).filter(finding => finding.reviewRevision === review.revision);
  const open = [...new Set([...own, ...raised].filter(finding => !lifecycle.settled(finding) || finding.pendingClosure).map(finding => finding.id))];
  if (open.length > 0) return unready(spec.id, `spec findings remain unsettled or unclosed: ${open.join(', ')}`, `Validate, dispose, repair and close ${open.join(', ')} on ${spec.id}`);
  if (own.some(finding => finding.repaired && finding.repairRevision >= review.revision)) return unready(spec.id, `a repair of ${spec.id} follows its latest assessment`, freshAssessment);

  return unready(spec.id, `the spec assurance of ${spec.id} is unmet`, freshAssessment);
}

// Spec readiness of a code task naming a spec: ready through its own reviewed snapshot while it matches and it has no link, or through
// its governing spec task. Everything else is unready with one sentence of cause and the way forward. A review context, a task of
// another kind and an agreement without a spec key are always ready.
function specReadiness(state, task, resolved = resolveGovernance(state.root, state.tasks)) {
  if (isReviewContext(state) || task.kind !== 'code' || !Object.hasOwn(task.agreement ?? {}, 'spec')) return READY(null);
  const spec = task.agreement.spec;
  if (!usableSpec(spec)) return unready(null, `its agreement's spec value ${JSON.stringify(spec) ?? String(spec)} is unusable, and no operation rewrites it`, capitalized(userDecision(task)));
  const entry = resolved.get(task.id);
  const specTaskId = entry.specTask?.id ?? null;
  let identity;
  try {
    projectFile(state.root, spec);
    identity = fileIdentity(state.root, spec);
  } catch {
    return unready(specTaskId, `the governing spec ${spec} cannot be read safely as a regular project file`, `Restore ${spec} as a regular file; otherwise ${userDecision(task)}`);
  }
  if (!identity.exists) return unready(specTaskId, `the governing spec file ${spec} is missing`, `Restore ${spec}; otherwise ${userDecision(task)}`);
  if (identity.directory) return unready(specTaskId, `the governing spec ${spec} is a directory`, `Restore ${spec} as a regular file; otherwise ${userDecision(task)}`);
  const snapshot = entry.link ? null : reviewedSnapshot(state.root, task);
  if (snapshot === 'current') return READY(specTaskId);
  if (entry.structural) return unready(null, linkCause(entry), capitalized(userDecision(task)));
  if (!entry.specTask) return unready(null, noRoute(snapshot, entry), `Run add-spec-review on ${task.id}, then complete the new spec task with an independent spec assessment`);

  try {
    return specTaskReadiness(state, entry.specTask, task, resolved);
  } catch {
    // Malformed persisted evidence on the spec task, of any shape, leaves the code task unready rather than failing status or a gate.
    return unready(entry.specTask.id, `the readiness comparison of ${entry.specTask.id} failed structurally on malformed evidence`, `Reconcile the malformed evidence of ${entry.specTask.id}, then obtain a fresh independent spec assessment`);
  }
}

function specReadinessRefusal(state, tasks, message) {
  const resolved = resolveGovernance(state.root, state.tasks);
  const failing = tasks.map(task => ({ task, reading: specReadiness(state, task, resolved) })).filter(entry => !entry.reading.ready);

  return failing.length === 0 ? null : `${message}. ${failing.map(({ task, reading }) => `${task.id}: ${reading.cause}. Next: ${reading.next}`).join('. ')}`;
}

function requireSpecReadiness(state, tasks, message) {
  const refusal = specReadinessRefusal(state, tasks, message);
  requireCondition(refusal === null, 'spec-review-required', refusal ?? '');
}

// The run-level status list: one entry for every code task whose agreement has a spec key, completed tasks included.
function specReadinessStatus(state, options, acceptance) {
  if (options.verifyFreshness === false) return 'reconcile at acceptance';
  const resolved = resolveGovernance(state.root, state.tasks);

  return state.tasks.filter(task => task.kind === 'code' && Object.hasOwn(task.agreement ?? {}, 'spec')).map(task => ({ taskId: task.id, ...specReadiness(state, task, resolved), specAcceptance: acceptance(task) }));
}

module.exports = { assertHandoverGovernance, linkValues, linkedTaskIds, requireSpecReadiness, resolveGovernance, samePath, specLink, specReadiness, specReadinessStatus, usableSpec };
