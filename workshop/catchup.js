#!/usr/bin/env node
// Here's one I prepared earlier. Run it from the workshop folder:
//   node catchup.js 2       puts every workshop file in its state at the end of step 2 (any step from 0 to 4)
//   node catchup.js reset   undoes a demo run: unticks TASKS.md, restores src/text.js and forgets the guard's count
// Both overwrite the workshop files, so copy anything of your own somewhere else first.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const v = [
`# Tasks

Work through the tasks in order. When a task is done, change its \`- [ ]\` to \`- [x]\`.

- [ ] Add \`slugify(text)\` to \`src/text.js\`: lowercase, every run of spaces or punctuation becomes one hyphen, no hyphen at either end ("Hello, World!" becomes "hello-world").
- [ ] Add \`titleCase(text)\` to \`src/text.js\`: capitalise the first letter of every word ("the quick fox" becomes "The Quick Fox").
- [ ] Add \`test/text.test.js\` with \`node:test\` tests for \`wordCount\`, \`slugify\` and \`titleCase\`, and make \`node --test\` pass.
`,
`// Small text helpers for the workshop.

function wordCount(text) {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\\s+/).length;
}

module.exports = { wordCount };
`,
`#!/usr/bin/env node
// Runs a hook the way Claude Code would and shows its answer, without starting Claude.
// Usage: node run-hook.js stop      runs .claude/hooks/stop-guard.js
//        node run-hook.js compact   runs .claude/hooks/restore-tasks.js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const hooks = {
  stop: { file: 'stop-guard.js', event: { hook_event_name: 'Stop' } },
  compact: { file: 'restore-tasks.js', event: { hook_event_name: 'SessionStart', source: 'compact' } },
};

const chosen = hooks[process.argv[2]];
if (!chosen) {
  console.log('Usage: node run-hook.js stop | compact');
  process.exit(1);
}
const hook = path.join(__dirname, '.claude', 'hooks', chosen.file);
if (!fs.existsSync(hook)) {
  console.log(\`There is no .claude/hooks/\${chosen.file} yet.\`);
  process.exit(1);
}

const input = { session_id: 'run-hook', cwd: __dirname, ...chosen.event };
const run = spawnSync(process.execPath, [hook], {
  input: JSON.stringify(input),
  encoding: 'utf8',
  env: { ...process.env, CLAUDE_PROJECT_DIR: __dirname },
});

console.log(\`exit code \${run.status}\`);
if (run.stderr.trim()) console.log(\`stderr: \${run.stderr.trim()}\`);
const out = run.stdout.trim();
if (!out) {
  console.log('No output, so Claude Code carries on as if the hook were not there.');
} else {
  try {
    console.log('Claude Code receives:');
    show(JSON.parse(out), '  ');
  } catch {
    console.log(\`Output that is not JSON: \${out}\`);
  }
}

function show(value, indent) {
  for (const [key, v] of Object.entries(value)) {
    if (v && typeof v === 'object') {
      console.log(\`\${indent}\${key}:\`);
      show(v, indent + '  ');
    } else if (typeof v === 'string' && v.includes('\\n')) {
      console.log(\`\${indent}\${key}:\`);
      for (const line of v.split('\\n')) console.log(\`\${indent}  | \${line}\`);
    } else {
      console.log(\`\${indent}\${key}: \${v}\`);
    }
  }
}
`,
`{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "node", "args": ["\${CLAUDE_PROJECT_DIR}/.claude/hooks/stop-guard.js"] }
        ]
      }
    ]
  }
}
`,
`#!/usr/bin/env node
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
  const open = tasks.split(/\\r?\\n/).filter(line => line.startsWith('- [ ]'));

  // Printing nothing lets Claude stop.
  if (open.length === 0) return;

  console.log(JSON.stringify({
    decision: 'block',
    reason: \`TASKS.md still has \${open.length} unchecked task(s):\\n\${open.join('\\n')}\\nCarry on with the next one, and tick it off in TASKS.md when it is done.\`,
  }));
});
`,
`# Tasks

Work through the tasks in order. When a task is done, change its \`- [ ]\` to \`- [x]\`.

- [ ] Add \`slugify(text)\` to \`src/text.js\`: lowercase, every run of spaces or punctuation becomes one hyphen, no hyphen at either end ("Hello, World!" becomes "hello-world").
- [ ] Add \`titleCase(text)\` to \`src/text.js\`: capitalise the first letter of every word ("the quick fox" becomes "The Quick Fox").
- [ ] Add \`test/text.test.js\` with \`node:test\` tests for \`wordCount\`, \`slugify\` and \`titleCase\`, and make \`node --test\` pass.
- [ ] Get the product owner's sign-off on the slug format. Only the user can arrange this.
`,
`.claude/stop-guard-state.json
`,
`#!/usr/bin/env node
// Stop guard: while TASKS.md has unchecked tasks, Claude may not end its turn,
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
  const open = tasks.split(/\\r?\\n/).filter(line => line.startsWith('- [ ]'));

  // Printing nothing lets Claude stop.
  if (open.length === 0) return;

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
      systemMessage: \`Stop guard gave up after \${MAX_REMINDERS} reminders without progress. Unfinished:\\n\${open.join('\\n')}\`,
    }));
    return;
  }

  console.log(JSON.stringify({
    decision: 'block',
    reason: \`TASKS.md still has \${open.length} unchecked task(s) (reminder \${reminders}):\\n\${open.join('\\n')}\\nCarry on with the next one, and tick it off in TASKS.md when it is done.\`,
  }));
});
`,
`# Tasks

Handed over: no

Work through the tasks in order. When a task is done, change its \`- [ ]\` to \`- [x]\`.
If a task needs a decision from the user, change its \`- [ ]\` to \`- [?]\`, add your question to the end of that line, and carry on with the other tasks.

- [ ] Add \`slugify(text)\` to \`src/text.js\`: lowercase, every run of spaces or punctuation becomes one hyphen, no hyphen at either end ("Hello, World!" becomes "hello-world").
- [ ] Add \`titleCase(text)\` to \`src/text.js\`: capitalise the first letter of every word ("the quick fox" becomes "The Quick Fox").
- [ ] Add \`test/text.test.js\` with \`node:test\` tests for \`wordCount\`, \`slugify\` and \`titleCase\`, and make \`node --test\` pass.
- [ ] Get the product owner's sign-off on the slug format. Only the user can arrange this.
`,
`#!/usr/bin/env node
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
  if (!/^Handed over: yes\\s*$/m.test(tasks)) return;

  const lines = tasks.split(/\\r?\\n/);
  const open = lines.filter(line => line.startsWith('- [ ]'));
  const waiting = lines.filter(line => line.startsWith('- [?]'));

  if (open.length === 0) {
    // Only the user can unblock a waiting task, so let Claude stop, and say the work is not complete.
    if (waiting.length > 0) {
      console.log(JSON.stringify({ systemMessage: \`Paused on your decision:\\n\${waiting.join('\\n')}\` }));
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
      systemMessage: \`Stop guard gave up after \${MAX_REMINDERS} reminders without progress. Unfinished:\\n\${open.join('\\n')}\`,
    }));
    return;
  }

  console.log(JSON.stringify({
    decision: 'block',
    reason: \`TASKS.md still has \${open.length} unchecked task(s) (reminder \${reminders}):\\n\${open.join('\\n')}\\nCarry on with the next one, and tick it off in TASKS.md when it is done.\`,
  }));
});
`,
`{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "node", "args": ["\${CLAUDE_PROJECT_DIR}/.claude/hooks/stop-guard.js"] }
        ]
      }
    ],
    "SessionStart": [
      {
        "matcher": "compact",
        "hooks": [
          { "type": "command", "command": "node", "args": ["\${CLAUDE_PROJECT_DIR}/.claude/hooks/restore-tasks.js"] }
        ]
      }
    ]
  }
}
`,
`#!/usr/bin/env node
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
  const owed = tasks.split(/\\r?\\n/).filter(line => line.startsWith('- [ ]') || line.startsWith('- [?]'));

  // Printing nothing adds nothing to Claude's context.
  if (owed.length === 0) return;

  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: \`The conversation was just compacted, so your summary may have lost details. TASKS.md is the record of what is still owed:\\n\${owed.join('\\n')}\\nBefore you continue, check TASKS.md against the actual files, since a task may be half done.\`,
    },
  }));
});
`,
];

