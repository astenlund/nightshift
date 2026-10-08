'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { RunStore } = require('../../internal/runtime/store');

async function completeReflection(root, actor, execute, dependencies) {
  const current = () => {
    const store = new RunStore(root);
    try { return store.read(); } finally { store.close(); }
  };
  const call = request => execute(root, { ...request, actor, revision: current().revision }, dependencies);
  await call({ action: 'claim-controller' });
  if (!current().continuation?.verified) await call({ action: 'continuation', mechanism: { verified: true, kind: 'goal', evidence: 'Simulated fixture goal' } });
  for (const task of current().tasks) {
    if (task.kind !== 'lore') throw new Error('Completion control requires reflection tasks');
    if (task.status === 'pending') await call({ action: 'start-task', taskId: task.id });
    if (current().tasks.find(item => item.id === task.id).status !== 'complete') await call({ action: 'advance', taskId: task.id, evidence: 'Fixture reflection found no worthwhile instruction proposal' });
  }
  if (!current().closing?.retrospectiveEvidence) await call({ action: 'retrospective', evidence: 'Reflection completed without new proposals' });
  const report = '.nightshift/runs/reports/fixture-' + current().id + '.md';
  fs.mkdirSync(path.join(root, '.nightshift/runs/reports'), { recursive: true });
  fs.writeFileSync(path.join(root, report), '# Fixture report\r\n\r\nReflection completed using simulated owner and continuation observations. No pending proposal or decision. No publication.\r\n');
  await call({ action: 'report', path: report });
  await call({ action: 'report-delivered', authority: 'Simulated fixture recipient acknowledged the report' });
  await call({ action: 'triage', evidence: 'No pending fixture follow-ups' });
  await call({ action: 'complete' });
  return current();
}

module.exports = { completeReflection };
