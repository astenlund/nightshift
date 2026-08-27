#!/usr/bin/env node
'use strict'

// Fixed host-visible controller proxy client for the init-backlog behavioral
// evaluation. It implements the production request-spool transport contract
// against its scenario root and forwards one consumed request through the
// driver-owned authenticated loopback proxy. It never loads production
// controller modules and never executes repository code itself.

const { randomBytes, createHash } = require('node:crypto')
const {
  closeSync,
  chmodSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeSync,
} = require('node:fs')
const { isAbsolute, join, relative, sep } = require('node:path')

const REQUEST_GATE_BASENAME = '.nightshift-init-backlog.request-gate'
const REQUEST_OWNER_STAGE_BASENAME = 'owner.new'
const REQUEST_OWNER_BASENAME = 'owner.json'
const REQUEST_PAYLOAD_BASENAME = 'request.json'
const MAX_REQUEST_BYTES = 16777216
const MAX_REPLY_FRAME_BYTES = 5592576

const INVALID_INVOCATION_LINE = Buffer.from('nightshift-init-backlog: invalid request transport invocation\n', 'ascii')
const TRANSPORT_RESIDUE_LINE = Buffer.from('nightshift-init-backlog: request transport residue\n', 'ascii')
const INTERNAL_FAILURE_LINE = Buffer.from('nightshift-init-backlog: internal process failure\n', 'ascii')

class TransportRefusal extends Error {
  constructor(code) {
    super(`request transport refusal: ${code}`)
    this.code = code
    this.name = 'TransportRefusal'
  }
}

class ResidueFailure extends Error {
  constructor(cause) {
    super('request transport cleanup left residue', { cause })
    this.name = 'ResidueFailure'
  }
}

function refuse(code) {
  throw new TransportRefusal(code)
}

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

function isCanonicalBase64(value) {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return false
  }

  return Buffer.from(value, 'base64').toString('base64') === value
}

function validInvocation(argv) {
  if (!Array.isArray(argv) || argv.some((item) => typeof item !== 'string')) {
    return false
  }
  if (argv[0] === '--reserve-request' || argv[0] === '--inspect-request-residue') {
    return argv.length === 2
  }
  if (argv[0] === '--consume-request') {
    return argv.length === 3 && /^[a-f0-9]{32}$/.test(argv[2])
  }
  if (argv[0] === '--clean-request-residue') {
    return argv.length === 6 && (argv[2] === 'null' || /^[a-f0-9]{32}$/.test(argv[2])) && argv.slice(3).every((item) => item === 'null' || /^[a-f0-9]{64}$/.test(item))
  }

  return false
}

function parseProxyEnvironment(environment) {
  const address = environment.NIGHTSHIFT_INIT_BACKLOG_PROXY_ADDRESS
  const port = environment.NIGHTSHIFT_INIT_BACKLOG_PROXY_PORT
  const token = environment.NIGHTSHIFT_INIT_BACKLOG_PROXY_TOKEN
  if (address !== '127.0.0.1' || typeof port !== 'string' || !/^[1-9][0-9]{0,4}$/.test(port)) {
    return null
  }
  const portNumber = Number(port)
  if (!Number.isSafeInteger(portNumber) || portNumber < 1 || portNumber > 65535 || String(portNumber) !== port) {
    return null
  }
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) {
    return null
  }

  return { address, port: portNumber, token }
}

function pathExists(path) {
  try {
    lstatSync(path)

    return true
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.code === 'ENOENT') {
      return false
    }
    throw error
  }
}

function contained(root, target) {
  const relation = relative(root, target)

  return relation !== '..' && !relation.startsWith(`..${sep}`) && !isAbsolute(relation)
}

function comparableIdentity(metadata) {
  return `${metadata.dev.toString()}:${metadata.ino.toString()}`
}

function comparableMode(metadata) {
  return process.platform === 'win32' ? null : Number(metadata.mode & 0o7777n)
}

function canonicalRoot(root) {
  try {
    if (typeof root !== 'string' || root === '' || root.includes(String.fromCharCode(0)) || !isAbsolute(root)) {
      refuse('request-filesystem')
    }
    const canonical = realpathSync.native(root)
    const metadata = lstatSync(canonical)
    if (canonical !== root || !metadata.isDirectory() || metadata.isSymbolicLink()) {
      refuse('request-filesystem')
    }

    return canonical
  } catch (error) {
    if (error instanceof TransportRefusal) {
      throw error
    }
    refuse('request-filesystem')
  }
}

