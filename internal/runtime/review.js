'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { isDeepStrictEqual } = require('node:util');
const { DIMENSIONS, commitmentsFor } = require('./lifecycle');
const { requireCondition, safeDirectory, text } = require('./store');
const { fileIdentity, fresh, hash, projectFile, projectInventory, snapshot } = require('./evidence');
const { codexModelContradiction, runAgent } = require('./hosts');
const { writeJson, writeText } = require('./artifacts');
const { PROBE_TIMEOUT_CAP_MS, PROBE_TIMEOUT_FLOOR_MS, loadProbeEvidence } = require('./probes');
const { createPrivateCopyDirectory, isPrivateCopyDirectory } = require('./copies');
const { workerEnvironment } = require('../releases/entry');
const { timeLeft } = require('./limits');

const STRONG_MODELS = Object.freeze({ claude: ['claude-fable-5-1'], codex: ['gpt-6-astra'] });
const DEFAULT_REVIEW_TIMEOUT_MS = 900000;
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
});

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, windowsHide: true, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 30000 });
  requireCondition(!result.error && result.status === 0, 'git-failed', result.error?.message ?? result.stderr);
  return result.stdout;
}

function contextFiles(root, excluded = [], included = []) {
  return projectInventory(root, excluded, included);
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
  requireCondition(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(baseSha), 'invalid-base', 'Review needs an immutable cumulative Git base');
  git(root, ['cat-file', '-e', baseSha + '^{tree}']);
}

function validateRequest(options) {
  text(options?.requirements, 'review.requirements');
  text(options?.rules, 'review.rules');
  requireCondition(options.kind === undefined || ['code', 'spec', 'skeptic'].includes(options.kind), 'invalid-review-kind', 'Unknown independent assessment kind');
  for (const field of ['artifactPaths', 'excludedPaths']) {
    requireCondition(options[field] === undefined || Array.isArray(options[field]) && options[field].every(file => typeof file === 'string' && file.trim()), 'invalid-review-paths', `${field} must contain project-relative file paths`);
  }
  requireCondition(!(options.artifactPaths ?? []).some(file => options.excludedPaths?.includes(file)), 'conflicting-review-paths', 'An explicitly selected artifact cannot also be excluded');
  requireCondition(options.timeoutMs === undefined || Number.isSafeInteger(options.timeoutMs) && options.timeoutMs > 0, 'invalid-request', 'review.timeoutMs is the per-attempt limit in milliseconds and must be a positive integer');
  const candidates = options.candidates;
  requireCondition(Array.isArray(candidates) && candidates.length > 0, 'missing-model', 'Controller must choose a permitted reviewer host and model');
  for (const candidate of candidates) {
    requireCondition(candidate !== null && typeof candidate === 'object' && Object.keys(candidate).every(key => ['host', 'model', 'effort'].includes(key)), 'invalid-model-selection', 'Model selection cannot replace the trusted host executable or its process policy');
    requireCondition(STRONG_MODELS[candidate.host]?.includes(candidate.model), 'review-strength', 'This gate requires a supported strong reviewer model');
  }
  requireCondition(!options.requiredModel || candidates.every(candidate => candidate.model === options.requiredModel), 'model-requirement', 'Explicit model requirements prohibit fallback to another model');
  // A fallback records why it replaced the preferred reviewer, so the reason must exist before any attempt starts.
  if (candidates.length > 1) text(options.substitutionReason, 'review.substitutionReason');
  if (options.kind === 'skeptic') {
    const findings = options.findings ?? [];
    requireCondition(Array.isArray(findings), 'invalid-skeptic-assignment', 'Skeptic findings must be an array');
    const ids = findings.map(finding => text(finding?.id, 'assigned finding.id'));
    requireCondition(new Set(ids).size === ids.length, 'invalid-skeptic-assignment', 'Assigned finding identities must be unique');
  }
}

