'use strict'

const assert = require('node:assert/strict')
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { spawnSync } = require('node:child_process')
const test = require('node:test')

const { analyzeUnwrapCatalog } = require('../../skills/init-backlog/unwrap')
const { analyzeCatalog } = require('../../skills/ready/ready')

function runCli(script, args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })
}

function runAdapterCases(repositoryRoot) {
  test('controller parser adapters expose stable pure catalog entry points', () => {
    assert.equal(typeof analyzeUnwrapCatalog, 'function')
    assert.equal(typeof analyzeCatalog, 'function')

    const unwrapResult = analyzeUnwrapCatalog([
      { target: 'FEATURES.md', contents: '## Features\n' },
      { target: 'features/example.md', contents: 'Example\nwrapped\n' },
    ])
    const readyResult = analyzeCatalog(unwrapResult.map(({ target, contents }) => ({ target, contents })))

    assert.deepEqual(readyResult.indexes.found, ['FEATURES.md'])
    assert.deepEqual(readyResult.ready, [])
    assert.deepEqual(readyResult.evidence, { structuralErrors: [], notices: [], legacyHistory: [] })
  })

  test('unwrap and ready CLIs retain their public JSON shapes and exit statuses', () => {
    const root = mkdtempSync(join(tmpdir(), 'nightshift-adapter-cli-'))
    try {
      const wrappedFile = join(root, 'wrapped.md')
      writeFileSync(wrappedFile, 'First line\ncontinued\n')
      const unwrap = runCli(join(repositoryRoot, 'skills', 'init-backlog', 'unwrap.js'), [wrappedFile])
      assert.equal(unwrap.status, 1)
      assert.deepEqual(JSON.parse(unwrap.stdout), [{ file: wrappedFile, wraps: 1, firstLine: 2, rewritten: false }])

      const ready = runCli(join(repositoryRoot, 'skills', 'ready', 'ready.js'), [root])
      assert.equal(ready.status, 1)
      assert.deepEqual(Object.keys(JSON.parse(ready.stdout)), ['error'])
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })
}

module.exports = { runAdapterCases }
