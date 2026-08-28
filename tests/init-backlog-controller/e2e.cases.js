'use strict'

// Regression cases that drive the shipped controller exactly as production
// wires it: the public CLI request transport over a real scratch repository,
// with no injected handlers, no injected dispatcher, and no test-only options.
// The lib-level suites cover the same units with fixture-shaped records; these
// cases exist to catch wiring defects those suites cannot observe.

const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const test = require('node:test')

const { runCli } = require('../../skills/init-backlog/init-backlog')
const { canonicalActionOrder, deriveSemanticActionId } = require('../../skills/init-backlog/lib/protocol')

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
function driveCli(root, request) {
  const nonce = nextNonce()
  const reserveStreams = captureStreams()
  const reserveExit = runCli({ argv: ['--reserve-request', root], nonce, stderr: reserveStreams.stderr, stdout: reserveStreams.stdout })
  assert.equal(reserveExit, 0, `request reservation failed: ${reserveStreams.stderrBytes().toString('utf8')}`)
  const reserved = JSON.parse(reserveStreams.stdoutBytes().toString('utf8'))
  writeFileSync(join(root, ...reserved.requestPath.split('/')), Buffer.from(canonicalJson(request) + '\n', 'utf8'), { flag: 'wx' })
  const streams = captureStreams()
  const exitCode = runCli({ argv: ['--consume-request', root, nonce], stderr: streams.stderr, stdout: streams.stdout })
  const stdout = streams.stdoutBytes().toString('utf8')

  return { exitCode, record: stdout.length === 0 ? null : JSON.parse(stdout), stderr: streams.stderrBytes().toString('utf8') }
}

function inspectRequest(root, host = 'claude-code', hostContext = claudeHostContext()) {
  return { host, hostContext, operation: 'inspect', protocolVersion: 1, root }
}

function semanticEdit(target, regionId, before, after) {
  const actionWithoutId = { afterBase64: after.toString('base64'), beforeBase64: before.toString('base64'), kind: 'exact-edit', regionId, target }

  return { ...actionWithoutId, id: deriveSemanticActionId(actionWithoutId) }
}

const BARE_GUIDANCE = ['# Project', '', 'Local guidance.', ''].join('\r\n')

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
    .filter((item) => item.contentRole === 'semantic' && item.templateId !== null && !item.states.includes('exact-template'))
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

function runE2eCases() {
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
}

module.exports = { buildApplyRequest, canonicalJson, captureStreams, claudeHostContext, driveCli, inspectRequest, makeGitRoot, makeRoot, removeRoot, runE2eCases, semanticDecisionsFor }
