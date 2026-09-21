'use strict';

const fs = require('node:fs');
const { hash, projectFile, snapshot } = require('./evidence');
const { requireCondition, text } = require('./store');
const { workerIsActive } = require('./workers');
const { codexModelContradiction } = require('./hosts');

const nonempty = value => typeof value === 'string' && value.trim().length > 0;

function correlated(value, state, worker) {
  try {
    const report = typeof value === 'string' ? JSON.parse(value) : value;

    return report?.runId === state.id && report.requestId === worker.id;
  } catch {
    return false;
  }
}

function claudeTerminal(events, state, worker) {
  const relevant = events.filter(event => event.session_id === worker.session);
  const terminal = relevant.findLast(event => event.type === 'result');
  if (!terminal || relevant.at(-1) !== terminal || terminal.subtype !== 'success' || terminal.is_error !== false) return null;
  const authors = relevant.filter(event => event.type === 'assistant' && nonempty(event.message?.model) && event.message.model !== '<synthetic>');
  if (authors.length === 0 || worker.model && authors.some(event => event.message.model !== worker.model)) return null;
  if (!correlated(terminal.structured_output ?? terminal.result, state, worker)) return null;

  return { source: 'claude-result', terminalState: terminal.subtype, nativeResultId: terminal.uuid ?? null };
}

function codexTerminal(events, state, worker) {
  const opening = events.find(event => event.result?.thread?.id === worker.session && nonempty(event.result.model));
  if (!opening || worker.model && opening.result.model !== worker.model) return null;
  if (events.some(event => codexModelContradiction(event, worker.session, worker.model ?? opening.result.model))) return null;
  const relevant = events.filter(event => event.params?.threadId === worker.session);
  const goal = relevant.findLast(event => ['thread/goal/updated', 'thread/goal/cleared'].includes(event.method));
  if (goal?.method === 'thread/goal/updated' && goal.params.goal?.status !== 'complete') return null;
  if (relevant.some(event => event.method === 'model/rerouted')) return null;
  const terminalIndex = relevant.findLastIndex(event => event.method === 'turn/completed');
  const terminal = relevant[terminalIndex];
  if (!terminal || terminal.params.turn?.status !== 'completed' || !nonempty(terminal.params.turn.id)) return null;
  if (relevant.slice(terminalIndex + 1).some(event => event.method === 'turn/started' || event.method.startsWith('item/') || event.method === 'thread/status/changed' && !['idle', 'notLoaded'].includes(event.params.status?.type))) return null;
  const message = relevant.slice(0, terminalIndex).findLast(event => event.method === 'item/completed' && event.params.turnId === terminal.params.turn.id && event.params.item?.type === 'agentMessage');
  if (!message || !correlated(message.params.item.text, state, worker)) return null;

  return { source: 'codex-turn', terminalState: terminal.params.turn.status, nativeResultId: terminal.params.turn.id };
}

function unmanagedNativeWorker(worker) {
  return worker.role !== 'operation' && !worker.helperProcess && !worker.artifactDirectory && worker.pid === undefined && worker.runnerPid === undefined;
}

function nativeEvidenceRequests(state, request) {
  const entries = request.workerEvidence ?? [];
  requireCondition(request.workerEvidence !== null && Array.isArray(entries) && entries.length <= state.workers.length, 'invalid-worker-evidence', 'Worker evidence is an optional bounded array');
  const selected = new Map();
  for (const entry of entries) {
    text(entry?.workerId, 'workerEvidence.workerId');
    text(entry.path, 'workerEvidence.path');
    const worker = state.workers.find(worker => worker.id === entry.workerId);
    requireCondition(worker && workerIsActive(worker) && unmanagedNativeWorker(worker) && !selected.has(worker.id), 'invalid-worker-evidence', 'Native evidence must name each nonterminal in-host worker at most once');
    requireCondition(entry.path.startsWith('.nightshift/runs/worker-evidence/'), 'invalid-worker-evidence', 'Preserve native event exports under .nightshift/runs/worker-evidence');
    selected.set(worker.id, entry.path);
  }

  return selected;
}

function nativeWorkerTermination(root, relative, worker, state) {
  if (!relative || !['claude', 'codex'].includes(worker.host)) return null;
  try {
    const file = projectFile(root, relative);
    if (fs.statSync(file).size > 32 * 1024 * 1024) return null;
    const before = snapshot(root, [relative]);
    const bytes = fs.readFileSync(file);
    if (bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191) return null;
    if (hash(bytes) !== before.files[0].sha256) return null;
    const events = bytes.toString('utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
    const terminal = worker.host === 'claude' ? claudeTerminal(events, state, worker) : codexTerminal(events, state, worker);
    if (!terminal || snapshot(root, [relative]).digest !== before.digest) return null;

    return { workerId: worker.id, kind: 'native-terminal-result', host: worker.host, session: worker.session, path: relative, sha256: before.files[0].sha256, runId: state.id, requestId: worker.id, observedAt: new Date().toISOString(), ...terminal };
  } catch {
    // Missing, malformed, changing or unattributable native evidence remains unknown.
    return null;
  }
}

module.exports = { nativeEvidenceRequests, nativeWorkerTermination };
