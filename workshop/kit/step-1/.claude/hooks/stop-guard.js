#!/usr/bin/env node
// Stop guard: while TASKS.md has unchecked tasks, Claude may not end its turn.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');

// Claude Code describes the event as JSON on stdin. Step 2 reads it; for now we only wait for it to end.
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => (raw += chunk));
process.stdin.on('end', () => {
  const tasks = fs.readFileSync(path.join(root, 'TASKS.md'), 'utf8');
  const open = tasks.split(/\r?\n/).filter(line => line.startsWith('- [ ]'));

  // Printing nothing lets Claude stop.
  if (open.length === 0) return;

  console.log(JSON.stringify({
    decision: 'block',
    reason: `TASKS.md still has ${open.length} unchecked task(s):\n${open.join('\n')}\nCarry on with the next one, and tick it off in TASKS.md when it is done.`,
  }));
});
