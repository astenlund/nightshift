'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { isDeepStrictEqual } = require('node:util');
const { DIMENSIONS, commitmentsFor } = require('./lifecycle');
const { requireCondition, safeDirectory, text } = require('./store');
const { fileIdentity, fresh, hash, inventorySnapshot, projectFile, snapshot } = require('./evidence');
const { codexModelContradiction, runAgent } = require('./hosts');
const { writeJson, writeText } = require('./artifacts');
const { PROBE_TIMEOUT_CAP_MS, PROBE_TIMEOUT_FLOOR_MS, loadProbeEvidence } = require('./probes');
const { createPrivateCopyDirectory, isPrivateCopyDirectory } = require('./copies');
const { continuesRecord, lineageOf } = require('./continuation');
const { workerEnvironment } = require('../releases/entry');
const { timeLeft } = require('./limits');

const STRONG_MODELS = Object.freeze({ claude: ['claude-fable-5-1'], codex: ['gpt-6-astra'] });
const DEFAULT_REVIEW_TIMEOUT_MS = 900000;
// Failures that end a dispatch at once rather than passing to the next candidate.
const DISPATCH_ABORTING_FAILURES = Object.freeze(['review-input-drift', 'snapshot-drift', 'unsafe-path', 'inventory-failed', 'file-identity-unavailable', 'conflicting-review-paths', 'invalid-review-paths', 'resource-limit', 'operation-time-limit', 'termination-unverified']);
// Failures that do not concern a resumed session, which keep their own codes when a resume fails.
const SESSION_INDEPENDENT_FAILURES = Object.freeze([...DISPATCH_ABORTING_FAILURES, 'nonindependent-worker', 'host-start-failed']);
const PROBE_TIMEOUT_RULE = `timeoutMs is in milliseconds, from ${PROBE_TIMEOUT_FLOOR_MS} to ${PROBE_TIMEOUT_CAP_MS}; allow for the command's full expected duration.`;

const DIMENSION_BRIEFS = Object.freeze({
  'intent-scope-acceptance': 'Does the spec express the desired outcome, consequential behavior, boundaries and evidence of success?',
  'soundness-integration': 'Can the approach satisfy the commitments in the actual project and operating environment, with real dependencies and assumptions?',
  'failure-safety-recovery': 'Are consequential failure outcomes, trust/data boundaries, concurrency and recovery expectations understood?',
  'clarity-consistency-proportionality': 'Are commitments and important reasoning understandable without contradictions, missing decisions or unnecessary prescription?',
  'requirements-ux': 'Does the flow fulfill agreed behavior and constraints, with usable and understandable interactions and relevant accessibility?',
  'correctness-integration': 'Does it work through normal, boundary, concurrent and failure cases, including callers, state transitions, wiring and sibling paths?',
  'security-data-safety': 'Are permissions, trust boundaries, confidentiality, data integrity, preservation and recovery respected?',
  'design-maintainability': 'Are local code and overall system decomposition proportionate and understandable? Check local clarity, ownership, reuse and duplication, and system module boundaries, dependency direction, shared contracts and coupling.',
  'performance-resources': 'Does the change avoid consequential latency, throughput, resource or operating-cost problems under realistic conditions?',
  'tests-evidence': 'Do meaningful assertions and realistic execution establish the behavior across the other lenses, and expose remaining uncertainty without mandating a separate verifier?',
  'claim-accuracy': 'Does each changed or affected claim match the code, records and evidence it describes, at the version it names?',
  'sweep-completeness': 'Which documentation, changed or not, did the cumulative change leave stale, contradictory or missing, including navigable references and history moves?',
  'backlog-conventions': 'Do backlog changes follow the project\'s documented grammar, dependency, history and retirement conventions? Parser validity itself is evidenced by the controller\'s recorded ready parser check.',
  'sibling-consistency': 'Does the documentation agree with sibling entries, index excerpts and their records, and history files?',
  'proportionality': 'Is depth proportionate to importance, with useful reasoning and evidence preserved and nothing overstated or described as current before it exists?',
});

// The assessment lens: a skeptic takes the lens of the findings it validates, so docs findings are judged as documentation.
function lensFor(options) {
  if (options.kind === 'skeptic') return options.lens ?? 'code';
  return options.kind === 'spec' || options.kind === 'docs' ? options.kind : 'code';
}

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, windowsHide: true, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 30000 });
  requireCondition(!result.error && result.status === 0, 'git-failed', result.error?.message ?? result.stderr);
  return result.stdout;
}

function resolveExclusions(root, excluded, baseSha) {
  if (excluded.length === 0) return [];
  const known = new Set([
    ...git(root, ['ls-files', '-z', '--cached']).split('\0'),
    ...git(root, ['ls-tree', '-r', '-z', '--name-only', baseSha]).split('\0'),
  ].filter(Boolean));
  const identities = new Map();
  const identity = file => {
    if (!identities.has(file)) identities.set(file, fileIdentity(root, file));
    return identities.get(file);
  };
  const resolved = new Set();
  for (const file of excluded) {
    const entry = identity(file);
    requireCondition(!entry.directory, 'invalid-review-paths', 'Exclusions must name individual file entries, not directories');
    requireCondition(entry.exists || known.has(file), 'unresolved-review-exclusion', 'An absent exclusion requires its exact path from the Git index or immutable review base');
    resolved.add(file);
    // Git diff uses recorded spelling, including paths absent from the working tree.
    for (const candidate of known) if (identity(candidate).key === entry.key) resolved.add(candidate);
  }
  return [...resolved].sort();
}

