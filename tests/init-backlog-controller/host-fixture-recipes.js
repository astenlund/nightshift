'use strict'

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const { canonicalJson, compareOrdinal, sha256 } = require('./helpers')
const { APPROVAL_RESPONSES, FEATURES_CONCEPTS, INITIAL_PROMPT, QUICK_WINS_CONCEPTS, SCENARIO_IDS } = require('./host-fixture-oracles')
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

module.exports = { buildExpectedScenarios, loadTemplateCompositions, materializeWindowsLivePlatformEol }
