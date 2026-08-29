'use strict'

const { createHash } = require('node:crypto')
const { lstatSync, readFileSync, readdirSync } = require('node:fs')
const { isAbsolute, join, relative, resolve, sep } = require('node:path')
const { execFileSync } = require('node:child_process')

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

function listFixtureFiles(root, prefix = '') {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    const target = join(root, entry.name)
    const metadata = lstatSync(target)
    if (metadata.isSymbolicLink()) {
      throw new Error(`Fixture contains a link: ${entryPath}`)
    }
    if (metadata.isDirectory()) {
      return listFixtureFiles(target, entryPath)
    }
    if (!metadata.isFile()) {
      throw new Error(`Fixture contains an unsupported entry: ${entryPath}`)
    }

    return [entryPath]
  }).sort(compareOrdinal)
}

function sourceClosure(repositoryRoot, sourceCommit) {
  const output = git(repositoryRoot, ['ls-tree', '-rz', '--name-only', sourceCommit, '--', '.claude-plugin/plugin.json', '.claude-plugin/marketplace.json', 'skills/', 'internal/', 'hooks/'], 'buffer')

  return output.toString('utf8').split('\0').filter(Boolean).sort(compareOrdinal)
}

function readBlob(repositoryRoot, sourceCommit, entryPath) {
  return git(repositoryRoot, ['cat-file', 'blob', `${sourceCommit}:${entryPath}`], 'buffer')
}

function hasExactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort(compareOrdinal).join(',') === [...keys].sort(compareOrdinal).join(',')
}

function loadPromptBaseline(repositoryRoot, sourceCommit) {
  const root = fixtureRoot(repositoryRoot)
  const manifestPath = join(root, 'manifest.json')
  const manifestBytes = readFileSync(manifestPath)
  const manifest = JSON.parse(manifestBytes.toString('utf8'))
  if (!hasExactKeys(manifest, ['schemaVersion', 'sourceCommit', 'files']) || manifest.schemaVersion !== 1 || manifest.sourceCommit !== sourceCommit || !Array.isArray(manifest.files)) {
    throw new Error('Prompt baseline manifest is invalid')
  }
  if (!manifestBytes.equals(Buffer.from(canonicalJson(manifest) + '\n', 'utf8'))) {
    throw new Error('Prompt baseline manifest is not canonical')
  }
  const closure = sourceClosure(repositoryRoot, sourceCommit)
  const entries = manifest.files.map((entry) => {
    if (!hasExactKeys(entry, ['path', 'sha256']) || typeof entry.path !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      throw new Error('Prompt baseline manifest entry is invalid')
    }

    return entry
  })
  const paths = entries.map((entry) => entry.path)
  if (paths.join('\0') !== [...paths].sort(compareOrdinal).join('\0') || new Set(paths).size !== paths.length || paths.join('\0') !== closure.join('\0')) {
    throw new Error('Prompt baseline manifest file set differs from source closure')
  }
  const fixtureFiles = listFixtureFiles(root).filter((entryPath) => entryPath !== 'manifest.json')
  if (fixtureFiles.join('\0') !== closure.join('\0')) {
    throw new Error('Prompt baseline fixture file set differs from source closure')
  }
  for (const entry of entries) {
    const fixtureBytes = readFileSync(fixtureFilePath(repositoryRoot, entry.path))
    const sourceBytes = readBlob(repositoryRoot, sourceCommit, entry.path)
    if (sha256(fixtureBytes) !== entry.sha256 || !fixtureBytes.equals(sourceBytes)) {
      throw new Error(`Prompt baseline bytes differ: ${entry.path}`)
    }
  }

  return { baselineManifestSha256: sha256(manifestBytes), manifest, root }
}

module.exports = { canonicalJson, compareOrdinal, fixtureFilePath, fixtureRoot, git, isContained, loadPromptBaseline, readBlob, sha256, sourceClosure }
