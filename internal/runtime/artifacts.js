'use strict';

const fs = require('node:fs');
const { randomBytes } = require('node:crypto');

// Writes through a temporary sibling and a rename, so a failed write, such as on a full disk, leaves no partial artifact for a reader
// to take as complete; a receipt that exists is a receipt that was written whole.
function writeText(file, content) {
  const normalized = String(content).replace(/\r\n|\r|\n/g, '\n').replace(/\n?$/, '\n').replaceAll('\n', '\r\n');
  const temporary = `${file}.${randomBytes(6).toString('hex')}.partial`;
  try {
    fs.writeFileSync(temporary, normalized, { flag: 'wx' });
    fs.renameSync(temporary, file);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

function writeJson(file, value) { writeText(file, JSON.stringify(value, null, 2)); }

module.exports = { writeJson, writeText };
