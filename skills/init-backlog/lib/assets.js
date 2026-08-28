'use strict'

const { lstatSync, realpathSync } = require('node:fs')
const { isAbsolute, join, resolve } = require('node:path')
const { TextDecoder } = require('node:util')

const { InitBacklogError, failureRecord } = require('./errors')
const { pathIsContained, stableOpenFile } = require('./filesystem')
const { canonicalJson, compareOrdinal, sameKeys, sha256, validateDigest, validateLogicalId, validateSelector, validateTarget } = require('./protocol')

const ASSET_IDS = [
  'backlog.bugs',
  'backlog.bugs-history',
  'backlog.features',
  'backlog.features-history',
  'backlog.patterns',
  'backlog.quick-wins',
  'backlog.quick-wins-history',
  'gitignore.backlog',
  'gitignore.plans',
  'guidance.claude-prologue',
  'guidance.codex-prologue',
  'guidance.section',
]
const TEMPLATE_IDS = [
  'backlog.bugs',
  'backlog.bugs-history',
  'backlog.features',
  'backlog.features-history',
  'backlog.patterns',
  'backlog.quick-wins',
  'backlog.quick-wins-history',
  'gitignore.backlog',
  'gitignore.plans',
  'guidance.claude',
  'guidance.codex',
  'guidance.section',
]
const TARGET_SELECTORS = [
  '.claude',
  '.claude/BUGS.md',
  '.claude/BUGS_HISTORY.md',
  '.claude/FEATURES.md',
  '.claude/FEATURES_HISTORY.md',
  '.claude/PATTERNS.md',
  '.claude/QUICK_WINS.md',
  '.claude/QUICK_WINS_HISTORY.md',
  '.claude/bugs',
  '.claude/features',
  '.claude/patterns',
  '.claude/plans',
  '.gitignore',
  '@resolved-guidance',
]

