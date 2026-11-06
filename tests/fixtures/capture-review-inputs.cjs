'use strict';

const fs = require('node:fs');
const { retain } = require('../../internal/runtime/review-inputs');

function main() {
  const request = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  process.stdout.write(JSON.stringify(retain(request.root, request.source, request.snapshot)));
}

try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
