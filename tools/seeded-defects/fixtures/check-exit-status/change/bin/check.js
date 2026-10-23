const fs = require('node:fs');
const { parseConfig } = require('../src/config');

const [file, flag] = process.argv.slice(2);
let text;
try {
  text = fs.readFileSync(file, 'utf8');
} catch (error) {
  console.error(`cannot read ${file}: ${error.message}`);
  process.exit(1);
}
const result = parseConfig(text);
for (const problem of result.problems) console.error(problem);
console.log(`${result.entries.length} entries`);
if (flag === '--check' && result.problems.some(problem => problem.startsWith('error'))) process.exitCode = 1;
