const { spawnSync } = require('node:child_process');

function runCheck(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, env: process.env, encoding: 'utf8', timeout: 600000, maxBuffer: 64 * 1024 * 1024 });
  return { exit: result.status, signal: result.signal, error: result.error?.message ?? null, output: (result.stdout ?? '') + (result.stderr ?? '') };
}

module.exports = { runCheck };