const EXPECTED_TARGETS = new Map([
  ['.claude', { applicability: 'always', conceptIds: [], kind: 'directory', regions: [], templateRule: null }],
  ['.claude/BUGS.md', { applicability: 'always', conceptIds: 'bugs.dependency-grammar bugs.history-archive bugs.index-on-demand bugs.inline-or-breakout bugs.line-discipline bugs.ready-after-add', kind: 'file', regions: [
    ['bugs.document-preamble', 'markdown-preamble', '# Bugs', 'forbidden', true],
    ['bugs.empty-document', 'empty-document', null, 'start', false],
    ['bugs.requires-lines', 'markdown-section', '## Requires lines', 'end', true],
  ], templateRule: 'backlog.bugs' }],
  ['.claude/BUGS_HISTORY.md', { applicability: 'always', conceptIds: 'bugs-history.append-fixed bugs-history.archaeological-on-demand bugs-history.breakout-records-remain bugs-history.ready-exclusion', kind: 'file', regions: [
    ['bugs-history.cross-reference-resolution', 'markdown-section', '## Cross-reference resolution', 'end', true],
    ['bugs-history.document-preamble', 'markdown-preamble', '# Bugs (history)', 'forbidden', true],
    ['bugs-history.empty-document', 'empty-document', null, 'start', false],
  ], templateRule: 'backlog.bugs-history' }],
  ['.claude/FEATURES.md', { applicability: 'always', conceptIds: 'features.dependency-grammar features.entry-grammar features.exploring-drafts features.history-archive features.index-on-demand features.informal-partial-progress features.line-discipline features.ready-after-add-or-graduate features.slicing', kind: 'file', regions: [
    ['features.document-preamble', 'markdown-preamble', '# Features', 'forbidden', true],
    ['features.empty-document', 'empty-document', null, 'start', false],
    ['features.exploring-preamble', 'markdown-preamble', '## Exploring', 'end', true],
    ['features.requires-lines', 'markdown-section', '## Requires lines', 'end', true],
    ['features.slicing', 'markdown-section', '## Slicing', 'end', true],
  ], templateRule: 'backlog.features' }],
  ['.claude/FEATURES_HISTORY.md', { applicability: 'always', conceptIds: 'features-history.append-shipped features-history.archaeological-on-demand features-history.breakout-records-remain features-history.ready-exclusion', kind: 'file', regions: [
    ['features-history.cross-reference-resolution', 'markdown-section', '## Cross-reference resolution', 'end', true],
    ['features-history.document-preamble', 'markdown-preamble', '# Features (history)', 'forbidden', true],
    ['features-history.empty-document', 'empty-document', null, 'start', false],
  ], templateRule: 'backlog.features-history' }],
  ['.claude/PATTERNS.md', { applicability: 'always', conceptIds: 'patterns.cross-cutting-definition patterns.graduation-linking patterns.index-on-demand patterns.line-discipline patterns.ready-registry-exclusion', kind: 'file', regions: [
    ['patterns.document-preamble', 'markdown-preamble', '# Patterns', 'forbidden', true],
    ['patterns.empty-document', 'empty-document', null, 'start', false],
  ], templateRule: 'backlog.patterns' }],
  ['.claude/QUICK_WINS.md', { applicability: 'always', conceptIds: 'quick-wins.active-themed-inline quick-wins.capture-shorthand quick-wins.history-archive quick-wins.index-on-demand quick-wins.line-discipline quick-wins.negative-knowledge-promotion quick-wins.ready-after-add quick-wins.stable-entry-anchors', kind: 'file', regions: [
    ['quick-wins.document-preamble', 'markdown-preamble', '# Quick wins', 'forbidden', true],
    ['quick-wins.empty-document', 'empty-document', null, 'start', false],
  ], templateRule: 'backlog.quick-wins' }],
  ['.claude/QUICK_WINS_HISTORY.md', { applicability: 'always', conceptIds: 'quick-wins-history.append-shipped quick-wins-history.archaeological-on-demand quick-wins-history.negative-knowledge-promotion quick-wins-history.ready-exclusion quick-wins-history.recoverable-entry-context', kind: 'file', regions: [
    ['quick-wins-history.cross-reference-resolution', 'markdown-section', '## Cross-reference resolution', 'end', true],
    ['quick-wins-history.document-preamble', 'markdown-preamble', '# Quick wins (history)', 'forbidden', true],
    ['quick-wins-history.empty-document', 'empty-document', null, 'start', false],
  ], templateRule: 'backlog.quick-wins-history' }],
  ['.claude/bugs', { applicability: 'always', conceptIds: [], kind: 'directory', regions: [], templateRule: null }],
  ['.claude/features', { applicability: 'always', conceptIds: [], kind: 'directory', regions: [], templateRule: null }],
  ['.claude/patterns', { applicability: 'always', conceptIds: [], kind: 'directory', regions: [], templateRule: null }],
  ['.claude/plans', { applicability: 'always', conceptIds: [], kind: 'directory', regions: [], templateRule: null }],
  ['.gitignore', { applicability: 'git-only', conceptIds: [], kind: 'file', regions: [
    ['gitignore.empty-document', 'empty-document', null, 'start', false],
    ['gitignore.policy-append', 'gitignore-append', null, 'end', false],
  ], templateRule: 'gitignore.plans' }],
  ['@resolved-guidance', { applicability: 'always', conceptIds: 'root-guidance.agreement-freshness root-guidance.compatible-contract-fit-autonomy root-guidance.consult-indexes root-guidance.dependency-walk-and-exploring root-guidance.final-presentation-agreement root-guidance.line-discipline root-guidance.locations-and-histories root-guidance.readiness-needs-agreement', kind: 'file', regions: [
    ['root-guidance.backlogs-and-indexes', 'markdown-section', '## Backlogs and indexes', 'end', true],
    ['root-guidance.empty-document', 'empty-document', null, 'start', false],
  ], templateRule: 'resolved-guidance' }],
])

function expectedTargetRecord(selector, expected) {
  const conceptIds = expected.conceptIds.length === 0 ? [] : expected.conceptIds.split(' ')
  const regions = expected.regions.map(([regionId, syntax, heading, missingPlacement, semantic]) => ({ heading, missingPlacement, regionId, semantic, syntax }))

  return { applicability: expected.applicability, conceptIds, kind: expected.kind, regions, targetSelector: selector, templateRule: expected.templateRule }
}

function templateInvalid(detail, cause) {
  throw new InitBacklogError(failureRecord({ code: 'template-invalid', detail, operation: 'inspect', phase: 'inspect' }), cause === undefined ? undefined : { cause })
}

function normalizeLogicalAsset(bytes) {
  if (!Buffer.isBuffer(bytes)) {
    templateInvalid('Template asset is not a byte buffer.')
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    templateInvalid('Template asset has a byte-order mark.')
  }
  if (bytes.includes(0x00)) {
    templateInvalid('Template asset contains NUL.')
  }
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error) {
    templateInvalid('Template asset is not valid UTF-8.', error)
  }
  const hasCrlf = text.includes('\r\n')
  const withoutCrlf = text.replaceAll('\r\n', '')
  const hasLf = withoutCrlf.includes('\n')
  const hasBareCarriageReturn = withoutCrlf.includes('\r')
  if ((hasCrlf && hasLf) || hasBareCarriageReturn) {
    templateInvalid('Template asset has mixed or invalid line endings.')
  }
  const logicalText = hasCrlf ? text.replaceAll('\r\n', '\n') : text
  const logicalBytes = Buffer.from(logicalText, 'utf8')

  return {
    finalNewline: logicalBytes.length > 0 && logicalBytes[logicalBytes.length - 1] === 0x0a,
    logicalBytes,
    logicalSha256: sha256(logicalBytes),
  }
}

