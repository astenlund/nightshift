'use strict'

const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const nodeFilesystem = require('node:fs')
const { tmpdir } = require('node:os')
const nodePath = require('node:path')
const test = require('node:test')

const hostBehavior = require('../init-backlog-host-behavior')
const driver = require('../init-backlog-session-driver')
// Driver-internal module (not a facade export), required directly the same
// way the dialogue cases do.
const hostEvents = require('../init-backlog-session-driver/host-events')
const { canonicalJson, sha256 } = require('./helpers')

const { join } = nodePath
const HEX64 = /^[a-f0-9]{64}$/

const DIALOGUE_FACTS_TRUE = Object.freeze({ allActionsDisclosed: true, ambiguitiesAsked: true, electionPresented: true, approvalBeforeApply: true, denialNoApply: true })
const LIFECYCLE_FACTS_TRUE = Object.freeze({ approvalApplyCardinality: true, resultPresented: true, unresolvedPresented: true, externalWriterWindowDisclosed: true })

const AUTHENTICATED_LINES = [
  'Logged in using workload identity',
  'Logged in using ChatGPT',
  'Logged in using access token',
  'Logged in using personal access token',
  'Logged in using Amazon Bedrock API key',
  'Logged in using Amazon Bedrock AWS access keys',
]

function tempRoot(prefix = 'nightshift-host-entry-') {
  return nodeFilesystem.mkdtempSync(join(tmpdir(), prefix))
}

function resolveRealGitExecutable() {
  const command = process.platform === 'win32' ? 'where' : 'which'
  const completion = require('node:child_process').spawnSync(command, ['git'], { encoding: 'utf8', windowsHide: true })
  const first = (completion.stdout ?? '').split(/\r?\n/).find((line) => line.trim() !== '')
  if (completion.status !== 0 || first === undefined) {
    throw new Error('the suite requires a resolvable git executable')
  }

  return first.trim()
}

function listFilesNamed(root, basename) {
  const found = []
  const walk = (directory) => {
    for (const entry of nodeFilesystem.readdirSync(directory, { withFileTypes: true })) {
      const target = join(directory, entry.name)
      if (entry.isDirectory()) {
        walk(target)
      } else if (entry.name === basename) {
        found.push(target)
      }
    }
  }
  walk(root)

  return found
}

function completedTuple({ exitCode = 0, signal = null, stderr = '', stdout = '' } = {}) {
  return {
    exitCode,
    signal,
    stderrBytes: Buffer.isBuffer(stderr) ? stderr : Buffer.from(stderr, 'utf8'),
    stdoutBytes: Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout, 'utf8'),
  }
}

function loginTuple({ exitCode, line, signal = null, stdout = '', terminator = '\n' }) {
  return completedTuple({ exitCode, signal, stderr: Buffer.concat([Buffer.from(line, 'latin1'), Buffer.from(terminator, 'latin1')]), stdout })
}

function untouchableFilesystem() {
  const calls = []

  return {
    calls,
    handle: new Proxy({}, {
      get(_target, property) {
        return (...args) => {
          calls.push(`${String(property)}:${args.length === 0 ? '' : String(args[0])}`)
          throw new Error(`the filesystem must not be touched: ${String(property)}`)
        }
      },
    }),
  }
}

function fakeCommandFilesystem(spec) {
  const lstatCounts = new Map()
  const readlinkCounts = new Map()
  const inodes = new Map()
  let inodeCounter = 100
  const inodeOf = (key) => {
    if (!inodes.has(key)) {
      inodes.set(key, inodeCounter += 1)
    }

    return inodes.get(key)
  }
  const resolveNode = (pathKey, counts) => {
    const node = spec[pathKey]
    if (node === undefined) {
      return undefined
    }
    if (Array.isArray(node.sequence)) {
      const index = counts.get(pathKey) ?? 0
      counts.set(pathKey, index + 1)

      return node.sequence[Math.min(index, node.sequence.length - 1)]
    }

    return node
  }
  const missing = (pathKey) => {
    const error = new Error(`ENOENT: ${pathKey}`)
    error.code = 'ENOENT'

    return error
  }

  return {
    lstatSync(pathKey) {
      const node = resolveNode(pathKey, lstatCounts)
      if (node === undefined || node === null) {
        throw missing(pathKey)
      }
      const kind = node.kind
      const mode = node.mode ?? (kind === 'file' ? (node.executable === false ? 0o644 : 0o755) : 0o755)

      return {
        dev: 1,
        ino: node.ino ?? inodeOf(`${pathKey}:${kind}:${mode}`),
        isDirectory: () => kind === 'dir',
        isFile: () => kind === 'file',
        isSymbolicLink: () => kind === 'link',
        mode,
      }
    },
    readlinkSync(pathKey) {
      const node = spec[pathKey]
      if (node === undefined || node.kind !== 'link') {
        const error = new Error(`EINVAL: ${pathKey}`)
        error.code = 'EINVAL'
        throw error
      }
      if (Array.isArray(node.targets)) {
        const index = readlinkCounts.get(pathKey) ?? 0
        readlinkCounts.set(pathKey, index + 1)

        return node.targets[Math.min(index, node.targets.length - 1)]
      }

      return node.target
    },
  }
}

function fakeCredentialFilesystem(initialEntries = {}) {
  const entries = new Map()
  const identities = new Map()
  let inode = 500n
  for (const [entryPath, entry] of Object.entries(initialEntries)) {
    entries.set(entryPath, { ...entry })
  }
  const identityOf = (entryPath) => {
    if (!identities.has(entryPath)) {
      identities.set(entryPath, inode += 1n)
    }

    return identities.get(entryPath)
  }
  const missing = (entryPath) => {
    const error = new Error(`ENOENT: ${entryPath}`)
    error.code = 'ENOENT'

    return error
  }
  const reads = []

  return {
    entries,
    lstatSync(entryPath, options = {}) {
      const entry = entries.get(entryPath)
      if (!entry) {
        throw missing(entryPath)
      }
      const bigint = options.bigint === true
      const mode = BigInt(entry.mode)
      const size = BigInt(entry.bytes === null || entry.bytes === undefined ? 0 : entry.bytes.length)

      return {
        dev: bigint ? 1n : 1,
        ino: bigint ? identityOf(entryPath) : Number(identityOf(entryPath)),
        isDirectory: () => entry.kind === 'dir',
        isFile: () => entry.kind === 'file',
        isSymbolicLink: () => entry.kind === 'link',
        mode: bigint ? mode : Number(mode),
        size: bigint ? size : Number(size),
      }
    },
    mkdirSync(entryPath, options = {}) {
      if (entries.has(entryPath)) {
        const error = new Error(`EEXIST: ${entryPath}`)
        error.code = 'EEXIST'
        throw error
      }
      entries.set(entryPath, { bytes: null, kind: 'dir', mode: options.mode ?? 0o777 })
    },
    readFileSync(entryPath) {
      reads.push(entryPath)
      const entry = entries.get(entryPath)
      if (!entry || entry.kind !== 'file') {
        throw missing(entryPath)
      }

      return Buffer.from(entry.bytes)
    },
    reads,
    rmSync(entryPath, options = {}) {
      if (!entries.has(entryPath) && options.force !== true) {
        throw missing(entryPath)
      }
      entries.delete(entryPath)
    },
    writeFileSync(entryPath, bytes, options = {}) {
      if (options.flag === 'wx' && entries.has(entryPath)) {
        const error = new Error(`EEXIST: ${entryPath}`)
        error.code = 'EEXIST'
        throw error
      }
      entries.set(entryPath, { bytes: Buffer.from(bytes), kind: 'file', mode: options.mode ?? 0o666 })
    },
  }
}

function syntheticScenario(scenarioId = 'synthetic-host-entry') {
  const fileEntry = (path, text) => ({ contentBase64: Buffer.from(text, 'utf8').toString('base64'), kind: 'file', mode: 420, path })
  const entries = [
    { contentBase64: null, kind: 'directory', mode: 493, path: '.claude' },
    fileEntry('.claude/QUICK_WINS.md', '# Quick wins\n'),
    fileEntry('git.exe', 'sentinel interpreter\n'),
    fileEntry('powershell.exe', 'sentinel interpreter\n'),
  ]
  const repository = { entries, git: { kind: 'non-git', trackedPaths: [] } }
  const member = { base: repository, hostEntries: { 'claude-code': [], codex: [] }, marker: null }

  return {
    oracles: {
      approvalBranch: 'denied',
      semanticClassifications: [{ conceptIds: [], status: 'complete', target: '.claude/QUICK_WINS.md' }],
      terminalRepositories: { disabled: member, enabled: member },
    },
    repository,
    scenarioId,
    schemaVersion: 1,
  }
}

function importProbeStream(expectedSentinel) {
  const events = [
    { mcp_servers: [], plugins: [], subtype: 'init', tools: [], type: 'system' },
    { structured_output: { sentinel: expectedSentinel }, subtype: 'success', type: 'result' },
  ]

  return Buffer.from(events.map((event) => JSON.stringify(event) + '\n').join(''), 'utf8')
}

function passingRecord(overrides = {}) {
  return {
    approvalBranch: 'denied',
    deterministicDigest: 'd'.repeat(64),
    dialogueFacts: { ...DIALOGUE_FACTS_TRUE },
    lifecycleFacts: { ...LIFECYCLE_FACTS_TRUE },
    passed: true,
    runPluginRootDigest: 'c'.repeat(64),
    scenarioRootDigest: 'f'.repeat(64),
    terminalRepositorySha256: '9'.repeat(64),
    ...overrides,
  }
}

function createEvaluationHarness(scratch, overrides = {}) {
  const platform = process.platform
  const suffix = platform === 'win32' ? '.exe' : ''
  const delimiter = platform === 'win32' ? ';' : ':'
  const binDirectory = join(scratch, 'bin')
  const untrustedDirectory = join(scratch, 'untrusted')
  const checkoutRoot = join(scratch, 'checkout')
  const ambientTemp = join(scratch, 'ambient-temp')
  nodeFilesystem.mkdirSync(binDirectory, { recursive: true })
  nodeFilesystem.mkdirSync(untrustedDirectory, { recursive: true })
  nodeFilesystem.mkdirSync(checkoutRoot, { recursive: true })
  nodeFilesystem.mkdirSync(join(ambientTemp, 'codex-arg0'), { recursive: true })
  nodeFilesystem.writeFileSync(join(ambientTemp, 'codex-arg0', 'residue.txt'), 'stale ambient residue\n')
  nodeFilesystem.writeFileSync(join(untrustedDirectory, 'git.exe'), 'sentinel interpreter\n')
  nodeFilesystem.writeFileSync(join(untrustedDirectory, 'powershell.exe'), 'sentinel interpreter\n')
  const ambientEnvironment = {
    ANTHROPIC_API_KEY: 'synthetic-anthropic-key',
    CODEX_API_KEY: 'synthetic-codex-key',
    HOME: join(scratch, 'home'),
    INIT_CWD: checkoutRoot,
    NODE_PATH: join(checkoutRoot, 'node_modules'),
    OLDPWD: checkoutRoot,
    PATH: [binDirectory, untrustedDirectory, join(checkoutRoot, 'bin')].join(delimiter),
    PWD: checkoutRoot,
    TEMP: ambientTemp,
    TMP: ambientTemp,
    TMPDIR: ambientTemp,
  }
  const descriptorFor = (host, logicalName) => ({
    descriptor: {
      argsPrefix: [],
      executable: join(binDirectory, logicalName + suffix),
      kind: platform === 'win32' ? 'windows-executable' : 'posix-executable',
      logicalName,
      sourcePath: join(binDirectory, logicalName + suffix),
    },
  })
  const launches = []
  const sessions = []
  const roots = []
  let rootOrdinal = 0
  const createRoot = overrides.createRoot ?? ((name) => {
    rootOrdinal += 1
    const root = join(scratch, 'roots', `${rootOrdinal}-${name}`)
    roots.push(root)

    return root
  })
  let lastMarketplacePath = null
  const launch = async (call) => {
    launches.push({ ...call, tempEntries: nodeFilesystem.readdirSync(call.environment.TEMP) })
    if (overrides.onLaunch) {
      const forced = overrides.onLaunch(call)
      if (forced) {
        return forced
      }
    }
    if (call.boundary === 'version') {
      return completedTuple({ stdout: call.host === 'claude-code' ? '2.5.2\n' : 'codex-cli 0.42.0\n' })
    }
    if (call.boundary === 'authentication') {
      return loginTuple({ exitCode: 0, line: 'Logged in using ChatGPT' })
    }
    if (call.boundary === 'plugin-setup') {
      if (call.argv[1] === 'marketplace') {
        lastMarketplacePath = call.argv[3]

        return completedTuple({ stdout: '{}\n' })
      }
      if (call.argv[1] === 'add') {
        return completedTuple({ stdout: '{}\n' })
      }

      return completedTuple({ stdout: JSON.stringify([{ pluginId: 'nightshift@astenlund', source: { path: lastMarketplacePath, source: 'local' } }]) + '\n' })
    }
    if (call.boundary === 'worker') {
      return { ready: true }
    }
    if (call.boundary === 'import-probe') {
      const caseId = nodePath.basename(call.cwd).replace(/^\d+-import-/, '')

      return completedTuple({ stdout: importProbeStream(overrides.importSentinels?.get(caseId) ?? null) })
    }
    throw new Error(`unexpected launch boundary: ${call.boundary}`)
  }
  const runSession = async (call) => {
    sessions.push(call)
    if (overrides.onSession) {
      const forced = overrides.onSession(call)
      if (forced) {
        return forced
      }
    }

    return { record: { deterministicDigest: 'd'.repeat(64), dialogueFacts: { ...DIALOGUE_FACTS_TRUE }, lifecycleFacts: { ...LIFECYCLE_FACTS_TRUE }, passed: true, terminationProven: true } }
  }
  const scenario = syntheticScenario()
  const options = {
    ambientEnvironment,
    baselineManifestSha256: 'a'.repeat(64),
    checkoutRoot,
    controllerEntryPath: join(checkoutRoot, 'skills', 'init-backlog', 'init-backlog.js'),
    controllerWorkerPath: join(scratch, 'controller-worker.js'),
    createRoot,
    descriptors: { 'claude-code': descriptorFor('claude-code', 'claude'), codex: descriptorFor('codex', 'codex') },
    homeDirectory: join(scratch, 'home'),
    launch,
    nodeExecutablePath: join(binDirectory, 'node' + suffix),
    platform,
    preparePluginRoot: ({ controllerEnabled, sessionPluginRoot }) => {
      nodeFilesystem.writeFileSync(join(sessionPluginRoot, 'placeholder.txt'), 'installed plugin placeholder\n')

      return { controllerRuntimeSha256: controllerEnabled ? '4'.repeat(64) : null, runPluginRootDigest: controllerEnabled ? 'c'.repeat(64) : null }
    },
    proxySessionFactory: ({ repetition }) => ({ port: 40000 + repetition, token: 'e'.repeat(64) }),
    runSession,
    runGitFactory: () => {
      throw new Error('this harness carries no git scenarios')
    },
    scenarioManifestSha256: 'b'.repeat(64),
    scenarios: [scenario],
    turnSchemaJson: '{"type":"object"}',
    turnSchemaPath: join(scratch, 'turn.schema.json'),
    ...overrides.options,
  }

  return { ambientEnvironment, ambientTemp, checkoutRoot, launches, options, roots, scenario, sessions, untrustedDirectory }
}

function sessionScenario() {
  return {
    ...syntheticScenario(),
    conversation: { approvalResponse: 'No, do not apply the proposal.', faultSchedule: 'none', hostOutcome: 'none', initialPrompt: 'Run the init-backlog scenario.', preApprovalTurns: [] },
  }
}

// Wraps a real transcript so that every append of the listed kinds returns
// the byte-budget admission-failure shape while the other kinds admit
// normally; the runner under test must map that failure, so the wrapper never
// simulates anything beyond the documented admission result.
function transcriptWithFailingAppends(failingMethods) {
  const real = driver.createTranscript()
  const failing = new Set(failingMethods)
  const admit = (method) => (payloadBytes) => failing.has(method)
    ? { ok: false, overflow: { limitName: 'MAX_TRANSCRIPT_BYTES', observedBytes: real.byteLength() + payloadBytes.length } }
    : real[method](payloadBytes)

  return {
    appendHostEvent: admit('appendHostEvent'),
    appendInput: admit('appendInput'),
    appendStructuredOutput: admit('appendStructuredOutput'),
    byteLength: () => real.byteLength(),
    lines: () => real.lines(),
  }
}

function fakeSessionAdapterFactory({ onStart } = {}) {
  const created = []
  const factory = (options) => {
    const state = { closed: false, exitCode: null, proven: false, terminations: 0 }
    const adapter = {
      closeInput: () => {},
      closureProof: () => ({ proven: state.proven }),
      hostExitCode: () => state.exitCode,
      input: () => ({ ok: true }),
      runnerClosed: () => state.closed,
      start: () => {
        if (onStart) {
          setImmediate(() => onStart({ options, state }))
        }

        return { ok: true }
      },
      terminate: () => {
        state.terminations += 1
      },
    }
    created.push({ options, state })

    return { adapter, ok: true }
  }
  factory.created = created

  return factory
}

function closedWorkerAdapter({ exitCode = 0, onTerminate = () => {} } = {}) {
  return {
    closeInput: () => {},
    closureProof: () => ({ proven: true }),
    hostExitCode: () => exitCode,
    input: () => ({ ok: true }),
    runnerClosed: () => true,
    terminate: onTerminate,
  }
}

function hostEventLine(event) {
  return Buffer.from(JSON.stringify(event) + '\n', 'utf8')
}

function claudeInitEvent(sessionPluginRoot) {
  return {
    mcp_servers: [],
    plugins: [{ name: 'nightshift', path: sessionPluginRoot }],
    skills: hostEvents.CLAUDE_PUBLIC_SKILL_INVENTORY.map((name) => `nightshift:${name}`),
    slash_commands: [],
    subtype: 'init',
    type: 'system',
  }
}

