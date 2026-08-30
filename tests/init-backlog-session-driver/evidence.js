'use strict'

const nodeFilesystem = require('node:fs')
const { dirname, isAbsolute, join, relative, resolve, sep } = require('node:path')

const { BYTE_BOUNDS, HOSTS, compareOrdinal, sha256 } = require('./primitives')
const { canonicalJson, canonicalJsonLine, isCanonicalBase64, parseJsonWithDepthLimit } = require('./transcript')

const EVIDENCE_HOSTS = HOSTS
const ENABLED_REPETITIONS = Object.freeze([1, 2, 3])
const ROOT_REPORT_FILENAMES = Object.freeze(['import-matrix.json', 'summary.json'])
const CREDENTIAL_CARRIER_KEYS = new Set(['afterBase64', 'backupContentBase64', 'beforeBase64', 'contentBase64', 'currentContentBase64', 'dataBase64', 'payloadBase64', 'predictedContentBase64', 'requestBase64', 'stderrBase64', 'stdoutBase64'])
const MAX_CREDENTIAL_CARRIER_DEPTH = 8
const MAX_CREDENTIAL_DECODED_BYTES = BYTE_BOUNDS.MAX_PROXY_TRACE_BYTES * 2
const PROXY_TRACE_KEYS = Object.freeze(['exitCode', 'ordinal', 'requestBase64', 'stderrBase64', 'stdoutBase64'])

function containsCredential(bytes, credentials) {
  return credentials.some((credential) => bytes.indexOf(credential) !== -1)
}

function decodeCanonicalBase64(value) {
  if (!isCanonicalBase64(value)) {
    return null
  }

  return Buffer.from(value, 'base64')
}

function nestedCarrierContainsCredential(bytes, credentials, budget, depth = 0) {
  if (containsCredential(bytes, credentials)) {
    return true
  }
  if (bytes.length === 0) {
    return false
  }
  if (depth >= MAX_CREDENTIAL_CARRIER_DEPTH) {
    return null
  }
  const parsed = parseJsonWithDepthLimit(bytes.toString('utf8').trimEnd())
  if (parsed.ok !== true) {
    return false
  }
  const pending = [parsed.value]
  while (pending.length > 0) {
    const value = pending.pop()
    if (value === null || typeof value !== 'object') {
      continue
    }
    for (const [key, child] of Object.entries(value)) {
      if (!CREDENTIAL_CARRIER_KEYS.has(key)) {
        if (child !== null && typeof child === 'object') pending.push(child)
        continue
      }
      if (child === null) {
        continue
      }
      const decoded = decodeCanonicalBase64(child)
      if (decoded === null) {
        return null
      }
      budget.decodedBytes += decoded.length
      if (budget.decodedBytes > MAX_CREDENTIAL_DECODED_BYTES) {
        return null
      }
      const contaminated = nestedCarrierContainsCredential(decoded, credentials, budget, depth + 1)
      if (contaminated !== false) {
        return contaminated
      }
    }
  }

  return false
}

function transcriptContainsCredential(bytes, credentials) {
  const budget = { decodedBytes: 0 }
  let offset = 0
  while (offset < bytes.length) {
    const newline = bytes.indexOf(0x0a, offset)
    if (newline === -1 || newline === offset) {
      return null
    }
    const parsed = parseJsonWithDepthLimit(bytes.subarray(offset, newline).toString('utf8'))
    if (parsed.ok !== true || parsed.value === null || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
      return null
    }
    const payload = decodeCanonicalBase64(parsed.value.payloadBase64)
    if (payload === null) {
      return null
    }
    budget.decodedBytes += payload.length
    if (budget.decodedBytes > MAX_CREDENTIAL_DECODED_BYTES) {
      return null
    }
    const contaminated = nestedCarrierContainsCredential(payload, credentials, budget)
    if (contaminated !== false) {
      return contaminated
    }
    offset = newline + 1
  }

  return false
}

