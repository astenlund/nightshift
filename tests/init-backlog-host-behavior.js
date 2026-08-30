'use strict'

// Live cross-host evaluator entry for the deterministic init-backlog harness.
// It composes the already green session-driver surfaces (state, evidence, and
// process supervision) with host command resolution, isolated Codex
// authentication, the version preflight, and result-row assembly. It is a
// non-suite helper: deterministic coverage lives in the controller suite via
// tests/init-backlog-controller/host-entry.cases.js, and this entry is never
// executed against installed hosts by CI.

const { spawnSync } = require('node:child_process')
const { randomBytes } = require('node:crypto')
const nodeFilesystem = require('node:fs')
const nodeNet = require('node:net')
const { homedir } = require('node:os')
const nodePath = require('node:path')

const driver = require('./init-backlog-session-driver')
const { canonicalJson, canonicalJsonLine, parseJsonWithDepthLimit } = require('./init-backlog-session-driver/transcript')
// The dialogue, host-event, and adjudication seams are driver-internal modules
// (not facade exports); the live entry requires them directly, the same way
// the dialogue cases do.
const adjudication = require('./init-backlog-session-driver/adjudication')
const dialogue = require('./init-backlog-session-driver/dialogue')
const evidence = require('./init-backlog-session-driver/evidence')
const hostEvents = require('./init-backlog-session-driver/host-events')
const oracles = require('./init-backlog-controller/host-fixture-oracles')
const { loadPromptBaseline } = require('./init-backlog-prompt-baseline')
const { CLAUDE_ROOT_EXCLUSION_CONFIRMATION } = require('./init-backlog-controller/election-oracles')
const { HOSTS, OutputCapacityError, compareOrdinal, sha256 } = require('./init-backlog-session-driver/primitives')

const HOST_ORDER = HOSTS
const LOGICAL_COMMANDS = Object.freeze({ 'claude-code': 'claude', codex: 'codex' })
const LAUNCH_BOUNDARIES = Object.freeze(['version', 'authentication', 'plugin-setup', 'import-probe', 'worker', 'session'])
// Derived from the evidence leaf grammar's closed repetition ordinals so the
// two surfaces cannot drift apart.
const ENABLED_REPETITIONS = evidence.ENABLED_REPETITIONS.length
const DISABLED_REPETITIONS = 1
const CODEX_PLUGIN_ID = 'nightshift@astenlund'
const MAX_SYMLINK_CHAIN_LINKS = 32
// Exact terminal evidence holds two stable collections and one canonical image
// concurrently, so this admission bound also caps the attestation memory peak.
const MAX_TERMINAL_REPOSITORY_CONTENT_BYTES = 67108864
const MAX_VERSION_LINE_BYTES = 256
const TERMINAL_REPOSITORY_LIMITS = Object.freeze({
  aggregateBytes: MAX_TERMINAL_REPOSITORY_CONTENT_BYTES,
  entries: 65536,
  fileBytes: MAX_TERMINAL_REPOSITORY_CONTENT_BYTES,
  pathBytes: 4194304,
})
const UNSUPPORTED_HOST_LAUNCHER_DETAIL = 'The first PATH host launcher is not a supported native executable.'
const WINDOWS_CANDIDATE_SUFFIXES = Object.freeze(['.exe', '.cmd', '.bat', '.com'])

const CODEX_API_KEY_REDACTION_PREFIX = 'Logged in using an API key - '
const CODEX_AUTHENTICATED_LINES = Object.freeze([
  'Logged in using workload identity',
  'Logged in using ChatGPT',
  'Logged in using access token',
  'Logged in using personal access token',
  'Logged in using Amazon Bedrock API key',
  'Logged in using Amazon Bedrock AWS access keys',
])
const CODEX_UNAUTHENTICATED_LINE = 'Not logged in'
const CODEX_AUTHENTICATION_UNAVAILABLE_RESULT = Object.freeze({
  ok: false,
  host: 'codex',
  code: 'authentication-unavailable',
  detail: 'The isolated Codex evaluation home could not use the current supported authentication channel.',
})

const RESULT_ROW_FIELDS = Object.freeze([
  'host',
  'version',
  'scenario',
  'controllerEnabled',
  'repetitions',
  'baselineManifestSha256',
  'scenarioManifestSha256',
  'scenarioRootDigest',
  'runPluginRootDigest',
  'semanticClassifications',
  'approvalBranch',
  'dialogueFacts',
  'lifecycleFacts',
  'semanticDecisionSource',
  'deterministicDigest',
  'terminalRepositorySha256',
  'passed',
])

const VERSION_DETAILS = Object.freeze({
  failed: 'Version command failed.',
  invalidLine: 'Version output must be one nonblank line of at most 256 bytes.',
  notUtf8: 'Version output is not valid UTF-8.',
  wroteStderr: 'Version command wrote stderr.',
})

function pathApiFor(platform) {
  return platform === 'win32' ? nodePath.win32 : nodePath.posix
}

function comparablePath(path, platform) {
  return platform === 'win32' ? path.toLowerCase() : path
}

function ambientPathValue(ambientEnvironment, platform) {
  if (platform !== 'win32') {
    return ambientEnvironment.PATH ?? ''
  }
  for (const [key, value] of Object.entries(ambientEnvironment)) {
    if (key.toUpperCase() === 'PATH') {
      return value
    }
  }

  return ''
}

function formatResultLine(result) {
  return Buffer.from(JSON.stringify(result) + '\n', 'utf8')
}

function decodeStrictUtf8(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

// --- Host command resolution ---------------------------------------------

function unsupportedHostLauncher(host) {
  return { code: 'unsupported-host-launcher', detail: UNSUPPORTED_HOST_LAUNCHER_DETAIL, host, ok: false }
}

function stableLstat(filesystem, path) {
  const probe = () => {
    try {
      return { ok: true, stat: filesystem.lstatSync(path, { bigint: true }) }
    } catch (error) {
      return { error, ok: false }
    }
  }
  const first = probe()
  const second = probe()
  if (!first.ok && !second.ok && first.error?.code === 'ENOENT' && second.error?.code === 'ENOENT') {
    return { absent: true }
  }
  if (!first.ok || !second.ok) {
    return { unstable: true }
  }
  if (!sameFilesystemIdentity(first.stat, second.stat)) {
    return { unstable: true }
  }

  return { stat: second.stat }
}

function sameFilesystemIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.isFile() === right.isFile()
    && left.isDirectory() === right.isDirectory()
    && left.isSymbolicLink() === right.isSymbolicLink()
}

function stableRealpath(filesystem, target, pathApi, platform) {
  const resolveRealpath = filesystem.realpathSync?.native ?? filesystem.realpathSync
  if (typeof resolveRealpath !== 'function') {
    return { canonicalPath: target }
  }
  let first
  let second
  try {
    first = pathApi.normalize(resolveRealpath(target))
    second = pathApi.normalize(resolveRealpath(target))
  } catch {
    return { unstable: true }
  }
  if (comparablePath(first, platform) !== comparablePath(second, platform)) {
    return { unstable: true }
  }

  return { canonicalPath: second }
}

function insideProtectedRoots(targetPath, protectedRoots, platform) {
  const pathApi = pathApiFor(platform)
  const comparable = comparablePath(targetPath, platform)
  for (const root of protectedRoots) {
    const comparableRoot = comparablePath(root, platform)
    const relation = pathApi.relative(comparableRoot, comparable)
    if (relation === '' || (relation !== '..' && !relation.startsWith(`..${pathApi.sep}`) && !pathApi.isAbsolute(relation))) {
      return true
    }
  }

  return false
}

// Walks a symlink chain to its terminal entry, double-reading every link and
// re-probing every hop so a racing filesystem is rejected rather than followed.
// `rejectProtectedRootHops` selects whether a hop landing inside a protected
// root is rejected mid-walk; callers that clear the terminal path lexically
// afterwards leave it off. The single `{ unstable: true }` rejection is mapped
// to each caller's own refusal value, so rejection semantics stay per-site.
function walkStableSymlinkChain({ filesystem, pathApi, platform, probed, protectedRoots, rejectProtectedRootHops, startPath }) {
  let currentPath = startPath
  let current = probed
  let traversedLinks = 0
  while (current.stat.isSymbolicLink()) {
    traversedLinks += 1
    if (traversedLinks > MAX_SYMLINK_CHAIN_LINKS) {
      return { unstable: true }
    }
    let firstTarget
    let secondTarget
    try {
      firstTarget = filesystem.readlinkSync(currentPath)
      secondTarget = filesystem.readlinkSync(currentPath)
    } catch {
      return { unstable: true }
    }
    if (firstTarget !== secondTarget) {
      return { unstable: true }
    }
    const resolved = pathApi.normalize(pathApi.isAbsolute(firstTarget) ? firstTarget : pathApi.join(pathApi.dirname(currentPath), firstTarget))
    if (!pathApi.isAbsolute(resolved) || (rejectProtectedRootHops && insideProtectedRoots(resolved, protectedRoots, platform))) {
      return { unstable: true }
    }
    currentPath = resolved
    current = stableLstat(filesystem, currentPath)
    if (current.absent || current.unstable) {
      return { unstable: true }
    }
  }

  return { currentPath, stat: current.stat }
}

function canonicalizeStableDirectory({ entry, filesystem, platform, protectedRoots }) {
  const pathApi = pathApiFor(platform)
  const startPath = pathApi.normalize(entry)
  const probed = stableLstat(filesystem, startPath)
  if (probed.absent) {
    return { skip: true }
  }
  if (probed.unstable) {
    return { unstable: true }
  }
  const walked = walkStableSymlinkChain({ filesystem, pathApi, platform, probed, protectedRoots, rejectProtectedRootHops: false, startPath })
  if (walked.unstable) {
    return { unstable: true }
  }
  const currentPath = walked.currentPath
  if (!walked.stat.isDirectory()) {
    return { skip: true }
  }
  if (insideProtectedRoots(currentPath, protectedRoots, platform)) {
    // The canonical identity is inside a protected root, so the directory is
    // never examined even when its lexical PATH spelling looks safe.
    return { skip: true }
  }

  return { canonicalPath: currentPath }
}

function canonicalizeStableProtectedRoots({ entries, filesystem, platform }) {
  const roots = []
  for (const entry of entries) {
    const resolved = canonicalizeStableDirectory({ entry, filesystem, platform, protectedRoots: [] })
    if (resolved.skip || resolved.unstable) {
      return { unstable: true }
    }
    roots.push(resolved.canonicalPath)
  }

  return { roots }
}

function resolvePosixCandidate({ candidatePath, filesystem, logicalName, platform, protectedRoots }) {
  const pathApi = pathApiFor(platform)
  const unsupported = () => ({ unsupported: true })
  const probed = stableLstat(filesystem, candidatePath)
  if (probed.unstable) {
    return unsupported()
  }
  const walked = walkStableSymlinkChain({ filesystem, pathApi, platform, probed, protectedRoots, rejectProtectedRootHops: true, startPath: candidatePath })
  if (walked.unstable) {
    return unsupported()
  }
  const currentPath = walked.currentPath
  const finalStat = walked.stat
  if (!finalStat.isFile() || finalStat.isSymbolicLink()) {
    return unsupported()
  }
  if ((finalStat.mode & 0o111n) === 0n) {
    return unsupported()
  }
  if (insideProtectedRoots(currentPath, protectedRoots, platform)) {
    return unsupported()
  }

  return { descriptor: { argsPrefix: [], executable: currentPath, kind: 'posix-executable', logicalName, sourcePath: candidatePath } }
}

function resolveCommandFromPath({ ambientPath, filesystem, logicalName, platform, protectedRoots }) {
  const pathApi = pathApiFor(platform)
  const delimiter = platform === 'win32' ? ';' : ':'
  const entries = String(ambientPath ?? '')
    .split(delimiter)
    .filter((entry) => entry !== '' && pathApi.isAbsolute(entry))
  for (const entry of entries) {
    // Each examined directory is canonicalized and stable-validated first, so
    // a symlinked PATH directory cannot smuggle a protected-root executable
    // past the lexical check.
    const resolvedDirectory = canonicalizeStableDirectory({ entry, filesystem, platform, protectedRoots })
    if (resolvedDirectory.skip) {
      continue
    }
    if (resolvedDirectory.unstable) {
      return { unsupported: true }
    }
    const directory = resolvedDirectory.canonicalPath
    if (platform === 'win32') {
      for (const suffix of WINDOWS_CANDIDATE_SUFFIXES) {
        const candidatePath = pathApi.join(directory, logicalName + suffix)
        const probed = stableLstat(filesystem, candidatePath)
        if (probed.absent) {
          continue
        }
        // The first existing candidate in the first directory containing any
        // candidate is decisive.
        if (probed.unstable || suffix !== '.exe' || !probed.stat.isFile() || probed.stat.isSymbolicLink() || insideProtectedRoots(candidatePath, protectedRoots, platform)) {
          return { unsupported: true }
        }

        return { descriptor: { argsPrefix: [], executable: candidatePath, kind: 'windows-executable', logicalName, sourcePath: candidatePath } }
      }
      continue
    }
    const candidatePath = pathApi.join(directory, logicalName)
    const probed = stableLstat(filesystem, candidatePath)
    if (probed.absent) {
      continue
    }
    if (probed.unstable) {
      return { unsupported: true }
    }

    return resolvePosixCandidate({ candidatePath, filesystem, logicalName, platform, protectedRoots })
  }

  return { unsupported: true }
}

function resolveHostCommand({ ambientPath, filesystem = nodeFilesystem, host, platform, protectedRoots = [] }) {
  const logicalName = LOGICAL_COMMANDS[host]
  if (logicalName === undefined) {
    throw new Error(`host is not a closed host name: ${host}`)
  }
  const resolution = resolveCommandFromPath({ ambientPath, filesystem, logicalName, platform, protectedRoots })
  if (resolution.unsupported) {
    return { unsupported: unsupportedHostLauncher(host) }
  }

  return resolution
}

function resolveTrustedGit({ ambientPath, filesystem = nodeFilesystem, platform, protectedRoots = [] }) {
  const resolution = resolveCommandFromPath({ ambientPath, filesystem, logicalName: 'git', platform, protectedRoots })
  if (resolution.unsupported) {
    throw new Error('a trusted git executable could not be resolved from the ambient PATH')
  }

  return { executable: resolution.descriptor.executable }
}

function buildContainedAmbientEnvironment({ ambientEnvironment, filesystem, platform, protectedRoots }) {
  const pathApi = pathApiFor(platform)
  const delimiter = pathApi.delimiter
  const canonicalEntries = []
  const seen = new Set()
  for (const entry of String(ambientPathValue(ambientEnvironment, platform) ?? '').split(delimiter)) {
    if (entry === '' || !pathApi.isAbsolute(entry)) {
      continue
    }
    const resolved = canonicalizeStableDirectory({ entry, filesystem, platform, protectedRoots })
    if (resolved.unstable) {
      return { unstable: true }
    }
    if (resolved.skip) {
      continue
    }
    const key = comparablePath(resolved.canonicalPath, platform)
    if (!seen.has(key)) {
      seen.add(key)
      canonicalEntries.push(resolved.canonicalPath)
    }
  }
  const environment = {}
  for (const [key, value] of Object.entries(ambientEnvironment)) {
    if (comparablePath(key, platform) !== 'path') {
      environment[key] = value
    }
  }
  environment.PATH = canonicalEntries.join(delimiter)

  return { environment }
}

