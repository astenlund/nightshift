#!/usr/bin/env node
// After compaction, put what is still owed back in front of Claude, straight from TASKS.md.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');

// Claude Code describes the event as JSON on stdin. We only need to wait for it to end.
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => (raw += chunk));
process.stdin.on('end', () => {
  const tasks = fs.readFileSync(path.join(root, 'TASKS.md'), 'utf8');
  const owed = tasks.split(/\r?\n/).filter(line => line.startsWith('- [ ]') || line.startsWith('- [?]'));

  // Printing nothing adds nothing to Claude's context.
  if (owed.length === 0) return;

  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: `The conversation was just compacted, so your summary may have lost details. TASKS.md is the record of what is still owed:\n${owed.join('\n')}\nBefore you continue, check TASKS.md against the actual files, since a task may be half done.`,
    },
  }));
});