function repositoryContainsCredential(bytes, credentials) {
  const budget = { decodedBytes: 0 }
  const parsed = parseJsonWithDepthLimit(bytes.toString('utf8').trimEnd())
  if (parsed.ok !== true || parsed.value === null || typeof parsed.value !== 'object' || Array.isArray(parsed.value) || !Array.isArray(parsed.value.observed?.entries)) {
    return null
  }
  for (const entry of parsed.value.observed.entries) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      return null
    }
    if (entry.contentBase64 === null) {
      continue
    }
    const content = decodeCanonicalBase64(entry.contentBase64)
    if (content === null) {
      return null
    }
    budget.decodedBytes += content.length
    if (budget.decodedBytes > MAX_CREDENTIAL_DECODED_BYTES) {
      return null
    }
    const contaminated = nestedCarrierContainsCredential(content, credentials, budget)
    if (contaminated !== false) {
      return contaminated
    }
  }

  return false
}

function proxyTraceContainsCredential(bytes, credentials) {
  const budget = { decodedBytes: 0 }
  let offset = 0
  while (offset < bytes.length) {
    const newline = bytes.indexOf(0x0a, offset)
    if (newline === -1 || newline === offset) {
      return null
    }
    const line = bytes.subarray(offset, newline + 1)
    const parsed = parseJsonWithDepthLimit(bytes.subarray(offset, newline).toString('utf8'))
    const record = parsed.value
    if (parsed.ok !== true
      || record === null
      || typeof record !== 'object'
      || Array.isArray(record)
      || Object.keys(record).sort(compareOrdinal).join(',') !== PROXY_TRACE_KEYS.join(',')
      || !Number.isSafeInteger(record.exitCode)
      || record.exitCode < 0
      || record.exitCode > 255
      || !Number.isSafeInteger(record.ordinal)
      || record.ordinal < 1
      || !line.equals(canonicalJsonLine(record))) {
      return null
    }
    for (const key of ['requestBase64', 'stderrBase64', 'stdoutBase64']) {
      const decoded = decodeCanonicalBase64(record[key])
      if (decoded === null) {
        return null
      }
      budget.decodedBytes += decoded.length
      if (budget.decodedBytes > MAX_CREDENTIAL_DECODED_BYTES) {
        return null
      }
      const contaminated = nestedCarrierContainsCredential(decoded, credentials, budget)
      if (contaminated !== false) {
        return contaminated
      }
    }
    offset = newline + 1
  }

  return false
}

function verifyCredentialFreeEvidence({ credentialValues, files }) {
  if (!Array.isArray(credentialValues) || credentialValues.some((value) => typeof value !== 'string') || !Array.isArray(files)) {
    return false
  }
  const credentials = [...new Set(credentialValues)].filter((value) => value !== '').map((value) => Buffer.from(value, 'utf8'))
  if (credentials.length === 0) {
    return true
  }
  for (const file of files) {
    if (file === null || typeof file !== 'object' || typeof file.path !== 'string' || !Buffer.isBuffer(file.bytes) || containsCredential(file.bytes, credentials)) {
      return false
    }
    let carrierContaminated = false
    if (file.path === 'transcript.jsonl') {
      carrierContaminated = transcriptContainsCredential(file.bytes, credentials)
    } else if (file.path === 'proxy-trace.jsonl') {
      carrierContaminated = proxyTraceContainsCredential(file.bytes, credentials)
    } else if (file.path === 'repository-attestation.json') {
      carrierContaminated = repositoryContainsCredential(file.bytes, credentials)
    }
    if (carrierContaminated !== false) {
      return false
    }
  }

  return true
}

function filesystemOperation(filesystem, name) {
  const operation = filesystem[name] ?? nodeFilesystem[name]

  return operation.bind(filesystem[name] === undefined ? nodeFilesystem : filesystem)
}

