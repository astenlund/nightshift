'use strict'

const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { readFileSync, readdirSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')

const MAX_PRESENTATION_CANONICAL_BYTES = 320000
const MAX_HOST_EVENT_FRAME_BYTES = 262144
const MAX_HOST_LINE_BYTES = 4194304

const HOST_FIXTURE_DIRECTORY = 'tests/fixtures/init-backlog-host'
const IMPORT_FIXTURE_DIRECTORY = 'tests/fixtures/init-backlog-import'
const EVAL_FIXTURE_DIRECTORY = 'tests/fixtures/init-backlog-eval'
const TURN_SCHEMA_PATH = `${EVAL_FIXTURE_DIRECTORY}/turn.schema.json`

const SCENARIO_IDS = [
  'existing-ambiguous-unavailable',
  'existing-drift-approved-failure',
  'existing-enriched-denied',
  'existing-legacy-history-approved',
  'existing-stale-manifest-deferred',
  'existing-wrapped-auto-denied',
  'fresh-empty-track-approved',
  'fresh-host-config-track-approved',
  'fresh-plans-only-election-deferred-approved',
  'fresh-structural-ignore-approved',
]

const COMMITTED_FIXTURE_LEAVES = [
  TURN_SCHEMA_PATH,
  `${EVAL_FIXTURE_DIRECTORY}/controller-proxy.js`,
  `${HOST_FIXTURE_DIRECTORY}/manifest.json`,
  ...SCENARIO_IDS.map((scenarioId) => `${HOST_FIXTURE_DIRECTORY}/scenarios/${scenarioId}.json`),
  `${IMPORT_FIXTURE_DIRECTORY}/cases.json`,
  `${IMPORT_FIXTURE_DIRECTORY}/compatibility.json`,
]

const CLOSED_FUTURE_FIXTURE_LEAVES = [...COMMITTED_FIXTURE_LEAVES]

const INITIAL_PROMPT = 'Initialize the Nightshift backlog for this repository.'
const APPROVAL_RESPONSES = { approved: 'Approve this manifest.', denied: 'Do not apply this manifest.', deferred: 'Defer this manifest.' }
const HOST_CONTROL_RECORDS = {
  autoDenied: '[nightshift-eval-host-control] manifest approval was auto-denied without a user decision.',
  disclosureAcknowledgement: '[nightshift-eval-host-control] disclosure recorded; continue.',
  unavailable: '[nightshift-eval-host-control] no user response is available.',
}
const CODEX_HOST_CONTEXT_CONFIRMATION = 'Confirm fixed guidance candidates AGENTS.override.md and AGENTS.md, no additional fallback guidance names, project_doc_max_bytes 32768, no project_doc_fallback_filenames override, and invocation directory repository root (.).'
const CLAUDE_ROOT_EXCLUSION_CONFIRMATION = 'Confirm that no effective claudeMdExcludes pattern matches the future root CLAUDE.md path shown above.'
const RESERVED_GATE_IDS = ['host-context-confirmation', 'claude-root-exclusion-confirmation', 'action-disclosure', 'manifest-approval']
const BREAKOUT_DIGEST_NOTICE = 'Decoded before and after images are withheld for mechanical breakout unwrap.'

const ENTRYPOINTS = { 'claude-code': '/nightshift:init-backlog', codex: '$nightshift:init-backlog' }
const ENVELOPE_INSTRUCTIONS = [
  'Invoke the entrypoint.',
  'Route every controller call through controllerProxy.',
  'At each user or manifest decision boundary, emit one turnSchema object and stop.',
  'Emit only the turnSchema object; put every presented carrier in its presentation field.',
]

const HOST_CONTEXTS = {
  claudeMissingRoot: { claudeContextSource: 'user-confirmed', claudeRootExclusionStatus: 'unexcluded-missing', codexContextSource: null, codexInvocationDirectory: null, codexProjectDocMaxBytes: null, codexProjectInstructions: [] },
  claudePresentRoot: { claudeContextSource: 'host-observed', claudeRootExclusionStatus: 'included', codexContextSource: null, codexInvocationDirectory: null, codexProjectDocMaxBytes: null, codexProjectInstructions: [] },
  codex: { claudeContextSource: null, claudeRootExclusionStatus: null, codexContextSource: 'user-confirmed', codexInvocationDirectory: '.', codexProjectDocMaxBytes: 32768, codexProjectInstructions: [] },
}

const QUICK_WINS_CONCEPTS = [
  'quick-wins.active-themed-inline',
  'quick-wins.capture-shorthand',
  'quick-wins.history-archive',
  'quick-wins.index-on-demand',
  'quick-wins.line-discipline',
  'quick-wins.negative-knowledge-promotion',
  'quick-wins.ready-after-add',
  'quick-wins.stable-entry-anchors',
]
const FEATURES_CONCEPTS = [
  'features.dependency-grammar',
  'features.entry-grammar',
  'features.exploring-drafts',
  'features.history-archive',
  'features.index-on-demand',
  'features.informal-partial-progress',
  'features.line-discipline',
  'features.ready-after-add-or-graduate',
  'features.slicing',
]
const SEMANTIC_TARGET_CONCEPTS = { '.claude/FEATURES.md': FEATURES_CONCEPTS, '.claude/QUICK_WINS.md': QUICK_WINS_CONCEPTS }

const ELECTION_MARKER_PATH = '.nightshift-init-backlog-election'
const GUIDANCE_SCENARIO_IDS = [
  'existing-legacy-history-approved',
  'fresh-empty-track-approved',
  'fresh-host-config-track-approved',
  'fresh-plans-only-election-deferred-approved',
  'fresh-structural-ignore-approved',
]

const BACKLOG_TEMPLATE_TARGETS = [
  ['.claude/BUGS.md', 'backlog.bugs'],
  ['.claude/BUGS_HISTORY.md', 'backlog.bugs-history'],
  ['.claude/FEATURES.md', 'backlog.features'],
  ['.claude/FEATURES_HISTORY.md', 'backlog.features-history'],
  ['.claude/PATTERNS.md', 'backlog.patterns'],
  ['.claude/QUICK_WINS.md', 'backlog.quick-wins'],
  ['.claude/QUICK_WINS_HISTORY.md', 'backlog.quick-wins-history'],
]
const CLAUDE_DIRECTORIES = ['.claude', '.claude/bugs', '.claude/features', '.claude/patterns', '.claude/plans']

const HEX64_PATTERN = /^[0-9a-f]{64}$/
const ACTION_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const WHITESPACE_CODE_POINTS = [0x0009, 0x000b, 0x000c, 0x0020, 0x00a0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x202f, 0x205f, 0x3000, 0xfeff, 0x000a, 0x000d, 0x2028, 0x2029]

const LIST_SEPARATOR = String.fromCharCode(0)

function compareOrdinal(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize)
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort(compareOrdinal).map((key) => [key, canonicalize(value[key])]))
  }

  return value
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value))
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function utf8ByteLength(text) {
  return Buffer.byteLength(text, 'utf8')
}

function isCanonicalBase64(value) {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return false
  }

  return Buffer.from(value, 'base64').toString('base64') === value
}

function hasExactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort(compareOrdinal).join(LIST_SEPARATOR) === [...keys].sort(compareOrdinal).join(LIST_SEPARATOR)
}

function requireExactKeys(value, keys, label) {
  if (!hasExactKeys(value, keys)) {
    throw new Error(`${label} must carry exactly the keys ${JSON.stringify([...keys].sort(compareOrdinal))}`)
  }
}

function isOrdinalSortedUnique(values) {
  return values.every((value, index) => index === 0 || compareOrdinal(values[index - 1], value) < 0)
}

function readCanonicalFixture(absolutePath) {
  const bytes = readFileSync(absolutePath)
  if (bytes.length === 0 || bytes[bytes.length - 1] !== 0x0a) {
    throw new Error(`Fixture must end with one LF: ${absolutePath}`)
  }
  if (bytes.includes(0x0d)) {
    throw new Error(`Fixture must not contain carriage returns: ${absolutePath}`)
  }
  for (const byte of bytes) {
    if (byte !== 0x0a && (byte < 0x20 || byte > 0x7e)) {
      throw new Error(`Fixture must be pure ASCII: ${absolutePath}`)
    }
  }
  const text = bytes.toString('utf8')
  const object = JSON.parse(text)
  if (text !== canonicalJson(object) + '\n') {
    throw new Error(`Fixture is not protocol-canonical JSON plus one LF: ${absolutePath}`)
  }

  return { bytes, object }
}

function loadTemplateCompositions(repositoryRoot) {
  const templatesRoot = join(repositoryRoot, 'skills', 'init-backlog', 'templates')
  const manifest = JSON.parse(readFileSync(join(templatesRoot, 'manifest.json'), 'utf8'))
  const assets = new Map()
  for (const asset of manifest.assets) {
    const raw = readFileSync(join(templatesRoot, asset.path))
    const normalized = Buffer.from(raw.toString('utf8').split('\r\n').join('\n'), 'utf8')
    assert.equal(normalized.includes(0x0d), false, `template asset must normalize to LF: ${asset.path}`)
    assert.equal(sha256(normalized), asset.logicalSha256, `template asset bytes must match the pinned logical digest: ${asset.path}`)
    assets.set(asset.assetId, normalized)
  }
  const compositions = new Map()
  for (const template of manifest.templates) {
    compositions.set(template.templateId, Buffer.concat(template.assetIds.map((assetId) => assets.get(assetId))))
  }
  compositions.set('asset:gitignore.plans', assets.get('gitignore.plans'))
  compositions.set('asset:gitignore.backlog', assets.get('gitignore.backlog'))

  return compositions
}

function enrichedImage(template) {
  return Buffer.concat([template, Buffer.from('\n## Local\n\nProject note.\n', 'utf8')])
}

function staleImage(template) {
  const lines = template.toString('utf8').split('\n')
  const matches = lines.filter((line) => line.startsWith('**After adding a new entry, run'))
  assert.equal(matches.length, 1, 'the quick-wins template must contain exactly one STALE anchor line')

  return Buffer.from(lines.filter((line) => !line.startsWith('**After adding a new entry, run')).join('\n'), 'utf8')
}

function wrappedImage(template) {
  return Buffer.concat([template, Buffer.from('\n## Evaluation\n\n- A deliberately wrapped fixture line\n  whose continuation is joined.\n', 'utf8')])
}

function legacyImage(template) {
  return Buffer.concat([template, Buffer.from('\n## Implemented\n\n- Legacy shipped item.\n', 'utf8')])
}

const AMBIGUOUS_IMAGE = Buffer.from('# Quick wins\n\nUse this project-specific queue.\n', 'utf8')
const DRIFT_IMAGE = Buffer.from('drift\n', 'utf8')

function directoryEntry(path) {
  return { contentBase64: null, kind: 'directory', mode: 493, path }
}

function fileEntry(path, bytes) {
  return { contentBase64: bytes.toString('base64'), kind: 'file', mode: 420, path }
}

function repositoryImage(entries, gitKind, trackedPaths) {
  return { entries: [...entries].sort((left, right) => compareOrdinal(left.path, right.path)), git: { kind: gitKind, trackedPaths: [...trackedPaths].sort(compareOrdinal) } }
}

function scaffoldFiles(compositions) {
  return BACKLOG_TEMPLATE_TARGETS.map(([path, templateId]) => fileEntry(path, compositions.get(templateId)))
}

function noneOracles(approvalBranch, terminalRepositories) {
  return { approvalBranch, semanticActionDispositions: [], semanticClassifications: [], semanticDecisions: [], semanticRepairOracles: [], terminalRepositories }
}

function completeOracles(target, conceptRow, approvalBranch, terminalRepositories) {
  return {
    approvalBranch,
    semanticActionDispositions: [{ disposition: 'none', target }],
    semanticClassifications: [{ conceptIds: [], status: 'complete', target }],
    semanticDecisions: [{ conceptIds: conceptRow, status: 'satisfied', target }],
    semanticRepairOracles: [],
    terminalRepositories,
  }
}

const WINDOWS_LIVE_PLATFORM_EOL = 'crlf'

function materializeWindowsLivePlatformEol(bytes) {
  assert.equal(WINDOWS_LIVE_PLATFORM_EOL, 'crlf')

  return Buffer.from(bytes.toString('utf8').split('\n').join('\r\n'), 'utf8')
}

function terminalMember(base, { guidance = null, marker = null } = {}) {
  return {
    base,
    hostEntries: guidance === null
      ? { 'claude-code': [], codex: [] }
      : { 'claude-code': [fileEntry('CLAUDE.md', guidance.claude)], codex: [fileEntry('AGENTS.md', guidance.codex)] },
    marker,
  }
}