function requestPaths(root) {
  const requestDirectory = join(root, REQUEST_GATE_BASENAME)

  return {
    owner: join(requestDirectory, REQUEST_OWNER_BASENAME),
    ownerStage: join(requestDirectory, REQUEST_OWNER_STAGE_BASENAME),
    payload: join(requestDirectory, REQUEST_PAYLOAD_BASENAME),
    requestDirectory,
  }
}

function verifyGateDirectory(path) {
  const metadata = lstatSync(path, { bigint: true })
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error('request gate is not an ordinary directory')
  }
  if (process.platform !== 'win32' && comparableMode(metadata) !== 0o700) {
    throw new Error('request gate mode is invalid')
  }
}

function verifyRuntimeFile(opened) {
  if (process.platform !== 'win32' && opened.mode !== 0o600) {
    throw new Error('request runtime file mode is invalid')
  }
}

function stableReadFile(root, target, options = {}) {
  if (!contained(root, target)) {
    throw new Error('stable-read target escapes its root')
  }
  const before = lstatSync(target, { bigint: true })
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error('stable-read target is not an ordinary file')
  }
  const flags = process.platform === 'win32' ? constants.O_RDONLY : constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)
  const descriptor = openSync(target, flags)
  try {
    const opened = fstatSync(descriptor, { bigint: true })
    if (!opened.isFile() || comparableIdentity(opened) !== comparableIdentity(before) || opened.size !== before.size || opened.mtimeNs !== before.mtimeNs) {
      throw new Error('stable-read target identity changed')
    }
    const size = Number(opened.size)
    if (!Number.isSafeInteger(size) || size < 0 || options.maxBytes !== undefined && size > options.maxBytes) {
      throw new Error('stable-read target size is invalid')
    }
    const bytes = Buffer.alloc(size)
    let offset = 0
    while (offset < size) {
      const count = readSync(descriptor, bytes, offset, size - offset, offset)
      if (count === 0) {
        throw new Error('stable-read target ended early')
      }
      offset += count
    }
    const after = fstatSync(descriptor, { bigint: true })
    const pathAfter = lstatSync(target, { bigint: true })
    if (comparableIdentity(after) !== comparableIdentity(before) || comparableIdentity(pathAfter) !== comparableIdentity(before) || after.size !== before.size || after.mtimeNs !== before.mtimeNs || pathAfter.isSymbolicLink()) {
      throw new Error('stable-read target changed during the read')
    }

    return { bytes, identity: comparableIdentity(before), mode: comparableMode(before), rawSha256: sha256(bytes) }
  } finally {
    closeSync(descriptor)
  }
}

function stageBytes(path, bytes) {
  const descriptor = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
  let closed = false
  try {
    if (process.platform !== 'win32') {
      fchmodSync(descriptor, 0o600)
    }
    let offset = 0
    while (offset < bytes.length) {
      const count = writeSync(descriptor, bytes, offset, bytes.length - offset, offset)
      if (count <= 0) {
        throw new Error('request stage write made no progress')
      }
      offset += count
    }
    fsyncSync(descriptor)
    closeSync(descriptor)
    closed = true
  } finally {
    if (!closed) {
      closeSync(descriptor)
    }
  }
  if (!readFileSync(path).equals(bytes)) {
    throw new Error('request stage readback differs')
  }
}

function parseOwner(bytes, root) {
  let record
  try {
    const text = bytes.toString('utf8')
    if (!text.endsWith('\n') || text.slice(0, -1).includes('\n')) {
      throw new Error('owner record line is invalid')
    }
    record = JSON.parse(text.slice(0, -1))
    if (!Buffer.from(canonicalJson(record) + '\n', 'utf8').equals(bytes)) {
      throw new Error('owner record is not canonical')
    }
  } catch (error) {
    throw new Error('published request owner is malformed', { cause: error })
  }
  const keys = Object.keys(record).sort(compareOrdinal).join(',')
  const expectedKeys = record.state === 'reserved' ? 'nonce,protocolVersion,root,state' : record.state === 'consuming' ? 'nonce,pid,protocolVersion,root,state' : ''
  if (keys !== expectedKeys || record.protocolVersion !== 1 || record.root !== root || !/^[a-f0-9]{32}$/.test(record.nonce) || record.state === 'consuming' && (!Number.isSafeInteger(record.pid) || record.pid <= 0)) {
    throw new Error('published request owner schema is invalid')
  }

  return record
}

