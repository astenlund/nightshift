'use strict'

const { spawnSync } = require('node:child_process')
const { isAbsolute, win32 } = require('node:path')

const FORBIDDEN_REPOSITORY_OVERRIDES = new Set(['GIT_COMMON_DIR', 'GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE'])
const TRUSTED_GIT_ENVIRONMENT_KEYS = new Set([
  'GIT_ATTR_NOSYSTEM',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_KEY_0',
  'GIT_CONFIG_NOSYSTEM',
  'GIT_CONFIG_SYSTEM',
  'GIT_CONFIG_VALUE_0',
  'GIT_NO_REPLACE_OBJECTS',
  'GIT_TEMPLATE_DIR',
])

function buffers(value) {
  return Buffer.isBuffer(value) ? value : Buffer.from(value ?? '', 'utf8')
}

function gitEnvironmentKey(key, platform) {
  return platform === 'win32' ? key.toUpperCase() : key
}

function validateTrustedGitEnvironment(environment) {
  if (environment === null || typeof environment !== 'object' || Array.isArray(environment)) throw new Error('Trusted Git environment must be an object')
  const keys = Object.keys(environment)
  for (const key of keys) {
    if (!TRUSTED_GIT_ENVIRONMENT_KEYS.has(key) || typeof environment[key] !== 'string') throw new Error('Trusted Git environment variable is not allowed')
  }
  const indexedKeys = keys.filter((key) => /^GIT_CONFIG_(?:KEY|VALUE)_[0-9]+$/.test(key))
  const count = environment.GIT_CONFIG_COUNT
  if (count === undefined && indexedKeys.length !== 0
    || count === '0' && indexedKeys.length !== 0
    || count === '1' && (indexedKeys.length !== 2 || typeof environment.GIT_CONFIG_KEY_0 !== 'string' || typeof environment.GIT_CONFIG_VALUE_0 !== 'string')
    || count !== undefined && count !== '0' && count !== '1') {
    throw new Error('Trusted Git configuration environment is invalid')
  }
}

function buildGitEnvironment(ambient, trusted, platform) {
  const ambientKeys = Object.keys(ambient)
  if (ambientKeys.some((key) => FORBIDDEN_REPOSITORY_OVERRIDES.has(gitEnvironmentKey(key, platform)))) throw new Error('Ambient Git repository override is not allowed')
  validateTrustedGitEnvironment(trusted)
  const environment = Object.fromEntries(Object.entries(ambient).filter(([key]) => !gitEnvironmentKey(key, platform).startsWith('GIT_')))

  return { ...environment, ...trusted, GIT_OPTIONAL_LOCKS: '0', GIT_PAGER: 'cat', GIT_TERMINAL_PROMPT: '0' }
}

function runGit(root, args, options = {}) {
  const executable = options.trustedGitPath ?? 'git'
  const spawn = options.spawnSync ?? spawnSync
  const ambient = options.env ?? process.env
  const trustedGitEnvironment = options.trustedGitEnvironment ?? {}
  const platform = options.platform ?? process.platform
  const isAbsoluteExecutable = platform === 'win32' ? win32.isAbsolute : isAbsolute
  if (!isAbsoluteExecutable(executable)) throw new Error('Trusted Git executable must be absolute')
  const env = buildGitEnvironment(ambient, trustedGitEnvironment, platform)
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

module.exports = { runGit }
