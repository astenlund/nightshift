'use strict'

const assert = require('node:assert/strict')
const { readFileSync, readdirSync } = require('node:fs')
const { join } = require('node:path')
const { execFileSync } = require('node:child_process')
const test = require('node:test')

const { PUBLIC_SKILLS } = require('./entry-contract')
const {
  SHIPPED_BEHAVIOR_SENTENCE,
  MANIFEST_PATH,
  classifyShippedBehavior,
  assessVersionSequence,
  resolveUnpushedRange,
  evaluateReleaseGate,
} = require('./release-gate')

const repositoryRoot = join(__dirname, '..')

// Spelled counts, so no assertion below restates a number that a list already
// knows. Adding a suite or a skill updates one list and every derived sentence
// follows, which is the duplication this suite exists to prevent.
const NUMBER_WORDS = Object.freeze([
  'zero', 'one', 'two', 'three', 'four', 'five', 'six',
  'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
])

// Every suite CI runs, and the authority for the suite count. Adding a suite
// means adding it here and to the CI workflow; the count sentences in AGENTS.md
// and this file derive from the list rather than restating it.
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

const SUITE_COUNT_SENTENCE = `CI runs all ${NUMBER_WORDS[CI_SUITE_COMMANDS.length]} suites on Node 22.`
const PUBLIC_SURFACE_PHRASE = `public surface is ${NUMBER_WORDS[PUBLIC_SKILLS.length]} skills`

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

  // Guard the lookup before the sentence that consumes it, so outgrowing
  // NUMBER_WORDS reports the short table rather than blaming AGENTS.md for an
  // "undefined" count. The skill-count guard lives with its own sentence below.
  assert.ok(NUMBER_WORDS[CI_SUITE_COMMANDS.length], `NUMBER_WORDS must spell ${CI_SUITE_COMMANDS.length}`)
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

// The manifest/marketplace description pair is asserted here rather than in the
// topology suite: it is release metadata, not skill topology.
test('the plugin manifest and its marketplace copy agree on the released surface', () => {
  const manifest = JSON.parse(readRepositoryFile('.claude-plugin/plugin.json'))
  const marketplace = JSON.parse(readRepositoryFile('.claude-plugin/marketplace.json'))
  const marketplaceEntry = marketplace.plugins.find((entry) => entry.name === manifest.name)

  assert.match(manifest.version, /^\d+\.\d+\.\d+$/, 'plugin version must be a three-part release version')
  assert.notEqual(marketplaceEntry, undefined, 'marketplace must list the plugin by name')
  assert.equal(marketplaceEntry.description, manifest.description, 'marketplace description must match the manifest description')
})

// Fixed samples pin the classifier independently of whatever the live range
// holds, so a prefix that matches nothing cannot stay silently green.
test('the shipped-behavior classifier resolves the convention to paths and manifest fields', () => {
  const base = { name: 'nightshift', description: 'old', version: '2.6.2' }
  const bumpOnly = { name: 'nightshift', description: 'old', version: '2.6.3' }
  const descriptionChanged = { name: 'nightshift', description: 'new', version: '2.6.2' }

  const shippedPaths = [
    'skills/ready/SKILL.md',
    'skills/ready/ready.js',
    'internal/revise/SKILL.md',
    'internal/revise/code.md',
    'internal/revise/orchestration.js',
    'hooks/pre-commit.sh',
  ]
  const exemptPaths = [
    'skills/ready/ready.test.js',
    'internal/revise/orchestration.test.js',
    'skills/spec-agreement/fixtures/fingerprint-v1.json',
    'tests/release-surface.test.js',
    'tests/release-gate.js',
    'AGENTS.md',
    'README.md',
    '.github/workflows/ci.yml',
    '.claude-plugin/marketplace.json',
    '.claude/QUICK_WINS.md',
  ]

  assert.deepEqual(classifyShippedBehavior([...shippedPaths, ...exemptPaths], base, base), shippedPaths)
  assert.deepEqual(classifyShippedBehavior(exemptPaths, base, base), [])
  assert.deepEqual(classifyShippedBehavior([MANIFEST_PATH], base, bumpOnly), [], 'a bump-only manifest edit is not shipped behavior')
  assert.deepEqual(classifyShippedBehavior([MANIFEST_PATH], base, descriptionChanged), [MANIFEST_PATH], 'a non-version manifest field change is shipped behavior')
  assert.deepEqual(classifyShippedBehavior(['README.md'], base, descriptionChanged), [], 'the manifest rule applies only when the manifest path changed')
})

