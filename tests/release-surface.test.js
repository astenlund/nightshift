'use strict'

const assert = require('node:assert/strict')
const { readFileSync, readdirSync, realpathSync } = require('node:fs')
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
  'node skills/init-backlog/unwrap.test.js',
  'node internal/revise/revise-round.test.js',
  'node internal/revise/rigor.test.js',
  'node internal/revise/orchestration.test.js',
  'node --test tests/universal-skill-topology.test.js',
  'node tests/host-discovery-smoke.test.js',
  'node tests/init-backlog-controller.test.js',
  'node tests/release-surface.test.js',
])

// The subset both command lists must name verbatim. Deliberately narrower than
// CI_SUITE_COMMANDS: these are the suites whose absence from the docs has
// actually caused confusion.
const DOCUMENTED_SUITE_COMMANDS = Object.freeze([
  'node tests/host-discovery-smoke.test.js',
  'node tests/init-backlog-controller.test.js',
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

function extractDelimited(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing ${label} start`)
  const bodyStart = start + startMarker.length
  const end = source.indexOf(endMarker, bodyStart)
  assert.notEqual(end, -1, `missing ${label} end`)

  return source.slice(bodyStart, end)
}

function assertRepositoryCommandList(source, path, heading) {
  const section = extractSection(source, heading)
  for (const command of DOCUMENTED_SUITE_COMMANDS) {
    assert.equal(countExact(section, command), 1, `${path} ${heading} must name ${command} exactly once`)
    assert.equal(countExact(source, command), 1, `${path} must name ${command} exactly once`)
  }
}

function git(args) {
  return execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function readManifestBatch(specs) {
  return execFileSync('git', ['cat-file', '--batch'], { cwd: repositoryRoot, encoding: null, input: Buffer.from(`${specs.join('\n')}\n`, 'utf8'), stdio: ['pipe', 'pipe', 'pipe'] })
}

function manifestsAt(revisions, readBatch = readManifestBatch) {
  const specs = revisions.map((revision) => `${revision}:${MANIFEST_PATH}`)
  const response = readBatch(specs)
  assert.equal(Buffer.isBuffer(response), true, 'manifest batch reader must return bytes')
  const manifests = []
  let offset = 0
  for (const spec of specs) {
    const headerEnd = response.indexOf(0x0a, offset)
    assert.notEqual(headerEnd, -1, `manifest batch header is missing for ${spec}`)
    const header = response.subarray(offset, headerEnd).toString('utf8').split(' ')
    assert.equal(header.length, 3, `manifest batch header is malformed for ${spec}`)
    const [objectId, type, sizeText] = header
    assert.match(objectId, /^[0-9a-f]+$/, `manifest batch object identity is malformed for ${spec}`)
    assert.equal(type, 'blob', `manifest batch object is not a blob for ${spec}`)
    assert.match(sizeText, /^(?:0|[1-9][0-9]*)$/, `manifest batch size is malformed for ${spec}`)
    const size = Number(sizeText)
    assert.equal(Number.isSafeInteger(size), true, `manifest batch size is unsafe for ${spec}`)
    const contentStart = headerEnd + 1
    const contentEnd = contentStart + size
    assert.equal(contentEnd < response.length && response[contentEnd] === 0x0a, true, `manifest batch content is truncated for ${spec}`)
    manifests.push(JSON.parse(response.subarray(contentStart, contentEnd).toString('utf8')))
    offset = contentEnd + 1
  }
  assert.equal(offset, response.length, 'manifest batch carries an unexpected trailing record')

  return manifests
}

test('manifest history batching preserves requested revision order in one read', () => {
  const expected = [{ name: 'nightshift', version: '2.6.13' }, { name: 'nightshift', version: '2.6.14' }]
  const response = Buffer.concat(expected.flatMap((manifest, index) => {
    const bytes = Buffer.from(JSON.stringify(manifest), 'utf8')

    return [Buffer.from(`${String(index + 1).repeat(40)} blob ${bytes.length}\n`, 'utf8'), bytes, Buffer.from('\n')]
  }))
  let reads = 0

  const actual = manifestsAt(['first', 'second'], (specs) => {
    reads += 1
    assert.deepEqual(specs, [`first:${MANIFEST_PATH}`, `second:${MANIFEST_PATH}`])

    return response
  })

  assert.deepEqual(actual, expected)
  assert.equal(reads, 1)
})

test('CI runs every suite exactly once and runs no undeclared suite', () => {
  const ci = readRepositoryFile('.github/workflows/ci.yml')
  const runLines = ci.split(/\r?\n/).filter((line) => line.startsWith('      - run: node '))

  assert.equal(runLines.length, CI_SUITE_COMMANDS.length, `CI must run exactly ${CI_SUITE_COMMANDS.length} suites`)
  for (const command of CI_SUITE_COMMANDS) {
    assert.equal(countExact(ci, `      - run: ${command}\n`), 1, `CI must run ${command} exactly once`)
  }
  // The version-increase gate resolves its range against origin/main, which a
  // pull-request checkout only has at full depth. Pinning the checkout input on
  // every job keeps a later workflow edit from regressing the gate to its skip
  // branch, which passes green and would hide the loss. Counted against the
  // checkout steps the workflow actually has, so splitting the suites across
  // more jobs cannot exempt one of them.
  const checkoutSteps = countExact(ci, '      - uses: actions/checkout@v5\n')
  assert.ok(checkoutSteps > 0, 'CI must check out the repository')
  assert.equal(countExact(ci, '      - uses: actions/checkout@v5\n        with:\n          fetch-depth: 0\n'), checkoutSteps, 'every checkout step must carry fetch-depth: 0')
  // Every job runs the same Node, so a suite never passes on a runtime the
  // others never see.
  assert.equal(countExact(ci, '      - uses: actions/setup-node@v5\n        with:\n          node-version: 22\n'), checkoutSteps, 'every job must set up Node 22')
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
  const manifest = JSON.parse(readRepositoryFile(MANIFEST_PATH))
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
  assert.throws(() => assessVersionSequence(['2.6.2', 'garbage']), /malformed semver: garbage/)
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
  assert.match(skipped.notice, /^version-increase check skipped/, 'the skip branch must report a notice')
  assert.match(skipped.notice, /\(last git error: fatal: no upstream and no origin\/main\)$/, 'the skip notice must name the last git error')

  const missingBinaryRunner = () => { throw new Error('Command failed: git merge-base HEAD origin/main\nspawnSync git ENOENT\n') }
  assert.match(resolveUnpushedRange(missingBinaryRunner).notice, /\(last git error: Command failed: git merge-base HEAD origin\/main spawnSync git ENOENT\)$/, 'a multi-line git error is collapsed onto the notice line')

  const silentRunner = () => ''
  assert.equal(resolveUnpushedRange(silentRunner).notice, 'version-increase check skipped: no upstream and no origin/main to resolve the unpushed range', 'a probe that throws nothing appends nothing')

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

// Only committed state is read: the convention scopes itself to unpushed
// batches, and the suite runs after commits and before the user-directed push.
test('the unpushed range carries a monotonic version increase when shipped behavior changed', (t) => {
  const { base, notice } = resolveUnpushedRange(git)
  if (base === null) {
    t.diagnostic(notice)
    return
  }
  const changedPaths = git(['diff', '--no-renames', '--name-only', `${base}..HEAD`]).split(/\r?\n/).filter((line) => line !== '')
  const commits = git(['rev-list', '--topo-order', '--reverse', `${base}..HEAD`]).split(/\r?\n/).filter((line) => line !== '')
  const manifests = manifestsAt([base, ...commits])
  const versions = manifests.map((manifest) => manifest.version)
  const verdict = evaluateReleaseGate({ changedPaths, baseManifest: manifests[0], headManifest: manifests[manifests.length - 1], versions })

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

test('README ready excerpt agrees with the production parser for its named examples', () => {
  const readmeSection = extractSection(readRepositoryFile('README.md'), '## What it looks like')
  const example = extractDelimited(readmeSection, '```\n/nightshift:ready\n\n', '\n```', 'README ready example')
  const readySection = extractDelimited(example, 'Ready\n', '\n\nBlocked\n', 'README Ready section')
  const blockedSection = extractDelimited(example, 'Blocked\n', '\n\nRecommended\n', 'README Blocked section')
  const recommendedSection = example.slice(example.indexOf('Recommended\n') + 'Recommended\n'.length)
  const recommendedTitles = [...recommendedSection.matchAll(/^  [0-9]+\. `([^`]+)`/gm)].map((match) => match[1])
  const recommendationCount = (recommendedSection.match(/^  [0-9]+\./gm) ?? []).length
  const report = JSON.parse(execFileSync(
    process.execPath,
    [join(repositoryRoot, 'skills', 'ready', 'ready.js'), repositoryRoot],
    { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ))
  const readyExamples = [
    { index: 'QUICK_WINS.md', title: 'Tell implementation subagents where their scratch files go' },
    { index: 'FEATURES.md', title: 'Content fingerprint helper' },
  ]
  const blockedExamples = [
    { title: 'Durable scope anchor', blockers: ['Pick-time breakouts'] },
    { title: '[Agent-host-agnostic Nightshift: Portable resource and fingerprint contract]', blockers: ['Content fingerprint helper'] },
  ]

  for (const expected of readyExamples) {
    assert.equal(countExact(readySection, `- ${expected.title}`), 1, `${expected.title} must appear once in the README Ready excerpt`)
    const parsed = report.ready.find(({ title }) => title === expected.title)
    assert.equal(parsed?.index, expected.index, `${expected.title} must remain Ready in the production parser`)
  }
  for (const expected of blockedExamples) {
    const blockerLabel = expected.blockers.join('`, `')
    assert.equal(countExact(blockedSection, `On \`${blockerLabel}\`:\n    - ${expected.title}`), 1, `${expected.title} must appear under its exact README blocker set`)
    const parsed = report.blocked.find(({ title }) => title === expected.title)
    assert.deepEqual(parsed?.blockers, expected.blockers, `${expected.title} must retain the README blocker set in the production parser`)
  }
  assert.equal(recommendedTitles.length, recommendationCount, 'every README recommendation must delimit its title')
  assert.deepEqual([...recommendedTitles].sort(), readyExamples.map(({ title }) => title).sort(), 'README must recommend exactly its named Ready examples')
  for (const title of recommendedTitles) {
    assert.equal(report.ready.some((entry) => entry.title === title), true, `${title} must be Ready before README recommends it`)
  }
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

// The controller suite was registered when the deterministic controller landed;
// these pins keep a later edit from double-declaring any suite or dropping the
// controller suite from either authoritative list.
test('the suite declarations are duplicate-free and include the init-backlog controller suite', () => {
  const controllerSuite = 'node tests/init-backlog-controller.test.js'

  assert.equal(new Set(CI_SUITE_COMMANDS).size, CI_SUITE_COMMANDS.length, 'CI_SUITE_COMMANDS must declare each suite exactly once')
  assert.equal(new Set(DOCUMENTED_SUITE_COMMANDS).size, DOCUMENTED_SUITE_COMMANDS.length, 'DOCUMENTED_SUITE_COMMANDS must declare each suite exactly once')
  for (const command of DOCUMENTED_SUITE_COMMANDS) {
    assert.ok(CI_SUITE_COMMANDS.includes(command), `documented suite must also run in CI: ${command}`)
  }
  assert.ok(CI_SUITE_COMMANDS.includes(controllerSuite), 'CI must declare the init-backlog controller suite')
  assert.ok(DOCUMENTED_SUITE_COMMANDS.includes(controllerSuite), 'the documented subset must declare the init-backlog controller suite')
})

// The controller and its normalized assets ship to every installation, so a
// change to any of them must trip the version-increase convention.
test('the shipped-behavior classifier covers the init-backlog controller and its bundled assets', () => {
  const base = { name: 'nightshift', description: 'old', version: '2.6.14' }
  const controllerPaths = [
    'skills/init-backlog/SKILL.md',
    'skills/init-backlog/init-backlog.js',
    'skills/init-backlog/windows-attributes.ps1',
    ...readdirSync(join(repositoryRoot, 'skills', 'init-backlog', 'lib')).map((name) => `skills/init-backlog/lib/${name}`),
    ...readdirSync(join(repositoryRoot, 'skills', 'init-backlog', 'templates')).map((name) => `skills/init-backlog/templates/${name}`),
  ]

  assert.deepEqual(classifyShippedBehavior(controllerPaths, base, base), controllerPaths, 'every controller file and normalized template asset must classify as shipped behavior')
})

test('init-backlog ships the documented non-writing apply-request builder', () => {
  const controller = require('../skills/init-backlog/init-backlog')
  const applyRequest = require('../skills/init-backlog/lib/apply-request')
  const skill = readRepositoryFile('skills/init-backlog/SKILL.md')

  assert.equal(typeof applyRequest.buildApprovedApplyRequest, 'function', 'the bundled builder must be callable')
  assert.equal(controller.buildApprovedApplyRequest, applyRequest.buildApprovedApplyRequest, 'the controller facade must expose the bundled builder')
  assert.equal(countExact(skill, '`buildApprovedApplyRequest` from `${CLAUDE_PLUGIN_ROOT}/skills/init-backlog/lib/apply-request.js`'), 1, 'the public procedure must name the callable builder exactly once')
})

// The prompt baseline replays a historical prompt-only install for evaluation
// runs; it lives under tests/fixtures and must never count as shipped input.
test('the prompt baseline is test input, not shipped production input', () => {
  const base = { name: 'nightshift', description: 'old', version: '2.6.14' }
  const baselineRoot = 'tests/fixtures/init-backlog-prompt-baseline'
  const baselineManifest = JSON.parse(readRepositoryFile(`${baselineRoot}/manifest.json`))

  assert.equal(baselineManifest.schemaVersion, 1, 'prompt baseline manifest must declare schema version 1')
  assert.ok(Array.isArray(baselineManifest.files) && baselineManifest.files.length > 0, 'prompt baseline manifest must list files')
  const baselinePaths = [`${baselineRoot}/manifest.json`, ...baselineManifest.files.map((entry) => `${baselineRoot}/${entry.path}`)]
  assert.deepEqual(classifyShippedBehavior(baselinePaths, base, base), [], 'prompt-baseline fixture changes must not require a version increase')
})

// loadManifest is the runtime loader itself: it verifies the canonical
// manifest, resolves every referenced asset, and checks each logical digest,
// so a missing or drifted template asset fails here before it ships.
test('the runtime closure includes every asset the template manifest references', () => {
  const { loadManifest } = require('../skills/init-backlog/lib/assets')
  const templatesRoot = realpathSync.native(join(repositoryRoot, 'skills', 'init-backlog', 'templates'))

  const { assets, manifest } = loadManifest(templatesRoot)

  assert.equal(assets.size, manifest.assets.length, 'the loader must resolve every declared asset')
  const referencedPaths = [...manifest.assets.map((item) => item.path)].sort()
  const presentPaths = readdirSync(templatesRoot).filter((name) => name !== 'manifest.json').sort()
  assert.deepEqual(presentPaths, referencedPaths, 'the templates directory must hold exactly the manifest-referenced assets')
})

test('bundled template assets are checked out as text with LF', () => {
  const { manifest } = require('../skills/init-backlog/lib/assets').loadManifest(join(repositoryRoot, 'skills', 'init-backlog', 'templates'))
  const templatePaths = ['manifest.json', ...manifest.assets.map((item) => item.path)].map((path) => `skills/init-backlog/templates/${path}`)
  const attributes = git(['check-attr', 'text', 'eol', '--', ...templatePaths]).trim().split(/\r?\n/)

  assert.deepEqual(attributes, templatePaths.flatMap((path) => [`${path}: text: set`, `${path}: eol: lf`]))
})

// README is the architecture surface a user reads first; it must name the
// deterministic controller and the normalized template manifest it applies.
test('README names the init-backlog controller and its normalized template manifest', () => {
  const readme = readRepositoryFile('README.md')

  assert.equal(countExact(readme, 'skills/init-backlog/init-backlog.js'), 1, 'README must name the init-backlog controller exactly once')
  assert.equal(countExact(readme, 'skills/init-backlog/templates/manifest.json'), 1, 'README must name the normalized template manifest exactly once')
  assert.equal(countExact(readme, 'host-canonical project guidance file'), 1, 'README must describe the resolved guidance target rather than promising CLAUDE.md')
  assert.equal(countExact(readme, 'track, ignore, or defer'), 1, 'README must name every durable-backlog election choice')
})
