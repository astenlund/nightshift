'use strict'

const nodeFilesystem = require('node:fs')
const { basename, dirname, join, posix, win32 } = require('node:path')

const primitives = require('./init-backlog-session-driver/primitives')
const state = require('./init-backlog-session-driver/state')
const processModule = require('./init-backlog-session-driver/process')
const transcriptModule = require('./init-backlog-session-driver/transcript')
const proxyModule = require('./init-backlog-session-driver/proxy')
const evidenceModule = require('./init-backlog-session-driver/evidence')
const cleanupModule = require('./init-backlog-session-driver/cleanup')
const aggregationModule = require('./init-backlog-session-driver/aggregation')

const { canonicalJson } = transcriptModule
const { sha256 } = primitives

const ELIGIBLE_AMBIENT_KEYS = Object.freeze(['PATH', 'SystemRoot', 'ComSpec', 'PATHEXT', 'HOME', 'USERPROFILE', 'USER', 'LOGNAME', 'SHELL', 'XDG_RUNTIME_DIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CODEX_API_KEY', 'OPENAI_API_KEY'])

const MODEL_CREDENTIAL_KEYS = Object.freeze(['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CODEX_API_KEY', 'OPENAI_API_KEY'])
const PROXY_CREDENTIAL_KEYS = Object.freeze(['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy'])
const EVIDENCE_CREDENTIAL_KEYS = Object.freeze([...MODEL_CREDENTIAL_KEYS, 'NIGHTSHIFT_INIT_BACKLOG_PROXY_TOKEN', ...PROXY_CREDENTIAL_KEYS])

const NEVER_COPIED_TEMP_KEYS = Object.freeze(['TEMP', 'TMP', 'TMPDIR'])

function comparablePath(path, platform) {
  return platform === 'win32' ? path.toLowerCase() : path
}

function pathIsAtOrInsideRoot(root, target, pathModule) {
  if (!pathModule.isAbsolute(root) || !pathModule.isAbsolute(target)) {
    return false
  }
  const relation = pathModule.relative(root, target)

  return relation === '' || (relation !== '..' && !relation.startsWith(`..${pathModule.sep}`) && !pathModule.isAbsolute(relation))
}

function gitIsolationEntries({ attributesPath, configPath, templatePath }) {
  return {
    GIT_ATTR_NOSYSTEM: '1',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_GLOBAL: configPath,
    GIT_CONFIG_KEY_0: 'core.attributesFile',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_VALUE_0: attributesPath,
    GIT_OPTIONAL_LOCKS: '0',
    GIT_PAGER: '',
    GIT_TEMPLATE_DIR: templatePath,
    GIT_TERMINAL_PROMPT: '0',
  }
}

function copyEligibleAmbient(ambientEnvironment, platform) {
  const projection = {}
  if (platform === 'win32') {
    const canonicalByUpper = new Map()
    for (const eligible of ELIGIBLE_AMBIENT_KEYS) {
      if (!canonicalByUpper.has(eligible.toUpperCase())) {
        canonicalByUpper.set(eligible.toUpperCase(), eligible)
      }
    }
    const matchedUppers = new Set()
    for (const [key, value] of Object.entries(ambientEnvironment)) {
      const upper = key.toUpperCase()
      if (!canonicalByUpper.has(upper) || NEVER_COPIED_TEMP_KEYS.includes(upper)) {
        continue
      }
      if (matchedUppers.has(upper)) {
        throw new Error(`ambient environment carries a duplicate-case alias for ${canonicalByUpper.get(upper)}`)
      }
      matchedUppers.add(upper)
      projection[canonicalByUpper.get(upper)] = value
    }
  } else {
    for (const eligible of ELIGIBLE_AMBIENT_KEYS) {
      if (eligible in ambientEnvironment) {
        projection[eligible] = ambientEnvironment[eligible]
      }
    }
  }

  return projection
}