function realpathOperation(filesystem) {
  if (typeof filesystem.realpathSync?.native === 'function') {
    return filesystem.realpathSync.native.bind(filesystem.realpathSync)
  }
  if (typeof filesystem.realpathSync === 'function') {
    return filesystem.realpathSync.bind(filesystem)
  }

  return nodeFilesystem.realpathSync.native.bind(nodeFilesystem.realpathSync)
}

function pathIsAtOrInside(root, target) {
  const relation = relative(root, target)

  return relation === '' || (relation !== '..' && !relation.startsWith(`..${sep}`) && !isAbsolute(relation))
}

function metadataIdentity(metadata) {
  return `${metadata.dev.toString()}:${metadata.ino.toString()}`
}

function canonicalOutputRoot(outputRoot, filesystem) {
  const realpath = realpathOperation(filesystem)
  const lstat = filesystemOperation(filesystem, 'lstatSync')
  const firstCanonical = realpath(outputRoot)
  const first = lstat(firstCanonical, { bigint: true })
  const canonical = realpath(outputRoot)
  const second = lstat(canonical, { bigint: true })
  if (firstCanonical !== canonical || !first.isDirectory() || first.isSymbolicLink() || !second.isDirectory() || second.isSymbolicLink() || metadataIdentity(first) !== metadataIdentity(second)) {
    throw new Error('Evidence output root is not an ordinary directory')
  }

  return canonical
}

function verifyContainedDirectory({ canonicalRoot, filesystem, path }) {
  const lstat = filesystemOperation(filesystem, 'lstatSync')
  const realpath = realpathOperation(filesystem)
  const before = lstat(path, { bigint: true })
  const beforeRealpath = realpath(path)
  const after = lstat(path, { bigint: true })
  const afterRealpath = realpath(path)
  if (!before.isDirectory() || before.isSymbolicLink() || !after.isDirectory() || after.isSymbolicLink() || metadataIdentity(before) !== metadataIdentity(after) || beforeRealpath !== afterRealpath || !pathIsAtOrInside(canonicalRoot, afterRealpath)) {
    throw new Error('Evidence directory is not stably confined')
  }

  return { canonicalPath: afterRealpath, identity: metadataIdentity(after) }
}

function verifyContainedFile({ bytes, canonicalRoot, expectedLinks = 1n, filesystem, path }) {
  const lstat = filesystemOperation(filesystem, 'lstatSync')
  const readFile = filesystemOperation(filesystem, 'readFileSync')
  const realpath = realpathOperation(filesystem)
  const before = lstat(path, { bigint: true })
  const beforeRealpath = realpath(path)
  const observed = Buffer.from(readFile(path))
  const after = lstat(path, { bigint: true })
  const afterRealpath = realpath(path)
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== expectedLinks || !after.isFile() || after.isSymbolicLink() || after.nlink !== expectedLinks || metadataIdentity(before) !== metadataIdentity(after) || beforeRealpath !== afterRealpath || !pathIsAtOrInside(canonicalRoot, afterRealpath) || !observed.equals(bytes)) {
    throw new Error('Evidence file is not stably confined')
  }

  return { canonicalPath: afterRealpath, identity: metadataIdentity(after) }
}

function ensureContainedDirectory({ allowBoundaryAlias = false, boundaryPath, canonicalRoot, createdDirectories, filesystem, path }) {
  const exists = filesystemOperation(filesystem, 'existsSync')
  const mkdir = filesystemOperation(filesystem, 'mkdirSync')
  if (resolve(path) === resolve(boundaryPath)) {
    if (allowBoundaryAlias) {
      const realpath = realpathOperation(filesystem)
      const first = realpath(path)
      const second = realpath(path)
      if (first !== canonicalRoot || second !== canonicalRoot) {
        throw new Error('Evidence output root identity changed')
      }

      return { canonicalPath: canonicalRoot }
    }

    return verifyContainedDirectory({ canonicalRoot, filesystem, path })
  }
  if (exists(path)) {
    return verifyContainedDirectory({ canonicalRoot, filesystem, path })
  }
  ensureContainedDirectory({ allowBoundaryAlias, boundaryPath, canonicalRoot, createdDirectories, filesystem, path: dirname(path) })
  mkdir(path)
  createdDirectories.push(path)

  return verifyContainedDirectory({ canonicalRoot, filesystem, path })
}