function buildExpectedScenarios(repositoryRoot) {
  const compositions = loadTemplateCompositions(repositoryRoot)
  const guidance = { claude: compositions.get('guidance.claude'), codex: compositions.get('guidance.codex') }
  const platformEolGuidance = { claude: materializeWindowsLivePlatformEol(guidance.claude), codex: materializeWindowsLivePlatformEol(guidance.codex) }
  const quickWinsTemplate = compositions.get('backlog.quick-wins')
  const featuresTemplate = compositions.get('backlog.features')
  const plansIgnore = compositions.get('asset:gitignore.plans')
  const backlogIgnore = compositions.get('asset:gitignore.backlog')
  const stale = staleImage(quickWinsTemplate)
  const legacy = legacyImage(quickWinsTemplate)
  const claudeDirectories = CLAUDE_DIRECTORIES.map(directoryEntry)
  const backlogFiles = scaffoldFiles(compositions)
  const inFlightPlan = fileEntry('.claude/plans/in-flight.md', Buffer.from('# In flight\n', 'utf8'))
  const hostSettings = fileEntry('.claude/settings.local.json', Buffer.from('{}\n', 'utf8'))
  const conversation = (preApprovalTurns, approvalBranch, faultSchedule = 'none') => ({
    approvalResponse: approvalBranch === 'unavailable' || approvalBranch === 'auto-denied' ? null : APPROVAL_RESPONSES[approvalBranch],
    faultSchedule,
    hostOutcome: approvalBranch === 'unavailable' || approvalBranch === 'auto-denied' ? approvalBranch : 'none',
    initialPrompt: INITIAL_PROMPT,
    preApprovalTurns,
  })
  const trackTurn = [{ gateId: 'version-control-choice', response: 'Track the non-plan backlog files.' }]
  const ignoreTurn = [{ gateId: 'version-control-choice', response: 'Ignore the non-plan backlog files.' }]
  const deferTurn = [{ gateId: 'version-control-choice', response: 'Defer the non-plan backlog choice.' }]
  const scenarios = new Map()
  const addScenario = (scenarioId, repository, conversationValue, oracles) => {
    scenarios.set(scenarioId, { conversation: conversationValue, oracles, repository, scenarioId, schemaVersion: 1 })
  }

  addScenario(
    'fresh-empty-track-approved',
    repositoryImage([], 'git', []),
    conversation(trackTurn, 'approved'),
    noneOracles('approved', {
      disabled: terminalMember(repositoryImage([...claudeDirectories, ...backlogFiles], 'git', []), { guidance }),
      enabled: terminalMember(repositoryImage([...claudeDirectories, ...backlogFiles, fileEntry('.gitignore', plansIgnore)], 'git', []), { guidance }),
    }),
  )
  addScenario(
    'fresh-structural-ignore-approved',
    repositoryImage(claudeDirectories, 'git', []),
    conversation(ignoreTurn, 'approved'),
    noneOracles('approved', {
      disabled: terminalMember(repositoryImage([...claudeDirectories, ...backlogFiles, fileEntry('.gitignore', Buffer.concat([backlogIgnore, plansIgnore]))], 'git', []), { guidance }),
      enabled: terminalMember(repositoryImage([...claudeDirectories, ...backlogFiles, fileEntry('.gitignore', Buffer.concat([plansIgnore, backlogIgnore]))], 'git', []), { guidance }),
    }),
  )
  addScenario(
    'fresh-plans-only-election-deferred-approved',
    repositoryImage([directoryEntry('.claude'), directoryEntry('.claude/plans'), inFlightPlan], 'git', ['.claude/plans/in-flight.md']),
    conversation(deferTurn, 'approved'),
    noneOracles('approved', {
      disabled: terminalMember(repositoryImage([...claudeDirectories, ...backlogFiles, inFlightPlan], 'git', ['.claude/plans/in-flight.md']), { guidance }),
      enabled: terminalMember(repositoryImage([...claudeDirectories, ...backlogFiles, inFlightPlan, fileEntry('.gitignore', plansIgnore)], 'git', ['.claude/plans/in-flight.md']), { guidance, marker: { state: 'deferred' } }),
    }),
  )
  addScenario(
    'fresh-host-config-track-approved',
    repositoryImage([directoryEntry('.claude'), hostSettings], 'git', []),
    conversation(trackTurn, 'approved'),
    noneOracles('approved', {
      disabled: terminalMember(repositoryImage([...claudeDirectories, ...backlogFiles, hostSettings], 'git', []), { guidance }),
      enabled: terminalMember(repositoryImage([...claudeDirectories, ...backlogFiles, hostSettings, fileEntry('.gitignore', plansIgnore)], 'git', []), { guidance }),
    }),
  )
  const enrichedRepository = repositoryImage([directoryEntry('.claude'), fileEntry('.claude/QUICK_WINS.md', enrichedImage(quickWinsTemplate))], 'non-git', [])
  addScenario(
    'existing-enriched-denied',
    enrichedRepository,
    conversation([], 'denied'),
    completeOracles('.claude/QUICK_WINS.md', QUICK_WINS_CONCEPTS, 'denied', { disabled: terminalMember(enrichedRepository), enabled: terminalMember(enrichedRepository) }),
  )
  const staleRepository = repositoryImage([directoryEntry('.claude'), fileEntry('.claude/QUICK_WINS.md', stale)], 'non-git', [])
  addScenario(
    'existing-stale-manifest-deferred',
    staleRepository,
    conversation([{ gateId: 'semantic-.claude/QUICK_WINS.md', response: 'Apply the exact repair.' }], 'deferred'),
    {
      approvalBranch: 'deferred',
      semanticActionDispositions: [{ disposition: 'approved-repair', target: '.claude/QUICK_WINS.md' }],
      semanticClassifications: [{ conceptIds: ['quick-wins.ready-after-add'], status: 'missing-concepts', target: '.claude/QUICK_WINS.md' }],
      semanticDecisions: [{ conceptIds: QUICK_WINS_CONCEPTS, status: 'satisfied', target: '.claude/QUICK_WINS.md' }],
      semanticRepairOracles: [{
        actions: [{ afterBase64: quickWinsTemplate.toString('base64'), beforeBase64: stale.toString('base64'), kind: 'exact-edit', regionId: 'quick-wins.document-preamble', target: '.claude/QUICK_WINS.md' }],
        resolvedConceptIds: ['quick-wins.ready-after-add'],
        target: '.claude/QUICK_WINS.md',
      }],
      terminalRepositories: { disabled: terminalMember(staleRepository), enabled: terminalMember(staleRepository) },
    },
  )
  const ambiguousRepository = repositoryImage([directoryEntry('.claude'), fileEntry('.claude/QUICK_WINS.md', AMBIGUOUS_IMAGE)], 'non-git', [])
  addScenario(
    'existing-ambiguous-unavailable',
    ambiguousRepository,
    conversation([{ gateId: 'semantic-.claude/QUICK_WINS.md', response: 'Leave it unresolved.' }], 'unavailable'),
    {
      approvalBranch: 'unavailable',
      semanticActionDispositions: [{ disposition: 'deferred-repair', target: '.claude/QUICK_WINS.md' }],
      semanticClassifications: [{ conceptIds: QUICK_WINS_CONCEPTS, status: 'ambiguous', target: '.claude/QUICK_WINS.md' }],
      semanticDecisions: [{ conceptIds: QUICK_WINS_CONCEPTS, status: 'deferred', target: '.claude/QUICK_WINS.md' }],
      semanticRepairOracles: [],
      terminalRepositories: { disabled: terminalMember(ambiguousRepository), enabled: terminalMember(ambiguousRepository) },
    },
  )
  const wrappedRepository = repositoryImage([directoryEntry('.claude'), fileEntry('.claude/FEATURES.md', wrappedImage(featuresTemplate))], 'non-git', [])
  addScenario(
    'existing-wrapped-auto-denied',
    wrappedRepository,
    conversation([], 'auto-denied'),
    completeOracles('.claude/FEATURES.md', FEATURES_CONCEPTS, 'auto-denied', { disabled: terminalMember(wrappedRepository), enabled: terminalMember(wrappedRepository) }),
  )
  const driftInitial = repositoryImage([directoryEntry('.claude'), fileEntry('.claude/QUICK_WINS.md', quickWinsTemplate)], 'git', [])
  const driftTerminal = repositoryImage([...driftInitial.entries, fileEntry('.claude/FEATURES.md', DRIFT_IMAGE)], 'git', [])
  addScenario(
    'existing-drift-approved-failure',
    driftInitial,
    conversation([], 'approved', 'after-approval-create-features'),
    noneOracles('approved', { disabled: terminalMember(driftTerminal), enabled: terminalMember(driftTerminal) }),
  )
  const legacyEntry = fileEntry('.claude/QUICK_WINS.md', legacy)
  const legacyInitial = repositoryImage([directoryEntry('.claude'), legacyEntry], 'non-git', [])
  const legacyScaffold = backlogFiles.filter((entry) => entry.path !== '.claude/QUICK_WINS.md')
  const legacyTerminal = repositoryImage([...claudeDirectories, ...legacyScaffold, legacyEntry], 'non-git', [])
  addScenario(
    'existing-legacy-history-approved',
    legacyInitial,
    conversation([], 'approved'),
    completeOracles('.claude/QUICK_WINS.md', QUICK_WINS_CONCEPTS, 'approved', { disabled: terminalMember(legacyTerminal, { guidance: platformEolGuidance }), enabled: terminalMember(legacyTerminal, { guidance: platformEolGuidance }) }),
  )
  assert.deepEqual([...scenarios.keys()].sort(compareOrdinal), SCENARIO_IDS)

  return scenarios
}

function validateRepositoryObject(repository, label) {
  requireExactKeys(repository, ['entries', 'git'], label)
  if (!Array.isArray(repository.entries)) {
    throw new Error(`${label}.entries must be an array`)
  }
  const paths = repository.entries.map((entry) => entry.path)
  if (!isOrdinalSortedUnique(paths)) {
    throw new Error(`${label}.entries must be duplicate-free and ordinal-path sorted`)
  }
  const directories = new Set()
  for (const entry of repository.entries) {
    requireExactKeys(entry, ['contentBase64', 'kind', 'mode', 'path'], `${label} entry`)
    if (typeof entry.path !== 'string' || entry.path === '' || entry.path.startsWith('/') || entry.path.includes('\\') || entry.path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
      throw new Error(`${label} entry path is not confined: ${entry.path}`)
    }
    const parent = entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : null
    if (parent !== null && !directories.has(parent)) {
      throw new Error(`${label} entry parent must precede child: ${entry.path}`)
    }
    if (entry.kind === 'directory') {
      if (entry.contentBase64 !== null || entry.mode !== 493) {
        throw new Error(`${label} directory entry is malformed: ${entry.path}`)
      }
      directories.add(entry.path)
    } else if (entry.kind === 'file') {
      if (!isCanonicalBase64(entry.contentBase64) || entry.mode !== 420) {
        throw new Error(`${label} file entry is malformed: ${entry.path}`)
      }
    } else {
      throw new Error(`${label} entry kind is invalid: ${entry.path}`)
    }
  }
  requireExactKeys(repository.git, ['kind', 'trackedPaths'], `${label}.git`)
  if (repository.git.kind !== 'git' && repository.git.kind !== 'non-git') {
    throw new Error(`${label}.git.kind is invalid`)
  }
  if (!Array.isArray(repository.git.trackedPaths) || !isOrdinalSortedUnique(repository.git.trackedPaths)) {
    throw new Error(`${label}.git.trackedPaths must be a duplicate-free ordinal-sorted array`)
  }
  const filePaths = new Set(repository.entries.filter((entry) => entry.kind === 'file').map((entry) => entry.path))
  for (const tracked of repository.git.trackedPaths) {
    if (!filePaths.has(tracked)) {
      throw new Error(`${label}.git.trackedPaths must be a subset of file entry paths: ${tracked}`)
    }
  }
  if (repository.git.kind === 'non-git' && repository.git.trackedPaths.length > 0) {
    throw new Error(`${label}.git non-Git image requires an empty tracked array`)
  }
}

function validateSemanticOracles(oracles, repository, label) {
  const classificationTargets = oracles.semanticClassifications.map((item) => item.target)
  if (!isOrdinalSortedUnique(classificationTargets)) {
    throw new Error(`${label}.semanticClassifications must be duplicate-free and ordinal-target sorted`)
  }
  const fileImages = new Map(repository.entries.filter((entry) => entry.kind === 'file').map((entry) => [entry.path, entry.contentBase64]))
  const byTarget = new Map()
  for (const item of oracles.semanticClassifications) {
    requireExactKeys(item, ['conceptIds', 'status', 'target'], `${label} classification`)
    if (!['complete', 'missing-concepts', 'ambiguous'].includes(item.status)) {
      throw new Error(`${label} classification status is invalid`)
    }
    if (!Array.isArray(item.conceptIds) || !isOrdinalSortedUnique(item.conceptIds)) {
      throw new Error(`${label} classification conceptIds must be ordinal sorted and duplicate-free`)
    }
    if (item.status === 'complete' ? item.conceptIds.length !== 0 : item.conceptIds.length === 0) {
      throw new Error(`${label} classification conceptIds cardinality contradicts its status`)
    }
    if (!fileImages.has(item.target)) {
      throw new Error(`${label} classification target must be a fixture file: ${item.target}`)
    }
    byTarget.set(item.target, { classification: item })
  }
  if (oracles.semanticDecisions.length !== oracles.semanticClassifications.length || oracles.semanticActionDispositions.length !== oracles.semanticClassifications.length) {
    throw new Error(`${label} semantic decision and disposition arrays must cover exactly the classified targets`)
  }
  for (const item of oracles.semanticDecisions) {
    requireExactKeys(item, ['conceptIds', 'status', 'target'], `${label} decision`)
    if (!['satisfied', 'deferred'].includes(item.status) || !byTarget.has(item.target)) {
      throw new Error(`${label} decision is invalid for ${item.target}`)
    }
    const row = SEMANTIC_TARGET_CONCEPTS[item.target]
    if (item.status === 'satisfied' && (row === undefined || item.conceptIds.join(LIST_SEPARATOR) !== row.join(LIST_SEPARATOR))) {
      throw new Error(`${label} satisfied decision must carry the complete concept row for ${item.target}`)
    }
    byTarget.get(item.target).decision = item
  }
  for (const item of oracles.semanticActionDispositions) {
    requireExactKeys(item, ['disposition', 'target'], `${label} disposition`)
    if (!['none', 'approved-repair', 'partial-repair', 'deferred-repair'].includes(item.disposition) || !byTarget.has(item.target)) {
      throw new Error(`${label} disposition is invalid for ${item.target}`)
    }
    byTarget.get(item.target).disposition = item.disposition
  }
  const repairTargets = oracles.semanticRepairOracles.map((item) => item.target)
  if (!isOrdinalSortedUnique(repairTargets)) {
    throw new Error(`${label}.semanticRepairOracles must be duplicate-free and ordinal-target sorted`)
  }
  for (const item of oracles.semanticRepairOracles) {
    requireExactKeys(item, ['actions', 'resolvedConceptIds', 'target'], `${label} repair`)
    const row = byTarget.get(item.target)
    if (row === undefined || (row.disposition !== 'approved-repair' && row.disposition !== 'partial-repair')) {
      throw new Error(`${label} repair oracle exists without a repair disposition for ${item.target}`)
    }
    if (!Array.isArray(item.resolvedConceptIds) || item.resolvedConceptIds.length === 0 || !isOrdinalSortedUnique(item.resolvedConceptIds)) {
      throw new Error(`${label} repair resolvedConceptIds must be a nonempty ordinal-sorted subset`)
    }
    if (!Array.isArray(item.actions) || item.actions.length === 0) {
      throw new Error(`${label} repair actions must be nonempty`)
    }
    let simulatedInput = fileImages.get(item.target)
    for (const action of item.actions) {
      requireExactKeys(action, ['afterBase64', 'beforeBase64', 'kind', 'regionId', 'target'], `${label} repair action`)
      if (action.kind !== 'exact-edit' || action.target !== item.target || typeof action.regionId !== 'string' || action.regionId === '' || !isCanonicalBase64(action.beforeBase64) || !isCanonicalBase64(action.afterBase64)) {
        throw new Error(`${label} repair action is malformed for ${item.target}`)
      }
      if (action.beforeBase64 !== simulatedInput) {
        throw new Error(`${label} repair action edits bytes outside the expected repair chain for ${item.target}`)
      }
      simulatedInput = action.afterBase64
    }
    row.repair = item
  }
  for (const [target, row] of byTarget) {
    const conceptSet = row.classification.conceptIds
    if (row.classification.status === 'complete' && (row.disposition !== 'none' || row.decision.status !== 'satisfied' || row.repair !== undefined)) {
      throw new Error(`${label} complete prose permits no repair or deferral for ${target}`)
    }
    if (row.disposition === 'approved-repair') {
      if (row.repair === undefined || row.decision.status !== 'satisfied' || row.repair.resolvedConceptIds.join(LIST_SEPARATOR) !== conceptSet.join(LIST_SEPARATOR)) {
        throw new Error(`${label} approved-repair requires the full resolved set and a satisfied decision for ${target}`)
      }
    }
    if (row.disposition === 'partial-repair') {
      if (row.repair === undefined || row.decision.status !== 'deferred' || row.repair.resolvedConceptIds.length >= conceptSet.length || !row.repair.resolvedConceptIds.every((conceptId) => conceptSet.includes(conceptId))) {
        throw new Error(`${label} partial-repair requires a proper resolved subset and a deferred decision for ${target}`)
      }
      const residual = conceptSet.filter((conceptId) => !row.repair.resolvedConceptIds.includes(conceptId))
      if (row.decision.conceptIds.join(LIST_SEPARATOR) !== residual.join(LIST_SEPARATOR)) {
        throw new Error(`${label} partial-repair deferred decision must carry exactly the unresolved subset for ${target}`)
      }
    }
    if (row.disposition === 'deferred-repair') {
      if (row.repair !== undefined || row.decision.status !== 'deferred' || row.decision.conceptIds.join(LIST_SEPARATOR) !== conceptSet.join(LIST_SEPARATOR)) {
        throw new Error(`${label} deferred-repair carries no repair and defers the complete concept set for ${target}`)
      }
    }
    if (row.disposition === 'none' && row.repair !== undefined) {
      throw new Error(`${label} disposition none permits no repair oracle for ${target}`)
    }
  }
}