function validateBase(root, baseSha) {
  requireCondition(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(baseSha), 'invalid-base', 'Review needs an immutable cumulative Git base: the full 40- or 64-digit lowercase hexadecimal object name, not an abbreviation or ref');
  git(root, ['cat-file', '-e', baseSha + '^{tree}']);
}

const REQUEST_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const DIALOGUE_POSITIONS = Object.freeze(['maintain', 'revise', 'withdraw']);

// The shape of the continuation fields a controller supplies: resume or replace an earlier dispatch, optionally for a dialogue
// turn, and acknowledgements for any dispatch. Whether the named dispatch can be continued is decided against the run record.
function validateContinuationRequest(options) {
  for (const field of ['resume', 'replaces']) {
    requireCondition(options[field] === undefined || typeof options[field] === 'string' && REQUEST_ID.test(options[field]), 'invalid-continuation', `review.${field} names the request id of an earlier dispatch`);
  }
  requireCondition(options.resume === undefined || options.replaces === undefined, 'invalid-continuation', 'A dispatch either resumes a session or replaces one, never both');
  if (options.dialogue !== undefined) {
    requireCondition(options.resume !== undefined || options.replaces !== undefined, 'invalid-dialogue', 'A dialogue turn resumes its participant, or replaces one that cannot be resumed');
    const dialogue = options.dialogue;
    requireCondition(dialogue !== null && typeof dialogue === 'object' && Object.keys(dialogue).every(key => ['findingIds', 'message'].includes(key)), 'invalid-dialogue', 'review.dialogue holds findingIds and message');
    requireCondition(Array.isArray(dialogue.findingIds) && dialogue.findingIds.length > 0, 'invalid-dialogue', 'A dialogue turn names the findings it concerns');
    const ids = dialogue.findingIds.map(id => text(id, 'review.dialogue.findingIds'));
    requireCondition(new Set(ids).size === ids.length, 'invalid-dialogue', 'Dialogue finding identities must be unique');
    text(dialogue.message, 'review.dialogue.message');
  }
  if (options.acknowledgements !== undefined) {
    requireCondition(Array.isArray(options.acknowledgements), 'invalid-acknowledgements', 'review.acknowledgements is a list of settled statements');
    options.acknowledgements.forEach(statement => text(statement, 'review.acknowledgements'));
  }
}

function validateRequest(options) {
  text(options?.requirements, 'review.requirements');
  text(options?.rules, 'review.rules');
  requireCondition(options.kind === undefined || ['code', 'spec', 'docs', 'skeptic'].includes(options.kind), 'invalid-review-kind', 'Unknown independent assessment kind');
  for (const field of ['artifactPaths', 'excludedPaths']) {
    requireCondition(options[field] === undefined || Array.isArray(options[field]) && options[field].every(file => typeof file === 'string' && file.trim()), 'invalid-review-paths', `${field} must contain project-relative file paths`);
  }
  requireCondition(!(options.artifactPaths ?? []).some(file => options.excludedPaths?.includes(file)), 'conflicting-review-paths', 'An explicitly selected artifact cannot also be excluded');
  requireCondition(options.timeoutMs === undefined || Number.isSafeInteger(options.timeoutMs) && options.timeoutMs > 0, 'invalid-request', 'review.timeoutMs is the per-attempt limit in milliseconds and must be a positive integer');
  validateContinuationRequest(options);
  // A resumed dispatch continues its recorded host, model and effort, which the runtime supplies once it resolves the session.
  if (options.resume !== undefined && options.continuation === undefined) {
    requireCondition(options.candidates === undefined && options.substitutionReason === undefined, 'invalid-continuation', 'A resumed dispatch continues the recorded host, model and effort of its session; supply no candidates or substitution reason');
  } else {
    const candidates = options.candidates;
    requireCondition(Array.isArray(candidates) && candidates.length > 0, 'missing-model', 'Controller must choose a permitted reviewer host and model');
    for (const candidate of candidates) {
      requireCondition(candidate !== null && typeof candidate === 'object' && Object.keys(candidate).every(key => ['host', 'model', 'effort'].includes(key)), 'invalid-model-selection', 'Model selection cannot replace the trusted host executable or its process policy');
      requireCondition(STRONG_MODELS[candidate.host]?.includes(candidate.model), 'review-strength', 'This gate requires a supported strong reviewer model');
    }
    requireCondition(!options.requiredModel || candidates.every(candidate => candidate.model === options.requiredModel), 'model-requirement', 'Explicit model requirements prohibit fallback to another model');
    // A fallback records why it replaced the preferred reviewer, so the reason must exist before any attempt starts.
    if (candidates.length > 1) text(options.substitutionReason, 'review.substitutionReason');
  }
  if (options.kind === 'skeptic') {
    const findings = options.findings ?? [];
    requireCondition(Array.isArray(findings), 'invalid-skeptic-assignment', 'Skeptic findings must be an array');
    const ids = findings.map(finding => text(finding?.id, 'assigned finding.id'));
    requireCondition(new Set(ids).size === ids.length, 'invalid-skeptic-assignment', 'Assigned finding identities must be unique');
  }
}

// What a skeptic is assigned: each finding's claim as its reviewer raised it. A saved record also carries the run's bookkeeping, such as
// a validation snapshot of the whole project inventory, which would otherwise grow every skeptic request and prompt with the project.
const CLAIM_FIELDS = Object.freeze(['id', 'localId', 'severity', 'required', 'consequence', 'evidence', 'relatedTo']);

