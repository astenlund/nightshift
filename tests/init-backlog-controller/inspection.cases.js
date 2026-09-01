'use strict'

const assert = require('node:assert/strict')
const { existsSync, linkSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const test = require('node:test')

const {
  MAX_IGNORE_PROBE_ATTEMPTS,
  buildReadyCatalog,
  buildIgnoreProbes,
  composeElectionRecord,
  collectInspection,
  inspectRegions,
  materializeText,
  projectGitProblems,
  projectReadyProblems,
  composeElectionMarker,
  inspect,
  creationMode,
  discoverInitialLockStage,
  ignoreProbesForGitKind,
  maskedRecords,
  newlineTargetEvidence,
  readElectionMarker,
  targetRecord,
} = require('../../skills/init-backlog/lib/inspection')
const { HTML_BLOCK_TYPE_SIX_TAGS, guidanceImports } = require('../../skills/init-backlog/lib/guidance')
const {
  classifyCheckAttrProcess,
  classifyGitKind,
  detectGitKind,
  normalizeConfigValue,
  resolveGitExcludesFile,
  resolveNewlinePolicy,
  parseNulPaths,
  resolveDefaultGlobalIgnoreFile,
  runGit,
  inspectIgnoreProbes,
  inspectGitPolicy,
} = require('../../skills/init-backlog/lib/git-policy')
const filesystem = require('../../skills/init-backlog/lib/filesystem')
const { createInitialLock, initialLockPaths, publishNoReplace, removeInitialLock } = filesystem
const { MAX_BREAKOUT_FILE_BYTES, MAX_INLINE_FILE_BYTES, MAX_INSPECT_RESULT_BYTES, canonicalJson, sha256, validateProposalDispositions } = require('../../skills/init-backlog/lib/protocol')
const { analyzeCatalog } = require('../../skills/ready/ready')
const { ELECTION_MARKER_PATH } = require('./election-oracles')
const { git } = require('./helpers')

const BACKUPS_MODULE_PATH = require.resolve('../../skills/init-backlog/lib/backups')
const INSPECTION_FEATURES = '# Features\n\n## Test\n'

// Fresh valid Codex host context for direct inspect/collect calls; every
// caller may mutate its copy freely.
function codexHostContext() {
  return { claudeContextSource: null, claudeRootExclusionStatus: null, codexContextSource: 'user-confirmed', codexInvocationDirectory: '.', codexProjectDocMaxBytes: 1048576, codexProjectInstructions: [] }
}

function scaffoldInspectionRepository(root) {
  mkdirSync(join(root, '.claude', 'features'), { recursive: true })
  writeFileSync(join(root, 'AGENTS.md'), '# Instructions\n')
  writeFileSync(join(root, 'CLAUDE.md'), '@AGENTS.md\n')
  writeFileSync(join(root, '.claude', 'FEATURES.md'), INSPECTION_FEATURES)
  writeFileSync(join(root, '.claude', 'features', 'example.md'), '# Example\n')
}

// Scaffolds a repository whose only controlled content is one discovered
// breakout under `.claude/bugs`, linked from a minimal `BUGS.md` index, and
// hands the caller the resulting inspection.
function inspectDiscoveredBreakout(prefix, breakoutContents, run) {
  const root = mkdtempSync(join(tmpdir(), prefix))
  try {
    mkdirSync(join(root, '.claude', 'bugs'), { recursive: true })
    writeFileSync(join(root, 'CLAUDE.md'), '@AGENTS.md\n')
    writeFileSync(join(root, 'AGENTS.md'), '')
    writeFileSync(join(root, '.claude', 'BUGS.md'), '## Open\n\n### [Issue](bugs/issue.md)\n\n**Requires:** none.\n')
    writeFileSync(join(root, '.claude', 'bugs', 'issue.md'), breakoutContents)
    run(collectInspection(root, 'claude-code', { claudeContextSource: 'host-observed', claudeRootExclusionStatus: 'included' }, { candidates: [] }))
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
}

function inspectDiscoveredFeature(prefix, breakoutContents, run) {
  const root = mkdtempSync(join(tmpdir(), prefix))
  try {
    mkdirSync(join(root, '.claude', 'features'), { recursive: true })
    writeFileSync(join(root, 'CLAUDE.md'), '@AGENTS.md\n')
    writeFileSync(join(root, 'AGENTS.md'), '')
    writeFileSync(join(root, '.claude', 'FEATURES.md'), '## Work\n\n### [Large feature](features/large-feature.md)\n\n**Requires:** none.\n')
    writeFileSync(join(root, '.claude', 'features', 'large-feature.md'), breakoutContents)
    run(collectInspection(root, 'claude-code', { claudeContextSource: 'host-observed', claudeRootExclusionStatus: 'included' }, { candidates: [] }))
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
}

function inspectSemanticGuidance(prefix, guidanceContents, run) {
  const root = mkdtempSync(join(tmpdir(), prefix))
  try {
    writeFileSync(join(root, 'CLAUDE.md'), guidanceContents)
    run(collectInspection(root, 'claude-code', { claudeContextSource: 'host-observed', claudeRootExclusionStatus: 'included' }, { candidates: [] }))
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
}

function sizedMarkdown(heading, size) {
  const bytes = Buffer.alloc(size, 0x0a)
  const prefix = Buffer.from(`${heading}\n\n`, 'utf8')
  const padding = Buffer.from('<!-- padding -->\n', 'utf8')
  prefix.copy(bytes)
  for (let offset = prefix.length; offset + padding.length <= bytes.length; offset += padding.length) {
    padding.copy(bytes, offset)
  }

  return bytes
}

function withRecordedBackupStableOpens(run) {
  const originalStableOpenFile = filesystem.stableOpenFile
  const openedTargets = []
  try {
    filesystem.stableOpenFile = (...args) => {
      openedTargets.push(args[1])

      return originalStableOpenFile(...args)
    }
    delete require.cache[BACKUPS_MODULE_PATH]

    return run(require(BACKUPS_MODULE_PATH), openedTargets)
  } finally {
    filesystem.stableOpenFile = originalStableOpenFile
    delete require.cache[BACKUPS_MODULE_PATH]
    require(BACKUPS_MODULE_PATH)
  }
}

function streamedDirectory(names) {
  const state = { closed: false, reads: 0 }

  return {
    open: () => {
      let index = 0

      return {
        closeSync: () => { state.closed = true },
        readSync: () => {
          if (index >= names.length) return null
          state.reads += 1

          return { name: names[index++] }
        },
      }
    },
    state,
  }
}

function runInspectionCases(repositoryRoot) {
  test('inspection module recognizes controlled Markdown regions outside code and HTML', () => {
    const source = Buffer.from('\ufeff# Title\n\n```\n## Section\n```\n<!--\n## Section\n-->\n## Section\nbody\n## Tail\n', 'utf8')
    const regions = inspectRegions(source, [{ regionId: 'section', syntax: 'markdown-section', heading: '## Section', missingPlacement: 'end', semantic: true }])

    assert.deepEqual(regions, [{ endByte: source.length - Buffer.byteLength('## Tail\n'), regionId: 'section', startByte: Buffer.byteLength('\ufeff# Title\n\n```\n## Section\n```\n<!--\n## Section\n-->\n', 'utf8') }])
  })

  test('inspection preserves prefix and suffix while materializing destination newline', () => {
    const source = Buffer.from('\ufeffprefix\r\n## Section\r\nold\r\n## Tail\r\n', 'utf8')
    const [region] = inspectRegions(source, [{ regionId: 'section', syntax: 'markdown-section', heading: '## Section', missingPlacement: 'end', semantic: true }])
    const result = materializeText(source, region.startByte, region.endByte, Buffer.from('## Section\nnew\n', 'utf8'), { newline: 'crlf' })

    assert.deepEqual(result, Buffer.from('\ufeffprefix\r\n## Section\r\nnew\r\n## Tail\r\n', 'utf8'))
  })

  test('region inspection recognizes setext boundaries and safe missing placement', () => {
    const source = Buffer.from('intro\n\n## Section\nbody\nSetext\n=======\nnext\n', 'utf8')
    const [region] = inspectRegions(source, [{ regionId: 'section', syntax: 'markdown-section', heading: '## Section', missingPlacement: 'end', semantic: true }])
    assert.equal(region.startByte, Buffer.byteLength('intro\n\n', 'utf8'))
    assert.equal(region.endByte, Buffer.byteLength('intro\n\n## Section\nbody\n', 'utf8'))
    const start = inspectRegions(Buffer.from('## Existing\nbody\n', 'utf8'), [{ regionId: 'preamble', syntax: 'markdown-preamble', heading: '# Missing', missingPlacement: 'start', semantic: true }])
    assert.deepEqual(start, [{ endByte: 0, regionId: 'preamble', startByte: 0 }])
    assert.throws(() => inspectRegions(Buffer.from('prose\n', 'utf8'), [{ regionId: 'preamble', syntax: 'markdown-preamble', heading: '# Missing', missingPlacement: 'start', semantic: true }]), (error) => error.code === 'structural-invalid')
  })

  test('inspection classifies Git only when all required marker candidates exist', () => {
    assert.equal(classifyGitKind([]).kind, 'non-git')
    assert.equal(classifyGitKind([{ name: 'HEAD', kind: 'file' }]).kind, 'git')
    assert.throws(() => classifyGitKind([{ name: 'HEAD', kind: 'link' }]))
  })

  test('linked-worktree gitfiles enter trusted Git validation while linked or special markers fail closed', () => {
    const root = mkdtempSync(join(tmpdir(), 'nightshift-linked-worktree-gitfile-'))
    const administrationRoot = join(root, 'main.git', 'worktrees', 'linked')
    const linkedRoot = join(root, 'linked')
    try {
      mkdirSync(administrationRoot, { recursive: true })
      mkdirSync(linkedRoot)
      writeFileSync(join(linkedRoot, '.git'), `gitdir: ${administrationRoot}\n`)

      const detected = detectGitKind(linkedRoot)
      const commands = []
      assert.deepEqual(detected, { kind: 'git', present: ['.git'] })
      assert.throws(() => inspectGitPolicy(linkedRoot, {
        kind: detected.kind,
        spawnSync: (executable, args) => {
          commands.push(args.slice(2))

          return { status: 1, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), signal: null }
        },
        trustedGitPath: 'C:/trusted/git.exe',
      }), /work-tree probe/)
      assert.deepEqual(commands, [['rev-parse', '--is-inside-work-tree']])

      for (const marker of [
        { isDirectory: () => false, isFile: () => true, isSymbolicLink: () => true },
        { isDirectory: () => false, isFile: () => false, isSymbolicLink: () => false },
      ]) {
        const visited = []
        assert.throws(() => detectGitKind(linkedRoot, { lstatSync: (path) => { visited.push(path); return marker } }))
        assert.deepEqual(visited, [join(linkedRoot, '.git')])
      }
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('inspection catalog contains only ready-owned Markdown targets', () => {
    const catalog = buildReadyCatalog([
      { target: '.gitignore', contents: '.claude/plans/\n' },
      { target: 'AGENTS.md', contents: '# Guidance\n' },
      { target: '.claude/FEATURES.md', contents: '# Features\n' },
      { target: '.claude/features/example.md', contents: 'Example\n' },
      { target: '.claude/BUGS.md', contents: '# Bugs\n' },
    ])

    assert.deepEqual(catalog.map((item) => item.target), ['BUGS.md', 'FEATURES.md', 'features/example.md'])
  })

  test('ready projection carries structural errors and notices with confined evidence', () => {
    const catalog = [
      { target: 'FEATURES.md', contents: '## Area\n### [Nested](features/deep/nested.md)\n\n**Requires:** none.\n' },
      { target: 'features/deep/nested.md', contents: '# Nested\n\n**Requires:** none.\nwrapped\n' },
      { target: 'features/deep/unlinked.md', contents: '# Unlinked\nFirst\nSecond\n' },
    ]
    const ready = analyzeCatalog(catalog)
    const projected = projectReadyProblems(ready, catalog)

    assert.equal(projected.problems.find((item) => item.code === 'ready-structural').blocking, true)
    assert.equal(projected.problems.find((item) => item.code === 'ready-structural').target, null)
    assert.equal(projected.problems.find((item) => item.code === 'ready-structural').evidencePaths[0], '.claude/FEATURES.md')
    assert.equal(projected.problems.find((item) => item.code === 'ready-notice').blocking, false)
    assert.equal(projected.warnings[0].code, 'nonblocking-ready-notice')
  })

  test('check-attr classifier enforces raw terminal transport and Cartesian ordering', () => {
    const paths = ['.claude/BUGS.md', '.claude/FEATURES.md']
    const attributes = ['text', 'eol']
    const fields = []
    for (const path of paths) {
      fields.push(path, 'text', 'set', path, 'eol', 'lf')
    }
    const result = { status: 0, stderr: Buffer.alloc(0), stdout: Buffer.from(`${fields.join('\0')}\0`, 'utf8') }
    assert.equal(classifyCheckAttrProcess(result, paths, attributes).length, 4)
    assert.throws(() => classifyCheckAttrProcess({ ...result, stdout: Buffer.from(fields.join('\0'), 'utf8') }, paths, attributes))
    assert.throws(() => classifyCheckAttrProcess({ ...result, stdout: Buffer.from([0xff, 0x00]) }, paths, attributes))
    assert.throws(() => classifyCheckAttrProcess({ ...result, stderr: Buffer.from('diagnostic') }, paths, attributes))
    assert.throws(() => classifyCheckAttrProcess({ ...result, stdout: Buffer.from(`${fields.map((value, index) => index === 2 ? 'unset' : value).join('\0')}\0`, 'utf8') }, paths, attributes))
  })

  test('Git path transport preserves and validates the producer order', () => {
    assert.deepEqual(parseNulPaths(Buffer.from('a\0b\0', 'utf8')), ['a', 'b'])
    assert.throws(() => parseNulPaths(Buffer.from('b\0a\0', 'utf8')), /ordering/)
    assert.throws(() => parseNulPaths(Buffer.from('foo/barx\0', 'utf8'), { domain: 'foo/bar' }), /domain/)
  })

  test('newline policy selects Git, sibling, choice, and platform branches', () => {
    assert.equal(resolveNewlinePolicy({ kind: 'git', autocrlf: 'true', eol: null, target: 'A.md' }).style, 'crlf')
    assert.equal(resolveNewlinePolicy({ kind: 'non-git', siblingStyles: ['lf'], platformEol: 'crlf', target: 'A.md' }).style, 'lf')
    assert.equal(resolveNewlinePolicy({ kind: 'non-git', siblingStyles: ['lf', 'crlf'], target: 'A.md' }).style, 'choice-required')
    assert.equal(resolveNewlinePolicy({ kind: 'non-git', siblingStyles: [], platformEol: 'crlf', target: 'A.md' }).style, 'crlf')
    assert.equal(resolveNewlinePolicy({ kind: 'git', text: 'unset', autocrlf: 'true', eol: 'crlf', target: 'A.md' }).style, 'crlf')
    assert.equal(resolveNewlinePolicy({ kind: 'git', text: 'set', autocrlf: 'false', eol: null, platformEol: 'crlf', target: 'A.md' }).style, 'crlf')
    assert.equal(resolveNewlinePolicy({ kind: 'non-git', siblingStyles: [], platformEol: 'lf', target: 'A.md' }).style, 'lf')
  })

  test('fence closers with trailing info remain opaque', () => {
    assert.throws(() => inspectRegions(Buffer.from('intro\n```\n## Section\n``` foo\n', 'utf8'), [{ regionId: 'section', syntax: 'markdown-section', heading: '## Section', missingPlacement: 'end', semantic: true }]), (error) => error.code === 'structural-invalid')
  })

  test('custom raw HTML blocks mask following headings through their blank terminator', () => {
    assert.deepEqual(inspectRegions(Buffer.from('<custom> inline\n## hidden\n\n', 'utf8'), [{ regionId: 'section', syntax: 'markdown-section', heading: '## hidden', missingPlacement: 'forbidden', semantic: true }]), [])
  })

  test('ready evidence rejects paths outside the closed catalog', () => {
    assert.throws(() => projectReadyProblems({ structuralErrors: [{ index: '../../escape', problem: 'bad' }], notices: [] }), /evidence|catalog|confined|invalid/i)
  })

  test('Windows Git home fallback skips system HOME and prefers a non-system synthesis', () => {
    const seen = []
    const value = resolveGitExcludesFile({
      platform: 'win32',
      env: { HOMEDRIVE: 'C:', HOMEPATH: '\\Windows', USERPROFILE: 'C:\\Users\\owner' },
      systemDirectory: 'C:\\Windows',
      exists: (path) => { seen.push(path); return path === 'C:\\Users\\owner' },
      realpath: (path) => path,
    })
    assert.equal(value, 'C:\\Users\\owner')
    assert.deepEqual(seen, ['C:\\Users\\owner'])
    assert.throws(() => normalizeConfigValue('\u00a0true', 'autocrlf'))
  })

  test('Git launch pins the trusted executable, bounded transport, and safety environment', () => {
    let observed
    runGit(repositoryRoot, ['status'], {
      trustedGitPath: 'C:/trusted/git.exe',
      env: {
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'core.excludesFile',
        GIT_CONFIG_VALUE_0: 'C:/ambient/excludes',
        GIT_EXEC_PATH: 'C:/ambient/git-core',
        PATH: 'C:/tools',
      },
      trustedGitEnvironment: {
        GIT_ATTR_NOSYSTEM: '1',
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_GLOBAL: 'C:/trusted/config',
        GIT_CONFIG_KEY_0: 'core.attributesFile',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_VALUE_0: 'C:/trusted/attributes',
      },
      spawnSync: (executable, args, options) => {
        observed = { args, executable, options }
        return { status: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), signal: null }
      },
      input: Buffer.from('payload', 'utf8'),
    })
    assert.equal(observed.executable, 'C:/trusted/git.exe')
    assert.deepEqual(observed.args, ['-c', 'core.fsmonitor=', 'status'])
    assert.equal(observed.options.shell, false)
    assert.equal(observed.options.killSignal, 'SIGKILL')
    assert.equal(observed.options.env.GIT_OPTIONAL_LOCKS, '0')
    assert.equal(observed.options.env.GIT_TERMINAL_PROMPT, '0')
    assert.equal(observed.options.env.GIT_PAGER, 'cat')
    assert.equal(observed.options.env.GIT_CONFIG_COUNT, '1')
    assert.equal(observed.options.env.GIT_CONFIG_KEY_0, 'core.attributesFile')
    assert.equal(observed.options.env.GIT_CONFIG_VALUE_0, 'C:/trusted/attributes')
    assert.equal(observed.options.env.GIT_CONFIG_GLOBAL, 'C:/trusted/config')
    assert.equal(observed.options.env.GIT_ATTR_NOSYSTEM, '1')
    assert.equal(observed.options.env.GIT_CONFIG_NOSYSTEM, '1')
    assert.equal(observed.options.env.PATH, 'C:/tools')
    assert.equal('GIT_EXEC_PATH' in observed.options.env, false)
  })

  test('Git launch rejects non-absolute executables and ambient repository overrides', () => {
    assert.throws(() => runGit(repositoryRoot, ['status'], { trustedGitPath: 'git.exe', platform: 'win32', spawnSync: () => { throw new Error('must not launch') } }), /absolute/)
    assert.throws(() => runGit(repositoryRoot, ['status'], { trustedGitPath: 'C:/trusted/git.exe', env: { GIT_DIR: 'C:/outside' }, spawnSync: () => { throw new Error('must not launch') } }), /override/)
  })

  test('diagnostic ignore winners remain unignored repository-policy evidence', () => {
    const privateExcludePath = join(repositoryRoot, '.git', 'info', 'exclude')
    const stdoutFor = (args) => {
      if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') return Buffer.from('true\n', 'utf8')
      if (args[0] === 'rev-parse' && args[1] === '--is-inside-git-dir') return Buffer.from('false\n', 'utf8')
      if (args[0] === 'rev-parse' && args[1] === '--is-bare-repository') return Buffer.from('false\n', 'utf8')
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return Buffer.from(`${repositoryRoot}\n`, 'utf8')
      if (args[0] === 'rev-parse' && args[1] === '--show-object-format=storage') return Buffer.from('sha1\n', 'utf8')
      if (args[0] === 'check-ignore') return Buffer.concat([Buffer.from(privateExcludePath, 'utf8'), Buffer.from([0]), Buffer.from('1\0x\0ignored.md\0', 'utf8')])

      return Buffer.alloc(0)
    }
    const policy = inspectGitPolicy(repositoryRoot, {
      eol: null,
      globalExcludePath: null,
      ignoreProbes: [{ probe: 'ignored.md', target: 'ignored.md' }],
      kind: 'git',
      privateExcludePath,
      spawnSync: (executable, args) => {
        assert.deepEqual(args.slice(0, 2), ['-c', 'core.fsmonitor='])
        const commandArgs = args.slice(2)

        return { status: commandArgs[0] === 'config' ? 1 : 0, stdout: stdoutFor(commandArgs), stderr: Buffer.alloc(0), signal: null }
      },
      trustedGitPath: 'C:/trusted/git.exe',
    })

    assert.deepEqual(policy.nonPlanUnignoredPaths, ['ignored.md'])
  })

  test('mixed regular and gate ignore probes use one Git process', () => {
    const privateExcludePath = join(repositoryRoot, '.git', 'info', 'exclude')
    let checkIgnoreCalls = 0
    let checkIgnoreInput = null
    const stdoutFor = (args) => {
      if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') return Buffer.from('true\n', 'utf8')
      if (args[0] === 'rev-parse' && args[1] === '--is-inside-git-dir') return Buffer.from('false\n', 'utf8')
      if (args[0] === 'rev-parse' && args[1] === '--is-bare-repository') return Buffer.from('false\n', 'utf8')
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return Buffer.from(`${repositoryRoot}\n`, 'utf8')
      if (args[0] === 'rev-parse' && args[1] === '--show-object-format=storage') return Buffer.from('sha1\n', 'utf8')
      return Buffer.alloc(0)
    }
    const policy = inspectGitPolicy(repositoryRoot, {
      eol: null,
      globalExcludePath: null,
      ignoreProbes: [{ probe: 'a.md', target: 'a.md' }, { gate: true, probe: 'b.md', target: 'b.md' }],
      kind: 'git',
      privateExcludePath,
      spawnSync: (executable, args, options) => {
        const commandArgs = args.slice(2)
        if (commandArgs[0] === 'check-ignore') {
          checkIgnoreCalls += 1
          checkIgnoreInput = options.input
          const probes = options.input.toString('utf8').slice(0, -1).split('\0')

          return { status: 0, stdout: Buffer.from(`${probes.map((probe) => `\0\0\0${probe}`).join('\0')}\0`, 'utf8'), stderr: Buffer.alloc(0), signal: null }
        }

        return { status: commandArgs[0] === 'config' ? 1 : 0, stdout: stdoutFor(commandArgs), stderr: Buffer.alloc(0), signal: null }
      },
      trustedGitPath: 'C:/trusted/git.exe',
    })

    assert.equal(checkIgnoreCalls, 1)
    assert.deepEqual(checkIgnoreInput, Buffer.from('a.md\0b.md\0', 'utf8'))
    assert.deepEqual(policy.nonPlanUnignoredPaths, ['a.md'])
  })

  test('empty ignore probe batches launch no Git process', () => {
    let launches = 0

    assert.deepEqual(inspectIgnoreProbes(repositoryRoot, [], { spawnSync: () => { launches += 1 } }), [])
    assert.equal(launches, 0)
  })

  test('plans policy builds a separate directory gate probe', () => {
    const probes = buildIgnoreProbes(repositoryRoot, [])
    assert.ok(probes.some((item) => item.gate === true && item.probe === '.claude/plans' && item.target === '.claude/plans'))
    assert.equal(probes.some((item) => item.target.endsWith('/')), false, 'recorded probe targets must be confined protocol targets')
  })

  test('ignore probe selection bounds occupied candidate scans', () => {
    assert.equal(MAX_IGNORE_PROBE_ATTEMPTS, 32)
    let attempts = 0
    let planAttempts = 0

    assert.throws(() => buildIgnoreProbes(repositoryRoot, [], {
      lstatSync: (path) => {
        attempts += 1
        if (!path.includes(join('.claude', 'plans'))) {
          const missing = new Error('missing')
          missing.code = 'ENOENT'

          throw missing
        }
        planAttempts += 1

        return { isFile: () => true }
      },
    }), /No free Git ignore probe/)
    assert.equal(planAttempts, MAX_IGNORE_PROBE_ATTEMPTS)
    assert.equal(attempts, MAX_IGNORE_PROBE_ATTEMPTS + 3)
  })

  test('non-Git inspection skips automatic ignore-probe discovery', () => {
    let builds = 0
    const build = () => {
      builds += 1

      return [{ probe: '.claude/.nightshift-probe.md', target: '.claude' }]
    }

    assert.deepEqual(ignoreProbesForGitKind('non-git', undefined, build), [])
    assert.equal(builds, 0)
    assert.deepEqual(ignoreProbesForGitKind('git', undefined, build), [{ probe: '.claude/.nightshift-probe.md', target: '.claude' }])
    assert.equal(builds, 1)
    const supplied = [{ probe: 'supplied.md', target: 'supplied.md' }]
    assert.equal(ignoreProbesForGitKind('non-git', supplied, build), supplied)
    assert.equal(builds, 1)
  })

  test('default global ignore identity follows XDG before platform fallbacks', () => {
    const value = resolveDefaultGlobalIgnoreFile({ platform: 'win32', env: { XDG_CONFIG_HOME: 'C:\\Config', APPDATA: 'C:\\AppData' }, exists: (path) => path === 'C:\\Config\\git\\ignore', realpath: (path) => path })
    assert.equal(value, 'C:\\Config\\git\\ignore')
    const homeValue = resolveDefaultGlobalIgnoreFile({ platform: 'win32', env: { APPDATA: 'C:\\AppData', HOME: 'C:\\Home' }, exists: (path) => path === 'C:\\Home\\.config\\git\\ignore', realpath: (path) => path })
    assert.equal(homeValue, 'C:\\Home\\.config\\git\\ignore')
    const relativePath = join(repositoryRoot, 'relative-ignore')
    assert.equal(resolveDefaultGlobalIgnoreFile({ configuredPath: 'relative-ignore', root: repositoryRoot, exists: (path) => path === relativePath, realpath: (path) => path }), relativePath)
  })

  test('configured Git excludes file wins before home fallback', () => {
    const seen = []
    const configured = 'C:\\Configured\\ignore'
    const home = 'C:\\Users\\owner'
    const value = resolveGitExcludesFile({
      configuredPath: configured,
      env: { HOME: home },
      exists: (path) => { seen.push(path); return path === configured },
      platform: 'win32',
      realpath: (path) => path,
    })
    assert.equal(value, configured)
    assert.deepEqual(seen, [configured])
  })

  test('missing target modes derive owner-safe POSIX permissions and Windows null', () => {
    assert.equal(creationMode('file', { platform: 'linux', umask: 0o022 }), 0o644)
    assert.equal(creationMode('directory', { platform: 'linux', umask: 0o022 }), 0o755)
    assert.equal(creationMode('file', { platform: 'win32', umask: 0o777 }), null)
    assert.throws(() => creationMode('file', { platform: 'linux', umask: 0o777 }), /owner permissions/)
    assert.equal(targetRecord('missing.md', { present: false, mode: 0o644 }, { kind: 'file' }, null, { platform: 'linux' }).mode, 0o644)
  })

  test('raw HTML type-one blocks that close on their opening line do not mask headings', () => {
    const source = Buffer.from('<script>inline</script>\n## Section\nbody\n', 'utf8')
    const [region] = inspectRegions(source, [{ regionId: 'section', syntax: 'markdown-section', heading: '## Section', missingPlacement: 'forbidden', semantic: true }])
    assert.equal(region.startByte, Buffer.byteLength('<script>inline</script>\n', 'utf8'))
  })

  test('raw HTML type-one blocks opened at end of line mask through their closing tag', () => {
    for (const tag of ['script', 'pre', 'style', 'textarea']) {
      const source = Buffer.from(`<${tag}\n## Hidden\n</${tag}>\n## Visible\n`, 'utf8')

      assert.deepEqual([...maskedRecords(source).masked], [0, 1, 2], `inspection scanner must mask an end-of-line <${tag} block`)
    }
  })

  test('raw HTML type-six blocks opened at end of line mask through the first blank line', () => {
    const source = Buffer.from('<div\n## Hidden\n\n## Visible\n', 'utf8')

    assert.deepEqual([...maskedRecords(source).masked], [0, 1])
  })

  test('non-Git newline evidence stays within each target family', () => {
    const result = inspectGitPolicy(repositoryRoot, {
      kind: 'non-git',
      newlineTargets: [
        { family: 'top-level', siblingStyles: ['lf'], target: '.claude/FEATURES.md' },
        { family: 'features', siblingStyles: ['crlf'], target: '.claude/features/example.md' },
      ],
      platformEol: 'lf',
    })
    assert.deepEqual(result.newlinePolicies.map((item) => item.style), ['lf', 'crlf'])
  })

  test('newline target evidence reads records linearly and retains compact styles', () => {
    let recordReads = 0
    const records = Array.from({ length: 200 }, (_, index) => {
      const values = { newline: index % 2 === 0 ? 'lf' : 'crlf', target: `.claude/features/item-${index}.md` }

      return {
        kind: 'file',
        mode: null,
        get newline() {
          recordReads += 1

          return values.newline
        },
        get target() {
          recordReads += 1

          return values.target
        },
      }
    })
    const nonGit = newlineTargetEvidence(records, 'AGENTS.md', [], 'non-git')

    assert.ok(recordReads <= records.length * 8, `record fields were read ${recordReads} times`)
    assert.equal(nonGit.every((item) => item.siblingStyles.length === 2), true)
    assert.equal(nonGit.every((item) => item.siblingStyles.length <= 2), true)
    const git = newlineTargetEvidence(records, 'AGENTS.md', [], 'git')
    assert.equal(git.every((item) => !Object.hasOwn(item, 'siblingStyles')), true)
  })

  test('non-Git guidance conflicts expose paired newline alternatives', () => {
    const result = inspectGitPolicy(repositoryRoot, {
      kind: 'non-git',
      newlineTargets: [{ family: 'guidance', siblingStyles: ['lf', 'crlf'], target: 'CLAUDE.md', guidance: true }],
      platformEol: 'lf',
    })
    assert.deepEqual(result.newlinePolicies[0], { mode: null, source: 'choice', style: 'choice-required', target: 'CLAUDE.md' })
  })

  test('non-Git guidance proposals preserve both newline byte variants', () => {
    const root = mkdtempSync(join(tmpdir(), 'nightshift-guidance-newline-'))
    try {
      mkdirSync(join(root, '.claude'), { recursive: true })
      writeFileSync(join(root, 'CLAUDE.md'), '@AGENTS.md\n')
      writeFileSync(join(root, 'AGENTS.md'), '')
      writeFileSync(join(root, 'CLAUDE.local.md'), Buffer.from('# Local\r\n', 'utf8'))
      const result = collectInspection(root, 'claude-code', { claudeContextSource: 'host-observed', claudeRootExclusionStatus: 'included' }, { candidates: [] })
      const proposals = result.proposals.filter((item) => item.reason === 'guidance-section')
      assert.equal(proposals.length, 2)
      assert.deepEqual(proposals.map((item) => item.condition).sort(), ['newline-crlf', 'newline-lf'])
      assert.notEqual(proposals[0].afterBase64, proposals[1].afterBase64)
      assert.ok(proposals.some((item) => Buffer.from(item.afterBase64, 'base64').includes(Buffer.from('\r\n'))))
      assert.ok(proposals.some((item) => Buffer.from(item.afterBase64, 'base64').includes(Buffer.from('\n')) && !Buffer.from(item.afterBase64, 'base64').includes(Buffer.from('\r\n'))))
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('unclosed opaque blocks fail only when they obscure a required boundary', () => {
    const declaration = { regionId: 'section', syntax: 'markdown-section', heading: '## Section', missingPlacement: 'forbidden', semantic: true }
    assert.throws(() => inspectRegions(Buffer.from('intro\n```\n## Section\n', 'utf8'), [declaration]), (error) => error.code === 'structural-invalid')
    assert.deepEqual(inspectRegions(Buffer.from('## Section\nbody\n```\n', 'utf8'), [{ ...declaration, missingPlacement: 'end' }]), [{ endByte: Buffer.byteLength('## Section\nbody\n```\n'), regionId: 'section', startByte: 0 }])
    assert.deepEqual(inspectRegions(Buffer.from('## Section\nbody\n<!--\n', 'utf8'), [{ ...declaration, missingPlacement: 'end' }]), [{ endByte: Buffer.byteLength('## Section\nbody\n<!--\n'), regionId: 'section', startByte: 0 }])
  })

  test('markdown scanners share the closed CommonMark 0.31.2 type-6 tag inventory', () => {
    // Arrange: the exact start-condition-6 tag list of CommonMark 0.31.2
    // (condition-1 tags pre, script, style, and textarea excluded).
    const specTags = ['address', 'article', 'aside', 'base', 'basefont', 'blockquote', 'body', 'caption', 'center', 'col', 'colgroup', 'dd', 'details', 'dialog', 'dir', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'frame', 'frameset', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hr', 'html', 'iframe', 'legend', 'li', 'link', 'main', 'menu', 'menuitem', 'nav', 'noframes', 'ol', 'optgroup', 'option', 'p', 'param', 'search', 'section', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'title', 'tr', 'track', 'ul']

    // Act + Assert: the shared constant is the closed spec inventory, and an
    // unterminated open tag for every member starts a blank-terminated HTML
    // block in both the guidance scanner and the inspection scanner.
    assert.deepEqual([...HTML_BLOCK_TYPE_SIX_TAGS], specTags)
    for (const tag of HTML_BLOCK_TYPE_SIX_TAGS) {
      assert.deepEqual(guidanceImports(`<${tag} attr\n@masked.md\n\n@kept.md\n`), ['kept.md'], `guidance scanner must mask an HTML block opened by <${tag}>`)
      assert.deepEqual([...maskedRecords(Buffer.from(`<${tag} attr\nbody\n\n## Tail\n`, 'utf8')).masked], [0, 1], `inspection scanner must mask an HTML block opened by <${tag}>`)
    }
    // A name outside the inventory without a complete tag is ordinary text.
    assert.deepEqual(guidanceImports('<pretend attr\n@kept.md\n'), ['kept.md'])
    assert.deepEqual([...maskedRecords(Buffer.from('<pretend attr\nbody\n', 'utf8')).masked], [])
  })

  test('direct inspection maps snapshot drift and cleanup failures without target writes', () => {
    const root = mkdtempSync(join(tmpdir(), 'nightshift-inspect-lifecycle-'))
    try {
      scaffoldInspectionRepository(root)
      const context = codexHostContext()
      let collections = 0
      assert.throws(() => inspect(root, 'codex', context, {
        candidates: [],
        ownerNonce: 'e'.repeat(32),
        onCollection: () => { collections += 1; if (collections === 1) writeFileSync(join(root, '.claude', 'FEATURES.md'), '# Features\n\n## Changed\n') },
      }), (error) => error.record?.code === 'snapshot-drift')
      assert.equal(require('node:fs').existsSync(join(root, '.nightshift-init-backlog.lock')), false)
      assert.equal(collections, 2)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('direct inspection rejects first-result overflow before a second collection', () => {
    const root = mkdtempSync(join(tmpdir(), 'nightshift-inspect-result-bound-'))
    let collections = 0
    try {
      writeFileSync(join(root, 'AGENTS.md'), '# Instructions\n')
      const collect = (...args) => {
        collections += 1
        const result = collectInspection(...args)
        result.ready = { detail: 'x'.repeat(MAX_INSPECT_RESULT_BYTES) }

        return result
      }

      assert.throws(() => inspect(root, 'codex', codexHostContext(), { candidates: [], collectInspection: collect, ownerNonce: '9'.repeat(32) }), (error) => error.record?.code === 'payload-too-large' && error.record?.phase === 'inspect')
      assert.equal(collections, 1)
      assert.equal(existsSync(join(root, '.nightshift-init-backlog.lock')), false)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('direct inspection reports cleanup failure after stable collections', () => {
    const root = mkdtempSync(join(tmpdir(), 'nightshift-inspect-cleanup-'))
    try {
      scaffoldInspectionRepository(root)
      const context = codexHostContext()
      let removals = 0
      assert.throws(() => inspect(root, 'codex', context, {
        candidates: [],
        ownerNonce: 'd'.repeat(32),
        removeAndVerify: () => { removals += 1; throw new Error('injected cleanup failure') },
      }), (error) => error.record?.code === 'filesystem' && error.record?.phase === 'cleanup')
      assert.equal(removals, 1)
      assert.equal(existsSync(join(root, '.nightshift-init-backlog.lock')), true)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('direct inspection maps guidance, Git, filesystem, marker, and lock failures', () => {
    const context = codexHostContext()
    const fixture = () => {
      const root = mkdtempSync(join(tmpdir(), 'nightshift-inspect-failure-'))
      scaffoldInspectionRepository(root)

      return root
    }
    const cases = [
      { name: 'guidance-resolution', phase: 'resolve', invoke: (root) => inspect(root, 'codex', {}, { candidates: [] }) },
      { name: 'git-policy', invoke: (root) => inspect(root, 'codex', context, { candidates: [null] }) },
    ]
    for (const item of cases) {
      const root = fixture()
      try {
        assert.throws(() => item.invoke(root), (error) => error.record?.code === item.name && error.record?.phase === (item.phase ?? 'inspect'))
      } finally {
        rmSync(root, { force: true, recursive: true })
      }
    }
    const filesystemRoot = fixture()
    try {
      const source = readdirSync(join(filesystemRoot, '.claude', 'features')).find((name) => name.endsWith('.md'))
      assert.notEqual(source, undefined)
      linkSync(join(filesystemRoot, '.claude', 'features', source), join(filesystemRoot, '.claude', 'features', 'identity-alias.md'))
      assert.throws(() => inspect(filesystemRoot, 'codex', context, { candidates: [] }), (error) => error.record?.code === 'filesystem' && error.record?.phase === 'inspect')
    } finally {
      rmSync(filesystemRoot, { force: true, recursive: true })
    }
    const markerRoot = fixture()
    try {
      writeFileSync(join(markerRoot, ELECTION_MARKER_PATH), `${canonicalJson(composeElectionRecord('track', markerRoot, 'e'.repeat(64)))}\n`, { mode: 0o600 })
      assert.throws(() => inspect(markerRoot, 'codex', context, { candidates: [] }), (error) => error.record?.code === 'runtime-marker' && error.record?.phase === 'inspect')
    } finally {
      rmSync(markerRoot, { force: true, recursive: true })
    }
    const lockRoot = fixture()
    try {
      writeFileSync(join(lockRoot, '.nightshift-init-backlog.lock'), '{}\n', { mode: 0o600 })
      assert.throws(() => inspect(lockRoot, 'codex', context, { candidates: [] }), (error) => error.record?.code === 'runtime-lock' && error.record?.phase === 'lock')
    } finally {
      rmSync(lockRoot, { force: true, recursive: true })
    }
  })

  test('direct inspection accepts an identical-projection ABA between collections', () => {
    const root = mkdtempSync(join(tmpdir(), 'nightshift-inspect-aba-'))
    try {
      scaffoldInspectionRepository(root)
      const context = codexHostContext()
      const original = readFileSync(join(root, '.claude', 'FEATURES.md'))
      let collections = 0
      const result = inspect(root, 'codex', context, {
        candidates: [],
        ownerNonce: 'a'.repeat(32),
        onCollection: () => { collections += 1; if (collections === 1) { writeFileSync(join(root, '.claude', 'FEATURES.md'), '# transient\n'); writeFileSync(join(root, '.claude', 'FEATURES.md'), original) } },
      })
      assert.equal(result.ok, true)
      assert.equal(collections, 2)
      assert.equal(existsSync(join(root, '.nightshift-init-backlog.lock')), false)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('ready catalog and evidence preserve nested identities without fallback rewriting', () => {
    const catalog = buildReadyCatalog([
      { target: 'FEATURES.md', contents: '## Area\n### [Nested](features/deep/nested.md)\n\n**Requires:** none.\n' },
      { target: 'features/deep/nested.md', contents: '# Nested\n\n**Requires:** none.\nwrapped\n' },
      { target: 'features/deep/unlinked.md', contents: '# Unlinked\nFirst\nSecond\n' },
      { target: '.claude/bugs/deep/issue.md', contents: 'Issue\n' },
    ])
    assert.deepEqual(catalog.map((item) => item.target), ['FEATURES.md', 'bugs/deep/issue.md', 'features/deep/nested.md', 'features/deep/unlinked.md'])
    const ready = analyzeCatalog(catalog)
    assert.equal(projectReadyProblems(ready, catalog).problems.find((item) => item.code === 'ready-notice').target, '.claude/features/deep/nested.md')
    for (const evidencePath of ['features\\deep\\nested.md', 'features/../features/deep/nested.md', 'features/deep/missing.md']) {
      assert.throws(() => projectReadyProblems({ ...ready, evidence: { ...ready.evidence, notices: [{ evidencePaths: [evidencePath], kind: 'notices', ordinal: 0 }] } }, catalog), /evidence|catalog|confined|invalid/i)
    }
    for (const evidence of [
      null,
      { legacyHistory: [], notices: [], structuralErrors: [] },
      { legacyHistory: [], notices: [{ evidencePaths: ['features/area/nested.md'], kind: 'notices', ordinal: 1 }], structuralErrors: [] },
    ]) {
      assert.throws(() => projectReadyProblems({ ...ready, evidence }, catalog), /evidence|ordinal|cardinality/i)
    }
  })

  test('ready evidence binds the parser-owned identity sequence exactly', () => {
    const catalog = buildReadyCatalog([
      { target: 'FEATURES.md', contents: '## Area\n### [Nested](features/deep/nested.md)\n\n**Requires:** none.\n' },
      { target: 'BUGS.md', contents: '# Bugs\n' },
      { target: 'features/deep/nested.md', contents: '# Nested\n\n**Requires:** none.\nwrapped\n' },
      { target: 'features/deep/unlinked.md', contents: '# Unlinked\nFirst\nSecond\n' },
    ])
    const ready = analyzeCatalog(catalog)
    const noticeIndex = ready.evidence.notices.findIndex((item) => item.evidencePaths.includes('features/deep/nested.md'))
    assert.notEqual(noticeIndex, -1)
    const evidencePaths = ready.evidence.notices[noticeIndex].evidencePaths
    assert.throws(() => projectReadyProblems({ ...ready, evidence: { ...ready.evidence, notices: ready.evidence.notices.map((item, index) => index === noticeIndex ? { ...item, evidencePaths: evidencePaths.map((path, pathIndex) => pathIndex === 0 ? `.claude/${path}` : path) } : item) } }, catalog), /evidence|identity|parser/i)
    assert.throws(() => projectReadyProblems({ ...ready, evidence: { ...ready.evidence, notices: ready.evidence.notices.map((item, index) => index === noticeIndex ? { ...item, evidencePaths: evidencePaths.map((path, pathIndex) => pathIndex === 0 ? 'BUGS.md' : path) } : item) } }, catalog), /evidence|identity|parser/i)
  })

  test('legacy migration projection accepts only parser-owned qualifying facts', () => {
    const catalog = [{ target: 'FEATURES.md', contents: '## Implemented\nentry\n' }]
    const ready = analyzeCatalog(catalog)
    assert.equal(projectReadyProblems(ready, catalog).problems[0].code, 'legacy-history-migration')
    assert.throws(() => projectReadyProblems({ ...ready, legacyHistory: [{ indexPath: '.claude/FEATURES.md', historyPath: '.claude/FEATURES_HISTORY.md' }], evidence: { ...ready.evidence, legacyHistory: [] } }, catalog), /legacy|parser|evidence/i)
    for (const fact of [
      { indexPath: '.claude/BUGS.md', historyPath: '.claude/FEATURES_HISTORY.md' },
      { indexPath: '.claude/FEATURES.md', historyPath: '.claude/FEATURES_HISTORY.md', extra: true },
    ]) {
      assert.throws(() => projectReadyProblems({ ...ready, evidence: { ...ready.evidence, legacyHistory: [fact] } }, catalog), /legacy|history|evidence/i)
    }
  })

  test('unclosed opaque blocks obscure required section and preamble boundaries only', () => {
    const section = { regionId: 'section', syntax: 'markdown-section', heading: '## Section', missingPlacement: 'end', semantic: true }
    assert.throws(() => inspectRegions(Buffer.from('## Section\nbody\n```\n## Tail\n', 'utf8'), [section]), (error) => error.code === 'structural-invalid')
    assert.throws(() => inspectRegions(Buffer.from('## Section\nbody\n```\nTail\n====\n', 'utf8'), [section]), (error) => error.code === 'structural-invalid')
    assert.deepEqual(inspectRegions(Buffer.from('## Existing\nbody\n```\n', 'utf8'), [{ regionId: 'preamble', syntax: 'markdown-preamble', heading: '# Missing', missingPlacement: 'start', semantic: true }]), [{ endByte: 0, regionId: 'preamble', startByte: 0 }])
    assert.throws(() => inspectRegions(Buffer.from('```\n# Hidden boundary\n', 'utf8'), [{ regionId: 'preamble', syntax: 'markdown-preamble', heading: '# Missing', missingPlacement: 'start', semantic: true }]), (error) => error.code === 'structural-invalid')
  })

  test('newline policies keep the exact four-field schema and admission selects one alternative', () => {
    const policy = resolveNewlinePolicy({ kind: 'non-git', siblingStyles: ['lf', 'crlf'], target: 'AGENTS.md' })
    assert.deepEqual(Object.keys(policy).sort(), ['mode', 'source', 'style', 'target'])
    assert.equal(policy.proposals, undefined)
    const proposals = [
      { action: { id: 'p-' + '1'.repeat(62), kind: 'create-from-template', mode: null, newline: 'lf', target: 'AGENTS.md', templateId: 'backlog.bugs' }, condition: 'newline-lf', proposalId: 'p-' + '1'.repeat(62), reason: 'missing-target' },
      { action: { id: 'p-' + '2'.repeat(62), kind: 'create-from-template', mode: null, newline: 'crlf', target: 'AGENTS.md', templateId: 'backlog.bugs' }, condition: 'newline-crlf', proposalId: 'p-' + '2'.repeat(62), reason: 'missing-target' },
    ]
    const lf = [{ disposition: 'selected', proposalId: proposals[0].proposalId }, { disposition: 'condition-not-selected', proposalId: proposals[1].proposalId }]
    const crlf = [{ disposition: 'condition-not-selected', proposalId: proposals[0].proposalId }, { disposition: 'selected', proposalId: proposals[1].proposalId }]
    assert.deepEqual(validateProposalDispositions(proposals, lf, { versionControlChoice: 'not-required' }), lf)
    assert.deepEqual(validateProposalDispositions(proposals, crlf, { versionControlChoice: 'not-required' }), crlf)
  })

  test('read-only guidance evidence may be hard-linked while controlled files remain single-linked', () => {
    const root = mkdtempSync(join(tmpdir(), 'nightshift-guidance-hardlink-'))
    try {
      mkdirSync(join(root, '.claude'), { recursive: true })
      writeFileSync(join(root, 'CLAUDE.md'), '@AGENTS.md\n')
      writeFileSync(join(root, 'AGENTS.md'), '')
      writeFileSync(join(root, 'CLAUDE.local.md'), '# Local\n')
      linkSync(join(root, 'CLAUDE.local.md'), join(root, 'guidance-alias.md'))
      const result = collectInspection(root, 'claude-code', { claudeContextSource: 'host-observed', claudeRootExclusionStatus: 'included' }, { candidates: [] })
      assert.equal(result.ok, true)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('delegated guidance inside controlled directories remains one semantic target', () => {
    for (const directory of ['bugs', 'features', 'patterns']) {
      const root = mkdtempSync(join(tmpdir(), `nightshift-guidance-${directory}-`))
      const target = `.claude/${directory}/CLAUDE.md`
      try {
        mkdirSync(join(root, '.claude', directory), { recursive: true })
        writeFileSync(join(root, 'CLAUDE.md'), `@${target}\n`)
        writeFileSync(join(root, '.claude', directory, 'CLAUDE.md'), '# Delegated guidance\n')

        const result = collectInspection(root, 'claude-code', { claudeContextSource: 'host-observed', claudeRootExclusionStatus: 'included' }, { candidates: [] })
        const records = result.targets.filter((item) => item.target === target)
        const templates = result.templates.filter((item) => item.target === target)

        assert.equal(result.guidance.resolvedTarget, target)
        assert.equal(records.length, 1)
        assert.equal(records[0].contentRole, 'semantic')
        assert.equal(records[0].templateId, 'guidance.claude')
        assert.equal(templates.length, 1)
        assert.equal(templates[0].templateId, 'guidance.claude')
      } finally {
        rmSync(root, { force: true, recursive: true })
      }
    }
  })

  test('a discovered breakout inspects as a present mechanical target', () => {
    inspectDiscoveredBreakout('nightshift-breakout-present-', '# Issue\n\nOne unwrapped paragraph on one physical line.\n', (result) => {
      const record = result.targets.find((item) => item.target === '.claude/bugs/issue.md')

      assert.deepEqual(record.states, ['present'])
      assert.equal(record.kind, 'file')
      assert.equal(record.contentRole, 'mechanical')
      assert.equal(record.rawSha256, sha256(Buffer.from('# Issue\n\nOne unwrapped paragraph on one physical line.\n', 'utf8')))
      assert.equal(result.ready.notices.some((notice) => notice.includes('bugs/issue.md')), false)
      assert.deepEqual(result.ready.structuralErrors, [])
    })
  })

  test('an inspection without wrap findings omits the duplicate ready prediction', () => {
    inspectDiscoveredBreakout('nightshift-breakout-no-wrap-prediction-', '# Issue\n\nOne unwrapped paragraph on one physical line.\n', (result) => {
      assert.deepEqual(result.wrapFindings, [])
      assert.deepEqual(result.unwrapReady, { after: null, targets: [] })
    })
  })

  test('semantic controlled files accept the inline boundary and reject its next byte', () => {
    const exact = sizedMarkdown('# Guidance', MAX_INLINE_FILE_BYTES)
    inspectSemanticGuidance('nightshift-semantic-boundary-', exact, (result) => {
      const record = result.targets.find((item) => item.target === 'CLAUDE.md')
      assert.equal(Buffer.from(record.contentBase64, 'base64').length, MAX_INLINE_FILE_BYTES)
    })
    assert.throws(
      () => inspectSemanticGuidance('nightshift-semantic-overflow-', Buffer.concat([exact, Buffer.from('x')]), () => {}),
      (error) => error.record?.code === 'payload-too-large' && error.record?.phase === 'inspect' && error.record?.target === 'CLAUDE.md',
    )
  })

  test('mechanical breakout files accept their governed boundary and reject its next byte', () => {
    const exact = sizedMarkdown('# Issue', MAX_BREAKOUT_FILE_BYTES)
    inspectDiscoveredBreakout('nightshift-mechanical-boundary-', exact, (result) => {
      const record = result.targets.find((item) => item.target === '.claude/bugs/issue.md')
      assert.equal(record.contentBase64, null)
      assert.equal(record.rawSha256, sha256(exact))
    })
    assert.throws(
      () => inspectDiscoveredBreakout('nightshift-mechanical-overflow-', Buffer.concat([exact, Buffer.from('x')]), () => {}),
      (error) => error.record?.code === 'payload-too-large' && error.record?.phase === 'inspect' && error.record?.target === '.claude/bugs/issue.md',
    )
  })

  test('feature breakout files accept the doubled inspection boundary', () => {
    const exact = sizedMarkdown('# Large feature', 262144)
    inspectDiscoveredFeature('nightshift-feature-boundary-', exact, (result) => {
      const record = result.targets.find((item) => item.target === '.claude/features/large-feature.md')
      assert.equal(record.contentBase64, null)
      assert.equal(record.rawSha256, sha256(exact))
    })
  })

  test('oversized feature breakouts become nonblocking incomplete-validation notices', () => {
    const oversized = sizedMarkdown('# Large feature', 262145)
    inspectDiscoveredFeature('nightshift-feature-opaque-', oversized, (result) => {
      const target = '.claude/features/large-feature.md'
      assert.equal(result.targets.some((item) => item.target === target), false)
      assert.equal(result.proposals.some((item) => item.action.target === target), false)
      assert.equal(result.ready.ready.some((item) => item.title === 'Large feature'), true)
      assert.deepEqual(result.problems.filter((item) => item.target === target), [{
        blocking: false,
        code: 'ready-notice',
        detail: 'Feature breakout is 262145 bytes, above the 262144-byte inspection limit; the file was left untouched and hard-wrap and breakout-hygiene checks were skipped.',
        evidencePaths: [target],
        target,
      }])
      assert.deepEqual(result.warnings.filter((item) => item.code === 'nonblocking-ready-notice'), [{ code: 'nonblocking-ready-notice', detail: '1 ready notice remains.', target }])
    })
  })

  test('a hard-wrapped discovered breakout yields a mechanical unwrap proposal', () => {
    const wrapped = '# Issue\n\nThis paragraph is deliberately hard wrapped across\ntwo physical lines so the detector fires.\n'
    const unwrapped = '# Issue\n\nThis paragraph is deliberately hard wrapped across two physical lines so the detector fires.\n'
    inspectDiscoveredBreakout('nightshift-breakout-wrapped-', wrapped, (result) => {
      const record = result.targets.find((item) => item.target === '.claude/bugs/issue.md')
      assert.deepEqual(record.states, ['present', 'wrapped'])
      assert.deepEqual(result.wrapFindings, [{ target: '.claude/bugs/issue.md', count: 1, firstLine: 4, beforeRawSha256: sha256(Buffer.from(wrapped, 'utf8')), predictedRawSha256: sha256(Buffer.from(unwrapped, 'utf8')), predictedContentBase64: null, predictedEditableRegions: [] }])
      const unwrapProposals = result.proposals.filter((item) => item.action.kind === 'unwrap-file')
      assert.equal(unwrapProposals.length, 1)
      assert.equal(unwrapProposals[0].reason, 'hard-wrap')
      assert.equal(unwrapProposals[0].beforeBase64, null)
      assert.equal(unwrapProposals[0].afterBase64, null)
      assert.equal(unwrapProposals[0].action.target, '.claude/bugs/issue.md')
      assert.equal(unwrapProposals[0].action.beforeRawSha256, sha256(Buffer.from(wrapped, 'utf8')))
      assert.equal(unwrapProposals[0].action.afterRawSha256, sha256(Buffer.from(unwrapped, 'utf8')))
      assert.deepEqual(result.unwrapReady.targets, ['.claude/bugs/issue.md'])
    })
  })

  test('the ready catalog sees a discovered breakout body rather than a broken link', () => {
    inspectDiscoveredBreakout('nightshift-breakout-catalog-', '# Issue\n\n**Requires:** none.\n', (result) => {
      assert.equal(result.ready.structuralErrors.length, 1)
      assert.match(result.ready.structuralErrors[0].problem, /^breakout file bugs\/issue\.md carries a \*\*Requires:\*\* line \(line 3\)/)
      assert.equal(result.ready.notices.some((notice) => notice.includes('does not exist')), false)
    })
  })

  test('direct inspection serializes concurrent callers and maps initial-lock crash prefixes', () => {
    const root = mkdtempSync(join(tmpdir(), 'nightshift-inspect-prefixes-'))
    try {
      const record = { operation: 'inspect', ownerNonce: 'a'.repeat(32), pid: 1234, protocolVersion: 1, recoveryId: null, root, temporaryPaths: [], unfinalizedDirectories: [], manifestId: null }
      for (const transition of ['after-owner-stage-create', 'after-owner-stage-write']) {
        let observedStage
        assert.throws(() => createInitialLock(root, record, { onTransition: (point) => { if (point === transition) { observedStage = readdirSync(root).find((entry) => entry.startsWith('.nightshift-init-backlog.lock.') && entry.endsWith('.new')); throw new Error('injected crash') } } }), /injected crash/)
        assert.equal(typeof observedStage, 'string')
        assert.deepEqual(readdirSync(root), [])
      }
      let publishedPaths
      assert.throws(() => createInitialLock(root, record, { onPublished: (destination) => { publishedPaths = { lock: destination, stage: readdirSync(root).filter((entry) => entry.startsWith('.nightshift-init-backlog.lock.') && entry.endsWith('.new')).map((entry) => join(root, entry))[0] }; throw new Error('injected publication crash') } }), /injected publication crash/)
      assert.equal(existsSync(publishedPaths.lock), true)
      assert.equal(existsSync(publishedPaths.stage), false)
      removeInitialLock(root, publishedPaths, Buffer.from(`${canonicalJson(record)}\n`, 'utf8'))
      assert.equal(existsSync(publishedPaths.lock), false)
      let nested
      const inspectionRoot = mkdtempSync(join(tmpdir(), 'nightshift-inspect-concurrent-'))
      const context = codexHostContext()
      try {
        scaffoldInspectionRepository(inspectionRoot)
        const result = inspect(inspectionRoot, 'codex', context, { candidates: [], ownerNonce: 'b'.repeat(32), onCollection: (index) => { if (index === 1) { try { inspect(inspectionRoot, 'codex', context, { candidates: [], ownerNonce: 'c'.repeat(32) }) } catch (error) { nested = error } } } })
        assert.equal(result.ok, true)
        assert.equal(nested?.record?.code, 'runtime-lock')
        assert.equal(nested?.record?.phase, 'lock')
        assert.equal(existsSync(join(inspectionRoot, '.nightshift-init-backlog.lock')), false)
      } finally {
        rmSync(inspectionRoot, { force: true, recursive: true })
      }
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('initial lock uses one stage identity and cleans pre-publication failures', () => {
    const root = mkdtempSync(join(tmpdir(), 'nightshift-lock-boundaries-'))
    try {
      const record = { operation: 'inspect', ownerNonce: 'a'.repeat(32), pid: 1234, protocolVersion: 1, recoveryId: null, root, temporaryPaths: [], unfinalizedDirectories: [], manifestId: null }
      assert.throws(() => createInitialLock(root, record, { writeSync: () => { throw new Error('injected write failure') } }), /injected write failure/)
      assert.deepEqual(readdirSync(root), [])
      assert.throws(() => createInitialLock(root, record, { readFileSync: () => Buffer.from('different\n', 'utf8') }), /readback differs/)
      assert.deepEqual(readdirSync(root), [])
      const inspectBoundary = (name, options, expectedNames) => {
        const boundaryRoot = mkdtempSync(join(tmpdir(), `nightshift-lock-${name}-`))
        try {
          assert.throws(() => inspect(boundaryRoot, 'codex', codexHostContext(), { candidates: [], pid: record.pid, ownerNonce: record.ownerNonce, ...options }), (error) => error.record?.code === 'filesystem' && error.record?.phase === 'lock' && error.record?.target === '.nightshift-init-backlog.lock')
          assert.deepEqual(readdirSync(boundaryRoot).sort(), expectedNames)
        } finally {
          rmSync(boundaryRoot, { force: true, recursive: true })
        }
      }
      inspectBoundary('write', { writeSync: () => { throw new Error('injected write failure') } }, [])
      inspectBoundary('readback', { readFileSync: () => Buffer.from('different\n', 'utf8') }, [])
      inspectBoundary('publish', { linkSync: () => { throw new Error('injected publish failure') } }, [])
      const cleanupStage = `.nightshift-init-backlog.lock.${record.pid}.${record.ownerNonce}.new`
      inspectBoundary('cleanup', { unlinkSync: () => { throw new Error('injected cleanup failure') } }, ['.nightshift-init-backlog.lock', cleanupStage])
      const observed = []
      const isolatedRoot = mkdtempSync(join(tmpdir(), 'nightshift-lock-identity-'))
      try {
        scaffoldInspectionRepository(isolatedRoot)
        const context = codexHostContext()
        const result = inspect(isolatedRoot, 'codex', context, {
          candidates: [],
          pid: 1234,
          onTransition: (point) => {
            if (point !== 'after-owner-stage-write') return
            const name = readdirSync(isolatedRoot).find((entry) => entry.includes('.nightshift-init-backlog.lock.') && entry.endsWith('.new'))
            const staged = JSON.parse(readFileSync(join(isolatedRoot, name), 'utf8'))
            observed.push({ name, staged })
          },
        })
        assert.equal(result.ok, true)
      } finally {
        rmSync(isolatedRoot, { force: true, recursive: true })
      }
      assert.equal(observed.length, 1)
      assert.equal(observed[0].name, `.nightshift-init-backlog.lock.${observed[0].staged.pid}.${observed[0].staged.ownerNonce}.new`)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('election marker lifecycle distinguishes absent, stale, and non-Git invalid states', () => {
    const root = mkdtempSync(join(tmpdir(), 'nightshift-marker-lifecycle-'))
    try {
      assert.equal(readElectionMarker(root).marker, 'absent')
      const stale = 'd'.repeat(64)
      for (const state of ['deferred', 'track', 'ignore']) {
        writeFileSync(join(root, ELECTION_MARKER_PATH), `${canonicalJson(composeElectionRecord(state, root, stale))}\n`, { mode: 0o600 })
        const marker = readElectionMarker(root)
        assert.deepEqual({ marker: marker.marker, snapshotId: marker.snapshotId }, { marker: state, snapshotId: stale })
      }
      assert.throws(() => collectInspection(root, 'codex', codexHostContext(), { candidates: [] }), (error) => error.record?.code === 'runtime-marker' && error.record?.phase === 'inspect')
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  // The publication window is the only caller that tolerates an extra marker
  // link, and it tolerates exactly the witnesses it reserved. These three cases
  // pin the whole accounting: a link the caller owns passes, a link nobody
  // claims fails inside the window, and the strict single-link rule still holds
  // outside it.
  test('election marker link accounting admits owned witnesses and rejects foreign links', () => {
    const root = mkdtempSync(join(tmpdir(), 'nightshift-marker-links-'))
    try {
      const markerPath = join(root, ELECTION_MARKER_PATH)
      const snapshotId = 'e'.repeat(64)
      writeFileSync(markerPath, `${canonicalJson(composeElectionRecord('deferred', root, snapshotId))}\n`, { mode: 0o600 })
      const witness = join(root, '.nightshift-init-backlog.election.witness')
      linkSync(markerPath, witness)

      const accounted = readElectionMarker(root, { electionWitnesses: [witness] })
      assert.deepEqual({ marker: accounted.marker, snapshotId: accounted.snapshotId }, { marker: 'deferred', snapshotId }, 'a witness sharing the marker identity accounts for its own link')

      assert.throws(
        () => readElectionMarker(root, { electionWitnesses: [] }),
        (error) => error.message === 'Election marker metadata failed' && error.cause?.message !== undefined,
        'outside the publication window the marker must still be strictly single-linked',
      )

      const intruder = join(root, 'intruder.link')
      linkSync(markerPath, intruder)
      assert.throws(
        () => readElectionMarker(root, { electionWitnesses: [witness] }),
        (error) => error.message === 'Election marker metadata failed' && error.cause?.message === 'Election marker carries a hard link the controller does not own',
        'a link no reserved witness claims must fail closed even inside the publication window',
      )
      assert.throws(
        () => collectInspection(root, 'codex', codexHostContext(), { candidates: [], electionWitnesses: [witness] }),
        (error) => error.record?.code === 'runtime-marker' && error.record?.phase === 'inspect' && error.record?.detail === 'Election marker is invalid.',
        'the foreign link must surface as runtime-marker through the inspection flow',
      )
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('election marker reads stop at the inline-file ceiling', () => {
    for (const extraBytes of [0, 1]) {
      const root = mkdtempSync(join(tmpdir(), 'nightshift-marker-bound-'))
      try {
        writeFileSync(join(root, ELECTION_MARKER_PATH), Buffer.alloc(MAX_INLINE_FILE_BYTES + extraBytes, 0x61), { mode: 0o600 })

        assert.throws(
          () => readElectionMarker(root),
          (error) => extraBytes === 0 ? error.cause?.code !== 'file-too-large' : error.cause?.code === 'file-too-large',
        )
      } finally {
        rmSync(root, { force: true, recursive: true })
      }
    }
  })

  test('guidance newline evidence preserves the guidance byte ceiling after initial resolution', () => {
    for (const extraBytes of [0, 1]) {
      const root = mkdtempSync(join(tmpdir(), 'nightshift-guidance-reopen-bound-'))
      try {
        const path = join(root, 'CLAUDE.md')
        writeFileSync(path, '# Initial\n')
        const options = { candidates: [] }
        Object.defineProperty(options, 'ignoreProbes', {
          get() {
            writeFileSync(path, sizedMarkdown('# Instructions', MAX_INLINE_FILE_BYTES + extraBytes))

            return []
          },
        })

        if (extraBytes === 0) {
          assert.equal(collectInspection(root, 'claude-code', { claudeContextSource: 'host-observed', claudeRootExclusionStatus: 'included' }, options).ok, true)
        } else {
          assert.throws(
            () => collectInspection(root, 'claude-code', { claudeContextSource: 'host-observed', claudeRootExclusionStatus: 'included' }, options),
            (error) => error.record?.code === 'git-policy' && error.cause?.code === 'file-too-large',
          )
        }
      } finally {
        rmSync(root, { force: true, recursive: true })
      }
    }
  })

  test('orphan lock-stage discovery validates an ordinary stable candidate before surfacing it', () => {
    const root = mkdtempSync(join(tmpdir(), 'nightshift-stage-'))
    const name = `.nightshift-init-backlog.lock.1234.${'b'.repeat(32)}.new`
    writeFileSync(join(root, name), '{"protocolVersion":1}\n', { mode: 0o600 })
    const stage = discoverInitialLockStage(root)
    assert.equal(stage, name)
    rmSync(root, { recursive: true, force: true })
  })

  test('valid stale election markers remain readable and carry their snapshot', () => {
    const root = mkdtempSync(join(tmpdir(), 'nightshift-marker-'))
    const snapshotId = 'c'.repeat(64)
    writeFileSync(join(root, ELECTION_MARKER_PATH), `${canonicalJson(composeElectionRecord('track', root, snapshotId))}\n`, { mode: 0o600 })
    const marker = readElectionMarker(root)
    assert.equal(marker.marker, 'track')
    assert.equal(marker.snapshotId, snapshotId)
    rmSync(root, { recursive: true, force: true })
  })

  test('initial inspection lock publishes by no-replace identity and removes its stage', () => {
    const root = mkdtempSync(join(tmpdir(), 'nightshift-inspect-'))
    const record = { operation: 'inspect', ownerNonce: 'a'.repeat(32), pid: 1234, protocolVersion: 1, root }
    const lock = createInitialLock(root, record, { pid: 1234, ownerNonce: record.ownerNonce })
    assert.deepEqual(readFileSync(lock.paths.lock), lock.bytes)
    assert.deepEqual(initialLockPaths(root, 1234, record.ownerNonce), lock.paths)
    assert.equal(lock.paths.stage ? require('node:fs').existsSync(lock.paths.stage) : false, false)
    removeInitialLock(root, lock.paths, lock.bytes)
    assert.equal(require('node:fs').existsSync(lock.paths.lock), false)
  })

  test('initial lock publication rejects collisions and unsupported hard links', () => {
    assert.throws(() => publishNoReplace('stage', 'lock', { linkSync: () => { const error = new Error('exists'); error.code = 'EEXIST'; throw error } }), /collided/)
    assert.throws(() => publishNoReplace('stage', 'lock', { linkSync: () => { throw new Error('unsupported') } }), /unsupported/)
  })

  test('election record is canonical and binds snapshot, root, and state', () => {
    const root = 'C:\\checkout'
    const snapshotId = sha256(Buffer.from('snapshot'))
    const record = composeElectionRecord('ignore', root, snapshotId)
    assert.equal(canonicalJson(record), `{"protocolVersion":1,"root":${JSON.stringify(root)},"snapshotId":"${snapshotId}","state":"ignore"}`)
    assert.equal(record.protocolVersion, 1)
  })

  test('election marker uses explicit platform mode and canonical content', () => {
    const marker = composeElectionMarker('ignore', 'git', true, 'a'.repeat(64), 0o600, 'C:\\checkout')
    assert.deepEqual(Object.keys(marker).sort(), ['classification', 'contentBase64', 'gitKind', 'mode', 'policyDigest', 'scaffoldPresent'].sort())
    assert.equal(marker.mode, 0o600)
    assert.equal(Buffer.from(marker.contentBase64, 'base64').toString('utf8'), '{"protocolVersion":1,"root":"C:\\\\checkout","snapshotId":"' + 'a'.repeat(64) + '","state":"ignore"}\n')
  })

  for (const marker of ['track', 'deferred']) {
    test(`the ignore-match blocker fires when the election marker is bound to ${marker}`, () => {
      const git = { kind: 'git', plansPolicy: 'satisfied', nonPlanIgnoreMatches: [{ pattern: '.claude/bugs/', probe: '.claude/bugs/probe.md', sourcePath: '.gitignore', target: '.claude/bugs' }], nonPlanUnignoredPaths: [], electionRequired: true, electionMarker: marker }
      const problem = projectGitProblems(git).find((item) => item.detail === 'Repository-local ignore rules match non-plan backlog paths.')
      assert.ok(problem !== undefined, `the ignore-match blocker must fire when the election marker is bound to ${marker}`)
      assert.equal(problem.blocking, true)
      assert.equal(problem.code, 'git-policy')
      assert.equal(problem.target, '.gitignore')
      assert.deepEqual(problem.evidencePaths, ['.claude/bugs', '.claude/bugs/probe.md'].sort())
    })
  }

  test('the ignore-match blocker does not fire when the election marker is bound to ignore', () => {
    const git = { kind: 'git', plansPolicy: 'satisfied', nonPlanIgnoreMatches: [{ pattern: '.claude/bugs/', probe: '.claude/bugs/probe.md', sourcePath: '.gitignore', target: '.claude/bugs' }], nonPlanUnignoredPaths: [], electionRequired: true, electionMarker: 'ignore' }
    const problem = projectGitProblems(git).find((item) => item.detail === 'Repository-local ignore rules match non-plan backlog paths.')
    assert.equal(problem, undefined, 'a marker bound to ignore must not raise the ignore-match blocker')
  })

  test('direct inspection collects a stable Git snapshot and removes its transient lock', () => {
    const root = mkdtempSync(join(tmpdir(), 'nightshift-inspect-stable-git-'))
    try {
      git(root, ['init', '--quiet'])
      mkdirSync(join(root, '.claude'))
      writeFileSync(join(root, 'AGENTS.md'), '# Instructions\n')

      const result = inspect(root, 'codex', codexHostContext(), {
        ownerNonce: 'f'.repeat(32),
        trustedGitPath: 'C:/Program Files/Git/cmd/git.exe',
      })

      assert.equal(result.ok, true)
      assert.equal(result.operation, 'inspect')
      assert.equal(result.git.kind, 'git')
      assert.equal(existsSync(join(root, '.nightshift-init-backlog.lock')), false)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('ordinary inspection classifies flat backups in deterministic order and ignores malformed entries', () => {
    const root = mkdtempSync(join(tmpdir(), 'nightshift-inspect-backups-'))
    const context = codexHostContext()
    const target = '.claude/FEATURES.md'
    const targetHash = sha256(Buffer.from(target, 'utf8'))
    const redundant = `.tmp/nightshift-init-backlog-unwrap-${'a'.repeat(64)}-${'b'.repeat(64)}-${targetHash}.bak`
    const divergent = `.tmp/nightshift-init-backlog-unwrap-${'c'.repeat(64)}-${'d'.repeat(64)}-${targetHash}.bak`
    const orphan = `.tmp/nightshift-init-backlog-unwrap-${'e'.repeat(64)}-${'f'.repeat(64)}-${'0'.repeat(64)}.bak`
    try {
      scaffoldInspectionRepository(root)
      const targetBytes = readFileSync(join(root, target))
      const targetMode = statSync(join(root, target)).mode & 0o777
      mkdirSync(join(root, '.tmp'), { mode: 0o700 })
      writeFileSync(join(root, ...redundant.split('/')), targetBytes, { mode: targetMode })
      writeFileSync(join(root, ...divergent.split('/')), Buffer.from('divergent backup\n', 'utf8'), { mode: targetMode })
      writeFileSync(join(root, ...orphan.split('/')), Buffer.from('orphan backup\n', 'utf8'), { mode: targetMode })
      writeFileSync(join(root, '.tmp', 'not-a-backup'), Buffer.from('ignored\n', 'utf8'), { mode: 0o600 })
      mkdirSync(join(root, '.tmp', 'nested'))

      const result = inspect(root, 'codex', context, { candidates: [], ownerNonce: 'a'.repeat(32) })

      assert.deepEqual(result.retainedBackups, [divergent, orphan, redundant].sort())
      assert.deepEqual(result.warnings.filter((item) => item.code === 'manual-cleanup').map((item) => item.target), [null])
      const problem = result.problems.find((item) => item.code === 'runtime-state')
      assert.equal(problem.blocking, true)
      assert.deepEqual(problem.evidencePaths, [divergent, target].sort())
      assert.equal(problem.target, target)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('backup inspection stable-opens a shared current target once per call', () => {
    const root = mkdtempSync(join(tmpdir(), 'nightshift-inspect-shared-backup-target-'))
    const target = '.claude/FEATURES.md'
    const targetPath = join(root, ...target.split('/'))
    try {
      mkdirSync(join(root, '.claude'), { recursive: true })
      mkdirSync(join(root, '.tmp'))
      writeFileSync(targetPath, Buffer.from('current\n', 'utf8'), { mode: 0o600 })
      const targetHash = sha256(Buffer.from(target, 'utf8'))
      const backups = [
        `.tmp/nightshift-init-backlog-unwrap-${'1'.repeat(64)}-${'2'.repeat(64)}-${targetHash}.bak`,
        `.tmp/nightshift-init-backlog-unwrap-${'3'.repeat(64)}-${'4'.repeat(64)}-${targetHash}.bak`,
      ]
      for (const backup of backups) writeFileSync(join(root, ...backup.split('/')), Buffer.from('backup\n', 'utf8'), { mode: 0o600 })

      withRecordedBackupStableOpens(({ inspectBackups }, openedTargets) => {
        const first = inspectBackups(root, [{ target }])
        const second = inspectBackups(root, [{ target }])

        assert.deepEqual(first.backups, backups)
        assert.deepEqual(second.backups, backups)
        assert.equal(openedTargets.filter((openedTarget) => openedTarget === targetPath).length, 2)
      })
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('backup inspection caches a missing shared current target once per call', () => {
    const root = mkdtempSync(join(tmpdir(), 'nightshift-inspect-missing-backup-target-'))
    const target = '.claude/MISSING.md'
    const targetPath = join(root, ...target.split('/'))
    try {
      mkdirSync(join(root, '.tmp'))
      const targetHash = sha256(Buffer.from(target, 'utf8'))
      const backups = [
        `.tmp/nightshift-init-backlog-unwrap-${'5'.repeat(64)}-${'6'.repeat(64)}-${targetHash}.bak`,
        `.tmp/nightshift-init-backlog-unwrap-${'7'.repeat(64)}-${'8'.repeat(64)}-${targetHash}.bak`,
      ]
      for (const backup of backups) writeFileSync(join(root, ...backup.split('/')), Buffer.from('backup\n', 'utf8'), { mode: 0o600 })

      withRecordedBackupStableOpens(({ inspectBackups }, openedTargets) => {
        const result = inspectBackups(root, [{ target }])

        assert.deepEqual(result.backups, backups)
        assert.deepEqual(result.problems, [])
        assert.equal(openedTargets.filter((openedTarget) => openedTarget === targetPath).length, 1)
      })
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('backup inspection fails closed when a shared current target is invalid', () => {
    const root = mkdtempSync(join(tmpdir(), 'nightshift-inspect-invalid-backup-target-'))
    const target = '.claude/FEATURES.md'
    try {
      mkdirSync(join(root, ...target.split('/')), { recursive: true })
      mkdirSync(join(root, '.tmp'))
      const targetHash = sha256(Buffer.from(target, 'utf8'))
      const backups = [
        `.tmp/nightshift-init-backlog-unwrap-${'9'.repeat(64)}-${'a'.repeat(64)}-${targetHash}.bak`,
        `.tmp/nightshift-init-backlog-unwrap-${'b'.repeat(64)}-${'c'.repeat(64)}-${targetHash}.bak`,
      ]
      for (const backup of backups) writeFileSync(join(root, ...backup.split('/')), Buffer.from('backup\n', 'utf8'), { mode: 0o600 })

      const { inspectBackups } = require(BACKUPS_MODULE_PATH)

      assert.throws(() => inspectBackups(root, [{ target }]), /ordinary nonlinked file/)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('backup inspection bounds every streamed directory entry and closes the handle on overflow', () => {
    const root = mkdtempSync(join(tmpdir(), 'nightshift-inspect-backup-entry-bound-'))
    const stream = streamedDirectory(Array.from({ length: 1025 }, (_, index) => Buffer.from(`unmatched-${index}`, 'utf8')))
    try {
      mkdirSync(join(root, '.tmp'))
      const { inspectBackups } = require(BACKUPS_MODULE_PATH)

      assert.throws(() => inspectBackups(root, [], { opendirSync: stream.open, platform: 'linux' }), (error) => error.code === 'directory-too-large')
      assert.equal(stream.state.reads, 1025)
      assert.equal(stream.state.closed, true)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('backup inspection admits a matching entry within a mixed directory at the total bound', () => {
    const root = mkdtempSync(join(tmpdir(), 'nightshift-inspect-backup-entry-boundary-'))
    const backup = `.tmp/nightshift-init-backlog-unwrap-${'d'.repeat(64)}-${'e'.repeat(64)}-${'f'.repeat(64)}.bak`
    const names = [...Array.from({ length: 1023 }, (_, index) => Buffer.from(`unmatched-${index}`, 'utf8')), Buffer.from(backup.slice('.tmp/'.length), 'utf8')]
    const stream = streamedDirectory(names)
    try {
      mkdirSync(join(root, '.tmp'))
      writeFileSync(join(root, ...backup.split('/')), Buffer.from('backup\n', 'utf8'), { mode: 0o600 })
      const { inspectBackups } = require(BACKUPS_MODULE_PATH)

      const result = inspectBackups(root, [], { opendirSync: stream.open, platform: 'linux' })

      assert.deepEqual(result.backups, [backup])
      assert.deepEqual(result.problems, [])
      assert.equal(stream.state.reads, 1024)
      assert.equal(stream.state.closed, true)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })
}

module.exports = { runInspectionCases }
