#!/usr/bin/env node
// Question guard: while work is handed over, Claude may not open the question dialog,
// because nobody is there to answer it. It parks the question in TASKS.md instead.
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

  // While the user is here, the dialog is the best way to ask.
  if (!/^Handed over: yes\s*$/m.test(tasks)) return;

  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: 'The user handed this work over and is not here to answer. Do not ask now: change the task to - [?], add your question to the end of its line in TASKS.md, and carry on with the other tasks.',
    },
  }));
});
