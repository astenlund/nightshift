'use strict'

const { createHash } = require('node:crypto')
const { isAbsolute, join, relative, resolve, sep } = require('node:path')
const { execFileSync } = require('node:child_process')

const { loadPromptBaseline: loadValidatedPromptBaseline } = require('../init-backlog-prompt-baseline')

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

function nestedJsonText(depth) {
  if (!Number.isSafeInteger(depth) || depth < 0) {
    throw new Error('JSON nesting depth must be a nonnegative safe integer')
  }

  return '{"value":'.repeat(depth) + 'null' + '}'.repeat(depth)
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function git(repositoryRoot, args, encoding = 'utf8') {
  return execFileSync('git', ['-C', repositoryRoot, ...args], { encoding, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
}

function fixtureRoot(repositoryRoot) {
  return join(repositoryRoot, 'tests', 'fixtures', 'init-backlog-prompt-baseline')
}

function isContained(root, target) {
  const relation = relative(root, target)
  return relation !== '' && relation !== '..' && !relation.startsWith('..' + sep) && !isAbsolute(relation)
}

function fixtureFilePath(repositoryRoot, entryPath) {
  const root = resolve(fixtureRoot(repositoryRoot))
  const target = resolve(root, ...entryPath.split('/'))
  if (!isContained(root, target)) {
    throw new Error('Fixture path escapes copied root')
  }

  return target
}

function sourceClosure(repositoryRoot, sourceCommit) {
  const output = git(repositoryRoot, ['ls-tree', '-rz', '--name-only', sourceCommit, '--', '.claude-plugin/plugin.json', '.claude-plugin/marketplace.json', 'skills/', 'internal/', 'hooks/'], 'buffer')

  return output.toString('utf8').split('\0').filter(Boolean).sort(compareOrdinal)
}

function readBlob(repositoryRoot, sourceCommit, entryPath) {
  return git(repositoryRoot, ['cat-file', 'blob', `${sourceCommit}:${entryPath}`], 'buffer')
}

function loadPromptBaseline(repositoryRoot, sourceCommit) {
  const baseline = loadValidatedPromptBaseline(repositoryRoot)
  const { manifest } = baseline
  if (manifest.sourceCommit !== sourceCommit) {
    throw new Error('Prompt baseline source commit differs from the requested authority')
  }
  const closure = sourceClosure(repositoryRoot, sourceCommit)
  if (baseline.files.map((entry) => entry.path).join('\0') !== closure.join('\0')) {
    throw new Error('Prompt baseline manifest file set differs from source closure')
  }
  for (const entry of baseline.files) {
    const sourceBytes = readBlob(repositoryRoot, sourceCommit, entry.path)
    if (!entry.bytes.equals(sourceBytes)) {
      throw new Error(`Prompt baseline bytes differ: ${entry.path}`)
    }
  }

  return baseline
}

module.exports = { canonicalJson, compareOrdinal, fixtureFilePath, fixtureRoot, git, isContained, loadPromptBaseline, nestedJsonText, readBlob, sha256, sourceClosure }
