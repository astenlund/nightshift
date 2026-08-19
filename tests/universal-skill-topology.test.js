'use strict'

const assert = require('node:assert/strict')
const { existsSync, lstatSync, readdirSync, readFileSync } = require('node:fs')
const { join, relative } = require('node:path')
const test = require('node:test')

const { PROCEDURE_REPLACEMENTS, PUBLIC_SKILLS, REVISE_ENGINE_RESOURCES, REVISE_WRAPPERS } = require('./entry-contract')

const REPOSITORY_ROOT = join(__dirname, '..')
const AGREEMENT_PATH = '../spec-agreement/SKILL.md'
const ENGINE_ROOT = join(REPOSITORY_ROOT, 'internal', 'revise')
const ENGINE_PATH = '../../internal/revise/SKILL.md'
const FIXTURE_ROOT = join(__dirname, 'fixtures', 'legacy-plugin-2.4.5')
const PUBLIC_SKILLS_ROOT = join(REPOSITORY_ROOT, 'skills')

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

  const confirmStep = '3. **Confirm.** Wait for explicit user confirmation before any writes.'
  const applyStep = '4. **Apply.** Execute the approved actions.'
  const confirmIndex = body.indexOf(confirmStep)
  const applyIndex = body.indexOf(applyStep)
  assert.equal(countExact(body, confirmStep), 1, 'init-backlog must require explicit confirmation before writes exactly once')
  assert.notEqual(applyIndex, -1, 'init-backlog must retain its apply step')
  assert.equal(confirmIndex < applyIndex, true, 'init-backlog must require explicit confirmation before Apply')
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
    join(PUBLIC_SKILLS_ROOT, 'spec-agreement', 'spec-agreement.js'),
    join(PUBLIC_SKILLS_ROOT, 'spec-agreement', 'spec-agreement.test.js'),
    join(PUBLIC_SKILLS_ROOT, 'spec-agreement', 'fixtures', 'fingerprint-v1.json'),
  ]) {
    requireRegularFile(bundledPath)
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

test('init-backlog preserves scaffolding behavior and reinforces current-session agreement', () => {
  const initBacklogPath = join(PUBLIC_SKILLS_ROOT, 'init-backlog', 'SKILL.md')
  const body = parseFrontmatter(initBacklogPath).body.replace(/\r?\n/g, '\n')
  const indexNames = ['QUICK_WINS.md', 'FEATURES.md', 'BUGS.md', 'PATTERNS.md']
  const currentSessionRule = 'Readiness and graduation are not approval: before spec-governed work, present the current decision-complete digest and obtain explicit agreement in this session.'
  const finalPresentationRule = 'When a final governing design is presented, invoke /nightshift:spec-agreement in final-presentation mode before asking for agreement.'
  const freshnessRule = 'Existing agreement is fresh only when the complete current candidate matches or passes contract-fit evaluation in the same session.'

  assertInitBacklogScaffoldInventory(body)

  assert.match(body, /\*\*Index files\*\* \(four, top-level under `\.claude\/`\)/, 'init-backlog must retain its four-index target inventory')
  for (const indexName of indexNames) {
    assert.equal(body.includes(`- \`.claude/${indexName}\``), true, `init-backlog must target .claude/${indexName}`)
    assert.equal(body.includes(`### \`.claude/${indexName}\``), true, `init-backlog must retain the authoritative ${indexName} template`)
  }
  assert.match(body, /Create from template if missing/, 'init-backlog must create missing index files from its authoritative templates')

  assert.match(body, /version-control election/, 'init-backlog must retain the version-control election')
  assert.match(body, /tracked in git or ignored/, 'init-backlog must retain the track-vs-ignore choice')
  assert.match(body, /appends the scaffolded paths to `\.gitignore`/, 'init-backlog must implement the ignore election')
  assert.match(body, /`git rm --cached`/, 'init-backlog must retain the tracked-to-ignored migration warning')

  assert.match(body, /The skill is idempotent: re-running on an existing project adds only\nwhat's missing/, 'init-backlog must remain add-missing and idempotent')
  assert.match(body, /Never overwrite an existing top-level index file or an existing subdirectory's contents/, 'init-backlog must preserve existing backlog content')
  assert.match(body, /Skip every up-to-date index file and every existing subdirectory/, 'init-backlog reruns must skip current targets')

  assert.match(body, /### `CLAUDE\.md` \(fresh minimal file\)[\s\S]*Use the complete `## Backlogs and indexes` section from the fresh `CLAUDE\.md` template above/, 'existing-root guidance must compose from the complete fresh-root section')
  assert.match(body, /\*\*Targeted-patch insertion rules\*\*[\s\S]*Never re-flow/, 'existing-root updates must remain targeted rather than destructive rewrites')
  assert.equal(countExact(body, currentSessionRule), 5, 'init-backlog must reinforce agreement in four index templates and fresh root guidance')
  assert.equal(countExact(body, finalPresentationRule), 2, 'init-backlog must protect the final-presentation checklist and generated guidance')
  assert.equal(countExact(body, freshnessRule), 2, 'init-backlog must protect the freshness checklist and generated guidance')

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
    ['3. **Confirm.** Wait for explicit user confirmation before any writes.', 'init-backlog must require explicit confirmation before writes exactly once'],
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
    'build a single flat TaskCreate queue',
  ]
  assert.notEqual(agreementSectionStart, -1, 'handover must define agreement and stage entry')
  let previousIndex = agreementSectionStart
  for (const token of orderedAgreementTokens) {
    const tokenIndex = body.indexOf(token, previousIndex)
    assert.notEqual(tokenIndex, -1, `handover agreement ordering must include ${token}`)
    assert.equal(tokenIndex > previousIndex, true, `handover agreement ordering must place ${token} after its predecessor`)
    previousIndex = tokenIndex
  }

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

test('current manifest descriptions agree and identify handover as a skill', () => {
  const pluginManifest = JSON.parse(readRequiredFile(join(REPOSITORY_ROOT, '.claude-plugin', 'plugin.json')))
  const marketplaceManifest = JSON.parse(readRequiredFile(join(REPOSITORY_ROOT, '.claude-plugin', 'marketplace.json')))
  assert.equal(pluginManifest.description, marketplaceManifest.plugins[0].description)
  assert.equal(pluginManifest.description.includes('handover command'), false)
  assert.equal(marketplaceManifest.plugins[0].description.includes('handover command'), false)
})

test('revise topology requires all relocated engine files as regular files', () => {
  for (const fileName of ['SKILL.md', 'code.md', 'plan.md', 'spec.md', 'rigor.js', 'rigor.test.js', 'revise-round.workflow.js', 'revise-round.test.js']) {
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
