'use strict'

const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const test = require('node:test')

const { SOURCE_COMMIT } = require('./baseline.cases')
const { validateManifest } = require('./assets.cases')
const { fixtureFilePath, git, sha256 } = require('./helpers')
const { collectInspection } = require('../../skills/init-backlog/lib/inspection')

const PRE_ACTIVATION_GUIDANCE_DIGEST = '7bb8af909add4f6a44947b4ba666e2dc81ba881f79ce209e567003cb40379198'
const PRE_ACTIVATION_MANIFEST_SHA256 = 'f27c321e36a7b4b3ec5f6bc12ba9bd82f3be3bca7d137b4a08095281fe867c80'
const PRE_UNWRAP_FEATURES_DIGEST = '8e9a3e6e85901a085c65806b63a5df2efb6b7fc9832b8f4d7be92d64153d5e5f'
const PLANS_POLICY_SENTENCE = 'Plans are never committed: in a Git repository, `.claude/plans/` is git-ignored by the repository-local `.gitignore`, independent of any track-or-ignore election for the durable backlog files.'
const PLANS_BULLET_PREFIX = '- `.claude/plans/<date>-<slug>.md`:'
const RETIRED_TRACKED_PLAN_PHRASES = [
  'Specs, plans, and backlog files may be git-ignored by user election',
  'On projects that track the plan file in git',
  'for untracked or git-ignored plans (a supported election; the project\'s `.gitignore` is the source of truth)',
]
const CONTROLLER_INVOCATION = '${CLAUDE_PLUGIN_ROOT}/skills/init-backlog/init-backlog.js'
const APPROVAL_SENTENCE = 'Obtain explicit approval for the complete manifest before any `apply` request.'
const EXTERNAL_WRITER_DISCLOSURE_SENTENCE = 'Before asking for approval, disclose the `external-writer-window`: project targets remain writable by external processes during controller publication, so a concurrent change can make a later action fail with `snapshot-drift` after earlier actions have landed; only an unwrap batch has byte-exact aggregate restoration.'
const DENIAL_SENTENCE = 'On denial, an unavailable user, or an unattended run without approval, no apply request is made and no project target changes.'
const FINAL_APPROVAL_SCOPE_SENTENCE = 'Always obtain the explicit approval in the Process above before any project target or apply-owned durable state is written; the bounded request-spool transport and inspection-ownership writes needed to obtain the proposal are not apply authorization, and a re-run never writes project content on recognition alone.'
const SHELL_LITERAL_SENTENCE = 'Encode every substituted command operand as one literal argument for the active shell, including the controller path, canonical root, nonce, and residue evidence digests.'
const POWERSHELL_LITERAL_SENTENCE = 'In PowerShell, single-quote each operand and double every embedded apostrophe before inserting the value into command text.'
const APPLY_STEP = '7. **Apply.**'
const ORDERED_WORKFLOW_TOKENS = [
  ['request reservation and recovery', '1. **Reserve and recover.**'],
  ['deterministic inspect', 'controller\'s `inspect` operation and retain its complete result'],
  ['semantic concept classification', 'concept checklists below to every customized template-controlled semantic target'],
  ['exact repair design', 'complete before and after file bytes over exactly one manifest-controlled region'],
  ['complete proposal presentation', 'Present every target, state, and exact proposed action payload'],
  ['external writer disclosure', EXTERNAL_WRITER_DISCLOSURE_SENTENCE],
  ['explicit approval and election', APPROVAL_SENTENCE],
  ['approved manifest apply', 'submit exactly the approved manifest through the request spool'],
  ['structured result presentation', '8. **Report.**'],
  ['final ready oracle', 'final post-inspection carries the complete ready result'],
]
const TRUSTED_GIT = process.platform === 'win32' ? 'C:/trusted/git.exe' : '/trusted/git'
const CLAUDE_HOST_CONTEXT = { claudeContextSource: 'host-observed', claudeRootExclusionStatus: 'included' }

function countExact(text, value) {
  return text.split(value).length - 1
}

