#!/usr/bin/env node
const { runGit } = require('../src/git');

const branch = process.argv[2];
if (!branch) {
  console.error('usage: switch <branch>');
  process.exit(2);
}
runGit(process.cwd(), ['switch', branch]);
console.log(`switched to ${branch}`);