function buildClosedProjection({ additionalPathExclusionRoots = [], ambientEnvironment, checkoutRoot, controllerPath = null, overrides = {}, platform, proxySession = null, temporaryPath }) {
  const projection = copyEligibleAmbient(ambientEnvironment, platform)
  for (const key of NEVER_COPIED_TEMP_KEYS) {
    projection[key] = temporaryPath
  }
  Object.assign(projection, overrides)
  if (proxySession !== null) {
    const { port, token } = proxySession
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
      throw new Error(`proxy session port is not a canonical decimal in range: ${port}`)
    }
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) {
      throw new Error('proxy session token must be exactly 64 lowercase hexadecimal characters')
    }
    projection.NIGHTSHIFT_INIT_BACKLOG_PROXY_ADDRESS = '127.0.0.1'
    projection.NIGHTSHIFT_INIT_BACKLOG_PROXY_PORT = String(port)
    projection.NIGHTSHIFT_INIT_BACKLOG_PROXY_TOKEN = token
  }
  const pathModule = platform === 'win32' ? win32 : posix
  const separator = pathModule.sep
  const trimTrailingSeparators = (path) => {
    let trimmed = path
    while (trimmed.length > 1 && trimmed.endsWith(separator)) {
      trimmed = trimmed.slice(0, -1)
    }

    return trimmed
  }
  const comparableCheckout = comparablePath(trimTrailingSeparators(checkoutRoot), platform)
  if (typeof projection.PATH === 'string') {
    const delimiter = pathModule.delimiter
    const pathExclusionRoots = [checkoutRoot, ...additionalPathExclusionRoots]
    projection.PATH = projection.PATH.split(delimiter).filter((entry) => {
      if (entry === '') {
        return false
      }

      return pathExclusionRoots.every((root) => !pathIsAtOrInsideRoot(root, entry, pathModule))
    }).join(delimiter)
  }
  for (const [key, value] of Object.entries(projection)) {
    const comparableKey = comparablePath(key, platform)
    const comparableValue = comparablePath(String(value), platform)
    if (controllerPath !== null) {
      const comparableController = comparablePath(controllerPath, platform)
      if (comparableKey.includes(comparableController) || comparableValue.includes(comparableController)) {
        throw new Error(`projection carries the driver-side controller path: ${key}`)
      }
    }
    if (comparableKey.includes(comparableCheckout) || comparableValue.includes(comparableCheckout)) {
      throw new Error(`projection carries the canonical checkout path: ${key}`)
    }
  }

  return projection
}

function buildWorkerProjection({ ambientEnvironment, checkoutRoot, gitIsolation, platform, protectedRoots = [], temporaryPath }) {
  const projection = buildClosedProjection({ additionalPathExclusionRoots: protectedRoots, ambientEnvironment, checkoutRoot, platform, temporaryPath })
  for (const key of MODEL_CREDENTIAL_KEYS) {
    delete projection[key]
  }
  Object.assign(projection, gitIsolationEntries(gitIsolation))

  return projection
}

function credentialValuesFromProjection(projection) {
  const values = []
  for (const key of EVIDENCE_CREDENTIAL_KEYS) {
    if (!Object.hasOwn(projection, key)) {
      continue
    }
    const value = projection[key]
    if (typeof value !== 'string') {
      throw new TypeError(`projected credential ${key} must be a string`)
    }
    if (value !== '' && !values.includes(value)) {
      values.push(value)
    }
  }

  return values
}

function buildHarnessGitEnvironment({ ambientEnvironment, attributesPath, configPath, platform, templatePath }) {
  const environment = {}
  for (const [key, value] of Object.entries(ambientEnvironment)) {
    const identityKey = platform === 'win32' ? key.toUpperCase() : key
    if (identityKey.startsWith('GIT_')) {
      continue
    }
    environment[key] = value
  }
  Object.assign(environment, gitIsolationEntries({ attributesPath, configPath, templatePath }))

  return Object.freeze(environment)
}

function parseNulTerminatedTrackedPaths(stdout) {
  if (stdout.length === 0) {
    return []
  }
  if (stdout[stdout.length - 1] !== 0x00) {
    throw new Error('tracked-set query stdout is missing its terminal NUL')
  }
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(stdout)
  } catch {
    throw new Error('tracked-set query stdout is not valid UTF-8')
  }
  const fields = text.slice(0, -1).split(String.fromCharCode(0))
  for (const field of fields) {
    if (field === '') {
      throw new Error('tracked-set query carries an empty field')
    }
    if (field.startsWith('/') || field.includes('\\') || field.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
      throw new Error(`tracked-set query field is not confined: ${field}`)
    }
  }
  for (let index = 1; index < fields.length; index += 1) {
    if (Buffer.compare(Buffer.from(fields[index - 1], 'utf8'), Buffer.from(fields[index], 'utf8')) >= 0) {
      throw new Error('tracked-set query fields are not in Git ordinal order')
    }
  }

  return fields
}

