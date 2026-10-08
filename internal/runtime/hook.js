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
  if (!notice.delivered) return 'Present the saved report, ending with its pending follow-ups and a plain question asking whether the user is ready to triage them, or with a plain statement that no decision is pending, record its delivery from the user\'s reply, then present each follow-up through the host\'s question tool, or leave them pending if the user is not ready.';
  return 'The report was delivered and follow-ups are pending. If the user has asked to triage them, present them one at a time through the host\'s question tool, starting with the first pending follow-up; otherwise ask whether the user is ready to triage them.';
}

// The morning report and its pending decisions are owed to the owner of a handed-over run whether or not the run has closed.
function withReportNotice(context, notice) {
  return notice ? `${context}\nNightshift morning report. ${reportInstruction(notice)}\n${JSON.stringify(notice)}` : context;
}

function continuationContext(brief) {
  return 'Nightshift continuation. Reconcile the saved state and actual files before dependent actions.\n' + JSON.stringify(brief);
}

function sessionStartContext(context) {
  return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } };
}

function reminderEligible(state, root) {
  if (state.status !== 'running' || !state.handover || exhaustedLimit(state)) return false;
  const brief = obligationBrief(state, root, { verifyFreshness: false });
  const idle = brief.next.length === 0 && brief.workers.length === 0 && !brief.finalReconciliationPending;
  return !idle || brief.closing.ready && brief.closing.stage !== 'complete' && !(brief.blockers.length > 0 && brief.blockers.every(entry => entry.blocker.kind === 'user-decision'));
}

function handleHook(input) {
  if (!input.cwd || !input.session_id) return {};
  const starting = input.hook_event_name === 'SessionStart';
  const bindingText = `Nightshift session binding: ${input.session_id}. Use this actual session identity when starting an explicitly authorized Nightshift run.`;
  const sessionBinding = starting ? sessionStartContext(bindingText) : {};
  const root = projectRoot(input.cwd);
  if (!root || !fs.existsSync(path.join(root, '.nightshift/runs/state.sqlite'))) return sessionBinding;
  const store = new RunStore(root);
  let ownerKnown = false;
  try {
    if (input.hook_event_name === 'Stop') {
      const row = store.db.prepare('SELECT r.state FROM runs r JOIN active a ON a.id=r.id WHERE a.singleton=1').get();
      if (row) {
        const candidate = JSON.parse(row.state);
        ownerKnown = candidate.root === store.root && (candidate.kind ?? 'delivery') === 'delivery' && candidate.controller?.session === input.session_id;
      }
    }
    const state = store.read(undefined, { hydrate: false });
    if (!state || state.controller.session !== input.session_id) return sessionBinding;
    ownerKnown = true;
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
    if (input.hook_event_name === 'Stop') {
      const protectedRun = Boolean(state.handover);
      if (!protectedRun) return {};
      const idle = brief.next.length === 0 && brief.workers.length === 0 && !brief.finalReconciliationPending;
      const closingDue = brief.closing.ready && brief.closing.stage !== 'complete';
      const awaitingUser = brief.blockers.length > 0 && brief.blockers.every(entry => entry.blocker.kind === 'user-decision');
      if (idle && awaitingUser) {
        // A conversational pause: the only way forward is an answer from the user, so ask instead of closing first.
        return { systemMessage: `Nightshift is paused on user decisions for ${brief.blockers.map(entry => entry.id).join(', ')}. Progress is preserved; completion is not established.${closingDue ? ' Session closing remains due when the run resumes or ends.' : ''}` };
      }
      if (idle && !closingDue) return { systemMessage: 'Nightshift has unfinished blocked work. Progress and unanswered decisions are preserved; completion is not established.' };
      const result = store.remind(state.controller, state.revision, current => reminderEligible(current, root));
      if (!result.issued) {
        if (result.reason === 'ineligible') return {};
        const reason = result.reason === 'exhausted' ? 'Nightshift continuation made no recorded progress after three reminders.' : `Nightshift automatic continuation accounting is unavailable (${result.diagnostic}).`;
        return { continue: false, stopReason: `${reason} Work remains incomplete. Reconcile the saved state and continuation failure before resumption.` };
      }
      const reminded = result.state;
      // The reminder write advances the revision, so the resumed controller's brief is built from the state it wrote.
      return { decision: 'block', reason: continuationContext(obligationBrief(reminded, root, { verifyFreshness: false })) };
    }
    if (starting) return sessionStartContext(withReportNotice(continuationContext(brief), reportNotice(state, root)));
    if (input.hook_event_name === 'PreCompact') return { systemMessage: 'Nightshift saved state is authoritative for outstanding commitments, findings, evidence and ownership. Reconcile it after compaction.' };
    return {};
  } catch (error) {
    if (ownerKnown && input.hook_event_name === 'Stop') return { continue: false, stopReason: `Nightshift automatic continuation accounting could not be established (${error.code ?? 'state-unavailable'}). Work remains incomplete; reconcile the saved state before resumption.` };
    throw error;
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
