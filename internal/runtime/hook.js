#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { RunStore } = require('./store');
const { obligationBrief, reportNotice, transition } = require('./lifecycle');
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

function reportInstruction(notice) {
  if (!notice.current) return 'The saved report is missing or changed. Rewrite it and record the report again before presenting it.';
  if (!notice.delivered) return 'Present the saved report, ending with its pending follow-ups and a plain question asking whether the user is ready to triage them, record its delivery from the user\'s reply, then present each follow-up through the host\'s question tool.';
  return 'The report was delivered. Continue the follow-up triage one item at a time through the host\'s question tool, starting with the first pending follow-up.';
}

// The morning report and its pending decisions are owed to the owner of a handed-over run whether or not the run has closed.
function withReportNotice(context, notice) {
  return notice ? `${context}\nNightshift morning report. ${reportInstruction(notice)}\n${JSON.stringify(notice)}` : context;
}

function sessionStartContext(context) {
  return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } };
}

function handleHook(input) {
  if (!input.cwd || !input.session_id) return {};
  const starting = input.hook_event_name === 'SessionStart';
  const bindingText = `Nightshift session binding: ${input.session_id}. Use this actual session identity when starting an explicitly authorized Nightshift run.`;
  const sessionBinding = starting ? sessionStartContext(bindingText) : {};
  const root = projectRoot(input.cwd);
  if (!root || !fs.existsSync(path.join(root, '.nightshift/runs/state.sqlite'))) return sessionBinding;
  const store = new RunStore(root);
  try {
    const state = store.read(undefined, { hydrate: false });
    if (!state || state.controller.session !== input.session_id) return sessionBinding;
    // Nothing else is restored for a closed run.
    if (['complete', 'stopped'].includes(state.status)) return starting ? sessionStartContext(withReportNotice(bindingText, reportNotice(state, root))) : sessionBinding;
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
      const protectedRun = state.handover || state.mode === 'unattended';
      // Stop follows every reply, so an attended run without a handover ends its turns silently.
      if (!protectedRun) return {};
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
    if (starting) return sessionStartContext(withReportNotice(context, reportNotice(state, root)));
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
  const parsed = JSON.parse(input);
  const host = process.argv[2];
  const output = await require('../releases/notice').handleNotice(parsed, host);
  process.stdout.write(JSON.stringify(output) + '\n');
}

if (require.main === module) {
  main().catch(error => {
    // A failed state check is not permission to announce completion.
    process.stdout.write(JSON.stringify({}) + '\n');
    process.exitCode = 0;
  });
}

module.exports = { handleHook, projectRoot };
