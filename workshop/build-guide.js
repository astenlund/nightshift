// Builds guide.html from guide.src.html, filling code figures from the tested kit snapshots.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const kit = path.join(__dirname, 'kit');
const read = (step, file) => {
  const p = path.join(kit, `step-${step}`, file);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
};
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Marks lines of b that are not in the longest common subsequence with a.
function addedLines(a, b) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const added = new Set();
  let i = 0, j = 0;
  while (j < m) {
    if (i < n && a[i] === b[j]) { i++; j++; }
    else if (i < n && dp[i + 1][j] >= dp[i][j + 1]) i++;
    else { added.add(j); j++; }
  }
  return added;
}

const files = {};
let counter = 0;
function figure(text, label, note, added) {
  const id = `f${counter++}`;
  files[id] = text;
  const lines = text.replace(/\n$/, '').split('\n');
  const body = lines.map((line, k) => `<span class="l${added.has(k) ? ' add' : ''}">${esc(line) || '&#8203;'}</span>`).join('');
  return `<figure class="code"><figcaption><span class="path">${esc(label)}</span><span class="note">${note}</span><button type="button" class="copy" data-src="${id}">Copy</button></figcaption><pre><code>${body}</code></pre></figure>`;
}

let html = fs.readFileSync(path.join(__dirname, 'guide.src.html'), 'utf8');
html = html.replace(/<!--code:(\d):([^:]+):(-|\d)-->/g, (_, step, file, from) => {
  const text = read(step, file);
  if (text === null) throw new Error(`missing ${file} in step ${step}`);
  const prev = from === '-' ? null : read(from, file);
  if (prev === null) return figure(text, file, 'New file', new Set());
  const added = addedLines(prev.replace(/\n$/, '').split('\n'), text.replace(/\n$/, '').split('\n'));
  if (added.size === 0) throw new Error(`${file} unchanged between ${from} and ${step}`);
  return figure(text, file, `Replace the whole file · ${added.size} changed line${added.size > 1 ? 's' : ''} marked`, added);
});
// Extra files outside the step snapshots: <!--file:relative/path|Label|Note-->
html = html.replace(/<!--file:([^|]+)\|([^|]+)\|([^>]*?)-->/g, (_, rel, label, note) => figure(fs.readFileSync(path.join(__dirname, rel), 'utf8'), label, note, new Set()));
html = html.replace('<!--catchup-->', () => {
  const text = fs.readFileSync(path.join(__dirname, 'catchup.js'), 'utf8');
  const id = `f${counter++}`;
  files[id] = text;
  return `<div class="catchup-file"><div class="catchup-bar"><span class="path">catchup.js</span><span class="note">${text.split('\n').length} lines · holds a finished copy of every step</span><button type="button" class="copy" data-src="${id}">Copy catchup.js</button></div><details><summary>Show the script</summary><pre><code>${esc(text)}</code></pre></details></div>`;
});
// Expected hook output, produced by running run-hook.js on a scratch copy of the step.
const { execFileSync } = require('node:child_process');
html = html.replace(/<!--hookrun:(\d):(\w+)(?::(\w+))?-->/g, (_, step, dish, variant) => {
  const tmp = fs.mkdtempSync(path.join(__dirname, '.hookrun-'));
  fs.cpSync(path.join(kit, `step-${step}`), tmp, { recursive: true });
  if (variant === 'handed') {
    const t = path.join(tmp, 'TASKS.md');
    fs.writeFileSync(t, fs.readFileSync(t, 'utf8').replace('Handed over: no', 'Handed over: yes'));
  }
  if (variant === 'fourth') for (let k = 0; k < 3; k++) execFileSync(process.execPath, ['run-hook.js', dish], { cwd: tmp });
  let out = '';
  try { out = execFileSync(process.execPath, ['run-hook.js', dish], { cwd: tmp, encoding: 'utf8' }); }
  catch (e) { out = e.stdout; }
  fs.rmSync(tmp, { recursive: true, force: true });
  return `<pre class="out">${esc(out.replace(/\n$/, ''))}</pre>`;
});
if (/<!--(code|catchup|hookrun)/.test(html)) throw new Error('unfilled placeholder');
html = html.replace('/*FILES*/', () => `const FILES = ${JSON.stringify(files).replace(/</g, '\\u003c')};`);
fs.writeFileSync(path.join(__dirname, 'guide.html'), html);
console.log(`guide.html: ${html.length} chars, ${counter} copyable files`);
