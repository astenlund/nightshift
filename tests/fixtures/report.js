'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { transition } = require('../../internal/runtime/lifecycle');

function fixtureReport(store, actor, request) {
  const state = store.read();
  if (request.action !== 'triage' || !state.handover || !state.closing?.retrospectiveEvidence || state.closing.reportEvidence) return;
  const relative = '.nightshift/runs/reports/fixture.md';
  fs.mkdirSync(path.dirname(path.join(store.root, relative)), { recursive: true });
  fs.writeFileSync(path.join(store.root, relative), '# Fixture report\r\n\r\nThe deterministic fixture completed its requested checks.\r\n');
  store.update(actor, state.revision, 'report', current => transition(current, { action: 'report', path: relative }));
}

module.exports = { fixtureReport };
