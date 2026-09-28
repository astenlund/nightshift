'use strict';
// Captures the runtime's real refusals for the keynote (see captured-output.md). Run from the repository root:
//   node talks/seams/capture.js
// It drives the runtime in scratch projects under .tmp/talk-capture the way tests/runtime*.test.js do: the Windows
// process observer is stubbed, and review, skeptic and check evidence are recorded directly instead of by live dispatch.
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const repo = path.resolve(__dirname, '../..');
const { execute } = require(repo + '/internal/runtime/cli');
const { RunStore } = require(repo + '/internal/runtime/store');
const { snapshot, verifyCommand } = require(repo + '/internal/runtime/evidence');
const { DIMENSIONS, commitmentsFor, transition } = require(repo + '/internal/runtime/lifecycle');

const base = path.join(repo, '.tmp/talk-capture');
fs.rmSync(base, { recursive: true, force: true });
fs.mkdirSync(base, { recursive: true });
const actor = { host: 'claude', session: 'controller-session' };
const deps = { nativeOwner: () => ({ found: true, pid: process.pid, created: '2026-09-28T00:00:00.000Z', name: 'claude' }), ownerAlive: () => true, information: () => ({ found: true, pid: process.pid, created: '2026-09-28T00:00:00.000Z', name: 'node' }) };

function project(name) {
  const root = path.join(base, name);
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'subject.js'), 'module.exports = xs => xs.map(x => x + 1);\n');
  fs.writeFileSync(path.join(root, 'README.md'), '# Fixture\n');
  execSync('git init -q && git add -A && git -c user.name=f -c user.email=f@f commit -qm base', { cwd: root });
  return root;
}
const rev = root => { const s = new RunStore(root); try { return s.read().revision; } finally { s.close(); } };
async function run(root, request, label) {
  const full = { actor, revision: rev(root), ...request };
  try { const out = await execute(root, full, deps); console.log(`\n### ${label}\n$ ${request.action}\n` + JSON.stringify(out, null, 2)); return out; }
  catch (error) { console.log(`\n### ${label}\n$ ${request.action}\n` + JSON.stringify({ error: error.code ?? 'operation-failed', message: error.message })); return null; }
}
async function quiet(root, request) { return execute(root, { actor, revision: rev(root), ...request }, deps); }
function direct(root, request) { const s = new RunStore(root); try { return s.update(actor, s.read().revision, request.action, state => transition(state, request)); } finally { s.close(); } }
const files = ['subject.js', 'README.md'];
function check(root, taskId) { direct(root, { action: 'check', taskId, evidence: verifyCommand(root, { name: 'unit tests', executable: process.execPath, args: ['--version'], paths: files }) }); }
function review(root, taskId, overrides = {}) {
  const s = new RunStore(root); let tasks; try { tasks = s.read().tasks; } finally { s.close(); }
  return direct(root, { action: 'review', taskId, review: { status: 'complete', commitments: commitmentsFor(tasks), strength: 'strong', session: 'independent-reviewer', independent: true, broad: true, attributionVerified: true, dimensions: [...DIMENSIONS.code], coverageEvidence: 'Read the complete cumulative diff and surrounding callers', snapshot: snapshot(root, files), findings: [], ...overrides } });
}
const task = (id, extra = {}) => ({ id, title: 'Increment every element', agreement: { source: 'User reply: "yes, go ahead"', outcome: 'Every element, including sparse slots, is handled' }, ...extra });
const create = (root, tasks, extra = {}) => execute(root, { action: 'create', objective: 'Deliver the agreed change', authority: 'User agreed the readback', controller: actor, tasks, ...extra }, deps);

