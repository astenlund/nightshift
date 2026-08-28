'use strict'

const assert = require('node:assert/strict')
const { existsSync, readFileSync } = require('node:fs')
const { join } = require('node:path')

const { canonicalJson, compareOrdinal, sha256 } = require('./helpers')

const ASSET_ROWS = [
  ['backlog.bugs', 'bugs.md'], ['backlog.bugs-history', 'bugs-history.md'], ['backlog.features', 'features.md'], ['backlog.features-history', 'features-history.md'],
  ['backlog.patterns', 'patterns.md'], ['backlog.quick-wins', 'quick-wins.md'], ['backlog.quick-wins-history', 'quick-wins-history.md'],
  ['gitignore.backlog', 'backlog-ignore.txt'], ['gitignore.plans', 'plans-ignore.txt'], ['guidance.claude-prologue', 'claude-prologue.md'],
  ['guidance.codex-prologue', 'codex-prologue.md'], ['guidance.section', 'root-guidance.md'],
]

const CONCEPTS = {
  'backlog.bugs': ['bugs.dependency-grammar', 'bugs.history-archive', 'bugs.index-on-demand', 'bugs.inline-or-breakout', 'bugs.line-discipline', 'bugs.ready-after-add'],
  'backlog.bugs-history': ['bugs-history.append-fixed', 'bugs-history.archaeological-on-demand', 'bugs-history.breakout-records-remain', 'bugs-history.ready-exclusion'],
  'backlog.features': ['features.dependency-grammar', 'features.entry-grammar', 'features.exploring-drafts', 'features.history-archive', 'features.index-on-demand', 'features.informal-partial-progress', 'features.line-discipline', 'features.ready-after-add-or-graduate', 'features.slicing'],
  'backlog.features-history': ['features-history.append-shipped', 'features-history.archaeological-on-demand', 'features-history.breakout-records-remain', 'features-history.ready-exclusion'],
  'backlog.patterns': ['patterns.cross-cutting-definition', 'patterns.graduation-linking', 'patterns.index-on-demand', 'patterns.line-discipline', 'patterns.ready-registry-exclusion'],
  'backlog.quick-wins': ['quick-wins.active-themed-inline', 'quick-wins.capture-shorthand', 'quick-wins.history-archive', 'quick-wins.index-on-demand', 'quick-wins.line-discipline', 'quick-wins.negative-knowledge-promotion', 'quick-wins.ready-after-add', 'quick-wins.stable-entry-anchors'],
  'backlog.quick-wins-history': ['quick-wins-history.append-shipped', 'quick-wins-history.archaeological-on-demand', 'quick-wins-history.negative-knowledge-promotion', 'quick-wins-history.ready-exclusion', 'quick-wins-history.recoverable-entry-context'],
  'guidance.section': ['root-guidance.agreement-freshness', 'root-guidance.compatible-contract-fit-autonomy', 'root-guidance.consult-indexes', 'root-guidance.dependency-walk-and-exploring', 'root-guidance.final-presentation-agreement', 'root-guidance.line-discipline', 'root-guidance.locations-and-histories', 'root-guidance.readiness-needs-agreement'],
}

const TEMPLATE_ROWS = [
  ['backlog.bugs', '.claude/BUGS.md', ['backlog.bugs']], ['backlog.bugs-history', '.claude/BUGS_HISTORY.md', ['backlog.bugs-history']],
  ['backlog.features', '.claude/FEATURES.md', ['backlog.features']], ['backlog.features-history', '.claude/FEATURES_HISTORY.md', ['backlog.features-history']],
  ['backlog.patterns', '.claude/PATTERNS.md', ['backlog.patterns']], ['backlog.quick-wins', '.claude/QUICK_WINS.md', ['backlog.quick-wins']],
  ['backlog.quick-wins-history', '.claude/QUICK_WINS_HISTORY.md', ['backlog.quick-wins-history']], ['gitignore.backlog', '.gitignore', ['gitignore.backlog']],
  ['gitignore.plans', '.gitignore', ['gitignore.plans']], ['guidance.claude', '@resolved-guidance', ['guidance.claude-prologue', 'guidance.section']],
  ['guidance.codex', '@resolved-guidance', ['guidance.codex-prologue', 'guidance.section']], ['guidance.section', '@resolved-guidance', ['guidance.section']],
]

