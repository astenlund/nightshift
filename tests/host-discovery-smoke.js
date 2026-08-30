'use strict'

const { join } = require('node:path')

const { createTrustedSmokeRuntime, evaluateEvidence, runCell } = require('./host-discovery-smoke-lib')

const checkoutRoot = join(__dirname, '..')
const evidenceRoot = join(checkoutRoot, '.tmp', 'host-smoke-evidence')
const argumentsList = process.argv.slice(2)

async function main() {
  if (argumentsList.length === 1 && (argumentsList[0] === '--check-local' || argumentsList[0] === '--check-release')) {
    const runtime = createTrustedSmokeRuntime({ checkoutRoot, evidenceRoot, parentEnv: process.env })
    const result = evaluateEvidence({ checkoutRoot, evidenceRoot, gitRunner: runtime.gitRunner, release: argumentsList[0] === '--check-release' })
    process.stdout.write(JSON.stringify({ status: 'pass', candidateDigest: result.digest }) + '\n')
    return
  }
  if (argumentsList.length === 4 && argumentsList[0] === '--host' && ['claude', 'codex'].includes(argumentsList[1]) && argumentsList[2] === '--mode' && ['clean', 'repeat'].includes(argumentsList[3])) {
    const row = await runCell({ host: argumentsList[1], mode: argumentsList[3], checkoutRoot, evidenceRoot })
    process.stdout.write(JSON.stringify(row) + '\n')
    if (row.status === 'fail') {
      process.exitCode = 1
    }
    return
  }

  throw new Error('Usage: --host claude|codex --mode clean|repeat | --check-local | --check-release')
}

main().catch((error) => {
  process.stderr.write('host-discovery-smoke: ' + error.message + '\n')
  process.exitCode = 1
})