function stripFrontmatter(text) {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').replace(/\r\n/g, '\n')
}

function readLive(repositoryRoot, relativePath) {
  return readFileSync(join(repositoryRoot, ...relativePath.split('/')), 'utf8').replace(/\r\n/g, '\n')
}

function readBaseline(repositoryRoot, relativePath) {
  return readFileSync(fixtureFilePath(repositoryRoot, relativePath), 'utf8').replace(/\r\n/g, '\n')
}

function assertPhraseRetired(name, text, phrase) {
  assert.equal(countExact(text, phrase), 0, `${name} must not contain the retired tracked-plan phrase: ${phrase}`)
}

function assertApprovalOrder(body) {
  const approvalIndex = body.indexOf(APPROVAL_SENTENCE)
  assert.notEqual(approvalIndex, -1, 'init-backlog must require explicit approval of the complete manifest before apply')
  const writerDisclosureIndex = body.indexOf(EXTERNAL_WRITER_DISCLOSURE_SENTENCE)
  assert.notEqual(writerDisclosureIndex, -1, 'init-backlog must disclose the external writer window before approval')
  assert.equal(writerDisclosureIndex < approvalIndex, true, 'the external writer window must be disclosed before approval is requested')
  const applyIndex = body.indexOf(APPLY_STEP)
  assert.notEqual(applyIndex, -1, 'init-backlog must retain its manifest apply step')
  assert.equal(approvalIndex < applyIndex, true, 'init-backlog must obtain approval before the apply step')
  assert.notEqual(body.indexOf(DENIAL_SENTENCE), -1, 'init-backlog must issue no apply request on denial')
  assert.equal(countExact(body, FINAL_APPROVAL_SCOPE_SENTENCE), 1, 'init-backlog must scope its final approval rule to project and apply-owned writes')
  assert.equal(countExact(body, 'before any file is written'), 0, 'init-backlog must not prohibit its pre-approval request-spool writes')
}

function assertControllerCommandSafety(body) {
  assert.equal(countExact(body, SHELL_LITERAL_SENTENCE), 1, 'init-backlog must require active-shell literal encoding for every command operand')
  assert.equal(countExact(body, POWERSHELL_LITERAL_SENTENCE), 1, 'init-backlog must define PowerShell apostrophe escaping')
  assert.equal(countExact(body, 'Never put a request record in argv'), 1, 'init-backlog must scope the argv prohibition to request records')
  for (const command of [
    '--reserve-request <shell-literal-canonical-root>',
    '--consume-request <shell-literal-canonical-root> <shell-literal-nonce>',
    '--inspect-request-residue <shell-literal-canonical-root>',
    '--clean-request-residue <shell-literal-canonical-root> <shell-literal-nonce-or-null> <shell-literal-owner-digest-or-null> <shell-literal-stage-digest-or-null> <shell-literal-payload-digest-or-null>',
  ]) {
    assert.equal(countExact(body, command), 1, `init-backlog must carry the safe schematic command: ${command}`)
  }
  assert.equal(countExact(body, '<canonical-root>'), 0, 'init-backlog must not carry a bare canonical-root metavariable')
}

function assertReserveFirst(body) {
  const processStart = body.indexOf('## Process')
  const processEnd = body.indexOf('## Version control', processStart)
  assert.notEqual(processStart, -1, 'init-backlog must retain its Process section')
  assert.notEqual(processEnd, -1, 'init-backlog must retain the section after Process')
  const process = body.slice(processStart, processEnd)
  const reserve = process.indexOf('Run `--reserve-request` first')
  const residue = process.indexOf('Only when reservation reports typed `request-residue`')
  assert.notEqual(reserve, -1, 'init-backlog must reserve before inspecting residue')
  assert.notEqual(residue, -1, 'init-backlog must limit residue inspection to a typed reservation collision')
  assert.equal(reserve < residue, true, 'request reservation must precede conditional residue inspection')
}

function extractPlansBullet(name, text) {
  const bullets = text.split('\n').filter((line) => line.startsWith(PLANS_BULLET_PREFIX))
  assert.equal(bullets.length, 1, `${name} must carry exactly one plans lifecycle bullet`)

  return bullets[0]
}

