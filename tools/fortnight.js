#!/usr/bin/env node
'use strict';
// Fortnightly numbers over one project's run store and dispatch receipts, read-only: the store-derived rows of the fortnightly
// check in .nightshift/reports/assessment-worklist-20261018.md (tokens per completed task and per repair batch, skeptic
// refutation rate, minor-only repair cycles, elapsed time per task and completions per fortnight) and the first-run question of
// how often a fresh gate after a resumed closure raised a critical or important finding. The store's history rows carry a full
// state each, so only the metadata columns are read for every row and the state only for the rows whose transition can change
// a task's status, for repairs, which mark the findings they repaired, and for dispatch registrations, which place every
// dispatch at a revision; current states come from the runs table.

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DEFAULT_ANCHOR = '2026-10-18';
const DAY_MS = 86400000;
const FORTNIGHT_DAYS = 14;
const SEVERE = new Set(['critical', 'important']);
const CLOSING_TASK = '#closing';
const REVIEW_ROLES = new Set(['reviewer', 'skeptic']);
// The transitions whose saved state is read: every request action whose transition in internal/runtime/lifecycle.js assigns a
// task status (a review import and a block can reopen a completed task), plus repairs, which mark the findings they repaired.
const STATE_KINDS = ['created', 'add-spec-review', 'start-task', 'review', 'repair', 'advance', 'block', 'unblock'];
// The row that registers a dispatch appends its worker, named by the request id, to the state's worker list.
const DISPATCH_KIND = 'dispatch-started';

function quantile(values, share) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(share * sorted.length) - 1)];
}

function summary(values) {
  return { count: values.length, median: quantile(values, 0.5), p90: quantile(values, 0.9), max: values.length ? Math.max(...values) : null };
}