const steps = {
  0: { 'TASKS.md': v[0], 'src/text.js': v[1], 'run-hook.js': v[2] },
  1: { 'TASKS.md': v[0], 'src/text.js': v[1], 'run-hook.js': v[2], '.claude/settings.json': v[3], '.claude/hooks/stop-guard.js': v[4] },
  2: { 'TASKS.md': v[5], 'src/text.js': v[1], 'run-hook.js': v[2], '.gitignore': v[6], '.claude/settings.json': v[3], '.claude/hooks/stop-guard.js': v[7] },
  3: { 'TASKS.md': v[8], 'src/text.js': v[1], 'run-hook.js': v[2], '.gitignore': v[6], '.claude/settings.json': v[3], '.claude/hooks/stop-guard.js': v[9] },
  4: { 'TASKS.md': v[8], 'src/text.js': v[1], 'run-hook.js': v[2], '.gitignore': v[6], '.claude/settings.json': v[10], '.claude/hooks/stop-guard.js': v[9], '.claude/hooks/restore-tasks.js': v[11] },
};

const managed = ['.claude/settings.json', '.claude/hooks/stop-guard.js', '.claude/hooks/restore-tasks.js'];
const here = file => path.join(__dirname, file);

function write(file, text) {
  fs.mkdirSync(path.dirname(here(file)), { recursive: true });
  fs.writeFileSync(here(file), text);
}

// Removes what Claude and the guard leave behind after a demo run.
function clearDemo() {
  fs.rmSync(here('test/text.test.js'), { force: true });
  try { fs.rmdirSync(here('test')); } catch {}
  fs.rmSync(here('.claude/stop-guard-state.json'), { force: true });
}

const arg = process.argv[2];

if (arg === 'reset') {
  clearDemo();
  write('src/text.js', steps[0]['src/text.js']);
  const known = Object.values(steps).flatMap(s => s['TASKS.md'].split('\n')).filter(l => l.startsWith('- [ ] '));
  const tasks = fs.readFileSync(here('TASKS.md'), 'utf8').split(/\r?\n/).map(line => {
    if (line.startsWith('Handed over:')) return 'Handed over: no';
    if (!/^- \[[x?]\] /.test(line)) return line;
    const rest = line.slice(6);
    return known.find(task => rest.startsWith(task.slice(6))) || '- [ ] ' + rest;
  });
  write('TASKS.md', tasks.join('\n'));
  console.log('Demo reset: every task is unticked, src/text.js is back to the start, and the guard has forgotten its count.');
} else if (Object.hasOwn(steps, arg)) {
  clearDemo();
  for (const file of managed) fs.rmSync(here(file), { force: true });
  for (const [file, text] of Object.entries(steps[arg])) write(file, text);
  console.log(`This folder now matches the end of step ${arg}: ${Object.keys(steps[arg]).join(', ')}`);
} else {
  console.log('Usage: node catchup.js <0-4>   or   node catchup.js reset');
  process.exit(1);
}
