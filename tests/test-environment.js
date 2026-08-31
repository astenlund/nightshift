'use strict'

const { realpathSync } = require('node:fs')
const { tmpdir } = require('node:os')

function normalizeTestTemporaryDirectory(environment = process.env, platform = process.platform) {
  const canonical = realpathSync.native(tmpdir())
  if (platform === 'win32') {
    environment.TEMP = canonical
    environment.TMP = canonical
  } else {
    environment.TMPDIR = canonical
  }

  return canonical
}

module.exports = { normalizeTestTemporaryDirectory }
