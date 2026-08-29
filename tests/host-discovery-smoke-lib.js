'use strict'

const { createHash, randomBytes } = require('node:crypto')
const { copyFileSync, cpSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, unlinkSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { dirname, isAbsolute, join, relative, resolve, sep } = require('node:path')
const { execFileSync, spawn } = require('node:child_process')
const { PUBLIC_SKILLS } = require('./entry-contract')

const CODEX_CATALOG_PROMPT = 'Return a JSON object whose skills array contains only the plugin-qualified Nightshift skill identifiers visible in the injected Skills catalog.'
const RUNTIME_KEYS = Object.freeze(['PATH', 'PATHEXT', 'SystemRoot', 'WINDIR', 'ComSpec', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'LANG', 'LC_ALL', 'TERM'])
const MAX_CAPTURE_BYTES = 1048576
const TIMEOUT_MS = 300000
const ENGINE_RESOURCE_KEYS = Object.freeze(['code', 'plan', 'rigor', 'spec', 'workflow'])

function compareOrdinal(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function projectRuntimeEnvironment(parentEnv, platform = process.platform) {
  const environment = {}
  const sourceKeys = Object.keys(parentEnv).sort(compareOrdinal)
  for (const key of RUNTIME_KEYS) {
    const matches = platform === 'win32' ? sourceKeys.filter((sourceKey) => sourceKey.localeCompare(key, undefined, { sensitivity: 'accent' }) === 0) : sourceKeys.filter((sourceKey) => sourceKey === key)
    const selected = matches.includes(key) ? key : matches[0]
    if (selected !== undefined && typeof parentEnv[selected] === 'string' && parentEnv[selected] !== '') {
      environment[selected] = parentEnv[selected]
    }
  }

  return environment
}

function resolveExternalClaudeConfigRoot(parentEnv, homeDir) {
  const configured = parentEnv.CLAUDE_CONFIG_DIR
  if (typeof configured === 'string' && configured.trim() !== '') {
    if (!isAbsolute(configured)) {
      throw new Error('Claude credential source must be absolute')
    }

    return configured
  }

  return join(homeDir, '.claude')
}

function resolveExternalCodexHome(parentEnv, homeDir) {
  const configured = parentEnv.CODEX_HOME
  if (typeof configured === 'string' && configured.trim() !== '') {
    if (!isAbsolute(configured)) {
      throw new Error('Codex credential source must be absolute')
    }

    return configured
  }

  return join(homeDir, '.codex')
}

function assertOutsideCheckout(filePath, checkoutRoot) {
  const resolvedFile = realpathSync(filePath)
  const resolvedCheckout = realpathSync(checkoutRoot)
  const relation = relative(resolvedCheckout, resolvedFile)
  if (relation === '' || relation !== '..' && !relation.startsWith('..' + require('node:path').sep) && !isAbsolute(relation)) {
    throw new Error('Credential source must be outside the checkout')
  }

  return resolvedFile
}

function copyCredential({ checkoutRoot, sourceRoot, sourceName, profileRoot }) {
  const sourcePath = join(sourceRoot, sourceName)
  const metadata = lstatSync(sourcePath)
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size === 0) {
    throw new Error('Credential source is not a nonempty regular file')
  }
  const resolvedSource = assertOutsideCheckout(sourcePath, checkoutRoot)
  mkdirSync(profileRoot, { recursive: true })
  copyFileSync(resolvedSource, join(profileRoot, sourceName))
}

function git(checkoutRoot, args, encoding = 'utf8') {
  return execFileSync('git', ['-C', checkoutRoot, ...args], { encoding, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
}

function listedTreeEntries(checkoutRoot, treeId) {
  const output = git(checkoutRoot, ['ls-tree', '-rz', '--full-tree', treeId], 'buffer')
  return output.toString('utf8').split('\0').filter(Boolean).map((record) => {
    const tab = record.indexOf('\t')
    const header = record.slice(0, tab).split(' ')
    if (tab === -1 || header.length !== 3) {
      throw new Error('Invalid indexed tree entry')
    }
    const [mode, type, objectId] = header
    const entryPath = record.slice(tab + 1)
    if (entryPath === '.claude/plans' || entryPath.startsWith('.claude/plans/')) {
      return null
    }
    if (mode !== '100644' && mode !== '100755') {
      throw new Error('Unsupported indexed entry mode: ' + mode)
    }
    if (type !== 'blob') {
      throw new Error('Unsupported indexed entry type: ' + type)
    }
    if (entryPath.includes('\\') || entryPath.startsWith('/') || entryPath.split('/').includes('..')) {
      throw new Error('Unsafe indexed entry path')
    }

    return { entryPath, mode, objectId }
  }).filter(Boolean).sort((left, right) => compareOrdinal(left.entryPath, right.entryPath))
}

function writeDigestRecord(hash, entryPath, content) {
  const pathBytes = Buffer.from(entryPath, 'utf8')
  const pathLength = Buffer.alloc(4)
  pathLength.writeUInt32BE(pathBytes.length)
  const contentLength = Buffer.alloc(8)
  contentLength.writeBigUInt64BE(BigInt(content.length))
  hash.update(Buffer.from([1]))
  hash.update(pathLength)
  hash.update(pathBytes)
  hash.update(contentLength)
  hash.update(content)
}

function stageCandidate({ checkoutRoot, destinationRoot, treeId }) {
  const root = join(destinationRoot, 'snapshot')
  mkdirSync(root, { recursive: true })
  const hash = createHash('sha256')
  for (const entry of listedTreeEntries(checkoutRoot, treeId)) {
    const content = git(checkoutRoot, ['cat-file', 'blob', entry.objectId], 'buffer')
    const target = join(root, ...entry.entryPath.split('/'))
    mkdirSync(require('node:path').dirname(target), { recursive: true })
    writeFileSync(target, content, { mode: entry.mode === '100755' ? 0o755 : 0o644 })
    writeDigestRecord(hash, entry.entryPath, content)
  }
  const manifest = JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8'))
  if (typeof manifest.version !== 'string' || manifest.version === '') {
    throw new Error('Staged candidate has no version')
  }

  return { root, version: manifest.version, digest: hash.digest('hex') }
}

function loadLegacyBaseline(candidateRoot) {
  const root = join(candidateRoot, 'tests', 'fixtures', 'legacy-plugin-2.4.5')
  const manifestPath = join(root, '.claude-plugin', 'plugin.json')
  const manifestMetadata = lstatSync(manifestPath)
  assertion(manifestMetadata.isSymbolicLink() === false && manifestMetadata.isFile(), 'Legacy baseline manifest is not a regular file')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  assertion(manifest && manifest.version === '2.4.5', 'Legacy baseline version is not 2.4.5')
  const commandNames = readdirSync(join(root, 'commands'), { withFileTypes: true }).map((entry) => {
    assertion(entry.isSymbolicLink() === false && entry.isFile() && entry.name.endsWith('.md'), 'Legacy baseline command is invalid')
    return entry.name.slice(0, -3)
  }).sort(compareOrdinal)
  const skillNames = readdirSync(join(root, 'skills'), { withFileTypes: true }).map((entry) => {
    assertion(entry.isSymbolicLink() === false && entry.isDirectory(), 'Legacy baseline skill is invalid')
    const skillFile = lstatSync(join(root, 'skills', entry.name, 'SKILL.md'))
    assertion(skillFile.isSymbolicLink() === false && skillFile.isFile(), 'Legacy baseline skill file is invalid')
    return entry.name
  }).sort(compareOrdinal)

  return { root, version: manifest.version, commandNames, skillNames }
}

function loadPromptBaseline(candidateRoot) {
  const root = join(candidateRoot, 'tests', 'fixtures', 'init-backlog-prompt-baseline')
  const manifestPath = join(root, 'manifest.json')
  const manifestMetadata = lstatSync(manifestPath)
  assertion(manifestMetadata.isSymbolicLink() === false && manifestMetadata.isFile(), 'Prompt baseline manifest is not a regular file')
  assertion(isContained(realpathSync(candidateRoot), realpathSync(manifestPath)), 'Prompt baseline manifest escapes the copied candidate root')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  assertion(manifest && manifest.schemaVersion === 1 && typeof manifest.sourceCommit === 'string' && Array.isArray(manifest.files), 'Prompt baseline manifest is invalid')

  return { manifest, root }
}

function assemblePromptBaseline({ candidateRoot, destinationRoot }) {
  const baseline = loadPromptBaseline(candidateRoot)
  const fixtureRoot = realpathSync(baseline.root)
  const installedRoot = join(destinationRoot, 'plugin')
  for (const entry of baseline.manifest.files) {
    assertion(entry && typeof entry.path === 'string' && /^[a-zA-Z0-9._/-]+$/.test(entry.path) && !entry.path.split('/').includes('..'), 'Prompt baseline file entry is invalid')
    const source = join(fixtureRoot, ...entry.path.split('/'))
    const target = join(installedRoot, ...entry.path.split('/'))
    const metadata = lstatSync(source)
    assertion(metadata.isSymbolicLink() === false && metadata.isFile() && isContained(fixtureRoot, realpathSync(source)), 'Prompt baseline source file is invalid')
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(source, target)
  }

  return { fixtureRoot, installedRoot: realpathSync(installedRoot) }
}

function assembleClaudePromptBaseline(options) {
  return assemblePromptBaseline(options)
}

function assembleCodexPromptBaseline(options) {
  return assemblePromptBaseline(options)
}

function createMarketplace({ marketplaceRoot, snapshotRoot }) {
  mkdirSync(join(marketplaceRoot, '.claude-plugin'), { recursive: true })
  cpSync(snapshotRoot, join(marketplaceRoot, 'plugin'), { recursive: true, dereference: false })
  writeFileSync(join(marketplaceRoot, '.claude-plugin', 'marketplace.json'), JSON.stringify({ name: 'astenlund', owner: { name: 'Andreas Stenlund' }, plugins: [{ name: 'nightshift', source: './plugin' }] }, null, 2) + '\n')
}

function buildCodexArgv({ prompt, schemaPath }) {
  return ['exec', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only', '--output-schema', schemaPath, prompt]
}

function createCellSequence(host, mode) {
  assertion(['claude', 'codex'].includes(host) && ['clean', 'repeat'].includes(mode), 'Unsupported host cell')
  if (mode === 'clean') {
    return ['install-candidate', 'verify-candidate']
  }
  if (host === 'claude') {
    return ['install-baseline', 'verify-baseline', 'replace-candidate', 'update-candidate', 'verify-candidate', 'update-candidate', 'verify-candidate']
  }

  return ['install-baseline', 'verify-baseline', 'remove-baseline', 'replace-candidate', 'install-candidate', 'verify-candidate', 'remove-candidate', 'install-candidate', 'verify-candidate']
}

async function executeCellSequence(sequence, actions) {
  for (const action of sequence) {
    assertion(typeof actions[action] === 'function', 'Cell sequence action is unavailable: ' + action)
    await actions[action]()
  }
}

function emptyRow(host, mode) {
  return { host, mode, status: 'fail', candidateVersion: null, candidateDigest: null, publicSkills: [], legacyCommands: [], legacySkillPresent: false, diagnostic: 'not started' }
}

function boundedDiagnostic(error) {
  const text = error && typeof error.message === 'string' ? error.message : 'host smoke failure'
  return text.replace(/[\r\n]+/g, ' ').slice(0, 240) || 'host smoke failure'
}

function parseJsonOutput(stdout, label) {
  try {
    const parsed = JSON.parse(stdout)
    assertion(parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed), label + ' response must be an object')

    return parsed
  } catch (error) {
    if (error && error.message && error.message.includes(label)) {
      throw error
    }
    throw new Error(label + ' response is not valid JSON')
  }
}

function parseClaudeAuthStatus(stdout) {
  const status = parseJsonOutput(stdout, 'Claude auth')
  assertion(Object.hasOwn(status, 'loggedIn') && status.loggedIn === true, 'Claude auth status is not authenticated')

  return true
}

function parseCodexAuthStatus(stdout, stderr) {
  const positiveLines = [stdout, stderr].flatMap((stream) => typeof stream === 'string' ? stream.split(/\r?\n/) : []).filter((line) => ['Logged in using ChatGPT', 'Logged in using an API key'].includes(line))
  assertion(positiveLines.length === 1, 'Codex auth status is not authenticated')

  return true
}

function childMetadataValue(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : 'invalid'
}

function classifyChildExit(code, stdout, stdoutBytes, stderrBytes) {
  try {
    const parsed = JSON.parse(stdout)
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const type = Object.hasOwn(parsed, 'type') ? childMetadataValue(parsed.type) : 'missing'
      const subtype = Object.hasOwn(parsed, 'subtype') ? childMetadataValue(parsed.subtype) : 'missing'
      const isError = typeof parsed.is_error === 'boolean' ? String(parsed.is_error) : 'invalid'
      return 'host child failed with exit code ' + code + ' json=true type=' + type + ' subtype=' + subtype + ' is_error=' + isError
    }
  } catch {
    // Non-JSON child output is reported only by shape and byte counts.
  }

  return 'host child failed with exit code ' + code + ' json=false stdoutBytes=' + stdoutBytes + ' stderrBytes=' + stderrBytes
}

function runChild(command, args, options) {
  return new Promise((resolveChild, rejectChild) => {
    let stdoutBytes = 0
    let stderrBytes = 0
    let settled = false
    let stoppingError = null
    const stdout = []
    const stderr = []
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, shell: false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    const finish = (callback, value) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        callback(value)
      }
    }
    const terminate = (message) => {
      if (stoppingError === null) {
        stoppingError = new Error(message)
        child.kill()
      }
    }
    const timer = setTimeout(() => terminate('host child timed out'), TIMEOUT_MS)
    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length
      if (stdoutBytes > MAX_CAPTURE_BYTES) {
        terminate(`stdout exceeded ${MAX_CAPTURE_BYTES}-byte limit`)
      } else {
        stdout.push(chunk)
      }
    })
    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.length
      if (stderrBytes > MAX_CAPTURE_BYTES) {
        terminate(`stderr exceeded ${MAX_CAPTURE_BYTES}-byte limit`)
      } else {
        stderr.push(chunk)
      }
    })
    child.on('error', (error) => {
      stoppingError = error
    })
    child.on('close', (code) => {
      if (stoppingError !== null) {
        finish(rejectChild, stoppingError)
      } else if (code === 0) {
        finish(resolveChild, { stderr: Buffer.concat(stderr).toString('utf8'), stdout: Buffer.concat(stdout).toString('utf8') })
      } else {
        finish(rejectChild, new Error(classifyChildExit(code, Buffer.concat(stdout).toString('utf8'), stdoutBytes, stderrBytes)))
      }
    })
    if (options.stdin !== undefined) {
      child.stdin.end(options.stdin)
    } else {
      child.stdin.end()
    }
  })
}

