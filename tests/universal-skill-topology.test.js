'use strict'

const assert = require('node:assert/strict')
const { existsSync, lstatSync, readdirSync, readFileSync } = require('node:fs')
const { join, relative } = require('node:path')
const test = require('node:test')

const { PROCEDURE_REPLACEMENTS, PUBLIC_SKILLS, REVISE_ENGINE_RESOURCES, REVISE_WRAPPERS, SUBSTANTIAL_ENTRIES } = require('./entry-contract')

const REPOSITORY_ROOT = join(__dirname, '..')
const ENGINE_ROOT = join(REPOSITORY_ROOT, 'internal', 'revise')
const ENGINE_PATH = '../../internal/revise/SKILL.md'
const FIXTURE_ROOT = join(__dirname, 'fixtures', 'legacy-plugin-2.4.5')
const PUBLIC_SKILLS_ROOT = join(REPOSITORY_ROOT, 'skills')

function readRequiredFile(filePath) {
  return readFileSync(filePath, 'utf8')
}

function requireRegularFile(filePath) {
  const metadata = lstatSync(filePath)
  assert.equal(metadata.isSymbolicLink(), false, `${filePath} must not be a symbolic link`)
  assert.equal(metadata.isFile(), true, `${filePath} must be a regular file`)
}

function parseFrontmatter(filePath) {
  const content = readRequiredFile(filePath)
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(content)
  assert.notEqual(match, null, `${filePath} must contain YAML frontmatter`)
  const fields = Object.fromEntries(match[1].split(/\r?\n/).map((line) => {
    const separator = line.indexOf(':')
    assert.notEqual(separator, -1, `${filePath} has an invalid frontmatter field`)

    return [line.slice(0, separator), line.slice(separator + 1).trim().replace(/^"|"$/g, '')]
  }))

  return { body: match[2], fields }
}

function assertContainedByEngine(filePath) {
  const pathWithinEngine = relative(ENGINE_ROOT, filePath)
  assert.notEqual(pathWithinEngine, '', `${filePath} must be beneath the engine root`)
  assert.equal(pathWithinEngine.startsWith('..'), false, `${filePath} must be beneath the engine root`)
}

function requireAbsent(filePath) {
  assert.equal(existsSync(filePath), false, `${filePath} must be absent`)
}

function removeProcedureEnvelope(text) {
  const withoutFrontmatter = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
  const probe = /^## Entry probe\r?\n/m.exec(withoutFrontmatter)
  if (probe === null) {
    return withoutFrontmatter
  }

  const afterProbe = probe.index + probe[0].length
  const nextHeading = /^## /m.exec(withoutFrontmatter.slice(afterProbe))
  if (nextHeading === null) {
    return withoutFrontmatter.slice(0, probe.index)
  }

  return withoutFrontmatter.slice(0, probe.index) + withoutFrontmatter.slice(afterProbe + nextHeading.index)
}

function normalizeProcedure(entryName, text) {
  let normalized = removeProcedureEnvelope(text)
  for (const [oldPhrase, newPhrase] of PROCEDURE_REPLACEMENTS[entryName]) {
    const occurrenceCount = normalized.split(oldPhrase).length - 1
    assert.notEqual(occurrenceCount, 0, `${entryName} normalization phrase is absent: ${oldPhrase}`)
    normalized = normalized.split(oldPhrase).join(newPhrase)
  }

  return normalized
}