function parseTrackedSetOutput({ exitCode, expectedTrackedPaths, stderr, stdout }) {
  if (exitCode !== 0) {
    throw new Error(`tracked-set query exit code is not zero: ${exitCode}`)
  }
  if (stderr.length !== 0) {
    throw new Error('tracked-set query stderr is not empty')
  }
  const fields = parseNulTerminatedTrackedPaths(stdout)
  if (fields.length !== expectedTrackedPaths.length || fields.some((field, index) => field !== expectedTrackedPaths[index])) {
    throw new Error('tracked-set query result must equal the expected tracked array exactly')
  }

  return { trackedPaths: fields }
}

function verifyStableDirectory(path, { expectedMode = null, filesystem, platform }) {
  const before = filesystem.lstatSync(path, { bigint: true })
  const after = filesystem.lstatSync(path, { bigint: true })
  if (!before.isDirectory() || before.isSymbolicLink() || !after.isDirectory()) {
    throw new Error(`stable directory verification failed: ${path}`)
  }
  if (before.dev !== after.dev || before.ino !== after.ino) {
    throw new Error(`stable directory identity changed: ${path}`)
  }
  if (platform !== 'win32' && expectedMode !== null && Number(before.mode & 0o7777n) !== expectedMode) {
    throw new Error(`stable directory mode differs: ${path}`)
  }
}

function createHostTempChild({ filesystem = nodeFilesystem, platform, runRoot }) {
  const path = join(runRoot, 'host-temp')
  try {
    filesystem.mkdirSync(path, { mode: 0o700 })
  } catch (error) {
    throw new Error(`host temp child creation failed: ${path}`, { cause: error })
  }
  verifyStableDirectory(path, { expectedMode: 0o700, filesystem, platform })
  if (filesystem.readdirSync(path).length !== 0) {
    throw new Error(`host temp child is not empty: ${path}`)
  }

  return { environmentBindings: { TEMP: path, TMP: path, TMPDIR: path }, path }
}

function createGitIsolationInputs({ filesystem = nodeFilesystem, runRoot }) {
  const configPath = join(runRoot, 'git-global.config')
  const attributesPath = join(runRoot, 'git-global.attributes')
  const templatePath = join(runRoot, 'git-template')
  try {
    filesystem.writeFileSync(configPath, Buffer.alloc(0), { flag: 'wx' })
    filesystem.writeFileSync(attributesPath, Buffer.alloc(0), { flag: 'wx' })
    filesystem.mkdirSync(templatePath)
  } catch (error) {
    throw new Error('Git isolation input creation failed', { cause: error })
  }
  for (const path of [configPath, attributesPath]) {
    const before = filesystem.lstatSync(path, { bigint: true })
    const bytes = filesystem.readFileSync(path)
    const after = filesystem.lstatSync(path, { bigint: true })
    if (!before.isFile() || before.isSymbolicLink() || bytes.length !== 0 || before.dev !== after.dev || before.ino !== after.ino || after.size !== 0n) {
      throw new Error(`Git isolation input is not a stable empty ordinary file: ${path}`)
    }
  }
  verifyStableDirectory(templatePath, { filesystem, platform: process.platform })
  if (filesystem.readdirSync(templatePath).length !== 0) {
    throw new Error(`Git isolation template directory is not empty: ${templatePath}`)
  }

  return { attributesPath, configPath, templatePath }
}