function isMissingExecutable(error) {
  return error && error.code === 'ENOENT'
}

function assertion(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function validateEvidenceRow(row) {
  const expected = ['candidateDigest', 'candidateVersion', 'diagnostic', 'host', 'legacyCommands', 'legacySkillPresent', 'mode', 'publicSkills', 'status']
  assertion(row && typeof row === 'object' && !Array.isArray(row), 'Evidence row must be an object')
  assertion(Object.keys(row).sort(compareOrdinal).join(',') === expected.join(','), 'Evidence row must contain exactly the required fields')
  assertion(['claude', 'codex'].includes(row.host) && ['clean', 'repeat'].includes(row.mode) && ['pass', 'fail', 'provisional'].includes(row.status), 'Evidence scalar is invalid')
  for (const key of ['candidateVersion', 'candidateDigest']) {
    assertion(row[key] === null || typeof row[key] === 'string' && row[key] !== '', 'Evidence candidate value is invalid')
  }
  assertion(row.candidateDigest === null || /^[a-f0-9]{64}$/.test(row.candidateDigest), 'Evidence digest is invalid')
  assertion(row.status !== 'pass' || typeof row.candidateVersion === 'string' && row.candidateVersion !== '' && typeof row.candidateDigest === 'string' && /^[a-f0-9]{64}$/.test(row.candidateDigest), 'Pass evidence requires a candidate version and digest')
  assertion(row.diagnostic === null || typeof row.diagnostic === 'string' && row.diagnostic !== '', 'Evidence diagnostic is invalid')
  assertion((row.status === 'pass') === (row.diagnostic === null), 'Evidence diagnostic does not match status')
  for (const collection of ['publicSkills', 'legacyCommands']) {
    assertion(Array.isArray(row[collection]) && row[collection].every((item) => typeof item === 'string') && row[collection].every((item, index, array) => index === 0 || compareOrdinal(array[index - 1], item) < 0), 'Evidence collection must be ordinal sorted')
  }
  assertion(typeof row.legacySkillPresent === 'boolean', 'Evidence legacy skill value is invalid')
}

function filesystemIdentity(metadata) {
  return `${metadata.dev.toString()}:${metadata.ino.toString()}`
}

function inspectEvidenceDirectoryChain(checkoutRoot, evidenceRoot, create) {
  const checkoutMetadata = lstatSync(checkoutRoot, { bigint: true })
  assertion(checkoutMetadata.isDirectory() && !checkoutMetadata.isSymbolicLink(), 'Evidence authority must be an ordinary direct directory')
  const authority = realpathSync.native(checkoutRoot)
  const target = resolve(evidenceRoot)
  assertion(isContained(authority, target), 'Evidence root must be contained by the checkout')
  const paths = [authority]
  let current = authority
  for (const segment of relative(authority, target).split(sep)) {
    current = join(current, segment)
    if (create) {
      try {
        mkdirSync(current, { mode: 0o700 })
      } catch (error) {
        if (error?.code !== 'EEXIST') {
          throw error
        }
      }
    }
    const metadata = lstatSync(current, { bigint: true })
    assertion(metadata.isDirectory() && !metadata.isSymbolicLink() && realpathSync.native(current) === current, 'Evidence path must be an ordinary direct directory without aliases')
    paths.push(current)
  }

  return {
    directories: paths.map((path) => ({ identity: filesystemIdentity(lstatSync(path, { bigint: true })), path })),
    root: target,
  }
}

function assertEvidenceDirectoriesStable(snapshot) {
  for (const directory of snapshot.directories) {
    const metadata = lstatSync(directory.path, { bigint: true })
    assertion(metadata.isDirectory() && !metadata.isSymbolicLink() && filesystemIdentity(metadata) === directory.identity && realpathSync.native(directory.path) === directory.path, 'Evidence directory identity changed')
  }
}

function stableEvidenceFile(root, filePath) {
  const before = lstatSync(filePath, { bigint: true })
  assertion(before.isFile() && !before.isSymbolicLink() && before.nlink === 1n, 'Evidence row must be a direct single-link file')
  const canonicalRoot = realpathSync.native(root)
  const canonicalFile = realpathSync.native(filePath)
  assertion(isContained(canonicalRoot, canonicalFile), 'Evidence row escapes its root')
  const bytes = readFileSync(filePath)
  const after = lstatSync(filePath, { bigint: true })
  assertion(after.isFile() && !after.isSymbolicLink() && after.nlink === 1n && filesystemIdentity(after) === filesystemIdentity(before) && after.size === before.size && after.mtimeNs === before.mtimeNs && realpathSync.native(filePath) === canonicalFile, 'Evidence row changed during verification')

  return { bytes, identity: filesystemIdentity(before) }
}

function expectedPublicSkillNames() {
  return PUBLIC_SKILLS.map((name) => 'nightshift:' + name).sort(compareOrdinal)
}

function writeEvidence({ checkoutRoot, evidenceRoot, row }) {
  validateEvidenceRow(row)
  const snapshot = inspectEvidenceDirectoryChain(checkoutRoot, evidenceRoot, true)
  const basename = row.host + '-' + row.mode + '.json'
  const destination = join(snapshot.root, basename)
  const stage = join(snapshot.root, '.' + basename + '.' + randomBytes(16).toString('hex') + '.new')
  const bytes = Buffer.from(JSON.stringify(row) + '\n', 'utf8')
  let stagePresent = false
  try {
    writeFileSync(stage, bytes, { flag: 'wx', mode: 0o600 })
    stagePresent = true
    const staged = stableEvidenceFile(snapshot.root, stage)
    try {
      linkSync(stage, destination)
    } catch (error) {
      if (error?.code === 'EEXIST') {
        throw new Error('Evidence row already exists', { cause: error })
      }
      throw new Error('Evidence row exclusive publication failed', { cause: error })
    }
    unlinkSync(stage)
    stagePresent = false
    const published = stableEvidenceFile(snapshot.root, destination)
    assertion(published.identity === staged.identity && published.bytes.equals(bytes), 'Published evidence row differs from its staged bytes')
    assertEvidenceDirectoriesStable(snapshot)
  } finally {
    if (stagePresent) {
      try {
        unlinkSync(stage)
      } catch {
        // The surviving random stage makes later evaluation fail closed.
      }
    }
  }
}

function readEvidence(evidenceRoot, host, mode) {
  return JSON.parse(stableEvidenceFile(evidenceRoot, join(evidenceRoot, host + '-' + mode + '.json')).bytes.toString('utf8'))
}

function candidateDigestForIndex(checkoutRoot) {
  const tempRoot = mkdtempSync(join(tmpdir(), 'nightshift-host-smoke-'))
  try {
    return stageCandidate({ checkoutRoot, destinationRoot: tempRoot, treeId: git(checkoutRoot, ['write-tree']).trim() }).digest
  } finally {
    rmSync(tempRoot, { force: true, recursive: true })
  }
}

function evaluateEvidence({ checkoutRoot, evidenceRoot, release }) {
  const snapshot = inspectEvidenceDirectoryChain(checkoutRoot, evidenceRoot, false)
  const expectedRows = ['claude-clean.json', 'claude-repeat.json', 'codex-clean.json', 'codex-repeat.json']
  assertion(readdirSync(snapshot.root).sort(compareOrdinal).join(',') === expectedRows.join(','), 'Evidence root must contain exactly the four row files')
  const cells = ['claude', 'codex'].flatMap((host) => ['clean', 'repeat'].map((mode) => ({ host, mode, row: readEvidence(snapshot.root, host, mode) })))
  for (const { host, mode, row } of cells) {
    validateEvidenceRow(row)
    assertion(row.host === host && row.mode === mode, 'Evidence row identity differs from its filename')
    assertion(row.publicSkills.join(',') === expectedPublicSkillNames().join(','), 'Evidence public skills are unexpected')
    assertion(row.legacyCommands.length === 0 && row.legacySkillPresent === false, 'Evidence exposes legacy entry points')
    assertion(row.status === 'pass' || !release && row.status === 'provisional' && row.diagnostic === 'host executable absent', 'Evidence status is not accepted')
  }
  const rows = cells.map((cell) => cell.row)
  const digest = candidateDigestForIndex(checkoutRoot)
  for (const row of rows) {
    assertion(row.candidateDigest === digest, 'Evidence candidate digest is stale or mixed')
  }
  assertEvidenceDirectoriesStable(snapshot)

  return { digest, rows }
}

function isContained(root, target) {
  const relation = relative(root, target)
  return relation !== '' && relation !== '..' && !relation.startsWith('..' + require('node:path').sep) && !isAbsolute(relation)
}

function listFiles(root, prefix = '') {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const child = join(root, entry.name)
    const entryPath = prefix === '' ? entry.name : prefix + '/' + entry.name
    assertion(entry.isSymbolicLink() === false, 'Installed candidate contains a link')
    if (entry.isDirectory()) {
      return listFiles(child, entryPath)
    }
    assertion(entry.isFile(), 'Installed candidate contains an unsupported entry')

    return [entryPath]
  }).sort(compareOrdinal)
}

