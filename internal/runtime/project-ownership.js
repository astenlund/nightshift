'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { requireCondition } = require('./errors');
const { referenceId } = require('./review-inventory');
const { workerIsActive } = require('./workers');
const { projectFile } = require('./evidence');

// Device names Windows reserves in every directory, with or without an extension, superscript digits included.
const WINDOWS_DEVICE = /^(CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[0-9\u00b9\u00b2\u00b3]|LPT[0-9\u00b9\u00b2\u00b3])(\..*)?$/i;

// On Windows one file can be named by several spellings: a trailing dot or space is dropped, a colon opens NTFS stream syntax
// or a drive-relative form, and an 8.3 short name aliases its long name. Any of them could hold a second reservation on an owned
// file, so ownership admits only ordinary spellings: no such segment, no device name, and every existing component spelled as the
// filesystem names it, apart from case. A missing component ends the comparison; any other resolution failure counts as an alias.
function windowsAlias(root, target) {
  const segments = target.split('/');
  if (segments.some(segment => /[. ]$/.test(segment) || segment.includes(':') || WINDOWS_DEVICE.test(segment))) return true;
  let current = fs.realpathSync.native(root);
  for (const segment of segments) {
    current = path.join(current, segment);
    let actual;
    try {
      actual = path.basename(fs.realpathSync.native(current));
    } catch (error) {
      return error.code !== 'ENOENT';
    }
    if (actual.toUpperCase() !== segment.toUpperCase()) return true;
  }

  return false;
}

// A stored reservation with a refused spelling fails closed under the caller's code and stays for explicit reconciliation.
function requireOwnershipPath(root, target, code = 'unsafe-path') {
  projectFile(root, target);
  requireCondition(process.platform !== 'win32' || !windowsAlias(root, target), code, `Write ownership refuses the Windows alias spelling ${JSON.stringify(target)}`);
}

function otherWriters(state) {
  const records = require('../releases/service').readRunStore(state.root) ?? [];
  const selected = referenceId(state);
  const writers = [];
  for (const record of records) {
    requireCondition(record.root === state.root && typeof record.id === 'string' && record.id.length > 0 && Array.isArray(record.workers), 'writer-state-unavailable', 'Project ownership inventory is unsupported; reconcile it before canonical writes');
    if (referenceId(record) === selected) continue;
    for (const worker of record.workers) {
      requireCondition(worker && typeof worker === 'object' && !Array.isArray(worker), 'writer-state-unavailable', 'Project worker inventory is malformed');
      if (!workerIsActive(worker)) continue;
      requireCondition(['starting', 'running', 'unverified'].includes(worker.status) && ['implementer', 'reviewer', 'skeptic', 'peer', 'supervisor', 'operation'].includes(worker.role), 'writer-state-unavailable', 'A surviving worker has unsupported ownership state');
      requireCondition(Array.isArray(worker.writes) && worker.writes.every(target => typeof target === 'string' && target.length > 0), 'writer-state-unavailable', 'A surviving worker has unknown write ownership');
      worker.writes.forEach(target => requireOwnershipPath(state.root, target, 'writer-state-unavailable'));
      if (worker.writes.length > 0) writers.push({ record: referenceId(record), worker });
    }
  }
  return writers;
}

function overlaps(left, right) {
  const a = process.platform === 'win32' ? left.toUpperCase() : left;
  const b = process.platform === 'win32' ? right.toUpperCase() : right;
  return a === b || a.startsWith(b + '/') || b.startsWith(a + '/');
}

function assertWorkerWriteScope(state, worker) {
  if (worker.writes.length === 0) return;
  for (const other of otherWriters(state)) {
    requireCondition(!worker.writes.some(target => other.worker.writes.some(owned => overlaps(target, owned))), 'writer-conflict', `Worker ${other.worker.id} in ${other.record} owns the requested paths`);
  }
}

function assertCanonicalWriteScope(state) {
  requireCondition(otherWriters(state).length === 0, 'writer-conflict', 'Another record has active or uncertain canonical write ownership; reconcile it before canonical engineering');
}

module.exports = { assertCanonicalWriteScope, assertWorkerWriteScope, overlaps, requireOwnershipPath };
