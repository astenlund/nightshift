const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');
const { isDeepStrictEqual } = require('node:util');

const {
  AgreementError,
  AGREEMENT_VERSION,
  buildCandidate,
  buildDerivedDiff,
  candidateToken,
  canonicalizePath,
  compareCandidates,
  createAgreementState,
  decideAgreementGate,
  detectLegacyMarkers,
  hashSelection,
  invalidateAgreementState,
  locateSelection,
  parsePlanContract,
  previewLegacyMarkerDeletion,
  refreshCompatibleState,
  replaceAgreementState,
  resolveGoverningSet,
  runCli,
  scanMarkdown,
  selectArtifact,
  serializePlanContract,
  validateContractFitVerdict,
  writeProvenanceStamp,
} = require('./spec-agreement');
const readyImplementation = require('../ready/ready');

const fixturePath = join(__dirname, 'fixtures', 'fingerprint-v1.json');
const corpus = JSON.parse(readFileSync(fixturePath, 'utf8'));
const projectRoot = 'C:/repo';
const repositoryRoot = join(__dirname, '..', '..');
const currentSessionAgreementRule = 'Readiness and graduation are not approval: before spec-governed work, present the current decision-complete digest and obtain explicit agreement in this session.';
const withinContractContinuationRule = 'Compatible governing-text changes that remain within the accepted digest continue autonomously after a cited contract-fit check.';
const finalPresentationRule = 'When a final governing design is presented, invoke /nightshift:spec-agreement in final-presentation mode before asking for agreement.';
const freshAgreementRule = 'Existing agreement is fresh only when the complete current candidate matches or passes contract-fit evaluation in the same session.';
const targetedAgreementPatchRule = 'On rerun, add missing agreement guidance with a targeted patch; never rewrite user-controlled sections.';
const legacyMigrationManifest = [
  '.claude/features/present-spec-for-agreement.md',
  '.claude/features/dependency-cycle-detection.md',
  '.claude/features/ready-exploring-visibility.md',
  '.claude/features/immediate-skeptic-dispatch.md',
];
const readyParser = {
  normalizeSliceName: (...args) => readyImplementation.normalizeSliceName(...args),
  parseSlices: (...args) => readyImplementation.parseSlices(...args),
  findSlicesByNormalizedName: (...args) => readyImplementation.findSlicesByNormalizedName(...args),
};

function readRepositoryFile(path) {
  return readFileSync(join(repositoryRoot, path), 'utf8');
}

function readRepositoryBytes(path) {
  return readFileSync(join(repositoryRoot, path));
}

function repositoryMarkdownPaths(relativeRoot) {
  const markdownPaths = [];

  function visit(relativePath) {
    const entries = readdirSync(join(repositoryRoot, relativePath), { withFileTypes: true }).sort((left, right) => {
      if (left.name === right.name) {
        return 0;
      }

      return left.name < right.name ? -1 : 1;
    });
    for (const entry of entries) {
      const entryPath = `${relativePath}/${entry.name}`;
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        markdownPaths.push(entryPath);
      }
    }
  }

  visit(relativeRoot);

  return markdownPaths;
}

function activeRepositoryDesignPaths() {
  return ['.claude', '.Codex']
    .filter((relativeRoot) => existsSync(join(repositoryRoot, relativeRoot)))
    .flatMap((relativeRoot) => repositoryMarkdownPaths(relativeRoot))
    .filter((path) => !path.startsWith('.claude/plans/') && !path.startsWith('.Codex/plans/') && !path.endsWith('_HISTORY.md'))
    .sort();
}

function activeInstructionPaths() {
  return [
    'AGENTS.md',
    'README.md',
    '.claude/BUGS.md',
    '.claude/FEATURES.md',
    '.claude/PATTERNS.md',
    '.claude/QUICK_WINS.md',
    ...repositoryMarkdownPaths('skills').filter((path) => path.endsWith('/SKILL.md')),
    ...repositoryMarkdownPaths('internal'),
  ].sort();
}

function inspectTerminalProvenance(path, sourceBuffer) {
  const selection = selectArtifact({ path, selectorKind: 'design-before-hardening', selectors: [], sourceBuffer });
  const hashed = hashSelection(selection);
  const lines = scanMarkdown(sourceBuffer).lines;
  const hardeningIndex = lines.findIndex((line) => line.outsideFence && line.heading?.level === 2 && line.heading.exactLine === '## Hardening');
  if (hardeningIndex === -1) {
    return { kind: 'missing', hashed, actualFingerprint: null, expectedFingerprint: hashed.contentHash.slice(0, 8) };
  }
  const terminal = lines.slice(hardeningIndex + 1).findLast((line) => line.content.trim() !== '');
  if (terminal === undefined) {
    return { kind: 'missing', hashed, actualFingerprint: null, expectedFingerprint: hashed.contentHash.slice(0, 8) };
  }
  const match = terminal.content.match(/^- (?:revise-spec (?:graduated|refreshed)|handover completed) \d{4}-\d{2}-\d{2} \d{2}:\d{2} at [0-9a-f]{7,40}, scope: .+, content: ([0-9a-f]{8}|p-[0-9a-f]{12})(?: \(.+\))?$/);
  if (match === null) {
    return { kind: 'missing', hashed, actualFingerprint: null, expectedFingerprint: hashed.contentHash.slice(0, 8) };
  }
  const expectedFingerprint = match[1].startsWith('p-') ? `p-${hashed.contentHash.slice(0, 12)}` : hashed.contentHash.slice(0, 8);

  return { kind: match[1] === expectedFingerprint ? 'current' : 'stale', hashed, actualFingerprint: match[1], expectedFingerprint };
}

function classifyMigrationArtifact(path, sourceBuffer) {
  const matches = detectLegacyMarkers({ artifacts: [{ path, selectorKind: 'design-before-hardening', selectors: [], sourceBuffer }] }).matches;
  const provenance = inspectTerminalProvenance(path, sourceBuffer);

  return { kind: matches.length > 0 ? 'marker-present' : provenance.kind === 'current' ? 'complete' : 'provenance-stale', matches, provenance };
}

function terminalProvenance(path, sourceBuffer) {
  const provenance = inspectTerminalProvenance(path, sourceBuffer);
  assert.notEqual(provenance.kind, 'missing', `${path} must have terminal eligible Hardening provenance`);

  return provenance;
}

function countExact(source, value) {
  return source.split(value).length - 1;
}

function beforeFirstLevelTwoHeading(source) {
  const normalized = source.replace(/\r\n?/g, '\n');
  const boundary = normalized.indexOf('\n## ');

  return boundary === -1 ? normalized : normalized.slice(0, boundary);
}

function extractSection(source, heading) {
  const normalized = source.replace(/\r\n?/g, '\n');
  const start = normalized.indexOf(`${heading}\n`);
  assert.notEqual(start, -1, `missing section ${heading}`);
  const bodyStart = start + heading.length + 1;
  const nextHeading = normalized.indexOf('\n## ', bodyStart);

  return normalized.slice(start, nextHeading === -1 ? normalized.length : nextHeading);
}

function extractTemplate(skill, heading) {
  const normalized = skill.replace(/\r\n?/g, '\n');
  const headingStart = normalized.indexOf(`${heading}\n`);
  assert.notEqual(headingStart, -1, `missing template heading ${heading}`);
  const fenceStart = normalized.indexOf('~~~markdown\n', headingStart);
  assert.notEqual(fenceStart, -1, `missing template fence for ${heading}`);
  const contentStart = fenceStart + '~~~markdown\n'.length;
  const fenceEnd = normalized.indexOf('\n~~~', contentStart);
  assert.notEqual(fenceEnd, -1, `missing template fence end for ${heading}`);

  return normalized.slice(contentStart, fenceEnd);
}

function extractFeatureEntry(features, entryHeading) {
  const normalized = features.replace(/\r\n?/g, '\n');
  const start = normalized.indexOf(`${entryHeading}\n`);
  assert.notEqual(start, -1, `missing feature entry ${entryHeading}`);
  const bodyStart = start + entryHeading.length + 1;
  const remaining = normalized.slice(bodyStart);
  const nextHeading = remaining.search(/\n#{2,3} /);

  return normalized.slice(start, nextHeading === -1 ? normalized.length : bodyStart + nextHeading);
}

function fakeRepository(files, aliases = {}) {
  const buffers = new Map();
  const directories = new Map([[projectRoot, new Set()]]);
  for (const [path, contents] of Object.entries(files)) {
    const segments = path.split('/');
    let parent = projectRoot;
    for (const [index, segment] of segments.entries()) {
      if (!directories.has(parent)) {
        directories.set(parent, new Set());
      }
      directories.get(parent).add(segment);
      const child = `${parent}/${segment}`;
      if (index < segments.length - 1 && !directories.has(child)) {
        directories.set(child, new Set());
      }
      parent = child;
    }
    buffers.set(`${projectRoot}/${path}`, Buffer.isBuffer(contents) ? contents : Buffer.from(contents));
  }

  return {
    readFile: (path) => {
      if (!buffers.has(path)) {
        throw new Error(`missing ${path}`);
      }

      return buffers.get(path);
    },
    readDirectory: (path) => [...(directories.get(path) ?? [])],
    realpath: (path) => aliases[path] ?? path,
    replaceFileAtomically: () => {},
  };
}

function mutableRepository(files) {
  const buffers = new Map();
  const directories = new Map([[projectRoot, new Set()]]);
  const replacements = [];
  for (const [path, contents] of Object.entries(files)) {
    const segments = path.split('/');
    let parent = projectRoot;
    for (const [index, segment] of segments.entries()) {
      if (!directories.has(parent)) {
        directories.set(parent, new Set());
      }
      directories.get(parent).add(segment);
      const child = `${parent}/${segment}`;
      if (index < segments.length - 1 && !directories.has(child)) {
        directories.set(child, new Set());
      }
      parent = child;
    }
    buffers.set(`${projectRoot}/${path}`, Buffer.from(contents));
  }
  const adapter = {
    readFile: (path) => {
      if (!buffers.has(path)) {
        throw new Error(`missing ${path}`);
      }

      return Buffer.from(buffers.get(path));
    },
    readDirectory: (path) => [...(directories.get(path) ?? [])],
    realpath: (path) => path,
    replaceFileAtomically: (path, nextBytes) => {
      if (!buffers.has(path)) {
        throw new Error(`missing ${path}`);
      }
      replacements.push({ path, bytes: Buffer.from(nextBytes) });
      buffers.set(path, Buffer.from(nextBytes));
    },
  };

  return {
    adapter,
    bytes: (path) => Buffer.from(buffers.get(`${projectRoot}/${path}`)),
    replaceReviewedBytes: (path, nextBytes) => buffers.set(`${projectRoot}/${path}`, Buffer.from(nextBytes)),
    replacements: () => replacements.map((replacement) => ({ path: replacement.path, bytes: Buffer.from(replacement.bytes) })),
  };
}

function mutableArtifact(initialBytes, { aliases = {}, readFailures = [] } = {}) {
  let bytes = Buffer.from(initialBytes);
  const replacements = [];
  const directories = new Map([
    [projectRoot, ['docs']],
    [`${projectRoot}/docs`, ['spec.md']],
  ]);
  const adapter = {
    readFile: (path) => {
      const failure = readFailures.shift();
      if (failure !== undefined) {
        throw failure;
      }

      return Buffer.from(bytes);
    },
    readDirectory: (path) => directories.get(path) ?? [],
    realpath: (path) => aliases[path] ?? path,
    replaceFileAtomically: (path, nextBytes) => {
      replacements.push({ path, bytes: Buffer.from(nextBytes) });
      bytes = Buffer.from(nextBytes);
    },
  };

  return {
    adapter,
    bytes: () => Buffer.from(bytes),
    replacements: () => replacements.map((replacement) => ({ path: replacement.path, bytes: Buffer.from(replacement.bytes) })),
  };
}

function fullHash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function scope(kind, path, selectors = [], workUnit = null) {
  return { kind, path, selectors, workUnit };
}

function request(overrides = {}) {
  return {
    mode: 'lifecycle',
    projectRoot,
    target: null,
    seeds: [],
    planBuffer: null,
    selectedSliceDeclaration: null,
    allowSpecLess: false,
    allowCompletedNoOp: false,
    ...overrides,
  };
}

function resolve(requestRecord, fsAdapter, parser = readyParser) {
  return resolveGoverningSet(requestRecord, { fsAdapter, readyParser: parser });
}

function selectionFor(entry) {
  return selectArtifact({
    path: 'artifact.md',
    sourceBuffer: Buffer.from(entry.sourceBytesHex, 'hex'),
    ...entry.selector,
  });
}

function expectStructural(fn, kind) {
  assert.throws(fn, (error) => error instanceof AgreementError && error.code === 'structural-error' && (!kind || error.evidence.kind === kind));
}

function candidateFixture(entries = [{ path: 'docs/spec.md', text: '# Spec\n' }]) {
  const target = scope('whole-file', entries[0].path);
  const artifacts = entries.map((entry) => ({
    path: entry.path,
    selectorKind: entry.selectorKind ?? 'design-before-hardening',
    selectors: entry.selectors ?? [],
    sourceBuffer: Buffer.from(entry.text),
  }));
  const selections = artifacts.map((artifact) => hashSelection(selectArtifact(artifact)));
  const resolution = { kind: 'resolved', target, governingScopes: [target], artifacts };

  return { ...buildCandidate({ resolution, selections }), resolution, selections };
}

function responseDecision(kind, digest = 'digest-v1', evidence = 'Current-session response.') {
  return { kind, digest, evidence };
}

function gateInput(overrides = {}) {
  const fixture = candidateFixture();

  return {
    phase: 'lifecycle-entry',
    request: request({ target: fixture.candidate.target, seeds: [fixture.candidate.target] }),
    resolution: fixture.resolution,
    sessionState: null,
    pendingPresentation: null,
    candidate: fixture.candidate,
    currentSources: fixture.currentSources,
    acceptedDigest: 'digest-v1',
    response: null,
    fitResult: null,
    legacyDeletions: null,
    ...overrides,
  };
}

function legacyMigrationFixture() {
  const statusLine = Buffer.from('Status: signed off\n');
  const statusText = `${statusLine.toString()}\n# Spec\n`;
  const refreshLine = Buffer.from('- revise-spec refreshed 2026-08-19 03:35 at 9ebd097, scope: whole file, content: 74092a52 (sign-off marker)\n');
  const refreshPrefix = Buffer.from('# Other\n\n## Hardening\n\n');
  const refreshText = Buffer.concat([refreshPrefix, refreshLine]).toString();
  const fixture = candidateFixture([
    { path: 'docs/spec.md', text: statusText },
    { path: 'docs/other.md', text: refreshText },
  ]);
  const deletions = [
    { path: 'docs/spec.md', kind: 'status', rawStart: 0, rawEnd: statusLine.length, rawLine: statusLine, ownedBlankLine: { start: statusLine.length, end: statusLine.length + 1 } },
    { path: 'docs/other.md', kind: 'hardening-refresh', rawStart: refreshPrefix.length, rawEnd: refreshPrefix.length + refreshLine.length, rawLine: refreshLine, ownedBlankLine: { start: refreshPrefix.length - 1, end: refreshPrefix.length } },
  ];
  const input = gateInput({
    request: request({ target: fixture.candidate.target, seeds: [fixture.candidate.target] }),
    resolution: fixture.resolution,
    candidate: fixture.candidate,
    currentSources: fixture.currentSources,
    legacyDeletions: deletions,
  });

  return { input, deletions };
}

function fakeVolatileStore(initialBytes, outcomes = []) {
  let checkpointBytes = Buffer.from(initialBytes);
  const calls = [];
  const store = {
    replace: (nextState) => {
      calls.push(nextState);
      const outcome = outcomes.shift();
      if (outcome !== undefined) {
        throw outcome;
      }
      checkpointBytes = Buffer.from(JSON.stringify(nextState));

      return nextState;
    },
  };

  return {
    store,
    checkpointBytes: () => Buffer.from(checkpointBytes),
    calls: () => [...calls],
  };
}

function callerMode({ phase, caller = null, originatingMode = null, durableArtifact = null }) {
  if (durableArtifact !== null) {
    const durableModes = { spec: 'revise-spec', plan: 'revise-plan', code: 'revise-code' };
    if (phase !== 'post-mutation' || !Object.hasOwn(durableModes, durableArtifact)) {
      throw new AgreementError('structural-error', 'Unsupported durable resume mapping.', { kind: 'selector-shape' });
    }

    return durableModes[durableArtifact];
  }
  if (phase === 'final-presentation' && caller === 'brainstorming') {
    return 'final-presentation';
  }
  if (phase === 'planning-result' && caller === 'planning') {
    return 'planning';
  }
  if (phase === 'post-mutation' && ['handover', 'lifecycle', 'revise-spec', 'revise-plan', 'revise-code', 'planning', 'final-presentation'].includes(originatingMode)) {
    return originatingMode;
  }
  if (phase === 'lifecycle-entry') {
    const lifecycleModes = {
      handover: 'handover',
      'revise-spec': 'revise-spec',
      'revise-plan': 'revise-plan',
      'revise-code': 'revise-code',
      planning: 'planning',
      generic: 'lifecycle',
    };
    if (Object.hasOwn(lifecycleModes, caller)) {
      return lifecycleModes[caller];
    }
  }

  throw new AgreementError('structural-error', 'Unsupported phase and caller mapping.', { kind: 'selector-shape' });
}

function callerHarness({ initialText = '# Spec\n', storeOutcomes = [], replacementStoreFactory = null } = {}) {
  let text = initialText;
  let storeFixture = fakeVolatileStore(Buffer.from('null'), storeOutcomes);
  const context = { sessionState: null, pendingPresentation: null, storeQuarantined: false };
  const events = [];
  let dispatchCount = 0;

  const capture = (mode = 'lifecycle') => {
    const target = scope('whole-file', 'docs/spec.md');
    const fsAdapter = fakeRepository({ 'docs/spec.md': text });
    const resolution = resolve(request({ mode, target, seeds: [target] }), fsAdapter);
    const selections = resolution.artifacts.map((artifact) => hashSelection(selectArtifact(artifact)));

    return { ...buildCandidate({ resolution, selections }), resolution, request: request({ mode, target, seeds: [target] }) };
  };
  const persist = (nextState, retrySameTurn, afterRenewedResponse = false) => {
    if (context.storeQuarantined) {
      if (!afterRenewedResponse || typeof replacementStoreFactory !== 'function') {
        events.push('quarantined-store-skipped');

        return false;
      }
      storeFixture = replacementStoreFactory();
      context.storeQuarantined = false;
      events.push('fresh-store-created');
    }
    const attempts = retrySameTurn ? 2 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        context.sessionState = replaceAgreementState({ store: storeFixture.store, nextState });
        events.push(attempt === 0 ? 'stored' : 'stored-on-same-turn-retry');

        return true;
      } catch (error) {
        assert.equal(error.code, 'state-storage-failed');
      }
    }
    context.sessionState = null;
    context.pendingPresentation = null;
    context.storeQuarantined = true;
    events.push('store-quarantined');

    return false;
  };
  const preparePresentation = ({ digest = 'digest-v1', digestFields = null, mutateAfterBaseline = null, onRender = null, mode = 'lifecycle' } = {}) => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const baseline = capture(mode);
      events.push(`baseline-${attempt + 1}`);
      mutateAfterBaseline?.({ attempt, setText: (nextText) => { text = nextText; } });
      const recheck = capture(mode);
      events.push(`recheck-${attempt + 1}`);
      if (isDeepStrictEqual(baseline.candidate, recheck.candidate) && isDeepStrictEqual(baseline.currentSources, recheck.currentSources)) {
        const renderedDigest = digestFields === null ? digest : renderDigestFixture(digestFields);
        context.pendingPresentation = { digest: renderedDigest, candidate: baseline.candidate, currentSources: baseline.currentSources };
        events.push('pending-created');
        onRender?.(context.pendingPresentation);
        events.push('digest-rendered');

        return baseline;
      }
      context.pendingPresentation = null;
      events.push('drift-restart');
    }

    throw new AgreementError('unstable-governing-source', 'Governing source changed during both presentation attempts.', { attempts: 2 });
  };
  const respond = ({ kind, digest = context.pendingPresentation?.digest ?? 'digest-v1', retrySameTurn = true, mode = 'lifecycle' }) => {
    const reconstructed = capture(mode);
    const action = decideAgreementGate({
      phase: mode === 'final-presentation' ? 'final-presentation' : 'lifecycle-entry',
      request: reconstructed.request,
      resolution: reconstructed.resolution,
      sessionState: context.sessionState,
      pendingPresentation: context.pendingPresentation,
      candidate: reconstructed.candidate,
      currentSources: reconstructed.currentSources,
      acceptedDigest: digest,
      response: responseDecision(kind, digest),
      fitResult: null,
      legacyDeletions: null,
    });
    events.push('response-classified');
    if (action.kind === 'continue') {
      if (persist(action.sessionState, retrySameTurn, true)) {
        context.pendingPresentation = null;
        dispatchCount += 1;
      }
    } else if (['return-to-design', 'stop-declined', 'stop-ambiguous', 'completed-no-op', 'not-applicable', 'brainstorming-required'].includes(action.kind)) {
      context.pendingPresentation = null;
    }

    return action;
  };
  const invalidate = ({ reason, retrySameTurn = true }) => {
    const { nextState } = invalidateAgreementState({ reason });
    context.pendingPresentation = null;
    context.sessionState = null;

    return persist(nextState, retrySameTurn);
  };
  return {
    context,
    events,
    capture,
    preparePresentation,
    respond,
    invalidate,
    setText: (nextText) => { text = nextText; },
    storeFixture: () => storeFixture,
    dispatchCount: () => dispatchCount,
  };
}

test('revise profiles use agreement fingerprint selector', () => {
  const profileDirectory = join(__dirname, '..', '..', 'internal', 'revise');
  const engine = readFileSync(join(profileDirectory, 'SKILL.md'), 'utf8');
  const assertNoRetiredStatusExclusion = (source, label) => {
    assert.equal(source.includes('!/^Status:/'), false, `${label} must not exclude Status from the fingerprint`);
  };
  const profiles = [
    ['spec', readFileSync(join(profileDirectory, 'spec.md'), 'utf8')],
    ['plan', readFileSync(join(profileDirectory, 'plan.md'), 'utf8')],
    ['code', readFileSync(join(profileDirectory, 'code.md'), 'utf8')],
  ];

  for (const [name, profile] of profiles) {
    assert.equal(profile.includes('skills/spec-agreement/spec-agreement.js'), true, `${name} profile must use the agreement fingerprint selector`);
    assert.equal(profile.includes('selectArtifact'), true, `${name} profile must delegate selection to the agreement controller`);
    assert.equal(profile.includes('hashSelection'), true, `${name} profile must delegate hashing to the agreement controller`);
    assertNoRetiredStatusExclusion(profile, `${name} profile`);
  }
  assertNoRetiredStatusExclusion(engine, 'revise engine');
  const statusExclusionMutant = `${engine}\n!/^Status:/`;
  assert.throws(() => assertNoRetiredStatusExclusion(statusExclusionMutant, 'revise engine'), /revise engine must not exclude Status/);

  const [spec, plan, code] = profiles.map(([, profile]) => profile);
  assert.equal(spec.includes('writeProvenanceStamp'), true, 'spec profile must use the shared provenance writer');
  assert.equal(spec.includes('recognized placeholder'), true, 'spec profile must replace a recognized first-graduation placeholder');
  assert.equal(spec.includes('later provenance stamps append'), true, 'spec profile must append later provenance');
  assert.equal(spec.includes('complete revise-spec boundary batch'), true, 'spec profile must classify after the complete revise-spec batch');

  assert.equal(plan.includes('parsePlanContract'), true, 'plan profile must parse exact governing declarations');
  assert.equal(plan.includes('additions, removals, repoints, reorders, and retargeting'), true, 'plan profile must classify every governing declaration and target change');
  assert.equal(plan.includes('canonical duplicate collapse'), true, 'plan profile must avoid false prompts for duplicate declarations');
  assert.equal(plan.includes('Spec Reconciliation'), true, 'plan profile must classify governing edits from Spec Reconciliation');
  assert.equal(plan.includes('Every completed plan mutation batch is agreement-boundary relevant because the selected plan is the agreement target'), true, 'plan profile must mark every completed plan batch before interpreting final bytes');
  const planFitCheck = plan.indexOf('atomically write `Agreement boundary: fit-check`');
  const planInterpretationSteps = [
    'reparse the final plan bytes',
    'resolve the final declarations',
    'perform canonical duplicate collapse',
    'reconstruct the complete candidate',
    'compare target and declaration changes',
  ].map(step => [step, plan.indexOf(step)]);
  assert.notEqual(planFitCheck, -1, 'plan profile must contain the durable fit-check write');
  for (const [step, index] of planInterpretationSteps) {
    assert.notEqual(index, -1, `plan profile must ${step}`);
    assert.equal(planFitCheck < index, true, `plan profile must write fit-check before it can ${step}`);
  }
  assert.equal(plan.includes('An unchanged post-resolution candidate, including duplicate-collapsed identity, takes exact continuation without prompting'), true, 'plan profile must clear unchanged identity without a false prompt');
  assert.equal(plan.includes('A parse, resolution, reconstruction, or comparison failure retains `Agreement boundary: fit-check` and dispatches nothing'), true, 'plan profile must retain fit-check on interpretation failure');

  assert.equal(code.includes('active-plan target'), true, 'code profile must bind agreement to the active plan target');
  assert.equal(code.includes('governing artifact'), true, 'code profile must bind agreement to governing artifacts');
  assert.equal(code.includes('governing declarations'), true, 'code profile must classify active-plan declaration overlap');
  assert.equal(code.includes('ordinary cumulative-patch movement'), true, 'code profile must exclude ordinary cumulative-patch movement');
});

test('live quick-win guidance requires current-session agreement', () => {
  const quickWins = readRepositoryFile('.claude/QUICK_WINS.md');
  const templateControlledHeader = beforeFirstLevelTwoHeading(quickWins);
  const ruleCount = countExact(templateControlledHeader, currentSessionAgreementRule);

  assert.equal(ruleCount, 1, 'QUICK_WINS header must contain one current-session agreement rule');
});

test('init-backlog checklist owns final presentation freshness and targeted rerun rules', () => {
  const initBacklog = readRepositoryFile('skills/init-backlog/SKILL.md');
  const conceptChecklists = extractSection(initBacklog, '## Concept checklists');

  assert.equal(countExact(conceptChecklists, finalPresentationRule), 1, 'concept checklist must contain one final-presentation rule');
  assert.equal(countExact(conceptChecklists, freshAgreementRule), 1, 'concept checklist must contain one same-session freshness rule');
  assert.equal(countExact(conceptChecklists, targetedAgreementPatchRule), 1, 'concept checklist must contain one targeted rerun rule');
});

test('authoritative and live index headers require current-session agreement exactly once', () => {
  const initBacklog = readRepositoryFile('skills/init-backlog/SKILL.md');
  const indexes = ['QUICK_WINS.md', 'FEATURES.md', 'BUGS.md', 'PATTERNS.md'];

  for (const index of indexes) {
    const template = extractTemplate(initBacklog, `### \`.claude/${index}\``);
    const templateHeader = beforeFirstLevelTwoHeading(template);
    const liveHeader = beforeFirstLevelTwoHeading(readRepositoryFile(`.claude/${index}`));

    assert.equal(countExact(templateHeader, currentSessionAgreementRule), 1, `${index} template header must contain one current-session agreement rule`);
    assert.equal(countExact(liveHeader, currentSessionAgreementRule), 1, `${index} live header must contain one current-session agreement rule`);
  }
});

test('fresh and existing-root guidance composition carries agreement and autonomous continuation', () => {
  const initBacklog = readRepositoryFile('skills/init-backlog/SKILL.md');
  const freshRoot = extractTemplate(initBacklog, '### `CLAUDE.md` (fresh minimal file)');
  const freshGuidance = extractSection(freshRoot, '## Backlogs and indexes');
  const existingRootInstructions = extractSection(initBacklog, '### `CLAUDE.md` section (to append when `CLAUDE.md` exists without it)');
  assert.match(existingRootInstructions, /Use the complete `## Backlogs and indexes` section from the fresh `CLAUDE\.md` template above/);
  const existingRootGuidance = freshGuidance;

  for (const [name, guidance] of [['fresh root', freshGuidance], ['existing root', existingRootGuidance]]) {
    assert.equal(countExact(guidance, currentSessionAgreementRule), 1, `${name} guidance must contain one current-session agreement rule`);
    assert.equal(countExact(guidance, withinContractContinuationRule), 1, `${name} guidance must contain one autonomous continuation rule`);
    assert.equal(countExact(guidance, finalPresentationRule), 1, `${name} guidance must contain one final-presentation rule`);
    assert.equal(countExact(guidance, freshAgreementRule), 1, `${name} guidance must contain one same-session freshness rule`);
  }
});