function assertInstalledPlugin(snapshotRoot, installedRoot, tempRoot, version) {
  const resolvedTemp = realpathSync(tempRoot)
  const resolvedInstalled = realpathSync(installedRoot)
  assertion(isContained(resolvedTemp, resolvedInstalled), 'Host reported an installed root outside the generated profile')
  const manifest = JSON.parse(readFileSync(join(resolvedInstalled, '.claude-plugin', 'plugin.json'), 'utf8'))
  assertion(manifest && manifest.version === version, 'Installed manifest version differs from candidate')
  for (const entryPath of listFiles(snapshotRoot)) {
    const installedPath = join(resolvedInstalled, ...entryPath.split('/'))
    const metadata = lstatSync(installedPath)
    assertion(metadata.isSymbolicLink() === false && metadata.isFile(), 'Installed candidate file is missing or not regular: ' + entryPath)
    assertion(Buffer.compare(readFileSync(join(snapshotRoot, ...entryPath.split('/'))), readFileSync(installedPath)) === 0, 'Installed candidate bytes differ: ' + entryPath)
  }

  return resolvedInstalled
}

function assertInstalledCandidate(snapshotRoot, installedRoot, tempRoot, version) {
  const resolvedInstalled = assertInstalledPlugin(snapshotRoot, installedRoot, tempRoot, version)
  assertion(existsSync(join(resolvedInstalled, 'commands')) === false && existsSync(join(resolvedInstalled, 'skills', 'revise')) === false, 'Installed candidate exposes retired entries')

  return resolvedInstalled
}

