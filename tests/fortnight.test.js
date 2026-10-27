'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { compute, formatMarkdown, fortnightLabel, ownTokens, parseArguments, readReceipts } = require('../tools/fortnight');

const RUN = '11111111-1111-4111-8111-111111111111';
const FRESH = 'aaaaaaaa-0000-4000-8000-000000000001';
const SKEPTIC = 'bbbbbbbb-0000-4000-8000-000000000002';
const RESUMED = 'cccccccc-0000-4000-8000-000000000003';
const RESUMED2 = 'cccccccc-0000-4000-8000-000000000004';
const GATE = 'dddddddd-0000-4000-8000-000000000005';
const UNIMPORTED = 'dddddddd-0000-4000-8000-000000000006';
const NEVER = 'ffffffff-0000-4000-8000-000000000007';
const FAILED = 'ffffffff-0000-4000-8000-000000000008';
const LATE_SKEPTIC = 'eeeeeeee-0000-4000-8000-000000000009';
const UNIMPORTED_RESUME = 'cccccccc-0000-4000-8000-000000000014';
const REOPEN = 'aaaaaaaa-0000-4000-8000-000000000010';
const RESUMED3 = 'cccccccc-0000-4000-8000-000000000011';
const REOPEN2 = 'cccccccc-0000-4000-8000-000000000012';
const CLOSING = '99999999-0000-4000-8000-000000000013';
const BROKEN = '99999999-0000-4000-8000-000000000015';

function review(requestId, extra = {}) {
  return { requestId, runId: RUN, taskId: 'task-a', kind: 'code', host: 'codex', model: 'gpt-6-sol', continues: null, threadTokens: null, attempts: [{ status: 'complete', tokens: 1000 }], findings: [], closures: [], ...extra };
}

function resumed(requestId, continues, extra = {}) {
  return review(requestId, { continues: { kind: 'resumed', requestId: continues }, ...extra });
}

const F1 = { id: `${FRESH}:F1`, severity: 'critical', reviewRevision: 3, raisedBy: { requestId: FRESH }, validation: { verdict: 'confirmed' } };
const F2 = { id: `${FRESH}:F2`, severity: 'minor', reviewRevision: 3, raisedBy: { requestId: FRESH }, validation: { verdict: 'confirmed' } };
const G1 = { id: `${GATE}:G1`, severity: 'important', reviewRevision: 16, raisedBy: { requestId: GATE }, validation: { verdict: 'refuted' } };
const R1 = { id: `${REOPEN}:R1`, severity: 'minor', reviewRevision: 23, raisedBy: { requestId: REOPEN }, validation: { verdict: 'confirmed' } };

// Imported reviews carry their import revision; the resumed ones their closures.
const IMPORTED = [
  review(FRESH, { revision: 3, findings: [{ id: 'F1', severity: 'critical' }, { id: 'F2', severity: 'minor' }] }),
  resumed(RESUMED, FRESH, { revision: 8, closures: [{ id: F1.id, closed: false }] }),
  resumed(RESUMED2, RESUMED, { revision: 11, closures: [{ id: F1.id, closed: true }] }),
  review(GATE, { revision: 16, findings: [{ id: 'G1', severity: 'important' }] }),
  review(REOPEN, { revision: 23, findings: [{ id: 'R1', severity: 'minor' }] }),
  resumed(RESUMED3, REOPEN, { revision: 26, closures: [{ id: R1.id, closed: true }] }),
  resumed(REOPEN2, RESUMED3, { revision: 29 }),
];

function state(revision, status, extra = {}) {
  return JSON.stringify({ schema: 1, id: RUN, revision, status: 'running', createdAt: '2026-10-01T00:00:00Z', workers: [], tasks: [{ id: 'task-a', kind: 'code', status, checks: [], reviews: [], findings: [], ...extra.task }], ...extra.state });
}

function dispatch(requestId, role = 'reviewer', taskId = 'task-a') {
  return state(0, 'active', { state: { workers: [{ id: requestId, role, taskId }] } });
}

// A store under a fresh temporary root: the rows, by index, as the run's history and the final state as its current state.
function writeStore(rows, final) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fortnight-'));
  const runs = path.join(root, '.nightshift', 'runs');
  fs.mkdirSync(runs, { recursive: true });
  const store = path.join(runs, 'state.sqlite');
  const db = new DatabaseSync(store);
  db.exec('CREATE TABLE runs (id TEXT PRIMARY KEY, revision INTEGER, state TEXT); CREATE TABLE history (run_id TEXT, revision INTEGER, kind TEXT, recorded_at TEXT, state TEXT)');
  const insert = db.prepare('INSERT INTO history VALUES (?, ?, ?, ?, ?)');
  rows.forEach(([kind, recordedAt, row], revision) => insert.run(RUN, revision, kind, recordedAt, row));
  db.prepare('INSERT INTO runs VALUES (?, ?, ?)').run(RUN, rows.length - 1, JSON.stringify(final));
  db.close();
  return { root, runs, store };
}

function writeReceipts(runs, receipts) {
  for (const [id, receipt] of Object.entries(receipts)) {
    fs.mkdirSync(path.join(runs, 'reviews', id), { recursive: true });
    fs.writeFileSync(path.join(runs, 'reviews', id, 'receipt.json'), JSON.stringify(receipt));
  }
}