test('README and AGENTS describe the current-session agreement contract', () => {
  const readme = readRepositoryFile('README.md');
  const agents = readRepositoryFile('AGENTS.md');

  assert.match(readme, /same-session agreement/);
  assert.match(readme, /within-contract[^.]*continue autonomously/);
  assert.equal(countExact(agents, currentSessionAgreementRule), 1, 'AGENTS must contain one current-session agreement rule');
  assert.equal(countExact(agents, withinContractContinuationRule), 1, 'AGENTS must contain one autonomous continuation rule');
});

test('related feature designs and excerpts record shipped agreement ordering and removed dependencies', () => {
  const features = readRepositoryFile('.claude/FEATURES.md');
  const pairs = [
    {
      path: '.claude/features/content-fingerprint-helper.md',
      heading: '### [Content fingerprint helper](features/content-fingerprint-helper.md)',
      dependencySection: '## Requirements',
      excerptRequirement: '**Requires:** none.',
      ordering: 'Present chosen spec for agreement before work shipped before Content fingerprint helper.',
    },
    {
      path: '.claude/features/second-opinion-gates.md',
      heading: '### [Second-opinion gates](features/second-opinion-gates.md)',
      dependencySection: '## Requirements',
      excerptRequirement: '**Requires:** [Contract-calibrated revise admission](features/contract-calibrated-revise-admission.md).',
      ordering: 'Present chosen spec for agreement before work shipped before Second-opinion gates.',
    },
    {
      path: '.claude/features/durable-scope-anchor.md',
      heading: '### [Durable scope anchor](features/durable-scope-anchor.md)',
      dependencySection: '## Requirements',
      excerptRequirement: '**Requires:** none.',
      ordering: 'Present chosen spec for agreement before work shipped before Durable scope anchor because the accepted digest authorizes its deliberate-empty exclusion and legacy backfill.',
    },
    {
      path: '.claude/features/agent-host-agnostic-nightshift.md',
      heading: '### [Agent-host-agnostic Nightshift](features/agent-host-agnostic-nightshift.md)',
      dependencySection: '## Related backlog work',
      designRequirement: '- [Move deterministic init-backlog mechanics out of promptspace](deterministic-init-backlog.md) is the remaining prerequisite for host-neutral scaffolding.',
      excerptRequirement: '  **Requires:** [Move deterministic init-backlog mechanics out of promptspace](features/deterministic-init-backlog.md).',
      ordering: 'The universal-skill MVP and the agreement gate are shipped; every later migration slice preserves that gate.',
    },
  ];

  for (const { path, heading, dependencySection, designRequirement, excerptRequirement, ordering } of pairs) {
    const design = readRepositoryFile(path);
    const designDependencies = extractSection(design, dependencySection);
    const excerpt = extractFeatureEntry(features, heading);

    assert.equal(/^[ \t]*\*\*(Requires|External):\*\*/m.test(designDependencies), false, `${path} must carry no dependency line in ${dependencySection}; the index entry is the sole authority`);
    if (designRequirement !== undefined) {
      assert.equal(countExact(designDependencies, designRequirement), 1, `${path} must carry its current prerequisite once in ${dependencySection}`);
    }
    assert.equal(countExact(excerpt, excerptRequirement), 1, `${heading} excerpt must carry its current prerequisite once`);
    assert.equal(countExact(design, ordering), 1, `${path} must contain its ordering sentence once`);
    assert.equal(countExact(excerpt, ordering), 1, `${heading} excerpt must contain its ordering sentence once`);
  }
  const activeRequires = features.match(/^[ \t]*\*\*Requires:\*\*.*$/gm) ?? [];
  assert.equal(activeRequires.some((line) => line.includes('present-spec-for-agreement.md')), false, 'active dependency lines must not reference the shipped agreement feature');
});

test('CLI rejects malformed request envelope', () => {
  const result = spawnSync(process.execPath, [join(__dirname, 'spec-agreement.js')], {
    encoding: 'utf8',
    input: '{}',
  });

  assert.equal(result.status, 2, 'malformed CLI request must exit 2');
});

function cliSource(source) {
  return {
    path: source.path,
    selectorKind: source.selectorKind,
    selectors: source.selectors,
    selectedBytesHex: source.selectedBytes.toString('hex'),
    sourceSpansHex: source.sourceSpans.map((span) => span.toString('hex')),
    sourceRanges: source.sourceRanges,
  };
}

function cliRequest(requestRecord) {
  return {
    mode: requestRecord.mode,
    projectRoot: requestRecord.projectRoot,
    target: requestRecord.target,
    seeds: requestRecord.seeds,
    planBytesHex: requestRecord.planBuffer === null ? null : requestRecord.planBuffer.toString('hex'),
    selectedSliceDeclaration: requestRecord.selectedSliceDeclaration,
    allowSpecLess: requestRecord.allowSpecLess,
    allowCompletedNoOp: requestRecord.allowCompletedNoOp,
  };
}

function cliSessionState(sessionState) {
  return {
    agreementRecord: {
      acceptedDigest: sessionState.agreementRecord.acceptedDigest,
      acceptedCandidate: sessionState.agreementRecord.acceptedCandidate,
      currentCandidate: sessionState.agreementRecord.currentCandidate,
      currentSources: sessionState.agreementRecord.currentSources.map(cliSource),
    },
    fitEvidence: sessionState.fitEvidence,
  };
}

function parseCliResult(result) {
  assert.equal(result.outputText.endsWith('\n'), true);
  assert.equal(result.outputText.slice(0, -1).includes('\n'), false);
  const envelope = JSON.parse(result.outputText);
  assert.equal(result.outputText, `${JSON.stringify(envelope)}\n`);
  assert.deepEqual(Object.keys(envelope), envelope.ok ? ['ok', 'value'] : ['ok', 'error']);
  if (!envelope.ok) {
    assert.deepEqual(Object.keys(envelope.error), ['code', 'message', 'evidence']);
  }

  return envelope;
}

test('CLI dispatches every allowlisted operation through closed JSON records', () => {
  const artifact = mutableArtifact(Buffer.from('# Spec\n'));
  const base = candidateFixture();
  const changed = candidateFixture([{ path: 'docs/spec.md', text: '# Spec\r\n' }]);
  const comparison = compareCandidates({ previousCandidate: base.candidate, currentCandidate: changed.candidate });
  const hunks = buildDerivedDiff({
    previousCandidate: base.candidate,
    currentCandidate: changed.candidate,
    previousSources: base.currentSources,
    currentSources: changed.currentSources,
  }).hunks;
  const fitEvidence = validateContractFitVerdict({ comparison, hunks, semanticInput: null });
  const sessionState = createAgreementState({
    acceptedDigest: 'digest-v1',
    presentedCandidate: base.candidate,
    responseDecision: responseDecision('agree'),
    reconstructedCandidate: base.candidate,
    reconstructedSources: base.currentSources,
  });
  const plan = `**Spec:** [docs/spec.md](docs/spec.md)\n\n## Governing specs\n\n- Spec JSON: ${JSON.stringify(base.candidate.target)}\n\n## Work\n\nbody\n`;
  const legacyBytes = Buffer.from('Status: signed off\n\n# Spec\n');
  const legacyLine = Buffer.from('Status: signed off\n');
  const resolvedValue = {
    kind: 'resolved',
    target: base.candidate.target,
    governingScopes: base.candidate.governingScopes,
    artifacts: [{
      path: 'docs/spec.md',
      selectorKind: 'design-before-hardening',
      selectors: [],
      sourceBytesHex: Buffer.from('# Spec\n').toString('hex'),
    }],
  };
  const cases = [
    ['plan-parse', { planBytesHex: Buffer.from(plan).toString('hex'), projectRoot }, (value) => assert.equal(value.governingScopes.length, 1)],
    ['plan-serialize', { planBodyBytesHex: Buffer.from('# Plan\n\n## Work\n\nbody\n').toString('hex'), governingScopes: [] }, (value) => assert.match(value.planBytesHex, /^[a-f0-9]+$/)],
    ['resolve', cliRequest(request({ target: base.candidate.target, seeds: [base.candidate.target] })), (value) => assert.equal(value.artifacts[0].sourceBytesHex, Buffer.from('# Spec\n').toString('hex'))],
    ['candidate', resolvedValue, (value) => assert.equal(value.currentSources[0].selectedBytesHex, Buffer.from('# Spec\n').toString('hex'))],
    ['compare', { previousCandidate: base.candidate, currentCandidate: base.candidate }, (value) => assert.equal(value.kind, 'equal')],
    ['diff', { previousCandidate: base.candidate, currentCandidate: base.candidate, previousSources: base.currentSources.map(cliSource), currentSources: base.currentSources.map(cliSource) }, (value) => assert.deepEqual(value.hunks, [])],
    ['fit', { comparison: { kind: 'equal', evidence: [] }, hunks: [], semanticInput: null }, (value) => assert.equal(value.verdict, 'within-contract')],
    ['locate', { projectRoot, path: 'docs/FEATURES.md', selectorKind: 'bullet-entry', selectors: [{ parentHeading: '## Parent', entryTitle: 'Task' }], sourceBytesHex: Buffer.from(['# Index', '', '## Parent', '- First', '- Task', ''].join('\n')).toString('hex') }, (value) => assert.deepEqual(value, { path: 'docs/FEATURES.md', line: 5, linkText: 'docs/FEATURES.md:5', linkTarget: `${projectRoot.replace(/\\/g, '/')}/docs/FEATURES.md` })],
    ['state-create', {
      acceptedDigest: 'digest-v1',
      presentedCandidate: base.candidate,
      responseDecision: responseDecision('agree'),
      reconstructedCandidate: base.candidate,
      reconstructedSources: base.currentSources.map(cliSource),
    }, (value) => assert.equal(value.agreementRecord.acceptedDigest, 'digest-v1')],
    ['state-refresh', {
      agreementRecord: cliSessionState(sessionState).agreementRecord,
      candidate: changed.candidate,
      currentSources: changed.currentSources.map(cliSource),
      fitEvidence,
    }, (value) => assert.equal(value.agreementRecord.currentCandidate.artifacts[0].sourceHash, changed.candidate.artifacts[0].sourceHash)],
    ['state-invalidate', { reason: 'completion' }, (value) => assert.deepEqual(value, { nextState: null, reason: 'completion' })],
    ['gate', {
      phase: 'lifecycle-entry',
      request: cliRequest(request({ target: base.candidate.target, seeds: [base.candidate.target] })),
      resolution: resolvedValue,
      sessionState: null,
      pendingPresentation: null,
      candidate: base.candidate,
      currentSources: base.currentSources.map(cliSource),
      acceptedDigest: 'digest-v1',
      response: null,
      fitResult: null,
      legacyDeletions: null,
    }, (value) => assert.equal(value.kind, 'present-digest')],
    ['legacy-detect', { artifacts: [{ path: 'docs/spec.md', selectorKind: 'design-before-hardening', selectors: [], sourceBytesHex: legacyBytes.toString('hex') }] }, (value) => assert.equal(value.matches[0].rawLineHex, legacyLine.toString('hex'))],
    ['legacy-preview', {
      sourceBytesHex: legacyBytes.toString('hex'),
      baselineHash: fullHash(legacyBytes),
      matches: [{ path: 'docs/spec.md', kind: 'status', rawStart: 0, rawEnd: legacyLine.length, rawLineHex: legacyLine.toString('hex') }],
    }, (value) => assert.equal(value.replacementBytesHex, Buffer.from('# Spec\n').toString('hex'))],
    ['provenance-write', {
      projectRoot,
      path: 'docs/spec.md',
      stamp: '- revise-spec graduated 2026-08-19 04:00 at abcdef0, scope: whole file, content: 1234abcd',
      baselineHash: fullHash(Buffer.from('# Spec\n')),
    }, (value) => assert.equal(value.alreadyApplied, false)],
  ];

  for (const [operation, input, assertValue] of cases) {
    const result = runCli({ requestText: JSON.stringify({ operation, input }) }, { fsAdapter: artifact.adapter, readyParser, environment: {} });
    assert.equal(result.exitCode, 0, operation);
    const envelope = parseCliResult(result);
    assert.equal(envelope.ok, true, operation);
    assertValue(envelope.value);
  }
});

test('CLI locate reads the line-link format from the injected environment, defaulting to the process environment', () => {
  const input = { projectRoot, path: 'docs/FEATURES.md', selectorKind: 'bullet-entry', selectors: [{ parentHeading: '## Parent', entryTitle: 'Task' }], sourceBytesHex: Buffer.from('## Parent\n- Task\n').toString('hex') };
  const requestText = JSON.stringify({ operation: 'locate', input });
  const fsAdapter = fakeRepository({});

  const formatted = parseCliResult(runCli({ requestText }, { fsAdapter, readyParser, environment: { NIGHTSHIFT_LINE_LINK_FORMAT: 'editor://{path}:{line}' } }));
  assert.deepEqual(formatted.value, { path: 'docs/FEATURES.md', line: 2, linkText: 'docs/FEATURES.md:2', linkTarget: 'editor://C:/repo/docs/FEATURES.md:2' });

  const unset = parseCliResult(runCli({ requestText }, { fsAdapter, readyParser, environment: {} }));
  assert.equal(unset.value.linkTarget, 'C:/repo/docs/FEATURES.md');

  const previous = process.env.NIGHTSHIFT_LINE_LINK_FORMAT;
  process.env.NIGHTSHIFT_LINE_LINK_FORMAT = 'proc://{line}';
  try {
    assert.equal(parseCliResult(runCli({ requestText }, { fsAdapter, readyParser })).value.linkTarget, 'proc://2');
  } finally {
    if (previous === undefined) { delete process.env.NIGHTSHIFT_LINE_LINK_FORMAT; } else { process.env.NIGHTSHIFT_LINE_LINK_FORMAT = previous; }
  }

  const rejected = parseCliResult(runCli({ requestText: JSON.stringify({ operation: 'locate', input: { ...input, linkFormat: 'x' } }) }, { fsAdapter, readyParser, environment: {} }));
  assert.equal(rejected.ok, false, 'the CLI owns linkFormat; a caller cannot smuggle one in');
});
test('CLI maps invocation, controller, and adapter failures to exact exit classes', () => {
  const base = candidateFixture();
  const malformedRequests = [
    '{',
    JSON.stringify({ operation: 'compare' }),
    JSON.stringify({ operation: 'compare', input: {}, extra: true }),
    JSON.stringify({ input: {}, operation: 'compare' }),
    JSON.stringify({ operation: 'unknown', input: {} }),
    JSON.stringify({ operation: 'plan-parse', input: { planBytesHex: '0', projectRoot } }),
    JSON.stringify({ operation: 'plan-parse', input: { planBytesHex: 'zz', projectRoot } }),
  ];
  for (const requestText of malformedRequests) {
    const result = runCli({ requestText }, { fsAdapter: fakeRepository({ 'docs/spec.md': '# Spec\n' }), readyParser });
    const envelope = parseCliResult(result);
    assert.equal(result.exitCode, 2);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, 'invocation-error');
  }

  const controllerFailure = runCli({
    requestText: JSON.stringify({ operation: 'compare', input: { previousCandidate: {}, currentCandidate: base.candidate } }),
  }, { fsAdapter: fakeRepository({ 'docs/spec.md': '# Spec\n' }), readyParser });
  assert.equal(controllerFailure.exitCode, 1);
  assert.equal(parseCliResult(controllerFailure).error.code, 'structural-error');

  const failingArtifact = mutableArtifact(Buffer.from('# Spec\n'));
  failingArtifact.adapter.replaceFileAtomically = () => {
    throw new Error('replace unavailable');
  };
  const adapterFailure = runCli({
    requestText: JSON.stringify({
      operation: 'provenance-write',
      input: {
        projectRoot,
        path: 'docs/spec.md',
        stamp: '- revise-spec graduated 2026-08-19 04:00 at abcdef0, scope: whole file, content: 1234abcd',
        baselineHash: fullHash(Buffer.from('# Spec\n')),
      },
    }),
  }, { fsAdapter: failingArtifact.adapter, readyParser });
  assert.equal(adapterFailure.exitCode, 2);
  assert.equal(parseCliResult(adapterFailure).error.code, 'unexpected-adapter-failure');
});

test('CLI rejects duplicate raw JSON keys before identity decoding', () => {
  const target = scope('whole-file', 'docs/spec.md');
  const targetJson = JSON.stringify(target);
  const requestText = `{"operation":"candidate","input":{"kind":"resolved","target":${targetJson},"governingScopes":[${targetJson}],"artifacts":[{"path":"attacker.md","path":"docs/spec.md","selectorKind":"design-before-hardening","selectors":[],"sourceBytesHex":"${Buffer.from('# Spec\n').toString('hex')}"}]}}`;

  const direct = runCli({ requestText });
  assert.equal(direct.exitCode, 2);
  assert.equal(parseCliResult(direct).error.code, 'invocation-error');

  const production = spawnSync(process.execPath, [join(__dirname, 'spec-agreement.js')], {
    encoding: 'utf8',
    input: requestText,
  });
  assert.equal(production.status, 2);
  assert.equal(JSON.parse(production.stdout).error.code, 'invocation-error');
});

test('CLI preserves __proto__ as an own key for closed-record validation', () => {
  const requestText = '{"operation":"state-invalidate","input":{"reason":"completion","__proto__":{"polluted":true}}}';

  const direct = runCli({ requestText });
  assert.equal(direct.exitCode, 1);
  assert.equal(parseCliResult(direct).error.code, 'structural-error');

  const production = spawnSync(process.execPath, [join(__dirname, 'spec-agreement.js')], {
    encoding: 'utf8',
    input: requestText,
  });
  assert.equal(production.status, 1);
  assert.equal(JSON.parse(production.stdout).error.code, 'structural-error');
});

test('CLI rejects raw Buffer keys and raw-hex aliases throughout wire records', () => {
  const rawBufferKeys = ['planBuffer', 'planBody', 'sourceBuffer', 'selectedBytes', 'sourceSpans', 'rawLine', 'replacementBytes', 'bytes'];
  const rawOnly = rawBufferKeys.map((rawKey) => ({
    operation: 'state-invalidate',
    input: { reason: 'completion', nested: { [rawKey]: 'raw-wire-value' } },
    label: `raw ${rawKey}`,
  }));
  const planBytes = Buffer.from('# Plan\n').toString('hex');
  const sourceBytes = Buffer.from('# Spec\n').toString('hex');
  const aliasCollisions = [
    { operation: 'plan-serialize', input: { planBody: 'raw-wire-value', planBodyBytesHex: planBytes, governingScopes: [] }, label: 'raw before hex' },
    { operation: 'plan-serialize', input: { planBodyBytesHex: planBytes, planBody: 'raw-wire-value', governingScopes: [] }, label: 'hex before raw' },
    {
      operation: 'candidate',
      input: { kind: 'resolved', target: scope('whole-file', 'docs/spec.md'), governingScopes: [scope('whole-file', 'docs/spec.md')], artifacts: [{ path: 'docs/spec.md', selectorKind: 'design-before-hardening', selectors: [], sourceBuffer: 'raw-wire-value', sourceBytesHex: sourceBytes }] },
      label: 'nested artifact raw before hex',
    },
    {
      operation: 'candidate',
      input: { kind: 'resolved', target: scope('whole-file', 'docs/spec.md'), governingScopes: [scope('whole-file', 'docs/spec.md')], artifacts: [{ path: 'docs/spec.md', selectorKind: 'design-before-hardening', selectors: [], sourceBytesHex: sourceBytes, sourceBuffer: 'raw-wire-value' }] },
      label: 'nested artifact hex before raw',
    },
    {
      operation: 'diff',
      input: { previousCandidate: {}, currentCandidate: {}, previousSources: [], currentSources: [{ selectedBytes: 'raw-wire-value', selectedBytesHex: sourceBytes, sourceSpans: [], sourceSpansHex: [sourceBytes] }] },
      label: 'nested source aliases',
    },
  ];

  for (const { operation, input, label } of [...rawOnly, ...aliasCollisions]) {
    const result = runCli({ requestText: JSON.stringify({ operation, input }) }, { fsAdapter: fakeRepository({}), readyParser });
    const envelope = parseCliResult(result);

    assert.equal(result.exitCode, 2, label);
    assert.equal(envelope.error.code, 'invocation-error', label);
  }
});

test('production CLI pipes resolve output directly into candidate construction', () => {
  const cliRoot = mkdtempSync(join(tmpdir(), 'nightshift-agreement-cli-'));
  try {
    writeFileSync(join(cliRoot, 'spec.md'), '# CLI spec\n');
    const target = scope('whole-file', 'spec.md');
    const resolveResult = spawnSync(process.execPath, [join(__dirname, 'spec-agreement.js')], {
      encoding: 'utf8',
      input: JSON.stringify({ operation: 'resolve', input: cliRequest(request({ projectRoot: cliRoot, target, seeds: [target] })) }),
    });

    assert.equal(resolveResult.status, 0);
    assert.equal(resolveResult.stderr, '');
    assert.equal(resolveResult.stdout.slice(0, -1).includes('\n'), false);
    const resolvedEnvelope = JSON.parse(resolveResult.stdout);
    assert.deepEqual(Object.keys(resolvedEnvelope), ['ok', 'value']);
    assert.equal(resolvedEnvelope.ok, true);

    const candidateResult = spawnSync(process.execPath, [join(__dirname, 'spec-agreement.js')], {
      encoding: 'utf8',
      input: JSON.stringify({ operation: 'candidate', input: resolvedEnvelope.value }),
    });

    assert.equal(candidateResult.status, 0);
    assert.equal(candidateResult.stderr, '');
    assert.equal(candidateResult.stdout.slice(0, -1).includes('\n'), false);
    const candidateEnvelope = JSON.parse(candidateResult.stdout);
    assert.deepEqual(Object.keys(candidateEnvelope), ['ok', 'value']);
    assert.equal(candidateEnvelope.value.candidate.artifacts[0].contentHash, 'f6e6ed416c92a57e438bdd0071d7ca13b70a3b809b57e82cdde78407b55cbb5b');
    assert.equal(candidateEnvelope.value.candidate.artifacts[0].sourceHash, '7d7e7549d9fae0c7563b62879a73a31391369369d023526b7a11b2f5a371a734');
    assert.equal(candidateEnvelope.value.currentSources[0].selectedBytesHex, '2320434c4920737065630a');
    assert.deepEqual(candidateEnvelope.value.currentSources[0].sourceSpansHex, ['2320434c4920737065630a']);
  } finally {
    rmSync(cliRoot, { force: true, recursive: true });
  }
});

function renderDigestFixture(fields) {
  const renderItems = (items, explicitlyNone) => {
    if (items.length === 0) {
      return explicitlyNone ? 'none explicitly stated' : 'none found after full governing-set review';
    }

    return items.map((item) => `- ${item.text} (source: ${item.source})`).join('\n');
  };
  if (fields.goal.text.trim() === '' || fields.goal.source.trim() === '' || fields.decisions.length === 0 || fields.decisions.some((item) => item.text.trim() === '' || item.source.trim() === '')) {
    throw new AgreementError('structural-error', 'Digest requires source-backed goal and decisions.', { kind: 'selector-shape' });
  }
  const artifactLines = fields.artifacts.map((artifact) => `- [${artifact.path}](${artifact.path})`).join('\n');
  const workUnits = fields.workUnits.map((workUnit) => `- ${workUnit}`).join('\n');

  return [
    '# Agreement digest',
    '## Governing artifacts', artifactLines,
    '## Requested target', fields.target,
    '## Selected work units', workUnits,
    '## Goal', `${fields.goal.text} (source: ${fields.goal.source})`,
    '## Material exclusions', renderItems(fields.exclusions, fields.explicitNone.exclusions),
    '## Non-goals', renderItems(fields.nonGoals, fields.explicitNone.nonGoals),
    '## Material decisions', renderItems(fields.decisions, false),
    '## Backlog dependencies', renderItems(fields.dependencies, fields.explicitNone.dependencies),
    '## External prerequisites', renderItems(fields.prerequisites, fields.explicitNone.prerequisites),
    '## Unresolved questions', renderItems(fields.questions, fields.explicitNone.questions),
    '## Provisional or deferred live claims', renderItems(fields.liveClaims, fields.explicitNone.liveClaims),
  ].join('\n');
}

function digestSection(digest, heading) {
  const start = digest.indexOf(`## ${heading}\n`);
  assert.notEqual(start, -1, `${heading} field must be rendered`);
  const bodyStart = start + heading.length + 4;
  const next = digest.indexOf('\n## ', bodyStart);

  return digest.slice(bodyStart, next === -1 ? digest.length : next);
}

test('natural-language adapters enter agreement without explicit handover wording', () => {
  const cases = [
    ['validate docs/spec.md against the repository', 'lifecycle-entry', 'generic', 'lifecycle'],
    ['review the requirements in docs/spec.md', 'lifecycle-entry', 'generic', 'lifecycle'],
    ['write an implementation plan for docs/spec.md', 'lifecycle-entry', 'planning', 'planning'],
    ['implement the design in docs/spec.md', 'lifecycle-entry', 'generic', 'lifecycle'],
    ['present the final design in docs/spec.md for agreement', 'final-presentation', 'brainstorming', 'final-presentation'],
  ];

  for (const [prompt, phase, caller, expectedMode] of cases) {
    assert.equal(prompt.includes('handover'), false);
    assert.equal(callerMode({ phase, caller }), expectedMode);
    const harness = callerHarness();
    let rendered;
    harness.preparePresentation({
      digest: `digest for ${prompt}`,
      mode: expectedMode,
      onRender: (pending) => { rendered = pending; },
    });
    assert.equal(harness.dispatchCount(), 0);
    assert.notEqual(rendered.candidate, null);
    assert.equal(rendered.digest, `digest for ${prompt}`);
    assert.equal(rendered.currentSources.length, rendered.candidate.artifacts.length);
  }
});

test('direct revise adapters stop before engine dispatch without a complete caller result', () => {
  const isCompleteAgreementRecord = (agreement) => {
    if (agreement === null || typeof agreement !== 'object' || Array.isArray(agreement)) {
      return false;
    }
    try {
      const validation = decideAgreementGate(gateInput({
        sessionState: { agreementRecord: agreement, fitEvidence: null },
        candidate: agreement.currentCandidate,
        currentSources: agreement.currentSources,
      }));

      return validation.kind === 'continue';
    } catch {
      return false;
    }
  };
  const toCallerResult = (action, resolution) => {
    if (action.kind === 'continue') {
      return { agreement: action.sessionState.agreementRecord, governingScopes: resolution.governingScopes };
    }
    if (action.kind === 'not-applicable') {
      return { agreement: 'not-applicable', governingScopes: [] };
    }

    return null;
  };
  const dispatchCount = (wrapperName, callerResult) => {
    const wrapper = readFileSync(join(__dirname, '..', wrapperName, 'SKILL.md'), 'utf8');
    const agreementIndex = wrapper.indexOf('../spec-agreement/SKILL.md');
    const engineIndex = wrapper.indexOf('../../internal/revise/SKILL.md');
    const authorityContract = wrapperName === 'revise-spec'
      ? 'Continue to the engine only when `callerResult.agreement` is a complete agreement record; stop without dispatch on `not-applicable` and every other outcome.'
      : 'Continue to the engine only when `callerResult.agreement` is a complete agreement record or the literal `not-applicable`; stop without dispatch on every other outcome.';
    const guardsAuthority = wrapper.includes(authorityContract);
    if (agreementIndex === -1 || agreementIndex > engineIndex || !guardsAuthority) {
      return -1;
    }
    if (callerResult?.agreement === 'not-applicable' && Array.isArray(callerResult.governingScopes) && callerResult.governingScopes.length === 0) {
      return wrapperName === 'revise-spec' ? 0 : 1;
    }
    if (callerResult !== null && Array.isArray(callerResult.governingScopes) && isCompleteAgreementRecord(callerResult.agreement)) {
      return 1;
    }

    return 0;
  };
  const absentAuthority = decideAgreementGate(gateInput());
  const notApplicableResolution = { kind: 'not-applicable', target: null, governingScopes: [], artifacts: [] };
  const notApplicable = decideAgreementGate({
    ...gateInput(),
    request: request({ allowSpecLess: true }),
    resolution: notApplicableResolution,
    candidate: null,
    currentSources: null,
  });
  const approvedFixture = gateInput();
  const pendingPresentation = { digest: approvedFixture.acceptedDigest, candidate: approvedFixture.candidate, currentSources: approvedFixture.currentSources };
  const approved = decideAgreementGate({ ...approvedFixture, pendingPresentation, response: responseDecision('agree') });
  const absentCallerResult = toCallerResult(absentAuthority, approvedFixture.resolution);
  const approvedCallerResult = toCallerResult(approved, approvedFixture.resolution);
  const notApplicableCallerResult = toCallerResult(notApplicable, notApplicableResolution);

  for (const wrapperName of ['revise-spec', 'revise-plan', 'revise-code']) {
    assert.equal(dispatchCount(wrapperName, absentCallerResult), 0, `${wrapperName} must not dispatch without current approval`);
    assert.equal(dispatchCount(wrapperName, null), 0, `${wrapperName} must not dispatch a null caller result`);
    assert.equal(dispatchCount(wrapperName, {}), 0, `${wrapperName} must not dispatch an empty caller result`);
    assert.equal(dispatchCount(wrapperName, approvedCallerResult), 1, `${wrapperName} must dispatch with current approval`);
    const expectedNotApplicableDispatches = wrapperName === 'revise-spec' ? 0 : 1;
    assert.equal(dispatchCount(wrapperName, notApplicableCallerResult), expectedNotApplicableDispatches, `${wrapperName} must enforce its spec-less caller contract`);
  }
});

