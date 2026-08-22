'use strict'

const { isDeepStrictEqual } = require('node:util')

// Pure decisions behind the version-increase gate in release-surface.test.js.
// Nothing here touches git or the filesystem; the live test injects a runner.

const SHIPPED_BEHAVIOR_SENTENCE = 'Shipped plugin behavior is public and internal `SKILL.md` procedures, bundled non-test skill resources, `hooks/**`, and every `.claude-plugin/plugin.json` field other than `version`.'
const MANIFEST_PATH = '.claude-plugin/plugin.json'

// The AGENTS.md list resolved to paths: skills/** and internal/** minus
// *.test.js and fixtures/ directories, plus hooks/**. The manifest is handled
// separately because its rule is field-level, which a path list cannot see.
function isShippedResourcePath(path) {
  const segments = path.split('/')
  if (segments[0] === 'hooks') {
    return segments.length > 1
  }
  if (segments[0] !== 'skills' && segments[0] !== 'internal') {
    return false
  }
  if (path.endsWith('.test.js') || segments.slice(0, -1).includes('fixtures')) {
    return false
  }

  return segments.length > 1
}

function manifestWithoutVersion(manifest) {
  const copy = { ...manifest }
  delete copy.version

  return copy
}

function classifyShippedBehavior(changedPaths, baseManifest, headManifest) {
  const shipped = changedPaths.filter(isShippedResourcePath)
  const manifestChanged = changedPaths.includes(MANIFEST_PATH)
    && !isDeepStrictEqual(manifestWithoutVersion(baseManifest), manifestWithoutVersion(headManifest))
  if (manifestChanged) {
    shipped.push(MANIFEST_PATH)
  }

  return shipped
}

function parseSemver(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new TypeError(`malformed semver: ${version}`)
  }

  return version.split('.').map(Number)
}

function compareSemver(left, right) {
  const a = parseSemver(left)
  const b = parseSemver(right)
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) {
      return a[index] < b[index] ? -1 : 1
    }
  }

  return 0
}

// versions[0] is the range base; the rest are per-commit versions, oldest first.
function assessVersionSequence(versions) {
  let decreasedAt = null
  for (let index = 1; index < versions.length; index += 1) {
    if (decreasedAt === null && compareSemver(versions[index], versions[index - 1]) < 0) {
      decreasedAt = index
    }
  }
  const increased = versions.length > 1 && compareSemver(versions[versions.length - 1], versions[0]) > 0

  return { increased, decreasedAt }
}

const SKIP_NOTICE = 'version-increase check skipped: no upstream and no origin/main to resolve the unpushed range'

// The base is the merge-base with the upstream when one exists (the unpushed
// commits are exactly base..HEAD), otherwise with origin/main; when neither
// resolves the caller skips and reports the notice.
function resolveUnpushedRange(run) {
  for (const ref of ['@{upstream}', 'origin/main']) {
    try {
      const base = run(['merge-base', 'HEAD', ref]).trim()
      if (base !== '') {
        return { base, notice: null }
      }
    } catch {
      // The ref does not exist here; try the next one.
    }
  }

  return { base: null, notice: SKIP_NOTICE }
}

function evaluateReleaseGate({ changedPaths, baseManifest, headManifest, versions }) {
  const shipped = classifyShippedBehavior(changedPaths, baseManifest, headManifest)
  if (shipped.length === 0) {
    return { shipped, ok: true, reason: null }
  }
  const { increased, decreasedAt } = assessVersionSequence(versions)
  if (decreasedAt !== null) {
    return { shipped, ok: false, reason: `the version decreased within the unpushed range at commit ${decreasedAt} of ${versions.length - 1} (${versions[decreasedAt - 1]} to ${versions[decreasedAt]})` }
  }
  if (!increased) {
    return { shipped, ok: false, reason: `shipped behavior changed (${shipped.join(', ')}) without a version increase: ${versions[0]} at the range base, ${versions[versions.length - 1]} at HEAD` }
  }

  return { shipped, ok: true, reason: null }
}

module.exports = {
  SHIPPED_BEHAVIOR_SENTENCE,
  MANIFEST_PATH,
  classifyShippedBehavior,
  assessVersionSequence,
  resolveUnpushedRange,
  evaluateReleaseGate,
}
