'use strict';

const fs = require('node:fs');
const { REVIEW_MODEL_PATH, bundledModel, normalizeModelText, projectModel } = require('../review-model');
const { preservedPolicy, readPublicationJournal } = require('../review-model-publication');
const { hash, projectFile } = require('./evidence');
const { requireCondition, RunError, text } = require('./errors');

function reviewModelOverride(agreement) {
  if (agreement?.reviewModelOverride === undefined) return null;

  return text(agreement.reviewModelOverride, 'agreement.reviewModelOverride');
}

function readEffectiveProjectModel(root) {
  const observed = projectModel(root);
  if (observed) return observed;

  const before = readPublicationJournal(root);
  const current = projectModel(root);
  if (current) return current;

  const after = readPublicationJournal(root);
  requireCondition((before.record || before.bytes === null) && (after.record || after.bytes === null), 'review-model-unavailable', 'Establish the review model setup journal before selecting a fallback');
  const sameJournal = before.bytes === null ? after.bytes === null : after.bytes !== null && before.bytes.equals(after.bytes);
  requireCondition(sameJournal, 'review-model-unavailable', 'Review model setup changed during model selection');
  const pending = after.record?.pending?.publication;
  const preserved = pending && preservedPolicy(root, pending);
  requireCondition(!preserved, 'review-model-unavailable', `Resolve the preserved project review policy at ${preserved} before selecting a fallback`);
  requireCondition(!pending || pending.before === null, 'review-model-unavailable', 'Wait for the pending review model publication before selecting a fallback');

  return null;
}

function captureReviewModel(root, tasks) {
  try {
    const project = readEffectiveProjectModel(root);
    const model = project ?? bundledModel();

    return {
      source: project ? 'project' : 'bundled',
      text: model.text,
      scopes: tasks.map(task => {
        const override = reviewModelOverride(task.agreement);

        return { taskId: task.id, override, sha256: reviewModelScopeDigest(model.text, override) };
      }),
    };
  } catch (cause) {
    throw new RunError('review-model-unavailable', `Cannot establish the effective review model: ${cause.message}`);
  }
}

const reviewModelDigest = model => hash(JSON.stringify(model));

function reviewModelScopeDigest(text, override) {
  return reviewModelDigest({ text: normalizeModelText(text), override });
}

function usesDefaultReviewModel(model) {
  return model.source === 'bundled' || normalizeModelText(model.text) === normalizeModelText(bundledModel().text);
}

function originatingReviewModel(root, state, finding) {
  const worker = state.workers.find(candidate => candidate.id === finding?.raisedBy?.requestId);
  if (!worker?.reviewModelDigest) return null;

  const assignment = JSON.parse(fs.readFileSync(projectFile(root, `${worker.artifactDirectory}/request.json`), 'utf8'));
  requireCondition(assignment.id === worker.id && assignment.reviewModel && reviewModelDigest(assignment.reviewModel) === worker.reviewModelDigest,
    'changed-assignment', 'The finding\'s original review model differs from its recorded assignment');

  return assignment.reviewModel.current;
}

function reviewModelsForFindings(root, state, findings) {
  const groups = new Map();
  for (const finding of new Set(findings.filter(Boolean))) {
    const origin = finding.raisedBy?.requestId;
    if (!groups.has(origin)) groups.set(origin, { findingIds: [], model: originatingReviewModel(root, state, finding) });
    groups.get(origin).findingIds.push(finding.id);
  }

  return [...groups.values()];
}

function reviewModelInputChange(root, review) {
  const previous = review.reviewModel?.current;
  try {
    const current = captureReviewModel(root, []);
    if (!previous) return usesDefaultReviewModel(current) ? [] : [REVIEW_MODEL_PATH];

    return normalizeModelText(previous.text) === normalizeModelText(current.text) ? [] : [REVIEW_MODEL_PATH];
  } catch {
    // Status can report unavailable review inputs without treating the previous assessment as current.
    return null;
  }
}

function reviewModelBrief(reviewModel) {
  if (!reviewModel) return '';

  return 'Review model for this assignment. Apply it within the accepted commitments and mandatory review and verification obligations. ' +
    'Task overrides apply only to the named task. For assigned original findings, use their recorded models to judge the original claim. ' +
    'A lead may report an observation outside the applicable model as advisory with required set to false. ' +
    'For relevance, compare the original and current model and judge whether a deciding boundary or review coverage changed, including omissions in a clean assessment. ' +
    'A null prior means the original assessment carries no captured model. Judge its recorded coverage against the current requirements and model.' +
    String.fromCharCode(10) + JSON.stringify(reviewModel, null, 2) + String.fromCharCode(10);
}

module.exports = { captureReviewModel, reviewModelsForFindings, reviewModelBrief, reviewModelDigest, reviewModelInputChange, reviewModelOverride, reviewModelScopeDigest, usesDefaultReviewModel };
