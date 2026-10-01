'use strict';

const fs = require('node:fs');
const { requireCondition } = require('./store');
const { projectFile } = require('./evidence');
const { workerIsActive } = require('./workers');

// A reviewer's lineage: the request id of the fresh dispatch it began with. Resumed and replacement dispatches carry the lineage of
// the dispatch they continue, so a reviewer and its replacements own the same findings. A receipt or imported review names its dispatch
// as requestId, and an assignment or worker as id; records from earlier releases carry no lineage and are fresh dispatches of their own.
function lineageOf(record) {
  return record.lineage ?? record.requestId ?? record.id;
}

// The continuation a receipt, its assignment and its worker record: null for a fresh dispatch, and a resume's session.
function continuesRecord(continuation) {
  if (!continuation) return null;
  return { kind: continuation.kind, requestId: continuation.requestId, ...(continuation.kind === 'resumed' ? { session: continuation.session } : {}) };
}

// The receipt of a review or skeptic dispatch, or null. The runtime writes one only after the assessment and every check after it
// succeeded, so it, not the worker's status, establishes completion and attribution: a failed final bookkeeping write or a
// reconciliation can leave the two disagreeing, and a lineage whose receipt was imported must stay continuable. A receipt that cannot
// be read, as an interrupted write by an earlier release can leave one, establishes nothing, so status and recovery keep working.
function dispatchReceipt(root, worker) {
  if (!['reviewer', 'skeptic'].includes(worker.role) || !worker.artifactDirectory) return null;
  const file = projectFile(root, `${worker.artifactDirectory}/receipt.json`);
  if (!fs.existsSync(file)) return null;
  try {
    const receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
    return receipt !== null && typeof receipt === 'object' ? receipt : null;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

// The dispatch a continuation names, with its receipt: a review or skeptic dispatch of this target that produced a receipt and is the
// latest such dispatch on its native session, with no active or unverified worker still holding that session.
function continuedDispatch(root, state, target, requestId) {
  const worker = state.workers.find(candidate => candidate.id === requestId && ['reviewer', 'skeptic'].includes(candidate.role));
  requireCondition(worker, 'unknown-dispatch', 'No review or skeptic dispatch of this run has that request id');
  requireCondition(worker.taskId === target.id, 'foreign-dispatch', 'The named dispatch assessed another task');
  const receipt = dispatchReceipt(root, worker);
  requireCondition(receipt, 'incomplete-dispatch', 'Only a dispatch that produced a receipt can be continued');
  requireCondition(typeof receipt.session === 'string' && receipt.session.trim(), 'sessionless-dispatch', 'The named dispatch recorded no native session');
  // A worker's host is recorded only when its dispatch completes or resumes, so session identity decides membership.
  const sameSession = state.workers.filter(candidate => candidate === worker || candidate.session === receipt.session && (candidate.host ?? receipt.host) === receipt.host);
  requireCondition(!sameSession.some(workerIsActive), 'session-held', 'An active or unverified worker holds this native session; reconcile it before continuing the session');
  const latest = sameSession.filter(candidate => dispatchReceipt(root, candidate)).at(-1);
  requireCondition(latest.id === worker.id, 'superseded-dispatch', `A later dispatch continued this session; name ${latest.id} instead`);
  return { worker, receipt };
}

// The latest dispatch of a reviewer lineage on an owner that produced a receipt, which a resume or replacement names, or null.
function latestDispatchOf(root, state, owner, lineage) {
  return state.workers.filter(worker => worker.taskId === owner.id && lineageOf(worker) === lineage && dispatchReceipt(root, worker)).at(-1)?.id ?? null;
}

// What a finding looks like to a reviewer or skeptic continuing an exchange about it.
function findingSummary(finding) {
  return {
    id: finding.id, localId: finding.localId, severity: finding.severity, consequence: finding.consequence, evidence: finding.evidence,
    verdict: finding.validation?.verdict ?? null, skepticEvidence: finding.validation?.evidence ?? null, repairProposal: finding.validation?.repairProposal ?? null,
    disposition: finding.disposition, reason: finding.reason ?? null, repaired: Boolean(finding.repaired), pendingClosure: Boolean(finding.pendingClosure), dialogue: finding.dialogue ?? [],
  };
}

// Resolves review.resume or review.replaces against the run record. Returns null for a fresh dispatch; otherwise the candidates to
// run, the continuation the receipt records, the context the prompt carries, and for a skeptic's dialogue turn its assigned findings.
function resolveContinuation(root, state, target, review) {
  const requestId = review.resume ?? review.replaces;
  if (requestId === undefined) return null;
  const { worker, receipt } = continuedDispatch(root, state, target, requestId);
  const kind = review.kind ?? 'code';
  requireCondition(receipt.kind === kind, 'wrong-review-kind', `The named dispatch was a ${receipt.kind} assessment, not ${kind}`);
  requireCondition(kind !== 'skeptic' || review.dialogue, 'invalid-continuation', 'A skeptic is continued only for a dialogue turn; validate a new finding with a fresh skeptic');
  const lineage = lineageOf(receipt);
  const resumed = review.resume !== undefined;
  requireCondition(!resumed || !review.requiredModel || review.requiredModel === receipt.model, 'model-requirement', 'Explicit model requirements prohibit resuming a session of another model');
  // The thread total the receipt recorded is the starting total only while no later attempt has used the session since.
  const usedSince = state.workers.slice(state.workers.indexOf(worker) + 1).some(candidate => candidate.session === receipt.session);
  const continuation = { kind: resumed ? 'resumed' : 'replacement', requestId, lineage, ...(resumed ? { session: receipt.session, priorThreadTokens: usedSince ? null : receipt.threadTokens ?? null } : {}) };
  const candidates = resumed ? [{ host: receipt.host, model: receipt.model, effort: receipt.effort }] : review.candidates;
  const raised = finding => finding.raisedBy?.lineage === lineage;
  if (review.dialogue) {
    const named = review.dialogue.findingIds.map(id => target.findings.find(finding => finding.id === id));
    requireCondition(named.every(Boolean), 'unknown-finding', 'A dialogue turn names recorded findings');
    const owned = kind === 'skeptic' ? named.every(finding => finding.validation?.lineage === lineage) : named.every(raised);
    requireCondition(owned, 'foreign-finding', kind === 'skeptic' ? 'A skeptic discusses only findings its lineage validated' : 'A reviewer discusses only findings its lineage raised');
    return { candidates, continuation, continuationContext: { dialogueFindings: named.map(findingSummary) }, findings: kind === 'skeptic' ? named : [] };
  }
  const lastReport = target.reviews.filter(review => lineageOf(review) === lineage).at(-1)?.revision ?? -1;
  return {
    candidates, continuation, findings: [],
    continuationContext: {
      pendingClosures: target.findings.filter(finding => finding.pendingClosure?.lineage === lineage).map(findingSummary),
      dispositionsSince: target.findings.filter(finding => raised(finding) && (finding.dispositionRevision ?? -1) > lastReport).map(finding => ({ id: finding.id, localId: finding.localId, verdict: finding.validation?.verdict ?? null, disposition: finding.disposition, reason: finding.reason ?? null })),
      replacedFindings: resumed ? [] : target.findings.filter(raised).map(findingSummary),
    },
  };
}

module.exports = { continuesRecord, latestDispatchOf, lineageOf, resolveContinuation };