function composeTemplate(assets) {
  if (!Array.isArray(assets) || assets.length === 0 || assets.some((asset) => asset === null || typeof asset !== 'object' || !Buffer.isBuffer(asset.logicalBytes))) {
    templateInvalid('Template composition is invalid.')
  }
  const logicalBytes = Buffer.concat(assets.map((asset) => asset.logicalBytes))

  return { logicalBytes, logicalSha256: sha256(logicalBytes) }
}

function validateSortedUnique(items, keySelector, label) {
  for (let index = 0; index < items.length; index += 1) {
    const key = keySelector(items[index])
    if (index > 0 && compareOrdinal(keySelector(items[index - 1]), key) >= 0) {
      templateInvalid(`${label} is not unique and ordinal sorted.`)
    }
  }
}

function sameInventory(actual, expected) {
  return actual.length === expected.length && actual.every((item, index) => item === expected[index])
}

function validateConceptIds(value, label) {
  if (!Array.isArray(value)) {
    templateInvalid(`${label} concept IDs are invalid.`)
  }
  for (const conceptId of value) {
    try {
      validateLogicalId(conceptId)
    } catch (error) {
      templateInvalid(`${label} concept ID is invalid.`, error)
    }
  }
  validateSortedUnique(value, (item) => item, `${label} concept IDs`)
}

function validateManifest(manifest) {
  if (!sameKeys(manifest, ['protocolVersion', 'assets', 'templates', 'targets']) || manifest.protocolVersion !== 1 || !Array.isArray(manifest.assets) || !Array.isArray(manifest.templates) || !Array.isArray(manifest.targets)) {
    templateInvalid('Template manifest record is invalid.')
  }
  for (const asset of manifest.assets) {
    if (!sameKeys(asset, ['assetId', 'path', 'logicalSha256', 'finalNewline']) || asset.finalNewline !== true || typeof asset.path !== 'string' || asset.path.length === 0 || isAbsolute(asset.path) || asset.path.includes('\\')) {
      templateInvalid('Template asset manifest item is invalid.')
    }
    try {
      validateLogicalId(asset.assetId)
      validateTarget(asset.path)
      validateDigest(asset.logicalSha256)
    } catch (error) {
      templateInvalid('Template asset manifest item is invalid.', error)
    }
  }
  validateSortedUnique(manifest.assets, (item) => item.assetId, 'Template assets')
  if (!sameInventory(manifest.assets.map((item) => item.assetId), ASSET_IDS)) {
    templateInvalid('Template asset inventory is incomplete.')
  }

  const assets = new Map(manifest.assets.map((item) => [item.assetId, item]))
  for (const template of manifest.templates) {
    if (!sameKeys(template, ['templateId', 'targetSelector', 'assetIds', 'conceptIds']) || !Array.isArray(template.assetIds) || template.assetIds.length === 0) {
      templateInvalid('Template manifest item is invalid.')
    }
    try {
      validateLogicalId(template.templateId)
      validateSelector(template.targetSelector)
    } catch (error) {
      templateInvalid('Template manifest item is invalid.', error)
    }
    const seenAssets = new Set()
    for (const assetId of template.assetIds) {
      if (seenAssets.has(assetId) || !assets.has(assetId)) {
        templateInvalid('Template composition references an invalid asset.')
      }
      seenAssets.add(assetId)
    }
    validateConceptIds(template.conceptIds, template.templateId)
    if (template.templateId.startsWith('gitignore.') && template.conceptIds.length !== 0) {
      templateInvalid('Mechanical template has semantic concepts.')
    }
  }
  validateSortedUnique(manifest.templates, (item) => item.templateId, 'Templates')
  if (!sameInventory(manifest.templates.map((item) => item.templateId), TEMPLATE_IDS)) {
    templateInvalid('Template inventory is incomplete.')
  }

  const templates = new Map(manifest.templates.map((item) => [item.templateId, item]))
  for (const target of manifest.targets) {
    if (!sameKeys(target, ['targetSelector', 'kind', 'applicability', 'templateRule', 'conceptIds', 'regions']) || !['directory', 'file'].includes(target.kind) || !['always', 'git-only'].includes(target.applicability) || !Array.isArray(target.regions)) {
      templateInvalid('Template target manifest item is invalid.')
    }
    try {
      validateSelector(target.targetSelector)
    } catch (error) {
      templateInvalid('Template target selector is invalid.', error)
    }
    const expected = EXPECTED_TARGETS.get(target.targetSelector)
    if (expected === undefined || canonicalJson(expectedTargetRecord(target.targetSelector, expected)) !== canonicalJson(target)) {
      templateInvalid('Template target does not match the closed target contract.')
    }
    validateConceptIds(target.conceptIds, target.targetSelector)
    if (target.targetSelector === '.gitignore') {
      if (target.applicability !== 'git-only' || target.templateRule !== 'gitignore.plans') {
        templateInvalid('Gitignore target rule is invalid.')
      }
    } else if (target.applicability !== 'always') {
      templateInvalid('Only gitignore may be git-only.')
    }
    if (target.kind === 'directory') {
      if (target.templateRule !== null || target.conceptIds.length !== 0 || target.regions.length !== 0) {
        templateInvalid('Directory target rule is invalid.')
      }
    } else if (target.targetSelector === '@resolved-guidance') {
      if (target.templateRule !== 'resolved-guidance') {
        templateInvalid('Resolved guidance target rule is invalid.')
      }
    } else if (target.templateRule !== null) {
      const template = templates.get(target.templateRule)
      if (template === undefined || template.targetSelector !== target.targetSelector || canonicalJson(template.conceptIds) !== canonicalJson(target.conceptIds)) {
        templateInvalid('File target template rule is invalid.')
      }
    }
    for (const region of target.regions) {
      if (!sameKeys(region, ['regionId', 'syntax', 'heading', 'missingPlacement', 'semantic']) || !['markdown-section', 'markdown-preamble', 'empty-document', 'gitignore-append'].includes(region.syntax) || !['start', 'end', 'forbidden'].includes(region.missingPlacement) || typeof region.semantic !== 'boolean') {
        templateInvalid('Template region is invalid.')
      }
      try {
        validateLogicalId(region.regionId)
      } catch (error) {
        templateInvalid('Template region ID is invalid.', error)
      }
      const markdown = region.syntax === 'markdown-section' || region.syntax === 'markdown-preamble'
      if ((markdown && (typeof region.heading !== 'string' || region.heading.length === 0)) || (!markdown && region.heading !== null) || (region.syntax === 'empty-document' && region.missingPlacement !== 'start') || (region.syntax === 'gitignore-append' && region.missingPlacement !== 'end') || (region.semantic !== markdown)) {
        templateInvalid('Template region grammar is invalid.')
      }
    }
    validateSortedUnique(target.regions, (item) => item.regionId, `${target.targetSelector} regions`)
  }
  validateSortedUnique(manifest.targets, (item) => item.targetSelector, 'Template targets')
  if (!sameInventory(manifest.targets.map((item) => item.targetSelector), TARGET_SELECTORS)) {
    templateInvalid('Template target inventory is incomplete.')
  }

  return manifest
}

