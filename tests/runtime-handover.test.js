'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { RunStore } = require('../internal/runtime/store');
const { execute } = require('../internal/runtime/cli');
const { obligationBrief, transition } = require('../internal/runtime/lifecycle');
const { handleHook } = require('../internal/runtime/hook');

const actor = { host: 'claude', session: 'controller' };
const REPORT_PATH = '.nightshift/runs/reports/morning.md';
const MECHANISM = { verified: true, kind: 'goal', evidence: 'Observed native goal and Stop hook in fixture' };
const STOP_HOOK = { verified: true, kind: 'stop-hook', evidence: 'Observed registered, enabled and trusted Stop hook with session activation in fixture' };

function fixture(t, options = {}) {
  const parent = path.resolve(__dirname, '../.tmp/runtime-handover');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'case-'));
  const store = new RunStore(root, { create: true });
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  store.create({ objective: 'Deliver accepted maintenance', authority: 'User agreed the scope', controller: actor, limits: { maxDispatches: 7 }, publication: { authorized: false }, tasks: [{ id: 'docs', title: 'Maintenance', kind: 'docs', agreement: { source: 'User', outcome: 'Reconciled documentation' } }], ...options });
  const act = (request, as = actor) => store.update(as, store.read().revision, request.action, state => transition(state, request));
  const writeReport = (content = '# Morning report\n', relative = REPORT_PATH) => {
    fs.mkdirSync(path.join(root, path.dirname(relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), content);
    return relative;
  };
  const finish = () => act({ action: 'advance', taskId: 'docs', evidence: 'Documentation matches delivered behavior' });
  const hook = (event, session = actor.session) => handleHook({ cwd: root, session_id: session, hook_event_name: event });
  return { root, store, act, writeReport, finish, hook };
}

// The notice is always the last line of the SessionStart context, after a marker line naming it.
function noticeOf(result) {
  const lines = (result.hookSpecificOutput?.additionalContext ?? '').split('\n');
  return lines.some(line => line.startsWith('Nightshift morning report.')) ? JSON.parse(lines.at(-1)) : null;
}

test('handover without a mechanism records the handover and leaves an attended run attended', t => {
  const f = fixture(t);
  assert.equal(obligationBrief(f.store.read()).handover, null);
  const state = f.act({ action: 'handover', authority: 'User said: take it from here' });
  assert.deepEqual(state.handover, { authority: 'User said: take it from here', revision: state.revision });
  assert.equal(state.mode, 'attended');
  assert.equal(state.continuation, null);
  const brief = obligationBrief(state);
  assert.equal(brief.mode, 'attended');
  assert.deepEqual(brief.report, { recorded: false, delivered: false, path: null, current: null });
});

test('handover with a verified mechanism switches to unattended in the same write and preserves everything else', t => {
  const f = fixture(t);
  f.act({ action: 'worker', worker: { id: 'helper', session: 'helper-session', assignment: 'Bounded helper', role: 'implementer', writes: ['notes'] } });
  f.act({ action: 'followup', item: { id: 'idea', context: 'Mid-run idea', recommendation: 'Track' } });
  const before = f.store.read();
  const state = f.act({ action: 'handover', authority: 'User handover', mechanism: MECHANISM });
  assert.equal(state.mode, 'unattended');
  assert.deepEqual(state.continuation, { ...MECHANISM, controller: state.controller, runId: state.id, observedAt: state.continuation.observedAt });
  assert.match(state.continuation.observedAt, /^\d{4}-\d{2}-\d{2}T.*Z$/);
  assert.equal(state.handover.revision, state.revision);
  for (const key of ['id', 'tasks', 'workers', 'followups', 'limits', 'publication', 'controller', 'objective', 'authority', 'closing']) assert.deepEqual(state[key], before[key], key);
});

