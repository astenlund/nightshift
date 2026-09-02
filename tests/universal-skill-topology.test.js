'use strict'

const assert = require('node:assert/strict')
const { execFileSync, spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const nodeFilesystem = require('node:fs')
const { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } = nodeFilesystem
const Module = require('node:module')
const { tmpdir } = require('node:os')
const nodePath = require('node:path')
const { dirname, join, relative } = require('node:path')
const test = require('node:test')

const { normalizeTestTemporaryDirectory } = require('./test-environment')

normalizeTestTemporaryDirectory()

const { PROCEDURE_REPLACEMENTS, PUBLIC_SKILLS, REVISE_ENGINE_RESOURCES, REVISE_WRAPPERS } = require('./entry-contract')
const { QUEUE_PROTOCOL_VERSION, QUEUE_STEPS, advanceQueue, bindImplementationAuditBase, createQueue, resumeQueue } = require('../skills/handover/handover-queue')
const { deriveImplementationTaskBrief, classifyImplementationRepository, resolveImplementationAuditBase, inspectImplementationBoundary, createImplementationScratch, ImplementationDispatchError } = require('../skills/handover/implementation-dispatch')
const {
  MAX_PLAN_BYTES,
  MAX_PLAN_CANDIDATE_BYTES,
  MAX_PLAN_CANDIDATES,
  capturePlanCandidateEvidence,
  deleteBoundPlan,
  establishPlanBinding,
  refreshPlanBinding,
  revalidatePlanBinding,
  writePlanProvenanceStamp,
} = require('../internal/plan-binding')
const { resolveTrustedExecutable } = require('../internal/filesystem-primitives')
const { runGit } = require('../internal/git-runner')

const REPOSITORY_ROOT = join(__dirname, '..')
const AGREEMENT_PATH = '../spec-agreement/SKILL.md'
const ENGINE_ROOT = join(REPOSITORY_ROOT, 'internal', 'revise')
const ENGINE_PATH = '../../internal/revise/SKILL.md'
const FIXTURE_ROOT = join(__dirname, 'fixtures', 'legacy-plugin-2.4.5')
const PUBLIC_SKILLS_ROOT = join(REPOSITORY_ROOT, 'skills')
const INIT_BACKLOG_APPROVAL_SENTENCE = 'Obtain explicit approval for the complete manifest before any `apply` request.'
const INIT_BACKLOG_WRITER_DISCLOSURE_SENTENCE = 'Before asking for approval, disclose the `external-writer-window`: project targets remain writable by external processes during controller publication, so a concurrent change can make a later action fail with `snapshot-drift` after earlier actions have landed; only a mechanical backlog-file repair batch has byte-exact aggregate restoration.'
const FABLE_RESERVATION_POLICY = 'Never dispatch Fable for reviewers, skeptics, verifiers, implementers, fixers, validators, or auxiliary agents. Fable is reserved for the user-interacting controller; retain the role-specific non-Fable model pins.'

function readRequiredFile(filePath) {
  return readFileSync(filePath, 'utf8')
}

function requireRegularFile(filePath) {
  const metadata = lstatSync(filePath)
  assert.equal(metadata.isSymbolicLink(), false, `${filePath} must not be a symbolic link`)
  assert.equal(metadata.isFile(), true, `${filePath} must be a regular file`)
}

function parseFrontmatter(filePath) {
  const content = readRequiredFile(filePath)
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(content)
  assert.notEqual(match, null, `${filePath} must contain YAML frontmatter`)
  const fields = Object.fromEntries(match[1].split(/\r?\n/).map((line) => {
    const separator = line.indexOf(':')
    assert.notEqual(separator, -1, `${filePath} has an invalid frontmatter field`)

    return [line.slice(0, separator), line.slice(separator + 1).trim().replace(/^"|"$/g, '')]
  }))

  return { body: match[2], fields }
}

function assertContainedByEngine(filePath) {
  const pathWithinEngine = relative(ENGINE_ROOT, filePath)
  assert.notEqual(pathWithinEngine, '', `${filePath} must be beneath the engine root`)
  assert.equal(pathWithinEngine.startsWith('..'), false, `${filePath} must be beneath the engine root`)
}

function requireAbsent(filePath) {
  assert.equal(existsSync(filePath), false, `${filePath} must be absent`)
}

function runtimeModuleClosure(entryPath) {
  const cacheSnapshot = new Map(Object.entries(require.cache))
  const originalLoad = Module._load
  const closure = new Set()
  for (const cachedPath of cacheSnapshot.keys()) {
    if (relative(REPOSITORY_ROOT, cachedPath).split(/[\\/]/)[0] !== '..' && cachedPath !== __filename) delete require.cache[cachedPath]
  }
  Module._load = function tracedLoad(request, parent, isMain) {
    const resolved = Module._resolveFilename(request, parent, isMain)
    const loaded = originalLoad.apply(this, arguments)
    if (typeof resolved === 'string' && relative(REPOSITORY_ROOT, resolved).split(/[\\/]/)[0] !== '..') closure.add(resolved)

    return loaded
  }
  try {
    require(entryPath)
  } finally {
    Module._load = originalLoad
    for (const cachedPath of Object.keys(require.cache)) delete require.cache[cachedPath]
    for (const [cachedPath, cachedModule] of cacheSnapshot) require.cache[cachedPath] = cachedModule
  }

  return [...closure]
}

function removeProcedureEnvelope(text) {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').replace(/\r?\n/g, '\n')
}

function extractHandoverProcedureTitles(body) {
  const normalizedBody = body.replace(/\r?\n/g, '\n')
  const procedureStart = normalizedBody.indexOf('## Procedure\n')
  assert.notEqual(procedureStart, -1, 'handover must define its procedure')
  const procedure = normalizedBody.slice(procedureStart + '## Procedure\n'.length)
  const nextSection = procedure.indexOf('\n## ')
  const steps = [...(nextSection === -1 ? procedure : procedure.slice(0, nextSection)).matchAll(/^(\d+)\. (.+)$/gm)]

  return steps.map((step, index) => {
    assert.equal(Number(step[1]), index + 1, 'handover procedure steps must be contiguous')
    const boldTitle = /^\*\*(.+?)\*\*/.exec(step[2])
    if (boldTitle !== null) {
      return boldTitle[1].replace(/\.$/, '')
    }
    const reviseTitle = /^`?\/nightshift:revise-([a-z-]+)`?:/.exec(step[2])
    assert.notEqual(reviseTitle, null, `handover procedure step ${step[1]} must have a queue title`)

    return `Revise ${reviseTitle[1].replace(/-/g, ' ')}`
  })
}

function assertHandoverCompletionStampPolicy(body) {
  const morningReportStart = body.indexOf('12. **Morning report.**')
  assert.notEqual(morningReportStart, -1, 'handover must retain the morning report step')
  const morningReport = body.slice(morningReportStart)
  const dedicated = 'For a dedicated spec file or backlog breakout file, invoke `writeProvenanceStamp`'
  const indexOnly = 'For an index-only backlog entry, do not invoke `writeProvenanceStamp`; emit a one-line note that the completion stamp was skipped and rely on the completed walk-and-remove archive move as the durable completion record.'

  assert.equal(countExact(morningReport, dedicated), 1, 'handover completion must stamp dedicated artifacts exactly once')
  assert.equal(countExact(morningReport, indexOnly), 1, 'handover completion must skip index-only stamps exactly once')
  assert.equal(morningReport.indexOf(dedicated) < morningReport.indexOf(indexOnly), true, 'handover completion must state the dedicated and index-only branches in order')
}

function countExact(text, value) {
  return text.split(value).length - 1
}

function assertFableReservationPolicy(dispatcherBodies) {
  for (const [owner, body] of dispatcherBodies) {
    assert.equal(countExact(body, FABLE_RESERVATION_POLICY), 1, `${owner} must reserve Fable for the user-interacting controller exactly once`)
  }
}

function assertInitBacklogScaffoldInventory(body) {
  const targetsStart = body.indexOf('## Targets\n')
  const processStart = body.indexOf('\n## Process\n', targetsStart)
  assert.notEqual(targetsStart, -1, 'init-backlog must define its scaffold targets')
  assert.notEqual(processStart, -1, 'init-backlog targets must precede its process')
  const targetsSection = body.slice(targetsStart, processStart)
  const lifecycleStart = targetsSection.indexOf('\nThe on-demand locations have different lifecycles:')
  assert.notEqual(lifecycleStart, -1, 'init-backlog must distinguish its scaffold inventory from target lifecycles')
  const inventorySection = targetsSection.slice(0, lifecycleStart)

  for (const directoryName of ['features', 'bugs', 'patterns', 'plans']) {
    assert.match(inventorySection, new RegExp('^- `\\.claude/' + directoryName + '/`:[^\\n]+$', 'm'), `init-backlog must target .claude/${directoryName}/ as a scaffold subdirectory`)
  }

  for (const archiveName of ['QUICK_WINS_HISTORY.md', 'FEATURES_HISTORY.md', 'BUGS_HISTORY.md']) {
    assert.equal(countExact(inventorySection, `\`${archiveName}\``), 1, `init-backlog must target .claude/${archiveName} as a top-level archive`)
  }
  assert.match(inventorySection, /archives \(single files, top-level under `\.claude\/`\)/, 'init-backlog must classify the history archives as top-level files')

  const approvalStep = `6. **Approve.** ${INIT_BACKLOG_WRITER_DISCLOSURE_SENTENCE} ${INIT_BACKLOG_APPROVAL_SENTENCE}`
  const applyStep = '7. **Apply.**'
  const approvalIndex = body.indexOf(approvalStep)
  const applyIndex = body.indexOf(applyStep)
  assert.equal(countExact(body, approvalStep), 1, 'init-backlog must require explicit approval before writes exactly once')
  assert.notEqual(applyIndex, -1, 'init-backlog must retain its apply step')
  assert.equal(approvalIndex < applyIndex, true, 'init-backlog must require explicit approval before Apply')
}

function normalizeProcedure(entryName, text) {
  let normalized = removeProcedureEnvelope(text)
  for (const [oldPhrase, newPhrase] of PROCEDURE_REPLACEMENTS[entryName]) {
    const occurrenceCount = countExact(normalized, oldPhrase)
    assert.notEqual(occurrenceCount, 0, `${entryName} normalization phrase is absent: ${oldPhrase}`)
    normalized = normalized.split(oldPhrase).join(newPhrase)
  }

  return normalized.replace(/\r?\n/g, '\n')
}

function normalizeCurrentProcedure(entryName, text) {
  const normalized = removeProcedureEnvelope(text)
  if (entryName === 'handover' || entryName === 'revise-lore') {
    return normalized.replace(`\n\n${FABLE_RESERVATION_POLICY}\n\n`, '\n\n')
  }

  return normalized
}

function listDirectChildDirectories(directoryPath) {
  return readdirSync(directoryPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(compareOrdinal)
}

function compareOrdinal(left, right) {
  if (left < right) {
    return -1
  }
  if (left > right) {
    return 1
  }

  return 0
}

function gitEnvelope({ error = null, signal = null, status = 0, stderr = Buffer.alloc(0), stdout = Buffer.alloc(0) } = {}) {
  return { error, signal, status, stderr, stdout }
}

function dispatchFilesystem(root, { markerEntries = new Map(), realRoot = root, rootError = null } = {}) {
  const ordinaryDirectory = { isDirectory: () => true, isFile: () => false, isReparsePoint: () => false, isSymbolicLink: () => false }

  return {
    realpathSync: {
      native(value) {
        if (rootError !== null) throw rootError

        return value === root ? realRoot : value
      },
    },
    lstatSync(value) {
      if (value === root) {
        if (rootError !== null) throw rootError

        return ordinaryDirectory
      }
      if (markerEntries.has(value)) {
        const entry = markerEntries.get(value)
        if (entry instanceof Error) throw entry

        return entry
      }
      const error = new Error(`Missing fixture path: ${value}`)
      error.code = 'ENOENT'
      throw error
    },
  }
}

function dispatchMarker(kind) {
  return {
    isDirectory: () => kind === 'directory',
    isFile: () => kind === 'file',
    isReparsePoint: () => kind === 'reparse',
    isSymbolicLink: () => kind === 'symbolic',
  }
}

function assertDispatchFailure(action, code, details) {
  assert.throws(action, (error) => {
    assert.equal(error instanceof ImplementationDispatchError, true)
    assert.equal(error.code, code)
    assert.deepEqual(error.details, details)

    return true
  })
}

function captureDispatchFailure(action, code, details) {
  let capturedError
  assertDispatchFailure(() => {
    try {
      return action()
    } catch (error) {
      capturedError = error
      throw error
    }
  }, code, details)

  return capturedError
}

function createImplementationBoundaryGit({
  calls = [],
  commits = [],
  diffPaths = new Map(),
  format = 'sha1',
  overrides = new Map(),
  root = 'C:\\audit-root',
  staged = Buffer.alloc(0),
  tip = 'b'.repeat(format === 'sha1' ? 40 : 64),
  tracked = Buffer.alloc(0),
} = {}) {
  const nul = String.fromCharCode(0)
  let verifyCount = 0

  return (_repositoryRoot, args, input) => {
    let operation
    if (args[0] === 'rev-parse' && args[1] === '--show-object-format=storage') operation = 'show-object-format'
    else if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') operation = 'show-toplevel'
    else if (args[0] === 'check-ignore') operation = input.equals(Buffer.from(`.tmp/nightshift-implementation-policy-probe${nul}`, 'utf8')) ? 'check-root-ignore' : 'check-superpowers-ignore'
    else if (args[0] === 'diff') operation = 'list-staged-scratch'
    else if (args[0] === 'rev-parse' && args[1] === '--verify') {
      verifyCount += 1
      operation = verifyCount === 1 ? 'resolve-tip' : 'recheck-tip'
    } else if (args[0] === 'cat-file') operation = 'check-object'
    else if (args[0] === 'merge-base') operation = 'check-ancestry'
    else if (args[0] === 'rev-list') operation = 'list-commits'
    else if (args[0] === 'diff-tree') operation = 'list-commit-paths'
    else if (args[0] === 'ls-files') operation = 'check-scratch-tracked'
    else throw new Error(`Unexpected Git arguments: ${args.join(' ')}`)
    calls.push({ args: [...args], input, operation })
    if (overrides.has(operation)) {
      const override = overrides.get(operation)

      return typeof override === 'function' ? override({ args, input, operation }) : override
    }
    if (operation === 'show-object-format') return gitEnvelope({ stdout: Buffer.from(`${format}\n`) })
    if (operation === 'show-toplevel') return gitEnvelope({ stdout: Buffer.from(`${root}\n`) })
    if (operation === 'check-root-ignore') return gitEnvelope({ stdout: Buffer.from(['.gitignore', '1', '/.tmp/', '.tmp/nightshift-implementation-policy-probe'].join(nul) + nul) })
    if (operation === 'check-superpowers-ignore') return gitEnvelope({ stdout: Buffer.from(['.gitignore', '2', '/.superpowers/', '.superpowers/nightshift-implementation-policy-probe'].join(nul) + nul) })
    if (operation === 'list-staged-scratch') return gitEnvelope({ stdout: Buffer.from(staged) })
    if (operation === 'resolve-tip' || operation === 'recheck-tip') return gitEnvelope({ stdout: Buffer.from(`${tip}\n`) })
    if (operation === 'list-commits') return gitEnvelope({ stdout: Buffer.from(commits.length === 0 ? '' : `${commits.join('\n')}\n`) })
    if (operation === 'list-commit-paths') {
      const commit = args[args.indexOf('-r') + 1]
      const paths = diffPaths.get(commit) ?? []

      return gitEnvelope({ stdout: Buffer.from(paths.length === 0 ? '' : `${paths.join(nul)}${nul}`) })
    }
    if (operation === 'check-scratch-tracked') return gitEnvelope({ stdout: Buffer.from(tracked) })

    return gitEnvelope()
  }
}

function assertCurrentPathsAreAbsent(filePath) {
  const text = readRequiredFile(filePath)
  assert.equal(text.includes('commands/'), false, `${filePath} must not reference commands/`)
  assert.equal(text.includes('skills/revise/'), false, `${filePath} must not reference skills/revise/`)
}

test('public topology exposes only the ten public skills and no legacy command tree', () => {
  assert.deepEqual(listDirectChildDirectories(PUBLIC_SKILLS_ROOT), [...PUBLIC_SKILLS].sort(compareOrdinal))
  requireAbsent(join(REPOSITORY_ROOT, 'commands'))
  requireAbsent(join(PUBLIC_SKILLS_ROOT, 'revise'))

  for (const skillName of PUBLIC_SKILLS) {
    const skillPath = join(PUBLIC_SKILLS_ROOT, skillName, 'SKILL.md')
    requireRegularFile(skillPath)
    const { fields } = parseFrontmatter(skillPath)
    assert.equal(fields.name, skillName)
  }

  for (const bundledPath of [
    join(PUBLIC_SKILLS_ROOT, 'handover', 'handover-queue.js'),
    join(PUBLIC_SKILLS_ROOT, 'handover', 'implementation-dispatch.js'),
    join(PUBLIC_SKILLS_ROOT, 'spec-agreement', 'spec-agreement.js'),
    join(PUBLIC_SKILLS_ROOT, 'spec-agreement', 'spec-agreement.test.js'),
    join(PUBLIC_SKILLS_ROOT, 'spec-agreement', 'fixtures', 'fingerprint-v1.json'),
  ]) {
    requireRegularFile(bundledPath)
  }
})

test('implementation dispatch derives task briefs', () => {
  const byteRangeCases = [
    {
      heading: '### Task 1: First task',
      plan: '# Plan\n\u00e9\n### Task 1: First task\r\nbody\r\n\n### Task 2: Second task\r\nnext\r\n',
      title: 'First task',
      want: '### Task 1: First task\r\nbody\r\n\n',
    },
    {
      heading: '### Task 2: Stops at level two',
      plan: '# Plan\n### Task 2: Stops at level two\nbody\n## Verification\nrest\n',
      title: 'Stops at level two',
      want: '### Task 2: Stops at level two\nbody\n',
    },
    {
      heading: '### Task 3: Keeps malformed and fenced headings',
      plan: '### Task 3: Keeps malformed and fenced headings\nbody\n### Task 04: malformed\n```\n### Task 4: fenced\n```\ntail',
      title: 'Keeps malformed and fenced headings',
      want: '### Task 3: Keeps malformed and fenced headings\nbody\n### Task 04: malformed\n```\n### Task 4: fenced\n```\ntail',
    },
  ]
  for (const vector of byteRangeCases) {
    const result = deriveImplementationTaskBrief({ planBytes: Buffer.from(vector.plan), taskHeading: vector.heading })
    assert.equal(result.taskTitle, vector.title)
    assert.deepEqual(result.briefBytes, Buffer.from(vector.want))
  }

  for (const vector of [
    { heading: '### Task 1: x', title: 'x' },
    { heading: '### Task 999999999: Last ordinal', title: 'Last ordinal' },
    { heading: `### Task 7: ${'a'.repeat(1024)}`, title: 'a'.repeat(1024) },
  ]) {
    const result = deriveImplementationTaskBrief({ planBytes: Buffer.from(`${vector.heading}\nbody\n`), taskHeading: vector.heading })
    assert.equal(result.taskTitle, vector.title)
    assert.deepEqual(result.briefBytes, Buffer.from(`${vector.heading}\nbody\n`))
  }

  const distinctHeadings = [
    { heading: '### Task 1: Same task', title: 'Same task' },
    { heading: '### Task 2: same task', title: 'same task' },
    { heading: '### Task 3: Same  task', title: 'Same  task' },
    { heading: '### Task 4: \u00e9', title: '\u00e9' },
    { heading: '### Task 5: e\u0301', title: 'e\u0301' },
  ]
  const distinctPlan = Buffer.from(`${distinctHeadings.map((vector) => vector.heading).join('\nbody\n')}\nbody\n`)
  for (const vector of distinctHeadings) {
    const result = deriveImplementationTaskBrief({ planBytes: distinctPlan, taskHeading: vector.heading })
    assert.equal(result.taskTitle, vector.title)
  }

  const duplicateSemanticTitle = Buffer.from('### Task 1: Same\nbody\n### Task 2: Same\nbody\n')
  assertDispatchFailure(
    () => deriveImplementationTaskBrief({ planBytes: duplicateSemanticTitle, taskHeading: '### Task 1: Same' }),
    'dispatch-input',
    { field: 'taskId', reason: 'invalid-task-heading' },
  )
  const duplicateExactHeading = Buffer.from('### Task 1: Same\nbody\n### Task 1: Same\nbody\n')
  assertDispatchFailure(
    () => deriveImplementationTaskBrief({ planBytes: duplicateExactHeading, taskHeading: '### Task 1: Same' }),
    'dispatch-input',
    { field: 'taskId', reason: 'invalid-task-heading' },
  )

  const maximumHeading = '### Task 1: Maximum plan'
  const maximumPlan = Buffer.concat([Buffer.from(`${maximumHeading}\n`), Buffer.alloc(2097152 - Buffer.byteLength(`${maximumHeading}\n`), 0x78)])
  const maximumResult = deriveImplementationTaskBrief({ planBytes: maximumPlan, taskHeading: maximumHeading })
  assert.equal(maximumResult.briefBytes.length, 2097152)
  assert.equal(maximumResult.briefBytes.subarray(0, Buffer.byteLength(`${maximumHeading}\n`)).toString(), `${maximumHeading}\n`)
  assert.equal(maximumResult.briefBytes[2097151], 0x78)

  for (const vector of [
    { heading: '### Task 3: Missing', plan: '### Task 1: Present\n', reason: 'missing' },
    { heading: '### Task 1: x', plan: '```\n### Task 1: x\n```\n', reason: 'fenced-only' },
    { heading: '### Task 0: x', reason: 'zero ordinal' },
    { heading: '### Task 01: x', reason: 'leading zero' },
    { heading: '### Task 1000000000: x', reason: 'ordinal overflow' },
    { heading: '## Task 1: x', reason: 'wrong heading level' },
    { heading: '### task 1: x', reason: 'wrong prefix case' },
    { heading: '#### Task 1: x', reason: 'extra prefix marker' },
    { heading: '###  Task 1: x', reason: 'extra prefix space' },
    { heading: '### Task  1: x', reason: 'extra ordinal space' },
    { heading: '### Task\t1: x', reason: 'prefix tab' },
    { heading: '### Task 1:x', reason: 'missing delimiter space' },
    { heading: '### Task 1 : x', reason: 'space before delimiter' },
    { heading: '### Task 1:  x', reason: 'extra delimiter space' },
    { heading: '### Task 1:\tx', reason: 'delimiter tab' },
    { heading: '### Task 1: ', reason: 'empty title' },
    { heading: '### Task 1: x ', reason: 'trailing ASCII whitespace' },
    { heading: '### Task 1:  x', reason: 'leading ASCII whitespace' },
    { heading: '### Task 1: \u00a0x', reason: 'leading ECMAScript whitespace' },
    { heading: '### Task 1: x\u00a0', reason: 'trailing ECMAScript whitespace' },
    { heading: '### Task 1: x\n', reason: 'LF terminator' },
    { heading: '### Task 1: x\r', reason: 'CR terminator' },
    { heading: '### Task 1: x\u2028', reason: 'line separator' },
    { heading: '### Task 1: x\u2029', reason: 'paragraph separator' },
    { heading: '### Task 1: x\u0000', reason: 'NUL control' },
    { heading: '### Task 1: x\u007f', reason: 'DEL control' },
    { heading: '### Task 1: x\u0085', reason: 'C1 control' },
    { heading: `### Task 1: ${'b'.repeat(1025)}`, reason: 'title overflow' },
  ]) {
    const vectorPlan = Buffer.from(vector.plan ?? `${vector.heading}\n`)
    assertDispatchFailure(
      () => deriveImplementationTaskBrief({ planBytes: vectorPlan, taskHeading: vector.heading }),
      'dispatch-input',
      { field: 'taskId', reason: 'invalid-task-heading' },
    )
  }

  for (const vector of [
    { planBytes: 'text', details: { field: 'planBytes', reason: 'not-buffer' } },
    { planBytes: Buffer.alloc(0), details: { field: 'planBytes', reason: 'empty-buffer' } },
    { planBytes: Buffer.alloc(2097153), details: { field: 'planBytes', reason: 'too-large' } },
  ]) {
    assertDispatchFailure(
      () => deriveImplementationTaskBrief({ planBytes: vector.planBytes, taskHeading: '### Task 1: x' }),
      'dispatch-input',
      vector.details,
    )
  }
})

test('implementation dispatch allocates isolated scratch', () => {
  const root = mkdtempSync(join(tmpdir(), 'nightshift-implementation-scratch-'))
  const repositoryRoot = join(root, 'repository')
  mkdirSync(join(repositoryRoot, '.tmp'), { recursive: true })
  const validUuid = '123e4567-e89b-42d3-a456-426614174000'
  try {
    const result = createImplementationScratch({ dispatchId: 'dispatch', repositoryRoot, taskId: 'task' }, { uuid: () => validUuid })
    assert.equal(result.relativePath, '.tmp/implementation-0ebb429fa86d-db8d1b6d64e4-123e4567-e89b-42d3-a456-426614174000')
    assert.equal(result.absolutePath, join(repositoryRoot, result.relativePath))
    assert.equal(lstatSync(result.absolutePath).isDirectory(), true)

    const unicode = createImplementationScratch({ dispatchId: 'dispatch', repositoryRoot, taskId: '\u00c5' }, { uuid: () => validUuid.replace('000', '001') })
    assert.equal(unicode.relativePath, '.tmp/implementation-0a94dc9d420d-db8d1b6d64e4-123e4567-e89b-42d3-a456-426614174001')
    const decomposed = createImplementationScratch({ dispatchId: 'dispatch', repositoryRoot, taskId: 'A\u030a' }, { uuid: () => validUuid.replace('000', '002') })
    assert.notEqual(decomposed.relativePath, unicode.relativePath)
    const swapped = createImplementationScratch({ dispatchId: 'task', repositoryRoot, taskId: 'dispatch' }, { uuid: () => validUuid.replace('000', '003') })
    assert.notEqual(swapped.relativePath, result.relativePath)

    for (const value of ['', 'x'.repeat(1025), 1, ...[0x0000, 0x000a, 0x007f, 0x0085].map((codePoint) => String.fromCharCode(codePoint))]) {
      assertDispatchFailure(() => createImplementationScratch({ dispatchId: 'dispatch', repositoryRoot, taskId: value }, { uuid: () => validUuid }), 'dispatch-input', { field: 'taskId', reason: 'invalid-task-id' })
    }
    for (const value of ['', 'x'.repeat(1025), 1, ...[0x0000, 0x000a, 0x007f, 0x0085].map((codePoint) => String.fromCharCode(codePoint))]) {
      assertDispatchFailure(() => createImplementationScratch({ dispatchId: value, repositoryRoot, taskId: 'task' }, { uuid: () => validUuid }), 'dispatch-input', { field: 'dispatchId', reason: 'invalid-dispatch-id' })
    }
    assertDispatchFailure(() => createImplementationScratch({ dispatchId: String.fromCharCode(0x0085), repositoryRoot, taskId: String.fromCharCode(0x000a) }, { uuid: () => validUuid }), 'dispatch-input', { field: 'taskId', reason: 'invalid-task-id' })
    assertDispatchFailure(() => createImplementationScratch({ dispatchId: '', repositoryRoot: 'relative', taskId: '' }, { uuid: () => validUuid }), 'dispatch-input', { field: 'taskId', reason: 'invalid-task-id' })
    assertDispatchFailure(() => createImplementationScratch({ dispatchId: 'dispatch', repositoryRoot: `${repositoryRoot}${nodePath.sep}.`, taskId: 'task' }, { uuid: () => validUuid }), 'dispatch-input', { field: 'repositoryRoot', reason: 'not-canonical-root' })
    for (const uuid of [null, '123E4567-E89B-42D3-A456-426614174000', '123e4567-e89b-52d3-a456-426614174000', 'bad']) {
      assertDispatchFailure(() => createImplementationScratch({ dispatchId: 'dispatch', repositoryRoot, taskId: 'task' }, { uuid: () => uuid }), 'scratch-allocation', { cause: 'invalid-uuid', path: join(repositoryRoot, '.tmp', 'implementation-0ebb429fa86d-db8d1b6d64e4-') })
    }

    const collisionFilesystem = { ...nodeFilesystem, mkdirSync: () => { const error = new Error('exists'); error.code = 'EEXIST'; throw error } }
    assertDispatchFailure(() => createImplementationScratch({ dispatchId: 'dispatch', repositoryRoot, taskId: 'task' }, { filesystem: collisionFilesystem, uuid: () => validUuid }), 'scratch-allocation', { cause: 'create-failed', path: join(repositoryRoot, '.tmp', 'implementation-0ebb429fa86d-db8d1b6d64e4-123e4567-e89b-42d3-a456-426614174000') })
    assert.equal(Object.hasOwn(require('../skills/handover/implementation-dispatch'), 'cleanupImplementationScratch'), false)
    assert.equal(Object.hasOwn(require('../skills/handover/implementation-dispatch'), 'scanImplementationScratch'), false)
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})

test('implementation dispatch allocation matrix rejects unsafe filesystem states', () => {
  const repositoryRoot = nodePath.resolve('C:/allocation-matrix-root')
  const parent = join(repositoryRoot, '.tmp')
  const uuid = '123e4567-e89b-42d3-a456-426614174000'
  const ordinary = dispatchMarker('directory')
  const makeFilesystem = (states = {}, calls = []) => {
    const created = new Set()

    return {
    lstatSync(path) {
      calls.push(['lstat', path])
      const state = Object.hasOwn(states, path) ? states[path] : (created.has(path) ? ordinary : path === repositoryRoot || path === parent ? ordinary : null)
      if (state instanceof Error) throw state
      if (state === null) { const error = new Error('missing'); error.code = 'ENOENT'; throw error }

      return state
    },
    realpathSync: { native(path) { calls.push(['realpath', path]); return states.realpath?.[path] ?? path } },
    mkdirSync(path, options) { calls.push(['mkdir', path, options]); if (states.mkdir instanceof Error) throw states.mkdir; created.add(path) },
    }
  }
  const allocate = (filesystem, input = { dispatchId: 'dispatch', repositoryRoot, taskId: 'task' }) => createImplementationScratch(input, { filesystem, uuid: () => uuid })
  const assertCause = (action, code, details) => assertDispatchFailure(action, code, details)

  for (const [value, reason] of [['relative', 'not-canonical-root'], [`${repositoryRoot}${nodePath.sep}.`, 'not-canonical-root']]) {
    assertCause(() => allocate(makeFilesystem(), { dispatchId: 'dispatch', repositoryRoot: value, taskId: 'task' }), 'dispatch-input', { field: 'repositoryRoot', reason })
  }
  for (const [state, cause] of [[Object.assign(new Error('missing'), { code: 'ENOENT' }), 'root-unavailable'], [dispatchMarker('file'), 'root-not-ordinary'], [dispatchMarker('symbolic'), 'root-not-ordinary'], [dispatchMarker('reparse'), 'root-not-ordinary']]) {
    assertCause(() => allocate(makeFilesystem({ [repositoryRoot]: state })), 'scratch-allocation', { cause, path: repositoryRoot })
  }
  assertCause(() => allocate(makeFilesystem({ realpath: { [repositoryRoot]: 'C:/alias' } })), 'scratch-allocation', { cause: 'root-alias', path: repositoryRoot })

  for (const [state, cause] of [[null, 'tmp-missing'], [Object.assign(new Error('denied'), { code: 'EACCES' }), 'tmp-missing'], [dispatchMarker('file'), 'tmp-not-ordinary'], [dispatchMarker('symbolic'), 'tmp-not-ordinary'], [dispatchMarker('reparse'), 'tmp-not-ordinary']]) {
    assertCause(() => allocate(makeFilesystem({ [parent]: state })), 'scratch-allocation', { cause, path: parent })
  }
  assertCause(() => allocate(makeFilesystem({ realpath: { [parent]: 'C:/tmp-alias' } })), 'scratch-allocation', { cause: 'tmp-alias', path: parent })

  const calls = []
  const filesystem = makeFilesystem({}, calls)
  const allocation = allocate(filesystem)
  assert.deepEqual(Object.keys(allocation), ['absolutePath', 'relativePath'])
  assert.match(allocation.relativePath, /^\.tmp\/implementation-[0-9a-f]{12}-[0-9a-f]{12}-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.equal(calls.some((call) => call[0] === 'mkdir' && call[2]?.recursive === true), false)
  assert.equal(calls.some((call) => call[1] === join(repositoryRoot, '.tmp', 'nightshift')), false)

  const target = join(repositoryRoot, allocation.relativePath)
  const collision = makeFilesystem({ [target]: ordinary, mkdir: Object.assign(new Error('exists'), { code: 'EEXIST' }) })
  assertCause(() => allocate(collision), 'scratch-allocation', { cause: 'create-failed', path: target })
  const malformedCreate = makeFilesystem({ mkdir: new Error('not ordinary') })
  assertCause(() => allocate(malformedCreate), 'scratch-allocation', { cause: 'create-failed', path: target })

  for (const state of [null, dispatchMarker('file'), dispatchMarker('symbolic'), dispatchMarker('reparse')]) {
    const postCreate = makeFilesystem({ [target]: state })
    assertCause(() => allocate(postCreate), 'scratch-allocation', { cause: state === null ? 'created-unavailable' : 'created-not-ordinary', path: target })
  }
  assertCause(() => allocate(makeFilesystem({ realpath: { [target]: 'C:/created-alias' } })), 'scratch-allocation', { cause: 'created-alias', path: target })

  const noGitFilesystem = makeFilesystem()
  const result = createImplementationScratch({ dispatchId: 'dispatch', repositoryRoot, taskId: 'task' }, { filesystem: noGitFilesystem, uuid: () => uuid })
  assert.equal(typeof result.absolutePath, 'string')
  assert.equal(Object.hasOwn(require('../skills/handover/implementation-dispatch'), 'cleanupImplementationScratch'), false)
  assert.equal(Object.hasOwn(require('../skills/handover/implementation-dispatch'), 'scanImplementationScratch'), false)
})

test('implementation dispatch enforces exact option contracts', () => {
  const repositoryRoot = 'C:\\option-root'
  const planBytes = Buffer.from('# Plan\n- revise-plan graduated 2026-09-01 12:00 at abcdef1, scope: x, content: 12345678\n')
  const storedAuditBase = `abcdef1${'a'.repeat(33)}`
  const auditInput = { auditBase: storedAuditBase, objectFormat: 'sha1', repositoryRoot, scratchRelativePath: null }
  const scratchInput = { dispatchId: 'dispatch', repositoryRoot, taskId: 'task' }

  const gitHelperCalls = [
    (options) => classifyImplementationRepository({ repositoryRoot }, options),
    (options) => resolveImplementationAuditBase({ planBytes, repositoryRoot, storedAuditBase }, options),
    (options) => inspectImplementationBoundary(auditInput, options),
  ]
  for (const call of gitHelperCalls) {
    assertDispatchFailure(() => call({ uuid: () => 'unused' }), 'dispatch-input', { field: 'options.uuid', reason: 'unknown-key' })
    assertDispatchFailure(() => call({ randomUUID: () => 'unused' }), 'dispatch-input', { field: 'options.randomUUID', reason: 'unknown-key' })
    assertDispatchFailure(() => call({ filesystem: null, uuid: null }), 'dispatch-input', { field: 'options.uuid', reason: 'unknown-key' })
  }

  assertDispatchFailure(() => createImplementationScratch(scratchInput, { uuid: null }), 'dispatch-input', { field: 'options.uuid', reason: 'invalid-option' })
  assertDispatchFailure(() => createImplementationScratch(scratchInput, { uuid: null, randomUUID: () => 'unused' }), 'dispatch-input', { field: 'options.randomUUID', reason: 'unknown-key' })
  for (const key of ['git', 'randomUUID', 'resolveGitExecutable', 'spawnSync']) {
    assertDispatchFailure(() => createImplementationScratch(scratchInput, { [key]: () => 'unused' }), 'dispatch-input', { field: `options.${key}`, reason: 'unknown-key' })
  }
})

test('implementation dispatch normalizes Git envelopes', () => {
  const dispatchSource = readRequiredFile(join(PUBLIC_SKILLS_ROOT, 'handover', 'implementation-dispatch.js'))
  for (const helperName of [
    'normalizeRunGitResult',
    'validateGitResultEnvelope',
    'requireGitStatus',
    'decodeStrictUtf8',
    'parseCheckIgnoreRecords',
    'parseNulPathList',
    'parseLfObjectIds',
    'parseExactAsciiLine',
    'validateGitTopLevel',
    'gitCommand',
    'parsePlanStamp',
  ]) {
    const definition = `function ${helperName}(`
    const definitionCount = dispatchSource.split(definition).length - 1
    assert.equal(definitionCount, 1, `${helperName} must have exactly one private definition; found ${definitionCount}`)
  }
  assert.equal(dispatchSource.split('validateGitTopLevel(').length - 1, 3, 'the shared Git top-level validator must have one definition and exactly two callers')

  const repositoryRoot = 'C:\\repo'
  const planBytes = Buffer.from('# Plan\n- revise-plan graduated 2026-09-01 12:00 at abcdef1, scope: x, content: 12345678\n')
  const sha1 = 'a'.repeat(40)
  const filesystem = dispatchFilesystem(repositoryRoot, { markerEntries: new Map([[join(repositoryRoot, '.git'), dispatchMarker('directory')]]) })
  const spawnCalls = []
  const rawSpawnSync = (executable, args, options) => {
    spawnCalls.push({ args, cwd: options.cwd, executable })
    const command = args.slice(2)
    const stdout = command.includes('--show-object-format=storage')
      ? Buffer.from('sha1\n')
      : command.includes('--is-ancestor') ? Buffer.alloc(0) : Buffer.from(`${sha1}\n`)

    return { pid: 42, output: [null, stdout, Buffer.alloc(0)], stdout, stderr: Buffer.alloc(0), status: 0, signal: null, error: undefined }
  }
  assert.deepEqual(
    resolveImplementationAuditBase(
      { planBytes, repositoryRoot, storedAuditBase: null },
      { filesystem, resolveGitExecutable: () => 'C:\\tools\\git.exe', spawnSync: rawSpawnSync },
    ),
    { auditBase: sha1, objectFormat: 'sha1', stampSha: 'abcdef1' },
  )
  assert.deepEqual(spawnCalls.map((call) => ({ args: call.args.slice(2), cwd: call.cwd, executable: call.executable })), [
    { args: ['rev-parse', '--show-object-format=storage'], cwd: repositoryRoot, executable: 'C:\\tools\\git.exe' },
    { args: ['rev-parse', '--verify', 'abcdef1^{commit}'], cwd: repositoryRoot, executable: 'C:\\tools\\git.exe' },
    { args: ['merge-base', '--is-ancestor', sha1, 'HEAD'], cwd: repositoryRoot, executable: 'C:\\tools\\git.exe' },
  ])

  for (const vector of [
    { label: 'pid', result: { error: null, signal: null, status: 0, stderr: Buffer.alloc(0), stdout: Buffer.from('sha1\n'), pid: 42 } },
    { label: 'output', result: { error: null, signal: null, status: 0, stderr: Buffer.alloc(0), stdout: Buffer.from('sha1\n'), output: [null] } },
  ]) {
    assertDispatchFailure(
      () => resolveImplementationAuditBase({ planBytes, repositoryRoot, storedAuditBase: null }, { filesystem, git: () => vector.result }),
      'git-command',
      { args: ['rev-parse', '--show-object-format=storage'], operation: 'show-object-format', status: null, stderr: '' },
    )
  }

  const malformedEnvelopes = [
    { label: 'null', result: null },
    { label: 'array', result: [] },
    { label: 'date', result: new Date(0) },
    { label: 'missing error', result: { signal: null, status: 0, stderr: Buffer.alloc(0), stdout: Buffer.from('sha1\n') } },
    { label: 'missing signal', result: { error: null, status: 0, stderr: Buffer.alloc(0), stdout: Buffer.from('sha1\n') } },
    { label: 'missing status', result: { error: null, signal: null, stderr: Buffer.alloc(0), stdout: Buffer.from('sha1\n') } },
    { label: 'missing stderr', result: { error: null, signal: null, status: 0, stdout: Buffer.from('sha1\n') } },
    { label: 'missing stdout', result: { error: null, signal: null, status: 0, stderr: Buffer.alloc(0) } },
    { label: 'extra key', result: { error: null, signal: null, status: 0, stderr: Buffer.alloc(0), stdout: Buffer.from('sha1\n'), extra: true } },
    { label: 'wrong key order', result: { signal: null, error: null, status: 0, stderr: Buffer.alloc(0), stdout: Buffer.from('sha1\n') } },
    { label: 'invalid error', result: { error: 'failure', signal: null, status: 0, stderr: Buffer.alloc(0), stdout: Buffer.from('sha1\n') } },
    { label: 'invalid signal', result: { error: null, signal: 9, status: 0, stderr: Buffer.alloc(0), stdout: Buffer.from('sha1\n') } },
    { label: 'invalid status string', result: { error: null, signal: null, status: '0', stderr: Buffer.alloc(0), stdout: Buffer.from('sha1\n') } },
    { label: 'invalid fractional status', result: { error: null, signal: null, status: 0.5, stderr: Buffer.alloc(0), stdout: Buffer.from('sha1\n') } },
    { label: 'invalid stderr', result: { error: null, signal: null, status: 0, stderr: '', stdout: Buffer.from('sha1\n') } },
    { label: 'invalid stdout', result: { error: null, signal: null, status: 0, stderr: Buffer.alloc(0), stdout: 'sha1\n' } },
  ]
  for (const vector of malformedEnvelopes) {
    assertDispatchFailure(
      () => resolveImplementationAuditBase({ planBytes, repositoryRoot, storedAuditBase: null }, { filesystem, git: () => vector.result }),
      'git-command',
      { args: ['rev-parse', '--show-object-format=storage'], operation: 'show-object-format', status: null, stderr: '' },
    )
  }

  for (const vector of [
    { result: gitEnvelope({ error: new Error('spawn failed'), stdout: Buffer.from('sha1\n') }), want: { status: 0, stderr: '' } },
    { result: gitEnvelope({ signal: 'SIGKILL', stdout: Buffer.from('sha1\n') }), want: { status: 0, stderr: '' } },
    { result: gitEnvelope({ status: 2, stdout: Buffer.from('sha1\n') }), want: { status: 2, stderr: '' } },
    { result: gitEnvelope({ stderr: Buffer.from('fatal\n'), stdout: Buffer.from('sha1\n') }), want: { status: 0, stderr: 'fatal\n' } },
  ]) {
    assertDispatchFailure(
      () => resolveImplementationAuditBase({ planBytes, repositoryRoot, storedAuditBase: null }, { filesystem, git: () => vector.result }),
      'git-command',
      { args: ['rev-parse', '--show-object-format=storage'], operation: 'show-object-format', status: vector.want.status, stderr: vector.want.stderr },
    )
  }

  const malformedFormatFrames = [
    Buffer.alloc(0),
    Buffer.from('sha1'),
    Buffer.from('sha1\r\n'),
    Buffer.from('sha1\n\n'),
    Buffer.from(' sha1\n'),
    Buffer.from('sha1 \n'),
    Buffer.from('SHA1\n'),
    Buffer.from('sha512\n'),
    Buffer.from([0xef, 0xbb, 0xbf, 0x73, 0x68, 0x61, 0x31, 0x0a]),
    Buffer.from([0x73, 0x68, 0x61, 0x31, 0x0a, 0x00]),
    Buffer.from([0xff, 0x0a]),
  ]
  for (const frame of malformedFormatFrames) {
    assertDispatchFailure(
      () => resolveImplementationAuditBase({ planBytes, repositoryRoot, storedAuditBase: null }, { filesystem, git: () => gitEnvelope({ stdout: frame }) }),
      'git-command',
      { args: ['rev-parse', '--show-object-format=storage'], operation: 'show-object-format', status: 0, stderr: '' },
    )
  }

  const malformedIdFrames = [
    Buffer.alloc(0),
    Buffer.from(sha1),
    Buffer.from(`${sha1}\r\n`),
    Buffer.from(`${sha1}\n\n`),
    Buffer.from(` ${sha1}\n`),
    Buffer.from(`${sha1} \n`),
    Buffer.from(`${sha1.toUpperCase()}\n`),
    Buffer.from(`${'g'.repeat(40)}\n`),
    Buffer.from(`${'a'.repeat(39)}\n`),
    Buffer.from(`${'a'.repeat(41)}\n`),
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(`${sha1}\n`)]),
    Buffer.concat([Buffer.from(`${sha1}\n`), Buffer.from([0x00])]),
    Buffer.concat([Buffer.from('a'.repeat(39)), Buffer.from([0xff, 0x0a])]),
  ]
  for (const frame of malformedIdFrames) {
    const git = (_root, args) => gitEnvelope({ stdout: args.includes('--show-object-format=storage') ? Buffer.from('sha1\n') : frame })
    assertDispatchFailure(
      () => resolveImplementationAuditBase({ planBytes, repositoryRoot, storedAuditBase: null }, { filesystem, git }),
      'git-command',
      { args: ['rev-parse', '--verify', 'abcdef1^{commit}'], operation: 'resolve-commit', status: 0, stderr: '' },
    )
  }
})

test('implementation dispatch classifies repositories', () => {
  for (const markerKind of ['directory', 'file']) {
    const root = markerKind === 'directory' ? 'C:\\ordinary' : 'C:\\linked'
    const filesystem = dispatchFilesystem(root, { markerEntries: new Map([[join(root, '.git'), dispatchMarker(markerKind)]]) })
    const git = (receivedRoot, args, input) => {
      assert.equal(receivedRoot, root)
      assert.deepEqual(args, ['rev-parse', '--show-toplevel'])
      assert.equal(input, null)

      return gitEnvelope({ stdout: Buffer.from(`${root}\n`) })
    }
    assert.deepEqual(classifyImplementationRepository({ repositoryRoot: root }, { filesystem, git }), { kind: 'git' })
  }

  for (const markerKind of ['directory', 'file']) {
    const root = markerKind === 'directory' ? 'C:\\ordinary\\nested' : 'C:\\linked\\nested'
    const topLevel = markerKind === 'directory' ? 'C:\\ordinary' : 'C:\\linked'
    const filesystem = dispatchFilesystem(root, { markerEntries: new Map([[join(topLevel, '.git'), dispatchMarker(markerKind)]]) })
    assertDispatchFailure(
      () => classifyImplementationRepository({ repositoryRoot: root }, { filesystem, git: () => gitEnvelope({ stdout: Buffer.from(`${topLevel}\n`) }) }),
      'repository-classification',
      { cause: 'root-mismatch', path: topLevel },
    )
  }

  const noMarkerRoot = 'C:\\plain\\nested'
  let noMarkerGitCalls = 0
  assert.deepEqual(
    classifyImplementationRepository(
      { repositoryRoot: noMarkerRoot },
      { filesystem: dispatchFilesystem(noMarkerRoot), git: () => { noMarkerGitCalls += 1; return gitEnvelope() } },
    ),
    { kind: 'non-git' },
  )
  assert.equal(noMarkerGitCalls, 0)

  const fakeRoot = 'C:\\fake'
  const fakeFilesystem = dispatchFilesystem(fakeRoot, { markerEntries: new Map([[join(fakeRoot, '.git'), dispatchMarker('directory')]]) })
  assertDispatchFailure(
    () => classifyImplementationRepository({ repositoryRoot: fakeRoot }, { filesystem: fakeFilesystem, git: () => gitEnvelope({ status: 1 }) }),
    'git-command',
    { args: ['rev-parse', '--show-toplevel'], operation: 'show-toplevel', status: 1, stderr: '' },
  )

  const markerFailures = [
    {
      details: { cause: 'metadata-unavailable', path: 'C:\\inaccessible\\.git' },
      marker: Object.assign(new Error('access denied'), { code: 'EACCES' }),
      root: 'C:\\inaccessible',
    },
    { details: { cause: 'metadata-not-ordinary', path: 'C:\\symbolic\\.git' }, marker: dispatchMarker('symbolic'), root: 'C:\\symbolic' },
    { details: { cause: 'metadata-not-ordinary', path: 'C:\\nonordinary\\.git' }, marker: dispatchMarker('other'), root: 'C:\\nonordinary' },
    { details: { cause: 'metadata-not-ordinary', path: 'C:\\reparse\\.git' }, marker: dispatchMarker('reparse'), root: 'C:\\reparse' },
  ]
  for (const vector of markerFailures) {
    const markerPath = join(vector.root, '.git')
    const filesystem = dispatchFilesystem(vector.root, { markerEntries: new Map([[markerPath, vector.marker]]) })
    assertDispatchFailure(
      () => classifyImplementationRepository({ repositoryRoot: vector.root }, { filesystem, git: () => gitEnvelope() }),
      'repository-classification',
      vector.details,
    )
  }

  const malformedFrames = [
    Buffer.alloc(0),
    Buffer.from('C:\\repo'),
    Buffer.from('C:\\repo\r\n'),
    Buffer.from('C:\\repo\nextra\n'),
    Buffer.from([0xef, 0xbb, 0xbf, 0x43, 0x3a, 0x5c, 0x72, 0x65, 0x70, 0x6f, 0x0a]),
    Buffer.from([0xff, 0x0a]),
  ]
  const malformedRoot = 'C:\\repo'
  const malformedFilesystem = dispatchFilesystem(malformedRoot, { markerEntries: new Map([[join(malformedRoot, '.git'), dispatchMarker('directory')]]) })
  for (const frame of malformedFrames) {
    assertDispatchFailure(
      () => classifyImplementationRepository({ repositoryRoot: malformedRoot }, { filesystem: malformedFilesystem, git: () => gitEnvelope({ stdout: frame }) }),
      'git-command',
      { args: ['rev-parse', '--show-toplevel'], operation: 'show-toplevel', status: 0, stderr: '' },
    )
  }

  assert.deepEqual(
    classifyImplementationRepository({ repositoryRoot: malformedRoot }, { filesystem: malformedFilesystem, git: () => gitEnvelope({ stdout: Buffer.from('C:/repo\n') }) }),
    { kind: 'git' },
  )
  assert.deepEqual(
    classifyImplementationRepository({ repositoryRoot: malformedRoot }, { filesystem: malformedFilesystem, git: () => gitEnvelope({ stdout: Buffer.from('C:/repo/child/../.\n') }) }),
    { kind: 'git' },
  )

  const classifierAlias = 'C:\\repo-alias'
  const classifierAliasFilesystem = dispatchFilesystem(malformedRoot, { markerEntries: new Map([[join(malformedRoot, '.git'), dispatchMarker('directory')]]) })
  classifierAliasFilesystem.realpathSync.native = (path) => path === classifierAlias ? malformedRoot : path
  assert.deepEqual(
    classifyImplementationRepository({ repositoryRoot: malformedRoot }, { filesystem: classifierAliasFilesystem, git: () => gitEnvelope({ stdout: Buffer.from(`${classifierAlias}\n`) }) }),
    { kind: 'git' },
  )

  for (const topLevel of ['C:\\other', 'c:\\repo', ' C:\\repo', 'C:\\repo ']) {
    assertDispatchFailure(
      () => classifyImplementationRepository({ repositoryRoot: malformedRoot }, { filesystem: malformedFilesystem, git: () => gitEnvelope({ stdout: Buffer.from(`${topLevel}\n`) }) }),
      'repository-classification',
      { cause: 'root-mismatch', path: topLevel },
    )
  }

  const classifierInaccessible = 'C:/inaccessible/../inaccessible-root'
  const canonicalClassifierInaccessible = 'C:\\inaccessible-root'
  const inaccessibleClassifierFilesystem = dispatchFilesystem(malformedRoot, { markerEntries: new Map([[join(malformedRoot, '.git'), dispatchMarker('directory')]]) })
  inaccessibleClassifierFilesystem.realpathSync.native = (path) => {
    if (path === canonicalClassifierInaccessible) throw Object.assign(new Error('access denied'), { code: 'EACCES' })

    return path
  }
  assertDispatchFailure(
    () => classifyImplementationRepository({ repositoryRoot: malformedRoot }, { filesystem: inaccessibleClassifierFilesystem, git: () => gitEnvelope({ stdout: Buffer.from(`${classifierInaccessible}\n`) }) }),
    'repository-classification',
    { cause: 'metadata-unavailable', path: classifierInaccessible },
  )

  assert.deepEqual(classifyImplementationRepository({ repositoryRoot: REPOSITORY_ROOT }), { kind: 'git' })
})

test('implementation dispatch resolves audit bases', () => {
  const planBytes = Buffer.from('# Plan\n\n## Hardening\n- revise-plan graduated 2026-09-01 12:00 at abcdef1, scope: whole file, content: 12345678\n')
  const repositoryRoot = 'C:\\repo'
  const sha1 = 'a'.repeat(40)
  const storedSha1 = `abcdef1${'a'.repeat(33)}`
  const sha256 = `abcdef1${'b'.repeat(57)}`
  const filesystem = dispatchFilesystem(repositoryRoot)
  const makeGit = ({ format = 'sha1', mergeStatus = 0, resolved = sha1, resolveStatus = 0 } = {}) => {
    const calls = []
    const git = (_root, args, input) => {
      calls.push({ args: [...args], input })
      if (args.includes('--show-object-format=storage')) return gitEnvelope({ stdout: Buffer.from(`${format}\n`) })
      if (args.includes('--verify')) return gitEnvelope({ status: resolveStatus, stdout: resolveStatus === 0 ? Buffer.from(`${resolved}\n`) : Buffer.alloc(0) })

      return gitEnvelope({ status: mergeStatus })
    }

    return { calls, git }
  }

  const sha1Git = makeGit()
  assert.deepEqual(
    resolveImplementationAuditBase({ planBytes, repositoryRoot, storedAuditBase: null }, { filesystem, git: sha1Git.git }),
    { auditBase: sha1, objectFormat: 'sha1', stampSha: 'abcdef1' },
  )
  assert.deepEqual(sha1Git.calls, [
    { args: ['rev-parse', '--show-object-format=storage'], input: null },
    { args: ['rev-parse', '--verify', 'abcdef1^{commit}'], input: null },
    { args: ['merge-base', '--is-ancestor', sha1, 'HEAD'], input: null },
  ])

  const sha256Git = makeGit({ format: 'sha256', resolved: sha256 })
  assert.deepEqual(
    resolveImplementationAuditBase({ planBytes, repositoryRoot, storedAuditBase: sha256 }, { filesystem, git: sha256Git.git }),
    { auditBase: sha256, objectFormat: 'sha256', stampSha: 'abcdef1' },
  )
  assert.deepEqual(sha256Git.calls, [
    { args: ['rev-parse', '--show-object-format=storage'], input: null },
    { args: ['rev-parse', '--verify', `${sha256}^{commit}`], input: null },
    { args: ['merge-base', '--is-ancestor', sha256, 'HEAD'], input: null },
  ])

  const wrongWidthGit = makeGit({ format: 'sha256' })
  assertDispatchFailure(
    () => resolveImplementationAuditBase({ planBytes, repositoryRoot, storedAuditBase: storedSha1 }, { filesystem, git: wrongWidthGit.git }),
    'object-format',
    { kind: 'width-mismatch', objectFormat: 'sha256', stampSha: 'abcdef1', storedAuditBase: storedSha1 },
  )
  assert.deepEqual(wrongWidthGit.calls, [{ args: ['rev-parse', '--show-object-format=storage'], input: null }])

  assertDispatchFailure(
    () => resolveImplementationAuditBase({ planBytes: Buffer.from('# Plan\n'), repositoryRoot, storedAuditBase: null }, { filesystem, git: makeGit().git }),
    'plan-stamp',
    { kind: 'missing' },
  )

  for (const vector of [
    { label: 'ambiguous abbreviation', storedAuditBase: null },
    { label: 'unresolvable stored base', storedAuditBase: storedSha1 },
  ]) {
    const unresolved = makeGit({ resolveStatus: 1 })
    assertDispatchFailure(
      () => resolveImplementationAuditBase({ planBytes, repositoryRoot, storedAuditBase: vector.storedAuditBase }, { filesystem, git: unresolved.git }),
      'object-format',
      { kind: 'resolution-failed', objectFormat: 'sha1', stampSha: 'abcdef1', storedAuditBase: vector.storedAuditBase },
    )
  }

  const malformedLines = [
    '- revise-plan graduated 0000-01-01 00:00 at abcdef1, scope: x, content: 12345678',
    '- revise-plan graduated 2024-00-01 00:00 at abcdef1, scope: x, content: 12345678',
    '- revise-plan graduated 2024-13-01 00:00 at abcdef1, scope: x, content: 12345678',
    '- revise-plan graduated 2024-01-00 00:00 at abcdef1, scope: x, content: 12345678',
    '- revise-plan graduated 2024-04-31 00:00 at abcdef1, scope: x, content: 12345678',
    '- revise-plan graduated 2023-02-29 00:00 at abcdef1, scope: x, content: 12345678',
    '- revise-plan graduated 2024-02-29 24:00 at abcdef1, scope: x, content: 12345678',
    '- revise-plan graduated 2024-02-29 23:60 at abcdef1, scope: x, content: 12345678',
    '- revise-plan graduated 2024-02-29 23:59 at abcdef, scope: x, content: 12345678',
    `- revise-plan graduated 2024-02-29 23:59 at ${'a'.repeat(41)}, scope: x, content: 12345678`,
    '- revise-plan graduated 2024-02-29 23:59 at ABCDEF1, scope: x, content: 12345678',
    '- revise-plan graduated 2024-02-29 23:59 at abcdeg1, scope: x, content: 12345678',
    '- revise-plan graduated 2024-02-29 23:59 at abcdef1, scope: , content: 12345678',
    '- revise-plan graduated 2024-02-29 23:59 at abcdef1, scope:  x, content: 12345678',
    '- revise-plan graduated 2024-02-29 23:59 at abcdef1, scope: x , content: 12345678',
    '- revise-plan graduated 2024-02-29 23:59 at abcdef1, scope: x, content: 1234567',
    '- revise-plan graduated 2024-02-29 23:59 at abcdef1, scope: x, content: 123456789',
    '- revise-plan graduated 2024-02-29 23:59 at abcdef1, scope: x, content: p-123456789ab',
    '- revise-plan graduated 2024-02-29 23:59 at abcdef1, scope: x, content: p-123456789abcd',
    '- revise-plan graduated 2024-02-29 23:59 at abcdef1, scope: x, content: P-123456789abc',
    '- revise-plan graduated 2024-02-29 23:59 at abcdef1, scope: x, content: p-123456789abG',
  ]
  for (const line of malformedLines) {
    assertDispatchFailure(
      () => resolveImplementationAuditBase({ planBytes: Buffer.from(`# Plan\n${line}\n`), repositoryRoot, storedAuditBase: null }, { filesystem, git: makeGit().git }),
      'plan-stamp',
      { kind: 'malformed', line },
    )
  }

  for (const vector of [
    { stamp: '0001-01-01 00:00', stampSha: 'abcdef1' },
    { stamp: '2000-02-29 12:30', stampSha: 'abcdef1' },
    { stamp: '2024-02-29 23:59', stampSha: 'abcdef1' },
    { stamp: '9999-12-31 23:59', stampSha: 'abcdef1' },
  ]) {
    const validPlan = Buffer.from(`# Plan\n- revise-plan graduated ${vector.stamp} at ${vector.stampSha}, scope: x, content: p-123456789abc\n`)
    assert.deepEqual(
      resolveImplementationAuditBase({ planBytes: validPlan, repositoryRoot, storedAuditBase: null }, { filesystem, git: makeGit().git }),
      { auditBase: sha1, objectFormat: 'sha1', stampSha: vector.stampSha },
    )
  }

  const validThenMalformed = Buffer.from('# Plan\n- revise-plan graduated 2026-09-01 12:00 at abcdef1, scope: first, content: 12345678\n- revise-plan graduated invalid\n')
  assertDispatchFailure(
    () => resolveImplementationAuditBase({ planBytes: validThenMalformed, repositoryRoot, storedAuditBase: null }, { filesystem, git: makeGit().git }),
    'plan-stamp',
    { kind: 'malformed', line: '- revise-plan graduated invalid' },
  )

  const earliestPlan = Buffer.from('# Plan\n- revise-plan graduated 2026-09-02 12:00 at abcdef1, scope: first, content: 12345678\n- revise-plan graduated 2020-01-01 00:00 at bcdef12, scope: second, content: 87654321\n')
  assert.deepEqual(
    resolveImplementationAuditBase({ planBytes: earliestPlan, repositoryRoot, storedAuditBase: null }, { filesystem, git: makeGit().git }),
    { auditBase: sha1, objectFormat: 'sha1', stampSha: 'abcdef1' },
  )

  let prefixMismatchCalls = 0
  assertDispatchFailure(
    () => resolveImplementationAuditBase(
      { planBytes, repositoryRoot, storedAuditBase: 'b'.repeat(40) },
      { filesystem, git: () => { prefixMismatchCalls += 1; return gitEnvelope() } },
    ),
    'object-format',
    { kind: 'resolved-id-mismatch', objectFormat: null, stampSha: 'abcdef1', storedAuditBase: 'b'.repeat(40) },
  )
  assert.equal(prefixMismatchCalls, 0)

  const mismatchedResolved = `abcdef1${'c'.repeat(33)}`
  assertDispatchFailure(
    () => resolveImplementationAuditBase({ planBytes, repositoryRoot, storedAuditBase: storedSha1 }, { filesystem, git: makeGit({ resolved: mismatchedResolved }).git }),
    'object-format',
    { kind: 'resolved-id-mismatch', objectFormat: 'sha1', stampSha: 'abcdef1', storedAuditBase: storedSha1 },
  )

  assertDispatchFailure(
    () => resolveImplementationAuditBase({ planBytes, repositoryRoot, storedAuditBase: null }, { filesystem, git: makeGit({ mergeStatus: 1 }).git }),
    'history-base',
    { auditBase: sha1, kind: 'non-ancestor' },
  )
  assertDispatchFailure(
    () => resolveImplementationAuditBase({ planBytes, repositoryRoot, storedAuditBase: null }, { filesystem, git: makeGit({ mergeStatus: 2 }).git }),
    'git-command',
    { args: ['merge-base', '--is-ancestor', sha1, 'HEAD'], operation: 'merge-base', status: 2, stderr: '' },
  )

  const fixtureRoot = mkdtempSync(join(tmpdir(), 'nightshift-implementation-audit-'))
  try {
    writeFileSync(join(fixtureRoot, '.gitignore'), '/.tmp/\n.superpowers/\n')
    mkdirSync(join(fixtureRoot, '.tmp'))
    mkdirSync(join(fixtureRoot, '.superpowers'))
    writeFileSync(join(fixtureRoot, 'fixture.txt'), 'first\n')
    execFileSync('git', ['init', '--quiet'], { cwd: fixtureRoot })
    execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: fixtureRoot })
    execFileSync('git', ['config', 'user.email', 'fixture@example.invalid'], { cwd: fixtureRoot })
    execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: fixtureRoot })
    execFileSync('git', ['add', '.gitignore', 'fixture.txt'], { cwd: fixtureRoot })
    execFileSync('git', ['commit', '--quiet', '-m', 'first'], { cwd: fixtureRoot })
    const auditBase = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fixtureRoot, encoding: 'utf8' }).trim()
    writeFileSync(join(fixtureRoot, 'fixture.txt'), 'second\n')
    execFileSync('git', ['add', 'fixture.txt'], { cwd: fixtureRoot })
    execFileSync('git', ['commit', '--quiet', '-m', 'second'], { cwd: fixtureRoot })
    const fixturePlan = Buffer.from(`# Plan\n- revise-plan graduated 2026-09-01 12:00 at ${auditBase.slice(0, 7)}, scope: whole file, content: 12345678\n`)
    const fixtureFilesystem = dispatchFilesystem(fixtureRoot)
    const realGit = (root, args) => {
      const result = spawnSync('git', args, { cwd: root, encoding: null, shell: false })

      return gitEnvelope({ error: result.error ?? null, signal: result.signal ?? null, status: result.status, stderr: result.stderr, stdout: result.stdout })
    }
    assert.deepEqual(
      resolveImplementationAuditBase({ planBytes: fixturePlan, repositoryRoot: fixtureRoot, storedAuditBase: auditBase }, { filesystem: fixtureFilesystem, git: realGit }),
      { auditBase, objectFormat: 'sha1', stampSha: auditBase.slice(0, 7) },
    )
  } finally {
    rmSync(fixtureRoot, { force: true, recursive: true })
  }
})

