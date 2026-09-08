'use strict';

const fs = require('node:fs');

function writeText(file, content) {
  const normalized = String(content).replace(/\r\n|\r|\n/g, '\n').replace(/\n?$/, '\n').replaceAll('\n', '\r\n');
  fs.writeFileSync(file, normalized);
}

function writeJson(file, value) { writeText(file, JSON.stringify(value, null, 2)); }

module.exports = { writeJson, writeText };
