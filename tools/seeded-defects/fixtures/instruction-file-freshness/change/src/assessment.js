const path = require('node:path');

const INSTRUCTION_FILES = new Set(['AGENTS.md', 'CLAUDE.md']);

function isDocumentation(file) {
  if (INSTRUCTION_FILES.has(path.posix.basename(file))) return false;
  return file.endsWith('.md') || file.startsWith('docs/');
}

function assessmentStaysCurrent(changedPaths) {
  return changedPaths.every(isDocumentation);
}

module.exports = { assessmentStaysCurrent };
