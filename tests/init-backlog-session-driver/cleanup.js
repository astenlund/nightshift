'use strict'

const nodeFilesystem = require('node:fs')

const HOST_FACTS = Object.freeze(['host-process-close', 'host-stdout-eof', 'host-stderr-eof', 'host-tree-proof'])
const ENABLED_FACTS = Object.freeze(['proxy-closure', 'worker-process-close', 'worker-stdout-eof', 'worker-stderr-eof', 'worker-containment-empty'])

function createFinalizationBarrier({ enabled }) {
  const required = new Set(enabled ? [...HOST_FACTS, ...ENABLED_FACTS] : HOST_FACTS)
  const satisfied = new Set()

  return {
    complete() {
      return [...required].every((fact) => satisfied.has(fact))
    },
    missing() {
      return [...required].filter((fact) => !satisfied.has(fact)).sort()
    },
    requireTerminationProof(name) {
      required.add(`termination-proven:${name}`)
    },
    satisfy(fact) {
      if (!required.has(fact)) {
        throw new Error(`unknown finalization barrier fact: ${fact}`)
      }
      satisfied.add(fact)
    },
  }
}

function finalizeRunRoot({ filesystem = nodeFilesystem, runRoot, streamClosureExpired = false, terminationProven }) {
  if (terminationProven !== true || streamClosureExpired === true) {
    return { attempted: false, retainedRunRoot: runRoot }
  }
  try {
    filesystem.rmSync(runRoot, { force: true, recursive: true })
    if (filesystem.existsSync(runRoot)) {
      throw new Error('run root remains after recursive removal')
    }
  } catch {
    return { attempted: true, detailCode: 'cleanup', retainedRunRoot: runRoot }
  }

  return { attempted: true, retainedRunRoot: null }
}

module.exports = { createFinalizationBarrier, finalizeRunRoot }