test('shared lifecycle entry yields to handover completion before presentation', () => {
  const handover = readFileSync(join(__dirname, '..', 'handover', 'SKILL.md'), 'utf8');
  const agreement = readFileSync(join(__dirname, 'SKILL.md'), 'utf8');
  const assertOrdered = (source, tokens, label) => {
    let previous = source.indexOf('## Entry procedure');
    for (const token of tokens) {
      const current = source.indexOf(token, previous);
      assert.notEqual(current, -1, `${label} must include ${token}`);
      assert.equal(current > previous, true, `${label} must order ${token} after its predecessor`);
      previous = current;
    }
  };

  assertOrdered(agreement, [
    '`resolveGoverningSet`',
    '`detectLegacyMarkers`',
    'restart complete resolution from disk',
    'yield control to handover',
    'active-artifact completion no-op',
    'any Exploring member',
    'Build one stable presentation baseline',
  ], 'shared lifecycle entry');
  assertOrdered(handover, [
    'Load `../spec-agreement/SKILL.md`',
    '`resolveGoverningSet`',
    '`detectLegacyMarkers`',
    'completed active-artifact no-op',
    'Exploring',
    'Resume the shared `lifecycle-entry` candidate, presentation, and authority procedure',
  ], 'handover lifecycle entry');
  assert.equal(handover.includes('`callerResult.agreement` is only the complete public agreement-record projection'), true);
  assert.equal(handover.includes('`controllerContext.sessionState` remains the separate complete state authority'), true);
  assert.equal(handover.includes('Read `fitEvidence` only from `controllerContext.sessionState.fitEvidence`'), true);
});

test('handover unattended agreement blocks only when a renewed response is required', () => {
  const accepted = candidateFixture([{ path: 'docs/spec.md', text: '# Spec\nold\n' }]);
  const sessionState = createAgreementState({
    acceptedDigest: 'digest-v1',
    presentedCandidate: accepted.candidate,
    responseDecision: responseDecision('agree'),
    reconstructedCandidate: accepted.candidate,
    reconstructedSources: accepted.currentSources,
  });
  const exact = decideAgreementGate(gateInput({ resolution: accepted.resolution, sessionState, candidate: accepted.candidate, currentSources: accepted.currentSources }));
  const represented = candidateFixture([{ path: 'docs/spec.md', text: '# Spec\r\nold\r\n' }]);
  const representationComparison = compareCandidates({ previousCandidate: accepted.candidate, currentCandidate: represented.candidate });
  const representationHunks = buildDerivedDiff({
    previousCandidate: accepted.candidate,
    currentCandidate: represented.candidate,
    previousSources: accepted.currentSources,
    currentSources: represented.currentSources,
  }).hunks;
  const representationFit = validateContractFitVerdict({ comparison: representationComparison, hunks: representationHunks, semanticInput: null });
  const representation = decideAgreementGate(gateInput({ resolution: represented.resolution, sessionState, candidate: represented.candidate, currentSources: represented.currentSources, fitResult: representationFit }));
  const clarified = candidateFixture([{ path: 'docs/spec.md', text: '# Spec\nclarified\n' }]);
  const clarificationComparison = compareCandidates({ previousCandidate: accepted.candidate, currentCandidate: clarified.candidate });
  const clarificationHunks = buildDerivedDiff({
    previousCandidate: accepted.candidate,
    currentCandidate: clarified.candidate,
    previousSources: accepted.currentSources,
    currentSources: clarified.currentSources,
  }).hunks;
  const clarificationSemantic = {
    verdict: 'within-contract',
    reason: 'The edit clarifies an accepted decision.',
    citations: [{ kind: 'source', path: 'docs/spec.md', hunk: 1, digestFields: ['decisions'] }],
  };
  const clarificationFit = validateContractFitVerdict({ comparison: clarificationComparison, hunks: clarificationHunks, semanticInput: { kind: 'json', text: JSON.stringify(clarificationSemantic) } });
  const clarification = decideAgreementGate(gateInput({ resolution: clarified.resolution, sessionState, candidate: clarified.candidate, currentSources: clarified.currentSources, fitResult: clarificationFit }));
  const renewed = decideAgreementGate(gateInput());
  const handover = readFileSync(join(__dirname, '..', 'handover', 'SKILL.md'), 'utf8');

  assert.equal(exact.kind, 'continue');
  assert.equal(representation.kind, 'continue');
  assert.equal(clarification.kind, 'continue');
  assert.equal(renewed.kind, 'present-digest');
  assert.equal(handover.includes('Exact equality, representation-only drift, and a validated `within-contract` refresh continue unattended without a response.'), true, 'handover must preserve autonomous compatible continuation');
  assert.equal(handover.includes('Only a gate outcome that requires a fresh or renewed response blocks unattended continuation.'), true, 'handover must block only for a required response');
});

test('standalone planning activates agreement even without a discoverable governing spec', () => {
  const skill = readFileSync(join(__dirname, 'SKILL.md'), 'utf8');
  const description = /^description: "([^"]+)"$/m.exec(skill)?.[1] ?? '';
  const planningRequest = request({ mode: 'planning', allowSpecLess: true });
  const resolution = resolve(planningRequest, fakeRepository({}));
  const action = decideAgreementGate({
    phase: 'planning-result',
    request: planningRequest,
    resolution,
    sessionState: null,
    pendingPresentation: null,
    candidate: null,
    currentSources: null,
    acceptedDigest: null,
    response: null,
    fitResult: null,
    legacyDeletions: null,
  });
  const serialized = serializePlanContract({ planBody: Buffer.from('# Plan\n'), governingScopes: [] }).toString();

  assert.equal(description.includes('any standalone planning request'), true, 'standalone planning trigger must be unconditional');
  assert.equal(skill.includes('Standalone planning always activates this skill'), true, 'skill body must preserve unconditional standalone planning activation');
  assert.equal(action.kind, 'not-applicable');
  assert.equal(serialized, '# Plan\n\n**Spec:** none\n\n## Governing specs\n\n- None.\n\n');
});

test('spec-less plan and code review adapters continue only through not-applicable', () => {
  for (const mode of ['planning', 'revise-code']) {
    const requestRecord = request({ mode, allowSpecLess: true });
    const resolution = resolve(requestRecord, fakeRepository({}));
    const action = decideAgreementGate({
      phase: mode === 'planning' ? 'planning-result' : 'lifecycle-entry',
      request: requestRecord,
      resolution,
      sessionState: null,
      pendingPresentation: null,
      candidate: null,
      currentSources: null,
      acceptedDigest: null,
      response: null,
      fitResult: null,
      legacyDeletions: null,
    });

    assert.deepEqual(resolution, { kind: 'not-applicable', target: null, governingScopes: [], artifacts: [] });
    assert.equal(action.kind, 'not-applicable');
  }
});

test('all-field digest adapter keeps every sentinel in its named field', () => {
  const fields = {
    artifacts: [
      { path: 'docs/GOVERNING_PATH_ALPHA.md' },
      { path: 'docs/GOVERNING_PATH_BETA.md' },
    ],
    target: 'REQUESTED_TARGET_SENTINEL',
    workUnits: ['SELECTED_WORK_UNIT_ALPHA', 'SELECTED_WORK_UNIT_BETA'],
    goal: { text: 'GOAL_SENTINEL', source: 'docs/GOVERNING_PATH_ALPHA.md#goal' },
    exclusions: [{ text: 'EXCLUSION_SENTINEL', source: 'docs/GOVERNING_PATH_ALPHA.md#scope' }],
    nonGoals: [{ text: 'NON_GOAL_SENTINEL', source: 'docs/GOVERNING_PATH_BETA.md#scope' }],
    decisions: [
      { text: 'DECISION_SENTINEL_ALPHA', source: 'docs/GOVERNING_PATH_ALPHA.md#decisions' },
      { text: 'DECISION_SENTINEL_BETA', source: 'docs/GOVERNING_PATH_BETA.md#decisions' },
    ],
    dependencies: [{ text: 'DEPENDENCY_SENTINEL', source: '.claude/FEATURES.md#dependency' }],
    prerequisites: [{ text: 'PREREQUISITE_SENTINEL', source: 'docs/GOVERNING_PATH_BETA.md#prerequisites' }],
    questions: [{ text: 'QUESTION_SENTINEL', source: 'docs/GOVERNING_PATH_ALPHA.md#questions' }],
    liveClaims: [
      { text: 'PROVISIONAL_CLAIM_SENTINEL', source: 'docs/GOVERNING_PATH_ALPHA.md#verification' },
      { text: 'DEFERRED_CLAIM_SENTINEL', source: 'docs/GOVERNING_PATH_BETA.md#verification' },
    ],
    explicitNone: { exclusions: false, nonGoals: false, dependencies: false, prerequisites: false, questions: false, liveClaims: false },
    fencedLookalike: 'FENCED_LOOKALIKE_SENTINEL',
    ordinaryRelatedLinks: ['ORDINARY_RELATED_LINK_SENTINEL'],
  };
  const harness = callerHarness();
  harness.preparePresentation({ digestFields: fields });
  const digest = harness.context.pendingPresentation.digest;
  const expectedByField = {
    'Governing artifacts': ['GOVERNING_PATH_ALPHA', 'GOVERNING_PATH_BETA', '[docs/GOVERNING_PATH_ALPHA.md](docs/GOVERNING_PATH_ALPHA.md)', '[docs/GOVERNING_PATH_BETA.md](docs/GOVERNING_PATH_BETA.md)'],
    'Requested target': ['REQUESTED_TARGET_SENTINEL'],
    'Selected work units': ['SELECTED_WORK_UNIT_ALPHA', 'SELECTED_WORK_UNIT_BETA'],
    Goal: ['GOAL_SENTINEL'],
    'Material exclusions': ['EXCLUSION_SENTINEL'],
    'Non-goals': ['NON_GOAL_SENTINEL'],
    'Material decisions': ['DECISION_SENTINEL_ALPHA', 'DECISION_SENTINEL_BETA'],
    'Backlog dependencies': ['DEPENDENCY_SENTINEL'],
    'External prerequisites': ['PREREQUISITE_SENTINEL'],
    'Unresolved questions': ['QUESTION_SENTINEL'],
    'Provisional or deferred live claims': ['PROVISIONAL_CLAIM_SENTINEL', 'DEFERRED_CLAIM_SENTINEL'],
  };
  for (const [heading, sentinels] of Object.entries(expectedByField)) {
    const section = digestSection(digest, heading);
    for (const sentinel of sentinels) {
      assert.equal(section.includes(sentinel), true, `${sentinel} must occur in ${heading}`);
    }
  }
  assert.equal(digest.includes(fields.fencedLookalike), false);
  assert.equal(digest.includes(fields.ordinaryRelatedLinks[0]), false);
  expectStructural(() => callerHarness().preparePresentation({ digestFields: { ...fields, goal: { text: '', source: '' } } }), 'selector-shape');
  expectStructural(() => callerHarness().preparePresentation({ digestFields: { ...fields, decisions: [] } }), 'selector-shape');
});

test('digest adapter distinguishes explicit emptiness from reviewed absence', () => {
  const base = {
    artifacts: [{ path: 'docs/spec.md' }],
    target: 'target',
    workUnits: ['whole file'],
    goal: { text: 'goal', source: 'docs/spec.md#goal' },
    exclusions: [],
    nonGoals: [],
    decisions: [{ text: 'decision', source: 'docs/spec.md#decision' }],
    dependencies: [],
    prerequisites: [],
    questions: [],
    liveClaims: [],
    explicitNone: { exclusions: true, nonGoals: false, dependencies: false, prerequisites: false, questions: false, liveClaims: false },
  };
  const harness = callerHarness();
  harness.preparePresentation({ digestFields: base });
  const digest = harness.context.pendingPresentation.digest;

  assert.equal(digestSection(digest, 'Material exclusions'), 'none explicitly stated');
  assert.equal(digestSection(digest, 'Non-goals'), 'none found after full governing-set review');
});

test('interaction skill defines the host-neutral controller contract', () => {
  const skill = readFileSync(join(__dirname, 'SKILL.md'), 'utf8');
  const requiredOperations = [
    'resolveGoverningSet',
    'buildCandidate',
    'compareCandidates',
    'buildDerivedDiff',
    'validateContractFitVerdict',
    'createAgreementState',
    'refreshCompatibleState',
    'replaceAgreementState',
    'invalidateAgreementState',
    'decideAgreementGate',
    'detectLegacyMarkers',
    'previewLegacyMarkerDeletion',
    'parsePlanContract',
    'serializePlanContract',
  ];
  for (const operation of requiredOperations) {
    assert.equal(skill.includes(`\`${operation}\``), true, `skill must invoke ${operation} by export name`);
  }
  for (const mode of ['lifecycle-entry', 'final-presentation', 'planning-result', 'post-mutation']) {
    assert.equal(skill.includes(`\`${mode}\``), true, `skill must define ${mode}`);
  }
  for (const phrase of [
    'validate, review, implement, or hand over work',
    'final governing design',
    'none explicitly stated',
    'none found after full governing-set review',
    'agreement',
    'governingScopes',
    'storeQuarantined',
  ]) {
    assert.equal(skill.includes(phrase), true, `skill must contain ${phrase}`);
  }
  assert.equal(skill.includes('provider API'), false);
  assert.equal(skill.includes('durable approval'), false);
});

test('candidate construction binds one exact baseline and uses canonical identity order', () => {
  const fixture = candidateFixture();

  assert.equal(AGREEMENT_VERSION, 1);
  assert.deepEqual(fixture.candidate, {
    version: 1,
    target: { kind: 'whole-file', path: 'docs/spec.md', selectors: [], workUnit: null },
    governingScopes: [{ kind: 'whole-file', path: 'docs/spec.md', selectors: [], workUnit: null }],
    artifacts: [{
      path: 'docs/spec.md',
      selectorKind: 'design-before-hardening',
      selectors: [],
      contentHash: '603c828a03383f98b82bf9c6787deeb5c40c02871a1b8d6ba14b0d538020a02b',
      sourceHash: '697e857f26cd01379f759a2878de38ebabf5a49065da13abfd7870254df5d5d3',
    }],
  });
  assert.deepEqual(Object.keys(fixture.candidate), ['version', 'target', 'governingScopes', 'artifacts']);
  assert.deepEqual(Object.keys(fixture.candidate.artifacts[0]), ['path', 'selectorKind', 'selectors', 'contentHash', 'sourceHash']);
  assert.equal(candidateToken(fixture.candidate), 'a-e1e0993e211f');
  assert.deepEqual(Object.keys(fixture.currentSources[0]), ['path', 'selectorKind', 'selectors', 'selectedBytes', 'sourceSpans', 'sourceRanges']);

  const driftedSelection = hashSelection(selectArtifact({
    path: 'docs/spec.md',
    selectorKind: 'design-before-hardening',
    selectors: [],
    sourceBuffer: Buffer.from('# Drifted\n'),
  }));
  expectStructural(() => buildCandidate({ resolution: fixture.resolution, selections: [driftedSelection] }), 'selector-shape');

  const rawSelection = selectArtifact(fixture.resolution.artifacts[0]);
  expectStructural(() => hashSelection({ ...rawSelection, privateField: 'must not cross the boundary' }), 'selector-shape');
});

test('candidate construction rejects duplicate scope and artifact identities', () => {
  const fixture = candidateFixture();
  const duplicateScopes = {
    ...fixture.resolution,
    governingScopes: [fixture.resolution.governingScopes[0], fixture.resolution.governingScopes[0]],
  };
  const duplicateArtifacts = {
    ...fixture.resolution,
    artifacts: [fixture.resolution.artifacts[0], fixture.resolution.artifacts[0]],
  };

  expectStructural(() => buildCandidate({ resolution: duplicateScopes, selections: fixture.selections }), 'selector-shape');
  expectStructural(() => buildCandidate({ resolution: duplicateArtifacts, selections: [fixture.selections[0], fixture.selections[0]] }), 'selector-shape');

  const cli = runCli({
    requestText: JSON.stringify({
      operation: 'candidate',
      input: {
        ...duplicateArtifacts,
        artifacts: duplicateArtifacts.artifacts.map((artifact) => ({
          path: artifact.path,
          selectorKind: artifact.selectorKind,
          selectors: artifact.selectors,
          sourceBytesHex: artifact.sourceBuffer.toString('hex'),
        })),
      },
    }),
  });
  assert.equal(cli.exitCode, 1);
  assert.equal(parseCliResult(cli).error.evidence.kind, 'selector-shape');
});

test('selection and candidate boundaries reject reordered nested selector keys', () => {
  const sourceBuffer = Buffer.from('# Features\n\n## Active\n\n### Spec\nBody\n');
  const reversedSelector = { entryHeading: '### Spec', parentHeading: '## Active' };
  const artifact = {
    path: '.claude/FEATURES.md',
    selectorKind: 'index-entry',
    selectors: [reversedSelector],
    sourceBuffer,
  };

  expectStructural(() => selectArtifact(artifact), 'selector-shape');

  const target = scope('index-entry', artifact.path, [{ parentHeading: '## Active', entryHeading: '### Spec' }]);
  const resolution = {
    kind: 'resolved',
    target,
    governingScopes: [target],
    artifacts: [artifact],
  };
  const selection = hashSelection(selectArtifact({
    ...artifact,
    selectors: target.selectors,
  }));

  expectStructural(() => buildCandidate({ resolution, selections: [selection] }), 'selector-shape');
});

test('candidate boundaries reject noncanonical path identities', () => {
  const path = 'docs/spec\ninjected.md';
  const target = scope('whole-file', path);
  const artifact = { path, selectorKind: 'design-before-hardening', selectors: [], sourceBuffer: Buffer.from('# Spec\n') };

  expectStructural(() => hashSelection(selectArtifact(artifact)), 'selector-shape');

  const cli = runCli({
    requestText: JSON.stringify({
      operation: 'candidate',
      input: { kind: 'resolved', target, governingScopes: [target], artifacts: [{ ...artifact, sourceBytesHex: artifact.sourceBuffer.toString('hex'), sourceBuffer: undefined }] },
    }),
  });
  assert.equal(cli.exitCode, 1);
  assert.equal(parseCliResult(cli).error.evidence.kind, 'selector-shape');
});

test('agreement creation accepts only explicit current-digest agreement over the retained candidate and sources', () => {
  const presented = candidateFixture();
  const reconstructed = candidateFixture();
  const input = {
    acceptedDigest: 'digest-v1',
    presentedCandidate: presented.candidate,
    responseDecision: responseDecision('agree'),
    reconstructedCandidate: reconstructed.candidate,
    reconstructedSources: reconstructed.currentSources,
  };
  const state = createAgreementState(input);

  assert.deepEqual(Object.keys(state), ['agreementRecord', 'fitEvidence']);
  assert.deepEqual(Object.keys(state.agreementRecord), ['acceptedDigest', 'acceptedCandidate', 'currentCandidate', 'currentSources']);
  assert.deepEqual(state.agreementRecord.acceptedCandidate, presented.candidate);
  assert.deepEqual(state.agreementRecord.currentCandidate, reconstructed.candidate);
  assert.deepEqual(state.agreementRecord.currentSources, reconstructed.currentSources);
  assert.equal(state.fitEvidence, null);
  assert.equal(Object.isFrozen(state), true);
  assert.equal(Object.isFrozen(state.agreementRecord), true);
  assert.equal(Object.isFrozen(state.agreementRecord.currentSources), true);

  const changed = candidateFixture([{ path: 'docs/spec.md', text: '# Changed\n' }]);
  const invalidInputs = [
    { ...input, responseDecision: { kind: 'agree', digest: 'digest-v1' } },
    { ...input, responseDecision: responseDecision('agree', 'digest-v1', '') },
    { ...input, responseDecision: responseDecision('changes-requested') },
    { ...input, responseDecision: responseDecision('agree', 'stale-digest') },
    { ...input, reconstructedCandidate: changed.candidate, reconstructedSources: changed.currentSources },
    { ...input, extra: true },
  ];
  for (const invalidInput of invalidInputs) {
    expectStructural(() => createAgreementState(invalidInput), 'selector-shape');
  }

  const tamperedSources = structuredClone(reconstructed.currentSources);
  tamperedSources[0].selectedBytes = Buffer.from('# Tampered\n');
  expectStructural(() => createAgreementState({ ...input, reconstructedSources: tamperedSources }), 'selector-shape');
  const mismatchedRange = reconstructed.currentSources.map((source) => ({ ...source, sourceRanges: [{ start: 0, end: source.sourceSpans[0].length + 1 }] }));
  expectStructural(() => createAgreementState({ ...input, reconstructedSources: mismatchedRange }), 'selector-shape');
});

test('agreement state source buffers are defensive immutable snapshots', () => {
  const fixture = candidateFixture();
  const state = createAgreementState({
    acceptedDigest: 'digest-v1',
    presentedCandidate: fixture.candidate,
    responseDecision: responseDecision('agree'),
    reconstructedCandidate: fixture.candidate,
    reconstructedSources: fixture.currentSources,
  });
  const beforeSelected = state.agreementRecord.currentSources[0].selectedBytes.toString('hex');
  const beforeSpan = state.agreementRecord.currentSources[0].sourceSpans[0].toString('hex');
  const selectedRead = state.agreementRecord.currentSources[0].selectedBytes;
  const spansRead = state.agreementRecord.currentSources[0].sourceSpans;

  selectedRead.fill(0);
  spansRead[0].fill(0);

  assert.equal(state.agreementRecord.currentSources[0].selectedBytes.toString('hex'), beforeSelected);
  assert.equal(state.agreementRecord.currentSources[0].sourceSpans[0].toString('hex'), beforeSpan);
  assert.notStrictEqual(state.agreementRecord.currentSources[0].selectedBytes, state.agreementRecord.currentSources[0].selectedBytes);
  assert.notStrictEqual(state.agreementRecord.currentSources[0].sourceSpans[0], state.agreementRecord.currentSources[0].sourceSpans[0]);
});

test('volatile replacement preserves object identity, normalizes every failure, and supports null invalidation', () => {
  const fixture = candidateFixture();
  const state = createAgreementState({
    acceptedDigest: 'digest-v1',
    presentedCandidate: fixture.candidate,
    responseDecision: responseDecision('agree'),
    reconstructedCandidate: fixture.candidate,
    reconstructedSources: fixture.currentSources,
  });
  const successful = fakeVolatileStore(Buffer.from('prior'));

  assert.strictEqual(replaceAgreementState({ store: successful.store, nextState: state }), state);
  assert.strictEqual(successful.calls()[0], state);
  const invalidation = invalidateAgreementState({ reason: 'session-end' });
  assert.deepEqual(invalidation, { nextState: null, reason: 'session-end' });
  assert.equal(replaceAgreementState({ store: successful.store, nextState: invalidation.nextState }), null);
  assert.equal(successful.checkpointBytes().toString(), 'null');

  for (const thrown of [new Error('disk full'), new AgreementError('structural-error', 'nested failure'), 'plain failure']) {
    const priorBytes = Buffer.from('owned-checkpoint-bytes');
    const failing = fakeVolatileStore(priorBytes, [thrown]);

    assert.throws(
      () => replaceAgreementState({ store: failing.store, nextState: state }),
      (error) => error instanceof AgreementError
        && error.code === 'state-storage-failed'
        && error.evidence.operation === 'replaceAgreementState'
        && error.evidence.originalMessage === (thrown instanceof Error ? thrown.message : String(thrown)),
    );
    assert.equal(failing.calls().length, 1);
    assert.equal(failing.checkpointBytes().toString('hex'), priorBytes.toString('hex'));
  }
});

test('compatible refresh retains accepted authorities and stores validated fit evidence atomically', () => {
  const accepted = candidateFixture([
    { path: 'docs/spec.md', text: '# Spec\nold\n' },
    { path: 'docs/companion.md', text: '# Companion\n' },
  ]);
  const current = candidateFixture([
    { path: 'docs/spec.md', text: '# Spec\nnew\n' },
    { path: 'docs/companion.md', text: '# Companion\n' },
  ]);
  const agreementRecord = createAgreementState({
    acceptedDigest: 'digest-v1',
    presentedCandidate: accepted.candidate,
    responseDecision: responseDecision('agree'),
    reconstructedCandidate: accepted.candidate,
    reconstructedSources: accepted.currentSources,
  }).agreementRecord;
  const hunks = buildDerivedDiff({
    previousCandidate: accepted.candidate,
    currentCandidate: current.candidate,
    previousSources: accepted.currentSources,
    currentSources: current.currentSources,
  }).hunks;
  const fitEvidence = {
    verdict: 'within-contract',
    reason: 'The implementation detail remains inside the accepted decision.',
    citations: [{ kind: 'source', path: 'docs/spec.md', hunk: 1, digestFields: ['decisions'] }],
    hunkHash: fullHash(Buffer.from(JSON.stringify(hunks))),
  };
  const refreshed = refreshCompatibleState({ agreementRecord, candidate: current.candidate, currentSources: current.currentSources, fitEvidence });

  assert.deepEqual(refreshed.agreementRecord.acceptedCandidate, accepted.candidate);
  assert.deepEqual(refreshed.agreementRecord.currentCandidate, current.candidate);
  assert.deepEqual(refreshed.agreementRecord.currentSources, current.currentSources);
  assert.deepEqual(refreshed.fitEvidence, fitEvidence);
  assert.equal(refreshed.agreementRecord.acceptedDigest, 'digest-v1');

  const reordered = [...current.currentSources].reverse();
  expectStructural(() => refreshCompatibleState({ agreementRecord, candidate: current.candidate, currentSources: reordered, fitEvidence }), 'selector-shape');
  expectStructural(() => refreshCompatibleState({ agreementRecord, candidate: current.candidate, currentSources: current.currentSources, fitEvidence: { ...fitEvidence, verdict: 'uncertain' } }), 'selector-shape');
  const structurallyChanged = structuredClone(current.candidate);
  structurallyChanged.target = { kind: 'sections', path: 'docs/spec.md', selectors: [{ headingPath: ['## Scope'] }], workUnit: null };
  expectStructural(() => refreshCompatibleState({ agreementRecord, candidate: structurallyChanged, currentSources: current.currentSources, fitEvidence }), 'selector-shape');
  const fabricatedFitEvidence = { ...fitEvidence, citations: [{ kind: 'source', path: 'docs/other.md', hunk: 1, digestFields: ['decisions'] }] };
  expectStructural(() => refreshCompatibleState({ agreementRecord, candidate: current.candidate, currentSources: current.currentSources, fitEvidence: fabricatedFitEvidence }), 'selector-shape');
  const missingFitEvidence = { ...fitEvidence, citations: [{ kind: 'source', path: 'docs/spec.md', hunk: 2, digestFields: ['decisions'] }] };
  expectStructural(() => refreshCompatibleState({ agreementRecord, candidate: current.candidate, currentSources: current.currentSources, fitEvidence: missingFitEvidence }), 'selector-shape');
});