const REGION_ROWS = {
  '.claude/BUGS.md': [['bugs.document-preamble', 'markdown-preamble', '# Bugs', 'forbidden', true], ['bugs.empty-document', 'empty-document', null, 'start', false], ['bugs.requires-lines', 'markdown-section', '## Requires lines', 'end', true]],
  '.claude/BUGS_HISTORY.md': [['bugs-history.cross-reference-resolution', 'markdown-section', '## Cross-reference resolution', 'end', true], ['bugs-history.document-preamble', 'markdown-preamble', '# Bugs (history)', 'forbidden', true], ['bugs-history.empty-document', 'empty-document', null, 'start', false]],
  '.claude/FEATURES.md': [['features.document-preamble', 'markdown-preamble', '# Features', 'forbidden', true], ['features.empty-document', 'empty-document', null, 'start', false], ['features.exploring-preamble', 'markdown-preamble', '## Exploring', 'end', true], ['features.requires-lines', 'markdown-section', '## Requires lines', 'end', true], ['features.slicing', 'markdown-section', '## Slicing', 'end', true]],
  '.claude/FEATURES_HISTORY.md': [['features-history.cross-reference-resolution', 'markdown-section', '## Cross-reference resolution', 'end', true], ['features-history.document-preamble', 'markdown-preamble', '# Features (history)', 'forbidden', true], ['features-history.empty-document', 'empty-document', null, 'start', false]],
  '.claude/PATTERNS.md': [['patterns.document-preamble', 'markdown-preamble', '# Patterns', 'forbidden', true], ['patterns.empty-document', 'empty-document', null, 'start', false]],
  '.claude/QUICK_WINS.md': [['quick-wins.document-preamble', 'markdown-preamble', '# Quick wins', 'forbidden', true], ['quick-wins.empty-document', 'empty-document', null, 'start', false]],
  '.claude/QUICK_WINS_HISTORY.md': [['quick-wins-history.cross-reference-resolution', 'markdown-section', '## Cross-reference resolution', 'end', true], ['quick-wins-history.document-preamble', 'markdown-preamble', '# Quick wins (history)', 'forbidden', true], ['quick-wins-history.empty-document', 'empty-document', null, 'start', false]],
  '.gitignore': [['gitignore.empty-document', 'empty-document', null, 'start', false], ['gitignore.policy-append', 'gitignore-append', null, 'end', false]],
  '@resolved-guidance': [['root-guidance.backlogs-and-indexes', 'markdown-section', '## Backlogs and indexes', 'end', true], ['root-guidance.empty-document', 'empty-document', null, 'start', false]],
}

const TARGET_ROWS = [
  ['.claude', 'directory', 'always', null], ['.claude/BUGS.md', 'file', 'always', 'backlog.bugs'], ['.claude/BUGS_HISTORY.md', 'file', 'always', 'backlog.bugs-history'],
  ['.claude/FEATURES.md', 'file', 'always', 'backlog.features'], ['.claude/FEATURES_HISTORY.md', 'file', 'always', 'backlog.features-history'], ['.claude/PATTERNS.md', 'file', 'always', 'backlog.patterns'],
  ['.claude/QUICK_WINS.md', 'file', 'always', 'backlog.quick-wins'], ['.claude/QUICK_WINS_HISTORY.md', 'file', 'always', 'backlog.quick-wins-history'], ['.claude/bugs', 'directory', 'always', null],
  ['.claude/features', 'directory', 'always', null], ['.claude/patterns', 'directory', 'always', null], ['.claude/plans', 'directory', 'always', null],
  ['.gitignore', 'file', 'git-only', 'gitignore.plans'], ['@resolved-guidance', 'file', 'always', 'resolved-guidance'],
]

const FILE_HEADING_BY_ASSET = {
  'bugs.md': '.claude/BUGS.md', 'bugs-history.md': '.claude/BUGS_HISTORY.md', 'features.md': '.claude/FEATURES.md', 'features-history.md': '.claude/FEATURES_HISTORY.md',
  'patterns.md': '.claude/PATTERNS.md', 'quick-wins.md': '.claude/QUICK_WINS.md', 'quick-wins-history.md': '.claude/QUICK_WINS_HISTORY.md',
}

