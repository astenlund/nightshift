'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const root = process.argv[2];
require('../../internal/runtime/workers').workerIsActive = () => true;
require('../../internal/runtime/report-delivery').validReportDelivery = () => false;

const { projection } = require('../../internal/runtime/legacy-approval-v1');
const reportHash = 'a'.repeat(64);
const state = { revision: 1, handover: {}, workers: [{ id: 'finished-worker', status: 'complete' }], tasks: [], followups: [], closing: { retrospectiveEvidence: {}, triageEvidence: {}, reportEvidence: { path: '.nightshift/runs/reports/saved.md', sha256: reportHash }, reportDelivery: { authority: 'Recipient confirmed', revision: 1, sha256: reportHash } } };
const approved = projection(state);
assert.equal(approved.workers[0].active, false);
assert.equal(approved.closing.report.delivered, true);
assert.equal(approved.closing.stage, 'complete');

const { LegacyInventory } = require('../../internal/runtime/legacy-inventory');
const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'), { readOnly: true });
try {
  assert.equal(new LegacyInventory(root, db).inventory().counts.retired, 1);
} finally {
  db.close();
}