test('compatible evidence remains transition-local across later autonomous refreshes', () => {
  const accepted = candidateFixture([{ path: 'docs/spec.md', text: 'accepted\n' }]);
  const canonical = candidateFixture([{ path: 'docs/spec.md', text: 'compatible\n' }]);
  const representation = candidateFixture([{ path: 'docs/spec.md', text: 'compatible\r\n' }]);
  const initial = createAgreementState({
    acceptedDigest: 'digest-v1',
    presentedCandidate: accepted.candidate,
    responseDecision: responseDecision('agree'),
    reconstructedCandidate: accepted.candidate,
    reconstructedSources: accepted.currentSources,
  });
  const fitFor = (previous, current) => {
    const comparison = compareCandidates({ previousCandidate: previous.candidate, currentCandidate: current.candidate });
    const hunks = buildDerivedDiff({
      previousCandidate: previous.candidate,
      currentCandidate: current.candidate,
      previousSources: previous.currentSources,
      currentSources: current.currentSources,
    }).hunks;
    const semanticInput = hunks.every((hunk) => hunk.kind === 'representation-only')
      ? null
      : { kind: 'json', text: JSON.stringify({
        verdict: 'within-contract',
        reason: 'The change remains inside the accepted decision.',
        citations: hunks.map((hunk) => ({ kind: 'source', path: hunk.path, hunk: hunk.ordinal, digestFields: ['decisions'] })),
      }) };

    return validateContractFitVerdict({ comparison, hunks, semanticInput });
  };
  const canonicalState = refreshCompatibleState({
    agreementRecord: initial.agreementRecord,
    candidate: canonical.candidate,
    currentSources: canonical.currentSources,
    fitEvidence: fitFor(accepted, canonical),
  });
  const returnedState = refreshCompatibleState({
    agreementRecord: canonicalState.agreementRecord,
    candidate: accepted.candidate,
    currentSources: accepted.currentSources,
    fitEvidence: fitFor(canonical, accepted),
  });
  const representationState = refreshCompatibleState({
    agreementRecord: canonicalState.agreementRecord,
    candidate: representation.candidate,
    currentSources: representation.currentSources,
    fitEvidence: fitFor(canonical, representation),
  });

  const returnedStore = fakeVolatileStore(Buffer.from('prior'));
  assert.strictEqual(replaceAgreementState({ store: returnedStore.store, nextState: returnedState }), returnedState);
  const representationStore = fakeVolatileStore(Buffer.from('prior'));
  assert.strictEqual(replaceAgreementState({ store: representationStore.store, nextState: representationState }), representationState);
});

test('candidate comparison separates structural changes from source changes with deterministic evidence', () => {
  const previous = candidateFixture();
  const changedSource = candidateFixture([{ path: 'docs/spec.md', text: '# Updated\n' }]);
  const changedTarget = structuredClone(previous.candidate);
  changedTarget.target = { kind: 'sections', path: 'docs/spec.md', selectors: [{ headingPath: ['## Area'] }], workUnit: null };
  const changedScopes = structuredClone(previous.candidate);
  changedScopes.governingScopes = [scope('whole-file', 'docs/other.md')];
  const changedArtifacts = structuredClone(previous.candidate);
  changedArtifacts.artifacts[0].selectorKind = 'index-entry';
  changedArtifacts.artifacts[0].selectors = [{ parentHeading: '## Specs', entryHeading: '### Spec' }];

  assert.deepEqual(compareCandidates({ previousCandidate: previous.candidate, currentCandidate: previous.candidate }), { kind: 'equal', evidence: [] });
  assert.deepEqual(compareCandidates({ previousCandidate: previous.candidate, currentCandidate: changedSource.candidate }), { kind: 'source-change', evidence: [] });
  assert.deepEqual(compareCandidates({ previousCandidate: previous.candidate, currentCandidate: changedTarget }), {
    kind: 'structural-change',
    evidence: [{ kind: 'candidate', candidateField: 'target' }],
  });
  assert.deepEqual(compareCandidates({ previousCandidate: previous.candidate, currentCandidate: changedScopes }), {
    kind: 'structural-change',
    evidence: [{ kind: 'candidate', candidateField: 'governingScopes' }],
  });
  assert.deepEqual(compareCandidates({ previousCandidate: previous.candidate, currentCandidate: changedArtifacts }), {
    kind: 'structural-change',
    evidence: [{ kind: 'candidate', candidateField: 'artifacts' }],
  });
});

test('derived diff emits deterministic canonical and representation hunks with global ordinals', () => {
  const previous = candidateFixture([
    { path: 'docs/first.md', text: 'one\nkeep\nthree\nkeep-again\nfive\n' },
    { path: 'docs/second.md', text: 'same\n' },
  ]);
  const current = candidateFixture([
    { path: 'docs/first.md', text: 'ONE\nkeep\nTHREE\nkeep-again\nfive\n' },
    { path: 'docs/second.md', text: 'same\r\n' },
  ]);
  const result = buildDerivedDiff({
    previousCandidate: previous.candidate,
    currentCandidate: current.candidate,
    previousSources: previous.currentSources,
    currentSources: current.currentSources,
  });

  assert.deepEqual(result.hunks, [
    { ordinal: 1, path: 'docs/first.md', kind: 'canonical', before: 'one\n', after: 'ONE\n' },
    { ordinal: 2, path: 'docs/first.md', kind: 'canonical', before: 'three\n', after: 'THREE\n' },
    {
      ordinal: 3,
      path: 'docs/second.md',
      kind: 'representation-only',
      beforeSourceHash: previous.candidate.artifacts[1].sourceHash,
      afterSourceHash: current.candidate.artifacts[1].sourceHash,
    },
  ]);
  assert.equal(result.hunks.filter((hunk) => hunk.kind === 'representation-only').length, 1);

  const tampered = structuredClone(previous.currentSources);
  tampered[0].sourceSpans = [Buffer.from('different')];
  expectStructural(() => buildDerivedDiff({ previousCandidate: previous.candidate, currentCandidate: current.candidate, previousSources: tampered, currentSources: current.currentSources }), 'selector-shape');
});

test('contract fit validates deterministic branches and compact semantic verdicts', () => {
  const structuralComparison = { kind: 'structural-change', evidence: [{ kind: 'candidate', candidateField: 'target' }] };
  assert.deepEqual(validateContractFitVerdict({ comparison: structuralComparison, hunks: [], semanticInput: null }), {
    verdict: 'changes-contract',
    reason: 'The canonical candidate structure changed.',
    citations: [{ kind: 'candidate', candidateField: 'target' }],
    hunkHash: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
  });

  const representationHunk = { ordinal: 1, path: 'docs/raw.md', kind: 'representation-only', beforeSourceHash: 'a'.repeat(64), afterSourceHash: 'b'.repeat(64) };
  assert.deepEqual(validateContractFitVerdict({ comparison: { kind: 'source-change', evidence: [] }, hunks: [representationHunk], semanticInput: null }), {
    verdict: 'within-contract',
    reason: 'Only source representation changed.',
    citations: [{ kind: 'source', path: 'docs/raw.md', hunk: 1, digestFields: [] }],
    hunkHash: '783bc68d17ac3df86a39de1d381d888a236af719030bd745bb67044320f9506b',
  });

  const canonicalHunks = [
    { ordinal: 1, path: 'docs/spec.md', kind: 'canonical', before: 'old\n', after: 'new\n' },
    { ordinal: 2, path: 'docs/other.md', kind: 'canonical', before: 'before\n', after: 'after\n' },
  ];
  const within = {
    verdict: 'within-contract',
    reason: 'Both edits are implementation details.',
    citations: [
      { kind: 'source', path: 'docs/spec.md', hunk: 1, digestFields: ['decisions'] },
      { kind: 'source', path: 'docs/other.md', hunk: 2, digestFields: ['goal', 'scope'] },
    ],
  };
  assert.deepEqual(validateContractFitVerdict({
    comparison: { kind: 'source-change', evidence: [] },
    hunks: canonicalHunks,
    semanticInput: { kind: 'json', text: JSON.stringify(within) },
  }), {
    ...within,
    hunkHash: fullHash(Buffer.from(JSON.stringify(canonicalHunks))),
  });

  const changes = {
    verdict: 'changes-contract',
    reason: 'One canonical edit replaces a material decision.',
    citations: [{ kind: 'source', path: 'docs/other.md', hunk: 2, digestFields: ['decisions'] }],
  };
  const mixedRepresentationHunk = { ...representationHunk, ordinal: 3 };
  assert.deepEqual(validateContractFitVerdict({
    comparison: { kind: 'source-change', evidence: [] },
    hunks: [...canonicalHunks, mixedRepresentationHunk],
    semanticInput: { kind: 'json', text: JSON.stringify(changes) },
  }), {
    ...changes,
    citations: [...changes.citations, { kind: 'source', path: 'docs/raw.md', hunk: 3, digestFields: [] }],
    hunkHash: fullHash(Buffer.from(JSON.stringify([...canonicalHunks, mixedRepresentationHunk]))),
  });
});

test('contract fit returns closed controller-owned failures for every invalid semantic boundary', () => {
  const comparison = { kind: 'source-change', evidence: [] };
  const hunks = [{ ordinal: 1, path: 'docs/spec.md', kind: 'canonical', before: 'old\n', after: 'new\n' }];
  const valid = {
    verdict: 'within-contract',
    reason: 'Clarification.',
    citations: [{ kind: 'source', path: 'docs/spec.md', hunk: 1, digestFields: ['decisions'] }],
  };
  const cases = [
    [null, 'invalid-schema'],
    [{ kind: 'classifier-failure', detail: 'classifier unavailable' }, 'classifier-failure'],
    [{ kind: 'json', text: '{bad}' }, 'malformed-json'],
    [{ kind: 'json', text: JSON.stringify(valid, null, 2) }, 'invalid-schema'],
    [{ kind: 'json', text: JSON.stringify({ ...valid, verdict: 'maybe' }) }, 'invalid-schema'],
    [{ kind: 'json', text: JSON.stringify({ ...valid, citations: [] }) }, 'invalid-schema'],
    [{ kind: 'json', text: JSON.stringify({ ...valid, citations: [{ kind: 'source', path: 'docs/other.md', hunk: 1, digestFields: ['decisions'] }] }) }, 'invalid-citation'],
    [{ kind: 'json', text: JSON.stringify({ ...valid, citations: [{ kind: 'source', path: 'docs/spec.md', hunk: 1, digestFields: ['unknown'] }] }) }, 'invalid-citation'],
    [{ kind: 'json', text: JSON.stringify({ ...valid, citations: [{ kind: 'source', path: 'docs/spec.md', hunk: 2, digestFields: ['decisions'] }] }) }, 'invalid-citation'],
  ];

  for (const [semanticInput, issueKind] of cases) {
    const result = validateContractFitVerdict({ comparison, hunks, semanticInput });

    assert.deepEqual(Object.keys(result), ['verdict', 'reason', 'errors']);
    assert.equal(result.verdict, 'uncertain');
    assert.equal(result.errors[0].kind, issueKind);
    assert.equal(result.errors.length > 0, true);
    assert.equal(Object.hasOwn(result, 'citations'), false);
  }

  const uncovered = {
    verdict: 'within-contract',
    reason: 'Only one hunk was classified.',
    citations: [{ kind: 'source', path: 'docs/spec.md', hunk: 1, digestFields: ['decisions'] }],
  };
  const twoHunks = [...hunks, { ordinal: 2, path: 'docs/spec.md', kind: 'canonical', before: 'x\n', after: 'y\n' }];
  const incomplete = validateContractFitVerdict({ comparison, hunks: twoHunks, semanticInput: { kind: 'json', text: JSON.stringify(uncovered) } });

  assert.equal(incomplete.errors[0].kind, 'incomplete-coverage');
  assert.equal(incomplete.errors[0].hunk, 2);

  for (const [deterministicComparison, deterministicHunks] of [
    [{ kind: 'structural-change', evidence: [{ kind: 'candidate', candidateField: 'target' }] }, []],
    [comparison, [{ ordinal: 1, path: 'docs/spec.md', kind: 'representation-only', beforeSourceHash: 'a'.repeat(64), afterSourceHash: 'b'.repeat(64) }]],
  ]) {
    const result = validateContractFitVerdict({ comparison: deterministicComparison, hunks: deterministicHunks, semanticInput: { kind: 'classifier-failure', detail: 'must not dispatch' } });
    assert.equal(result.errors[0].kind, 'invalid-schema');
  }

  const nonconsecutive = validateContractFitVerdict({
    comparison,
    hunks: [{ ordinal: 2, path: 'docs/spec.md', kind: 'canonical', before: 'old\n', after: 'new\n' }],
    semanticInput: { kind: 'json', text: JSON.stringify({ ...valid, citations: [{ kind: 'source', path: 'docs/spec.md', hunk: 2, digestFields: ['decisions'] }] }) },
  });
  assert.equal(nonconsecutive.errors[0].kind, 'invalid-schema');
});

test('agreement gate exposes only the closed action matrix and keeps authorities separate', () => {
  const fresh = gateInput();
  assert.deepEqual(decideAgreementGate(fresh), { kind: 'present-digest', sessionState: null, digest: 'digest-v1', evidence: null });

  const pendingPresentation = { digest: fresh.acceptedDigest, candidate: fresh.candidate, currentSources: fresh.currentSources };
  const agreed = decideAgreementGate({ ...fresh, pendingPresentation, response: responseDecision('agree') });
  assert.equal(agreed.kind, 'continue');
  assert.deepEqual(agreed.sessionState.agreementRecord.acceptedCandidate, pendingPresentation.candidate);
  assert.deepEqual(agreed.sessionState.agreementRecord.currentCandidate, fresh.candidate);
  assert.deepEqual(agreed.sessionState.agreementRecord.currentSources, fresh.currentSources);

  const stored = [];
  const store = { replace: (nextState) => { stored.push(nextState); return nextState; } };
  assert.strictEqual(replaceAgreementState({ store, nextState: agreed.sessionState }), agreed.sessionState);
  assert.strictEqual(stored[0], agreed.sessionState);

  for (const [kind, actionKind] of [
    ['changes-requested', 'return-to-design'],
    ['decline', 'stop-declined'],
    ['ambiguous', 'stop-ambiguous'],
  ]) {
    const action = decideAgreementGate({ ...fresh, pendingPresentation, response: responseDecision(kind) });
    assert.deepEqual(action, { kind: actionKind, sessionState: null, digest: null, evidence: responseDecision(kind) });
  }

  const stale = decideAgreementGate({ ...fresh, pendingPresentation, response: responseDecision('agree', 'old-digest') });
  assert.deepEqual(stale, { kind: 'present-digest', sessionState: null, digest: 'digest-v1', evidence: null });
  const ambiguous = decideAgreementGate({ ...fresh, pendingPresentation, response: responseDecision('ambiguous') });
  assert.equal(ambiguous.kind, 'stop-ambiguous');
  assert.equal(ambiguous.digest, null);
  const staleAmbiguous = decideAgreementGate({ ...fresh, pendingPresentation, response: responseDecision('ambiguous', 'old-digest') });
  assert.deepEqual(staleAmbiguous, { kind: 'stop-ambiguous', sessionState: null, digest: null, evidence: responseDecision('ambiguous', 'old-digest') });

  const shiftedSources = fresh.currentSources.map((source) => ({
    ...source,
    sourceRanges: source.sourceRanges.map((range) => ({ start: range.start + 1, end: range.end + 1 })),
  }));
  const shiftedResponse = decideAgreementGate({ ...fresh, pendingPresentation, currentSources: shiftedSources, response: responseDecision('agree') });
  assert.deepEqual(shiftedResponse, { kind: 'present-digest', sessionState: null, digest: 'digest-v1', evidence: null });

  const unrelated = candidateFixture([{ path: 'docs/unrelated.md', text: '# Unrelated\n' }]);
  const unrelatedResponse = decideAgreementGate({
    ...fresh,
    pendingPresentation: { digest: 'digest-v1', candidate: unrelated.candidate, currentSources: unrelated.currentSources },
    candidate: unrelated.candidate,
    currentSources: unrelated.currentSources,
    response: responseDecision('agree'),
  });
  assert.equal(unrelatedResponse.kind, 'stop-error');
});

test('retained-state gate reuses identity, refreshes compatible state, and separates changed and uncertain presentation', () => {
  const accepted = candidateFixture([{ path: 'docs/spec.md', text: '# Spec\nold\n' }]);
  const state = createAgreementState({
    acceptedDigest: 'digest-v1',
    presentedCandidate: accepted.candidate,
    responseDecision: responseDecision('agree'),
    reconstructedCandidate: accepted.candidate,
    reconstructedSources: accepted.currentSources,
  });
  const exactInput = gateInput({
    resolution: accepted.resolution,
    sessionState: state,
    candidate: accepted.candidate,
    currentSources: accepted.currentSources,
  });
  const exact = decideAgreementGate(exactInput);

  assert.deepEqual(exact, { kind: 'continue', sessionState: state, digest: null, evidence: null });
  assert.strictEqual(exact.sessionState, state);

  const changed = candidateFixture([{ path: 'docs/spec.md', text: '# Spec\nnew\n' }]);
  const comparison = compareCandidates({ previousCandidate: accepted.candidate, currentCandidate: changed.candidate });
  const hunks = buildDerivedDiff({ previousCandidate: accepted.candidate, currentCandidate: changed.candidate, previousSources: accepted.currentSources, currentSources: changed.currentSources }).hunks;
  const semantic = {
    verdict: 'within-contract',
    reason: 'The edit clarifies an accepted decision.',
    citations: [{ kind: 'source', path: 'docs/spec.md', hunk: 1, digestFields: ['decisions'] }],
  };
  const fitResult = validateContractFitVerdict({ comparison, hunks, semanticInput: { kind: 'json', text: JSON.stringify(semantic) } });
  const compatible = decideAgreementGate(gateInput({ resolution: changed.resolution, sessionState: state, candidate: changed.candidate, currentSources: changed.currentSources, fitResult }));

  assert.equal(compatible.kind, 'continue');
  assert.deepEqual(compatible.sessionState.fitEvidence, fitResult);
  assert.deepEqual(compatible.sessionState.agreementRecord.currentCandidate, changed.candidate);

  const fabricatedFit = { ...fitResult, citations: [{ kind: 'source', path: 'docs/other.md', hunk: 1, digestFields: ['decisions'] }] };
  const rejectedFabrication = decideAgreementGate(gateInput({ resolution: changed.resolution, sessionState: state, candidate: changed.candidate, currentSources: changed.currentSources, fitResult: fabricatedFit }));
  assert.equal(rejectedFabrication.kind, 'stop-error');

  const changesFit = {
    verdict: 'changes-contract',
    reason: 'The decision changed.',
    citations: [{ kind: 'source', path: 'docs/spec.md', hunk: 1, digestFields: ['decisions'] }],
    hunkHash: fitResult.hunkHash,
  };
  assert.deepEqual(decideAgreementGate(gateInput({ resolution: changed.resolution, sessionState: state, candidate: changed.candidate, currentSources: changed.currentSources, fitResult: changesFit })), {
    kind: 'present-digest', sessionState: null, digest: 'digest-v1', evidence: changesFit,
  });

  const uncertain = { verdict: 'uncertain', reason: 'Evidence is incomplete.', citations: [{ kind: 'source', path: 'docs/spec.md', hunk: 1, digestFields: ['questions'] }], hunkHash: fitResult.hunkHash };
  assert.deepEqual(decideAgreementGate(gateInput({ resolution: changed.resolution, sessionState: state, candidate: changed.candidate, currentSources: changed.currentSources, fitResult: uncertain })), {
    kind: 'render-uncertain-then-present', sessionState: null, digest: 'digest-v1', evidence: uncertain,
  });

  const tamperedState = structuredClone(state);
  tamperedState.agreementRecord.currentSources[0].selectedBytes = Buffer.from('tampered\n');
  assert.deepEqual(decideAgreementGate(gateInput({ resolution: changed.resolution, sessionState: tamperedState, candidate: changed.candidate, currentSources: changed.currentSources })), {
    kind: 'present-digest', sessionState: null, digest: 'digest-v1', evidence: null,
  });
});

test('retained-state gate rejects fit evidence replayed against different hunk bytes', () => {
  const accepted = candidateFixture([{ path: 'docs/spec.md', text: 'old\n' }]);
  const classified = candidateFixture([{ path: 'docs/spec.md', text: 'new\n' }]);
  const replayed = candidateFixture([{ path: 'docs/spec.md', text: 'other\n' }]);
  const sessionState = createAgreementState({
    acceptedDigest: 'digest-v1',
    presentedCandidate: accepted.candidate,
    responseDecision: responseDecision('agree'),
    reconstructedCandidate: accepted.candidate,
    reconstructedSources: accepted.currentSources,
  });
  const classifiedHunks = buildDerivedDiff({
    previousCandidate: accepted.candidate,
    currentCandidate: classified.candidate,
    previousSources: accepted.currentSources,
    currentSources: classified.currentSources,
  }).hunks;
  const fitResult = validateContractFitVerdict({
    comparison: compareCandidates({ previousCandidate: accepted.candidate, currentCandidate: classified.candidate }),
    hunks: classifiedHunks,
    semanticInput: {
      kind: 'json',
      text: JSON.stringify({
        verdict: 'within-contract',
        reason: 'The classified edit stays within the accepted decision.',
        citations: [{ kind: 'source', path: 'docs/spec.md', hunk: 1, digestFields: ['decisions'] }],
      }),
    },
  });
  const action = decideAgreementGate(gateInput({
    resolution: replayed.resolution,
    sessionState,
    candidate: replayed.candidate,
    currentSources: replayed.currentSources,
    fitResult,
  }));

  assert.equal(action.kind, 'stop-error');
});

test('retained-state gate rejects current candidate drift without fit evidence', () => {
  const accepted = candidateFixture([{ path: 'docs/spec.md', text: 'old\n' }]);
  const current = candidateFixture([{ path: 'docs/spec.md', text: 'new\n' }]);
  const sessionState = {
    agreementRecord: {
      acceptedDigest: 'digest-v1',
      acceptedCandidate: accepted.candidate,
      currentCandidate: current.candidate,
      currentSources: current.currentSources,
    },
    fitEvidence: null,
  };
  const action = decideAgreementGate(gateInput({
    resolution: current.resolution,
    sessionState,
    candidate: current.candidate,
    currentSources: current.currentSources,
  }));

  assert.equal(action.kind, 'present-digest');
});

test('retained-state gate rejects malformed or impossible compatible fit evidence', () => {
  const accepted = candidateFixture([{ path: 'docs/spec.md', text: 'old\n' }]);
  const current = candidateFixture([{ path: 'docs/spec.md', text: 'new\n' }]);
  const initial = createAgreementState({
    acceptedDigest: 'digest-v1',
    presentedCandidate: accepted.candidate,
    responseDecision: responseDecision('agree'),
    reconstructedCandidate: accepted.candidate,
    reconstructedSources: accepted.currentSources,
  });
  const comparison = compareCandidates({ previousCandidate: accepted.candidate, currentCandidate: current.candidate });
  const hunks = buildDerivedDiff({
    previousCandidate: accepted.candidate,
    currentCandidate: current.candidate,
    previousSources: accepted.currentSources,
    currentSources: current.currentSources,
  }).hunks;
  const fitEvidence = validateContractFitVerdict({
    comparison,
    hunks,
    semanticInput: { kind: 'json', text: JSON.stringify({
      verdict: 'within-contract',
      reason: 'The wording remains inside the accepted decision.',
      citations: [{ kind: 'source', path: 'docs/spec.md', hunk: 1, digestFields: ['decisions'] }],
    }) },
  });
  const valid = refreshCompatibleState({ agreementRecord: initial.agreementRecord, candidate: current.candidate, currentSources: current.currentSources, fitEvidence });
  const malformedEvidence = [
    { ...fitEvidence, citations: [fitEvidence.citations[0], fitEvidence.citations[0]] },
    { ...fitEvidence, citations: [{ ...fitEvidence.citations[0], digestFields: ['decisions', 'decisions'] }] },
    { ...fitEvidence, citations: [{ ...fitEvidence.citations[0], path: 'docs/not-owned.md', hunk: 999 }] },
  ];

  for (const evidence of malformedEvidence) {
    const action = decideAgreementGate(gateInput({
      resolution: current.resolution,
      sessionState: { agreementRecord: valid.agreementRecord, fitEvidence: evidence },
      candidate: current.candidate,
      currentSources: current.currentSources,
    }));
    assert.equal(action.kind, 'present-digest');
  }
});

test('changes-contract fit requires owned canonical proof when representation hunks are mixed in', () => {
  const accepted = candidateFixture([
    { path: 'docs/spec.md', text: 'old\n' },
    { path: 'docs/raw.md', text: 'same\n' },
  ]);
  const current = candidateFixture([
    { path: 'docs/spec.md', text: 'new\n' },
    { path: 'docs/raw.md', text: 'same\r\n' },
  ]);
  const sessionState = createAgreementState({
    acceptedDigest: 'digest-v1',
    presentedCandidate: accepted.candidate,
    responseDecision: responseDecision('agree'),
    reconstructedCandidate: accepted.candidate,
    reconstructedSources: accepted.currentSources,
  });
  const representationOnlyProof = {
    verdict: 'changes-contract',
    reason: 'The contract changed.',
    citations: [{ kind: 'source', path: 'docs/raw.md', hunk: 2, digestFields: [] }],
    hunkHash: fullHash(Buffer.from(JSON.stringify(buildDerivedDiff({
      previousCandidate: accepted.candidate,
      currentCandidate: current.candidate,
      previousSources: accepted.currentSources,
      currentSources: current.currentSources,
    }).hunks))),
  };
  const action = decideAgreementGate(gateInput({
    resolution: current.resolution,
    sessionState,
    candidate: current.candidate,
    currentSources: current.currentSources,
    fitResult: representationOnlyProof,
  }));

  assert.equal(action.kind, 'stop-error');
});

test('agreement gate handles every terminal resolver and response path without inferring approval', () => {
  const base = gateInput();
  const migration = legacyMigrationFixture();
  const completionTarget = scope('index-entry', '.claude/FEATURES.md', [{ parentHeading: '## Active', entryHeading: '### [Done](features/done.md)' }]);
  const completionRequest = request({ mode: 'handover', target: completionTarget, seeds: [completionTarget], allowCompletedNoOp: true });
  const completionFs = fakeRepository({
    '.claude/FEATURES.md': '# Features\n\n## Active\n',
    '.claude/FEATURES_HISTORY.md': '# History\n\n## Entries\n\n- [Done](features/done.md): shipped.\n',
  });
  const completionResolution = resolve(completionRequest, completionFs);
  const completionOptions = { fsAdapter: completionFs, readyParser };
  const cases = [
    [{ ...base, resolution: { kind: 'not-applicable', target: null, governingScopes: [], artifacts: [] }, request: request({ allowSpecLess: true }) }, 'not-applicable', undefined],
    [{ ...base, resolution: { kind: 'not-applicable', target: null, governingScopes: [], artifacts: [] }, request: request({ allowSpecLess: false }) }, 'stop-error', undefined],
    [{ ...base, resolution: { kind: 'brainstorming-required', artifacts: [], unfinished: { artifacts: [{ path: 'docs/spec.md', signals: ['frontmatter'] }] } }, candidate: null, currentSources: null }, 'brainstorming-required', undefined],
    [{ ...base, request: completionRequest, resolution: completionResolution, candidate: null, currentSources: null }, 'completed-no-op', completionOptions],
    [migration.input, 'reviewed-migration', undefined],
  ];
  const allowlist = new Set(['continue', 'not-applicable', 'present-digest', 'render-uncertain-then-present', 'return-to-design', 'stop-declined', 'stop-ambiguous', 'reviewed-migration', 'brainstorming-required', 'completed-no-op', 'stop-error']);

  for (const [input, expectedKind, options] of cases) {
    const action = decideAgreementGate(input, options);
    assert.equal(action.kind, expectedKind);
    assert.equal(allowlist.has(action.kind), true);
    assert.deepEqual(Object.keys(action), ['kind', 'sessionState', 'digest', 'evidence']);
  }

  for (const unsupportedEvidence of ['ready selection', 'nomination', 'durable marker', candidateToken(base.candidate)]) {
    const action = decideAgreementGate({ ...base, response: { kind: 'ambiguous', digest: 'digest-v1', evidence: unsupportedEvidence }, pendingPresentation: { digest: 'digest-v1', candidate: base.candidate, currentSources: base.currentSources } });
    assert.equal(action.kind, 'stop-ambiguous');
  }

  const noDigestCompletion = decideAgreementGate({
    ...base,
    request: completionRequest,
    resolution: completionResolution,
    candidate: null,
    currentSources: null,
    acceptedDigest: null,
  }, completionOptions);
  assert.equal(noDigestCompletion.kind, 'completed-no-op');
  const malformedCompletion = decideAgreementGate({
    ...base,
    request: completionRequest,
    resolution: { ...completionResolution, extra: true },
    candidate: null,
    currentSources: null,
    acceptedDigest: null,
  }, completionOptions);
  assert.equal(malformedCompletion.kind, 'stop-error');

  const unauthorizedCompletion = decideAgreementGate({
    ...base,
    resolution: completionResolution,
    candidate: null,
    currentSources: null,
  }, completionOptions);
  assert.equal(unauthorizedCompletion.kind, 'stop-error');
  const otherTarget = scope('whole-file', 'docs/other.md');
  const mismatchedCompletion = decideAgreementGate({
    ...base,
    request: request({ mode: 'handover', target: base.candidate.target, seeds: [base.candidate.target], allowCompletedNoOp: true }),
    resolution: { kind: 'completed-no-op', evidence: { target: otherTarget, archivePath: '.claude/FEATURES_HISTORY.md', matchedDeclaration: null } },
    candidate: null,
    currentSources: null,
  }, completionOptions);
  assert.equal(mismatchedCompletion.kind, 'stop-error');

  for (const evidence of [
    { ...completionResolution.evidence, archivePath: '.claude/BUGS_HISTORY.md' },
    { ...completionResolution.evidence, matchedDeclaration: '- [Forged](features/forged.md): shipped.' },
    { target: base.candidate.target, archivePath: '.claude/FEATURES_HISTORY.md', matchedDeclaration: null },
  ]) {
    const forged = decideAgreementGate({
      ...base,
      request: completionRequest,
      resolution: { kind: 'completed-no-op', evidence },
      candidate: null,
      currentSources: null,
      acceptedDigest: null,
    }, completionOptions);
    assert.equal(forged.kind, 'stop-error');
  }

  const cliCompletionInput = {
    ...base,
    request: cliRequest(completionRequest),
    resolution: completionResolution,
    candidate: null,
    currentSources: null,
    acceptedDigest: null,
  };
  const cliCompletion = runCli({ requestText: JSON.stringify({ operation: 'gate', input: cliCompletionInput }) }, completionOptions);
  assert.equal(cliCompletion.exitCode, 0);
  assert.equal(parseCliResult(cliCompletion).value.kind, 'completed-no-op');
  const cliForgery = runCli({
    requestText: JSON.stringify({
      operation: 'gate',
      input: { ...cliCompletionInput, resolution: { kind: 'completed-no-op', evidence: { ...completionResolution.evidence, archivePath: '.claude/BUGS_HISTORY.md' } } },
    }),
  }, completionOptions);
  assert.equal(cliForgery.exitCode, 0);
  const cliForgeryAction = parseCliResult(cliForgery).value;
  assert.equal(cliForgeryAction.kind, 'stop-error');
  assert.equal(cliForgeryAction.evidence.code, 'structural-error');

  const pendingPresentation = { digest: 'digest-v1', candidate: base.candidate, currentSources: base.currentSources };
  const declineWithoutReconstruction = decideAgreementGate({
    ...base,
    pendingPresentation,
    candidate: null,
    currentSources: null,
    response: responseDecision('decline'),
  });
  assert.equal(declineWithoutReconstruction.kind, 'stop-declined');
});

