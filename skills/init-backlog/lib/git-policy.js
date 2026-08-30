'use strict'

const { spawnSync } = require('node:child_process')
const { TextDecoder } = require('node:util')
const { existsSync, lstatSync, realpathSync } = require('node:fs')
const { isAbsolute, join, relative, resolve, win32 } = require('node:path')

const { DIGEST_PATTERN, compareOrdinal, sameKeys } = require('./protocol')
const { resolveTrustedExecutable } = require('./filesystem')

const GIT_CANDIDATES = ['HEAD', 'objects', 'refs']
const GIT_ATTRIBUTE_NAMES = ['text', 'eol', 'filter', 'ident', 'working-tree-encoding']
const CONFIG_KEYS = ['core.autocrlf', 'core.eol', 'core.excludesFile']
const [AUTOCRLF_CONFIG_KEY, EOL_CONFIG_KEY, EXCLUDES_FILE_CONFIG_KEY] = CONFIG_KEYS
const PLANS_ROOT_RULE_EFFECTIVE = Symbol('plansRootRuleEffective')

function buffers(value) {
  return Buffer.isBuffer(value) ? value : Buffer.from(value ?? '', 'utf8')
}

function validateCheckAttrRecords(records, paths, attributes) {
  if (!Array.isArray(records) || !Array.isArray(paths) || !Array.isArray(attributes) || records.length !== paths.length * attributes.length) {
    throw new Error('Git check-attr cardinality is invalid')
  }
  const canonicalAttributes = GIT_ATTRIBUTE_NAMES
  if (paths.some((path, index) => typeof path !== 'string' || index > 0 && compareOrdinal(paths[index - 1], path) >= 0) || attributes.some((attribute, index) => typeof attribute !== 'string' || attributes.indexOf(attribute) !== index || attribute !== canonicalAttributes[index])) {
    throw new Error('Git check-attr ordering is invalid')
  }
  const expected = []
  for (const path of paths) for (const attribute of attributes) expected.push({ attribute, path })
  records.forEach((record, index) => {
    const values = {
      eol: new Set(['crlf', 'lf', 'unspecified']),
      filter: new Set(['unset', 'unspecified']),
      ident: new Set(['unset', 'unspecified']),
      text: new Set(['auto', 'set', 'unset', 'unspecified']),
      'working-tree-encoding': new Set(['unset', 'unspecified']),
    }
    if (!sameKeys(record, ['attribute', 'path', 'value']) || record.path !== expected[index].path || record.attribute !== expected[index].attribute || typeof record.value !== 'string' || !values[record.attribute]?.has(record.value)) {
      throw new Error('Git check-attr record is invalid')
    }
  })

  const valuesByPath = new Map()
  for (const record of records) {
    const byAttribute = valuesByPath.get(record.path) ?? new Map()
    byAttribute.set(record.attribute, record.value)
    valuesByPath.set(record.path, byAttribute)
  }
  for (const values of valuesByPath.values()) {
    if (values.get('text') === 'unset' && values.get('eol') !== undefined && values.get('eol') !== 'unspecified') {
      throw new Error('Git check-attr text unset conflicts with eol')
    }
    if (['filter', 'ident', 'working-tree-encoding'].some((attribute) => values.get(attribute) !== undefined && values.get(attribute) !== 'unset' && values.get(attribute) !== 'unspecified')) {
      throw new Error('Git check-attr has an active transform')
    }
  }

  return records
}

function classifyCheckAttrProcess(result, paths, attributes) {
  const stdout = buffers(result?.stdout)
  const stderr = buffers(result?.stderr)
  if (result?.error || result?.signal !== undefined && result?.signal !== null || result?.status !== 0 || stderr.length !== 0 || stdout.length === 0 || stdout[stdout.length - 1] !== 0) {
    throw new Error('Git check-attr process failed')
  }
  let fields
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(stdout)
    fields = text.split('\0')
  } catch (error) {
    throw new Error('Git check-attr output is invalid', { cause: error })
  }
  if (fields.at(-1) !== '' || fields.length !== paths.length * attributes.length * 3 + 1) throw new Error('Git check-attr output cardinality is invalid')
  const records = []
  for (let index = 0; index < fields.length - 1; index += 3) records.push({ attribute: fields[index + 1], path: fields[index], value: fields[index + 2] })

  return validateCheckAttrRecords(records, paths, attributes)
}

function pathIdentity(left, right, platform = process.platform) {
  if (platform === 'win32') {
    return left.toLowerCase() === right.toLowerCase()
  }

  return left === right
}

