const { runGit } = require('../src/git');

const branch = process.argv[2];
if (!branch || branch.startsWith('-')) {
  console.error('usage: switch <branch>');
  process.exit(2);
}
try {
  runGit(process.cwd(), ['switch', branch]);
} catch (error) {
  console.error(error.message.trim());
  process.exit(1);
}
console.log(`switched to ${branch}`);
