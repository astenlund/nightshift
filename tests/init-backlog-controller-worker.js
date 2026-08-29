#!/usr/bin/env node
'use strict'

const { dirname, join } = require('node:path')

const { BYTE_BOUNDS, collectControllerRuntimeClosure, createLineDecoder } = require('./init-backlog-session-driver')
const { canonicalJson, canonicalJsonLine, isCanonicalBase64 } = require('./init-backlog-session-driver/transcript')

class WorkerProtocolError extends Error {
  constructor(message) {
    super(message)
    this.name = 'WorkerProtocolError'
  }
}

function createWorkerRuntime({ entryPath, expectedControllerRuntimeSha256, loadModule = require }) {
  const closure = collectControllerRuntimeClosure({ entryPath })
  if (!/^[0-9a-f]{64}$/.test(expectedControllerRuntimeSha256 ?? '')) {
    throw new WorkerProtocolError('worker expected controller runtime digest is malformed')
  }
  if (closure.controllerRuntimeSha256 !== expectedControllerRuntimeSha256) {
    throw new WorkerProtocolError('worker runtime closure differs from the pre-launch snapshot')
  }
  const facade = loadModule(entryPath)
  const { collectInspection } = loadModule(join(dirname(entryPath), 'lib', 'inspection'))
  const handlers = {
    apply: (request) => facade.publishApply(request, {}),
    inspect: facade.inspect,
    'recover-apply': (request) => facade.applyRecovery(request, { collectInspection }),
    'recover-inspect': (request) => facade.inspectRecovery(request, { collectInspection }),
  }

  return {
    closure,
    handleFrameLine(lineBytes) {
      let frame
      try {
        frame = JSON.parse(Buffer.from(lineBytes).toString('utf8'))
      } catch {
        throw new WorkerProtocolError('worker request frame is not JSON')
      }
      if (frame === null || typeof frame !== 'object' || Array.isArray(frame) || Object.keys(frame).sort().join(',') !== 'ordinal,requestBase64') {
        throw new WorkerProtocolError('worker request frame members are not exactly ordinal and requestBase64')
      }
      if (!Number.isSafeInteger(frame.ordinal) || frame.ordinal < 1 || !isCanonicalBase64(frame.requestBase64)) {
        throw new WorkerProtocolError('worker request frame fields are malformed')
      }
      const currentClosure = collectControllerRuntimeClosure({ entryPath })
      if (currentClosure.controllerRuntimeSha256 !== expectedControllerRuntimeSha256) {
        throw new WorkerProtocolError('worker runtime closure changed after worker startup')
      }
      const result = facade.runPrivateDispatcher(Buffer.from(frame.requestBase64, 'base64'), handlers)

      return canonicalJsonLine({
        exitCode: result.exitCode,
        ordinal: frame.ordinal,
        stderrBase64: Buffer.from(result.stderr).toString('base64'),
        stdoutBase64: Buffer.from(result.stdout).toString('base64'),
      })
    },
    readyFrameBytes() {
      return Buffer.from(canonicalJson({ controllerRuntimeSha256: closure.controllerRuntimeSha256, ready: true }) + '\n', 'utf8')
    },
  }
}

function main() {
  const entryPath = process.argv[2]
  const expectedControllerRuntimeSha256 = process.argv[3]
  const runtime = createWorkerRuntime({ entryPath, expectedControllerRuntimeSha256 })
  process.stdout.write(runtime.readyFrameBytes())
  const decoder = createLineDecoder({
    limit: BYTE_BOUNDS.MAX_RUNNER_FRAME_BYTES,
    limitName: 'MAX_RUNNER_FRAME_BYTES',
    onLine(lineBytes) {
      process.stdout.write(runtime.handleFrameLine(lineBytes))
    },
    onOverflow(overflow) {
      process.stderr.write(Buffer.from(`worker frame capacity exceeded: ${overflow.limitName} at ${overflow.observedBytes}\n`, 'ascii'))
      process.exit(1)
    },
  })
  process.stdin.on('data', (chunk) => {
    try {
      decoder.push(chunk)
    } catch (error) {
      process.stderr.write(Buffer.from(`${error.name}: ${error.message}\n`, 'utf8'))
      process.exit(1)
    }
  })
}

if (require.main === module) {
  main()
}

module.exports = { WorkerProtocolError, createWorkerRuntime }