function classifyGitKind(candidates) {
  if (!Array.isArray(candidates) || candidates.some((candidate) => candidate === null || typeof candidate !== 'object' || typeof candidate.name !== 'string')) {
    throw new Error('Git candidate set is invalid')
  }
  const present = candidates.filter((candidate) => candidate.present === true || candidate.exists === true || candidate.present === undefined && candidate.exists === undefined)
  if (present.length === 0) {
    return { kind: 'non-git', present: [] }
  }
  if (present.some((candidate) => candidate.kind !== undefined && candidate.kind !== 'file' && candidate.kind !== 'directory')) {
    throw new Error('Git candidate is not an ordinary object')
  }
  if (present.some((candidate) => candidate.accessible === false || candidate.link === true || candidate.special === true || candidate.indeterminate === true)) {
    throw new Error('Git candidate cannot be trusted')
  }

  return { kind: 'git', present: present.map((candidate) => candidate.name).sort(compareOrdinal) }
}

function gitCandidate(name, path, metadata) {
  return { kind: metadata.isFile() ? 'file' : metadata.isDirectory() ? 'directory' : 'special', link: metadata.isSymbolicLink(), name, path, present: true }
}

function candidateSet(root, options = {}) {
  const stat = options.lstatSync ?? lstatSync
  const markerPath = join(root, '.git')
  let marker
  try {
    marker = gitCandidate('.git', markerPath, stat(markerPath, { bigint: true }))
  } catch (error) {
    if (error?.code === 'ENOENT') return []

    return [{ accessible: false, name: '.git', path: markerPath, present: true }]
  }
  if (marker.link || marker.kind === 'special') return [marker]
  if (marker.kind === 'file') return [marker]

  return GIT_CANDIDATES.map((name) => {
    const path = join(root, '.git', name)
    try {
      return gitCandidate(name, path, stat(path, { bigint: true }))
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return { kind: null, name, path, present: false }
      }

      return { accessible: false, name, path, present: true }
    }
  })
}

function detectGitKind(root, options = {}) {
  return classifyGitKind(options.candidates ?? candidateSet(root, options))
}

function windowsHomeCandidates(env, systemDirectory) {
  const result = []
  const windowsResolve = (value) => win32.resolve(value)
  if (typeof env.HOMEDRIVE === 'string' && typeof env.HOMEPATH === 'string' && env.HOMEDRIVE.length > 0 && env.HOMEPATH.length > 0) {
    const home = `${env.HOMEDRIVE}${env.HOMEPATH}`
    if (!pathIdentity(windowsResolve(home), windowsResolve(systemDirectory), 'win32')) {
      result.push(home)
    }
  }
  if (typeof env.USERPROFILE === 'string' && env.USERPROFILE.length > 0) {
    result.push(env.USERPROFILE)
  }

  return result
}

function pushConfiguredIgnoreCandidate(candidates, configured, { isAbsolutePath, resolvePath, root }) {
  if (isAbsolutePath(configured)) candidates.push(configured)
  else if (typeof root === 'string' && isAbsolutePath(root)) candidates.push(resolvePath(root, configured))
  else throw new Error('Configured global ignore path is not absolute')
}

function firstExistingIgnoreCandidate(candidates, { canonicalize, isExisting, platform, resolvePath, systemDirectory }) {
  for (const candidate of candidates) {
    const path = resolvePath(candidate)
    if (systemDirectory && pathIdentity(path, resolvePath(systemDirectory), platform)) {
      continue
    }
    try {
      if (isExisting(path)) {
        return canonicalize(path)
      }
    } catch {
      // An inaccessible candidate is not a winning source.
    }
  }

  return null
}

function resolveGitExcludesFile(options = {}) {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const systemDirectory = options.systemDirectory ?? null
  const configured = options.configuredPath ?? env.GIT_CONFIG_GLOBAL ?? null
  const candidates = []
  const isExisting = options.exists ?? existsSync
  const canonicalize = options.realpath ?? realpathSync.native
  const resolvePath = platform === 'win32' ? win32.resolve : resolve
  const isAbsolutePath = platform === 'win32' ? win32.isAbsolute : isAbsolute
  if (typeof configured === 'string' && configured.length > 0) {
    pushConfiguredIgnoreCandidate(candidates, configured, { isAbsolutePath, resolvePath, root: options.root })
  }
  if (typeof configured !== 'string' || configured.length === 0) {
    if (platform === 'win32' && !env.HOME) {
      candidates.push(...windowsHomeCandidates(env, systemDirectory ?? ''))
    }
    if (typeof env.HOME === 'string' && env.HOME.length > 0) {
      candidates.push(env.HOME)
    }
    if (typeof env.USERPROFILE === 'string' && env.USERPROFILE.length > 0 && platform !== 'win32') {
      candidates.push(env.USERPROFILE)
    }
  }

  return firstExistingIgnoreCandidate(candidates, { canonicalize, isExisting, platform, resolvePath, systemDirectory })
}