function validateEvidencePath(path) {
  const segments = typeof path === 'string' ? path.split('/') : []
  if (segments.length === 0 || segments.some((segment) => segment === '' || segment === '.' || segment === '..' || segment.includes('\\')) || path === 'manifest.json') {
    throw new Error('Evidence file path is not closed')
  }
}

function collectInventory(root, filesystem) {
  const lstat = filesystemOperation(filesystem, 'lstatSync')
  const readdir = filesystemOperation(filesystem, 'readdirSync')
  const paths = []
  const walk = (directory, prefix) => {
    for (const entry of readdir(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name)
      const relativePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      const metadata = lstat(entryPath, { bigint: true })
      if (metadata.isSymbolicLink()) {
        throw new Error('Evidence inventory contains a link')
      }
      if (metadata.isDirectory()) {
        walk(entryPath, relativePath)
      } else if (metadata.isFile()) {
        paths.push(relativePath)
      } else {
        throw new Error('Evidence inventory contains a special object')
      }
    }
  }
  walk(root, '')

  return paths.sort(compareOrdinal)
}

function removeOwnedStaging({ canonicalRoot, filesystem, identity, path }) {
  const exists = filesystemOperation(filesystem, 'existsSync')
  const rm = filesystemOperation(filesystem, 'rmSync')
  if (!exists(path)) {
    return
  }
  const current = verifyContainedDirectory({ canonicalRoot, filesystem, path })
  if (current.identity === identity) {
    rm(path, { force: true, recursive: true })
  }
}