(async () => {
  // S1: a spec'd task cannot start before its spec has an independent review.
  let root = project('s1-agreement');
  fs.writeFileSync(path.join(root, 'spec.md'), '# Spec\n');
  await create(root, [task('feature', { agreement: { source: 'User', outcome: 'Implements the spec', spec: 'spec.md' } })]);
  await run(root, { action: 'start-task', taskId: 'feature' }, 'S1 start implementation before the spec is independently reviewed');

  // S2: an advisory (not strong) review does not pass the gate; an explicit model requirement forbids substitution.
  root = project('s2-independence');
  await create(root, [task('change')]);
  await quiet(root, { action: 'start-task', taskId: 'change' }); check(root, 'change');
  await quiet(root, { action: 'advance', taskId: 'change', evidence: 'Implemented' });
  review(root, 'change', { strength: 'advisory', session: 'advisory-reviewer' });
  await run(root, { action: 'advance', taskId: 'change', evidence: 'Reviewed' }, 'S2 advance past review with only an advisory review');
  const baseSha = execSync('git rev-parse HEAD', { cwd: root }).toString().trim();
  await run(root, { action: 'dispatch', taskId: 'change', review: { kind: 'code', baseSha, requirements: 'Agreed outcome', rules: 'Project conventions', requiredModel: 'claude-fable-5-1', candidates: [{ host: 'claude', model: 'claude-fable-5-1', effort: 'high' }, { host: 'codex', model: 'gpt-6-astra', effort: 'high' }], substitutionReason: 'Fable is capped' } }, 'S2 dispatch with a required reviewer model plus a substitute');

  // S3: a review imported, then one file edited; the gate names the stale assessment.
  root = project('s3-staleness');
  await create(root, [task('change')]);
  await quiet(root, { action: 'start-task', taskId: 'change' }); check(root, 'change');
  await quiet(root, { action: 'advance', taskId: 'change', evidence: 'Implemented' });
  review(root, 'change');
  fs.appendFileSync(path.join(root, 'README.md'), 'One more line of docs.\n');
  await run(root, { action: 'advance', taskId: 'change', evidence: 'Reviewed' }, 'S3 advance after editing a file the review covered');

  // S4: every finding needs a skeptic first; a required finding cannot be skipped.
  root = project('s4-skeptic');
  await create(root, [task('change')]);
  await quiet(root, { action: 'start-task', taskId: 'change' }); check(root, 'change');
  await quiet(root, { action: 'advance', taskId: 'change', evidence: 'Implemented' });
  const reviewed = review(root, 'change', { findings: [{ id: 'sparse', required: true, consequence: 'forEach skips missing array slots, so [10] becomes [15]', evidence: 'Reproduced with a sparse array' }] });
  const findingId = reviewed.tasks[0].findings[0].id;
  await run(root, { action: 'dispose', taskId: 'change', findingId, disposition: 'skip', reason: 'Edge case', obligation: { classification: 'required', basis: 'Agreed outcome covers sparse slots' } }, 'S4 dispose a finding no skeptic has validated');
  direct(root, { action: 'validate', taskId: 'change', findingId, validation: { session: 'skeptic', attributionVerified: true, verdict: 'confirmed', evidence: 'Independent execution reproduces it', snapshot: snapshot(root, files) } });
  await run(root, { action: 'dispose', taskId: 'change', findingId, disposition: 'skip', reason: 'Edge case, costly to fix', obligation: { classification: 'required', basis: 'Agreed outcome covers sparse slots' } }, 'S4 skip a confirmed required finding');
  const brief = await execute(root, { action: 'status' }, deps);
  console.log('\n### S5 status brief the lead agent reads after compaction\n$ status\n' + JSON.stringify({ next: brief.next, closing: brief.closing, rules: brief.rules }, null, 2));

  // S5: stale revision, a different session, a second run, then the obligations brief.
  root = project('s5-continuity');
  await create(root, [task('change')]);
  await quiet(root, { action: 'start-task', taskId: 'change' });
  await run(root, { action: 'block', taskId: 'change', revision: 0, blocker: { kind: 'dependency', reason: 'x', recoveryAttempted: 'y' } }, 'S5 write with an out-of-date revision');
  await run(root, { action: 'start-task', taskId: 'change', actor: { host: 'claude', session: 'another-session' } }, 'S5 write from a different session');
  await run(root, { action: 'create', objective: 'Start over', authority: 'New session', controller: { host: 'claude', session: 'another-session' }, tasks: [task('change')] }, 'S5 start a second run over the unfinished one');

  // S6: handover with an unverified continuation mechanism.
  root = project('s6-handover');
  await create(root, [task('change')]);
  await run(root, { action: 'handover', authority: 'User said: I am going to bed, take it from here', mechanism: { verified: false, kind: 'stop-hook', evidence: 'Hook is configured' } }, 'S6 hand over without verified continuation');

  // S7: a handed-over run cannot triage or complete without its morning report.
  root = project('s7-closing');
  await create(root, [{ id: 'docs', title: 'Update docs', kind: 'docs', agreement: { source: 'User', outcome: 'Docs match behavior' } }]);
  await quiet(root, { action: 'handover', authority: 'User said: I am going to bed, take it from here' });
  await quiet(root, { action: 'advance', taskId: 'docs', evidence: 'Docs reconciled' });
  await run(root, { action: 'complete' }, 'S7 complete before the retrospective');
  await quiet(root, { action: 'retrospective', evidence: 'Reviewed the run; no instruction change warranted' });
  await run(root, { action: 'triage', evidence: 'No follow-ups' }, 'S7 triage before the morning report');
})().catch(error => { console.error(error); process.exitCode = 1; });