function resolveDefaultGlobalIgnoreFile(options = {}) {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const resolvePath = platform === 'win32' ? win32.resolve : resolve
  const exists = options.exists ?? existsSync
  const canonicalize = options.realpath ?? realpathSync.native
  const joinPath = platform === 'win32' ? win32.join : join
  const isAbsolutePath = platform === 'win32' ? win32.isAbsolute : isAbsolute
  const configured = options.configuredPath
  const candidates = []
  if (typeof configured === 'string' && configured.length > 0) {
    pushConfiguredIgnoreCandidate(candidates, configured, { isAbsolutePath, resolvePath, root: options.root })
  } else if (typeof env.XDG_CONFIG_HOME === 'string' && env.XDG_CONFIG_HOME.length > 0) {
    candidates.push(joinPath(env.XDG_CONFIG_HOME, 'git', 'ignore'))
  } else {
    if (platform === 'win32' && typeof env.APPDATA === 'string' && env.APPDATA.length > 0) candidates.push(joinPath(env.APPDATA, 'Git', 'ignore'))
    if (typeof env.HOME === 'string') {
      if (env.HOME.length > 0) candidates.push(joinPath(env.HOME, '.config', 'git', 'ignore'))
    } else if (platform === 'win32') {
      const homes = windowsHomeCandidates(env, options.systemDirectory ?? '')
      for (const home of homes) candidates.push(joinPath(home, '.config', 'git', 'ignore'))
    }
  }

  return firstExistingIgnoreCandidate(candidates, { canonicalize, isExisting: exists, platform, resolvePath, systemDirectory: options.systemDirectory })
}

function runGit(root, args, options = {}) {
  const executable = options.trustedGitPath ?? 'git'
  const spawn = options.spawnSync ?? spawnSync
  const ambient = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const isAbsoluteExecutable = platform === 'win32' ? win32.isAbsolute : isAbsolute
  if (!isAbsoluteExecutable(executable)) throw new Error('Trusted Git executable must be absolute')
  const forbiddenAmbient = new Set(['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE'])
  if (Object.keys(ambient).some((key) => forbiddenAmbient.has(platform === 'win32' ? key.toUpperCase() : key))) {
    throw new Error('Ambient Git repository override is not allowed')
  }
  const env = { ...ambient, GIT_OPTIONAL_LOCKS: '0', GIT_PAGER: 'cat', GIT_TERMINAL_PROMPT: '0' }
  const input = options.input === undefined ? undefined : buffers(options.input)
  if (input !== undefined && input.length > 1048576) throw new Error('Git input exceeds its byte limit')
  const safeArgs = ['-c', 'core.fsmonitor=', ...args]
  const result = spawn(executable, safeArgs, {
    cwd: root,
    encoding: null,
    maxBuffer: 1048576,
    shell: false,
    timeout: options.timeout ?? 30000,
    killSignal: 'SIGKILL',
    windowsHide: true,
    env,
    ...(input === undefined ? {} : { input }),
  })
  if (buffers(result?.stdout).length > 1048576 || buffers(result?.stderr).length > 65536) throw new Error('Git output exceeds its byte limit')

  return result
}

function requireGitCompletion(result, label) {
  if (result === null || typeof result !== 'object' || result.error || result.signal !== undefined && result.signal !== null) {
    throw new Error(`Git ${label} process did not complete`)
  }

  return result
}

function requireGitResult(result, label, allowEmpty = true) {
  requireGitCompletion(result, label)
  const stdout = buffers(result.stdout)
  const stderr = buffers(result.stderr)
  if (result.status !== 0 || stderr.length !== 0 || !allowEmpty && stdout.length === 0) {
    throw new Error(`Git ${label} process failed`)
  }

  return stdout
}

function decodeGitBoolean(result, label) {
  const bytes = requireGitResult(result, label, false)
  let value
  try {
    value = new TextDecoder('ascii', { fatal: true }).decode(bytes)
  } catch (error) {
    throw new Error(`Git ${label} output is not ASCII`, { cause: error })
  }
  if (value.endsWith('\n')) value = value.slice(0, -1)
  if (!['true', 'false'].includes(value)) throw new Error(`Git ${label} output is invalid`)

  return value === 'true'
}

function decodeGitPath(result, label, root) {
  const bytes = requireGitResult(result, label, false)
  let value
  try {
    value = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error) {
    throw new Error(`Git ${label} output is not UTF-8`, { cause: error })
  }
  if (value.endsWith('\n')) value = value.slice(0, -1)
  if (value.length === 0 || value.includes('\n') || value.includes('\0')) throw new Error(`Git ${label} output is invalid`)
  const resolved = realpathSync.native(value)
  if (root !== null && resolved !== root) throw new Error(`Git ${label} does not name the repository root`)

  return value
}