function nulRecords(values) {
  return Buffer.from(values.map((value) => `${value}\0`).join(''), 'utf8')
}

function fakeGitSpawn(canonical, scenario) {
  return (executable, args, options) => {
    if (executable !== TRUSTED_GIT) {
      return spawnSync(executable, args, options)
    }
    const ok = (stdout, status = 0) => ({ status, stdout, stderr: Buffer.alloc(0), signal: null })
    if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') return ok(Buffer.from('true\n', 'utf8'))
    if (args[0] === 'rev-parse' && (args[1] === '--is-inside-git-dir' || args[1] === '--is-bare-repository')) return ok(Buffer.from('false\n', 'utf8'))
    if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return ok(Buffer.from(`${canonical}\n`, 'utf8'))
    if (args[0] === 'rev-parse' && args[1] === '--show-object-format=storage') return ok(Buffer.from('sha1\n', 'utf8'))
    if (args[0] === 'config') return ok(Buffer.alloc(0), 1)
    if (args[0] === 'ls-files') {
      const domain = args[args.indexOf('--') + 1]

      return ok(domain === '.claude/plans' ? nulRecords(scenario.trackedPlanPaths ?? []) : Buffer.alloc(0))
    }
    if (args[0] === 'check-attr') {
      const paths = args.slice(args.indexOf('--') + 1)
      const attributes = args.slice(2, args.indexOf('--'))

      return ok(nulRecords(paths.flatMap((path) => attributes.flatMap((attribute) => [path, attribute, 'unspecified']))))
    }
    if (args[0] === 'check-ignore') {
      const probes = options.input.toString('utf8').split('\0').filter((probe) => probe !== '')
      const records = []
      let matched = false
      for (const probe of probes) {
        const match = scenario.ignore(probe)
        if (match === null) {
          records.push('', '', '', probe)
        } else {
          matched = true
          records.push(match.source, match.line, match.pattern, probe)
        }
      }

      return ok(nulRecords(records), matched ? 0 : 1)
    }

    throw new Error(`Unexpected Git invocation: ${args.join(' ')}`)
  }
}

