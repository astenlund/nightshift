'use strict';

const { requireCondition } = require('./store');

// The strong reviewer models a gated assessment admits: the minimum version of each family per host. Any later version of a listed
// family qualifies; another family, a lower version or an identifier outside its family's plain form does not.
const STRONG_MODEL_FLOORS = Object.freeze({
  claude: Object.freeze({ opus: Object.freeze([5, 5]), fable: Object.freeze([5, 1]) }),
  codex: Object.freeze({ sol: Object.freeze([6]), astra: Object.freeze([6]) }),
});

// Each host's plain identifier form. A version part has at most three digits and no leading zero, so a dated snapshot such as
// claude-opus-4-20250514, a variant such as gpt-6-sol-mini or any other suffix is not recognized.
const VERSION_PART = '(0|[1-9]\\d{0,2})';
const MODEL_FORMS = Object.freeze({
  claude: { pattern: new RegExp(`^claude-([a-z]+)-${VERSION_PART}(?:-${VERSION_PART})?$`), parse: match => ({ family: match[1], version: [match[2], match[3]] }) },
  codex: { pattern: new RegExp(`^gpt-${VERSION_PART}(?:\\.${VERSION_PART})?-([a-z]+)$`), parse: match => ({ family: match[3], version: [match[1], match[2]] }) },
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

function isStrongModel(host, model) {
  if (typeof host !== 'string' || typeof model !== 'string' || !Object.hasOwn(STRONG_MODEL_FLOORS, host)) return false;
  const match = MODEL_FORMS[host].pattern.exec(model);
  if (!match) return false;
  const { family, version } = MODEL_FORMS[host].parse(match);
  const floors = STRONG_MODEL_FLOORS[host];
  return Object.hasOwn(floors, family) && compareVersions(version.filter(part => part !== undefined).map(Number), floors[family]) >= 0;
}

// Refuses an assessment effort at max or above, or one no host names, before anything launches at it. recovery adds a next step.
function requirePermittedEffort(effort, recovery = '') {
  requireCondition(effort === undefined || PERMITTED_EFFORTS.includes(effort), 'effort-not-permitted', `Assessments run below max reasoning effort: use ${PERMITTED_EFFORTS.join(', ')}, or omit effort for high${recovery}`);
}

module.exports = { isStrongModel, requirePermittedEffort };