function decodeGitLine(result, label, allowAbsent = false) {
  requireGitCompletion(result, label)
  if (allowAbsent && result.status === 1 && buffers(result.stdout).length === 0 && buffers(result.stderr).length === 0) return null
  const stdout = requireGitResult(result, label, false)
  if (stdout[stdout.length - 1] !== 0x0a) throw new Error(`Git ${label} process failed`)
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(stdout)
  } catch (error) {
    throw new Error(`Git ${label} output is not UTF-8`, { cause: error })
  }
  if (text.slice(0, -1).includes('\n') || text.includes('\0')) throw new Error(`Git ${label} output has invalid records`)

  return text.slice(0, -1)
}

function readGitConfig(root, key, kind, options = {}) {
  const result = runGit(root, ['config', ...(options.configPath === true ? ['--path'] : []), '--get', key], options)
  const value = decodeGitLine(result, key, true)
  if (value === null) return null
  if (kind === 'path') return value

  return normalizeConfigValue(value, kind)
}

function inspectIgnoreProbe(root, probe, options = {}) {
  return inspectIgnoreProbes(root, [{ probe, target: probe }], options)[0]
}

function validateIgnoreProbes(probes) {
  if (!Array.isArray(probes) || probes.some((item) => item === null || typeof item !== 'object' || typeof item.probe !== 'string')) throw new Error('Git ignore probes are invalid')
  for (let index = 1; index < probes.length; index += 1) {
    if (compareOrdinal(probes[index - 1].probe, probes[index].probe) >= 0) throw new Error('Git ignore probes are not ordinally ordered')
  }

  return probes
}

function inspectIgnoreProbes(root, probes, options = {}) {
  const ordered = validateIgnoreProbes(probes)
  if (ordered.length === 0) return []
  const input = Buffer.from(ordered.map((item) => item.probe).join('\0') + '\0', 'utf8')
  const result = runGit(root, ['check-ignore', '-z', '-v', '-n', '--no-index', '--stdin'], { ...options, input })
  const stdout = buffers(result.stdout)
  const stderr = buffers(result.stderr)
  if (result.error || result.signal !== undefined && result.signal !== null || stderr.length !== 0) throw new Error('Git ignore probe did not complete')
  if (result.status === 1 && stdout.length === 0) return ordered.map(() => null)
  if (result.status !== 0 && result.status !== 1 || stdout.length === 0 || stdout[stdout.length - 1] !== 0) throw new Error('Git ignore probe failed')
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(stdout)
  } catch (error) {
    throw new Error('Git ignore probe is not UTF-8', { cause: error })
  }
  const fields = text.split('\0')
  if (fields.at(-1) !== '' || fields.length !== ordered.length * 4 + 1) throw new Error('Git ignore probe record cardinality is invalid')
  const matches = []
  for (let index = 0; index < ordered.length; index += 1) {
    const offset = index * 4
    const [source, line, patternText, pathname] = fields.slice(offset, offset + 4)
    const probe = ordered[index].probe
    if (pathname !== probe) throw new Error('Git ignore probe pathname is invalid')
    if (source === '' && line === '' && patternText === '') {
      matches.push(null)
      continue
    }
    if (source === '' || !/^[1-9][0-9]*$/.test(line) || patternText === '') throw new Error('Git ignore probe match record is invalid')
    const pattern = normalizeIgnorePattern(patternText)
    matches.push({ pattern: pattern.startsWith('!') ? null : pattern, sourcePath: source.replaceAll('\\', '/'), target: ordered[index].target ?? probe })
  }

  return matches
}

