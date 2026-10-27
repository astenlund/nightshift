'use strict';

const { requireCondition } = require('./store');

const BOTH_ROLES = Object.freeze(['lead', 'skeptic']);
const family = (floor, roles = BOTH_ROLES) => Object.freeze({ floor: Object.freeze(floor), roles });

// The strong reviewer models a gated assessment admits: the minimum version of each family per host and the roles it is admitted
// for. Any later version of a listed family qualifies; another family, a lower version or an identifier outside its family's plain
// form does not. GLM on Vibe leads assessments but never validates findings as a skeptic, the role that filters noise.
const ADMITTED_FAMILIES = Object.freeze({
  claude: Object.freeze({ opus: family([5, 5]), fable: family([5, 1]) }),
  codex: Object.freeze({ sol: family([6]), astra: family([6]) }),
  vibe: Object.freeze({ glm: family([5, 3], Object.freeze(['lead'])) }),
});

// Each host's plain identifier form. A version part has at most three digits and no leading zero, so a dated snapshot such as
// claude-opus-4-20250514, a variant such as gpt-6-sol-mini or any other suffix is not recognized.
const VERSION_PART = '(0|[1-9]\\d{0,2})';
const MODEL_FORMS = Object.freeze({
  claude: { pattern: new RegExp(`^claude-([a-z]+)-${VERSION_PART}(?:-${VERSION_PART})?$`), parse: match => ({ family: match[1], version: [match[2], match[3]] }) },
  codex: { pattern: new RegExp(`^gpt-${VERSION_PART}(?:\\.${VERSION_PART})?-([a-z]+)$`), parse: match => ({ family: match[3], version: [match[1], match[2]] }) },
  vibe: { pattern: new RegExp(`^([a-z]+)-${VERSION_PART}(?:-${VERSION_PART})?$`), parse: match => ({ family: match[1], version: [match[2], match[3]] }) },
});

// Reasoning effort a runtime-launched assessment may use: every level below max. An omitted effort takes the host default, high.
const PERMITTED_EFFORTS = Object.freeze(['low', 'medium', 'high', 'xhigh']);

// Compares dotted versions part by part, reading a missing part as zero, so 6 equals 6.0 and precedes 6.1.
function compareVersions(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

// The role an assessment kind fills: a skeptic validates findings, and every other kind, an omitted one included, leads.
function roleFor(kind) {
  return kind === 'skeptic' ? 'skeptic' : 'lead';
}

// The version parts of a host's plain identifier, or null when it is not one.
function parseModel(host, model) {
  if (typeof host !== 'string' || typeof model !== 'string' || !Object.hasOwn(MODEL_FORMS, host)) return null;
  const match = MODEL_FORMS[host].pattern.exec(model);
  if (!match) return null;
  const { family: name, version } = MODEL_FORMS[host].parse(match);

  return { family: name, version: version.filter(part => part !== undefined).map(Number) };
}

function isAdmittedModel(host, model, role) {
  const parsed = parseModel(host, model);
  if (!parsed || !Object.hasOwn(ADMITTED_FAMILIES[host], parsed.family)) return false;
  const admitted = ADMITTED_FAMILIES[host][parsed.family];

  return admitted.roles.includes(role) && compareVersions(parsed.version, admitted.floor) >= 0;
}

// Refuses a model the role does not admit, naming the role, before anything launches or imports.
function requireAdmittedModel(host, model, kind) {
  const role = roleFor(kind);
  requireCondition(isAdmittedModel(host, model, role), 'review-strength', `This gate requires a supported strong reviewer model admitted for the ${role} role`);
}

// Refuses an assessment effort at max or above, or one no host names, before anything launches at it. recovery adds a next step.
function requirePermittedEffort(effort, recovery = '') {
  requireCondition(effort === undefined || PERMITTED_EFFORTS.includes(effort), 'effort-not-permitted', `Assessments run below max reasoning effort: use ${PERMITTED_EFFORTS.join(', ')}, or omit effort for high${recovery}`);
}

module.exports = { compareVersions, isAdmittedModel, parseModel, requireAdmittedModel, requirePermittedEffort, roleFor };