test('caller harness captures and rechecks one fake-filesystem baseline before creating pending presentation', () => {
  const harness = callerHarness();
  let renderedPending;

  harness.preparePresentation({
    onRender: (pendingPresentation) => {
      assert.strictEqual(harness.context.pendingPresentation, pendingPresentation);
      assert.equal(harness.events.at(-1), 'pending-created');
      renderedPending = pendingPresentation;
    },
  });

  assert.strictEqual(harness.context.pendingPresentation, renderedPending);
  assert.deepEqual(harness.events, ['baseline-1', 'recheck-1', 'pending-created', 'digest-rendered']);
});

test('caller harness replaces pending presentation after one drift and stops on repeated drift', () => {
  const restarted = callerHarness();
  const superseded = { digest: 'old-digest', candidate: null, currentSources: null };
  restarted.context.pendingPresentation = superseded;
  restarted.preparePresentation({
    mutateAfterBaseline: ({ attempt, setText }) => {
      if (attempt === 0) {
        setText('# Spec v2\n');
      } else {
        assert.equal(restarted.context.pendingPresentation, null);
      }
    },
  });

  assert.notStrictEqual(restarted.context.pendingPresentation, superseded);
  assert.equal(restarted.events.filter((event) => event === 'drift-restart').length, 1);
  assert.equal(restarted.context.pendingPresentation.candidate.artifacts[0].contentHash, createHash('sha256').update('# Spec v2\n').digest('hex'));

  const unstable = callerHarness();
  assert.throws(
    () => unstable.preparePresentation({
      mutateAfterBaseline: ({ attempt, setText }) => setText(`# Spec drift ${attempt + 1}\n`),
    }),
    (error) => error instanceof AgreementError && error.code === 'unstable-governing-source' && error.evidence.attempts === 2,
  );
  assert.equal(unstable.context.pendingPresentation, null);
  assert.equal(unstable.events.filter((event) => event === 'digest-rendered').length, 0);
});

test('caller harness clears pending presentation on every authority and terminal lifecycle path', () => {
  for (const [decision, actionKind] of [
    ['agree', 'continue'],
    ['changes-requested', 'return-to-design'],
    ['decline', 'stop-declined'],
    ['ambiguous', 'stop-ambiguous'],
  ]) {
    const harness = callerHarness();
    harness.preparePresentation();
    const action = harness.respond({ kind: decision });

    assert.equal(action.kind, actionKind, decision);
    assert.equal(harness.context.pendingPresentation, null, decision);
  }

  for (const reason of ['invalidation', 'completion', 'abandonment', 'session-end']) {
    const harness = callerHarness();
    harness.preparePresentation();
    const agreementAction = harness.respond({ kind: 'agree' });
    assert.equal(agreementAction.kind, 'continue', reason);
    assert.notEqual(harness.context.sessionState, null, reason);
    harness.preparePresentation();
    assert.equal(harness.invalidate({ reason }), true, reason);
    assert.equal(harness.context.pendingPresentation, null, reason);
    assert.equal(harness.context.sessionState, null, reason);
    assert.equal(harness.storeFixture().checkpointBytes().toString(), 'null', reason);
    const reconstructed = harness.capture();
    const nextAction = decideAgreementGate({
      phase: 'lifecycle-entry',
      request: reconstructed.request,
      resolution: reconstructed.resolution,
      sessionState: harness.context.sessionState,
      pendingPresentation: null,
      candidate: reconstructed.candidate,
      currentSources: reconstructed.currentSources,
      acceptedDigest: 'digest-v1',
      response: null,
      fitResult: null,
      legacyDeletions: null,
    });
    assert.equal(nextAction.kind, 'present-digest', reason);
  }
});

test('caller harness retries only in the same turn and quarantines failed invalidation before dispatch', () => {
  const retried = callerHarness({ storeOutcomes: [new Error('transient store failure')] });
  retried.preparePresentation();
  const action = retried.respond({ kind: 'agree', retrySameTurn: true });

  assert.equal(action.kind, 'continue');
  assert.equal(retried.storeFixture().calls().length, 2);
  assert.strictEqual(retried.storeFixture().calls()[0], action.sessionState);
  assert.strictEqual(retried.storeFixture().calls()[1], action.sessionState);
  assert.equal(retried.events.includes('stored-on-same-turn-retry'), true);
  assert.equal(retried.dispatchCount(), 1);

  const quarantined = callerHarness({ storeOutcomes: [undefined, new Error('clear failed'), new AgreementError('structural-error', 'clear failed again')] });
  quarantined.preparePresentation();
  quarantined.respond({ kind: 'agree' });
  const checkpointBeforeClear = quarantined.storeFixture().checkpointBytes();
  const dispatchesBeforeClear = quarantined.dispatchCount();
  quarantined.preparePresentation();

  assert.equal(quarantined.invalidate({ reason: 'changes-contract', retrySameTurn: true }), false);
  assert.equal(quarantined.context.storeQuarantined, true);
  assert.equal(quarantined.context.sessionState, null);
  assert.equal(quarantined.context.pendingPresentation, null);
  assert.equal(quarantined.dispatchCount(), dispatchesBeforeClear);
  assert.equal(quarantined.storeFixture().checkpointBytes().toString('hex'), checkpointBeforeClear.toString('hex'));
  const callsAfterQuarantine = quarantined.storeFixture().calls().length;
  assert.equal(quarantined.invalidate({ reason: 'session-end' }), false);
  assert.equal(quarantined.storeFixture().calls().length, callsAfterQuarantine);
  assert.equal(quarantined.events.at(-1), 'quarantined-store-skipped');
});

test('caller harness creates a replacement store only after renewed response reconstruction', () => {
  let replacementStore = null;
  let replacementStoreCreations = 0;
  const harness = callerHarness({
    storeOutcomes: [new Error('creation failed')],
    replacementStoreFactory: () => {
      replacementStoreCreations += 1;
      replacementStore = fakeVolatileStore(Buffer.from('null'));

      return replacementStore;
    },
  });
  harness.preparePresentation({ digest: 'digest-v1' });
  harness.respond({ kind: 'agree', retrySameTurn: false });

  assert.equal(harness.context.storeQuarantined, true);
  assert.equal(harness.dispatchCount(), 0);
  assert.equal(harness.storeFixture().calls().length, 1);
  const quarantinedStore = harness.storeFixture();
  const quarantinedStoreCalls = quarantinedStore.calls().length;

  harness.setText('# Spec reconstructed\n');
  harness.preparePresentation({ digest: 'digest-v2' });
  assert.equal(replacementStoreCreations, 0, 'replacement store must not exist before the renewed response');
  assert.equal(replacementStore, null);
  const renewed = harness.respond({ kind: 'agree', digest: 'digest-v2' });

  assert.equal(renewed.kind, 'continue');
  assert.equal(replacementStoreCreations, 1, 'renewed response persistence must create one replacement store');
  assert.equal(harness.context.storeQuarantined, false);
  assert.equal(replacementStore.calls().length, 1);
  assert.equal(harness.events.indexOf('fresh-store-created') > harness.events.lastIndexOf('response-classified'), true, 'replacement store must follow response classification and reconstruction');
  assert.equal(quarantinedStore.calls().length, quarantinedStoreCalls, 'quarantined store must remain untouched through renewed response persistence');
  assert.equal(harness.dispatchCount(), 1);
});

test('caller phase mapping is exhaustive and durable resume never supplies authority', () => {
  const lifecycleCases = [
    ['handover', 'handover'],
    ['revise-spec', 'revise-spec'],
    ['revise-plan', 'revise-plan'],
    ['revise-code', 'revise-code'],
    ['planning', 'planning'],
    ['generic', 'lifecycle'],
  ];
  for (const [caller, expected] of lifecycleCases) {
    assert.equal(callerMode({ phase: 'lifecycle-entry', caller }), expected);
  }
  assert.equal(callerMode({ phase: 'final-presentation', caller: 'brainstorming' }), 'final-presentation');
  assert.equal(callerMode({ phase: 'planning-result', caller: 'planning' }), 'planning');
  for (const mode of ['handover', 'lifecycle', 'revise-spec', 'revise-plan', 'revise-code', 'planning', 'final-presentation']) {
    assert.equal(callerMode({ phase: 'post-mutation', originatingMode: mode }), mode);
  }
  for (const [artifact, expected] of [['spec', 'revise-spec'], ['plan', 'revise-plan'], ['code', 'revise-code']]) {
    assert.equal(callerMode({ phase: 'post-mutation', durableArtifact: artifact }), expected);
  }
  for (const unsupported of [
    { phase: 'final-presentation', caller: 'generic' },
    { phase: 'planning-result', caller: 'handover' },
    { phase: 'post-mutation', originatingMode: 'unknown' },
    { phase: 'lifecycle-entry', caller: 'unknown' },
    { phase: 'post-mutation', durableArtifact: 'unknown' },
  ]) {
    expectStructural(() => callerMode(unsupported), 'selector-shape');
  }

  const durableResume = callerHarness();
  durableResume.preparePresentation();
  durableResume.respond({ kind: 'agree' });
  assert.notEqual(durableResume.context.sessionState, null);
  durableResume.context.sessionState = null;
  durableResume.context.pendingPresentation = null;
  const reconstructed = durableResume.capture(callerMode({ phase: 'post-mutation', durableArtifact: 'spec' }));
  const action = decideAgreementGate({
    phase: 'post-mutation',
    request: reconstructed.request,
    resolution: reconstructed.resolution,
    sessionState: null,
    pendingPresentation: null,
    candidate: reconstructed.candidate,
    currentSources: reconstructed.currentSources,
    acceptedDigest: 'fresh-digest',
    response: null,
    fitResult: null,
    legacyDeletions: null,
  });

  assert.equal(action.kind, 'present-digest');
  assert.equal(action.sessionState, null);
});

test('parsePlanContract returns the canonical scope from a valid one-scope plan', () => {
  const path = '.claude/features/example.md';
  const scope = { kind: 'whole-file', path, selectors: [], workUnit: null };
  const planBuffer = Buffer.from(`# Plan\n\n**Spec:** [${path}](${path})\n\n## Governing specs\n\n- Spec JSON: ${JSON.stringify(scope)}\n\n## Steps\n\n- Implement it.\n`);
  const directories = new Map([
    ['C:/repo', ['.claude']],
    ['C:/repo/.claude', ['features']],
    ['C:/repo/.claude/features', ['example.md']],
  ]);
  const fsAdapter = {
    readFile: () => Buffer.from('# Example\n'),
    readDirectory: (directory) => directories.get(directory) ?? [],
    realpath: (nominatedPath) => nominatedPath,
    replaceFileAtomically: () => {},
  };

  const result = parsePlanContract({ planBuffer, projectRoot: 'C:/repo' }, { fsAdapter });

  assert.deepEqual(result.governingScopes, [scope]);
});

test('public boundaries reject reordered and extra closed-record fields before destructuring', () => {
  const path = 'docs/spec.md';
  const governingScope = scope('whole-file', path);
  const fsAdapter = fakeRepository({ [path]: '# Spec\n' });
  const planBuffer = Buffer.from(`# Plan\n\n**Spec:** [${path}](${path})\n\n## Governing specs\n\n- Spec JSON: ${JSON.stringify(governingScope)}\n`);
  const planInput = { planBuffer, projectRoot };
  const planOptions = { fsAdapter };
  const planBody = Buffer.from('# Plan\n');
  const serializeInput = { planBody, governingScopes: [governingScope] };
  const resolverRequest = request({ target: governingScope, seeds: [governingScope] });
  const resolverOptions = { fsAdapter, readyParser };
  const reorderedFsAdapter = {
    readDirectory: fsAdapter.readDirectory,
    readFile: fsAdapter.readFile,
    realpath: fsAdapter.realpath,
    replaceFileAtomically: fsAdapter.replaceFileAtomically,
  };
  const reorderedReadyParser = {
    parseSlices: readyParser.parseSlices,
    normalizeSliceName: readyParser.normalizeSliceName,
    findSlicesByNormalizedName: readyParser.findSlicesByNormalizedName,
  };
  const cases = [
    ['parse input reorder', () => parsePlanContract({ projectRoot, planBuffer }, planOptions), 'plan-contract-grammar'],
    ['parse input extra', () => parsePlanContract({ ...planInput, extra: true }, planOptions), 'plan-contract-grammar'],
    ['parse options extra', () => parsePlanContract(planInput, { ...planOptions, extra: true }), 'plan-contract-grammar'],
    ['parse fs reorder', () => parsePlanContract(planInput, { fsAdapter: reorderedFsAdapter }), 'plan-contract-grammar'],
    ['parse fs extra', () => parsePlanContract(planInput, { fsAdapter: { ...fsAdapter, extra: true } }), 'plan-contract-grammar'],
    ['serialize input reorder', () => serializePlanContract({ governingScopes: [governingScope], planBody }), 'plan-contract-grammar'],
    ['serialize input extra', () => serializePlanContract({ ...serializeInput, extra: true }), 'plan-contract-grammar'],
    ['resolve request reorder', () => resolveGoverningSet({ projectRoot, mode: resolverRequest.mode, target: resolverRequest.target, seeds: resolverRequest.seeds, planBuffer: null, selectedSliceDeclaration: null, allowSpecLess: false, allowCompletedNoOp: false }, resolverOptions), 'selector-shape'],
    ['resolve request extra', () => resolveGoverningSet({ ...resolverRequest, extra: true }, resolverOptions), 'selector-shape'],
    ['resolve options reorder', () => resolveGoverningSet(resolverRequest, { readyParser, fsAdapter }), 'selector-shape'],
    ['resolve options extra', () => resolveGoverningSet(resolverRequest, { ...resolverOptions, extra: true }), 'selector-shape'],
    ['resolve fs reorder', () => resolveGoverningSet(resolverRequest, { fsAdapter: reorderedFsAdapter, readyParser }), 'selector-shape'],
    ['resolve fs extra', () => resolveGoverningSet(resolverRequest, { fsAdapter: { ...fsAdapter, extra: true }, readyParser }), 'selector-shape'],
    ['resolve ready reorder', () => resolveGoverningSet(resolverRequest, { fsAdapter, readyParser: reorderedReadyParser }), 'selector-shape'],
    ['resolve ready extra', () => resolveGoverningSet(resolverRequest, { fsAdapter, readyParser: { ...readyParser, extra: true } }), 'selector-shape'],
  ];

  for (const [name, invoke, kind] of cases) {
    assert.throws(invoke, (error) => error instanceof AgreementError && error.code === 'structural-error' && error.evidence.kind === kind, name);
  }
});

test('resolveGoverningSet maps every governing scope kind to ordered artifacts', () => {
  const featureEntry = '### [Feature A](features/a.md)';
  const umbrellaEntry = '### [Umbrella](features/umbrella.md)';
  const quickTitle = '**Tidy parser**: keep it small.';
  const files = {
    '.claude/FEATURES.md': `# Features\n\n## Active\n\n${featureEntry}\n\nFeature body.\n\n${umbrellaEntry}\n\nUmbrella body.\n`,
    '.claude/QUICK_WINS.md': `# Quick wins\n\n## Parser\n\n- ${quickTitle}\n  Continuation.\n`,
    '.claude/features/a.md': '# Feature A\n',
    '.claude/features/umbrella.md': '# Umbrella\n',
    '.claude/patterns/shared.md': '# Shared pattern\n',
    'docs/standalone.md': '# Standalone\n\n## Area\n\n### Detail\n',
  };
  const fsAdapter = fakeRepository(files);
  const cases = [
    {
      name: 'whole-file breakout plus companion',
      seed: scope('whole-file', '.claude/features/a.md'),
      want: [
        ['.claude/features/a.md', 'design-before-hardening'],
        ['.claude/FEATURES.md', 'index-entry'],
      ],
    },
    {
      name: 'section scope',
      seed: scope('sections', 'docs/standalone.md', [{ headingPath: ['## Area', '### Detail'] }]),
      want: [['docs/standalone.md', 'design-before-hardening']],
    },
    {
      name: 'heading-form index',
      seed: scope('index-entry', '.claude/FEATURES.md', [{ parentHeading: '## Active', entryHeading: featureEntry }]),
      want: [['.claude/FEATURES.md', 'index-entry']],
    },
    {
      name: 'bullet-form quick win',
      seed: scope('bullet-entry', '.claude/QUICK_WINS.md', [{ parentHeading: '## Parser', entryTitle: quickTitle }]),
      want: [['.claude/QUICK_WINS.md', 'bullet-entry']],
    },
    {
      name: 'pattern',
      seed: scope('whole-file', '.claude/patterns/shared.md'),
      want: [['.claude/patterns/shared.md', 'design-before-hardening']],
    },
    {
      name: 'umbrella breakout plus companion',
      seed: scope('whole-file', '.claude/features/umbrella.md'),
      want: [
        ['.claude/features/umbrella.md', 'design-before-hardening'],
        ['.claude/FEATURES.md', 'index-entry'],
      ],
    },
  ];

  for (const entry of cases) {
    const result = resolve(request({ target: entry.seed, seeds: [entry.seed] }), fsAdapter);

    assert.equal(result.kind, 'resolved', entry.name);
    assert.deepEqual(result.artifacts.map((artifact) => [artifact.path, artifact.selectorKind]), entry.want, entry.name);
  }
});

test('resolveGoverningSet preserves declaration order, inserts companions, sorts co-governing tails, and deduplicates exact scopes', () => {
  const featureEntry = '### [Feature A](features/a.md)';
  const firstSlice = '- **MVP - Core**';
  const secondSlice = '- **Continuation - Core**';
  const files = {
    '.claude/FEATURES.md': `# Features\n\n## Active\n\n${featureEntry}\n\n**Slices:**\n${firstSlice}\n${secondSlice}\n`,
    '.claude/features/a.md': '# Feature A\n',
    '.claude/patterns/a.md': '# A pattern\n',
    '.claude/patterns/z.md': '# Z pattern\n',
  };
  const fsAdapter = fakeRepository(files);
  const feature = scope('whole-file', '.claude/features/a.md');
  const patternA = scope('whole-file', '.claude/patterns/a.md');
  const patternZ = scope('whole-file', '.claude/patterns/z.md');
  const sorted = resolve(request({ target: feature, seeds: [feature, patternZ, patternA] }), fsAdapter);

  assert.deepEqual(sorted.governingScopes.map((item) => item.path), ['.claude/features/a.md', '.claude/patterns/a.md', '.claude/patterns/z.md']);
  assert.deepEqual(sorted.artifacts.map((artifact) => artifact.path), ['.claude/features/a.md', '.claude/FEATURES.md', '.claude/patterns/a.md', '.claude/patterns/z.md']);

  const planScopes = [patternZ, feature, patternZ];
  const planBody = Buffer.from(`# Plan\n\n**Spec:** multiple (see Governing specs)\n\n## Governing specs\n\n${planScopes.map((item) => `- Spec JSON: ${JSON.stringify(item)}`).join('\n')}\n\n## Work\n`);
  const declared = resolve(request({ mode: 'revise-plan', target: feature, seeds: [], planBuffer: planBody }), fsAdapter);

  assert.deepEqual(declared.governingScopes.map((item) => item.path), ['.claude/patterns/z.md', '.claude/features/a.md']);
  assert.deepEqual(declared.artifacts.map((artifact) => artifact.path), ['.claude/patterns/z.md', '.claude/features/a.md', '.claude/FEATURES.md']);

  const callerRequest = request({ mode: 'revise-plan', target: feature, seeds: [patternZ, patternA], planBuffer: planBody });
  const callerSeedOrder = callerRequest.seeds.map((item) => item.path);
  resolve(callerRequest, fsAdapter);
  assert.deepEqual(callerRequest.seeds.map((item) => item.path), callerSeedOrder, 'resolver must not mutate caller-owned seed order');

  const firstUnit = { normalizedKey: 'core', declaration: firstSlice, state: 'unshipped' };
  const secondUnit = { normalizedKey: 'core', declaration: secondSlice, state: 'unshipped' };
  const entryBase = ['index-entry', '.claude/FEATURES.md', [{ parentHeading: '## Active', entryHeading: featureEntry }]];
  const firstScope = scope(...entryBase, firstUnit);
  const secondScope = scope(...entryBase, secondUnit);
  const distinct = resolve(request({ mode: 'revise-code', target: firstScope, seeds: [firstScope, firstScope, secondScope] }), fsAdapter);

  assert.equal(distinct.governingScopes.length, 2);
  assert.deepEqual(distinct.governingScopes.map((item) => item.workUnit.declaration), [firstSlice, secondSlice]);
  assert.equal(distinct.artifacts.length, 1);
});

test('governing ordering ignores work units and places revise-code plan declarations before sorted explicit tails', () => {
  const entryHeading = '### [Feature A](features/a.md)';
  const zDeclaration = '- **Z - Core**';
  const aDeclaration = '- **A - Core**';
  const files = {
    '.claude/FEATURES.md': `# Features\n\n## Active\n\n${entryHeading}\n\n**Slices:**\n${zDeclaration}\n${aDeclaration}\n`,
    'docs/primary.md': '# Primary\n',
    'docs/plan-z.md': '# Plan Z\n',
    'docs/plan-a.md': '# Plan A\n',
    'docs/tail-z.md': '# Tail Z\n',
    'docs/tail-a.md': '# Tail A\n',
  };
  const fsAdapter = fakeRepository(files);
  const primary = scope('whole-file', 'docs/primary.md');
  const selector = [{ parentHeading: '## Active', entryHeading }];
  const zScope = scope('index-entry', '.claude/FEATURES.md', selector, { normalizedKey: 'core', declaration: zDeclaration, state: 'unshipped' });
  const aScope = scope('index-entry', '.claude/FEATURES.md', selector, { normalizedKey: 'core', declaration: aDeclaration, state: 'unshipped' });
  const equalSelectors = resolve(request({ target: primary, seeds: [primary, zScope, aScope] }), fsAdapter);

  assert.deepEqual(equalSelectors.governingScopes.slice(1).map((item) => item.workUnit.declaration), [zDeclaration, aDeclaration]);

  const planZ = scope('whole-file', 'docs/plan-z.md');
  const planA = scope('whole-file', 'docs/plan-a.md');
  const tailZ = scope('whole-file', 'docs/tail-z.md');
  const tailA = scope('whole-file', 'docs/tail-a.md');
  const planScopes = [planZ, planA];
  const planBuffer = Buffer.from(`# Plan\n\n**Spec:** multiple (see Governing specs)\n\n## Governing specs\n\n${planScopes.map((item) => `- Spec JSON: ${JSON.stringify(item)}`).join('\n')}\n`);
  const planBacked = resolve(request({ mode: 'revise-code', target: primary, seeds: [primary, tailZ, tailA], planBuffer }), fsAdapter);

  assert.deepEqual(planBacked.governingScopes.map((item) => item.path), ['docs/primary.md', 'docs/plan-z.md', 'docs/plan-a.md', 'docs/tail-a.md', 'docs/tail-z.md']);
});

test('slice resolution retains exact declarations, shipped state, and collision choices', () => {
  const entryHeading = '### [Feature A](features/a.md)';
  const first = '- **MVP - Core**';
  const second = '- **Continuation - Core**';
  const files = {
    '.claude/FEATURES.md': `# Features\n\n## Active\n\n${entryHeading}\n\n**Slices:**\n${first}\n${second}\n`,
  };
  const fsAdapter = fakeRepository(files);
  const requested = scope('index-entry', '.claude/FEATURES.md', [{ parentHeading: '## Active', entryHeading }], { normalizedKey: 'core', declaration: '- requested Core', state: 'unshipped' });
  const unresolved = resolve(request({ target: requested, seeds: [requested] }), fsAdapter);

  assert.deepEqual(unresolved, { kind: 'slice-selection-required', declarations: [first, second] });

  const selected = resolve(request({ target: requested, seeds: [requested], selectedSliceDeclaration: second }), fsAdapter);

  assert.deepEqual(selected.governingScopes[0].workUnit, { normalizedKey: 'core', declaration: second, state: 'unshipped' });

  const embeddedFirst = scope('index-entry', '.claude/FEATURES.md', [{ parentHeading: '## Active', entryHeading }], { normalizedKey: 'core', declaration: first, state: 'unshipped' });
  const invocationOverride = resolve(request({ target: embeddedFirst, seeds: [embeddedFirst], selectedSliceDeclaration: second }), fsAdapter);

  assert.deepEqual(invocationOverride.governingScopes[0].workUnit, { normalizedKey: 'core', declaration: second, state: 'unshipped' });
  assert.throws(
    () => resolve(request({ target: embeddedFirst, seeds: [embeddedFirst], selectedSliceDeclaration: '- unavailable' }), fsAdapter),
    (error) => error instanceof AgreementError && error.code === 'ambiguous-slice-selection',
  );
  assert.throws(
    () => resolve(request({ target: requested, seeds: [requested], selectedSliceDeclaration: '- unavailable' }), fsAdapter),
    (error) => error instanceof AgreementError && error.code === 'ambiguous-slice-selection',
  );

  const shippedDeclaration = '- ~~MVP - Core~~';
  const shippedFs = fakeRepository({ '.claude/FEATURES.md': `# Features\n\n## Active\n\n${entryHeading}\n\n**Slices:**\n${shippedDeclaration}\n` });
  const shipped = resolve(request({ target: requested, seeds: [requested], selectedSliceDeclaration: shippedDeclaration }), shippedFs);

  assert.deepEqual(shipped.governingScopes[0].workUnit, { normalizedKey: 'core', declaration: shippedDeclaration, state: 'shipped' });

  const duplicateFs = fakeRepository({ '.claude/FEATURES.md': `# Features\n\n## Active\n\n${entryHeading}\n\n**Slices:**\n${first}\n${first}\n` });
  assert.throws(
    () => resolve(request({ target: requested, seeds: [requested], selectedSliceDeclaration: first }), duplicateFs),
    (error) => error instanceof AgreementError && error.code === 'duplicate-slice-declaration',
  );
});

