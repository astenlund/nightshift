'use strict'

const { isDeepStrictEqual } = require('node:util')

const { HOSTS, OutputCapacityError, compareOrdinal, sha256 } = require('./primitives')
const { canonicalJson } = require('./transcript')
const { ELECTION_MARKER_PATH, selectTerminalExpectation, validateLiveElectionMarker, windowsRepositoryImage } = require('../init-backlog-controller/election-oracles')

const RESULT_RECORD_KEYS = Object.freeze(['deterministicDigest', 'dialogueFacts', 'lifecycleFacts', 'passed', 'semanticActionDispositions', 'semanticClassifications', 'semanticDecisionSource', 'semanticDecisions', 'semanticRepairOracles', 'structuredResult', 'terminalRepositorySha256'])

function normalizePlatformModes(repository, platform) {
  return platform === 'win32' ? windowsRepositoryImage(repository) : repository
}

function buildAttestationEvidence(expectedSha256, observedJson, observedSha256) {
  const prefix = `{"expectedSha256":${JSON.stringify(expectedSha256)},"observed":`
  const suffix = `,"observedSha256":${JSON.stringify(observedSha256)}}\n`
  const bytes = Buffer.allocUnsafe(Buffer.byteLength(prefix) + Buffer.byteLength(observedJson) + Buffer.byteLength(suffix))
  let offset = bytes.write(prefix, 0, 'utf8')
  offset += bytes.write(observedJson, offset, 'utf8')
  offset += bytes.write(suffix, offset, 'utf8')
  if (offset !== bytes.length) {
    throw new Error('repository attestation evidence length changed during encoding')
  }

  return bytes
}

function attestTerminalRepository({ collectRepository, host, member, platform, scenarioRoot }) {
  let first
  let observed
  try {
    first = collectRepository()
    observed = collectRepository()
  } catch (error) {
    if (error instanceof OutputCapacityError) {
      return { failure: { detailCode: error.detailCode, initialCode: null, phase: 'post-session' } }
    }

    return { failure: { detailCode: 'repository-attestation', initialCode: null, phase: 'post-session' } }
  }
  const stable = isDeepStrictEqual(first, observed)
  first = null
  if (!stable) {
    return { failure: { detailCode: 'repository-attestation', initialCode: null, phase: 'post-session' } }
  }
  const expected = normalizePlatformModes(selectTerminalExpectation(member, host), platform)
  const expectedSha256 = sha256(canonicalJson(expected))
  const observedMarkers = observed.entries.filter((entry) => entry.path === ELECTION_MARKER_PATH)
  const observedWithoutMarker = { entries: observed.entries.filter((entry) => entry.path !== ELECTION_MARKER_PATH), git: observed.git }
  let passed = isDeepStrictEqual(observedWithoutMarker, expected)
  if (member.marker === null) {
    passed = passed && observedMarkers.length === 0
  } else if (observedMarkers.length !== 1) {
    passed = false
  } else {
    try {
      validateLiveElectionMarker({
        bytes: Buffer.from(observedMarkers[0].contentBase64, 'base64'),
        expectedState: member.marker.state,
        mode: observedMarkers[0].mode,
        platform,
        root: scenarioRoot,
      })
    } catch {
      passed = false
    }
  }
  const observedJson = canonicalJson(observed)
  const observedSha256 = sha256(observedJson)

  return {
    evidenceBytes: buildAttestationEvidence(expectedSha256, observedJson, observedSha256),
    passed,
    terminalRepositorySha256: observedSha256,
  }
}

function buildResultRecord(parts) {
  const keys = Object.keys(parts).sort(compareOrdinal)
  if (keys.join(',') !== RESULT_RECORD_KEYS.join(',')) {
    throw new Error(`result record must carry exactly the closed keys, received: ${keys.join(',')}`)
  }
  if (typeof parts.passed !== 'boolean') {
    throw new Error('result record passed must be a boolean')
  }

  return Object.freeze({ ...parts })
}

function rowSortKey(row, scenarioIds) {
  const hostOrdinal = HOSTS.indexOf(row.host)
  if (hostOrdinal === -1) {
    throw new Error(`summary row host is not closed: ${row.host}`)
  }
  const scenarioOrdinal = scenarioIds.indexOf(row.scenario)
  if (scenarioOrdinal === -1) {
    throw new Error(`summary row scenario is not in the scenario inventory: ${row.scenario}`)
  }

  return [hostOrdinal, scenarioOrdinal, row.controllerEnabled === true ? 1 : 0]
}

function buildSummary({ evidenceManifests, rows, scenarioIds }) {
  for (let index = 1; index < rows.length; index += 1) {
    const previous = rowSortKey(rows[index - 1], scenarioIds)
    const current = rowSortKey(rows[index], scenarioIds)
    if (previous[0] > current[0]) {
      throw new Error('summary rows must be sorted by host ordinal')
    }
    if (previous[0] === current[0] && previous[1] > current[1]) {
      throw new Error('summary rows must be sorted by scenario ordinal')
    }
    if (previous[0] === current[0] && previous[1] === current[1] && previous[2] >= current[2]) {
      throw new Error('summary rows must order controllerEnabled false before true')
    }
  }
  const manifestKey = (item) => [HOSTS.indexOf(item.host), scenarioIds.indexOf(item.scenario), item.mode, item.repetition]
  for (let index = 1; index < evidenceManifests.length; index += 1) {
    const previous = manifestKey(evidenceManifests[index - 1])
    const current = manifestKey(evidenceManifests[index])
    const ordered = previous[0] < current[0]
      || previous[0] === current[0] && previous[1] < current[1]
      || previous[0] === current[0] && previous[1] === current[1] && compareOrdinal(previous[2], current[2]) < 0
      || previous[0] === current[0] && previous[1] === current[1] && previous[2] === current[2] && previous[3] < current[3]
    if (!ordered) {
      throw new Error('summary evidence manifests must be (host,scenario,mode,repetition)-sorted')
    }
  }

  return { evidenceManifests, rows }
}

module.exports = { attestTerminalRepository, buildResultRecord, buildSummary, normalizePlatformModes }
