const { spawnSync } = require('node:child_process');

function runGit(cwd, args) {
  const result = spawnSync('git', args, { cwd, shell: true, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout;
}

module.exports = { runGit };