test('an unverified mechanism is rejected and writes nothing', t => {
  const f = fixture(t);
  const before = f.store.read();
  for (const mechanism of [{ verified: false, evidence: 'Not observed' }, { verified: true }, { verified: true, evidence: '   ' }, null]) {
    assert.throws(() => f.act({ action: 'handover', authority: 'User handover', mechanism }), { code: 'unverified-continuation' });
    assert.throws(() => f.act({ action: 'continuation', mechanism }), { code: 'unverified-continuation' });
  }
  assert.deepEqual(f.store.read(), before);
});

test('a verified mechanism without a known kind is rejected and writes nothing', t => {
  const f = fixture(t);
  const before = f.store.read();
  for (const kind of [undefined, null, '', 'hook', 'Goal', 'toString', ['goal']]) {
    const mechanism = { ...MECHANISM, kind };
    assert.throws(() => f.act({ action: 'handover', authority: 'User handover', mechanism }), { code: 'invalid-continuation-kind' });
    assert.throws(() => f.act({ action: 'continuation', mechanism }), { code: 'invalid-continuation-kind' });
  }
  assert.deepEqual(f.store.read(), before);
});

test('a verified Stop hook carries unattended work for a Claude controller', t => {
  const f = fixture(t);
  const state = f.act({ action: 'handover', authority: 'User handover', mechanism: STOP_HOOK });
  assert.equal(state.mode, 'unattended');
  assert.equal(state.continuation.kind, 'stop-hook');
  f.finish();
  assert.equal(f.store.read().tasks[0].status, 'complete');
});

test('a Claude run created unattended executes once continuation records a verified Stop hook', t => {
  const f = fixture(t, { mode: 'unattended', authority: 'User handed the queue over' });
  assert.throws(() => f.finish(), { code: 'unverified-continuation' });
  const state = f.act({ action: 'continuation', mechanism: STOP_HOOK });
  assert.equal(state.mode, 'unattended');
  assert.equal(state.continuation.kind, 'stop-hook');
  f.finish();
  assert.equal(f.store.read().tasks[0].status, 'complete');
});

test('a Codex controller needs a verified goal because a Stop hook alone is refused', t => {
  const codex = { host: 'codex', session: 'codex-controller' };
  const f = fixture(t, { controller: codex });
  const before = f.store.read();
  assert.throws(() => f.act({ action: 'handover', authority: 'User handover', mechanism: STOP_HOOK }, codex), { code: 'unsupported-continuation' });
  assert.throws(() => f.act({ action: 'continuation', mechanism: STOP_HOOK }, codex), { code: 'unsupported-continuation' });
  assert.deepEqual(f.store.read(), before);
  const state = f.act({ action: 'handover', authority: 'User handover', mechanism: MECHANISM }, codex);
  assert.equal(state.mode, 'unattended');
  assert.equal(state.continuation.kind, 'goal');
});

test('repeated handover keeps the original record, can upgrade and never downgrades', t => {
  const f = fixture(t);
  const first = f.act({ action: 'handover', authority: 'First handover' });
  const upgraded = f.act({ action: 'handover', authority: 'Second handover', mechanism: MECHANISM });
  assert.deepEqual(upgraded.handover, first.handover);
  assert.equal(upgraded.mode, 'unattended');
  const repeated = f.act({ action: 'handover', authority: 'Third handover' });
  assert.deepEqual(repeated.handover, first.handover);
  assert.equal(repeated.mode, 'unattended');
  assert.deepEqual(repeated.continuation, upgraded.continuation);
});

test('handover is refused on a stopped run and for another controller', t => {
  const f = fixture(t);
  assert.throws(() => f.act({ action: 'handover', authority: 'Other' }, { host: 'claude', session: 'intruder' }), { code: 'wrong-owner' });
  f.act({ action: 'stop', kind: 'user-stop', reason: 'User paused the work' });
  assert.throws(() => f.act({ action: 'handover', authority: 'User handover' }), { code: 'run-stopped' });
  f.act({ action: 'resume', authority: 'User resumed' });
  assert.ok(f.act({ action: 'handover', authority: 'User handover' }).handover);
});