function assertInstalledBaseline(baseline, installedRoot, tempRoot) {
  const resolvedInstalled = assertInstalledPlugin(baseline.root, installedRoot, tempRoot, baseline.version)
  const commandNames = readdirSync(join(resolvedInstalled, 'commands'), { withFileTypes: true }).map((entry) => {
    assertion(entry.isSymbolicLink() === false && entry.isFile() && entry.name.endsWith('.md'), 'Installed baseline command is invalid')
    return entry.name.slice(0, -3)
  }).sort(compareOrdinal)
  const skillNames = readdirSync(join(resolvedInstalled, 'skills'), { withFileTypes: true }).map((entry) => {
    assertion(entry.isSymbolicLink() === false && entry.isDirectory(), 'Installed baseline skill is invalid')
    return entry.name
  }).sort(compareOrdinal)
  assertion(commandNames.join(',') === baseline.commandNames.join(',') && skillNames.join(',') === baseline.skillNames.join(','), 'Installed baseline topology differs from fixture')

  return resolvedInstalled
}

function parseClaudeDetails(stdout) {
  const matches = stdout.split(/\r?\n/).filter((line) => /^  Skills \(\d+\)  /.test(line))
  assertion(matches.length === 1, 'Claude details must contain one Skills inventory line')
  const [, countText, namesText] = /^  Skills \((\d+)\)  (.+)$/.exec(matches[0]) || []
  assertion(countText !== undefined && namesText !== undefined, 'Claude details Skills inventory is malformed')
  const names = namesText.split(', ').filter(Boolean)
  assertion(names.length === Number(countText), 'Claude details Skills count differs from inventory')
  assertion(names.every((name) => /^[a-z][a-z0-9-]*$/.test(name)), 'Claude details Skills inventory contains an invalid name')
  assertion(new Set(names).size === names.length, 'Claude details Skills inventory must be unique')

  return [...names].sort(compareOrdinal)
}