test('implementation dispatch audits root scratch history', () => {
  const root = 'C:\\audit-root'
  const base = 'a'.repeat(40)
  const tip = 'b'.repeat(40)
  const nul = String.fromCharCode(0)
  const calls = []
  const git = (_root, args, input) => {
    calls.push({ args, input })
    if (args[0] === 'rev-parse' && args[1] === '--show-object-format=storage') return gitEnvelope({ stdout: Buffer.from('sha1\n') })
    if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return gitEnvelope({ stdout: Buffer.from(`${root}\n`) })
    if (args[0] === 'check-ignore') {
      const path = input.toString('utf8').slice(0, -1)
      return gitEnvelope({ stdout: Buffer.from(['.gitignore', '1', path.startsWith('.tmp/') ? '/.tmp/' : '.superpowers/', path].join(nul) + nul) })
    }
    if (args[0] === 'rev-parse' && args[1] === '--verify') return gitEnvelope({ stdout: Buffer.from(`${tip}\n`) })
    if (args[0] === 'rev-list') return gitEnvelope()
    return gitEnvelope()
  }
  assert.deepEqual(inspectImplementationBoundary({ auditBase: base, objectFormat: 'sha1', repositoryRoot: root, scratchRelativePath: '.tmp/implementation-000000000000-000000000000-00000000-0000-4000-8000-000000000000' }, { filesystem: dispatchFilesystem(root), git }), { commitsChecked: 0, scratchTracked: false })
  assert.deepEqual(calls.map(({ args }) => args[0]), ['rev-parse', 'rev-parse', 'check-ignore', 'check-ignore', 'diff', 'rev-parse', 'cat-file', 'merge-base', 'rev-list', 'ls-files', 'rev-parse'])
  assert.deepEqual(calls[2].input, Buffer.from('.tmp/nightshift-implementation-policy-probe' + nul, 'utf8'))
  assert.deepEqual(calls[3].input, Buffer.from('.superpowers/nightshift-implementation-policy-probe' + nul, 'utf8'))
  assert.deepEqual(calls[9].args, ['ls-files', '-z', '--', ':(literal).tmp/implementation-000000000000-000000000000-00000000-0000-4000-8000-000000000000'])
})