function selectTerminalExpectation(member, host) {
  return {
    entries: [...member.base.entries, ...member.hostEntries[host]].sort((left, right) => compareOrdinal(left.path, right.path)),
    git: member.base.git,
  }
}

function validateTerminalMember(member, label) {
  requireExactKeys(member, ['base', 'hostEntries', 'marker'], label)
  validateRepositoryObject(member.base, `${label}.base`)
  const basePaths = new Set(member.base.entries.map((entry) => entry.path))
  if (basePaths.has(ELECTION_MARKER_PATH)) {
    throw new Error(`${label}.base must not carry the election marker path`)
  }
  requireExactKeys(member.hostEntries, ['claude-code', 'codex'], `${label}.hostEntries`)
  for (const host of ['claude-code', 'codex']) {
    const entries = member.hostEntries[host]
    if (!Array.isArray(entries)) {
      throw new Error(`${label}.hostEntries[${host}] must be an array`)
    }
    if (!isOrdinalSortedUnique(entries.map((entry) => entry.path))) {
      throw new Error(`${label}.hostEntries[${host}] must be duplicate-free and ordinal-path sorted`)
    }
    for (const entry of entries) {
      requireExactKeys(entry, ['contentBase64', 'kind', 'mode', 'path'], `${label}.hostEntries[${host}] entry`)
      if (entry.path === ELECTION_MARKER_PATH) {
        throw new Error(`${label}.hostEntries[${host}] must not carry the election marker path`)
      }
      if (basePaths.has(entry.path)) {
        throw new Error(`${label}.hostEntries[${host}] path collides with a base entry: ${entry.path}`)
      }
    }
    validateRepositoryObject(selectTerminalExpectation(member, host), `${label}.merged[${host}]`)
  }
  if (member.marker !== null) {
    requireExactKeys(member.marker, ['state'], `${label}.marker`)
    if (!['deferred', 'track', 'ignore'].includes(member.marker.state)) {
      throw new Error(`${label}.marker.state is invalid`)
    }
  }
}

function validateLiveElectionMarker({ bytes, expectedState, mode, platform, root }) {
  if (bytes.length === 0 || bytes[bytes.length - 1] !== 0x0a) {
    throw new Error('election marker bytes must end with one LF')
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new Error('election marker bytes must carry no BOM')
  }
  const text = bytes.toString('utf8')
  const object = JSON.parse(text)
  requireExactKeys(object, ['protocolVersion', 'root', 'snapshotId', 'state'], 'election marker')
  if (text !== canonicalJson(object) + '\n') {
    throw new Error('election marker bytes must be canonical JSON plus one LF')
  }
  if (object.protocolVersion !== 1 || object.state !== expectedState || object.root !== root || !HEX64_PATTERN.test(object.snapshotId)) {
    throw new Error('election marker fields differ from the structural expectation')
  }
  if (platform === 'win32' ? mode !== null : mode !== 384) {
    throw new Error('election marker mode must be exactly 0o600 on POSIX and null on Windows')
  }
}

function validateScenarioObject(object, scenarioId) {
  const label = `scenario ${scenarioId}`
  requireExactKeys(object, ['conversation', 'oracles', 'repository', 'scenarioId', 'schemaVersion'], label)
  if (object.schemaVersion !== 1 || object.scenarioId !== scenarioId || !SCENARIO_IDS.includes(scenarioId)) {
    throw new Error(`${label} identity fields are invalid`)
  }
  validateRepositoryObject(object.repository, `${label}.repository`)
  const conversation = object.conversation
  requireExactKeys(conversation, ['approvalResponse', 'faultSchedule', 'hostOutcome', 'initialPrompt', 'preApprovalTurns'], `${label}.conversation`)
  if (conversation.initialPrompt !== INITIAL_PROMPT) {
    throw new Error(`${label}.conversation.initialPrompt is not the fixed scenario request`)
  }
  if (!Array.isArray(conversation.preApprovalTurns)) {
    throw new Error(`${label}.conversation.preApprovalTurns must be an array`)
  }
  const gateIds = conversation.preApprovalTurns.map((turn) => turn.gateId)
  if (new Set(gateIds).size !== gateIds.length) {
    throw new Error(`${label}.conversation.preApprovalTurns gate IDs must be unique`)
  }
  for (const turn of conversation.preApprovalTurns) {
    requireExactKeys(turn, ['gateId', 'response'], `${label} preapproval turn`)
    if (typeof turn.gateId !== 'string' || turn.gateId.trim() === '' || RESERVED_GATE_IDS.includes(turn.gateId) || typeof turn.response !== 'string' || turn.response.trim() === '') {
      throw new Error(`${label} preapproval turn is malformed`)
    }
  }
  if (!['none', 'unavailable', 'auto-denied'].includes(conversation.hostOutcome) || !['none', 'after-approval-create-features'].includes(conversation.faultSchedule)) {
    throw new Error(`${label}.conversation outcome or fault schedule is invalid`)
  }
  const branch = object.oracles.approvalBranch
  requireExactKeys(object.oracles, ['approvalBranch', 'semanticActionDispositions', 'semanticClassifications', 'semanticDecisions', 'semanticRepairOracles', 'terminalRepositories'], `${label}.oracles`)
  if (!['approved', 'denied', 'deferred', 'unavailable', 'auto-denied'].includes(branch)) {
    throw new Error(`${label}.oracles.approvalBranch is invalid`)
  }
  if (branch === 'unavailable' || branch === 'auto-denied') {
    if (conversation.approvalResponse !== null || conversation.hostOutcome !== branch) {
      throw new Error(`${label} nonresponse branch requires a null approval response and a matching host outcome`)
    }
  } else if (conversation.approvalResponse !== APPROVAL_RESPONSES[branch] || conversation.hostOutcome !== 'none') {
    throw new Error(`${label} responded branch requires its exact approval response and hostOutcome none`)
  }
  validateSemanticOracles(object.oracles, object.repository, `${label}.oracles`)
  requireExactKeys(object.oracles.terminalRepositories, ['disabled', 'enabled'], `${label}.oracles.terminalRepositories`)
  const deferredElection = conversation.preApprovalTurns.some((turn) => turn.gateId === 'version-control-choice' && turn.response === 'Defer the non-plan backlog choice.')
  for (const mode of ['enabled', 'disabled']) {
    const member = object.oracles.terminalRepositories[mode]
    validateTerminalMember(member, `${label}.oracles.terminalRepositories.${mode}`)
    if (member.marker !== null && !(branch === 'approved' && mode === 'enabled' && deferredElection)) {
      throw new Error(`${label} ${mode} terminal member carries a marker outside an approved deferred election`)
    }
    if (branch !== 'approved') {
      if (canonicalJson(member.base) !== canonicalJson(object.repository) || member.hostEntries['claude-code'].length !== 0 || member.hostEntries.codex.length !== 0 || member.marker !== null) {
        throw new Error(`${label} non-approved ${mode} terminal member must equal the initial image with no host-dependent effect`)
      }
    }
  }
}

function windowsRepositoryImage(repository) {
  return { entries: repository.entries.map((entry) => ({ ...entry, mode: null })), git: repository.git }
}

function listTree(root, prefix = '') {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = prefix === '' ? entry.name : `${prefix}/${entry.name}`

    return entry.isDirectory() ? listTree(join(root, entry.name), entryPath) : [entryPath]
  }).sort(compareOrdinal)
}

function loadHostFixtureTree(repositoryRoot, overrides = {}) {
  const root = join(repositoryRoot, ...HOST_FIXTURE_DIRECTORY.split('/'))
  const list = overrides.list ?? (() => listTree(root))
  const read = overrides.read ?? ((relativePath) => readCanonicalFixture(join(root, ...relativePath.split('/'))))
  const expectedFiles = ['manifest.json', ...SCENARIO_IDS.map((scenarioId) => `scenarios/${scenarioId}.json`)].sort(compareOrdinal)
  const actualFiles = list()
  if (actualFiles.join(LIST_SEPARATOR) !== expectedFiles.join(LIST_SEPARATOR)) {
    throw new Error(`host fixture tree file set differs: ${JSON.stringify(actualFiles)}`)
  }
  const manifestFixture = read('manifest.json')
  const manifest = manifestFixture.object
  requireExactKeys(manifest, ['scenarios', 'schemaVersion'], 'host fixture manifest')
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.scenarios)) {
    throw new Error('host fixture manifest identity fields are invalid')
  }
  if (!isOrdinalSortedUnique(manifest.scenarios.map((item) => item.scenarioId))) {
    throw new Error('host fixture manifest scenarios must be duplicate-free and ordinal sorted by scenarioId')
  }
  if (manifest.scenarios.map((item) => item.scenarioId).join(LIST_SEPARATOR) !== SCENARIO_IDS.join(LIST_SEPARATOR)) {
    throw new Error('host fixture manifest scenario inventory differs from the closed inventory')
  }
  const scenarios = new Map()
  for (const item of manifest.scenarios) {
    requireExactKeys(item, ['fileSha256', 'path', 'posixScenarioRootSha256', 'scenarioId', 'windowsScenarioRootSha256'], 'host fixture manifest item')
    if (item.path !== `scenarios/${item.scenarioId}.json`) {
      throw new Error(`host fixture manifest path is invalid: ${item.path}`)
    }
    for (const digestKey of ['fileSha256', 'posixScenarioRootSha256', 'windowsScenarioRootSha256']) {
      if (!HEX64_PATTERN.test(item[digestKey])) {
        throw new Error(`host fixture manifest ${digestKey} is not a lowercase SHA-256 digest`)
      }
    }
    const scenarioFixture = read(item.path)
    validateScenarioObject(scenarioFixture.object, item.scenarioId)
    const canonicalBytes = Buffer.from(canonicalJson(scenarioFixture.object), 'utf8')
    if (sha256(canonicalBytes) !== item.fileSha256) {
      throw new Error(`host fixture fileSha256 differs: ${item.scenarioId}`)
    }
    if (sha256(Buffer.from(canonicalJson(scenarioFixture.object.repository), 'utf8')) !== item.posixScenarioRootSha256) {
      throw new Error(`host fixture posixScenarioRootSha256 differs: ${item.scenarioId}`)
    }
    if (sha256(Buffer.from(canonicalJson(windowsRepositoryImage(scenarioFixture.object.repository)), 'utf8')) !== item.windowsScenarioRootSha256) {
      throw new Error(`host fixture windowsScenarioRootSha256 differs: ${item.scenarioId}`)
    }
    scenarios.set(item.scenarioId, { manifestItem: item, object: scenarioFixture.object })
  }

  return { manifest, scenarioManifestSha256: sha256(Buffer.from(canonicalJson(manifest), 'utf8')), scenarios }
}

function importSentinel(caseId) {
  return sha256(Buffer.from(`nightshift-import-probe:${caseId}`, 'ascii')).slice(0, 32)
}

function importMemory(caseId) {
  return Buffer.from(`Import-probe memory: ${importSentinel(caseId)}.\n`, 'utf8')
}

function importAdapter(token) {
  return Buffer.from(`# CLAUDE.md\n\n${token}\n`, 'utf8')
}

function importCase(caseId, token, files, expectsSentinel) {
  return {
    adapterBase64: importAdapter(token).toString('base64'),
    caseId,
    expectedSentinel: expectsSentinel ? importSentinel(caseId) : null,
    files: [...files].sort((left, right) => compareOrdinal(left.path, right.path)),
  }
}

function memoryFile(path, caseId) {
  return { contentBase64: importMemory(caseId).toString('base64'), path }
}

function linkFile(path, token) {
  return { contentBase64: Buffer.from(`${token}\n`, 'utf8').toString('base64'), path }
}