function assignedClaim(finding) {
  return Object.fromEntries(CLAIM_FIELDS.filter(field => finding[field] !== undefined).map(field => [field, finding[field]]));
}

// A list of exactly one entry per named identity; an empty set admits no entries.
function boundList(ids, properties, required) {
  const id = ids.length ? { type: 'string', enum: ids } : { type: 'string' };

  return { type: 'array', items: { type: 'object', additionalProperties: false, properties: { id, ...properties }, required: ['id', ...required] }, minItems: ids.length, maxItems: ids.length };
}

// The report a dispatch must return. shape.closures lists the findings a continued lead reports closure for, and shape.dialogue
// the findings a lead's dialogue turn answers; a skeptic's dialogue turn returns ordinary verdicts over its assigned findings.
function schemaFor(kind, requestId, assignedFindings = [], shape = {}) {
  const scalar = { type: 'string' };
  const assignedIds = kind === 'skeptic' ? assignedFindings.map(finding => finding.id) : [];
  const leadDialogue = kind !== 'skeptic' && Array.isArray(shape.dialogue);
  const finding = kind === 'skeptic'
    ? { type: 'object', additionalProperties: false, properties: { id: assignedIds.length ? { type: 'string', enum: assignedIds } : scalar, verdict: { type: 'string', enum: ['confirmed', 'refuted', 'unverified'] }, evidence: scalar, value: scalar, repairProposal: scalar }, required: ['id', 'verdict', 'evidence', 'value', 'repairProposal'] }
    : { type: 'object', additionalProperties: false, properties: { id: scalar, severity: { type: 'string', enum: ['critical', 'important', 'minor'] }, consequence: scalar, evidence: scalar, required: { type: 'boolean' } }, required: ['id', 'severity', 'consequence', 'evidence', 'required'] };
  const findingBounds = kind === 'skeptic' ? { minItems: assignedIds.length, maxItems: assignedIds.length } : leadDialogue ? { maxItems: 0 } : {};
  const extra = {
    ...(kind !== 'skeptic' && !leadDialogue && Array.isArray(shape.closures) ? { closures: boundList(shape.closures, { closed: { type: 'boolean' }, evidence: scalar }, ['closed', 'evidence']) } : {}),
    ...(leadDialogue ? { positions: boundList(shape.dialogue, { position: { type: 'string', enum: DIALOGUE_POSITIONS }, evidence: scalar }, ['position', 'evidence']) } : {}),
  };
  return {
    type: 'object', additionalProperties: false,
    properties: {
      requestId: { type: 'string', enum: [requestId] }, status: { type: 'string', enum: ['complete', 'incomplete'] },
      coverage: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { dimension: scalar, evidence: scalar }, required: ['dimension', 'evidence'] } },
      findings: { type: 'array', items: finding, ...findingBounds }, summary: scalar,
      probes: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
        id: scalar, purpose: scalar, executable: scalar, args: { type: 'array', items: scalar }, timeoutMs: { type: 'integer', minimum: PROBE_TIMEOUT_FLOOR_MS, maximum: PROBE_TIMEOUT_CAP_MS, description: PROBE_TIMEOUT_RULE },
        files: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { path: scalar, content: scalar }, required: ['path', 'content'] } },
      }, required: ['id', 'purpose', 'executable', 'args', 'timeoutMs', 'files'] } },
      ...extra,
    },
    required: ['requestId', 'status', 'coverage', 'findings', 'summary', 'probes', ...Object.keys(extra)],
  };
}

function parseReport(output) {
  if (output !== null && typeof output === 'object') return output;
  text(output, 'review output');
  return JSON.parse(output.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, ''));
}

function validateReport(report, request) {
  requireCondition(report?.requestId === request.id && ['complete', 'incomplete'].includes(report.status), 'wrong-result', 'Report is missing its request identity or completion status');
  requireCondition(Array.isArray(report.findings) && Array.isArray(report.coverage), 'invalid-result', 'Report lacks findings or coverage');
  text(report.summary, 'report.summary');
  requireCondition(report.probes === undefined || Array.isArray(report.probes), 'invalid-probe', 'Requested probes must be an array');
  requireCondition(!report.probes?.length || report.status === 'incomplete', 'incomplete-evidence', 'An assessment needing probe evidence must remain incomplete');
  const probeIds = new Set();
  for (const probe of report.probes ?? []) {
    text(probe.id, 'probe.id');
    text(probe.purpose, 'probe.purpose');
    requireCondition(!probeIds.has(probe.id), 'duplicate-probe', 'Probe identities must be unique within the assignment');
    probeIds.add(probe.id);
  }
  const ids = new Set();
  for (const finding of report.findings) {
    text(finding.id, 'finding.id');
    text(finding.evidence, 'finding.evidence');
    requireCondition(!ids.has(finding.id), 'duplicate-finding', 'Report repeats a finding identity');
    ids.add(finding.id);
    if (request.kind === 'skeptic') {
      requireCondition(['confirmed', 'refuted', 'unverified'].includes(finding.verdict), 'invalid-verdict', 'Invalid skeptic verdict');
      text(finding.value, 'finding.value');
      // Every confirmed verdict carries the approach a repair would take, whatever the skeptic recommends about implementing it.
      if (finding.verdict === 'confirmed') text(finding.repairProposal, 'finding.repairProposal');
    } else {
      text(finding.consequence, 'finding.consequence');
      requireCondition(['critical', 'important', 'minor'].includes(finding.severity) && typeof finding.required === 'boolean', 'invalid-finding', 'Finding needs severity and obligation assessment');
    }
  }
  if (request.kind === 'skeptic') requireCondition(request.findings.length === ids.size && request.findings.every(finding => ids.has(finding.id)), 'missing-validation', 'Skeptic must evaluate every assigned finding exactly once');
  else if (request.dialogue) validatePositions(report, request);
  else {
    if (request.continues) validateClosures(report, request);
    if (report.status === 'complete') requireCondition(request.dimensions.every(dimension => report.coverage.some(item => item.dimension === dimension && typeof item.evidence === 'string' && item.evidence.trim())), 'partial-coverage', 'Complete review must cover every dimension with evidence');
  }
  return report;
}