test('implementation dispatch validates returned top-level identity', () => {
  const root = 'C:\\audit-root'
  const base = 'a'.repeat(40)
  const input = { auditBase: base, objectFormat: 'sha1', repositoryRoot: root, scratchRelativePath: null }
  const run = (top, filesystem = dispatchFilesystem(root)) => inspectImplementationBoundary(input, {
    filesystem,
    git: createImplementationBoundaryGit({ overrides: new Map([['show-toplevel', gitEnvelope({ stdout: Buffer.from(`${top}\n`) })]]) }),
  })

  assert.deepEqual(run(root), { commitsChecked: 0, scratchTracked: false })
  assert.deepEqual(run('C:/audit-root'), { commitsChecked: 0, scratchTracked: false })

  const normalizedEquivalent = `${root}${nodePath.sep}.`
  assert.deepEqual(run(normalizedEquivalent), { commitsChecked: 0, scratchTracked: false })
  const mixedAlias = 'C:/audit-root/child/../.'
  assert.deepEqual(run(mixedAlias), { commitsChecked: 0, scratchTracked: false })

  const realpathAlias = 'C:\\audit-alias'
  let aliasRealpathCalls = 0
  const aliasFilesystem = dispatchFilesystem(root)
  aliasFilesystem.realpathSync.native = (path) => {
    if (path === realpathAlias) aliasRealpathCalls += 1

    return path === realpathAlias ? root : path
  }
  assert.deepEqual(run(realpathAlias, aliasFilesystem), { commitsChecked: 0, scratchTracked: false })
  assert.equal(aliasRealpathCalls, 1)

  const relativeTop = 'audit-root'
  assertDispatchFailure(() => run(relativeTop), 'repository-classification', { cause: 'root-mismatch', path: relativeTop })

  const differentRoot = 'C:\\different-root'
  assertDispatchFailure(() => run(differentRoot), 'repository-classification', { cause: 'root-mismatch', path: differentRoot })

  let rootRealpathCalls = 0
  const physicallyDifferentFilesystem = dispatchFilesystem(root)
  physicallyDifferentFilesystem.realpathSync.native = (path) => {
    rootRealpathCalls += 1

    return rootRealpathCalls === 1 ? path : differentRoot
  }
  assertDispatchFailure(() => run(root, physicallyDifferentFilesystem), 'repository-classification', { cause: 'root-mismatch', path: root })

  const inaccessibleTop = 'C:/inaccessible/../inaccessible-root'
  const canonicalInaccessibleTop = 'C:\\inaccessible-root'
  const inaccessibleFilesystem = dispatchFilesystem(root)
  inaccessibleFilesystem.realpathSync.native = (path) => {
    if (path === canonicalInaccessibleTop) throw Object.assign(new Error('access denied'), { code: 'EACCES' })

    return path
  }
  const failure = captureDispatchFailure(
    () => run(inaccessibleTop, inaccessibleFilesystem),
    'repository-classification',
    { cause: 'metadata-unavailable', path: inaccessibleTop },
  )
  assert.deepEqual(Object.keys(failure.details), ['cause', 'path'])

  const malformedFrames = [
    Buffer.alloc(0),
    Buffer.from(root),
    Buffer.from(`${root}\r\n`),
    Buffer.from(`${root}\nextra\n`),
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(`${root}\n`)]),
    Buffer.from([0xff, 0x0a]),
  ]
  for (const frame of malformedFrames) {
    assertDispatchFailure(
      () => inspectImplementationBoundary(input, {
        filesystem: dispatchFilesystem(root),
        git: createImplementationBoundaryGit({ overrides: new Map([['show-toplevel', gitEnvelope({ stdout: frame })]]) }),
      }),
      'git-command',
      { args: ['rev-parse', '--show-toplevel'], operation: 'show-toplevel', status: 0, stderr: '' },
    )
  }
})

