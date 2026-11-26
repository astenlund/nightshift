'use strict';

const { randomUUID } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { bundledModel, normalizeModelText, projectModel } = require('./review-model');
const { hash } = require('./runtime/evidence');
const { requireCondition } = require('./runtime/errors');
const { safeDirectory } = require('./runtime/store');
const { replaceAtomically } = require('./template-text/storage');
const { BASELINE_PATH, STAGING_DIRECTORY, acquirePublicationLock, isDigest, preparePublication, preservedPolicy, previousMatches, publicationStillStaged, publishReviewModel, readPublicationJournal } = require('./review-model-publication');

function modelState(root, bundled = bundledModel()) {
  const project = projectModel(root);
  const saved = readPublicationJournal(root);
  const pending = saved.record?.pending;
  const preservedPrevious = pending?.publication ? preservedPolicy(root, pending.publication) : null;
  const previousVerified = !pending?.publication || previousMatches(root, pending.publication);
  const displacedChanged = Boolean(preservedPrevious && !previousVerified);
  const pendingApplied = Boolean(project && pending?.after === project.sha256 && previousVerified);
  const pendingUnapplied = Boolean(project && pending?.publication && !preservedPrevious &&
    project.sha256 === pending.publication.before && publicationStillStaged(root, pending.publication, pending.after));
  let baseline = saved.record?.baseline ?? null;
  // A write followed by a user edit can leave any other bytes, including the exact pre-merge bytes.
  if (pendingApplied) baseline = pending.baseline;
  else if (pending && !pendingUnapplied) baseline = null;
  const projectTextBaseline = pendingApplied ? modelTextDigest(project.bytes) : saved.record?.projectTextSha256;

  return { bundled, project, saved, baseline, projectTextBaseline, pendingApplied, pendingUnapplied, preservedPrevious, displacedChanged };
}

// Text comparison tolerates checkout conversions. Publication and recovery still bind exact bytes.
const modelTextDigest = bytes => hash(normalizeModelText(bytes.toString('utf8')));

function modelReport({ bundled, project, baseline, projectTextBaseline, saved, preservedPrevious, displacedChanged }) {
  const bundledText = normalizeModelText(bundled.text);
  const projectText = project && normalizeModelText(project.text);
  const matching = projectText === bundledText;
  // A known journal read failure prevents setup from establishing a baseline for absent or matching models.
  if (saved.readError !== undefined && (!project || matching)) {
    return { status: 'unavailable', reason: saved.readError };
  }
  if (preservedPrevious && (!project || displacedChanged)) return { status: 'recovery', preservedPrevious };
  if (!project) return { status: 'absent' };
  if (matching) return { status: 'matching' };
  if (baseline !== null) {
    const baselineText = normalizeModelText(baseline);
    if (bundledText === baselineText || modelTextDigest(project.bytes) === projectTextBaseline) return { status: 'preserved' };
  }

  return {
    status: baseline === null ? 'compare' : 'merge',
    baseline,
    ...(preservedPrevious ? { preservedPrevious } : {}),
    ...(saved.readError !== undefined ? { baselineUnavailableReason: saved.readError } : {}),
    project: { text: project.text, sha256: project.sha256 },
    bundled: { text: bundled.text, sha256: bundled.sha256 },
  };
}

function inspectReviewModel(root, bundled) {
  try { return modelReport(modelState(root, bundled)); }
  catch (error) { return { status: 'unavailable', reason: error.message }; }
}

function validateReviewModelDecision(decision) {
  requireCondition(decision === undefined || decision !== null && isDigest(decision.projectSha256) &&
    isDigest(decision.bundledSha256) && typeof decision.text === 'string', 'invalid-review-model-decision',
  'A review model merge needs the two compared SHA-256 values and the exact approved text');
}

function saveBaseline(root, saved, baseline, projectTextSha256, pending = null) {
  const previous = saved.record;
  if (previous && previous.baseline === baseline && previous.projectTextSha256 === projectTextSha256 && isDeepStrictEqual(previous.pending, pending)) return saved;
  safeDirectory(root, STAGING_DIRECTORY, true);
  const record = { schema: 1, journalId: randomUUID(), baseline, projectTextSha256, pending };
  const bytes = Buffer.from(JSON.stringify(record, null, 2) + String.fromCharCode(10));
  replaceAtomically(root, BASELINE_PATH, bytes, saved.bytes);

  return { record, bytes };
}

function applyUnderLock(root, decision, bundledSource) {
  let state;
  try { state = modelState(root, bundledSource); }
  catch (error) {
    if (decision !== undefined) throw error;

    return { status: 'unavailable', reason: error.message };
  }
  const { bundled, project, saved, baseline, projectTextBaseline, pendingApplied, pendingUnapplied } = state;
  const report = modelReport(state);
  if (saved.readError !== undefined) {
    requireCondition(decision === undefined, 'review-model-baseline-unavailable', `Cannot safely update the review model journal: ${saved.readError}`);

    return report;
  }
  if (report.status === 'recovery') {
    requireCondition(decision === undefined, 'review-model-recovery-required', `Reconcile the preserved review model at ${report.preservedPrevious} before applying a merge`);

    return report;
  }
  if (decision !== undefined) {
    requireCondition(['compare', 'merge'].includes(report.status) && project.sha256 === decision.projectSha256 && bundled.sha256 === decision.bundledSha256,
      'review-model-drift', 'Review model changed after comparison. Inspect again before applying a merge');
  }
  if (!project || decision !== undefined) {
    const bytes = project ? Buffer.from(decision.text, 'utf8') : bundled.bytes;
    const publication = preparePublication(root, project, bytes);
    const pending = { baseline: bundled.text, after: hash(bytes), publication };
    const journal = saveBaseline(root, saved, baseline, projectTextBaseline, pending);
    publishReviewModel(root, publication);
    saveBaseline(root, journal, pending.baseline, modelTextDigest(bytes));

    return project ? { status: 'merged', preservedPrevious: preservedPolicy(root, publication) } : { status: 'created' };
  }
  if (report.status === 'matching' || pendingApplied) {
    saveBaseline(root, saved, report.status === 'matching' ? bundled.text : baseline, modelTextDigest(project.bytes));
  } else if (pendingUnapplied) {
    saveBaseline(root, saved, baseline, projectTextBaseline);
  }

  return report;
}

function applyReviewModel(root, decision, bundledSource) {
  validateReviewModelDecision(decision);
  const directory = safeDirectory(root, STAGING_DIRECTORY, true);
  const lock = acquirePublicationLock(root, directory);
  try {
    return applyUnderLock(root, decision, bundledSource);
  } finally { lock.close(); }
}

module.exports = { applyReviewModel, inspectReviewModel, validateReviewModelDecision };
