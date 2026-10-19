'use strict';

// Keeps template edits from staling a retained retirement certificate (commitment 13 of
// .nightshift/specs/setup-index-text-adjudication.md): every tracked destination a certificate binds is evaluated by
// targetEntry over the planned bytes and compared with its value over the current files.
const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');

const ACTIVE_INDEXES = new Set(['.nightshift/FEATURES.md', '.nightshift/BUGS.md', '.nightshift/QUICK_WINS.md', '.nightshift/PATTERNS.md']);

// { status: 'none' | 'ok' | 'unverifiable', destinations, reason }
function boundDestinations(root) {
  const store = path.join(root, '.nightshift', 'runs', 'state.sqlite');
  if (!fs.existsSync(store)) return { status: 'none', destinations: [] };
  try {
    const { DatabaseSync } = require('node:sqlite');
    const { readArtifact, retirementRows } = require('../runtime/legacy-store');
    const { MAX_CERTIFICATE_BYTES } = require('../runtime/legacy-certificates');
    const database = new DatabaseSync(store, { readOnly: true });
    try {
      const destinations = [];
      for (const row of retirementRows(database)) {
        const certificate = readArtifact(database, row.artifact, MAX_CERTIFICATE_BYTES);
        for (const choice of certificate?.followups ?? []) {
          if (choice?.disposition === 'tracked' && choice.destination) destinations.push(choice.destination);
        }
      }

      return { status: 'ok', destinations };
    } finally { database.close(); }
  } catch (error) { return { status: 'unverifiable', destinations: [], reason: error.message }; }
}

function evaluate(root, destination, planned) {
  const { targetEntry } = require('../runtime/legacy-backlog');
  try { return targetEntry(root, destination, { bytes: 0, maximum: 16 * 1024 * 1024, cache: new Map(), planned }); }
  catch (error) { return { unavailable: error.code ?? error.message }; }
}

// The destinations whose value the planned bytes change, each with the files its change is charged to: an anchored
// destination's own file, or every active index for a breakout record, whose validity rests on reachability. A
// destination already different from its bound value before the edit is reported as stale and charged to nothing.
function plannedChanges(root, destinations, planned) {
  const changed = [];
  const stale = [];
  for (const destination of destinations) {
    const current = evaluate(root, destination, new Map());
    if (!isDeepStrictEqual(current, destination)) {
      stale.push(destination);
      continue;
    }
    const after = evaluate(root, destination, planned);
    if (isDeepStrictEqual(after, current)) continue;
    const own = `.nightshift/${String(destination.path).replace(/^\.nightshift\//, '')}`;
    changed.push({ destination, files: ACTIVE_INDEXES.has(own) && destination.anchor !== null ? [own] : [...ACTIVE_INDEXES] });
  }

  return { changed, stale };
}

module.exports = { ACTIVE_INDEXES, boundDestinations, plannedChanges };