function collectControllerRuntimeClosure({ entryPath, filesystem = nodeFilesystem }) {
  const root = dirname(entryPath)
  const skillsRoot = dirname(root)
  const initBacklogPrefix = `skills/${basename(root)}`
  const entryName = basename(entryPath)
  const inventory = []
  const readClosureFile = (absolutePath, relativePath) => {
    const metadata = filesystem.lstatSync(absolutePath)
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`controller closure member is not an ordinary nonlinked file: ${relativePath}`)
    }
    inventory.push({ path: relativePath, sha256: sha256(filesystem.readFileSync(absolutePath)) })
  }
  readClosureFile(entryPath, `${initBacklogPrefix}/${entryName}`)
  const walk = (directory, prefix, includeFile) => {
    for (const entry of filesystem.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name < right.name ? -1 : 1)) {
      const absolutePath = join(directory, entry.name)
      const relativePath = `${prefix}/${entry.name}`
      if (entry.isDirectory()) {
        walk(absolutePath, relativePath, includeFile)
      } else if (entry.isFile() && includeFile(entry.name)) {
        readClosureFile(absolutePath, relativePath)
      } else if (includeFile(entry.name)) {
        throw new Error(`controller closure member is not an ordinary nonlinked file: ${relativePath}`)
      }
    }
  }
  walk(join(root, 'lib'), `${initBacklogPrefix}/lib`, (name) => name.endsWith('.js'))
  walk(join(root, 'templates'), `${initBacklogPrefix}/templates`, () => true)
  readClosureFile(join(root, 'unwrap.js'), `${initBacklogPrefix}/unwrap.js`)
  readClosureFile(join(root, 'windows-attributes.ps1'), `${initBacklogPrefix}/windows-attributes.ps1`)
  readClosureFile(join(skillsRoot, 'ready', 'ready.js'), 'skills/ready/ready.js')
  readClosureFile(join(skillsRoot, 'spec-agreement', 'spec-agreement.js'), 'skills/spec-agreement/spec-agreement.js')
  inventory.sort((left, right) => left.path < right.path ? -1 : 1)

  return { controllerRuntimeSha256: sha256(Buffer.from(canonicalJson(inventory), 'utf8')), entryPath, files: inventory }
}

function scenarioRootDigest(repository, platform) {
  return sha256(Buffer.from(canonicalJson(aggregationModule.normalizePlatformModes(repository, platform)), 'utf8'))
}

function runHarnessGit(runGit, argv) {
  if (typeof runGit !== 'function') {
    throw new Error('a Git scenario requires an injected harness Git runner')
  }
  const result = runGit(argv)
  if (result.exitCode !== 0) {
    throw new Error(`harness Git command failed: ${argv.join(' ')}`)
  }

  return result
}

function listScenarioTree(filesystem, scenarioRoot) {
  const listed = []
  const walk = (directory, prefix) => {
    for (const entry of filesystem.readdirSync(directory, { withFileTypes: true })) {
      if (prefix === '' && entry.name === '.git') {
        continue
      }
      const relativePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      const absolutePath = join(directory, entry.name)
      if (entry.isDirectory()) {
        listed.push({ kind: 'directory', path: relativePath })
        walk(absolutePath, relativePath)
      } else {
        listed.push({ kind: 'file', path: relativePath })
      }
    }
  }
  walk(scenarioRoot, '')

  return listed.sort((left, right) => left.path < right.path ? -1 : 1)
}

function verifyScenarioFileSet({ filesystem = nodeFilesystem, platform, repository, runGit = null, scenarioRoot }) {
  const actual = listScenarioTree(filesystem, scenarioRoot)
  const expected = repository.entries.map((entry) => ({ kind: entry.kind, path: entry.path }))
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error(`scenario file set differs from the fixture image: ${scenarioRoot}`)
  }
  for (const entry of repository.entries) {
    const absolutePath = join(scenarioRoot, ...entry.path.split('/'))
    const metadata = filesystem.lstatSync(absolutePath, { bigint: true })
    if (metadata.isSymbolicLink()) {
      throw new Error(`scenario entry is linked: ${entry.path}`)
    }
    if (platform !== 'win32' && Number(metadata.mode & 0o7777n) !== entry.mode) {
      throw new Error(`scenario entry mode differs: ${entry.path}`)
    }
    if (entry.kind === 'file') {
      const bytes = filesystem.readFileSync(absolutePath)
      if (!bytes.equals(Buffer.from(entry.contentBase64, 'base64'))) {
        throw new Error(`scenario entry bytes differ: ${entry.path}`)
      }
    }
  }
  if (repository.git.kind === 'git') {
    const query = runHarnessGit(runGit, ['ls-files', '-z'])

    return parseTrackedSetOutput({ exitCode: 0, expectedTrackedPaths: repository.git.trackedPaths, stderr: query.stderr, stdout: query.stdout })
  }
  if (repository.git.trackedPaths.length !== 0) {
    throw new Error('a non-Git scenario requires an empty tracked array')
  }

  return { trackedPaths: [] }
}