function readOrdinaryFile(root, target) {
  const rootMetadata = lstatSync(root, { bigint: true })
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    templateInvalid('Template root is not an ordinary directory.')
  }
  const resolvedRoot = realpathSync.native(root)
  if (resolvedRoot !== root) {
    templateInvalid('Template root is not canonically confined.')
  }
  const resolvedTarget = resolve(resolvedRoot, target)
  if (!pathIsContained(resolvedRoot, resolvedTarget)) {
    templateInvalid('Template asset path escapes the template root.')
  }
  try {
    return stableOpenFile(resolvedRoot, resolvedTarget, { requireSingleLink: true }).bytes
  } catch (error) {
    templateInvalid('Template asset is not an ordinary confined file.', error)
  }
}

// The default resolves the bundled templates relative to this module, which
// sits beside inspection and apply-manifest in lib/, so the resolved root is
// identical for every caller that passes no explicit templatesRoot.
function loadManifest(templatesRoot = join(__dirname, '..', 'templates')) {
  try {
    const normalizedManifest = normalizeLogicalAsset(readOrdinaryFile(templatesRoot, 'manifest.json'))
    const manifestText = normalizedManifest.logicalBytes.toString('utf8')
    const manifest = JSON.parse(manifestText)
    validateManifest(manifest)
    if (!normalizedManifest.logicalBytes.equals(Buffer.from(canonicalJson(manifest) + '\n', 'utf8'))) {
      templateInvalid('Template manifest is not canonical.')
    }
    const assets = new Map()
    for (const item of manifest.assets) {
      const normalized = normalizeLogicalAsset(readOrdinaryFile(templatesRoot, item.path))
      if (normalized.logicalSha256 !== item.logicalSha256 || normalized.finalNewline !== item.finalNewline) {
        templateInvalid('Template asset identity differs from its manifest.')
      }
      assets.set(item.assetId, { ...item, ...normalized })
    }
    const templates = new Map()
    for (const item of manifest.templates) {
      const composition = composeTemplate(item.assetIds.map((assetId) => assets.get(assetId)))
      templates.set(item.templateId, { ...item, ...composition })
    }

    return { assets, manifest, templates }
  } catch (error) {
    if (error instanceof InitBacklogError) {
      throw error
    }
    templateInvalid('Template manifest loading failed.', error)
  }
}

module.exports = { composeTemplate, loadManifest, normalizeLogicalAsset, validateManifest }