function assertClaudeInventory(stdout, expected, message = 'Claude details inventory differs') {
  const observed = parseClaudeDetails(stdout)
  assertion(observed.join(',') === [...expected].sort(compareOrdinal).join(','), message)

  return observed
}

function parseClaudeInstalledRoot(stdout) {
  const rows = JSON.parse(stdout)
  assertion(Array.isArray(rows), 'Claude plugin list must be an array')
  const matches = rows.filter((row) => row && row.id === 'nightshift@astenlund')
  assertion(matches.length === 1 && matches[0].enabled === true && typeof matches[0].installPath === 'string' && matches[0].installPath !== '', 'Claude candidate is not enabled')

  return matches[0].installPath
}

function parseCodexInstalledRoot(stdout) {
  const catalog = parseJsonOutput(stdout, 'Codex plugin list')
  assertion(Array.isArray(catalog.installed), 'Codex plugin list has no installed array')
  const matches = catalog.installed.filter((row) => row && row.pluginId === 'nightshift@astenlund')
  assertion(matches.length === 1 && matches[0].installed === true && matches[0].enabled === true && matches[0].source && matches[0].source.source === 'local' && typeof matches[0].source.path === 'string', 'Codex candidate is not enabled')

  return matches[0].source.path
}

function loadCandidateEngineResources(candidateRoot) {
  const contractPath = join(candidateRoot, 'tests', 'entry-contract.js')
  let contract
  try {
    const metadata = lstatSync(contractPath)
    assertion(metadata.isSymbolicLink() === false && metadata.isFile(), 'Candidate entry contract is unavailable')
    assertion(isContained(realpathSync(candidateRoot), realpathSync(contractPath)), 'Candidate entry contract is unavailable')
    delete require.cache[require.resolve(contractPath)]
    contract = require(contractPath)
  } catch {
    throw new Error('Candidate entry contract is unavailable')
  }
  const resources = contract && contract.REVISE_ENGINE_RESOURCES
  assertion(resources !== null && typeof resources === 'object' && !Array.isArray(resources), 'Candidate entry contract is malformed')
  assertion(Object.keys(resources).sort(compareOrdinal).join(',') === ENGINE_RESOURCE_KEYS.join(','), 'Candidate entry contract is malformed')
  const normalized = {}
  for (const resourceName of ENGINE_RESOURCE_KEYS) {
    const fileName = resources[resourceName]
    assertion(typeof fileName === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(fileName), 'Candidate entry contract is malformed')
    normalized[resourceName] = fileName
  }

  return Object.freeze(normalized)
}

