#!/usr/bin/env node
const fs = require('node:fs');
const { parseConfig } = require('../src/config');

const [file, flag] = process.argv.slice(2);
const result = parseConfig(fs.readFileSync(file, 'utf8'));
for (const problem of result.problems) console.error(problem);
console.log(`${result.entries.length} entries`);
if (flag === '--check' && result.problems.some(problem => problem.startsWith('error'))) process.exitCode = 1;