test('the version-sequence assessor requires a strict increase with no intermediate decrease', () => {
  assert.deepEqual(assessVersionSequence(['2.6.2', '2.6.3']), { increased: true, decreasedAt: null })
  assert.deepEqual(assessVersionSequence(['2.6.2', '2.6.3', '2.6.3', '2.7.0']), { increased: true, decreasedAt: null }, 'two bumps in one range pass, and idle commits keep the version')
  assert.deepEqual(assessVersionSequence(['2.6.2', '2.6.2', '2.6.2']), { increased: false, decreasedAt: null }, 'a range with no bump has not increased')
  assert.deepEqual(assessVersionSequence(['2.6.2']), { increased: false, decreasedAt: null }, 'an empty range has not increased')
  assert.deepEqual(assessVersionSequence(['2.6.2', '2.7.0', '2.6.5', '2.8.0']), { increased: true, decreasedAt: 2 }, 'an intermediate decrease is reported by index')
  assert.deepEqual(assessVersionSequence(['2.6.9', '2.6.10']), { increased: true, decreasedAt: null }, 'semver compares numerically, not lexically')
  assert.deepEqual(assessVersionSequence(['2.6.2', '2.6.1']), { increased: false, decreasedAt: 1 })
})

// The live gate reads committed state through git. These samples pin the range
// resolver and the verdict without a repository, including the skip branch,
// so a skip that always fires is reported rather than swallowed.
test('the unpushed-range resolver prefers the upstream, falls back to origin/main, and reports a skip', () => {
  const upstreamRunner = (args) => {
    if (args.join(' ') === 'merge-base HEAD @{upstream}') { return 'aaaa\n' }
    throw new Error(`unexpected git ${args.join(' ')}`)
  }
  assert.deepEqual(resolveUnpushedRange(upstreamRunner), { base: 'aaaa', notice: null })

  const originOnlyRunner = (args) => {
    if (args.join(' ') === 'merge-base HEAD @{upstream}') { throw new Error('no upstream') }
    if (args.join(' ') === 'merge-base HEAD origin/main') { return 'bbbb\n' }
    throw new Error(`unexpected git ${args.join(' ')}`)
  }
  assert.deepEqual(resolveUnpushedRange(originOnlyRunner), { base: 'bbbb', notice: null })

  const detachedRunner = () => { throw new Error('fatal: no upstream and no origin/main') }
  const skipped = resolveUnpushedRange(detachedRunner)
  assert.equal(skipped.base, null)
  assert.match(skipped.notice, /version-increase check skipped/, 'the skip branch must report a notice')

  const base = { name: 'nightshift', description: 'old', version: '2.6.2' }
  const bumped = { ...base, version: '2.6.3' }
  assert.deepEqual(
    evaluateReleaseGate({ changedPaths: ['skills/ready/SKILL.md'], baseManifest: base, headManifest: bumped, versions: ['2.6.2', '2.6.3'] }),
    { shipped: ['skills/ready/SKILL.md'], ok: true, reason: null },
  )
  assert.deepEqual(
    evaluateReleaseGate({ changedPaths: ['skills/ready/SKILL.md'], baseManifest: base, headManifest: base, versions: ['2.6.2', '2.6.2'] }),
    { shipped: ['skills/ready/SKILL.md'], ok: false, reason: 'shipped behavior changed (skills/ready/SKILL.md) without a version increase: 2.6.2 at the range base, 2.6.2 at HEAD' },
  )
  assert.deepEqual(
    evaluateReleaseGate({ changedPaths: ['README.md'], baseManifest: base, headManifest: base, versions: ['2.6.2', '2.6.2'] }),
    { shipped: [], ok: true, reason: null },
    'a batch with no shipped change needs no bump',
  )
  assert.deepEqual(
    evaluateReleaseGate({ changedPaths: ['skills/ready/SKILL.md'], baseManifest: base, headManifest: { ...base, version: '2.8.0' }, versions: ['2.6.2', '2.7.0', '2.6.5', '2.8.0'] }),
    { shipped: ['skills/ready/SKILL.md'], ok: false, reason: 'the version decreased within the unpushed range at commit 2 of 3 (2.7.0 to 2.6.5)' },
  )
})

