const fs = require('node:fs');
const path = require('node:path');

function readStore(project) {
  return JSON.parse(fs.readFileSync(path.join(project, '.runs', 'store.json'), 'utf8'));
}

module.exports = { readStore };