function logicalText(bytes, finalNewline, name) {
  assert.equal(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), false, `${name} must not carry a BOM`)
  assert.equal(bytes.includes(0), false, `${name} must not contain NUL`)
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    assert.fail(`${name} must be valid UTF-8`)
  }
  assert.equal(/\r(?!\n)/.test(text) || /(?<!\r)\n/.test(text) && text.includes('\r\n'), false, `${name} must use one newline style`)
  const logical = text.replace(/\r\n/g, '\n')
  assert.equal(logical.endsWith('\n'), finalNewline, `${name} final-newline declaration differs from bytes`)

  return logical
}

function exactKeys(value, keys, name) {
  assert.deepEqual(Object.keys(value).sort(compareOrdinal), [...keys].sort(compareOrdinal), `${name} keys drifted`)
}

function assetPath(root, relativePath) {
  const target = join(root, relativePath)
  assert.equal(existsSync(target), true, `missing asset ${relativePath}`)

  return target
}

const BASELINE_PROMPT_PATH = ['tests', 'fixtures', 'init-backlog-prompt-baseline', 'skills', 'init-backlog', 'SKILL.md']
const PLANS_BULLET_BASELINE = '- `.claude/plans/<date>-<slug>.md`: implementation plans produced by the writing-plans workflow. **Ephemeral**: a plan exists while the implementation is in flight and is deleted once the work lands. The code, tests, and commits are the durable record. Plans are purely mechanical step-by-step instructions for the agent doing the work. There is no "implemented plans" archive.'
const PLANS_BULLET_ACTIVATED = `${PLANS_BULLET_BASELINE} Plans are never committed: in a Git repository, \`.claude/plans/\` is git-ignored by the repository-local \`.gitignore\`, independent of any track-or-ignore election for the durable backlog files.`

function readBaselinePrompt(root) {
  return readFileSync(join(root, ...BASELINE_PROMPT_PATH), 'utf8').replace(/\r\n/g, '\n')
}

function expectedPromptAssets(root) {
  const prompt = readBaselinePrompt(root)
  const expected = new Map()
  for (const [fileName, heading] of Object.entries(FILE_HEADING_BY_ASSET)) {
    const marker = `### \`${heading}\`\n\n~~~markdown\n`
    const start = prompt.indexOf(marker)
    assert.notEqual(start, -1, `prompt baseline lacks ${heading}`)
    const contentStart = start + marker.length
    const end = prompt.indexOf('\n~~~', contentStart)
    assert.notEqual(end, -1, `prompt baseline lacks closing block for ${heading}`)
    expected.set(fileName, prompt.slice(contentStart, end) + '\n')
  }
  const claudeMarker = '### `CLAUDE.md` (fresh minimal file)\n\n~~~markdown\n'
  const claudeStart = prompt.indexOf(claudeMarker)
  const claudeContentStart = claudeStart + claudeMarker.length
  const claudeEnd = prompt.indexOf('\n~~~', claudeContentStart)
  const claude = prompt.slice(claudeContentStart, claudeEnd) + '\n'
  const sectionStart = claude.indexOf('## Backlogs and indexes\n')
  expected.set('root-guidance.md', claude.slice(sectionStart))
  expected.set('claude-prologue.md', claude.slice(0, sectionStart))
  expected.set('codex-prologue.md', '# AGENTS.md\n\nThis file provides guidance to coding agents working in this repository.\n\n')
  expected.set('plans-ignore.txt', '.claude/plans/\n')
  expected.set('backlog-ignore.txt', '.claude/QUICK_WINS.md\n.claude/FEATURES.md\n.claude/BUGS.md\n.claude/PATTERNS.md\n.claude/QUICK_WINS_HISTORY.md\n.claude/FEATURES_HISTORY.md\n.claude/BUGS_HISTORY.md\n.claude/features/\n.claude/bugs/\n.claude/patterns/\n')

  return expected
}

function expectedQuickWinReplacementAssets(prompt, expected) {
  const arrow = String.fromCharCode(0x2192)
  const sourceSentences = [
    `Notes the negative-knowledge ${arrow} patterns Cautionary tales promotion path.`,
    `Notes the negative-knowledge ${arrow} patterns promotion path with one-line redirect convention.`,
  ]
  const replacementWord = sourceSentences.map((sentence) => {
    assert.equal(prompt.includes(sentence), true, `prompt baseline lacks ${sentence}`)
    const replacement = sentence.replace(arrow, 'to')

    return replacement.slice(replacement.indexOf('negative-knowledge ') + 'negative-knowledge '.length, replacement.indexOf(' patterns'))
  })
  const replacements = [
    ['quick-wins.md', 'from the history into the relevant', `from the history ${replacementWord[0]} the relevant`],
    ['quick-wins-history.md', 'promoting those into the relevant', `promoting those ${replacementWord[1]} the relevant`],
  ]
  const result = new Map(expected)
  for (const [assetPath, before, after] of replacements) {
    const asset = result.get(assetPath)
    assert.equal(asset.split(before).length - 1, 1, `${assetPath} must contain one approved replacement site`)
    result.set(assetPath, asset.replace(before, after))
  }

  return result
}