// A continued lead reports exactly one closure per finding of its reviewer pending closure when it was dispatched. A finding it
// does not close is reported again under its local identity in a complete report, so the remaining problem is itself a finding.
function validateClosures(report, request) {
  const pending = request.pendingClosures ?? [];
  requireCondition(Array.isArray(report.closures) && report.closures.length === pending.length, 'missing-closure', 'A continued lead reports exactly one closure per finding pending closure');
  const named = new Set();
  for (const closure of report.closures) {
    const finding = pending.find(item => item.id === closure?.id);
    requireCondition(finding && !named.has(closure.id), 'missing-closure', 'Closures name each finding pending closure exactly once');
    named.add(closure.id);
    requireCondition(typeof closure.closed === 'boolean', 'invalid-closure', 'A closure states whether the finding is closed');
    text(closure.evidence, 'closure.evidence');
    if (!closure.closed && report.status === 'complete') requireCondition(report.findings.some(item => item.id === finding.localId), 'unmatched-closure', `A finding left open is reported again as finding ${finding.localId}`);
  }
}

// A lead's dialogue turn answers each named finding once and raises no new findings; it is evidence, not an assessment.
function validatePositions(report, request) {
  const named = request.dialogue.findingIds;
  requireCondition(report.findings.length === 0, 'invalid-dialogue-reply', 'A dialogue reply raises no findings');
  requireCondition(Array.isArray(report.positions) && report.positions.length === named.length, 'missing-position', 'A dialogue reply answers every named finding');
  const answered = new Set();
  for (const position of report.positions) {
    requireCondition(named.includes(position?.id) && !answered.has(position.id), 'missing-position', 'A dialogue reply answers each named finding exactly once');
    answered.add(position.id);
    requireCondition(DIALOGUE_POSITIONS.includes(position.position), 'invalid-position', `A dialogue position is one of ${DIALOGUE_POSITIONS.join(', ')}`);
    text(position.evidence, 'position.evidence');
  }
}

// How a dispatch begins: a fresh reviewer, one continuing its own session in a new copy, or one standing in for a lost session.
function opening(request, role, workspace) {
  const continued = request.continues;
  const location = workspace ? `at ${workspace}, which is your current working directory` : 'in your current working directory';
  if (continued?.kind === 'resumed') return `You are continuing your own earlier work as the ${role} in this session (request ${continued.requestId}). This dispatch gives you a new private copy of the project ${location}: read context/diff.patch, context/manifest.json and project/ there. Copies from your earlier turns, in any other directory, are stale; do not read them.`;
  if (continued?.kind === 'replacement') return `You are a fresh independent ${role} standing in for the ${role} of request ${continued.requestId}, whose session cannot be resumed; its record follows.`;
  return `You are a fresh independent ${role}.`;
}

function listing(title, items) {
  return items.length === 0 ? '' : `${title}\n${JSON.stringify(items, null, 2)}\n`;
}

// The continuation material a lead receives: its findings pending closure and the closure rule, the dispositions recorded since
// its last report, and for a replacement the whole record of the reviewer it stands in for.
function continuationBrief(request) {
  const context = request.continuationContext ?? {};
  const closure = 'For each finding listed as pending closure, return exactly one closures entry {id, closed, evidence}: closed true when the repair resolves it or it no longer applies, with the deciding evidence; closed false when it does not, and then report the remaining problem again as a finding whose id is that finding\'s localId. Besides closures, assess the complete supplied artifact and cumulative change across every dimension, as any lead does.\n';
  return listing('Findings pending closure: repaired since they were raised, and not yet verified by their reviewer.', context.pendingClosures ?? [])
    + listing('Dispositions recorded since your last imported report.', context.dispositionsSince ?? [])
    + listing('The record of the reviewer you stand in for: its findings with their verdicts, dispositions and repair state.', context.replacedFindings ?? [])
    + closure;
}

function dialogueBrief(request) {
  const findings = request.continuationContext?.dialogueFindings ?? [];
  const reply = request.kind === 'skeptic'
    ? 'Return a verdict for each assigned finding as before, with its evidence, value and repairProposal; you may keep or change your earlier verdict.'
    : 'For each named finding return one positions entry: maintain it, revise it (say how in evidence) or withdraw it, with the deciding evidence. Return empty findings and coverage arrays.';
  return `This is a dialogue turn, not a new assessment. The controller relays the exchange between the reviewer that raised these findings and the skeptic that validated them, and decides every disposition itself. Message from the controller:\n${request.dialogue.message}\n\n` + listing('The findings in question, with their current verdicts and the dialogue so far.', findings) + reply + '\n';
}

