'use strict'

const { normalizeLineEndings } = require('./git-policy')
const { unwrapText } = require('../unwrap')

function repairFileBytes(source, options) {
  const normalized = normalizeLineEndings(source, options.newline)
  if (options.unwrap !== true) return normalized

  return Buffer.from(unwrapText(normalized.toString('utf8')), 'utf8')
}

module.exports = { repairFileBytes }
