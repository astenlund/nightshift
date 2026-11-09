'use strict';

const { isDeepStrictEqual } = require('node:util');
const { requireCondition } = require('./errors');
const { fresh, hash } = require('./evidence');
const { differences } = require('./applicability');

const SURFACE_VERDICTS = Object.freeze(['confirmed', 'refuted', 'unverified']);

const nonempty = value => typeof value === 'string' && value.trim() !== '';

function surfaceIdentity(surface) {
  return JSON.stringify([surface.path, surface.location.trim()]);
}

// Refuses a malformed entry before any identity is computed, and joins the evidence of entries that share one.
function consolidatedSurfaces(entries) {
  requireCondition(Array.isArray(entries), 'invalid-finding', 'A finding\'s surfaces are a list');
  const surfaces = new Map();
  for (const entry of entries) {
    requireCondition(entry !== null && typeof entry === 'object' && nonempty(entry.path) && typeof entry.location === 'string' && nonempty(entry.evidence), 'invalid-finding', 'A surface needs a nonempty path, a location string and nonempty evidence');
    const identity = surfaceIdentity(entry);
    const known = surfaces.get(identity);
    if (known) known.evidence += `\n${entry.evidence}`;
    else surfaces.set(identity, { path: entry.path, location: entry.location.trim(), evidence: entry.evidence });
  }

  return [...surfaces.values()];
}

function consolidatedBasis(basis) {
  requireCondition(Array.isArray(basis) && basis.every(nonempty), 'invalid-finding', 'A finding\'s basis is a list of nonempty paths');

  return [...new Set(basis)];
}

// A supplied claim has no recorded finding to take these from; an absent list is a claim without them.
function claimSurfaces(claim) {
  return {
    ...(claim.surfaces === undefined ? {} : { surfaces: consolidatedSurfaces(claim.surfaces) }),
    ...(claim.basis === undefined ? {} : { basis: consolidatedBasis(claim.basis) }),
  };
}

// What a saved finding's fields can be trusted to hold. Admission of new claims stays strict; a damaged record counts as naming nothing.
function wellFormedSurface(entry) {
  return entry !== null && typeof entry === 'object' && nonempty(entry.path) && typeof entry.location === 'string' && nonempty(entry.evidence);
}

function savedSurfaces(finding) {
  return Array.isArray(finding?.surfaces) && finding.surfaces.every(wellFormedSurface) ? finding.surfaces : [];
}

function savedBasis(finding) {
  return Array.isArray(finding?.basis) && finding.basis.every(nonempty) ? finding.basis : [];
}

function validateLeadSurfaces(finding) {
  consolidatedSurfaces(finding.surfaces);
  consolidatedBasis(finding.basis);
}

// The finding's verdict follows its surfaces, each judged by whether the alleged problem exists there.
function validateSurfaceAnswers(assigned, finding) {
  const answers = finding.surfaces ?? [];
  requireCondition(Array.isArray(answers) && answers.every(answer => answer !== null && typeof answer === 'object' && typeof answer.path === 'string' && typeof answer.location === 'string'), 'missing-validation', 'Each surface answer names its path and location');
  const expected = new Set(assigned.map(surfaceIdentity));
  const answered = answers.map(surfaceIdentity);
  requireCondition(new Set(answered).size === answered.length && answered.length === expected.size && answered.every(identity => expected.has(identity)), 'missing-validation', 'A skeptic answers every assigned surface exactly once and adds none');
  if (assigned.length === 0) return;
  requireCondition(answers.every(answer => SURFACE_VERDICTS.includes(answer.verdict) && nonempty(answer.evidence)), 'invalid-verdict', 'Each surface answer carries a verdict and its evidence');
  const count = verdict => answers.filter(answer => answer.verdict === verdict).length;
  const follows = count('unverified') > 0 ? 'unverified' : count('confirmed') > 0 ? 'confirmed' : 'refuted';
  requireCondition(finding.verdict === follows, 'invalid-verdict', `The finding verdict follows its surfaces and is ${follows} here`);
}

function namedPaths(finding) {
  return [...finding.surfaces.map(surface => surface.path), ...finding.basis];
}