test('slice resolution is confined to the selected entry and binds breakout work units through the companion', () => {
  const otherEntry = '### [Other](features/other.md)';
  const selectedEntry = '### [Feature A](features/a.md)';
  const otherDeclaration = '- **Other - Core**';
  const selectedDeclaration = '- **MVP - Core**';
  const files = {
    '.claude/FEATURES.md': `# Features\n\n## Active\n\n${otherEntry}\n\n**Slices:**\n${otherDeclaration}\n\n${selectedEntry}\n\n**Slices:**\n${selectedDeclaration}\n`,
    '.claude/features/a.md': '# Feature A\n',
  };
  const fsAdapter = fakeRepository(files);
  const workUnit = { normalizedKey: 'core', declaration: selectedDeclaration, state: 'unshipped' };
  const indexScope = scope('index-entry', '.claude/FEATURES.md', [{ parentHeading: '## Active', entryHeading: selectedEntry }], workUnit);
  const indexResult = resolve(request({ target: indexScope, seeds: [indexScope] }), fsAdapter);

  assert.equal(indexResult.governingScopes[0].workUnit.declaration, selectedDeclaration);

  const breakoutScope = scope('whole-file', '.claude/features/a.md', [], workUnit);
  const breakoutResult = resolve(request({ target: breakoutScope, seeds: [breakoutScope] }), fsAdapter);

  assert.equal(breakoutResult.governingScopes[0].workUnit.declaration, selectedDeclaration);
});

test('ready-parser failures are normalized at each closed adapter operation', () => {
  const entryHeading = '### [Feature A](features/a.md)';
  const declaration = '- **MVP - Core**';
  const fsAdapter = fakeRepository({ '.claude/FEATURES.md': `# Features\n\n## Active\n\n${entryHeading}\n\n**Slices:**\n${declaration}\n` });
  const sliced = scope('index-entry', '.claude/FEATURES.md', [{ parentHeading: '## Active', entryHeading }], { normalizedKey: 'core', declaration, state: 'unshipped' });
  const operations = ['normalizeSliceName', 'parseSlices', 'findSlicesByNormalizedName'];

  for (const operation of operations) {
    const parser = { ...readyParser, [operation]: () => { throw new Error(`${operation} failed`); } };

    assert.throws(
      () => resolve(request({ target: sliced, seeds: [sliced] }), fsAdapter, parser),
      (error) => error instanceof AgreementError && error.code === 'unexpected-adapter-failure' && error.evidence.operation === `readyParser.${operation}` && error.evidence.originalMessage === `${operation} failed`,
      operation,
    );
  }
});

test('governing path resolution rejects casing, root escape, and real-target aliases', () => {
  const files = {
    'Docs/Spec.md': '# Spec\n',
    'Docs/Alias.md': '# Alias\n',
  };
  const canonical = scope('whole-file', 'Docs/Spec.md');
  const wrongCase = scope('whole-file', 'docs/Spec.md');
  assert.throws(
    () => resolve(request({ target: wrongCase, seeds: [wrongCase] }), fakeRepository(files)),
    (error) => error instanceof AgreementError && error.code === 'structural-error' && error.evidence.kind === 'path-casing',
  );
  assert.throws(
    () => resolve(request({ target: canonical, seeds: [canonical] }), fakeRepository(files, { 'C:/repo/Docs/Spec.md': 'C:/outside/Spec.md' })),
    (error) => error instanceof AgreementError && error.code === 'structural-error' && error.evidence.kind === 'root-escape',
  );
  const alias = scope('whole-file', 'Docs/Alias.md');
  const aliases = {
    'C:/repo/Docs/Spec.md': 'C:/repo/real/Spec.md',
    'C:/repo/Docs/Alias.md': 'C:/repo/real/Spec.md',
  };
  assert.throws(
    () => resolve(request({ target: canonical, seeds: [canonical, alias] }), fakeRepository(files, aliases)),
    (error) => error instanceof AgreementError && error.code === 'structural-error' && error.evidence.kind === 'alias-collision',
  );
});

test('Exploring signals from frontmatter and index placement report every unfinished artifact', () => {
  const firstEntry = '### [First](features/first.md)';
  const secondEntry = '### [Second](features/second.md)';
  const files = {
    '.claude/FEATURES.md': `# Features\n\n## Exploring\n\n${firstEntry}\n\nDraft.\n\n## Active\n\n${secondEntry}\n\nReady.\n`,
    '.claude/features/first.md': '# First\n',
    '.claude/features/second.md': '---\nstatus: exploring\n---\n# Second\n',
    '.claude/patterns/draft.md': '---\nstatus: exploring\n---\n# Draft pattern\n',
  };
  const seeds = [
    scope('whole-file', '.claude/features/first.md'),
    scope('whole-file', '.claude/features/second.md'),
    scope('whole-file', '.claude/patterns/draft.md'),
  ];
  const result = resolve(request({ target: seeds[0], seeds }), fakeRepository(files));

  assert.deepEqual(result, {
    kind: 'brainstorming-required',
    artifacts: [
      { path: '.claude/features/first.md', selectorKind: 'design-before-hardening', selectors: [], sourceBuffer: Buffer.from(files['.claude/features/first.md']) },
      { path: '.claude/FEATURES.md', selectorKind: 'index-entry', selectors: [{ parentHeading: '## Exploring', entryHeading: firstEntry }], sourceBuffer: Buffer.from(files['.claude/FEATURES.md']) },
      { path: '.claude/features/second.md', selectorKind: 'design-before-hardening', selectors: [], sourceBuffer: Buffer.from(files['.claude/features/second.md']) },
      { path: '.claude/FEATURES.md', selectorKind: 'index-entry', selectors: [{ parentHeading: '## Active', entryHeading: secondEntry }], sourceBuffer: Buffer.from(files['.claude/FEATURES.md']) },
      { path: '.claude/patterns/draft.md', selectorKind: 'design-before-hardening', selectors: [], sourceBuffer: Buffer.from(files['.claude/patterns/draft.md']) },
    ],
    unfinished: {
      artifacts: [
        { path: '.claude/FEATURES.md', signals: ['index'] },
        { path: '.claude/features/second.md', signals: ['frontmatter'] },
        { path: '.claude/patterns/draft.md', signals: ['frontmatter'] },
      ],
    },
  });
});

test('bare-CR Exploring frontmatter routes to brainstorming before agreement', () => {
  const path = '.claude/patterns/draft.md';
  const target = scope('whole-file', path);
  const source = Buffer.from('---\rstatus: exploring\r---\r# Draft\r');
  const result = resolve(request({ target, seeds: [target] }), fakeRepository({ [path]: source }));

  assert.equal(result.kind, 'brainstorming-required');
  assert.deepEqual(result.unfinished.artifacts, [{ path, signals: ['frontmatter'] }]);
});

test('Exploring resolution retains the physical baseline so legacy cleanup runs first', () => {
  const entryHeading = '### [Draft](features/draft.md)';
  const marker = Buffer.from('Status: signed off\n');
  const files = {
    '.claude/FEATURES.md': `# Features\n\n## Exploring\n\n${entryHeading}\n`,
    '.claude/features/draft.md': Buffer.concat([marker, Buffer.from('\n# Draft\n')]),
  };
  const target = scope('whole-file', '.claude/features/draft.md');
  const requestRecord = request({ target, seeds: [target] });
  const resolution = resolve(requestRecord, fakeRepository(files));

  assert.equal(resolution.kind, 'brainstorming-required');
  assert.equal(Array.isArray(resolution.artifacts), true, 'Exploring resolution must retain artifact snapshots');
  assert.deepEqual(Object.keys(resolution), ['kind', 'artifacts', 'unfinished']);
  assert.deepEqual(resolution.artifacts.map((artifact) => Object.keys(artifact)), [
    ['path', 'selectorKind', 'selectors', 'sourceBuffer'],
    ['path', 'selectorKind', 'selectors', 'sourceBuffer'],
  ]);

  const matches = detectLegacyMarkers({ artifacts: resolution.artifacts }).matches;
  const preview = previewLegacyMarkerDeletion({ sourceBuffer: resolution.artifacts[0].sourceBuffer, baselineHash: fullHash(resolution.artifacts[0].sourceBuffer), matches });
  const action = decideAgreementGate(gateInput({
    request: requestRecord,
    resolution,
    candidate: null,
    currentSources: null,
    acceptedDigest: null,
    legacyDeletions: preview.deletions,
  }));

  assert.deepEqual(matches.map((match) => [match.path, match.kind, match.rawLine.toString()]), [['.claude/features/draft.md', 'status', 'Status: signed off\n']]);
  assert.equal(action.kind, 'reviewed-migration');

  const cli = runCli({ requestText: JSON.stringify({ operation: 'resolve', input: cliRequest(requestRecord) }) }, { fsAdapter: fakeRepository(files), readyParser });
  const wireResolution = parseCliResult(cli).value;
  assert.deepEqual(Object.keys(wireResolution), ['kind', 'artifacts', 'unfinished']);
  assert.deepEqual(Object.keys(wireResolution.artifacts[0]), ['path', 'selectorKind', 'selectors', 'sourceBytesHex']);
  assert.equal(wireResolution.artifacts[0].sourceBytesHex, files['.claude/features/draft.md'].toString('hex'));
});

test('handover completion uses only unique exact archive title and displayName evidence', () => {
  const unslicedHeading = '### [Done](features/done.md)';
  const unslicedTarget = scope('index-entry', '.claude/FEATURES.md', [{ parentHeading: '## Active', entryHeading: unslicedHeading }]);
  const unslicedFs = fakeRepository({
    '.claude/FEATURES.md': '# Features\n\n## Active\n',
    '.claude/FEATURES_HISTORY.md': '# History\n\n## Entries\n\n- [Done](features/done.md): shipped.\n',
  });
  const unsliced = resolve(request({ mode: 'handover', target: unslicedTarget, seeds: [unslicedTarget], allowCompletedNoOp: true }), unslicedFs);

  assert.deepEqual(unsliced, {
    kind: 'completed-no-op',
    evidence: { target: unslicedTarget, archivePath: '.claude/FEATURES_HISTORY.md', matchedDeclaration: null },
  });

  const sliceDeclaration = '- **MVP - Core**';
  const slicedTarget = scope('index-entry', '.claude/FEATURES.md', [{ parentHeading: '## Active', entryHeading: unslicedHeading }], { normalizedKey: 'core', declaration: sliceDeclaration, state: 'unshipped' });
  const historyDeclaration = '- [Done: MVP - Core](features/done.md): shipped.';
  const slicedFs = fakeRepository({
    '.claude/FEATURES.md': '# Features\n\n## Active\n',
    '.claude/FEATURES_HISTORY.md': `# History\n\n## Entries\n\n${historyDeclaration}\n`,
  });
  const sliced = resolve(request({ mode: 'handover', target: slicedTarget, seeds: [slicedTarget], allowCompletedNoOp: true }), slicedFs);

  assert.deepEqual(sliced, {
    kind: 'completed-no-op',
    evidence: { target: slicedTarget, archivePath: '.claude/FEATURES_HISTORY.md', matchedDeclaration: historyDeclaration },
  });
  const mismatchedTarget = scope('index-entry', '.claude/FEATURES.md', [{ parentHeading: '## Active', entryHeading: unslicedHeading }], { normalizedKey: 'wrong', declaration: sliceDeclaration, state: 'unshipped' });
  const mismatchedRequest = request({ mode: 'handover', target: mismatchedTarget, seeds: [mismatchedTarget], allowCompletedNoOp: true });
  assert.throws(
    () => resolve(mismatchedRequest, slicedFs),
    (error) => error instanceof AgreementError && error.code === 'structural-error' && error.evidence.kind === 'selector-absence',
  );
  const forgedCompletion = decideAgreementGate(gateInput({
    request: mismatchedRequest,
    resolution: {
      kind: 'completed-no-op',
      evidence: { target: mismatchedTarget, archivePath: '.claude/FEATURES_HISTORY.md', matchedDeclaration: historyDeclaration },
    },
    candidate: null,
    currentSources: null,
    acceptedDigest: null,
  }), { fsAdapter: slicedFs, readyParser });
  assert.equal(forgedCompletion.kind, 'stop-error');
  for (const [declaration, state] of [
    [sliceDeclaration, 'shipped'],
    ['- ~~MVP - Core~~', 'unshipped'],
  ]) {
    const stateMismatchTarget = scope('index-entry', '.claude/FEATURES.md', [{ parentHeading: '## Active', entryHeading: unslicedHeading }], { normalizedKey: 'core', declaration, state });
    const stateMismatchRequest = request({ mode: 'handover', target: stateMismatchTarget, seeds: [stateMismatchTarget], allowCompletedNoOp: true });
    assert.throws(
      () => resolve(stateMismatchRequest, slicedFs),
      (error) => error instanceof AgreementError && error.code === 'structural-error' && error.evidence.kind === 'selector-absence',
    );
    const forgedStateCompletion = decideAgreementGate(gateInput({
      request: stateMismatchRequest,
      resolution: {
        kind: 'completed-no-op',
        evidence: { target: stateMismatchTarget, archivePath: '.claude/FEATURES_HISTORY.md', matchedDeclaration: historyDeclaration },
      },
      candidate: null,
      currentSources: null,
      acceptedDigest: null,
    }), { fsAdapter: slicedFs, readyParser });
    assert.equal(forgedStateCompletion.kind, 'stop-error');
  }
  assert.throws(
    () => resolve(request({ mode: 'revise-spec', target: unslicedTarget, seeds: [unslicedTarget] }), unslicedFs),
    (error) => error instanceof AgreementError && error.code === 'structural-error' && error.evidence.kind === 'selector-absence',
  );
  const duplicateFs = fakeRepository({
    '.claude/FEATURES.md': '# Features\n\n## Active\n',
    '.claude/FEATURES_HISTORY.md': `# History\n\n## Entries\n\n${historyDeclaration}\n${historyDeclaration}\n`,
  });
  assert.throws(
    () => resolve(request({ mode: 'handover', target: slicedTarget, seeds: [slicedTarget], allowCompletedNoOp: true }), duplicateFs),
    (error) => error instanceof AgreementError && error.code === 'structural-error' && error.evidence.kind === 'selector-absence',
  );
});

test('handover completion recognizes unique plain index-only feature archive entries', () => {
  const title = 'Dedup-before-verify (no breakout file)';
  const target = scope('index-entry', '.claude/FEATURES.md', [{ parentHeading: '## Active', entryHeading: `### ${title}` }]);
  const declaration = `- ${title}: shipped.`;
  const requestRecord = request({ mode: 'handover', target, seeds: [target], allowCompletedNoOp: true });
  const repository = (history) => fakeRepository({
    '.claude/FEATURES.md': '# Features\n\n## Active\n',
    '.claude/FEATURES_HISTORY.md': `# History\n\n## Entries\n\n${history}\n`,
  });

  assert.deepEqual(resolve(requestRecord, repository(declaration)), {
    kind: 'completed-no-op',
    evidence: { target, archivePath: '.claude/FEATURES_HISTORY.md', matchedDeclaration: null },
  });
  assert.throws(
    () => resolve(requestRecord, repository(`${declaration}\n${declaration}`)),
    (error) => error instanceof AgreementError && error.code === 'structural-error' && error.evidence.kind === 'selector-absence',
  );
});

test('handover completion recognizes unique bold bug and quick-win archive entries and rejects duplicates', () => {
  const bugTitle = 'Shared sync-gists skill names the wrong backlog command.';
  const bugTarget = scope('index-entry', '.claude/BUGS.md', [{ parentHeading: '## Active', entryHeading: `### ${bugTitle}` }]);
  const quickTitle = 'Tidy parser';
  const quickTarget = scope('bullet-entry', '.claude/QUICK_WINS.md', [{ parentHeading: '## Parser', entryTitle: quickTitle }]);
  const cases = [
    {
      name: 'bug',
      target: bugTarget,
      activePath: '.claude/BUGS.md',
      active: '# Bugs\n\n## Active\n',
      archivePath: '.claude/BUGS_HISTORY.md',
      declaration: `- **${bugTitle}** Corrected it.`,
    },
    {
      name: 'quick win',
      target: quickTarget,
      activePath: '.claude/QUICK_WINS.md',
      active: '# Quick wins\n\n## Parser\n',
      archivePath: '.claude/QUICK_WINS_HISTORY.md',
      declaration: `- **${quickTitle}**: shipped.`,
    },
  ];

  for (const entry of cases) {
    const uniqueFs = fakeRepository({
      [entry.activePath]: entry.active,
      [entry.archivePath]: `# History\n\n## Entries\n\n${entry.declaration}\n`,
    });
    const unique = resolve(request({ mode: 'handover', target: entry.target, seeds: [entry.target], allowCompletedNoOp: true }), uniqueFs);

    assert.deepEqual(unique, {
      kind: 'completed-no-op',
      evidence: { target: entry.target, archivePath: entry.archivePath, matchedDeclaration: null },
    }, entry.name);

    const ambiguousFs = fakeRepository({
      [entry.activePath]: entry.active,
      [entry.archivePath]: `# History\n\n## Entries\n\n${entry.declaration}\n${entry.declaration}\n`,
    });
    assert.throws(
      () => resolve(request({ mode: 'handover', target: entry.target, seeds: [entry.target], allowCompletedNoOp: true }), ambiguousFs),
      (error) => error instanceof AgreementError && error.code === 'structural-error' && error.evidence.kind === 'selector-absence',
      `${entry.name} ambiguity`,
    );
  }
});

test('parsePlanContract enforces exact declaration and visible-header grammar', () => {
  const path = 'docs/spec.md';
  const canonicalScope = scope('whole-file', path);
  const json = JSON.stringify(canonicalScope);
  const validHeader = `**Spec:** [${path}](${path})`;
  const fsAdapter = fakeRepository({ [path]: '# Spec\n' });
  const invalidPlans = [
    `# Plan\n\n${validHeader}\n`,
    `# Plan\n\n${validHeader}\n\n## Governing specs\n\n- Spec JSON: ${json}\n\n## Governing specs\n\n- Spec JSON: ${json}\n`,
    `# Plan\n\n${validHeader}\n\n## Governing specs\n\n- None.\n- Spec JSON: ${json}\n`,
    `# Plan\n\n${validHeader}\n\n## Governing specs\n\n- Spec JSON:\n  ${json}\n`,
    `# Plan\n\n${validHeader}\n\n## Governing specs\n\n- Spec JSON: {bad}\n`,
    `# Plan\n\n${validHeader}\n\n## Governing specs\n\n- Spec JSON: ${JSON.stringify({ ...canonicalScope, extra: true })}\n`,
    `# Plan\n\n## Work\n\n${validHeader}\n\n## Governing specs\n\n- Spec JSON: ${json}\n`,
    `# Plan\n\n## Governing specs\n\n- Spec JSON: ${json}\n\n${validHeader}\n`,
    `# Plan\n\n**Spec:** none\n\n## Governing specs\n\n- Spec JSON: ${json}\n`,
    `# Plan\n\n${validHeader}\n${validHeader}\n\n## Governing specs\n\n- Spec JSON: ${json}\n`,
    `# Plan\n\n${validHeader}\n\n\`\`\`\n## Governing specs\n- Spec JSON: ${json}\n\`\`\`\n`,
  ];

  for (const plan of invalidPlans) {
    expectStructural(() => parsePlanContract({ planBuffer: Buffer.from(plan), projectRoot }, { fsAdapter }), 'plan-contract-grammar');
  }

  const unresolved = scope('index-entry', path, [{ parentHeading: '## Missing', entryHeading: '### Missing' }]);
  expectStructural(
    () => parsePlanContract({ planBuffer: Buffer.from(`# Plan\n\n**Spec:** [${path}](${path})\n\n## Governing specs\n\n- Spec JSON: ${JSON.stringify(unresolved)}\n`), projectRoot }, { fsAdapter }),
    'plan-contract-grammar',
  );

  const fencedLookalike = Buffer.from(`# Plan\n\n\`\`\`\n**Spec:** none\n## Governing specs\n- None.\n\`\`\`\n\n${validHeader}\n\n## Governing specs\n\n- Spec JSON: ${json}\n`);
  assert.deepEqual(parsePlanContract({ planBuffer: fencedLookalike, projectRoot }, { fsAdapter }).governingScopes, [canonicalScope]);
});

test('serializePlanContract round trips zero, one, and multiple scopes without interpreting prose or fenced lookalikes', () => {
  const first = scope('whole-file', 'docs/first.md');
  const second = scope('sections', 'docs/second.md', [{ headingPath: ['## Area'] }]);
  const fsAdapter = fakeRepository({
    'docs/first.md': '# First\n',
    'docs/second.md': '# Second\n\n## Area\n',
  });
  const body = Buffer.from('# Plan\n\nRelated prose: [first](docs/first.md).\n\n```md\n**Spec:** none\n## Governing specs\n- None.\n```\n\n## Work\n\n- Implement.\n');
  const cases = [[], [first], [first, second]];

  for (const governingScopes of cases) {
    const serialized = serializePlanContract({ planBody: body, governingScopes });
    const parsed = parsePlanContract({ planBuffer: serialized, projectRoot }, { fsAdapter });

    assert.deepEqual(parsed.governingScopes, governingScopes);
    assert.match(serialized.toString(), /Related prose: \[first\]\(docs\/first\.md\)\./);
  }

  const zero = serializePlanContract({ planBody: Buffer.from('# Plan\n\n## Work\n'), governingScopes: [] }).toString();
  assert.equal(zero, '# Plan\n\n**Spec:** none\n\n## Governing specs\n\n- None.\n\n## Work\n');
  expectStructural(() => serializePlanContract({ planBody: Buffer.from('# Plan\n\n**Spec:** none\n'), governingScopes: [] }), 'plan-contract-grammar');
  expectStructural(() => serializePlanContract({ planBody: Buffer.from('# Plan\n\n## Governing specs\n\n- None.\n'), governingScopes: [] }), 'plan-contract-grammar');
  expectStructural(() => serializePlanContract({
    planBody: Buffer.from('# Plan\n\n## Work\n'),
    governingScopes: [scope('whole-file', 'docs/spec.md\n## Injected')],
  }), 'plan-contract-grammar');
});

test('serializePlanContract escapes a canonical path for the human Markdown header', () => {
  const path = 'docs/x](y) _FAKE_ [z';
  const governingScope = scope('whole-file', path);
  const serialized = serializePlanContract({ planBody: Buffer.from('# Plan\n\n## Work\n'), governingScopes: [governingScope] });
  const text = serialized.toString();
  const header = text.split(/\r?\n/, 1)[0];

  assert.equal(header.includes('](y)'), false);
  assert.equal(text.includes(`- Spec JSON: ${JSON.stringify(governingScope)}`), true);
  assert.deepEqual(parsePlanContract({ planBuffer: serialized, projectRoot }, { fsAdapter: fakeRepository({ [path]: '# Spec\n' }) }).governingScopes, [governingScope]);
});

test('golden corpus preserves canonical selection and representation identity', () => {
  for (const entry of corpus) {
    const selection = selectionFor(entry);
    const hashed = hashSelection(selection);

    assert.equal(selection.selectedBytes.toString('hex'), entry.selectedBytesHex, entry.name);
    assert.deepEqual(selection.sourceSpans.map((span) => span.toString('hex')), entry.sourceSpansHex, entry.name);
    assert.equal(hashed.contentHash, entry.contentHash, entry.name);
    assert.equal(hashed.sourceHash, entry.sourceHash, entry.name);
  }
});

test('hashSelection frames raw source spans so boundary splits cannot collide', () => {
  const common = { path: 'artifact.md', selectorKind: 'design-before-hardening', selectors: [], selectedBytes: Buffer.from('x\n') };
  const oneSpan = hashSelection({ ...common, sourceSpans: [Buffer.from('ab')], sourceRanges: [{ start: 0, end: 2 }] });
  const splitSpans = hashSelection({ ...common, sourceSpans: [Buffer.from('a'), Buffer.from('b')], sourceRanges: [{ start: 0, end: 1 }, { start: 1, end: 2 }] });

  assert.equal(oneSpan.contentHash, splitSpans.contentHash);
  assert.notEqual(oneSpan.sourceHash, splitSpans.sourceHash);
  assert.equal(oneSpan.sourceHash, createHash('sha256').update('["6162"]', 'utf8').digest('hex'));
});

test('scanMarkdown applies CommonMark backtick and tilde fence rules', () => {
  const source = Buffer.from('```js\n# hidden\n````\n# visible\n~~~ info\n* hidden\n~~~x\n# still-hidden\n~~~\n* visible\n```bad`\n# visible-too\n');
  const lines = scanMarkdown(source).lines;

  assert.deepEqual(lines.filter((line) => line.heading).map((line) => line.heading.exactLine), ['# visible', '# visible-too']);
  assert.deepEqual(lines.filter((line) => line.topLevelBullet).map((line) => line.content), ['* visible']);
});

test('scanMarkdown retains raw spans for outside-fence headings and bullets', () => {
  const source = Buffer.from('## Parent\r\n```\r\n### fake\r\n- fake\r\n```\r\n### Real\r\n- Real\r\n');
  const lines = scanMarkdown(source).lines;
  const heading = lines.find((line) => line.heading && line.heading.exactLine === '### Real');
  const bullet = lines.find((line) => line.topLevelBullet);

  assert.equal(source.subarray(heading.rawStart, heading.rawEnd).toString('hex'), Buffer.from('### Real\r\n').toString('hex'));
  assert.equal(source.subarray(bullet.rawStart, bullet.rawEnd).toString('hex'), Buffer.from('- Real\r\n').toString('hex'));
});

test('scanMarkdown identifies fence boundary lines independently from structural eligibility', () => {
  const lines = scanMarkdown(Buffer.from('```\n### hidden\n```\n### visible\n')).lines;

  assert.deepEqual(Object.keys(lines[0]), ['rawStart', 'rawEnd', 'content', 'terminator', 'outsideFence', 'opensFence', 'heading', 'topLevelBullet']);
  assert.strictEqual(lines[0].outsideFence, true);
  assert.strictEqual(lines[0].opensFence, true);
  assert.strictEqual(lines[1].outsideFence, false);
  assert.strictEqual(lines[3].outsideFence, true);
});

test('selections retain original raw ranges across BOM, CRLF, and gaps', () => {
  const source = Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from('## Parent\r\nintro\r\n### Entry\r\nbody\r\n')]);
  const result = selectArtifact({ path: 'a.md', sourceBuffer: source, selectorKind: 'index-entry', selectors: [{ parentHeading: '## Parent', entryHeading: '### Entry' }] });

  assert.deepEqual(result.sourceRanges, [{ start: 0, end: 14 }, { start: 21, end: 38 }]);
  assert.deepEqual(result.sourceSpans.map((span) => span.toString('hex')), [source.subarray(0, 14).toString('hex'), source.subarray(21, 38).toString('hex')]);
});

test('locateSelection reports the one-based line where the selected entry starts', () => {
  const locate = ({ path, sourceBuffer, selectorKind, selectors }) => locateSelection({ projectRoot: 'C:\\repo', path, selectorKind, selectors, sourceBuffer, linkFormat: null });
  const indexSource = Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from('## Parent\r\nintro\r\n### Entry\r\nbody\r\n')]);
  assert.deepEqual(locate({ path: 'a.md', sourceBuffer: indexSource, selectorKind: 'index-entry', selectors: [{ parentHeading: '## Parent', entryHeading: '### Entry' }] }), { path: 'a.md', line: 3, linkText: 'a.md:3', linkTarget: 'C:/repo/a.md' });

  const bareCrSource = Buffer.from(['## Parent', 'intro', '### Entry', 'body', ''].join(String.fromCharCode(13)));
  assert.deepEqual(locate({ path: 'a.md', sourceBuffer: bareCrSource, selectorKind: 'index-entry', selectors: [{ parentHeading: '## Parent', entryHeading: '### Entry' }] }), { path: 'a.md', line: 3, linkText: 'a.md:3', linkTarget: 'C:/repo/a.md' });

  const bulletSource = Buffer.from('# Index\n\n## Other\n- Elsewhere\n\n## Parent\n- First\n- Task\n  continuation\n');
  assert.deepEqual(locate({ path: 'a.md', sourceBuffer: bulletSource, selectorKind: 'bullet-entry', selectors: [{ parentHeading: '## Parent', entryTitle: 'Task' }] }), { path: 'a.md', line: 8, linkText: 'a.md:8', linkTarget: 'C:/repo/a.md' });

  const design = Buffer.from('# Design\n\n## Hardening\n- (None yet; this file has not been through a revise-spec run.)\n');
  assert.deepEqual(locate({ path: 'a.md', sourceBuffer: design, selectorKind: 'design-before-hardening', selectors: [] }), { path: 'a.md', line: null, linkText: 'a.md', linkTarget: 'C:/repo/a.md' });

  expectStructural(() => locate({ path: 'a.md', sourceBuffer: bulletSource, selectorKind: 'bullet-entry', selectors: [{ parentHeading: '## Parent', entryTitle: 'Missing' }] }));
});