function expectedPlansPolicyAssets(expected) {
  const result = new Map(expected)
  const guidance = result.get('root-guidance.md')
  assert.equal(guidance.split(PLANS_BULLET_BASELINE).length - 1, 1, 'root-guidance.md must contain one baseline plans bullet to activate')
  result.set('root-guidance.md', guidance.replace(PLANS_BULLET_BASELINE, PLANS_BULLET_ACTIVATED))

  return result
}

function validateManifest(root, manifest, { readAsset = (relativePath) => readFileSync(assetPath(root, relativePath)) } = {}) {
  exactKeys(manifest, ['protocolVersion', 'assets', 'templates', 'targets'], 'manifest')
  assert.equal(manifest.protocolVersion, 1)
  assert.equal(JSON.stringify(manifest), canonicalJson(manifest), 'manifest must be canonical')
  assert.deepEqual(manifest.assets.map((entry) => entry.assetId), ASSET_ROWS.map(([id]) => id), 'asset inventory drifted')
  assert.deepEqual(manifest.templates.map((entry) => entry.templateId), TEMPLATE_ROWS.map(([id]) => id), 'template inventory drifted')
  assert.deepEqual(manifest.targets.map((entry) => entry.targetSelector), TARGET_ROWS.map(([selector]) => selector), 'target inventory drifted')
  for (const [entry, [assetId, expectedPath]] of manifest.assets.map((entry, index) => [entry, ASSET_ROWS[index]])) {
    exactKeys(entry, ['assetId', 'path', 'logicalSha256', 'finalNewline'], `asset ${assetId}`)
    assert.equal(entry.assetId, assetId)
    assert.equal(entry.path, expectedPath)
    assert.equal(entry.finalNewline, true)
    assert.match(entry.path, /^(?!.*(?:^|\/)\.\.?\/)[a-z0-9-]+\.(?:md|txt)$/)
    const logical = logicalText(readAsset(entry.path), entry.finalNewline, entry.assetId)
    assert.equal(sha256(Buffer.from(logical, 'utf8')), entry.logicalSha256, `${entry.assetId}.logicalSha256 differs`)
    assert.equal(/[^\x00-\x7f]/.test(logical), false, `${entry.assetId} contains a non-ASCII production byte`)
  }
  for (const [entry, [templateId, targetSelector, assetIds]] of manifest.templates.map((entry, index) => [entry, TEMPLATE_ROWS[index]])) {
    exactKeys(entry, ['templateId', 'targetSelector', 'assetIds', 'conceptIds'], `template ${templateId}`)
    assert.equal(entry.templateId, templateId)
    assert.equal(entry.targetSelector, targetSelector)
    assert.deepEqual(entry.assetIds, assetIds)
    assert.deepEqual(entry.conceptIds, templateId.startsWith('guidance.') ? CONCEPTS['guidance.section'] : CONCEPTS[templateId] ?? [])
  }
  for (const [entry, [targetSelector, kind, applicability, templateRule]] of manifest.targets.map((entry, index) => [entry, TARGET_ROWS[index]])) {
    exactKeys(entry, ['targetSelector', 'kind', 'applicability', 'templateRule', 'conceptIds', 'regions'], `target ${targetSelector}`)
    assert.equal(entry.targetSelector, targetSelector)
    assert.equal(entry.kind, kind)
    assert.equal(entry.applicability, applicability)
    assert.equal(entry.templateRule, templateRule)
    const concepts = templateRule === 'resolved-guidance' ? CONCEPTS['guidance.section'] : CONCEPTS[templateRule] ?? []
    assert.deepEqual(entry.conceptIds, concepts)
    const expectedRegions = REGION_ROWS[targetSelector] ?? []
    assert.deepEqual(entry.regions.map((region) => region.regionId), expectedRegions.map(([id]) => id), `${targetSelector} region ownership drifted`)
    for (const [region, [regionId, syntax, heading, missingPlacement, semantic]] of entry.regions.map((region, index) => [region, expectedRegions[index]])) {
      exactKeys(region, ['regionId', 'syntax', 'heading', 'missingPlacement', 'semantic'], `region ${regionId}`)
      assert.deepEqual(region, { regionId, syntax, heading, missingPlacement, semantic }, `malformed region ${regionId}`)
    }
  }
}