function classifyPid(pid, killProcess) {
  try {
    killProcess(pid, 0)

    return 'live'
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.code === 'ESRCH') {
      return 'absent'
    }

    return 'indeterminate'
  }
}

function collectRequestResidue(root, options = {}) {
  const canonical = canonicalRoot(root)
  const paths = requestPaths(canonical)
  try {
    if (!pathExists(paths.requestDirectory)) {
      refuse('request-invalid-state')
    }
    verifyGateDirectory(paths.requestDirectory)
    const entries = readdirSync(paths.requestDirectory).sort(compareOrdinal)
    const allowed = new Set([REQUEST_OWNER_STAGE_BASENAME, REQUEST_OWNER_BASENAME, REQUEST_PAYLOAD_BASENAME])
    if (entries.some((entry) => !allowed.has(entry))) {
      refuse('request-invalid-state')
    }
    const ownerStage = entries.includes(REQUEST_OWNER_STAGE_BASENAME) ? stableReadFile(canonical, paths.ownerStage) : null
    const owner = entries.includes(REQUEST_OWNER_BASENAME) ? stableReadFile(canonical, paths.owner) : null
    const payloadPresent = entries.includes(REQUEST_PAYLOAD_BASENAME)
    if (ownerStage !== null) {
      verifyRuntimeFile(ownerStage)
    }
    if (owner !== null) {
      verifyRuntimeFile(owner)
    }
    const record = owner === null ? null : parseOwner(owner.bytes, canonical)
    const childSet = entries.join(',')
    let state
    if (childSet === '') {
      state = 'empty-gate'
    } else if (childSet === REQUEST_OWNER_STAGE_BASENAME) {
      state = 'owner-stage'
    } else if (childSet === `${REQUEST_OWNER_BASENAME},${REQUEST_OWNER_STAGE_BASENAME}` && record?.state === 'reserved' && owner.identity === ownerStage.identity && owner.bytes.equals(ownerStage.bytes)) {
      state = 'published-owner-stage'
    } else if (childSet === REQUEST_OWNER_BASENAME && record?.state === 'reserved') {
      state = 'reserved'
    } else if (childSet === `${REQUEST_OWNER_BASENAME},${REQUEST_PAYLOAD_BASENAME}` && record?.state === 'reserved') {
      state = 'reserved-payload'
    } else if (childSet === `${REQUEST_OWNER_BASENAME},${REQUEST_OWNER_STAGE_BASENAME},${REQUEST_PAYLOAD_BASENAME}` && record?.state === 'reserved') {
      state = 'consuming-stage-payload'
    } else if (childSet === `${REQUEST_OWNER_BASENAME},${REQUEST_PAYLOAD_BASENAME}` && record?.state === 'consuming') {
      state = 'consuming-payload'
    } else if (childSet === REQUEST_OWNER_BASENAME && record?.state === 'consuming') {
      state = 'consuming-owner'
    } else {
      refuse('request-invalid-state')
    }
    const killProcess = options.killProcess ?? process.kill.bind(process)
    const pidStatus = record?.state === 'consuming' && options.classifyPid !== false ? classifyPid(record.pid, killProcess) : 'not-applicable'
    const payload = payloadPresent && options.openPayload !== false ? stableReadFile(canonical, paths.payload, { maxBytes: MAX_REQUEST_BYTES }) : null
    const cleanupAllowed = pidStatus === 'not-applicable' || pidStatus === 'absent'

    return {
      canonical,
      owner,
      ownerStage,
      paths,
      payload,
      payloadPresent,
      record,
      result: {
        cleanupAllowed,
        nonce: record?.nonce ?? null,
        ownerRawSha256: owner?.rawSha256 ?? null,
        ownerStageRawSha256: ownerStage?.rawSha256 ?? null,
        payloadRawSha256: payload?.rawSha256 ?? null,
        payloadSize: payload?.bytes.length ?? null,
        pidStatus,
        requestDirectory: REQUEST_GATE_BASENAME,
        state,
      },
    }
  } catch (error) {
    if (error instanceof TransportRefusal) {
      throw error
    }
    refuse('request-filesystem')
  }
}