test('locateSelection renders the link target from the line-link format, never from prose', () => {
  const bulletSource = Buffer.from('## Parent\n- Task\n');
  const selectors = [{ parentHeading: '## Parent', entryTitle: 'Task' }];
  const format = 'subl://open?url=file:///{path}&line={line}';
  const located = locateSelection({ projectRoot: 'C:\\repo', path: 'docs/a.md', selectorKind: 'bullet-entry', selectors, sourceBuffer: bulletSource, linkFormat: format });
  assert.deepEqual(located, { path: 'docs/a.md', line: 2, linkText: 'docs/a.md:2', linkTarget: 'subl://open?url=file:///C:/repo/docs/a.md&line=2' });

  const repeated = locateSelection({ projectRoot: '/srv/repo', path: 'docs/a.md', selectorKind: 'bullet-entry', selectors, sourceBuffer: bulletSource, linkFormat: '{path}#{line}-{line}' });
  assert.equal(repeated.linkTarget, '/srv/repo/docs/a.md#2-2', 'every placeholder occurrence is substituted');

  const design = Buffer.from('# Design\n');
  const unlined = locateSelection({ projectRoot: 'C:\\repo', path: 'docs/a.md', selectorKind: 'design-before-hardening', selectors: [], sourceBuffer: design, linkFormat: format });
  assert.deepEqual(unlined, { path: 'docs/a.md', line: null, linkText: 'docs/a.md', linkTarget: 'C:/repo/docs/a.md' }, 'a selection without a line links the bare path even when a format is set');

  const empty = locateSelection({ projectRoot: 'C:\\repo', path: 'docs/a.md', selectorKind: 'bullet-entry', selectors, sourceBuffer: bulletSource, linkFormat: '' });
  assert.equal(empty.linkTarget, 'C:/repo/docs/a.md', 'an empty format reads as unset');

  expectStructural(() => locateSelection({ path: 'docs/a.md', selectorKind: 'bullet-entry', selectors, sourceBuffer: bulletSource, linkFormat: null }), 'locate-input');
  expectStructural(() => locateSelection({ projectRoot: 'C:\\repo', path: 'docs/a.md', selectorKind: 'bullet-entry', selectors, sourceBuffer: bulletSource, linkFormat: 7 }), 'locate-input');
});

test('bullet selection excludes a column-zero fence after the entry', () => {
  const source = Buffer.from('## Parent\n- Task\n```\n# not a continuation\n```\n  continuation\n');
  const result = selectArtifact({ path: 'a.md', sourceBuffer: source, selectorKind: 'bullet-entry', selectors: [{ parentHeading: '## Parent', entryTitle: 'Task' }] });

  assert.equal(result.selectedBytes.toString(), '## Parent\n- Task\n');
});

test('design selector accepts only terminal closed Hardening provenance', () => {
  const stamp = '- revise-spec graduated 2026-08-19 03:34 at 9ebd097, scope: whole file, content: 74092a52';
  const refreshed = '- revise-spec refreshed 2026-08-19 03:34 at 9ebd097, scope: whole file, content: 74092a52 (sign-off marker)';
  const completed = '- handover completed 2026-08-19 03:34 at 9ebd097, scope: whole file, content: 74092a52';
  const placeholders = [
    '- (None yet; this file has not been through a revise-spec run.)',
    '- (None yet; this file has not completed a revise-spec run.)',
    '- (None entered yet; this file has not been through a revise-spec review.)',
  ];

  for (const body of [stamp, refreshed, completed, ...placeholders]) {
    assert.equal(selectionFor({ sourceBytesHex: Buffer.from(`# Design\n\n## Hardening\n${body}\n`).toString('hex'), selector: { selectorKind: 'design-before-hardening', selectors: [] } }).selectedBytes.toString(), '# Design\n');
  }

  for (const body of ['', `${placeholders[0]}\n${placeholders[1]}`, `${stamp}\n${placeholders[0]}`, '- malformed', '- material body text']) {
    expectStructural(() => selectionFor({ sourceBytesHex: Buffer.from(`# Design\n## Hardening\n${body}\n`).toString('hex'), selector: { selectorKind: 'design-before-hardening', selectors: [] } }));
  }

  expectStructural(() => selectionFor({ sourceBytesHex: Buffer.from(`# Design\n## Hardening\n${stamp}\n## After\ncontent\n`).toString('hex'), selector: { selectorKind: 'design-before-hardening', selectors: [] } }));
});

test('selector failures use only the closed shape absence and ambiguity evidence', () => {
  const ordinary = Buffer.from('## Parent\n### Entry\nBody\n- Task\n');
  const repeatedEntries = Buffer.from('## Parent\n### Repeat\nA\n### Repeat\nB\n- Task\n- Task\n');
  const repeatedParents = Buffer.from('## Parent\n### Entry\nA\n## Parent\n### Entry\nB\n');
  const orderedSections = Buffer.from('## Parent\n### Earlier\nA\n### Later\nB\n');
  const cases = [
    ['raw selector shape', () => selectArtifact({ path: 'a.md', sourceBuffer: ordinary, selectorKind: 'index-entry', selectors: null }), 'selector-shape'],
    ['design cardinality', () => selectArtifact({ path: 'a.md', sourceBuffer: ordinary, selectorKind: 'design-before-hardening', selectors: [{ headingPath: ['## Parent'] }] }), 'selector-shape'],
    ['section range shape', () => selectArtifact({ path: 'a.md', sourceBuffer: ordinary, selectorKind: 'sections', selectors: [{ startLine: 2, endLine: 3 }] }), 'selector-shape'],
    ['section artifact shape', () => selectArtifact({ path: 'a.md', sourceBuffer: ordinary, selectorKind: 'sections', selectors: [{ headingPath: ['## Parent', '### Entry'] }] }), 'selector-shape'],
    ['section order', () => selectArtifact({ path: 'a.md', sourceBuffer: orderedSections, selectorKind: 'sections', selectors: [{ headingPath: ['## Parent', '### Later'] }, { headingPath: ['## Parent', '### Earlier'] }] }), 'selector-shape'],
    ['missing section path', () => selectArtifact({ path: 'a.md', sourceBuffer: ordinary, selectorKind: 'sections', selectors: [{ headingPath: ['## Parent', '### Missing'] }] }), 'selector-absence'],
    ['repeated section path', () => selectArtifact({ path: 'a.md', sourceBuffer: repeatedEntries, selectorKind: 'sections', selectors: [{ headingPath: ['## Parent', '### Repeat'] }] }), 'selector-ambiguity'],
    ['missing parent heading', () => selectArtifact({ path: 'a.md', sourceBuffer: ordinary, selectorKind: 'index-entry', selectors: [{ parentHeading: '## Missing', entryHeading: '### Entry' }] }), 'selector-absence'],
    ['repeated parent heading', () => selectArtifact({ path: 'a.md', sourceBuffer: repeatedParents, selectorKind: 'index-entry', selectors: [{ parentHeading: '## Parent', entryHeading: '### Entry' }] }), 'selector-ambiguity'],
    ['missing entry heading', () => selectArtifact({ path: 'a.md', sourceBuffer: ordinary, selectorKind: 'index-entry', selectors: [{ parentHeading: '## Parent', entryHeading: '### Missing' }] }), 'selector-absence'],
    ['repeated entry heading', () => selectArtifact({ path: 'a.md', sourceBuffer: repeatedEntries, selectorKind: 'index-entry', selectors: [{ parentHeading: '## Parent', entryHeading: '### Repeat' }] }), 'selector-ambiguity'],
    ['missing bullet entry', () => selectArtifact({ path: 'a.md', sourceBuffer: ordinary, selectorKind: 'bullet-entry', selectors: [{ parentHeading: '## Parent', entryTitle: 'Missing' }] }), 'selector-absence'],
    ['repeated bullet entry', () => selectArtifact({ path: 'a.md', sourceBuffer: repeatedEntries, selectorKind: 'bullet-entry', selectors: [{ parentHeading: '## Parent', entryTitle: 'Task' }] }), 'selector-ambiguity'],
  ];

  for (const [label, invoke, expectedKind] of cases) {
    assert.throws(invoke, (error) => error instanceof AgreementError && error.code === 'structural-error' && error.evidence.kind === expectedKind, `${label} must report ${expectedKind}`);
  }

  const outOfOrderScope = scope('sections', 'a.md', [{ headingPath: ['## Parent', '### Later'] }, { headingPath: ['## Parent', '### Earlier'] }]);
  assert.throws(
    () => resolve(request({ target: outOfOrderScope, seeds: [outOfOrderScope] }), fakeRepository({ 'a.md': orderedSections })),
    (error) => error instanceof AgreementError && error.code === 'structural-error' && error.evidence.kind === 'selector-shape',
    'resolved section order must report selector-shape',
  );
});

test('ready-backed backlog selectors reject unsupported Markdown entry tokens', () => {
  const cases = [
    ['indented parent heading', '  ## Parent\n  ### Entry\nBody\n', 'index-entry', { parentHeading: '  ## Parent', entryHeading: '  ### Entry' }],
    ['tabbed parent heading', '##\tParent\n### Entry\nBody\n', 'index-entry', { parentHeading: '##\tParent', entryHeading: '### Entry' }],
    ['indented entry heading', '## Parent\n  ### Entry\nBody\n', 'index-entry', { parentHeading: '## Parent', entryHeading: '  ### Entry' }],
    ['tabbed entry heading', '## Parent\n###\tEntry\nBody\n', 'index-entry', { parentHeading: '## Parent', entryHeading: '###\tEntry' }],
    ['star bullet', '## Parent\n* Task\n', 'bullet-entry', { parentHeading: '## Parent', entryTitle: 'Task' }],
    ['plus bullet', '## Parent\n+ Task\n', 'bullet-entry', { parentHeading: '## Parent', entryTitle: 'Task' }],
    ['indented dash bullet', '## Parent\n  - Task\n', 'bullet-entry', { parentHeading: '## Parent', entryTitle: 'Task' }],
  ];

  for (const [label, source, selectorKind, selector] of cases) {
    assert.throws(
      () => selectArtifact({ path: 'a.md', sourceBuffer: Buffer.from(source), selectorKind, selectors: [selector] }),
      (error) => error instanceof AgreementError && error.code === 'structural-error' && error.evidence.kind === 'selector-absence',
      label,
    );
  }

  const commonMark = scanMarkdown(Buffer.from('  ## Parent\n  ### Entry\n* Task\n+ Task\n  - Task\n')).lines;
  assert.deepEqual(commonMark.filter((line) => line.heading).map((line) => line.content), ['  ## Parent', '  ### Entry']);
  assert.deepEqual(commonMark.filter((line) => line.topLevelBullet).map((line) => line.content), ['* Task', '+ Task', '  - Task']);
});

test('canonicalizePath rejects traversal, duplicate matches, and adapter failures', () => {
  const root = 'C:/repo';
  const directories = new Map([[root, ['Docs']], ['C:/repo/Docs', ['Spec.md']]]);
  const adapter = {
    readDirectory: (path) => directories.get(path) ?? [],
    realpath: (path) => path,
  };

  assert.deepEqual(canonicalizePath(root, 'Docs/Spec.md', adapter), { path: 'Docs/Spec.md', realPath: 'C:/repo/Docs/Spec.md' });
  expectStructural(() => canonicalizePath(root, 'docs/Spec.md', adapter));
  expectStructural(() => canonicalizePath(root, '../Spec.md', adapter));
  expectStructural(() => canonicalizePath(root, 'Docs/Spec.md', { ...adapter, readDirectory: (path) => path === root ? ['Docs', 'Docs'] : ['Spec.md'] }), 'path-casing');
  assert.throws(() => canonicalizePath(root, 'Docs/Spec.md', { ...adapter, readDirectory: () => { throw new Error('directory failure'); } }), (error) => error instanceof AgreementError && error.code === 'structural-error' && error.evidence.kind === 'unreadable-artifact' && error.evidence.operation === 'readDirectory' && error.evidence.path === root && error.evidence.originalMessage === 'directory failure');
  assert.throws(() => canonicalizePath(root, 'Docs/Spec.md', { ...adapter, realpath: () => { throw new Error('realpath failure'); } }), (error) => error instanceof AgreementError && error.code === 'structural-error' && error.evidence.kind === 'unreadable-artifact' && error.evidence.operation === 'realpath' && error.evidence.path === root && error.evidence.originalMessage === 'realpath failure');
});

test('invalid UTF-8 fails before scanning and selection', () => {
  const invalidOne = Buffer.from([0xc3]);
  const invalidTwo = Buffer.from([0x80]);

  assert.equal(invalidOne.toString('utf8'), invalidTwo.toString('utf8'));
  for (const sourceBuffer of [invalidOne, invalidTwo]) {
    expectStructural(() => scanMarkdown(sourceBuffer), 'invalid-utf8');
    expectStructural(() => selectArtifact({ path: 'a.md', sourceBuffer, selectorKind: 'design-before-hardening', selectors: [] }), 'invalid-utf8');
    expectStructural(() => selectArtifact({ path: 'a.md', sourceBuffer, selectorKind: 'design-before-hardening', selectors: [{}] }), 'invalid-utf8');
  }
});

test('legacy detection recognizes only the two closed column-one grammars in artifact order', () => {
  const statusSource = Buffer.from([
    0xef, 0xbb, 0xbf,
    ...Buffer.from('Status: signed off\nStatus: signed off \r\nStatus: signed off not-a-canonical-suffix\r# Design\n status: signed off\n> Status: signed off\ninline Status: signed off\n```\nStatus: signed off\n```\n## Hardening\n- revise-spec graduated 2026-08-19 03:34 at 9ebd097, scope: whole file, content: 74092a52\n'),
  ]);
  const refreshSource = Buffer.from('# Design\n- revise-spec refreshed 2026-08-19 03:34 at 9ebd097, scope: whole file, content: 74092a52 (sign-off marker)\n## Hardening\nStatus: signed off misplaced-header\n- revise-spec refreshed 2026-08-19 03:35 at 9ebd097, scope: whole file, content: 74092a52 (sign-off marker)\n');
  const artifacts = [
    { path: 'docs/status.md', selectorKind: 'design-before-hardening', selectors: [], sourceBuffer: statusSource },
    { path: 'docs/refresh.md', selectorKind: 'design-before-hardening', selectors: [], sourceBuffer: refreshSource },
  ];

  const { matches } = detectLegacyMarkers({ artifacts });

  assert.deepEqual(matches.map((match) => [match.path, match.kind, match.rawLine.toString()]), [
    ['docs/status.md', 'status', 'Status: signed off\n'],
    ['docs/status.md', 'status', 'Status: signed off \r\n'],
    ['docs/status.md', 'status', 'Status: signed off not-a-canonical-suffix\r'],
    ['docs/refresh.md', 'status', 'Status: signed off misplaced-header\n'],
    ['docs/refresh.md', 'hardening-refresh', '- revise-spec refreshed 2026-08-19 03:35 at 9ebd097, scope: whole file, content: 74092a52 (sign-off marker)\n'],
  ]);
  assert.equal(matches[0].rawStart, 3);
  assert.equal(matches.every((match) => match.rawEnd - match.rawStart === match.rawLine.length), true);
});

test('legacy detection scans one physical index once across plural selected entries', () => {
  const sourceBuffer = Buffer.from('Status: signed off\n\n## Active\n\n### One\nBody one.\n\n### Two\nBody two.\n');
  const artifacts = [
    { path: '.claude/FEATURES.md', selectorKind: 'index-entry', selectors: [{ parentHeading: '## Active', entryHeading: '### One' }], sourceBuffer },
    { path: '.claude/FEATURES.md', selectorKind: 'index-entry', selectors: [{ parentHeading: '## Active', entryHeading: '### Two' }], sourceBuffer: Buffer.from(sourceBuffer) },
  ];

  const { matches } = detectLegacyMarkers({ artifacts });

  assert.deepEqual(matches.map((match) => [match.path, match.kind, match.rawStart, match.rawEnd]), [['.claude/FEATURES.md', 'status', 0, 19]]);

  const contradictory = artifacts.map((artifact, index) => index === 0 ? artifact : { ...artifact, sourceBuffer: Buffer.from(`${sourceBuffer.toString()}changed\n`) });
  assert.throws(
    () => detectLegacyMarkers({ artifacts: contradictory }),
    (error) => error instanceof AgreementError && error.code === 'structural-error' && error.evidence.kind === 'hardening-grammar',
  );
});

test('legacy detection rejects snapshots outside the closed selector contract', () => {
  const sourceBytesHex = Buffer.from('# Spec\n').toString('hex');
  const invalidArtifacts = [
    { path: 'docs/spec.md', selectorKind: 'bogus', selectors: [], sourceBuffer: Buffer.from('# Spec\n') },
    { path: '.claude/FEATURES.md', selectorKind: 'index-entry', selectors: [], sourceBuffer: Buffer.from('# Features\n') },
  ];

  for (const artifact of invalidArtifacts) {
    assert.throws(
      () => detectLegacyMarkers({ artifacts: [artifact] }),
      (error) => error instanceof AgreementError && error.code === 'structural-error' && error.evidence.kind === 'hardening-grammar',
    );
  }

  const cli = runCli({
    requestText: JSON.stringify({
      operation: 'legacy-detect',
      input: { artifacts: [{ path: 'docs/spec.md', selectorKind: 'bogus', selectors: [], sourceBytesHex }] },
    }),
  });
  assert.equal(cli.exitCode, 1);
  assert.equal(parseCliResult(cli).error.evidence.kind, 'hardening-grammar');
});

test('legacy deletion previews preserve every unowned byte across positions and line endings', () => {
  const cases = [
    {
      name: 'first line with BOM and LF',
      source: Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from('Status: signed off\n\n# Design\n')]),
      expected: Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from('# Design\n')]),
      ownedBlank: true,
    },
    {
      name: 'middle line with CRLF and mixed endings',
      source: Buffer.from('# Design\r\n\r\nStatus: signed off old\r\n\nBody\r'),
      expected: Buffer.from('# Design\r\n\r\nBody\r'),
      ownedBlank: true,
    },
    {
      name: 'final line with bare CR and no terminal newline',
      source: Buffer.from('# Design\rStatus: signed off'),
      expected: Buffer.from('# Design\r'),
      ownedBlank: false,
    },
    {
      name: 'Hardening refresh marker',
      source: Buffer.from('# Design\n\n## Hardening\n\n- revise-spec graduated 2026-08-19 03:34 at 9ebd097, scope: whole file, content: 74092a52\n- revise-spec refreshed 2026-08-19 03:35 at 9ebd097, scope: whole file, content: 74092a52 (sign-off marker)\n'),
      expected: Buffer.from('# Design\n\n## Hardening\n\n- revise-spec graduated 2026-08-19 03:34 at 9ebd097, scope: whole file, content: 74092a52\n'),
      ownedBlank: false,
    },
  ];

  for (const entry of cases) {
    const matches = detectLegacyMarkers({ artifacts: [{ path: 'docs/spec.md', selectorKind: 'design-before-hardening', selectors: [], sourceBuffer: entry.source }] }).matches;
    const result = previewLegacyMarkerDeletion({ sourceBuffer: entry.source, baselineHash: fullHash(entry.source), matches });

    assert.deepEqual(result.replacementBytes, entry.expected, entry.name);
    assert.equal(result.deletions.length, 1, entry.name);
    assert.deepEqual(result.deletions[0].rawLine, matches[0].rawLine, entry.name);
    assert.equal(result.deletions[0].ownedBlankLine !== null, entry.ownedBlank, entry.name);
  }
});

test('legacy preview rejects complete-file drift before calculating a replacement', () => {
  const original = Buffer.from('Status: signed off\n# Design\n\n## Hardening\n- revise-spec graduated 2026-08-19 03:34 at 9ebd097, scope: whole file, content: 74092a52\n');
  const matches = detectLegacyMarkers({ artifacts: [{ path: 'docs/spec.md', selectorKind: 'design-before-hardening', selectors: [], sourceBuffer: original }] }).matches;
  const drifted = [
    Buffer.from(original.toString().replace('Status: signed off\n', 'Status: signed off\r\n')),
    Buffer.from(original.toString().replace('content: 74092a52', 'content: 84092a52')),
  ];

  for (const current of drifted) {
    assert.throws(
      () => previewLegacyMarkerDeletion({ sourceBuffer: current, baselineHash: fullHash(original), matches }),
      (error) => error instanceof AgreementError && error.code === 'stale-baseline',
    );
  }
});

test('legacy preview rejects caller spans hidden inside fenced blocks', () => {
  for (const fence of ['```', '~~~']) {
    const prefix = Buffer.from(`# Design\n${fence}\n`);
    const rawLine = Buffer.from('Status: signed off\n');
    const sourceBuffer = Buffer.concat([prefix, rawLine, Buffer.from(`${fence}\n`)]);
    const matches = [{ path: 'docs/spec.md', kind: 'status', rawStart: prefix.length, rawEnd: prefix.length + rawLine.length, rawLine }];

    expectStructural(() => previewLegacyMarkerDeletion({ sourceBuffer, baselineHash: fullHash(sourceBuffer), matches }), 'hardening-grammar');
  }
});

test('legacy preview rejects hardening-refresh spans outside eligible Hardening', () => {
  const prefix = Buffer.from('# Design\n');
  const rawLine = Buffer.from('- revise-spec refreshed 2026-08-19 03:35 at 9ebd097, scope: whole file, content: 74092a52 (sign-off marker)\n');
  const sourceBuffer = Buffer.concat([prefix, rawLine]);
  const matches = [{ path: 'docs/spec.md', kind: 'hardening-refresh', rawStart: prefix.length, rawEnd: prefix.length + rawLine.length, rawLine }];

  expectStructural(() => previewLegacyMarkerDeletion({ sourceBuffer, baselineHash: fullHash(sourceBuffer), matches }), 'hardening-grammar');
});

test('legacy preview fails closed when no match can identify the artifact path', () => {
  const sourceBuffer = Buffer.from('# Design\n');

  expectStructural(() => previewLegacyMarkerDeletion({ sourceBuffer, baselineHash: fullHash(sourceBuffer), matches: [] }), 'hardening-grammar');
});

test('agreement gate never treats missing empty or internally mismatched deletion evidence as reviewed migration', () => {
  const base = gateInput();
  const malformed = {
    path: 'docs/spec.md',
    kind: 'status',
    rawStart: 0,
    rawEnd: 18,
    rawLine: Buffer.from('Status: signed off\n'),
    ownedBlankLine: null,
  };
  const wrongRawLine = {
    path: 'docs/spec.md',
    kind: 'status',
    rawStart: 0,
    rawEnd: 19,
    rawLine: Buffer.from(`${'X'.repeat(18)}\n`),
    ownedBlankLine: null,
  };

  assert.notEqual(decideAgreementGate(base).kind, 'reviewed-migration');
  assert.equal(decideAgreementGate({ ...base, legacyDeletions: [] }).kind, 'stop-error');
  assert.equal(decideAgreementGate({ ...base, legacyDeletions: [malformed] }).kind, 'stop-error');
  assert.equal(decideAgreementGate({ ...base, legacyDeletions: [wrongRawLine] }).kind, 'stop-error');
});

test('reviewed migration evidence must exactly match current detector and preview output', () => {
  const { input, deletions } = legacyMigrationFixture();
  const staleLine = Buffer.from('Status: signed off old\n');
  const stale = {
    ...deletions[0],
    rawEnd: staleLine.length,
    rawLine: staleLine,
    ownedBlankLine: { start: staleLine.length, end: staleLine.length + 1 },
  };
  const cases = [
    { name: 'missing', evidence: null },
    { name: 'partial', evidence: [deletions[0]] },
    { name: 'reordered', evidence: [deletions[1], deletions[0]] },
    { name: 'stale', evidence: [stale, deletions[1]] },
    { name: 'wrong path', evidence: [{ ...deletions[0], path: 'docs/wrong.md' }, deletions[1]] },
    { name: 'extra', evidence: [...deletions, { ...deletions[0], path: 'docs/extra.md' }] },
    { name: 'wrong blank ownership', evidence: [{ ...deletions[0], ownedBlankLine: null }, deletions[1]] },
  ];

  assert.deepEqual(decideAgreementGate(input), { kind: 'reviewed-migration', sessionState: null, digest: null, evidence: { deletions } });
  for (const entry of cases) {
    assert.equal(decideAgreementGate({ ...input, legacyDeletions: entry.evidence }).kind, 'stop-error', entry.name);
  }

  const noMarker = gateInput();
  assert.equal(decideAgreementGate({ ...noMarker, legacyDeletions: deletions }).kind, 'stop-error', 'fabricated');
});

test('large legacy marker sets stay linear and do not exceed the argument stack', () => {
  const target = scope('whole-file', 'docs/spec.md');
  const sourceBuffer = Buffer.from('Status: signed off\n'.repeat(150_000));
  const resolution = {
    kind: 'resolved',
    target,
    governingScopes: [target],
    artifacts: [{ path: target.path, selectorKind: 'design-before-hardening', selectors: [], sourceBuffer }],
  };
  const action = decideAgreementGate(gateInput({
    request: request({ target, seeds: [target] }),
    resolution,
    candidate: null,
    currentSources: null,
    acceptedDigest: 'digest-v1',
    legacyDeletions: null,
  }));

  assert.equal(action.kind, 'stop-error');
  assert.equal(action.evidence.code, 'structural-error');
});

test('legacy migration grouping stays linear across many artifacts', () => {
  const modulePath = JSON.stringify(join(__dirname, 'spec-agreement.js'));
  const probe = `
    const { decideAgreementGate } = require(${modulePath});
    const artifacts = Array.from({ length: 64_000 }, (_, index) => ({
      path: 'docs/spec-' + index + '.md',
      selectorKind: 'design-before-hardening',
      selectors: [],
      sourceBuffer: Buffer.from('Status: signed off\\n'),
    }));
    const target = { kind: 'whole-file', path: artifacts[0].path, selectors: [], workUnit: null };
    const action = decideAgreementGate({
      phase: 'lifecycle-entry',
      request: {
        mode: 'lifecycle',
        projectRoot: 'C:/repo',
        target,
        seeds: [target],
        planBuffer: null,
        selectedSliceDeclaration: null,
        allowSpecLess: false,
        allowCompletedNoOp: false,
      },
      resolution: { kind: 'resolved', target, governingScopes: [target], artifacts },
      sessionState: null,
      pendingPresentation: null,
      candidate: null,
      currentSources: null,
      acceptedDigest: 'digest-v1',
      response: null,
      fitResult: null,
      legacyDeletions: null,
    });
    if (action.kind !== 'stop-error' || action.evidence.code !== 'structural-error') {
      throw new Error(JSON.stringify(action));
    }
  `;
  const result = spawnSync(process.execPath, ['-e', probe], { encoding: 'utf8', timeout: 8000 });

  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
});

test('provenance writes first graduation into missing empty and placeholder Hardening forms', () => {
  const stamp = '- revise-spec graduated 2026-08-19 04:00 at 9ebd097, scope: whole file, content: 74092a52';
  const placeholders = [
    '- (None yet; this file has not been through a revise-spec run.)',
    '- (None yet; this file has not completed a revise-spec run.)',
    '- (None entered yet; this file has not been through a revise-spec review.)',
  ];
  const cases = [
    [Buffer.from('# Design\n'), Buffer.from(`# Design\n## Hardening\n\n${stamp}\n`), 'missing'],
    [Buffer.from('# Design\n\n## Hardening\n'), Buffer.from(`# Design\n\n## Hardening\n\n${stamp}\n`), 'empty'],
    [Buffer.from('# Design\n\n## Hardening'), Buffer.from(`# Design\n\n## Hardening\n\n${stamp}`), 'empty without terminal newline'],
    ...placeholders.map((placeholder) => [Buffer.from(`# Design\n\n## Hardening\n\n${placeholder}\n`), Buffer.from(`# Design\n\n## Hardening\n\n${stamp}\n`), placeholder]),
  ];

  for (const [initial, expected, name] of cases) {
    const artifact = mutableArtifact(initial);
    const result = writeProvenanceStamp({ projectRoot, path: 'docs/spec.md', stamp, baselineHash: fullHash(initial) }, { fsAdapter: artifact.adapter });

    assert.deepEqual(result, { bytes: expected, alreadyApplied: false }, name);
    assert.deepEqual(artifact.bytes(), expected, name);
    assert.equal(artifact.replacements().length, 1, name);
    assert.equal(artifact.replacements()[0].path, `${projectRoot}/docs/spec.md`, name);
  }
});