function inspectFixture(scenario) {
  const root = mkdtempSync(join(tmpdir(), 'nightshift-activation-'))
  try {
    writeFileSync(join(root, 'CLAUDE.md'), '# CLAUDE.md\n\nGuidance for this fixture.\n')
    mkdirSync(join(root, '.claude'), { recursive: true })
    writeFileSync(join(root, '.claude', 'QUICK_WINS.md'), '# Quick wins\n\nNothing tracked yet.\n')
    if (scenario.gitignore !== undefined) {
      writeFileSync(join(root, '.gitignore'), scenario.gitignore)
    }
    if (scenario.nestedIgnore !== undefined) {
      writeFileSync(join(root, '.claude', '.gitignore'), scenario.nestedIgnore)
    }
    if (scenario.git === false) {
      return { result: collectInspection(root, 'claude-code', CLAUDE_HOST_CONTEXT, { candidates: [] }) }
    }
    mkdirSync(join(root, '.git', 'info'), { recursive: true })
    writeFileSync(join(root, '.git', 'info', 'exclude'), '')
    const canonical = realpathSync.native(root)
    const result = collectInspection(root, 'claude-code', CLAUDE_HOST_CONTEXT, {
      candidates: [{ kind: 'directory', link: false, name: 'HEAD', present: true }],
      privateExcludePath: join(canonical, '.git', 'info', 'exclude'),
      spawnSync: fakeGitSpawn(canonical, scenario),
      trustedGitPath: TRUSTED_GIT,
    })

    return { result }
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
}

function plansPolicyProposals(result) {
  return result.proposals.filter((item) => item.reason === 'plans-policy')
}

function decode(base64) {
  return base64 === null ? null : Buffer.from(base64, 'base64').toString('utf8')
}

function runActivationCases(repositoryRoot) {
  const templatesRoot = join(repositoryRoot, 'skills', 'init-backlog', 'templates')
  const skillBody = () => stripFrontmatter(readFileSync(join(repositoryRoot, 'skills', 'init-backlog', 'SKILL.md'), 'utf8'))

  test('the public skill drives the deterministic controller workflow in order', () => {
    const body = skillBody()
    const controllerInvocations = countExact(body, CONTROLLER_INVOCATION)
    assert.notEqual(controllerInvocations, 0, 'the public skill contains zero deterministic controller inspect invocations')
    assert.notEqual(countExact(body, '--reserve-request'), 0, 'init-backlog must reserve the request spool before dispatch')
    assert.notEqual(countExact(body, '--consume-request'), 0, 'init-backlog must consume the reserved request spool')
    assert.notEqual(countExact(body, '--inspect-request-residue'), 0, 'init-backlog must inspect request-spool residue')
    let previousIndex = -1
    for (const [expectation, token] of ORDERED_WORKFLOW_TOKENS) {
      const tokenIndex = body.indexOf(token, previousIndex + 1)
      assert.notEqual(tokenIndex, -1, `init-backlog workflow must include ${expectation} in order: ${token}`)
      previousIndex = tokenIndex
    }
    assert.equal(countExact(body, 'exact decoded before and after content'), 1, 'semantic and whole-file mechanical proposals must disclose exact decoded content')
    assert.equal(countExact(body, 'deliberately withholds both prose images'), 1, 'mechanical breakout unwraps must use the digest-only disclosure carrier')
    assert.equal(countExact(body, 'Any changed bound fact outside the approved simulated states'), 1, 'unrelated drift must invalidate the carried inspection')
    assert.equal(countExact(body, 'never resubmit or hand-edit an old manifest'), 1, 'drift recovery must require a fresh inspect and fresh approval')
  })

  test('controller command examples encode every substituted operand as a shell literal', () => {
    const body = skillBody()

    assertControllerCommandSafety(body)
    assert.throws(
      () => assertControllerCommandSafety(body.replace(SHELL_LITERAL_SENTENCE, '')),
      (error) => error.name === 'AssertionError' && error.message.includes('active-shell literal encoding'),
      'removing the shell-literal contract must fail the safety assertion',
    )
  })

  test('request reservation precedes residue inspection and cleanup', () => {
    const body = skillBody()

    assertReserveFirst(body)
    const mutated = body.replace('Run `--reserve-request` first', 'Run reservation later').replace('Only when reservation reports typed `request-residue`', 'Only when reservation reports typed `request-residue`, run `--reserve-request` first')
    assert.throws(
      () => assertReserveFirst(mutated),
      (error) => error.name === 'AssertionError' && error.message.includes('reserve'),
      'moving residue inspection ahead of reservation must fail the ordering assertion',
    )
  })

  test('approval precedes apply and denial issues no apply request', () => {
    const body = skillBody()
    assertApprovalOrder(body)
    const mutations = [
      [APPROVAL_SENTENCE, 'must require explicit approval of the complete manifest before apply'],
      [DENIAL_SENTENCE, 'must issue no apply request on denial'],
      [FINAL_APPROVAL_SCOPE_SENTENCE, 'must scope its final approval rule to project and apply-owned writes'],
      [APPLY_STEP, 'must retain its manifest apply step'],
    ]
    for (const [removedText, expectedMessage] of mutations) {
      const mutatedBody = body.split(removedText).join('')
      assert.notEqual(mutatedBody, body, `mutation target must exist: ${removedText}`)
      assert.throws(
        () => assertApprovalOrder(mutatedBody),
        (error) => error.name === 'AssertionError' && error.message.includes(expectedMessage),
        `removing ${removedText} must fail the approval contract`,
      )
    }
  })

  test('retired tracked-plan phrases are absent from handover and revise-plan', () => {
    const baselineHandover = readBaseline(repositoryRoot, 'skills/handover/SKILL.md')
    const baselinePlan = readBaseline(repositoryRoot, 'internal/revise/plan.md')
    for (const phrase of RETIRED_TRACKED_PLAN_PHRASES) {
      assert.equal(countExact(baselineHandover, phrase) + countExact(baselinePlan, phrase), 1, `the pinned baseline must contain exactly one occurrence: ${phrase}`)
    }
    const liveHandover = readLive(repositoryRoot, 'skills/handover/SKILL.md')
    const livePlan = readLive(repositoryRoot, 'internal/revise/plan.md')
    for (const [name, text] of [['skills/handover/SKILL.md', liveHandover], ['internal/revise/plan.md', livePlan]]) {
      for (const phrase of RETIRED_TRACKED_PLAN_PHRASES) {
        assertPhraseRetired(name, text, phrase)
        assert.throws(
          () => assertPhraseRetired(name, `${text}\n${phrase}\n`, phrase),
          (error) => error.name === 'AssertionError' && error.message.includes('retired tracked-plan phrase'),
          `${name} absence pin must fail when the phrase returns: ${phrase}`,
        )
      }
    }
    assert.equal(countExact(liveHandover, 'Plans are outside the election: `.claude/plans/` is git-ignored unconditionally'), 1, 'handover must place plans outside the version-control election')
    assert.equal(countExact(liveHandover, 'Plans are never committed: `.claude/plans/` is git-ignored'), 1, 'handover must state that plans are never committed')
    assert.equal(countExact(liveHandover, 'Before trusting or writing a plan hardening stamp, verify that the selected plan is ignored and untracked.'), 1, 'handover must verify the plans policy before stamping')
    assert.equal(countExact(liveHandover, 'A tracked plan is a blocking legacy conflict: stop before stamping, implementation, or deletion and require manual resolution.'), 1, 'handover must stop on a tracked plan')
    assert.equal(countExact(liveHandover, 'git rm -f'), 0, 'handover must not prescribe git removal of a plan file')
    assert.equal(countExact(livePlan, '`git status` reports tracked changes and ordinary untracked files, while `git diff --stat` reports tracked differences; ignored `.claude/plans/` files appear in neither normal output, so fall back to file modification time.'), 1, 'revise-plan must explain why ignored plan files require the modification-time fallback')
  })

  test('generated root guidance matches the repository guidance excerpt for plans', () => {
    const rootGuidance = readLive(repositoryRoot, 'skills/init-backlog/templates/root-guidance.md')
    const agents = readLive(repositoryRoot, 'AGENTS.md')
    const guidanceBullet = extractPlansBullet('templates/root-guidance.md', rootGuidance)
    const agentsBullet = extractPlansBullet('AGENTS.md', agents)
    assert.equal(countExact(guidanceBullet, PLANS_POLICY_SENTENCE), 1, 'generated root guidance must state the never-committed plans policy')
    assert.equal(countExact(agentsBullet, PLANS_POLICY_SENTENCE), 1, 'repository guidance must state the never-committed plans policy')
    assert.equal(guidanceBullet, agentsBullet, 'generated root guidance must match the repository guidance excerpt')
  })

  test('root-guidance digest refresh changes exactly the guidance.section manifest field', () => {
    const manifestBytes = readFileSync(join(templatesRoot, 'manifest.json'))
    const manifest = JSON.parse(manifestBytes.toString('utf8'))
    const entry = manifest.assets.find((item) => item.assetId === 'guidance.section')
    const logical = readFileSync(join(templatesRoot, 'root-guidance.md')).toString('utf8').replace(/\r\n/g, '\n')
    assert.equal(entry.logicalSha256, sha256(Buffer.from(logical, 'utf8')), 'manifest guidance.section digest must match the normalized asset bytes')
    assert.notEqual(entry.logicalSha256, PRE_ACTIVATION_GUIDANCE_DIGEST, 'the activation policy edit must refresh the guidance.section digest')
    // Two deliberate refreshes have moved a manifest digest since the pinned
    // image: the activation policy edit (guidance.section) and the entry-shape
    // example unwrap (backlog.features). Reverting exactly those two must
    // restore the pinned bytes, so any third drift still fails here.
    const featuresEntry = manifest.assets.find((item) => item.assetId === 'backlog.features')
    const featuresLogical = readFileSync(join(templatesRoot, 'features.md')).toString('utf8').replace(/\r\n/g, '\n')
    assert.equal(featuresEntry.logicalSha256, sha256(Buffer.from(featuresLogical, 'utf8')), 'manifest backlog.features digest must match the normalized asset bytes')
    assert.notEqual(featuresEntry.logicalSha256, PRE_UNWRAP_FEATURES_DIGEST, 'the entry-shape example unwrap must refresh the backlog.features digest')
    const restoredManifest = manifestBytes.toString('utf8').split(entry.logicalSha256).join(PRE_ACTIVATION_GUIDANCE_DIGEST).split(featuresEntry.logicalSha256).join(PRE_UNWRAP_FEATURES_DIGEST)
    assert.equal(sha256(Buffer.from(restoredManifest, 'utf8')), PRE_ACTIVATION_MANIFEST_SHA256, 'every manifest byte other than the two refreshed asset digests must remain unchanged')
    assert.throws(
      () => validateManifest(templatesRoot, manifest, { readAsset: (relativePath) => relativePath === entry.path ? Buffer.from(`${logical}Unrefreshed mutation line.\n`, 'utf8') : readFileSync(join(templatesRoot, relativePath)) }),
      /guidance\.section\.logicalSha256/,
      'a root-guidance mutation without a manifest refresh must fail on guidance.section.logicalSha256',
    )
  })

  test('the tracked plans placeholder is deleted and no plan path stays tracked', () => {
    const baselinePlans = git(repositoryRoot, ['ls-tree', '-r', '--name-only', '-z', SOURCE_COMMIT, '--', '.claude/plans'], 'buffer').toString('utf8').split('\0').filter(Boolean)
    assert.deepEqual(baselinePlans, ['.claude/plans/.gitkeep'], 'the pinned baseline must track exactly the plans placeholder')
    const indexedPlans = git(repositoryRoot, ['ls-files', '-z', '--', '.claude/plans'], 'buffer').toString('utf8').split('\0').filter(Boolean)
    assert.deepEqual(indexedPlans, [], 'the post-slice index must track no plan path')
  })

  test('the election excludes plans while the mandatory policy owns them', () => {
    const elective = readLive(repositoryRoot, 'skills/init-backlog/templates/backlog-ignore.txt')
    assert.equal(elective.split('\n').includes('.claude/plans/'), false, 'the elective backlog fragment must not cover plans')
    const mandatory = readLive(repositoryRoot, 'skills/init-backlog/templates/plans-ignore.txt')
    assert.equal(mandatory, '.claude/plans/\n', 'the mandatory fragment must be exactly the plans ignore line')
    const body = skillBody()
    assert.equal(countExact(body, 'The election covers only the durable backlog files'), 1, 'the skill election must cover only the durable backlog files')
    assert.equal(countExact(body, '`.claude/plans/` is git-ignored in every Git repository'), 1, 'the skill must state the unconditional plans policy')
    assert.equal(countExact(body, 'never a user preference'), 1, 'the skill must state that the plans policy is not an election')
  })

  test('a satisfied plans policy carries no policy action', () => {
    const { result } = inspectFixture({
      gitignore: '.claude/plans/\n',
      ignore: (probe) => probe.startsWith('.claude/plans') ? { line: '1', pattern: '.claude/plans/', source: '.gitignore' } : null,
    })
    assert.equal(result.git.plansPolicy, 'satisfied')
    assert.deepEqual(plansPolicyProposals(result), [])
    assert.equal(result.git.electionRequired, false, 'the plans policy must not depend on the non-plan election')
  })

  test('an action-required plans policy carries the exact mandatory append', () => {
    const { result } = inspectFixture({ gitignore: 'node_modules/\n', ignore: () => null })
    assert.equal(result.git.plansPolicy, 'action-required')
    const proposals = plansPolicyProposals(result)
    assert.equal(proposals.length, 1, 'action-required must carry exactly one plans-policy proposal')
    assert.equal(proposals[0].action.kind, 'exact-edit')
    assert.equal(proposals[0].action.target, '.gitignore')
    assert.equal(decode(proposals[0].beforeBase64), 'node_modules/\n')
    assert.equal(decode(proposals[0].afterBase64), 'node_modules/\n.claude/plans/\n')
    assert.equal(result.git.electionRequired, false, 'the mandatory append must not depend on the non-plan election')
  })

  test('a later root negation requires a final positive plans rule', () => {
    const seed = '.claude/plans/\n!.claude/plans/\n'
    const { result } = inspectFixture({
      gitignore: seed,
      ignore: (probe) => probe.startsWith('.claude/plans') ? { line: '2', pattern: '!.claude/plans/', source: '.gitignore' } : null,
    })

    assert.equal(result.git.plansPolicy, 'action-required')
    const proposals = plansPolicyProposals(result)
    assert.equal(proposals.length, 1)
    assert.equal(decode(proposals[0].beforeBase64), seed)
    assert.equal(decode(proposals[0].afterBase64), `${seed}.claude/plans/\n`)
  })

  test('a tracked conflict still repairs a root rule defeated by a later negation', () => {
    const seed = '.claude/plans/\n!.claude/plans/\n'
    const { result } = inspectFixture({
      gitignore: seed,
      ignore: (probe) => probe.startsWith('.claude/plans') ? { line: '2', pattern: '!.claude/plans/', source: '.gitignore' } : null,
      trackedPlanPaths: ['.claude/plans/example.md'],
    })

    assert.equal(result.git.plansPolicy, 'tracked-conflict')
    const proposals = plansPolicyProposals(result)
    assert.equal(proposals.length, 1)
    assert.equal(decode(proposals[0].afterBase64), `${seed}.claude/plans/\n`)
  })

  test('a tracked conflict stays incomplete and independently carries the required append', () => {
    const { result } = inspectFixture({ gitignore: 'node_modules/\n', ignore: () => null, trackedPlanPaths: ['.claude/plans/2026-08-25-example.md'] })
    assert.equal(result.git.plansPolicy, 'tracked-conflict')
    assert.deepEqual(result.git.trackedPlanPaths, ['.claude/plans/2026-08-25-example.md'])
    const proposals = plansPolicyProposals(result)
    assert.equal(proposals.length, 1, 'tracked-conflict must still carry the otherwise required append')
    assert.equal(decode(proposals[0].afterBase64), 'node_modules/\n.claude/plans/\n')
    const blocking = result.problems.filter((item) => item.code === 'git-policy' && item.blocking === true)
    assert.equal(blocking.length >= 1, true, 'tracked-conflict must remain a blocking incomplete state')
    assert.equal(blocking.some((item) => item.evidencePaths.includes('.claude/plans/2026-08-25-example.md')), true, 'the blocking problem must carry the tracked plan path')
  })

  test('a nested conflict suppresses the ineffective root append', () => {
    const { result } = inspectFixture({
      gitignore: 'node_modules/\n',
      ignore: (probe) => probe.startsWith('.claude/plans') ? { line: '1', pattern: 'plans/', source: '.claude/.gitignore' } : null,
      nestedIgnore: 'plans/\n',
    })
    assert.equal(result.git.plansPolicy, 'nested-conflict')
    assert.deepEqual(plansPolicyProposals(result), [], 'a nested conflict must suppress the ineffective root append')
    assert.equal(result.problems.some((item) => item.code === 'git-policy' && item.blocking === true), true, 'a nested conflict must remain blocking')
  })

  test('a non-Git repository is not-applicable with no gitignore surface', () => {
    const { result } = inspectFixture({ git: false })
    assert.equal(result.git.plansPolicy, 'not-applicable')
    assert.deepEqual(plansPolicyProposals(result), [])
    assert.equal(result.targets.some((item) => item.target === '.gitignore'), false, 'non-Git inspection must not instantiate .gitignore')
  })
}

module.exports = { runActivationCases }