// Each receipt reduced to the fields the numbers read. A receipt file that cannot be parsed or names no request id is added to
// unreadable: the tokens, verdicts and closures it held are then missing from the counts read from receipts, while its
// registered dispatch still counts as an unknown attempt and its imported verdicts stay in run state.
function readReceipts(reviews, unreadable = []) {
  const receipts = new Map();
  if (!fs.existsSync(reviews)) return receipts;
  for (const entry of fs.readdirSync(reviews)) {
    const file = path.join(reviews, entry, 'receipt.json');
    if (!fs.existsSync(file)) continue;
    let receipt;
    try { receipt = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { unreadable.push(entry); continue; }
    if (typeof receipt?.requestId !== 'string') { unreadable.push(entry); continue; }
    receipts.set(receipt.requestId, {
      requestId: receipt.requestId, runId: receipt.runId ?? null, taskId: receipt.taskId ?? null, kind: receipt.kind ?? null, host: receipt.host ?? null, model: receipt.model ?? null,
      continues: receipt.continues ?? null, threadTokens: typeof receipt.threadTokens === 'number' ? receipt.threadTokens : null,
      attempts: (Array.isArray(receipt.attempts) ? receipt.attempts : []).map(attempt => ({ host: attempt.host ?? null, status: attempt.status ?? null, tokens: typeof attempt.tokens === 'number' ? attempt.tokens : null })),
      findings: (Array.isArray(receipt.findings) ? receipt.findings : []).map(finding => ({ id: finding.id, severity: finding.severity ?? null, verdict: finding.verdict ?? null })),
      closures: (Array.isArray(receipt.closures) ? receipt.closures : []).map(closure => ({ id: closure.id, closed: closure.closed === true })),
    });
  }
  return receipts;
}

function rawTokens(receipt) {
  const known = receipt.attempts.filter(attempt => attempt.tokens !== null).reduce((sum, attempt) => sum + attempt.tokens, 0);
  return { known, unknownAttempts: receipt.attempts.filter(attempt => attempt.tokens === null).length };
}

function isFresh(review) {
  return !review.continues;
}

function isResumed(review) {
  return review.continues?.kind === 'resumed';
}

// The tokens of a receipt's completed Claude attempt, the session a cumulative total covers; null when there is none or its
// tokens are unknown.
function claudeSessionTokens(receipt) {
  return receipt?.attempts.find(attempt => attempt.host === 'claude' && attempt.status === 'complete')?.tokens ?? null;
}

// A receipt's own tokens. Before 3.3.3 a resumed Claude attempt recorded the session's cumulative total and no threadTokens, so
// such a receipt's own usage is its total less the continued receipt's completed Claude attempt, the only attempt that session
// covers, and unknown when that receipt or attempt is missing, when either total is unmeasured, or when the cumulative total
// is below the prior one; a replacement is a session of its own and needs no correction. A null attempt total (a Codex
// output loop) stays unknown.
function ownTokens(receipt, receipts) {
  const raw = rawTokens(receipt);
  if (isResumed(receipt) && receipt.host === 'claude' && receipt.threadTokens === null) {
    const cumulative = claudeSessionTokens(receipt);
    const prior = claudeSessionTokens(receipts.get(receipt.continues.requestId));
    if (cumulative === null || prior === null || cumulative < prior) return { known: 0, unknownAttempts: Math.max(raw.unknownAttempts, 1), correction: 'uncorrectable' };
    return { known: raw.known - prior, unknownAttempts: raw.unknownAttempts, correction: 'cumulative' };
  }
  return { ...raw, correction: null };
}

function taskStatuses(state) {
  return new Map((state.tasks ?? []).map(task => [task.id, task.status]));
}

// The records that carry reviews and findings: every task, plus the closing record as a task of its own, whose findings
// include those a closing reset carries between closing records (lifecycle.js resetClosing), held outside the current record
// until the next triage.
function recordsOf(state) {
  const records = (state.tasks ?? []).map(task => ({ id: task.id, kind: task.kind, status: task.status, reviews: task.reviews ?? [], findings: task.findings ?? [] }));
  const closing = state.closing?.docs;
  const held = closing?.findings ?? [];
  const carried = (state.closing?.carriedFindings ?? []).filter(finding => !held.some(saved => saved.id === finding.id));
  if (closing && Array.isArray(closing.reviews)) records.push({ id: CLOSING_TASK, kind: 'closing', status: null, reviews: closing.reviews, findings: [...held, ...carried] });
  else if (carried.length) records.push({ id: CLOSING_TASK, kind: 'closing', status: null, reviews: [], findings: carried });
  return records;
}

// Closing reviews seen in the states read: a re-recorded triage starts a new closing record and drops the earlier one from the
// current state, so each run's closing reviews are collected from every state read as well as from the current state. A run's
// closing records are read as one record: the re-recorded triage carries the earlier record's unsettled findings into the new
// one, whose next closing review covers them, so that review is the fresh assessment that ends a batch begun in the earlier
// record.
function rememberClosingReviews(remembered, runId, state) {
  for (const review of state.closing?.docs?.reviews ?? []) {
    if (!remembered.has(runId)) remembered.set(runId, new Map());
    if (!remembered.get(runId).has(review.requestId)) remembered.get(runId).set(review.requestId, review);
  }
}

function closingRecordOf(run) {
  let record = run.records.find(candidate => candidate.id === CLOSING_TASK);
  if (!record) {
    record = { id: CLOSING_TASK, kind: 'closing', status: null, reviews: [], findings: [] };
    run.records.push(record);
  }
  return record;
}

// The final record of each review or skeptic worker, by request id, for dispatches that left no receipt.
function workersOf(state) {
  return new Map((state.workers ?? []).filter(worker => REVIEW_ROLES.has(worker.role)).map(worker => [worker.id, { status: worker.status ?? null, phase: worker.phase ?? null }]));
}

// The store is read inside one read transaction, so a run completing between two of the queries cannot leave the current
// states and the history out of step; the state-carrying rows are streamed, since together they run to hundreds of MiB.
function readStore(store) {
  const db = new DatabaseSync(store, { readOnly: true });
  let reading = false;
  try {
    db.exec('BEGIN');
    reading = true;
    const meta = db.prepare('SELECT run_id, revision, kind, recorded_at FROM history ORDER BY run_id, revision').all();
    const runs = db.prepare('SELECT id, state FROM runs').all().map(row => {
      const state = JSON.parse(row.state);
      return { id: row.id, status: state.status, createdAt: state.createdAt, records: recordsOf(state), workers: workersOf(state) };
    });
    const closingReviews = new Map();
    const transitions = [];
    for (const row of db.prepare(`SELECT run_id, revision, kind, recorded_at, state FROM history WHERE kind IN (${STATE_KINDS.map(() => '?').join(', ')}) ORDER BY run_id, revision`).iterate(...STATE_KINDS)) {
      const state = JSON.parse(row.state);
      rememberClosingReviews(closingReviews, row.run_id, state);
      transitions.push({
        runId: row.run_id, revision: row.revision, kind: row.kind, recordedAt: row.recorded_at,
        statuses: taskStatuses(state),
        repaired: row.kind === 'repair' ? recordsOf(state).flatMap(record => record.findings.filter(finding => finding.repairRevision === row.revision).map(finding => ({ taskId: record.id, id: finding.id, severity: finding.severity ?? null }))) : null,
      });
    }
    const dispatches = [];
    for (const row of db.prepare('SELECT run_id, revision, recorded_at, state FROM history WHERE kind = ? ORDER BY run_id, revision').iterate(DISPATCH_KIND)) {
      const worker = JSON.parse(row.state).workers?.at(-1);
      if (typeof worker?.id === 'string') dispatches.push({ runId: row.run_id, revision: row.revision, recordedAt: row.recorded_at, requestId: worker.id, taskId: worker.taskId ?? null, role: worker.role ?? null });
    }
    for (const run of runs) {
      const remembered = closingReviews.get(run.id);
      if (!remembered) continue;
      const record = closingRecordOf(run);
      for (const review of remembered.values()) if (!record.reviews.some(candidate => candidate.requestId === review.requestId)) record.reviews.push(review);
    }
    return { meta, runs, transitions, dispatches };
  } finally {
    if (reading) db.exec('COMMIT');
    db.close();
  }
}

// Every dispatch of each record, placed at its registration revision; a receipt whose dispatch has no registration row (a store
// older than the registration kind, or a receipt copied in) is kept without a revision, so it counts for the record's tokens
// but cannot be placed in a batch.
function dispatchesByRecord(dispatches, receipts) {
  const byRecord = new Map();
  const add = dispatch => {
    const key = `${dispatch.runId}\n${dispatch.taskId}`;
    if (!byRecord.has(key)) byRecord.set(key, []);
    byRecord.get(key).push(dispatch);
  };
  for (const dispatch of dispatches) if (dispatch.taskId) add(dispatch);
  const placed = new Set(dispatches.map(dispatch => dispatch.requestId));
  for (const receipt of receipts.values()) {
    if (receipt.runId && receipt.taskId && !placed.has(receipt.requestId)) add({ runId: receipt.runId, revision: null, recordedAt: null, requestId: receipt.requestId, taskId: receipt.taskId, role: null });
  }
  for (const list of byRecord.values()) list.sort((a, b) => (a.revision ?? Infinity) - (b.revision ?? Infinity));
  return byRecord;
}

// What a dispatch cost: its receipt's own tokens, or, without a receipt, nothing when its worker record says it never launched
// a model (its phase still reserved or preparing) and otherwise one unknown attempt. The part names the session kind: a
// replacement is a fresh session standing in for one that could not be resumed, so its tokens count as fresh, although it is
// no fresh assessment to the lifecycle.
function dispatchTokens(dispatch, run, receipts) {
  const receipt = receipts.get(dispatch.requestId);
  if (receipt) return { ...ownTokens(receipt, receipts), part: receipt.kind === 'skeptic' ? 'skeptic' : isResumed(receipt) ? 'resumed' : 'fresh', receipt };
  const launched = !['reserved', 'preparing'].includes(run.workers.get(dispatch.requestId)?.phase);
  return { known: 0, unknownAttempts: launched ? 1 : 0, correction: null, part: null, receipt: null };
}

// A sum that is unknown when any part is, or when there are no parts.
function sumOrNull(values) {
  return values.length && values.every(value => value !== null) ? values.reduce((sum, value) => sum + value, 0) : null;
}

function completeRecordKeys(runs) {
  return new Set(runs.flatMap(run => run.records.filter(record => record.kind === 'closing' ? run.status === 'complete' : record.status === 'complete').map(record => `${run.id}\n${record.id}`)));
}

// Tokens per completed task: every dispatch the task's run registered under that task id, fresh and resumed alike, plus any
// receipt on the task without a registration. Thread tokens count each session chain once, at its last receipt, and are
// unknown when any chain's last receipt did not measure them or a launched dispatch left no receipt.
function tokensPerTask(runs, byRecord, receipts) {
  const complete = completeRecordKeys(runs);
  const continuedByResume = new Set([...receipts.values()].filter(isResumed).map(receipt => receipt.continues.requestId));
  const tasks = [];
  for (const run of runs) {
    for (const record of run.records) {
      if (!complete.has(`${run.id}\n${record.id}`)) continue;
      const own = (byRecord.get(`${run.id}\n${record.id}`) ?? []).map(dispatch => dispatchTokens(dispatch, run, receipts));
      tasks.push({
        runId: run.id, taskId: record.id, kind: record.kind, dispatches: own.length,
        tokens: own.reduce((sum, entry) => sum + entry.known, 0),
        threadTokens: own.some(entry => !entry.receipt && entry.unknownAttempts) ? null : sumOrNull(own.filter(entry => entry.receipt && !continuedByResume.has(entry.receipt.requestId)).map(entry => entry.receipt.threadTokens)),
        unknownAttempts: own.reduce((sum, entry) => sum + entry.unknownAttempts, 0),
        corrected: own.filter(entry => entry.correction === 'cumulative').length,
      });
    }
  }
  return tasks;
}

// Elapsed time per completed task: from the transition that first made it active, normally start-task, to the advance that
// last completed it, read from the task statuses those transitions left behind; a task reopened and completed again counts
// once, over its whole span, with its completions counted, and a task reopened and not completed again is left out, as in
// the token row.
function elapsedPerTask(transitions, runs) {
  const complete = completeRecordKeys(runs);
  const previous = new Map();
  const spans = new Map();
  for (const transition of transitions) {
    const before = previous.get(transition.runId) ?? new Map();
    for (const [taskId, status] of transition.statuses) {
      const key = `${transition.runId}\n${taskId}`;
      const span = spans.get(key) ?? { runId: transition.runId, taskId, startedAt: null, completedAt: null, completions: 0 };
      if (status === 'active' && span.startedAt === null) span.startedAt = transition.recordedAt;
      if (status === 'complete' && before.get(taskId) !== 'complete') {
        span.completedAt = transition.recordedAt;
        span.completions += 1;
      }
      spans.set(key, span);
    }
    previous.set(transition.runId, transition.statuses);
  }
  return [...spans.values()].filter(span => span.completedAt !== null && complete.has(`${span.runId}\n${span.taskId}`)).map(span => ({ ...span, hours: span.startedAt ? (Date.parse(span.completedAt) - Date.parse(span.startedAt)) / 3600000 : null }));
}

function fortnightLabel(day, anchor) {
  const offset = Math.ceil((Date.parse(day + 'T00:00:00Z') - Date.parse(anchor + 'T00:00:00Z')) / DAY_MS / FORTNIGHT_DAYS);
  return 'to ' + new Date(Date.parse(anchor + 'T00:00:00Z') + offset * FORTNIGHT_DAYS * DAY_MS).toISOString().slice(0, 10);
}

// Runs completed per fortnight, by the UTC date of the complete transition: every fortnight from the first completion's to
// the anchor's is listed, a fortnight without completions as zero, and completions after the anchor are counted apart.
function completionsPerFortnight(meta, anchor) {
  const anchorEnd = Date.parse(anchor + 'T00:00:00Z');
  const counts = new Map();
  let afterAnchor = 0;
  for (const row of meta) {
    if (row.kind !== 'complete') continue;
    const day = row.recorded_at.slice(0, 10);
    if (Date.parse(day + 'T00:00:00Z') > anchorEnd) {
      afterAnchor += 1;
      continue;
    }
    const label = fortnightLabel(day, anchor);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const ends = [...counts.keys()].map(label => Date.parse(label.slice(3) + 'T00:00:00Z'));
  const fortnights = [];
  for (let end = ends.length ? Math.min(...ends) : anchorEnd; end <= anchorEnd; end += FORTNIGHT_DAYS * DAY_MS) {
    const fortnight = 'to ' + new Date(end).toISOString().slice(0, 10);
    fortnights.push({ fortnight, count: counts.get(fortnight) ?? 0 });
  }
  return { fortnights, afterAnchor };
}

function importedReviews(record) {
  return record.reviews.filter(review => typeof review.revision === 'number').sort((a, b) => a.revision - b.revision);
}

// Repair batches: a batch starts at a repair transition and holds every dispatch registered after it up to the import of the
// next fresh assessment on the same record, that assessment included, or up to the next repair when that comes first. The
// fresh assessment's own skeptics start after its import, so they fall outside, as the skeptics of the first assessment fall
// before the first batch. A batch no fresh assessment or repair has yet ended is open and left out of the figures.
function repairBatches(runs, transitions, byRecord, receipts) {
  const batches = [];
  for (const run of runs) {
    for (const record of run.records) {
      const repairs = transitions.filter(transition => transition.kind === 'repair' && transition.runId === run.id && transition.repaired.some(finding => finding.taskId === record.id)).map(transition => transition.revision);
      const reviews = importedReviews(record);
      const dispatches = byRecord.get(`${run.id}\n${record.id}`) ?? [];
      repairs.forEach((start, index) => {
        const nextRepair = repairs[index + 1] ?? Infinity;
        const fresh = reviews.find(review => review.revision > start && isFresh(review));
        const end = Math.min(nextRepair, fresh?.revision ?? Infinity);
        const batch = { runId: run.id, taskId: record.id, kind: record.kind, repairRevision: start, endRevision: Number.isFinite(end) ? end : null, reachedFreshGate: fresh !== undefined && fresh.revision <= end, fresh: 0, resumed: 0, skeptic: 0, unknownAttempts: 0, dispatches: 0 };
        if (!Number.isFinite(end)) {
          batches.push({ ...batch, open: true });
          return;
        }
        for (const dispatch of dispatches.filter(candidate => candidate.revision !== null && candidate.revision > start && candidate.revision <= end)) {
          const tokens = dispatchTokens(dispatch, run, receipts);
          if (tokens.part) batch[tokens.part] += tokens.known;
          batch.unknownAttempts += tokens.unknownAttempts;
          batch.dispatches += 1;
        }
        batches.push({ ...batch, open: false, tokens: batch.fresh + batch.resumed + batch.skeptic });
      });
    }
  }
  return batches;
}

// Skeptic verdicts over the receipts of this store's runs, and the latest verdict per finding in their current states; receipts
// of other stores' contexts that share the reviews folder are left out, as every other row leaves them out.
function refutationRate(runs, receipts) {
  const runIds = new Set(runs.map(run => run.id));
  const count = verdicts => {
    const tally = { confirmed: 0, refuted: 0, unverified: 0 };
    for (const verdict of verdicts) if (verdict in tally) tally[verdict] += 1;
    const total = tally.confirmed + tally.refuted + tally.unverified;
    return { ...tally, total, rate: total ? tally.refuted / total : null };
  };
  const everyVerdict = [...receipts.values()].filter(receipt => receipt.kind === 'skeptic' && runIds.has(receipt.runId)).flatMap(receipt => receipt.findings.map(finding => finding.verdict));
  const latestVerdict = runs.flatMap(run => run.records.flatMap(record => record.findings.map(finding => finding.validation?.verdict).filter(Boolean)));
  return { receipts: count(everyVerdict), latest: count(latestVerdict) };
}

function minorOnlyCycles(transitions) {
  const repairs = transitions.filter(transition => transition.kind === 'repair');
  const known = repairs.filter(transition => transition.repaired.length);
  const minorOnly = known.filter(transition => transition.repaired.every(finding => finding.severity === 'minor'));
  return { repairs: repairs.length, known: known.length, minorOnly: minorOnly.length, share: known.length ? minorOnly.length / known.length : null };
}

// Fresh-gate catches after resumed closure: each resumed lead whose receipt confirmed at least one closure, and whether the
// next fresh review of the same kind on the same record, imported after the resumed review was (or, when it never was, after
// its dispatch), raised a critical or important finding.
function freshGateCatches(runs, byRecord, receipts) {
  const closures = [];
  for (const run of runs) {
    for (const record of run.records) {
      const reviews = importedReviews(record);
      for (const dispatch of byRecord.get(`${run.id}\n${record.id}`) ?? []) {
        const receipt = receipts.get(dispatch.requestId);
        if (!receipt || receipt.kind === 'skeptic' || !isResumed(receipt) || !receipt.closures.some(closure => closure.closed)) continue;
        const imported = reviews.find(review => review.requestId === receipt.requestId);
        const after = imported?.revision ?? dispatch.revision;
        const gate = after === null ? undefined : reviews.find(candidate => candidate.revision > after && isFresh(candidate) && (candidate.kind ?? null) === receipt.kind);
        closures.push({ runId: run.id, taskId: record.id, requestId: receipt.requestId, imported: imported !== undefined, gateRequestId: gate?.requestId ?? null, severeFindings: gate ? (gate.findings ?? []).filter(finding => SEVERE.has(finding.severity)).length : null });
      }
    }
  }
  return { closures: closures.length, withGate: closures.filter(entry => entry.gateRequestId).length, catches: closures.filter(entry => entry.severeFindings > 0).length, unimported: closures.filter(entry => !entry.imported).length, entries: closures };
}

function compute(store, options = {}) {
  const anchor = options.anchor ?? DEFAULT_ANCHOR;
  const reviews = options.reviews ?? path.join(path.dirname(store), 'reviews');
  const { meta, runs, transitions, dispatches } = readStore(store);
  const unreadable = [];
  const receipts = readReceipts(reviews, unreadable);
  const runIds = new Set(runs.map(run => run.id));
  const byRecord = dispatchesByRecord(dispatches.filter(dispatch => runIds.has(dispatch.runId)), new Map([...receipts].filter(([, receipt]) => runIds.has(receipt.runId))));
  const placed = [...byRecord.values()].flat();
  const costs = placed.map(dispatch => dispatchTokens(dispatch, runs.find(run => run.id === dispatch.runId), receipts));
  const tasks = tokensPerTask(runs, byRecord, receipts);
  const elapsed = elapsedPerTask(transitions, runs);
  const completions = completionsPerFortnight(meta, anchor);
  const batches = repairBatches(runs, transitions, byRecord, receipts);
  const closedBatches = batches.filter(batch => !batch.open);
  return {
    store, reviews, anchor, readAt: new Date().toISOString(),
    runs: { total: runs.length, completed: runs.filter(run => run.status === 'complete').length },
    receipts: { total: receipts.size, onTheseRuns: [...receipts.values()].filter(receipt => runIds.has(receipt.runId)).length, unreadable: unreadable.length, unreadableIds: unreadable },
    dispatches: { total: placed.length, withoutReceipt: costs.filter(cost => !cost.receipt).length, unknownWithoutReceipt: costs.filter(cost => !cost.receipt && cost.unknownAttempts).length },
    tokensPerTask: { tasks, complete: summary(tasks.filter(task => !task.unknownAttempts).map(task => task.tokens)), partial: tasks.filter(task => task.unknownAttempts).length, withoutDispatch: tasks.filter(task => task.dispatches === 0).length },
    tokensPerBatch: { batches, closed: summary(closedBatches.filter(batch => !batch.unknownAttempts).map(batch => batch.tokens)), reachedFreshGate: closedBatches.filter(batch => batch.reachedFreshGate).length, endedAtRepair: closedBatches.filter(batch => !batch.reachedFreshGate).length, open: batches.length - closedBatches.length, partial: closedBatches.filter(batch => batch.unknownAttempts).length, withoutDispatch: closedBatches.filter(batch => batch.dispatches === 0).length, shares: ['fresh', 'resumed', 'skeptic'].map(part => [part, closedBatches.reduce((sum, batch) => sum + batch[part], 0)]) },
    refutation: refutationRate(runs, receipts),
    minorOnly: minorOnlyCycles(transitions),
    elapsed: { tasks: elapsed, hours: summary(elapsed.filter(task => task.hours !== null).map(task => task.hours)), unknownStart: elapsed.filter(task => task.hours === null).length, reopened: elapsed.filter(task => task.completions > 1).length, completions: completions.fortnights, completionsAfterAnchor: completions.afterAnchor },
    freshGate: freshGateCatches(runs, byRecord, receipts),
  };
}

const number = value => value === null ? 'unknown' : Math.round(value).toLocaleString('en-US');
const percent = value => value === null ? 'unknown' : `${(value * 100).toFixed(1)}%`;
const hours = value => value === null ? 'unknown' : `${value.toFixed(1)} h`;

function formatMarkdown(result) {
  const lines = [];
  lines.push(`# Fortnightly numbers from ${result.store}`, '');
  lines.push(`Read ${result.readAt.slice(0, 10)}: ${result.runs.total} runs, ${result.runs.completed} completed; ${result.receipts.total} receipts, ${result.receipts.onTheseRuns} on these runs, ${result.receipts.unreadable} receipt files unreadable, their tokens, verdicts and closures missing from the counts read from receipts; ${result.dispatches.total} dispatches registered by these runs, ${result.dispatches.withoutReceipt} without a receipt, of which ${result.dispatches.unknownWithoutReceipt} may have launched a model and so cost an unknown amount. Medians and ninetieth percentiles are nearest rank. Token figures sum each receipt's own attempt tokens; a task or batch with an attempt whose tokens are unknown is left out of the figures and counted as partial.`, '');
  lines.push('| # | Number | Reading |', '| --- | --- | --- |');
  const task = result.tokensPerTask;
  lines.push(`| 1 | Tokens per completed task | median ${number(task.complete.median)}, p90 ${number(task.complete.p90)}, max ${number(task.complete.max)} over ${task.complete.count} tasks (${task.partial} partial, ${task.withoutDispatch} with no dispatch counted as 0) |`);
  const batch = result.tokensPerBatch;
  const shares = batch.shares.map(([part, tokens]) => `${part} ${number(tokens)}`).join(', ');
  lines.push(`| 2 | Tokens per repair batch | median ${number(batch.closed.median)}, worst ${number(batch.closed.max)} over ${batch.closed.count} batches, of ${batch.batches.length} (${batch.reachedFreshGate} ended at a fresh assessment and ${batch.endedAtRepair} at the next repair; ${batch.open} open, ${batch.partial} partial, ${batch.withoutDispatch} with no dispatch counted as 0); measured tokens over the closed batches, their unknown attempts excluded and replacements counted as fresh sessions: ${shares} |`);
  const refutation = result.refutation;
  lines.push(`| 3 | Skeptic refutation rate | ${percent(refutation.receipts.rate)} of ${refutation.receipts.total} verdicts in skeptic receipts (${refutation.receipts.refuted} refuted, ${refutation.receipts.confirmed} confirmed, ${refutation.receipts.unverified} unverified); ${percent(refutation.latest.rate)} of the ${refutation.latest.total} latest verdicts in run state |`);
  const minor = result.minorOnly;
  lines.push(`| 4 | Minor-only repair cycles | ${percent(minor.share)} (${minor.minorOnly} of ${minor.known} repair transitions with their findings recorded, of ${minor.repairs}) |`);
  const elapsed = result.elapsed;
  lines.push(`| 7 | Elapsed time per completed task, and runs completed per fortnight | median ${hours(elapsed.hours.median)}, p90 ${hours(elapsed.hours.p90)}, max ${hours(elapsed.hours.max)} over ${elapsed.hours.count} tasks (${elapsed.unknownStart} without a recorded start, ${elapsed.reopened} completed more than once); completions by UTC date ${elapsed.completions.map(entry => `${entry.count} ${entry.fortnight}`).join(', ')}${elapsed.completionsAfterAnchor ? `, ${elapsed.completionsAfterAnchor} after the anchor not listed` : ''} |`);
  const gate = result.freshGate;
  lines.push(`| first run | Fresh-gate catches after resumed closure | ${gate.catches} of ${gate.withGate} resumed closures followed by a fresh review of the same kind raised a critical or important finding (${gate.closures - gate.withGate} resumed closures had no such fresh review; ${gate.unimported} of the ${gate.closures} were never imported into run state) |`);
  lines.push('', '## Completed tasks', '', '| Run | Task | Kind | Dispatches | Tokens | Thread tokens | Unknown attempts | Elapsed |', '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |');
  const elapsedByTask = new Map(elapsed.tasks.map(entry => [`${entry.runId}\n${entry.taskId}`, entry.hours]));
  for (const entry of task.tasks) lines.push(`| ${entry.runId.slice(0, 8)} | ${entry.taskId} | ${entry.kind} | ${entry.dispatches} | ${number(entry.tokens)} | ${number(entry.threadTokens)} | ${entry.unknownAttempts} | ${hours(elapsedByTask.get(`${entry.runId}\n${entry.taskId}`) ?? null)} |`);
  lines.push('', '## Repair batches', '', '| Run | Task | Repair revision | End revision | Fresh gate | Dispatches | Fresh | Resumed | Skeptic | Total |', '| --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: |');
  for (const entry of batch.batches) lines.push(`| ${entry.runId.slice(0, 8)} | ${entry.taskId} | ${entry.repairRevision} | ${entry.open ? 'open' : entry.endRevision} | ${entry.open ? '' : entry.reachedFreshGate ? 'yes' : 'next repair first'} | ${entry.dispatches} | ${number(entry.fresh)} | ${number(entry.resumed)} | ${number(entry.skeptic)} | ${entry.open ? '' : number(entry.tokens)}${entry.unknownAttempts ? ' partial' : ''} |`);
  return lines.join('\n') + '\n';
}

// The command line keeps the anchor on the baseline's grid, so every reading's fortnights keep the same boundaries; compute
// itself takes any anchor.
function onBaselineGrid(anchor) {
  return Number.isInteger((Date.parse(anchor + 'T00:00:00Z') - Date.parse(DEFAULT_ANCHOR + 'T00:00:00Z')) / (FORTNIGHT_DAYS * DAY_MS));
}

function isCalendarDate(value) {
  const time = Date.parse(value + 'T00:00:00Z');
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function parseArguments(argv) {
  const options = { anchor: DEFAULT_ANCHOR, json: null, store: null };
  const valueOf = index => {
    const value = argv[index];
    if (value === undefined || value.startsWith('--')) throw new Error(`${argv[index - 1]} needs a value`);
    return value;
  };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--anchor') options.anchor = valueOf(++index);
    else if (argument === '--json') options.json = valueOf(++index);
    else if (argument.startsWith('--')) throw new Error(`Unknown option ${argument}`);
    else options.store = argument;
  }
  if (!options.store) throw new Error('Usage: node tools/fortnight.js <path to state.sqlite> [--anchor YYYY-MM-DD] [--json <file>]');
  if (!isCalendarDate(options.anchor)) throw new Error('--anchor takes a calendar date as YYYY-MM-DD');
  if (!onBaselineGrid(options.anchor)) throw new Error(`--anchor must be ${DEFAULT_ANCHOR} plus or minus a whole number of fortnights`);
  return options;
}

if (require.main === module) {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  const result = compute(path.resolve(options.store), { anchor: options.anchor });
  if (options.json) fs.writeFileSync(path.resolve(options.json), JSON.stringify(result, null, 2) + '\n');
  process.stdout.write(formatMarkdown(result));
}

module.exports = { CLOSING_TASK, compute, dispatchesByRecord, elapsedPerTask, formatMarkdown, fortnightLabel, freshGateCatches, minorOnlyCycles, ownTokens, parseArguments, readReceipts, readStore, refutationRate, repairBatches, tokensPerTask };