test('implementation dispatch audits real add-delete and merge history', () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'nightshift-implementation-boundary-'))
  const diffTreeCalls = []
  try {
    writeFileSync(join(fixtureRoot, '.gitignore'), '/.tmp/\n/.superpowers/\n')
    writeFileSync(join(fixtureRoot, 'anchor.txt'), 'anchor\n')
    execFileSync('git', ['init', '--quiet'], { cwd: fixtureRoot })
    execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: fixtureRoot })
    execFileSync('git', ['config', 'user.email', 'fixture@example.invalid'], { cwd: fixtureRoot })
    execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: fixtureRoot })
    execFileSync('git', ['add', '.gitignore', 'anchor.txt'], { cwd: fixtureRoot })
    execFileSync('git', ['commit', '--quiet', '-m', 'base'], { cwd: fixtureRoot })
    const auditBase = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fixtureRoot, encoding: 'utf8' }).trim()

    mkdirSync(join(fixtureRoot, '.tmp'))
    writeFileSync(join(fixtureRoot, '.tmp', 'transient'), 'added\n')
    execFileSync('git', ['add', '--force', '.tmp/transient'], { cwd: fixtureRoot })
    execFileSync('git', ['commit', '--quiet', '-m', 'add transient'], { cwd: fixtureRoot })
    const addCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fixtureRoot, encoding: 'utf8' }).trim()
    execFileSync('git', ['rm', '--quiet', '.tmp/transient'], { cwd: fixtureRoot })
    execFileSync('git', ['commit', '--quiet', '-m', 'delete transient'], { cwd: fixtureRoot })
    const divergenceBase = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fixtureRoot, encoding: 'utf8' }).trim()
    const deleteCommit = divergenceBase

    execFileSync('git', ['checkout', '--quiet', '-b', 'parent-a'], { cwd: fixtureRoot })
    mkdirSync(join(fixtureRoot, '.tmp'), { recursive: true })
    writeFileSync(join(fixtureRoot, '.tmp', 'left'), 'left\n')
    writeFileSync(join(fixtureRoot, '.tmp', 'shared'), 'parent a\n')
    execFileSync('git', ['add', '--force', '.tmp/left', '.tmp/shared'], { cwd: fixtureRoot })
    execFileSync('git', ['commit', '--quiet', '-m', 'parent a'], { cwd: fixtureRoot })
    const parentA = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fixtureRoot, encoding: 'utf8' }).trim()

    execFileSync('git', ['checkout', '--quiet', '-b', 'parent-b', divergenceBase], { cwd: fixtureRoot })
    mkdirSync(join(fixtureRoot, '.tmp'), { recursive: true })
    writeFileSync(join(fixtureRoot, '.tmp', 'right'), 'right\n')
    writeFileSync(join(fixtureRoot, '.tmp', 'shared'), 'parent b\n')
    execFileSync('git', ['add', '--force', '.tmp/right', '.tmp/shared'], { cwd: fixtureRoot })
    execFileSync('git', ['commit', '--quiet', '-m', 'parent b'], { cwd: fixtureRoot })
    const parentB = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fixtureRoot, encoding: 'utf8' }).trim()

    execFileSync('git', ['checkout', '--quiet', 'parent-a'], { cwd: fixtureRoot })
    const mergeResult = spawnSync('git', ['merge', '--no-commit', '--no-ff', 'parent-b'], { cwd: fixtureRoot, encoding: null, shell: false })
    assert.equal(mergeResult.status, 1)
    writeFileSync(join(fixtureRoot, '.tmp', 'shared'), 'merged\n')
    execFileSync('git', ['add', '--force', '.tmp/shared'], { cwd: fixtureRoot })
    execFileSync('git', ['commit', '--quiet', '-m', 'merge parents'], { cwd: fixtureRoot })
    const mergeCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fixtureRoot, encoding: 'utf8' }).trim()
    assert.deepEqual(execFileSync('git', ['rev-parse', `${mergeCommit}^1`, `${mergeCommit}^2`], { cwd: fixtureRoot, encoding: 'utf8' }).trim().split('\n'), [parentA, parentB])

    const realGit = (root, args, input) => {
      const result = spawnSync('git', args, { cwd: root, encoding: null, input, shell: false })
      if (args[0] === 'diff-tree' && args.includes(mergeCommit)) diffTreeCalls.push({ args: [...args], stdout: Buffer.from(result.stdout ?? []) })

      return gitEnvelope({ error: result.error ?? null, signal: result.signal ?? null, status: result.status, stderr: result.stderr, stdout: result.stdout })
    }
    let auditError
    assert.throws(
      () => inspectImplementationBoundary({ auditBase, objectFormat: 'sha1', repositoryRoot: fixtureRoot, scratchRelativePath: null }, { filesystem: dispatchFilesystem(fixtureRoot), git: realGit }),
      (error) => {
        auditError = error

        return error instanceof ImplementationDispatchError && error.code === 'committed-scratch'
      },
    )
    const transientOffenders = auditError.details.offenders.filter(({ path }) => path === '.tmp/transient')
    assert.equal(transientOffenders.length, 2)
    assert.deepEqual(transientOffenders.find(({ commit }) => commit === addCommit), { commit: addCommit, path: '.tmp/transient' })
    assert.deepEqual(transientOffenders.find(({ commit }) => commit === deleteCommit), { commit: deleteCommit, path: '.tmp/transient' })
    assert.equal(diffTreeCalls.length, 1)
    assert.deepEqual(diffTreeCalls[0].args, ['diff-tree', '-m', '--root', '--no-commit-id', '--name-only', '-z', '-r', mergeCommit, '--', ':(top).tmp'])
    const rawMergePaths = diffTreeCalls[0].stdout.toString('utf8').slice(0, -1).split(String.fromCharCode(0))
    assert.equal(rawMergePaths.filter((path) => path === '.tmp/shared').length, 2)
    assert.equal(rawMergePaths.filter((path) => path === '.tmp/left').length, 1)
    assert.equal(rawMergePaths.filter((path) => path === '.tmp/right').length, 1)
    assert.deepEqual(auditError.details.offenders.filter(({ commit }) => commit === mergeCommit), [
      { commit: mergeCommit, path: '.tmp/left' },
      { commit: mergeCommit, path: '.tmp/right' },
      { commit: mergeCommit, path: '.tmp/shared' },
    ])

    writeFileSync(join(fixtureRoot, '.tmp', 'z-staged'), 'z\n')
    writeFileSync(join(fixtureRoot, '.tmp', 'A-staged'), 'a\n')
    mkdirSync(join(fixtureRoot, 'nested', '.tmp'), { recursive: true })
    writeFileSync(join(fixtureRoot, 'nested', '.tmp', 'excluded'), 'nested\n')
    execFileSync('git', ['add', '--force', '.tmp/z-staged', '.tmp/A-staged', 'nested/.tmp/excluded'], { cwd: fixtureRoot })
    assertDispatchFailure(
      () => inspectImplementationBoundary({ auditBase: mergeCommit, objectFormat: 'sha1', repositoryRoot: fixtureRoot, scratchRelativePath: null }, { filesystem: dispatchFilesystem(fixtureRoot), git: realGit }),
      'staged-scratch',
      { paths: ['.tmp/A-staged', '.tmp/z-staged'] },
    )
  } finally {
    rmSync(fixtureRoot, { force: true, recursive: true })
  }
})

test('implementation dispatch rejects hostile policy frames and preserves validation order', () => {
  const root = 'C:\\audit-root'
  const base = 'a'.repeat(40)
  const valid = { objectFormat: 'sha1', repositoryRoot: root, scratchRelativePath: null }
  const filesystem = dispatchFilesystem(root)
  const nul = String.fromCharCode(0)
  const frameGit = (frame, status = 0) => (_root, args) => gitEnvelope({ status: args[0] === 'check-ignore' ? status : 0, stdout: args[0] === 'rev-parse' && args[1] === '--show-object-format=storage' ? Buffer.from('sha1\n') : args[0] === 'check-ignore' ? frame : Buffer.from(`${root}\n`) })
  assertDispatchFailure(() => inspectImplementationBoundary({ ...valid, auditBase: base }, { filesystem, git: frameGit(Buffer.from(['wrong', '1', '/.tmp/', '.tmp/nightshift-implementation-policy-probe'].join(nul) + nul)) }), 'ignore-policy', { expectedPattern: '/.tmp/', observedPattern: '/.tmp/', observedSource: 'wrong', path: '.tmp/' })
  assertDispatchFailure(() => inspectImplementationBoundary({ ...valid, auditBase: base }, { filesystem, git: frameGit(Buffer.from('hostile'), 1) }), 'git-command', { args: ['check-ignore', '-z', '-v', '--no-index', '--stdin'], operation: 'check-root-ignore', status: 1, stderr: '' })
  let probeNumber = 0
  const superpowersHostile = (_root, args) => {
    if (args[0] === 'rev-parse' && args[1] === '--show-object-format=storage') return gitEnvelope({ stdout: Buffer.from('sha1\n') })
    if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return gitEnvelope({ stdout: Buffer.from(`${root}\n`) })
    if (args[0] === 'check-ignore') { probeNumber += 1; return probeNumber === 2 ? gitEnvelope({ status: 1, stdout: Buffer.from('hostile') }) : gitEnvelope({ stdout: Buffer.from(['.gitignore', '1', '/.tmp/', '.tmp/nightshift-implementation-policy-probe'].join(nul) + nul) }) }
    return gitEnvelope()
  }
  assertDispatchFailure(() => inspectImplementationBoundary({ ...valid, auditBase: base }, { filesystem, git: superpowersHostile }), 'git-command', { args: ['check-ignore', '-z', '-v', '--no-index', '--stdin'], operation: 'check-superpowers-ignore', status: 1, stderr: '' })
  assertDispatchFailure(
    () => inspectImplementationBoundary({ ...valid, auditBase: base }, { filesystem, git: createImplementationBoundaryGit({ overrides: new Map([['check-root-ignore', gitEnvelope({ status: 1 })]]) }) }),
    'ignore-policy',
    { expectedPattern: '/.tmp/', observedPattern: null, observedSource: null, path: '.tmp/' },
  )
  assertDispatchFailure(
    () => inspectImplementationBoundary({ ...valid, auditBase: base }, { filesystem, git: createImplementationBoundaryGit({ overrides: new Map([['check-superpowers-ignore', gitEnvelope({ status: 1 })]]) }) }),
    'superpowers-policy',
    { expectedPattern: null, observedPattern: null, observedSource: null, path: '.superpowers/' },
  )
  assertDispatchFailure(() => inspectImplementationBoundary({ ...valid, objectFormat: 'sha512', auditBase: base }, { filesystem, git: () => { throw new Error('must not call Git') } }), 'dispatch-input', { field: 'objectFormat', reason: 'invalid-audit-base' })
})

test('implementation dispatch distinguishes history base semantic statuses', () => {
  const root = 'C:\\audit-root'
  const base = 'a'.repeat(40)
  const tip = 'b'.repeat(40)
  const filesystem = dispatchFilesystem(root)
  const input = { auditBase: base, objectFormat: 'sha1', repositoryRoot: root, scratchRelativePath: null }
  assertDispatchFailure(
    () => inspectImplementationBoundary(input, { filesystem, git: createImplementationBoundaryGit({ overrides: new Map([['check-object', gitEnvelope({ status: 1 })]]) }) }),
    'history-base',
    { auditBase: base, kind: 'missing-object' },
  )
  const ancestryCalls = []
  assertDispatchFailure(
    () => inspectImplementationBoundary(input, { filesystem, git: createImplementationBoundaryGit({ calls: ancestryCalls, overrides: new Map([['check-ancestry', gitEnvelope({ status: 1 })]]) }) }),
    'history-base',
    { auditBase: base, kind: 'non-ancestor' },
  )
  assert.deepEqual(ancestryCalls.find(({ operation }) => operation === 'check-ancestry').args, ['merge-base', '--is-ancestor', base, tip])
})

test('implementation dispatch bounds and frames the complete audit range', () => {
  const root = 'C:\\audit-root'
  const base = 'a'.repeat(40)
  const tip = 'b'.repeat(40)
  const nul = String.fromCharCode(0)
  const filesystem = dispatchFilesystem(root)
  const makeGit = ({ commits = [], diffPaths = new Map(), staged = '', tracked = '', secondTip = tip, status = new Map(), malformed = new Map(), failureCommit = null } = {}) => {
    let probe = 0
    return (_root, args, input) => {
      const key = args[0]
      if (status.has(args[0] + ':' + (args[1] ?? ''))) return gitEnvelope({ status: status.get(args[0] + ':' + (args[1] ?? '')) })
      if (key === 'rev-parse' && args[1] === '--show-object-format=storage') return gitEnvelope({ stdout: Buffer.from('sha1\n') })
      if (key === 'rev-parse' && args[1] === '--show-toplevel') return gitEnvelope({ stdout: Buffer.from(`${root}\n`) })
      if (key === 'check-ignore') { probe += 1; const path = input.toString('utf8').slice(0, -1); return gitEnvelope({ stdout: Buffer.from(['.gitignore', '1', path.startsWith('.tmp/') ? '/.tmp/' : '.superpowers/', path].join(nul) + nul) }) }
      if (key === 'diff') return gitEnvelope({ stdout: Buffer.from(staged) })
      if (key === 'rev-parse' && args[1] === '--verify') return gitEnvelope({ stdout: Buffer.from(`${probe > 2 ? secondTip : tip}\n`) })
      if (key === 'cat-file') return gitEnvelope()
      if (key === 'merge-base') return gitEnvelope()
      if (key === 'rev-list') return gitEnvelope({ stdout: malformed.get('rev-list') ?? Buffer.from(commits.length === 0 ? '' : commits.join('\n') + '\n') })
      if (key === 'diff-tree') { const commit = args[args.indexOf('-r') + 1]; if (failureCommit === commit) return gitEnvelope({ status: 2 }); if (malformed.has(commit)) return gitEnvelope({ stdout: Buffer.from(malformed.get(commit)) }); return gitEnvelope({ stdout: Buffer.from((diffPaths.get(commit) ?? []).join(nul) + ((diffPaths.get(commit) ?? []).length > 0 ? nul : '')) }) }
      if (key === 'ls-files') return gitEnvelope({ stdout: Buffer.from(tracked) })
      return gitEnvelope()
    }
  }
  const validInput = { auditBase: base, objectFormat: 'sha1', repositoryRoot: root, scratchRelativePath: null }
  const empty = inspectImplementationBoundary(validInput, { filesystem, git: makeGit() })
  assert.deepEqual(empty, { commitsChecked: 0, scratchTracked: false })
  const c1 = 'c'.repeat(40); const c2 = 'd'.repeat(40)
  assertDispatchFailure(() => inspectImplementationBoundary(validInput, { filesystem, git: makeGit({ commits: [c1, c2], diffPaths: new Map([[c1, ['.tmp/one', '.tmp/one']], [c2, ['.tmp/two']]]) }) }), 'committed-scratch', { offenders: [{ commit: c1, path: '.tmp/one' }, { commit: c2, path: '.tmp/two' }] })
  let overLimitDiffTreeCalls = 0
  const overLimitGit = makeGit({ commits: Array.from({ length: 257 }, (_, index) => index.toString(16).padStart(40, '0')) })
  assertDispatchFailure(
    () => inspectImplementationBoundary(validInput, { filesystem, git: (rootValue, args, input) => {
      if (args[0] === 'diff-tree') overLimitDiffTreeCalls += 1

      return overLimitGit(rootValue, args, input)
    } }),
    'audit-limit',
    { kind: 'commit-count', limit: 256, observed: 257 },
  )
  assert.equal(overLimitDiffTreeCalls, 0)
  const fourThousandNinetySix = Array.from({ length: 4097 }, (_, index) => `.tmp/p${index}`)
  assertDispatchFailure(() => inspectImplementationBoundary(validInput, { filesystem, git: makeGit({ commits: [c1], diffPaths: new Map([[c1, fourThousandNinetySix]]) }) }), 'audit-limit', { kind: 'offender-count', limit: 4096, observed: 4097 })
  const byteOverflowPath = '.tmp/' + 'x'.repeat(1048532)
  assertDispatchFailure(() => inspectImplementationBoundary(validInput, { filesystem, git: makeGit({ commits: [c1], diffPaths: new Map([[c1, [byteOverflowPath]]]) }) }), 'audit-limit', { kind: 'offender-bytes', limit: 1048576, observed: 1048577 })
  const acceptedCommits = Array.from({ length: 256 }, (_, index) => index.toString(16).padStart(40, '0'))
  const acceptedResult = inspectImplementationBoundary(validInput, { filesystem, git: makeGit({ commits: acceptedCommits }) })
  assert.deepEqual(acceptedResult, { commitsChecked: 256, scratchTracked: false })
  const acceptedOffenders = Array.from({ length: 4096 }, (_, index) => `.tmp/q${index}`)
  assertDispatchFailure(() => inspectImplementationBoundary(validInput, { filesystem, git: makeGit({ commits: [c1], diffPaths: new Map([[c1, acceptedOffenders]]) }) }), 'committed-scratch', { offenders: acceptedOffenders.map((path) => ({ commit: c1, path })).sort((left, right) => left.path < right.path ? -1 : 1) })
  const exactBytesPath = '.tmp/' + 'y'.repeat(1048531)
  assertDispatchFailure(() => inspectImplementationBoundary(validInput, { filesystem, git: makeGit({ commits: [c1], diffPaths: new Map([[c1, [exactBytesPath]]]) }) }), 'committed-scratch', { offenders: [{ commit: c1, path: exactBytesPath }] })
  let verifyCount = 0
  const changedTipGit = makeGit({ secondTip: 'c'.repeat(40) })
  const changedTipWrapper = (rootValue, args, input) => { const result = changedTipGit(rootValue, args, input); if (args[0] === 'rev-parse' && args[1] === '--verify') verifyCount += 1; return verifyCount > 1 && args[0] === 'rev-parse' && args[1] === '--verify' ? gitEnvelope({ stdout: Buffer.from('c'.repeat(40) + '\n') }) : result }
  assertDispatchFailure(() => inspectImplementationBoundary(validInput, { filesystem, git: changedTipWrapper }), 'history-base', { auditBase: base, expectedTip: tip, kind: 'tip-changed', observedTip: 'c'.repeat(40) })
  const partialCalls = []
  const partialFailure = captureDispatchFailure(
    () => inspectImplementationBoundary(validInput, {
      filesystem,
      git: createImplementationBoundaryGit({
        calls: partialCalls,
        commits: [c1, c2],
        overrides: new Map([['list-commit-paths', ({ args }) => args.includes(c1) ? gitEnvelope({ stdout: Buffer.from(`.tmp/earlier${nul}`) }) : gitEnvelope({ status: 2 })]]),
      }),
    }),
    'git-command',
    { args: ['diff-tree', '-m', '--root', '--no-commit-id', '--name-only', '-z', '-r', c2, '--', ':(top).tmp'], operation: 'list-commit-paths', status: 2, stderr: '' },
  )
  assert.deepEqual(partialCalls.filter(({ operation }) => operation === 'list-commit-paths').map(({ args }) => args), [
    ['diff-tree', '-m', '--root', '--no-commit-id', '--name-only', '-z', '-r', c1, '--', ':(top).tmp'],
    ['diff-tree', '-m', '--root', '--no-commit-id', '--name-only', '-z', '-r', c2, '--', ':(top).tmp'],
  ])
  assert.equal(partialCalls.some(({ operation }) => operation === 'check-scratch-tracked' || operation === 'recheck-tip'), false)
  assert.equal(Object.hasOwn(partialFailure.details, 'offenders'), false)
  assert.equal(JSON.stringify(partialFailure.details).includes('.tmp/earlier'), false)
  const malformedRevListGit = makeGit({ malformed: new Map([['rev-list', Buffer.from(`${c1}\r\n`)]]) })
  assertDispatchFailure(() => inspectImplementationBoundary(validInput, { filesystem, git: malformedRevListGit }), 'git-command', { args: ['rev-list', '--reverse', `${base}..${tip}`], operation: 'list-commits', status: 0, stderr: '' })
  const generated = '.tmp/implementation-000000000000-000000000000-00000000-0000-4000-8000-000000000000'
  assertDispatchFailure(() => inspectImplementationBoundary({ ...validInput, scratchRelativePath: generated }, { filesystem, git: makeGit({ tracked: generated + nul }) }), 'scratch-tracked', { path: generated })
  for (const path of ['.tmp/other', '.tmp/implementation-foo', '.tmp/implementation-000000000000-000000000000-00000000-0000-4000-8000-00000000000x']) assertDispatchFailure(() => inspectImplementationBoundary({ ...validInput, scratchRelativePath: path }, { filesystem, git: makeGit() }), 'dispatch-input', { field: 'scratchRelativePath', reason: 'invalid-scratch-path' })
})

test('implementation dispatch reports staged root scratch paths in ordinal order', () => {
  const root = 'C:\\audit-root'
  const base = 'a'.repeat(40)
  const nul = String.fromCharCode(0)
  const calls = []
  assertDispatchFailure(
    () => inspectImplementationBoundary(
      { auditBase: base, objectFormat: 'sha1', repositoryRoot: root, scratchRelativePath: null },
      { filesystem: dispatchFilesystem(root), git: createImplementationBoundaryGit({ calls, staged: Buffer.from(`.tmp/z${nul}.tmp/A${nul}`) }) },
    ),
    'staged-scratch',
    { paths: ['.tmp/A', '.tmp/z'] },
  )
  assert.deepEqual(calls.find(({ operation }) => operation === 'list-staged-scratch').args, ['diff', '--cached', '--name-only', '-z', '--', ':(top).tmp'])
})