function inspectGitPolicy(root, options = {}) {
  const kind = options.kind ?? 'git'
  if (kind !== 'git') {
    const familyStyles = new Map()
    for (const target of options.newlineTargets ?? []) {
      const family = target.family ?? 'default'
      const styles = familyStyles.get(family) ?? []
      styles.push(...(target.siblingStyles ?? []).filter((style) => style === 'lf' || style === 'crlf'))
      familyStyles.set(family, styles)
    }
    const siblingStyles = [...new Set((options.siblingStyles ?? []).filter((style) => style === 'lf' || style === 'crlf'))]
    const platformEol = options.platformEol ?? ((options.platform ?? process.platform) === 'win32' ? 'crlf' : 'lf')
    return normalizeGitPolicy({ kind: 'non-git', plansPolicy: 'not-applicable', electionMarker: 'absent', newlinePolicies: (options.newlineTargets ?? []).map((target) => {
      const familyEvidence = target.siblingStyles ?? familyStyles.get(target.family ?? 'default') ?? siblingStyles

      return resolveNewlinePolicy({ kind: 'non-git', mode: target.mode ?? null, platformEol, siblingStyles: familyEvidence, target: target.target })
    }) })
  }
  const platform = options.platform ?? process.platform
  const trustedGitPath = options.trustedGitPath ?? resolveTrustedExecutable({ basename: platform === 'win32' ? 'git.exe' : 'git', path: options.path, root, platform })
  const gitOptions = { ...options, trustedGitPath }
  const insideWorkTree = decodeGitBoolean(runGit(root, ['rev-parse', '--is-inside-work-tree'], gitOptions), 'work-tree probe')
  const insideGitDir = decodeGitBoolean(runGit(root, ['rev-parse', '--is-inside-git-dir'], gitOptions), 'git-dir probe')
  const bare = decodeGitBoolean(runGit(root, ['rev-parse', '--is-bare-repository'], gitOptions), 'bare probe')
  if (!insideWorkTree || insideGitDir || bare) throw new Error('Git repository classification is unsupported')
  decodeGitPath(runGit(root, ['rev-parse', '--show-toplevel'], gitOptions), 'top-level probe', root)
  const format = decodeGitLine(runGit(root, ['rev-parse', '--show-object-format=storage'], gitOptions), 'object format')
  if (!['sha1', 'sha256'].includes(format)) throw new Error('Git object format is invalid')
  const autocrlf = readGitConfig(root, AUTOCRLF_CONFIG_KEY, 'autocrlf', gitOptions)
  const eol = readGitConfig(root, EOL_CONFIG_KEY, 'eol', gitOptions)
  const excludesFile = readGitConfig(root, EXCLUDES_FILE_CONFIG_KEY, 'path', { ...gitOptions, configPath: true })
  const trackedPlanPaths = parseNulPaths(requireGitResult(runGit(root, ['ls-files', '-z', '--', '.claude/plans'], gitOptions), 'tracked plan paths'))
  const electivePaths = ['.claude/QUICK_WINS.md', '.claude/FEATURES.md', '.claude/BUGS.md', '.claude/PATTERNS.md', '.claude/QUICK_WINS_HISTORY.md', '.claude/FEATURES_HISTORY.md', '.claude/BUGS_HISTORY.md', '.claude/features/', '.claude/bugs/', '.claude/patterns/']
  const trackedBacklogPaths = parseNulPaths(requireGitResult(runGit(root, ['ls-files', '-z', '--', ...electivePaths], gitOptions), 'tracked backlog paths'))
  if (trackedPlanPaths.some((item) => item !== '.claude/plans' && !item.startsWith('.claude/plans/')) || trackedBacklogPaths.some((item) => !electivePaths.includes(item) && !electivePaths.some((prefix) => prefix.endsWith('/') && item.startsWith(prefix)))) throw new Error('Git tracked path is outside its policy domain')
  const attributePaths = [...(options.attributePaths ?? [])].sort(compareOrdinal)
  const attributes = GIT_ATTRIBUTE_NAMES
  let checkAttr = []
  if (attributePaths.length > 0) {
    checkAttr = classifyCheckAttrProcess(runGit(root, ['check-attr', '-z', ...attributes, '--', ...attributePaths], gitOptions), attributePaths, attributes)
  }
  const privateExclude = options.privateExcludePath ?? decodeGitPath(runGit(root, ['rev-parse', '--path-format=absolute', '--git-path', 'info/exclude'], gitOptions), 'private exclude path', null)
  const configuredGlobalPath = options.configuredGlobalPath ?? excludesFile
  const globalExclude = options.globalExcludePath ?? resolveDefaultGlobalIgnoreFile({ ...options, configuredPath: configuredGlobalPath, platform: options.platform, root, systemDirectory: options.systemDirectory })
  const canonicalPrivateExclude = privateExclude === null ? null : resolveSourceIdentity(root, privateExclude, options.platform)
  const canonicalize = options.realpath ?? realpathSync.native
  const canonicalGlobalExclude = globalExclude === null ? null : canonicalize(globalExclude)
  const rootGitignore = resolve(root, '.gitignore')
  const canonicalRootGitignore = (() => {
    try {
      return canonicalize(rootGitignore)
    } catch {
      return rootGitignore
    }
  })()
  if (configuredGlobalPath !== null && configuredGlobalPath !== undefined && canonicalGlobalExclude !== null && pathIdentity(canonicalGlobalExclude, canonicalRootGitignore, platform)) {
    throw new Error('Configured global ignore identity aliases repository .gitignore')
  }
  const classifySource = (match) => {
    if (match === null) return null
    const source = canonicalize(resolve(root, match.sourcePath))
    const isDiagnostic = canonicalPrivateExclude !== null && pathIdentity(source, canonicalPrivateExclude, options.platform) || canonicalGlobalExclude !== null && pathIdentity(source, canonicalGlobalExclude, options.platform)
    if (isDiagnostic) return { ...match, diagnostic: true }
    const isLocal = pathIdentity(source, canonicalRootGitignore, options.platform)
    const relativeSource = relative(resolve(root), source).replaceAll('\\', '/')
    if (!isLocal && (relativeSource === '' || relativeSource.startsWith('../') || relativeSource.includes('/../') || !relativeSource.endsWith('.gitignore'))) throw new Error('Git ignore source is not classifiable')
    if (!isLocal) {
      const metadata = lstatSync(source, { bigint: true })
      if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('Git ignore source is not a confined ordinary file')
    }

    return { ...match, sourcePath: relativeSource, diagnostic: false }
  }
  const ignoreMatches = []
  const nonPlanUnignoredPaths = []
  let planMatch = null
  let nestedConflict = false
  const declaredProbes = options.ignoreProbes ?? []
  const regularProbes = declaredProbes.filter((item) => item?.gate !== true)
  const gateProbes = declaredProbes.filter((item) => item?.gate === true)
  validateIgnoreProbes(regularProbes)
  validateIgnoreProbes(gateProbes)
  const collectionProbes = [...new Map(declaredProbes.map((item) => [item.probe, item])).values()].sort((left, right) => compareOrdinal(left.probe, right.probe))
  const collectionResults = inspectIgnoreProbes(root, collectionProbes, gitOptions)
  const resultsByProbe = new Map(collectionProbes.map((item, index) => [item.probe, collectionResults[index]]))
  const resultFor = (item) => {
    const result = resultsByProbe.get(item.probe)

    return result === null ? null : { ...result, target: item.target }
  }
  for (const item of regularProbes) {
    if (typeof item !== 'object' || typeof item.probe !== 'string' || typeof item.target !== 'string') throw new Error('Git ignore probe declaration is invalid')
    const match = classifySource(resultFor(item))
    if (match !== null) {
      if (match.diagnostic) {
        if (item.plan) {
          planMatch = null
        } else {
          nonPlanUnignoredPaths.push(item.target)
        }
        continue
      }
      if (match.sourcePath !== '.gitignore' && item.plan) nestedConflict = true
    }
    if (item.plan) {
      planMatch = match
    } else if (match === null || match.pattern === null) {
      nonPlanUnignoredPaths.push(item.target)
    } else {
      ignoreMatches.push({ pattern: match.pattern, probe: item.probe, sourcePath: match.sourcePath, target: item.target })
    }
  }
  for (const item of gateProbes) {
    if (typeof item !== 'object' || typeof item.probe !== 'string' || typeof item.target !== 'string') throw new Error('Git ignore gate declaration is invalid')
    const match = classifySource(resultFor(item))
    if (match !== null && !match.diagnostic && match.sourcePath !== '.gitignore' && match.pattern !== null) nestedConflict = true
  }
  const rootRuleEffective = options.rootRuleEffective === true || planMatch?.sourcePath === '.gitignore' && planMatch.pattern !== null
  nestedConflict = options.nestedConflict === true || nestedConflict || planMatch !== null && planMatch.pattern !== null && planMatch.sourcePath !== '.gitignore'
  const plansPolicy = classifyPlansPolicy({ git: true, rootRuleEffective, nestedConflict, trackedPlanPaths })
  const attrsByPath = new Map()
  for (const record of checkAttr) {
    const values = attrsByPath.get(record.path) ?? {}
    values[record.attribute] = record.value
    attrsByPath.set(record.path, values)
  }
  const platformEol = options.platformEol ?? (platform === 'win32' ? 'crlf' : 'lf')
  const newlinePolicies = (options.newlineTargets ?? []).map((target) => resolveNewlinePolicy({ ...attrsByPath.get(target.target), autocrlf, eol, kind: 'git', mode: target.mode ?? null, platformEol, target: target.target }))
  const policy = normalizeGitPolicy({ kind: 'git', objectFormat: format, trackedPlanPaths, trackedBacklogPaths, nonPlanIgnoreMatches: ignoreMatches, nonPlanUnignoredPaths, newlinePolicies, electionMarker: options.electionMarker ?? 'absent', electionMarkerMode: options.electionMarkerMode ?? null, electionMarkerSnapshotId: options.electionMarkerSnapshotId ?? null, freshScaffold: options.freshScaffold === true, electionRequired: options.electionMarker && options.electionMarker !== 'absent' || options.freshScaffold === true, plansPolicy })
  Object.defineProperty(policy, PLANS_ROOT_RULE_EFFECTIVE, { value: rootRuleEffective })
  return policy
}