function inspectRequestResidue(root, options = {}) {
  return collectRequestResidue(root, options).result
}

function reserveRequest(root, options = {}) {
  const canonical = canonicalRoot(root)
  const paths = requestPaths(canonical)
  const nonce = options.nonce ?? randomBytes(16).toString('hex')
  if (!/^[a-f0-9]{32}$/.test(nonce)) {
    refuse('request-filesystem')
  }
  try {
    mkdirSync(paths.requestDirectory, { mode: 0o700 })
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.code === 'EEXIST') {
      const inspection = inspectRequestResidue(canonical, options)
      if ((inspection.pidStatus === 'live' || inspection.pidStatus === 'indeterminate') && inspection.state.startsWith('consuming')) {
        refuse('request-busy')
      }
      refuse('request-residue')
    }
    refuse('request-filesystem')
  }
  if (process.platform !== 'win32') {
    chmodSync(paths.requestDirectory, 0o700)
  }
  verifyGateDirectory(paths.requestDirectory)
  const ownerBytes = Buffer.from(canonicalJson({ nonce, protocolVersion: 1, root: canonical, state: 'reserved' }) + '\n', 'utf8')
  stageBytes(paths.ownerStage, ownerBytes)
  linkSync(paths.ownerStage, paths.owner)
  const stage = stableReadFile(canonical, paths.ownerStage)
  const owner = stableReadFile(canonical, paths.owner)
  verifyRuntimeFile(stage)
  verifyRuntimeFile(owner)
  if (stage.identity !== owner.identity || !stage.bytes.equals(ownerBytes) || !owner.bytes.equals(ownerBytes)) {
    throw new Error('published request owner differs from its stage')
  }
  unlinkSync(paths.ownerStage)
  if (pathExists(paths.ownerStage)) {
    throw new Error('request owner stage was not removed')
  }

  return {
    maxRequestBytes: MAX_REQUEST_BYTES,
    nonce,
    requestDirectory: REQUEST_GATE_BASENAME,
    requestPath: `${REQUEST_GATE_BASENAME}/${REQUEST_PAYLOAD_BASENAME}`,
  }
}

function cleanupPath(path, state, expected) {
  if (!pathExists(path)) {
    return
  }
  try {
    if (expected === null || expected === undefined) {
      throw new Error('request cleanup found an unexpected artifact')
    }
    const parent = join(path, '..')
    const current = stableReadFile(join(parent, '..'), path)
    if (current.identity !== expected.identity || current.rawSha256 !== expected.rawSha256) {
      throw new Error('request cleanup artifact changed before removal')
    }
    unlinkSync(path)
    if (pathExists(path)) {
      throw new Error('removed request artifact is still present')
    }
    state.mutated = true
  } catch (error) {
    if (state.mutated) {
      throw new ResidueFailure(error)
    }
    throw error
  }
}

function cleanupGate(paths, expected, initialMutated = false) {
  const state = { mutated: initialMutated }
  cleanupPath(paths.ownerStage, state, expected.ownerStage)
  cleanupPath(paths.payload, state, expected.payload)
  cleanupPath(paths.owner, state, expected.owner)
  try {
    if (readdirSync(paths.requestDirectory).length !== 0) {
      throw new Error('request gate is not empty')
    }
    rmdirSync(paths.requestDirectory)
    if (pathExists(paths.requestDirectory)) {
      throw new Error('request gate is still present')
    }
    state.mutated = true
  } catch (error) {
    if (state.mutated) {
      throw new ResidueFailure(error)
    }
    throw error
  }
}