test('graduation after terminated design preserves candidate source bytes exactly', () => {
  const initial = Buffer.from('# Design\r\nBody\r\n');
  const stamp = '- revise-spec graduated 2026-08-19 04:00 at 9ebd097, scope: whole file, content: 74092a52';
  const artifact = mutableArtifact(initial);
  const beforeArtifact = { path: 'docs/spec.md', selectorKind: 'design-before-hardening', selectors: [], sourceBuffer: initial };
  const beforeSelection = selectArtifact(beforeArtifact);

  writeProvenanceStamp({ projectRoot, path: 'docs/spec.md', stamp, baselineHash: fullHash(initial) }, { fsAdapter: artifact.adapter });

  const afterArtifact = { ...beforeArtifact, sourceBuffer: artifact.bytes() };
  const afterSelection = selectArtifact(afterArtifact);
  assert.deepEqual(afterSelection.sourceSpans, beforeSelection.sourceSpans);
  assert.deepEqual(afterSelection.selectedBytes, beforeSelection.selectedBytes);
  assert.equal(afterSelection.sourceHash, beforeSelection.sourceHash);
});

test('later provenance is append-only for graduation refresh and completion stamps', () => {
  const existing = '- revise-spec graduated 2026-08-19 03:34 at 9ebd097, scope: whole file, content: 74092a52';
  const stamps = [
    '- revise-spec graduated 2026-08-19 04:00 at aebd097, scope: sections, content: 84092a52',
    '- revise-plan graduated 2026-08-19 04:00 at aebd097, scope: whole file, content: 84092a52',
    '- revise-spec refreshed 2026-08-19 04:01 at aebd097, scope: whole file, content: 84092a52 (clarified verification)',
    '- handover completed 2026-08-19 04:02 at aebd097, scope: whole file, content: 84092a52',
  ];

  for (const stamp of stamps) {
    const initial = Buffer.from(`# Design\r\n\r\n## Hardening\r\n\r\n${existing}\r\n`);
    const expected = Buffer.from(`${initial.toString()}${stamp}\r\n`);
    const artifact = mutableArtifact(initial);
    const result = writeProvenanceStamp({ projectRoot, path: 'docs/spec.md', stamp, baselineHash: fullHash(initial) }, { fsAdapter: artifact.adapter });

    assert.deepEqual(result, { bytes: expected, alreadyApplied: false }, stamp);
  }
});

test('plan refreshed stamps are accepted and appended after a plan graduation', () => {
  const graduated = '- revise-plan graduated 2026-08-22 09:00 at 4f2d6e2, scope: whole file, content: 74092a52';
  const refreshed = '- revise-plan refreshed 2026-08-22 09:30 at 4f2d6e2, scope: whole file, content: 84092a52 (count gate narrowed at execution)';
  const initial = Buffer.from(`# Plan\n\n## Hardening\n\n${graduated}\n`);
  const expected = Buffer.from(`${initial.toString()}${refreshed}\n`);
  const artifact = mutableArtifact(initial);

  const result = writeProvenanceStamp({ projectRoot, path: 'docs/spec.md', stamp: refreshed, baselineHash: fullHash(initial) }, { fsAdapter: artifact.adapter });

  assert.deepEqual(result, { bytes: expected, alreadyApplied: false });
  assert.deepEqual(artifact.bytes(), expected);
  const retry = writeProvenanceStamp({ projectRoot, path: 'docs/spec.md', stamp: refreshed, baselineHash: fullHash(initial) }, { fsAdapter: artifact.adapter });
  assert.deepEqual(retry, { bytes: expected, alreadyApplied: true });
});

test('the active plan is selectable with its revise-plan graduation provenance', () => {
  const selected = selectArtifact({
    path: 'docs/plan.md',
    selectorKind: 'design-before-hardening',
    selectors: [],
    sourceBuffer: Buffer.from('# Plan\n\n## Hardening\n\n- revise-plan graduated 2026-08-19 00:00 at 7aa82fe, scope: whole file, content: 00000000\n'),
  });

  assert.equal(selected.selectedBytes.length > 0, true);
});

test('a missing-section separator after unterminated design is representation-only drift', () => {
  const initial = Buffer.from('# Design');
  const stamp = '- revise-spec graduated 2026-08-19 04:00 at 9ebd097, scope: whole file, content: 74092a52';
  const artifact = mutableArtifact(initial);
  const beforeArtifact = { path: 'docs/spec.md', selectorKind: 'design-before-hardening', selectors: [], sourceBuffer: initial };
  const target = scope('whole-file', 'docs/spec.md');
  const beforeResolution = { kind: 'resolved', target, governingScopes: [target], artifacts: [beforeArtifact] };
  const before = buildCandidate({ resolution: beforeResolution, selections: [hashSelection(selectArtifact(beforeArtifact))] });

  writeProvenanceStamp({ projectRoot, path: 'docs/spec.md', stamp, baselineHash: fullHash(initial) }, { fsAdapter: artifact.adapter });

  const afterArtifact = { ...beforeArtifact, sourceBuffer: artifact.bytes() };
  const afterResolution = { ...beforeResolution, artifacts: [afterArtifact] };
  const after = buildCandidate({ resolution: afterResolution, selections: [hashSelection(selectArtifact(afterArtifact))] });
  const comparison = compareCandidates({ previousCandidate: before.candidate, currentCandidate: after.candidate });
  const diff = buildDerivedDiff({ previousCandidate: before.candidate, currentCandidate: after.candidate, previousSources: before.currentSources, currentSources: after.currentSources });

  assert.deepEqual(comparison, { kind: 'source-change', evidence: [] });
  assert.equal(diff.hunks.length, 1);
  assert.equal(diff.hunks[0].kind, 'representation-only');
});

test('provenance fails before replacement for malformed mixed nonterminal and unclosed Hardening states', () => {
  const stamp = '- revise-spec graduated 2026-08-19 04:00 at 9ebd097, scope: whole file, content: 74092a52';
  const placeholder = '- (None yet; this file has not been through a revise-spec run.)';
  const existing = '- revise-spec graduated 2026-08-19 03:34 at 9ebd097, scope: whole file, content: 74092a52';
  const cases = [
    [Buffer.from('# Design\n\n## Hardening\n\n- malformed\n'), 'structural-error', 'hardening-grammar'],
    [Buffer.from(`# Design\n\n## Hardening\n\n${placeholder}\n${existing}\n`), 'structural-error', 'hardening-grammar'],
    [Buffer.from(`# Design\n\n## Hardening\n\n${existing}\n\n## Later\nbody\n`), 'structural-error', 'hardening-grammar'],
    [Buffer.from('# Design\n```\nunclosed\n'), 'unclosed-fence-prevents-hardening-provenance', null],
  ];

  for (const [initial, code, kind] of cases) {
    const artifact = mutableArtifact(initial);
    assert.throws(
      () => writeProvenanceStamp({ projectRoot, path: 'docs/spec.md', stamp, baselineHash: fullHash(initial) }, { fsAdapter: artifact.adapter }),
      (error) => error instanceof AgreementError && error.code === code && (kind === null || error.evidence.kind === kind),
    );
    assert.equal(artifact.replacements().length, 0);
  }
});

test('provenance canonicalizes every nominated path before reading or replacing', () => {
  const initial = Buffer.from('# Design\n');
  const stamp = '- revise-spec graduated 2026-08-19 04:00 at 9ebd097, scope: whole file, content: 74092a52';
  const invalidPaths = ['C:/repo/docs/spec.md', '/repo/docs/spec.md', './docs/spec.md', 'docs/./spec.md', '../spec.md', 'docs/../spec.md', 'Docs/spec.md'];

  for (const path of invalidPaths) {
    const artifact = mutableArtifact(initial);
    assert.throws(
      () => writeProvenanceStamp({ projectRoot, path, stamp, baselineHash: fullHash(initial) }, { fsAdapter: artifact.adapter }),
      (error) => error instanceof AgreementError && error.code === 'structural-error' && ['path-casing', 'root-escape'].includes(error.evidence.kind),
      path,
    );
    assert.equal(artifact.replacements().length, 0, path);
  }

  const escaped = mutableArtifact(initial, { aliases: { [`${projectRoot}/docs/spec.md`]: 'C:/outside/spec.md' } });
  assert.throws(
    () => writeProvenanceStamp({ projectRoot, path: 'docs/spec.md', stamp, baselineHash: fullHash(initial) }, { fsAdapter: escaped.adapter }),
    (error) => error instanceof AgreementError && error.code === 'structural-error' && error.evidence.kind === 'root-escape',
  );
  assert.equal(escaped.replacements().length, 0);
});

test('atomic provenance replacement prevents torn output but does not claim concurrent-writer preservation', () => {
  const stamp = '- revise-spec graduated 2026-08-19 04:00 at 9ebd097, scope: whole file, content: 74092a52';
  const existing = '- revise-spec graduated 2026-08-19 03:34 at aebd097, scope: whole file, content: 64092a52';
  const initialStates = [
    Buffer.from('# Design\n'),
    Buffer.from('# Design\n\n## Hardening'),
    Buffer.from('# Design\n\n## Hardening\n\n- (None yet; this file has not been through a revise-spec run.)\n'),
    Buffer.from(`# Design\n\n## Hardening\n\n${existing}`),
  ];

  for (const initial of initialStates) {
    const artifact = mutableArtifact(initial, { readFailures: [undefined, new Error('readback failed')] });
    assert.throws(
      () => writeProvenanceStamp({ projectRoot, path: 'docs/spec.md', stamp, baselineHash: fullHash(initial) }, { fsAdapter: artifact.adapter }),
      (error) => error instanceof AgreementError
        && error.code === 'structural-error'
        && error.evidence.kind === 'unreadable-artifact'
        && error.evidence.operation === 'readFile'
        && error.evidence.path === `${projectRoot}/docs/spec.md`
        && error.evidence.originalMessage === 'readback failed',
    );
    const written = artifact.bytes();
    assert.equal(written.toString().split(stamp).length - 1, 1);

    const retried = writeProvenanceStamp({ projectRoot, path: 'docs/spec.md', stamp, baselineHash: fullHash(initial) }, { fsAdapter: artifact.adapter });

    assert.deepEqual(retried, { bytes: written, alreadyApplied: true });
    assert.equal(artifact.replacements().length, 1);
  }
});

test('an existing stamp with its own full-file hash is not an applied retry', () => {
  const stamp = '- revise-spec graduated 2026-08-19 04:00 at 9ebd097, scope: whole file, content: 74092a52';
  const initial = Buffer.from(`# Design\n\n## Hardening\n\n${stamp}\n`);
  const artifact = mutableArtifact(initial);

  assert.throws(
    () => writeProvenanceStamp({ projectRoot, path: 'docs/spec.md', stamp, baselineHash: fullHash(initial) }, { fsAdapter: artifact.adapter }),
    (error) => error instanceof AgreementError && error.code === 'structural-error' && error.evidence.kind === 'hardening-grammar',
  );
  assert.equal(artifact.replacements().length, 0);
});

test('provenance normalizes every atomic replacement failure at its adapter boundary', () => {
  const initial = Buffer.from('# Design\n');
  const stamp = '- revise-spec graduated 2026-08-19 04:00 at 9ebd097, scope: whole file, content: 74092a52';
  const artifact = mutableArtifact(initial);
  artifact.adapter.replaceFileAtomically = () => {
    throw new AgreementError('stale-baseline', 'inner adapter error', { hidden: true });
  };

  assert.throws(
    () => writeProvenanceStamp({ projectRoot, path: 'docs/spec.md', stamp, baselineHash: fullHash(initial) }, { fsAdapter: artifact.adapter }),
    (error) => error instanceof AgreementError
      && error.code === 'unexpected-adapter-failure'
      && error.evidence.operation === 'replaceFileAtomically'
      && error.evidence.path === `${projectRoot}/docs/spec.md`
      && error.evidence.originalMessage === 'inner adapter error',
  );
});

test('legacy migration resumes a mixed five-file worktree without rewriting completed artifacts', () => {
  const worktreePaths = [
    '.claude/features/deletion-applied.md',
    '.claude/features/already-complete.md',
    '.claude/features/untouched-one.md',
    '.claude/features/untouched-two.md',
    '.claude/features/untouched-three.md',
  ];
  const completedPath = worktreePaths[1];
  const completedDesign = Buffer.from('# Already complete\n');
  const completedFingerprint = hashSelection(selectArtifact({ path: completedPath, selectorKind: 'design-before-hardening', selectors: [], sourceBuffer: completedDesign })).contentHash.slice(0, 8);
  const files = {
    [worktreePaths[0]]: '# Deletion already applied\n\n## Hardening\n\n- revise-spec graduated 2026-08-19 01:00 at 7aa82fe, scope: whole file, content: 00000000\n',
    [completedPath]: `${completedDesign.toString()}\n## Hardening\n\n- revise-spec refreshed 2026-08-19 04:00 at 2fce9c2, scope: whole file, content: ${completedFingerprint} (legacy marker removal)\n`,
    [worktreePaths[2]]: 'Status: signed off 2026-08-15\n\n# Untouched one\n\n## Hardening\n\n- revise-spec graduated 2026-08-15 18:01 at 1a5cc8b, scope: whole file, content: b6e8b045\n',
    [worktreePaths[3]]: 'Status: signed off 2026-08-09\n\n# Untouched two\n',
    [worktreePaths[4]]: 'Status: signed off 2026-08-09\n\n# Untouched three\n',
  };
  const repository = mutableRepository(files);
  const completedBefore = repository.bytes(completedPath);
  const initialKinds = worktreePaths.map((path) => classifyMigrationArtifact(path, repository.bytes(path)).kind);

  assert.deepEqual(initialKinds, ['provenance-stale', 'complete', 'marker-present', 'marker-present', 'marker-present']);

  for (const path of worktreePaths) {
    let bytes = repository.bytes(path);
    const initial = classifyMigrationArtifact(path, bytes);
    if (initial.kind === 'marker-present') {
      const preview = previewLegacyMarkerDeletion({ sourceBuffer: bytes, baselineHash: fullHash(bytes), matches: initial.matches });
      repository.replaceReviewedBytes(path, preview.replacementBytes);
      bytes = repository.bytes(path);
    }
    const resumed = classifyMigrationArtifact(path, bytes);
    if (resumed.kind === 'complete') {
      continue;
    }
    const fingerprint = resumed.provenance.hashed.contentHash.slice(0, 8);
    const stamp = resumed.provenance.kind === 'missing'
      ? `- revise-spec graduated 2026-08-19 04:01 at 2fce9c2, scope: whole file, content: ${fingerprint}`
      : `- revise-spec refreshed 2026-08-19 04:01 at 2fce9c2, scope: whole file, content: ${fingerprint} (legacy marker removal)`;
    writeProvenanceStamp({ projectRoot, path, stamp, baselineHash: fullHash(bytes) }, { fsAdapter: repository.adapter });
  }

  assert.deepEqual(worktreePaths.map((path) => classifyMigrationArtifact(path, repository.bytes(path)).kind), ['complete', 'complete', 'complete', 'complete', 'complete']);
  assert.deepEqual(repository.bytes(completedPath), completedBefore);
  assert.equal(repository.replacements().some((replacement) => replacement.path === `${projectRoot}/${completedPath}`), false);
  const remainingMatches = detectLegacyMarkers({
    artifacts: worktreePaths.map((path) => ({ path, selectorKind: 'design-before-hardening', selectors: [], sourceBuffer: repository.bytes(path) })),
  }).matches;
  assert.deepEqual(remainingMatches, []);
});

test('accepted legacy cleanup refreshes the post-mutation handover candidate as within-contract', () => {
  const accepted = candidateFixture(legacyMigrationManifest.map((path, index) => ({ path, text: `Status: signed off 2026-08-19\n\n# Design ${index}\n` })));
  const current = candidateFixture(legacyMigrationManifest.map((path, index) => ({ path, text: `# Design ${index}\n` })));
  const acceptedDigest = 'Accepted decision: remove every legacy durable sign-off marker without adding replacement approval labels.';
  const sessionState = createAgreementState({
    acceptedDigest,
    presentedCandidate: accepted.candidate,
    responseDecision: responseDecision('agree', acceptedDigest),
    reconstructedCandidate: accepted.candidate,
    reconstructedSources: accepted.currentSources,
  });
  const comparison = compareCandidates({ previousCandidate: accepted.candidate, currentCandidate: current.candidate });
  const hunks = buildDerivedDiff({
    previousCandidate: accepted.candidate,
    currentCandidate: current.candidate,
    previousSources: accepted.currentSources,
    currentSources: current.currentSources,
  }).hunks;
  const semantic = {
    verdict: 'within-contract',
    reason: 'Every canonical hunk removes one accepted legacy durable sign-off marker and adds no replacement authority.',
    citations: hunks.map((hunk) => ({ kind: 'source', path: hunk.path, hunk: hunk.ordinal, digestFields: ['decisions', 'scope'] })),
  };
  const fitResult = validateContractFitVerdict({ comparison, hunks, semanticInput: { kind: 'json', text: JSON.stringify(semantic) } });
  const input = gateInput({
    phase: 'post-mutation',
    request: request({ mode: 'handover', target: current.candidate.target, seeds: [current.candidate.target] }),
    resolution: current.resolution,
    sessionState,
    candidate: current.candidate,
    currentSources: current.currentSources,
    acceptedDigest,
    fitResult,
  });
  const action = decideAgreementGate(input);

  assert.equal(callerMode({ phase: 'post-mutation', originatingMode: input.request.mode }), 'handover');
  assert.equal(hunks.length, legacyMigrationManifest.length);
  assert.equal(action.kind, 'continue');
  assert.deepEqual(action.sessionState.agreementRecord.acceptedCandidate, accepted.candidate);
  assert.deepEqual(action.sessionState.agreementRecord.currentCandidate, current.candidate);
  assert.deepEqual(action.sessionState.agreementRecord.currentSources, current.currentSources);
  assert.deepEqual(action.sessionState.fitEvidence, fitResult);

  const changesContract = { verdict: 'changes-contract', reason: 'A material decision changed.', citations: [semantic.citations[0]], hunkHash: fitResult.hunkHash };
  assert.equal(decideAgreementGate({ ...input, fitResult: changesContract }).kind, 'present-digest');
  const uncertain = { verdict: 'uncertain', reason: 'Containment cannot be proved.', citations: [semantic.citations[0]], hunkHash: fitResult.hunkHash };
  assert.equal(decideAgreementGate({ ...input, fitResult: uncertain }).kind, 'render-uncertain-then-present');
});

test('release-wide legacy marker migration gate', () => {
  const artifacts = activeRepositoryDesignPaths().map((path) => ({
    path,
    selectorKind: 'design-before-hardening',
    selectors: [],
    sourceBuffer: readRepositoryBytes(path),
  }));
  const markerFindings = detectLegacyMarkers({ artifacts }).matches.map((match) => {
    const rawLine = match.rawLine.toString('utf8').replace(/(?:\r\n|\r|\n)$/, '');

    return `${match.path}: ${match.kind}: ${rawLine}`;
  });
  assert.deepEqual(markerFindings, [], `legacy marker artifacts must be migrated:\n${markerFindings.join('\n')}`);

  const prohibitedInstructionPatterns = [
    ['status marker', /^Status:[ \t]+signed off(?:[ \t].*)?$/],
    ['sign-off marker instruction', /\bsign-off marker\b/i],
    ['signed-off spec instruction', /\bsigned-off spec\b/i],
    ['sign-off marker writer', /\b(?:create|write|persist|record|refresh)(?:s|ed|ing)?\b[^.]{0,160}\b(?:sign-off|signed off)\b/i],
    ['sign-off marker authority', /\b(?:trust|authorize|approve)(?:s|d|ing)?\b[^.]{0,160}\b(?:sign-off|signed off)\b/i],
    ['Status exclusion recipe', /!\/\^Status:\//],
    ['Status exclusion instruction', /(?:\bexclude(?:s|d|ing)?\s+(?:the\s+)?`?Status(?::| header| line)?|\bStatus(?: header| line|:)[^.]{0,80}\b(?:is\s+)?excluded\b)/i],
  ];
  const instructionFindings = activeInstructionPaths().flatMap((path) => {
    const lines = scanMarkdown(readRepositoryBytes(path)).lines;

    return lines.flatMap((line) => {
      if (!line.outsideFence) {
        return [];
      }

      return prohibitedInstructionPatterns
        .filter(([form, pattern]) => pattern.test(line.content) && !(form === 'Status exclusion instruction' && /\bnever excluded\b/i.test(line.content)))
        .map(([form]) => `${path}: ${form}: ${line.content}`);
    });
  });
  assert.deepEqual(instructionFindings, [], `active instructions must not recreate durable sign-off authority:\n${instructionFindings.join('\n')}`);

  for (const path of legacyMigrationManifest) {
    const provenance = terminalProvenance(path, readRepositoryBytes(path));
    assert.equal(provenance.actualFingerprint, provenance.expectedFingerprint, `${path} terminal provenance must match current design bytes`);
  }
});

test('gate applies the shared request invariant before terminal dispatch', () => {
  const action = decideAgreementGate(gateInput({
    request: request({ mode: 'planning', allowSpecLess: true, allowCompletedNoOp: true }),
    resolution: { kind: 'not-applicable', target: null, governingScopes: [], artifacts: [] },
    candidate: null,
    currentSources: null,
  }));

  assert.equal(action.kind, 'stop-error');
  assert.equal(action.evidence.code, 'structural-error');
});

test('ready-backed index selection ends at a level-one heading', () => {
  const sourceBuffer = Buffer.from('## Parent\n\n### Entry\n\ninside\n\n# Root\n\noutside\n');
  const selected = selectArtifact({
    path: '.claude/FEATURES.md',
    selectorKind: 'index-entry',
    selectors: [{ parentHeading: '## Parent', entryHeading: '### Entry' }],
    sourceBuffer,
  }).selectedBytes.toString('utf8');

  assert.equal(selected.includes('# Root'), false);
  assert.equal(selected.includes('outside'), false);
});

test('gate rejects a candidate whose resolved source bytes changed', () => {
  const oldFixture = candidateFixture([{ path: 'docs/spec.md', text: '# Spec\nold\n' }]);
  const newFixture = candidateFixture([{ path: 'docs/spec.md', text: '# Spec\nnew\n' }]);
  const action = decideAgreementGate(gateInput({
    request: request({ target: oldFixture.candidate.target, seeds: [oldFixture.candidate.target] }),
    resolution: newFixture.resolution,
    pendingPresentation: { digest: 'digest-v1', candidate: oldFixture.candidate, currentSources: oldFixture.currentSources },
    candidate: oldFixture.candidate,
    currentSources: oldFixture.currentSources,
    response: responseDecision('agree'),
  }));

  assert.equal(action.kind, 'stop-error');
});

test('large sparse edits preserve disjoint shortest-edit hunk boundaries with bounded memory', () => {
  const modulePath = join(__dirname, 'spec-agreement.js');
  const probe = `
    const api = require(${JSON.stringify(modulePath)});
    const make = (lines) => {
      const sourceBuffer = Buffer.from(lines.join(''));
      const target = { kind: 'whole-file', path: 'docs/spec.md', selectors: [], workUnit: null };
      const artifact = { path: target.path, selectorKind: 'design-before-hardening', selectors: [], sourceBuffer };
      const selection = api.hashSelection(api.selectArtifact(artifact));
      return api.buildCandidate({ resolution: { kind: 'resolved', target, governingScopes: [target], artifacts: [artifact] }, selections: [selection] });
    };
    const beforeLines = Array.from({ length: 2000 }, (_, index) => 'line-' + index + '\\n');
    const afterLines = [...beforeLines];
    afterLines[0] = 'changed-first\\n';
    afterLines[1999] = 'changed-last\\n';
    const before = make(beforeLines);
    const after = make(afterLines);
    const result = api.buildDerivedDiff({ previousCandidate: before.candidate, currentCandidate: after.candidate, previousSources: before.currentSources, currentSources: after.currentSources });
    process.stdout.write(JSON.stringify(result.hunks.map((hunk) => [hunk.before, hunk.after])));
  `;
  const result = spawnSync(process.execPath, ['--max-old-space-size=128', '-e', probe], { encoding: 'utf8', timeout: 30000 });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [['line-0\n', 'changed-first\n'], ['line-1999\n', 'changed-last\n']]);
});

test('large complete replacements produce a bounded derived diff', () => {
  const modulePath = join(__dirname, 'spec-agreement.js');
  const probe = `
    const api = require(${JSON.stringify(modulePath)});
    const make = (label) => {
      const sourceBuffer = Buffer.from(Array.from({ length: 4000 }, (_, index) => label + index + '\\n').join(''));
      const target = { kind: 'whole-file', path: 'docs/spec.md', selectors: [], workUnit: null };
      const artifact = { path: target.path, selectorKind: 'design-before-hardening', selectors: [], sourceBuffer };
      const selection = api.hashSelection(api.selectArtifact(artifact));
      const built = api.buildCandidate({ resolution: { kind: 'resolved', target, governingScopes: [target], artifacts: [artifact] }, selections: [selection] });
      return built;
    };
    const before = make('before-');
    const after = make('after-');
    const result = api.buildDerivedDiff({ previousCandidate: before.candidate, currentCandidate: after.candidate, previousSources: before.currentSources, currentSources: after.currentSources });
    process.stdout.write(String(result.hunks.length));
  `;
  const result = spawnSync(process.execPath, ['--max-old-space-size=128', '-e', probe], { encoding: 'utf8', timeout: 30000 });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '1');
});

test('large asymmetric replacements produce a bounded derived diff', () => {
  const modulePath = join(__dirname, 'spec-agreement.js');
  const probe = `
    const api = require(${JSON.stringify(modulePath)});
    const make = (sourceBuffer) => {
      const target = { kind: 'whole-file', path: 'docs/spec.md', selectors: [], workUnit: null };
      const artifact = { path: target.path, selectorKind: 'design-before-hardening', selectors: [], sourceBuffer };
      const selection = api.hashSelection(api.selectArtifact(artifact));
      return api.buildCandidate({ resolution: { kind: 'resolved', target, governingScopes: [target], artifacts: [artifact] }, selections: [selection] });
    };
    const before = make(Buffer.from('before\\n'));
    const after = make(Buffer.from(Array.from({ length: 200000 }, (_, index) => 'after-' + index + '\\n').join('')));
    const result = api.buildDerivedDiff({ previousCandidate: before.candidate, currentCandidate: after.candidate, previousSources: before.currentSources, currentSources: after.currentSources });
    process.stdout.write(String(result.hunks.length));
  `;
  const result = spawnSync(process.execPath, ['--max-old-space-size=128', '-e', probe], { encoding: 'utf8', timeout: 30000 });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '1');
});

test('governing resolution reads only the validated real target', () => {
  const base = fakeRepository({ 'docs/spec.md': '# Spec\n' });
  const realPath = `${projectRoot}/resolved/spec.md`;
  const reads = [];
  const fsAdapter = {
    readFile: (path) => {
      reads.push(path);
      if (path !== realPath) {
        throw new Error(`unvalidated read ${path}`);
      }

      return Buffer.from('# Spec\n');
    },
    readDirectory: base.readDirectory,
    realpath: (path) => path === `${projectRoot}/docs/spec.md` ? realPath : path,
    replaceFileAtomically: base.replaceFileAtomically,
  };
  const target = scope('whole-file', 'docs/spec.md');
  const resolution = resolveGoverningSet(request({ target, seeds: [target] }), { fsAdapter, readyParser });

  assert.equal(resolution.kind, 'resolved');
  assert.equal(reads.length > 0, true);
  assert.equal(reads.every((path) => path === realPath), true);
});

test('post-mutation engine path is rooted in the installed plugin', () => {
  const engine = readRepositoryFile('internal/revise/SKILL.md');

  assert.equal(engine.includes('Invoke `${CLAUDE_PLUGIN_ROOT}/skills/spec-agreement/SKILL.md` in `post-mutation` phase'), true);
});

test('selector validation and artifact selection share their selector resolvers', () => {
  const controller = readRepositoryFile('skills/spec-agreement/spec-agreement.js');

  assert.equal(countExact(controller, 'function resolveReadyEntry('), 1);
  assert.equal(countExact(controller, 'resolveReadyEntry(lines, selectorKind, selector)'), 2);
  assert.equal(countExact(controller, 'function resolveSectionSelectors('), 1);
  assert.equal(countExact(controller, 'resolveSectionSelectors('), 3);
});

test('production provenance replacement preserves restrictive permissions', { skip: process.platform === 'win32' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'nightshift-mode-'));
  const path = join(root, 'spec.md');
  const initial = Buffer.from('# Spec\n');
  try {
    writeFileSync(path, initial);
    chmodSync(path, 0o600);
    const result = runCli({
      requestText: JSON.stringify({
        operation: 'provenance-write',
        input: {
          projectRoot: root,
          path: 'spec.md',
          stamp: '- revise-spec graduated 2026-08-19 04:00 at abcdef0, scope: whole file, content: 1234abcd',
          baselineHash: fullHash(initial),
        },
      }),
    });

    assert.equal(result.exitCode, 0, result.outputText);
    assert.equal(statSync(path).mode & 0o777, 0o600);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