// --- Closed environment projection per launch boundary --------------------

function buildLaunchProjection({ ambientEnvironment, boundary, checkoutRoot, controllerPath = null, overrides = {}, platform, proxySession = null, temporaryPaths }) {
  if (!LAUNCH_BOUNDARIES.includes(boundary)) {
    throw new Error(`launch boundary is not closed: ${boundary}`)
  }
  if (proxySession !== null && boundary !== 'session') {
    throw new Error(`proxy session keys are limited to host-session projections: ${boundary}`)
  }
  const temporaryPath = boundary === 'version' ? temporaryPaths.preflight : boundary === 'import-probe' ? temporaryPaths.case : temporaryPaths.run
  if (typeof temporaryPath !== 'string' || temporaryPath === '') {
    throw new Error(`launch boundary ${boundary} requires its lifecycle temp path`)
  }

  return driver.buildClosedProjection({ ambientEnvironment, checkoutRoot, controllerPath, overrides, platform, proxySession, temporaryPath })
}

// --- Codex login-status classification and credential provisioning --------

function readSingleAsciiStderrLine(stderrBytes) {
  if (stderrBytes.length === 0 || stderrBytes[stderrBytes.length - 1] !== 0x0a) {
    return null
  }
  for (const byte of stderrBytes) {
    if (byte > 0x7e || (byte < 0x20 && byte !== 0x0a && byte !== 0x0d)) {
      return null
    }
  }
  const body = stderrBytes.length >= 2 && stderrBytes[stderrBytes.length - 2] === 0x0d
    ? stderrBytes.subarray(0, -2)
    : stderrBytes.subarray(0, -1)
  if (body.length === 0 || body.includes(0x0a) || body.includes(0x0d)) {
    return null
  }

  return body.toString('latin1')
}

function isLegalApiKeyRedaction(rest) {
  if (rest === '***') {
    return true
  }

  // Eight printable ASCII bytes, the literal ***, and five printable ASCII
  // bytes; printability is already guaranteed by the single-line ASCII check.
  return rest.length === 16 && rest.slice(8, 11) === '***'
}

function classifyCodexLoginStatus({ exitCode, signal = null, stderrBytes, stdoutBytes }) {
  if (signal !== null || stdoutBytes.length !== 0) {
    return 'authentication-unavailable'
  }
  const line = readSingleAsciiStderrLine(stderrBytes)
  if (line === null) {
    return 'authentication-unavailable'
  }
  if (exitCode === 0) {
    if (CODEX_AUTHENTICATED_LINES.includes(line)) {
      return 'authenticated'
    }
    if (line.startsWith(CODEX_API_KEY_REDACTION_PREFIX) && isLegalApiKeyRedaction(line.slice(CODEX_API_KEY_REDACTION_PREFIX.length))) {
      return 'authenticated'
    }

    return 'authentication-unavailable'
  }
  if (exitCode === 1 && line === CODEX_UNAUTHENTICATED_LINE) {
    return 'unauthenticated'
  }

  return 'authentication-unavailable'
}

function verifyMode(filesystem, path, expectedMode) {
  const stat = filesystem.lstatSync(path, { bigint: true })

  return Number(stat.mode & 0o7777n) === expectedMode
}

async function provisionCodexAuthentication({ ambientEnvironment, filesystem = nodeFilesystem, homeDirectory = homedir(), isolatedCodexHome, platform, probeLoginStatus }) {
  const unavailable = () => ({ result: CODEX_AUTHENTICATION_UNAVAILABLE_RESULT, status: 'authentication-unavailable' })
  const probe = async () => {
    const outcome = await probeLoginStatus()
    if (outcome !== null && typeof outcome === 'object' && 'failure' in outcome) {
      return { precedence: outcome.failure }
    }

    return { status: classifyCodexLoginStatus(outcome) }
  }
  const first = await probe()
  if (first.precedence !== undefined) {
    return { precedence: first.precedence }
  }
  if (first.status === 'authenticated') {
    return { status: 'authenticated' }
  }
  if (first.status !== 'unauthenticated' || platform === 'win32') {
    // On Windows the isolated result has no protected creation-time DACL
    // surface, so an unauthenticated isolated home never reads or copies a
    // credential file.
    return unavailable()
  }
  const pathApi = pathApiFor(platform)
  const ambientCodexHome = ambientEnvironment.CODEX_HOME
  const sourceHome = typeof ambientCodexHome === 'string' && ambientCodexHome !== '' ? ambientCodexHome : pathApi.join(homeDirectory, '.codex')
  const sourceCredentialPath = pathApi.join(sourceHome, 'auth.json')
  let before
  try {
    before = filesystem.lstatSync(sourceCredentialPath, { bigint: true })
  } catch {
    return unavailable()
  }
  if (!before.isFile() || before.isSymbolicLink()) {
    return unavailable()
  }
  let credentialBytes
  let after
  try {
    credentialBytes = filesystem.readFileSync(sourceCredentialPath)
    after = filesystem.lstatSync(sourceCredentialPath, { bigint: true })
  } catch {
    return unavailable()
  }
  if (before.dev !== after.dev || before.ino !== after.ino || after.size !== BigInt(credentialBytes.length)) {
    return unavailable()
  }
  try {
    filesystem.mkdirSync(isolatedCodexHome, { mode: 0o700 })
  } catch (error) {
    if (error.code !== 'EEXIST') {
      return unavailable()
    }
  }
  const isolatedCredentialPath = pathApi.join(isolatedCodexHome, 'auth.json')
  const releaseCopiedCredential = () => {
    try {
      filesystem.rmSync(isolatedCredentialPath, { force: true })
    } catch {
      return false
    }
    try {
      filesystem.lstatSync(isolatedCredentialPath)
    } catch {
      return true
    }

    return false
  }
  const retainedCredentialCarrier = (initialCode) => ({
    result: infrastructureCarrier({ detailCode: 'cleanup', host: 'codex', initialCode, phase: 'authentication', retainedRunRoot: isolatedCodexHome }),
    status: 'authentication-unavailable',
  })
  // Every non-continuing outcome below this point removes and
  // absence-verifies the copied credential; a removal failure escalates to
  // the retained-root infrastructure carrier instead of silent retention.
  try {
    filesystem.writeFileSync(isolatedCredentialPath, credentialBytes, { flag: 'wx', mode: 0o600 })
  } catch {
    return releaseCopiedCredential() ? unavailable() : retainedCredentialCarrier('authentication-unavailable')
  }
  if (!verifyMode(filesystem, isolatedCodexHome, 0o700) || !verifyMode(filesystem, isolatedCredentialPath, 0o600)) {
    return releaseCopiedCredential() ? unavailable() : retainedCredentialCarrier('authentication-unavailable')
  }
  const second = await probe()
  if (second.precedence !== undefined) {
    const initialCode = driver.PRIMARY_INITIAL_CODES.includes(second.precedence?.code) ? second.precedence.code : null

    return releaseCopiedCredential() ? { precedence: second.precedence } : retainedCredentialCarrier(initialCode)
  }
  if (second.status !== 'authenticated') {
    return releaseCopiedCredential() ? unavailable() : retainedCredentialCarrier('authentication-unavailable')
  }

  return { copiedCredential: true, status: 'authenticated' }
}

// --- Session argv contracts -----------------------------------------------

function buildClaudeSessionArgv({ sessionPluginRoot, turnSchemaJson }) {
  return [
    '--print',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--no-session-persistence',
    '--dangerously-skip-permissions',
    '--setting-sources',
    'project',
    '--json-schema',
    turnSchemaJson,
    '--plugin-dir',
    sessionPluginRoot,
  ]
}

function buildCodexInitialSessionArgv({ scenarioRoot, turnOutputPath, turnSchemaPath }) {
  return ['exec', '--json', '--dangerously-bypass-approvals-and-sandbox', '--output-schema', turnSchemaPath, '-o', turnOutputPath, '-C', scenarioRoot, '-']
}

function buildCodexResumeSessionArgv({ threadId, turnOutputPath, turnSchemaPath }) {
  return ['exec', 'resume', '--json', '--dangerously-bypass-approvals-and-sandbox', '--output-schema', turnSchemaPath, '-o', turnOutputPath, threadId, '-']
}

function buildCodexPluginSetupArgvs({ runPluginRoot }) {
  return [
    ['plugin', 'marketplace', 'add', runPluginRoot, '--json'],
    ['plugin', 'add', CODEX_PLUGIN_ID, '--json'],
    ['plugin', 'list', '--json'],
  ]
}

function verifyCodexPluginList({ platform, runPluginRoot, stdoutBytes }) {
  const text = decodeStrictUtf8(stdoutBytes)
  if (text === null) {
    return { detail: 'plugin list output is not valid UTF-8', ok: false }
  }
  const parsedResult = parseJsonWithDepthLimit(text)
  if (parsedResult.ok !== true) {
    return { detail: 'plugin list output is not valid JSON', ok: false }
  }
  const parsed = parsedResult.value
  const records = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.plugins) ? parsed.plugins : null
  if (records === null) {
    return { detail: 'plugin list output carries no record array', ok: false }
  }
  if (records.length !== 1) {
    return { detail: `plugin list must contain exactly one installed record, found ${records.length}`, ok: false }
  }
  const record = records[0]
  if (record?.pluginId !== CODEX_PLUGIN_ID) {
    return { detail: 'the installed record pluginId differs', ok: false }
  }
  if (record?.source?.source !== 'local') {
    return { detail: 'the installed record source kind is not local', ok: false }
  }
  const pathApi = pathApiFor(platform)
  if (typeof record?.source?.path !== 'string' || comparablePath(pathApi.normalize(record.source.path), platform) !== comparablePath(pathApi.normalize(runPluginRoot), platform)) {
    return { detail: 'the installed record source path differs from the run plugin root', ok: false }
  }

  return { ok: true }
}

// --- Version preflight -----------------------------------------------------

function validateVersionLine(line) {
  if (typeof line !== 'string' || line.includes('\n') || line.includes('\r')) {
    return false
  }
  const byteLength = Buffer.byteLength(line, 'utf8')

  return byteLength >= 1 && byteLength <= MAX_VERSION_LINE_BYTES && line.trim() !== ''
}

function validateVersionOutput({ exitCode, signal = null, stderrBytes, stdoutBytes }) {
  if (signal !== null || exitCode !== 0) {
    return { detail: VERSION_DETAILS.failed, ok: false }
  }
  if (stderrBytes.length !== 0) {
    return { detail: VERSION_DETAILS.wroteStderr, ok: false }
  }
  const text = decodeStrictUtf8(stdoutBytes)
  if (text === null) {
    return { detail: VERSION_DETAILS.notUtf8, ok: false }
  }
  const line = text.endsWith('\r\n') ? text.slice(0, -2) : text.endsWith('\n') ? text.slice(0, -1) : text
  if (!validateVersionLine(line)) {
    return { detail: VERSION_DETAILS.invalidLine, ok: false }
  }

  return { line, ok: true }
}

function createFreshRunRoot({ filesystem, path }) {
  const before = stableLstat(filesystem, path)
  if (before.unstable || (!before.absent && (before.stat.isSymbolicLink() || !before.stat.isDirectory()))) {
    throw new Error(`a fresh run root must start empty and link-free: ${path}`)
  }
  filesystem.mkdirSync(path, { recursive: true })
  const after = stableLstat(filesystem, path)
  if (after.absent || after.unstable || after.stat.isSymbolicLink() || !after.stat.isDirectory()) {
    throw new Error(`a fresh run root must start empty and link-free: ${path}`)
  }
  if (filesystem.readdirSync(path).length !== 0) {
    throw new Error(`a fresh run root must start empty: ${path}`)
  }
}

function prepareRunsRoot({ filesystem, outputRoot, platform, runsRoot }) {
  let probed = stableLstat(filesystem, runsRoot)
  if (probed.absent) {
    try {
      filesystem.mkdirSync(runsRoot)
    } catch {
      return { unstable: true }
    }
    probed = stableLstat(filesystem, runsRoot)
  }
  if (probed.absent || probed.unstable || probed.stat.isSymbolicLink() || !probed.stat.isDirectory()) {
    return { unstable: true }
  }
  const canonical = canonicalizeStableDirectory({ entry: runsRoot, filesystem, platform, protectedRoots: [] })
  if (canonical.skip || canonical.unstable || !insideProtectedRoots(canonical.canonicalPath, [outputRoot], platform)) {
    return { unstable: true }
  }

  return { root: canonical.canonicalPath }
}

function cleanupRunRoot({ filesystem, path }) {
  try {
    filesystem.rmSync(path, { force: true, recursive: true })
    if (filesystem.existsSync(path)) {
      throw new Error('run root remains after recursive removal')
    }
  } catch {
    return { ok: false }
  }

  return { ok: true }
}

async function runVersionPreflight({ ambientEnvironment, checkoutRoot, controllerPath = null, descriptors, filesystem = nodeFilesystem, hosts = HOST_ORDER, launch, platform, preflightRunRoot }) {
  createFreshRunRoot({ filesystem, path: preflightRunRoot })
  const hostTemp = driver.createHostTempChild({ filesystem, platform, runRoot: preflightRunRoot })
  const versions = {}
  const escalateCleanup = (host, initialCode) => ({
    result: infrastructureCarrier({ detailCode: 'cleanup', host, initialCode, phase: 'version', retainedRunRoot: preflightRunRoot }),
  })
  for (const host of hosts) {
    const descriptor = descriptors[host]
    const environment = buildLaunchProjection({
      ambientEnvironment,
      boundary: 'version',
      checkoutRoot,
      controllerPath,
      platform,
      temporaryPaths: { preflight: hostTemp.path },
    })
    const completion = await launch({
      argv: [...descriptor.argsPrefix, '--version'],
      boundary: 'version',
      cwd: checkoutRoot,
      environment,
      executable: descriptor.executable,
      host,
      stdin: 'ignore',
    })
    if (completion !== null && typeof completion === 'object' && 'failure' in completion) {
      if (typeof completion.failure.retainedRunRoot === 'string') {
        return { result: completion.failure }
      }
      if (!cleanupRunRoot({ filesystem, path: preflightRunRoot }).ok) {
        return escalateCleanup(host, completion.failure.code ?? null)
      }

      return { result: completion.failure }
    }
    const validation = validateVersionOutput(completion)
    if (!validation.ok) {
      if (!cleanupRunRoot({ filesystem, path: preflightRunRoot }).ok) {
        return escalateCleanup(host, 'invalid-host-version')
      }

      return { result: { ok: false, host, code: 'invalid-host-version', detail: validation.detail } }
    }
    versions[host] = validation.line
  }
  if (!cleanupRunRoot({ filesystem, path: preflightRunRoot }).ok) {
    return escalateCleanup(hosts[hosts.length - 1], null)
  }

  return { versions }
}

// --- Real terminal repository collector ------------------------------------

