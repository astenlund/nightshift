#!/usr/bin/env node
// Stop guard: while handed-over work in TASKS.md has unchecked tasks, Claude may not end its turn,
// until it has been reminded three times without TASKS.md changing.
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const stateFile = path.join(root, '.claude', 'stop-guard-state.json');
const MAX_REMINDERS = 3;

// Claude Code describes the event as JSON on stdin.
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => (raw += chunk));
process.stdin.on('end', () => {
  const event = JSON.parse(raw);
  const tasks = fs.readFileSync(path.join(root, 'TASKS.md'), 'utf8');

  // Only work the user has handed over is guarded. While the user is here, Claude may stop and talk.
  if (!/^Handed over: yes\s*$/m.test(tasks)) return;

  const lines = tasks.split(/\r?\n/);
  const open = lines.filter(line => line.startsWith('- [ ]'));
  const waiting = lines.filter(line => line.startsWith('- [?]'));

  if (open.length === 0) {
    // Only the user can unblock a waiting task, so let Claude stop, and say the work is not complete.
    if (waiting.length > 0) {
      console.log(JSON.stringify({ systemMessage: `Paused on your decision:\n${waiting.join('\n')}` }));
    }
    return;
  }

  // Progress means TASKS.md changed since the last reminder, not that Claude says it tried.
  const fingerprint = crypto.createHash('sha256').update(tasks).digest('hex');
  let last = {};
  try { last = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch {}
  const stuck = last.session === event.session_id && last.fingerprint === fingerprint;
  const reminders = stuck ? last.reminders + 1 : 1;
  fs.writeFileSync(stateFile, JSON.stringify({ session: event.session_id, fingerprint, reminders }));

  if (reminders > MAX_REMINDERS) {
    // Let Claude stop, but tell the user plainly that the work is not finished.
    console.log(JSON.stringify({
      systemMessage: `Stop guard gave up after ${MAX_REMINDERS} reminders without progress. Unfinished:\n${open.join('\n')}`,
    }));
    return;
  }

  console.log(JSON.stringify({
    decision: 'block',
    reason: `TASKS.md still has ${open.length} unchecked task(s) (reminder ${reminders}):\n${open.join('\n')}\nCarry on with the next one, and tick it off in TASKS.md when it is done.`,
  }));
});