function schemaFor(kind, requestId, assignedFindings = []) {
  const scalar = { type: 'string' };
  const assignedIds = kind === 'skeptic' ? assignedFindings.map(finding => finding.id) : [];
  const finding = kind === 'skeptic'
    ? { type: 'object', additionalProperties: false, properties: { id: assignedIds.length ? { type: 'string', enum: assignedIds } : scalar, verdict: { type: 'string', enum: ['confirmed', 'refuted', 'unverified'] }, evidence: scalar, value: scalar }, required: ['id', 'verdict', 'evidence', 'value'] }
    : { type: 'object', additionalProperties: false, properties: { id: scalar, severity: { type: 'string', enum: ['critical', 'important', 'minor'] }, consequence: scalar, evidence: scalar, required: { type: 'boolean' } }, required: ['id', 'severity', 'consequence', 'evidence', 'required'] };
  return {
    type: 'object', additionalProperties: false,
    properties: {
      requestId: { type: 'string', enum: [requestId] }, status: { type: 'string', enum: ['complete', 'incomplete'] },
      coverage: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { dimension: scalar, evidence: scalar }, required: ['dimension', 'evidence'] } },
      findings: { type: 'array', items: finding, ...(kind === 'skeptic' ? { minItems: assignedIds.length, maxItems: assignedIds.length } : {}) }, summary: scalar,
      probes: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
        id: scalar, purpose: scalar, executable: scalar, args: { type: 'array', items: scalar }, timeoutMs: { type: 'integer', minimum: PROBE_TIMEOUT_FLOOR_MS, maximum: PROBE_TIMEOUT_CAP_MS, description: PROBE_TIMEOUT_RULE },
        files: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { path: scalar, content: scalar }, required: ['path', 'content'] } },
      }, required: ['id', 'purpose', 'executable', 'args', 'timeoutMs', 'files'] } },
    },
    required: ['requestId', 'status', 'coverage', 'findings', 'summary', 'probes'],
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
    } else {
      text(finding.consequence, 'finding.consequence');
      requireCondition(['critical', 'important', 'minor'].includes(finding.severity) && typeof finding.required === 'boolean', 'invalid-finding', 'Finding needs severity and obligation assessment');
    }
  }
  if (request.kind === 'skeptic') requireCondition(request.findings.length === ids.size && request.findings.every(finding => ids.has(finding.id)), 'missing-validation', 'Skeptic must evaluate every assigned finding exactly once');
  else if (report.status === 'complete') {
    requireCondition(request.dimensions.every(dimension => report.coverage.some(item => item.dimension === dimension && typeof item.evidence === 'string' && item.evidence.trim())), 'partial-coverage', 'Complete review must cover every dimension with evidence');
  }
  return report;
}

function buildPrompt(request) {
  const skeptic = request.kind === 'skeptic';
  const scope = skeptic ? 'Use the complete supplied artifact and cumulative change as context for validating the assigned claims and their affected siblings.' : 'Assess the complete supplied artifact and cumulative change, surrounding code and sibling paths.';
  const purpose = skeptic ? 'deciding each assigned claim' : 'a credible broad assessment';
  const common = `You are a fresh independent ${skeptic ? 'skeptic' : 'strong lead reviewer'}. ${scope} Reviewed files are immutable. Do not edit them, commit, or publish. Mutating probes require a separate isolated fixture; if tools cannot support a deciding check, report the missing evidence. Do not delegate unless the assignment explicitly includes peer dispatch. Report only concrete consequences with evidence; do not manufacture findings or prescribe unnecessary implementation detail.\n\nRequest: ${request.id}\nRequirements:\n${request.requirements}\n\nAll applicable review dimensions:\n${request.dimensions.join('\n')}\n\nRead context/diff.patch, context/manifest.json and the files in project/ as needed for ${purpose}. The full source snapshot is available. Prior fixes are included in the cumulative change and need surrounding/sibling coverage.\n`;
  const role = request.kind === 'skeptic'
    ? `The assigned finding set is closed: return exactly one verdict for each supplied full id and retain that id verbatim. Validate each claim against concrete evidence, attempting refutation. Separate factual validity and practical value. Missing evidence is unverified. Evaluate whether it is worthwhile to implement, defer or skip, preserving agreed obligations. Unassigned observations belong in summary for separate controller routing and independent assessment before disposition; they are not assigned verdicts. Findings:\n${JSON.stringify(request.findings, null, 2)}\n`
    : 'Evaluate all dimensions without quotas or equal-depth narration. The author has not selected relevant dimensions. If the assignment is too large for credible coverage, return incomplete and describe the needed peer coverage. One underlying problem is one finding.\n';
  const definitions = request.dimensions.map(dimension => `${dimension}: ${DIMENSION_BRIEFS[dimension]}`).join('\n');
  const execution = `If a deciding claim needs execution unavailable in your read-only tools, request a bounded probe in probes, with its purpose, exact executable/args, timeout and ASCII fixture files. ${PROBE_TIMEOUT_RULE} The controller executes it in a separate private copy and returns raw command/output evidence for your independent assessment. Remain incomplete/unverified until that evidence is sufficient. A probe never authorizes canonical project repairs. Available returned probe evidence is under context/probes/.\n`;
  return common + definitions + '\n\n' + role + execution + '\nReturn the requested structured report with requestId, status, coverage, findings, probes and summary. Use an empty probes array when no execution evidence is missing.\n';
}

