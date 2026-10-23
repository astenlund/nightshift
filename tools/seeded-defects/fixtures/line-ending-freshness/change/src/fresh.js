const crypto = require('node:crypto');
const fs = require('node:fs');

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function snapshot(files) {
  return Object.fromEntries(files.map(file => [file, digest(file)]));
}

function fresh(recorded) {
  return Object.entries(recorded).every(([file, hash]) => fs.existsSync(file) && digest(file) === hash);
}

module.exports = { fresh, snapshot };