function parseNulPaths(bytes, options = {}) {
  const input = buffers(bytes)
  if (input.length === 0) {
    return []
  }
  if (input[input.length - 1] !== 0) {
    throw new Error('Git path transport is not NUL terminated')
  }
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(input.subarray(0, -1))
  } catch (error) {
    throw new Error('Git path transport is not valid UTF-8', { cause: error })
  }
  const paths = text.split('\0')
  if (paths.some((item) => item.length === 0) || new Set(paths).size !== paths.length) throw new Error('Git path transport contains an empty or duplicate record')

  for (const path of paths) {
    if (path.includes('\\') || path.startsWith('/') || /^[A-Za-z]:\//.test(path) || path.split('/').some((part) => part === '' || part === '.' || part === '..')) throw new Error('Git path transport domain is invalid')
  }
  if (options.domain !== undefined && (typeof options.domain !== 'string' || options.domain.length === 0 || paths.some((path) => path !== options.domain && !path.startsWith(`${options.domain}/`)))) throw new Error('Git path transport is outside its domain')
  if (Array.isArray(options.expectedPaths) && (paths.length !== options.expectedPaths.length || paths.some((path, index) => path !== options.expectedPaths[index]))) throw new Error('Git path transport order is invalid')
  for (let index = 1; index < paths.length; index += 1) {
    if (compareOrdinal(paths[index - 1], paths[index]) >= 0) throw new Error('Git path transport ordering is invalid')
  }

  return paths
}