function assertEngineResource(engineRoot, fileName) {
  assertion(typeof fileName === 'string' && fileName !== '', 'Installed engine resource name is invalid')
  const resource = join(engineRoot, fileName)
  let metadata
  let resolvedEngineRoot
  let resolvedResource
  try {
    metadata = lstatSync(resource)
    resolvedEngineRoot = realpathSync(engineRoot)
    resolvedResource = realpathSync(resource)
  } catch {
    throw new Error('Installed engine resource is unavailable')
  }
  assertion(metadata.isSymbolicLink() === false && metadata.isFile() && isContained(resolvedEngineRoot, resolvedResource), 'Installed engine resource is unavailable')
}

function assertEngineClosure(installedRoot, resources) {
  const engineRoot = join(installedRoot, 'internal', 'revise')
  const engine = readFileSync(join(engineRoot, 'SKILL.md'), 'utf8')
  for (const artifactType of ['code', 'plan', 'spec']) {
    const fileName = resources[artifactType]
    assertion(typeof fileName === 'string' && fileName !== '', 'Installed engine resource name is invalid')
    assertion(engine.includes('- `' + artifactType + '` -> `' + fileName + '`'), 'Installed engine mapping is stale')
  }
  assertion(typeof resources.workflow === 'string' && resources.workflow !== '', 'Installed engine resource name is invalid')
  assertion(engine.includes('${CLAUDE_PLUGIN_ROOT}/internal/revise/' + resources.workflow), 'Installed engine Workflow reference is stale')
  for (const fileName of Object.values(resources)) {
    assertEngineResource(engineRoot, fileName)
  }

  return engineRoot
}

function assertInstalledRegularFile(rootPath, relativePath, label) {
  const target = join(rootPath, ...relativePath.split('/'))
  let metadata
  let resolvedRoot
  let resolvedTarget
  try {
    metadata = lstatSync(target)
    resolvedRoot = realpathSync(rootPath)
    resolvedTarget = realpathSync(target)
  } catch {
    throw new Error(label + ' is unavailable: ' + relativePath)
  }
  assertion(metadata.isSymbolicLink() === false && metadata.isFile() && isContained(resolvedRoot, resolvedTarget), label + ' is unavailable: ' + relativePath)
}

