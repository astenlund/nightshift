#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { RunStore } = require('./store');
const { obligationBrief, transition } = require('./lifecycle');
const { exhaustedLimit } = require('./limits');

function projectRoot(cwd) {
  let current = path.resolve(cwd);
  while (true) {
    if (fs.existsSync(path.join(current, '.git')) || fs.existsSync(path.join(current, '.nightshift'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function handleHook(input) {
  if (!input.cwd || !input.session_id) return {};
  const sessionBinding = input.hook_event_name === 'SessionStart'
    ? { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: `Nightshift session binding: ${input.session_id}. Use this actual session identity when starting an explicitly authorized Nightshift run.` } }
    : {};
  const root = projectRoot(input.cwd);
  if (!root || !fs.existsSync(path.join(root, '.nightshift/runs/state.sqlite'))) return sessionBinding;
  const store = new RunStore(root);
  try {
    const state = store.read(undefined, { hydrate: false });
    if (!state || state.controller.session !== input.session_id || ['complete', 'stopped'].includes(state.status)) return sessionBinding;
    const exhausted = exhaustedLimit(state);
    if (exhausted) {
      store.update(state.controller, state.revision, 'limit-reached', current => transition(current, { action: 'stop', kind: 'resource-limit', reason: exhausted }));
      return { continue: false, stopReason: exhausted };
    }
    if (input.hook_event_name === 'Interrupt') {
      store.update(state.controller, state.revision, 'user-interrupt', current => transition(current, { action: 'stop', kind: 'user-stop', reason: 'The host reported an explicit user interruption' }));
      return {};
    }
    const brief = obligationBrief(state, root, { verifyFreshness: false });
    const context = 'Nightshift continuation. Reconcile the saved state and actual files before dependent actions.\n' + JSON.stringify(brief);
    if (input.hook_event_name === 'Stop') {
      if (state.mode !== 'unattended') return { systemMessage: 'Nightshift attended work remains saved. Reconcile its outstanding obligations before resuming or claiming completion.' };
      const idle = brief.next.length === 0 && brief.workers.length === 0 && !brief.finalReconciliationPending;
      const closingDue = brief.closing.ready && brief.closing.stage !== 'complete';
      const awaitingUser = brief.blockers.length > 0 && brief.blockers.every(entry => entry.blocker.kind === 'user-decision');
      if (idle && awaitingUser) {
        // A conversational pause: the only way forward is an answer from the user, so ask instead of closing first.
        return { systemMessage: `Nightshift is paused on user decisions for ${brief.blockers.map(entry => entry.id).join(', ')}. Progress is preserved; completion is not established.${closingDue ? ' Session closing remains due when the run resumes or ends.' : ''}` };
      }
      if (idle && !closingDue) return { systemMessage: 'Nightshift has unfinished blocked work. Progress and unanswered decisions are preserved; completion is not established.' };
      const previous = state.stopRecovery;
      const reminders = previous?.revision === state.revision ? previous.reminders + 1 : 1;
      if (reminders > 3) return { continue: false, stopReason: 'Nightshift continuation made no recorded progress after three reminders. Work remains incomplete. Reconcile the saved state and repair the continuation mechanism before unattended resumption.' };
      store.update(state.controller, state.revision, 'continuation-reminder', current => {
        current.stopRecovery = { reminders, revision: current.revision + 1 };
      });
      return { decision: 'block', reason: context };
    }
    if (input.hook_event_name === 'SessionStart') return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } };
    if (input.hook_event_name === 'PreCompact') return { systemMessage: 'Nightshift saved state is authoritative for outstanding commitments, findings, evidence and ownership. Reconcile it after compaction.' };
    return {};
  } finally { store.close(); }
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 4 * 1024 * 1024) throw new Error('Hook input exceeds its limit');
  }
  process.stdout.write(JSON.stringify(handleHook(JSON.parse(input))) + '\n');
}

if (require.main === module) {
  main().catch(error => {
    // A failed state check is not permission to announce completion.
    process.stdout.write(JSON.stringify({ systemMessage: `Nightshift could not establish run ownership or reconcile saved obligations: ${error.message}. Completion is unverified; the owning controller must recover its state.` }) + '\n');
    process.exitCode = 0;
  });
}

module.exports = { handleHook, projectRoot };