function resolveSourceIdentity(root, sourcePath, platform = process.platform) {
  if (typeof sourcePath !== 'string' || sourcePath.length === 0) throw new Error('Git ignore source is invalid')
  const candidate = resolve(root, sourcePath)
  const canonical = realpathSync.native(candidate)
  if (!pathIdentity(canonical, resolve(root, '.gitignore'), platform)) {
    const metadata = lstatSync(canonical, { bigint: true })
    const relation = relative(resolve(root), canonical)
    if (!metadata.isFile() || metadata.isSymbolicLink() || !pathIdentity(canonical, candidate, platform) || relation.startsWith('..') || resolve(resolve(root), relation) !== canonical) throw new Error('Git ignore source is not a confined ordinary file')
  }

  return canonical
}

function normalizeIgnorePattern(line) {
  const normalized = String(line).replace(/\r?\n$/, '')
  if (Buffer.byteLength(normalized, 'utf8') > 4096 || normalized.trim() === '') {
    throw new Error('Git ignore pattern is invalid')
  }

  return normalized
}

function newlineStyle(bytes) {
  const input = buffers(bytes)
  const text = input.toString('utf8')
  const crlf = text.includes('\r\n')
  const bareLf = text.replaceAll('\r\n', '').includes('\n')
  const bareCr = text.replaceAll('\r\n', '').includes('\r')
  if (bareCr || crlf && bareLf) {
    throw new Error('Mixed or invalid line endings')
  }

  return crlf ? 'crlf' : bareLf ? 'lf' : 'none'
}

function normalizeConfigValue(value, kind) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new Error('Git configuration value is invalid')
  const normalized = value.replace(/^[ \t\r\n\f\v]+|[ \t\r\n\f\v]+$/g, '').toLowerCase()
  if (kind === 'autocrlf') {
    if (['true', 'yes', 'on', '1'].includes(normalized)) return 'true'
    if (['false', 'no', 'off', '0'].includes(normalized)) return 'false'
    if (normalized === 'input') return 'input'
  } else if (kind === 'eol' && ['native', 'lf', 'crlf'].includes(normalized)) {
    return normalized
  }

  throw new Error('Git configuration value is invalid')
}

function resolveNewlinePolicy({ kind = 'non-git', text = 'unspecified', autocrlf = null, eol = null, siblingStyles = [], platformEol = 'lf', mode = null, target }) {
  if (kind === 'git') {
    if (!['lf', 'crlf'].includes(platformEol)) throw new Error('Git platform EOL is invalid')
    const normalizedEol = normalizeConfigValue(eol, 'eol')
    const normalizedAutocrlf = normalizeConfigValue(autocrlf, 'autocrlf')
    const normalizedText = text ?? 'unspecified'
    if (!['auto', 'set', 'unset', 'unspecified'].includes(normalizedText)) throw new Error('Git text attribute is invalid')
    let style
    if (normalizedEol === 'crlf' || normalizedEol === 'lf') {
      style = normalizedEol
    } else if (normalizedText === 'unset' || normalizedText === 'unspecified' && normalizedAutocrlf !== 'true' && normalizedAutocrlf !== 'input') {
      style = 'lf'
    } else if (normalizedAutocrlf === 'true') {
      style = 'crlf'
    } else if (normalizedAutocrlf === 'input') {
      style = 'lf'
    } else {
      style = normalizedText === 'set' || normalizedText === 'auto' ? platformEol : 'lf'
    }

    return { mode, source: 'git', style, target }
  }
  if (!['lf', 'crlf'].includes(platformEol) || siblingStyles.some((style) => !['lf', 'crlf', 'none'].includes(style))) {
    throw new Error('Non-Git newline evidence is invalid')
  }
  const styles = [...new Set(siblingStyles.filter((style) => style === 'lf' || style === 'crlf'))]
  if (styles.length === 1) return { mode, source: 'siblings', style: styles[0], target }
  if (styles.length > 1) return { mode, source: 'choice', style: 'choice-required', target }

  return { mode, source: 'platform', style: platformEol, target }
}