function assertInitBacklogClosure(installedRoot) {
  const skillRoot = join(installedRoot, 'skills', 'init-backlog')
  for (const fileName of ['SKILL.md', 'init-backlog.js']) {
    assertInstalledRegularFile(installedRoot, 'skills/init-backlog/' + fileName, 'Installed init-backlog controller file')
  }
  let manifest
  try {
    manifest = JSON.parse(readFileSync(join(skillRoot, 'templates', 'manifest.json'), 'utf8'))
  } catch {
    throw new Error('Installed template manifest is unavailable')
  }
  assertion(manifest !== null && typeof manifest === 'object' && !Array.isArray(manifest) && Array.isArray(manifest.assets) && manifest.assets.length > 0, 'Installed template manifest is invalid')
  for (const asset of manifest.assets) {
    assertion(asset !== null && typeof asset === 'object' && typeof asset.path === 'string' && /^[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/.test(asset.path), 'Installed template asset path is invalid')
    assertInstalledRegularFile(skillRoot, 'templates/' + asset.path, 'Installed template asset')
  }

  return skillRoot
}

async function verifyInstalled({ host, execute, candidate, tempRoot, row }) {
  const resources = loadCandidateEngineResources(candidate.root)
  if (host === 'claude') {
    const list = await execute('claude', ['plugin', 'list', '--json'])
    const details = await execute('claude', ['plugin', 'details', 'nightshift@astenlund'])
    const installedRoot = assertInstalledCandidate(candidate.root, parseClaudeInstalledRoot(list.stdout), tempRoot, candidate.version)
    assertEngineClosure(installedRoot, resources)
    assertInitBacklogClosure(installedRoot)
    const observed = assertClaudeInventory(details.stdout, PUBLIC_SKILLS, 'Claude public discovery differs from candidate')
    row.publicSkills = observed.map((name) => 'nightshift:' + name)
    row.legacyCommands = []
    row.legacySkillPresent = false

    return installedRoot
  }
  const list = await execute('codex', ['plugin', 'list', '--json'])
  const installedRoot = assertInstalledCandidate(candidate.root, parseCodexInstalledRoot(list.stdout), tempRoot, candidate.version)
  assertEngineClosure(installedRoot, resources)
  assertInitBacklogClosure(installedRoot)
  const catalog = await execute('codex', buildCodexArgv({ prompt: CODEX_CATALOG_PROMPT, schemaPath: join(candidate.root, 'tests', 'fixtures', 'codex-skill-catalog.schema.json') }))
  const observed = parseJsonOutput(catalog.stdout, 'Codex skill catalog').skills
  assertion(Array.isArray(observed) && observed.every((name) => typeof name === 'string') && new Set(observed).size === observed.length && [...observed].sort(compareOrdinal).join(',') === observed.join(',') && observed.join(',') === expectedPublicSkillNames().join(','), 'Codex public discovery differs from candidate')
  row.publicSkills = observed
  row.legacyCommands = []
  row.legacySkillPresent = false

  return installedRoot
}

async function verifyBaseline({ host, execute, baseline, candidate, tempRoot }) {
  if (host === 'claude') {
    const list = await execute('claude', ['plugin', 'list', '--json'])
    const details = await execute('claude', ['plugin', 'details', 'nightshift@astenlund'])
    const installedRoot = assertInstalledBaseline(baseline, parseClaudeInstalledRoot(list.stdout), tempRoot)
    const expected = [...baseline.skillNames, ...baseline.commandNames].sort(compareOrdinal)
    const observed = assertClaudeInventory(details.stdout, expected, 'Claude baseline discovery differs from fixture')
    const legacyCommands = observed.filter((name) => baseline.commandNames.includes(name))
    assertion(legacyCommands.join(',') === baseline.commandNames.join(','), 'Claude baseline legacy command inventory differs from fixture')

    return installedRoot
  }
  const list = await execute('codex', ['plugin', 'list', '--json'])
  const installedRoot = assertInstalledBaseline(baseline, parseCodexInstalledRoot(list.stdout), tempRoot)
  const catalog = await execute('codex', buildCodexArgv({ prompt: CODEX_CATALOG_PROMPT, schemaPath: join(candidate.root, 'tests', 'fixtures', 'codex-skill-catalog.schema.json') }))
  const observed = parseJsonOutput(catalog.stdout, 'Codex skill catalog').skills
  const expected = ['nightshift:exploring', 'nightshift:ready', 'nightshift:revise']
  assertion(Array.isArray(observed) && observed.length === new Set(observed).size && observed.every((name) => typeof name === 'string') && observed.join(',') === expected.join(','), 'Codex baseline discovery differs from fixture')

  return installedRoot
}

async function runCell({ host, mode, checkoutRoot, evidenceRoot }) {
  const row = emptyRow(host, mode)
  const tempRoot = mkdtempSync(join(tmpdir(), 'nightshift-host-smoke-'))
  try {
    assertion(['claude', 'codex'].includes(host) && ['clean', 'repeat'].includes(mode), 'Unsupported host cell')
    const sequence = createCellSequence(host, mode)
    const repeat = sequence.includes('verify-baseline')
    const treeId = git(checkoutRoot, ['write-tree']).trim()
    const candidate = stageCandidate({ checkoutRoot, destinationRoot: tempRoot, treeId })
    const baseline = repeat ? loadLegacyBaseline(candidate.root) : null
    row.candidateVersion = candidate.version
    row.candidateDigest = candidate.digest
    const workspace = join(tempRoot, 'workspace')
    mkdirSync(workspace)
    const marketplace = join(tempRoot, 'marketplace')
    createMarketplace({ marketplaceRoot: marketplace, snapshotRoot: baseline === null ? candidate.root : baseline.root })
    const parentEnv = process.env
    const homeDir = parentEnv.USERPROFILE || parentEnv.HOME
    assertion(typeof homeDir === 'string' && homeDir !== '', 'Home directory is unavailable')
    const environment = projectRuntimeEnvironment(parentEnv)
    const execute = (command, args, stdin) => runChild(command, args, { cwd: workspace, env: environment, stdin })
    if (host === 'claude') {
      const profile = join(tempRoot, 'profile')
      copyCredential({ checkoutRoot, sourceRoot: resolveExternalClaudeConfigRoot(parentEnv, homeDir), sourceName: '.credentials.json', profileRoot: profile })
      environment.CLAUDE_CONFIG_DIR = profile
      await execute('claude', ['auth', 'status', '--json']).then((output) => parseClaudeAuthStatus(output.stdout))
      await execute('claude', ['plugin', 'marketplace', 'add', '--scope', 'user', marketplace])
      let installedRoot = null
      const install = async () => execute('claude', ['plugin', 'install', '--scope', 'user', 'nightshift@astenlund'])
      const update = async () => {
        await execute('claude', ['plugin', 'marketplace', 'update', 'astenlund'])
        await execute('claude', ['plugin', 'update', '--scope', 'user', 'nightshift@astenlund'])
      }
      await executeCellSequence(sequence, {
        'install-baseline': install,
        'install-candidate': install,
        'verify-baseline': async () => verifyBaseline({ host, execute, baseline, candidate, tempRoot }),
        'replace-candidate': async () => {
          rmSync(join(marketplace, 'plugin'), { force: true, recursive: true })
          cpSync(candidate.root, join(marketplace, 'plugin'), { recursive: true })
        },
        'update-candidate': update,
        'verify-candidate': async () => {
          installedRoot = await verifyInstalled({ host, execute, candidate, tempRoot, row })
        },
      })
    } else {
      const profile = join(tempRoot, 'profile')
      const accessToken = typeof parentEnv.CODEX_ACCESS_TOKEN === 'string' && parentEnv.CODEX_ACCESS_TOKEN !== '' ? parentEnv.CODEX_ACCESS_TOKEN : null
      const apiKey = typeof parentEnv.OPENAI_API_KEY === 'string' && parentEnv.OPENAI_API_KEY !== '' ? parentEnv.OPENAI_API_KEY : null
      assertion(!(accessToken && apiKey), 'Codex authentication is ambiguous')
      environment.CODEX_HOME = profile
      if (accessToken || apiKey) {
        await execute('codex', ['login', accessToken ? '--with-access-token' : '--with-api-key'], (accessToken || apiKey) + '\n')
      } else {
        copyCredential({ checkoutRoot, sourceRoot: resolveExternalCodexHome(parentEnv, homeDir), sourceName: 'auth.json', profileRoot: profile })
      }
      const auth = await execute('codex', ['login', 'status'])
      parseCodexAuthStatus(auth.stdout, auth.stderr)
      const install = async () => {
        await execute('codex', ['plugin', 'marketplace', 'add', marketplace, '--json'])
        await execute('codex', ['plugin', 'add', 'nightshift@astenlund', '--json'])
      }
      const remove = async () => {
        await execute('codex', ['plugin', 'remove', 'nightshift@astenlund', '--json'])
        await execute('codex', ['plugin', 'marketplace', 'remove', 'astenlund', '--json'])
      }
      let installedRoot = null
      await executeCellSequence(sequence, {
        'install-baseline': install,
        'install-candidate': install,
        'verify-baseline': async () => verifyBaseline({ host, execute, baseline, candidate, tempRoot }),
        'remove-baseline': remove,
        'remove-candidate': remove,
        'replace-candidate': async () => {
          rmSync(join(marketplace, 'plugin'), { force: true, recursive: true })
          cpSync(candidate.root, join(marketplace, 'plugin'), { recursive: true })
        },
        'verify-candidate': async () => {
          installedRoot = await verifyInstalled({ host, execute, candidate, tempRoot, row })
        },
      })
    }
    row.status = 'pass'
    row.diagnostic = null
  } catch (error) {
    if (isMissingExecutable(error)) {
      row.status = 'provisional'
      row.diagnostic = 'host executable absent'
    } else {
      row.status = 'fail'
      row.diagnostic = boundedDiagnostic(error)
    }
  } finally {
    try {
      rmSync(tempRoot, { force: true, recursive: true })
    } catch {
      row.status = 'fail'
      row.diagnostic = 'generated temporary root cleanup failed'
    }
    writeEvidence({ checkoutRoot, evidenceRoot, row })
  }

  return row
}

module.exports = { CODEX_CATALOG_PROMPT, PUBLIC_SKILLS, RUNTIME_KEYS, assembleClaudePromptBaseline, assembleCodexPromptBaseline, assertClaudeInventory, assertEngineClosure, assertInitBacklogClosure, assertOutsideCheckout, buildCodexArgv, classifyChildExit, createCellSequence, createMarketplace, evaluateEvidence, executeCellSequence, loadCandidateEngineResources, loadLegacyBaseline, loadPromptBaseline, parseClaudeAuthStatus, parseClaudeDetails, parseCodexAuthStatus, projectRuntimeEnvironment, resolveExternalClaudeConfigRoot, runCell, stageCandidate, validateEvidenceRow, writeEvidence }
