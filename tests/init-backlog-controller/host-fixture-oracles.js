'use strict'

// Host-fixture oracles shared by the controller cases and the live cross-host
// evaluator. The scenario schema validators, the host fixture tree loader, the
// import-probe case oracles, the evaluation envelope, and the host contexts all
// have consumers on both sides of that seam, so they live here rather than in a
// cases module that would otherwise double as a library.

const assert = require('node:assert/strict')
const { readFileSync, readdirSync } = require('node:fs')
const { join } = require('node:path')

const { canonicalJson, compareOrdinal, sha256 } = require('./helpers')
const { ELECTION_MARKER_PATH, HEX64_PATTERN, LIST_SEPARATOR, requireExactKeys, selectTerminalExpectation, windowsRepositoryImage } = require('./election-oracles')

const HOST_FIXTURE_DIRECTORY = 'tests/fixtures/init-backlog-host'

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

const INITIAL_PROMPT = 'Initialize the Nightshift backlog for this repository.'
const APPROVAL_RESPONSES = { approved: 'Approve this manifest.', denied: 'Do not apply this manifest.', deferred: 'Defer this manifest.' }
const RESERVED_GATE_IDS = ['host-context-confirmation', 'claude-root-exclusion-confirmation', 'action-disclosure', 'manifest-approval']

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

const WHITESPACE_CODE_POINTS = [0x0009, 0x000b, 0x000c, 0x0020, 0x00a0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x202f, 0x205f, 0x3000, 0xfeff, 0x000a, 0x000d, 0x2028, 0x2029]

function isCanonicalBase64(value) {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return false
  }

  return Buffer.from(value, 'base64').toString('base64') === value
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

function buildEvaluationEnvelope(host, { controllerProxy, scenarioPrompt, turnSchema }) {
  assert.ok(host in ENTRYPOINTS, `unknown evaluation host: ${host}`)

  return canonicalJson({
    nightshiftEvaluation: { controllerProxy, entrypoint: ENTRYPOINTS[host], instructions: ENVELOPE_INSTRUCTIONS, turnSchema, version: 1 },
    scenarioPrompt,
  })
}

module.exports = {
  APPROVAL_RESPONSES,
  ENTRYPOINTS,
  ENVELOPE_INSTRUCTIONS,
  FEATURES_CONCEPTS,
  HOST_CONTEXTS,
  HOST_FIXTURE_DIRECTORY,
  INITIAL_PROMPT,
  QUICK_WINS_CONCEPTS,
  SCENARIO_IDS,
  WHITESPACE_CODE_POINTS,
  buildEvaluationEnvelope,
  buildExpectedImportCases,
  importSentinel,
  isCanonicalBase64,
  isOrdinalSortedUnique,
  listTree,
  loadHostFixtureTree,
  readCanonicalFixture,
  validateRepositoryObject,
  validateScenarioObject,
}
