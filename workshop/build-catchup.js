// Builds catchup.js from the tested kit/step-N snapshots.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const kit = path.join(__dirname, 'kit');
const STEPS = [0, 1, 2, 3, 4];
const FILES = ['TASKS.md', 'src/text.js', 'run-hook.js', '.gitignore', '.claude/settings.json', '.claude/hooks/stop-guard.js', '.claude/hooks/restore-tasks.js'];

const versions = [];
const steps = {};
for (const n of STEPS) {
  steps[n] = {};
  for (const file of FILES) {
    const p = path.join(kit, `step-${n}`, file);
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, 'utf8');
    let id = versions.indexOf(text);
    if (id < 0) { versions.push(text); id = versions.length - 1; }
    steps[n][file] = id;
  }
}

const literal = text => '`' + text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${') + '`';

const out = `#!/usr/bin/env node
// Here's one I prepared earlier. Run it from the workshop folder:
//   node catchup.js 2       puts every workshop file in its state at the end of step 2 (any step from 0 to 4)
//   node catchup.js reset   undoes a demo run: unticks TASKS.md, restores src/text.js and forgets the guard's count
// Both overwrite the workshop files, so copy anything of your own somewhere else first.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const v = [
${versions.map(literal).join(',\n')},
];

const steps = {
${STEPS.map(n => `  ${n}: { ${Object.entries(steps[n]).map(([f, id]) => `'${f}': v[${id}]`).join(', ')} },`).join('\n')}
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
  const known = Object.values(steps).flatMap(s => s['TASKS.md'].split('\\n')).filter(l => l.startsWith('- [ ] '));
  const tasks = fs.readFileSync(here('TASKS.md'), 'utf8').split(/\\r?\\n/).map(line => {
    if (line.startsWith('Handed over:')) return 'Handed over: no';
    if (!/^- \\[[x?]\\] /.test(line)) return line;
    const rest = line.slice(6);
    return known.find(task => rest.startsWith(task.slice(6))) || '- [ ] ' + rest;
  });
  write('TASKS.md', tasks.join('\\n'));
  console.log('Demo reset: every task is unticked, src/text.js is back to the start, and the guard has forgotten its count.');
} else if (Object.hasOwn(steps, arg)) {
  clearDemo();
  for (const file of managed) fs.rmSync(here(file), { force: true });
  for (const [file, text] of Object.entries(steps[arg])) write(file, text);
  console.log(\`This folder now matches the end of step \${arg}: \${Object.keys(steps[arg]).join(', ')}\`);
} else {
  console.log('Usage: node catchup.js <0-4>   or   node catchup.js reset');
  process.exit(1);
}
`;
fs.writeFileSync(path.join(__dirname, 'catchup.js'), out);
console.log(`catchup.js: ${out.length} chars, ${versions.length} file versions`);