function acknowledgementBrief(request) {
  const statements = request.acknowledgements ?? [];
  return statements.length === 0 ? '' : `Recorded acknowledgements, settled by the governing requirement or the user. Do not raise them again; adjacent issues about how they are carried out remain in scope:\n${statements.map(statement => `- ${statement}`).join('\n')}\n`;
}

// workspace is the absolute directory of the dispatch's private copy, which a resumed reviewer is told by name.
function buildPrompt(request, { workspace } = {}) {
  const skeptic = request.kind === 'skeptic';
  const dialogue = Boolean(request.dialogue);
  const scope = skeptic ? 'Use the complete supplied artifact and cumulative change as context for validating the assigned claims and their affected siblings.' : 'Assess the complete supplied artifact and cumulative change, surrounding code and sibling paths.';
  const purpose = skeptic ? 'deciding each assigned claim' : dialogue ? 'answering the dialogue' : 'a credible broad assessment';
  const common = `${opening(request, skeptic ? 'skeptic' : 'strong lead reviewer', workspace)} ${scope} Reviewed files are immutable. Do not edit them, commit, or publish. Mutating probes require a separate isolated fixture; if tools cannot support a deciding check, report the missing evidence. Do not delegate unless the assignment explicitly includes peer dispatch. Report only concrete consequences with evidence; do not manufacture findings or prescribe unnecessary implementation detail.\n\nRequest: ${request.id}\nRequirements:\n${request.requirements}\n\nAll applicable review dimensions:\n${request.dimensions.join('\n')}\n\nRead context/diff.patch, context/manifest.json and the files in project/ as needed for ${purpose}. The full source snapshot is available. Prior fixes are included in the cumulative change and need surrounding/sibling coverage.\n`;
  const lead = 'Evaluate all dimensions without quotas or equal-depth narration. The author has not selected relevant dimensions. If the assignment is too large for credible coverage, return incomplete and describe the needed peer coverage. One underlying problem is one finding.\n';
  const documentation = 'This is a documentation review. The code in the cumulative change is context: judge what the documentation, including the backlog, says about it, not whether the code is correct. Report as a finding any changed file you judge to be operating instructions that agents load or are directed to follow during a run, such as skills, instruction files or runtime reference guidance, so the controller routes it to code assessment.\n';
  const proposal = 'For every confirmed verdict give repairProposal: the approach a repair would take, with enough reasoning to judge it and without a complete patch, whatever you recommend about implementing it. For a refuted or unverified verdict give an empty repairProposal unless a repair is still worth describing.\n';
  const skepticRole = `The assigned finding set is closed: return exactly one verdict for each supplied full id and retain that id verbatim. Validate each claim against concrete evidence, attempting refutation. Separate factual validity and practical value. Missing evidence is unverified. Evaluate whether it is worthwhile to implement, defer or skip, preserving agreed obligations. Unassigned observations belong in summary for separate controller routing and independent assessment before disposition; they are not assigned verdicts. ${proposal}Findings:\n${JSON.stringify(request.findings, null, 2)}\n`;
  const leadRole = (request.kind === 'docs' ? documentation : '') + lead + (request.continues ? continuationBrief(request) : '');
  const role = (skeptic ? skepticRole : '') + (dialogue ? dialogueBrief(request) : skeptic ? '' : leadRole);
  const definitions = request.dimensions.map(dimension => `${dimension}: ${DIMENSION_BRIEFS[dimension]}`).join('\n');
  const execution = `If a deciding claim needs execution unavailable in your read-only tools, request a bounded probe in probes, with its purpose, exact executable/args, timeout and ASCII fixture files. ${PROBE_TIMEOUT_RULE} The controller executes it in a separate private copy and returns raw command/output evidence for your independent assessment. Remain incomplete/unverified until that evidence is sufficient. A probe never authorizes canonical project repairs. Available returned probe evidence is under context/probes/.\n`;
  const fields = ['requestId', 'status', 'coverage', 'findings', 'probes', 'summary', ...(!skeptic && !dialogue && request.continues ? ['closures'] : []), ...(!skeptic && dialogue ? ['positions'] : [])];
  return common + definitions + '\n\n' + role + acknowledgementBrief(request) + execution + `\nReturn the requested structured report with ${fields.slice(0, -1).join(', ')} and ${fields.at(-1)}. Use an empty probes array when no execution evidence is missing.\n`;
}

// Whether the inputs an assessment judged are unchanged, before its dispatch returns and again at import. A spec assessment judged
// its governing artifacts, so edits elsewhere while it runs keep it, as they already do once it is imported; every other kind
// judged the whole context, which for them is the same evidence as their snapshot and so is read once.
function inputsUnchanged(root, kind, snapshot, contextSnapshot) {
  return fresh(root, snapshot) && (kind === 'spec' || isDeepStrictEqual(snapshot, contextSnapshot) || fresh(root, contextSnapshot));
}