function publishOutputFile({ bytes, filename, filesystem = nodeFilesystem, outputRoot }) {
  if (!ROOT_REPORT_FILENAMES.includes(filename)) {
    throw new Error('Output report filename is not closed')
  }
  const canonicalRoot = canonicalOutputRoot(outputRoot, filesystem)
  const targetPath = join(outputRoot, filename)
  const stagingPath = `${targetPath}.staging`
  const exists = filesystemOperation(filesystem, 'existsSync')
  const link = filesystemOperation(filesystem, 'linkSync')
  const unlink = filesystemOperation(filesystem, 'unlinkSync')
  const writeFile = filesystemOperation(filesystem, 'writeFileSync')
  if (exists(targetPath)) {
    throw new Error(`Output report already exists: ${filename}`)
  }
  let staged = false
  let stagedIdentity = null
  try {
    writeFile(stagingPath, bytes, { flag: 'wx', mode: 0o600 })
    staged = true
    const stagedFile = verifyContainedFile({ bytes, canonicalRoot, filesystem, path: stagingPath })
    stagedIdentity = stagedFile.identity
    if (exists(targetPath)) {
      throw new Error(`Output report already exists: ${filename}`)
    }
    link(stagingPath, targetPath)
    const published = verifyContainedFile({ bytes, canonicalRoot, expectedLinks: 2n, filesystem, path: targetPath })
    if (published.identity !== stagedFile.identity) {
      throw new Error('Published output report differs from its stage')
    }
    unlink(stagingPath)
    staged = false
    verifyContainedFile({ bytes, canonicalRoot, filesystem, path: targetPath })

    return targetPath
  } catch (error) {
    if (staged && stagedIdentity !== null && exists(stagingPath)) {
      try {
        const lstat = filesystemOperation(filesystem, 'lstatSync')
        const current = lstat(stagingPath, { bigint: true })
        if (current.isFile() && !current.isSymbolicLink() && metadataIdentity(current) === stagedIdentity) {
          unlink(stagingPath)
        }
      } catch {
        // Preserve the publication error and leave an unowned or changed stage untouched.
      }
    }
    throw error
  }
}

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
  sorted.forEach((file) => validateEvidencePath(file.path))
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
  let canonicalRoot
  let canonicalStagingRoot
  let stagingIdentity = null
  const cleanupStaging = () => {
    try {
      if (stagingIdentity !== null) {
        removeOwnedStaging({ canonicalRoot, filesystem, identity: stagingIdentity, path: stagingPath })
      }
      const rmdir = filesystemOperation(filesystem, 'rmdirSync')
      for (const created of [...createdDirectories].reverse()) {
        if (filesystemOperation(filesystem, 'existsSync')(created)) {
          rmdir(created)
        }
      }
    } catch {
      // Best-effort cleanup never removes a staging path that this call did not create.
    }
  }
  try {
    canonicalRoot = canonicalOutputRoot(outputRoot, filesystem)
    ensureContainedDirectory({ allowBoundaryAlias: true, boundaryPath: outputRoot, canonicalRoot, createdDirectories, filesystem, path: dirname(stagingPath) })
    filesystemOperation(filesystem, 'mkdirSync')(stagingPath)
    stagingIdentity = verifyContainedDirectory({ canonicalRoot, filesystem, path: stagingPath }).identity
    canonicalStagingRoot = realpathOperation(filesystem)(stagingPath)
    for (const file of publish) {
      const target = join(stagingPath, ...file.path.split('/'))
      ensureContainedDirectory({ boundaryPath: stagingPath, canonicalRoot: canonicalStagingRoot, createdDirectories: [], filesystem, path: dirname(target) })
      filesystemOperation(filesystem, 'writeFileSync')(target, file.bytes, { flag: 'wx', mode: 0o600 })
    }
  } catch {
    cleanupStaging()

    return { detailCode: 'evidence-copy', ok: false }
  }
  try {
    for (const file of publish) {
      const target = join(stagingPath, ...file.path.split('/'))
      verifyContainedFile({ bytes: file.bytes, canonicalRoot: canonicalStagingRoot, filesystem, path: target })
    }
    const expectedInventory = publish.map((file) => file.path).sort(compareOrdinal)
    if (collectInventory(stagingPath, filesystem).join('\0') !== expectedInventory.join('\0')) {
      throw new Error('Staged evidence inventory is not closed')
    }
  } catch {
    cleanupStaging()

    return { detailCode: 'evidence-verification', ok: false }
  }
  try {
    const exists = filesystemOperation(filesystem, 'existsSync')
    if (exists(leafPath)) {
      throw new Error('Final evidence leaf already exists')
    }
    filesystemOperation(filesystem, 'renameSync')(stagingPath, leafPath)
    stagingIdentity = null
    if (exists(stagingPath) || !exists(leafPath)) {
      throw new Error('atomic evidence publication left an inconsistent leaf')
    }
    const publishedLeaf = verifyContainedDirectory({ canonicalRoot, filesystem, path: leafPath })
    if (collectInventory(leafPath, filesystem).join('\0') !== publish.map((file) => file.path).sort(compareOrdinal).join('\0')) {
      throw new Error('Published evidence inventory is not closed')
    }
    for (const file of publish) {
      verifyContainedFile({ bytes: file.bytes, canonicalRoot: publishedLeaf.canonicalPath, filesystem, path: join(leafPath, ...file.path.split('/')) })
    }
  } catch {
    cleanupStaging()

    return { detailCode: 'evidence-copy', ok: false }
  }

  return { evidenceManifestSha256: manifest.evidenceManifestSha256, leafBytes, leafPath, ok: true }
}

module.exports = { ENABLED_REPETITIONS, buildEvidenceManifest, buildLeafPath, publishEvidenceLeaf, publishOutputFile, verifyCredentialFreeEvidence }
