'use strict'

const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const { canonicalJson, sha256 } = require('./init-backlog-controller/helpers')
const { windowsRepositoryImage } = require('./init-backlog-controller/election-oracles')
const { SCENARIO_IDS } = require('./init-backlog-controller/host-fixture-oracles')
const { buildExpectedScenarios } = require('./init-backlog-controller/oracles.cases')

const repositoryRoot = join(__dirname, '..')
const fixtureRoot = join(repositoryRoot, 'tests', 'fixtures', 'init-backlog-host')
const expected = buildExpectedScenarios(repositoryRoot)

const scenarios = []
let rewritten = 0
for (const scenarioId of SCENARIO_IDS) {
  const object = expected.get(scenarioId)
  const canonical = Buffer.from(`${canonicalJson(object)}\n`, 'utf8')
  const scenarioPath = join(fixtureRoot, 'scenarios', `${scenarioId}.json`)
  const current = readFileSync(scenarioPath)
  if (!current.equals(canonical)) {
    writeFileSync(scenarioPath, canonical)
    rewritten += 1
    console.log(`rewrote scenario: ${scenarioId}`)
  }
  scenarios.push({
    fileSha256: sha256(Buffer.from(canonicalJson(object), 'utf8')),
    path: `scenarios/${scenarioId}.json`,
    posixScenarioRootSha256: sha256(Buffer.from(canonicalJson(object.repository), 'utf8')),
    scenarioId,
    windowsScenarioRootSha256: sha256(Buffer.from(canonicalJson(windowsRepositoryImage(object.repository)), 'utf8')),
  })
}

const manifestPath = join(fixtureRoot, 'manifest.json')
const manifest = Buffer.from(`${canonicalJson({ scenarios, schemaVersion: 1 })}\n`, 'utf8')
const currentManifest = readFileSync(manifestPath)
if (!currentManifest.equals(manifest)) {
  writeFileSync(manifestPath, manifest)
  console.log('rewrote host fixture manifest')
}
console.log(`scenarios rewritten: ${rewritten}`)
