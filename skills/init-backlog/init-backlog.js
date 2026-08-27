#!/usr/bin/env node
'use strict'

const { InitBacklogError } = require('./lib/errors')
const { canonicalJson, decodeRequest, encodeResult } = require('./lib/protocol')
const {
  RequestTransportResidueError,
  cleanRequestResidue,
  consumeRequest,
  inspectRequestResidue,
  reserveRequest,
} = require('./lib/filesystem')
const { discoverControlledMarkdown, resolveGuidance } = require('./lib/guidance')
const { collectInspection, inspect } = require('./lib/inspection')
const { admitApplyManifest } = require('./lib/apply-manifest')
const { publishApply } = require('./lib/publication')
const { applyRecovery, inspectRecovery } = require('./lib/recovery')

const INVALID_INVOCATION_LINE = Buffer.from('nightshift-init-backlog: invalid request transport invocation\n', 'ascii')
const TRANSPORT_RESIDUE_LINE = Buffer.from('nightshift-init-backlog: request transport residue\n', 'ascii')
const INTERNAL_FAILURE_LINE = Buffer.from('nightshift-init-backlog: internal process failure\n', 'ascii')

function controllerExitCode(result) {
  if (result.ok === false) {
    return result.phase === 'decode' ? 2 : 1
  }
  if (result.operation === 'apply' && result.complete === false) {
    return 1
  }

  return 0
}

function runPrivateDispatcher(requestBytes, handlers = {}) {
  let request
  try {
    request = decodeRequest(requestBytes)
  } catch (error) {
    if (error instanceof InitBacklogError) {
      try {
        const stdout = encodeResult(error.record)

        return { exitCode: controllerExitCode(error.record), stderr: Buffer.alloc(0), stdout }
      } catch {
        return { exitCode: 3, stderr: INTERNAL_FAILURE_LINE, stdout: Buffer.alloc(0) }
      }
    }

    return { exitCode: 3, stderr: INTERNAL_FAILURE_LINE, stdout: Buffer.alloc(0) }
  }

  let result
  try {
    const handler = handlers[request.operation]
    if (typeof handler !== 'function') {
      throw new Error('Controller capability is unavailable')
    }
    result = handler(request)
  } catch (error) {
    if (error instanceof InitBacklogError) {
      try {
        const stdout = encodeResult(error.record)

        return { exitCode: controllerExitCode(error.record), stderr: Buffer.alloc(0), stdout }
      } catch {
        return { exitCode: 3, stderr: INTERNAL_FAILURE_LINE, stdout: Buffer.alloc(0) }
      }
    }

    return { exitCode: 3, stderr: INTERNAL_FAILURE_LINE, stdout: Buffer.alloc(0) }
  }

  try {
    const stdout = encodeResult(result)

    return { exitCode: controllerExitCode(result), stderr: Buffer.alloc(0), stdout }
  } catch {
    return { exitCode: 3, stderr: INTERNAL_FAILURE_LINE, stdout: Buffer.alloc(0) }
  }
}

function writePublicRecord(stream, value) {
  stream.write(Buffer.from(canonicalJson(value) + '\n', 'utf8'))
}

function validPublicInvocation(argv) {
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

function runCli(options = {}) {
  const argv = options.argv ?? []
  const stdout = options.stdout ?? process.stdout
  const stderr = options.stderr ?? process.stderr
  if (!validPublicInvocation(argv)) {
    stderr.write(INVALID_INVOCATION_LINE)

    return 2
  }
  try {
    let result
    if (argv[0] === '--reserve-request') {
      result = reserveRequest(argv[1], { ...options.filesystemOptions, nonce: options.nonce })
    } else if (argv[0] === '--inspect-request-residue') {
      result = inspectRequestResidue(argv[1], options.filesystemOptions)
    } else if (argv[0] === '--clean-request-residue') {
      result = cleanRequestResidue(argv[1], {
        nonce: argv[2] === 'null' ? null : argv[2],
        ownerRawSha256: argv[3] === 'null' ? null : argv[3],
        ownerStageRawSha256: argv[4] === 'null' ? null : argv[4],
        payloadRawSha256: argv[5] === 'null' ? null : argv[5],
      }, options.filesystemOptions)
    } else {
      const dispatch = options.dispatch ?? ((bytes) => runPrivateDispatcher(bytes, { inspect, apply: (request) => publishApply(request, options.filesystemOptions ?? {}), 'recover-inspect': (request) => inspectRecovery(request, { ...options.filesystemOptions, collectInspection }), 'recover-apply': (request) => applyRecovery(request, { ...options.filesystemOptions, collectInspection }), ...(options.handlers ?? {}) }))
      const dispatched = consumeRequest(argv[1], argv[2], dispatch, options.filesystemOptions)
      stdout.write(dispatched.stdout)
      if (dispatched.stderr.length !== 0) {
        stderr.write(dispatched.stderr)
      }

      return dispatched.exitCode
    }
    writePublicRecord(stdout, result)

    return 0
  } catch (error) {
    if (error instanceof RequestTransportResidueError) {
      stderr.write(TRANSPORT_RESIDUE_LINE)

      return 4
    }
    if (error instanceof InitBacklogError && typeof error.record?.code === 'string') {
      writePublicRecord(stdout, { code: error.record.code, ok: false })

      return 1
    }
    stderr.write(INTERNAL_FAILURE_LINE)

    return 3
  }
}

function main() {
  process.exitCode = runCli({ argv: process.argv.slice(2) })
}

if (require.main === module) {
  main()
}

module.exports = { admitApplyManifest, applyRecovery, discoverControlledMarkdown, inspect, inspectRecovery, main, publishApply, resolveGuidance, runCli, runPrivateDispatcher }