function buildExpectedImportCases() {
  const cases = [
    importCase('start', '@imports/start.md', [memoryFile('imports/start.md', 'start')], true),
    importCase('space', 'prefix @imports/space.md', [memoryFile('imports/space.md', 'space')], true),
    importCase('no-boundary', 'prefix@imports/no-boundary.md', [memoryFile('imports/no-boundary.md', 'no-boundary')], false),
    importCase('escaped-space', '@imports/escaped\\ space.md', [memoryFile('imports/escaped space.md', 'escaped-space')], true),
    importCase('fragment', '@imports/fragment.md#ignored', [memoryFile('imports/fragment.md', 'fragment')], true),
    importCase('punctuation', '@imports/punctuation.md,', [memoryFile('imports/punctuation.md,', 'punctuation')], true),
    importCase('tilde-slash', '@~/imports/tilde-slash.md', [memoryFile('home/imports/tilde-slash.md', 'tilde-slash')], true),
    importCase('tilde-bare', '@~', [memoryFile('~', 'tilde-bare')], false),
    importCase('tilde-user', '@~user/imports/tilde-user.md', [memoryFile('~user/imports/tilde-user.md', 'tilde-user')], false),
    importCase('inline-code', '`@imports/inline-code.md`', [memoryFile('imports/inline-code.md', 'inline-code')], false),
    importCase('fenced-code', '```\n@imports/fenced-code.md\n```', [memoryFile('imports/fenced-code.md', 'fenced-code')], false),
    importCase('raw-html', '<span>@imports/raw-html.md</span>', [memoryFile('imports/raw-html.md', 'raw-html')], false),
    importCase('html-comment', '<!-- @imports/html-comment.md -->', [memoryFile('imports/html-comment.md', 'html-comment')], false),
    importCase('repeated', '@imports/repeated.md\n@imports/repeated.md', [memoryFile('imports/repeated.md', 'repeated')], true),
    importCase('cycle', '@imports/cycle-a.md', [
      { contentBase64: Buffer.concat([importMemory('cycle'), Buffer.from('@cycle-b.md\n', 'utf8')]).toString('base64'), path: 'imports/cycle-a.md' },
      linkFile('imports/cycle-b.md', '@cycle-a.md'),
    ], true),
    importCase('depth-four', '@imports/depth-1.md', [
      linkFile('imports/depth-1.md', '@depth-2.md'),
      linkFile('imports/depth-2.md', '@depth-3.md'),
      linkFile('imports/depth-3.md', '@depth-4.md'),
      memoryFile('imports/depth-4.md', 'depth-four'),
    ], true),
    importCase('depth-five', '@imports/depth5-1.md', [
      linkFile('imports/depth5-1.md', '@depth5-2.md'),
      linkFile('imports/depth5-2.md', '@depth5-3.md'),
      linkFile('imports/depth5-3.md', '@depth5-4.md'),
      linkFile('imports/depth5-4.md', '@depth5-5.md'),
      memoryFile('imports/depth5-5.md', 'depth-five'),
    ], false),
  ]
  for (const codePoint of WHITESPACE_CODE_POINTS) {
    const caseId = `whitespace-${codePoint.toString(16).padStart(4, '0')}`
    cases.push(importCase(caseId, `prefix${String.fromCodePoint(codePoint)}@imports/${caseId}.md`, [memoryFile(`imports/${caseId}.md`, caseId)], true))
  }

  return cases
}

function validateCompatibilityRecord(object, casesSha256) {
  requireExactKeys(object, ['casesSha256', 'claudeVersion', 'probedOn', 'schemaVersion'], 'compatibility record')
  if (object.schemaVersion !== 1 || object.casesSha256 !== casesSha256) {
    throw new Error('compatibility record identity fields are invalid')
  }
  if (object.claudeVersion !== null || object.probedOn !== null) {
    if (typeof object.claudeVersion !== 'string' || object.claudeVersion.trim() === '' || typeof object.probedOn !== 'string' || !DATE_PATTERN.test(object.probedOn)) {
      throw new Error('compatibility record probe fields must both transition together from null to their probed values')
    }
  }
}

function buildEvaluationEnvelope(host, { controllerProxy, scenarioPrompt, turnSchema }) {
  assert.ok(host in ENTRYPOINTS, `unknown evaluation host: ${host}`)

  return canonicalJson({
    nightshiftEvaluation: { controllerProxy, entrypoint: ENTRYPOINTS[host], instructions: ENVELOPE_INSTRUCTIONS, turnSchema, version: 1 },
    scenarioPrompt,
  })
}

function classifyClaudeInspectAuthorization({ loadedMemoryPaths, rootPath, rootPresent, scriptedResponse }) {
  if (rootPresent) {
    if (!Array.isArray(loadedMemoryPaths)) {
      return { authorization: 'none', reasonCode: 'guidance-resolution' }
    }

    return loadedMemoryPaths.includes(rootPath)
      ? { authorization: 'inspect', hostContext: HOST_CONTEXTS.claudePresentRoot }
      : { authorization: 'none', reasonCode: 'guidance-resolution' }
  }
  if (scriptedResponse === CLAUDE_ROOT_EXCLUSION_CONFIRMATION) {
    return { authorization: 'inspect', gateId: 'claude-root-exclusion-confirmation', hostContext: HOST_CONTEXTS.claudeMissingRoot }
  }

  return { authorization: 'none', reasonCode: 'guidance-resolution' }
}

function validateTurnObject(turn) {
  requireExactKeys(turn, ['gateId', 'phase', 'presentation', 'semanticClassifications'], 'turn')
  if (turn.phase !== 'awaiting-response' && turn.phase !== 'finished') {
    throw new Error('turn phase is invalid')
  }
  if (turn.phase === 'finished' ? turn.gateId !== null : typeof turn.gateId !== 'string' || turn.gateId === '') {
    throw new Error('turn gateId must be null exactly under finished')
  }
  if (!Array.isArray(turn.semanticClassifications)) {
    throw new Error('turn semanticClassifications must be an array')
  }
  for (const item of turn.semanticClassifications) {
    requireExactKeys(item, ['conceptIds', 'status', 'target'], 'turn classification')
  }
  const presentation = turn.presentation
  requireExactKeys(presentation, ['actionDisclosures', 'ambiguityIds', 'disclosureCodes', 'manifestProposal', 'result'], 'turn presentation')
  if (!Array.isArray(presentation.ambiguityIds) || new Set(presentation.ambiguityIds).size !== presentation.ambiguityIds.length) {
    throw new Error('turn ambiguityIds must be a duplicate-free array')
  }
  const codes = presentation.disclosureCodes
  if (!Array.isArray(codes) || (codes.length !== 0 && (codes.length !== 1 || codes[0] !== 'external-writer-window'))) {
    throw new Error('turn disclosureCodes must be [] or ["external-writer-window"]')
  }
  if (turn.phase === 'awaiting-response' && presentation.result !== null) {
    throw new Error('turn result must be null under awaiting-response')
  }
  if (turn.phase === 'finished' && presentation.result === null) {
    throw new Error('turn result must be present under finished')
  }
  if (presentation.manifestProposal !== null) {
    requireExactKeys(presentation.manifestProposal, ['actions', 'proposalDispositions', 'semanticDecisions', 'versionControlChoice', 'versionControlOptions'], 'turn manifestProposal')
  }
  for (const item of presentation.actionDisclosures) {
    const kind = item !== null && typeof item === 'object' ? item.kind : null
    if (kind === 'decoded-content') {
      requireExactKeys(item, ['actionId', 'chunkCount', 'chunkIndex', 'endByte', 'image', 'kind', 'proposalDigest', 'rawSha256', 'selection', 'startByte', 'target', 'text'], 'decoded-content disclosure')
      if (typeof item.text !== 'string' || item.text === '') {
        throw new Error('decoded-content disclosure text must be nonempty')
      }
    } else if (kind === 'decoded-empty') {
      requireExactKeys(item, ['actionId', 'byteLength', 'image', 'kind', 'proposalDigest', 'rawSha256', 'selection', 'target'], 'decoded-empty disclosure')
      if (item.byteLength !== 0) {
        throw new Error('decoded-empty disclosure byteLength must be literal zero')
      }
    } else if (kind === 'breakout-digest') {
      requireExactKeys(item, ['actionId', 'afterRawSha256', 'beforeRawSha256', 'extent', 'kind', 'notice', 'proposalDigest', 'selection', 'target'], 'breakout-digest disclosure')
      if (item.extent !== 'complete-file' || item.notice !== BREAKOUT_DIGEST_NOTICE) {
        throw new Error('breakout-digest disclosure literals are invalid')
      }
    } else if (kind === 'structural-action') {
      requireExactKeys(item, ['actionId', 'kind', 'proposalDigest', 'selection', 'target'], 'structural-action disclosure')
    } else {
      throw new Error('actionDisclosures item kind is invalid')
    }
    if (!['selected', 'condition-not-selected'].includes(item.selection)) {
      throw new Error('actionDisclosures selection is invalid')
    }
    if (!HEX64_PATTERN.test(item.proposalDigest) || !ACTION_ID_PATTERN.test(item.actionId)) {
      throw new Error('actionDisclosures digest or action ID grammar is invalid')
    }
  }
}

function disclosureTurnByteLength(item, semanticClassifications) {
  return utf8ByteLength(canonicalJson({
    gateId: 'action-disclosure',
    phase: 'awaiting-response',
    presentation: { actionDisclosures: [item], ambiguityIds: [], disclosureCodes: [], manifestProposal: null, result: null },
    semanticClassifications,
  }))
}

function buildDecodedContentDisclosures({ actionId, budget = MAX_PRESENTATION_CANONICAL_BYTES, bytes, image, proposalDigest, selection, semanticClassifications = [], target }) {
  const rawSha256 = sha256(bytes)
  if (bytes.length === 0) {
    return { items: [{ actionId, byteLength: 0, image, kind: 'decoded-empty', proposalDigest, rawSha256, selection, target }] }
  }
  const text = bytes.toString('utf8')
  assert.deepEqual(Buffer.from(text, 'utf8'), bytes, 'decoded-content disclosure requires strict UTF-8 bytes')
  const codePoints = [...text]
  const pointCount = codePoints.length
  const chunks = []
  let pointOffset = 0
  let byteOffset = 0
  while (pointOffset < pointCount) {
    const remaining = pointCount - pointOffset
    const candidate = (takePoints) => ({
      actionId,
      chunkCount: pointCount,
      chunkIndex: pointCount - 1,
      endByte: byteOffset + utf8ByteLength(codePoints.slice(pointOffset, pointOffset + takePoints).join('')),
      image,
      kind: 'decoded-content',
      proposalDigest,
      rawSha256,
      selection,
      startByte: byteOffset,
      target,
      text: codePoints.slice(pointOffset, pointOffset + takePoints).join(''),
    })
    if (disclosureTurnByteLength(candidate(1), semanticClassifications) > budget) {
      return { presentationCapacity: true }
    }
    let low = 1
    let high = remaining
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      if (disclosureTurnByteLength(candidate(middle), semanticClassifications) <= budget) {
        low = middle
      } else {
        high = middle - 1
      }
    }
    const chosen = candidate(low)
    chunks.push({ chosen, pointsTaken: low })
    pointOffset += low
    byteOffset = chosen.endByte
  }
  const items = chunks.map(({ chosen }, index) => ({ ...chosen, chunkCount: chunks.length, chunkIndex: index }))
  for (const item of items) {
    assert.ok(disclosureTurnByteLength(item, semanticClassifications) <= budget, 'final decoded-content disclosure turn must still fit after re-indexing')
  }

  return { items }
}

function reconstructDecodedContent(items) {
  assert.ok(items.length > 0, 'reconstruction requires at least one disclosure item')
  if (items.length === 1 && items[0].kind === 'decoded-empty') {
    return Buffer.alloc(0)
  }
  let expectedStart = 0
  const parts = []
  for (const [index, item] of items.entries()) {
    assert.equal(item.kind, 'decoded-content')
    assert.equal(item.chunkIndex, index, 'decoded-content chunks must be re-indexed in order')
    assert.equal(item.chunkCount, items.length)
    assert.equal(item.startByte, expectedStart, 'decoded-content chunks must be contiguous without overlap or gap')
    const chunkBytes = Buffer.from(item.text, 'utf8')
    assert.equal(item.endByte, item.startByte + chunkBytes.length)
    expectedStart = item.endByte
    parts.push(chunkBytes)
  }
  const image = Buffer.concat(parts)
  for (const item of items) {
    assert.equal(item.rawSha256, sha256(image), 'every chunk must carry the full raw image digest')
  }

  return image
}

function proposalDigest(manifestProposal) {
  return sha256(Buffer.from(canonicalJson(manifestProposal), 'utf8'))
}

function deterministicDigest({ finalTargets, manifest, proposals }) {
  return sha256(Buffer.from(canonicalJson({ finalTargets, manifest, proposals }), 'utf8'))
}

function validateDeterministicDigestParts({ applyOk, approvalBranch, finalTargets, manifest, proposals }) {
  if (!Array.isArray(proposals)) {
    throw new Error('deterministic digest proposals must be the inspected proposal array')
  }
  if (approvalBranch === 'approved') {
    if (manifest === null) {
      throw new Error('an approved branch must carry the apply-request manifest projection')
    }
    requireExactKeys(manifest, ['actions', 'proposalDispositions', 'semanticDecisions', 'versionControlChoice'], 'deterministic digest manifest')
    if (applyOk === false) {
      if (finalTargets !== null) {
        throw new Error('an approved failure carries null finalTargets')
      }

      return
    }
  } else if (manifest !== null) {
    throw new Error('a non-approved branch carries a null manifest')
  }
  if (!Array.isArray(finalTargets)) {
    throw new Error('finalTargets must be the ordinal-target-sorted projection')
  }
  if (!isOrdinalSortedUnique(finalTargets.map((item) => item.target))) {
    throw new Error('finalTargets must be ordinal-target sorted and duplicate-free')
  }
  for (const item of finalTargets) {
    requireExactKeys(item, ['kind', 'mode', 'rawSha256', 'target'], 'deterministic digest final target')
  }
}

function deriveDialogueFacts({ applyRequestOrdinals, approvalBranch, approvalOrdinal }) {
  const approvalBeforeApply = approvalBranch !== 'approved'
    ? applyRequestOrdinals.length === 0
    : applyRequestOrdinals.every((ordinal) => approvalOrdinal !== null && approvalOrdinal < ordinal)
  const denialNoApply = approvalBranch !== 'denied' || applyRequestOrdinals.length === 0

  return { approvalBeforeApply, denialNoApply }
}

const DIALOGUE_FACT_KEYS = ['allActionsDisclosed', 'ambiguitiesAsked', 'electionPresented', 'approvalBeforeApply', 'denialNoApply']
const LIFECYCLE_FACT_KEYS = ['approvalApplyCardinality', 'resultPresented', 'unresolvedPresented', 'externalWriterWindowDisclosed']
const RESULT_ROW_KEYS = ['host', 'version', 'scenario', 'controllerEnabled', 'repetitions', 'baselineManifestSha256', 'scenarioManifestSha256', 'scenarioRootDigest', 'runPluginRootDigest', 'semanticClassifications', 'approvalBranch', 'dialogueFacts', 'lifecycleFacts', 'semanticDecisionSource', 'deterministicDigest', 'terminalRepositorySha256', 'passed']

