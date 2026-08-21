'use strict'

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')

const repositoryRoot = join(__dirname, '..')

// Every suite CI runs. This is the single home for the count, so adding a suite
// touches this list, the CI workflow, and the two documented command lists, and
// never a feature-scoped test file.
const CI_SUITE_COMMANDS = Object.freeze([
  'node skills/spec-agreement/spec-agreement.test.js',
  'node skills/ready/ready.test.js',
  'node internal/revise/revise-round.test.js',
  'node internal/revise/rigor.test.js',
  'node internal/revise/orchestration.test.js',
  'node --test tests/universal-skill-topology.test.js',
  'node tests/host-discovery-smoke.test.js',
  'node tests/release-surface.test.js',
])

// The subset both command lists must name verbatim. Deliberately narrower than
// CI_SUITE_COMMANDS: these are the suites whose absence from the docs has
// actually caused confusion.
const DOCUMENTED_SUITE_COMMANDS = Object.freeze([
  'node tests/host-discovery-smoke.test.js',
  'node skills/spec-agreement/spec-agreement.test.js',
  'node tests/release-surface.test.js',
])

const COMMAND_LISTS = Object.freeze([
  { path: 'AGENTS.md', heading: '## Development commands' },
  { path: 'README.md', heading: '## Development' },
])

const SUITE_COUNT_SENTENCE = 'CI runs all eight suites on Node 22.'
const PUBLIC_SKILL_COUNT = 10

// Line endings are normalized on read: this repository is edited on Windows, so
// checked-in files can carry CRLF while every assertion here is written with LF.
function readRepositoryFile(path) {
  return readFileSync(join(repositoryRoot, path), 'utf8').replace(/\r\n?/g, '\n')
}

function countExact(source, value) {
  return source.split(value).length - 1
}

function extractSection(source, heading) {
  const normalized = source.replace(/\r\n?/g, '\n')
  const start = normalized.indexOf(`${heading}\n`)
  assert.notEqual(start, -1, `missing section ${heading}`)
  const bodyStart = start + heading.length + 1
  const nextHeading = normalized.indexOf('\n## ', bodyStart)

  return nextHeading === -1 ? normalized.slice(bodyStart) : normalized.slice(bodyStart, nextHeading)
}

function assertRepositoryCommandList(source, path, heading) {
  const section = extractSection(source, heading)
  for (const command of DOCUMENTED_SUITE_COMMANDS) {
    assert.equal(countExact(section, command), 1, `${path} ${heading} must name ${command} exactly once`)
    assert.equal(countExact(source, command), 1, `${path} must name ${command} exactly once`)
  }
}

test('CI runs every suite exactly once and runs no undeclared suite', () => {
  const ci = readRepositoryFile('.github/workflows/ci.yml')
  const runLines = ci.split(/\r?\n/).filter((line) => line.startsWith('      - run: node '))

  assert.equal(runLines.length, CI_SUITE_COMMANDS.length, `CI must run exactly ${CI_SUITE_COMMANDS.length} suites`)
  for (const command of CI_SUITE_COMMANDS) {
    assert.equal(countExact(ci, `      - run: ${command}\n`), 1, `CI must run ${command} exactly once`)
  }
})

test('AGENTS states the literal suite count CI actually runs', () => {
  const agents = readRepositoryFile('AGENTS.md')

  assert.equal(countExact(agents, SUITE_COUNT_SENTENCE), 1, `AGENTS must state: ${SUITE_COUNT_SENTENCE}`)
})

test('repository command lists name the documented suites exactly once', () => {
  for (const { path, heading } of COMMAND_LISTS) {
    assertRepositoryCommandList(readRepositoryFile(path), path, heading)
  }
})

test('repository command-list contract rejects commands outside named development sections', () => {
  const invalidDocuments = [
    {
      path: 'AGENTS.md',
      heading: '## Development commands',
      source: `# Instructions\n\n${DOCUMENTED_SUITE_COMMANDS.join('\n')}\n\n## Development commands\n\n- Run another check.\n\n## Architecture\n`,
    },
    {
      path: 'README.md',
      heading: '## Development',
      source: `# Nightshift\n\n${DOCUMENTED_SUITE_COMMANDS.join('\n')}\n\n## Development\n\nRun another check.\n\n## License\n`,
    },
  ]

  for (const { path, heading, source } of invalidDocuments) {
    assert.throws(
      () => assertRepositoryCommandList(source, path, heading),
      (error) => error?.code === 'ERR_ASSERTION' && error.message.includes(`${path} ${heading}`),
      `${path} commands outside ${heading} must not satisfy the command-list contract`,
    )
  }
})

test('the plugin manifest and its marketplace copy agree on the released surface', () => {
  const manifest = JSON.parse(readRepositoryFile('.claude-plugin/plugin.json'))
  const marketplace = JSON.parse(readRepositoryFile('.claude-plugin/marketplace.json'))
  const marketplaceEntry = marketplace.plugins.find((entry) => entry.name === manifest.name)

  assert.match(manifest.version, /^\d+\.\d+\.\d+$/, 'plugin version must be a three-part release version')
  assert.notEqual(marketplaceEntry, undefined, 'marketplace must list the plugin by name')
  assert.equal(marketplaceEntry.description, manifest.description, 'marketplace description must match the manifest description')
})

test('README lists every public skill exactly once', () => {
  const readme = readRepositoryFile('README.md')
  const agents = readRepositoryFile('AGENTS.md')
  const publicSkillRows = readme.match(/^\| `\/nightshift:[^`]+`/gm) ?? []

  assert.equal(publicSkillRows.length, PUBLIC_SKILL_COUNT, `README must list ${PUBLIC_SKILL_COUNT} public skills`)
  assert.equal(new Set(publicSkillRows).size, PUBLIC_SKILL_COUNT, 'README must not list a public skill twice')
  assert.equal(publicSkillRows.some((row) => row.includes('/nightshift:spec-agreement')), true, 'README must list spec-agreement')
  assert.match(agents, /public surface is ten skills/)
})