function listDirectChildDirectories(directoryPath) {
  return readdirSync(directoryPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(compareOrdinal)
}

function compareOrdinal(left, right) {
  if (left < right) {
    return -1
  }
  if (left > right) {
    return 1
  }

  return 0
}

function assertCurrentPathsAreAbsent(filePath) {
  const text = readRequiredFile(filePath)
  assert.equal(text.includes('commands/'), false, `${filePath} must not reference commands/`)
  assert.equal(text.includes('skills/revise/'), false, `${filePath} must not reference skills/revise/`)
}

test('public topology exposes only the nine public skills and no legacy command tree', () => {
  assert.deepEqual(listDirectChildDirectories(PUBLIC_SKILLS_ROOT), [...PUBLIC_SKILLS].sort(compareOrdinal))
  requireAbsent(join(REPOSITORY_ROOT, 'commands'))
  requireAbsent(join(PUBLIC_SKILLS_ROOT, 'revise'))

  for (const skillName of PUBLIC_SKILLS) {
    const skillPath = join(PUBLIC_SKILLS_ROOT, skillName, 'SKILL.md')
    requireRegularFile(skillPath)
    const { fields } = parseFrontmatter(skillPath)
    assert.equal(fields.name, skillName)
  }
})

test('procedure fidelity retains each substantial workflow except its declared topology terms', () => {
  for (const entryName of SUBSTANTIAL_ENTRIES) {
    const fixtureCommandPath = join(FIXTURE_ROOT, 'commands', `${entryName}.md`)
    const migratedSkillPath = join(PUBLIC_SKILLS_ROOT, entryName, 'SKILL.md')
    const fixtureFrontmatter = parseFrontmatter(fixtureCommandPath)
    const migratedFrontmatter = parseFrontmatter(migratedSkillPath)
    assert.equal(migratedFrontmatter.fields.description, fixtureFrontmatter.fields.description, `${entryName} description must remain unchanged`)
    assert.equal(removeProcedureEnvelope(readRequiredFile(migratedSkillPath)), normalizeProcedure(entryName, readRequiredFile(fixtureCommandPath)), `${entryName} body differs outside allowed topology replacements`)
  }
})

test('current public references reject retired command and revise engine paths', () => {
  const pathsToAudit = [
    join(REPOSITORY_ROOT, 'README.md'),
    join(REPOSITORY_ROOT, 'AGENTS.md'),
    join(REPOSITORY_ROOT, '.github', 'workflows', 'ci.yml'),
    ...PUBLIC_SKILLS.map((skillName) => join(PUBLIC_SKILLS_ROOT, skillName, 'SKILL.md')),
    ...readdirSync(ENGINE_ROOT, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => join(ENGINE_ROOT, entry.name)),
  ]
  for (const filePath of pathsToAudit) {
    assertCurrentPathsAreAbsent(filePath)
  }
})

test('current manifest descriptions agree and identify handover as a skill', () => {
  const pluginManifest = JSON.parse(readRequiredFile(join(REPOSITORY_ROOT, '.claude-plugin', 'plugin.json')))
  const marketplaceManifest = JSON.parse(readRequiredFile(join(REPOSITORY_ROOT, '.claude-plugin', 'marketplace.json')))
  assert.equal(pluginManifest.description, marketplaceManifest.plugins[0].description)
  assert.equal(pluginManifest.description.includes('handover command'), false)
  assert.equal(marketplaceManifest.plugins[0].description.includes('handover command'), false)
})

test('revise topology requires all relocated engine files as regular files', () => {
  for (const fileName of ['SKILL.md', 'code.md', 'plan.md', 'spec.md', 'rigor.js', 'rigor.test.js', 'revise-round.workflow.js', 'revise-round.test.js']) {
    requireRegularFile(join(ENGINE_ROOT, fileName))
  }
})

test('revise topology removes the public revise engine directory', () => {
  assert.equal(existsSync(join(REPOSITORY_ROOT, 'skills', 'revise')), false)
})

test('revise topology gives every wrapper its exact public frontmatter', () => {
  for (const [wrapperName, wrapper] of Object.entries(REVISE_WRAPPERS)) {
    const { fields } = parseFrontmatter(join(REPOSITORY_ROOT, 'skills', wrapperName, 'SKILL.md'))
    assert.equal(fields.name, wrapperName)
    assert.equal(fields.description, wrapper.description)
  }
})

test('revise topology gives every wrapper its fixed forwarding contract', () => {
  const bodies = []
  for (const [wrapperName, wrapper] of Object.entries(REVISE_WRAPPERS)) {
    const { body } = parseFrontmatter(join(REPOSITORY_ROOT, 'skills', wrapperName, 'SKILL.md'))
    const artifactToken = new RegExp('fixed artifact type `' + wrapper.artifactType + '`', 'g')
    assert.equal([...body.matchAll(artifactToken)].length, 1, `${wrapperName} must have one fixed artifact type token`)
    assert.equal(body.includes(ENGINE_PATH), true, `${wrapperName} must name the relative engine path`)
    assert.equal(body.includes('REVISE_ENGINE_UNAVAILABLE'), true, `${wrapperName} must name the unavailable-engine token`)
    assert.equal(body.includes('When the host supplies usable scope text, pass it to the engine without intentional normalization.'), true, `${wrapperName} must forward usable scope`)
    assert.equal(body.includes('When scope is missing, empty, or whitespace-only, omit it so the engine performs its existing inference and clarification behavior.'), true, `${wrapperName} must preserve omitted-scope inference`)
    bodies.push(body)
  }
  assert.equal(new Set(bodies).size, bodies.length, 'wrapper bodies must remain distinct')
})

test('revise topology keeps engine profile and resource references contained', () => {
  const engine = readRequiredFile(join(ENGINE_ROOT, 'SKILL.md'))
  for (const artifactType of ['code', 'plan', 'spec']) {
    assert.match(engine, new RegExp('- `' + artifactType + '` -> `' + REVISE_ENGINE_RESOURCES[artifactType] + '`'))
  }
  const workflowPath = join(ENGINE_ROOT, REVISE_ENGINE_RESOURCES.workflow)
  assert.match(engine, new RegExp('\\$\\{CLAUDE_PLUGIN_ROOT\\}/internal/revise/' + REVISE_ENGINE_RESOURCES.workflow))
  for (const resourceFileName of Object.values(REVISE_ENGINE_RESOURCES)) {
    const resourcePath = join(ENGINE_ROOT, resourceFileName)
    assertContainedByEngine(resourcePath)
    requireRegularFile(resourcePath)
  }
  assertContainedByEngine(workflowPath)
})