function normalizeGitPolicy(policy = {}) {
  const kind = policy.kind ?? 'non-git'
  const objectFormat = policy.objectFormat ?? null
  const electionMarker = policy.electionMarker ?? 'absent'
  const electionMarkerSnapshotId = policy.electionMarkerSnapshotId ?? null
  const electionMarkerMode = policy.electionMarkerMode ?? null
  const plansPolicy = policy.plansPolicy ?? (kind === 'git' ? 'action-required' : 'not-applicable')
  if (!['git', 'non-git'].includes(kind) || kind === 'git' && !['sha1', 'sha256'].includes(objectFormat) || kind === 'non-git' && objectFormat !== null || !['satisfied', 'action-required', 'tracked-conflict', 'nested-conflict', 'not-applicable'].includes(plansPolicy) || kind === 'non-git' && plansPolicy !== 'not-applicable' || !['absent', 'deferred', 'track', 'ignore'].includes(electionMarker) || electionMarker === 'absent' && electionMarkerSnapshotId !== null || electionMarker !== 'absent' && (typeof electionMarkerSnapshotId !== 'string' || !DIGEST_PATTERN.test(electionMarkerSnapshotId)) || electionMarkerMode !== null && (!Number.isSafeInteger(electionMarkerMode) || electionMarkerMode < 0 || electionMarkerMode > 4095)) {
    throw new Error('Git policy fields are invalid')
  }
  const newlinePolicies = [...(policy.newlinePolicies ?? [])].map((item) => {
    if (!sameKeys(item, ['mode', 'source', 'style', 'target']) || typeof item.target !== 'string' || !['git', 'siblings', 'platform', 'choice'].includes(item.source) || !['lf', 'crlf', 'choice-required'].includes(item.style) || item.mode !== null && (!Number.isSafeInteger(item.mode) || item.mode < 0 || item.mode > 4095)) {
      throw new Error('Git newline policy fields are invalid')
    }

    return { mode: item.mode, source: item.source, style: item.style, target: item.target }
  })
  return {
    kind,
    objectFormat,
    freshScaffold: policy.freshScaffold === true,
    plansPolicy,
    trackedPlanPaths: [...(policy.trackedPlanPaths ?? [])].sort(compareOrdinal),
    trackedBacklogPaths: [...(policy.trackedBacklogPaths ?? [])].sort(compareOrdinal),
    nonPlanIgnoreMatches: [...(policy.nonPlanIgnoreMatches ?? [])].sort((a, b) => compareOrdinal(`${a.target}\0${a.probe}`, `${b.target}\0${b.probe}`)),
    nonPlanUnignoredPaths: [...(policy.nonPlanUnignoredPaths ?? [])].sort(compareOrdinal),
    electionRequired: policy.electionRequired === true,
    electionMarker,
    electionMarkerSnapshotId,
    electionMarkerMode,
    newlinePolicies: newlinePolicies.sort((a, b) => compareOrdinal(a.target, b.target)),
  }
}

function classifyPlansPolicy({ git = true, rootRuleEffective = false, nestedConflict = false, trackedPlanPaths = [] } = {}) {
  if (!git) return 'not-applicable'
  if (nestedConflict) return 'nested-conflict'
  if (trackedPlanPaths.length > 0) return 'tracked-conflict'

  return rootRuleEffective ? 'satisfied' : 'action-required'
}

function plansRootRuleEffective(policy) {
  return policy?.[PLANS_ROOT_RULE_EFFECTIVE] === true
}

function normalizeElectionMarker(value) {
  if (value === null || value === undefined) return { marker: 'absent', mode: null, snapshotId: null }
  if (typeof value !== 'object' || !['deferred', 'track', 'ignore'].includes(value.marker) || typeof value.snapshotId !== 'string' || !DIGEST_PATTERN.test(value.snapshotId)) throw new Error('Election marker is invalid')

  return { marker: value.marker, mode: value.mode ?? null, snapshotId: value.snapshotId }
}

module.exports = {
  CONFIG_KEYS,
  GIT_CANDIDATES,
  candidateSet,
  classifyCheckAttrProcess,
  classifyGitKind,
  detectGitKind,
  newlineStyle,
  normalizeGitPolicy,
  normalizeConfigValue,
  plansRootRuleEffective,
  classifyPlansPolicy,
  normalizeIgnorePattern,
  normalizeElectionMarker,
  parseNulPaths,
  pathIdentity,
  resolveNewlinePolicy,
  resolveGitExcludesFile,
  resolveDefaultGlobalIgnoreFile,
  inspectGitPolicy,
  inspectIgnoreProbe,
  inspectIgnoreProbes,
  runGit,
  windowsHomeCandidates,
  validateCheckAttrRecords,
}
