'use strict'

const { establishPlanBinding } = require('../../internal/plan-binding')

const [repositoryRoot, globalPlansRoot, logicalPath] = process.argv.slice(2)

try {
  establishPlanBinding({ exactUserPath: false, globalPlansRoot, logicalPath, repositoryRoot })
  process.stdout.write('accepted\n')
} catch (error) {
  process.stderr.write(`${error?.code ?? 'unexpected'}\n`)
  process.exitCode = 2
}