function cleanRequestResidue(root, carried, options = {}) {
  const canonical = canonicalRoot(root)
  const paths = requestPaths(canonical)
  let requestDirectoryPresent
  try {
    requestDirectoryPresent = pathExists(paths.requestDirectory)
  } catch {
    refuse('request-filesystem')
  }
  if (!requestDirectoryPresent) {
    if (Object.values(carried).every((value) => value === null)) {
      return { cleaned: true, requestDirectory: REQUEST_GATE_BASENAME }
    }
    refuse('request-evidence-mismatch')
  }
  const collection = collectRequestResidue(canonical, { ...options, classifyPid: false, openPayload: false })
  const current = collection.result
  for (const key of ['nonce', 'ownerRawSha256', 'ownerStageRawSha256']) {
    if (carried[key] !== current[key]) {
      refuse('request-evidence-mismatch')
    }
  }
  if (collection.payloadPresent !== (carried.payloadRawSha256 !== null)) {
    refuse('request-evidence-mismatch')
  }
  if (collection.record?.state === 'consuming') {
    const killProcess = options.killProcess ?? process.kill.bind(process)
    if (classifyPid(collection.record.pid, killProcess) !== 'absent') {
      refuse('request-live')
    }
  }
  if (collection.payloadPresent) {
    const payload = stableReadFile(canonical, paths.payload, { maxBytes: MAX_REQUEST_BYTES })
    if (payload.rawSha256 !== carried.payloadRawSha256) {
      refuse('request-evidence-mismatch')
    }
    collection.payload = payload
  }
  try {
    cleanupGate(paths, { owner: collection.owner, ownerStage: collection.ownerStage, payload: collection.payload })
  } catch (error) {
    if (error instanceof ResidueFailure) {
      throw error
    }
    refuse('request-filesystem')
  }

  return { cleaned: true, requestDirectory: REQUEST_GATE_BASENAME }
}

function consumeRequest(root, nonce, options = {}) {
  const canonical = canonicalRoot(root)
  const paths = requestPaths(canonical)
  const inspection = inspectRequestResidue(canonical, options)
  if (inspection.state !== 'reserved-payload' || inspection.nonce !== nonce) {
    refuse('request-evidence-mismatch')
  }
  const owner = stableReadFile(canonical, paths.owner)
  const payload = stableReadFile(canonical, paths.payload, { maxBytes: MAX_REQUEST_BYTES })
  const reservedRecord = parseOwner(owner.bytes, canonical)
  if (reservedRecord.state !== 'reserved' || reservedRecord.nonce !== nonce || owner.rawSha256 !== inspection.ownerRawSha256 || payload.rawSha256 !== inspection.payloadRawSha256) {
    refuse('request-evidence-mismatch')
  }
  const pid = options.pid ?? process.pid
  const consumingBytes = Buffer.from(canonicalJson({ nonce, pid, protocolVersion: 1, root: canonical, state: 'consuming' }) + '\n', 'utf8')
  stageBytes(paths.ownerStage, consumingBytes)
  renameSync(paths.ownerStage, paths.owner)
  const consumingOwner = stableReadFile(canonical, paths.owner)
  verifyRuntimeFile(consumingOwner)
  if (!consumingOwner.bytes.equals(consumingBytes)) {
    throw new Error('consuming owner differs after atomic rename')
  }
  try {
    cleanupGate(paths, { owner: stableReadFile(canonical, paths.owner), ownerStage: null, payload }, false)
  } catch (error) {
    if (error instanceof ResidueFailure) {
      throw error
    }
    throw new ResidueFailure(error)
  }

  return payload.bytes
}

function defaultConnect({ address, port }) {
  return new Promise((resolveConnection, rejectConnection) => {
    const net = require('node:net')
    const socket = net.connect({ host: address, port })
    socket.on('error', rejectConnection)
    socket.on('connect', () => {
      resolveConnection({
        end() {
          socket.end()
          socket.destroy()
        },
        sendFrame(frameBytes) {
          return new Promise((resolveFrame, rejectFrame) => {
            let buffered = Buffer.alloc(0)
            let settled = false
            socket.on('data', (chunk) => {
              if (settled) {
                return
              }
              buffered = Buffer.concat([buffered, chunk])
              if (buffered.length > MAX_REPLY_FRAME_BYTES) {
                settled = true
                rejectFrame(new Error('proxy reply frame exceeds its byte bound'))
                socket.destroy()

                return
              }
              const terminator = buffered.indexOf(0x0a)
              if (terminator !== -1) {
                settled = true
                resolveFrame(buffered.subarray(0, terminator + 1))
              }
            })
            socket.on('close', () => {
              if (!settled) {
                settled = true
                rejectFrame(new Error('proxy connection closed before a reply frame'))
              }
            })
            socket.write(frameBytes)
          })
        },
      })
    })
  })
}