test('implementation dispatch rejects every malformed strict audit frame', () => {
  const root = 'C:\\audit-root'
  const sha1Base = 'a'.repeat(40)
  const sha1Tip = 'b'.repeat(40)
  const sha1Commit = 'c'.repeat(40)
  const sha256Base = 'a'.repeat(64)
  const sha256Tip = 'b'.repeat(64)
  const sha256Commit = 'c'.repeat(64)
  const generated = '.tmp/implementation-000000000000-000000000000-00000000-0000-4000-8000-000000000000'
  const nul = String.fromCharCode(0)
  const lineBreak = String.fromCharCode(13, 10)
  const backslash = String.fromCharCode(92)
  const canonicalPathFrame = Buffer.from(`.tmp/a${nul}`)
  const pathFrameMutations = [
    { label: 'invalid UTF-8', frame: Buffer.from([0xc3, 0x28, 0x00]) },
    { label: 'UTF-8 BOM', frame: Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from('.tmp/a'), 0x00]) },
    { label: 'CRLF data', frame: Buffer.from(`.tmp/a${lineBreak}${nul}`) },
    { label: 'missing terminal NUL', frame: Buffer.from('.tmp/a') },
    { label: 'empty record', frame: Buffer.from(`.tmp/a${nul}${nul}`) },
    { label: 'extra byte after terminal NUL', frame: Buffer.from(`.tmp/a${nul}x`) },
    { label: 'backslash path', frame: Buffer.from(`.tmp${backslash}a${nul}`) },
    { label: 'dot segment path', frame: Buffer.from(`.tmp/./a${nul}`) },
  ]
  const pathOperations = [
    {
      args: ['diff', '--cached', '--name-only', '-z', '--', ':(top).tmp'],
      input: { auditBase: sha1Base, objectFormat: 'sha1', repositoryRoot: root, scratchRelativePath: null },
      operation: 'list-staged-scratch',
      options(frame) {
        return { overrides: new Map([['list-staged-scratch', gitEnvelope({ stdout: frame })]]) }
      },
    },
    {
      args: ['diff-tree', '-m', '--root', '--no-commit-id', '--name-only', '-z', '-r', sha1Commit, '--', ':(top).tmp'],
      input: { auditBase: sha1Base, objectFormat: 'sha1', repositoryRoot: root, scratchRelativePath: null },
      operation: 'list-commit-paths',
      options(frame) {
        return { commits: [sha1Commit], overrides: new Map([['list-commit-paths', gitEnvelope({ stdout: frame })]]) }
      },
    },
    {
      args: ['ls-files', '-z', '--', `:(literal)${generated}`],
      input: { auditBase: sha1Base, objectFormat: 'sha1', repositoryRoot: root, scratchRelativePath: generated },
      operation: 'check-scratch-tracked',
      options(frame) {
        return { overrides: new Map([['check-scratch-tracked', gitEnvelope({ stdout: frame })]]) }
      },
    },
  ]
  for (const mutation of pathFrameMutations) {
    assert.notDeepEqual(mutation.frame, canonicalPathFrame, `${mutation.label} must mutate the canonical path frame`)
    for (const vector of pathOperations) {
      assertDispatchFailure(
        () => inspectImplementationBoundary(vector.input, { filesystem: dispatchFilesystem(root), git: createImplementationBoundaryGit(vector.options(mutation.frame)) }),
        'git-command',
        { args: vector.args, operation: vector.operation, status: 0, stderr: '' },
      )
    }
  }

  const revListMutations = [
    { format: 'sha1', frame: Buffer.from([0xc3, 0x28, 0x0a]), label: 'invalid UTF-8', value: sha1Commit },
    { format: 'sha1', frame: Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from(sha1Commit), 0x0a]), label: 'UTF-8 BOM', value: sha1Commit },
    { format: 'sha1', frame: Buffer.from(`${sha1Commit}${lineBreak}`), label: 'CRLF terminator', value: sha1Commit },
    { format: 'sha1', frame: Buffer.from(sha1Commit), label: 'missing terminal LF', value: sha1Commit },
    { format: 'sha1', frame: Buffer.from(`${String.fromCharCode(10)}${sha1Commit}${String.fromCharCode(10)}`), label: 'empty record', value: sha1Commit },
    { format: 'sha1', frame: Buffer.from(`${sha1Commit}\n${'d'.repeat(40)}\nextra\n`), label: 'extra line', value: sha1Commit },
    { format: 'sha1', frame: Buffer.from(`${'c'.repeat(39)}\n`), label: 'wrong SHA-1 width', value: sha1Commit },
    { format: 'sha256', frame: Buffer.from(`${'c'.repeat(40)}\n`), label: 'wrong SHA-256 width', value: sha256Commit },
  ]
  for (const mutation of revListMutations) {
    const base = mutation.format === 'sha1' ? sha1Base : sha256Base
    const tip = mutation.format === 'sha1' ? sha1Tip : sha256Tip
    const canonical = Buffer.from(`${mutation.value}\n`)
    assert.notDeepEqual(mutation.frame, canonical, `${mutation.label} must mutate the canonical rev-list frame`)
    assertDispatchFailure(
      () => inspectImplementationBoundary(
        { auditBase: base, objectFormat: mutation.format, repositoryRoot: root, scratchRelativePath: null },
        {
          filesystem: dispatchFilesystem(root),
          git: createImplementationBoundaryGit({
            format: mutation.format,
            overrides: new Map([['list-commits', gitEnvelope({ stdout: mutation.frame })]]),
            tip,
          }),
        },
      ),
      'git-command',
      { args: ['rev-list', '--reverse', `${base}..${tip}`], operation: 'list-commits', status: 0, stderr: '' },
    )
  }
})

test('implementation dispatch maps every audit Git operation failure exactly', () => {
  const root = 'C:\\audit-root'
  const base = 'a'.repeat(40)
  const tip = 'b'.repeat(40)
  const commit = 'c'.repeat(40)
  const generated = '.tmp/implementation-000000000000-000000000000-00000000-0000-4000-8000-000000000000'
  const input = { auditBase: base, objectFormat: 'sha1', repositoryRoot: root, scratchRelativePath: null }
  const vectors = [
    { args: ['check-ignore', '-z', '-v', '--no-index', '--stdin'], operation: 'check-root-ignore' },
    { args: ['check-ignore', '-z', '-v', '--no-index', '--stdin'], operation: 'check-superpowers-ignore' },
    { args: ['diff', '--cached', '--name-only', '-z', '--', ':(top).tmp'], operation: 'list-staged-scratch' },
    { args: ['rev-parse', '--verify', 'HEAD^{commit}'], operation: 'resolve-tip' },
    { args: ['cat-file', '-e', `${base}^{commit}`], operation: 'check-object' },
    { args: ['merge-base', '--is-ancestor', base, tip], operation: 'check-ancestry' },
    { args: ['rev-list', '--reverse', `${base}..${tip}`], operation: 'list-commits' },
    { args: ['diff-tree', '-m', '--root', '--no-commit-id', '--name-only', '-z', '-r', commit, '--', ':(top).tmp'], commits: [commit], operation: 'list-commit-paths' },
    { args: ['ls-files', '-z', '--', `:(literal)${generated}`], operation: 'check-scratch-tracked', scratchRelativePath: generated },
    { args: ['rev-parse', '--verify', 'HEAD^{commit}'], operation: 'recheck-tip' },
  ]
  for (const vector of vectors) {
    const calls = []
    const stderr = `failure:${vector.operation}\n`
    const error = captureDispatchFailure(
      () => inspectImplementationBoundary(
        { ...input, scratchRelativePath: vector.scratchRelativePath ?? null },
        {
          filesystem: dispatchFilesystem(root),
          git: createImplementationBoundaryGit({
            calls,
            commits: vector.commits ?? [],
            overrides: new Map([[vector.operation, gitEnvelope({ status: 2, stderr: Buffer.from(stderr) })]]),
          }),
        },
      ),
      'git-command',
      { args: vector.args, operation: vector.operation, status: 2, stderr },
    )
    assert.deepEqual(calls.at(-1).args, vector.args)
    assert.equal(calls.at(-1).operation, vector.operation)
    assert.equal(Object.hasOwn(error.details, 'offenders'), false)
  }
})

test('implementation dispatch maps typed failures', () => {
  const validDetails = [
    ...['conflicting-seams', 'empty-buffer', 'invalid-audit-base', 'invalid-option', 'invalid-plan-fingerprint', 'invalid-task-heading', 'invalid-task-id', 'invalid-dispatch-id', 'invalid-scratch-path', 'not-buffer', 'not-canonical-root', 'root-alias', 'root-not-ordinary', 'root-unavailable', 'too-large', 'unknown-key']
      .map((reason) => ['dispatch-input', { field: 'field', reason }]),
    ['git-command', { args: ['rev-parse', 'HEAD'], operation: 'resolve-tip', status: null, stderr: '' }],
    ['git-command', { args: ['rev-parse', 'HEAD'], operation: 'resolve-tip', status: 1, stderr: 'failure\n' }],
    ...['kind-changed', 'metadata-unavailable', 'metadata-not-ordinary', 'root-mismatch']
      .map((cause) => ['repository-classification', { cause, path: 'C:\\repo' }]),
    ['plan-stamp', { kind: 'missing' }],
    ['plan-stamp', { kind: 'malformed', line: '- revise-plan graduated invalid' }],
    ...['unsupported-format', 'width-mismatch', 'resolution-failed', 'resolved-id-mismatch']
      .map((kind) => ['object-format', { kind, objectFormat: kind === 'unsupported-format' ? 'sha512' : 'sha1', stampSha: 'abcdef1', storedAuditBase: null }]),
    ['ignore-policy', { expectedPattern: '/.tmp/', observedPattern: null, observedSource: null, path: '.tmp/' }],
    ['ignore-policy', { expectedPattern: '/.tmp/', observedPattern: '/tmp/', observedSource: '.gitignore', path: '.tmp/' }],
    ['superpowers-policy', { expectedPattern: null, observedPattern: null, observedSource: null, path: '.superpowers/' }],
    ['superpowers-policy', { expectedPattern: null, observedPattern: '.superpowers/', observedSource: '.gitignore', path: '.superpowers/' }],
    ['history-base', { auditBase: 'a'.repeat(40), kind: 'missing-object' }],
    ['history-base', { auditBase: 'a'.repeat(40), kind: 'non-ancestor' }],
    ['history-base', { auditBase: 'a'.repeat(40), expectedTip: 'b'.repeat(40), kind: 'tip-changed', observedTip: 'c'.repeat(40) }],
    ['staged-scratch', { paths: ['.tmp/a', '.tmp/b'] }],
    ['committed-scratch', { offenders: [{ commit: 'a', path: '.tmp/a' }, { commit: 'a', path: '.tmp/b' }, { commit: 'b', path: '.tmp/a' }] }],
    ['scratch-allocation', { cause: 'root-unavailable', path: 'C:\\repo\\.tmp' }],
    ['scratch-allocation', { cause: 'parent-alias', path: 'C:\\repo\\.tmp' }],
    ['scratch-allocation', { cause: 'containment-failure', path: 'C:\\outside' }],
    ['scratch-tracked', { path: '.tmp/implementation-id' }],
    ...['commit-count', 'offender-count', 'offender-bytes'].map((kind) => ['audit-limit', { kind, limit: 1, observed: 2 }]),
  ]
  for (const [code, details] of validDetails) {
    const error = new ImplementationDispatchError(code, 'valid details', details)
    assert.equal(error.name, 'ImplementationDispatchError')
    assert.equal(error.message, `${code}: valid details`)
    assert.equal(error.code, code)
    assert.deepEqual(error.details, details)
  }

  const codes = ['dispatch-input', 'git-command', 'repository-classification', 'plan-stamp', 'object-format', 'ignore-policy', 'superpowers-policy', 'history-base', 'staged-scratch', 'committed-scratch', 'scratch-allocation', 'scratch-tracked', 'audit-limit']
  for (const code of codes) {
    assert.throws(() => new ImplementationDispatchError(code, 'missing details'), TypeError)
    assert.throws(() => new ImplementationDispatchError(code, 'null details', null), TypeError)
    assert.throws(() => new ImplementationDispatchError(code, 'array details', []), TypeError)
  }
  assert.throws(() => new ImplementationDispatchError('unknown-code', 'unknown', {}), TypeError)

  for (const [code, missing, malformed] of [
    ['dispatch-input', { field: 'field' }, { field: 1, reason: 'unknown-key' }],
    ['git-command', { args: [], operation: 'x', status: null }, { args: [1], operation: 'x', status: null, stderr: '' }],
    ['repository-classification', { cause: 'root-mismatch' }, { cause: 'other', path: 'x' }],
    ['plan-stamp', {}, { kind: 'malformed' }],
    ['object-format', { kind: 'width-mismatch', objectFormat: 'sha1', stampSha: 'abcdef1' }, { kind: 'other', objectFormat: 'sha1', stampSha: 'abcdef1', storedAuditBase: null }],
    ['ignore-policy', { expectedPattern: '/.tmp/', observedPattern: null, observedSource: null }, { expectedPattern: '/tmp/', observedPattern: null, observedSource: null, path: '.tmp/' }],
    ['superpowers-policy', { expectedPattern: null, observedPattern: null, observedSource: null }, { expectedPattern: '/.superpowers/', observedPattern: null, observedSource: null, path: '.superpowers/' }],
    ['history-base', { auditBase: 'a', kind: 'tip-changed' }, { auditBase: 'a', kind: 'other' }],
    ['staged-scratch', {}, { paths: ['b', 'a'] }],
    ['committed-scratch', {}, { offenders: [{ commit: 'b', path: 'a' }, { commit: 'a', path: 'z' }] }],
    ['scratch-allocation', { cause: 'x' }, { cause: 1, path: 'x' }],
    ['scratch-tracked', {}, { path: 1 }],
    ['audit-limit', { kind: 'commit-count', limit: 1 }, { kind: 'other', limit: 1, observed: 2 }],
  ]) {
    assert.throws(() => new ImplementationDispatchError(code, 'missing key', missing), TypeError)
    assert.throws(() => new ImplementationDispatchError(code, 'malformed value', malformed), TypeError)
  }

  const validByCode = new Map(validDetails.filter(([code], index, entries) => entries.findIndex(([candidate]) => candidate === code) === index))
  for (const code of codes) {
    assert.throws(() => new ImplementationDispatchError(code, 'extra key', { ...validByCode.get(code), extra: true }), TypeError)
  }
  assert.throws(() => new ImplementationDispatchError('staged-scratch', 'duplicate path', { paths: ['a', 'a'] }), TypeError)
  assert.throws(() => new ImplementationDispatchError('committed-scratch', 'wrong path order', { offenders: [{ commit: 'a', path: 'b' }, { commit: 'a', path: 'a' }] }), TypeError)
  assert.throws(() => new ImplementationDispatchError('committed-scratch', 'wrong commit order', { offenders: [{ commit: 'b', path: 'a' }, { commit: 'a', path: 'z' }] }), TypeError)

  const repositoryRoot = 'C:\\repo'
  const planBytes = Buffer.from('# Plan\n- revise-plan graduated 2026-09-01 12:00 at abcdef1, scope: x, content: 12345678\n')
  const storedAuditBase = `abcdef1${'a'.repeat(33)}`
  const validGit = (_root, args) => gitEnvelope({ stdout: args.includes('--show-object-format=storage') ? Buffer.from('sha1\n') : args.includes('--verify') ? Buffer.from(`${storedAuditBase}\n`) : Buffer.alloc(0) })

  for (const publicCall of [
    () => classifyImplementationRepository({ repositoryRoot: 'relative' }, { filesystem: dispatchFilesystem('relative'), git: validGit }),
    () => resolveImplementationAuditBase({ planBytes, repositoryRoot: 'relative', storedAuditBase }, { filesystem: dispatchFilesystem('relative'), git: validGit }),
    () => classifyImplementationRepository({}, { filesystem: dispatchFilesystem(repositoryRoot), git: validGit }),
    () => resolveImplementationAuditBase({ planBytes, storedAuditBase }, { filesystem: dispatchFilesystem(repositoryRoot), git: validGit }),
  ]) {
    assertDispatchFailure(publicCall, 'dispatch-input', { field: 'repositoryRoot', reason: 'not-canonical-root' })
  }

  const rootFailureCases = [
    {
      classifier: { cause: 'metadata-not-ordinary', path: repositoryRoot },
      filesystem: dispatchFilesystem(repositoryRoot, { realRoot: 'C:\\canonical' }),
      resolver: { field: 'repositoryRoot', reason: 'root-alias' },
    },
    {
      classifier: { cause: 'metadata-unavailable', path: repositoryRoot },
      filesystem: dispatchFilesystem(repositoryRoot, { rootError: Object.assign(new Error('missing'), { code: 'ENOENT' }) }),
      resolver: { field: 'repositoryRoot', reason: 'root-unavailable' },
    },
    {
      classifier: { cause: 'metadata-not-ordinary', path: repositoryRoot },
      filesystem: {
        realpathSync: { native: (value) => value },
        lstatSync: () => ({ isDirectory: () => false, isReparsePoint: () => false, isSymbolicLink: () => false }),
      },
      resolver: { field: 'repositoryRoot', reason: 'root-not-ordinary' },
    },
  ]
  for (const vector of rootFailureCases) {
    assertDispatchFailure(
      () => classifyImplementationRepository({ repositoryRoot }, { filesystem: vector.filesystem, git: validGit }),
      'repository-classification',
      vector.classifier,
    )
    assertDispatchFailure(
      () => resolveImplementationAuditBase({ planBytes, repositoryRoot, storedAuditBase }, { filesystem: vector.filesystem, git: validGit }),
      'dispatch-input',
      vector.resolver,
    )
  }

  const optionContainers = [null, [], () => {}, 'x', 1, true, new Date(0)]
  for (const options of optionContainers) {
    for (const publicCall of [
      () => classifyImplementationRepository({ repositoryRoot }, options),
      () => resolveImplementationAuditBase({ planBytes, repositoryRoot, storedAuditBase }, options),
    ]) assertDispatchFailure(publicCall, 'dispatch-input', { field: 'options', reason: 'invalid-option' })
  }

  for (const vector of [
    { options: { nope: 1 }, details: { field: 'options.nope', reason: 'unknown-key' } },
    { options: { uuid: null }, details: { field: 'options.uuid', reason: 'unknown-key' } },
    { options: { filesystem: null }, details: { field: 'options.filesystem', reason: 'invalid-option' } },
    { options: { git: null }, details: { field: 'options.git', reason: 'invalid-option' } },
    { options: { resolveGitExecutable: null }, details: { field: 'options.resolveGitExecutable', reason: 'invalid-option' } },
    { options: { spawnSync: null }, details: { field: 'options.spawnSync', reason: 'invalid-option' } },
    { options: { git: validGit, resolveGitExecutable: () => 'C:\\git.exe' }, details: { field: 'options', reason: 'conflicting-seams' } },
    { options: { git: validGit, spawnSync: () => ({}) }, details: { field: 'options', reason: 'conflicting-seams' } },
  ]) {
    for (const publicCall of [
      () => classifyImplementationRepository({ repositoryRoot }, vector.options),
      () => resolveImplementationAuditBase({ planBytes, repositoryRoot, storedAuditBase }, vector.options),
    ]) assertDispatchFailure(publicCall, 'dispatch-input', vector.details)
  }

  for (const vector of [
    { action: () => deriveImplementationTaskBrief(null), details: { field: 'input', reason: 'unknown-key' } },
    { action: () => deriveImplementationTaskBrief({ planBytes: Buffer.from('### Task 1: x\n'), taskHeading: '### Task 1: x', extra: true }), details: { field: 'extra', reason: 'unknown-key' } },
    { action: () => deriveImplementationTaskBrief({ taskHeading: '### Task 1: x' }), details: { field: 'planBytes', reason: 'not-buffer' } },
    { action: () => classifyImplementationRepository({ repositoryRoot, extra: true }), details: { field: 'extra', reason: 'unknown-key' } },
    { action: () => resolveImplementationAuditBase(null), details: { field: 'input', reason: 'unknown-key' } },
    { action: () => resolveImplementationAuditBase({ planBytes, repositoryRoot, storedAuditBase, extra: true }), details: { field: 'extra', reason: 'unknown-key' } },
    { action: () => resolveImplementationAuditBase({ repositoryRoot, storedAuditBase }), details: { field: 'planBytes', reason: 'not-buffer' } },
    { action: () => resolveImplementationAuditBase({ planBytes, repositoryRoot }), details: { field: 'storedAuditBase', reason: 'invalid-audit-base' } },
  ]) assertDispatchFailure(vector.action, 'dispatch-input', vector.details)

  const reorderedBrief = deriveImplementationTaskBrief({ taskHeading: '### Task 1: x', planBytes: Buffer.from('### Task 1: x\n') })
  assert.deepEqual(reorderedBrief, { briefBytes: Buffer.from('### Task 1: x\n'), taskTitle: 'x' })
  assert.deepEqual(
    resolveImplementationAuditBase({ storedAuditBase, repositoryRoot, planBytes }, { git: validGit, filesystem: dispatchFilesystem(repositoryRoot) }),
    { auditBase: storedAuditBase, objectFormat: 'sha1', stampSha: 'abcdef1' },
  )
})

test('ready and plan binding runtime closures exclude init-backlog infrastructure', () => {
  const forbiddenRoot = join(PUBLIC_SKILLS_ROOT, 'init-backlog')
  for (const entryPath of [join(PUBLIC_SKILLS_ROOT, 'ready', 'ready.js'), join(REPOSITORY_ROOT, 'internal', 'plan-binding.js')]) {
    const forbidden = runtimeModuleClosure(entryPath).filter((loadedPath) => {
      const relation = relative(forbiddenRoot, loadedPath)

      return relation === '' || relation.split(/[\\/]/)[0] !== '..'
    })
    assert.deepEqual(forbidden, [], `${entryPath} must not load init-backlog infrastructure`)
  }
})

test('neutral runtime primitive closures contain no skill modules', () => {
  for (const fileName of ['backlog-catalog.js', 'filesystem-primitives.js', 'git-runner.js']) {
    const entryPath = join(REPOSITORY_ROOT, 'internal', fileName)
    requireRegularFile(entryPath)
    const skills = runtimeModuleClosure(entryPath).filter((loadedPath) => {
      const relation = relative(PUBLIC_SKILLS_ROOT, loadedPath)

      return relation === '' || relation.split(/[\\/]/)[0] !== '..'
    })
    assert.deepEqual(skills, [], `${entryPath} must not load skill infrastructure`)
  }
})

test('neutral stable open keeps Windows scalar validation bound to the actual host', { skip: process.platform !== 'win32' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'nightshift-stable-open-scalar-'))
  try {
    const { stableOpenFile } = require('../internal/filesystem-primitives')
    const unsafeTarget = join(root, String.fromCodePoint(0x10ffff))

    assert.throws(() => stableOpenFile(root, unsafeTarget, { platform: 'linux' }), TypeError)
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})

test('procedure fidelity retains each substantial workflow except its declared topology terms', () => {
  for (const entryName of Object.keys(PROCEDURE_REPLACEMENTS)) {
    const fixtureCommandPath = join(FIXTURE_ROOT, 'commands', `${entryName}.md`)
    const migratedSkillPath = join(PUBLIC_SKILLS_ROOT, entryName, 'SKILL.md')
    const fixtureFrontmatter = parseFrontmatter(fixtureCommandPath)
    const migratedFrontmatter = parseFrontmatter(migratedSkillPath)
    assert.equal(migratedFrontmatter.fields.description, fixtureFrontmatter.fields.description, `${entryName} description must remain unchanged`)
    assert.equal(normalizeCurrentProcedure(entryName, readRequiredFile(migratedSkillPath)), normalizeProcedure(entryName, readRequiredFile(fixtureCommandPath)), `${entryName} body differs outside allowed topology replacements`)
  }
})

test('handover pins the durable queue lifecycle contract', () => {
  const body = parseFrontmatter(join(PUBLIC_SKILLS_ROOT, 'handover', 'SKILL.md')).body
  const scopeStart = body.indexOf('## Scope')
  const agreementStart = body.indexOf('## Agreement and stage entry')
  assert.notEqual(scopeStart, -1, 'handover must define its scope')
  assert.notEqual(agreementStart, -1, 'handover must define agreement and stage entry')
  assert.equal(scopeStart < agreementStart, true, 'handover scope must precede agreement and stage entry')
  const scopeSection = body.slice(scopeStart, agreementStart)

  for (const [contractTerm, expectation] of [
    ['`.tmp/handover-queue.md` in the project root', 'name the durable queue path'],
    ['bundled `handover-queue.js` controller', 'name the deterministic queue owner'],
    ['`- [ ] <step number>. <step name>`', 'pin the queued step line form'],
    ['`- [x]` is the sole completion mark', 'pin a single completion mark a resuming session can recognize'],
    ['an absent file is the ordinary fresh-run case', 'state the absent-file branch'],
    ['idempotent write', 'state that re-marking a completed step is idempotent'],
    ['repository-local ordinary single-link file that is ignored and untracked', 'bind the queue to a safe physical file'],
    ['stable two-read identity check', 'require stable queue capture'],
  ]) {
    assert.equal(countExact(scopeSection, contractTerm), 1, `handover scope must ${expectation} exactly once`)
  }

  assert.equal(countExact(scopeSection, '`implementationAuditBase`'), 1)
  assert.equal(countExact(scopeSection, '`bindImplementationAuditBase`'), 1)
  assert.equal(countExact(scopeSection, 'canonical version-1 queue'), 1)
  assert.equal(scopeSection.includes('returns exactly `{ complete, nextStep, sourceBuffer }`'), true)
  assert.equal(scopeSection.includes('returns replacement bytes plus the bound value'), false)

  const rebuildGuard = 'scratch state can never skip a lifecycle gate'
  assert.equal(countExact(body, rebuildGuard), 1, 'handover must restart at the ladder when queue marks would skip a gate')
  assert.equal(countExact(body, 'a queue may resume earlier than or at the detected ladder step, never later'), 1, 'handover must treat the ladder as the latest safe resume bound')
  assert.equal(countExact(body, 'completing step 12 marks steps 10 and 12 together'), 1, 'handover must model the coupled step-10 and step-12 tail marks')
  assert.equal(body.indexOf(rebuildGuard) > agreementStart, true, 'the resume branch must live in the agreement and stage entry procedure')
  assert.equal(body.includes('sub-step resume is deliberately not tracked'), false, 'handover must not deny the cross-session step resume the queue now provides')
})

