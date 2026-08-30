'use strict'

const { spawnSync } = require('node:child_process')
const { isAbsolute, win32 } = require('node:path')

function buffers(value) {
  return Buffer.isBuffer(value) ? value : Buffer.from(value ?? '', 'utf8')
}

function runGit(root, args, options = {}) {
  const executable = options.trustedGitPath ?? 'git'
  const spawn = options.spawnSync ?? spawnSync
  const ambient = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const isAbsoluteExecutable = platform === 'win32' ? win32.isAbsolute : isAbsolute
  if (!isAbsoluteExecutable(executable)) throw new Error('Trusted Git executable must be absolute')
  const forbiddenAmbient = new Set(['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE'])
  if (Object.keys(ambient).some((key) => forbiddenAmbient.has(platform === 'win32' ? key.toUpperCase() : key))) throw new Error('Ambient Git repository override is not allowed')
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

module.exports = { runGit }