function fixture() {
  const rows = [
    ['created', '2026-10-01T00:00:00.000Z', state(0, 'pending')],
    ['start-task', '2026-10-01T01:00:00.000Z', state(1, 'active')],
    ['dispatch-started', '2026-10-01T01:10:00.000Z', dispatch(FRESH)],
    ['review', '2026-10-01T02:00:00.000Z', state(3, 'active')],
    ['dispatch-started', '2026-10-01T02:10:00.000Z', dispatch(SKEPTIC, 'skeptic')],
    ['validate', '2026-10-01T02:30:00.000Z', state(5, 'active')],
    ['repair', '2026-10-01T03:00:00.000Z', state(6, 'active', { task: { findings: [{ ...F1, repairRevision: 6 }, { ...F2, repairRevision: 6 }] } })],
    ['dispatch-started', '2026-10-01T03:10:00.000Z', dispatch(RESUMED)],
    ['review', '2026-10-01T03:30:00.000Z', state(8, 'active')],
    ['repair', '2026-10-01T04:00:00.000Z', state(9, 'active', { task: { findings: [{ ...F1, repairRevision: 9 }, { ...F2, repairRevision: 6 }] } })],
    ['dispatch-started', '2026-10-01T04:10:00.000Z', dispatch(RESUMED2)],
    ['review', '2026-10-01T04:30:00.000Z', state(11, 'active')],
    ['dispatch-started', '2026-10-01T04:40:00.000Z', dispatch(GATE)],
    ['dispatch-started', '2026-10-01T04:41:00.000Z', dispatch(UNIMPORTED)],
    ['dispatch-started', '2026-10-01T04:42:00.000Z', dispatch(NEVER)],
    ['dispatch-started', '2026-10-01T04:43:00.000Z', dispatch(FAILED)],
    ['review', '2026-10-01T05:00:00.000Z', state(16, 'active')],
    ['dispatch-started', '2026-10-01T05:05:00.000Z', dispatch(UNIMPORTED_RESUME)],
    ['dispatch-started', '2026-10-01T05:10:00.000Z', dispatch(LATE_SKEPTIC, 'skeptic')],
    ['validate', '2026-10-01T05:30:00.000Z', state(19, 'active')],
    ['dispose', '2026-10-01T06:00:00.000Z', state(20, 'active')],
    ['advance', '2026-10-01T07:00:00.000Z', state(21, 'complete')],
    ['dispatch-started', '2026-10-01T07:10:00.000Z', dispatch(REOPEN)],
    ['review', '2026-10-01T08:00:00.000Z', state(23, 'active')],
    ['repair', '2026-10-01T08:30:00.000Z', state(24, 'active', { task: { findings: [{ ...R1, repairRevision: 24 }] } })],
    ['dispatch-started', '2026-10-01T08:40:00.000Z', dispatch(RESUMED3)],
    ['review', '2026-10-01T09:00:00.000Z', state(26, 'active')],
    ['advance', '2026-10-01T10:00:00.000Z', state(27, 'complete')],
    ['dispatch-started', '2026-10-01T10:10:00.000Z', dispatch(REOPEN2)],
    ['review', '2026-10-01T11:00:00.000Z', state(29, 'active')],
    ['advance', '2026-10-02T01:00:00.000Z', state(30, 'complete')],
    ['dispatch-started', '2026-10-02T01:05:00.000Z', dispatch(CLOSING, 'reviewer', '#closing')],
    ['review', '2026-10-02T01:20:00.000Z', state(32, 'complete')],
    ['complete', '2026-10-02T01:30:00.000Z', state(33, 'complete')],
  ];
  const final = {
    ...JSON.parse(state(33, 'complete', { task: { findings: [{ ...F1, repairRevision: 9 }, { ...F2, repairRevision: 6 }, G1, { ...R1, repairRevision: 24 }], reviews: IMPORTED } })),
    status: 'complete',
    workers: [{ id: NEVER, role: 'reviewer', taskId: 'task-a', status: 'failed', phase: 'preparing' }, { id: FAILED, role: 'reviewer', taskId: 'task-a', status: 'failed', phase: 'launched' }],
    closing: { docs: { id: '#closing', kind: 'closing', reviews: [review(CLOSING, { revision: 32, taskId: '#closing', kind: 'docs' })], findings: [] } },
  };
  const { root, runs, store } = writeStore(rows, final);
  const receipts = {
    [FRESH]: review(FRESH, { threadTokens: 1000, findings: [{ id: 'F1', severity: 'critical' }, { id: 'F2', severity: 'minor' }] }),
    [SKEPTIC]: review(SKEPTIC, { kind: 'skeptic', threadTokens: 500, attempts: [{ status: 'complete', tokens: 500 }], findings: [{ id: F1.id, verdict: 'confirmed' }, { id: F2.id, verdict: 'confirmed' }] }),
    [RESUMED]: resumed(RESUMED, FRESH, { threadTokens: 1300, attempts: [{ status: 'complete', tokens: 300 }], closures: [{ id: F1.id, closed: false }] }),
    [RESUMED2]: resumed(RESUMED2, RESUMED, { threadTokens: 1650, attempts: [{ status: 'complete', tokens: 350 }], closures: [{ id: F1.id, closed: true }] }),
    [GATE]: review(GATE, { attempts: [{ status: 'complete', tokens: 2000 }], findings: [{ id: 'G1', severity: 'important' }] }),
    // A replacement is a fresh session, so its tokens count as fresh in the batch although it continues a lineage.
    [UNIMPORTED]: review(UNIMPORTED, { continues: { kind: 'replacement', requestId: FRESH }, attempts: [{ status: 'incomplete', tokens: 400 }] }),
    [LATE_SKEPTIC]: review(LATE_SKEPTIC, { kind: 'skeptic', attempts: [{ status: 'complete', tokens: 700 }], findings: [{ id: G1.id, verdict: 'refuted' }] }),
    [UNIMPORTED_RESUME]: resumed(UNIMPORTED_RESUME, GATE, { attempts: [{ status: 'incomplete', tokens: 250 }], closures: [{ id: G1.id, closed: true }] }),
    [REOPEN]: review(REOPEN, { threadTokens: 1200, attempts: [{ status: 'complete', tokens: 1200 }], findings: [{ id: 'R1', severity: 'minor' }] }),
    [RESUMED3]: resumed(RESUMED3, REOPEN, { threadTokens: 1520, attempts: [{ status: 'complete', tokens: 320 }], closures: [{ id: R1.id, closed: true }] }),
    [REOPEN2]: resumed(REOPEN2, RESUMED3, { threadTokens: 1670, attempts: [{ status: 'complete', tokens: 150 }] }),
    [CLOSING]: review(CLOSING, { taskId: '#closing', kind: 'docs', attempts: [{ status: 'complete', tokens: 600 }] }),
  };
  writeReceipts(runs, receipts);
  // A receipt whose write was interrupted is unreadable and reported as such.
  fs.mkdirSync(path.join(runs, 'reviews', BROKEN), { recursive: true });
  fs.writeFileSync(path.join(runs, 'reviews', BROKEN, 'receipt.json'), '{"requestId": "' + BROKEN);
  return { root, store };
}

