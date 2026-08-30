'use strict'

const { sha256, validateBase64 } = require('./protocol')

function validateUnwrapPrediction(action, finding, computedOutput = undefined) {
  if (finding === undefined) throw new TypeError('Mechanical unwrap finding is missing')
  if (finding.beforeRawSha256 !== action.beforeRawSha256) throw new TypeError('Mechanical unwrap input digest differs from its finding')
  if (finding.predictedRawSha256 !== action.afterRawSha256) throw new TypeError('Mechanical unwrap output digest differs from its finding')
  if (finding.predictedContentBase64 !== null && finding.predictedContentBase64 !== undefined) {
    const predicted = validateBase64(finding.predictedContentBase64)
    if (sha256(predicted) !== finding.predictedRawSha256) throw new TypeError('Mechanical unwrap visible output misses its predicted digest')

    return predicted
  }
  if (computedOutput !== undefined) {
    if (sha256(computedOutput) !== finding.predictedRawSha256) throw new TypeError('Mechanical unwrap computed output misses its predicted digest')

    return computedOutput
  }

  return null
}

module.exports = { validateUnwrapPrediction }