test('a run created unattended carries the same handover record and can verify through handover', t => {
  const f = fixture(t, { mode: 'unattended', authority: 'User handed the queue over' });
  assert.deepEqual(f.store.read().handover, { authority: 'User handed the queue over', revision: 0 });
  assert.throws(() => f.finish(), { code: 'unverified-continuation' });
  // A mechanism-less handover cannot unblock an unattended run, which is why an unverifiable handover starts attended.
  assert.equal(f.act({ action: 'handover', authority: 'Still unverified' }).mode, 'unattended');
  assert.throws(() => f.finish(), { code: 'unverified-continuation' });
  f.act({ action: 'handover', authority: 'Renewed', mechanism: MECHANISM });
  f.finish();
  assert.equal(f.store.read().tasks[0].status, 'complete');
});

test('a run without a handover keeps the two-stage closing and owes no report', t => {
  const f = fixture(t);
  f.finish();
  f.act({ action: 'retrospective', evidence: 'Considered' });
  assert.equal(obligationBrief(f.store.read()).closing.stage, 'triage');
  assert.throws(() => f.act({ action: 'report', path: f.writeReport() }), { code: 'report-not-due' });
  assert.throws(() => f.act({ action: 'report-delivered', authority: 'User replied' }), { code: 'report-required' });
  f.act({ action: 'triage', evidence: 'Nothing pending' });
  assert.equal(f.act({ action: 'complete' }).status, 'complete');
  assert.equal(obligationBrief(f.store.read()).report, null);
});

test('a handed-over run closes through retrospective, report, triage and completion', t => {
  const f = fixture(t);
  f.act({ action: 'handover', authority: 'User handover' });
  f.finish();
  assert.throws(() => f.act({ action: 'report', path: f.writeReport() }), { code: 'retrospective-required' });
  f.act({ action: 'retrospective', evidence: 'Considered' });
  assert.equal(obligationBrief(f.store.read()).closing.stage, 'report');
  assert.throws(() => f.act({ action: 'triage', evidence: 'Too early' }), { code: 'report-required' });
  for (const bad of ['.nightshift/runs/reports/missing.md', 'morning.md', '.nightshift/runs/reports/notes.txt', '.nightshift/runs/reports/../../escape.md']) {
    assert.throws(() => f.act({ action: 'report', path: bad }), error => ['invalid-report', 'unsafe-path'].includes(error.code), bad);
  }
  assert.throws(() => f.act({ action: 'report', path: f.writeReport('', '.nightshift/runs/reports/empty.md') }), { code: 'invalid-report' });
  const recorded = f.act({ action: 'report', path: f.writeReport() });
  assert.equal(recorded.closing.reportEvidence.path, REPORT_PATH);
  assert.match(recorded.closing.reportEvidence.sha256, /^[0-9a-f]{64}$/);
  assert.equal(obligationBrief(recorded).closing.stage, 'triage');
  f.act({ action: 'triage', evidence: 'Decisions deferred for the absent user' });
  assert.equal(f.act({ action: 'complete' }).status, 'complete');
});

test('a handover arriving after retrospective and triage still cannot complete without a report', t => {
  const f = fixture(t);
  f.finish();
  f.act({ action: 'retrospective', evidence: 'Considered' });
  f.act({ action: 'triage', evidence: 'Nothing pending' });
  const handed = f.act({ action: 'handover', authority: 'Late handover' });
  assert.equal(handed.closing.retrospectiveEvidence, 'Considered');
  assert.equal(handed.closing.triageEvidence, 'Nothing pending');
  assert.equal(obligationBrief(handed).closing.stage, 'report');
  assert.throws(() => f.act({ action: 'complete' }), { code: 'report-required' });
  f.act({ action: 'report', path: f.writeReport() });
  assert.equal(obligationBrief(f.store.read()).closing.stage, 'complete');
  assert.equal(f.act({ action: 'complete' }).status, 'complete');
});