async function dispatchReview(root, options, dependencies = {}) {
  const canonical = fs.realpathSync.native(root);
  validateRequest(options);
  validateBase(canonical, options.baseSha);
  const candidates = options.candidates;
  const directory = safeDirectory(canonical, '.nightshift/runs/reviews', true);
  const id = options.id ?? randomUUID();
  requireCondition(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id), 'invalid-dispatch', 'Dispatch identity must be a UUID');
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
    const files = contextFiles(canonical, excludedPaths, includedPaths);
    const contextSnapshot = { ...snapshot(canonical, files), inventory: true, excludedPaths, includedPaths };
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
    const request = { id, workspace: path.relative(canonical, workspace).split(path.sep).join('/'), runId: options.runId, taskId: options.taskId, coveredTaskIds: options.coveredTaskIds ?? [options.taskId], commitments: options.commitments ?? {}, resources: options.resources ?? null, controller: options.controller ?? null, kind: options.kind ?? 'code', requirements: text(options.requirements, 'review requirements'), dimensions: DIMENSIONS[options.kind === 'spec' ? 'spec' : 'code'], findings: options.findings ?? [], snapshot: captured, contextSnapshot, baseSha: options.baseSha };
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
      try {
        options.onAttempt?.();
        // timeoutMs applies to each attempt; the run and launcher deadlines bound the dispatch as a whole.
        const timeoutMs = timeLeft({ deadlineUtc: options.deadlineUtc, operationDeadlineUtc: options.operationDeadlineUtc }, options.timeoutMs ?? DEFAULT_REVIEW_TIMEOUT_MS);
        processStarted = false;
        terminationProven = false;
        result = await (dependencies.runAgent ?? runAgent)({ ...candidate, cwd: workspace, protectedRoot: canonical, artifacts, systemFile, env: workerEnvironment(options.resourceContext), prompt: buildPrompt(request), schema: schemaFor(request.kind, id, request.findings), timeoutMs, onProcess: pid => { processStarted = true; options.onProcess?.(pid); }, onSession: options.onSession });
        attempt.tokens = result.tokens ?? null;
        terminationProven = result.exit?.descendantsReclaimed === true;
        options.onFinalizing?.();
        requireCondition(!(options.forbiddenSessions ?? []).includes(result.session), 'nonindependent-worker', 'A current or former controller cannot supply a newly dispatched independent assessment');
        const { events, ...record } = result;
        writeJson(path.join(artifacts, 'result.json'), record);
        requireCondition(result.exit?.descendantsReclaimed !== false, 'termination-unverified', 'The agent process tree did not provide complete termination evidence');
        requireCondition(result.status === 'complete' && result.attributionVerified, 'unusable-review', 'Host did not return an attributable completed assessment');
        const report = validateReport(parseReport(result.output), request);
        requireCondition(fresh(canonical, contextSnapshot) && fresh(project, { ...contextSnapshot, inventory: false }), 'review-input-drift', 'Reviewed project inputs changed during assessment');
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
          eventFile: path.relative(canonical, path.join(artifacts, 'events.jsonl')).split(path.sep).join('/'),
          eventHash: hash(fs.readFileSync(path.join(artifacts, 'events.jsonl'))),
        };
        const receiptFile = path.join(target, 'receipt.json');
        writeJson(receiptFile, receipt);
        return { receiptFile, receipt };
      } catch (error) {
        terminationProven ||= error.descendantsReclaimed === true;
        Object.assign(attempt, { status: 'failed', error: error.message });
        if (processStarted && !terminationProven) error.code = 'termination-unverified';
        if (index === candidates.length - 1 || ['review-input-drift', 'snapshot-drift', 'unsafe-path', 'inventory-failed', 'file-identity-unavailable', 'conflicting-review-paths', 'invalid-review-paths', 'resource-limit', 'operation-time-limit', 'termination-unverified'].includes(error.code)) {
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
  if (state.workers) {
    const worker = state.workers.find(candidate => candidate.id === receipt.requestId);
    requireCondition(worker?.snapshotDigest === receipt.snapshot.digest && worker.taskId === taskId && isDeepStrictEqual(worker.coveredTaskIds, receipt.coveredTaskIds), 'changed-assignment', 'Receipt differs from the controller-owned dispatch record');
    requireCondition(isDeepStrictEqual(worker.resources ?? null, receipt.resources ?? null), 'changed-assignment', 'Receipt differs from the worker resource binding');
    requireCondition(isDeepStrictEqual(worker.controller ?? null, assignment.controller ?? null), 'changed-assignment', 'Receipt assignment changed its dispatch controller provenance');
    requireCondition(isDeepStrictEqual(worker.commitments, receipt.commitments) && isDeepStrictEqual(assignment.commitments, receipt.commitments), 'changed-assignment', 'Receipt differs from the commitments bound when it was dispatched');
    requireCondition(receipt.coveredTaskIds.every(id => {
      const task = state.tasks.find(candidate => candidate.id === id);
      return task && isDeepStrictEqual(receipt.commitments?.[id], commitmentsFor([task])[id]);
    }), 'stale-commitments', 'Accepted commitments changed during assessment; reassess them before importing this report');
  }
  requireCondition(receipt.runId === state.id && receipt.taskId === taskId && receipt.session !== state.controller.session, 'wrong-result', 'Report belongs to another run, task or controller');
  if (assignment.controller && isDeepStrictEqual(assignment.controller, state.controller)) requireCondition(!require('./ownership').forbiddenReviewSessions(state).has(receipt.session), 'nonindependent-worker', 'A former controller cannot author a new independent assessment');
  requireCondition(hash(fs.readFileSync(projectFile(root, receipt.eventFile))) === receipt.eventHash, 'changed-result', 'Native host result changed after collection');
  requireCondition(STRONG_MODELS[receipt.host]?.includes(receipt.model) && receipt.attributionVerified === true && fresh(root, receipt.snapshot) && fresh(root, receipt.contextSnapshot), 'invalid-receipt', 'Review attribution, strength or input freshness is invalid');
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
  requireCondition(report.requestId === receipt.requestId && report.status === receipt.status && isDeepStrictEqual(report.findings, receipt.findings) && isDeepStrictEqual(report.probes ?? [], receipt.probes) && isDeepStrictEqual(report.coverage.map(item => item.dimension), receipt.dimensions), 'changed-result', 'Collected assessment differs from the native host report');
  return receipt;
}

module.exports = { DEFAULT_REVIEW_TIMEOUT_MS, STRONG_MODELS, buildPrompt, contextFiles, dispatchReview, parseReport, readReceipt, schemaFor, validateBase, validateReport, validateRequest };