test('the numbers of a run whose task was repaired three times, reopened twice, resumed once without import and closed with a closing review', () => {
  const { root, store } = fixture();
  try {
    const result = compute(store, { anchor: '2026-10-18' });
    assert.deepEqual(result.runs, { total: 1, completed: 1 });
    assert.deepEqual(result.receipts, { total: 12, onTheseRuns: 12, unreadable: 1, unreadableIds: [BROKEN] });
    assert.deepEqual(result.dispatches, { total: 14, withoutReceipt: 2, unknownWithoutReceipt: 1 });

    // Thread tokens are unknown for the task, since the chains ending at GATE's unimported resume and at the late skeptic were not measured.
    const [task, closing] = result.tokensPerTask.tasks;
    assert.deepEqual({ taskId: task.taskId, dispatches: task.dispatches, tokens: task.tokens, threadTokens: task.threadTokens, unknownAttempts: task.unknownAttempts }, { taskId: 'task-a', dispatches: 13, tokens: 1000 + 500 + 300 + 350 + 2000 + 400 + 250 + 700 + 1200 + 320 + 150, threadTokens: null, unknownAttempts: 1 });
    assert.deepEqual({ taskId: closing.taskId, kind: closing.kind, tokens: closing.tokens, unknownAttempts: closing.unknownAttempts }, { taskId: '#closing', kind: 'closing', tokens: 600, unknownAttempts: 0 });
    assert.deepEqual({ ...result.tokensPerTask.complete, partial: result.tokensPerTask.partial }, { count: 1, median: 600, p90: 600, max: 600, partial: 1 });

    const batches = result.tokensPerBatch.batches.map(batch => [batch.repairRevision, batch.open ? 'open' : batch.endRevision, batch.reachedFreshGate, batch.dispatches, batch.fresh, batch.resumed, batch.skeptic, batch.unknownAttempts]);
    assert.deepEqual(batches, [[6, 9, false, 1, 0, 300, 0, 0], [9, 16, true, 5, 2400, 350, 0, 1], [24, 'open', false, 0, 0, 0, 0, 0]]);
    assert.deepEqual({ ...result.tokensPerBatch.closed, reachedFreshGate: result.tokensPerBatch.reachedFreshGate, endedAtRepair: result.tokensPerBatch.endedAtRepair, open: result.tokensPerBatch.open, partial: result.tokensPerBatch.partial }, { count: 1, median: 300, p90: 300, max: 300, reachedFreshGate: 1, endedAtRepair: 1, open: 1, partial: 1 });
    assert.deepEqual(result.tokensPerBatch.shares, [['fresh', 2400], ['resumed', 650], ['skeptic', 0]]);

    assert.deepEqual(result.refutation.receipts, { confirmed: 2, refuted: 1, unverified: 0, total: 3, rate: 1 / 3 });
    assert.deepEqual(result.refutation.latest, { confirmed: 3, refuted: 1, unverified: 0, total: 4, rate: 0.25 });
    assert.deepEqual(result.minorOnly, { repairs: 3, known: 3, minorOnly: 1, share: 1 / 3 });

    assert.equal(result.elapsed.tasks.length, 1);
    assert.deepEqual({ hours: result.elapsed.tasks[0].hours, completions: result.elapsed.tasks[0].completions, reopened: result.elapsed.reopened, unknownStart: result.elapsed.unknownStart }, { hours: 24, completions: 3, reopened: 1, unknownStart: 0 });
    assert.deepEqual({ completions: result.elapsed.completions, after: result.elapsed.completionsAfterAnchor }, { completions: [{ fortnight: 'to 2026-10-04', count: 1 }, { fortnight: 'to 2026-10-18', count: 0 }], after: 0 });
    // An anchor before the completion lists the fortnights up to it and counts the later completion apart.
    const earlier = compute(store, { anchor: '2026-09-20' });
    assert.deepEqual({ completions: earlier.elapsed.completions, after: earlier.elapsed.completionsAfterAnchor }, { completions: [{ fortnight: 'to 2026-09-20', count: 0 }], after: 1 });
    assert.match(formatMarkdown(earlier), /completions by UTC date 0 to 2026-09-20, 1 after the anchor not listed/);

    const gate = result.freshGate;
    assert.deepEqual({ closures: gate.closures, withGate: gate.withGate, catches: gate.catches, unimported: gate.unimported }, { closures: 3, withGate: 2, catches: 1, unimported: 1 });
    assert.deepEqual(gate.entries.map(entry => [entry.requestId, entry.gateRequestId, entry.severeFindings]), [[RESUMED2, GATE, 1], [UNIMPORTED_RESUME, REOPEN, 0], [RESUMED3, null, null]]);

    const markdown = formatMarkdown(result);
    assert.match(markdown, /12 receipts, 12 on these runs, 1 receipt files unreadable, their tokens, verdicts and closures missing from the counts read from receipts; 14 dispatches of these runs \(registered, plus any receipt without a registration row\), 2 without a receipt, of which 1 may have launched a model/);
    assert.match(markdown, /\| 1 \| Tokens per completed task \| median 600, p90 600, max 600 over 1 tasks \(1 partial, 0 with no dispatch counted as 0\); Vibe apart, in its own accounting: median unknown, max unknown over 0 tasks that ran Vibe \(0 partial\) \|/);
    assert.match(markdown, /\| 2 \| Tokens per repair batch \| median 300, worst 300 over 1 batches, of 3 \(1 ended at a fresh assessment and 1 at the next repair; 1 open, 1 partial, 0 with no dispatch counted as 0\); measured tokens over the closed batches, their unknown attempts excluded and replacements counted as fresh sessions: fresh 2,400, resumed 650, skeptic 0; Vibe apart, in its own accounting: 0 over 0 batches that ran Vibe \(0 partial\) \|/);
    assert.match(markdown, /completions by UTC date 1 to 2026-10-04, 0 to 2026-10-18/);
    assert.match(markdown, /\| first run \| Fresh-gate catches after resumed closure \| 1 of 2 resumed closures .* \(1 resumed closures had no such fresh review; 1 of the 3 were never imported into run state\)/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a task completed and then reopened without completing again is left out of the elapsed row', () => {
  const rows = [
    ['created', '2026-10-01T00:00:00.000Z', state(0, 'pending')],
    ['start-task', '2026-10-01T01:00:00.000Z', state(1, 'active')],
    ['advance', '2026-10-01T03:00:00.000Z', state(2, 'complete')],
    ['block', '2026-10-01T04:00:00.000Z', state(3, 'active')],
  ];
  const { root, store } = writeStore(rows, JSON.parse(state(3, 'active')));
  try {
    const result = compute(store, { anchor: '2026-10-18' });
    assert.deepEqual({ elapsed: result.elapsed.tasks, tokens: result.tokensPerTask.tasks, completions: result.elapsed.completions }, { elapsed: [], tokens: [], completions: [{ fortnight: 'to 2026-10-18', count: 0 }] });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const CLOSING1 = '77777777-0000-4000-8000-000000000021';
const CLOSING2 = '77777777-0000-4000-8000-000000000022';
const CLOSING3 = '77777777-0000-4000-8000-000000000023';

test('closing reviews dropped from the current state by a re-recorded triage are read back from history', () => {
  const closing = (reviews, findings) => ({ state: { closing: { docs: { id: '#closing', kind: 'closing', reviews, findings } } } });
  const C1 = { id: `${CLOSING1}:C1`, severity: 'minor', validation: { verdict: 'confirmed' } };
  const first = review(CLOSING1, { revision: 2, taskId: '#closing', kind: 'docs', findings: [{ id: 'C1', severity: 'minor' }] });
  const second = resumed(CLOSING2, CLOSING1, { revision: 5, taskId: '#closing', kind: 'docs', closures: [{ id: C1.id, closed: true }] });
  const third = review(CLOSING3, { revision: 7, taskId: '#closing', kind: 'docs', findings: [{ id: 'C2', severity: 'important' }] });
  const rows = [
    ['created', '2026-10-01T00:00:00.000Z', state(0, 'pending', closing([], []))],
    ['dispatch-started', '2026-10-01T00:10:00.000Z', dispatch(CLOSING1, 'reviewer', '#closing')],
    ['review', '2026-10-01T01:00:00.000Z', state(2, 'pending', closing([first], [C1]))],
    ['repair', '2026-10-01T02:00:00.000Z', state(3, 'pending', closing([first], [{ ...C1, repairRevision: 3 }]))],
    ['dispatch-started', '2026-10-01T02:10:00.000Z', dispatch(CLOSING2, 'reviewer', '#closing')],
    ['review', '2026-10-01T03:00:00.000Z', state(5, 'pending', closing([first, second], [{ ...C1, repairRevision: 3 }]))],
    ['dispatch-started', '2026-10-01T03:10:00.000Z', dispatch(CLOSING3, 'reviewer', '#closing')],
    ['review', '2026-10-01T04:00:00.000Z', state(7, 'pending', closing([first, second, third], [{ ...C1, repairRevision: 3 }]))],
    ['triage', '2026-10-01T05:00:00.000Z', state(8, 'pending', closing([], []))],
    ['complete', '2026-10-01T06:00:00.000Z', state(9, 'pending', closing([], []))],
  ];
  // The current state is as a closing reset leaves it: no closing record, only the carried finding, until the next triage.
  const final = { ...JSON.parse(state(9, 'pending', closing([], []))), status: 'complete' };
  delete final.closing.docs;
  final.closing.carriedFindings = [{ ...C1, repairRevision: 3, pendingClosure: true }];
  const { root, runs, store } = writeStore(rows, final);
  writeReceipts(runs, {
    [CLOSING1]: review(CLOSING1, { taskId: '#closing', kind: 'docs', attempts: [{ status: 'complete', tokens: 100 }], findings: [{ id: 'C1', severity: 'minor' }] }),
    [CLOSING2]: resumed(CLOSING2, CLOSING1, { taskId: '#closing', kind: 'docs', attempts: [{ status: 'complete', tokens: 50 }], closures: [{ id: C1.id, closed: true }] }),
    [CLOSING3]: review(CLOSING3, { taskId: '#closing', kind: 'docs', attempts: [{ status: 'complete', tokens: 200 }], findings: [{ id: 'C2', severity: 'important' }] }),
  });
  try {
    const result = compute(store, { anchor: '2026-10-18' });
    assert.deepEqual(result.tokensPerTask.tasks.map(task => [task.taskId, task.dispatches, task.tokens, task.threadTokens]), [['#closing', 3, 350, null]]);
    assert.deepEqual(result.tokensPerBatch.batches.map(batch => [batch.repairRevision, batch.open ? 'open' : batch.endRevision, batch.reachedFreshGate, batch.fresh, batch.resumed]), [[3, 7, true, 200, 50]]);
    assert.deepEqual({ closures: result.freshGate.closures, withGate: result.freshGate.withGate, catches: result.freshGate.catches, unimported: result.freshGate.unimported }, { closures: 1, withGate: 1, catches: 1, unimported: 0 });
    assert.deepEqual(result.refutation.latest, { confirmed: 1, refuted: 0, unverified: 0, total: 1, rate: 0 });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const LEAD = '55555555-0000-4000-8000-000000000031';
const CLOSER = '55555555-0000-4000-8000-000000000032';
const JUDGE = '55555555-0000-4000-8000-000000000033';
const STAND_IN = '55555555-0000-4000-8000-000000000034';
const FINAL = '55555555-0000-4000-8000-000000000035';
const UNREGISTERED = '55555555-0000-4000-8000-000000000036';
const RESERVED = '55555555-0000-4000-8000-000000000037';
const FOREIGN = '55555555-0000-4000-8000-000000000038';
const OTHER_RUN = '22222222-2222-4222-8222-222222222222';

test('a batch splits its parts, a replacement is no fresh gate, thread chains sum at their ends, an unregistered receipt counts, a foreign one does not', () => {
  const X1 = { id: `${LEAD}:X1`, severity: 'important', reviewRevision: 3, raisedBy: { requestId: LEAD }, validation: { verdict: 'confirmed' } };
  const imported = [
    review(LEAD, { revision: 3, findings: [{ id: 'X1', severity: 'important' }] }),
    resumed(CLOSER, LEAD, { revision: 6, closures: [{ id: X1.id, closed: true }] }),
    review(STAND_IN, { revision: 9, continues: { kind: 'replacement', requestId: LEAD } }),
    review(FINAL, { revision: 11 }),
  ];
  const rows = [
    ['created', '2026-10-01T00:00:00.000Z', state(0, 'pending')],
    ['start-task', '2026-10-01T01:00:00.000Z', state(1, 'active')],
    ['dispatch-started', '2026-10-01T01:10:00.000Z', dispatch(LEAD)],
    ['review', '2026-10-01T02:00:00.000Z', state(3, 'active')],
    ['repair', '2026-10-01T03:00:00.000Z', state(4, 'active', { task: { findings: [{ ...X1, repairRevision: 4 }] } })],
    ['dispatch-started', '2026-10-01T03:10:00.000Z', dispatch(CLOSER)],
    ['review', '2026-10-01T04:00:00.000Z', state(6, 'active')],
    ['dispatch-started', '2026-10-01T04:10:00.000Z', dispatch(JUDGE, 'skeptic')],
    ['dispatch-started', '2026-10-01T04:20:00.000Z', dispatch(STAND_IN)],
    ['review', '2026-10-01T05:00:00.000Z', state(9, 'active')],
    ['dispatch-started', '2026-10-01T05:10:00.000Z', dispatch(FINAL)],
    ['review', '2026-10-01T06:00:00.000Z', state(11, 'active')],
    ['dispatch-started', '2026-10-01T06:10:00.000Z', dispatch(RESERVED)],
    ['repair', '2026-10-01T06:20:00.000Z', state(13, 'active', { task: { findings: [{ ...X1, repairRevision: 13 }] } })],
    ['repair', '2026-10-01T06:30:00.000Z', state(14, 'active', { task: { findings: [{ ...X1, repairRevision: 14 }] } })],
    ['advance', '2026-10-01T07:00:00.000Z', state(15, 'complete')],
    ['complete', '2026-10-01T07:30:00.000Z', state(16, 'complete')],
  ];
  // The reserved worker never launched a model, so its dispatch costs nothing; the two consecutive repairs make a batch with no dispatch.
  const final = { ...JSON.parse(state(16, 'complete', { task: { findings: [{ ...X1, repairRevision: 14 }], reviews: imported } })), status: 'complete' };
  final.workers = [{ id: RESERVED, role: 'reviewer', taskId: 'task-a', status: 'failed', phase: 'reserved' }];
  const { root, runs, store } = writeStore(rows, final);
  writeReceipts(runs, {
    [LEAD]: review(LEAD, { threadTokens: 1000, attempts: [{ status: 'complete', tokens: 100 }], findings: [{ id: 'X1', severity: 'important' }] }),
    [CLOSER]: resumed(CLOSER, LEAD, { threadTokens: 1300, attempts: [{ status: 'complete', tokens: 200 }], closures: [{ id: X1.id, closed: true }] }),
    [JUDGE]: review(JUDGE, { kind: 'skeptic', threadTokens: 50, attempts: [{ status: 'complete', tokens: 50 }], findings: [{ id: X1.id, verdict: 'confirmed' }, { id: `${LEAD}:X2`, verdict: 'unverified' }] }),
    [STAND_IN]: review(STAND_IN, { continues: { kind: 'replacement', requestId: LEAD }, threadTokens: 300, attempts: [{ status: 'complete', tokens: 300 }] }),
    [FINAL]: review(FINAL, { threadTokens: 400, attempts: [{ status: 'complete', tokens: 400 }] }),
    // A receipt with no registration row (an older store) still counts for the task, though it can be placed in no batch.
    [UNREGISTERED]: review(UNREGISTERED, { threadTokens: 90, attempts: [{ status: 'complete', tokens: 90 }] }),
    // A skeptic receipt of another store's context, sharing the reviews folder, counts for nothing here.
    [FOREIGN]: review(FOREIGN, { runId: OTHER_RUN, kind: 'skeptic', attempts: [{ status: 'complete', tokens: 5000 }], findings: [{ id: X1.id, verdict: 'refuted' }] }),
  });
  try {
    const result = compute(store, { anchor: '2026-10-18' });
    assert.deepEqual({ total: result.receipts.total, onTheseRuns: result.receipts.onTheseRuns, withoutReceipt: result.dispatches.withoutReceipt, unknownWithoutReceipt: result.dispatches.unknownWithoutReceipt }, { total: 7, onTheseRuns: 6, withoutReceipt: 1, unknownWithoutReceipt: 0 });
    const [task] = result.tokensPerTask.tasks;
    assert.deepEqual({ dispatches: task.dispatches, tokens: task.tokens, threadTokens: task.threadTokens, unknownAttempts: task.unknownAttempts }, { dispatches: 7, tokens: 100 + 200 + 50 + 300 + 400 + 90, threadTokens: 1300 + 50 + 300 + 400 + 90, unknownAttempts: 0 });
    const batches = result.tokensPerBatch.batches.map(batch => [batch.repairRevision, batch.open ? 'open' : batch.endRevision, batch.reachedFreshGate, batch.dispatches, batch.fresh, batch.resumed, batch.skeptic]);
    assert.deepEqual(batches, [[4, 11, true, 4, 300 + 400, 200, 50], [13, 14, false, 0, 0, 0, 0], [14, 'open', false, 0, 0, 0, 0]]);
    assert.deepEqual({ withoutDispatch: result.tokensPerBatch.withoutDispatch, tasksWithoutDispatch: result.tokensPerTask.withoutDispatch }, { withoutDispatch: 1, tasksWithoutDispatch: 0 });
    assert.deepEqual(result.freshGate.entries.map(entry => [entry.requestId, entry.gateRequestId, entry.severeFindings]), [[CLOSER, FINAL, 0]]);
    assert.deepEqual(result.refutation.receipts, { confirmed: 1, refuted: 0, unverified: 1, total: 2, rate: 0 });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a cumulative pre-3.3.3 Claude resume is corrected by its continued receipt, a replacement is not, and the unknown stays unknown', () => {
  const receipts = readReceipts(path.join(os.tmpdir(), 'fortnight-no-such-directory'));
  assert.equal(receipts.size, 0);
  const claude = (tokens, status = 'complete') => ({ host: 'claude', status, tokens });
  const fresh = { requestId: FRESH, host: 'claude', continues: null, threadTokens: null, attempts: [{ host: 'codex', status: 'failed', tokens: 100 }, claude(1500)] };
  const cumulative = { requestId: RESUMED, host: 'claude', continues: { kind: 'resumed', requestId: FRESH }, threadTokens: null, attempts: [claude(2300)] };
  const measured = { requestId: GATE, host: 'claude', continues: { kind: 'resumed', requestId: FRESH }, threadTokens: 4000, attempts: [claude(900), { host: 'codex', status: 'failed', tokens: null }] };
  const replacement = { requestId: REOPEN, host: 'claude', continues: { kind: 'replacement', requestId: FRESH }, threadTokens: null, attempts: [claude(1200)] };
  const unmeasured = { requestId: UNIMPORTED, host: 'claude', continues: null, threadTokens: null, attempts: [claude(null)] };
  const map = new Map([[FRESH, fresh], [RESUMED, cumulative], [GATE, measured], [REOPEN, replacement], [UNIMPORTED, unmeasured]]);
  assert.deepEqual(ownTokens(cumulative, map), { known: 800, unknownAttempts: 0, vibe: 0, vibeUnknownAttempts: 0, correction: 'cumulative' });
  assert.deepEqual(ownTokens({ ...cumulative, attempts: [{ host: 'codex', status: 'failed', tokens: 70 }, claude(2300)] }, map), { known: 870, unknownAttempts: 0, vibe: 0, vibeUnknownAttempts: 0, correction: 'cumulative' });
  assert.deepEqual(ownTokens(measured, map), { known: 900, unknownAttempts: 1, vibe: 0, vibeUnknownAttempts: 0, correction: null });
  assert.deepEqual(ownTokens(replacement, map), { known: 1200, unknownAttempts: 0, vibe: 0, vibeUnknownAttempts: 0, correction: null });
  assert.deepEqual(ownTokens({ ...cumulative, continues: { kind: 'resumed', requestId: 'missing' } }, map), { known: 0, unknownAttempts: 1, vibe: 0, vibeUnknownAttempts: 0, correction: 'uncorrectable' });
  assert.deepEqual(ownTokens({ ...cumulative, continues: { kind: 'resumed', requestId: UNIMPORTED } }, map), { known: 0, unknownAttempts: 1, vibe: 0, vibeUnknownAttempts: 0, correction: 'uncorrectable' });
  assert.deepEqual(ownTokens({ ...cumulative, attempts: [claude(null)] }, map), { known: 0, unknownAttempts: 1, vibe: 0, vibeUnknownAttempts: 0, correction: 'uncorrectable' });
  assert.deepEqual(ownTokens({ ...cumulative, attempts: [claude(900)] }, map), { known: 0, unknownAttempts: 1, vibe: 0, vibeUnknownAttempts: 0, correction: 'uncorrectable' });
  assert.deepEqual(ownTokens({ ...cumulative, attempts: [claude(500, 'failed')] }, map), { known: 0, unknownAttempts: 1, vibe: 0, vibeUnknownAttempts: 0, correction: 'uncorrectable' });
});

test('fortnights are labelled by the anchor they end on and the arguments are checked', () => {
  assert.equal(fortnightLabel('2026-10-18', '2026-10-18'), 'to 2026-10-18');
  assert.equal(fortnightLabel('2026-10-05', '2026-10-18'), 'to 2026-10-18');
  assert.equal(fortnightLabel('2026-10-04', '2026-10-18'), 'to 2026-10-04');
  assert.equal(fortnightLabel('2026-10-19', '2026-10-18'), 'to 2026-11-01');
  assert.throws(() => parseArguments(['--anchor', 'yesterday', 'store.sqlite']), /YYYY-MM-DD/);
  assert.throws(() => parseArguments(['--anchor', '2026-13-45', 'store.sqlite']), /calendar date/);
  assert.throws(() => parseArguments(['--anchor', '2026-10-20', 'store.sqlite']), /whole number of fortnights/);
  assert.deepEqual(parseArguments(['--anchor', '2026-11-01', 'store.sqlite']).anchor, '2026-11-01');
  assert.deepEqual(parseArguments(['--anchor', '2026-09-20', 'store.sqlite']).anchor, '2026-09-20');
  assert.throws(() => parseArguments(['store.sqlite', '--json']), /--json needs a value/);
  assert.throws(() => parseArguments(['store.sqlite', '--json', '--anchor', '2026-10-18']), /--json needs a value/);
  assert.throws(() => parseArguments([]), /Usage/);
  assert.throws(() => parseArguments(['one.sqlite', 'two.sqlite']), /one store path/);
  assert.deepEqual(parseArguments(['store.sqlite', '--json', 'out.json']), { anchor: '2026-10-18', json: 'out.json', store: 'store.sqlite' });
});

test('Vibe attempts are kept out of the Claude and Codex figures and reported as their own', () => {
  // Arrange
  const VIBE_LEAD = '77777777-0000-4000-8000-000000000041';
  const SOL_SKEPTIC = '77777777-0000-4000-8000-000000000042';
  const VIBE_STAND_IN = '77777777-0000-4000-8000-000000000043';
  const FALLBACK = '77777777-0000-4000-8000-000000000044';
  const VIBE_FAILED = '77777777-0000-4000-8000-000000000045';
  const V1 = { id: `${VIBE_LEAD}:V1`, severity: 'important', reviewRevision: 3, raisedBy: { requestId: VIBE_LEAD }, validation: { verdict: 'confirmed' } };
  const vibeReview = (requestId, extra) => review(requestId, { host: 'vibe', model: 'glm-5-3', ...extra });
  const imported = [vibeReview(VIBE_LEAD, { revision: 3, findings: [{ id: 'V1', severity: 'important' }] }), review(FALLBACK, { revision: 10 })];
  const rows = [
    ['created', '2026-10-01T00:00:00.000Z', state(0, 'pending')],
    ['start-task', '2026-10-01T01:00:00.000Z', state(1, 'active')],
    ['dispatch-started', '2026-10-01T01:10:00.000Z', dispatch(VIBE_LEAD)],
    ['review', '2026-10-01T02:00:00.000Z', state(3, 'active')],
    ['dispatch-started', '2026-10-01T02:10:00.000Z', dispatch(SOL_SKEPTIC, 'skeptic')],
    ['validate', '2026-10-01T02:30:00.000Z', state(5, 'active')],
    ['repair', '2026-10-01T03:00:00.000Z', state(6, 'active', { task: { findings: [{ ...V1, repairRevision: 6 }] } })],
    ['dispatch-started', '2026-10-01T03:10:00.000Z', dispatch(VIBE_STAND_IN)],
    ['dispatch-started', '2026-10-01T03:20:00.000Z', dispatch(FALLBACK)],
    ['dispatch-started', '2026-10-01T03:30:00.000Z', dispatch(VIBE_FAILED)],
    ['review', '2026-10-01T04:00:00.000Z', state(10, 'active')],
    ['advance', '2026-10-01T05:00:00.000Z', state(11, 'complete')],
    ['complete', '2026-10-01T06:00:00.000Z', state(12, 'complete')],
  ];
  const final = { ...JSON.parse(state(12, 'complete', { task: { reviews: imported, findings: [{ ...V1, repairRevision: 6 }] }, state: { workers: [{ id: VIBE_FAILED, role: 'reviewer', taskId: 'task-a', status: 'failed', phase: 'launched' }] } })), status: 'complete' };
  const { root, runs, store } = writeStore(rows, final);
  // A launched Vibe dispatch whose only attempt failed leaves its attempts in failure.json and no receipt.
  fs.mkdirSync(path.join(runs, 'reviews', VIBE_FAILED), { recursive: true });
  fs.writeFileSync(path.join(runs, 'reviews', VIBE_FAILED, 'failure.json'), JSON.stringify({ requestId: VIBE_FAILED, attempts: [{ host: 'vibe', model: 'glm-5-3', status: 'failed', tokens: 30 }], code: 'unusable-review' }));
  writeReceipts(runs, {
    [VIBE_LEAD]: vibeReview(VIBE_LEAD, { threadTokens: 500, attempts: [{ host: 'vibe', status: 'complete', tokens: 500 }] }),
    [SOL_SKEPTIC]: review(SOL_SKEPTIC, { kind: 'skeptic', threadTokens: 200, attempts: [{ host: 'codex', status: 'complete', tokens: 200 }] }),
    [VIBE_STAND_IN]: vibeReview(VIBE_STAND_IN, { continues: { kind: 'replacement', requestId: VIBE_LEAD }, threadTokens: 400, attempts: [{ host: 'vibe', status: 'complete', tokens: 400 }] }),
    [FALLBACK]: review(FALLBACK, { threadTokens: 700, attempts: [{ host: 'vibe', status: 'failed', tokens: 50 }, { host: 'codex', status: 'complete', tokens: 700 }] }),
  });

  try {
    // Act
    const result = compute(store, { anchor: '2026-10-18' });
    const markdown = formatMarkdown(result);

    // Assert
    assert.deepEqual(result.tokensPerTask.tasks.map(task => [task.dispatches, task.tokens, task.threadTokens, task.unknownAttempts, task.vibeTokens, task.vibeUnknownAttempts]), [[5, 900, 900, 0, 980, 0]]);
    assert.deepEqual(result.tokensPerTask.complete.median, 900);
    assert.deepEqual([result.tokensPerTask.vibe.count, result.tokensPerTask.vibe.median, result.tokensPerTask.vibe.partial], [1, 980, 0]);
    assert.deepEqual(result.tokensPerBatch.batches.map(batch => [batch.repairRevision, batch.endRevision, batch.fresh, batch.resumed, batch.skeptic, batch.tokens, batch.unknownAttempts, batch.vibe]), [[6, 10, 700, 0, 0, 700, 0, 480]]);
    assert.deepEqual(result.tokensPerBatch.shares, [['fresh', 700], ['resumed', 0], ['skeptic', 0]]);
    assert.equal(result.tokensPerBatch.vibe.total, 480);
    assert.match(markdown, /Vibe apart, in its own accounting: median 980, max 980 over 1 tasks that ran Vibe \(0 partial\)/);
    assert.match(markdown, /skeptic 0; Vibe apart, in its own accounting: 480 over 1 batches that ran Vibe \(0 partial\)/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

for (const host of ['claude', 'codex', undefined, 'vibe']) {
  test('known failed attempt spend keeps missing thread totals unknown for ' + (host ?? 'unknown host'), () => {
    // Arrange
    const rows = [
      ['created', '2026-10-01T00:00:00.000Z', state(0, 'pending')],
      ['start-task', '2026-10-01T01:00:00.000Z', state(1, 'active')],
      ['dispatch-started', '2026-10-01T01:10:00.000Z', dispatch(FRESH)],
      ['dispatch-started', '2026-10-01T01:20:00.000Z', dispatch(FAILED)],
      ['advance', '2026-10-01T02:00:00.000Z', state(4, 'complete')],
    ];
    const final = JSON.parse(state(4, 'complete', { state: { workers: [{ id: FAILED, role: 'reviewer', taskId: 'task-a', status: 'failed', phase: 'launched' }] } }));
    const { root, runs, store } = writeStore(rows, final);
    writeReceipts(runs, { [FRESH]: review(FRESH, { threadTokens: 100, attempts: [{ host: 'codex', status: 'complete', tokens: 100 }] }) });
    const folder = path.join(runs, 'reviews', FAILED);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'failure.json'), JSON.stringify({ requestId: FAILED, attempts: [{ host, status: 'failed', tokens: 30 }], code: 'unusable-review' }));

    try {
      // Act
      const result = compute(store, { anchor: '2026-10-18' });
      const [task] = result.tokensPerTask.tasks;

      // Assert
      assert.equal(task.tokens, host === 'vibe' ? 100 : 130);
      assert.equal(task.unknownAttempts, 0);
      assert.equal(task.threadTokens, host === 'vibe' ? 100 : null);
      assert.equal(task.vibeTokens, host === 'vibe' ? 30 : 0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}