function compose(manifest, assets, templateId) {
  const template = manifest.templates.find((entry) => entry.templateId === templateId)
  assert.ok(template, `missing template ${templateId}`)

  return template.assetIds.map((assetId) => assets.get(manifest.assets.find((entry) => entry.assetId === assetId).path)).join('')
}

function runAssetCases(repositoryRoot) {
  const templatesRoot = join(repositoryRoot, 'skills', 'init-backlog', 'templates')
  const manifest = JSON.parse(readFileSync(join(templatesRoot, 'manifest.json'), 'utf8'))
  validateManifest(templatesRoot, manifest)
  const prompt = readBaselinePrompt(repositoryRoot)
  const expected = expectedPlansPolicyAssets(expectedQuickWinReplacementAssets(prompt, expectedPromptAssets(repositoryRoot)))
  const assets = new Map(manifest.assets.map((entry) => [entry.path, logicalText(readFileSync(assetPath(templatesRoot, entry.path)), entry.finalNewline, entry.assetId)]))
  for (const [fileName, expectedBytes] of expected) {
    assert.equal(assets.get(fileName), expectedBytes, `${fileName} drifted from its pinned baseline-derived body`)
  }
  assert.equal(compose(manifest, assets, 'guidance.claude'), assets.get('claude-prologue.md') + assets.get('root-guidance.md'))
  assert.equal(compose(manifest, assets, 'guidance.codex'), assets.get('codex-prologue.md') + assets.get('root-guidance.md'))
  assert.equal(compose(manifest, assets, 'guidance.section'), assets.get('root-guidance.md'))

  const badText = [Buffer.from('first\nsecond\r\n', 'utf8'), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('text\n')]), Buffer.from([0x61, 0x00, 0x0a]), Buffer.from([0xc3, 0x28])]
  for (const bytes of badText) {
    assert.throws(() => logicalText(bytes, true, 'mutation'), /newline style|BOM|NUL|UTF-8/)
  }
  assert.throws(() => logicalText(Buffer.from('text\n'), false, 'mutation'), /final-newline/)
  const digestMutation = structuredClone(manifest)
  digestMutation.assets[0].logicalSha256 = '0'.repeat(64)
  assert.throws(() => validateManifest(templatesRoot, digestMutation), /logicalSha256/)
  const nonAsciiMutation = structuredClone(manifest)
  const nonAsciiAsset = nonAsciiMutation.assets[0]
  const nonAsciiBytes = Buffer.from(`# Bugs ${String.fromCharCode(0x80)}\n`, 'utf8')
  nonAsciiAsset.logicalSha256 = sha256(nonAsciiBytes)
  assert.throws(() => validateManifest(templatesRoot, nonAsciiMutation, { readAsset: (relativePath) => relativePath === nonAsciiAsset.path ? nonAsciiBytes : readFileSync(assetPath(templatesRoot, relativePath)) }), /non-ASCII/)
  const orderingMutation = structuredClone(manifest)
  orderingMutation.assets.reverse()
  assert.throws(() => validateManifest(templatesRoot, orderingMutation), /asset inventory/)
  const duplicateMutation = structuredClone(manifest)
  duplicateMutation.templates[1].templateId = duplicateMutation.templates[0].templateId
  assert.throws(() => validateManifest(templatesRoot, duplicateMutation), /template inventory/)
  const pathMutation = structuredClone(manifest)
  pathMutation.assets[0].path = '../escape.md'
  assert.throws(() => validateManifest(templatesRoot, pathMutation), /Expected values/)
  assert.throws(() => validateManifest(templatesRoot, manifest, { readAsset: () => { throw new Error('missing asset') } }), /missing asset/)
  const conceptMutation = structuredClone(manifest)
  conceptMutation.templates[0].conceptIds = []
  assert.throws(() => validateManifest(templatesRoot, conceptMutation), /deep-equal/)
  const regionMutation = structuredClone(manifest)
  regionMutation.targets[1].regions[0].semantic = false
  assert.throws(() => validateManifest(templatesRoot, regionMutation), /malformed region/)
}

module.exports = { runAssetCases, validateManifest }