test('handover pins implementation dispatch scratch isolation', () => {
  const body = parseFrontmatter(join(PUBLIC_SKILLS_ROOT, 'handover', 'SKILL.md')).body
  const startMarker = '4. **Implement the plan**'
  const endMarker = '5. ' + String.fromCharCode(96) + '/nightshift:revise-code' + String.fromCharCode(96)
  assert.equal(countExact(body, startMarker), 1)
  assert.equal(countExact(body, endMarker), 1)
  const implementationStep = body.slice(body.indexOf(startMarker), body.indexOf(endMarker))

  assert.equal(implementationStep.includes('`resolveImplementationAuditBase`'), true)
  assert.equal(implementationStep.includes('`inspectImplementationBoundary`'), true)
  assert.equal(implementationStep.includes('`createImplementationScratch`'), true)
  assert.equal(countExact(implementationStep, 'performs no automatic cleanup'), 1)
  assert.equal(implementationStep.includes('add `.superpowers/` to the project\'s `.gitignore`'), false)
  assert.equal(implementationStep.includes('use the retained resolver `auditBase` for the entry or resume audit'), true)
  assert.equal(implementationStep.includes('use that returned ID'), false)
  for (const boundaryName of ['Entry or resume boundary', 'First pre-dispatch boundary', 'Later pre-dispatch boundary', 'Post-return boundary', 'Pre-exit boundary']) {
    assert.equal(implementationStep.includes(boundaryName), true)
  }
  for (const contractTerm of [
    'original, repair, replacement, or replay dispatch',
    'exact `/.tmp/` rule',
    'staged-path audit',
    'commit-by-commit audit',
    'retained non-Git branch',
    'user-owned remediation',
    'For every failure outcome, preserve the exact queue bytes with step 4 unchecked.',
    'Only after every required post-return boundary passes may the pre-exit boundary run and the queue advance.',
    'A crash before verified replacement leaves step 4 unchecked and reruns the implementation success boundary; a crash after replacement resumes at revise-code.',
  ]) {
    assert.equal(implementationStep.includes(contractTerm), true)
  }

  const orderedMarkers = [
    'Queue migration boundary:',
    'Selected-task validation boundary:',
    'Repository classification boundary:',
    'Scratch allocation boundary:',
    'Prompt finalization boundary:',
    'Assigned-path inspection boundary:',
    'Final repository classification boundary:',
    'External dispatch boundary:',
  ]
  const terminalMarker = 'Terminal outcomes boundary:'
  const postReturnMarker = 'Single post-return boundary:'
  const nonGitMarker = 'Non-Git post-return boundary:'
  const dispatchTerminalBoundarySentence = 'External dispatch boundary: invoke the external agent exactly once; its result is exactly one Terminal outcomes boundary: normal return, thrown error, cancellation, or interruption, and each enters Single post-return boundary: exactly once.'

  function assertLifecycleOrder(text) {
    for (const marker of [...orderedMarkers, terminalMarker, postReturnMarker, nonGitMarker]) assert.equal(countExact(text, marker), 1)
    for (let index = 1; index < orderedMarkers.length; index += 1) assert.equal(text.indexOf(orderedMarkers[index - 1]) < text.indexOf(orderedMarkers[index]), true)
    assert.equal(text.indexOf(orderedMarkers.at(-1)) < text.indexOf(terminalMarker), true)
    assert.equal(text.indexOf(terminalMarker) < text.indexOf(postReturnMarker), true)
    assert.equal(countExact(text, dispatchTerminalBoundarySentence), 1)
    assert.equal(text.indexOf(postReturnMarker) < text.indexOf(nonGitMarker), true)
    assert.equal(countExact(text, 'normal return'), 1)
    assert.equal(countExact(text, 'thrown error'), 1)
    assert.equal(countExact(text, 'cancellation'), 1)
    assert.equal(countExact(text, 'interruption'), 1)
    assert.equal(countExact(text, 'Dispatch failure'), 1)
    assert.equal(countExact(text, 'Boundary failure'), 1)
    assert.equal(text.indexOf('Dispatch failure') < text.indexOf('Boundary failure'), true)
  }

  assertLifecycleOrder(implementationStep)
  const swapped = implementationStep
    .replace('Prompt finalization boundary:', 'LIFECYCLE_SWAP_SENTINEL')
    .replace('Assigned-path inspection boundary:', 'Prompt finalization boundary:')
    .replace('LIFECYCLE_SWAP_SENTINEL', 'Assigned-path inspection boundary:')
  assert.throws(() => assertLifecycleOrder(swapped))
  const brokenDispatchBridge = implementationStep.replace(
    dispatchTerminalBoundarySentence,
    'External dispatch boundary: invoke the external agent. Terminal outcomes boundary: Single post-return boundary:',
  )
  assert.throws(() => assertLifecycleOrder(brokenDispatchBridge))
  assert.throws(() => assertLifecycleOrder(implementationStep.replace('interruption', 'interrupted outcome')))
})

test('handover queue accepts reordered creation input without changing durable ordering', () => {
  const authority = { artifactPath: '.claude/features/example.md', planFingerprint: 'none', targetScope: 'whole file' }

  const sourceBuffer = createQueue({ entryStep: 5, authority })

  assert.equal(sourceBuffer.toString('utf8'), [
    '{"artifactPath":".claude/features/example.md","entryStep":5,"implementationAuditBase":null,"planFingerprint":"none","protocolVersion":2,"targetScope":"whole file"}',
    '- [ ] 5. Revise code',
    '- [ ] 6. Verify end-to-end',
    '- [ ] 7. Revise docs',
    '- [ ] 8. Backlog bookkeeping check',
    '- [ ] 9. Revise lore',
    '- [ ] 10. Persist workflow edits',
    '- [ ] 11. Full test suite',
    '- [ ] 12. Morning report',
    '',
  ].join('\n'))
})

test('handover queue accepts reordered authority records', () => {
  const authority = { targetScope: 'whole file', planFingerprint: 'none', artifactPath: '.claude/features/example.md' }

  const sourceBuffer = createQueue({ authority, entryStep: 5 })

  assert.equal(sourceBuffer.toString('utf8').split('\n')[0], '{"artifactPath":".claude/features/example.md","entryStep":5,"implementationAuditBase":null,"planFingerprint":"none","protocolVersion":2,"targetScope":"whole file"}')
})

test('handover queue migrates version 1 and binds audit bases', () => {
  const authority = { artifactPath: '.claude/features/example.md', planFingerprint: 'none', targetScope: 'whole file' }
  const evidence = { ignored: true, ordinary: true, singleLink: true, stable: true, tracked: false }
  const sourceBuffer = createQueue({ authority, entryStep: 5 })

  assert.equal(QUEUE_PROTOCOL_VERSION, 2)
  assert.equal(sourceBuffer.toString('utf8').split('\n')[0], '{"artifactPath":".claude/features/example.md","entryStep":5,"implementationAuditBase":null,"planFingerprint":"none","protocolVersion":2,"targetScope":"whole file"}')

  const legacy = Buffer.from([
    '{"artifactPath":".claude/features/example.md","entryStep":4,"planFingerprint":"none","protocolVersion":1,"targetScope":"whole file"}',
    '- [ ] 4. Implement the plan',
    '- [ ] 5. Revise code',
    '- [ ] 6. Verify end-to-end',
    '- [ ] 7. Revise docs',
    '- [ ] 8. Backlog bookkeeping check',
    '- [ ] 9. Revise lore',
    '- [ ] 10. Persist workflow edits',
    '- [ ] 11. Full test suite',
    '- [ ] 12. Morning report',
    '',
  ].join('\n'))
  const migrated = resumeQueue({ detectedEntryStep: 4, evidence, expectedAuthority: authority, sourceBuffer: legacy })
  assert.equal(migrated.kind, 'live')
  assert.equal(JSON.parse(migrated.sourceBuffer.toString('utf8').split('\n')[0]).implementationAuditBase, null)
  assert.equal(JSON.parse(migrated.sourceBuffer.toString('utf8').split('\n')[0]).protocolVersion, 2)
  assert.throws(() => advanceQueue({ completedStep: 4, currentAuthority: authority, evidence, nextAuthority: authority, sourceBuffer: legacy }), /Queue header is not canonical/)

  const legacyRestart = Buffer.from(legacy.toString('utf8').replace('- [ ] 4. Implement the plan', '- [x] 4. Implement the plan'))
  const restarted = resumeQueue({ detectedEntryStep: 3, evidence, expectedAuthority: authority, sourceBuffer: legacyRestart })
  assert.equal(restarted.kind, 'restart')
  assert.equal(JSON.parse(restarted.sourceBuffer.toString('utf8').split('\n')[0]).protocolVersion, 2)
  assert.equal(JSON.parse(restarted.sourceBuffer.toString('utf8').split('\n')[0]).implementationAuditBase, null)
  assert.equal(restarted.sourceBuffer.toString('utf8').includes('- [x]'), false)

  const legacyDead = Buffer.from(legacy.toString('utf8').replaceAll('- [ ]', '- [x]'))
  const dead = resumeQueue({ detectedEntryStep: 4, evidence, expectedAuthority: authority, sourceBuffer: legacyDead })
  assert.equal(dead.kind, 'dead')
  assert.equal(JSON.parse(dead.sourceBuffer.toString('utf8').split('\n')[0]).protocolVersion, 2)
  assert.equal(JSON.parse(dead.sourceBuffer.toString('utf8').split('\n')[0]).implementationAuditBase, null)
  assert.equal(dead.sourceBuffer.toString('utf8').includes('- [x]'), false)

  const implementationSource = createQueue({ authority, entryStep: 4 })
  const bound = bindImplementationAuditBase({ currentAuthority: authority, evidence, implementationAuditBase: 'a'.repeat(40), sourceBuffer: implementationSource })
  assert.deepEqual(Object.keys(bound), ['complete', 'nextStep', 'sourceBuffer'])
  assert.equal(bound.complete, false)
  assert.equal(bound.nextStep, 4)
  assert.equal(JSON.parse(bound.sourceBuffer.toString('utf8').split('\n')[0]).implementationAuditBase, 'a'.repeat(40))
  assert.deepEqual(bindImplementationAuditBase({ currentAuthority: authority, evidence, implementationAuditBase: 'a'.repeat(40), sourceBuffer: bound.sourceBuffer }), bound)
  const refreshedAuthority = { ...authority, planFingerprint: `sha256:${'d'.repeat(64)}` }
  const advanced = advanceQueue({ completedStep: 4, currentAuthority: authority, evidence, nextAuthority: refreshedAuthority, sourceBuffer: bound.sourceBuffer })
  assert.equal(JSON.parse(advanced.sourceBuffer.toString('utf8').split('\n')[0]).implementationAuditBase, 'a'.repeat(40))
  assert.deepEqual(advanceQueue({ completedStep: 4, currentAuthority: refreshedAuthority, evidence, nextAuthority: refreshedAuthority, sourceBuffer: advanced.sourceBuffer }), advanced)
  assert.throws(() => bindImplementationAuditBase({ currentAuthority: authority, evidence, implementationAuditBase: 'c'.repeat(40), sourceBuffer: bound.sourceBuffer }))
  assert.throws(() => bindImplementationAuditBase({ currentAuthority: authority, evidence, implementationAuditBase: null, sourceBuffer: implementationSource }), /full object ID/)
  assert.throws(() => bindImplementationAuditBase({ currentAuthority: authority, evidence: { ...evidence, tracked: true }, implementationAuditBase: 'b'.repeat(64), sourceBuffer }))
  assert.throws(() => bindImplementationAuditBase({ currentAuthority: refreshedAuthority, evidence, implementationAuditBase: 'b'.repeat(64), sourceBuffer }))
  assert.throws(() => bindImplementationAuditBase({ currentAuthority: authority, evidence, implementationAuditBase: 'b'.repeat(64), sourceBuffer: legacy }))
  assert.throws(() => bindImplementationAuditBase({ currentAuthority: authority, evidence, implementationAuditBase: 'b'.repeat(64), sourceBuffer: createQueue({ authority, entryStep: 5 }) }))
})

test('handover queue accepts reordered evidence records', () => {
  const authority = { artifactPath: '.claude/features/example.md', planFingerprint: 'none', targetScope: 'whole file' }
  const evidence = { tracked: false, stable: true, singleLink: true, ordinary: true, ignored: true }
  const sourceBuffer = createQueue({ authority, entryStep: 5 })

  assert.deepEqual(resumeQueue({ detectedEntryStep: 5, evidence, expectedAuthority: authority, sourceBuffer }), { kind: 'live', nextStep: 5, sourceBuffer })
})

test('handover queue rejects a UTF-8 BOM before a valid queue', () => {
  const authority = { artifactPath: '.claude/features/example.md', planFingerprint: 'none', targetScope: 'whole file' }
  const evidence = { ignored: true, ordinary: true, singleLink: true, stable: true, tracked: false }
  const sourceBuffer = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), createQueue({ authority, entryStep: 5 })])

  assert.throws(
    () => resumeQueue({ detectedEntryStep: 5, evidence, expectedAuthority: authority, sourceBuffer }),
    /Queue source encoding is not canonical/,
  )
})

test('handover queue rejects malformed authority and cannot outrun the ladder', () => {
  const authority = { artifactPath: '.claude/features/example.md', planFingerprint: `sha256:${'a'.repeat(64)}`, targetScope: 'whole file' }
  const evidence = { ignored: true, ordinary: true, singleLink: true, stable: true, tracked: false }
  const sourceBuffer = createQueue({ authority, entryStep: 4 })
  const text = sourceBuffer.toString('utf8')
  const lines = text.trimEnd().split('\n')

  assert.deepEqual(resumeQueue({ detectedEntryStep: 4, evidence, expectedAuthority: authority, sourceBuffer }), { kind: 'live', nextStep: 4, sourceBuffer })
  for (const malformed of [
    Buffer.from(text.replace(lines[0], `{"entryStep":4,"artifactPath":".claude/features/example.md","planFingerprint":"sha256:${'a'.repeat(64)}","protocolVersion":1,"targetScope":"whole file"}`)),
    Buffer.from([...lines.slice(0, 2), ...lines.slice(3)].join('\n') + '\n'),
    Buffer.from([...lines, lines[1]].join('\n') + '\n'),
    Buffer.from([lines[0], lines[2], lines[1], ...lines.slice(3)].join('\n') + '\n'),
    Buffer.from(text.replace('4. Implement the plan', '4. Skip the plan')),
    Buffer.from([lines[0], lines[1], lines.at(-1)].join('\n') + '\n'),
    Buffer.from(text.replace('- [ ] 5.', '- [x] 5.')),
  ]) {
    assert.throws(() => resumeQueue({ detectedEntryStep: 4, evidence, expectedAuthority: authority, sourceBuffer: malformed }))
  }

  let advanced = sourceBuffer
  for (const completedStep of [4, 5, 6, 7, 8, 9, 11]) {
    advanced = advanceQueue({ completedStep, currentAuthority: authority, evidence, nextAuthority: authority, sourceBuffer: advanced }).sourceBuffer
  }
  const restarted = resumeQueue({ detectedEntryStep: 5, evidence, expectedAuthority: authority, sourceBuffer: advanced })

  assert.equal(restarted.kind, 'restart')
  assert.equal(restarted.nextStep, 5)
  assert.match(restarted.sourceBuffer.toString('utf8'), /- \[ \] 5\. Revise code/)
  assert.equal(restarted.sourceBuffer.toString('utf8').includes('- [x]'), false)
})

test('handover queue models coupled tail completion and rejects untrusted files', () => {
  const authority = { artifactPath: '.claude/features/example.md', planFingerprint: 'none', targetScope: 'sections: Delivery' }
  const evidence = { ignored: true, ordinary: true, singleLink: true, stable: true, tracked: false }
  let sourceBuffer = createQueue({ authority, entryStep: 5 })
  for (const completedStep of [5, 6, 7, 8, 9]) {
    sourceBuffer = advanceQueue({ completedStep, currentAuthority: authority, evidence, nextAuthority: authority, sourceBuffer }).sourceBuffer
  }

  assert.throws(() => advanceQueue({ completedStep: 10, currentAuthority: authority, evidence, nextAuthority: authority, sourceBuffer }))
  const beforeReport = advanceQueue({ completedStep: 11, currentAuthority: authority, evidence, nextAuthority: authority, sourceBuffer })
  sourceBuffer = beforeReport.sourceBuffer
  assert.equal(beforeReport.nextStep, 12)
  const completed = advanceQueue({ completedStep: 12, currentAuthority: authority, evidence, nextAuthority: authority, sourceBuffer })

  assert.equal(completed.complete, true)
  for (const override of [
    { ignored: false },
    { ordinary: false },
    { singleLink: false },
    { stable: false },
    { tracked: true },
  ]) {
    assert.throws(() => resumeQueue({ detectedEntryStep: 5, evidence: { ...evidence, ...override }, expectedAuthority: authority, sourceBuffer }))
  }
  for (const override of [
    { artifactPath: '.claude/features/other.md' },
    { planFingerprint: `sha256:${'b'.repeat(64)}` },
    { targetScope: 'whole file' },
  ]) {
    assert.throws(() => resumeQueue({ detectedEntryStep: 5, evidence, expectedAuthority: { ...authority, ...override }, sourceBuffer }))
  }
})

test('handover queue rebinds plan authority and makes durable marks idempotent', () => {
  const initialAuthority = { artifactPath: '.claude/features/example.md', planFingerprint: 'none', targetScope: 'whole file' }
  const planAuthority = { ...initialAuthority, planFingerprint: `sha256:${'c'.repeat(64)}` }
  const evidence = { ignored: true, ordinary: true, singleLink: true, stable: true, tracked: false }
  const sourceBuffer = createQueue({ authority: initialAuthority, entryStep: 2 })
  const advanced = advanceQueue({ completedStep: 2, currentAuthority: initialAuthority, evidence, nextAuthority: planAuthority, sourceBuffer })

  assert.equal(resumeQueue({ detectedEntryStep: 3, evidence, expectedAuthority: planAuthority, sourceBuffer: advanced.sourceBuffer }).nextStep, 3)
  assert.deepEqual(
    advanceQueue({ completedStep: 2, currentAuthority: planAuthority, evidence, nextAuthority: planAuthority, sourceBuffer: advanced.sourceBuffer }),
    advanced,
  )
  assert.throws(() => createQueue({ authority: initialAuthority, entryStep: 6 }))
  assert.throws(() => resumeQueue({ detectedEntryStep: 12, evidence, expectedAuthority: planAuthority, sourceBuffer: advanced.sourceBuffer }))
})