function validateReplyFrame(replyLine, requestBase64) {
  const line = Buffer.from(replyLine)
  if (line.length === 0 || line[line.length - 1] !== 0x0a) {
    throw new Error('proxy reply frame is not LF-terminated')
  }
  let frame
  try {
    frame = JSON.parse(line.subarray(0, -1).toString('utf8'))
  } catch (error) {
    throw new Error('proxy reply frame is not JSON', { cause: error })
  }
  if (frame === null || typeof frame !== 'object' || Array.isArray(frame) || Object.keys(frame).sort(compareOrdinal).join(',') !== 'exitCode,ordinal,requestBase64,stderrBase64,stdoutBase64') {
    throw new Error('proxy reply frame members are not the closed five-member set')
  }
  if (!Number.isSafeInteger(frame.ordinal) || frame.ordinal < 1 || frame.requestBase64 !== requestBase64 || !isCanonicalBase64(frame.stdoutBase64) || !isCanonicalBase64(frame.stderrBase64) || !Number.isSafeInteger(frame.exitCode) || frame.exitCode < 0 || frame.exitCode > 255) {
    throw new Error('proxy reply frame fields are malformed')
  }

  return { exitCode: frame.exitCode, stderr: Buffer.from(frame.stderrBase64, 'base64'), stdout: Buffer.from(frame.stdoutBase64, 'base64') }
}

async function dispatchThroughProxy(payloadBytes, proxy, options) {
  const connect = options.connect ?? defaultConnect
  const connection = await connect({ address: proxy.address, port: proxy.port })
  try {
    const requestBase64 = payloadBytes.toString('base64')
    const frameBytes = Buffer.from(canonicalJson({ requestBase64, token: proxy.token }) + '\n', 'utf8')
    const replyLine = await connection.sendFrame(frameBytes)

    return validateReplyFrame(replyLine, requestBase64)
  } finally {
    try {
      connection.end()
    } catch {
      // Closing the socket is best-effort after the frame exchange settles.
    }
  }
}

function writeRecord(stream, value) {
  stream.write(Buffer.from(canonicalJson(value) + '\n', 'utf8'))
}

async function runCli(options = {}) {
  const argv = options.argv ?? []
  const stdout = options.stdout ?? process.stdout
  const stderr = options.stderr ?? process.stderr
  if (!validInvocation(argv)) {
    stderr.write(INVALID_INVOCATION_LINE)

    return 2
  }
  try {
    if (argv[0] === '--reserve-request') {
      writeRecord(stdout, reserveRequest(argv[1], options))

      return 0
    }
    if (argv[0] === '--inspect-request-residue') {
      writeRecord(stdout, inspectRequestResidue(argv[1], options))

      return 0
    }
    if (argv[0] === '--clean-request-residue') {
      writeRecord(stdout, cleanRequestResidue(argv[1], {
        nonce: argv[2] === 'null' ? null : argv[2],
        ownerRawSha256: argv[3] === 'null' ? null : argv[3],
        ownerStageRawSha256: argv[4] === 'null' ? null : argv[4],
        payloadRawSha256: argv[5] === 'null' ? null : argv[5],
      }, options))

      return 0
    }
    const proxy = parseProxyEnvironment(options.env ?? process.env)
    if (proxy === null) {
      stderr.write(INVALID_INVOCATION_LINE)

      return 2
    }
    const payloadBytes = consumeRequest(argv[1], argv[2], options)
    const reply = await dispatchThroughProxy(payloadBytes, proxy, options)
    if (reply.stdout.length !== 0) {
      stdout.write(reply.stdout)
    }
    if (reply.stderr.length !== 0) {
      stderr.write(reply.stderr)
    }

    return reply.exitCode
  } catch (error) {
    if (error instanceof ResidueFailure) {
      stderr.write(TRANSPORT_RESIDUE_LINE)

      return 4
    }
    if (error instanceof TransportRefusal) {
      writeRecord(stdout, { code: error.code, ok: false })

      return 1
    }
    stderr.write(INTERNAL_FAILURE_LINE)

    return 3
  }
}

async function main() {
  process.exitCode = await runCli({ argv: process.argv.slice(2), env: process.env })
}

if (require.main === module) {
  main()
}

module.exports = { runCli }
