'use strict'

// Regression cases that drive the shipped controller exactly as production
// wires it: the public CLI request transport over a real scratch repository,
// with no injected handlers, no injected dispatcher, and no test-only options.
// The lib-level suites cover the same units with fixture-shaped records; these
// cases exist to catch wiring defects those suites cannot observe.

const assert = require('node:assert/strict')
const { execFileSync, spawn } = require('node:child_process')
const { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const test = require('node:test')

const { runCli } = require('../../skills/init-backlog/init-backlog')
const { canonicalActionOrder, deriveSemanticActionId } = require('../../skills/init-backlog/lib/protocol')
const { canonicalJson, compareOrdinal, git } = require('./helpers')
const { ELECTION_MARKER_PATH } = require('./election-oracles')

function captureStreams() {
  const stdout = []
  const stderr = []

  return {
    stderr: { write: (value) => stderr.push(Buffer.from(value)) },
    stderrBytes: () => Buffer.concat(stderr),
    stdout: { write: (value) => stdout.push(Buffer.from(value)) },
    stdoutBytes: () => Buffer.concat(stdout),
  }
}

function claudeHostContext(status = 'unexcluded-missing') {
  return {
    claudeContextSource: status === 'included' ? 'host-observed' : 'user-confirmed',
    claudeRootExclusionStatus: status,
    codexContextSource: null,
    codexInvocationDirectory: null,
    codexProjectDocMaxBytes: null,
    codexProjectInstructions: [],
  }
}

function makeRoot() {
  return realpathSync.native(mkdtempSync(join(tmpdir(), 'nightshift-e2e-')))
}

function makeGitRoot() {
  const root = makeRoot()
  execFileSync('git', ['-C', root, 'init', '--quiet'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })

  return root
}

function removeRoot(root) {
  rmSync(root, { force: true, maxRetries: 8, recursive: true, retryDelay: 25 })
}

let nonceCounter = 0

function nextNonce() {
  nonceCounter += 1

  return nonceCounter.toString(16).padStart(32, '0')
}

// Drives one request through the public CLI transport: reserve the request
// gate, write the payload, then consume it with the production dispatcher.
// `filesystemOptions` is used only to inject a crash that manufactures a
// durable partial state; every resubmit under test runs with none.
function driveCli(root, request, filesystemOptions = undefined) {
  const nonce = nextNonce()
  const reserveStreams = captureStreams()
  const reserveExit = runCli({ argv: ['--reserve-request', root], nonce, stderr: reserveStreams.stderr, stdout: reserveStreams.stdout })
  assert.equal(reserveExit, 0, `request reservation failed: ${reserveStreams.stderrBytes().toString('utf8')}`)
  const reserved = JSON.parse(reserveStreams.stdoutBytes().toString('utf8'))
  const requestRecord = typeof request === 'function' ? request(reserved.canonicalRoot) : request
  writeFileSync(join(reserved.canonicalRoot, ...reserved.requestPath.split('/')), Buffer.from(canonicalJson(requestRecord) + '\n', 'utf8'), { flag: 'wx' })
  const streams = captureStreams()
  const exitCode = runCli({ argv: ['--consume-request', reserved.canonicalRoot, nonce], filesystemOptions, stderr: streams.stderr, stdout: streams.stdout })
  const stdout = streams.stdoutBytes().toString('utf8')

  return { exitCode, record: stdout.length === 0 ? null : JSON.parse(stdout), stderr: streams.stderrBytes().toString('utf8') }
}

// Reaches the durable state a response-loss leaves behind: inspect, approve the
// manifest, then either complete the apply or crash it at a named transition.
function interruptedApply(root, { bare = false, failAt = null } = {}) {
  if (!bare) writeFileSync(join(root, 'CLAUDE.md'), BARE_GUIDANCE, 'utf8')
  const inspected = driveCli(root, inspectRequest(root, 'claude-code', claudeHostContext(bare ? 'unexcluded-missing' : 'included')))
  assert.equal(inspected.exitCode, 0, inspected.stderr)
  const request = buildApplyRequest(root, inspected.record)
  if (failAt === null) {
    assert.equal(driveCli(root, request).record.ok, true, 'the first apply must succeed')
  } else {
    driveCli(root, request, { crash: true, failAt })
    assert.ok(existsSync(join(root, LOCK_BASENAME)), `the crash at ${failAt} must leave a durable owner record`)
  }

  return request
}

function inspectRequest(root, host = 'claude-code', hostContext = claudeHostContext()) {
  return { host, hostContext, operation: 'inspect', protocolVersion: 1, root }
}

function semanticEdit(target, regionId, before, after) {
  const actionWithoutId = { afterBase64: after.toString('base64'), beforeBase64: before.toString('base64'), kind: 'exact-edit', regionId, target }

  return { ...actionWithoutId, id: deriveSemanticActionId(actionWithoutId) }
}

const BARE_GUIDANCE = ['# Project', '', 'Local guidance.', ''].join('\r\n')

const LOCK_BASENAME = '.nightshift-init-backlog.lock'

// `git check-ignore` exits 1 with no output when the path is not ignored, so
// the exit status is the answer and a nonzero status is not a failure here.
function ignoredByGit(root, target) {
  try {
    git(root, ['check-ignore', '-q', '--no-index', target])

    return true
  } catch (error) {
    if (error?.status === 1) return false

    throw error
  }
}

function controllerResidue(root) {
  return readdirSync(root).filter((name) => name.startsWith('.nightshift')).sort(compareOrdinal)
}

// A repository whose only committed content is a `.gitignore` that already
// satisfies the unconditional plans rule, so the fresh-scaffold election is the
// one open question the apply has to resolve.
function makeElectionRoot(seed = '.claude/plans/\r\n') {
  const root = makeGitRoot()
  writeFileSync(join(root, 'CLAUDE.md'), BARE_GUIDANCE, 'utf8')
  writeFileSync(join(root, '.gitignore'), seed, 'utf8')
  git(root, ['add', '.gitignore'])
  git(root, ['-c', 'user.email=nightshift@example.invalid', '-c', 'user.name=Nightshift', 'commit', '-qm', 'seed'])

  return root
}

// The elective fragment the ignore branch appends, as the bundled template
// declares it. Kept here as an explicit expectation so a template edit that
// changes the covered surface has to update this pin deliberately.
const ELECTIVE_IGNORE_PATHS = [
  '.claude/QUICK_WINS.md',
  '.claude/FEATURES.md',
  '.claude/BUGS.md',
  '.claude/PATTERNS.md',
  '.claude/QUICK_WINS_HISTORY.md',
  '.claude/FEATURES_HISTORY.md',
  '.claude/BUGS_HISTORY.md',
  '.claude/features/',
  '.claude/bugs/',
  '.claude/patterns/',
]

// Both shapes the elective append can take: alone when the mandatory plans rule
// is already satisfied, and chained onto the mandatory append when it is not.
const IGNORE_ELECTION_CASES = [
  { name: 'appends the elective paths when the plans rule is already satisfied', reasons: ['elective-ignore'], seed: '.claude/plans/\r\n' },
  { name: 'chains the elective append onto the mandatory plans append', reasons: ['elective-ignore', 'plans-policy'], seed: 'node_modules/\r\n' },
]

// Proposal identity is a content digest, so the seed content alone decides
// whether the elective proposal sorts before or after the mandatory one in the
// carried inspection. Both orders must admit and land identically. The two
// elective-first seeds are the ones that were rejected before the chain-head
// fix; the plans-first seeds guard against regressing the other direction.
const IGNORE_CHAIN_ORDER_SEEDS = ['node_modules/\r\n', 'dist/\r\n', 'coverage/\r\n*.tmp\r\n', 'node_modules/\r\n*.log\r\n', 'build/\r\n']

function electionApply(root, choice) {
  const inspected = driveCli(root, inspectRequest(root, 'claude-code', claudeHostContext('included')))
  assert.equal(inspected.exitCode, 0, inspected.stderr)
  assert.equal(inspected.record.git.kind, 'git')

  return { applied: driveCli(root, buildApplyRequest(root, inspected.record, choice)), inspection: inspected.record }
}

// Each entry names a durable state a lost response can leave behind. All of
// them are the same approved manifest at a unique approved prefix, so
// resubmitting it must complete rather than report drift.
const RESUME_CASES = [
  { name: 'a crash before any action published', options: { failAt: 'after-lock-upgrade' } },
  { name: 'a crash midway through the directory prefix', options: { failAt: 'after-directory-create' } },
  { name: 'a crash midway through the file prefix', options: { failAt: 'after-final-verification' } },
  { name: 'a completed apply whose owner record was already cleaned', options: {} },
  { name: 'a completed apply that created the root guidance file', options: { bare: true } },
]

const POPULATED_GUIDANCE = ['# Project', '', '## Backlogs and indexes', '', 'Existing controlled prose.', '', '## Local conventions', '', 'Tail prose the edit must not touch.', ''].join('\r\n')

// The documented semantic repair is appending a missing section or concept, so
// both the empty region a missing section presents and a populated region with
// live bytes after it must admit a length-changing insertion.
const SEMANTIC_INSERTION_CASES = [
  { guidance: BARE_GUIDANCE, insertion: '## Backlogs and indexes\r\n\r\nInserted section.\r\n', name: 'appends a missing section into a zero-width region', zeroWidth: true },
  { guidance: POPULATED_GUIDANCE, insertion: 'More controlled prose.\r\n', name: 'extends a populated region without touching the bytes after it', zeroWidth: false },
]

// Mirrors the manifest an approving agent submits: every proposal disposed by
// its own condition, the selected proposals' actions in canonical order, and a
// satisfied decision for every semantic target the inspection requires.
function semanticDecisionsFor(inspection, status = 'satisfied') {
  return inspection.targets
    .filter((item) => item.contentRole === 'semantic' && item.templateId !== null && !item.states.includes('exact-template') && !(item.contentBase64 !== null && item.contentBase64.length === 0 && inspection.proposals.some((proposal) => proposal.action.target === item.target && proposal.reason === 'empty-target' && proposal.condition === 'always')))
    .map((item) => ({
      conceptIds: inspection.templates.find((entry) => entry.templateId === item.templateId && entry.target === item.target)?.conceptIds ?? [],
      status,
      target: item.target,
    }))
    .sort((left, right) => compareOrdinal(left.target, right.target))
}

function buildApplyRequest(root, inspection, choice = 'not-required', options = {}) {
  const newlineChoice = options.newline ?? 'crlf'
  const dispositions = []
  const actions = []
  for (const proposal of inspection.proposals) {
    let selected
    if (proposal.condition === 'always') {
      selected = true
    } else if (proposal.condition === 'version-control-ignore') {
      selected = choice === 'ignore'
    } else if (proposal.condition === 'newline-lf' || proposal.condition === 'newline-crlf') {
      selected = proposal.condition === `newline-${newlineChoice}`
    } else {
      throw new Error(`unrecognized proposal condition: ${proposal.condition}`)
    }
    dispositions.push({ disposition: selected ? 'selected' : 'condition-not-selected', proposalId: proposal.proposalId })
    if (selected) {
      actions.push(proposal.action)
    }
  }

  return {
    actions: canonicalActionOrder([...actions, ...(options.extraActions ?? [])]),
    host: inspection.host,
    hostContext: inspection.hostContext,
    inspection,
    operation: 'apply',
    protocolVersion: 1,
    proposalDispositions: dispositions,
    root,
    semanticDecisions: options.semanticDecisions ?? semanticDecisionsFor(inspection),
    versionControlChoice: choice,
  }
}

function readyCatalogFixture(options = {}) {
  const root = makeRoot()
  writeFileSync(join(root, 'CLAUDE.md'), BARE_GUIDANCE, 'utf8')
  const scaffoldInspection = driveCli(root, inspectRequest(root, 'claude-code', claudeHostContext('included')))
  assert.equal(scaffoldInspection.exitCode, 0, scaffoldInspection.stderr)
  const scaffoldApply = driveCli(root, buildApplyRequest(root, scaffoldInspection.record))
  assert.equal(scaffoldApply.record.ok, true, `fixture scaffold failed: ${JSON.stringify(scaffoldApply.record).slice(0, 400)}`)
  const linked = options.linked !== false
  const linkedTarget = join(root, '.claude', 'features', 'linked.md')
  const featuresTarget = join(root, '.claude', 'FEATURES.md')
  const scaffoldFeatures = readFileSync(featuresTarget, 'utf8')
  const newline = scaffoldFeatures.includes('\r\n') ? '\r\n' : '\n'
  const featureLines = ['', '## Active']
  if (linked) featureLines.push('', '### [Linked](features/linked.md)', '', '**Requires:** none.')
  writeFileSync(featuresTarget, `${scaffoldFeatures.trimEnd()}${newline}${featureLines.join(newline)}${newline}`, 'utf8')
  if (linked) {
    const linkedContents = options.structural === true
      ? '# Linked\n\n**Requires:** none.\n'
      : options.wrapped === true
        ? '# Linked\n\nThis paragraph is deliberately hard wrapped across\ntwo physical lines so the detector fires.\n'
        : '# Linked\n'
    writeFileSync(linkedTarget, linkedContents, 'utf8')
  }
  if (options.unlinked === true) writeFileSync(join(root, '.claude', 'features', 'unlinked.md'), '# Unlinked\n', 'utf8')
  const inspected = driveCli(root, inspectRequest(root, 'claude-code', claudeHostContext('included')))
  assert.equal(inspected.exitCode, 0, inspected.stderr)

  return { inspection: inspected.record, linkedTarget, root }
}

function featuresPreambleEdit(inspection) {
  const record = inspection.targets.find((entry) => entry.target === '.claude/FEATURES.md')
  const region = record.editableRegions.find((entry) => entry.regionId === 'features.document-preamble')
  assert.ok(region !== undefined, 'the feature preamble must be an authorized semantic region')
  const before = Buffer.from(record.contentBase64, 'base64')
  const newline = before.includes(Buffer.from('\r\n', 'utf8')) ? '\r\n' : '\n'
  const insertion = Buffer.from(`Current catalog note.${newline}${newline}`, 'utf8')
  const after = Buffer.concat([before.subarray(0, region.endByte), insertion, before.subarray(region.endByte)])

  return { action: semanticEdit(record.target, region.regionId, before, after), after, before }
}

function runE2eCases() {
  test('forward-slash reservation carries the native root through production inspect transport', { skip: process.platform !== 'win32' }, () => {
    const root = makeRoot()
    try {
      const projectRoot = root.replaceAll('\\', '/')

      const outcome = driveCli(projectRoot, (canonicalRoot) => inspectRequest(canonicalRoot))

      assert.equal(outcome.stderr, '')
      assert.equal(outcome.exitCode, 0)
      assert.equal(outcome.record.ok, true)
      assert.equal(outcome.record.root, root)
      assert.deepEqual(readdirSync(root).filter((entry) => entry.startsWith('.nightshift-init-backlog.')), [])
    } finally {
      removeRoot(root)
    }
  })

  test('inspection over a Git repository with unignored backlog directories survives the CLI transport', () => {
    const root = makeGitRoot()
    try {
      const outcome = driveCli(root, inspectRequest(root))

      assert.equal(outcome.stderr, '', 'the controller must not fall back to the internal-failure transport')
      assert.equal(outcome.exitCode, 0)
      assert.equal(outcome.record.ok, true)
      assert.equal(outcome.record.git.kind, 'git')
      const unignored = outcome.record.git.nonPlanUnignoredPaths
      assert.ok(unignored.includes('.claude/bugs'), 'directory evidence must be recorded as a confined target')
      assert.equal(unignored.some((item) => item.endsWith('/')), false, 'no recorded target may carry a trailing separator')
      for (const problem of outcome.record.problems) {
        assert.equal(problem.evidencePaths.some((item) => item.endsWith('/')), false, `problem evidence carries a trailing separator: ${problem.code}`)
      }
    } finally {
      removeRoot(root)
    }
  })

  test('inspection carries an empty controlled file through the production dispatcher', () => {
    const root = makeRoot()
    try {
      writeFileSync(join(root, 'CLAUDE.md'), BARE_GUIDANCE, 'utf8')
      mkdirSync(join(root, '.claude'))
      writeFileSync(join(root, '.claude', 'BUGS.md'), Buffer.alloc(0))

      const outcome = driveCli(root, inspectRequest(root, 'claude-code', claudeHostContext('included')))

      assert.equal(outcome.stderr, '', 'the empty-file proposal must remain protocol-valid')
      assert.equal(outcome.exitCode, 0)
      const action = outcome.record.proposals.find((proposal) => proposal.action.kind === 'exact-edit' && proposal.action.target === '.claude/BUGS.md').action
      assert.deepEqual(Object.keys(action).sort(), ['afterBase64', 'beforeBase64', 'id', 'kind', 'regionId', 'target'])
      const applied = driveCli(root, buildApplyRequest(root, outcome.record))
      assert.equal(applied.exitCode, 0, canonicalJson(applied))
      assert.equal(applied.record.ok, true)
      assert.notEqual(readFileSync(join(root, '.claude', 'BUGS.md')).length, 0)
    } finally {
      removeRoot(root)
    }
  })

  test('a later plans negation is repaired through the public inspect and apply path', () => {
    const root = makeGitRoot()
    try {
      writeFileSync(join(root, 'CLAUDE.md'), BARE_GUIDANCE, 'utf8')
      mkdirSync(join(root, '.claude'), { recursive: true })
      writeFileSync(join(root, '.claude', 'QUICK_WINS.md'), '# Quick wins\n', 'utf8')
      const seed = '.claude/plans/\n!.claude/plans/\n!.claude/plans/**\n'
      writeFileSync(join(root, '.gitignore'), seed, 'utf8')
      assert.equal(ignoredByGit(root, '.claude/plans/example.md'), false, 'the fixture must expose the later negation')

      const inspected = driveCli(root, inspectRequest(root, 'claude-code', claudeHostContext('included')))
      assert.equal(inspected.exitCode, 0, inspected.stderr)
      assert.equal(inspected.record.git.plansPolicy, 'action-required')
      const plansProposal = inspected.record.proposals.find((proposal) => proposal.reason === 'plans-policy')
      assert.ok(plansProposal, JSON.stringify(inspected.record.proposals))
      assert.equal(Buffer.from(plansProposal.afterBase64, 'base64').toString('utf8'), `${seed}.claude/plans/\n`)

      const applied = driveCli(root, buildApplyRequest(root, inspected.record))
      assert.equal(applied.exitCode, 0, applied.stderr)
      assert.equal(applied.record.ok, true, JSON.stringify(applied.record))
      assert.equal(applied.record.complete, true, JSON.stringify(applied.record.incompleteTargets))
      assert.equal(applied.record.postInspect.git.plansPolicy, 'satisfied')
      assert.equal(ignoredByGit(root, '.claude/plans/example.md'), true)
      assert.equal(readFileSync(join(root, '.gitignore'), 'utf8'), `${seed}.claude/plans/\n`)
    } finally {
      removeRoot(root)
    }
  })

  test('inspection over a Git repository whose backlog directories are ignored survives the CLI transport', () => {
    const root = makeGitRoot()
    try {
      writeFileSync(join(root, '.gitignore'), '.claude/bugs/\n.claude/features/\n.claude/patterns/\n.claude/plans/\n', 'utf8')
      const outcome = driveCli(root, inspectRequest(root))

      assert.equal(outcome.stderr, '', 'the controller must not fall back to the internal-failure transport')
      assert.equal(outcome.exitCode, 0)
      assert.equal(outcome.record.ok, true)
      const matches = outcome.record.git.nonPlanIgnoreMatches
      assert.ok(matches.length > 0, 'repository-local ignore rules must be reported')
      for (const match of matches) {
        assert.deepEqual(Object.keys(match).sort(compareOrdinal), ['pattern', 'probe', 'sourcePath', 'target'])
        assert.equal(match.sourcePath, '.gitignore')
        assert.ok(match.probe.startsWith(`${match.target}/`), 'the probe must address a path inside its recorded target')
      }
      const problem = outcome.record.problems.find((item) => item.detail === 'Repository-local ignore rules match non-plan backlog paths.')
      assert.ok(problem !== undefined, 'the ignore-match problem must be projected')
      assert.equal(problem.evidencePaths.every((item) => typeof item === 'string'), true)
    } finally {
      removeRoot(root)
    }
  })

  test('a scaffold-creating manifest is admitted even though creation changes the ready result', () => {
    const root = makeRoot()
    try {
      writeFileSync(join(root, 'CLAUDE.md'), '# Project\n\nLocal guidance.\n', 'utf8')
      const inspected = driveCli(root, inspectRequest(root, 'claude-code', claudeHostContext('included')))
      assert.equal(inspected.exitCode, 0, inspected.stderr)
      const inspection = inspected.record
      assert.ok(inspection.proposals.some((item) => item.action.kind === 'create-from-template' && item.action.target === '.claude/FEATURES.md'), 'the scaffold creations must be proposed')

      const applied = driveCli(root, buildApplyRequest(root, inspection))

      assert.equal(applied.stderr, '')
      assert.notEqual(applied.record.detail, 'Simulated ready result differs from the inspected prediction.', 'the drift gate must not reject the inspected transition itself')
      assert.equal(applied.record.ok, true, `apply failed: ${JSON.stringify(applied.record)}`)
      assert.equal(applied.record.complete, true, `apply is incomplete: ${JSON.stringify(applied.record.incompleteTargets)}`)
      assert.equal(applied.exitCode, 0)
      for (const target of ['.claude/BUGS.md', '.claude/FEATURES.md', '.claude/PATTERNS.md', '.claude/QUICK_WINS.md']) {
        assert.ok(existsSync(join(root, ...target.split('/'))), `scaffold target was not published: ${target}`)
      }
    } finally {
      removeRoot(root)
    }
  })

  test('creating the missing root guidance file does not fail its own post-publication verification', () => {
    const root = makeRoot()
    try {
      const inspected = driveCli(root, inspectRequest(root))
      assert.equal(inspected.exitCode, 0, inspected.stderr)
      const inspection = inspected.record
      assert.equal(inspection.hostContext.claudeRootExclusionStatus, 'unexcluded-missing')
      assert.ok(inspection.proposals.some((item) => item.action.kind === 'create-from-template' && item.action.target === 'CLAUDE.md'), 'the guidance creation must be proposed')

      const applied = driveCli(root, buildApplyRequest(root, inspection))

      assert.equal(applied.stderr, '')
      assert.notEqual(applied.record.detail, 'Post-publication ready verification failed.', 'verification must expect the guidance file the apply itself created')
      assert.equal(applied.record.ok, true, `apply failed: ${JSON.stringify(applied.record)}`)
      assert.equal(applied.record.complete, true, `apply is incomplete: ${JSON.stringify(applied.record.incompleteTargets)}`)
      assert.equal(applied.exitCode, 0)
      assert.equal(applied.record.postInspect.hostContext.claudeRootExclusionStatus, 'included', 'the verification host context must reflect the published guidance file')
      assert.ok(existsSync(join(root, 'CLAUDE.md')), 'the guidance file must remain published')
      assert.ok(readFileSync(join(root, 'CLAUDE.md'), 'utf8').includes('Backlogs and indexes'), 'the published guidance file must carry the controlled section')
    } finally {
      removeRoot(root)
    }
  })

  for (const item of SEMANTIC_INSERTION_CASES) {
    test(`a length-changing semantic edit ${item.name}`, () => {
      const root = makeRoot()
      try {
        writeFileSync(join(root, 'CLAUDE.md'), item.guidance, 'utf8')
        const inspection = driveCli(root, inspectRequest(root, 'claude-code', claudeHostContext('included'))).record
        const record = inspection.targets.find((entry) => entry.target === 'CLAUDE.md')
        const region = record.editableRegions.find((entry) => entry.regionId === 'root-guidance.backlogs-and-indexes')
        assert.ok(region !== undefined, 'the controlled guidance region must be inspected')
        assert.equal(region.endByte - region.startByte === 0, item.zeroWidth, `region width does not match the case: ${JSON.stringify(region)}`)
        const before = Buffer.from(record.contentBase64, 'base64')
        const after = Buffer.concat([before.subarray(0, region.endByte), Buffer.from(item.insertion, 'utf8'), before.subarray(region.endByte)])
        assert.notEqual(after.length, before.length, 'the case must exercise a length-changing edit')

        const applied = driveCli(root, buildApplyRequest(root, inspection, 'not-required', { extraActions: [semanticEdit('CLAUDE.md', region.regionId, before, after)] }))

        assert.equal(applied.stderr, '')
        assert.notEqual(applied.record.detail, 'Exact edit broadens its approved region.', 'an insertion inside the approved region does not broaden it')
        assert.equal(applied.record.ok, true, `apply failed: ${JSON.stringify(applied.record)}`)
        assert.deepEqual(readFileSync(join(root, 'CLAUDE.md')), after, 'the published bytes must be the approved image')
      } finally {
        removeRoot(root)
      }
    })
  }

  test('a semantic edit that rewrites bytes outside its approved region is still refused', () => {
    const root = makeRoot()
    try {
      writeFileSync(join(root, 'CLAUDE.md'), POPULATED_GUIDANCE, 'utf8')
      const inspection = driveCli(root, inspectRequest(root, 'claude-code', claudeHostContext('included'))).record
      const record = inspection.targets.find((entry) => entry.target === 'CLAUDE.md')
      const region = record.editableRegions.find((entry) => entry.regionId === 'root-guidance.backlogs-and-indexes')
      const before = Buffer.from(record.contentBase64, 'base64')
      const tail = Buffer.from(before.subarray(region.endByte).toString('utf8').replace('Tail prose', 'Rewritten'), 'utf8')
      const after = Buffer.concat([before.subarray(0, region.endByte), Buffer.from('More controlled prose.\r\n', 'utf8'), tail])
      assert.notDeepEqual(tail, before.subarray(region.endByte), 'the case must actually alter the tail')

      const applied = driveCli(root, buildApplyRequest(root, inspection, 'not-required', { extraActions: [semanticEdit('CLAUDE.md', region.regionId, before, after)] }))

      assert.equal(applied.record.ok, false)
      assert.equal(applied.record.code, 'manifest-invalid')
      assert.equal(applied.record.detail, 'Exact edit broadens its approved region.')
      assert.equal(readFileSync(join(root, 'CLAUDE.md'), 'utf8'), POPULATED_GUIDANCE, 'a refused manifest writes nothing')
    } finally {
      removeRoot(root)
    }
  })

  for (const item of [
    { name: 'linked breakout', options: { linked: true } },
    { name: 'unlinked breakout', options: { linked: false, unlinked: true } },
  ]) {
    test(`a no-op apply retains the complete ready catalog for a ${item.name}`, () => {
      const fixture = readyCatalogFixture(item.options)
      try {
        const applied = driveCli(fixture.root, buildApplyRequest(fixture.root, fixture.inspection))

        assert.equal(applied.stderr, '')
        assert.equal(applied.record.ok, true, `apply failed: ${JSON.stringify(applied.record).slice(0, 400)}`)
        assert.equal(applied.record.complete, true)
        assert.deepEqual(applied.record.outcomes, [])
        assert.deepEqual(applied.record.postInspect.ready, fixture.inspection.ready, 'a no-op must preserve exact parser output')
      } finally {
        removeRoot(fixture.root)
      }
    })
  }

  test('a semantic index edit overlays the complete hidden ready catalog', () => {
    const fixture = readyCatalogFixture({ linked: true, unlinked: true })
    try {
      const edit = featuresPreambleEdit(fixture.inspection)
      const request = buildApplyRequest(fixture.root, fixture.inspection, 'not-required', { extraActions: [edit.action] })
      const applied = driveCli(fixture.root, request)

      assert.equal(applied.stderr, '')
      assert.equal(applied.record.ok, true, `apply failed: ${JSON.stringify(applied.record).slice(0, 400)}`)
      assert.deepEqual(readFileSync(join(fixture.root, '.claude', 'FEATURES.md')), edit.after)
      assert.deepEqual(applied.record.postInspect.ready, fixture.inspection.ready, 'the semantic overlay must retain linked and unlinked parser evidence')
    } finally {
      removeRoot(fixture.root)
    }
  })

  test('a hidden mechanical unwrap overlays its prediction without dropping sibling catalog entries', () => {
    const fixture = readyCatalogFixture({ linked: true, unlinked: true, wrapped: true })
    try {
      const request = buildApplyRequest(fixture.root, fixture.inspection)
      assert.equal(request.actions.some((action) => action.kind === 'unwrap-file' && action.target === '.claude/features/linked.md'), true, 'the fixture must select the hidden unwrap')

      const applied = driveCli(fixture.root, request)

      assert.equal(applied.stderr, '')
      assert.equal(applied.record.ok, true, `apply failed: ${JSON.stringify(applied.record).slice(0, 400)}`)
      assert.deepEqual(applied.record.postInspect.ready, fixture.inspection.unwrapReady.after, 'the unwrap prediction must preserve the complete sibling catalog')
      assert.equal(readFileSync(fixture.linkedTarget, 'utf8').includes('across two physical'), true)
    } finally {
      removeRoot(fixture.root)
    }
  })

  test('a linked breakout structural error survives a no-op apply exactly', () => {
    const fixture = readyCatalogFixture({ linked: true, structural: true })
    try {
      assert.notEqual(fixture.inspection.ready.structuralErrors.length, 0, 'the fixture must expose breakout dependency prose')
      assert.equal(fixture.inspection.ready.evidence.structuralErrors.some((item) => item.evidencePaths.includes('features/linked.md')), true, 'the structural evidence must name the linked breakout')

      const applied = driveCli(fixture.root, buildApplyRequest(fixture.root, fixture.inspection))

      assert.equal(applied.stderr, '')
      assert.equal(applied.record.ok, true, `apply failed: ${JSON.stringify(applied.record).slice(0, 400)}`)
      assert.equal(applied.record.complete, false, 'the preserved structural error remains incomplete')
      assert.deepEqual(applied.record.postInspect.ready, fixture.inspection.ready)
    } finally {
      removeRoot(fixture.root)
    }
  })

  test('an identity mutation after ready catalog acquisition fails before semantic publication', () => {
    const fixture = readyCatalogFixture({ linked: true })
    try {
      const edit = featuresPreambleEdit(fixture.inspection)
      const request = buildApplyRequest(fixture.root, fixture.inspection, 'not-required', { extraActions: [edit.action] })
      let mutated = false
      const applied = driveCli(fixture.root, request, { onTransition: (point) => {
        if (point === 'after-ready-catalog-acquisition') {
          const bytes = readFileSync(fixture.linkedTarget)
          rmSync(fixture.linkedTarget)
          writeFileSync(fixture.linkedTarget, bytes)
          mutated = true
        }
      } })

      assert.equal(mutated, true, 'the mutation must land after acquisition')
      assert.equal(applied.record.ok, false)
      assert.equal(applied.record.code, 'snapshot-drift')
      assert.deepEqual(readFileSync(join(fixture.root, '.claude', 'FEATURES.md')), edit.before, 'catalog drift must prevent every target publication')
      assert.equal(existsSync(join(fixture.root, LOCK_BASENAME)), false, 'prepublication drift must clean the owner record')
    } finally {
      removeRoot(fixture.root)
    }
  })

  for (const item of RESUME_CASES) {
    test(`resubmitting the identical manifest after ${item.name} completes`, () => {
      const root = makeRoot()
      try {
        const request = interruptedApply(root, item.options)

        const resumed = driveCli(root, request)

        assert.equal(resumed.stderr, '')
        assert.equal(resumed.record.ok, true, `resubmit failed: ${JSON.stringify(resumed.record).slice(0, 400)}`)
        assert.equal(resumed.record.complete, true, `resubmit is incomplete: ${JSON.stringify(resumed.record.incompleteTargets)}`)
        assert.equal(resumed.exitCode, 0)
        assert.deepEqual(resumed.record.outcomes.map((outcome) => outcome.target).sort(compareOrdinal), request.actions.map((action) => action.target).sort(compareOrdinal), 'every approved action must be accounted for')
        for (const outcome of resumed.record.outcomes) {
          assert.ok(['created', 'edited', 'skipped-complete'].includes(outcome.status), `unexpected resume outcome: ${outcome.status}`)
        }
        assert.equal(existsSync(join(root, LOCK_BASENAME)), false, 'a completed resume releases the owner record')
      } finally {
        removeRoot(root)
      }
    })
  }

  test('a third-party edit to a published target during the crash window is drift, not resume', () => {
    const root = makeRoot()
    try {
      const request = interruptedApply(root, { failAt: 'after-final-verification' })
      const tampered = join(root, '.claude', 'BUGS.md')
      assert.ok(existsSync(tampered), 'the fixture must have published the tampered target')
      writeFileSync(tampered, '# Tampered\r\n', 'utf8')

      const resumed = driveCli(root, request)

      assert.equal(resumed.record.ok, false)
      assert.equal(resumed.record.code, 'snapshot-drift')
      assert.equal(resumed.record.detail, 'Durable target state is not a unique approved prefix of the manifest.')
      assert.equal(readFileSync(tampered, 'utf8'), '# Tampered\r\n', 'a refused resume publishes nothing')
      assert.ok(existsSync(join(root, LOCK_BASENAME)), 'a refused resume never removes an owner record it did not create')
    } finally {
      removeRoot(root)
    }
  })

  test('a third-party file added to the controlled surface during the crash window is drift, not resume', () => {
    const root = makeRoot()
    try {
      const request = interruptedApply(root, { failAt: 'after-final-verification' })
      writeFileSync(join(root, '.claude', 'features', 'intruder.md'), '# Intruder\r\n', 'utf8')

      const resumed = driveCli(root, request)

      assert.equal(resumed.record.ok, false)
      assert.equal(resumed.record.code, 'snapshot-drift')
      assert.equal(resumed.record.detail, 'Live repository differs from the approved resume state.')
    } finally {
      removeRoot(root)
    }
  })

  test('an owner record naming a different live process still blocks instead of resuming', () => {
    const root = makeRoot()
    const owner = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], { stdio: 'ignore', windowsHide: true })
    try {
      writeFileSync(join(root, 'CLAUDE.md'), BARE_GUIDANCE, 'utf8')
      const inspected = driveCli(root, inspectRequest(root, 'claude-code', claudeHostContext('included')))
      const request = buildApplyRequest(root, inspected.record)
      driveCli(root, request, { crash: true, failAt: 'after-lock-upgrade', pid: owner.pid })
      assert.ok(existsSync(join(root, LOCK_BASENAME)))
      assert.notEqual(owner.pid, process.pid)

      const blocked = driveCli(root, request)

      assert.equal(blocked.record.ok, false)
      assert.equal(blocked.record.code, 'runtime-lock')
      assert.equal(blocked.record.detail, 'Publication lock is already present.')
      assert.equal(existsSync(join(root, '.claude', 'FEATURES.md')), false, 'a blocked apply publishes nothing')
    } finally {
      owner.kill()
      removeRoot(root)
    }
  })

  test('a track election apply converges and leaves no marker or witness behind', () => {
    const root = makeElectionRoot()
    try {
      const { applied, inspection } = electionApply(root, 'track')

      assert.equal(inspection.git.electionRequired, true, 'the fixture must open the election')
      assert.equal(inspection.git.electionMarker, 'absent')
      assert.equal(applied.stderr, '')
      assert.equal(applied.record.ok, true, `track apply failed: ${JSON.stringify(applied.record).slice(0, 400)}`)
      assert.equal(applied.record.complete, true, `track apply is incomplete: ${JSON.stringify(applied.record.incompleteTargets)}`)
      assert.equal(applied.exitCode, 0)
      assert.equal(applied.record.postInspect.git.electionMarker, 'absent', 'a proved election retires its marker')
      assert.deepEqual(controllerResidue(root), [], 'no marker, witness, alias, tombstone, or lock may survive')
      assert.equal(ignoredByGit(root, '.claude/FEATURES.md'), false, 'a track election leaves the backlog unignored')
    } finally {
      removeRoot(root)
    }
  })

  test('re-running the whole flow after a track election is a no-op', () => {
    const root = makeElectionRoot()
    try {
      assert.equal(electionApply(root, 'track').applied.record.complete, true)
      const ignoreBefore = readFileSync(join(root, '.gitignore'))

      const repeated = electionApply(root, 'not-required')

      assert.equal(repeated.inspection.git.electionRequired, false, 'a converged election never reopens')
      assert.deepEqual(repeated.inspection.proposals, [], 'a converged scaffold proposes nothing')
      assert.equal(repeated.applied.record.ok, true, `re-run failed: ${JSON.stringify(repeated.applied.record).slice(0, 400)}`)
      assert.deepEqual(repeated.applied.record.outcomes, [], 'a no-op manifest publishes nothing')
      assert.equal(repeated.applied.record.complete, true)
      assert.deepEqual(readFileSync(join(root, '.gitignore')), ignoreBefore, 'the re-run rewrites no version-control state')
      assert.deepEqual(controllerResidue(root), [])
    } finally {
      removeRoot(root)
    }
  })

  test('a foreign hard link on a durable election marker still fails closed', () => {
    const root = makeElectionRoot()
    try {
      const deferred = electionApply(root, 'deferred')
      assert.equal(deferred.applied.record.ok, true, `deferred apply failed: ${JSON.stringify(deferred.applied.record).slice(0, 300)}`)
      const marker = join(root, ELECTION_MARKER_PATH)
      assert.ok(existsSync(marker), 'a deferred election keeps its marker durable')
      const clean = driveCli(root, inspectRequest(root, 'claude-code', claudeHostContext('included')))
      assert.equal(clean.record.ok, true, 'the unlinked marker must inspect cleanly')
      assert.equal(clean.record.git.electionMarker, 'deferred')

      linkSync(marker, join(root, 'intruder.link'))
      const linked = driveCli(root, inspectRequest(root, 'claude-code', claudeHostContext('included')))

      assert.equal(linked.record.ok, false)
      assert.equal(linked.record.code, 'runtime-marker')
      assert.equal(linked.record.detail, 'Election marker is invalid.')
    } finally {
      removeRoot(root)
    }
  })

  for (const item of IGNORE_ELECTION_CASES) {
    test(`an ignore election ${item.name}`, () => {
      const root = makeElectionRoot(item.seed)
      try {
        const { applied, inspection } = electionApply(root, 'ignore')

        assert.deepEqual(inspection.proposals.filter((entry) => entry.action.target === '.gitignore').map((entry) => entry.reason).sort(compareOrdinal), item.reasons, 'the inspected policy actions must cover the ignore branch')
        assert.equal(inspection.proposals.some((entry) => entry.reason === 'elective-ignore' && entry.condition === 'version-control-ignore'), true, 'the elective action must be selected only by the ignore branch')
        assert.equal(applied.stderr, '')
        assert.equal(applied.record.ok, true, `ignore apply failed: ${JSON.stringify(applied.record).slice(0, 400)}`)
        assert.equal(applied.record.complete, true, `ignore apply is incomplete: ${JSON.stringify(applied.record.incompleteTargets)}`)
        assert.equal(applied.exitCode, 0)
        const rules = readFileSync(join(root, '.gitignore'), 'utf8').split('\r\n')
        for (const path of ELECTIVE_IGNORE_PATHS) {
          assert.ok(rules.includes(path), `the elective append is missing ${path}`)
        }
        assert.ok(rules.includes('.claude/plans/'), 'the mandatory plans rule must survive the elective append')
        for (const target of ['.claude/FEATURES.md', '.claude/BUGS.md', '.claude/features/breakout.md', '.claude/plans/plan.md']) {
          assert.equal(ignoredByGit(root, target), true, `git does not ignore ${target}`)
        }
        assert.deepEqual(controllerResidue(root), [], 'a proved ignore election retires its marker')
      } finally {
        removeRoot(root)
      }
    })
  }

  test('re-running the whole flow after an ignore election is a no-op', () => {
    const root = makeElectionRoot()
    try {
      assert.equal(electionApply(root, 'ignore').applied.record.complete, true)
      const ignoreBefore = readFileSync(join(root, '.gitignore'))

      const repeated = electionApply(root, 'not-required')

      assert.equal(repeated.inspection.git.electionRequired, false, 'a converged election never reopens')
      assert.deepEqual(repeated.inspection.proposals, [], 'a converged scaffold proposes nothing, the elective append included')
      assert.equal(repeated.applied.record.ok, true, `re-run failed: ${JSON.stringify(repeated.applied.record).slice(0, 400)}`)
      assert.equal(repeated.applied.record.complete, true)
      assert.deepEqual(repeated.applied.record.outcomes, [])
      assert.deepEqual(readFileSync(join(root, '.gitignore')), ignoreBefore, 'the re-run appends the elective paths a second time')
    } finally {
      removeRoot(root)
    }
  })

  test('an ignore election lands regardless of how the policy proposals sort', () => {
    const orders = new Set()
    for (const seed of IGNORE_CHAIN_ORDER_SEEDS) {
      const root = makeElectionRoot(seed)
      try {
        const { applied, inspection } = electionApply(root, 'ignore')

        orders.add(inspection.proposals.filter((entry) => entry.action.target === '.gitignore').map((entry) => entry.reason).join(','))
        assert.equal(applied.record.ok, true, `seed ${JSON.stringify(seed)} was refused: ${JSON.stringify(applied.record).slice(0, 300)}`)
        assert.equal(applied.record.complete, true, `seed ${JSON.stringify(seed)} is incomplete: ${JSON.stringify(applied.record.incompleteTargets)}`)
        const rules = readFileSync(join(root, '.gitignore'), 'utf8').split('\r\n')
        assert.ok(rules.includes('.claude/FEATURES.md'), `seed ${JSON.stringify(seed)} did not land the elective append`)
        assert.ok(rules.includes('.claude/plans/'), `seed ${JSON.stringify(seed)} lost the mandatory plans rule`)
        assert.ok(rules.includes(seed.split('\r\n')[0]), `seed ${JSON.stringify(seed)} lost its own pre-existing rules`)
      } finally {
        removeRoot(root)
      }
    }
    assert.equal(orders.size, 2, `the seeds must cover both carried orders, saw ${JSON.stringify([...orders])}`)
  })

  test('an ignore election still refuses while a backlog path stays tracked', () => {
    const root = makeGitRoot()
    try {
      writeFileSync(join(root, 'CLAUDE.md'), BARE_GUIDANCE, 'utf8')
      writeFileSync(join(root, '.gitignore'), '.claude/plans/\r\n', 'utf8')
      mkdirSync(join(root, '.claude'), { recursive: true })
      writeFileSync(join(root, '.claude', 'FEATURES.md'), '# Features\r\n', 'utf8')
      git(root, ['add', '.gitignore', '.claude/FEATURES.md'])
      git(root, ['-c', 'user.email=nightshift@example.invalid', '-c', 'user.name=Nightshift', 'commit', '-qm', 'seed'])
      // Tracked in the index but absent from the worktree, so the scaffold is
      // still fresh and the election still opens over a tracked backlog path.
      rmSync(join(root, '.claude', 'FEATURES.md'))

      const { applied, inspection } = electionApply(root, 'ignore')

      assert.deepEqual(inspection.git.trackedBacklogPaths, ['.claude/FEATURES.md'])
      assert.equal(applied.record.ok, true, 'a conflict is a reported incompletion, never a protocol failure')
      assert.equal(applied.record.complete, false, 'ignore cannot complete while a backlog path stays tracked')
      assert.ok(applied.record.incompleteTargets.includes('.claude/FEATURES.md'), 'the refusal must name the tracked path')
    } finally {
      removeRoot(root)
    }
  })

  test('the mechanical gitignore target is never read as hard-wrapped prose', () => {
    const root = makeElectionRoot()
    try {
      assert.equal(electionApply(root, 'ignore').applied.record.complete, true)

      const inspected = driveCli(root, inspectRequest(root, 'claude-code', claudeHostContext('included')))

      const record = inspected.record.targets.find((entry) => entry.target === '.gitignore')
      assert.deepEqual(record.states, ['present'], 'consecutive ignore rules are not wrapped prose')
      assert.equal(inspected.record.wrapFindings.some((entry) => entry.target === '.gitignore'), false)
      assert.equal(inspected.record.proposals.some((entry) => entry.action.kind === 'unwrap-file'), false, 'no unwrap may ever join ignore rules into one pattern')
    } finally {
      removeRoot(root)
    }
  })
}

module.exports = { buildApplyRequest, canonicalJson, captureStreams, claudeHostContext, driveCli, inspectRequest, makeGitRoot, makeRoot, removeRoot, runE2eCases, semanticDecisionsFor }