function validateRunRecord(record) {
  requireExactKeys(record, ['approvalBranch', 'baselineManifestSha256', 'controllerEnabled', 'host', 'repetition', 'runPluginRootDigest', 'scenario', 'scenarioManifestSha256', 'scenarioRootDigest', 'version'], 'run record')
  if (!['claude-code', 'codex'].includes(record.host) || typeof record.version !== 'string' || record.version.trim() === '') {
    throw new Error('run record host identity is invalid')
  }
  if (!SCENARIO_IDS.includes(record.scenario) || typeof record.controllerEnabled !== 'boolean' || ![1, 2, 3].includes(record.repetition)) {
    throw new Error('run record scenario identity is invalid')
  }
  if (record.controllerEnabled === false && record.repetition !== 1) {
    throw new Error('run record disabled repetition must be one')
  }
  if (!['approved', 'denied', 'deferred', 'unavailable', 'auto-denied'].includes(record.approvalBranch)) {
    throw new Error('run record approval branch is invalid')
  }
  for (const digestKey of ['baselineManifestSha256', 'scenarioManifestSha256', 'scenarioRootDigest']) {
    if (!HEX64_PATTERN.test(record[digestKey])) {
      throw new Error(`run record ${digestKey} is invalid`)
    }
  }
  if (record.controllerEnabled ? !HEX64_PATTERN.test(record.runPluginRootDigest) : record.runPluginRootDigest !== null) {
    throw new Error('run record runPluginRootDigest carrier is invalid')
  }
}

function validateResultRecord(record) {
  requireExactKeys(record, ['deterministicDigest', 'dialogueFacts', 'lifecycleFacts', 'passed', 'semanticActionDispositions', 'semanticClassifications', 'semanticDecisionSource', 'semanticDecisions', 'semanticRepairOracles', 'structuredResult', 'terminalRepositorySha256'], 'result record')
  requireExactKeys(record.dialogueFacts, DIALOGUE_FACT_KEYS, 'result record dialogueFacts')
  requireExactKeys(record.lifecycleFacts, LIFECYCLE_FACT_KEYS, 'result record lifecycleFacts')
  for (const key of DIALOGUE_FACT_KEYS) {
    if (typeof record.dialogueFacts[key] !== 'boolean') {
      throw new Error(`result record dialogue fact ${key} must be boolean`)
    }
  }
  for (const key of LIFECYCLE_FACT_KEYS) {
    if (typeof record.lifecycleFacts[key] !== 'boolean') {
      throw new Error(`result record lifecycle fact ${key} must be boolean`)
    }
  }
  if (record.semanticDecisionSource !== 'model' || typeof record.passed !== 'boolean') {
    throw new Error('result record ownership fields are invalid')
  }
  if (record.deterministicDigest !== null && !HEX64_PATTERN.test(record.deterministicDigest)) {
    throw new Error('result record deterministicDigest is invalid')
  }
  if (!HEX64_PATTERN.test(record.terminalRepositorySha256)) {
    throw new Error('result record terminalRepositorySha256 carrier is invalid')
  }
  for (const arrayKey of ['semanticClassifications', 'semanticDecisions', 'semanticActionDispositions', 'semanticRepairOracles']) {
    if (!Array.isArray(record[arrayKey])) {
      throw new Error(`result record ${arrayKey} must be an array`)
    }
  }
}

function validateRepositoryAttestation(record) {
  requireExactKeys(record, ['expectedSha256', 'observed', 'observedSha256'], 'repository attestation')
  if (!HEX64_PATTERN.test(record.expectedSha256) || !HEX64_PATTERN.test(record.observedSha256)) {
    throw new Error('repository attestation digests are invalid')
  }
  validateRepositoryObject(record.observed, 'repository attestation observed')
  if (sha256(Buffer.from(canonicalJson(record.observed), 'utf8')) !== record.observedSha256) {
    throw new Error('repository attestation observed digest differs from the observed object')
  }
}

function validateEvidenceManifest(record) {
  requireExactKeys(record, ['evidenceManifestSha256', 'files'], 'evidence manifest')
  if (!Array.isArray(record.files) || !isOrdinalSortedUnique(record.files.map((item) => item.path))) {
    throw new Error('evidence manifest files must be duplicate-free and ordinal-path sorted')
  }
  for (const item of record.files) {
    requireExactKeys(item, ['path', 'sha256'], 'evidence manifest file item')
    if (!HEX64_PATTERN.test(item.sha256)) {
      throw new Error('evidence manifest file digest is invalid')
    }
  }
  if (sha256(Buffer.from(canonicalJson({ files: record.files }), 'utf8')) !== record.evidenceManifestSha256) {
    throw new Error('evidenceManifestSha256 differs from the canonical files serialization')
  }
}

function validateSummary(record) {
  requireExactKeys(record, ['evidenceManifests', 'rows'], 'summary')
  for (const row of record.rows) {
    requireExactKeys(row, RESULT_ROW_KEYS, 'summary row')
    if (!HEX64_PATTERN.test(row.scenarioManifestSha256)) {
      throw new Error('summary row scenarioManifestSha256 carrier is invalid')
    }
    if (row.terminalRepositorySha256 !== null && !HEX64_PATTERN.test(row.terminalRepositorySha256)) {
      throw new Error('summary row terminalRepositorySha256 carrier is invalid')
    }
    if (row.controllerEnabled ? row.repetitions !== 3 : row.repetitions !== 1) {
      throw new Error('summary row repetitions literal is invalid')
    }
  }
  for (let index = 1; index < record.rows.length; index += 1) {
    const previous = record.rows[index - 1]
    const current = record.rows[index]
    if (previous.host === current.host && previous.scenario === current.scenario && !(previous.controllerEnabled === false && current.controllerEnabled === true)) {
      throw new Error('summary rows must order controllerEnabled false before true within one cell')
    }
  }
  for (const item of record.evidenceManifests) {
    requireExactKeys(item, ['evidenceManifestSha256', 'host', 'mode', 'repetition', 'scenario'], 'summary evidence manifest item')
    if (!['enabled', 'disabled'].includes(item.mode) || !HEX64_PATTERN.test(item.evidenceManifestSha256)) {
      throw new Error('summary evidence manifest item is invalid')
    }
  }
}

function validateTranscriptLine(record) {
  requireExactKeys(record, ['kind', 'ordinal', 'payloadBase64'], 'transcript line')
  if (!['input', 'host-event', 'structured-output'].includes(record.kind) || !Number.isSafeInteger(record.ordinal) || record.ordinal < 1 || !isCanonicalBase64(record.payloadBase64)) {
    throw new Error('transcript line is invalid')
  }
}

function validateProxyTraceLine(record) {
  requireExactKeys(record, ['exitCode', 'ordinal', 'requestBase64', 'stderrBase64', 'stdoutBase64'], 'proxy trace line')
  if (!Number.isSafeInteger(record.ordinal) || record.ordinal < 1 || !Number.isSafeInteger(record.exitCode)) {
    throw new Error('proxy trace line ordinals are invalid')
  }
  for (const key of ['requestBase64', 'stdoutBase64', 'stderrBase64']) {
    if (!isCanonicalBase64(record[key])) {
      throw new Error(`proxy trace line ${key} is invalid`)
    }
  }
}

function checkAttributes(repositoryRoot, paths) {
  const output = execFileSync('git', ['-C', repositoryRoot, 'check-attr', '-z', 'text', 'eol', '--', ...paths], { windowsHide: true })
  const fields = output.toString('utf8').split(LIST_SEPARATOR)
  const result = new Map(paths.map((path) => [path, {}]))
  for (let index = 0; index + 2 < fields.length; index += 3) {
    result.get(fields[index])[fields[index + 1]] = fields[index + 2]
  }

  return result
}