function runHostEntryCases(repositoryRoot) {
  test('the host-behavior live entry pins its closed surface and delegates to the driver package', () => {
    assert.equal(hostBehavior.driverSurface, driver, 'the live entry must delegate to the exact session-driver package instance')
    assert.deepEqual(Object.keys(hostBehavior).sort(), [
      'CODEX_API_KEY_REDACTION_PREFIX',
      'CODEX_AUTHENTICATED_LINES',
      'CODEX_AUTHENTICATION_UNAVAILABLE_RESULT',
      'CODEX_PLUGIN_ID',
      'DISABLED_REPETITIONS',
      'ENABLED_REPETITIONS',
      'HOST_ORDER',
      'LAUNCH_BOUNDARIES',
      'LOGICAL_COMMANDS',
      'RESULT_ROW_FIELDS',
      'UNSUPPORTED_HOST_LAUNCHER_DETAIL',
      'buildClaudeSessionArgv',
      'buildCodexInitialSessionArgv',
      'buildCodexPluginSetupArgvs',
      'buildCodexResumeSessionArgv',
      'buildDisabledPluginRoot',
      'buildEnabledPluginRoot',
      'buildImportProbeArgv',
      'buildLaunchProjection',
      'buildResultRow',
      'classifyCodexLoginStatus',
      'collectQualifyingWriterCodes',
      'collectTerminalRepository',
      'createApplyCallRecorder',
      'createScenarioGitRunner',
      'createTerminalRepositoryCollector',
      'deriveVerifiedLoadedMemory',
      'driverSurface',
      'formatResultLine',
      'main',
      'parseMainArgv',
      'provisionCodexAuthentication',
      'resolveHostCommand',
      'resolveTrustedGit',
      'runEvaluation',
      'runImportCase',
      'runImportMatrix',
      'runLiveHostSession',
      'runOutputEvaluation',
      'runVersionPreflight',
      'validateCalendarDate',
      'validateVersionLine',
      'validateVersionOutput',
      'verifyCodexPluginList',
      'verifyCompatibilityTransition',
    ])
    assert.deepEqual(hostBehavior.HOST_ORDER, ['claude-code', 'codex'])
    assert.deepEqual(hostBehavior.LOGICAL_COMMANDS, { 'claude-code': 'claude', codex: 'codex' })
    assert.deepEqual(hostBehavior.LAUNCH_BOUNDARIES, ['version', 'authentication', 'plugin-setup', 'import-probe', 'worker', 'session'])
    assert.equal(hostBehavior.ENABLED_REPETITIONS, 3)
    assert.equal(hostBehavior.DISABLED_REPETITIONS, 1)
    assert.equal(hostBehavior.CODEX_PLUGIN_ID, 'nightshift@astenlund')
    assert.equal(hostBehavior.UNSUPPORTED_HOST_LAUNCHER_DETAIL, 'The first PATH host launcher is not a supported native executable.')
    assert.deepEqual(hostBehavior.RESULT_ROW_FIELDS, [
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
  })

  test('the session argv builders pin the exact host command contracts', () => {
    assert.deepEqual(hostBehavior.buildClaudeSessionArgv({ sessionPluginRoot: '/run/enabled-plugin', turnSchemaJson: '{"type":"object"}' }), [
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
      '{"type":"object"}',
      '--plugin-dir',
      '/run/enabled-plugin',
    ])
    assert.deepEqual(hostBehavior.buildCodexInitialSessionArgv({ scenarioRoot: '/run/scenario', turnOutputPath: '/run/turn-output.json', turnSchemaPath: '/run/turn.schema.json' }), [
      'exec',
      '--json',
      '--dangerously-bypass-approvals-and-sandbox',
      '--output-schema',
      '/run/turn.schema.json',
      '-o',
      '/run/turn-output.json',
      '-C',
      '/run/scenario',
      '-',
    ])
    assert.deepEqual(hostBehavior.buildCodexResumeSessionArgv({ threadId: 'thread-1', turnOutputPath: '/run/turn-output-2.json', turnSchemaPath: '/run/turn.schema.json' }), [
      'exec',
      'resume',
      '--json',
      '--dangerously-bypass-approvals-and-sandbox',
      '--output-schema',
      '/run/turn.schema.json',
      '-o',
      '/run/turn-output-2.json',
      'thread-1',
      '-',
    ])
    assert.deepEqual(hostBehavior.buildCodexPluginSetupArgvs({ runPluginRoot: '/run/enabled-plugin' }), [
      ['plugin', 'marketplace', 'add', '/run/enabled-plugin', '--json'],
      ['plugin', 'add', 'nightshift@astenlund', '--json'],
      ['plugin', 'list', '--json'],
    ])
  })

  test('the codex login classifier accepts exactly the fixed authenticated and unauthenticated tuples', () => {
    assert.deepEqual(hostBehavior.CODEX_AUTHENTICATED_LINES, AUTHENTICATED_LINES)
    assert.equal(hostBehavior.CODEX_API_KEY_REDACTION_PREFIX, 'Logged in using an API key - ')
    for (const line of AUTHENTICATED_LINES) {
      assert.equal(hostBehavior.classifyCodexLoginStatus(loginTuple({ exitCode: 0, line })), 'authenticated', line)
      assert.equal(hostBehavior.classifyCodexLoginStatus(loginTuple({ exitCode: 0, line, terminator: '\r\n' })), 'authenticated', `${line} (CRLF)`)
    }
    assert.equal(hostBehavior.classifyCodexLoginStatus(loginTuple({ exitCode: 0, line: 'Logged in using an API key - ***' })), 'authenticated')
    assert.equal(hostBehavior.classifyCodexLoginStatus(loginTuple({ exitCode: 0, line: 'Logged in using an API key - sk-proj0***abcde' })), 'authenticated')
    assert.equal(hostBehavior.classifyCodexLoginStatus(loginTuple({ exitCode: 1, line: 'Not logged in' })), 'unauthenticated')
    assert.equal(hostBehavior.classifyCodexLoginStatus(loginTuple({ exitCode: 1, line: 'Not logged in', terminator: '\r\n' })), 'unauthenticated')
  })

  test('every rejected codex login tuple classifies as authentication-unavailable', () => {
    const rejected = [
      ['wrong pairing: exit 0 with the unauthenticated line', loginTuple({ exitCode: 0, line: 'Not logged in' })],
      ['wrong pairing: exit 1 with an authenticated line', loginTuple({ exitCode: 1, line: 'Logged in using ChatGPT' })],
      ['unknown exit code', loginTuple({ exitCode: 2, line: 'Not logged in' })],
      ['stdout contamination', loginTuple({ exitCode: 0, line: 'Logged in using ChatGPT', stdout: 'x' })],
      ['missing line termination', completedTuple({ exitCode: 0, stderr: 'Logged in using ChatGPT' })],
      ['doubled line termination', completedTuple({ exitCode: 1, stderr: 'Not logged in\n\n' })],
      ['an additional line', completedTuple({ exitCode: 1, stderr: 'Not logged in\nextra\n' })],
      ['a non-ASCII byte', completedTuple({ exitCode: 0, stderr: Buffer.concat([Buffer.from('Logged in using ChatGPT', 'latin1'), Buffer.from([0xc3, 0xa9, 0x0a])]) })],
      ['unknown status text', loginTuple({ exitCode: 0, line: 'Logged in using magic beans' })],
      ['malformed redaction: bare double star', loginTuple({ exitCode: 0, line: 'Logged in using an API key - **' })],
      ['malformed redaction: seven-byte prefix', loginTuple({ exitCode: 0, line: 'Logged in using an API key - 1234567***abcde' })],
      ['malformed redaction: four-byte suffix', loginTuple({ exitCode: 0, line: 'Logged in using an API key - 12345678***abcd' })],
      ['malformed redaction: two-star separator', loginTuple({ exitCode: 0, line: 'Logged in using an API key - 12345678**abcde' })],
      ['empty stderr', completedTuple({ exitCode: 0 })],
      ['signal exit', loginTuple({ exitCode: null, line: 'Logged in using ChatGPT', signal: 'SIGKILL' })],
    ]
    for (const [label, tuple] of rejected) {
      assert.equal(hostBehavior.classifyCodexLoginStatus(tuple), 'authentication-unavailable', label)
    }
    assert.deepEqual(Object.keys(hostBehavior.CODEX_AUTHENTICATION_UNAVAILABLE_RESULT), ['ok', 'host', 'code', 'detail'])
    assert.deepEqual(hostBehavior.CODEX_AUTHENTICATION_UNAVAILABLE_RESULT, {
      code: 'authentication-unavailable',
      detail: 'The isolated Codex evaluation home could not use the current supported authentication channel.',
      host: 'codex',
      ok: false,
    })
  })

  test('a rejected completed tuple returns authentication-unavailable on both platforms before any credential path is resolved or read', async () => {
    for (const platform of ['linux', 'win32']) {
      const filesystem = untouchableFilesystem()
      const provisioned = await hostBehavior.provisionCodexAuthentication({
        ambientEnvironment: {},
        filesystem: filesystem.handle,
        homeDirectory: platform === 'win32' ? 'C:\\Users\\eval' : '/home/eval',
        isolatedCodexHome: platform === 'win32' ? 'C:\\run\\codex-home' : '/run/codex-home',
        platform,
        probeLoginStatus: () => loginTuple({ exitCode: 2, line: 'Not logged in' }),
      })

      assert.equal(provisioned.status, 'authentication-unavailable', platform)
      assert.deepEqual(provisioned.result, hostBehavior.CODEX_AUTHENTICATION_UNAVAILABLE_RESULT)
      assert.deepEqual(filesystem.calls, [], `${platform} must resolve or read no credential path`)
    }
  })

  test('pre-session supervision failures retain precedence over authentication classification', async () => {
    const filesystem = untouchableFilesystem()
    const failure = { code: 'preflight-timeout', host: 'codex', ok: false, phase: 'authentication' }
    const provisioned = await hostBehavior.provisionCodexAuthentication({
      ambientEnvironment: {},
      filesystem: filesystem.handle,
      homeDirectory: '/home/eval',
      isolatedCodexHome: '/run/codex-home',
      platform: 'linux',
      probeLoginStatus: () => ({ failure }),
    })

    assert.equal(provisioned.precedence, failure, 'the supervision failure must be returned unchanged')
    assert.deepEqual(filesystem.calls, [])
  })

  test('an authenticated first probe uses the existing channel and copies no credential file', async () => {
    const filesystem = untouchableFilesystem()
    const provisioned = await hostBehavior.provisionCodexAuthentication({
      ambientEnvironment: {},
      filesystem: filesystem.handle,
      homeDirectory: '/home/eval',
      isolatedCodexHome: '/run/codex-home',
      platform: 'linux',
      probeLoginStatus: () => loginTuple({ exitCode: 0, line: 'Logged in using access token' }),
    })

    assert.equal(provisioned.status, 'authenticated')
    assert.deepEqual(filesystem.calls, [])
  })

  test('the POSIX credential-copy fallback is reachable only from the exact unauthenticated tuple and verifies both modes', async () => {
    const filesystem = fakeCredentialFilesystem({
      '/home/eval/.codex': { bytes: null, kind: 'dir', mode: 0o755 },
      '/home/eval/.codex/auth.json': { bytes: Buffer.from('{"synthetic":"credential"}', 'utf8'), kind: 'file', mode: 0o600 },
    })
    let probes = 0
    const provisioned = await hostBehavior.provisionCodexAuthentication({
      ambientEnvironment: {},
      filesystem,
      homeDirectory: '/home/eval',
      isolatedCodexHome: '/run/codex-home',
      platform: 'linux',
      probeLoginStatus: () => {
        probes += 1

        return probes === 1 ? loginTuple({ exitCode: 1, line: 'Not logged in' }) : loginTuple({ exitCode: 0, line: 'Logged in using ChatGPT' })
      },
    })

    assert.equal(provisioned.status, 'authenticated')
    assert.equal(probes, 2, 'the repeated probe must pass the same classifier')
    assert.deepEqual(filesystem.reads, ['/home/eval/.codex/auth.json'])
    const home = filesystem.entries.get('/run/codex-home')
    const copied = filesystem.entries.get('/run/codex-home/auth.json')
    assert.equal(home.kind, 'dir')
    assert.equal(home.mode & 0o7777, 0o700, 'the isolated home mode must be exactly 0o700')
    assert.equal(copied.mode & 0o7777, 0o600, 'the copied credential mode must be exactly 0o600')
    assert.deepEqual(copied.bytes, Buffer.from('{"synthetic":"credential"}', 'utf8'))
    assert.equal(JSON.stringify(provisioned).includes('synthetic'), false, 'the result must not report credential content')
  })

  test('the POSIX fallback resolves the source home from a nonempty ambient CODEX_HOME', async () => {
    const filesystem = fakeCredentialFilesystem({
      '/custom/codex-home/auth.json': { bytes: Buffer.from('{"synthetic":"credential"}', 'utf8'), kind: 'file', mode: 0o600 },
    })
    let probes = 0
    const provisioned = await hostBehavior.provisionCodexAuthentication({
      ambientEnvironment: { CODEX_HOME: '/custom/codex-home' },
      filesystem,
      homeDirectory: '/home/eval',
      isolatedCodexHome: '/run/codex-home',
      platform: 'linux',
      probeLoginStatus: () => {
        probes += 1

        return probes === 1 ? loginTuple({ exitCode: 1, line: 'Not logged in' }) : loginTuple({ exitCode: 0, line: 'Logged in using ChatGPT' })
      },
    })

    assert.equal(provisioned.status, 'authenticated')
    assert.deepEqual(filesystem.reads, ['/custom/codex-home/auth.json'])
  })

  test('a linked or missing source credential and a still-unauthenticated repeat both fail closed', async () => {
    const linked = fakeCredentialFilesystem({
      '/home/eval/.codex/auth.json': { bytes: Buffer.from('x', 'utf8'), kind: 'link', mode: 0o600 },
    })
    const linkedResult = await hostBehavior.provisionCodexAuthentication({
      ambientEnvironment: {},
      filesystem: linked,
      homeDirectory: '/home/eval',
      isolatedCodexHome: '/run/codex-home',
      platform: 'linux',
      probeLoginStatus: () => loginTuple({ exitCode: 1, line: 'Not logged in' }),
    })
    assert.equal(linkedResult.status, 'authentication-unavailable')
    assert.equal(linked.entries.has('/run/codex-home/auth.json'), false, 'a linked source must never be copied')

    const missing = fakeCredentialFilesystem({})
    const missingResult = await hostBehavior.provisionCodexAuthentication({
      ambientEnvironment: {},
      filesystem: missing,
      homeDirectory: '/home/eval',
      isolatedCodexHome: '/run/codex-home',
      platform: 'linux',
      probeLoginStatus: () => loginTuple({ exitCode: 1, line: 'Not logged in' }),
    })
    assert.equal(missingResult.status, 'authentication-unavailable')

    const repeat = fakeCredentialFilesystem({
      '/home/eval/.codex/auth.json': { bytes: Buffer.from('{"synthetic":"credential"}', 'utf8'), kind: 'file', mode: 0o600 },
    })
    const repeatResult = await hostBehavior.provisionCodexAuthentication({
      ambientEnvironment: {},
      filesystem: repeat,
      homeDirectory: '/home/eval',
      isolatedCodexHome: '/run/codex-home',
      platform: 'linux',
      probeLoginStatus: () => loginTuple({ exitCode: 1, line: 'Not logged in' }),
    })
    assert.equal(repeatResult.status, 'authentication-unavailable')
    assert.deepEqual(repeatResult.result, hostBehavior.CODEX_AUTHENTICATION_UNAVAILABLE_RESULT)
    assert.equal(repeat.entries.has('/run/codex-home/auth.json'), false, 'the copied credential is removed and absence-verified on the failed-re-probe stop path')
  })

  test('a credential-removal failure on a stop path escalates to the retained-root carrier instead of silent retention', async () => {
    const filesystem = fakeCredentialFilesystem({
      '/home/eval/.codex/auth.json': { bytes: Buffer.from('{"synthetic":"credential"}', 'utf8'), kind: 'file', mode: 0o600 },
    })
    filesystem.rmSync = () => {
      throw new Error('synthetic removal failure')
    }
    const provisioned = await hostBehavior.provisionCodexAuthentication({
      ambientEnvironment: {},
      filesystem,
      homeDirectory: '/home/eval',
      isolatedCodexHome: '/run/codex-home',
      platform: 'linux',
      probeLoginStatus: () => loginTuple({ exitCode: 1, line: 'Not logged in' }),
    })

    assert.equal(provisioned.status, 'authentication-unavailable')
    assert.deepEqual(provisioned.result, {
      ok: false,
      host: 'codex',
      code: 'harness-infrastructure',
      phase: 'authentication',
      initialCode: 'authentication-unavailable',
      detailCode: 'cleanup',
      retainedRunRoot: '/run/codex-home',
    })
  })

  test('a Windows isolated credential-store miss returns authentication-unavailable with zero credential reads or copies', async () => {
    const filesystem = untouchableFilesystem()
    const provisioned = await hostBehavior.provisionCodexAuthentication({
      ambientEnvironment: { CODEX_HOME: 'C:\\ambient\\codex' },
      filesystem: filesystem.handle,
      homeDirectory: 'C:\\Users\\eval',
      isolatedCodexHome: 'C:\\run\\codex-home',
      platform: 'win32',
      probeLoginStatus: () => loginTuple({ exitCode: 1, line: 'Not logged in' }),
    })

    assert.equal(provisioned.status, 'authentication-unavailable')
    assert.deepEqual(provisioned.result, hostBehavior.CODEX_AUTHENTICATION_UNAVAILABLE_RESULT)
    assert.deepEqual(filesystem.calls, [])
  })

  test('the POSIX host-launcher resolver accepts native layouts and npm symlink chains', () => {
    const native = fakeCommandFilesystem({ '/usr/local/bin': { kind: 'dir' }, '/usr/local/bin/claude': { kind: 'file' } })
    assert.deepEqual(hostBehavior.resolveHostCommand({ ambientPath: '/usr/local/bin', filesystem: native, host: 'claude-code', platform: 'linux' }), {
      descriptor: { argsPrefix: [], executable: '/usr/local/bin/claude', kind: 'posix-executable', logicalName: 'claude', sourcePath: '/usr/local/bin/claude' },
    })

    const npm = fakeCommandFilesystem({
      '/usr/bin': { kind: 'dir' },
      '/usr/bin/claude': { kind: 'link', target: '../lib/node_modules/@anthropic-ai/claude-code/cli.js' },
      '/usr/lib/node_modules/@anthropic-ai/claude-code/cli.js': { kind: 'file' },
    })
    assert.deepEqual(hostBehavior.resolveHostCommand({ ambientPath: '/usr/bin', filesystem: npm, host: 'claude-code', platform: 'linux' }), {
      descriptor: { argsPrefix: [], executable: '/usr/lib/node_modules/@anthropic-ai/claude-code/cli.js', kind: 'posix-executable', logicalName: 'claude', sourcePath: '/usr/bin/claude' },
    })
  })

  test('the POSIX resolver honors the 32-link boundary', () => {
    const buildChain = (linkCount) => {
      const spec = { '/bin': { kind: 'dir' }, '/bin/codex': { kind: 'link', target: '/links/t1' }, '/links/final': { kind: 'file' } }
      for (let index = 1; index < linkCount; index += 1) {
        spec[`/links/t${index}`] = { kind: 'link', target: index === linkCount - 1 ? '/links/final' : `/links/t${index + 1}` }
      }
      if (linkCount === 1) {
        spec['/bin/codex'] = { kind: 'link', target: '/links/final' }
      }

      return spec
    }
    const within = hostBehavior.resolveHostCommand({ ambientPath: '/bin', filesystem: fakeCommandFilesystem(buildChain(32)), host: 'codex', platform: 'linux' })
    assert.deepEqual(within.descriptor, { argsPrefix: [], executable: '/links/final', kind: 'posix-executable', logicalName: 'codex', sourcePath: '/bin/codex' })
    const beyond = hostBehavior.resolveHostCommand({ ambientPath: '/bin', filesystem: fakeCommandFilesystem(buildChain(33)), host: 'codex', platform: 'linux' })
    assert.equal(beyond.unsupported.code, 'unsupported-host-launcher')
  })

  test('unstable hops, retargeted links, protected-root escapes, and nonexecutable finals are unsupported', () => {
    const unstable = fakeCommandFilesystem({
      '/bin': { kind: 'dir' },
      '/bin/claude': { sequence: [{ kind: 'link', target: '/real/claude' }, { kind: 'file' }] },
      '/real/claude': { kind: 'file' },
    })
    assert.equal(hostBehavior.resolveHostCommand({ ambientPath: '/bin', filesystem: unstable, host: 'claude-code', platform: 'linux' }).unsupported.code, 'unsupported-host-launcher')

    const retargeted = fakeCommandFilesystem({
      '/bin': { kind: 'dir' },
      '/bin/claude': { kind: 'link', target: '/real/claude', targets: ['/real/claude', '/other/claude'] },
      '/real/claude': { kind: 'file' },
      '/other/claude': { kind: 'file' },
    })
    assert.equal(hostBehavior.resolveHostCommand({ ambientPath: '/bin', filesystem: retargeted, host: 'claude-code', platform: 'linux' }).unsupported.code, 'unsupported-host-launcher')

    const escaping = fakeCommandFilesystem({
      '/bin': { kind: 'dir' },
      '/bin/claude': { kind: 'link', target: '/checkout/nightshift/bin/claude' },
      '/checkout/nightshift/bin/claude': { kind: 'file' },
    })
    assert.equal(hostBehavior.resolveHostCommand({ ambientPath: '/bin', filesystem: escaping, host: 'claude-code', platform: 'linux', protectedRoots: ['/checkout/nightshift'] }).unsupported.code, 'unsupported-host-launcher')

    const nonexecutable = fakeCommandFilesystem({ '/bin': { kind: 'dir' }, '/bin/claude': { executable: false, kind: 'file' } })
    assert.equal(hostBehavior.resolveHostCommand({ ambientPath: '/bin', filesystem: nonexecutable, host: 'claude-code', platform: 'linux' }).unsupported.code, 'unsupported-host-launcher')

    const directoryCandidate = fakeCommandFilesystem({ '/bin': { kind: 'dir' }, '/bin/claude': { kind: 'dir' } })
    assert.equal(hostBehavior.resolveHostCommand({ ambientPath: '/bin', filesystem: directoryCandidate, host: 'claude-code', platform: 'linux' }).unsupported.code, 'unsupported-host-launcher')
  })

  test('relative and empty PATH entries and protected directories are never examined, and the first candidate directory is decisive', () => {
    const skipping = fakeCommandFilesystem({
      'relative/claude': { kind: 'file' },
      '/checkout/bin': { kind: 'dir' },
      '/checkout/bin/claude': { kind: 'file' },
      '/real/bin': { kind: 'dir' },
      '/real/bin/claude': { kind: 'file' },
    })
    const resolved = hostBehavior.resolveHostCommand({ ambientPath: ':relative:/checkout/bin:/real/bin', filesystem: skipping, host: 'claude-code', platform: 'linux', protectedRoots: ['/checkout'] })
    assert.equal(resolved.descriptor.executable, '/real/bin/claude')

    const onlyRelative = hostBehavior.resolveHostCommand({ ambientPath: 'relative', filesystem: skipping, host: 'claude-code', platform: 'linux' })
    assert.equal(onlyRelative.unsupported.code, 'unsupported-host-launcher')

    const precedence = fakeCommandFilesystem({
      '/first': { kind: 'dir' },
      '/first/claude': { executable: false, kind: 'file' },
      '/second': { kind: 'dir' },
      '/second/claude': { kind: 'file' },
    })
    assert.equal(hostBehavior.resolveHostCommand({ ambientPath: '/first:/second', filesystem: precedence, host: 'claude-code', platform: 'linux' }).unsupported.code, 'unsupported-host-launcher')
  })

  test('PATH directories are canonicalized and stable-validated before their candidates are examined', () => {
    const evasionSpec = () => ({
      '/evil': { kind: 'link', target: '/checkout/nightshift/bin' },
      '/checkout/nightshift/bin': { kind: 'dir' },
      '/checkout/nightshift/bin/claude': { kind: 'file' },
      '/safe': { kind: 'dir' },
      '/safe/claude': { kind: 'file' },
    })
    const evaded = hostBehavior.resolveHostCommand({
      ambientPath: '/evil:/safe',
      filesystem: fakeCommandFilesystem(evasionSpec()),
      host: 'claude-code',
      platform: 'linux',
      protectedRoots: ['/checkout/nightshift'],
    })
    assert.equal(evaded.descriptor.executable, '/safe/claude', 'a symlinked PATH directory targeting the checkout is never examined')
    const evasionOnly = hostBehavior.resolveHostCommand({
      ambientPath: '/evil',
      filesystem: fakeCommandFilesystem(evasionSpec()),
      host: 'claude-code',
      platform: 'linux',
      protectedRoots: ['/checkout/nightshift'],
    })
    assert.equal(evasionOnly.unsupported.code, 'unsupported-host-launcher')

    const flickering = fakeCommandFilesystem({
      '/flicker': { sequence: [{ kind: 'dir' }, { kind: 'file' }] },
      '/flicker/claude': { kind: 'file' },
      '/safe': { kind: 'dir' },
      '/safe/claude': { kind: 'file' },
    })
    assert.equal(
      hostBehavior.resolveHostCommand({ ambientPath: '/flicker:/safe', filesystem: flickering, host: 'claude-code', platform: 'linux' }).unsupported.code,
      'unsupported-host-launcher',
      'an unstable PATH directory fails closed',
    )

    const aliased = fakeCommandFilesystem({
      '/alias': { kind: 'link', target: '/real' },
      '/real': { kind: 'dir' },
      '/real/claude': { kind: 'file' },
    })
    assert.deepEqual(hostBehavior.resolveHostCommand({ ambientPath: '/alias', filesystem: aliased, host: 'claude-code', platform: 'linux' }), {
      descriptor: { argsPrefix: [], executable: '/real/claude', kind: 'posix-executable', logicalName: 'claude', sourcePath: '/real/claude' },
    }, 'a canonical outside-root directory still resolves against its canonical identity')
  })

  test('the Windows resolver accepts only a stable ordinary .exe and rejects every shim in candidate order', () => {
    const native = fakeCommandFilesystem({ 'C:\\hosts': { kind: 'dir' }, 'C:\\hosts\\claude.exe': { kind: 'file' } })
    assert.deepEqual(hostBehavior.resolveHostCommand({ ambientPath: 'C:\\hosts', filesystem: native, host: 'claude-code', platform: 'win32' }), {
      descriptor: { argsPrefix: [], executable: 'C:\\hosts\\claude.exe', kind: 'windows-executable', logicalName: 'claude', sourcePath: 'C:\\hosts\\claude.exe' },
    })

    for (const shim of ['claude.cmd', 'claude.bat', 'claude.com']) {
      const shimFilesystem = fakeCommandFilesystem({ 'C:\\hosts': { kind: 'dir' }, [`C:\\hosts\\${shim}`]: { kind: 'file' } })
      assert.equal(hostBehavior.resolveHostCommand({ ambientPath: 'C:\\hosts', filesystem: shimFilesystem, host: 'claude-code', platform: 'win32' }).unsupported.code, 'unsupported-host-launcher', shim)
    }

    const shimBeforeExe = fakeCommandFilesystem({
      'C:\\first': { kind: 'dir' },
      'C:\\first\\claude.cmd': { kind: 'file' },
      'C:\\second': { kind: 'dir' },
      'C:\\second\\claude.exe': { kind: 'file' },
    })
    assert.equal(hostBehavior.resolveHostCommand({ ambientPath: 'C:\\first;C:\\second', filesystem: shimBeforeExe, host: 'claude-code', platform: 'win32' }).unsupported.code, 'unsupported-host-launcher')

    const exePreferred = fakeCommandFilesystem({
      'C:\\hosts': { kind: 'dir' },
      'C:\\hosts\\claude.exe': { kind: 'file' },
      'C:\\hosts\\claude.cmd': { kind: 'file' },
    })
    assert.equal(hostBehavior.resolveHostCommand({ ambientPath: 'C:\\hosts', filesystem: exePreferred, host: 'claude-code', platform: 'win32' }).descriptor.executable, 'C:\\hosts\\claude.exe')

    const linkedExe = fakeCommandFilesystem({ 'C:\\hosts': { kind: 'dir' }, 'C:\\hosts\\claude.exe': { kind: 'link', target: 'C:\\real\\claude.exe' }, 'C:\\real\\claude.exe': { kind: 'file' } })
    assert.equal(hostBehavior.resolveHostCommand({ ambientPath: 'C:\\hosts', filesystem: linkedExe, host: 'claude-code', platform: 'win32' }).unsupported.code, 'unsupported-host-launcher')
  })

  test('a protected Windows drive root contains every launcher below it', () => {
    const filesystem = fakeCommandFilesystem({
      'C:\\Program Files\\Git\\cmd': { kind: 'dir' },
      'C:\\Program Files\\Git\\cmd\\git.exe': { kind: 'file' },
    })
    assert.throws(() => hostBehavior.resolveTrustedGit({
      ambientPath: 'C:\\Program Files\\Git\\cmd',
      filesystem,
      platform: 'win32',
      protectedRoots: ['C:\\'],
    }), /trusted git executable could not be resolved/)
  })

  test('the unsupported-host-launcher result pins its exact bytes and field order', () => {
    const resolution = hostBehavior.resolveHostCommand({ ambientPath: '', filesystem: fakeCommandFilesystem({}), host: 'claude-code', platform: 'linux' })
    assert.deepEqual(Object.keys(resolution.unsupported), ['code', 'detail', 'host', 'ok'])
    assert.deepEqual(resolution.unsupported, {
      code: 'unsupported-host-launcher',
      detail: 'The first PATH host launcher is not a supported native executable.',
      host: 'claude-code',
      ok: false,
    })
    assert.deepEqual(
      hostBehavior.formatResultLine(resolution.unsupported),
      Buffer.from('{"code":"unsupported-host-launcher","detail":"The first PATH host launcher is not a supported native executable.","host":"claude-code","ok":false}\n', 'utf8'),
    )
  })

  test('the launch projection drops process-context keys, keeps credentials and overrides, and binds the lifecycle temp triple', () => {
    const ambientEnvironment = {
      ANTHROPIC_API_KEY: 'synthetic-anthropic-key',
      HOME: '/home/eval',
      INIT_CWD: '/checkout/nightshift',
      NIGHTSHIFT_ARBITRARY_PATH: '/somewhere/else',
      NODE_PATH: '/checkout/nightshift/node_modules',
      OLDPWD: '/checkout/nightshift',
      PATH: '/usr/bin:/checkout/nightshift/bin:/checkout/nightshift',
      PWD: '/checkout/nightshift',
      TEMP: '/ambient/temp',
      TMP: '/ambient/temp',
      TMPDIR: '/ambient/temp',
    }
    const projection = hostBehavior.buildLaunchProjection({
      ambientEnvironment,
      boundary: 'plugin-setup',
      checkoutRoot: '/checkout/nightshift',
      overrides: { CODEX_HOME: '/run/codex-home' },
      platform: 'linux',
      temporaryPaths: { run: '/run/host-temp' },
    })

    for (const key of ['PWD', 'OLDPWD', 'INIT_CWD', 'NODE_PATH', 'NIGHTSHIFT_ARBITRARY_PATH']) {
      assert.equal(key in projection, false, `${key} must be omitted`)
    }
    assert.equal(projection.ANTHROPIC_API_KEY, 'synthetic-anthropic-key')
    assert.equal(projection.CODEX_HOME, '/run/codex-home')
    assert.equal(projection.PATH, '/usr/bin', 'checkout-bearing PATH entries must be removed')
    assert.equal(projection.TEMP, '/run/host-temp')
    assert.equal(projection.TMP, '/run/host-temp')
    assert.equal(projection.TMPDIR, '/run/host-temp')
  })

  test('the projection boundary grammar is closed and each boundary selects its own lifecycle temp child', () => {
    const build = (boundary, temporaryPaths, proxySession = null) => hostBehavior.buildLaunchProjection({
      ambientEnvironment: {},
      boundary,
      checkoutRoot: '/checkout/nightshift',
      platform: 'linux',
      proxySession,
      temporaryPaths,
    })

    assert.equal(build('version', { preflight: '/preflight/host-temp' }).TMPDIR, '/preflight/host-temp')
    assert.equal(build('import-probe', { case: '/case/host-temp' }).TMPDIR, '/case/host-temp')
    for (const boundary of ['authentication', 'plugin-setup', 'worker', 'session']) {
      assert.equal(build(boundary, { run: '/run/host-temp' }).TMPDIR, '/run/host-temp', boundary)
    }
    assert.throws(() => build('bogus', { run: '/run/host-temp' }), /boundary/)
    assert.throws(() => build('version', { run: '/run/host-temp' }), /temp/)
    assert.throws(() => build('plugin-setup', { run: '/run/host-temp' }, { port: 4000, token: 'e'.repeat(64) }), /proxy/i)
  })

  test('enabled-session projections carry exactly the three proxy keys with canonical values and every other projection carries none', () => {
    const build = (proxySession) => hostBehavior.buildLaunchProjection({
      ambientEnvironment: {},
      boundary: 'session',
      checkoutRoot: '/checkout/nightshift',
      platform: 'linux',
      proxySession,
      temporaryPaths: { run: '/run/host-temp' },
    })
    const enabled = build({ port: 65535, token: 'e'.repeat(64) })
    assert.equal(enabled.NIGHTSHIFT_INIT_BACKLOG_PROXY_ADDRESS, '127.0.0.1')
    assert.equal(enabled.NIGHTSHIFT_INIT_BACKLOG_PROXY_PORT, '65535')
    assert.equal(enabled.NIGHTSHIFT_INIT_BACKLOG_PROXY_TOKEN, 'e'.repeat(64))
    assert.equal(build({ port: 1, token: 'e'.repeat(64) }).NIGHTSHIFT_INIT_BACKLOG_PROXY_PORT, '1')
    const disabled = build(null)
    for (const key of ['NIGHTSHIFT_INIT_BACKLOG_PROXY_ADDRESS', 'NIGHTSHIFT_INIT_BACKLOG_PROXY_PORT', 'NIGHTSHIFT_INIT_BACKLOG_PROXY_TOKEN']) {
      assert.equal(key in disabled, false, key)
    }
    for (const port of [0, 65536, 3.5, '80']) {
      assert.throws(() => build({ port, token: 'e'.repeat(64) }), /port/, String(port))
    }
    assert.throws(() => build({ port: 4000, token: 'E'.repeat(64) }), /token/)
    assert.throws(() => build({ port: 4000, token: 'e'.repeat(63) }), /token/)
  })

  test('Windows duplicate-case aliases and checkout-bearing values fail closed', () => {
    assert.throws(() => hostBehavior.buildLaunchProjection({
      ambientEnvironment: { PATH: 'C:\\bin', Path: 'C:\\other' },
      boundary: 'worker',
      checkoutRoot: 'C:\\checkout\\nightshift',
      platform: 'win32',
      temporaryPaths: { run: 'C:\\run\\host-temp' },
    }), /duplicate-case/)
    assert.throws(() => hostBehavior.buildLaunchProjection({
      ambientEnvironment: { HOME: '/checkout/nightshift/home' },
      boundary: 'worker',
      checkoutRoot: '/checkout/nightshift',
      platform: 'linux',
      temporaryPaths: { run: '/run/host-temp' },
    }), /checkout/)
    const posixExactSpelling = hostBehavior.buildLaunchProjection({
      ambientEnvironment: { Path: '/bin' },
      boundary: 'worker',
      checkoutRoot: '/checkout/nightshift',
      platform: 'linux',
      temporaryPaths: { run: '/run/host-temp' },
    })
    assert.equal('Path' in posixExactSpelling, false, 'POSIX matching uses exact key spelling')
  })

  test('a projected Node child observes neither forbidden keys nor checkout or driver paths', () => {
    const scratch = tempRoot()
    try {
      const temporaryChild = join(scratch, 'host-temp')
      nodeFilesystem.mkdirSync(temporaryChild)
      const probeScript = join(scratch, 'environment-probe.js')
      nodeFilesystem.writeFileSync(probeScript, "process.stdout.write(JSON.stringify(process.env))\n")
      const ambientEnvironment = {
        ANTHROPIC_API_KEY: 'synthetic-anthropic-key',
        INIT_CWD: repositoryRoot,
        NIGHTSHIFT_ARBITRARY_PATH: join(repositoryRoot, 'secret'),
        NODE_PATH: join(repositoryRoot, 'node_modules'),
        OLDPWD: repositoryRoot,
        PATH: nodePath.dirname(process.execPath),
        PWD: repositoryRoot,
      }
      if (process.platform === 'win32') {
        ambientEnvironment.SystemRoot = process.env.SystemRoot ?? 'C:\\Windows'
        ambientEnvironment.ComSpec = process.env.ComSpec ?? 'C:\\Windows\\System32\\cmd.exe'
      }
      const controllerPath = join(repositoryRoot, 'skills', 'init-backlog', 'init-backlog.js')
      const projection = hostBehavior.buildLaunchProjection({
        ambientEnvironment,
        boundary: 'session',
        checkoutRoot: repositoryRoot,
        controllerPath,
        platform: process.platform,
        temporaryPaths: { run: temporaryChild },
      })
      const childEnvironment = JSON.parse(execFileSync(process.execPath, [probeScript], { cwd: scratch, encoding: 'utf8', env: projection, windowsHide: true }))

      for (const key of ['PWD', 'OLDPWD', 'INIT_CWD', 'NODE_PATH', 'NIGHTSHIFT_ARBITRARY_PATH']) {
        assert.equal(key in childEnvironment, false, `the child must not see ${key}`)
      }
      const comparable = (value) => process.platform === 'win32' ? value.toLowerCase() : value
      for (const [key, value] of Object.entries(childEnvironment)) {
        assert.equal(comparable(key).includes(comparable(repositoryRoot)), false, `child key carries the checkout: ${key}`)
        assert.equal(comparable(String(value)).includes(comparable(repositoryRoot)), false, `child value carries the checkout: ${key}`)
        assert.equal(comparable(String(value)).includes(comparable(controllerPath)), false, `child value carries the controller path: ${key}`)
      }
      assert.equal(childEnvironment.TEMP, temporaryChild)
      assert.equal(childEnvironment.TMP, temporaryChild)
      assert.equal(childEnvironment.TMPDIR, temporaryChild)
      assert.equal(childEnvironment.ANTHROPIC_API_KEY, 'synthetic-anthropic-key')
    } finally {
      nodeFilesystem.rmSync(scratch, { force: true, recursive: true })
    }
  })

  test('an import case creates one fixed host temp child plus an isolated import home and launches at the import-probe boundary', async () => {
    const scratch = tempRoot()
    try {
      const launches = []
      const descriptor = { argsPrefix: [], executable: join(scratch, 'bin', 'claude'), kind: 'posix-executable', logicalName: 'claude', sourcePath: join(scratch, 'bin', 'claude') }
      const results = []
      for (const ordinal of [1, 2]) {
        results.push(await hostBehavior.runImportCase({
          ambientEnvironment: { TEMP: join(scratch, 'ambient'), TMP: join(scratch, 'ambient'), TMPDIR: join(scratch, 'ambient') },
          argv: ['--print', 'import-probe'],
          caseRoot: join(scratch, `case-${ordinal}`),
          checkoutRoot: join(scratch, 'checkout'),
          descriptor,
          host: 'claude-code',
          launch: async (call) => {
            launches.push(call)

            return completedTuple({ stdout: '{}\n' })
          },
          platform: process.platform,
        }))
      }

      assert.equal(launches.length, 2)
      for (const [index, call] of launches.entries()) {
        const caseRoot = join(scratch, `case-${index + 1}`)
        assert.equal(call.boundary, 'import-probe')
        assert.equal(call.environment.TEMP, join(caseRoot, 'host-temp'))
        assert.equal(call.environment.TMP, join(caseRoot, 'host-temp'))
        assert.equal(call.environment.TMPDIR, join(caseRoot, 'host-temp'))
        assert.equal(call.environment.HOME, join(caseRoot, 'home'))
        assert.equal(call.environment.USERPROFILE, join(caseRoot, 'home'))
        assert.equal('NIGHTSHIFT_INIT_BACKLOG_PROXY_TOKEN' in call.environment, false)
        assert.deepEqual(nodeFilesystem.readdirSync(call.environment.TEMP), [], 'the import temp child starts empty')
      }
      assert.notEqual(results[0].hostTempPath, results[1].hostTempPath, 'each import case owns its own host temp child')
    } finally {
      nodeFilesystem.rmSync(scratch, { force: true, recursive: true })
    }
  })

  test('the version preflight launches claude-code then codex from a dedicated root and cleans it up before returning versions', async () => {
    const scratch = tempRoot()
    try {
      const preflightRunRoot = join(scratch, 'preflight-run')
      const checkoutRoot = join(scratch, 'checkout')
      nodeFilesystem.mkdirSync(checkoutRoot, { recursive: true })
      const launches = []
      const descriptors = {
        'claude-code': { argsPrefix: [], executable: join(scratch, 'bin', 'claude'), kind: 'posix-executable', logicalName: 'claude', sourcePath: join(scratch, 'bin', 'claude') },
        codex: { argsPrefix: [], executable: join(scratch, 'bin', 'codex'), kind: 'posix-executable', logicalName: 'codex', sourcePath: join(scratch, 'bin', 'codex') },
      }
      const preflight = await hostBehavior.runVersionPreflight({
        ambientEnvironment: { TEMP: join(scratch, 'ambient') },
        checkoutRoot,
        descriptors,
        launch: async (call) => {
          launches.push(call)

          return completedTuple({ stdout: call.host === 'claude-code' ? '2.5.2\n' : 'codex-cli 0.42.0\r\n' })
        },
        platform: process.platform,
        preflightRunRoot,
      })

      assert.deepEqual(preflight.versions, { 'claude-code': '2.5.2', codex: 'codex-cli 0.42.0' })
      assert.deepEqual(launches.map((call) => call.host), ['claude-code', 'codex'])
      for (const call of launches) {
        assert.deepEqual(call.argv, ['--version'])
        assert.equal(call.boundary, 'version')
        assert.equal(call.cwd, checkoutRoot)
        assert.equal(call.executable, descriptors[call.host].executable)
        assert.equal(call.environment.TEMP, join(preflightRunRoot, 'host-temp'))
        assert.equal(call.environment.TMP, join(preflightRunRoot, 'host-temp'))
        assert.equal(call.environment.TMPDIR, join(preflightRunRoot, 'host-temp'))
      }
      assert.equal(nodeFilesystem.existsSync(preflightRunRoot), false, 'the preflight root is removed and absence-verified before rows')
    } finally {
      nodeFilesystem.rmSync(scratch, { force: true, recursive: true })
    }
  })

  test('every invalid version output returns the fixed detail in check order and cleans up the preflight root', async () => {
    const invalidOutputs = [
      ['Version command failed.', completedTuple({ exitCode: 1, stdout: '2.5.2\n' })],
      ['Version command failed.', completedTuple({ exitCode: null, signal: 'SIGKILL' })],
      ['Version command wrote stderr.', completedTuple({ stderr: 'warning\n', stdout: '2.5.2\n' })],
      ['Version output is not valid UTF-8.', completedTuple({ stdout: Buffer.from([0xff, 0xfe, 0x0a]) })],
      ['Version output must be one nonblank line of at most 256 bytes.', completedTuple({ stdout: 'a\nb\n' })],
      ['Version output must be one nonblank line of at most 256 bytes.', completedTuple({ stdout: '\n' })],
      ['Version output must be one nonblank line of at most 256 bytes.', completedTuple({ stdout: '   \n' })],
      ['Version output must be one nonblank line of at most 256 bytes.', completedTuple({ stdout: 'v'.repeat(257) + '\n' })],
      ['Version output must be one nonblank line of at most 256 bytes.', completedTuple({ stdout: '' })],
    ]
    for (const [detail, tuple] of invalidOutputs) {
      const scratch = tempRoot()
      try {
        const preflightRunRoot = join(scratch, 'preflight-run')
        const launches = []
        const result = await hostBehavior.runVersionPreflight({
          ambientEnvironment: {},
          checkoutRoot: join(scratch, 'checkout'),
          descriptors: {
            'claude-code': { argsPrefix: [], executable: join(scratch, 'bin', 'claude'), kind: 'posix-executable', logicalName: 'claude', sourcePath: join(scratch, 'bin', 'claude') },
            codex: { argsPrefix: [], executable: join(scratch, 'bin', 'codex'), kind: 'posix-executable', logicalName: 'codex', sourcePath: join(scratch, 'bin', 'codex') },
          },
          launch: async (call) => {
            launches.push(call)

            return tuple
          },
          platform: process.platform,
          preflightRunRoot,
        })

        assert.deepEqual(Object.keys(result.result), ['ok', 'host', 'code', 'detail'], detail)
        assert.deepEqual(result.result, { code: 'invalid-host-version', detail, host: 'claude-code', ok: false }, detail)
        assert.equal(launches.length, 1, 'the first version failure stops evaluation before the codex launch')
        assert.equal(nodeFilesystem.existsSync(preflightRunRoot), false, 'invalid-version cleanup removes the preflight root')
      } finally {
        nodeFilesystem.rmSync(scratch, { force: true, recursive: true })
      }
    }
  })

  test('a preflight cleanup failure escalates to the infrastructure carrier with the retained preflight root', async () => {
    const scratch = tempRoot()
    try {
      const preflightRunRoot = join(scratch, 'preflight-run')
      const filesystem = {
        ...nodeFilesystem,
        rmSync() {
          throw new Error('synthetic cleanup failure')
        },
      }
      const result = await hostBehavior.runVersionPreflight({
        ambientEnvironment: {},
        checkoutRoot: join(scratch, 'checkout'),
        descriptors: {
          'claude-code': { argsPrefix: [], executable: join(scratch, 'bin', 'claude'), kind: 'posix-executable', logicalName: 'claude', sourcePath: join(scratch, 'bin', 'claude') },
          codex: { argsPrefix: [], executable: join(scratch, 'bin', 'codex'), kind: 'posix-executable', logicalName: 'codex', sourcePath: join(scratch, 'bin', 'codex') },
        },
        filesystem,
        launch: async () => completedTuple({ exitCode: 1 }),
        platform: process.platform,
        preflightRunRoot,
      })

      assert.deepEqual(result.result, {
        ok: false,
        host: 'claude-code',
        code: 'harness-infrastructure',
        phase: 'version',
        initialCode: 'invalid-host-version',
        detailCode: 'cleanup',
        retainedRunRoot: preflightRunRoot,
      })
      assert.equal(nodeFilesystem.existsSync(preflightRunRoot), true, 'the preflight root is retained on cleanup failure')
    } finally {
      nodeFilesystem.rmSync(scratch, { force: true, recursive: true })
    }
  })

  test('a preflight root seeded with stale residue is refused rather than reused', async () => {
    const scratch = tempRoot()
    try {
      const preflightRunRoot = join(scratch, 'preflight-run')
      nodeFilesystem.mkdirSync(join(preflightRunRoot, 'codex-arg0'), { recursive: true })
      nodeFilesystem.writeFileSync(join(preflightRunRoot, 'codex-arg0', 'residue.txt'), 'stale residue\n')

      await assert.rejects(hostBehavior.runVersionPreflight({
        ambientEnvironment: {},
        checkoutRoot: join(scratch, 'checkout'),
        descriptors: {
          'claude-code': { argsPrefix: [], executable: join(scratch, 'bin', 'claude'), kind: 'posix-executable', logicalName: 'claude', sourcePath: join(scratch, 'bin', 'claude') },
          codex: { argsPrefix: [], executable: join(scratch, 'bin', 'codex'), kind: 'posix-executable', logicalName: 'codex', sourcePath: join(scratch, 'bin', 'codex') },
        },
        launch: async () => completedTuple({ stdout: '2.5.2\n' }),
        platform: process.platform,
        preflightRunRoot,
      }), /must start empty/)
    } finally {
      nodeFilesystem.rmSync(scratch, { force: true, recursive: true })
    }
  })

  test('the version-line and calendar-date grammars are exact', () => {
    assert.equal(hostBehavior.validateVersionLine('2.5.2'), true)
    assert.equal(hostBehavior.validateVersionLine('v'.repeat(256)), true)
    assert.equal(hostBehavior.validateVersionLine('v'.repeat(257)), false)
    assert.equal(hostBehavior.validateVersionLine(''), false)
    assert.equal(hostBehavior.validateVersionLine('   '), false)
    assert.equal(hostBehavior.validateVersionLine('a\nb'), false)
    assert.equal(hostBehavior.validateVersionLine('a\rb'), false)
    assert.equal(hostBehavior.validateVersionLine(null), false)
    assert.equal(hostBehavior.validateCalendarDate('2026-08-28'), true)
    assert.equal(hostBehavior.validateCalendarDate('2024-02-29'), true)
    assert.equal(hostBehavior.validateCalendarDate('2026-02-30'), false)
    assert.equal(hostBehavior.validateCalendarDate('2026-13-01'), false)
    assert.equal(hostBehavior.validateCalendarDate('2026-00-10'), false)
    assert.equal(hostBehavior.validateCalendarDate('2026-8-28'), false)
    assert.equal(hostBehavior.validateCalendarDate('not-a-date'), false)
  })

  test('the compatibility-transition verifier accepts changes only to claudeVersion and probedOn', () => {
    const scratch = tempRoot()
    try {
      const writeRecord = (name, record, raw = null) => {
        const target = join(scratch, name)
        nodeFilesystem.writeFileSync(target, raw ?? canonicalJson(record) + '\n')

        return target
      }
      const baseRecord = { claudeVersion: null, host: 'claude-code', probedOn: null, scenario: 'fresh-empty-track-approved', schemaVersion: 1 }
      const afterRecord = { ...baseRecord, claudeVersion: '2.5.2', probedOn: '2026-08-28' }
      const beforePath = writeRecord('before.json', baseRecord)
      const afterPath = writeRecord('after.json', afterRecord)

      assert.deepEqual(hostBehavior.verifyCompatibilityTransition({ afterPath, beforePath }), { ok: true })
      assert.throws(() => hostBehavior.verifyCompatibilityTransition({
        afterPath: writeRecord('after-drift.json', { ...afterRecord, scenario: 'other-scenario' }),
        beforePath,
      }), /field/)
      assert.throws(() => hostBehavior.verifyCompatibilityTransition({
        afterPath,
        beforePath: writeRecord('before-nonnull.json', { ...baseRecord, claudeVersion: '2.5.1' }),
      }), /null/)
      assert.throws(() => hostBehavior.verifyCompatibilityTransition({
        afterPath: writeRecord('after-bad-date.json', { ...afterRecord, probedOn: '2026-02-30' }),
        beforePath,
      }), /probedOn/)
      assert.throws(() => hostBehavior.verifyCompatibilityTransition({
        afterPath: writeRecord('after-bad-version.json', { ...afterRecord, claudeVersion: 'a\nb' }),
        beforePath,
      }), /claudeVersion/)
      assert.throws(() => hostBehavior.verifyCompatibilityTransition({
        afterPath: writeRecord('after-extra-key.json', { ...afterRecord, extra: 1 }),
        beforePath,
      }), /field/)
      assert.throws(() => hostBehavior.verifyCompatibilityTransition({
        afterPath: writeRecord('after-noncanonical.json', null, '{"schemaVersion":1,"claudeVersion":"2.5.2","host":"claude-code","probedOn":"2026-08-28","scenario":"fresh-empty-track-approved"}\n'),
        beforePath,
      }), /canonical/)
      assert.throws(() => hostBehavior.verifyCompatibilityTransition({
        afterPath: writeRecord('after-no-lf.json', null, canonicalJson(afterRecord)),
        beforePath,
      }), /canonical/)
    } finally {
      nodeFilesystem.rmSync(scratch, { force: true, recursive: true })
    }
  })

  test('the live helper CLI emits exact canonical ok bytes and performs no host launch or write', () => {
    const scratch = tempRoot()
    try {
      const record = { claudeVersion: null, host: 'claude-code', probedOn: null, scenario: 's', schemaVersion: 1 }
      const beforePath = join(scratch, 'before.json')
      const afterPath = join(scratch, 'after.json')
      nodeFilesystem.writeFileSync(beforePath, canonicalJson(record) + '\n')
      nodeFilesystem.writeFileSync(afterPath, canonicalJson({ ...record, claudeVersion: '2.5.2', probedOn: '2026-08-28' }) + '\n')
      const readOnlyFilesystem = { lstatSync: nodeFilesystem.lstatSync, readFileSync: nodeFilesystem.readFileSync }
      const stdoutWrites = []
      const stderrWrites = []
      const streams = {
        filesystem: readOnlyFilesystem,
        stderr: { write: (text) => stderrWrites.push(text) },
        stdout: { write: (text) => stdoutWrites.push(text) },
      }

      assert.equal(hostBehavior.main(['--verify-compatibility-transition', beforePath, afterPath], streams), 0)
      assert.deepEqual(stdoutWrites, ['{"ok":true}\n'])
      assert.deepEqual(stderrWrites, [])

      nodeFilesystem.writeFileSync(afterPath, canonicalJson({ ...record, claudeVersion: '2.5.2', probedOn: '2026-08-28', scenario: 'drifted' }) + '\n')
      assert.equal(hostBehavior.main(['--verify-compatibility-transition', beforePath, afterPath], streams), 1)
      assert.equal(stdoutWrites.length, 1, 'a failed verification writes nothing to stdout')
      assert.equal(stderrWrites.length, 1)
      assert.equal(hostBehavior.main([], streams), 2, 'unknown argv returns the usage exit code')
    } finally {
      nodeFilesystem.rmSync(scratch, { force: true, recursive: true })
    }
  })

  test('the real terminal repository collector reconstructs the exact entries-and-git image from a scratch directory', () => {
    const scratch = tempRoot()
    try {
      const scenarioRoot = join(scratch, 'scenario')
      nodeFilesystem.mkdirSync(join(scenarioRoot, 'sub'), { recursive: true })
      nodeFilesystem.mkdirSync(join(scenarioRoot, '.git', 'objects'), { recursive: true })
      nodeFilesystem.writeFileSync(join(scenarioRoot, '.git', 'HEAD'), 'ref: refs/heads/main\n')
      nodeFilesystem.writeFileSync(join(scenarioRoot, 'a.md'), '# A\n')
      nodeFilesystem.writeFileSync(join(scenarioRoot, 'sub', 'b.md'), '# B\n')
      const runGit = (argv) => {
        assert.deepEqual(argv, ['ls-files', '-z'])

        return { exitCode: 0, stderr: Buffer.alloc(0), stdout: Buffer.from('a.md\u0000sub/b.md\u0000', 'utf8') }
      }
      const collector = hostBehavior.createTerminalRepositoryCollector({ platform: process.platform, runGit, scenarioRoot })
      const first = collector()
      const second = collector()

      assert.equal(canonicalJson(first), canonicalJson(second), 'two independent collections must agree canonically')
      assert.deepEqual(first.entries.map((entry) => entry.path), ['a.md', 'sub', 'sub/b.md'], 'entries are ordinal sorted and exclude .git')
      for (const entry of first.entries) {
        assert.deepEqual(Object.keys(entry).sort(), ['contentBase64', 'kind', 'mode', 'path'])
        if (process.platform === 'win32') {
          assert.equal(entry.mode, null, 'Windows modes are platform-comparable null')
        } else {
          assert.equal(typeof entry.mode, 'number')
        }
      }
      assert.equal(first.entries[0].contentBase64, Buffer.from('# A\n', 'utf8').toString('base64'))
      assert.equal(first.entries[1].kind, 'directory')
      assert.equal(first.entries[1].contentBase64, null)
      assert.deepEqual(first.git, { kind: 'git', trackedPaths: ['a.md', 'sub/b.md'] })
      assert.match(sha256(Buffer.from(canonicalJson(first), 'utf8')), HEX64)
    } finally {
      nodeFilesystem.rmSync(scratch, { force: true, recursive: true })
    }
  })

  test('the collector queries the tracked set through the scrubbed Git runner against a real repository', () => {
    const scratch = tempRoot()
    try {
      const scenarioRoot = join(scratch, 'scenario')
      nodeFilesystem.mkdirSync(scenarioRoot, { recursive: true })
      nodeFilesystem.writeFileSync(join(scenarioRoot, 'tracked.md'), 'tracked\n')
      nodeFilesystem.writeFileSync(join(scenarioRoot, 'untracked.md'), 'untracked\n')
      const isolation = driver.createGitIsolationInputs({ runRoot: scratch })
      const environment = driver.buildHarnessGitEnvironment({
        ambientEnvironment: process.env,
        attributesPath: isolation.attributesPath,
        configPath: isolation.configPath,
        platform: process.platform,
        templatePath: isolation.templatePath,
      })
      const runGit = hostBehavior.createScenarioGitRunner({ environment, gitExecutablePath: resolveRealGitExecutable(), scenarioRoot })
      assert.equal(runGit(['init', '--quiet', '--initial-branch=main']).exitCode, 0)
      assert.equal(runGit(['add', '--', 'tracked.md']).exitCode, 0)
      const collector = hostBehavior.createTerminalRepositoryCollector({ platform: process.platform, runGit, scenarioRoot })
      const collected = collector()

      assert.deepEqual(collected.git, { kind: 'git', trackedPaths: ['tracked.md'] })
      assert.deepEqual(collected.entries.map((entry) => entry.path), ['tracked.md', 'untracked.md'])
      assert.equal(canonicalJson(collector()), canonicalJson(collected))
    } finally {
      nodeFilesystem.rmSync(scratch, { force: true, recursive: true })
    }
  })

  test('the scenario git runner launches only the retained absolute trusted git, never a cwd or PATH shim', () => {
    const scratch = tempRoot()
    try {
      const scenarioRoot = join(scratch, 'scenario')
      const untrustedDirectory = join(scratch, 'untrusted')
      nodeFilesystem.mkdirSync(scenarioRoot, { recursive: true })
      nodeFilesystem.mkdirSync(untrustedDirectory, { recursive: true })
      for (const shimName of ['git', 'git.exe']) {
        nodeFilesystem.writeFileSync(join(scenarioRoot, shimName), 'sentinel interpreter\n')
        nodeFilesystem.writeFileSync(join(untrustedDirectory, shimName), 'sentinel interpreter\n')
      }
      const realGit = resolveRealGitExecutable()
      const resolution = hostBehavior.resolveTrustedGit({ ambientPath: nodePath.dirname(realGit), platform: process.platform })
      assert.equal(nodePath.isAbsolute(resolution.executable), true, 'the trusted resolution returns an absolute path')
      assert.equal(nodePath.basename(resolution.executable).startsWith('git'), true)
      const isolation = driver.createGitIsolationInputs({ runRoot: scratch })
      const environment = {
        ...driver.buildHarnessGitEnvironment({
          ambientEnvironment: process.env,
          attributesPath: isolation.attributesPath,
          configPath: isolation.configPath,
          platform: process.platform,
          templatePath: isolation.templatePath,
        }),
      }
      // The runner's environment PATH leads with the untrusted shim directory
      // while the scenario cwd carries its own sentinels; the retained
      // absolute path must still be the launched executable.
      environment.PATH = untrustedDirectory + (process.platform === 'win32' ? ';' : ':') + (environment.PATH ?? '')
      const runner = hostBehavior.createScenarioGitRunner({ environment, gitExecutablePath: resolution.executable, scenarioRoot })
      const completion = runner(['--version'])

      assert.equal(completion.exitCode, 0)
      assert.match(completion.stdout.toString('utf8'), /^git version /, 'the real trusted git ran, not a sentinel shim')
      assert.throws(() => hostBehavior.createScenarioGitRunner({ environment, gitExecutablePath: 'git', scenarioRoot }), /absolute/)
      assert.throws(() => hostBehavior.createScenarioGitRunner({ environment, scenarioRoot }), /absolute/)
    } finally {
      nodeFilesystem.rmSync(scratch, { force: true, recursive: true })
    }
  })

  test('the collector rejects malformed tracked-set output and unsupported entries', () => {
    const scratch = tempRoot()
    try {
      const scenarioRoot = join(scratch, 'scenario')
      nodeFilesystem.mkdirSync(join(scenarioRoot, '.git'), { recursive: true })
      nodeFilesystem.writeFileSync(join(scenarioRoot, 'a.md'), '# A\n')
      const collect = (gitResult) => hostBehavior.collectTerminalRepository({
        platform: process.platform,
        runGit: () => gitResult,
        scenarioRoot,
      })

      assert.throws(() => collect({ exitCode: 1, stderr: Buffer.alloc(0), stdout: Buffer.alloc(0) }), /exit/)
      assert.throws(() => collect({ exitCode: 0, stderr: Buffer.from('warn\n'), stdout: Buffer.alloc(0) }), /stderr/)
      assert.throws(() => collect({ exitCode: 0, stderr: Buffer.alloc(0), stdout: Buffer.from('a.md', 'utf8') }), /NUL/)
      assert.throws(() => collect({ exitCode: 0, stderr: Buffer.alloc(0), stdout: Buffer.from('b.md\u0000a.md\u0000', 'utf8') }), /order/)
      assert.throws(() => collect({ exitCode: 0, stderr: Buffer.alloc(0), stdout: Buffer.from('\u0000', 'utf8') }), /empty/)
      assert.throws(() => collect({ exitCode: 0, stderr: Buffer.alloc(0), stdout: Buffer.from('../escape\u0000', 'utf8') }), /confined/)
      assert.throws(() => collect({ exitCode: 0, stderr: Buffer.alloc(0), stdout: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('\u0000', 'utf8')]) }), /UTF-8/)
      assert.throws(() => hostBehavior.collectTerminalRepository({ platform: process.platform, runGit: null, scenarioRoot }), /Git/)

      if (process.platform !== 'win32') {
        const linkedRoot = join(scratch, 'linked-scenario')
        nodeFilesystem.mkdirSync(linkedRoot, { recursive: true })
        nodeFilesystem.writeFileSync(join(linkedRoot, 'real.md'), 'real\n')
        nodeFilesystem.symlinkSync(join(linkedRoot, 'real.md'), join(linkedRoot, 'link.md'))
        assert.throws(() => hostBehavior.collectTerminalRepository({ platform: process.platform, runGit: null, scenarioRoot: linkedRoot }), /link/)
      }
    } finally {
      nodeFilesystem.rmSync(scratch, { force: true, recursive: true })
    }
  })

  test('the real collector composes with the terminal attestation seam over a live scratch scenario', () => {
    const scratch = tempRoot()
    try {
      const scenarioRoot = join(scratch, 'scenario')
      nodeFilesystem.mkdirSync(join(scenarioRoot, 'sub'), { recursive: true })
      nodeFilesystem.writeFileSync(join(scenarioRoot, 'a.md'), '# A\n')
      nodeFilesystem.writeFileSync(join(scenarioRoot, 'sub', 'b.md'), '# B\n')
      if (process.platform !== 'win32') {
        nodeFilesystem.chmodSync(join(scenarioRoot, 'sub'), 0o755)
        nodeFilesystem.chmodSync(join(scenarioRoot, 'a.md'), 0o644)
        nodeFilesystem.chmodSync(join(scenarioRoot, 'sub', 'b.md'), 0o644)
      }
      const member = {
        base: {
          entries: [
            { contentBase64: Buffer.from('# A\n', 'utf8').toString('base64'), kind: 'file', mode: 420, path: 'a.md' },
            { contentBase64: null, kind: 'directory', mode: 493, path: 'sub' },
            { contentBase64: Buffer.from('# B\n', 'utf8').toString('base64'), kind: 'file', mode: 420, path: 'sub/b.md' },
          ],
          git: { kind: 'non-git', trackedPaths: [] },
        },
        hostEntries: { 'claude-code': [], codex: [] },
        marker: null,
      }
      const collectRepository = hostBehavior.createTerminalRepositoryCollector({ platform: process.platform, scenarioRoot })
      const attestation = driver.attestTerminalRepository({ collectRepository, host: 'claude-code', member, platform: process.platform, scenarioRoot })

      assert.equal(attestation.passed, true)
      assert.match(attestation.terminalRepositorySha256, HEX64)
    } finally {
      nodeFilesystem.rmSync(scratch, { force: true, recursive: true })
    }
  })

  test('result rows pin the exact field order and the mode-specific repetition literals', () => {
    const scenario = syntheticScenario()
    const enabledRow = hostBehavior.buildResultRow({
      baselineManifestSha256: 'a'.repeat(64),
      controllerEnabled: true,
      host: 'claude-code',
      records: [passingRecord(), passingRecord(), passingRecord()],
      scenario,
      scenarioManifestSha256: 'b'.repeat(64),
      version: '2.5.2',
    })

    assert.deepEqual(Object.keys(enabledRow), hostBehavior.RESULT_ROW_FIELDS)
    assert.equal(enabledRow.repetitions, 3)
    assert.equal(enabledRow.controllerEnabled, true)
    assert.equal(enabledRow.runPluginRootDigest, 'c'.repeat(64))
    assert.equal(enabledRow.deterministicDigest, 'd'.repeat(64))
    assert.equal(enabledRow.semanticDecisionSource, 'model')
    assert.equal(enabledRow.approvalBranch, 'denied')
    assert.equal(enabledRow.passed, true)

    const disabledRow = hostBehavior.buildResultRow({
      baselineManifestSha256: 'a'.repeat(64),
      controllerEnabled: false,
      host: 'codex',
      records: [passingRecord({ deterministicDigest: null, runPluginRootDigest: null })],
      scenario,
      scenarioManifestSha256: 'b'.repeat(64),
      version: 'codex-cli 0.42.0',
    })
    assert.equal(disabledRow.repetitions, 1)
    assert.equal(disabledRow.runPluginRootDigest, null)
    assert.equal(disabledRow.deterministicDigest, null)
    assert.equal(disabledRow.passed, true, 'disabled null digests are inapplicable, not failing')

    assert.throws(() => hostBehavior.buildResultRow({
      baselineManifestSha256: 'a'.repeat(64),
      controllerEnabled: true,
      host: 'claude-code',
      records: [passingRecord()],
      scenario,
      scenarioManifestSha256: 'b'.repeat(64),
      version: '2.5.2',
    }), /repetition/)
  })

  test('enabled repetition disagreement nulls the shared digests and fails the row', () => {
    const scenario = syntheticScenario()
    const disagreeing = hostBehavior.buildResultRow({
      baselineManifestSha256: 'a'.repeat(64),
      controllerEnabled: true,
      host: 'claude-code',
      records: [passingRecord(), passingRecord({ terminalRepositorySha256: '8'.repeat(64) }), passingRecord()],
      scenario,
      scenarioManifestSha256: 'b'.repeat(64),
      version: '2.5.2',
    })
    assert.equal(disagreeing.terminalRepositorySha256, null)
    assert.equal(disagreeing.passed, false)

    const digestDisagreement = hostBehavior.buildResultRow({
      baselineManifestSha256: 'a'.repeat(64),
      controllerEnabled: true,
      host: 'claude-code',
      records: [passingRecord(), passingRecord({ deterministicDigest: '1'.repeat(64) }), passingRecord()],
      scenario,
      scenarioManifestSha256: 'b'.repeat(64),
      version: '2.5.2',
    })
    assert.equal(digestDisagreement.deterministicDigest, null)
    assert.equal(digestDisagreement.passed, false)
  })

  test('the assembled evaluation runs three enabled repetitions plus one disabled baseline per host with exact boundary projections', async () => {
    const scratch = tempRoot()
    try {
      const harness = createEvaluationHarness(scratch)
      const evaluation = await hostBehavior.runEvaluation(harness.options)

      assert.equal(evaluation.exitCode, 0)
      assert.equal(evaluation.result, null)
      assert.deepEqual(evaluation.versions, { 'claude-code': '2.5.2', codex: 'codex-cli 0.42.0' })
      assert.equal(evaluation.rows.length, 4)
      assert.deepEqual(evaluation.rows.map((row) => [row.host, row.controllerEnabled, row.repetitions]), [
        ['claude-code', false, 1],
        ['claude-code', true, 3],
        ['codex', false, 1],
        ['codex', true, 3],
      ])
      const expectedScenarioRootDigest = driver.scenarioRootDigest(harness.scenario.repository, process.platform)
      for (const row of evaluation.rows) {
        assert.deepEqual(Object.keys(row), hostBehavior.RESULT_ROW_FIELDS)
        assert.equal(row.version, row.host === 'claude-code' ? '2.5.2' : 'codex-cli 0.42.0')
        assert.equal(row.scenario, 'synthetic-host-entry')
        assert.equal(row.baselineManifestSha256, 'a'.repeat(64))
        assert.equal(row.scenarioManifestSha256, 'b'.repeat(64))
        assert.equal(row.scenarioRootDigest, expectedScenarioRootDigest)
        assert.equal(row.runPluginRootDigest, row.controllerEnabled ? 'c'.repeat(64) : null)
        assert.equal(row.deterministicDigest, row.controllerEnabled ? 'd'.repeat(64) : null)
        assert.equal(row.semanticDecisionSource, 'model')
        assert.match(row.terminalRepositorySha256, HEX64)
        assert.equal(row.passed, true)
      }
      assert.equal(new Set(evaluation.rows.map((row) => row.terminalRepositorySha256)).size, 1)

      const versionLaunches = harness.launches.filter((call) => call.boundary === 'version')
      assert.deepEqual(versionLaunches.map((call) => call.host), ['claude-code', 'codex'])
      assert.equal(harness.launches[0].boundary, 'version', 'version preflight precedes every other launch')
      assert.equal(harness.launches[1].boundary, 'version')
      assert.equal(nodeFilesystem.existsSync(harness.roots[0]), false, 'the preflight root is cleaned before rows')

      const authenticationLaunches = harness.launches.filter((call) => call.boundary === 'authentication')
      assert.equal(authenticationLaunches.length, 4, 'each codex repetition provisions isolated authentication')
      for (const call of authenticationLaunches) {
        assert.equal(call.host, 'codex')
        assert.deepEqual(call.argv, ['login', 'status'])
        assert.match(call.environment.CODEX_HOME, /codex-home$/)
      }
      const pluginLaunches = harness.launches.filter((call) => call.boundary === 'plugin-setup')
      assert.equal(pluginLaunches.length, 12, 'three exact plugin-setup commands per codex repetition')
      for (let index = 0; index < pluginLaunches.length; index += 3) {
        const pluginRoot = pluginLaunches[index].argv[3]
        assert.deepEqual(pluginLaunches[index].argv, ['plugin', 'marketplace', 'add', pluginRoot, '--json'])
        assert.deepEqual(pluginLaunches[index + 1].argv, ['plugin', 'add', 'nightshift@astenlund', '--json'])
        assert.deepEqual(pluginLaunches[index + 2].argv, ['plugin', 'list', '--json'])
      }
      const workerLaunches = harness.launches.filter((call) => call.boundary === 'worker')
      assert.equal(workerLaunches.length, 6, 'exactly one worker per enabled repetition and none for disabled runs')
      for (const call of workerLaunches) {
        assert.equal(call.executable, harness.options.nodeExecutablePath)
        assert.deepEqual(call.argv, [harness.options.controllerWorkerPath, harness.options.controllerEntryPath, '4'.repeat(64)])
        assert.equal('ANTHROPIC_API_KEY' in call.environment, false, 'the worker projection carries no credentials')
        assert.equal('CODEX_API_KEY' in call.environment, false)
        assert.equal(call.environment.GIT_TERMINAL_PROMPT, '0', 'the worker projection carries the hermetic Git environment')
      }

      assert.equal(harness.sessions.length, 8, 'one disabled plus three enabled sessions per host')
      for (const session of harness.sessions) {
        const runRoot = nodePath.dirname(session.sessionPluginRoot)
        assert.equal(nodePath.dirname(session.cwd), runRoot, 'the scenario root is a runRoot sibling of the plugin root')
        assert.equal(nodePath.basename(session.sessionPluginRoot), session.controllerEnabled ? 'enabled-plugin' : 'disabled-plugin')
        assert.equal(session.environment.TEMP, join(runRoot, 'host-temp'))
        assert.equal(session.environment.TMP, join(runRoot, 'host-temp'))
        assert.equal(session.environment.TMPDIR, join(runRoot, 'host-temp'))
        assert.equal(session.environment.ANTHROPIC_API_KEY, 'synthetic-anthropic-key')
        if (session.controllerEnabled) {
          assert.equal(session.environment.NIGHTSHIFT_INIT_BACKLOG_PROXY_ADDRESS, '127.0.0.1')
          assert.match(session.environment.NIGHTSHIFT_INIT_BACKLOG_PROXY_PORT, /^\d+$/)
          assert.equal(session.environment.NIGHTSHIFT_INIT_BACKLOG_PROXY_TOKEN, 'e'.repeat(64))
        } else {
          for (const key of ['NIGHTSHIFT_INIT_BACKLOG_PROXY_ADDRESS', 'NIGHTSHIFT_INIT_BACKLOG_PROXY_PORT', 'NIGHTSHIFT_INIT_BACKLOG_PROXY_TOKEN']) {
            assert.equal(key in session.environment, false, key)
          }
        }
        if (session.host === 'claude-code') {
          assert.equal(session.argv[session.argv.indexOf('--setting-sources') + 1], 'project', 'the scenario root is the sole setting source')
          assert.equal(session.argv[session.argv.indexOf('--plugin-dir') + 1], session.sessionPluginRoot)
        } else {
          assert.equal(session.argv[session.argv.indexOf('-C') + 1], session.cwd)
        }
      }
      const sessionTempPaths = new Set(harness.sessions.map((session) => session.environment.TEMP))
      assert.equal(sessionTempPaths.size, 8, 'each behavioral repetition owns its own host temp child')
      for (const call of harness.launches) {
        assert.notEqual(call.environment.TEMP, harness.ambientTemp, 'ambient temp state is never copied')
        assert.deepEqual(call.tempEntries, [], 'no launch observes stale codex-arg0 residue or prior-run content')
        assert.equal('PWD' in call.environment, false)
        assert.equal('NODE_PATH' in call.environment, false)
        const knownExecutables = [
          harness.options.descriptors['claude-code'].descriptor.executable,
          harness.options.descriptors.codex.descriptor.executable,
          harness.options.nodeExecutablePath,
        ]
        assert.equal(knownExecutables.includes(call.executable), true, 'only retained absolute trusted executables are launched')
        assert.equal(call.executable.startsWith(harness.untrustedDirectory), false)
      }
      for (const root of harness.roots) {
        assert.equal(nodeFilesystem.existsSync(root), false, 'every run root is removed and absence-verified')
      }
    } finally {
      nodeFilesystem.rmSync(scratch, { force: true, recursive: true })
    }
  })

  test('an unsupported host launcher stops the evaluation with the exact preflight bytes and zero process launches', async () => {
    const scratch = tempRoot()
    try {
      const harness = createEvaluationHarness(scratch)
      const unsupported = {
        code: 'unsupported-host-launcher',
        detail: 'The first PATH host launcher is not a supported native executable.',
        host: 'claude-code',
        ok: false,
      }
      const evaluation = await hostBehavior.runEvaluation({
        ...harness.options,
        descriptors: { 'claude-code': { unsupported }, codex: harness.options.descriptors.codex },
      })

      assert.equal(evaluation.exitCode, 1)
      assert.deepEqual(evaluation.result, unsupported)
      assert.deepEqual(evaluation.resultLine, hostBehavior.formatResultLine(unsupported))
      assert.deepEqual(evaluation.rows, [])
      assert.equal(harness.launches.length, 0, 'zero process launches after an unsupported descriptor')
    } finally {
      nodeFilesystem.rmSync(scratch, { force: true, recursive: true })
    }
  })

  test('a version failure inside the assembled evaluation emits the primary result with no rows', async () => {
    const scratch = tempRoot()
    try {
      const harness = createEvaluationHarness(scratch, {
        onLaunch: (call) => call.boundary === 'version' && call.host === 'claude-code' ? completedTuple({ exitCode: 1 }) : null,
      })
      const evaluation = await hostBehavior.runEvaluation(harness.options)

      assert.equal(evaluation.exitCode, 1)
      assert.deepEqual(evaluation.result, { code: 'invalid-host-version', detail: 'Version command failed.', host: 'claude-code', ok: false })
      assert.deepEqual(evaluation.rows, [])
      assert.equal(harness.launches.length, 1)
      assert.equal(nodeFilesystem.existsSync(harness.roots[0]), false)
    } finally {
      nodeFilesystem.rmSync(scratch, { force: true, recursive: true })
    }
  })

  test('a rejected codex authentication tuple stops the evaluation before plugin setup with the fixed primary result', async () => {
    const scratch = tempRoot()
    try {
      const harness = createEvaluationHarness(scratch, {
        onLaunch: (call) => call.boundary === 'authentication' ? loginTuple({ exitCode: 2, line: 'Not logged in' }) : null,
      })
      const evaluation = await hostBehavior.runEvaluation(harness.options)

      assert.equal(evaluation.exitCode, 1)
      assert.deepEqual(evaluation.result, hostBehavior.CODEX_AUTHENTICATION_UNAVAILABLE_RESULT)
      assert.deepEqual(evaluation.rows, [], 'a primary result emits no table rows')
      assert.equal(harness.launches.filter((call) => call.boundary === 'plugin-setup').length, 0)
      assert.equal(harness.sessions.filter((session) => session.host === 'codex').length, 0)
    } finally {
      nodeFilesystem.rmSync(scratch, { force: true, recursive: true })
    }
  })

  test('a worker startup failure produces the infrastructure carrier before any host session', async () => {
    const scratch = tempRoot()
    try {
      const harness = createEvaluationHarness(scratch, {
        onLaunch: (call) => call.boundary === 'worker' ? { failure: { reason: 'startup' } } : null,
      })
      const evaluation = await hostBehavior.runEvaluation(harness.options)

      assert.equal(evaluation.exitCode, 1)
      assert.deepEqual(evaluation.result, {
        ok: false,
        host: 'claude-code',
        code: 'harness-infrastructure',
        phase: 'initial-turn',
        initialCode: null,
        detailCode: 'proxy',
        retainedRunRoot: harness.roots[2],
      })
      assert.deepEqual(evaluation.rows, [])
      assert.equal(harness.sessions.filter((session) => session.controllerEnabled).length, 0, 'no enabled session launches after a worker failure')
    } finally {
      nodeFilesystem.rmSync(scratch, { force: true, recursive: true })
    }
  })

  test('pre-spawn scenario revalidation rejects drift injected after plugin setup with zero codex sessions', async () => {
    const scratch = tempRoot()
    try {
      const harness = createEvaluationHarness(scratch, {
        onLaunch: (call) => {
          if (call.boundary === 'plugin-setup' && call.argv[1] === 'add') {
            const runRoot = nodePath.dirname(call.environment.CODEX_HOME)
            nodeFilesystem.writeFileSync(join(runRoot, 'scenario', 'drift.txt'), 'external drift\n')
          }

          return null
        },
      })

      await assert.rejects(hostBehavior.runEvaluation(harness.options), /scenario file set differs/)
      assert.equal(harness.sessions.filter((session) => session.host === 'codex').length, 0, 'drift fails before the host spawn')
    } finally {
      nodeFilesystem.rmSync(scratch, { force: true, recursive: true })
    }
  })

  test('a codex plugin-list mismatch fails before a session', async () => {
    const scratch = tempRoot()
    try {
      const harness = createEvaluationHarness(scratch, {
        onLaunch: (call) => {
          if (call.boundary === 'plugin-setup' && call.argv[1] === 'list') {
            return completedTuple({ stdout: JSON.stringify([{ pluginId: 'nightshift@astenlund', source: { path: call.environment.CODEX_HOME, source: 'github' } }]) + '\n' })
          }

          return null
        },
      })

      await assert.rejects(hostBehavior.runEvaluation(harness.options), /plugin installation verification/)
      assert.equal(harness.sessions.filter((session) => session.host === 'codex').length, 0)

      const verification = hostBehavior.verifyCodexPluginList({
        platform: process.platform,
        runPluginRoot: '/run/enabled-plugin',
        stdoutBytes: Buffer.from(JSON.stringify([{ pluginId: 'nightshift@astenlund', source: { path: '/run/enabled-plugin', source: 'local' } }]) + '\n', 'utf8'),
      })
      assert.deepEqual(verification, { ok: true })
      for (const [label, records] of [
        ['wrong source kind', [{ pluginId: 'nightshift@astenlund', source: { path: '/run/enabled-plugin', source: 'github' } }]],
        ['wrong path', [{ pluginId: 'nightshift@astenlund', source: { path: '/other', source: 'local' } }]],
        ['wrong id', [{ pluginId: 'other@astenlund', source: { path: '/run/enabled-plugin', source: 'local' } }]],
        ['extra record', [{ pluginId: 'nightshift@astenlund', source: { path: '/run/enabled-plugin', source: 'local' } }, { pluginId: 'other@x', source: { path: '/y', source: 'local' } }]],
        ['no record', []],
      ]) {
        const rejected = hostBehavior.verifyCodexPluginList({ platform: process.platform, runPluginRoot: '/run/enabled-plugin', stdoutBytes: Buffer.from(JSON.stringify(records) + '\n', 'utf8') })
        assert.equal(rejected.ok, false, label)
      }
    } finally {
      nodeFilesystem.rmSync(scratch, { force: true, recursive: true })
    }
  })

  test('a copied codex credential never survives a throw or failure stop path of the assembled evaluation', async () => {
    const copyingProvision = async ({ isolatedCodexHome }) => {
      nodeFilesystem.mkdirSync(isolatedCodexHome, { recursive: true })
      nodeFilesystem.writeFileSync(join(isolatedCodexHome, 'auth.json'), '{"synthetic":"credential"}\n')

      return { copiedCredential: true, status: 'authenticated' }
    }

    const throwScratch = tempRoot()
    try {
      const harness = createEvaluationHarness(throwScratch, {
        onLaunch: (call) => call.boundary === 'plugin-setup' && call.argv[1] === 'list'
          ? completedTuple({ stdout: JSON.stringify([{ pluginId: 'nightshift@astenlund', source: { path: join(throwScratch, 'wrong'), source: 'local' } }]) + '\n' })
          : null,
        options: { provisionAuthentication: copyingProvision },
      })

      await assert.rejects(hostBehavior.runEvaluation(harness.options), /plugin installation verification/)
      assert.deepEqual(listFilesNamed(throwScratch, 'auth.json'), [], 'the throw path removes the copied credential before rethrowing')
    } finally {
      nodeFilesystem.rmSync(throwScratch, { force: true, recursive: true })
    }

    const failureScratch = tempRoot()
    try {
      const sessionFailure = { ok: false, host: 'codex', code: 'session-input', phase: 'initial-turn' }
      const harness = createEvaluationHarness(failureScratch, {
        onSession: (call) => call.host === 'codex' ? { failure: sessionFailure } : null,
        options: { provisionAuthentication: copyingProvision },
      })
      const evaluation = await hostBehavior.runEvaluation(harness.options)

      assert.deepEqual(evaluation.result, sessionFailure)
      assert.deepEqual(evaluation.rows, [])
      assert.deepEqual(listFilesNamed(failureScratch, 'auth.json'), [], 'a primary-result stop path removes the copied credential')
    } finally {
      nodeFilesystem.rmSync(failureScratch, { force: true, recursive: true })
    }
  })

  test('a credential-removal failure on an evaluation stop path escalates to the retained-root carrier', async () => {
    const scratch = tempRoot()
    try {
      const harness = createEvaluationHarness(scratch, {
        onLaunch: (call) => call.boundary === 'plugin-setup' && call.argv[1] === 'list'
          ? completedTuple({ stdout: JSON.stringify([{ pluginId: 'nightshift@astenlund', source: { path: join(scratch, 'wrong'), source: 'local' } }]) + '\n' })
          : null,
        options: {
          filesystem: {
            ...nodeFilesystem,
            rmSync(path, options) {
              if (String(path).endsWith('auth.json')) {
                throw new Error('synthetic removal failure')
              }

              return nodeFilesystem.rmSync(path, options)
            },
          },
          provisionAuthentication: async ({ isolatedCodexHome }) => {
            nodeFilesystem.mkdirSync(isolatedCodexHome, { recursive: true })
            nodeFilesystem.writeFileSync(join(isolatedCodexHome, 'auth.json'), '{"synthetic":"credential"}\n')

            return { copiedCredential: true, status: 'authenticated' }
          },
        },
      })
      const evaluation = await hostBehavior.runEvaluation(harness.options)

      assert.equal(evaluation.exitCode, 1)
      assert.deepEqual(evaluation.result, {
        ok: false,
        host: 'codex',
        code: 'harness-infrastructure',
        phase: 'authentication',
        initialCode: null,
        detailCode: 'cleanup',
        retainedRunRoot: harness.roots[5],
      })
      assert.deepEqual(evaluation.rows, [])
    } finally {
      nodeFilesystem.rmSync(scratch, { force: true, recursive: true })
    }
  })

  test('a dirtied fresh run root is refused rather than reused', async () => {
    const scratch = tempRoot()
    try {
      let ordinal = 0
      const harness = createEvaluationHarness(scratch, {
        createRoot: (name) => {
          ordinal += 1
          const root = join(scratch, 'roots', `${ordinal}-${name}`)
          if (ordinal === 2) {
            nodeFilesystem.mkdirSync(join(root, 'codex-arg0'), { recursive: true })
            nodeFilesystem.writeFileSync(join(root, 'codex-arg0', 'residue.txt'), 'stale residue\n')
          }

          return root
        },
      })

      await assert.rejects(hostBehavior.runEvaluation(harness.options), /must start empty/)
    } finally {
      nodeFilesystem.rmSync(scratch, { force: true, recursive: true })
    }
  })

  test('the CLI argv grammar accepts exactly the output and verification modes', () => {
    assert.deepEqual(hostBehavior.parseMainArgv(['--verify-compatibility-transition', 'a.json', 'b.json']), {
      afterPath: 'b.json',
      beforePath: 'a.json',
      mode: 'verify-compatibility-transition',
    })
    assert.deepEqual(hostBehavior.parseMainArgv(['--output', 'evidence-root']), { mode: 'output', outputRoot: 'evidence-root' })
    for (const invalid of [
      [],
      ['--output'],
      ['--output', ''],
      ['--output', '   '],
      ['--output', 'a', 'b'],
      ['--verify-compatibility-transition', 'a.json'],
      ['--verify-compatibility-transition', 'a.json', 'b.json', 'c.json'],
      ['--bogus', 'x'],
      ['output', 'dir'],
    ]) {
      assert.deepEqual(hostBehavior.parseMainArgv(invalid), { error: 'usage' }, JSON.stringify(invalid))
    }
    const stderrWrites = []
    const streams = { stderr: { write: (text) => stderrWrites.push(text) }, stdout: { write: () => {} } }
    assert.equal(hostBehavior.main(['--output'], streams), 2)
    assert.equal(hostBehavior.main(['--output', 'dir', 'extra'], streams), 2)
    assert.equal(stderrWrites.length, 2)
    assert.match(stderrWrites[0], /--output <directory>/)
  })

  test('the import probe argv pins the exact command, schema, and prompt', () => {
    assert.deepEqual(hostBehavior.buildImportProbeArgv(), [
      '--print',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-hook-events',
      '--json-schema',
      '{"additionalProperties":false,"properties":{"sentinel":{"anyOf":[{"pattern":"^[0-9a-f]{32}$","type":"string"},{"type":"null"}]}},"required":["sentinel"],"type":"object"}',
      '--tools',
      '',
      '--no-session-persistence',
      '--setting-sources',
      'project',
      'Return the 32-character sentinel stated by the loaded import-probe memory. Return null when no such memory is loaded. Do not infer a sentinel from a path.',
    ])
  })

  test('an import case materializes the adapter and imported files inside its fresh case root', async () => {
    const scratch = tempRoot()
    try {
      const caseRoot = join(scratch, 'case-alpha')
      const launches = []
      const probe = await hostBehavior.runImportCase({
        adapterBase64: Buffer.from('# CLAUDE.md\n\n@imports/alpha.md\n', 'utf8').toString('base64'),
        ambientEnvironment: {},
        argv: hostBehavior.buildImportProbeArgv(),
        caseFiles: [
          { contentBase64: Buffer.from('Import-probe memory: alpha.\n', 'utf8').toString('base64'), path: 'imports/alpha.md' },
          { contentBase64: Buffer.from('Import-probe memory: tilde.\n', 'utf8').toString('base64'), path: 'home/imports/tilde.md' },
        ],
        caseRoot,
        checkoutRoot: join(scratch, 'checkout'),
        descriptor: { argsPrefix: [], executable: join(scratch, 'bin', 'claude'), kind: 'posix-executable', logicalName: 'claude', sourcePath: join(scratch, 'bin', 'claude') },
        host: 'claude-code',
        launch: async (call) => {
          launches.push(call)

          return completedTuple({ stdout: importProbeStream(null) })
        },
        platform: process.platform,
      })

      assert.equal(launches.length, 1)
      assert.equal(nodeFilesystem.readFileSync(join(caseRoot, 'CLAUDE.md'), 'utf8'), '# CLAUDE.md\n\n@imports/alpha.md\n')
      assert.equal(nodeFilesystem.readFileSync(join(caseRoot, 'imports', 'alpha.md'), 'utf8'), 'Import-probe memory: alpha.\n')
      assert.equal(nodeFilesystem.readFileSync(join(caseRoot, 'home', 'imports', 'tilde.md'), 'utf8'), 'Import-probe memory: tilde.\n')
      assert.equal(probe.homePath, join(caseRoot, 'home'), 'the tilde overrides name the case root home child')
    } finally {
      nodeFilesystem.rmSync(scratch, { force: true, recursive: true })
    }
  })

  test('the import matrix runs every case in order, aggregates verdicts, and cleans each case root', async () => {
    const scratch = tempRoot()
    try {
      const alphaSentinel = 'a1'.repeat(16)
      const importCases = [
        { adapterBase64: Buffer.from('# CLAUDE.md\n\n@imports/a.md\n', 'utf8').toString('base64'), caseId: 'alpha', expectedSentinel: alphaSentinel, files: [{ contentBase64: Buffer.from(`Import-probe memory: ${alphaSentinel}.\n`, 'utf8').toString('base64'), path: 'imports/a.md' }] },
        { adapterBase64: Buffer.from('# CLAUDE.md\n\n`@imports/b.md`\n', 'utf8').toString('base64'), caseId: 'beta', expectedSentinel: null, files: [{ contentBase64: Buffer.from('Import-probe memory: hidden.\n', 'utf8').toString('base64'), path: 'imports/b.md' }] },
      ]
      const roots = []
      let ordinal = 0
      const createRoot = (name) => {
        ordinal += 1
        const root = join(scratch, 'roots', `${ordinal}-${name}`)
        roots.push(root)

        return root
      }
      const launches = []
      const runMatrix = (launch) => hostBehavior.runImportMatrix({
        ambientEnvironment: {},
        checkoutRoot: join(scratch, 'checkout'),
        createRoot,
        descriptor: { argsPrefix: [], executable: join(scratch, 'bin', 'claude'), kind: 'posix-executable', logicalName: 'claude', sourcePath: join(scratch, 'bin', 'claude') },
        importCases,
        launch,
        platform: process.platform,
      })
      const passing = await runMatrix(async (call) => {
        launches.push(call)
        const caseId = nodePath.basename(call.cwd).replace(/^\d+-import-/, '')

        return completedTuple({ stdout: importProbeStream(caseId === 'alpha' ? alphaSentinel : null) })
      })

      assert.deepEqual(passing, { passed: true, verdicts: [{ caseId: 'alpha', passed: true }, { caseId: 'beta', passed: true }] })
      assert.equal(launches.length, 2)
      for (const call of launches) {
        assert.deepEqual(call.argv, hostBehavior.buildImportProbeArgv())
        assert.equal(call.boundary, 'import-probe')
        assert.equal(call.environment.TEMP, join(call.cwd, 'host-temp'))
      }
      for (const root of roots) {
        assert.equal(nodeFilesystem.existsSync(root), false, 'every import case root is removed and absence-verified')
      }

      const failing = await runMatrix(async () => completedTuple({ stdout: importProbeStream('f0'.repeat(16)) }))
      assert.equal(failing.passed, false)
      assert.deepEqual(failing.verdicts.map((verdict) => verdict.passed), [false, false])
      assert.equal(failing.verdicts[1].reason, 'structured-output-mismatch')

      const supervised = await runMatrix(async () => ({ failure: { code: 'preflight-timeout', host: 'claude-code', ok: false, phase: 'import-probe' } }))
      assert.deepEqual(supervised.failure, { code: 'preflight-timeout', host: 'claude-code', ok: false, phase: 'import-probe' })
    } finally {
      nodeFilesystem.rmSync(scratch, { force: true, recursive: true })
    }
  })

  test('the enabled plugin root replaces the controller entry with the proxy client and digests its manifest', () => {
    const scratch = tempRoot()
    try {
      const checkoutRoot = join(scratch, 'checkout')
      const write = (relativePath, text) => {
        const target = join(checkoutRoot, ...relativePath.split('/'))
        nodeFilesystem.mkdirSync(nodePath.dirname(target), { recursive: true })
        nodeFilesystem.writeFileSync(target, text)
      }
      write('.claude-plugin/plugin.json', '{"name":"nightshift","version":"0.0.0"}\n')
      write('.claude-plugin/marketplace.json', '{}\n')
      write('skills/init-backlog/init-backlog.js', 'production controller entry\n')
      write('skills/init-backlog/lib/util.js', 'library module\n')
      write('skills/init-backlog/templates/features.md', 'feature template\n')
      write('skills/init-backlog/templates/manifest.json', '{}\n')
      write('internal/notes.md', 'internal file\n')
      write('hooks/hook.js', 'hook file\n')
      const proxyClientPath = join(scratch, 'controller-proxy.js')
      nodeFilesystem.writeFileSync(proxyClientPath, 'fixed proxy client\n')
      const runPluginRoot = join(scratch, 'enabled-plugin')
      nodeFilesystem.mkdirSync(runPluginRoot)
      const manifestPath = join(scratch, 'run-plugin-manifest.json')
      const built = hostBehavior.buildEnabledPluginRoot({
        checkoutRoot,
        controllerEntryPath: join(checkoutRoot, 'skills', 'init-backlog', 'init-backlog.js'),
        manifestPath,
        proxyClientPath,
        runPluginRoot,
      })

      assert.equal(nodeFilesystem.readFileSync(join(runPluginRoot, 'skills', 'init-backlog', 'init-backlog.js'), 'utf8'), 'fixed proxy client\n')
      assert.equal(nodeFilesystem.readFileSync(join(runPluginRoot, 'internal', 'notes.md'), 'utf8'), 'internal file\n')
      assert.equal(nodeFilesystem.readFileSync(join(runPluginRoot, 'hooks', 'hook.js'), 'utf8'), 'hook file\n')
      const manifest = built.manifest
      assert.deepEqual(Object.keys(manifest).sort(), ['controllerRuntimeSha256', 'files', 'schemaVersion'])
      assert.equal(manifest.schemaVersion, 1)
      const paths = manifest.files.map((file) => file.path)
      assert.deepEqual(paths, [...paths].sort(), 'manifest file paths are ordinal sorted')
      const entryItem = manifest.files.find((file) => file.path === 'skills/init-backlog/init-backlog.js')
      assert.equal(entryItem.role, 'controller-proxy')
      assert.equal(entryItem.sourceSha256, sha256(Buffer.from('production controller entry\n', 'utf8')))
      assert.equal(entryItem.installedSha256, sha256(Buffer.from('fixed proxy client\n', 'utf8')))
      for (const item of manifest.files.filter((file) => file.path !== 'skills/init-backlog/init-backlog.js')) {
        assert.equal(item.role, 'exact')
        assert.equal(item.sourceSha256, item.installedSha256)
      }
      assert.equal(built.runPluginRootDigest, sha256(Buffer.from(canonicalJson(manifest), 'utf8')))
      assert.deepEqual(nodeFilesystem.readFileSync(manifestPath), Buffer.from(canonicalJson(manifest) + '\n', 'utf8'))
    } finally {
      nodeFilesystem.rmSync(scratch, { force: true, recursive: true })
    }
  })

  test('the disabled plugin root copies only the baseline manifest files and refuses a controller entry', () => {
    const scratch = tempRoot()
    try {
      const baselineRoot = join(scratch, 'baseline')
      nodeFilesystem.mkdirSync(join(baselineRoot, 'skills'), { recursive: true })
      const bytes = Buffer.from('baseline skill file\n', 'utf8')
      nodeFilesystem.writeFileSync(join(baselineRoot, 'skills', 'ready.md'), bytes)
      const baselineManifest = { files: [{ path: 'skills/ready.md', sha256: sha256(bytes) }], schemaVersion: 1, sourceCommit: 'f'.repeat(40) }
      const disabledRunPluginRoot = join(scratch, 'disabled-plugin')
      nodeFilesystem.mkdirSync(disabledRunPluginRoot)
      const built = hostBehavior.buildDisabledPluginRoot({
        baselineManifest,
        baselineRoot,
        disabledRunPluginRoot,
        manifestPath: join(scratch, 'disabled-plugin-manifest.json'),
      })

      assert.equal(built.runPluginRootDigest, null, 'a disabled row carries a null run plugin root digest')
      assert.deepEqual(nodeFilesystem.readFileSync(join(disabledRunPluginRoot, 'skills', 'ready.md')), bytes)
      assert.equal(nodeFilesystem.existsSync(join(disabledRunPluginRoot, 'skills', 'init-backlog', 'init-backlog.js')), false)
      assert.throws(() => hostBehavior.buildDisabledPluginRoot({
        baselineManifest: { files: [{ path: 'skills/init-backlog/init-backlog.js', sha256: sha256(bytes) }], schemaVersion: 1, sourceCommit: 'f'.repeat(40) },
        baselineRoot,
        disabledRunPluginRoot: join(scratch, 'other-disabled'),
        manifestPath: join(scratch, 'other-manifest.json'),
      }), /controller entry/)
    } finally {
      nodeFilesystem.rmSync(scratch, { force: true, recursive: true })
    }
  })

  test('the apply-call recorder captures the transcript watermark at apply admission', () => {
    const verdicts = [
      { ok: false, reason: 'order' },
      { ok: true, operation: 'inspect' },
      { ok: true, operation: 'apply' },
    ]
    let authorized = 0
    const gate = {
      admit: () => verdicts.shift(),
      authorizeInspect: () => {
        authorized += 1
      },
    }
    let transcriptCount = 5
    const recorder = hostBehavior.createApplyCallRecorder({ gate, transcriptOrdinal: () => transcriptCount })

    assert.equal(recorder.gate.admit(Buffer.from('x')).ok, false)
    assert.deepEqual(recorder.applyCalls, [], 'a rejected admission records nothing')
    assert.deepEqual(recorder.gate.admit(Buffer.from('x')), { ok: true, operation: 'inspect' })
    transcriptCount = 9
    assert.deepEqual(recorder.gate.admit(Buffer.from('x')), { ok: true, operation: 'apply' })
    assert.deepEqual(recorder.applyCalls, [{ proxyOrdinal: 2, transcriptWatermark: 9 }], 'the apply call pairs its proxy ordinal with the admission-time transcript watermark')
    recorder.gate.authorizeInspect()
    assert.equal(authorized, 1, 'non-admit gate methods pass through')
    assert.throws(() => hostBehavior.createApplyCallRecorder({ gate }), /transcript ordinal/)
  })

  test('writer-window codes are pre-filtered to the qualifying window before derivation', () => {
    const turnRecords = [
      { disclosureCodes: ['external-writer-window'], ordinal: 1 },
      { disclosureCodes: [], ordinal: 2 },
      { disclosureCodes: ['external-writer-window'], ordinal: 3 },
      { disclosureCodes: ['external-writer-window'], ordinal: 5 },
    ]

    assert.deepEqual(hostBehavior.collectQualifyingWriterCodes({ applyRequestWatermark: 4, inspectWatermark: 2, turnRecords }), ['external-writer-window'])
    assert.deepEqual(hostBehavior.collectQualifyingWriterCodes({ applyRequestWatermark: null, inspectWatermark: 2, turnRecords }), ['external-writer-window', 'external-writer-window'])
    assert.deepEqual(hostBehavior.collectQualifyingWriterCodes({ applyRequestWatermark: 4, inspectWatermark: 0, turnRecords }), ['external-writer-window', 'external-writer-window'])
    assert.throws(() => hostBehavior.collectQualifyingWriterCodes({ inspectWatermark: -1, turnRecords }), /inspectWatermark/)
    assert.throws(() => hostBehavior.collectQualifyingWriterCodes({ inspectWatermark: 0, turnRecords: [{ ordinal: 0, disclosureCodes: [] }] }), /turn record/)
  })

  test('verifiedLoadedMemory derives from the host system-init memory_paths record', () => {
    assert.equal(hostBehavior.deriveVerifiedLoadedMemory({
      initEvent: { memory_paths: ['/run/scenario/CLAUDE.md'], subtype: 'init', type: 'system' },
      platform: 'linux',
      scenarioRoot: '/run/scenario',
    }), true)
    assert.equal(hostBehavior.deriveVerifiedLoadedMemory({
      initEvent: { memory_paths: ['C:\\Run\\Scenario\\claude.md'], subtype: 'init', type: 'system' },
      platform: 'win32',
      scenarioRoot: 'C:\\run\\scenario',
    }), true, 'Windows path comparison is case-insensitive')
    assert.equal(hostBehavior.deriveVerifiedLoadedMemory({
      initEvent: { memory_paths: ['/other/CLAUDE.md'], subtype: 'init', type: 'system' },
      platform: 'linux',
      scenarioRoot: '/run/scenario',
    }), false)
    assert.equal(hostBehavior.deriveVerifiedLoadedMemory({ initEvent: { subtype: 'init', type: 'system' }, platform: 'linux', scenarioRoot: '/run/scenario' }), false)
    assert.equal(hostBehavior.deriveVerifiedLoadedMemory({ initEvent: null, platform: 'linux', scenarioRoot: '/run/scenario' }), false)
  })

  test('the evaluation resolves the trusted git once with nonempty protected roots and threads it to the scenario runner wiring', async () => {
    const suffix = process.platform === 'win32' ? '.exe' : ''
    const outsideDirectory = process.platform === 'win32' ? 'C:\\trusted\\git-bin' : '/trusted/git-bin'
    const outsideGit = join(outsideDirectory, `git${suffix}`)
    const delimiter = process.platform === 'win32' ? ';' : ':'

    const acceptedScratch = tempRoot()
    try {
      const protectedGitDirectory = join(acceptedScratch, 'protected-output', 'git-bin')
      const protectedGitAlias = join(acceptedScratch, 'protected-git-alias')
      const harness = createEvaluationHarness(acceptedScratch, {
        options: {
          commandFilesystem: fakeCommandFilesystem({
            [outsideDirectory]: { kind: 'dir' },
            [outsideGit]: { kind: 'file' },
            [protectedGitAlias]: { kind: 'link', target: protectedGitDirectory },
            [protectedGitDirectory]: { kind: 'dir' },
            [join(protectedGitDirectory, `git${suffix}`)]: { kind: 'file' },
          }),
          protectedRoots: [join(acceptedScratch, 'checkout'), join(acceptedScratch, 'protected-output')],
          runGitFactory: null,
        },
      })
      harness.options.ambientEnvironment.PATH = harness.options.ambientEnvironment.PATH + delimiter + protectedGitAlias + delimiter + protectedGitDirectory + delimiter + outsideDirectory
      const evaluation = await hostBehavior.runEvaluation(harness.options)

      assert.equal(evaluation.result, null)
      assert.equal(evaluation.trustedGitExecutable, outsideGit, 'the resolved trusted git is retained for every scenario git runner')
      for (const call of harness.launches.filter((launch) => launch.boundary === 'worker')) {
        assert.equal(call.environment.PATH.split(delimiter).includes(protectedGitDirectory), false, 'the worker cannot re-resolve git below a protected root')
        assert.equal(call.environment.PATH.split(delimiter).includes(protectedGitAlias), false, 'the worker cannot retain an alias into a protected root')
      }
    } finally {
      nodeFilesystem.rmSync(acceptedScratch, { force: true, recursive: true })
    }

    const rejectedScratch = tempRoot()
    try {
      const checkoutRoot = join(rejectedScratch, 'checkout')
      const checkoutGitDirectory = join(checkoutRoot, 'git-bin')
      const harness = createEvaluationHarness(rejectedScratch, {
        options: {
          commandFilesystem: fakeCommandFilesystem({ [checkoutGitDirectory]: { kind: 'dir' }, [join(checkoutGitDirectory, `git${suffix}`)]: { kind: 'file' } }),
          protectedRoots: [checkoutRoot],
          runGitFactory: null,
        },
      })
      harness.options.ambientEnvironment.PATH = harness.options.ambientEnvironment.PATH + delimiter + checkoutGitDirectory
      const evaluation = await hostBehavior.runEvaluation(harness.options)

      assert.deepEqual(evaluation.result, {
        ok: false,
        host: 'claude-code',
        code: 'harness-infrastructure',
        phase: 'version',
        initialCode: null,
        detailCode: 'containment-unavailable',
        retainedRunRoot: null,
      }, 'a checkout-resident git is a preflight-class trusted-executable failure')
      assert.deepEqual(evaluation.rows, [])
      assert.equal(harness.launches.length, 0, 'trusted-git resolution fails before any launch')
    } finally {
      nodeFilesystem.rmSync(rejectedScratch, { force: true, recursive: true })
    }
  })

  test('a live-session transcript admission failure fixes the output-capacity carrier, closes proxy admission, and terminates host and worker exactly once', async () => {
    const token = 'f'.repeat(64)
    const runRoot = 'synthetic-transcript-run-root'
    let workerTerminations = 0
    const workerEntry = {
      adapter: closedWorkerAdapter({ onTerminate: () => { workerTerminations += 1 } }),
      onLine: null,
      ready: true,
    }
    const proxyEntry = { server: null, tcpServer: null, token }
    // The first failing append is the initial-prompt input; the host event
    // emitted after settlement is a second admission failure that must not
    // restart terminations or re-close admission.
    const processAdapterFactory = fakeSessionAdapterFactory({
      onStart: ({ options }) => {
        options.onHostStdout(hostEventLine({ subtype: 'noise', type: 'system-noise' }))
      },
    })
    const session = await hostBehavior.runLiveHostSession({
      call: {
        argv: ['--print'],
        controllerEnabled: true,
        cwd: 'synthetic-scenario-root',
        environment: {},
        executable: 'claude-executable',
        host: 'claude-code',
        proxySession: { port: 40100, token },
        runRoot,
        scenario: sessionScenario(),
        sessionPluginRoot: 'synthetic-plugin-root',
        turnSchemaRunPath: 'synthetic-turn-schema-path',
      },
      filesystem: nodeFilesystem,
      platform: 'win32',
      processAdapterFactory,
      proxyRegistry: new Map([[token, proxyEntry]]),
      transcriptFactory: () => transcriptWithFailingAppends(['appendHostEvent', 'appendInput']),
      workerRegistry: new Map([[runRoot, workerEntry]]),
    })

    assert.deepEqual(session, {
      failure: {
        ok: false,
        host: 'claude-code',
        code: 'harness-infrastructure',
        phase: 'initial-turn',
        initialCode: null,
        detailCode: 'output-capacity',
        retainedRunRoot: runRoot,
      },
    })
    assert.equal(proxyEntry.server.admissionOpen(), false, 'the first admission failure closes proxy admission')
    await new Promise((resolveDelay) => setImmediate(resolveDelay))
    await new Promise((resolveDelay) => setImmediate(resolveDelay))
    assert.equal(processAdapterFactory.created.length, 1)
    assert.equal(processAdapterFactory.created[0].state.terminations, 1, 'host termination starts exactly once across repeated admission failures')
    assert.equal(workerTerminations, 1, 'worker termination starts exactly once across repeated admission failures')
  })

  test('live process, proxy, and post-ready worker failures preserve their infrastructure identity and publish no evidence', async () => {
    const tokens = { process: 'c'.repeat(64), proxy: 'd'.repeat(64), worker: 'e'.repeat(64), 'worker-exit': 'f'.repeat(64) }
    for (const source of ['process', 'proxy', 'worker', 'worker-exit']) {
      const token = tokens[source]
      const runRoot = `synthetic-${source}-failure-run-root`
      const workerEntry = {
        adapter: closedWorkerAdapter({ exitCode: source === 'worker-exit' ? 7 : 0 }),
        onFailure: null,
        onLine: null,
        ready: true,
      }
      const proxyEntry = { server: null, tcpServer: null, token }
      const processAdapterFactory = fakeSessionAdapterFactory({
        onStart: ({ options, state }) => {
          if (source === 'process') {
            options.onFailure({ detailCode: 'child-process' })
          } else if (source === 'proxy') {
            const connection = { end() {}, write() { return true } }
            proxyEntry.server.handleConnection(connection)
            proxyEntry.server.receiveData(connection, Buffer.from(canonicalJson({ requestBase64: Buffer.from('{}', 'utf8').toString('base64'), token: '0'.repeat(64) }) + '\n', 'utf8'))
          } else if (source === 'worker') {
            workerEntry.onFailure?.({ detailCode: 'child-process' })
          }
          state.closed = true
          state.exitCode = 0
          state.proven = true
        },
      })
      const session = await hostBehavior.runLiveHostSession({
        call: {
          argv: ['--print'],
          controllerEnabled: source !== 'process',
          cwd: `synthetic-${source}-scenario-root`,
          environment: {},
          executable: 'claude-executable',
          host: 'claude-code',
          proxySession: { port: 40101, token },
          runRoot,
          scenario: sessionScenario(),
          sessionPluginRoot: 'synthetic-plugin-root',
          turnSchemaRunPath: 'synthetic-turn-schema-path',
        },
        filesystem: nodeFilesystem,
        platform: 'win32',
        processAdapterFactory,
        proxyRegistry: source === 'process' ? new Map() : new Map([[token, proxyEntry]]),
        workerRegistry: source === 'process' ? new Map() : new Map([[runRoot, workerEntry]]),
      })

      assert.deepEqual(session, {
        failure: {
          ok: false,
          host: 'claude-code',
          code: 'harness-infrastructure',
          phase: 'initial-turn',
          initialCode: null,
          detailCode: source === 'proxy' ? 'proxy-authorization' : 'child-process',
          retainedRunRoot: runRoot,
        },
      }, source)
    }
  })

  test('a mid-session transcript admission failure records the output-capacity infrastructure failure with no row and no evidence leaf', async () => {
    const scratch = tempRoot()
    try {
      const evidenceOutputRoot = join(scratch, 'evidence')
      nodeFilesystem.mkdirSync(evidenceOutputRoot, { recursive: true })
      const sessionCalls = []
      const processAdapterFactory = fakeSessionAdapterFactory({
        onStart: ({ options }) => {
          options.onHostStdout(hostEventLine({ subtype: 'noise', type: 'assistant-noise' }))
        },
      })
      const harness = createEvaluationHarness(scratch, {
        options: {
          evidenceOutputRoot,
          runSession: (call) => {
            sessionCalls.push(call)

            return hostBehavior.runLiveHostSession({
              call,
              filesystem: nodeFilesystem,
              platform: 'win32',
              processAdapterFactory,
              proxyRegistry: new Map(),
              transcriptFactory: () => transcriptWithFailingAppends(['appendHostEvent']),
              workerRegistry: new Map(),
            })
          },
          scenarios: [sessionScenario()],
        },
      })
      const evaluation = await hostBehavior.runEvaluation(harness.options)

      assert.equal(evaluation.exitCode, 1)
      assert.equal(sessionCalls.length, 1, 'the first failing session stops the evaluation')
      assert.deepEqual(evaluation.result, {
        ok: false,
        host: 'claude-code',
        code: 'harness-infrastructure',
        phase: 'initial-turn',
        initialCode: null,
        detailCode: 'output-capacity',
        retainedRunRoot: sessionCalls[0].runRoot,
      })
      assert.deepEqual(evaluation.resultLine, hostBehavior.formatResultLine(evaluation.result))
      assert.deepEqual(evaluation.rows, [], 'a transcript admission failure publishes no row')
      assert.equal(evaluation.summary, null)
      assert.deepEqual(evaluation.evidenceManifests, [])
      assert.deepEqual(listFilesNamed(evidenceOutputRoot, 'manifest.json'), [], 'no final evidence leaf is published')
      assert.equal(nodeFilesystem.existsSync(sessionCalls[0].runRoot), true, 'the failed repetition run root is retained')
    } finally {
      nodeFilesystem.rmSync(scratch, { force: true, recursive: true })
    }
  })

  test('the writer-window false-pass channel is closed: a failing structured-output append yields the capacity carrier, never a row', async () => {
    const sessionPluginRoot = 'synthetic-disabled-plugin-root'
    // With windowExpected false for this disabled run, dropping this turn
    // from the transcript used to let deriveWriterDisclosure read true.
    const turn = {
      gateId: 'action-disclosure',
      phase: 'awaiting-response',
      presentation: { actionDisclosures: [], ambiguityIds: [], disclosureCodes: ['external-writer-window'], manifestProposal: null },
      semanticClassifications: [],
    }
    const processAdapterFactory = fakeSessionAdapterFactory({
      onStart: ({ options }) => {
        options.onHostStdout(Buffer.concat([
          hostEventLine(claudeInitEvent(sessionPluginRoot)),
          hostEventLine({ structured_output: turn, subtype: 'success', type: 'result' }),
        ]))
      },
    })
    const session = await hostBehavior.runLiveHostSession({
      call: {
        argv: ['--print'],
        controllerEnabled: false,
        cwd: 'synthetic-scenario-root',
        environment: {},
        executable: 'claude-executable',
        host: 'claude-code',
        proxySession: null,
        runRoot: 'synthetic-disabled-run-root',
        scenario: sessionScenario(),
        sessionPluginRoot,
        turnSchemaRunPath: 'synthetic-turn-schema-path',
      },
      filesystem: nodeFilesystem,
      platform: 'win32',
      processAdapterFactory,
      proxyRegistry: new Map(),
      transcriptFactory: () => transcriptWithFailingAppends(['appendStructuredOutput']),
      workerRegistry: new Map(),
    })

    assert.equal(session.record, undefined, 'the dropped turn can no longer flow into a session record')
    assert.deepEqual(session, {
      failure: {
        ok: false,
        host: 'claude-code',
        code: 'harness-infrastructure',
        phase: 'initial-turn',
        initialCode: null,
        detailCode: 'output-capacity',
        retainedRunRoot: 'synthetic-disabled-run-root',
      },
    })
    assert.equal(processAdapterFactory.created[0].state.terminations, 1)
  })

  test('a codex turn whose structured-output append fails stops the session with the output-capacity carrier', async () => {
    const scratch = tempRoot()
    try {
      const runRoot = join(scratch, 'run-root')
      nodeFilesystem.mkdirSync(runRoot, { recursive: true })
      const turn = {
        gateId: 'host-context-confirmation',
        phase: 'awaiting-response',
        presentation: { actionDisclosures: [], ambiguityIds: [], disclosureCodes: [], manifestProposal: null },
        semanticClassifications: [],
      }
      nodeFilesystem.writeFileSync(join(runRoot, 'turn-output.json'), Buffer.from(canonicalJson(turn), 'utf8'))
      const processAdapterFactory = fakeSessionAdapterFactory({
        onStart: ({ options, state }) => {
          options.onHostStdout(Buffer.concat([
            hostEventLine({ thread_id: 'thread-1', type: 'thread.started' }),
            hostEventLine({ item: { text: JSON.stringify(turn), type: 'agent_message' }, type: 'item.completed' }),
          ]))
          state.closed = true
          state.exitCode = 0
          state.proven = true
        },
      })
      const session = await hostBehavior.runLiveHostSession({
        call: {
          argv: ['exec', '--json'],
          controllerEnabled: false,
          cwd: join(scratch, 'scenario'),
          environment: {},
          executable: 'codex-executable',
          host: 'codex',
          proxySession: null,
          runRoot,
          scenario: sessionScenario(),
          sessionPluginRoot: 'synthetic-plugin-root',
          turnSchemaRunPath: 'synthetic-turn-schema-path',
        },
        filesystem: nodeFilesystem,
        platform: 'win32',
        processAdapterFactory,
        proxyRegistry: new Map(),
        transcriptFactory: () => transcriptWithFailingAppends(['appendStructuredOutput']),
        workerRegistry: new Map(),
      })

      assert.deepEqual(session, {
        failure: {
          ok: false,
          host: 'codex',
          code: 'harness-infrastructure',
          phase: 'initial-turn',
          initialCode: null,
          detailCode: 'output-capacity',
          retainedRunRoot: runRoot,
        },
      })
      assert.equal(processAdapterFactory.created[0].state.terminations, 1)
    } finally {
      nodeFilesystem.rmSync(scratch, { force: true, recursive: true })
    }
  })

  // The bounded timeout keeps a natural-closure regression (an unsettled
  // session promise, as the callbackless proxy close produced) a failure
  // instead of a suite hang.
  test('an enabled live session reaches natural closure through the callback-bearing proxy close and produces a record', { timeout: 30000 }, async () => {
    const token = 'a'.repeat(64)
    const runRoot = 'synthetic-natural-run-root'
    const sessionPluginRoot = 'synthetic-natural-plugin-root'
    // Present-root Claude with an init event carrying no memory_paths walks
    // straight to context-stopped, so the finished context-stop turn
    // completes the walk deterministically without the inspect dance.
    const scenario = sessionScenario()
    scenario.repository = {
      ...scenario.repository,
      entries: [...scenario.repository.entries, { contentBase64: Buffer.from('# Scenario root instructions\n', 'utf8').toString('base64'), kind: 'file', mode: 420, path: 'CLAUDE.md' }],
    }
    const finishedTurn = {
      gateId: null,
      phase: 'finished',
      presentation: { actionDisclosures: [], ambiguityIds: [], disclosureCodes: [], manifestProposal: null, result: { approvalBranch: 'unavailable', reasonCode: 'guidance-resolution' } },
      semanticClassifications: [],
    }
    const workerEntry = {
      adapter: closedWorkerAdapter(),
      onLine: null,
      ready: true,
    }
    const proxyEntry = { server: null, tcpServer: null, token }
    const processAdapterFactory = fakeSessionAdapterFactory({
      onStart: ({ options, state }) => {
        options.onHostStdout(Buffer.concat([
          hostEventLine(claudeInitEvent(sessionPluginRoot)),
          hostEventLine({ structured_output: finishedTurn, subtype: 'success', type: 'result' }),
        ]))
        state.closed = true
        state.exitCode = 0
        state.proven = true
      },
    })
    const session = await hostBehavior.runLiveHostSession({
      call: {
        argv: ['--print'],
        controllerEnabled: true,
        cwd: 'synthetic-natural-scenario-root',
        environment: {},
        executable: 'claude-executable',
        host: 'claude-code',
        proxySession: { port: 40200, token },
        runRoot,
        scenario,
        sessionPluginRoot,
        turnSchemaRunPath: 'synthetic-turn-schema-path',
      },
      filesystem: nodeFilesystem,
      platform: 'win32',
      processAdapterFactory,
      proxyRegistry: new Map([[token, proxyEntry]]),
      workerRegistry: new Map([[runRoot, workerEntry]]),
    })

    assert.equal(session.failure, undefined, 'natural closure settles the session with a record, not a failure')
    assert.equal(session.record.terminationProven, true, 'the settle path proves closure through verifiedClosure and the worker runner')
    assert.equal(proxyEntry.server.verifiedClosure(), true, 'the callback-bearing close marks verified proxy closure')
    assert.deepEqual(session.evidence.map((file) => file.path), ['transcript.jsonl', 'proxy-trace.jsonl'])
    assert.equal(processAdapterFactory.created[0].state.terminations, 0, 'a natural closure starts no termination')
  })

  test('a slow-closing worker never re-enters the exactly-once proxy close on the natural-closure path', { timeout: 30000 }, async () => {
    const token = 'b'.repeat(64)
    const runRoot = 'synthetic-slow-worker-run-root'
    const sessionPluginRoot = 'synthetic-slow-worker-plugin-root'
    const scenario = sessionScenario()
    scenario.repository = {
      ...scenario.repository,
      entries: [...scenario.repository.entries, { contentBase64: Buffer.from('# Scenario root instructions\n', 'utf8').toString('base64'), kind: 'file', mode: 420, path: 'CLAUDE.md' }],
    }
    const finishedTurn = {
      gateId: null,
      phase: 'finished',
      presentation: { actionDisclosures: [], ambiguityIds: [], disclosureCodes: [], manifestProposal: null, result: { approvalBranch: 'unavailable', reasonCode: 'guidance-resolution' } },
      semanticClassifications: [],
    }
    // The worker reports closed only 250 ms after closeInput, several poll
    // intervals past the first finish entry, so settleEnabledClosure stays in
    // flight across ticks; a re-entered finish would hit the proxy server's
    // exactly-once close throw as an unhandled rejection.
    let workerClosed = false
    let workerTerminations = 0
    const workerEntry = {
      adapter: {
        closeInput: () => {
          setTimeout(() => {
            workerClosed = true
          }, 250)
        },
        closureProof: () => ({ proven: true }),
        hostExitCode: () => 0,
        input: () => ({ ok: true }),
        runnerClosed: () => workerClosed,
        terminate: () => {
          workerTerminations += 1
        },
      },
      onLine: null,
      ready: true,
    }
    const proxyEntry = { server: null, tcpServer: null, token }
    const processAdapterFactory = fakeSessionAdapterFactory({
      onStart: ({ options, state }) => {
        options.onHostStdout(Buffer.concat([
          hostEventLine(claudeInitEvent(sessionPluginRoot)),
          hostEventLine({ structured_output: finishedTurn, subtype: 'success', type: 'result' }),
        ]))
        state.closed = true
        state.exitCode = 0
        state.proven = true
      },
    })
    const session = await hostBehavior.runLiveHostSession({
      call: {
        argv: ['--print'],
        controllerEnabled: true,
        cwd: 'synthetic-slow-worker-scenario-root',
        environment: {},
        executable: 'claude-executable',
        host: 'claude-code',
        proxySession: { port: 40300, token },
        runRoot,
        scenario,
        sessionPluginRoot,
        turnSchemaRunPath: 'synthetic-turn-schema-path',
      },
      filesystem: nodeFilesystem,
      platform: 'win32',
      processAdapterFactory,
      proxyRegistry: new Map([[token, proxyEntry]]),
      workerRegistry: new Map([[runRoot, workerEntry]]),
    })

    // The real proxy server throws on any second close, so a clean settle
    // proves at most one close and verifiedClosure() proves at least one:
    // together, exactly once.
    assert.equal(session.failure, undefined, 'the slow-worker natural closure settles cleanly with no unhandled rejection')
    assert.equal(session.record.terminationProven, true, 'closure is proven once the worker reports closed')
    assert.equal(proxyEntry.server.verifiedClosure(), true, 'proxy closure verified through the single close')
    assert.equal(workerClosed, true, 'the settle waited for the delayed worker closure')
    assert.equal(workerTerminations, 0, 'a within-deadline worker closure needs no termination')
    assert.equal(processAdapterFactory.created[0].state.terminations, 0, 'a natural closure starts no host termination')
  })

  test('the assembled CLI output mode runs the import matrix first and publishes evidence, summary, and the canonical table', async () => {
    const scratch = tempRoot()
    try {
      const alphaSentinel = 'a1'.repeat(16)
      const importSentinels = new Map([['alpha', alphaSentinel], ['beta', null]])
      const harness = createEvaluationHarness(scratch, { importSentinels })
      const scenarioB = syntheticScenario('synthetic-host-entry-b')
      const outputRoot = join(scratch, 'evidence')
      const stdoutWrites = []
      const stderrWrites = []
      const overrides = {
        ambientEnvironment: harness.options.ambientEnvironment,
        checkoutRoot: harness.options.checkoutRoot,
        controllerEntryPath: harness.options.controllerEntryPath,
        controllerWorkerPath: harness.options.controllerWorkerPath,
        descriptors: harness.options.descriptors,
        fixtures: {
          baselineManifestSha256: 'a'.repeat(64),
          importCases: [
            { adapterBase64: Buffer.from('# CLAUDE.md\n\n@imports/a.md\n', 'utf8').toString('base64'), caseId: 'alpha', expectedSentinel: alphaSentinel, files: [{ contentBase64: Buffer.from(`Import-probe memory: ${alphaSentinel}.\n`, 'utf8').toString('base64'), path: 'imports/a.md' }] },
            { adapterBase64: Buffer.from('# CLAUDE.md\n\n`@imports/b.md`\n', 'utf8').toString('base64'), caseId: 'beta', expectedSentinel: null, files: [{ contentBase64: Buffer.from('Import-probe memory: hidden.\n', 'utf8').toString('base64'), path: 'imports/b.md' }] },
          ],
          scenarioManifestSha256: 'b'.repeat(64),
          scenarios: [harness.scenario, scenarioB],
        },
        homeDirectory: harness.options.homeDirectory,
        launch: harness.options.launch,
        preparePluginRoot: harness.options.preparePluginRoot,
        proxySessionFactory: harness.options.proxySessionFactory,
        runGitFactory: harness.options.runGitFactory,
        runSession: harness.options.runSession,
        turnSchemaJson: harness.options.turnSchemaJson,
      }
      const exitCode = await hostBehavior.main(['--output', outputRoot], {
        evaluationOverrides: overrides,
        stderr: { write: (text) => stderrWrites.push(text) },
        stdout: { write: (text) => stdoutWrites.push(String(text)) },
      })

      assert.equal(exitCode, 0)
      assert.deepEqual(stderrWrites, [])
      const importReport = JSON.parse(nodeFilesystem.readFileSync(join(outputRoot, 'import-matrix.json'), 'utf8'))
      assert.deepEqual(importReport, { passed: true, verdicts: [{ caseId: 'alpha', passed: true }, { caseId: 'beta', passed: true }] })
      const importOrdinal = harness.launches.findIndex((call) => call.boundary === 'import-probe')
      const versionOrdinal = harness.launches.findIndex((call) => call.boundary === 'version')
      assert.ok(importOrdinal !== -1 && versionOrdinal !== -1 && importOrdinal < versionOrdinal, 'the import matrix runs before the behavioral matrix')
      const rows = JSON.parse(stdoutWrites[stdoutWrites.length - 1])
      assert.equal(rows.length, 8, 'two hosts times two scenarios times two modes')
      assert.deepEqual(rows.map((row) => [row.host, row.scenario, row.controllerEnabled, row.repetitions]), [
        ['claude-code', 'synthetic-host-entry', false, 1],
        ['claude-code', 'synthetic-host-entry', true, 3],
        ['claude-code', 'synthetic-host-entry-b', false, 1],
        ['claude-code', 'synthetic-host-entry-b', true, 3],
        ['codex', 'synthetic-host-entry', false, 1],
        ['codex', 'synthetic-host-entry', true, 3],
        ['codex', 'synthetic-host-entry-b', false, 1],
        ['codex', 'synthetic-host-entry-b', true, 3],
      ])
      assert.equal(rows.every((row) => row.passed === true), true)
      const summary = JSON.parse(nodeFilesystem.readFileSync(join(outputRoot, 'summary.json'), 'utf8'))
      assert.equal(summary.rows.length, 8)
      assert.equal(summary.evidenceManifests.length, 16, 'one evidence leaf per behavioral repetition')
      for (const manifestEntry of summary.evidenceManifests) {
        assert.match(manifestEntry.evidenceManifestSha256, HEX64)
        const leafManifestPath = join(outputRoot, manifestEntry.host, manifestEntry.scenario, manifestEntry.mode, String(manifestEntry.repetition), 'manifest.json')
        assert.equal(nodeFilesystem.existsSync(leafManifestPath), true, `evidence leaf manifest exists: ${leafManifestPath}`)
        assert.equal(nodeFilesystem.existsSync(join(nodePath.dirname(leafManifestPath), 'repository-attestation.json')), true)
      }
      assert.equal(harness.sessions.length, 16, 'each repetition ran exactly one session through the injected adapter')
    } finally {
      nodeFilesystem.rmSync(scratch, { force: true, recursive: true })
    }
  })

  test('output-root aliases protect executables in their physical targets from PATH resolution', async (t) => {
    if (process.platform !== 'win32') {
      t.skip('junction containment is a Windows-only live boundary')

      return
    }
    const scratch = tempRoot()
    try {
      for (const aliasKind of ['direct', 'parent']) {
        const caseRoot = join(scratch, aliasKind)
        const physicalParent = join(caseRoot, 'physical-parent')
        const physicalOutputRoot = aliasKind === 'direct' ? join(caseRoot, 'physical-output') : join(physicalParent, 'output')
        const outputRoot = aliasKind === 'direct' ? join(caseRoot, 'output-link') : join(caseRoot, 'linked-parent', 'output')
        const outputBin = join(physicalOutputRoot, 'bin')
        const checkoutRoot = join(caseRoot, 'checkout')
        nodeFilesystem.mkdirSync(outputBin, { recursive: true })
        nodeFilesystem.mkdirSync(checkoutRoot)
        nodeFilesystem.writeFileSync(join(outputBin, 'claude.exe'), '')
        nodeFilesystem.writeFileSync(join(outputBin, 'codex.exe'), '')
        nodeFilesystem.symlinkSync(aliasKind === 'direct' ? physicalOutputRoot : physicalParent, aliasKind === 'direct' ? outputRoot : join(caseRoot, 'linked-parent'), 'junction')
        const launches = []
        const stdoutWrites = []
        const exitCode = await hostBehavior.runOutputEvaluation({
          outputRoot,
          overrides: {
            ambientEnvironment: { PATH: outputBin },
            checkoutRoot,
            fixtures: {
              baselineManifestSha256: 'a'.repeat(64),
              importCases: [{ adapterBase64: Buffer.from('# CLAUDE.md\n', 'utf8').toString('base64'), caseId: `protected-root-${aliasKind}`, expectedSentinel: null, files: [] }],
              scenarioManifestSha256: 'b'.repeat(64),
              scenarios: [],
            },
            launch: (call) => {
              launches.push(call)

              return completedTuple({ exitCode: 1 })
            },
            runSession: async () => { throw new Error('the protected launcher must fail before a session starts') },
          },
          stdout: { write: (text) => stdoutWrites.push(String(text)) },
        })

        assert.equal(exitCode, 1, aliasKind)
        assert.equal(launches.length, 0, `no executable physically inside the ${aliasKind} output root is launched`)
        assert.equal(JSON.parse(stdoutWrites[0]).code, 'unsupported-host-launcher', aliasKind)
      }
    } finally {
      nodeFilesystem.rmSync(scratch, { force: true, recursive: true })
    }
  })

  test('output mode refuses a pre-existing report hard link without changing its external bytes', async () => {
    const scratch = tempRoot()
    try {
      const checkoutRoot = join(scratch, 'checkout')
      const outputRoot = join(scratch, 'evidence')
      const externalPath = join(scratch, 'external.json')
      nodeFilesystem.mkdirSync(checkoutRoot)
      nodeFilesystem.mkdirSync(outputRoot)
      nodeFilesystem.writeFileSync(externalPath, 'external\n')
      nodeFilesystem.linkSync(externalPath, join(outputRoot, 'import-matrix.json'))

      await assert.rejects(hostBehavior.runOutputEvaluation({
        outputRoot,
        overrides: {
          ambientEnvironment: { PATH: '' },
          checkoutRoot,
          descriptors: { 'claude-code': { descriptor: {} }, codex: { descriptor: {} } },
          fixtures: {
            baselineManifestSha256: 'a'.repeat(64),
            importCases: [],
            scenarioManifestSha256: 'b'.repeat(64),
            scenarios: [],
          },
          launch: () => { throw new Error('report publication did not stop evaluation') },
        },
        stdout: { write() {} },
      }), /already exists/)
      assert.equal(nodeFilesystem.readFileSync(externalPath, 'utf8'), 'external\n')
    } finally {
      nodeFilesystem.rmSync(scratch, { force: true, recursive: true })
    }
  })

  test('the CLI output mode exits 1 with the primary result line or the failed import report and no table', async () => {
    const versionScratch = tempRoot()
    try {
      const harness = createEvaluationHarness(versionScratch, {
        importSentinels: new Map([['alpha', 'a1'.repeat(16)]]),
        onLaunch: (call) => call.boundary === 'version' && call.host === 'claude-code' ? completedTuple({ exitCode: 1 }) : null,
      })
      const outputRoot = join(versionScratch, 'evidence')
      const stdoutWrites = []
      const overrides = {
        ambientEnvironment: harness.options.ambientEnvironment,
        checkoutRoot: harness.options.checkoutRoot,
        controllerEntryPath: harness.options.controllerEntryPath,
        controllerWorkerPath: harness.options.controllerWorkerPath,
        descriptors: harness.options.descriptors,
        fixtures: {
          baselineManifestSha256: 'a'.repeat(64),
          importCases: [{ adapterBase64: Buffer.from('# CLAUDE.md\n\n@imports/a.md\n', 'utf8').toString('base64'), caseId: 'alpha', expectedSentinel: 'a1'.repeat(16), files: [{ contentBase64: Buffer.from(`Import-probe memory: ${'a1'.repeat(16)}.\n`, 'utf8').toString('base64'), path: 'imports/a.md' }] }],
          scenarioManifestSha256: 'b'.repeat(64),
          scenarios: [harness.scenario],
        },
        homeDirectory: harness.options.homeDirectory,
        launch: harness.options.launch,
        preparePluginRoot: harness.options.preparePluginRoot,
        proxySessionFactory: harness.options.proxySessionFactory,
        runGitFactory: harness.options.runGitFactory,
        runSession: harness.options.runSession,
        turnSchemaJson: harness.options.turnSchemaJson,
      }
      const exitCode = await hostBehavior.runOutputEvaluation({ outputRoot, overrides, stdout: { write: (text) => stdoutWrites.push(String(text)) } })

      assert.equal(exitCode, 1)
      assert.equal(stdoutWrites[stdoutWrites.length - 1], '{"ok":false,"host":"claude-code","code":"invalid-host-version","detail":"Version command failed."}\n')
      assert.equal(nodeFilesystem.existsSync(join(outputRoot, 'summary.json')), false, 'a primary result publishes no summary')
    } finally {
      nodeFilesystem.rmSync(versionScratch, { force: true, recursive: true })
    }

    const importScratch = tempRoot()
    try {
      const harness = createEvaluationHarness(importScratch, { importSentinels: new Map([['alpha', 'ff'.repeat(16)]]) })
      const outputRoot = join(importScratch, 'evidence')
      const stdoutWrites = []
      const overrides = {
        ambientEnvironment: harness.options.ambientEnvironment,
        checkoutRoot: harness.options.checkoutRoot,
        controllerEntryPath: harness.options.controllerEntryPath,
        controllerWorkerPath: harness.options.controllerWorkerPath,
        descriptors: harness.options.descriptors,
        fixtures: {
          baselineManifestSha256: 'a'.repeat(64),
          importCases: [{ adapterBase64: Buffer.from('# CLAUDE.md\n\n@imports/a.md\n', 'utf8').toString('base64'), caseId: 'alpha', expectedSentinel: 'a1'.repeat(16), files: [{ contentBase64: Buffer.from('Import-probe memory: wrong.\n', 'utf8').toString('base64'), path: 'imports/a.md' }] }],
          scenarioManifestSha256: 'b'.repeat(64),
          scenarios: [harness.scenario],
        },
        homeDirectory: harness.options.homeDirectory,
        launch: harness.options.launch,
        preparePluginRoot: harness.options.preparePluginRoot,
        proxySessionFactory: harness.options.proxySessionFactory,
        runGitFactory: harness.options.runGitFactory,
        runSession: harness.options.runSession,
        turnSchemaJson: harness.options.turnSchemaJson,
      }
      const exitCode = await hostBehavior.runOutputEvaluation({ outputRoot, overrides, stdout: { write: (text) => stdoutWrites.push(String(text)) } })

      assert.equal(exitCode, 1)
      const importReport = JSON.parse(nodeFilesystem.readFileSync(join(outputRoot, 'import-matrix.json'), 'utf8'))
      assert.equal(importReport.passed, false)
      assert.equal(importReport.verdicts[0].reason, 'structured-output-mismatch')
      assert.equal(stdoutWrites[stdoutWrites.length - 1], canonicalJson(importReport) + '\n')
      assert.equal(harness.launches.some((call) => call.boundary === 'version'), false, 'a failed import matrix stops before the behavioral matrix')
    } finally {
      nodeFilesystem.rmSync(importScratch, { force: true, recursive: true })
    }
  })
}

module.exports = { runHostEntryCases }
