#!/usr/bin/env node
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
  console.log(`There is no .claude/hooks/${chosen.file} yet.`);
  process.exit(1);
}

const input = { session_id: 'run-hook', cwd: __dirname, ...chosen.event };
const run = spawnSync(process.execPath, [hook], {
  input: JSON.stringify(input),
  encoding: 'utf8',
  env: { ...process.env, CLAUDE_PROJECT_DIR: __dirname },
});

console.log(`exit code ${run.status}`);
if (run.stderr.trim()) console.log(`stderr: ${run.stderr.trim()}`);
const out = run.stdout.trim();
if (!out) {
  console.log('No output, so Claude Code carries on as if the hook were not there.');
} else {
  try {
    console.log('Claude Code receives:');
    show(JSON.parse(out), '  ');
  } catch {
    console.log(`Output that is not JSON: ${out}`);
  }
}

function show(value, indent) {
  for (const [key, v] of Object.entries(value)) {
    if (v && typeof v === 'object') {
      console.log(`${indent}${key}:`);
      show(v, indent + '  ');
    } else if (typeof v === 'string' && v.includes('\n')) {
      console.log(`${indent}${key}:`);
      for (const line of v.split('\n')) console.log(`${indent}  | ${line}`);
    } else {
      console.log(`${indent}${key}: ${v}`);
    }
  }
}
