'use strict'

// Regression cases that drive the shipped controller exactly as production
// wires it: the public CLI request transport over a real scratch repository,
// with no injected handlers, no injected dispatcher, and no test-only options.
// The lib-level suites cover the same units with fixture-shaped records; these
// cases exist to catch wiring defects those suites cannot observe.

const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { mkdtempSync, realpathSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const test = require('node:test')

const { runCli } = require('../../skills/init-backlog/init-backlog')

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
}

module.exports = { canonicalJson, captureStreams, claudeHostContext, driveCli, inspectRequest, makeGitRoot, makeRoot, removeRoot, runE2eCases }