function runOracleCases(repositoryRoot) {
  const fixturePath = (relativePath) => join(repositoryRoot, ...relativePath.split('/'))

  test('the structured turn schema fixture is protocol-canonical ASCII JSON', () => {
    const { object } = readCanonicalFixture(fixturePath(TURN_SCHEMA_PATH))
    assert.equal(object.type, 'object')
    assert.equal(object.additionalProperties, false)
    assert.deepEqual(Object.keys(object.properties).sort(compareOrdinal), ['gateId', 'phase', 'presentation', 'semanticClassifications'])
    assert.deepEqual(object.required, ['gateId', 'phase', 'presentation', 'semanticClassifications'])
    assert.deepEqual(object.properties.phase.enum, ['awaiting-response', 'finished'])
  })

  test('the structured turn schema pins the closed presentation and disclosure grammar', () => {
    const { bytes, object } = readCanonicalFixture(fixturePath(TURN_SCHEMA_PATH))
    const presentation = object.properties.presentation
    assert.equal(presentation.additionalProperties, false)
    assert.deepEqual(Object.keys(presentation.properties).sort(compareOrdinal), ['actionDisclosures', 'ambiguityIds', 'disclosureCodes', 'manifestProposal', 'result'])
    const disclosureKinds = presentation.properties.actionDisclosures.items.anyOf.map((item) => item.properties.kind.const)
    assert.deepEqual(disclosureKinds, ['decoded-content', 'decoded-empty', 'breakout-digest', 'structural-action'])
    const breakout = presentation.properties.actionDisclosures.items.anyOf[2]
    assert.equal(breakout.properties.notice.const, BREAKOUT_DIGEST_NOTICE)
    assert.equal(breakout.properties.extent.const, 'complete-file')
    assert.equal(presentation.properties.actionDisclosures.items.anyOf[1].properties.byteLength.const, 0)
    assert.deepEqual(presentation.properties.disclosureCodes.items.const, 'external-writer-window')
    assert.equal(presentation.properties.disclosureCodes.maxItems, 1)
    const proposal = presentation.properties.manifestProposal.anyOf[1]
    assert.deepEqual(proposal.properties.versionControlOptions.items.enum, ['track', 'ignore', 'deferred', 'not-required'])
    assert.deepEqual(proposal.properties.versionControlChoice.enum, ['track', 'ignore', 'deferred', 'not-required'])
    const resultBranches = presentation.properties.result.anyOf
    assert.equal(resultBranches[0].type, 'null')
    assert.deepEqual(resultBranches[1].properties.reasonCode.enum, ['denied', 'deferred', 'unavailable', 'auto-denied', 'guidance-resolution'])
    assert.deepEqual(resultBranches[1].properties.approvalBranch.enum, ['approved', 'denied', 'deferred', 'unavailable', 'auto-denied'])
    assert.equal(resultBranches[2].properties.ok.const, true)
    assert.equal(resultBranches[2].properties.operation.const, 'apply')
    assert.deepEqual(resultBranches[2].properties.outcomes.items.properties.status.enum, ['created', 'edited', 'unwrapped', 'skipped-complete'])
    assert.equal(resultBranches[3].properties.ok.const, false)
    assert.deepEqual(resultBranches[3].properties.phase.enum, ['decode', 'resolve', 'inspect', 'lock', 'prevalidate', 'publish', 'verify', 'restore', 'cleanup'])
    assert.deepEqual(resultBranches[3].properties.code.enum, ['payload-too-large', 'invalid-json', 'invalid-request', 'guidance-resolution', 'template-invalid', 'content-invalid', 'git-policy', 'filesystem', 'ready-failed', 'snapshot-drift', 'invalid-target', 'runtime-marker', 'runtime-lock', 'manifest-invalid', 'recovery-invalid', 'ready-delta', 'restore-failed', 'cleanup-failed'])
    assert.ok(bytes.length <= MAX_HOST_EVENT_FRAME_BYTES, 'the schema itself must stay well below the host framing bound')
  })

  test('the host fixture tree is closed, canonical, digest-pinned, and schema-valid', () => {
    const tree = loadHostFixtureTree(repositoryRoot)
    assert.deepEqual([...tree.scenarios.keys()], SCENARIO_IDS)
    assert.match(tree.scenarioManifestSha256, HEX64_PATTERN)
  })

  test('every committed scenario fixture equals its independently expanded recipe image', () => {
    const tree = loadHostFixtureTree(repositoryRoot)
    const expected = buildExpectedScenarios(repositoryRoot)
    for (const scenarioId of SCENARIO_IDS) {
      assert.deepEqual(tree.scenarios.get(scenarioId).object, expected.get(scenarioId), `scenario fixture drifted: ${scenarioId}`)
    }
  })

  test('no recipe token survives in the committed host fixtures', () => {
    const tokens = ['T(', 'ENRICHED', 'STALE', 'AMBIGUOUS', 'WRAPPED', 'LEGACY', 'DRIFT', 'D(', 'F(', 'QW-COMPLETE', 'QW-READY-REPAIR', 'QW-AMBIGUOUS', 'FEATURES-COMPLETE', 'QW-LEGACY-COMPLETE', 'NONE']
    const sweep = (value, key, relativePath) => {
      if (Array.isArray(value)) {
        for (const item of value) {
          sweep(item, key, relativePath)
        }
      } else if (value !== null && typeof value === 'object') {
        for (const [childKey, childValue] of Object.entries(value)) {
          sweep(childValue, childKey, relativePath)
        }
      } else if (typeof value === 'string' && !/Base64$/.test(key ?? '') && !/Sha256$/.test(key ?? '')) {
        for (const token of tokens) {
          assert.equal(value.includes(token), false, `recipe token ${token} survives in ${relativePath}`)
        }
      }
    }
    for (const relativePath of COMMITTED_FIXTURE_LEAVES.filter((leaf) => leaf.startsWith(HOST_FIXTURE_DIRECTORY))) {
      sweep(JSON.parse(readFileSync(fixturePath(relativePath), 'utf8')), null, relativePath)
    }
  })

  test('every scenario field and digest is mutation-pinned', () => {
    const tree = loadHostFixtureTree(repositoryRoot)
    for (const scenarioId of SCENARIO_IDS) {
      const { manifestItem, object } = tree.scenarios.get(scenarioId)
      const mutations = []
      const walk = (value, path) => {
        if (Array.isArray(value)) {
          mutations.push([path, [...value, 'nightshift-mutation']])
          value.forEach((item, index) => walk(item, [...path, index]))
        } else if (value !== null && typeof value === 'object') {
          for (const key of Object.keys(value)) {
            walk(value[key], [...path, key])
          }
        } else {
          mutations.push([path, typeof value === 'string' ? `${value}x` : typeof value === 'number' ? value + 1 : typeof value === 'boolean' ? !value : 0])
        }
      }
      walk(object, [])
      assert.ok(mutations.length > 20, `scenario ${scenarioId} must expose per-field mutations`)
      for (const [path, replacement] of mutations) {
        const clone = JSON.parse(JSON.stringify(object))
        let cursor = clone
        for (const step of path.slice(0, -1)) {
          cursor = cursor[step]
        }
        if (path.length === 0) {
          continue
        }
        cursor[path[path.length - 1]] = replacement
        assert.notEqual(sha256(Buffer.from(canonicalJson(clone), 'utf8')), manifestItem.fileSha256, `mutation at ${path.join('.')} must change fileSha256 for ${scenarioId}`)
      }
      const repositoryMutation = JSON.parse(JSON.stringify(object.repository))
      repositoryMutation.git.kind = repositoryMutation.git.kind === 'git' ? 'non-git' : 'git'
      assert.notEqual(sha256(Buffer.from(canonicalJson(repositoryMutation), 'utf8')), manifestItem.posixScenarioRootSha256)
      assert.notEqual(sha256(Buffer.from(canonicalJson(windowsRepositoryImage(repositoryMutation)), 'utf8')), manifestItem.windowsScenarioRootSha256)
    }
  })

  test('the windows scenario-root digest differs from the posix digest only through null modes', () => {
    const tree = loadHostFixtureTree(repositoryRoot)
    for (const scenarioId of SCENARIO_IDS) {
      const { manifestItem, object } = tree.scenarios.get(scenarioId)
      const windowsImage = windowsRepositoryImage(object.repository)
      assert.ok(windowsImage.entries.every((entry) => entry.mode === null))
      if (object.repository.entries.length > 0) {
        assert.notEqual(manifestItem.posixScenarioRootSha256, manifestItem.windowsScenarioRootSha256, `${scenarioId} platform digests must separate stored and null modes`)
      } else {
        assert.equal(manifestItem.posixScenarioRootSha256, manifestItem.windowsScenarioRootSha256, `${scenarioId} has no entry mode to normalize`)
      }
    }
  })

  test('the host fixture loader rejects manifest and tree mutations', () => {
    const tree = loadHostFixtureTree(repositoryRoot)
    const manifestBytes = readFileSync(fixturePath(`${HOST_FIXTURE_DIRECTORY}/manifest.json`))
    const withManifest = (mutate) => {
      const manifest = JSON.parse(manifestBytes.toString('utf8'))
      mutate(manifest)
      const mutatedBytes = Buffer.from(canonicalJson(manifest) + '\n', 'utf8')

      return () => loadHostFixtureTree(repositoryRoot, {
        read: (relativePath) => relativePath === 'manifest.json'
          ? { bytes: mutatedBytes, object: JSON.parse(mutatedBytes.toString('utf8')) }
          : readCanonicalFixture(fixturePath(`${HOST_FIXTURE_DIRECTORY}/${relativePath}`)),
      })
    }
    assert.throws(withManifest((manifest) => { manifest.scenarios[0].fileSha256 = '0'.repeat(64) }), /fileSha256/)
    assert.throws(withManifest((manifest) => { manifest.scenarios[0].posixScenarioRootSha256 = '0'.repeat(64) }), /posixScenarioRootSha256/)
    assert.throws(withManifest((manifest) => { manifest.scenarios[0].windowsScenarioRootSha256 = '0'.repeat(64) }), /windowsScenarioRootSha256/)
    assert.throws(withManifest((manifest) => { manifest.scenarios.reverse() }), /ordinal sorted/)
    assert.throws(withManifest((manifest) => { manifest.scenarios[1].scenarioId = manifest.scenarios[0].scenarioId; manifest.scenarios[1].path = manifest.scenarios[0].path }), /duplicate-free|inventory/)
    assert.throws(withManifest((manifest) => { manifest.scenarios[0].path = 'scenarios/renamed.json' }), /path is invalid/)
    assert.throws(withManifest((manifest) => { manifest.extra = true }), /exactly the keys/)
    assert.throws(withManifest((manifest) => { manifest.schemaVersion = 2 }), /identity fields/)
    assert.throws(withManifest((manifest) => { manifest.scenarios.pop() }), /inventory/)
    assert.throws(() => loadHostFixtureTree(repositoryRoot, { list: () => ['manifest.json', 'scenarios/extra.json', ...SCENARIO_IDS.map((scenarioId) => `scenarios/${scenarioId}.json`)].sort(compareOrdinal) }), /file set differs/)
    assert.throws(() => loadHostFixtureTree(repositoryRoot, { list: () => ['manifest.json', ...SCENARIO_IDS.slice(1).map((scenarioId) => `scenarios/${scenarioId}.json`)].sort(compareOrdinal) }), /file set differs/)
    assert.equal(tree.scenarioManifestSha256, sha256(Buffer.from(canonicalJson(JSON.parse(manifestBytes.toString('utf8'))), 'utf8')))
  })

  test('the scenario validator rejects the named negative semantic transitions', () => {
    const expected = buildExpectedScenarios(repositoryRoot)
    const staleScenario = expected.get('existing-stale-manifest-deferred')
    const enrichedScenario = expected.get('existing-enriched-denied')
    const withMutation = (base, mutate) => {
      const clone = JSON.parse(JSON.stringify(base))
      mutate(clone)

      return () => validateScenarioObject(clone, clone.scenarioId)
    }
    assert.throws(withMutation(staleScenario, (clone) => { clone.oracles.semanticRepairOracles = [] }), /approved-repair requires/)
    assert.throws(withMutation(staleScenario, (clone) => { clone.oracles.semanticActionDispositions[0].disposition = 'deferred-repair' }), /deferred-repair|repair oracle/)
    assert.throws(withMutation(staleScenario, (clone) => {
      clone.oracles.semanticActionDispositions[0].disposition = 'partial-repair'
    }), /partial-repair/)
    assert.throws(withMutation(enrichedScenario, (clone) => {
      clone.oracles.semanticRepairOracles = JSON.parse(JSON.stringify(staleScenario.oracles.semanticRepairOracles))
      clone.oracles.semanticActionDispositions[0].disposition = 'approved-repair'
    }), /outside the expected repair|complete prose|approved-repair/)
    assert.throws(withMutation(enrichedScenario, (clone) => {
      clone.oracles.semanticRepairOracles = JSON.parse(JSON.stringify(staleScenario.oracles.semanticRepairOracles))
    }), /complete prose|repair disposition/)
    assert.throws(withMutation(staleScenario, (clone) => {
      clone.oracles.semanticRepairOracles[0].actions[0].beforeBase64 = Buffer.from('unexpected bytes\n', 'utf8').toString('base64')
    }), /outside the expected repair/)
    const ambiguousScenario = expected.get('existing-ambiguous-unavailable')
    assert.throws(withMutation(ambiguousScenario, (clone) => {
      clone.oracles.semanticDecisions[0].conceptIds = clone.oracles.semanticDecisions[0].conceptIds.slice(1)
    }), /defers the complete concept set/)
    assert.throws(withMutation(staleScenario, (clone) => { clone.oracles.terminalRepositories.enabled.base.git.kind = 'git' }), /non-approved enabled terminal|trackedPaths|initial image/)
    assert.throws(withMutation(staleScenario, (clone) => { clone.conversation.approvalResponse = APPROVAL_RESPONSES.approved }), /exact approval response/)
    assert.throws(withMutation(staleScenario, (clone) => { clone.oracles.approvalBranch = 'unavailable' }), /null approval response/)
  })

  test('terminal members carry host-dependent guidance entries and the deferred marker expectation', () => {
    const tree = loadHostFixtureTree(repositoryRoot)
    const compositions = loadTemplateCompositions(repositoryRoot)
    const guidanceImages = { 'claude-code': compositions.get('guidance.claude'), codex: compositions.get('guidance.codex') }
    const platformEolGuidanceImages = { 'claude-code': materializeWindowsLivePlatformEol(guidanceImages['claude-code']), codex: materializeWindowsLivePlatformEol(guidanceImages.codex) }
    const guidanceNames = { 'claude-code': 'CLAUDE.md', codex: 'AGENTS.md' }
    for (const scenarioId of SCENARIO_IDS) {
      const { object } = tree.scenarios.get(scenarioId)
      const platformEolSourced = scenarioId === 'existing-legacy-history-approved'
      for (const mode of ['enabled', 'disabled']) {
        const member = object.oracles.terminalRepositories[mode]
        for (const host of ['claude-code', 'codex']) {
          if (GUIDANCE_SCENARIO_IDS.includes(scenarioId)) {
            const expectedImage = platformEolSourced ? platformEolGuidanceImages[host] : guidanceImages[host]
            assert.deepEqual(member.hostEntries[host], [{ contentBase64: expectedImage.toString('base64'), kind: 'file', mode: 420, path: guidanceNames[host] }], `${scenarioId} ${mode} ${host} must carry its host guidance composition in its derived newline style`)
            if (platformEolSourced) {
              assert.notEqual(member.hostEntries[host][0].contentBase64, guidanceImages[host].toString('base64'), `${scenarioId} ${mode} ${host} platform-EOL-sourced guidance must not regress to LF`)
            }
          } else {
            assert.deepEqual(member.hostEntries[host], [], `${scenarioId} ${mode} ${host} must carry no host-dependent entry`)
          }
          const merged = selectTerminalExpectation(member, host)
          assert.deepEqual(merged.git, member.base.git)
          assert.equal(merged.entries.some((entry) => entry.path === ELECTION_MARKER_PATH), false, 'the marker file is never an expected entry')
          assert.deepEqual(merged.entries.map((entry) => entry.path), [...merged.entries.map((entry) => entry.path)].sort(compareOrdinal))
          assert.equal(merged.entries.length, member.base.entries.length + member.hostEntries[host].length)
        }
        const expectedMarker = scenarioId === 'fresh-plans-only-election-deferred-approved' && mode === 'enabled' ? { state: 'deferred' } : null
        assert.deepEqual(member.marker, expectedMarker, `${scenarioId} ${mode} marker expectation drifted`)
      }
    }
  })

  test('the live election marker is judged structurally, never byte-exactly', () => {
    const root = '/runs/7/repo'
    const markerObject = { protocolVersion: 1, root, snapshotId: 'a'.repeat(64), state: 'deferred' }
    const markerBytes = Buffer.from(canonicalJson(markerObject) + '\n', 'utf8')
    validateLiveElectionMarker({ bytes: markerBytes, expectedState: 'deferred', mode: 384, platform: 'linux', root })
    validateLiveElectionMarker({ bytes: markerBytes, expectedState: 'deferred', mode: null, platform: 'win32', root })
    const withBytes = (mutate) => {
      const clone = JSON.parse(JSON.stringify(markerObject))
      mutate(clone)

      return Buffer.from(canonicalJson(clone) + '\n', 'utf8')
    }
    assert.throws(() => validateLiveElectionMarker({ bytes: withBytes((clone) => { clone.state = 'track' }), expectedState: 'deferred', mode: 384, platform: 'linux', root }), /structural expectation/)
    assert.throws(() => validateLiveElectionMarker({ bytes: withBytes((clone) => { clone.root = '/runs/8/repo' }), expectedState: 'deferred', mode: 384, platform: 'linux', root }), /structural expectation/)
    assert.throws(() => validateLiveElectionMarker({ bytes: withBytes((clone) => { clone.snapshotId = 'nope' }), expectedState: 'deferred', mode: 384, platform: 'linux', root }), /structural expectation/)
    assert.throws(() => validateLiveElectionMarker({ bytes: withBytes((clone) => { clone.extra = true }), expectedState: 'deferred', mode: 384, platform: 'linux', root }), /exactly the keys/)
    assert.throws(() => validateLiveElectionMarker({ bytes: Buffer.from(canonicalJson(markerObject), 'utf8'), expectedState: 'deferred', mode: 384, platform: 'linux', root }), /one LF/)
    assert.throws(() => validateLiveElectionMarker({ bytes: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), markerBytes]), expectedState: 'deferred', mode: 384, platform: 'linux', root }), /BOM/)
    assert.throws(() => validateLiveElectionMarker({ bytes: Buffer.from(JSON.stringify(markerObject, null, 2) + '\n', 'utf8'), expectedState: 'deferred', mode: 384, platform: 'linux', root }), /canonical JSON/)
    assert.throws(() => validateLiveElectionMarker({ bytes: markerBytes, expectedState: 'deferred', mode: 420, platform: 'linux', root }), /0o600/)
    assert.throws(() => validateLiveElectionMarker({ bytes: markerBytes, expectedState: 'deferred', mode: 384, platform: 'win32', root }), /0o600/)
  })

  test('the terminal member schema rejects the ruled negative mutations', () => {
    const expected = buildExpectedScenarios(repositoryRoot)
    const trackScenario = expected.get('fresh-empty-track-approved')
    const deferredScenario = expected.get('fresh-plans-only-election-deferred-approved')
    const withMutation = (base, mutate) => {
      const clone = JSON.parse(JSON.stringify(base))
      mutate(clone)

      return () => validateScenarioObject(clone, clone.scenarioId)
    }
    assert.throws(withMutation(trackScenario, (clone) => {
      clone.oracles.terminalRepositories.enabled.hostEntries = { 'claude-code': clone.oracles.terminalRepositories.enabled.hostEntries['claude-code'] }
    }), /exactly the keys/)
    assert.throws(withMutation(trackScenario, (clone) => {
      clone.oracles.terminalRepositories.enabled.hostEntries.macos = []
    }), /exactly the keys/)
    assert.throws(withMutation(trackScenario, (clone) => {
      const entries = clone.oracles.terminalRepositories.enabled.hostEntries['claude-code']
      entries.push({ ...entries[0] })
    }), /duplicate-free and ordinal-path sorted/)
    assert.throws(withMutation(trackScenario, (clone) => {
      const entries = clone.oracles.terminalRepositories.enabled.hostEntries['claude-code']
      entries.unshift({ contentBase64: '', kind: 'file', mode: 420, path: 'ZZZ.md' })
    }), /ordinal-path sorted/)
    assert.throws(withMutation(trackScenario, (clone) => {
      clone.oracles.terminalRepositories.enabled.hostEntries['claude-code'][0].path = '.gitignore'
    }), /collides with a base entry/)
    assert.throws(withMutation(trackScenario, (clone) => {
      clone.oracles.terminalRepositories.enabled.hostEntries.codex[0].path = ELECTION_MARKER_PATH
    }), /election marker path/)
    assert.throws(withMutation(trackScenario, (clone) => {
      const member = clone.oracles.terminalRepositories.enabled
      member.base.entries.push({ contentBase64: '', kind: 'file', mode: 420, path: ELECTION_MARKER_PATH })
      member.base.entries.sort((left, right) => compareOrdinal(left.path, right.path))
    }), /election marker path/)
    assert.throws(withMutation(deferredScenario, (clone) => {
      clone.oracles.terminalRepositories.enabled.marker = { state: 'sometimes' }
    }), /marker\.state is invalid/)
    assert.throws(withMutation(trackScenario, (clone) => {
      clone.oracles.terminalRepositories.enabled.marker = { state: 'deferred' }
    }), /outside an approved deferred election/)
    assert.throws(withMutation(deferredScenario, (clone) => {
      clone.oracles.terminalRepositories.disabled.marker = { state: 'deferred' }
    }), /outside an approved deferred election/)
    assert.throws(withMutation(expected.get('existing-enriched-denied'), (clone) => {
      clone.oracles.terminalRepositories.enabled.hostEntries.codex = [{ contentBase64: '', kind: 'file', mode: 420, path: 'AGENTS.md' }]
    }), /initial image with no host-dependent effect/)
  })

  test('the import case matrix equals its exact authoring expansion', () => {
    const { object } = readCanonicalFixture(fixturePath(`${IMPORT_FIXTURE_DIRECTORY}/cases.json`))
    const expected = buildExpectedImportCases()
    assert.equal(expected.length, 42)
    assert.deepEqual(object, expected)
    const caseIds = object.map((entry) => entry.caseId)
    assert.equal(new Set(caseIds).size, 42)
    const sentinels = object.map((entry) => entry.expectedSentinel).filter((sentinel) => sentinel !== null)
    assert.equal(new Set(sentinels).size, sentinels.length, 'every non-null sentinel must be unique')
    for (const entry of object) {
      requireExactKeys(entry, ['adapterBase64', 'caseId', 'expectedSentinel', 'files'], 'import case')
      assert.ok(isCanonicalBase64(entry.adapterBase64))
      assert.ok(entry.expectedSentinel === null || /^[0-9a-f]{32}$/.test(entry.expectedSentinel))
      assert.ok(isOrdinalSortedUnique(entry.files.map((file) => file.path)), `${entry.caseId} files must be ordinal-path sorted`)
      const sentinel = importSentinel(entry.caseId)
      const adapter = Buffer.from(entry.adapterBase64, 'base64').toString('utf8')
      assert.equal(adapter.includes(sentinel), false, `${entry.caseId} sentinel must never appear in the adapter`)
      const carriers = entry.files.filter((file) => Buffer.from(file.contentBase64, 'base64').toString('utf8').includes(sentinel))
      assert.equal(carriers.length, 1, `${entry.caseId} sentinel must occur in exactly one imported file`)
    }
  })

  test('the import whitespace coverage expands the exact ordered code-point array', () => {
    const { object } = readCanonicalFixture(fixturePath(`${IMPORT_FIXTURE_DIRECTORY}/cases.json`))
    const whitespaceCases = object.slice(17)
    assert.equal(whitespaceCases.length, 25)
    assert.deepEqual(whitespaceCases.map((entry) => entry.caseId), WHITESPACE_CODE_POINTS.map((codePoint) => `whitespace-${codePoint.toString(16).padStart(4, '0')}`))
    for (const [index, entry] of whitespaceCases.entries()) {
      const adapter = Buffer.from(entry.adapterBase64, 'base64').toString('utf8')
      assert.equal(adapter, `# CLAUDE.md\n\nprefix${String.fromCodePoint(WHITESPACE_CODE_POINTS[index])}@imports/${entry.caseId}.md\n`)
      assert.equal(entry.expectedSentinel, importSentinel(entry.caseId))
    }
  })

  test('the compatibility record pins the cases digest with both probe fields null', () => {
    const casesBytes = readFileSync(fixturePath(`${IMPORT_FIXTURE_DIRECTORY}/cases.json`))
    const casesSha256 = sha256(casesBytes.subarray(0, casesBytes.length - 1))
    const { object } = readCanonicalFixture(fixturePath(`${IMPORT_FIXTURE_DIRECTORY}/compatibility.json`))
    validateCompatibilityRecord(object, casesSha256)
    assert.deepEqual(object, { casesSha256, claudeVersion: null, probedOn: null, schemaVersion: 1 })
    validateCompatibilityRecord({ casesSha256, claudeVersion: '2.1.0 (Claude Code)', probedOn: '2026-08-27', schemaVersion: 1 }, casesSha256)
    assert.throws(() => validateCompatibilityRecord({ casesSha256, claudeVersion: '2.1.0', probedOn: null, schemaVersion: 1 }, casesSha256), /both/)
    assert.throws(() => validateCompatibilityRecord({ casesSha256, claudeVersion: null, probedOn: '2026-08-27', schemaVersion: 1 }, casesSha256), /both/)
    assert.throws(() => validateCompatibilityRecord({ casesSha256: '0'.repeat(64), claudeVersion: null, probedOn: null, schemaVersion: 1 }, casesSha256), /identity/)
  })

  test('the import fixture directory is closed to its two leaves', () => {
    assert.deepEqual(listTree(fixturePath(IMPORT_FIXTURE_DIRECTORY)), ['cases.json', 'compatibility.json'])
    const evalLeaves = listTree(fixturePath(EVAL_FIXTURE_DIRECTORY))
    assert.ok(evalLeaves.includes('turn.schema.json'))
    for (const leaf of evalLeaves) {
      assert.ok(['controller-proxy.js', 'turn.schema.json'].includes(leaf), `unexpected evaluation fixture leaf: ${leaf}`)
    }
  })

  test('every closed fixture leaf is attribute-pinned to unset text and unspecified eol', () => {
    const attributes = checkAttributes(repositoryRoot, CLOSED_FUTURE_FIXTURE_LEAVES)
    for (const leaf of CLOSED_FUTURE_FIXTURE_LEAVES) {
      assert.equal(attributes.get(leaf).text, 'unset', `${leaf} must carry -text`)
      assert.equal(attributes.get(leaf).eol, 'unspecified', `${leaf} must carry no eol attribute`)
    }
  })

  test('the exact host entrypoint envelopes are pinned per host', () => {
    const sample = { controllerProxy: '/runs/1/enabled-plugin/skills/init-backlog/init-backlog.js', scenarioPrompt: INITIAL_PROMPT, turnSchema: '/runs/1/turn.schema.json' }
    const claudeEnvelope = buildEvaluationEnvelope('claude-code', sample)
    const codexEnvelope = buildEvaluationEnvelope('codex', sample)
    assert.equal(claudeEnvelope, canonicalJson({ nightshiftEvaluation: { controllerProxy: sample.controllerProxy, entrypoint: '/nightshift:init-backlog', instructions: ENVELOPE_INSTRUCTIONS, turnSchema: sample.turnSchema, version: 1 }, scenarioPrompt: INITIAL_PROMPT }))
    assert.ok(claudeEnvelope.includes('"entrypoint":"/nightshift:init-backlog"'))
    assert.ok(codexEnvelope.includes('"entrypoint":"$nightshift:init-backlog"'))
    assert.notEqual(claudeEnvelope, codexEnvelope)
    assert.deepEqual(ENVELOPE_INSTRUCTIONS, [
      'Invoke the entrypoint.',
      'Route every controller call through controllerProxy.',
      'At each user or manifest decision boundary, emit one turnSchema object and stop.',
      'Emit only the turnSchema object; put every presented carrier in its presentation field.',
    ])
    const reordered = canonicalJson({ nightshiftEvaluation: { controllerProxy: sample.controllerProxy, entrypoint: '/nightshift:init-backlog', instructions: [...ENVELOPE_INSTRUCTIONS].reverse(), turnSchema: sample.turnSchema, version: 1 }, scenarioPrompt: INITIAL_PROMPT })
    assert.notEqual(claudeEnvelope, reordered, 'instruction order is part of the envelope')
  })

  test('host-context gates, responses, and no-inspect branches are pinned', () => {
    assert.deepEqual(HOST_CONTEXTS.codex, { claudeContextSource: null, claudeRootExclusionStatus: null, codexContextSource: 'user-confirmed', codexInvocationDirectory: '.', codexProjectDocMaxBytes: 32768, codexProjectInstructions: [] })
    assert.equal(CODEX_HOST_CONTEXT_CONFIRMATION.startsWith('Confirm fixed guidance candidates AGENTS.override.md and AGENTS.md'), true)
    assert.equal(CODEX_HOST_CONTEXT_CONFIRMATION.endsWith('invocation directory repository root (.).'), true)
    const rootPath = 'CLAUDE.md'
    assert.deepEqual(classifyClaudeInspectAuthorization({ loadedMemoryPaths: [rootPath], rootPath, rootPresent: true, scriptedResponse: null }), { authorization: 'inspect', hostContext: HOST_CONTEXTS.claudePresentRoot })
    assert.deepEqual(classifyClaudeInspectAuthorization({ loadedMemoryPaths: [], rootPath, rootPresent: true, scriptedResponse: null }), { authorization: 'none', reasonCode: 'guidance-resolution' })
    assert.deepEqual(classifyClaudeInspectAuthorization({ loadedMemoryPaths: null, rootPath, rootPresent: true, scriptedResponse: null }), { authorization: 'none', reasonCode: 'guidance-resolution' })
    assert.deepEqual(classifyClaudeInspectAuthorization({ loadedMemoryPaths: null, rootPath, rootPresent: false, scriptedResponse: CLAUDE_ROOT_EXCLUSION_CONFIRMATION }), { authorization: 'inspect', gateId: 'claude-root-exclusion-confirmation', hostContext: HOST_CONTEXTS.claudeMissingRoot })
    assert.deepEqual(classifyClaudeInspectAuthorization({ loadedMemoryPaths: null, rootPath, rootPresent: false, scriptedResponse: null }), { authorization: 'none', reasonCode: 'guidance-resolution' })
    assert.deepEqual(classifyClaudeInspectAuthorization({ loadedMemoryPaths: null, rootPath, rootPresent: false, scriptedResponse: 'Denied.' }), { authorization: 'none', reasonCode: 'guidance-resolution' })
    assert.equal(HOST_CONTROL_RECORDS.disclosureAcknowledgement, '[nightshift-eval-host-control] disclosure recorded; continue.')
    assert.equal(HOST_CONTROL_RECORDS.unavailable, '[nightshift-eval-host-control] no user response is available.')
    assert.equal(HOST_CONTROL_RECORDS.autoDenied, '[nightshift-eval-host-control] manifest approval was auto-denied without a user decision.')
  })

  test('sample structured turns pass and mutated turns fail the closed grammar', () => {
    const digest = 'a'.repeat(64)
    const disclosureTurn = {
      gateId: 'action-disclosure',
      phase: 'awaiting-response',
      presentation: {
        actionDisclosures: [{ actionId: 'p-' + 'a'.repeat(62), chunkCount: 1, chunkIndex: 0, endByte: 5, image: 'after', kind: 'decoded-content', proposalDigest: digest, rawSha256: digest, selection: 'selected', startByte: 0, target: '.claude/QUICK_WINS.md', text: 'hello' }],
        ambiguityIds: [],
        disclosureCodes: [],
        manifestProposal: null,
        result: null,
      },
      semanticClassifications: [],
    }
    validateTurnObject(disclosureTurn)
    const finishedTurn = {
      gateId: null,
      phase: 'finished',
      presentation: { actionDisclosures: [], ambiguityIds: [], disclosureCodes: [], manifestProposal: null, result: { approvalBranch: 'denied', reasonCode: 'denied' } },
      semanticClassifications: [],
    }
    validateTurnObject(finishedTurn)
    const mutate = (base, mutation) => {
      const clone = JSON.parse(JSON.stringify(base))
      mutation(clone)

      return () => validateTurnObject(clone)
    }
    assert.throws(mutate(disclosureTurn, (turn) => { turn.gateId = null }), /gateId/)
    assert.throws(mutate(finishedTurn, (turn) => { turn.gateId = 'manifest-approval' }), /gateId/)
    assert.throws(mutate(finishedTurn, (turn) => { turn.presentation.result = null }), /result/)
    assert.throws(mutate(disclosureTurn, (turn) => { turn.presentation.result = { approvalBranch: 'denied', reasonCode: 'denied' } }), /result/)
    assert.throws(mutate(disclosureTurn, (turn) => { turn.presentation.disclosureCodes = ['other'] }), /disclosureCodes/)
    assert.throws(mutate(disclosureTurn, (turn) => { turn.presentation.disclosureCodes = ['external-writer-window', 'external-writer-window'] }), /disclosureCodes/)
    assert.throws(mutate(disclosureTurn, (turn) => { turn.presentation.actionDisclosures[0].text = '' }), /text/)
    assert.throws(mutate(disclosureTurn, (turn) => { delete turn.presentation.actionDisclosures[0].rawSha256 }), /decoded-content/)
    assert.throws(mutate(disclosureTurn, (turn) => { turn.presentation.actionDisclosures[0].contentBase64 = 'aGk=' }), /decoded-content/)
    assert.throws(mutate(disclosureTurn, (turn) => {
      turn.presentation.actionDisclosures[0] = { actionId: 'p-' + 'a'.repeat(62), afterRawSha256: digest, beforeRawSha256: digest, extent: 'complete-file', kind: 'breakout-digest', notice: 'Images withheld.', proposalDigest: digest, selection: 'selected', target: '.claude/FEATURES.md' }
    }), /breakout-digest/)
  })

  test('decoded-content disclosure chunking covers images exactly and re-fits after re-indexing', () => {
    const base = { actionId: 'p-' + 'b'.repeat(62), image: 'after', proposalDigest: 'c'.repeat(64), selection: 'selected', target: '.claude/FEATURES.md' }
    const smallBytes = Buffer.from('short disclosure image\n', 'utf8')
    const small = buildDecodedContentDisclosures({ ...base, bytes: smallBytes })
    assert.equal(small.items.length, 1)
    assert.deepEqual(reconstructDecodedContent(small.items), smallBytes)
    assert.equal(small.items[0].startByte, 0)
    assert.equal(small.items[0].endByte, smallBytes.length)
    const largeBytes = Buffer.from('x'.repeat(700000), 'utf8')
    const large = buildDecodedContentDisclosures({ ...base, bytes: largeBytes })
    assert.ok(large.items.length >= 3)
    assert.deepEqual(reconstructDecodedContent(large.items), largeBytes)
    for (const item of large.items) {
      assert.ok(disclosureTurnByteLength(item, []) <= MAX_PRESENTATION_CANONICAL_BYTES)
    }
    const largePointCount = [...largeBytes.toString('utf8')].length
    for (const item of large.items.slice(0, -1)) {
      const widened = { ...item, chunkCount: largePointCount, chunkIndex: largePointCount - 1, endByte: item.endByte + 1, text: `${item.text}x` }
      assert.ok(disclosureTurnByteLength(widened, []) > MAX_PRESENTATION_CANONICAL_BYTES, 'every nonfinal chunk must be the maximal pessimistically fitting prefix')
    }
    const multibyte = Buffer.from(String.fromCodePoint(0x10348).repeat(50000), 'utf8')
    const astral = buildDecodedContentDisclosures({ ...base, budget: 120000, bytes: multibyte })
    assert.deepEqual(reconstructDecodedContent(astral.items), multibyte)
    for (const item of astral.items) {
      assert.equal(Buffer.from(item.text, 'utf8').toString('utf8'), item.text, 'every chunk must end at a code-point boundary')
    }
  })

  test('decoded-empty, capacity, and arithmetic boundaries are pinned', () => {
    const base = { actionId: 'p-' + 'd'.repeat(62), image: 'before', proposalDigest: 'e'.repeat(64), selection: 'condition-not-selected', target: '.claude/BUGS.md' }
    const empty = buildDecodedContentDisclosures({ ...base, bytes: Buffer.alloc(0) })
    assert.deepEqual(empty.items, [{ actionId: base.actionId, byteLength: 0, image: 'before', kind: 'decoded-empty', proposalDigest: base.proposalDigest, rawSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', selection: base.selection, target: base.target }])
    assert.deepEqual(reconstructDecodedContent(empty.items), Buffer.alloc(0))
    const capacity = buildDecodedContentDisclosures({ ...base, budget: 100, bytes: Buffer.from('unfitting', 'utf8') })
    assert.deepEqual(capacity, { presentationCapacity: true })
    assert.equal(MAX_PRESENTATION_CANONICAL_BYTES, 320000)
    assert.equal(MAX_HOST_EVENT_FRAME_BYTES, 262144)
    assert.equal(MAX_PRESENTATION_CANONICAL_BYTES * 12 + MAX_HOST_EVENT_FRAME_BYTES, 4102144)
    assert.ok(MAX_PRESENTATION_CANONICAL_BYTES * 12 + MAX_HOST_EVENT_FRAME_BYTES < MAX_HOST_LINE_BYTES)
    const probe = { ...base, bytes: Buffer.from('y'.repeat(4096), 'utf8') }
    const boundaryBudget = disclosureTurnByteLength({ actionId: probe.actionId, chunkCount: 4096, chunkIndex: 4095, endByte: 4096, image: probe.image, kind: 'decoded-content', proposalDigest: probe.proposalDigest, rawSha256: sha256(probe.bytes), selection: probe.selection, startByte: 0, target: probe.target, text: probe.bytes.toString('utf8') }, [])
    const exact = buildDecodedContentDisclosures({ ...probe, budget: boundaryBudget })
    assert.equal(exact.items.length, 1, 'a turn exactly at the presentation bound fits')
    const oneUnder = buildDecodedContentDisclosures({ ...probe, budget: boundaryBudget - 1 })
    assert.equal(oneUnder.items.length, 2, 'one byte below the bound must split the image')
  })

  test('two manifests differing only in election choice and conditional dispositions have different proposal digests', () => {
    const mandatoryId = 'p-' + '1'.repeat(62)
    const electiveId = 'p-' + '2'.repeat(62)
    const baseProposal = (versionControlChoice, electiveDisposition) => ({
      actions: [{ id: mandatoryId, kind: 'create-from-template', mode: 420, newline: null, target: '.gitignore', templateId: 'gitignore.plans' }],
      proposalDispositions: [{ disposition: 'selected', proposalId: mandatoryId }, { disposition: electiveDisposition, proposalId: electiveId }],
      semanticDecisions: [],
      versionControlChoice,
      versionControlOptions: ['track', 'ignore', 'deferred'],
    })
    const trackProposal = baseProposal('track', 'condition-not-selected')
    const ignoreProposal = baseProposal('ignore', 'selected')
    assert.deepEqual({ ...trackProposal, proposalDispositions: null, versionControlChoice: null }, { ...ignoreProposal, proposalDispositions: null, versionControlChoice: null })
    assert.notEqual(proposalDigest(trackProposal), proposalDigest(ignoreProposal))
    assert.notEqual(proposalDigest(trackProposal), proposalDigest(baseProposal('track', 'selected')))
  })

  test('deterministic digest preimages pin manifests, final targets, and every branch shape', () => {
    const proposals = [{ action: null, afterBase64: 'aGk=', beforeBase64: null, condition: 'always', proposalId: 'p-' + '3'.repeat(62), reason: 'missing-target' }]
    const manifest = { actions: [], proposalDispositions: [], semanticDecisions: [], versionControlChoice: 'not-required' }
    const finalTargets = [{ kind: 'file', mode: 420, rawSha256: 'f'.repeat(64), target: '.claude/QUICK_WINS.md' }]
    const approved = { applyOk: true, approvalBranch: 'approved', finalTargets, manifest, proposals }
    validateDeterministicDigestParts(approved)
    validateDeterministicDigestParts({ applyOk: false, approvalBranch: 'approved', finalTargets: null, manifest, proposals })
    validateDeterministicDigestParts({ applyOk: null, approvalBranch: 'denied', finalTargets, manifest: null, proposals })
    assert.throws(() => validateDeterministicDigestParts({ applyOk: null, approvalBranch: 'denied', finalTargets, manifest, proposals }), /non-approved/)
    assert.throws(() => validateDeterministicDigestParts({ applyOk: true, approvalBranch: 'approved', finalTargets, manifest: null, proposals }), /approved branch/)
    assert.throws(() => validateDeterministicDigestParts({ applyOk: false, approvalBranch: 'approved', finalTargets, manifest, proposals }), /null finalTargets/)
    assert.throws(() => validateDeterministicDigestParts({ applyOk: true, approvalBranch: 'approved', finalTargets: [...finalTargets].reverse().concat(finalTargets), manifest, proposals }), /sorted/)
    const digest = deterministicDigest({ finalTargets, manifest, proposals })
    assert.match(digest, HEX64_PATTERN)
    assert.notEqual(digest, deterministicDigest({ finalTargets, manifest: { ...manifest, versionControlChoice: 'track' }, proposals }))
    assert.notEqual(digest, deterministicDigest({ finalTargets: null, manifest, proposals }))
  })

  test('runtime-derived dialogue facts follow the universal conditions', () => {
    assert.deepEqual(deriveDialogueFacts({ applyRequestOrdinals: [], approvalBranch: 'denied', approvalOrdinal: 4 }), { approvalBeforeApply: true, denialNoApply: true })
    assert.deepEqual(deriveDialogueFacts({ applyRequestOrdinals: [9], approvalBranch: 'denied', approvalOrdinal: 4 }), { approvalBeforeApply: false, denialNoApply: false })
    assert.deepEqual(deriveDialogueFacts({ applyRequestOrdinals: [9], approvalBranch: 'approved', approvalOrdinal: 4 }), { approvalBeforeApply: true, denialNoApply: true })
    assert.deepEqual(deriveDialogueFacts({ applyRequestOrdinals: [3], approvalBranch: 'approved', approvalOrdinal: 4 }), { approvalBeforeApply: false, denialNoApply: true })
    assert.deepEqual(deriveDialogueFacts({ applyRequestOrdinals: [], approvalBranch: 'unavailable', approvalOrdinal: null }), { approvalBeforeApply: true, denialNoApply: true })
    assert.deepEqual(DIALOGUE_FACT_KEYS, ['allActionsDisclosed', 'ambiguitiesAsked', 'electionPresented', 'approvalBeforeApply', 'denialNoApply'])
    assert.deepEqual(LIFECYCLE_FACT_KEYS, ['approvalApplyCardinality', 'resultPresented', 'unresolvedPresented', 'externalWriterWindowDisclosed'])
  })

  test('evidence file schemas carry both digest carriers and reject mutations', () => {
    const digest = '9'.repeat(64)
    const runRecord = { approvalBranch: 'approved', baselineManifestSha256: digest, controllerEnabled: true, host: 'claude-code', repetition: 2, runPluginRootDigest: digest, scenario: 'fresh-empty-track-approved', scenarioManifestSha256: digest, scenarioRootDigest: digest, version: '2.1.0' }
    validateRunRecord(runRecord)
    validateRunRecord({ ...runRecord, controllerEnabled: false, repetition: 1, runPluginRootDigest: null })
    assert.throws(() => validateRunRecord({ ...runRecord, repetition: 4 }), /scenario identity/)
    assert.throws(() => validateRunRecord({ ...runRecord, controllerEnabled: false, repetition: 2, runPluginRootDigest: null }), /disabled repetition/)
    assert.throws(() => validateRunRecord({ ...runRecord, scenarioManifestSha256: 'nope' }), /scenarioManifestSha256/)
    assert.throws(() => validateRunRecord({ ...runRecord, controllerEnabled: false, repetition: 1 }), /runPluginRootDigest/)
    assert.throws(() => validateRunRecord({ ...runRecord, extra: 1 }), /exactly the keys/)
    const resultRecord = {
      deterministicDigest: digest,
      dialogueFacts: { allActionsDisclosed: true, ambiguitiesAsked: true, approvalBeforeApply: true, denialNoApply: true, electionPresented: true },
      lifecycleFacts: { approvalApplyCardinality: true, externalWriterWindowDisclosed: true, resultPresented: true, unresolvedPresented: true },
      passed: true,
      semanticActionDispositions: [],
      semanticClassifications: [],
      semanticDecisionSource: 'model',
      semanticDecisions: [],
      semanticRepairOracles: [],
      structuredResult: { approvalBranch: 'denied', reasonCode: 'denied' },
      terminalRepositorySha256: digest,
    }
    validateResultRecord(resultRecord)
    assert.throws(() => validateResultRecord({ ...resultRecord, semanticDecisionSource: 'controller' }), /ownership/)
    assert.throws(() => validateResultRecord({ ...resultRecord, terminalRepositorySha256: null }), /terminalRepositorySha256/)
    assert.throws(() => validateResultRecord({ ...resultRecord, dialogueFacts: { ...resultRecord.dialogueFacts, approvalBeforeApply: 'yes' } }), /boolean/)
    const observed = { entries: [], git: { kind: 'non-git', trackedPaths: [] } }
    const attestation = { expectedSha256: digest, observed, observedSha256: sha256(Buffer.from(canonicalJson(observed), 'utf8')) }
    validateRepositoryAttestation(attestation)
    assert.throws(() => validateRepositoryAttestation({ ...attestation, observedSha256: digest }), /observed digest/)
    const files = [{ path: 'result.json', sha256: digest }, { path: 'run.json', sha256: digest }]
    const evidenceManifest = { evidenceManifestSha256: sha256(Buffer.from(canonicalJson({ files }), 'utf8')), files }
    validateEvidenceManifest(evidenceManifest)
    assert.throws(() => validateEvidenceManifest({ ...evidenceManifest, files: [...files].reverse() }), /sorted/)
    assert.throws(() => validateEvidenceManifest({ ...evidenceManifest, evidenceManifestSha256: digest }), /canonical files serialization/)
  })

  test('summary rows, transcript lines, and proxy trace lines follow their closed grammars', () => {
    const digest = '8'.repeat(64)
    const row = (controllerEnabled) => ({
      approvalBranch: 'approved',
      baselineManifestSha256: digest,
      controllerEnabled,
      deterministicDigest: controllerEnabled ? digest : null,
      dialogueFacts: { allActionsDisclosed: true, ambiguitiesAsked: true, approvalBeforeApply: true, denialNoApply: true, electionPresented: true },
      host: 'claude-code',
      lifecycleFacts: { approvalApplyCardinality: true, externalWriterWindowDisclosed: true, resultPresented: true, unresolvedPresented: true },
      passed: true,
      repetitions: controllerEnabled ? 3 : 1,
      runPluginRootDigest: controllerEnabled ? digest : null,
      scenario: 'fresh-empty-track-approved',
      scenarioManifestSha256: digest,
      scenarioRootDigest: digest,
      semanticClassifications: [],
      semanticDecisionSource: 'model',
      terminalRepositorySha256: digest,
      version: '2.1.0',
    })
    const summary = {
      evidenceManifests: [{ evidenceManifestSha256: digest, host: 'claude-code', mode: 'disabled', repetition: 1, scenario: 'fresh-empty-track-approved' }],
      rows: [row(false), row(true)],
    }
    validateSummary(summary)
    assert.throws(() => validateSummary({ ...summary, rows: [row(true), row(false)] }), /false before true/)
    assert.throws(() => validateSummary({ ...summary, rows: [{ ...row(true), repetitions: 1 }] }), /repetitions/)
    validateTranscriptLine({ kind: 'host-event', ordinal: 1, payloadBase64: 'aGk=' })
    assert.throws(() => validateTranscriptLine({ kind: 'note', ordinal: 1, payloadBase64: 'aGk=' }), /transcript/)
    assert.throws(() => validateTranscriptLine({ kind: 'input', ordinal: 0, payloadBase64: 'aGk=' }), /transcript/)
    assert.throws(() => validateTranscriptLine({ kind: 'input', ordinal: 1, payloadBase64: 'aGk' }), /transcript/)
    validateProxyTraceLine({ exitCode: 0, ordinal: 1, requestBase64: 'aGk=', stderrBase64: '', stdoutBase64: 'aGk=' })
    assert.throws(() => validateProxyTraceLine({ exitCode: 0, ordinal: 1, requestBase64: 'aGk=', stderrBase64: '', stdoutBase64: 'aGk' }), /stdoutBase64/)
  })

  if (process.argv.includes('--verify-fixture-blobs-at-head')) {
    test('every committed fixture leaf equals its current HEAD blob byte for byte', () => {
      const missing = []
      for (const leaf of COMMITTED_FIXTURE_LEAVES) {
        let blob = null
        try {
          blob = execFileSync('git', ['-C', repositoryRoot, 'cat-file', 'blob', `HEAD:${leaf}`], { windowsHide: true })
        } catch {
          // A missing HEAD blob is collected so the assertion can report every gap at once.
          missing.push(leaf)
          continue
        }
        assert.deepEqual(readFileSync(fixturePath(leaf)), blob, `working-tree bytes differ from the HEAD blob: ${leaf}`)
      }
      assert.deepEqual(missing, [], 'every expected fixture leaf must have a HEAD blob')
    })
  }
}

module.exports = {
  BREAKOUT_DIGEST_NOTICE,
  CLAUDE_ROOT_EXCLUSION_CONFIRMATION,
  ELECTION_MARKER_PATH,
  GUIDANCE_SCENARIO_IDS,
  CLOSED_FUTURE_FIXTURE_LEAVES,
  CODEX_HOST_CONTEXT_CONFIRMATION,
  COMMITTED_FIXTURE_LEAVES,
  ENTRYPOINTS,
  ENVELOPE_INSTRUCTIONS,
  HOST_CONTEXTS,
  HOST_CONTROL_RECORDS,
  MAX_HOST_EVENT_FRAME_BYTES,
  MAX_HOST_LINE_BYTES,
  MAX_PRESENTATION_CANONICAL_BYTES,
  SCENARIO_IDS,
  buildDecodedContentDisclosures,
  buildEvaluationEnvelope,
  buildExpectedImportCases,
  buildExpectedScenarios,
  loadHostFixtureTree,
  runOracleCases,
  selectTerminalExpectation,
  validateLiveElectionMarker,
  validateScenarioObject,
  validateTurnObject,
}
