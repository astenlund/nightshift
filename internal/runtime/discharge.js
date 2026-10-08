'use strict';

const { requireCondition } = require('./errors');
const progress = require('./progress');
const contexts = new WeakMap();

function begin(state, encode, active, bindings = {}) {
  contexts.set(state, { encode, active, registrations: new Map(), bindings });
}

function origin(state, occurrence) { return contexts.get(state)?.bindings[occurrence] ?? null; }

function inventory(state) {
  const result = new Map();
  const add = (occurrence, evidence, binding, parent) => {
    requireCondition(!result.has(occurrence), 'progress-evidence-unavailable', 'Closing evidence has a duplicated occurrence');
    const { progressBinding, progressOrigin, ...content } = evidence && typeof evidence === 'object' ? evidence : { value: evidence };
    result.set(occurrence, { occurrence, evidenceHash: progress.fingerprint(content), binding, parent, source: progressOrigin ?? null });
  };
  const closing = state.closing;
  if (!closing) return result;
  const bindings = closing.progressBindings ?? {};
  if (closing.retrospectiveEvidence) add('retrospective', closing.retrospectiveEvidence, bindings.retrospective, null);
  if (closing.reportEvidence) add('report', closing.reportEvidence, bindings.report, 'retrospective');
  if (closing.reportDelivery) add('delivery', closing.reportDelivery, bindings.delivery, 'report');
  if (closing.triageEvidence) add('triage', closing.triageEvidence, bindings.triage, 'retrospective');
  const record = closing.docs;
  if (record) {
    add('record', { id: record.id, kind: record.kind, baseline: record.baseline }, record.progressBinding, 'triage');
    for (const check of record.checks ?? []) {
      if (check.passed === true && !check.pending) add('check/' + (check.attemptId ?? progress.fingerprint({ name: check.name, snapshot: check.snapshot })), check, check.progressBinding, 'record');
    }
    for (const review of record.reviews ?? []) add('review/' + (review.requestId ?? progress.fingerprint(review)), review, review.progressBinding, 'record');
  }
  const findings = [...(record?.findings ?? []), ...(closing.carriedFindings ?? [])];
  for (const finding of findings) {
    const occurrence = 'finding/' + finding.id;
    const { validation, disposition, obligation, reason, route, dispositionRevision, repaired, repairRevision, pendingClosure, closures, dialogue, ...subject } = finding;
    add(occurrence, subject, finding.progressBinding, 'review/' + finding.raisedBy?.requestId);
    if (validation) add(occurrence + '/validation', validation, validation.progressBinding, occurrence);
    if (disposition) add(occurrence + '/disposition', { disposition, obligation, reason, route }, finding.progressBinding, occurrence);
    if (repaired) add(occurrence + '/repair', { repaired, repairRevision }, finding.progressBinding, occurrence);
    if (pendingClosure) add(occurrence + '/pending', pendingClosure, pendingClosure.progressBinding, occurrence);
    for (const closure of closures ?? []) add(occurrence + '/closure/' + closure.requestId, closure, closure.progressBinding, occurrence);
  }
  return result;
}

function capture(state) {
  const context = contexts.get(state);
  return context ? inventory(context.encode(state)) : new Map();
}

function register(state, occurrence) {
  const context = contexts.get(state);
  if (!context) return;
  requireCondition(context.active(), 'progress-evidence-unavailable', 'Discharge capability expired outside its transaction');
  const fact = inventory(context.encode(state)).get(occurrence);
  requireCondition(fact, 'progress-evidence-unavailable', 'Admitted discharge has no candidate evidence');
  context.registrations.set(occurrence, structuredClone(fact));
}

function admittedAction(state, request, before) {
  const scalars = { retrospective: ['retrospective'], report: ['report'], 'report-delivered': ['delivery'], triage: ['triage', 'record'] };
  if (scalars[request.action]) {
    for (const occurrence of scalars[request.action]) if (capture(state).has(occurrence)) register(state, occurrence);
    return;
  }
  if (request.action === 'advance' && capture(state).has('retrospective') && !before.has('retrospective')) register(state, 'retrospective');
  if (request.taskId !== '#closing' || !['check', 'review', 'validate', 'dispose', 'repair'].includes(request.action)) return;
  for (const [occurrence, fact] of capture(state)) {
    if (!['check/', 'review/', 'finding/'].some(prefix => occurrence.startsWith(prefix))) continue;
    if (progress.fingerprint(before.get(occurrence)) !== progress.fingerprint(fact)) register(state, occurrence);
  }
}

function registrations(state, encoded) {
  const context = contexts.get(state);
  if (!context) return new Map();
  requireCondition(context.active(), 'progress-evidence-unavailable', 'Discharge capability expired');
  const facts = inventory(encoded);
  for (const [occurrence, admitted] of context.registrations) requireCondition(progress.fingerprint(admitted) === progress.fingerprint(facts.get(occurrence)), 'progress-evidence-unavailable', 'Candidate differs from the admitted discharge');
  return context.registrations;
}

module.exports = { begin, origin, inventory, capture, register, admittedAction, registrations };