test('resumed engineering clears the report and its delivery with the rest of the closing evidence', t => {
  const f = fixture(t, { tasks: [{ id: 'docs', title: 'Maintenance', kind: 'docs', agreement: { source: 'User', outcome: 'Docs' } }, { id: 'later', title: 'Later', kind: 'docs', agreement: { source: 'User', outcome: 'More docs' } }] });
  f.act({ action: 'handover', authority: 'User handover' });
  f.finish();
  f.act({ action: 'block', taskId: 'later', blocker: { kind: 'user-decision', reason: 'Needs the user', recoveryAttempted: 'Checked the agreement' } });
  f.act({ action: 'retrospective', evidence: 'Considered' });
  f.act({ action: 'report', path: f.writeReport() });
  f.act({ action: 'report-delivered', authority: 'User replied: thanks' });
  f.act({ action: 'unblock', taskId: 'later', evidence: 'User answered the decision' });
  assert.deepEqual(f.store.read().closing, { retrospectiveEvidence: null, reportEvidence: null, reportDelivery: null, triageEvidence: null });
});

test('delivery is recorded on running, stopped and complete runs, is idempotent, and a replaced or stale report is undelivered', t => {
  for (const status of ['running', 'stopped', 'complete']) {
    const f = fixture(t);
    f.act({ action: 'handover', authority: 'User handover' });
    f.finish();
    f.act({ action: 'retrospective', evidence: 'Considered' });
    assert.throws(() => f.act({ action: 'report-delivered', authority: 'User replied' }), { code: 'report-required' });
    f.act({ action: 'report', path: f.writeReport() });
    if (status === 'stopped') f.act({ action: 'stop', kind: 'user-stop', reason: 'User paused' });
    if (status === 'complete') {
      f.act({ action: 'triage', evidence: 'Deferred' });
      f.act({ action: 'complete' });
    }
    assert.equal(f.store.read().status, status);
    assert.throws(() => f.act({ action: 'report-delivered', authority: '  ' }), error => error.code !== undefined);
    const delivered = f.act({ action: 'report-delivered', authority: 'User replied: track it' });
    assert.equal(delivered.closing.reportDelivery.sha256, delivered.closing.reportEvidence.sha256);
    assert.equal(obligationBrief(delivered).report.delivered, true);
    const again = f.act({ action: 'report-delivered', authority: 'A later reply' });
    assert.deepEqual(again.closing.reportDelivery, delivered.closing.reportDelivery);

    f.writeReport('# Morning report, edited outside the runtime\n');
    assert.equal(obligationBrief(f.store.read()).report.current, false);
    f.act({ action: 'report', path: REPORT_PATH });
    assert.equal(f.store.read().closing.reportDelivery, null);
    assert.equal(obligationBrief(f.store.read()).report.delivered, false);
    fs.rmSync(path.join(f.root, REPORT_PATH));
    assert.throws(() => f.act({ action: 'report-delivered', authority: 'User replied' }), { code: 'report-stale' });
    f.writeReport('# Changed again\n');
    assert.throws(() => f.act({ action: 'report-delivered', authority: 'User replied' }), { code: 'report-stale' });
  }
});

