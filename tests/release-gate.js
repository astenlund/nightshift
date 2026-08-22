'use strict'

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
  if (path.endsWith('.test.js') || segments.includes('fixtures')) {
    return false
  }

  return segments.length > 1
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  }

  return JSON.stringify(value)
}

function manifestWithoutVersion(manifest) {
  const copy = { ...manifest }
  delete copy.version

  return copy
}

function classifyShippedBehavior(changedPaths, baseManifest, headManifest) {
  const shipped = changedPaths.filter(isShippedResourcePath)
  const manifestChanged = changedPaths.includes(MANIFEST_PATH)
    && stableStringify(manifestWithoutVersion(baseManifest)) !== stableStringify(manifestWithoutVersion(headManifest))
  if (manifestChanged) {
    shipped.push(MANIFEST_PATH)
  }

  return shipped
}

function compareSemver(left, right) {
  const a = left.split('.').map(Number)
  const b = right.split('.').map(Number)
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

module.exports = {
  SHIPPED_BEHAVIOR_SENTENCE,
  MANIFEST_PATH,
  classifyShippedBehavior,
  assessVersionSequence,
}
