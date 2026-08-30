'use strict'

const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } = require('node:fs')
const Module = require('node:module')
const { tmpdir } = require('node:os')
const { dirname, join, relative } = require('node:path')
const test = require('node:test')

const { PROCEDURE_REPLACEMENTS, PUBLIC_SKILLS, REVISE_ENGINE_RESOURCES, REVISE_WRAPPERS } = require('./entry-contract')
const { advanceQueue, createQueue, resumeQueue } = require('../skills/handover/handover-queue')
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

const REPOSITORY_ROOT = join(__dirname, '..')
const AGREEMENT_PATH = '../spec-agreement/SKILL.md'
const ENGINE_ROOT = join(REPOSITORY_ROOT, 'internal', 'revise')
const ENGINE_PATH = '../../internal/revise/SKILL.md'
const FIXTURE_ROOT = join(__dirname, 'fixtures', 'legacy-plugin-2.4.5')
const PUBLIC_SKILLS_ROOT = join(REPOSITORY_ROOT, 'skills')
const INIT_BACKLOG_APPROVAL_SENTENCE = 'Obtain explicit approval for the complete manifest before any `apply` request.'
const INIT_BACKLOG_WRITER_DISCLOSURE_SENTENCE = 'Before asking for approval, disclose the `external-writer-window`: project targets remain writable by external processes during controller publication, so a concurrent change can make a later action fail with `snapshot-drift` after earlier actions have landed; only an unwrap batch has byte-exact aggregate restoration.'

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

function countExact(text, value) {
  return text.split(value).length - 1
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
    join(PUBLIC_SKILLS_ROOT, 'spec-agreement', 'spec-agreement.js'),
    join(PUBLIC_SKILLS_ROOT, 'spec-agreement', 'spec-agreement.test.js'),
    join(PUBLIC_SKILLS_ROOT, 'spec-agreement', 'fixtures', 'fingerprint-v1.json'),
  ]) {
    requireRegularFile(bundledPath)
  }
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
    assert.equal(removeProcedureEnvelope(readRequiredFile(migratedSkillPath)), normalizeProcedure(entryName, readRequiredFile(fixtureCommandPath)), `${entryName} body differs outside allowed topology replacements`)
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

  const rebuildGuard = 'scratch state can never skip a lifecycle gate'
  assert.equal(countExact(body, rebuildGuard), 1, 'handover must restart at the ladder when queue marks would skip a gate')
  assert.equal(countExact(body, 'a queue may resume earlier than or at the detected ladder step, never later'), 1, 'handover must treat the ladder as the latest safe resume bound')
  assert.equal(countExact(body, 'completing step 12 marks steps 10 and 12 together'), 1, 'handover must model the coupled step-10 and step-12 tail marks')
  assert.equal(body.indexOf(rebuildGuard) > agreementStart, true, 'the resume branch must live in the agreement and stage entry procedure')
  assert.equal(body.includes('sub-step resume is deliberately not tracked'), false, 'handover must not deny the cross-session step resume the queue now provides')
})

test('handover queue accepts reordered creation input without changing durable ordering', () => {
  const authority = { artifactPath: '.claude/features/example.md', planFingerprint: 'none', targetScope: 'whole file' }

  const sourceBuffer = createQueue({ entryStep: 5, authority })

  assert.equal(sourceBuffer.toString('utf8'), [
    '{"artifactPath":".claude/features/example.md","entryStep":5,"planFingerprint":"none","protocolVersion":1,"targetScope":"whole file"}',
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

  assert.equal(sourceBuffer.toString('utf8').split('\n')[0], '{"artifactPath":".claude/features/example.md","entryStep":5,"planFingerprint":"none","protocolVersion":1,"targetScope":"whole file"}')
})

test('handover queue accepts reordered evidence records', () => {
  const authority = { artifactPath: '.claude/features/example.md', planFingerprint: 'none', targetScope: 'whole file' }
  const evidence = { tracked: false, stable: true, singleLink: true, ordinary: true, ignored: true }
  const sourceBuffer = createQueue({ authority, entryStep: 5 })

  assert.deepEqual(resumeQueue({ detectedEntryStep: 5, evidence, expectedAuthority: authority, sourceBuffer }), { kind: 'live', nextStep: 5, sourceBuffer })
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

test('init-backlog topology requires the controller, its libraries, and normalized assets as regular files', () => {
  const controllerRoot = join(PUBLIC_SKILLS_ROOT, 'init-backlog')
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
  assert.equal(countExact(body, '`writeProvenanceStamp`'), 2, 'handover must use the shared provenance writer for refresh and completion')
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
    'write it BEFORE the next offer',
    'then offer to remove the plan file',
    'Invalidate volatile agreement state on completion before returning.',
  ]) {
    assert.equal(body.includes(lifecycleContract), true, `handover must preserve lifecycle contract: ${lifecycleContract}`)
  }
  assert.equal(body.includes('Status:'), false, 'handover must not create or trust Status markers')
  assert.equal(body.toLowerCase().includes('signed off'), false, 'handover must not retain signed-off stage logic')
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
    'link count is available and exactly one',
    'file size, stable content metadata',
    'Before modification time or content can influence inferred selection',
    'stable candidate set',
    "each binding's `mtimeNs`",
    "that binding's captured bytes",
    "retain that candidate's existing full binding",
    'Global and external plans are outside the current repository\'s ignore policy',
    'Call `revalidatePlanBinding` immediately before every authoritative plan read, plan mutation, or plan-derived dispatch.',
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