async function dispatchReview(root, options, dependencies = {}) {
  const canonical = fs.realpathSync.native(root);
  validateRequest(options);
  validateBase(canonical, options.baseSha);
  const candidates = options.candidates;
  const directory = safeDirectory(canonical, '.nightshift/runs/reviews', true);
  const id = options.id ?? randomUUID();
  requireCondition(REQUEST_ID.test(id), 'invalid-dispatch', 'Dispatch identity must be a UUID');
  const target = path.join(directory, id);
  fs.mkdirSync(target);
  const workspace = createPrivateCopyDirectory(canonical);
  const project = path.join(workspace, 'project');
  const context = path.join(workspace, 'context');
  let processStarted = false;
  let terminationProven = false;
  try {
    fs.mkdirSync(project, { recursive: true });
    fs.mkdirSync(context);
    const excludedPaths = resolveExclusions(canonical, options.excludedPaths ?? [], options.baseSha);
    const includedPaths = [...new Set(options.artifactPaths ?? [])].sort();
    const contextSnapshot = inventorySnapshot(canonical, excludedPaths, includedPaths);
    const files = contextSnapshot.files.map(file => file.path);
    const captured = options.kind === 'spec' ? snapshot(canonical, options.artifactPaths) : contextSnapshot;
    if (options.kind === 'spec') requireCondition(captured.files.every(file => file.sha256 !== null), 'missing-spec', 'Whole-spec assessment requires the governing artifact to exist');
    const exclusionArgs = excludedPaths.map(file => `:(exclude,literal)${file}`);
    let diff = git(canonical, ['diff', '--no-ext-diff', '--binary', options.baseSha, '--', '.', ...exclusionArgs]);
    const untracked = git(canonical, ['ls-files', '-z', '--others', '--exclude-standard']).split('\0').filter(file => files.includes(file));
    for (const file of untracked) {
      const added = spawnSync('git', ['diff', '--no-index', '--no-ext-diff', '--binary', '--', '/dev/null', file], { cwd: canonical, windowsHide: true, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 30000 });
      requireCondition(!added.error && [0, 1].includes(added.status), 'diff-failed', added.error?.message ?? added.stderr);
      diff += added.stdout;
    }
    for (const file of contextSnapshot.files) {
      if (file.sha256 === null) continue;
      const destination = path.join(project, file.path);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(projectFile(canonical, file.path), destination, fs.constants.COPYFILE_EXCL);
    }
    requireCondition(fresh(canonical, contextSnapshot), 'snapshot-drift', 'Project changed while preparing the review');
    // The reviewer reads its own copy; the one beside the receipt survives clearing the disposable copies.
    const retained = path.join(target, 'context');
    fs.mkdirSync(retained);
    for (const directory of [context, retained]) {
      fs.writeFileSync(path.join(directory, 'diff.patch'), diff);
      writeJson(path.join(directory, 'manifest.json'), contextSnapshot);
    }
    const probeEvidence = loadProbeEvidence(canonical, options.probeEvidence, captured, contextSnapshot);
    if (probeEvidence.length > 0) {
      fs.mkdirSync(path.join(context, 'probes'));
      probeEvidence.forEach((evidence, index) => writeJson(path.join(context, 'probes', `${index + 1}.json`), evidence));
    }
    // A repository boundary prevents host discovery from walking into the controller's checkout.
    git(workspace, ['init', '--quiet']);
    const continuation = options.continuation ?? null;
    const request = {
      id, workspace: path.relative(canonical, workspace).split(path.sep).join('/'), runId: options.runId, taskId: options.taskId, coveredTaskIds: options.coveredTaskIds ?? [options.taskId], commitments: options.commitments ?? {}, resources: options.resources ?? null, controller: options.controller ?? null, kind: options.kind ?? 'code', requirements: text(options.requirements, 'review requirements'), dimensions: DIMENSIONS[lensFor(options)], findings: (options.findings ?? []).map(assignedClaim), snapshot: captured, contextSnapshot, baseSha: options.baseSha,
      // A continued dispatch belongs to the lineage of the reviewer it continues; a fresh one starts its own.
      continues: continuesRecord(continuation),
      lineage: continuation?.lineage ?? id,
      pendingClosures: (options.continuationContext?.pendingClosures ?? []).map(finding => ({ id: finding.id, localId: finding.localId })),
      dialogue: options.dialogue ?? null, acknowledgements: options.acknowledgements ?? [], continuationContext: options.continuationContext ?? null,
    };
    writeJson(path.join(target, 'request.json'), request);
    options.onPrepared?.(request);
    const systemFile = path.join(target, 'system.md');
    writeText(systemFile, 'You are an independent read-only engineering assessor. Follow the assignment and applicable user conventions. Use ASCII prose.\n\n' + text(options.rules, 'applicable rules'));
    const attempts = [];
    for (let index = 0; index < candidates.length; index++) {
      const candidate = candidates[index];
      const artifacts = path.join(target, `attempt-${index + 1}`);
      const attempt = { host: candidate.host, model: candidate.model, status: 'failed', tokens: null };
      attempts.push(attempt);
      let result;
      // Set while the attempt's outcome depends on the host's handling of its session: from a started host's own failure until its
      // report is validated. Bookkeeping, filesystem and pre-launch failures fall outside it.
      let sessionFailure = false;
      try {
        options.onAttempt?.();
        // timeoutMs applies to each attempt; the run and launcher deadlines bound the dispatch as a whole.
        const timeoutMs = timeLeft({ deadlineUtc: options.deadlineUtc, operationDeadlineUtc: options.operationDeadlineUtc }, options.timeoutMs ?? DEFAULT_REVIEW_TIMEOUT_MS);
        processStarted = false;
        terminationProven = false;
        const resumed = continuation?.kind === 'resumed' ? { session: continuation.session, priorThreadTokens: continuation.priorThreadTokens ?? null } : {};
        const shape = { ...(request.continues && !request.dialogue ? { closures: request.pendingClosures.map(finding => finding.id) } : {}), ...(request.dialogue ? { dialogue: request.dialogue.findingIds } : {}) };
        try {
          result = await (dependencies.runAgent ?? runAgent)({ ...candidate, ...resumed, cwd: workspace, protectedRoot: canonical, artifacts, systemFile, env: workerEnvironment(options.resourceContext), prompt: buildPrompt(request, { workspace }), schema: schemaFor(request.kind, id, request.findings, shape), timeoutMs, onProcess: pid => { processStarted = true; options.onProcess?.(pid); }, onSession: options.onSession });
        } catch (error) {
          // A started host that fails on its own, without an operating-system error, failed in its session.
          sessionFailure = processStarted && error.errno === undefined;
          throw error;
        }
        attempt.tokens = result.tokens ?? null;
        terminationProven = result.exit?.descendantsReclaimed === true;
        options.onFinalizing?.();
        requireCondition(!(options.forbiddenSessions ?? []).includes(result.session), 'nonindependent-worker', 'A current or former controller cannot supply a newly dispatched independent assessment');
        const { events, ...record } = result;
        writeJson(path.join(artifacts, 'result.json'), record);
        requireCondition(result.exit?.descendantsReclaimed !== false, 'termination-unverified', 'The agent process tree did not provide complete termination evidence');
        sessionFailure = true;
        requireCondition(result.status === 'complete' && result.attributionVerified, 'unusable-review', 'Host did not return an attributable completed assessment');
        requireCondition(!resumed.session || result.session === resumed.session, 'unusable-review', 'The host did not continue the resumed session');
        const report = validateReport(parseReport(result.output), request);
        sessionFailure = false;
        requireCondition(inputsUnchanged(canonical, request.kind, captured, contextSnapshot) && fresh(project, { ...contextSnapshot, inventory: false }), 'review-input-drift', 'Reviewed project inputs changed during assessment');
        attempt.status = 'complete';
        const receipt = {
          requestId: id, runId: request.runId, taskId: request.taskId,
          coveredTaskIds: request.coveredTaskIds, commitments: request.commitments, resources: request.resources, kind: request.kind,
          host: result.host, model: result.model, effort: result.effort, session: result.session,
          attributionVerified: true, strength: 'strong', independent: true,
          broad: report.status === 'complete', status: report.status,
          dimensions: report.coverage.map(item => item.dimension),
          coverageEvidence: report.coverage.map(item => `${item.dimension}: ${item.evidence}`).join('\n'),
          findings: report.findings, probes: report.probes ?? [], summary: report.summary,
          snapshot: captured, contextSnapshot, attempts, substitution: index > 0 ? options.substitutionReason : null,
          continues: request.continues, lineage: request.lineage, dialogue: request.dialogue,
          closures: report.closures ?? [], positions: report.positions ?? null, threadTokens: result.threadTokens ?? null,
          eventFile: path.relative(canonical, path.join(artifacts, 'events.jsonl')).split(path.sep).join('/'),
          eventHash: hash(fs.readFileSync(path.join(artifacts, 'events.jsonl'))),
        };
        const receiptFile = path.join(target, 'receipt.json');
        writeJson(receiptFile, receipt);
        return { receiptFile, receipt };
      } catch (error) {
        terminationProven ||= error.descendantsReclaimed === true;
        Object.assign(attempt, { status: 'failed', error: error.message });
        // A resume that fails because of its session is distinct, so the controller knows to replace the reviewer; failures that do
        // not concern the session keep their codes, and unproven termination outranks both below.
        if (continuation?.kind === 'resumed' && sessionFailure && !SESSION_INDEPENDENT_FAILURES.includes(error.code)) {
          error.code = 'resume-failed';
          error.message = `Resuming session ${continuation.session} failed: ${error.message}`;
        }
        if (processStarted && !terminationProven) error.code = 'termination-unverified';
        if (index === candidates.length - 1 || DISPATCH_ABORTING_FAILURES.includes(error.code)) {
          writeJson(path.join(target, 'failure.json'), { requestId: id, attempts });
          throw error;
        }
      }
    }
  } finally {
    // Keep uncertain live-worker residue. The diff, manifest and native logs retain
    // assessment evidence after a safely ended attempt's source copy is discarded.
    if ((!processStarted || terminationProven) && fs.existsSync(project)) {
      requireCondition(isPrivateCopyDirectory(canonical, workspace) && path.relative(workspace, project) === 'project', 'unsafe-path', 'Disposable review copy escaped its assignment');
      try { fs.rmSync(project, { recursive: true }); }
      catch (error) { writeJson(path.join(target, 'cleanup.json'), { pending: true, error: error.message }); }
    }
  }
}