test('SessionStart carries the morning-report notice for a closed handed-over run until the hand-off is finished', t => {
  const f = fixture(t);
  f.act({ action: 'handover', authority: 'User handover' });
  f.act({ action: 'followup', item: { id: 'decision', context: 'Optional cleanup', recommendation: 'Track' } });
  f.finish();
  f.act({ action: 'retrospective', evidence: 'Considered' });
  assert.equal(noticeOf(f.hook('SessionStart')), null);
  f.act({ action: 'report', path: f.writeReport() });
  const running = f.hook('SessionStart');
  assert.match(running.hookSpecificOutput.additionalContext, /^Nightshift continuation\./);
  assert.deepEqual(noticeOf(running), { recorded: true, delivered: false, path: REPORT_PATH, current: true, followups: ['decision'] });
  f.act({ action: 'triage', evidence: 'Deferred for the absent user' });
  f.act({ action: 'complete' });

  const undelivered = f.hook('SessionStart');
  assert.deepEqual(noticeOf(undelivered), { recorded: true, delivered: false, path: REPORT_PATH, current: true, followups: ['decision'] });
  assert.match(undelivered.hookSpecificOutput.additionalContext, /Present the saved report, ending with its pending follow-ups and a plain question asking whether the user is ready to triage them, or with a plain statement that no decision is pending, .*each follow-up through the host's question tool, or leave them pending if the user is not ready/);
  assert.doesNotMatch(undelivered.hookSpecificOutput.additionalContext, /Nightshift continuation\./);
  assert.equal(noticeOf(f.hook('SessionStart', 'another-session')), null);
  assert.deepEqual(f.hook('Stop'), {});
  assert.deepEqual(f.hook('PreCompact'), {});

  f.writeReport('# Tampered\n');
  const stale = f.hook('SessionStart');
  assert.equal(noticeOf(stale).current, false);
  assert.match(stale.hookSpecificOutput.additionalContext, /Rewrite it and record the report again before presenting it/);
  assert.doesNotMatch(stale.hookSpecificOutput.additionalContext, /Present the saved report/);
  f.act({ action: 'report', path: f.writeReport() });

  f.act({ action: 'report-delivered', authority: 'User replied: track it' });
  const delivered = f.hook('SessionStart');
  assert.deepEqual(noticeOf(delivered), { recorded: true, delivered: true, path: REPORT_PATH, current: true, followups: ['decision'] });
  assert.match(delivered.hookSpecificOutput.additionalContext, /The report was delivered and follow-ups are pending\. If the user has asked to triage them, present them one at a time through the host's question tool, .*otherwise ask whether the user is ready to triage them/);
  f.act({ action: 'resolve-followup', followupId: 'decision', decision: 'track', authority: 'User replied: track it' });
  assert.equal(noticeOf(f.hook('SessionStart')), null);
  assert.match(f.hook('SessionStart').hookSpecificOutput.additionalContext, /Nightshift session binding/);
});

test('a closed run without a handover and a state from an earlier release produce no notice', t => {
  const f = fixture(t);
  f.finish();
  f.act({ action: 'retrospective', evidence: 'Considered' });
  f.act({ action: 'triage', evidence: 'Nothing pending' });
  f.act({ action: 'followup', item: { id: 'decision', context: 'Optional cleanup', recommendation: 'Track' } });
  f.act({ action: 'complete' });
  assert.doesNotMatch(f.hook('SessionStart').hookSpecificOutput.additionalContext, /morning report/);

  const legacy = fixture(t, { mode: 'unattended' });
  legacy.store.update(actor, legacy.store.read().revision, 'earlier-release-fixture', state => { delete state.handover; state.closing = { retrospectiveEvidence: 'Considered', triageEvidence: 'Nothing pending' }; });
  const brief = obligationBrief(legacy.store.read());
  assert.equal(brief.handover, null);
  assert.equal(brief.report, null);
  assert.equal(brief.closing.stage, 'complete');
});

test('the unattended Stop hook resists a yield at the report stage and never for an unrecorded delivery', t => {
  const f = fixture(t);
  f.act({ action: 'handover', authority: 'User handover', mechanism: MECHANISM });
  f.finish();
  f.act({ action: 'retrospective', evidence: 'Considered' });
  assert.equal(obligationBrief(f.store.read()).closing.stage, 'report');
  assert.equal(f.hook('Stop').decision, 'block');
  f.act({ action: 'report', path: f.writeReport() });
  f.act({ action: 'triage', evidence: 'Deferred' });
  f.act({ action: 'complete' });
  assert.equal(f.store.read().closing.reportDelivery, null);
  assert.deepEqual(f.hook('Stop'), {});
});

test('the CLI routes the new actions and still refuses a run selector on mutations', async t => {
  const f = fixture(t);
  const brief = await execute(f.root, { action: 'handover', authority: 'User handover', actor, revision: f.store.read().revision });
  assert.equal(brief.handover.authority, 'User handover');
  await assert.rejects(execute(f.root, { action: 'report-delivered', authority: 'User replied', runId: 'some-other-run', actor, revision: f.store.read().revision }), { code: 'wrong-run' });
});
