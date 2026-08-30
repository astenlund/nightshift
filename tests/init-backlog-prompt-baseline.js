'use strict'

const nodeFilesystem = require('node:fs')
const nodePath = require('node:path')

const { SOURCE_COMMIT, SOURCE_PATHS } = require('./init-backlog-controller/baseline.cases')
const { sha256 } = require('./init-backlog-session-driver/primitives')
const { canonicalJson, parseJsonWithDepthLimit } = require('./init-backlog-session-driver/transcript')

const MAX_FIXTURE_ENTRIES = 256
const MAX_FIXTURE_FILE_BYTES = 16777216
const MAX_FIXTURE_TOTAL_BYTES = 67108864
const MAX_MANIFEST_BYTES = 1048576

function isContained(root, target) {
  const relation = nodePath.relative(root, target)

  return relation !== '' && relation !== '..' && !relation.startsWith(`..${nodePath.sep}`) && !nodePath.isAbsolute(relation)
}

function hasExactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',')
}

function validateRelativePath(path) {
  return typeof path === 'string'
    && path !== ''
    && !nodePath.isAbsolute(path)
    && !path.includes('\\')
    && path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

function stableReadFile({ filesystem, path, physicalRoot, sizeLimit }) {
  const before = filesystem.lstatSync(path, { bigint: true })
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error(`Prompt baseline member is not an ordinary nonlinked file: ${path}`)
  }
  if (before.size > BigInt(sizeLimit)) {
    throw new Error(`Prompt baseline member exceeds its byte limit: ${path}`)
  }
  const physicalPath = filesystem.realpathSync.native(path)
  if (!isContained(physicalRoot, physicalPath)) {
    throw new Error(`Prompt baseline member escapes the fixture root: ${path}`)
  }
  const bytes = filesystem.readFileSync(path)
  const after = filesystem.lstatSync(path, { bigint: true })
  if (!after.isFile() || after.isSymbolicLink() || before.dev !== after.dev || before.ino !== after.ino || before.size !== BigInt(bytes.length) || after.size !== BigInt(bytes.length)) {
    throw new Error(`Prompt baseline member is unstable: ${path}`)
  }

  return bytes
}

function listFixtureFiles({ filesystem, root, physicalRoot }) {
  const files = []
  let entryCount = 0
  const walk = (directory, prefix) => {
    for (const entry of filesystem.readdirSync(directory, { withFileTypes: true })) {
      entryCount += 1
      if (entryCount > MAX_FIXTURE_ENTRIES) {
        throw new Error('Prompt baseline fixture tree exceeds its entry limit')
      }
      const relativePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      const target = nodePath.join(directory, entry.name)
      const metadata = filesystem.lstatSync(target)
      if (metadata.isSymbolicLink()) {
        throw new Error(`Prompt baseline fixture contains a link: ${relativePath}`)
      }
      const physicalTarget = filesystem.realpathSync.native(target)
      if (!isContained(physicalRoot, physicalTarget)) {
        throw new Error(`Prompt baseline fixture entry escapes its root: ${relativePath}`)
      }
      if (metadata.isDirectory()) {
        walk(target, relativePath)
      } else if (metadata.isFile()) {
        files.push(relativePath)
      } else {
        throw new Error(`Prompt baseline fixture contains an unsupported entry: ${relativePath}`)
      }
    }
  }
  walk(root, '')

  return files.sort()
}

function loadPromptBaseline(repositoryRoot, { filesystem = nodeFilesystem } = {}) {
  const logicalRepositoryRoot = nodePath.resolve(repositoryRoot)
  const physicalRepositoryRoot = filesystem.realpathSync.native(logicalRepositoryRoot)
  const root = nodePath.join(logicalRepositoryRoot, 'tests', 'fixtures', 'init-backlog-prompt-baseline')
  const rootMetadata = filesystem.lstatSync(root, { bigint: true })
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new Error('Prompt baseline root is not an ordinary nonlinked directory')
  }
  const physicalRoot = filesystem.realpathSync.native(root)
  if (!isContained(physicalRepositoryRoot, physicalRoot)) {
    throw new Error('Prompt baseline root escapes the repository')
  }
  const manifestPath = nodePath.join(root, 'manifest.json')
  const manifestBytes = stableReadFile({ filesystem, path: manifestPath, physicalRoot, sizeLimit: MAX_MANIFEST_BYTES })
  const parsed = parseJsonWithDepthLimit(manifestBytes.toString('utf8'))
  if (!parsed.ok) {
    throw new Error('Prompt baseline manifest is not valid bounded JSON')
  }
  const manifest = parsed.value
  if (!hasExactKeys(manifest, ['schemaVersion', 'sourceCommit', 'files']) || manifest.schemaVersion !== 1 || manifest.sourceCommit !== SOURCE_COMMIT || !Array.isArray(manifest.files)) {
    throw new Error('Prompt baseline manifest is invalid')
  }
  if (!manifestBytes.equals(Buffer.from(canonicalJson(manifest) + '\n', 'utf8'))) {
    throw new Error('Prompt baseline manifest is not canonical')
  }
  const entries = manifest.files.map((entry) => {
    if (!hasExactKeys(entry, ['path', 'sha256']) || !validateRelativePath(entry.path) || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      throw new Error('Prompt baseline manifest entry path or digest is invalid')
    }

    return entry
  })
  const paths = entries.map((entry) => entry.path)
  if (paths.join('\0') !== SOURCE_PATHS.join('\0')) {
    throw new Error('Prompt baseline manifest file set differs from the frozen source closure')
  }
  const fixtureFiles = listFixtureFiles({ filesystem, physicalRoot, root })
  const expectedFixtureFiles = ['manifest.json', ...SOURCE_PATHS].sort()
  if (fixtureFiles.join('\0') !== expectedFixtureFiles.join('\0')) {
    throw new Error('Prompt baseline fixture file set differs from the frozen source closure')
  }
  let totalBytes = 0
  const files = entries.map((entry) => {
    const path = nodePath.resolve(root, ...entry.path.split('/'))
    if (!isContained(root, path)) {
      throw new Error(`Prompt baseline manifest path is not contained: ${entry.path}`)
    }
    const bytes = stableReadFile({ filesystem, path, physicalRoot, sizeLimit: MAX_FIXTURE_FILE_BYTES })
    totalBytes += bytes.length
    if (totalBytes > MAX_FIXTURE_TOTAL_BYTES) {
      throw new Error('Prompt baseline fixture files exceed their aggregate byte limit')
    }
    if (sha256(bytes) !== entry.sha256) {
      throw new Error(`Prompt baseline bytes differ from the manifest digest: ${entry.path}`)
    }

    return Object.freeze({ bytes, path: entry.path, sha256: entry.sha256 })
  })
  const rootAfter = filesystem.lstatSync(root, { bigint: true })
  if (!rootAfter.isDirectory() || rootAfter.isSymbolicLink() || rootMetadata.dev !== rootAfter.dev || rootMetadata.ino !== rootAfter.ino || filesystem.realpathSync.native(root) !== physicalRoot) {
    throw new Error('Prompt baseline root is unstable')
  }
  for (const entry of manifest.files) {
    Object.freeze(entry)
  }
  Object.freeze(manifest.files)

  return Object.freeze({ baselineManifestSha256: sha256(manifestBytes), files: Object.freeze(files), manifest: Object.freeze(manifest), root })
}

module.exports = { loadPromptBaseline }
