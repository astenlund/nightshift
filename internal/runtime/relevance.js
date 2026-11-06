'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { requireCondition, text } = require('./errors');
const { privateInputsCurrent, projectFile } = require('./evidence');
const { identity, inputChanges, missingSpecInputs, validRelevanceTaskIds } = require('./applicability');
const inputs = require('./review-inputs');

function relevanceBinding(relevance) {
  if (!relevance) return null;
  const binding = { ...relevance };
  delete binding.original;
  return binding;
}

function validateRelevanceBinding(value) {
  requireCondition(value && typeof value.requestId === 'string' && value.requestId.trim() && validRelevanceTaskIds(value.taskIds), 'invalid-relevance', 'Relevance names an original assessment and unique covered tasks');
}

function validateRelevanceRequest(options) {
  if (options.relevance === undefined || options.relevance === null) return;
  requireCondition(options.kind !== 'skeptic' && !options.dialogue && (options.resume !== undefined || options.replaces !== undefined || options.continuation), 'invalid-relevance', 'Relevance resumes or replaces a lead reviewer without a finding dialogue');
  validateRelevanceBinding(options.relevance);
}

// Cached source belongs to its immutable manifest, not the original worker's continuing presence.
// Legacy per-dispatch copies need their registered location; unavailable or unsafe copies permit no preservation.
function retainedSource(root, original, worker) {
  if (original.retainedInputs?.kind === 'cache-v1') return { source: null, ...inputs.load(root, original.retainedInputs, original.contextSnapshot) };
  const unavailable = reason => ({ source: null, available: false, reason });
  if (original.retainedInputs !== true) return unavailable(original.retainedInputsReason ?? 'Original inputs are not retained');
  if (typeof worker?.artifactDirectory !== 'string' || !worker.artifactDirectory.trim()) return unavailable('Original legacy input registration is unavailable');
  try {
    const source = path.posix.join(worker.artifactDirectory, 'inputs');
    const available = privateInputsCurrent(projectFile(root, source), original.contextSnapshot);
    return { source: available ? source : null, available, reason: available ? null : 'Original legacy source is missing or changed' };
  } catch (error) {
    return unavailable('Original legacy source cannot be read: ' + error.message);
  }
}

// All fields besides the original identity and selected tasks are controller-owned and rederived before dispatch.
function resolveRelevance(root, state, owner, requested) {
  validateRelevanceBinding(requested);
  const original = owner.reviews.find(review => review.requestId === requested.requestId && !review.relevance);
  requireCondition(original, 'unknown-assessment', 'Relevance names an imported assessment on this target');
  requireCondition(requested.taskIds.every(id => original.coveredTaskIds?.includes(id) && state.tasks.some(task => task.id === id)), 'foreign-assessment', 'Relevance names tasks covered by the original assessment');
  const changes = inputChanges(root, original, original.kind ?? (owner.kind === 'spec' ? 'spec' : 'code'));
  requireCondition(changes !== null, 'uncomparable-assessment', 'Reconcile the original assessment evidence before relevance');
  if ((original.kind ?? owner.kind) === 'spec') {
    const missing = missingSpecInputs(root, original);
    requireCondition(!missing.length, 'missing-spec', 'Restore the missing declared spec inputs, or reconcile the governing agreement and obtain a fresh assessment with revised deciding scope: ' + missing.join(', '));
  }
  const worker = state.workers.find(candidate => candidate.id === original.requestId);
  const available = retainedSource(root, original, worker);
  const source = available.source;
  return { requestId: original.requestId, originalHash: identity(original), taskIds: [...requested.taskIds], original: structuredClone(original), changes, source, originalInputsAvailable: available.available, originalInputsReason: available.available ? null : available.reason };
}

function prepareOriginal(root, relevance, workspace) {
  const context = path.join(workspace, 'context');
  fs.writeFileSync(path.join(context, 'original-assessment.json'), JSON.stringify(relevance.original));
  if (!relevance.originalInputsAvailable) return;
  if (relevance.original.retainedInputs?.kind === 'cache-v1') {
    const restored = inputs.restore(root, relevance.original.retainedInputs, relevance.original.contextSnapshot, path.join(workspace, 'original'));
    relevance.originalInputsAvailable = restored.available;
    relevance.originalInputsReason = restored.reason;
    return;
  }
  const source = projectFile(root, relevance.source);
  const restored = inputs.restoreLegacy(source, relevance.original.contextSnapshot, path.join(workspace, 'original'));
  relevance.originalInputsAvailable = restored.available;
  relevance.originalInputsReason = restored.reason;
}

function validateRelevanceReport(report, request) {
  validateRelevanceBinding(request?.relevance);
  const assigned = request.relevance.taskIds;
  requireCondition(Array.isArray(report?.coverage) && report.coverage.length === 0, 'invalid-relevance', 'A relevance decision does not claim new dimension coverage');
  requireCondition(Array.isArray(report.applicability) && report.applicability.length === assigned.length, 'missing-relevance', 'Relevance answers every assigned task');
  const answered = new Set();
  for (const answer of report.applicability) {
    requireCondition(assigned.includes(answer?.id) && !answered.has(answer.id), 'missing-relevance', 'Relevance answers each assigned task exactly once');
    answered.add(answer.id);
    requireCondition(['preserve', 'reassess', 'unresolved'].includes(answer.outcome), 'invalid-relevance', 'Unknown applicability outcome');
    text(answer.evidence, 'applicability.evidence');
    requireCondition(answer.outcome !== 'preserve' || request.relevance.originalInputsAvailable === true && report.status === 'complete', 'missing-assessment-inputs', 'Preserving applicability requires the original inputs and a completed relevance decision');
  }
}

function relevancePrompt(request, { workspace }) {
  return `Decide applicability of the original assessment to each named task on the supplied later inputs and commitments. This is a relevance decision, not a fresh assessment or finding closure. Read context/original-assessment.json and original/ when available under ${workspace}, alongside the current project and context. A replacement independently examines the basis. Missing evidence leaves the answer unresolved. Preserve only with a concrete reason explaining why affected coverage and interactions still apply; otherwise require reassessment or leave unresolved. New concrete findings use the ordinary finding shape. Leave coverage, closures and positions empty. Each applicability entry has id (the task id), outcome (preserve, reassess or unresolved) and evidence. Original assessment: ${request.relevance.requestId}. Named tasks: ${JSON.stringify(request.relevance.taskIds)}. Changed paths: ${JSON.stringify(request.relevance.changes)}. Original source available: ${request.relevance.originalInputsAvailable}. Source availability detail: ${request.relevance.originalInputsReason ?? (request.relevance.originalInputsAvailable ? 'available' : 'not available')}. Current commitments: ${JSON.stringify(request.commitments)}.`;
}

module.exports = { relevanceBinding, prepareOriginal, relevancePrompt, resolveRelevance, validateRelevanceReport, validateRelevanceRequest };
