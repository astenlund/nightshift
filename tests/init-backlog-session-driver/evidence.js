'use strict'

const nodeFilesystem = require('node:fs')
const { dirname, join } = require('node:path')

const { BYTE_BOUNDS, HOSTS, compareOrdinal, sha256 } = require('./state')
const { canonicalJson, canonicalJsonLine } = require('./transcript')

const EVIDENCE_HOSTS = HOSTS
const ENABLED_REPETITIONS = Object.freeze([1, 2, 3])


function buildLeafPath({ host, mode, repetition, scenario }) {
  if (!EVIDENCE_HOSTS.includes(host)) {
    throw new Error(`evidence host is not closed: ${host}`)
  }
  if (typeof scenario !== 'string' || scenario === '') {
    throw new Error('evidence scenario must be a nonempty scenario identifier')
  }
  if (mode !== 'enabled' && mode !== 'disabled') {
    throw new Error(`evidence mode is not closed: ${mode}`)
  }
  const allowed = mode === 'enabled' ? ENABLED_REPETITIONS : [1]
  if (!allowed.includes(repetition)) {
    throw new Error(`evidence repetition is not closed for ${mode}: ${repetition}`)
  }

  return `${host}/${scenario}/${mode}/${repetition}`
}

function buildEvidenceManifest(files) {
  const items = files.map((file) => ({ path: file.path, sha256: sha256(file.bytes) }))
  const paths = items.map((item) => item.path)
  if (paths.some((path, index) => index > 0 && compareOrdinal(paths[index - 1], path) >= 0)) {
    throw new Error('evidence manifest files must be duplicate-free and ordinal-path sorted')
  }

  return { evidenceManifestSha256: sha256(Buffer.from(canonicalJson({ files: items }), 'utf8')), files: items }
}

function publishEvidenceLeaf({ files, filesystem = nodeFilesystem, host, leafLimit = BYTE_BOUNDS.MAX_EVIDENCE_LEAF_BYTES, mode, outputRoot, repetition, rootLimit = BYTE_BOUNDS.MAX_EVIDENCE_ROOT_BYTES, rootUsedBytes = 0, scenario }) {
  const sorted = [...files].sort((left, right) => compareOrdinal(left.path, right.path))
  const manifest = buildEvidenceManifest(sorted)
  const manifestBytes = canonicalJsonLine(manifest)
  const leafBytes = sorted.reduce((total, file) => total + file.bytes.length, 0) + manifestBytes.length
  if (leafBytes > leafLimit) {
    return { detailCode: 'output-capacity', limitName: 'MAX_EVIDENCE_LEAF_BYTES', observedBytes: leafBytes, ok: false }
  }
  if (rootUsedBytes + leafBytes > rootLimit) {
    return { detailCode: 'output-capacity', limitName: 'MAX_EVIDENCE_ROOT_BYTES', observedBytes: rootUsedBytes + leafBytes, ok: false }
  }
  const leafRelative = buildLeafPath({ host, mode, repetition, scenario })
  const leafPath = join(outputRoot, ...leafRelative.split('/'))
  const stagingPath = `${leafPath}.staging`
  const publish = [...sorted.map((file) => ({ bytes: file.bytes, path: file.path })), { bytes: manifestBytes, path: 'manifest.json' }]
  const createdDirectories = []
  const ensureDirectory = (path) => {
    if (path === outputRoot || filesystem.existsSync(path)) {
      return
    }
    ensureDirectory(dirname(path))
    filesystem.mkdirSync(path)
    createdDirectories.push(path)
  }
  const cleanupStaging = () => {
    try {
      filesystem.rmSync(stagingPath, { force: true, recursive: true })
      for (const created of [...createdDirectories].reverse()) {
        filesystem.rmSync(created, { force: true, recursive: true })
      }
    } catch {
      // The staging sibling is best-effort debris removal; the failure result already stands.
    }
  }
  try {
    ensureDirectory(dirname(stagingPath))
    filesystem.mkdirSync(stagingPath, { recursive: true })
    for (const file of publish) {
      const target = join(stagingPath, ...file.path.split('/'))
      filesystem.mkdirSync(dirname(target), { recursive: true })
      filesystem.writeFileSync(target, file.bytes)
    }
  } catch {
    cleanupStaging()

    return { detailCode: 'evidence-copy', ok: false }
  }
  try {
    for (const file of publish) {
      const target = join(stagingPath, ...file.path.split('/'))
      const staged = filesystem.readFileSync(target)
      if (!Buffer.from(staged).equals(file.bytes)) {
        throw new Error(`staged evidence bytes differ: ${file.path}`)
      }
    }
  } catch {
    cleanupStaging()

    return { detailCode: 'evidence-verification', ok: false }
  }
  try {
    filesystem.mkdirSync(dirname(leafPath), { recursive: true })
    filesystem.renameSync(stagingPath, leafPath)
    if (filesystem.existsSync(stagingPath) || !filesystem.existsSync(leafPath)) {
      throw new Error('atomic evidence publication left an inconsistent leaf')
    }
  } catch {
    cleanupStaging()

    return { detailCode: 'evidence-copy', ok: false }
  }

  return { evidenceManifestSha256: manifest.evidenceManifestSha256, leafBytes, leafPath, ok: true }
}

module.exports = { ENABLED_REPETITIONS, buildEvidenceManifest, buildLeafPath, publishEvidenceLeaf }