function readReceipt(root, relative, state, taskId) {
  requireCondition(relative.startsWith('.nightshift/runs/reviews/'), 'invalid-receipt', 'Review receipt must belong to this project run');
  const receipt = JSON.parse(fs.readFileSync(projectFile(root, relative), 'utf8'));
  const assignmentFile = path.posix.join(path.posix.dirname(relative), 'request.json');
  const assignment = JSON.parse(fs.readFileSync(projectFile(root, assignmentFile), 'utf8'));
  requireCondition(assignment.id === receipt.requestId && assignment.runId === receipt.runId && assignment.taskId === receipt.taskId && assignment.kind === receipt.kind && isDeepStrictEqual(assignment.snapshot, receipt.snapshot) && isDeepStrictEqual(assignment.contextSnapshot, receipt.contextSnapshot) && isDeepStrictEqual(assignment.coveredTaskIds, receipt.coveredTaskIds), 'changed-assignment', 'Receipt no longer matches the saved dispatch assignment and inputs');
  requireCondition(isDeepStrictEqual(assignment.resources ?? null, receipt.resources ?? null), 'changed-assignment', 'Receipt resource binding does not match its immutable assignment');
  // Assignments from earlier releases carry no continuation fields and read as fresh dispatches of their own lineage.
  requireCondition(isDeepStrictEqual(assignment.continues ?? null, receipt.continues ?? null) && lineageOf(assignment) === lineageOf(receipt) && isDeepStrictEqual(assignment.dialogue ?? null, receipt.dialogue ?? null), 'changed-assignment', 'Receipt continuation differs from its immutable assignment');
  requireCondition(receipt.continues?.kind !== 'resumed' || receipt.session === receipt.continues.session, 'unattributed-review', 'A resumed receipt must come from the session it resumed');
  if (state.workers) {
    const worker = state.workers.find(candidate => candidate.id === receipt.requestId);
    requireCondition(worker?.snapshotDigest === receipt.snapshot.digest && worker.taskId === taskId && isDeepStrictEqual(worker.coveredTaskIds, receipt.coveredTaskIds), 'changed-assignment', 'Receipt differs from the controller-owned dispatch record');
    requireCondition(isDeepStrictEqual(worker.resources ?? null, receipt.resources ?? null), 'changed-assignment', 'Receipt differs from the worker resource binding');
    requireCondition(isDeepStrictEqual(worker.controller ?? null, assignment.controller ?? null), 'changed-assignment', 'Receipt assignment changed its dispatch controller provenance');
    requireCondition(isDeepStrictEqual(worker.continues ?? null, receipt.continues ?? null) && lineageOf(worker) === lineageOf(receipt), 'changed-assignment', 'Receipt continuation differs from the controller-owned dispatch record');
    requireCondition(isDeepStrictEqual(worker.commitments, receipt.commitments) && isDeepStrictEqual(assignment.commitments, receipt.commitments), 'changed-assignment', 'Receipt differs from the commitments bound when it was dispatched');
    requireCondition(receipt.coveredTaskIds.every(id => {
      const task = state.tasks.find(candidate => candidate.id === id);
      return task && isDeepStrictEqual(receipt.commitments?.[id], commitmentsFor([task])[id]);
    }), 'stale-commitments', 'Accepted commitments changed during assessment; reassess them before importing this report');
  }
  requireCondition(receipt.runId === state.id && receipt.taskId === taskId && receipt.session !== state.controller.session, 'wrong-result', 'Report belongs to another run, task or controller');
  if (assignment.controller && isDeepStrictEqual(assignment.controller, state.controller)) requireCondition(!require('./ownership').forbiddenReviewSessions(state).has(receipt.session), 'nonindependent-worker', 'A former controller cannot author a new independent assessment');
  requireCondition(hash(fs.readFileSync(projectFile(root, receipt.eventFile))) === receipt.eventHash, 'changed-result', 'Native host result changed after collection');
  requireCondition(STRONG_MODELS[receipt.host]?.includes(receipt.model) && receipt.attributionVerified === true && inputsUnchanged(root, receipt.kind, receipt.snapshot, receipt.contextSnapshot), 'invalid-receipt', 'Review attribution, strength or input freshness is invalid');
  const events = fs.readFileSync(projectFile(root, receipt.eventFile), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  let output;
  if (receipt.host === 'claude') {
    const result = events.findLast(event => event.type === 'result');
    const authored = events.filter(event => event.type === 'assistant' && event.message?.model && event.message.model !== '<synthetic>');
    requireCondition(result?.session_id === receipt.session && result.subtype === 'success' && result.is_error === false && authored.length > 0 && authored.every(event => event.message.model === receipt.model && event.session_id === receipt.session), 'unattributed-review', 'Native Claude result does not match the reviewer receipt');
    output = result.structured_output ?? result.result;
  } else {
    requireCondition(events.some(event => event.result?.thread?.id === receipt.session && event.result.model === receipt.model) && events.some(event => event.method === 'turn/completed' && event.params.threadId === receipt.session && event.params.turn.status === 'completed') && !events.some(event => codexModelContradiction(event, receipt.session, receipt.model)), 'unattributed-review', 'Native Codex result does not match the reviewer receipt');
    output = events.findLast(event => event.method === 'item/completed' && event.params.threadId === receipt.session && event.params.item.type === 'agentMessage')?.params.item.text;
  }
  const report = parseReport(output);
  requireCondition(report.requestId === receipt.requestId && report.status === receipt.status && isDeepStrictEqual(report.findings, receipt.findings) && isDeepStrictEqual(report.probes ?? [], receipt.probes) && isDeepStrictEqual(report.coverage.map(item => item.dimension), receipt.dimensions) && isDeepStrictEqual(report.closures ?? [], receipt.closures ?? []) && isDeepStrictEqual(report.positions ?? null, receipt.positions ?? null), 'changed-result', 'Collected assessment differs from the native host report');
  return receipt;
}

module.exports = { DEFAULT_REVIEW_TIMEOUT_MS, DIALOGUE_POSITIONS, STRONG_MODELS, buildPrompt, dispatchReview, parseReport, readReceipt, schemaFor, validateBase, validateReport, validateRequest };
