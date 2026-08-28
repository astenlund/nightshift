'use strict'

const { HOSTS, compareOrdinal, sha256 } = require('./state')
const { canonicalJson } = require('./transcript')
const { ELECTION_MARKER_PATH, selectTerminalExpectation, validateLiveElectionMarker } = require('../init-backlog-controller/oracles.cases')

const RESULT_RECORD_KEYS = Object.freeze(['deterministicDigest', 'dialogueFacts', 'lifecycleFacts', 'passed', 'semanticActionDispositions', 'semanticClassifications', 'semanticDecisionSource', 'semanticDecisions', 'semanticRepairOracles', 'structuredResult', 'terminalRepositorySha256'])

function normalizePlatformModes(repository, platform) {
  if (platform !== 'win32') {
    return repository
  }

  return { entries: repository.entries.map((entry) => ({ ...entry, mode: null })), git: repository.git }
}

function attestTerminalRepository({ collectRepository, host, member, platform, scenarioRoot }) {
  let first
  let second
  try {
    first = collectRepository()
    second = collectRepository()
  } catch {
    return { failure: { detailCode: 'repository-attestation', initialCode: null, phase: 'post-session' } }
  }
  if (canonicalJson(first) !== canonicalJson(second)) {
    return { failure: { detailCode: 'repository-attestation', initialCode: null, phase: 'post-session' } }
  }
  const observed = second
  const expected = normalizePlatformModes(selectTerminalExpectation(member, host), platform)
  const observedMarkers = observed.entries.filter((entry) => entry.path === ELECTION_MARKER_PATH)
  const observedWithoutMarker = { entries: observed.entries.filter((entry) => entry.path !== ELECTION_MARKER_PATH), git: observed.git }
  let passed = canonicalJson(observedWithoutMarker) === canonicalJson(expected)
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
  const observedSha256 = sha256(Buffer.from(canonicalJson(observed), 'utf8'))

  return {
    passed,
    record: {
      expectedSha256: sha256(Buffer.from(canonicalJson(expected), 'utf8')),
      observed,
      observedSha256,
    },
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

module.exports = { attestTerminalRepository, buildResultRecord, buildSummary }