test('init-backlog preserves scaffolding behavior over the controller and normalized assets', () => {
  const initBacklogPath = join(PUBLIC_SKILLS_ROOT, 'init-backlog', 'SKILL.md')
  const body = parseFrontmatter(initBacklogPath).body.replace(/\r?\n/g, '\n')
  const indexNames = ['QUICK_WINS.md', 'FEATURES.md', 'BUGS.md', 'PATTERNS.md']
  const finalPresentationRule = 'When a final governing design is presented, invoke /nightshift:spec-agreement in final-presentation mode before asking for agreement.'
  const freshnessRule = 'Existing agreement is fresh only when the complete current candidate matches or passes contract-fit evaluation in the same session.'

  assertInitBacklogScaffoldInventory(body)

  assert.match(body, /\*\*Index files\*\* \(four, top-level under `\.claude\/`\)/, 'init-backlog must retain its four-index target inventory')
  for (const indexName of indexNames) {
    assert.equal(body.includes(`- \`.claude/${indexName}\``), true, `init-backlog must target .claude/${indexName}`)
  }
  assert.match(body, /created from its manifest template/, 'init-backlog must create missing index files from the normalized manifest templates')
  assert.match(body, /skills\/init-backlog\/templates\//, 'init-backlog must reference the normalized template assets')
  assert.match(body, /manifest\.json/, 'init-backlog must reference the template manifest')

  assert.match(body, /version-control election/, 'init-backlog must retain the version-control election')
  assert.match(body, /tracked in git or ignored/, 'init-backlog must retain the track-vs-ignore choice')
  assert.match(body, /appends the elective backlog paths to `\.gitignore`/, 'init-backlog must implement the ignore election')
  assert.match(body, /`git rm --cached`/, 'init-backlog must retain the tracked-to-ignored migration warning')
  assert.equal(countExact(body, '`.claude/plans/` is git-ignored in every Git repository'), 1, 'init-backlog must require the plans-ignore policy unconditionally')
  const repositoryIgnore = readRequiredFile(join(REPOSITORY_ROOT, '.gitignore'))
  assert.equal(repositoryIgnore.split(/\r?\n/).includes('.claude/plans/'), true, 'this repository must git-ignore .claude/plans/ itself')

  assert.match(body, /idempotent: re-running on an existing project adds only what's missing/, 'init-backlog must remain add-missing and idempotent')
  assert.match(body, /Never overwrite an existing top-level index file or an existing subdirectory's contents/, 'init-backlog must preserve existing backlog content')
  assert.match(body, /Skip every up-to-date index file and every existing subdirectory/, 'init-backlog reruns must skip current targets')

  assert.match(body, /a Claude `@AGENTS\.md` delegation deliberately receives the Codex-neutral composition/, 'init-backlog must preserve adapter-delegation composition')
  assert.match(body, /host-canonical writable guidance target/, 'init-backlog must preserve host-canonical guidance target selection')
  assert.match(body, /\*\*Targeted-patch insertion rules\*\*[\s\S]*Never re-flow/, 'existing-root updates must remain targeted rather than destructive rewrites')
  assert.equal(countExact(body, finalPresentationRule), 1, 'init-backlog must protect the final-presentation checklist concept')
  assert.equal(countExact(body, freshnessRule), 1, 'init-backlog must protect the freshness checklist concept')

  assert.equal(body.includes('commands/'), false, 'init-backlog must not reference a duplicate host-specific command surface')
  requireAbsent(join(REPOSITORY_ROOT, 'commands', 'init-backlog.md'))
})

test('init-backlog scaffold contract rejects missing targets and confirmation', () => {
  const body = parseFrontmatter(join(PUBLIC_SKILLS_ROOT, 'init-backlog', 'SKILL.md')).body.replace(/\r?\n/g, '\n')
  const mutations = [
    ['.claude/features/', 'init-backlog must target .claude/features/ as a scaffold subdirectory'],
    ['.claude/bugs/', 'init-backlog must target .claude/bugs/ as a scaffold subdirectory'],
    ['.claude/patterns/', 'init-backlog must target .claude/patterns/ as a scaffold subdirectory'],
    ['.claude/plans/', 'init-backlog must target .claude/plans/ as a scaffold subdirectory'],
    ['QUICK_WINS_HISTORY.md', 'init-backlog must target .claude/QUICK_WINS_HISTORY.md as a top-level archive'],
    ['FEATURES_HISTORY.md', 'init-backlog must target .claude/FEATURES_HISTORY.md as a top-level archive'],
    ['BUGS_HISTORY.md', 'init-backlog must target .claude/BUGS_HISTORY.md as a top-level archive'],
    [INIT_BACKLOG_WRITER_DISCLOSURE_SENTENCE, 'init-backlog must require explicit approval before writes exactly once'],
    [INIT_BACKLOG_APPROVAL_SENTENCE, 'init-backlog must require explicit approval before writes exactly once'],
  ]

  for (const [removedText, expectedMessage] of mutations) {
    const mutatedBody = body.split(removedText).join('')
    assert.notEqual(mutatedBody, body, `mutation target must exist: ${removedText}`)
    assert.throws(
      () => assertInitBacklogScaffoldInventory(mutatedBody),
      (error) => error.name === 'AssertionError' && error.message.includes(expectedMessage),
      `removing ${removedText} must fail the scaffold contract`,
    )
  }
})

test('init-backlog topology requires the controller, shared internals, libraries, and normalized assets as regular files', () => {
  const controllerRoot = join(PUBLIC_SKILLS_ROOT, 'init-backlog')
  for (const fileName of ['backlog-catalog.js', 'filesystem-primitives.js', 'git-runner.js']) {
    requireRegularFile(join(REPOSITORY_ROOT, 'internal', fileName))
  }
  for (const fileName of ['SKILL.md', 'init-backlog.js', 'unwrap.js', 'windows-attributes.ps1']) {
    requireRegularFile(join(controllerRoot, fileName))
  }
  for (const libraryName of ['actions.js', 'apply-manifest.js', 'assets.js', 'backups.js', 'errors.js', 'filesystem.js', 'git-policy.js', 'guidance.js', 'inspection.js', 'protocol.js', 'publication.js', 'recovery.js', 'resume.js']) {
    requireRegularFile(join(controllerRoot, 'lib', libraryName))
  }
  const manifestPath = join(controllerRoot, 'templates', 'manifest.json')
  requireRegularFile(manifestPath)
  const templateManifest = JSON.parse(readRequiredFile(manifestPath))
  assert.equal(Array.isArray(templateManifest.assets) && templateManifest.assets.length > 0, true, 'template manifest must declare assets')
  for (const asset of templateManifest.assets) {
    requireRegularFile(join(controllerRoot, 'templates', asset.path))
  }
})

test('init-backlog embeds no prompt-owned template bodies', () => {
  const body = parseFrontmatter(join(PUBLIC_SKILLS_ROOT, 'init-backlog', 'SKILL.md')).body.replace(/\r?\n/g, '\n')
  assert.equal(countExact(body, '# Quick wins\n'), 0, 'skills/init-backlog/SKILL.md still contains the prompt-owned `# Quick wins` template body')
  assert.equal(countExact(body, '~~~markdown'), 0, 'init-backlog must not fence any prompt-owned template body')
  assert.equal(countExact(body, '### `.claude/'), 0, 'init-backlog must not carry per-target template headings')
})

test('handover procedure titles match the ordered queue inventory', () => {
  const { body } = parseFrontmatter(join(PUBLIC_SKILLS_ROOT, 'handover', 'SKILL.md'))
  const procedureTitles = extractHandoverProcedureTitles(body)

  assert.equal(procedureTitles.length, 12, 'handover must define all twelve lifecycle procedure steps')
  assert.deepEqual(procedureTitles, QUEUE_STEPS)
  const mutatedBody = body.replace('**Spec gate.**', '**Changed gate.**')
  assert.notEqual(mutatedBody, body, 'handover procedure mutation target must exist')
  assert.throws(() => assert.deepEqual(extractHandoverProcedureTitles(mutatedBody), QUEUE_STEPS), assert.AssertionError)
})

test('handover queue fails closed when named tail steps drift', () => {
  const queuePath = join(REPOSITORY_ROOT, 'skills', 'handover', 'handover-queue.js')
  const source = readRequiredFile(queuePath)
  const loadMutatedQueue = (mutatedSource) => {
    const module = { exports: {} }
    new Function('require', 'module', 'exports', mutatedSource)(require, module, module.exports)
  }

  for (const mutation of [
    ["  'Revise lore',", "  'Renamed lore',"],
    ["  'Morning report',", "  'Revise lore',"],
  ]) {
    assert.equal(source.split(mutation[0]).length, 2, `queue mutation target must be unique: ${mutation[0]}`)
    assert.throws(() => loadMutatedQueue(source.replace(mutation[0], mutation[1])), /Queue step name is not unique/)
  }
})

test('plan binding delegates containment to the shared filesystem primitive', () => {
  const source = readRequiredFile(join(REPOSITORY_ROOT, 'internal', 'plan-binding.js'))

  assert.match(source, /const \{[^}]*pathIsContained[^}]*\} = require\('\.\/filesystem-primitives'\)/)
  assert.equal(/function pathIsContained\s*\(/.test(source), false)
})

test('handover preserves lifecycle behavior behind the agreement gate', () => {
  const handoverPath = join(PUBLIC_SKILLS_ROOT, 'handover', 'SKILL.md')
  const { body } = parseFrontmatter(handoverPath)
  const agreementBody = parseFrontmatter(join(PUBLIC_SKILLS_ROOT, 'spec-agreement', 'SKILL.md')).body
  const agreementSectionStart = body.indexOf('## Agreement and stage entry')
  const orderedAgreementTokens = [
    `Load \`${AGREEMENT_PATH}\``,
    '`resolveGoverningSet`',
    'archive-backed completion no-op',
    '`decideAgreementGate`',
    '`detectLegacyMarkers`',
    'restart complete resolution from the cleaned on-disk bytes',
    'completed active-artifact no-op',
    'Exploring',
    'Resume the shared `lifecycle-entry` candidate, presentation, and authority procedure',
    'stable presentation baseline',
    '`callerResult.agreement`',
    '**Validate before proceeding.**',
    'build the single flat step queue in `.tmp/handover-queue.md`',
  ]
  assert.notEqual(agreementSectionStart, -1, 'handover must define agreement and stage entry')
  let previousIndex = agreementSectionStart
  for (const token of orderedAgreementTokens) {
    const tokenIndex = body.indexOf(token, previousIndex)
    assert.notEqual(tokenIndex, -1, `handover agreement ordering must include ${token}`)
    assert.equal(tokenIndex > previousIndex, true, `handover agreement ordering must place ${token} after its predecessor`)
    previousIndex = tokenIndex
  }

  const singleValidityRule = 'The mandatory validation above is not repeated because no governing artifact or repository baseline changes between it and this decision.'
  assert.equal(countExact(body, singleValidityRule), 1, 'handover must reuse the mandatory repository-currency validation at the staleness decision')
  assert.equal(countExact(body, 'fresh agent'), 1, 'handover must dispatch exactly one fresh repository-currency validator before queue construction')
  assert.equal(countExact(body, 'quick validity check'), 0, 'handover must not offer a duplicate subset of its mandatory validation')

  const orderedLadderTokens = [
    '1. **Late-stage tail already ran this session**',
    'no-op; say so.',
    '2. **Implementation complete**',
    'If complete: enter at step 5 (the late-stage tail).',
    '3. **Plan exists.**',
    'Hardened (stamp or same-session evidence): enter at step 4 (implementation). Not hardened: enter at step 3 (revise-plan).',
    '4. **Current agreement exists and no plan exists.**',
    'Hardened for the target scope',
    'enter at step 2 (planning). Not hardened: enter at step 1 (the spec gate).',
  ]
  let previousLadderIndex = body.indexOf('Walk the ladder top-down')
  assert.notEqual(previousLadderIndex, -1, 'handover must define the stage ladder')
  for (const token of orderedLadderTokens) {
    const tokenIndex = body.indexOf(token, previousLadderIndex)
    assert.notEqual(tokenIndex, -1, `handover stage ladder must include ${token}`)
    assert.equal(tokenIndex > previousLadderIndex, true, `handover stage ladder must place ${token} after its predecessor`)
    previousLadderIndex = tokenIndex
  }

  const sharedEntryStart = agreementBody.indexOf('## Entry procedure')
  const orderedSharedTokens = [
    '`resolveGoverningSet`',
    '`completed-no-op` resolution',
    '`decideAgreementGate`',
    'nonterminal active-artifact',
    '`detectLegacyMarkers`',
    'restart complete resolution from disk',
    'yield control to handover',
    'active-artifact completion no-op',
    'any Exploring member',
    'Build one stable presentation baseline',
  ]
  assert.notEqual(sharedEntryStart, -1, 'the shared gate must define its entry procedure')
  let previousSharedIndex = sharedEntryStart
  for (const token of orderedSharedTokens) {
    const tokenIndex = agreementBody.indexOf(token, previousSharedIndex)
    assert.notEqual(tokenIndex, -1, `the shared entry ordering must include ${token}`)
    assert.equal(tokenIndex > previousSharedIndex, true, `the shared entry ordering must place ${token} after its predecessor`)
    previousSharedIndex = tokenIndex
  }

  assert.equal(body.includes('resolve which feature and which scope this handover takes over'), true, 'handover must preserve target selection')
  assert.equal(body.includes('artifact named or implied by the invocation and conversation context first'), true, 'handover must preserve artifact selection')
  assert.equal(body.includes('does the described problem, design, and every file reference still hold?'), true, 'handover must preserve repository validation')
  assert.equal(body.includes('the stated conclusion is the user\'s interrupt point, not a question'), true, 'handover must preserve clean-detection continuation')
  assert.equal(body.includes('`serializePlanContract`'), true, 'handover planning must use the agreement serializer')
  assert.equal(body.includes('## Governing specs'), true, 'handover planning must serialize governing specs')
  assert.equal(body.includes('`callerResult.agreement` is only the complete public agreement-record projection'), true, 'handover must keep the public agreement projection closed')
  assert.equal(body.includes('`controllerContext.sessionState` remains the separate complete state authority'), true, 'handover must retain the complete state authority separately')
  assert.equal(body.includes('Read `fitEvidence` only from `controllerContext.sessionState.fitEvidence`'), true, 'handover must read fit evidence from controller state')
  assert.equal(body.includes('Repository-local plans are never committed and remain untracked'), true, 'handover must scope the never-committed policy to repository-local plans')
  assert.equal(body.includes('the standard `.claude/plans/` directory is unconditionally ignored'), true, 'handover must pin the standard repository-local plan policy')
  assert.equal(body.includes('a project-established custom repository-local location must carry an applicable ignore rule'), true, 'handover must pin the custom repository-local plan policy')
  assert.equal(body.includes('Global and external plans remain outside the current repository\'s Git policy'), true, 'handover must state the complementary global and external plan branch')
  assert.equal(body.includes('Plans are never committed: `.claude/plans/` is git-ignored.'), false, 'handover must not state a universal repository Git policy for plans')
  assert.equal(countExact(body, '`writeProvenanceStamp`'), 3, 'handover must name the shared provenance writer for refresh and both completion branches')
  for (const lifecycleContract of [
    '5. `/nightshift:revise-code`',
    'Valid-but-deferred findings flow into the follow-up items list across all rounds',
    '6. **Verify end-to-end.**',
    'Drive the affected flow in the running app or tool and observe the behavior',
    'report any surviving `(live-claim: provisional)` markers',
    '7. `/nightshift:revise-docs`',
    'update project docs to reflect what shipped',
    '8. **Backlog bookkeeping check.**',
    'history-archive entries appended',
    'slice bullets struck through',
    'walk-and-remove sweep applied to every other `**Requires:**` line',
    '9. `/nightshift:revise-lore`',
    'Project-repo lore',
    'may be applied and committed directly',
    'Workflow-instruction lore',
    'draft each candidate as a follow-up item',
    '10. **Persist workflow edits.**',
    'approved plugin follow-ups are applied inside step 12\'s post-triage tail, never earlier',
    '11. **Full test suite.**',
    'halt and surface failures before triage',
    '12. **Morning report.**',
    '**lore outcomes**',
    '**retrospective outcomes**',
    'one item per message',
    'record the user\'s disposition for each in the marker itself',
    'Write the dedicated-artifact completion stamp BEFORE the next offer',
    'then offer to remove the plan file',
    'Invalidate volatile agreement state on completion before returning.',
  ]) {
    assert.equal(body.includes(lifecycleContract), true, `handover must preserve lifecycle contract: ${lifecycleContract}`)
  }
  assert.equal(body.includes('Status:'), false, 'handover must not create or trust Status markers')
  assert.equal(body.toLowerCase().includes('signed off'), false, 'handover must not retain signed-off stage logic')
})

test('handover completion stamp policy distinguishes dedicated and index-only artifacts', () => {
  const handoverPath = join(PUBLIC_SKILLS_ROOT, 'handover', 'SKILL.md')
  const { body } = parseFrontmatter(handoverPath)

  assertHandoverCompletionStampPolicy(body)
  const skipRule = 'For an index-only backlog entry, do not invoke `writeProvenanceStamp`'
  assert.equal(countExact(body, skipRule), 1, 'handover completion mutation target must be unique')
  const mutatedBody = body.replace(skipRule, 'For an index-only backlog entry, invoke `writeProvenanceStamp`')
  assert.notEqual(mutatedBody, body, 'handover completion mutation target must exist')
  assert.throws(() => assertHandoverCompletionStampPolicy(mutatedBody), assert.AssertionError)
})

test('direct plugin dispatchers reserve Fable for the user-interacting controller', () => {
  const dispatcherBodies = [
    ['revise engine', readRequiredFile(join(ENGINE_ROOT, 'SKILL.md'))],
    ['handover', readRequiredFile(join(PUBLIC_SKILLS_ROOT, 'handover', 'SKILL.md'))],
    ['revise-lore', readRequiredFile(join(PUBLIC_SKILLS_ROOT, 'revise-lore', 'SKILL.md'))],
  ]

  assertFableReservationPolicy(dispatcherBodies)
  for (const [owner, body] of dispatcherBodies) {
    const mutatedBody = body.replace(FABLE_RESERVATION_POLICY, 'Fable is available for every agent role.')
    assert.notEqual(mutatedBody, body, `${owner} Fable-reservation mutation target must exist`)
    assert.throws(() => assertFableReservationPolicy([[owner, mutatedBody]]), assert.AssertionError)
  }
})

test('plan workflows share one physical binding and consume revalidated bytes', () => {
  const handoverBody = parseFrontmatter(join(PUBLIC_SKILLS_ROOT, 'handover', 'SKILL.md')).body
  const planBody = readRequiredFile(join(ENGINE_ROOT, 'plan.md'))
  const codeBody = readRequiredFile(join(ENGINE_ROOT, 'code.md'))
  const bindingPath = join(REPOSITORY_ROOT, 'internal', 'plan-binding.md')
  const bindingServicePath = join(REPOSITORY_ROOT, 'internal', 'plan-binding.js')
  const bindingBody = readRequiredFile(bindingPath)

  requireRegularFile(bindingPath)
  requireRegularFile(bindingServicePath)
  for (const contract of [
    'stable physical plan binding',
    'symbolic link, junction, or other reparse point',
    'project-established custom location, inference, or an exact user-supplied path',
    'actual repository-relative path is ignored and untracked',
    'Absence is the only confirmed non-Git state.',
    'Linked, special, or unreadable metadata is ambiguous',
    'A confirmed non-Git root skips only those Git ignore and tracking checks.',
    'link count is available and exactly one',
    'file size, stable content metadata',
    'Before modification time or content can influence inferred selection',
    'stable candidate set',
    "each binding's `mtimeNs`",
    "that binding's captured bytes",
    "retain that candidate's existing full binding",
    'Global and external plans are outside the current repository\'s ignore policy',
    'Call `revalidatePlanBinding` immediately before every authoritative plan read, plan mutation, or plan-derived dispatch.',
    'reclassifies every repository root',
    'returns the plan bytes read from the revalidated file identity',
    'never rereads the logical pathname between revalidation and use',
    'captured bytes and stable content metadata agree across both reads',
    'Immediately before replacement, repeat `revalidatePlanBinding`',
    'still has the captured baseline bytes',
    '`writePlanProvenanceStamp`',
    'returns the refreshed full binding',
    'failure stops the run before any read, write, dispatch, or deletion',
  ]) {
    assert.equal(bindingBody.includes(contract), true, `shared plan binding must preserve contract: ${contract}`)
  }

  for (const [body, owner] of [[handoverBody, 'handover'], [planBody, 'revise-plan'], [codeBody, 'revise-code']]) {
    assert.equal(body.includes('${CLAUDE_PLUGIN_ROOT}/internal/plan-binding.md'), true, `${owner} must load the shared plan binding procedure`)
    assert.equal(body.includes('${CLAUDE_PLUGIN_ROOT}/internal/plan-binding.js'), true, `${owner} must load the executable plan binding service`)
    assert.equal(body.includes('revalidatePlanBinding'), true, `${owner} must call executable plan revalidation`)
    assert.equal(body.includes('captured plan bytes'), true, `${owner} must consume plan bytes returned by revalidation`)
    for (const sharedOnlyContract of [
      'symbolic link, junction, or other reparse point',
      'project-established custom location, inference, or an exact user-supplied path',
      'actual repository-relative path is ignored and untracked',
      'link count is available and exactly one',
      'Global and external plans are outside the current repository\'s ignore policy',
    ]) {
      assert.equal(body.includes(sharedOnlyContract), false, `${owner} must not duplicate shared plan-binding contract: ${sharedOnlyContract}`)
    }
  }

  assert.equal(handoverBody.includes('before each plan-derived implementation dispatch'), true, 'handover must revalidate each implementation dispatch')
  assert.equal(handoverBody.includes('`~/.claude/plans/`'), true, 'handover must consider the shared global plan fallback during inferred selection')
  assert.equal(handoverBody.includes('shared candidate-evidence procedure before modification time or content influences selection'), true, 'handover must bind candidate evidence before inferred selection')
  assert.equal(handoverBody.includes('capturePlanCandidateEvidence'), true, 'handover must capture inferred candidate evidence through the executable service')
  assert.equal(handoverBody.includes('establishPlanBinding'), true, 'handover must establish direct selections through the executable service')
  assert.equal(handoverBody.includes('deleteBoundPlan'), true, 'handover must delete only through the retained executable binding')
  assert.equal(handoverBody.includes('git status` recency'), false, 'handover must not select from tracked plan evidence rejected by the shared binding')
  assert.equal(handoverBody.includes('must not reread `PLAN_FILE`'), true, 'handover task dispatch must not reopen the plan pathname')
  assert.equal(planBody.includes('before each reviewer or skeptic dispatch'), true, 'revise-plan must revalidate each review dispatch')
  assert.equal(planBody.includes('shared candidate-evidence procedure before modification time or content influences selection'), true, 'revise-plan must bind candidate evidence before inferred selection')
  assert.equal(planBody.includes('capturePlanCandidateEvidence'), true, 'revise-plan must capture inferred candidate evidence through the executable service')
  assert.equal(planBody.includes('establishPlanBinding'), true, 'revise-plan must establish direct selections through the executable service')
  assert.equal(planBody.includes('refreshPlanBinding'), true, 'revise-plan must refresh bindings after local replacements')
  assert.equal(planBody.includes('Recently touched plan-shaped files in `git status`'), false, 'revise-plan must not select from tracked plan evidence rejected by the shared binding')
  assert.equal(planBody.includes('writePlanProvenanceStamp'), true, 'revise-plan must stamp through the retained full binding')
  assert.equal(codeBody.includes('before each reviewer or skeptic dispatch'), true, 'revise-code must revalidate each review dispatch when a plan is active')
  assert.equal(codeBody.includes('establishPlanBinding'), true, 'revise-code must establish active plans through the executable service')
  assert.equal(codeBody.includes('refreshPlanBinding'), true, 'revise-code must refresh bindings after active-plan replacements')
  assert.equal(codeBody.includes('parsePlanContract'), true, 'revise-code must parse captured plan authority')
})

test('plan binding service preserves authority across classification and mutation', () => {
  const root = mkdtempSync(join(tmpdir(), 'nightshift-plan-binding-'))
  try {
    const repositoryRoot = join(root, 'repository')
    const globalPlansRoot = join(root, 'global-plans')
    const repositoryPlan = join(repositoryRoot, '.claude', 'plans', 'repository.md')
    const globalPlan = join(globalPlansRoot, 'global.md')
    const externalPlan = join(root, 'external', 'external.md')
    for (const path of [repositoryPlan, globalPlan, externalPlan]) {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, '# Plan\n')
    }
    const gitChecks = []
    const gitPolicy = (request) => gitChecks.push(request)
    const common = { globalPlansRoot, repositoryRoot }
    const repository = establishPlanBinding({ ...common, exactUserPath: false, logicalPath: repositoryPlan }, { gitPolicy })
    const global = establishPlanBinding({ ...common, exactUserPath: false, logicalPath: globalPlan }, { gitPolicy })

    assert.equal(repository.binding.classification, 'repository')
    assert.equal(repository.binding.repositoryRelativePath, '.claude/plans/repository.md')
    assert.equal(global.binding.classification, 'global')
    assert.equal(global.binding.repositoryRelativePath, null)
    assert.equal(gitChecks.length, 1)
    assert.throws(() => establishPlanBinding({ ...common, exactUserPath: false, logicalPath: externalPlan }, { gitPolicy }), /exact user path/)
    assert.equal(establishPlanBinding({ ...common, exactUserPath: true, logicalPath: externalPlan }, { gitPolicy }).binding.classification, 'external')

    const replacement = Buffer.from('# Plan\n\nChanged.\n')
    writeFileSync(repositoryPlan, replacement)
    assert.throws(() => revalidatePlanBinding(repository.binding, { gitPolicy }), /stale/)
    const refreshed = refreshPlanBinding({ binding: repository.binding, expectedBytes: replacement }, { gitPolicy })

    assert.equal(refreshed.binding.logicalPath, repository.binding.logicalPath)
    assert.equal(refreshed.binding.declaredBoundary, repository.binding.declaredBoundary)
    assert.equal(refreshed.bytes.equals(replacement), true)
    assert.equal(revalidatePlanBinding(refreshed.binding, { gitPolicy }).bytes.equals(replacement), true)
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})

test('plan binding service bounds individual and inferred candidate evidence', () => {
  const root = mkdtempSync(join(tmpdir(), 'nightshift-plan-bounds-'))
  try {
    const repositoryRoot = join(root, 'repository')
    const globalPlansRoot = join(root, 'global-plans')
    mkdirSync(repositoryRoot)
    mkdirSync(globalPlansRoot)
    const common = { globalPlansRoot, repositoryRoot }
    const gitPolicy = () => {}
    const boundaryPlan = join(globalPlansRoot, 'boundary.md')
    const oversizedPlan = join(globalPlansRoot, 'oversized.md')
    writeFileSync(boundaryPlan, Buffer.alloc(MAX_PLAN_BYTES, 0x61))
    writeFileSync(oversizedPlan, Buffer.alloc(MAX_PLAN_BYTES + 1, 0x61))

    assert.equal(establishPlanBinding({ ...common, exactUserPath: false, logicalPath: boundaryPlan }, { gitPolicy }).bytes.length, MAX_PLAN_BYTES)
    assert.throws(() => establishPlanBinding({ ...common, exactUserPath: false, logicalPath: oversizedPlan }, { gitPolicy }), /plan-too-large/)

    const tooMany = Array.from({ length: MAX_PLAN_CANDIDATES + 1 }, (_, index) => ({ exactUserPath: false, logicalPath: join(globalPlansRoot, `missing-${index}.md`) }))
    assert.throws(() => capturePlanCandidateEvidence({ ...common, enumerateCandidates: () => tooMany }, { gitPolicy }), /candidate-count/)

    const aggregate = []
    const candidateSize = Math.floor(MAX_PLAN_CANDIDATE_BYTES / 8)
    for (let index = 0; index < 9; index += 1) {
      const logicalPath = join(globalPlansRoot, `aggregate-${index}.md`)
      writeFileSync(logicalPath, Buffer.alloc(candidateSize, 0x62))
      aggregate.push({ exactUserPath: false, logicalPath })
    }
    assert.throws(() => capturePlanCandidateEvidence({ ...common, enumerateCandidates: () => aggregate }, { gitPolicy }), /aggregate-bytes/)

    let enumeration = aggregate.slice(0, 1)
    assert.throws(() => capturePlanCandidateEvidence({ ...common, enumerateCandidates: () => {
      const result = enumeration
      enumeration = aggregate.slice(0, 2)

      return result
    } }, { gitPolicy }), /candidate set changed/)
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})

test('plan candidate evidence compares duplicate-free membership independently of enumeration order', () => {
  const root = mkdtempSync(join(tmpdir(), 'nightshift-plan-candidates-'))
  try {
    const repositoryRoot = join(root, 'repository')
    const globalPlansRoot = join(root, 'global-plans')
    const firstPlan = join(globalPlansRoot, 'first.md')
    const secondPlan = join(globalPlansRoot, 'second.md')
    mkdirSync(repositoryRoot)
    mkdirSync(globalPlansRoot)
    writeFileSync(firstPlan, '# First\n')
    writeFileSync(secondPlan, '# Second\n')
    const common = { globalPlansRoot, repositoryRoot }
    const candidates = [
      { exactUserPath: false, logicalPath: secondPlan },
      { exactUserPath: false, logicalPath: firstPlan },
    ]
    assert.deepEqual(Object.keys(capturePlanCandidateEvidence({ ...common, enumerateCandidates: () => candidates })), ['evidence'])

    let enumerationCount = 0
    const captured = capturePlanCandidateEvidence({ ...common, enumerateCandidates: () => {
      enumerationCount += 1

      return enumerationCount === 1 ? candidates : [...candidates].reverse()
    } })

    assert.deepEqual(captured.evidence.map(({ binding }) => binding.logicalPath), [secondPlan, firstPlan])

    enumerationCount = 0
    assert.throws(() => capturePlanCandidateEvidence({ ...common, enumerateCandidates: () => {
      enumerationCount += 1

      return enumerationCount === 1 ? candidates : [candidates[0], candidates[0]]
    } }), { code: 'plan-candidate-duplicate' })
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})

test('plan candidate evidence resolves one trusted Git executable per capture', () => {
  const root = mkdtempSync(join(tmpdir(), 'nightshift-plan-candidate-git-'))
  try {
    const repositoryRoot = join(root, 'repository')
    const globalPlansRoot = join(root, 'global-plans')
    const plansRoot = join(repositoryRoot, '.claude', 'plans')
    const candidates = ['first.md', 'second.md'].map((name) => ({ exactUserPath: false, logicalPath: join(plansRoot, name) }))
    mkdirSync(plansRoot, { recursive: true })
    mkdirSync(globalPlansRoot)
    execFileSync('git', ['init', '--quiet', repositoryRoot], { windowsHide: true })
    writeFileSync(join(repositoryRoot, '.gitignore'), '.claude/plans/\n')
    candidates.forEach((candidate) => writeFileSync(candidate.logicalPath, '# Plan\n'))
    const trustedGit = resolveTrustedExecutable({
      basename: process.platform === 'win32' ? 'git.exe' : 'git',
      protectedRoots: [globalPlansRoot],
      root: repositoryRoot,
    })
    const resolutionRequests = []
    const input = { enumerateCandidates: () => candidates, globalPlansRoot, repositoryRoot }
    const options = {
      resolveGitExecutable: (request) => {
        resolutionRequests.push(request)

        return trustedGit
      },
    }

    assert.equal(capturePlanCandidateEvidence(input, options).evidence.length, 2)
    assert.equal(resolutionRequests.length, 1)
    assert.deepEqual(resolutionRequests[0], {
      basename: process.platform === 'win32' ? 'git.exe' : 'git',
      protectedRoots: [globalPlansRoot],
      root: repositoryRoot,
    })

    assert.equal(capturePlanCandidateEvidence(input, options).evidence.length, 2)
    assert.equal(resolutionRequests.length, 2)
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})

test('plan candidate evidence preserves explicit Git executables and custom Git policies', () => {
  const root = mkdtempSync(join(tmpdir(), 'nightshift-plan-candidate-git-options-'))
  try {
    const repositoryRoot = join(root, 'repository')
    const globalPlansRoot = join(root, 'global-plans')
    const plansRoot = join(repositoryRoot, '.claude', 'plans')
    const candidates = ['first.md', 'second.md'].map((name) => ({ exactUserPath: false, logicalPath: join(plansRoot, name) }))
    mkdirSync(plansRoot, { recursive: true })
    mkdirSync(globalPlansRoot)
    execFileSync('git', ['init', '--quiet', repositoryRoot], { windowsHide: true })
    writeFileSync(join(repositoryRoot, '.gitignore'), '.claude/plans/\n')
    candidates.forEach((candidate) => writeFileSync(candidate.logicalPath, '# Plan\n'))
    const trustedGit = resolveTrustedExecutable({ root: repositoryRoot })
    const input = { enumerateCandidates: () => candidates, globalPlansRoot, repositoryRoot }
    const rejectResolution = () => { throw new Error('trusted Git resolution must not run') }

    assert.equal(capturePlanCandidateEvidence(input, { gitExecutable: trustedGit, resolveGitExecutable: rejectResolution }).evidence.length, 2)
    let policyCalls = 0
    assert.equal(capturePlanCandidateEvidence(input, {
      gitPolicy: () => {
        policyCalls += 1
      },
      resolveGitExecutable: rejectResolution,
    }).evidence.length, 2)
    assert.equal(policyCalls, 2)
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})

test('plan candidate evidence does not resolve Git for global and external candidates', () => {
  const root = mkdtempSync(join(tmpdir(), 'nightshift-plan-candidate-no-git-'))
  try {
    const repositoryRoot = join(root, 'repository')
    const globalPlansRoot = join(root, 'global-plans')
    const globalPlan = join(globalPlansRoot, 'global.md')
    const externalPlan = join(root, 'external', 'external.md')
    mkdirSync(repositoryRoot)
    mkdirSync(globalPlansRoot)
    mkdirSync(dirname(externalPlan))
    writeFileSync(globalPlan, '# Global\n')
    writeFileSync(externalPlan, '# External\n')
    const candidates = [
      { exactUserPath: false, logicalPath: globalPlan },
      { exactUserPath: true, logicalPath: externalPlan },
    ]

    assert.equal(capturePlanCandidateEvidence({ enumerateCandidates: () => candidates, globalPlansRoot, repositoryRoot }, {
      resolveGitExecutable: () => { throw new Error('trusted Git resolution must not run') },
    }).evidence.length, 2)
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})

test('plan binding rejects case-only logical aliases on Windows', { skip: process.platform !== 'win32' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'nightshift-plan-case-'))
  try {
    const repositoryRoot = join(root, 'repository')
    const globalPlansRoot = join(root, 'Global-Plans')
    const planDirectory = join(globalPlansRoot, 'MiXeD')
    const plan = join(planDirectory, 'Plan.MD')
    mkdirSync(repositoryRoot)
    mkdirSync(planDirectory, { recursive: true })
    writeFileSync(plan, '# Plan\n')
    const common = { exactUserPath: false, globalPlansRoot, repositoryRoot }

    assert.equal(establishPlanBinding({ ...common, logicalPath: plan }).binding.logicalPath, plan)
    assert.throws(() => establishPlanBinding({ ...common, logicalPath: join(planDirectory, 'plan.md') }), { code: 'plan-link' })
    assert.throws(() => establishPlanBinding({ ...common, logicalPath: join(globalPlansRoot, 'mixed', 'Plan.MD') }), { code: 'plan-link' })
    assert.throws(() => establishPlanBinding({ ...common, globalPlansRoot: join(root, 'global-plans'), logicalPath: join(root, 'global-plans', 'MiXeD', 'Plan.MD') }), { code: 'plan-link' })

    const junctionTarget = join(globalPlansRoot, 'Junction-Target')
    const junctionAlias = join(globalPlansRoot, 'Junction-Alias')
    mkdirSync(junctionTarget)
    writeFileSync(join(junctionTarget, 'Linked.md'), '# Linked\n')
    symlinkSync(junctionTarget, junctionAlias, 'junction')
    assert.throws(() => establishPlanBinding({ ...common, logicalPath: join(junctionAlias, 'Linked.md') }), (error) => {
      assert.equal(error.code, 'plan-link')
      assert.equal(error.details.path, junctionAlias)

      return true
    })
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})

test('plan binding service enforces repository ignore and tracking policy', () => {
  const root = mkdtempSync(join(tmpdir(), 'nightshift-plan-git-policy-'))
  try {
    const repositoryRoot = join(root, 'repository')
    const globalPlansRoot = join(root, 'global-plans')
    const plan = join(repositoryRoot, '.claude', 'plans', 'repository.md')
    mkdirSync(dirname(plan), { recursive: true })
    mkdirSync(globalPlansRoot)
    execFileSync('git', ['init', '--quiet', repositoryRoot], { windowsHide: true })
    writeFileSync(join(repositoryRoot, '.gitignore'), '.claude/plans/\n')
    writeFileSync(plan, '# Plan\n')
    const input = { exactUserPath: false, globalPlansRoot, logicalPath: plan, repositoryRoot }

    assert.equal(establishPlanBinding(input).binding.classification, 'repository')
    execFileSync('git', ['-C', repositoryRoot, 'add', '--force', '--', '.claude/plans/repository.md'], { windowsHide: true })
    assert.throws(() => establishPlanBinding(input), /must be untracked/)
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})

test('plan binding production default supports confirmed non-Git roots and revalidates Git metadata', () => {
  const root = mkdtempSync(join(tmpdir(), 'nightshift-plan-non-git-policy-'))
  try {
    const repositoryRoot = join(root, 'repository')
    const globalPlansRoot = join(root, 'global-plans')
    const plan = join(repositoryRoot, '.claude', 'plans', 'repository.md')
    const gitMetadata = join(repositoryRoot, '.git')
    mkdirSync(dirname(plan), { recursive: true })
    mkdirSync(globalPlansRoot)
    writeFileSync(plan, '# Plan\n')
    const input = { exactUserPath: false, globalPlansRoot, logicalPath: plan, repositoryRoot }

    const established = establishPlanBinding(input)
    assert.equal(established.binding.classification, 'repository')
    assert.equal(established.bytes.equals(Buffer.from('# Plan\n')), true)
    assert.equal(revalidatePlanBinding(established.binding).bytes.equals(established.bytes), true)

    let gitMetadataChecks = 0
    const racingFilesystem = {
      ...nodeFilesystem,
      lstatSync: (path, options) => {
        if (path === gitMetadata) {
          gitMetadataChecks += 1
          if (gitMetadataChecks === 2) mkdirSync(gitMetadata)
        }

        return nodeFilesystem.lstatSync(path, options)
      },
    }
    assert.throws(() => establishPlanBinding(input, { filesystem: racingFilesystem }), { code: 'plan-git-policy' })
    assert.equal(gitMetadataChecks, 2)
    rmSync(gitMetadata, { recursive: true })

    mkdirSync(gitMetadata)
    assert.throws(() => revalidatePlanBinding(established.binding), { code: 'plan-git-policy' })
    rmSync(gitMetadata, { recursive: true })
    writeFileSync(gitMetadata, 'malformed\n')
    assert.throws(() => revalidatePlanBinding(established.binding), { code: 'plan-git-policy' })
    rmSync(gitMetadata)
    const externalMetadata = join(root, 'external-git-metadata')
    mkdirSync(externalMetadata)
    symlinkSync(externalMetadata, gitMetadata, process.platform === 'win32' ? 'junction' : 'dir')
    assert.throws(() => revalidatePlanBinding(established.binding), { code: 'plan-git-policy' })
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})

test('plan binding ignores ambient command-scope Git configuration', () => {
  const root = mkdtempSync(join(tmpdir(), 'nightshift-plan-git-environment-'))
  try {
    const repositoryRoot = join(root, 'repository')
    const globalPlansRoot = join(root, 'global-plans')
    const plan = join(repositoryRoot, '.claude', 'plans', 'repository.md')
    const injectedExcludes = join(root, 'ambient-excludes')
    mkdirSync(dirname(plan), { recursive: true })
    mkdirSync(globalPlansRoot)
    execFileSync('git', ['init', '--quiet', repositoryRoot], { windowsHide: true })
    writeFileSync(injectedExcludes, '.claude/plans/\n')
    writeFileSync(plan, '# Plan\n')
    const completion = spawnSync(process.execPath, [join(__dirname, 'fixtures', 'plan-binding-ambient-config.js'), repositoryRoot, globalPlansRoot, plan], {
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'core.excludesFile',
        GIT_CONFIG_VALUE_0: injectedExcludes,
      },
      windowsHide: true,
    })

    assert.equal(completion.status, 2, completion.stderr || completion.stdout)
    assert.match(completion.stderr, /^plan-git-policy\n$/)
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})

test('Git runner reconstructs only an explicitly trusted Git environment', () => {
  let observedEnvironment
  runGit('C:/repository', ['status'], {
    env: {
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.excludesFile',
      GIT_CONFIG_VALUE_0: 'C:/ambient/excludes',
      GIT_EXEC_PATH: 'C:/ambient/git-core',
      PATH: 'C:/tools',
    },
    platform: 'win32',
    spawnSync: (executable, args, options) => {
      observedEnvironment = options.env

      return { status: 0, stderr: Buffer.alloc(0), stdout: Buffer.alloc(0) }
    },
    trustedGitEnvironment: {
      GIT_ATTR_NOSYSTEM: '1',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_GLOBAL: 'C:/trusted/config',
      GIT_CONFIG_KEY_0: 'core.attributesFile',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_VALUE_0: 'C:/trusted/attributes',
    },
    trustedGitPath: 'C:/trusted/git.exe',
  })

  assert.equal(observedEnvironment.PATH, 'C:/tools')
  assert.equal(observedEnvironment.GIT_CONFIG_COUNT, '1')
  assert.equal(observedEnvironment.GIT_CONFIG_GLOBAL, 'C:/trusted/config')
  assert.equal(observedEnvironment.GIT_CONFIG_KEY_0, 'core.attributesFile')
  assert.equal(observedEnvironment.GIT_CONFIG_VALUE_0, 'C:/trusted/attributes')
  assert.equal(observedEnvironment.GIT_ATTR_NOSYSTEM, '1')
  assert.equal(observedEnvironment.GIT_CONFIG_NOSYSTEM, '1')
  assert.equal(observedEnvironment.GIT_OPTIONAL_LOCKS, '0')
  assert.equal(observedEnvironment.GIT_PAGER, 'cat')
  assert.equal(observedEnvironment.GIT_TERMINAL_PROMPT, '0')
  assert.equal('GIT_EXEC_PATH' in observedEnvironment, false)
  assert.throws(() => runGit('C:/repository', ['status'], { platform: 'win32', spawnSync: () => { throw new Error('must not launch') }, trustedGitEnvironment: { GIT_EXEC_PATH: 'C:/git-core' }, trustedGitPath: 'C:/trusted/git.exe' }), /not allowed/)
})

test('plan provenance refresh retains full authority and enforces the size cap before mutation', () => {
  const root = mkdtempSync(join(tmpdir(), 'nightshift-plan-provenance-'))
  try {
    const repositoryRoot = join(root, 'repository')
    const globalPlansRoot = join(root, 'global-plans')
    const plan = join(globalPlansRoot, 'global.md')
    mkdirSync(repositoryRoot)
    mkdirSync(globalPlansRoot)
    const initial = Buffer.from('# Plan\n')
    writeFileSync(plan, initial)
    const established = establishPlanBinding({ exactUserPath: false, globalPlansRoot, logicalPath: plan, repositoryRoot })
    const baselineHash = createHash('sha256').update(initial).digest('hex')
    const stamp = '- revise-plan graduated 2026-08-30 10:00 at abcdef1, scope: whole file, content: 12345678'
    const written = writePlanProvenanceStamp({ baselineHash, binding: established.binding, stamp })

    assert.equal(written.binding.classification, 'global')
    assert.equal(written.binding.globalPlansRoot, established.binding.globalPlansRoot)
    assert.equal(written.binding.repositoryRoot, established.binding.repositoryRoot)
    assert.equal(written.bytes.includes(Buffer.from(stamp)), true)
    assert.equal(revalidatePlanBinding(written.binding).bytes.equals(written.bytes), true)
    assert.throws(() => revalidatePlanBinding(established.binding), /stale/)

    const fullPlan = join(globalPlansRoot, 'full.md')
    const fullBytes = Buffer.alloc(MAX_PLAN_BYTES, 0x61)
    writeFileSync(fullPlan, fullBytes)
    const full = establishPlanBinding({ exactUserPath: false, globalPlansRoot, logicalPath: fullPlan, repositoryRoot })
    const fullHash = createHash('sha256').update(fullBytes).digest('hex')

    assert.throws(() => writePlanProvenanceStamp({ baselineHash: fullHash, binding: full.binding, stamp }), /plan-too-large/)
    assert.equal(readFileSync(fullPlan).equals(fullBytes), true)

    const removablePlan = join(globalPlansRoot, 'removable.md')
    const replacement = Buffer.from('# Replacement\n')
    writeFileSync(removablePlan, initial)
    const removable = establishPlanBinding({ exactUserPath: false, globalPlansRoot, logicalPath: removablePlan, repositoryRoot })
    writeFileSync(removablePlan, replacement)
    assert.throws(() => deleteBoundPlan(removable.binding), /stale/)
    assert.equal(readFileSync(removablePlan).equals(replacement), true)
    const refreshed = refreshPlanBinding({ binding: removable.binding, expectedBytes: replacement })

    assert.deepEqual(deleteBoundPlan(refreshed.binding), { alreadyAbsent: false, binding: null })
    assert.deepEqual(deleteBoundPlan(refreshed.binding), { alreadyAbsent: true, binding: null })
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})

test('production procedures contain no smoke-only probe branch', () => {
  for (const skillName of PUBLIC_SKILLS) {
    assert.equal(readRequiredFile(join(PUBLIC_SKILLS_ROOT, skillName, 'SKILL.md')).includes('NIGHTSHIFT_ENTRY_PROBE:'), false, `${skillName} must not retain a smoke probe`)
  }
  assert.equal(readRequiredFile(join(ENGINE_ROOT, 'SKILL.md')).includes('NIGHTSHIFT_ENTRY_PROBE:'), false, 'revise engine must not retain a smoke probe')
})

test('current public references reject retired command and revise engine paths', () => {
  const pathsToAudit = [
    join(REPOSITORY_ROOT, 'README.md'),
    join(REPOSITORY_ROOT, 'AGENTS.md'),
    join(REPOSITORY_ROOT, '.github', 'workflows', 'ci.yml'),
    ...PUBLIC_SKILLS.map((skillName) => join(PUBLIC_SKILLS_ROOT, skillName, 'SKILL.md')),
    ...readdirSync(ENGINE_ROOT, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => join(ENGINE_ROOT, entry.name)),
  ]
  for (const filePath of pathsToAudit) {
    assertCurrentPathsAreAbsent(filePath)
  }
})

test('current manifest descriptions do not identify handover as a command', () => {
  const pluginManifest = JSON.parse(readRequiredFile(join(REPOSITORY_ROOT, '.claude-plugin', 'plugin.json')))
  const marketplaceManifest = JSON.parse(readRequiredFile(join(REPOSITORY_ROOT, '.claude-plugin', 'marketplace.json')))
  // Description parity between the two manifests is release metadata and is
  // asserted in tests/release-surface.test.js, not duplicated here.
  assert.equal(pluginManifest.description.includes('handover command'), false)
  assert.equal(marketplaceManifest.plugins[0].description.includes('handover command'), false)
})

test('revise topology requires all relocated engine files as regular files', () => {
  for (const fileName of ['SKILL.md', 'code.md', 'plan.md', 'spec.md', 'rigor.js', 'rigor.test.js', 'revise-round.workflow.js', 'revise-round.test.js', 'orchestration.js', 'orchestration.test.js']) {
    requireRegularFile(join(ENGINE_ROOT, fileName))
  }
})

test('revise topology removes the public revise engine directory', () => {
  assert.equal(existsSync(join(REPOSITORY_ROOT, 'skills', 'revise')), false)
})

test('revise topology gives every wrapper its exact public frontmatter', () => {
  for (const [wrapperName, wrapper] of Object.entries(REVISE_WRAPPERS)) {
    const { fields } = parseFrontmatter(join(REPOSITORY_ROOT, 'skills', wrapperName, 'SKILL.md'))
    assert.equal(fields.name, wrapperName)
    assert.equal(fields.description, wrapper.description)
  }
})

test('revise topology gives every wrapper its fixed forwarding contract', () => {
  const bodies = []
  for (const [wrapperName, wrapper] of Object.entries(REVISE_WRAPPERS)) {
    const { body } = parseFrontmatter(join(REPOSITORY_ROOT, 'skills', wrapperName, 'SKILL.md'))
    const lines = body.split(/\r?\n/)
    const artifactToken = new RegExp('fixed artifact type `' + wrapper.artifactType + '`', 'g')
    assert.equal([...body.matchAll(artifactToken)].length, 1, `${wrapperName} must have one fixed artifact type token`)
    const agreementIndex = body.indexOf(AGREEMENT_PATH)
    const engineIndex = body.indexOf(ENGINE_PATH)
    assert.notEqual(agreementIndex, -1, `${wrapperName} must name the relative agreement path`)
    assert.equal(body.includes(ENGINE_PATH), true, `${wrapperName} must name the relative engine path`)
    assert.equal(agreementIndex < engineIndex, true, `${wrapperName} must invoke agreement before the revise engine`)
    const unavailableAgreementLine = `SPEC_AGREEMENT_UNAVAILABLE ${AGREEMENT_PATH}`
    const unavailableAgreementLineIndexes = lines.flatMap((line, index) => line === unavailableAgreementLine ? [index] : [])
    assert.equal(unavailableAgreementLineIndexes.length, 1, `${wrapperName} must contain exactly one unavailable-agreement line`)
    assert.equal(lines[unavailableAgreementLineIndexes[0] - 1], 'If the agreement skill is missing or unreadable, report exactly this single line, then stop before starting review work.', `${wrapperName} must stop before review after the unavailable-agreement line`)
    const unavailableLine = `REVISE_ENGINE_UNAVAILABLE ${ENGINE_PATH}`
    const unavailableLineIndexes = lines.flatMap((line, index) => line === unavailableLine ? [index] : [])
    assert.deepEqual(unavailableLineIndexes.length, 1, `${wrapperName} must contain exactly one unavailable-engine line`)
    assert.equal(lines[unavailableLineIndexes[0] - 1], 'If the engine is missing or unreadable, report exactly this single line, then stop before starting review work.', `${wrapperName} must stop before review after the unavailable-engine line`)
    assert.equal(body.includes('When the host supplies usable scope text, pass the same text unchanged to the agreement skill and, after authority is present, to the engine.'), true, `${wrapperName} must forward usable scope unchanged`)
    assert.equal(body.includes('When scope is missing, empty, or whitespace-only, omit it so the engine performs its existing inference and clarification behavior.'), true, `${wrapperName} must preserve omitted-scope inference`)
    const authorityContract = wrapperName === 'revise-spec'
      ? 'Continue to the engine only when `callerResult.agreement` is a complete agreement record; stop without dispatch on `not-applicable` and every other outcome.'
      : 'Continue to the engine only when `callerResult.agreement` is a complete agreement record or the literal `not-applicable`; stop without dispatch on every other outcome.'
    assert.equal(body.includes(authorityContract), true, `${wrapperName} must enforce its caller authority contract`)
    bodies.push(body)
  }
  assert.equal(new Set(bodies).size, bodies.length, 'wrapper bodies must remain distinct')
})

test('revise topology keeps engine profile and resource references contained', () => {
  const engine = readRequiredFile(join(ENGINE_ROOT, 'SKILL.md'))
  for (const artifactType of ['code', 'plan', 'spec']) {
    assert.match(engine, new RegExp('- `' + artifactType + '` -> `' + REVISE_ENGINE_RESOURCES[artifactType] + '`'))
  }
  const workflowPath = join(ENGINE_ROOT, REVISE_ENGINE_RESOURCES.workflow)
  assert.match(engine, new RegExp('\\$\\{CLAUDE_PLUGIN_ROOT\\}/internal/revise/' + REVISE_ENGINE_RESOURCES.workflow))
  for (const resourceFileName of Object.values(REVISE_ENGINE_RESOURCES)) {
    const resourcePath = join(ENGINE_ROOT, resourceFileName)
    assertContainedByEngine(resourcePath)
    requireRegularFile(resourcePath)
  }
  assertContainedByEngine(workflowPath)
})
