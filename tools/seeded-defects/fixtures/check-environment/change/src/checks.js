const { spawnSync } = require('node:child_process');

function runCheck(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, env: process.env, encoding: 'utf8', timeout: 600000 });
  return { exit: result.status, output: result.stdout + result.stderr };
}

module.exports = { runCheck };