// The classifier copies the AGENTS.md enumeration; pinning the sentence means a
// widened convention fails here instead of silently outrunning the predicate.
test('AGENTS states the shipped-behavior convention the classifier resolves', () => {
  const agents = readRepositoryFile('AGENTS.md')

  assert.equal(countExact(agents, SHIPPED_BEHAVIOR_SENTENCE), 1, `AGENTS must state: ${SHIPPED_BEHAVIOR_SENTENCE}`)
})

function git(args) {
  return execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
}

// No fallback: the manifest exists at every revision in range, and a failed
// `git show` must surface as a red test rather than a default that passes.
function manifestAt(revision) {
  return JSON.parse(git(['show', `${revision}:${MANIFEST_PATH}`]))
}

// Only committed state is read: the convention scopes itself to unpushed
// batches, and the suite runs after commits and before the user-directed push.
test('the unpushed range carries a monotonic version increase when shipped behavior changed', (t) => {
  const { base, notice } = resolveUnpushedRange(git)
  if (base === null) {
    t.diagnostic(notice)
    return
  }
  const changedPaths = git(['diff', '--name-only', `${base}..HEAD`]).split(/\r?\n/).filter((line) => line !== '')
  const commits = git(['rev-list', '--reverse', `${base}..HEAD`]).split(/\r?\n/).filter((line) => line !== '')
  const versions = [base, ...commits].map((revision) => manifestAt(revision).version)
  const verdict = evaluateReleaseGate({ changedPaths, baseManifest: manifestAt(base), headManifest: manifestAt('HEAD'), versions })

  assert.ok(verdict.ok, verdict.reason ?? 'release gate failed')
})

test('README lists exactly the public skills, one row each', () => {
  const readme = readRepositoryFile('README.md')
  const agents = readRepositoryFile('AGENTS.md')
  const rowNames = (readme.match(/^\| `\/nightshift:[^`]+`/gm) ?? [])
    .map((row) => row.replace(/^\| `\/nightshift:/, '').replace(/`$/, ''))

  // Set equality, not a count: a renamed or invented row must fail even when
  // the total still matches.
  assert.deepEqual([...rowNames].sort(), [...PUBLIC_SKILLS].sort(), 'README rows must name exactly the public skills')
  assert.equal(new Set(rowNames).size, rowNames.length, 'README must not list a public skill twice')
  assert.ok(NUMBER_WORDS[PUBLIC_SKILLS.length], `NUMBER_WORDS must spell ${PUBLIC_SKILLS.length}`)
  assert.equal(countExact(agents, PUBLIC_SURFACE_PHRASE), 1, `AGENTS must state: ${PUBLIC_SURFACE_PHRASE}`)
})

test('every checked-in suite is declared to CI', () => {
  const suitePaths = []
  const walk = (directory) => {
    for (const entry of readdirSync(join(repositoryRoot, directory), { withFileTypes: true })) {
      const entryPath = `${directory}/${entry.name}`
      if (entry.isDirectory()) {
        // Skip every dot-directory rather than naming them: `.worktrees` (agents
        // create full checkouts there), `.git`, `.tmp`, `.idea`, `.superpowers`.
        // A worktree holds a copy of every suite, so descending into one turns
        // this test red locally while CI, which checks out clean, stays green.
        // No tracked suite lives under a dot-directory, so nothing is lost today.
        // If one ever needs to (a tested `.github/` helper, say), add it to
        // CI_SUITE_COMMANDS by hand: this walk will not find it.
        if (!entry.name.startsWith('.') && !['node_modules', 'fixtures'].includes(entry.name)) {
          walk(entryPath)
        }
      } else if (entry.name.endsWith('.test.js')) {
        suitePaths.push(entryPath.replace(/^\.\//, ''))
      }
    }
  }
  walk('.')

  const declaredPaths = CI_SUITE_COMMANDS.map((command) => command.replace(/^node (--test )?/, ''))
  assert.deepEqual(
    [...suitePaths].sort(),
    [...declaredPaths].sort(),
    'every *.test.js file must be declared in CI_SUITE_COMMANDS, and every declared command must name a real suite',
  )
})