// Resolved once at import, so a finding carried into a replaced closing record needs no later reader of its raising review.
// A spec review's finding is bound to that review's deciding inputs, whatever it names, since the wider copy is orientation.
function resolveScope(finding, review, specOrigin) {
  if (specOrigin) return review.snapshot.files.map(file => file.path);
  if (finding.surfaces.length === 0) return null;
  const context = new Set((review.contextSnapshot ?? review.snapshot).files.map(file => file.path));
  const named = namedPaths(finding);
  if (!named.every(file => context.has(file))) return null;
  const governing = Object.values(review.commitments ?? {}).map(value => value?.agreement?.spec).filter(nonempty);

  return [...new Set([...named, ...governing])].sort();
}

// What a finding records at import. One from before surfaces existed records nothing, and so has no scope.
function recordedSurfaces(finding, review, specOrigin) {
  if (finding.surfaces === undefined && finding.basis === undefined) return {};
  const surfaces = consolidatedSurfaces(finding.surfaces ?? []);
  const basis = consolidatedBasis(finding.basis ?? []);
  const scope = resolveScope({ surfaces, basis }, review, specOrigin);

  return { surfaces, basis, ...(scope ? { scope } : {}) };
}

// A saved scope is trusted only while it is well formed and agrees with the paths its finding names.
function scopeOf(finding) {
  const scope = finding?.scope;
  if (!Array.isArray(scope) || scope.length === 0 || !scope.every(nonempty)) return null;
  if (!Array.isArray(finding.surfaces) || !Array.isArray(finding.basis) || !finding.surfaces.every(wellFormedSurface) || !finding.basis.every(nonempty)) return null;
  if (finding.reviewKind === 'spec') return scope;
  if (finding.surfaces.length === 0) return null;

  return namedPaths(finding).every(file => scope.includes(file)) ? scope : null;
}

function intactSnapshot(snapshot) {
  return Array.isArray(snapshot?.files) && hash(JSON.stringify(snapshot.files)) === snapshot.digest;
}

function singleFile(file) {
  return { files: [file], digest: hash(JSON.stringify([file])) };
}

function changedFiles(root, files) {
  return files.filter(file => !fresh(root, singleFile(file))).map(file => file.path).sort();
}

// Whether a skeptic or dialogue receipt is still current for the findings an operation concerns, given as their scopes, null for a
// finding without one. Every carried snapshot must be intact first: otherwise the comparison cannot be established, whatever the kind.
function receiptCurrency(root, evidence, scopes = []) {
  const carried = [evidence.snapshot, ...(evidence.contextSnapshot === undefined || evidence.contextSnapshot === null ? [] : [evidence.contextSnapshot])];
  if (!carried.every(intactSnapshot)) return { current: false, established: false, changedPaths: null };
  const context = evidence.contextSnapshot;
  if (context && scopes.length > 0 && scopes.every(Boolean)) {
    const recorded = new Map(context.files.map(file => [file.path, file]));
    const wanted = [...new Set(scopes.flat())];
    if (wanted.every(file => recorded.has(file))) {
      const changed = changedFiles(root, wanted.map(file => recorded.get(file)));

      return { current: changed.length === 0, established: true, changedPaths: changed };
    }
  }
  const whole = fresh(root, evidence.snapshot) && (evidence.kind === 'spec' || !context || isDeepStrictEqual(evidence.snapshot, context) || fresh(root, context));
  if (whole) return { current: true, established: true, changedPaths: [] };
  const changes = [evidence.snapshot, ...(context && evidence.kind !== 'spec' ? [context] : [])].map(snapshot => differences(root, snapshot));

  return { current: false, established: true, changedPaths: changes.some(paths => paths === null) ? null : [...new Set(changes.flat())].sort() };
}

function currencyRefusal(subject, result) {
  if (!result.established) return `${subject} could not be compared: a recorded snapshot failed its integrity check (changed paths: null). Restore the receipt, or obtain new evidence on current inputs`;
  const named = result.changedPaths?.length ? result.changedPaths.join(', ') : 'unknown';

  return `${subject} no longer match their files; changed: ${named}. Restore those files' reviewed content, or obtain new evidence on current inputs`;
}

// The surface verdicts status names for a finding, or nothing before any were recorded.
function surfaceVerdicts(finding) {
  const answers = finding.validation?.surfaces;

  return Array.isArray(answers) && answers.length > 0 ? answers.map(surface => ({ path: surface?.path, location: surface?.location, verdict: surface?.verdict })) : null;
}

module.exports = { claimSurfaces, consolidatedSurfaces, currencyRefusal, intactSnapshot, receiptCurrency, recordedSurfaces, changedFiles, savedBasis, savedSurfaces, scopeOf, singleFile, surfaceVerdicts, validateLeadSurfaces, validateSurfaceAnswers };