function materializeScenario({ filesystem = nodeFilesystem, platform, repository, runGit = null, scenarioRoot }) {
  filesystem.mkdirSync(scenarioRoot, { recursive: true })
  for (const entry of repository.entries) {
    const absolutePath = join(scenarioRoot, ...entry.path.split('/'))
    if (entry.kind === 'directory') {
      filesystem.mkdirSync(absolutePath)
    } else {
      filesystem.writeFileSync(absolutePath, Buffer.from(entry.contentBase64, 'base64'))
    }
    if (platform !== 'win32') {
      filesystem.chmodSync(absolutePath, entry.mode)
    }
  }
  if (repository.git.kind === 'git') {
    runHarnessGit(runGit, ['init', '--quiet', '--initial-branch=main'])
    if (repository.git.trackedPaths.length !== 0) {
      runHarnessGit(runGit, ['add', '--', ...repository.git.trackedPaths])
    }
  }
  const verification = verifyScenarioFileSet({ filesystem, platform, repository, runGit, scenarioRoot })

  return { scenarioRoot, scenarioRootDigest: scenarioRootDigest(repository, platform), trackedPaths: verification.trackedPaths }
}

module.exports = {
  BYTE_BOUNDS: primitives.BYTE_BOUNDS,
  DEADLINES: primitives.DEADLINES,
  INFRASTRUCTURE_DETAIL_CODES: primitives.INFRASTRUCTURE_DETAIL_CODES,
  INFRASTRUCTURE_PHASES: primitives.INFRASTRUCTURE_PHASES,
  MAX_PROXY_CLIENT_FRAME_BYTES: proxyModule.MAX_PROXY_CLIENT_FRAME_BYTES,
  PRIMARY_INITIAL_CODES: primitives.PRIMARY_INITIAL_CODES,
  PROCESS_ADAPTER_EVENTS: primitives.PROCESS_ADAPTER_EVENTS,
  RUNNER_CLOSE_MILLISECONDS: processModule.RUNNER_CLOSE_MILLISECONDS,
  WINDOWS_RUNNER_INPUT_FRAME_KINDS: processModule.WINDOWS_RUNNER_INPUT_FRAME_KINDS,
  WINDOWS_RUNNER_OUTPUT_FRAME_KINDS: processModule.WINDOWS_RUNNER_OUTPUT_FRAME_KINDS,
  attestTerminalRepository: aggregationModule.attestTerminalRepository,
  buildClosedProjection,
  buildHarnessGitEnvironment,
  buildLeafPath: evidenceModule.buildLeafPath,
  buildResultRecord: aggregationModule.buildResultRecord,
  buildSummary: aggregationModule.buildSummary,
  buildWorkerProjection,
  collectControllerRuntimeClosure,
  createAuthorizationGate: proxyModule.createAuthorizationGate,
  createByteBudget: state.createByteBudget,
  createDirectPosixFallbackAdapter: processModule.createDirectPosixFallbackAdapter,
  createFinalizationBarrier: cleanupModule.createFinalizationBarrier,
  createGitIsolationInputs,
  createHostTempChild,
  createInfrastructureAccount: state.createInfrastructureAccount,
  createLaunchState: state.createLaunchState,
  createLineDecoder: state.createLineDecoder,
  createProductionProcessAdapter: processModule.createProductionProcessAdapter,
  createProxyServer: proxyModule.createProxyServer,
  createProxyTrace: transcriptModule.createProxyTrace,
  createSessionLatch: state.createSessionLatch,
  createTranscript: transcriptModule.createTranscript,
  createTurnSequencer: state.createTurnSequencer,
  createWindowsJobRunnerAdapter: processModule.createWindowsJobRunnerAdapter,
  createWriteState: state.createWriteState,
  credentialValuesFromProjection,
  evaluateLinuxContainment: processModule.evaluateLinuxContainment,
  finalizeRunRoot: cleanupModule.finalizeRunRoot,
  infrastructureFailure: state.infrastructureFailure,
  materializeScenario,
  parseNulTerminatedTrackedPaths,
  parseTrackedSetOutput,
  publishEvidenceLeaf: evidenceModule.publishEvidenceLeaf,
  publishOutputFile: evidenceModule.publishOutputFile,
  scenarioRootDigest,
  verifyCredentialFreeEvidence: evidenceModule.verifyCredentialFreeEvidence,
  verifyScenarioFileSet,
  windowsJobRunnerPath: processModule.windowsJobRunnerPath,
}
