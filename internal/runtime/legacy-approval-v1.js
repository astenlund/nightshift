'use strict';

const { createHash } = require('node:crypto');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');

const HASH = /^[a-f0-9]{64}$/;
const ACTIVE_INDEXES = new Set(['.nightshift/FEATURES.md', '.nightshift/BUGS.md', '.nightshift/QUICK_WINS.md', '.nightshift/PATTERNS.md']);
const ACTIVE_RECORD_DIRECTORIES = ['.nightshift/features/', '.nightshift/bugs/', '.nightshift/patterns/'];
const MEMBER_KEYS = ['id', 'revision', 'status', 'objective', 'stop', 'hold', 'classification', 'selected', 'retirement', 'stateHash', 'historyHash', 'workers', 'incompleteTasks', 'closing', 'report', 'followups'];

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));

  return value;
}

function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value)) ?? 'undefined').digest('hex');
}

function savedReportHash(evidence) {
  return typeof evidence?.sha256 === 'string' && HASH.test(evidence.sha256) ? evidence.sha256 : null;
}

function validReportDelivery(state, savedHash) {
  const delivery = state.closing?.reportDelivery;
  const recordedBy = delivery?.recordedBy;

  return Boolean(typeof savedHash === 'string' && savedHash.length > 0 && delivery && typeof delivery === 'object' && !Array.isArray(delivery) && delivery.sha256 === savedHash && typeof delivery.authority === 'string' && delivery.authority.trim().length > 0 && Number.isSafeInteger(delivery.revision) && delivery.revision >= 0 && delivery.revision <= state.revision && (recordedBy === undefined || recordedBy && ['claude', 'codex'].includes(recordedBy.host) && typeof recordedBy.session === 'string' && recordedBy.session.length > 0));
}

function closingStage(state) {
  if (!state.closing?.retrospectiveEvidence) return 'retrospective';
  if (state.handover && !state.closing?.reportEvidence) return 'report';

  return state.closing.triageEvidence ? 'complete' : 'triage';
}

function projection(state) {
  const evidence = state.closing?.reportEvidence ?? null;
  const hash = savedReportHash(evidence);

  return {
    objective: state.objective ?? null,
    stop: state.stop ?? null,
    hold: state.hold ?? null,
    workers: state.workers.map(worker => ({ id: worker.id ?? null, status: worker.status, active: !['complete', 'failed', 'stopped'].includes(worker.status) })),
    incompleteTasks: state.tasks.filter(task => task.status !== 'complete'),
    closing: { stage: closingStage(state), report: { recorded: Boolean(evidence), delivered: validReportDelivery(state, hash), path: evidence?.path ?? null }, retrospective: Boolean(state.closing?.retrospectiveEvidence), triage: Boolean(state.closing?.triageEvidence), saved: state.closing ?? null },
    followups: (state.followups ?? []).filter(item => item.status !== 'resolved'),
  };
}

function matches(state, member) {
  return Object.entries(projection(state)).every(([key, value]) => isDeepStrictEqual(member[key], value));
}

function reportValid(state, report, member) {
  if (!exactKeys(report, ['kind', 'sha256'])) return false;
  const savedHash = savedReportHash(state.closing?.reportEvidence ?? null);
  const delivered = validReportDelivery(state, savedHash);
  const owed = (Boolean(state.handover) || state.closing?.reportEvidence != null) && !delivered;
  const observed = member.report;
  if (!exactKeys(observed, ['owed', 'savedHash', 'file']) || !exactKeys(observed.file, ['status', 'sha256', 'reason']) || report.sha256 !== savedHash || observed.savedHash !== savedHash || observed.owed !== owed) return false;
  if (report.kind === 'none') return !owed && savedHash === null;
  if (report.kind === 'already-delivered') return delivered;
  if (report.kind === 'confirmed') return owed && observed.file.status === 'present' && observed.file.sha256 === savedHash;

  return report.kind === 'waived' && owed;
}

function safeDestination(destination) {
  if (!destination || typeof destination.path !== 'string' || destination.path.length === 0 || destination.path.length > 1024 || !(destination.anchor === null || typeof destination.anchor === 'string' && destination.anchor.length > 0)) return false;
  const relative = destination.path;
  if (path.posix.isAbsolute(relative) || path.win32.isAbsolute(relative) || relative.includes(String.fromCharCode(92))) return false;
  for (const part of relative.split('/')) {
    if (!part || part === '.' || part === '..' || part.endsWith('.') || part.endsWith(' ') || [...part].some(character => character.codePointAt(0) < 32 || '<>:"|?*'.includes(character))) return false;
    const base = part.split('.')[0].toLowerCase();
    if (['con', 'prn', 'aux', 'nul'].includes(base) || ['com', 'lpt'].some(prefix => base.startsWith(prefix) && base.length === 4 && '123456789'.includes(base[3]))) return false;
  }
  if (!(ACTIVE_INDEXES.has(relative) || ACTIVE_RECORD_DIRECTORIES.some(directory => relative.startsWith(directory) && relative.endsWith('.md')))) return false;

  return destination.anchor !== null || !ACTIVE_INDEXES.has(relative);
}

function followupsShape(state, choices, member) {
  const pending = (state.followups ?? []).filter(item => item.status !== 'resolved');
  if (!Array.isArray(member.followups) || !isDeepStrictEqual(member.followups, pending) || !Array.isArray(choices) || choices.length !== pending.length) return false;
  const byId = new Map(choices.map(choice => [choice?.id, choice]));
  if (byId.size !== pending.length) return false;
  for (const item of pending) {
    const choice = byId.get(item.id);
    if (!exactKeys(choice, ['id', 'sourceHash', 'disposition', 'destination']) || choice.sourceHash !== fingerprint(item)) return false;
    if (choice.disposition === 'tracked') {
      if (!exactKeys(choice.destination, ['path', 'anchor', 'entryHash']) || !safeDestination(choice.destination) || !HASH.test(choice.destination.entryHash)) return false;
    } else if (choice.disposition !== 'dismissed' || choice.destination !== null) return false;
  }

  return true;
}

module.exports = { MEMBER_KEYS, followupsShape, matches, projection, reportValid };