function collectTerminalRepository({ filesystem = nodeFilesystem, limits = TERMINAL_REPOSITORY_LIMITS, platform, runGit = null, scenarioRoot }) {
  const limitKeys = ['aggregateBytes', 'entries', 'fileBytes', 'pathBytes']
  if (Object.keys(limits).sort().join(',') !== limitKeys.join(',') || limitKeys.some((key) => !Number.isSafeInteger(limits[key]) || limits[key] < 0)) {
    throw new Error('terminal repository limits must carry exactly four nonnegative safe integers')
  }
  const entries = []
  let aggregateBytes = 0n
  let entryCount = 0
  let pathBytes = 0
  const admit = (limitName, observed, limit) => {
    if (BigInt(observed) > BigInt(limit)) {
      throw new OutputCapacityError({ limitName, observed })
    }
  }
  const collectEntry = (absolutePath, relativePath) => {
    entryCount += 1
    admit('MAX_TERMINAL_REPOSITORY_ENTRIES', entryCount, limits.entries)
    pathBytes += Buffer.byteLength(relativePath, 'utf8')
    admit('MAX_TERMINAL_REPOSITORY_PATH_BYTES', pathBytes, limits.pathBytes)
    const before = filesystem.lstatSync(absolutePath, { bigint: true })
    if (before.isSymbolicLink()) {
      throw new Error(`terminal repository entry is linked: ${relativePath}`)
    }
    const mode = platform === 'win32' ? null : Number(before.mode & 0o7777n)
    if (before.isDirectory()) {
      entries.push({ contentBase64: null, kind: 'directory', mode, path: relativePath })

      return true
    }
    if (!before.isFile()) {
      throw new Error(`terminal repository entry is not an ordinary file or directory: ${relativePath}`)
    }
    admit('MAX_TERMINAL_REPOSITORY_FILE_BYTES', before.size, limits.fileBytes)
    aggregateBytes += before.size
    admit('MAX_TERMINAL_REPOSITORY_AGGREGATE_BYTES', aggregateBytes, limits.aggregateBytes)
    const bytes = filesystem.readFileSync(absolutePath)
    const after = filesystem.lstatSync(absolutePath, { bigint: true })
    if (after.isSymbolicLink() || !after.isFile() || before.dev !== after.dev || before.ino !== after.ino || before.size !== BigInt(bytes.length) || after.size !== BigInt(bytes.length)) {
      throw new Error(`terminal repository entry is unstable: ${relativePath}`)
    }
    entries.push({ contentBase64: bytes.toString('base64'), kind: 'file', mode, path: relativePath })

    return false
  }
  const walk = (directory, prefix) => {
    const handle = filesystem.opendirSync(directory)
    try {
      let entry = handle.readSync()
      while (entry !== null) {
        if (!(prefix === '' && entry.name === '.git')) {
          const relativePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`
          const absolutePath = nodePath.join(directory, entry.name)
          if (collectEntry(absolutePath, relativePath)) {
            walk(absolutePath, relativePath)
          }
        }
        entry = handle.readSync()
      }
    } finally {
      handle.closeSync()
    }
  }
  walk(scenarioRoot, '')
  entries.sort((left, right) => compareOrdinal(left.path, right.path))
  let git
  if (filesystem.existsSync(nodePath.join(scenarioRoot, '.git'))) {
    if (typeof runGit !== 'function') {
      throw new Error('a Git scenario collection requires an injected trusted Git runner')
    }
    const query = runGit(['ls-files', '-z'])
    if (query.exitCode !== 0) {
      throw new Error(`tracked-set query exit code is not zero: ${query.exitCode}`)
    }
    if (query.stderr.length !== 0) {
      throw new Error('tracked-set query stderr is not empty')
    }
    git = { kind: 'git', trackedPaths: driver.parseNulTerminatedTrackedPaths(query.stdout) }
  } else {
    git = { kind: 'non-git', trackedPaths: [] }
  }

  return { entries, git }
}

function createTerminalRepositoryCollector(options) {
  return () => collectTerminalRepository(options)
}

function createScenarioGitRunner({ environment, gitExecutablePath, scenarioRoot }) {
  if (typeof gitExecutablePath !== 'string' || !nodePath.isAbsolute(gitExecutablePath)) {
    throw new Error('the scenario Git runner requires a retained absolute trusted git executable path')
  }

  return (argv) => {
    // Spawning by the retained absolute path means neither a scenario-cwd
    // sentinel nor an untrusted PATH entry can change which git is launched.
    const completion = spawnSync(gitExecutablePath, ['-C', scenarioRoot, ...argv], { env: environment, windowsHide: true })
    if (completion.error) {
      throw new Error('trusted Git invocation failed to spawn', { cause: completion.error })
    }

    return { exitCode: completion.status ?? 1, stderr: completion.stderr, stdout: completion.stdout }
  }
}

// --- Compatibility-transition verification ---------------------------------

function validateCalendarDate(text) {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return false
  }
  const [year, month, day] = text.split('-').map(Number)
  if (month < 1 || month > 12 || day < 1) {
    return false
  }
  const daysInMonth = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

  return day <= daysInMonth[month - 1]
}

function stableReadCanonicalObject(filesystem, path) {
  const before = filesystem.lstatSync(path, { bigint: true })
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error(`compatibility record is not an ordinary nonlinked file: ${path}`)
  }
  const bytes = filesystem.readFileSync(path)
  const after = filesystem.lstatSync(path, { bigint: true })
  if (before.dev !== after.dev || before.ino !== after.ino || after.size !== BigInt(bytes.length)) {
    throw new Error(`compatibility record is not stable across the read: ${path}`)
  }
  const text = decodeStrictUtf8(bytes)
  if (text === null) {
    throw new Error(`compatibility record is not valid UTF-8: ${path}`)
  }
  const parsedResult = parseJsonWithDepthLimit(text)
  if (parsedResult.ok !== true) {
    throw new Error(`compatibility record is not valid JSON: ${path}`)
  }
  const parsed = parsedResult.value
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`compatibility record is not a JSON object: ${path}`)
  }
  if (text !== canonicalJson(parsed) + '\n') {
    throw new Error(`compatibility record is not canonical JSON plus one LF: ${path}`)
  }

  return parsed
}

function verifyCompatibilityTransition({ afterPath, beforePath, filesystem = nodeFilesystem }) {
  const before = stableReadCanonicalObject(filesystem, beforePath)
  const after = stableReadCanonicalObject(filesystem, afterPath)
  for (const record of [before, after]) {
    if (!('claudeVersion' in record) || !('probedOn' in record)) {
      throw new Error('compatibility records must carry claudeVersion and probedOn')
    }
  }
  if (before.claudeVersion !== null || before.probedOn !== null) {
    throw new Error('the before record must carry null claudeVersion and probedOn')
  }
  if (!validateVersionLine(after.claudeVersion)) {
    throw new Error('the after claudeVersion must pass the version-line grammar')
  }
  if (!validateCalendarDate(after.probedOn)) {
    throw new Error('the after probedOn must pass the calendar-date grammar')
  }
  const withoutTransitionFields = (record) => {
    const copy = { ...record }
    delete copy.claudeVersion
    delete copy.probedOn

    return copy
  }
  if (canonicalJson(withoutTransitionFields(before)) !== canonicalJson(withoutTransitionFields(after))) {
    throw new Error('every field other than claudeVersion and probedOn must be canonically equal')
  }

  return { ok: true }
}

// --- Result-row assembly ----------------------------------------------------

function buildResultRow({ baselineManifestSha256, controllerEnabled, host, records, scenario, scenarioManifestSha256, version }) {
  const repetitions = controllerEnabled ? ENABLED_REPETITIONS : DISABLED_REPETITIONS
  if (records.length !== repetitions) {
    throw new Error(`the ${controllerEnabled ? 'enabled' : 'disabled'} row requires exactly ${repetitions} repetition records, received ${records.length}`)
  }
  const sharedValue = (select) => {
    const values = records.map(select)

    return values.every((value) => canonicalJson(value) === canonicalJson(values[0])) ? values[0] : null
  }
  const scenarioRootDigest = sharedValue((record) => record.scenarioRootDigest)
  if (scenarioRootDigest === null) {
    throw new Error('scenario root digests disagree across repetitions')
  }
  const runPluginRootDigest = controllerEnabled ? sharedValue((record) => record.runPluginRootDigest) : null
  const deterministicDigest = controllerEnabled ? sharedValue((record) => record.deterministicDigest) : null
  const terminalRepositorySha256 = sharedValue((record) => record.terminalRepositorySha256)
  const dialogueFacts = sharedValue((record) => record.dialogueFacts)
  const lifecycleFacts = sharedValue((record) => record.lifecycleFacts)
  const passed = records.every((record) => record.passed === true)
    && dialogueFacts !== null
    && lifecycleFacts !== null
    && terminalRepositorySha256 !== null
    && (!controllerEnabled || (runPluginRootDigest !== null && deterministicDigest !== null))

  return {
    host,
    version,
    scenario: scenario.scenarioId,
    controllerEnabled,
    repetitions,
    baselineManifestSha256,
    scenarioManifestSha256,
    scenarioRootDigest,
    runPluginRootDigest,
    semanticClassifications: scenario.oracles.semanticClassifications,
    approvalBranch: scenario.oracles.approvalBranch,
    dialogueFacts: dialogueFacts ?? records[0].dialogueFacts,
    lifecycleFacts: lifecycleFacts ?? records[0].lifecycleFacts,
    semanticDecisionSource: 'model',
    deterministicDigest,
    terminalRepositorySha256,
    passed,
  }
}

// --- Import-probe case ------------------------------------------------------

const IMPORT_PROBE_PROMPT = 'Return the 32-character sentinel stated by the loaded import-probe memory. Return null when no such memory is loaded. Do not infer a sentinel from a path.'
const IMPORT_PROBE_SCHEMA_JSON = canonicalJson({
  additionalProperties: false,
  properties: { sentinel: { anyOf: [{ pattern: '^[0-9a-f]{32}$', type: 'string' }, { type: 'null' }] } },
  required: ['sentinel'],
  type: 'object',
})

function buildImportProbeArgv() {
  return [
    '--print',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-hook-events',
    '--json-schema',
    IMPORT_PROBE_SCHEMA_JSON,
    '--tools',
    '',
    '--no-session-persistence',
    '--setting-sources',
    'project',
    IMPORT_PROBE_PROMPT,
  ]
}

async function runImportCase({ adapterBase64 = null, ambientEnvironment, argv, caseFiles = [], caseRoot, checkoutRoot, controllerPath = null, descriptor, filesystem = nodeFilesystem, host, launch, platform }) {
  createFreshRunRoot({ filesystem, path: caseRoot })
  const hostTemp = driver.createHostTempChild({ filesystem, platform, runRoot: caseRoot })
  // The tilde import case reads from the case root's home child, so the
  // import-probe HOME and USERPROFILE overrides both name that child.
  const importHomePath = nodePath.join(caseRoot, 'home')
  filesystem.mkdirSync(importHomePath)
  if (adapterBase64 !== null) {
    filesystem.writeFileSync(nodePath.join(caseRoot, 'CLAUDE.md'), Buffer.from(adapterBase64, 'base64'))
  }
  for (const caseFile of caseFiles) {
    const target = nodePath.join(caseRoot, ...caseFile.path.split('/'))
    filesystem.mkdirSync(nodePath.dirname(target), { recursive: true })
    filesystem.writeFileSync(target, Buffer.from(caseFile.contentBase64, 'base64'))
  }
  const environment = buildLaunchProjection({
    ambientEnvironment,
    boundary: 'import-probe',
    checkoutRoot,
    controllerPath,
    overrides: { HOME: importHomePath, USERPROFILE: importHomePath },
    platform,
    temporaryPaths: { case: hostTemp.path },
  })
  const completion = await launch({ argv, boundary: 'import-probe', cwd: caseRoot, environment, executable: descriptor.executable, host })

  return { completion, environment, homePath: importHomePath, hostTempPath: hostTemp.path }
}

async function runImportMatrix({ ambientEnvironment, checkoutRoot, controllerPath = null, createRoot, descriptor, filesystem = nodeFilesystem, importCases, launch, platform }) {
  const verdicts = []
  for (const importCase of importCases) {
    const caseRoot = createRoot(`import-${importCase.caseId}`)
    const probe = await runImportCase({
      adapterBase64: importCase.adapterBase64,
      ambientEnvironment,
      argv: buildImportProbeArgv(),
      caseFiles: importCase.files,
      caseRoot,
      checkoutRoot,
      controllerPath,
      descriptor,
      filesystem,
      host: 'claude-code',
      launch,
      platform,
    })
    if (probe.completion !== null && typeof probe.completion === 'object' && 'failure' in probe.completion) {
      return { failure: probe.completion.failure, verdicts }
    }
    const verdict = hostEvents.validateImportProbeSession({
      expectedSentinel: importCase.expectedSentinel,
      exitCode: probe.completion.exitCode,
      stderrBytes: probe.completion.stderrBytes,
      stdoutBytes: probe.completion.stdoutBytes,
    })
    verdicts.push(verdict.passed === true ? { caseId: importCase.caseId, passed: true } : { caseId: importCase.caseId, passed: false, reason: verdict.reason })
    if (!cleanupRunRoot({ filesystem, path: caseRoot }).ok) {
      return {
        failure: infrastructureCarrier({ detailCode: 'cleanup', host: 'claude-code', phase: 'import-probe', retainedRunRoot: caseRoot }),
        verdicts,
      }
    }
  }

  return { passed: verdicts.every((verdict) => verdict.passed === true), verdicts }
}

// --- Run plugin roots -------------------------------------------------------

const CONTROLLER_ENTRY_RELATIVE_PATH = 'skills/init-backlog/init-backlog.js'
const PLUGIN_REQUIRED_MANIFEST_FILES = Object.freeze(['.claude-plugin/marketplace.json', '.claude-plugin/plugin.json'])
const PLUGIN_RUNTIME_DIRECTORIES = Object.freeze(['hooks', 'internal', 'skills'])

function listPluginRuntimeFiles({ checkoutRoot, filesystem }) {
  const relativePaths = []
  for (const requiredPath of PLUGIN_REQUIRED_MANIFEST_FILES) {
    const metadata = filesystem.lstatSync(nodePath.join(checkoutRoot, ...requiredPath.split('/')))
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`a required plugin manifest file is not an ordinary nonlinked file: ${requiredPath}`)
    }
    relativePaths.push(requiredPath)
  }
  const walk = (absoluteDirectory, relativeDirectory) => {
    for (const entry of filesystem.readdirSync(absoluteDirectory, { withFileTypes: true })) {
      const relativePath = `${relativeDirectory}/${entry.name}`
      const absolutePath = nodePath.join(absoluteDirectory, entry.name)
      const metadata = filesystem.lstatSync(absolutePath)
      if (metadata.isSymbolicLink()) {
        throw new Error(`a plugin runtime entry is linked: ${relativePath}`)
      }
      if (metadata.isDirectory()) {
        walk(absolutePath, relativePath)
      } else if (metadata.isFile()) {
        relativePaths.push(relativePath)
      } else {
        throw new Error(`a plugin runtime entry is not an ordinary file or directory: ${relativePath}`)
      }
    }
  }
  for (const runtimeDirectory of PLUGIN_RUNTIME_DIRECTORIES) {
    const absoluteDirectory = nodePath.join(checkoutRoot, runtimeDirectory)
    if (filesystem.existsSync(absoluteDirectory)) {
      walk(absoluteDirectory, runtimeDirectory)
    }
  }
  const sorted = [...relativePaths].sort(compareOrdinal)
  if (new Set(sorted).size !== sorted.length) {
    throw new Error('the plugin runtime file set carries a duplicate path')
  }

  return sorted
}

function buildEnabledPluginRoot({ checkoutRoot, controllerEntryPath, filesystem = nodeFilesystem, manifestPath, proxyClientPath, runPluginRoot }) {
  const closure = driver.collectControllerRuntimeClosure({ entryPath: controllerEntryPath, filesystem })
  const proxyClientBytes = filesystem.readFileSync(proxyClientPath)
  const files = []
  for (const relativePath of listPluginRuntimeFiles({ checkoutRoot, filesystem })) {
    const sourceBytes = filesystem.readFileSync(nodePath.join(checkoutRoot, ...relativePath.split('/')))
    const role = relativePath === CONTROLLER_ENTRY_RELATIVE_PATH ? 'controller-proxy' : 'exact'
    const installedBytes = role === 'controller-proxy' ? proxyClientBytes : sourceBytes
    const target = nodePath.join(runPluginRoot, ...relativePath.split('/'))
    filesystem.mkdirSync(nodePath.dirname(target), { recursive: true })
    filesystem.writeFileSync(target, installedBytes)
    const written = filesystem.readFileSync(target)
    if (!written.equals(installedBytes)) {
      throw new Error(`plugin root bytes changed during copying: ${relativePath}`)
    }
    files.push({ installedSha256: sha256(installedBytes), path: relativePath, role, sourceSha256: sha256(sourceBytes) })
  }
  if (!files.some((file) => file.role === 'controller-proxy')) {
    throw new Error('the enabled plugin root must replace the controller entry with the fixed proxy client')
  }
  const manifest = { controllerRuntimeSha256: closure.controllerRuntimeSha256, files, schemaVersion: 1 }
  filesystem.writeFileSync(manifestPath, canonicalJsonLine(manifest))

  return { controllerRuntimeSha256: closure.controllerRuntimeSha256, manifest, runPluginRootDigest: sha256(Buffer.from(canonicalJson(manifest), 'utf8')) }
}

function buildDisabledPluginRoot({ baselineFiles = null, baselineManifest = null, baselineRoot = null, disabledRunPluginRoot, filesystem = nodeFilesystem, manifestPath }) {
  if ((baselineFiles === null) === (baselineManifest === null)) {
    throw new Error('the disabled plugin root requires exactly one baseline file authority')
  }
  const containedPath = (root, relativePath) => {
    if (typeof relativePath !== 'string' || relativePath === '' || nodePath.isAbsolute(relativePath) || relativePath.includes('\\') || relativePath.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
      throw new Error(`disabled baseline path is not contained: ${relativePath}`)
    }
    const resolvedRoot = nodePath.resolve(root)
    const target = nodePath.resolve(resolvedRoot, ...relativePath.split('/'))
    const relation = nodePath.relative(resolvedRoot, target)
    if (relation === '' || relation === '..' || relation.startsWith(`..${nodePath.sep}`) || nodePath.isAbsolute(relation)) {
      throw new Error(`disabled baseline path is not contained: ${relativePath}`)
    }

    return target
  }
  const sourceEntries = baselineFiles ?? baselineManifest.files
  if (!Array.isArray(sourceEntries)) {
    throw new Error('the disabled baseline file authority must be an array')
  }
  if (sourceEntries.some((entry) => entry === null || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.path !== 'string' || typeof entry.sha256 !== 'string')) {
    throw new Error('every disabled baseline entry requires a path and digest')
  }
  const paths = sourceEntries.map((entry) => entry.path)
  if (paths.join('\0') !== [...paths].sort(compareOrdinal).join('\0') || new Set(paths).size !== paths.length) {
    throw new Error('the disabled baseline paths must be unique and ordinal sorted')
  }
  for (const entry of sourceEntries) {
    if (entry.path === CONTROLLER_ENTRY_RELATIVE_PATH) {
      throw new Error('the disabled baseline must not carry the controller entry point')
    }
    if (!/^[a-f0-9]{64}$/.test(entry.sha256)) {
      throw new Error(`disabled baseline digest is invalid: ${entry.path}`)
    }
    containedPath(disabledRunPluginRoot, entry.path)
    if (baselineFiles === null) {
      containedPath(baselineRoot, entry.path)
    }
  }
  const preparedEntries = sourceEntries.map((entry) => {
    const bytes = baselineFiles === null ? filesystem.readFileSync(containedPath(baselineRoot, entry.path)) : entry.bytes
    if (!Buffer.isBuffer(bytes)) {
      throw new Error(`disabled baseline bytes are missing: ${entry.path}`)
    }
    if (sha256(bytes) !== entry.sha256) {
      throw new Error(`disabled baseline bytes differ from the manifest digest: ${entry.path}`)
    }

    return { bytes, path: entry.path, sha256: entry.sha256 }
  })
  const files = []
  for (const entry of preparedEntries) {
    const target = containedPath(disabledRunPluginRoot, entry.path)
    filesystem.mkdirSync(nodePath.dirname(target), { recursive: true })
    filesystem.writeFileSync(target, entry.bytes)
    if (!filesystem.readFileSync(target).equals(entry.bytes)) {
      throw new Error(`disabled plugin root bytes changed during copying: ${entry.path}`)
    }
    files.push({ path: entry.path, sha256: entry.sha256 })
  }
  if (filesystem.existsSync(nodePath.join(disabledRunPluginRoot, ...CONTROLLER_ENTRY_RELATIVE_PATH.split('/')))) {
    throw new Error('the disabled plugin root must not contain a directly invokable controller entry')
  }
  const manifest = { files, schemaVersion: 1 }
  filesystem.writeFileSync(manifestPath, canonicalJsonLine(manifest))

  return { manifest, runPluginRootDigest: null }
}

// --- Cross-domain wiring helpers (Task 14b review obligations) --------------

// Transcript ordinals and proxy ordinals are separate domains, so each
// admitted apply call captures the transcript watermark at admission; the
// adjudication seam consumes exactly that pairing.
function createApplyCallRecorder({ gate, transcriptOrdinal }) {
  if (typeof transcriptOrdinal !== 'function') {
    throw new Error('the apply-call recorder requires a transcript ordinal reader')
  }
  const applyCalls = []
  let admittedOrdinal = 0

  return {
    applyCalls,
    gate: {
      ...gate,
      admit(requestBytes) {
        const verdict = gate.admit(requestBytes)
        if (verdict.ok === true) {
          admittedOrdinal += 1
          if (verdict.operation === 'apply') {
            applyCalls.push({ proxyOrdinal: admittedOrdinal, transcriptWatermark: transcriptOrdinal() })
          }
        }

        return verdict
      },
    },
  }
}

// Pre-filter for deriveWriterDisclosure: only codes presented after the
// inspect watermark and, when an approved apply request exists, at or before
// that request's transcript watermark are in the qualifying window.
function collectQualifyingWriterCodes({ applyRequestWatermark = null, inspectWatermark, turnRecords }) {
  if (!Number.isSafeInteger(inspectWatermark) || inspectWatermark < 0) {
    throw new Error('inspectWatermark must be a nonnegative transcript ordinal count')
  }
  if (applyRequestWatermark !== null && (!Number.isSafeInteger(applyRequestWatermark) || applyRequestWatermark < 0)) {
    throw new Error('applyRequestWatermark must be a nonnegative transcript ordinal count or null')
  }
  const codes = []
  for (const record of turnRecords) {
    if (!Number.isSafeInteger(record.ordinal) || record.ordinal < 1 || !Array.isArray(record.disclosureCodes)) {
      throw new Error('every turn record carries its transcript ordinal and disclosureCodes array')
    }
    if (record.ordinal <= inspectWatermark) {
      continue
    }
    if (applyRequestWatermark !== null && record.ordinal > applyRequestWatermark) {
      continue
    }
    codes.push(...record.disclosureCodes)
  }

  return codes
}

// A present-root Claude scenario is verified through the host's own
// loaded-memory path record: the system/init event's memory_paths array must
// name the scenario root CLAUDE.md under platform path comparison.
function deriveVerifiedLoadedMemory({ initEvent, platform, scenarioRoot }) {
  if (initEvent === null || typeof initEvent !== 'object') {
    return false
  }
  const memoryPaths = initEvent.memory_paths
  if (!Array.isArray(memoryPaths)) {
    return false
  }
  const expected = comparablePath(pathApiFor(platform).join(scenarioRoot, 'CLAUDE.md'), platform)

  return memoryPaths.some((memoryPath) => typeof memoryPath === 'string' && comparablePath(memoryPath, platform) === expected)
}

// --- Assembled evaluation ---------------------------------------------------

async function runEvaluation(options) {
  const {
    ambientEnvironment,
    baselineManifestSha256,
    checkoutRoot,
    collectRepositoryFactory = (collectorOptions) => createTerminalRepositoryCollector(collectorOptions),
    commandFilesystem = null,
    controllerEntryPath,
    controllerPath = null,
    controllerWorkerPath,
    createRoot,
    descriptors,
    evidenceOutputRoot = null,
    evidenceRootLimit = driver.BYTE_BOUNDS.MAX_EVIDENCE_ROOT_BYTES,
    filesystem = nodeFilesystem,
    homeDirectory = homedir(),
    hosts = HOST_ORDER,
    launch,
    nodeExecutablePath = process.execPath,
    platform,
    preparePluginRoot,
    protectedRoots = [],
    provisionAuthentication = provisionCodexAuthentication,
    proxySessionFactory = null,
    runGitFactory = null,
    runSession,
    scenarioManifestSha256,
    scenarios,
    turnSchemaJson,
    turnSchemaPath,
  } = options
  const stopWith = (result) => ({ evidenceManifests: [], exitCode: 1, result, resultLine: formatResultLine(result), rows: [], summary: null, trustedGitExecutable: null, versions: null })
  const resolvedDescriptors = {}
  for (const host of hosts) {
    const resolution = descriptors[host]
    if (resolution.unsupported) {
      return stopWith(resolution.unsupported)
    }
    resolvedDescriptors[host] = resolution.descriptor
  }
  // The trusted git executable is resolved exactly once at evaluation start,
  // against the original ambient PATH and outside every protected root, and
  // threaded to every scenario git runner. A resolution failure is a
  // preflight-class trusted-executable failure before any session.
  let trustedGitExecutable = null
  let effectiveRunGitFactory = runGitFactory
  if (effectiveRunGitFactory === null) {
    try {
      trustedGitExecutable = resolveTrustedGit({
        ambientPath: ambientPathValue(ambientEnvironment, platform),
        filesystem: commandFilesystem ?? filesystem,
        platform,
        protectedRoots,
      }).executable
    } catch {
      return stopWith(infrastructureCarrier({ detailCode: 'containment-unavailable', host: hosts[0], phase: 'version' }))
    }
    effectiveRunGitFactory = ({ gitIsolation, scenarioRoot }) => createScenarioGitRunner({
      environment: driver.buildHarnessGitEnvironment({
        ambientEnvironment,
        attributesPath: gitIsolation.attributesPath,
        configPath: gitIsolation.configPath,
        platform,
        templatePath: gitIsolation.templatePath,
      }),
      gitExecutablePath: trustedGitExecutable,
      scenarioRoot,
    })
  }
  const workerAmbient = buildContainedAmbientEnvironment({ ambientEnvironment, filesystem: commandFilesystem ?? filesystem, platform, protectedRoots })
  if (workerAmbient.unstable) {
    return stopWith(infrastructureCarrier({ detailCode: 'containment-unavailable', host: hosts[0], phase: 'version' }))
  }
  const evidenceManifests = []
  let evidenceRootUsedBytes = 0
  const preflight = await runVersionPreflight({
    ambientEnvironment,
    checkoutRoot,
    controllerPath,
    descriptors: resolvedDescriptors,
    filesystem,
    hosts,
    launch,
    platform,
    preflightRunRoot: createRoot('preflight'),
  })
  if (preflight.result) {
    return stopWith(preflight.result)
  }

  const runRepetition = async ({ controllerEnabled, host, repetition, scenario }) => {
    const descriptor = resolvedDescriptors[host]
    const modeName = controllerEnabled ? 'enabled' : 'disabled'
    const runRoot = createRoot(`${host}-${scenario.scenarioId}-${modeName}-${repetition}`)
    createFreshRunRoot({ filesystem, path: runRoot })
    const hostTemp = driver.createHostTempChild({ filesystem, platform, runRoot })
    const temporaryPaths = { run: hostTemp.path }
    const scenarioRoot = nodePath.join(runRoot, 'scenario')
    const gitIsolation = driver.createGitIsolationInputs({ filesystem, runRoot })
    const runGit = scenario.repository.git.kind === 'git' ? effectiveRunGitFactory({ gitIsolation, runRoot, scenarioRoot }) : null
    const materialized = driver.materializeScenario({ filesystem, platform, repository: scenario.repository, runGit, scenarioRoot })
    const sessionPluginRoot = nodePath.join(runRoot, controllerEnabled ? 'enabled-plugin' : 'disabled-plugin')
    filesystem.mkdirSync(sessionPluginRoot)
    const plugin = preparePluginRoot({ controllerEnabled, filesystem, host, runRoot, scenario, sessionPluginRoot })
    let codexHome = null
    let copiedCredentialPath = null
    const releaseCopiedCredential = () => {
      if (copiedCredentialPath === null) {
        return true
      }
      try {
        filesystem.rmSync(copiedCredentialPath, { force: true })
        if (filesystem.existsSync(copiedCredentialPath)) {
          return false
        }
        copiedCredentialPath = null

        return true
      } catch {
        return false
      }
    }
    const retainedCredentialCarrier = () => infrastructureCarrier({ detailCode: 'cleanup', host, phase: 'authentication', retainedRunRoot: runRoot })
    const finishRepetition = ({ outcome, phase, terminationProven }) => {
      if (!releaseCopiedCredential()) {
        if (outcome.result?.code === 'harness-infrastructure') {
          return { result: { ...outcome.result, retainedRunRoot: runRoot } }
        }

        return { result: retainedCredentialCarrier() }
      }
      if (outcome.result !== undefined && typeof outcome.result.retainedRunRoot === 'string') {
        return { result: { ...outcome.result, retainedRunRoot: runRoot } }
      }
      const finalization = driver.finalizeRunRoot({ filesystem, runRoot, terminationProven })
      if (finalization.retainedRunRoot !== null) {
        if (outcome.result?.code === 'harness-infrastructure') {
          return { result: { ...outcome.result, retainedRunRoot: finalization.retainedRunRoot } }
        }

        return {
          result: infrastructureCarrier({
            detailCode: finalization.detailCode ?? 'termination',
            host,
            initialCode: outcome.result?.code ?? null,
            phase,
            retainedRunRoot: finalization.retainedRunRoot,
          }),
        }
      }

      return outcome
    }
    if (host === 'codex') {
      codexHome = nodePath.join(runRoot, 'codex-home')
      const provisioned = await provisionAuthentication({
        ambientEnvironment,
        filesystem,
        homeDirectory,
        isolatedCodexHome: codexHome,
        platform,
        probeLoginStatus: () => launch({
          argv: ['login', 'status'],
          boundary: 'authentication',
          cwd: checkoutRoot,
          environment: buildLaunchProjection({ ambientEnvironment, boundary: 'authentication', checkoutRoot, controllerPath, overrides: { CODEX_HOME: codexHome }, platform, temporaryPaths }),
          executable: descriptor.executable,
          host,
        }),
      })
      if (provisioned.copiedCredential === true) {
        copiedCredentialPath = nodePath.join(codexHome, 'auth.json')
      }
      if (provisioned.precedence !== undefined) {
        return finishRepetition({ outcome: { result: provisioned.precedence }, phase: 'authentication', terminationProven: true })
      }
      if (provisioned.status !== 'authenticated') {
        return finishRepetition({ outcome: { result: provisioned.result }, phase: 'authentication', terminationProven: true })
      }
    }
    try {
      if (host === 'codex') {
        let pluginListStdout = null
        for (const argv of buildCodexPluginSetupArgvs({ runPluginRoot: sessionPluginRoot })) {
          const completion = await launch({
            argv,
            boundary: 'plugin-setup',
            cwd: checkoutRoot,
            environment: buildLaunchProjection({ ambientEnvironment, boundary: 'plugin-setup', checkoutRoot, controllerPath, overrides: { CODEX_HOME: codexHome }, platform, temporaryPaths }),
            executable: descriptor.executable,
            host,
          })
          if (completion !== null && typeof completion === 'object' && 'failure' in completion) {
            return finishRepetition({
              outcome: { result: completion.failure },
              phase: 'plugin-setup',
              terminationProven: completion.failure.retainedRunRoot === null,
            })
          }
          if (completion.exitCode !== 0) {
            throw new Error(`codex plugin setup command failed: ${argv.join(' ')}`)
          }
          pluginListStdout = completion.stdoutBytes
        }
        const listVerification = verifyCodexPluginList({ platform, runPluginRoot: sessionPluginRoot, stdoutBytes: pluginListStdout })
        if (!listVerification.ok) {
          throw new Error(`codex plugin installation verification failed: ${listVerification.detail}`)
        }
      }
      if (controllerEnabled) {
        const workerEnvironment = driver.buildWorkerProjection({ ambientEnvironment: workerAmbient.environment, checkoutRoot, gitIsolation, platform, protectedRoots, temporaryPath: hostTemp.path })
        const workerCompletion = await launch({
          argv: [controllerWorkerPath, controllerEntryPath, plugin.controllerRuntimeSha256],
          boundary: 'worker',
          cwd: runRoot,
          environment: workerEnvironment,
          executable: nodeExecutablePath,
          host,
        })
        if (isWorkerConstructionCompletion(workerCompletion, host)) {
          return finishRepetition({
            outcome: { result: workerCompletion.failure },
            phase: workerCompletion.failure.phase,
            terminationProven: workerCompletion.failure.retainedRunRoot === null,
          })
        }
        if (!isReadyWorkerCompletion(workerCompletion)) {
          return finishRepetition({
            outcome: { result: infrastructureCarrier({ detailCode: 'proxy', host, phase: 'initial-turn', retainedRunRoot: runRoot }) },
            phase: 'initial-turn',
            terminationProven: false,
          })
        }
      }
      // Pre-spawn scenario revalidation: any added, removed, or changed
      // repository entry fails before the host launch.
      driver.verifyScenarioFileSet({ filesystem, platform, repository: scenario.repository, runGit, scenarioRoot })
      const proxySession = controllerEnabled ? await proxySessionFactory({ host, repetition, scenario }) : null
      // The turn schema is copied run-local so neither the codex argv nor the
      // scenario envelope carries a checkout path.
      const turnSchemaRunPath = nodePath.join(runRoot, 'turn.schema.json')
      filesystem.writeFileSync(turnSchemaRunPath, Buffer.from(turnSchemaJson, 'utf8'))
      const argv = host === 'claude-code'
        ? buildClaudeSessionArgv({ sessionPluginRoot, turnSchemaJson })
        : buildCodexInitialSessionArgv({ scenarioRoot, turnOutputPath: nodePath.join(runRoot, 'turn-output.json'), turnSchemaPath: turnSchemaRunPath })
      const environment = buildLaunchProjection({
        ambientEnvironment,
        boundary: 'session',
        checkoutRoot,
        controllerPath,
        overrides: host === 'codex' ? { CODEX_HOME: codexHome } : {},
        platform,
        proxySession,
        temporaryPaths,
      })
      const session = await runSession({
        argv,
        controllerEnabled,
        cwd: scenarioRoot,
        environment,
        executable: descriptor.executable,
        host,
        proxySession,
        repetition,
        runRoot,
        scenario,
        sessionPluginRoot,
        turnSchemaRunPath,
      })
      if (session !== null && typeof session === 'object' && 'failure' in session) {
        if (session.failure.code === 'harness-infrastructure' && session.failure.detailCode === 'spawn' && session.failure.retainedRunRoot === null) {
          return finishRepetition({ outcome: { result: session.failure }, phase: session.failure.phase, terminationProven: true })
        }
        return finishRepetition({ outcome: { result: session.failure }, phase: session.failure.phase, terminationProven: session.terminationProven === true })
      }
      const sessionRecord = session.record
      const collectRepository = collectRepositoryFactory({ filesystem, platform, runGit, scenarioRoot })
      const member = scenario.oracles.terminalRepositories[modeName]
      const attestation = driver.attestTerminalRepository({ collectRepository, host, member, platform, scenarioRoot })
      if (attestation.failure) {
        return finishRepetition({
          outcome: { result: infrastructureCarrier({ detailCode: attestation.failure.detailCode, host, phase: 'post-session', retainedRunRoot: runRoot }) },
          phase: 'post-session',
          terminationProven: sessionRecord.terminationProven === true,
        })
      }
      if (evidenceOutputRoot !== null) {
        const evidenceFiles = [...(session.evidence ?? []), { bytes: attestation.evidenceBytes, path: 'repository-attestation.json' }]
        const published = driver.publishEvidenceLeaf({
          files: evidenceFiles,
          filesystem,
          host,
          mode: modeName,
          outputRoot: evidenceOutputRoot,
          repetition,
          rootLimit: evidenceRootLimit,
          rootUsedBytes: evidenceRootUsedBytes,
          scenario: scenario.scenarioId,
        })
        if (published.ok !== true) {
          return finishRepetition({
            outcome: { result: infrastructureCarrier({ detailCode: published.detailCode, host, phase: 'post-session', retainedRunRoot: runRoot }) },
            phase: 'post-session',
            terminationProven: sessionRecord.terminationProven === true,
          })
        }
        evidenceRootUsedBytes += published.leafBytes
        evidenceManifests.push({ evidenceManifestSha256: published.evidenceManifestSha256, host, mode: modeName, repetition, scenario: scenario.scenarioId })
      }
      return finishRepetition({ outcome: {
        record: {
          approvalBranch: scenario.oracles.approvalBranch,
          deterministicDigest: controllerEnabled ? sessionRecord.deterministicDigest : null,
          dialogueFacts: sessionRecord.dialogueFacts,
          lifecycleFacts: sessionRecord.lifecycleFacts,
          passed: sessionRecord.passed === true && attestation.passed === true,
          runPluginRootDigest: controllerEnabled ? plugin.runPluginRootDigest : null,
          scenarioRootDigest: materialized.scenarioRootDigest,
          terminalRepositorySha256: attestation.terminalRepositorySha256,
        },
      }, phase: 'post-session', terminationProven: sessionRecord.terminationProven === true })
    } catch (error) {
      if (!releaseCopiedCredential()) {
        return { result: retainedCredentialCarrier() }
      }
      throw error
    }
  }

  const rows = []
  for (const host of hosts) {
    for (const scenario of scenarios) {
      for (const controllerEnabled of [false, true]) {
        const repetitions = controllerEnabled ? ENABLED_REPETITIONS : DISABLED_REPETITIONS
        const records = []
        for (let repetition = 1; repetition <= repetitions; repetition += 1) {
          const outcome = await runRepetition({ controllerEnabled, host, repetition, scenario })
          if (outcome.result) {
            return stopWith(outcome.result)
          }
          records.push(outcome.record)
        }
        rows.push(buildResultRow({
          baselineManifestSha256,
          controllerEnabled,
          host,
          records,
          scenario,
          scenarioManifestSha256,
          version: preflight.versions[host],
        }))
      }
    }
  }

  // The plan defines exit semantics only for primary and infrastructure
  // results; a completed table exits 0 and each row carries its own passed
  // verdict (disclosed aggregate-exit choice).
  const summary = driver.buildSummary({ evidenceManifests, rows, scenarioIds: scenarios.map((scenario) => scenario.scenarioId) })
  const summaryBytes = canonicalJsonLine(summary)
  if (evidenceOutputRoot !== null && evidenceRootUsedBytes + summaryBytes.length > evidenceRootLimit) {
    return stopWith(infrastructureCarrier({ detailCode: 'output-capacity', host: hosts[hosts.length - 1], phase: 'post-session' }))
  }

  return { evidenceManifests, exitCode: 0, result: null, resultLine: null, rows, summary, trustedGitExecutable, versions: preflight.versions }
}

// --- Live composition -------------------------------------------------------
// The live bindings compose the already green driver surfaces (process
// adapters, transcript, proxy, dialogue walk, host-event conductors, and the
// adjudication engine) into real host launches. They are wired for the probe
// round and are never executed against installed hosts by the suite.

const PRE_SESSION_BOUNDARY_PHASES = Object.freeze({ authentication: 'authentication', 'import-probe': 'import-probe', 'plugin-setup': 'plugin-setup', version: 'version' })
const LIVE_COMPLETION_POLL_MILLISECONDS = 50
const DRIFT_FAULT_BYTES = Buffer.from('drift\n', 'utf8')

// Shared settle-once guard for the live-process promises below. It owns the
// deadline and poll handles so the first `settle` clears the deadline, then the
// poll, then resolves exactly once; every later call is inert.
function createSettleGuard(resolve) {
  let deadlineHandle = null
  let pollHandle = null
  let settled = false

  return {
    armDeadline(callback, milliseconds) {
      if (deadlineHandle !== null) {
        clearTimeout(deadlineHandle)
      }
      deadlineHandle = setTimeout(callback, milliseconds)
    },
    armPoll(callback, milliseconds) {
      pollHandle = setInterval(callback, milliseconds)
    },
    clearPoll() {
      if (pollHandle !== null) {
        clearInterval(pollHandle)
        pollHandle = null
      }
    },
    settle(value) {
      if (settled) {
        return
      }
      settled = true
      if (deadlineHandle !== null) {
        clearTimeout(deadlineHandle)
      }
      if (pollHandle !== null) {
        clearInterval(pollHandle)
      }
      resolve(value)
    },
  }
}

function infrastructureCarrier({ detailCode, host, initialCode = null, phase, retainedRunRoot = null }) {
  if (detailCode === 'cleanup' && phase !== 'post-session') {
    // Pre-session cleanup carriers stay locally constructed: the driver
    // validator pins cleanup to post-session, while the recorded Task 14
    // ruling accepts the authentication/version/import-probe cleanup carriers
    // as an extrapolation of the plan's version-phase carve-out.
    return { ok: false, host, code: 'harness-infrastructure', phase, initialCode, detailCode, retainedRunRoot }
  }

  return driver.infrastructureFailure({ detailCode, host, initialCode, phase, retainedRunRoot })
}

const INFRASTRUCTURE_CARRIER_KEYS = Object.freeze(['code', 'detailCode', 'host', 'initialCode', 'ok', 'phase', 'retainedRunRoot'])
const WORKER_CONSTRUCTION_DETAIL_CODES = Object.freeze(['containment-unavailable', 'spawn'])
const WORKER_CONSTRUCTION_COMPLETION_KEYS = Object.freeze(['failure'])
const WORKER_READY_COMPLETION_KEYS = Object.freeze(['ready'])

function hasExactKeys(value, expectedKeys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const keys = Object.keys(value).sort()

  return keys.length === expectedKeys.length && keys.every((key, index) => key === expectedKeys[index])
}

function isWorkerConstructionCompletion(completion, host) {
  if (!hasExactKeys(completion, WORKER_CONSTRUCTION_COMPLETION_KEYS) || !hasExactKeys(completion.failure, INFRASTRUCTURE_CARRIER_KEYS)) {
    return false
  }
  const failure = completion.failure

  return failure.ok === false
    && failure.host === host
    && failure.code === 'harness-infrastructure'
    && failure.phase === 'initial-turn'
    && failure.initialCode === null
    && WORKER_CONSTRUCTION_DETAIL_CODES.includes(failure.detailCode)
    && failure.retainedRunRoot === null
}

function isReadyWorkerCompletion(completion) {
  return hasExactKeys(completion, WORKER_READY_COMPLETION_KEYS) && completion.ready === true
}

function latestClassificationsByTarget(turnRecords) {
  const byTarget = new Map()
  for (const record of turnRecords) {
    for (const classification of record.turn.semanticClassifications) {
      byTarget.set(classification.target, classification)
    }
  }

  return [...byTarget.values()].sort((left, right) => compareOrdinal(left.target, right.target))
}

function deriveProposalCarriers(inspection) {
  return inspection.proposals.map((proposal) => {
    if (proposal.action.kind === 'ensure-directory') {
      return { actionId: proposal.action.id, kind: 'structural-action', target: proposal.action.target }
    }
    if (proposal.action.kind === 'unwrap-file') {
      return { actionId: proposal.action.id, afterRawSha256: proposal.action.afterRawSha256, beforeRawSha256: proposal.action.beforeRawSha256, kind: 'breakout-digest', target: proposal.action.target }
    }

    const afterBytes = Buffer.from(proposal.afterBase64, 'base64')
    const beforeBytes = proposal.beforeBase64 === null ? null : Buffer.from(proposal.beforeBase64, 'base64')

    return {
      actionId: proposal.action.id,
      afterBytes,
      afterRawSha256: sha256(afterBytes),
      beforeBytes,
      beforeRawSha256: beforeBytes === null ? null : sha256(beforeBytes),
      kind: 'decoded',
      target: proposal.action.target,
    }
  })
}

function deriveSemanticCarriers({ manifestProposal, proposalActionIds, scenario }) {
  const carriers = []
  const consumedActionIds = new Set(proposalActionIds)
  for (const repairOracle of scenario.oracles.semanticRepairOracles) {
    for (const action of repairOracle.actions) {
      const proposalAction = (manifestProposal?.actions ?? []).find((candidate) => candidate.target === action.target && !consumedActionIds.has(candidate.id))
      if (proposalAction === undefined) {
        return null
      }
      consumedActionIds.add(proposalAction.id)
      carriers.push({
        actionId: proposalAction.id,
        afterBytes: Buffer.from(action.afterBase64, 'base64'),
        beforeBytes: action.beforeBase64 === null ? null : Buffer.from(action.beforeBase64, 'base64'),
        kind: 'decoded',
        target: action.target,
      })
    }
  }

  return carriers
}

function attemptProcessAdapterConstruction(processAdapterFactory, options) {
  try {
    return processAdapterFactory(options)
  } catch {
    return { detailCode: 'spawn', ok: false }
  }
}

function runLivePreSessionCommand({
  call,
  deadlineMilliseconds = driver.DEADLINES.PRE_SESSION_MILLISECONDS,
  onAdapterCreated = () => {},
  platform,
  pollMilliseconds = LIVE_COMPLETION_POLL_MILLISECONDS,
  processAdapterFactory = driver.createProductionProcessAdapter,
}) {
  return new Promise((resolve) => {
    const phase = PRE_SESSION_BOUNDARY_PHASES[call.boundary]
    if (platform !== 'win32') {
      resolve({ failure: infrastructureCarrier({ detailCode: 'containment-unavailable', host: call.host, phase }) })

      return
    }
    const stdoutChunks = []
    const stderrChunks = []
    let adapter = null
    let timeoutFailure = null
    const { armDeadline, armPoll, settle } = createSettleGuard(resolve)
    const completed = () => ({ exitCode: adapter.hostExitCode(), signal: null, stderrBytes: Buffer.concat(stderrChunks), stdoutBytes: Buffer.concat(stdoutChunks) })
    const retainRoot = () => adapter !== null && (adapter.retainsRunRoot?.() === true || adapter.closureProof().proven !== true)
    const production = attemptProcessAdapterConstruction(processAdapterFactory, {
      cwd: call.cwd,
      mode: 'pre-session',
      onFailure: (failure) => {
        settle({ failure: infrastructureCarrier({ detailCode: failure.detailCode, host: call.host, phase, retainedRunRoot: retainRoot() ? call.cwd : null }) })
      },
      onHostStderr: (bytes) => stderrChunks.push(Buffer.from(bytes)),
      onHostStdout: (bytes) => stdoutChunks.push(Buffer.from(bytes)),
      onStarted: () => {},
    })
    if (production.ok !== true) {
      settle({ failure: infrastructureCarrier({ detailCode: production.detailCode, host: call.host, phase }) })

      return
    }
    adapter = production.adapter
    onAdapterCreated(adapter)
    armDeadline(() => {
      if (adapter.runnerClosed() && adapter.closureProof().proven === true) {
        settle(completed())

        return
      }
      timeoutFailure = { code: 'preflight-timeout', host: call.host, ok: false, phase }
      if (adapter.terminate().ok !== true) {
        settle({ failure: infrastructureCarrier({ detailCode: 'termination', host: call.host, phase, retainedRunRoot: call.cwd }) })
      }
    }, deadlineMilliseconds)
    armPoll(() => {
      if (!adapter.runnerClosed()) {
        return
      }
      if (timeoutFailure !== null) {
        settle(adapter.closureProof().proven === true
          ? { failure: timeoutFailure }
          : { failure: infrastructureCarrier({ detailCode: 'termination', host: call.host, phase, retainedRunRoot: call.cwd }) })

        return
      }
      if (adapter.closureProof().proven === true) {
        settle(completed())
      }
    }, pollMilliseconds)
    if (adapter.start({ args: call.argv, environment: call.environment, executable: call.executable }).ok !== true) {
      settle({ failure: infrastructureCarrier({ detailCode: 'spawn', host: call.host, phase }) })
    }
  })
}

function createLiveBindings({ filesystem = nodeFilesystem, platform, workerProcessAdapterFactory = driver.createProductionProcessAdapter }) {
  const preSessionAdapters = new Set()
  const workerRegistry = new Map()
  const proxyRegistry = new Map()

  const startLiveWorker = (call) => new Promise((resolve) => {
    if (platform !== 'win32') {
      resolve({ failure: infrastructureCarrier({ detailCode: 'containment-unavailable', host: call.host, phase: 'initial-turn' }) })

      return
    }
    const entry = { adapter: null, onLine: null, ready: false }
    const { armDeadline, settle } = createSettleGuard(resolve)
    const startupFailure = () => settle({ failure: infrastructureCarrier({ detailCode: 'proxy', host: call.host, phase: 'initial-turn', retainedRunRoot: call.cwd }) })
    const decoder = driver.createLineDecoder({
      limit: driver.BYTE_BOUNDS.MAX_RUNNER_FRAME_BYTES,
      limitName: 'MAX_RUNNER_FRAME_BYTES',
      onLine: (line) => {
        if (entry.ready) {
          if (entry.onLine !== null) {
            entry.onLine(Buffer.from(line))
          }

          return
        }
        let frame = null
        try {
          frame = JSON.parse(Buffer.from(line).toString('utf8'))
        } catch {
          frame = null
        }
        const expectedDigest = call.argv[2]
        if (!/^[0-9a-f]{64}$/.test(expectedDigest ?? '') || frame === null || frame.ready !== true || frame.controllerRuntimeSha256 !== expectedDigest) {
          startupFailure()

          return
        }
        entry.ready = true
        settle({ ready: true })
      },
      onOverflow: () => workerFailure({ detailCode: 'output-capacity' }),
      onUnterminated: () => workerFailure({ detailCode: 'proxy' }),
    })
    const production = attemptProcessAdapterConstruction(workerProcessAdapterFactory, {
      cwd: call.cwd,
      mode: 'session',
      onFailure: workerFailure,
      onHostStderr: () => {},
      onHostStdout: (bytes) => decoder.push(bytes),
      onHostStdoutEnd: () => decoder.end(),
      onStarted: () => {},
    })
    if (production.ok !== true) {
      settle({ failure: infrastructureCarrier({ detailCode: production.detailCode, host: call.host, phase: 'initial-turn' }) })

      return
    }
    entry.adapter = production.adapter
    workerRegistry.set(call.cwd, entry)
    armDeadline(startupFailure, driver.DEADLINES.WORKER_STARTUP_MILLISECONDS)
    if (entry.adapter.start({ args: call.argv, environment: call.environment, executable: call.executable }).ok !== true) {
      startupFailure()
    }
  })

  const proxySessionFactory = () => new Promise((resolve, reject) => {
    const token = randomBytes(32).toString('hex')
    const tcpServer = nodeNet.createServer()
    const entry = { server: null, tcpServer }
    tcpServer.on('connection', (socket) => {
      if (entry.server === null) {
        socket.destroy()

        return
      }
      entry.server.handleConnection(socket)
    })
    tcpServer.on('error', reject)
    tcpServer.listen({ exclusive: true, host: '127.0.0.1', port: 0 }, () => {
      proxyRegistry.set(token, entry)
      resolve({ port: tcpServer.address().port, token })
    })
  })

  const launch = (call) => call.boundary === 'worker'
    ? startLiveWorker(call)
    : runLivePreSessionCommand({ call, onAdapterCreated: (adapter) => preSessionAdapters.add(adapter), platform })

  const runSession = (call) => runLiveHostSession({ call, filesystem, platform, proxyRegistry, workerRegistry })

  const dispose = () => {
    for (const adapter of preSessionAdapters) {
      adapter.dispose?.()
    }
    for (const entry of workerRegistry.values()) {
      entry.adapter?.dispose?.()
    }
    for (const entry of proxyRegistry.values()) {
      entry.server?.dispose()
      entry.tcpServer.close()
    }
  }

  return { dispose, launch, proxySessionFactory, runSession }
}

async function runLiveHostSession({ call, filesystem, platform, processAdapterFactory = driver.createProductionProcessAdapter, proxyRegistry, transcriptFactory = driver.createTranscript, turnDeadlineMilliseconds = Number(driver.DEADLINES.TURN_NANOSECONDS / 1000000n), workerRegistry }) {
  const { argv, controllerEnabled, cwd: scenarioRoot, environment, executable, host, proxySession, runRoot, scenario, sessionPluginRoot, turnSchemaRunPath } = call
  if (platform !== 'win32') {
    return { failure: infrastructureCarrier({ detailCode: 'containment-unavailable', host, phase: 'initial-turn' }) }
  }
  const conversation = scenario.conversation
  const approvalBranch = scenario.oracles.approvalBranch
  const mode = controllerEnabled ? 'enabled' : 'disabled'
  const transcript = transcriptFactory()
  const turnRecords = []
  let approvalInputOrdinal = null
  let inspectWatermark = 0
  let manifestProposal = null
  let firstProposalTurnOrdinal = null
  let firstClassifiedTurnOrdinal = null
  let structuredResult = null
  const disabledBufferedDisclosures = []
  const rootClaudePresent = scenario.repository.entries.some((entry) => entry.kind === 'file' && entry.path === 'CLAUDE.md')
  const hostContext = host === 'codex' ? oracles.HOST_CONTEXTS.codex : rootClaudePresent ? oracles.HOST_CONTEXTS.claudePresentRoot : oracles.HOST_CONTEXTS.claudeMissingRoot
  let gate = null
  let recorder = null
  let server = null
  let trace = null
  const workerEntry = controllerEnabled ? workerRegistry.get(runRoot) : null
  const proxyEntry = controllerEnabled ? proxyRegistry.get(proxySession.token) : null
  const sessionAdapters = []
  let activePhase = 'initial-turn'
  let selectedPrimaryFailure = null
  let hostTerminationStarted = false
  let workerTerminationStarted = false
  const startHostTermination = () => {
    if (hostTerminationStarted) {
      return
    }
    hostTerminationStarted = true
    for (const adapter of sessionAdapters) {
      adapter.terminate()
    }
  }
  const startWorkerTermination = () => {
    if (workerTerminationStarted || workerEntry === null || workerEntry === undefined) {
      return
    }
    workerTerminationStarted = true
    workerEntry.adapter.terminate()
  }
  // The first supervision failure fixes the infrastructure carrier, closes
  // proxy admission, and starts host and worker termination exactly once. The
  // session then stops with that carrier and produces no behavior evidence.
  // Later failures only accumulate accounting on the fixed identity.
  const infrastructureFailureAccount = driver.createInfrastructureAccount({ host })
  let transcriptFailure = null
  const recordInfrastructureFailure = ({ detailCode, initialCode = null, phase = activePhase }) => {
    if (infrastructureFailureAccount.recordFailure({ detailCode, initialCode, phase }).first === true) {
      infrastructureFailureAccount.finalizeRetainedRunRoot(runRoot)
      if (server !== null && server.admissionOpen()) {
        server.close(() => {})
      }
      startHostTermination()
      startWorkerTermination()
    }

    return infrastructureFailureAccount.result()
  }
  const recordSessionInfrastructureFailure = (failure) => recordInfrastructureFailure({
    ...failure,
    initialCode: selectedPrimaryFailure?.code ?? failure.initialCode ?? null,
    phase: failure.phase ?? selectedPrimaryFailure?.phase ?? activePhase,
  })
  const recordTranscriptFailure = () => {
    transcriptFailure = recordSessionInfrastructureFailure({ detailCode: 'output-capacity' })

    return transcriptFailure
  }
  if (controllerEnabled) {
    if (workerEntry === undefined || proxyEntry === undefined) {
      return { failure: infrastructureCarrier({ detailCode: 'proxy', host, phase: 'initial-turn', retainedRunRoot: runRoot }) }
    }
    workerEntry.onFailure = recordSessionInfrastructureFailure
    if (workerEntry.failure !== null && workerEntry.failure !== undefined) {
      return { failure: recordSessionInfrastructureFailure(workerEntry.failure) }
    }
    gate = driver.createAuthorizationGate({ host, hostContext, scenarioRoot })
    recorder = createApplyCallRecorder({ gate, transcriptOrdinal: () => transcript.lineCount() })
    trace = driver.createProxyTrace({ flush: () => {} })
    const serverGate = {
      ...recorder.gate,
      recordInspectSuccess(resultBytes) {
        inspectWatermark = transcript.lineCount()
        recorder.gate.recordInspectSuccess(resultBytes)
      },
    }
    server = driver.createProxyServer({
      clock: { clearTimeout: (handle) => clearTimeout(handle), setTimeout: (fn, milliseconds) => setTimeout(fn, milliseconds) },
      gate: serverGate,
      onFailure: recordSessionInfrastructureFailure,
      termination: {
        startHost: startHostTermination,
        startWorker: startWorkerTermination,
      },
      token: proxySession.token,
      trace,
      worker: { send: (bytes) => workerEntry.adapter.input(bytes) },
    })
    proxyEntry.server = server
    if (proxyEntry.tcpServer !== null) {
      proxyEntry.tcpServer.maxConnections = server.connectionLimit()
    }
    workerEntry.onLine = (line) => server.receiveWorkerLine(line)
  }
  let storedInspectionState = null
  const loadStoredInspectionState = () => {
    if (storedInspectionState !== null) {
      return storedInspectionState
    }
    const inspectionBytes = gate === null ? null : gate.storedInspectionBytes()
    if (inspectionBytes === null) {
      return null
    }
    const inspection = JSON.parse(inspectionBytes.toString('utf8'))
    const proposalCarriers = deriveProposalCarriers(inspection)
    const proposalCarriersByActionId = new Map(proposalCarriers.map((carrier) => [carrier.actionId, carrier]))
    if (proposalCarriersByActionId.size !== proposalCarriers.length) {
      throw new Error('inspection proposal action IDs must be unique')
    }
    storedInspectionState = { inspection, proposalCarriers, proposalCarriersByActionId }

    return storedInspectionState
  }
  let expectedDisclosureItems = null
  let disclosureSequenceVerified = false
  const verifyObservedDisclosures = ({ items, proposal }) => {
    if (!controllerEnabled) {
      // The disabled expected sequence is proposal-owned; the structural
      // rebuild here checks digest binding and closed selections (provisional
      // against the plan's full byte reconstruction).
      return { ok: Array.isArray(items) && ((proposal.actions ?? []).length === 0 || items.length > 0) }
    }
    if (expectedDisclosureItems === null) {
      const inspectionState = loadStoredInspectionState()
      if (inspectionState === null) {
        return { ok: false }
      }
      const proposalActionIds = new Set(inspectionState.proposalCarriersByActionId.keys())
      const semanticCarriers = deriveSemanticCarriers({ manifestProposal: proposal, proposalActionIds, scenario })
      if (semanticCarriers === null) {
        return { ok: false }
      }
      const built = adjudication.buildExpectedDisclosureSequence({
        manifestProposal: proposal,
        proposalCarriers: inspectionState.proposalCarriers,
        semanticCarriers,
        semanticClassifications: latestClassificationsByTarget(turnRecords),
      })
      if (built.presentationCapacity === true) {
        return { ok: false }
      }
      expectedDisclosureItems = built.items
    }

    const verification = adjudication.verifyDisclosureSequence({ expected: expectedDisclosureItems, observed: items })
    if (verification.ok === true) {
      disclosureSequenceVerified = true
      expectedDisclosureItems = null
    }

    return verification
  }
  let walk = null
  const ensureWalk = (initEvent) => {
    if (walk !== null) {
      return walk
    }
    const claudeRootExclusion = host === 'claude-code' && controllerEnabled
      ? rootClaudePresent
        ? { present: true, response: null, verifiedLoadedMemory: deriveVerifiedLoadedMemory({ initEvent, platform, scenarioRoot }) }
        : { present: false, response: CLAUDE_ROOT_EXCLUSION_CONFIRMATION, verifiedLoadedMemory: null }
      : null
    walk = dialogue.createGateWalk({
      applyFault: conversation.faultSchedule === 'none' ? null : () => {
        filesystem.writeFileSync(nodePath.join(scenarioRoot, '.claude', 'FEATURES.md'), DRIFT_FAULT_BYTES)
      },
      approvalBranch,
      approvalResponse: conversation.approvalResponse,
      claudeRootExclusion,
      faultSchedule: conversation.faultSchedule,
      gate: controllerEnabled ? gate : null,
      host,
      hostContext: controllerEnabled ? hostContext : null,
      hostOutcome: conversation.hostOutcome,
      mode,
      onlineDisclosureCheck: controllerEnabled
        ? (item) => {
          const inspectionState = loadStoredInspectionState()

          return inspectionState === null
            ? { ok: false }
            : adjudication.verifyInspectionBoundDisclosure({ item, proposalCarriersByActionId: inspectionState.proposalCarriersByActionId })
        }
        : null,
      preApprovalTurns: conversation.preApprovalTurns,
      scenarioRoot: controllerEnabled ? scenarioRoot : null,
      verifyDisclosureSequence: ({ items, manifestProposal: proposal }) => verifyObservedDisclosures({ items, proposal }),
    })

    return walk
  }
  const recordTurn = (turn) => {
    const appended = transcript.appendStructuredOutput(Buffer.from(canonicalJson(turn), 'utf8'))
    if (appended.ordinal === undefined) {
      recordTranscriptFailure()

      return null
    }
    turnRecords.push({ disclosureCodes: turn.presentation.disclosureCodes, ordinal: appended.ordinal, turn })
    if (turn.phase === 'awaiting-response') {
      if (turn.presentation.manifestProposal !== null && firstProposalTurnOrdinal === null) {
        firstProposalTurnOrdinal = appended.ordinal
        manifestProposal = turn.presentation.manifestProposal
      }
      if (turn.semanticClassifications.length > 0 && firstClassifiedTurnOrdinal === null) {
        firstClassifiedTurnOrdinal = appended.ordinal
      }
      if (!controllerEnabled && turn.gateId === 'action-disclosure') {
        disabledBufferedDisclosures.push(...turn.presentation.actionDisclosures)
      }
    }

    return appended.ordinal
  }
  const recordInput = (text, kind) => {
    const appended = transcript.appendInput(Buffer.from(text, 'utf8'))
    if (appended.ordinal === undefined) {
      recordTranscriptFailure()

      return false
    }
    if (kind === 'approval') {
      approvalInputOrdinal = appended.ordinal
    }

    return true
  }
  // buildEvaluationEnvelope already returns the protocol-canonical
  // serialization of {nightshiftEvaluation, scenarioPrompt}.
  const envelopeText = oracles.buildEvaluationEnvelope(host, {
    controllerProxy: nodePath.join(sessionPluginRoot, ...CONTROLLER_ENTRY_RELATIVE_PATH.split('/')),
    scenarioPrompt: conversation.initialPrompt,
    turnSchema: turnSchemaRunPath,
  })
  const sessionFailure = (code, phase) => ({ failure: { ok: false, host, code, phase } })
  const sessionAdapterFailure = (production, phase) => controllerEnabled
    ? recordSessionInfrastructureFailure({ detailCode: production.detailCode ?? 'spawn', phase })
    : infrastructureCarrier({ detailCode: production.detailCode ?? 'spawn', host, phase })
  const claimPrimaryFailure = (code, phase) => {
    selectedPrimaryFailure = selectedPrimaryFailure ?? sessionFailure(code, phase).failure
    if (server !== null && server.admissionOpen()) {
      server.close(() => {})
    }
    startHostTermination()
    startWorkerTermination()

    return selectedPrimaryFailure
  }

  const finishSessionRecord = ({ closureProven, walkDone }) => {
    if (infrastructureFailureAccount.hasFailure()) {
      return { failure: infrastructureFailureAccount.result() }
    }
    const awaiting = turnRecords.filter((record) => record.turn.phase === 'awaiting-response')
    const applyCalls = controllerEnabled ? recorder.applyCalls : []
    const approvalFacts = adjudication.deriveApprovalFacts({ applyCalls, approvalBranch, approvalInputOrdinal })
    const electionRequired = conversation.preApprovalTurns.some((turn) => turn.gateId === 'version-control-choice')
    const inspectionState = loadStoredInspectionState()
    const inspection = inspectionState === null ? null : inspectionState.inspection
    const observedClassifications = latestClassificationsByTarget(turnRecords)
    const disabledCoverage = !controllerEnabled && (manifestProposal === null || (manifestProposal.actions ?? []).length === 0 || disabledBufferedDisclosures.length > 0)
    const dialogueFacts = {
      allActionsDisclosed: controllerEnabled
        ? disclosureSequenceVerified
        : disabledCoverage,
      ambiguitiesAsked: adjudication.deriveAmbiguityCoverage({
        ambiguityIdSequences: awaiting.map((record) => record.turn.presentation.ambiguityIds),
        gateIds: awaiting.map((record) => record.turn.gateId),
      }),
      electionPresented: adjudication.deriveElectionPresented({ electionRequired, manifestProposal }),
      approvalBeforeApply: approvalFacts.approvalBeforeApply,
      denialNoApply: approvalFacts.denialNoApply,
    }
    const resultPresentation = adjudication.deriveResultPresentation({ approvalBranch, structuredResult })
    const qualifyingCodes = collectQualifyingWriterCodes({
      applyRequestWatermark: applyCalls.length > 0 ? applyCalls[0].transcriptWatermark : null,
      inspectWatermark,
      turnRecords: turnRecords.map((record) => ({ disclosureCodes: record.disclosureCodes, ordinal: record.ordinal })),
    })
    const lifecycleFacts = {
      approvalApplyCardinality: approvalFacts.approvalApplyCardinality,
      resultPresented: resultPresentation.resultPresented,
      unresolvedPresented: resultPresentation.unresolvedPresented,
      externalWriterWindowDisclosed: adjudication.deriveWriterDisclosure({
        observedCodes: qualifyingCodes,
        windowExpected: controllerEnabled && approvalBranch === 'approved',
      }),
    }
    let ownership = { ok: false }
    if (controllerEnabled) {
      ownership = inspection === null
        ? { ok: false }
        : adjudication.verifyEnabledSemanticOwnership({
          classificationRequired: scenario.oracles.semanticClassifications.length > 0,
          firstClassifiedTurnOrdinal,
          firstProposalTurnOrdinal,
          inspection,
          inspectWatermark,
        })
    } else {
      ownership = adjudication.verifyDisabledSemanticOwnership({
        classificationRequired: scenario.oracles.semanticClassifications.length > 0,
        controllerArtifactPaths: [],
        firstClassifiedTurnOrdinal,
        firstProposalTurnOrdinal,
        proxyCallCount: 0,
      })
    }
    let deterministicDigest = null
    if (controllerEnabled && inspection !== null) {
      try {
        const applyOk = approvalBranch === 'approved' ? structuredResult?.ok === true : null
        const projectTargets = (targets) => [...targets]
          .map((target) => ({ kind: target.kind, mode: target.mode, rawSha256: target.rawSha256, target: target.target }))
          .sort((left, right) => compareOrdinal(left.target, right.target))
        const finalTargets = approvalBranch === 'approved'
          ? structuredResult?.ok === true ? projectTargets(structuredResult.postInspect.targets) : null
          : projectTargets(inspection.targets ?? [])
        deterministicDigest = adjudication.deriveDeterministicDigest({
          applyOk,
          approvalBranch,
          finalTargets,
          manifest: approvalBranch === 'approved' && manifestProposal !== null
            ? {
              actions: manifestProposal.actions,
              proposalDispositions: manifestProposal.proposalDispositions,
              semanticDecisions: manifestProposal.semanticDecisions,
              versionControlChoice: manifestProposal.versionControlChoice,
            }
            : null,
          proposals: inspection.proposals,
        })
      } catch {
        deterministicDigest = null
      }
    }
    const semanticMatch = adjudication.compareSemanticClassifications({ observed: observedClassifications, oracle: scenario.oracles.semanticClassifications })
    const passed = walkDone === true
      && closureProven === true
      && semanticMatch
      && Object.values(dialogueFacts).every((fact) => fact === true)
      && Object.values(lifecycleFacts).every((fact) => fact === true)
      && ownership.ok === true
      && (!controllerEnabled || deterministicDigest !== null)
    const evidence = [{ bytes: transcript.toBuffer(), path: 'transcript.jsonl' }]
    if (controllerEnabled) {
      evidence.push({ bytes: trace.toBuffer(), path: 'proxy-trace.jsonl' })
    }

    return {
      evidence,
      record: { deterministicDigest, dialogueFacts, lifecycleFacts, passed, terminationProven: closureProven === true },
    }
  }

  const settleEnabledClosure = async ({ initialCode = null } = {}) => {
    if (!controllerEnabled) {
      return true
    }
    if (server.admissionOpen()) {
      server.close(() => {})
    }
    workerEntry.adapter.closeInput()
    const workerClosedCleanly = () => workerEntry.adapter.runnerClosed()
      && workerEntry.adapter.closureProof().proven === true
      && workerEntry.adapter.hostExitCode() === 0
    const activeInitialCode = () => initialCode ?? selectedPrimaryFailure?.code ?? null
    const deadline = Date.now() + driver.DEADLINES.NATURAL_CLOSURE_MILLISECONDS
    while (Date.now() < deadline) {
      if (server.verifiedClosure() && workerEntry.adapter.runnerClosed()) {
        if (workerClosedCleanly()) {
          return true
        }
        recordInfrastructureFailure({ detailCode: workerEntry.adapter.hostExitCode() === 0 ? 'stream-closure' : 'child-process', initialCode: activeInitialCode() })

        return false
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, LIVE_COMPLETION_POLL_MILLISECONDS))
    }
    workerEntry.adapter.terminate()
    if (server.verifiedClosure() && workerClosedCleanly()) {
      return true
    }
    recordInfrastructureFailure({ detailCode: 'termination', initialCode: activeInitialCode() })

    return false
  }

  const finishPrimaryFailure = async ({ enabledClosure, failure, hostClosureProven }) => {
    const resolvedEnabledClosure = enabledClosure ?? await settleEnabledClosure({ initialCode: failure.code })
    if (hostClosureProven && resolvedEnabledClosure && !infrastructureFailureAccount.hasFailure()) {
      return { failure, terminationProven: true }
    }
    if (!infrastructureFailureAccount.hasFailure()) {
      recordInfrastructureFailure({ detailCode: 'termination', initialCode: failure.code, phase: failure.phase })
    }

    return { failure: infrastructureFailureAccount.result(), terminationProven: false }
  }

  const runTurnProcess = ({ commandArgv, conductor, inputText, inputKind, sessionInput }) => new Promise((resolve) => {
    const stderrChunks = []
    let adapter = null
    let conductorFailure = null
    let primaryFailure = null
    const { armDeadline, armPoll, settle } = createSettleGuard(resolve)
    const submitInitialInput = () => {
      if (inputText !== null) {
        if (!recordInput(inputText, inputKind)) {
          settle({ failure: transcriptFailure })

          return
        }
        if (adapter.input(Buffer.from(inputText, 'utf8')).ok !== true) {
          primaryFailure = primaryFailure ?? claimPrimaryFailure('session-input', sessionInput.phase)

          return
        }
      }
      adapter.closeInput()
    }
    const decoder = driver.createLineDecoder({
      limit: driver.BYTE_BOUNDS.MAX_HOST_LINE_BYTES,
      limitName: 'MAX_HOST_LINE_BYTES',
      onLine: (line) => {
        if (transcript.appendHostEvent(Buffer.from(line)).ordinal === undefined) {
          settle({ failure: recordTranscriptFailure() })

          return
        }
        const outcome = conductor.acceptLine(Buffer.from(line))
        if (outcome.failure !== undefined) {
          conductorFailure = outcome.failure
          adapter.terminate()
        }
      },
      onOverflow: () => {
        settle({ failure: recordSessionInfrastructureFailure({ detailCode: 'output-capacity', phase: sessionInput.phase }) })
      },
      onUnterminated: () => {
        settle({ failure: recordSessionInfrastructureFailure({ detailCode: 'termination', phase: sessionInput.phase }) })
      },
    })
    const production = attemptProcessAdapterConstruction(processAdapterFactory, {
      cwd: scenarioRoot,
      mode: 'session',
      onFailure: (failure) => settle({ failure: recordSessionInfrastructureFailure(failure) }),
      onHostStderr: (bytes) => stderrChunks.push(Buffer.from(bytes)),
      onHostStdout: (bytes) => decoder.push(bytes),
      onHostStdoutEnd: () => decoder.end(),
      onStarted: submitInitialInput,
    })
    if (production.ok !== true) {
      settle({ failure: sessionAdapterFailure(production, sessionInput.phase) })

      return
    }
    adapter = production.adapter
    sessionAdapters.push(adapter)
    armDeadline(() => {
      primaryFailure = primaryFailure ?? claimPrimaryFailure('session-timeout', sessionInput.phase)
    }, turnDeadlineMilliseconds)
    armPoll(() => {
      if (adapter.runnerClosed()) {
        settle({
          closureProven: adapter.closureProof().proven === true,
          conductorFailure,
          exitCode: adapter.hostExitCode(),
          primaryFailure,
          stderrBytes: Buffer.concat(stderrChunks),
        })
      }
    }, LIVE_COMPLETION_POLL_MILLISECONDS)
    if (adapter.start({ args: commandArgv, environment, executable }).ok !== true) {
      settle({ failure: recordSessionInfrastructureFailure({ detailCode: 'spawn', phase: sessionInput.phase }) })
    }
  })

  if (host === 'codex') {
    let threadId = null
    let turnIndex = 0
    let nextInputText = envelopeText
    let nextInputKind = 'initial'
    let walkDone = false
    let closureProven = true
    while (true) {
      const phase = turnIndex === 0 ? 'initial-turn' : 'interaction-turn'
      activePhase = phase
      const turnOutputPath = turnIndex === 0 ? nodePath.join(runRoot, 'turn-output.json') : nodePath.join(runRoot, `turn-output-${turnIndex}.json`)
      const commandArgv = turnIndex === 0
        ? argv
        : buildCodexResumeSessionArgv({ threadId, turnOutputPath, turnSchemaPath: turnSchemaRunPath })
      const conductor = hostEvents.createCodexTurnConductor({ expectedThreadId: threadId })
      const completion = await runTurnProcess({ commandArgv, conductor, inputKind: nextInputKind, inputText: nextInputText, sessionInput: { phase } })
      if (completion.failure !== undefined) {
        return completion
      }
      closureProven = closureProven && completion.closureProven === true
      if (completion.primaryFailure !== null) {
        return finishPrimaryFailure({ failure: completion.primaryFailure, hostClosureProven: closureProven })
      }
      const finished = conductor.finish()
      if (completion.conductorFailure !== null || completion.exitCode !== 0 || completion.stderrBytes.length !== 0 || finished.ok !== true) {
        return finishPrimaryFailure({ failure: claimPrimaryFailure('session-input', phase), hostClosureProven: closureProven })
      }
      threadId = finished.threadId
      const turnOutputBytes = filesystem.existsSync(turnOutputPath) ? filesystem.readFileSync(turnOutputPath) : Buffer.alloc(0)
      if (hostEvents.verifyTurnOutputEquality({ structuredResult: finished.structuredResult, turnOutputBytes }).ok !== true) {
        return finishPrimaryFailure({ failure: claimPrimaryFailure('session-input', phase), hostClosureProven: closureProven })
      }
      const turn = finished.structuredResult
      if (recordTurn(turn) === null) {
        return { failure: transcriptFailure }
      }
      const walkOutcome = ensureWalk(null).receiveTurn(turn)
      if (walkOutcome.failure !== undefined) {
        return finishPrimaryFailure({ failure: claimPrimaryFailure('session-input', phase), hostClosureProven: closureProven })
      }
      if (walkOutcome.done === true) {
        structuredResult = walkOutcome.result
        walkDone = true
        break
      }
      nextInputText = walkOutcome.response
      nextInputKind = walkOutcome.kind === 'approval' ? 'approval' : walkOutcome.kind
      turnIndex += 1
    }
    const enabledClosure = await settleEnabledClosure()

    return finishSessionRecord({ closureProven: closureProven && enabledClosure, walkDone })
  }

  // Claude Code: one process, structured turns interleaved over stream-json.
  return await new Promise((resolve) => {
    const stderrChunks = []
    const conductor = hostEvents.createClaudeSessionConductor({ sessionPluginRoot })
    let adapter = null
    let walkDone = false
    let primaryFailure = null
    const { armDeadline, armPoll, clearPoll, settle } = createSettleGuard(resolve)
    const armTurnDeadline = () => {
      armDeadline(() => {
        primaryFailure = primaryFailure ?? claimPrimaryFailure('session-timeout', activePhase)
      }, turnDeadlineMilliseconds)
    }
    const writeUserTurn = (text, kind) => {
      if (primaryFailure !== null) {
        return false
      }
      const payload = canonicalJson({ message: { content: [{ text, type: 'text' }], role: 'user' }, type: 'user' }) + '\n'
      if (!recordInput(text, kind)) {
        settle({ failure: transcriptFailure })

        return false
      }
      if (adapter.input(Buffer.from(payload, 'utf8')).ok !== true) {
        primaryFailure = claimPrimaryFailure('session-input', activePhase)

        return false
      }

      return true
    }
    const handleTurn = (turn) => {
      if (recordTurn(turn) === null) {
        settle({ failure: transcriptFailure })

        return
      }
      const walkOutcome = ensureWalk(conductor.initEvent()).receiveTurn(turn)
      if (walkOutcome.failure !== undefined) {
        primaryFailure = primaryFailure ?? claimPrimaryFailure('session-input', activePhase)

        return
      }
      if (walkOutcome.done === true) {
        structuredResult = walkOutcome.result
        walkDone = true

        return
      }
      activePhase = 'interaction-turn'
      armTurnDeadline()
      const written = writeUserTurn(walkOutcome.response, walkOutcome.kind === 'approval' ? 'approval' : walkOutcome.kind)
      if (written && (ensureWalk(conductor.initEvent()).state() === 'await-result' || ensureWalk(conductor.initEvent()).state() === 'context-stopped')) {
        adapter.closeInput()
      }
    }
    const decoder = driver.createLineDecoder({
      limit: driver.BYTE_BOUNDS.MAX_HOST_LINE_BYTES,
      limitName: 'MAX_HOST_LINE_BYTES',
      onLine: (line) => {
        if (transcript.appendHostEvent(Buffer.from(line)).ordinal === undefined) {
          settle({ failure: recordTranscriptFailure() })

          return
        }
        const outcome = conductor.acceptLine(Buffer.from(line))
        if (outcome.failure !== undefined) {
          primaryFailure = primaryFailure ?? claimPrimaryFailure('session-input', activePhase)

          return
        }
        if (outcome.accepted.kind === 'structured-result') {
          handleTurn(outcome.accepted.structuredOutput)
        }
      },
      onOverflow: () => {
        settle({ failure: recordSessionInfrastructureFailure({ detailCode: 'output-capacity', phase: activePhase }) })
      },
      onUnterminated: () => {
        settle({ failure: recordSessionInfrastructureFailure({ detailCode: 'termination', phase: activePhase }) })
      },
    })
    const production = attemptProcessAdapterConstruction(processAdapterFactory, {
      cwd: scenarioRoot,
      mode: 'session',
      onFailure: (failure) => settle({ failure: recordSessionInfrastructureFailure(failure) }),
      onHostStderr: (bytes) => stderrChunks.push(Buffer.from(bytes)),
      onHostStdout: (bytes) => decoder.push(bytes),
      onHostStdoutEnd: () => decoder.end(),
      onStarted: () => writeUserTurn(envelopeText, 'initial'),
    })
    if (production.ok !== true) {
      settle({ failure: sessionAdapterFailure(production, activePhase) })

      return
    }
    adapter = production.adapter
    sessionAdapters.push(adapter)
    armPoll(() => {
      if (!adapter.runnerClosed()) {
        return
      }
      // First entry only: a slow worker keeps settleEnabledClosure in flight
      // past the next tick, and a re-entered finish would call the
      // exactly-once proxy close a second time.
      clearPoll()
      const finish = async () => {
        if (primaryFailure !== null) {
          settle(await finishPrimaryFailure({ failure: primaryFailure, hostClosureProven: adapter.closureProof().proven === true }))

          return
        }
        const closureProven = adapter.closureProof().proven === true && adapter.hostExitCode() === 0 && stderrChunks.length === 0
        const enabledClosure = await settleEnabledClosure()
        if (primaryFailure !== null) {
          settle(await finishPrimaryFailure({ enabledClosure, failure: primaryFailure, hostClosureProven: adapter.closureProof().proven === true }))

          return
        }
        settle(finishSessionRecord({ closureProven: closureProven && enabledClosure, walkDone }))
      }
      finish()
    }, LIVE_COMPLETION_POLL_MILLISECONDS)
    armTurnDeadline()
    if (adapter.start({ args: argv, environment, executable }).ok !== true) {
      settle({ failure: recordSessionInfrastructureFailure({ detailCode: 'spawn', phase: 'initial-turn' }) })
    }
  })
}

// --- Live output-mode evaluation --------------------------------------------

function parseMainArgv(argv) {
  if (argv.length === 3 && argv[0] === '--verify-compatibility-transition') {
    return { afterPath: argv[2], beforePath: argv[1], mode: 'verify-compatibility-transition' }
  }
  if (argv.length === 2 && argv[0] === '--output' && typeof argv[1] === 'string' && argv[1].trim() !== '') {
    return { mode: 'output', outputRoot: argv[1] }
  }

  return { error: 'usage' }
}

async function runOutputEvaluation({ outputRoot, overrides = {}, stdout = process.stdout }) {
  const filesystem = overrides.filesystem ?? nodeFilesystem
  const platform = overrides.platform ?? process.platform
  const ambientEnvironment = overrides.ambientEnvironment ?? { ...process.env }
  const checkoutRoot = overrides.checkoutRoot ?? nodePath.resolve(__dirname, '..')
  const resolvedOutputRoot = nodePath.resolve(outputRoot)
  filesystem.mkdirSync(resolvedOutputRoot, { recursive: true })
  const outputIdentity = canonicalizeStableDirectory({ entry: resolvedOutputRoot, filesystem, platform, protectedRoots: [] })
  const runs = outputIdentity.skip || outputIdentity.unstable
    ? { unstable: true }
    : prepareRunsRoot({ filesystem, outputRoot: outputIdentity.canonicalPath, platform, runsRoot: nodePath.join(resolvedOutputRoot, 'runs') })
  if (runs.unstable) {
    stdout.write(formatResultLine(unsupportedHostLauncher('claude-code')))

    return 1
  }
  const runsRoot = runs.root
  let rootOrdinal = 0
  const createRoot = overrides.createRoot ?? ((name) => nodePath.join(runsRoot, `${(rootOrdinal += 1)}-${name}`))
  const protectedRootResult = canonicalizeStableProtectedRoots({ entries: overrides.protectedRoots ?? [checkoutRoot, resolvedOutputRoot], filesystem, platform })
  if (protectedRootResult.unstable) {
    stdout.write(formatResultLine(unsupportedHostLauncher('claude-code')))

    return 1
  }
  const protectedRoots = protectedRootResult.roots
  const commandFilesystem = overrides.commandFilesystem ?? filesystem
  const containedAmbient = buildContainedAmbientEnvironment({ ambientEnvironment, filesystem: commandFilesystem, platform, protectedRoots })
  if (containedAmbient.unstable) {
    stdout.write(formatResultLine(unsupportedHostLauncher('claude-code')))

    return 1
  }
  const launchEnvironment = containedAmbient.environment
  const controllerEntryPath = overrides.controllerEntryPath ?? nodePath.join(checkoutRoot, ...CONTROLLER_ENTRY_RELATIVE_PATH.split('/'))
  const controllerWorkerPath = overrides.controllerWorkerPath ?? nodePath.join(__dirname, 'init-backlog-controller-worker.js')
  const proxyClientPath = overrides.proxyClientPath ?? nodePath.join(__dirname, 'fixtures', 'init-backlog-eval', 'controller-proxy.js')
  const turnSchemaSourcePath = overrides.turnSchemaSourcePath ?? nodePath.join(__dirname, 'fixtures', 'init-backlog-eval', 'turn.schema.json')
  const descriptors = overrides.descriptors ?? Object.fromEntries(HOST_ORDER.map((host) => [host, resolveHostCommand({
    ambientPath: ambientPathValue(ambientEnvironment, platform),
    filesystem: commandFilesystem,
    host,
    platform,
    protectedRoots,
  })]))
  const claudeResolution = descriptors['claude-code']
  if (claudeResolution.unsupported) {
    stdout.write(formatResultLine(claudeResolution.unsupported))

    return 1
  }
  const live = overrides.launch !== undefined && overrides.runSession !== undefined
    ? null
    : createLiveBindings({ filesystem, platform })
  const launch = overrides.launch ?? live.launch
  const runSession = overrides.runSession ?? live.runSession
  const proxySessionFactory = overrides.proxySessionFactory ?? live?.proxySessionFactory ?? null
  try {
    const fixtures = overrides.fixtures ?? (() => {
      const tree = oracles.loadHostFixtureTree(checkoutRoot)
      const promptBaseline = loadPromptBaseline(nodePath.resolve(__dirname, '..'), { filesystem })

      return {
        baselineManifestSha256: promptBaseline.baselineManifestSha256,
        importCases: oracles.buildExpectedImportCases(),
        promptBaseline,
        scenarioManifestSha256: tree.scenarioManifestSha256,
        scenarios: [...tree.scenarios.values()].map((entry) => entry.object),
      }
    })()
    // The import matrix runs before the behavioral matrix, per the probe
    // slice's ordering.
    const matrix = await runImportMatrix({
      ambientEnvironment: launchEnvironment,
      checkoutRoot,
      createRoot,
      descriptor: claudeResolution.descriptor,
      filesystem,
      importCases: fixtures.importCases,
      launch,
      platform,
    })
    const matrixReport = canonicalJsonLine({ passed: matrix.passed === true, verdicts: matrix.verdicts })
    driver.publishOutputFile({ bytes: matrixReport, filename: 'import-matrix.json', filesystem, outputRoot: resolvedOutputRoot })
    if (matrix.failure !== undefined) {
      stdout.write(formatResultLine(matrix.failure))

      return 1
    }
    if (matrix.passed !== true) {
      stdout.write(matrixReport)

      return 1
    }
    const evaluation = await runEvaluation({
      ambientEnvironment: launchEnvironment,
      baselineManifestSha256: fixtures.baselineManifestSha256,
      checkoutRoot,
      commandFilesystem,
      controllerEntryPath,
      controllerPath: controllerEntryPath,
      controllerWorkerPath,
      createRoot,
      descriptors,
      evidenceOutputRoot: resolvedOutputRoot,
      evidenceRootLimit: overrides.evidenceRootLimit,
      filesystem,
      homeDirectory: overrides.homeDirectory ?? homedir(),
      launch,
      platform,
      preparePluginRoot: overrides.preparePluginRoot ?? (({ controllerEnabled, runRoot, sessionPluginRoot }) => {
        if (controllerEnabled) {
          return buildEnabledPluginRoot({
            checkoutRoot,
            controllerEntryPath,
            filesystem,
            manifestPath: nodePath.join(runRoot, 'run-plugin-manifest.json'),
            proxyClientPath,
            runPluginRoot: sessionPluginRoot,
          })
        }
        return buildDisabledPluginRoot({
          baselineFiles: fixtures.promptBaseline.files,
          disabledRunPluginRoot: sessionPluginRoot,
          filesystem,
          manifestPath: nodePath.join(runRoot, 'disabled-plugin-manifest.json'),
        })
      }),
      protectedRoots,
      proxySessionFactory,
      runGitFactory: overrides.runGitFactory ?? null,
      runSession,
      scenarioManifestSha256: fixtures.scenarioManifestSha256,
      scenarios: fixtures.scenarios,
      turnSchemaJson: overrides.turnSchemaJson ?? filesystem.readFileSync(turnSchemaSourcePath).toString('utf8'),
      turnSchemaPath: turnSchemaSourcePath,
    })
    if (evaluation.result !== null) {
      stdout.write(evaluation.resultLine)

      return 1
    }
    driver.publishOutputFile({ bytes: canonicalJsonLine(evaluation.summary), filename: 'summary.json', filesystem, outputRoot: resolvedOutputRoot })
    stdout.write(canonicalJsonLine(evaluation.rows))

    return evaluation.exitCode
  } finally {
    live?.dispose()
  }
}

// --- CLI --------------------------------------------------------------------

function main(argv, { evaluationOverrides = {}, filesystem = nodeFilesystem, stderr = process.stderr, stdout = process.stdout } = {}) {
  const parsed = parseMainArgv(argv)
  if (parsed.mode === 'verify-compatibility-transition') {
    try {
      const verified = verifyCompatibilityTransition({ afterPath: parsed.afterPath, beforePath: parsed.beforePath, filesystem })
      stdout.write(canonicalJson(verified) + '\n')

      return 0
    } catch (error) {
      stderr.write(`${error.message}\n`)

      return 1
    }
  }
  if (parsed.mode === 'output') {
    // The live evaluation mode is asynchronous, so this branch returns a
    // Promise<number> while the verification and usage branches stay
    // synchronous numbers.
    return runOutputEvaluation({ outputRoot: parsed.outputRoot, overrides: evaluationOverrides, stdout }).catch((error) => {
      stderr.write(`${error.message}\n`)

      return 1
    })
  }
  stderr.write('usage: node tests/init-backlog-host-behavior.js --output <directory> | --verify-compatibility-transition <before-path> <after-path>\n')

  return 2
}

if (require.main === module) {
  Promise.resolve(main(process.argv.slice(2))).then((code) => {
    process.exitCode = code
  })
}

module.exports = {
  CODEX_API_KEY_REDACTION_PREFIX,
  CODEX_AUTHENTICATED_LINES,
  CODEX_AUTHENTICATION_UNAVAILABLE_RESULT,
  CODEX_PLUGIN_ID,
  DISABLED_REPETITIONS,
  ENABLED_REPETITIONS,
  HOST_ORDER,
  LAUNCH_BOUNDARIES,
  LOGICAL_COMMANDS,
  RESULT_ROW_FIELDS,
  UNSUPPORTED_HOST_LAUNCHER_DETAIL,
  buildClaudeSessionArgv,
  buildCodexInitialSessionArgv,
  buildCodexPluginSetupArgvs,
  buildCodexResumeSessionArgv,
  buildDisabledPluginRoot,
  buildEnabledPluginRoot,
  buildImportProbeArgv,
  buildLaunchProjection,
  buildResultRow,
  classifyCodexLoginStatus,
  collectQualifyingWriterCodes,
  collectTerminalRepository,
  createApplyCallRecorder,
  createLiveBindings,
  createScenarioGitRunner,
  createTerminalRepositoryCollector,
  deriveSemanticCarriers,
  deriveVerifiedLoadedMemory,
  driverSurface: driver,
  formatResultLine,
  main,
  parseMainArgv,
  provisionCodexAuthentication,
  resolveHostCommand,
  resolveTrustedGit,
  runEvaluation,
  runImportCase,
  runImportMatrix,
  runLiveHostSession,
  runLivePreSessionCommand,
  runOutputEvaluation,
  runVersionPreflight,
  validateCalendarDate,
  validateVersionLine,
  validateVersionOutput,
  verifyCodexPluginList,
  verifyCompatibilityTransition,
}
