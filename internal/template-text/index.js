'use strict';

// Setup's adjudication of index text that differs from its template: what inspect reports and what apply does with the
// user's decisions. Governed by .nightshift/specs/setup-index-text-adjudication.md.
const fs = require('node:fs');
const path = require('node:path');
const { BACKLOG_FILES, decodeUtf8 } = require('../backlog-catalog');
const { projectFile } = require('../runtime/evidence');
const { requireCondition } = require('../runtime/errors');
const { LOCK_NAME, acquireLock } = require('../unwrap-lock');
const { RECOVERY_SUFFIX } = require('../unwrap-recovery');
const { lineEnding } = require('./document');
const { analyzeIndex, knownIdentities } = require('./differences');
const { composeFile, sectionOrder, sectionSpan } = require('./compose');
const { entriesProblem } = require('./entries');
const { loadRetired, loadTemplates } = require('./templates');
const { DECISIONS_FILE, decisionsBytes, keyOf, leftoverTemporaries, preservedCopies, preservedPath, readDecisions, replaceAtomically } = require('./storage');
const { ACTIVE_INDEXES, boundDestinations, plannedChanges } = require('./certificates');

const TEMPLATE_NEWLINE = String.fromCharCode(13, 10);
const HASH = /^[a-f0-9]{64}$/;
const ACTIONS = new Set(['insert', 'replace', 'remove', 'keep']);
const FIELDS = new Set(['file', 'templateHash', 'action', 'replaces']);
const relative = file => `.nightshift/${file}`;

function loadContext() {
  return { templates: loadTemplates(), retired: loadRetired() };
}

// Refuses what the decision array, the templates and the retired list show, before any write (commitment 9).
function validateDecisions(decisions, context) {
  if (decisions === undefined) return [];
  requireCondition(Array.isArray(decisions), 'invalid-template-decisions', 'templateDecisions must be an array');
  const seen = new Set();
  const replaced = new Set();
  const renamed = new Set();
  const normalized = decisions.map((decision, index) => {
    const label = `templateDecisions[${index}]`;
    const refuse = (condition, message) => requireCondition(condition, 'invalid-template-decisions', `${label} ${message}`);
    refuse(decision && typeof decision === 'object' && !Array.isArray(decision) && Object.keys(decision).every(key => FIELDS.has(key)), 'must be an object with only file, templateHash, action and replaces');
    refuse(BACKLOG_FILES.includes(decision.file), 'names a file outside the seven backlog files');
    refuse(typeof decision.templateHash === 'string' && HASH.test(decision.templateHash), 'needs a 64-digit lowercase hexadecimal templateHash');
    refuse(ACTIONS.has(decision.action), 'needs an action of insert, replace, remove or keep');
    refuse(decision.action === 'replace' ? typeof decision.replaces === 'string' && HASH.test(decision.replaces) : decision.replaces === undefined, decision.action === 'replace' ? 'needs a 64-digit lowercase hexadecimal replaces' : 'takes replaces only with replace');
    const identities = knownIdentities(context.templates.get(decision.file), context.retired.get(decision.file));
    const kind = identities.missing.has(decision.templateHash) ? 'missing-block' : identities.sections.has(decision.templateHash) ? 'missing-section' : identities.retired.has(decision.templateHash) ? 'retired' : null;
    refuse(kind !== null, 'names no difference the template or the retired list defines');
    refuse(decision.action === 'keep' || (decision.action === 'remove' ? kind === 'retired' : kind !== 'retired'), `cannot ${decision.action} a ${kind} difference`);
    const key = keyOf(decision.file, decision.templateHash);
    refuse(!seen.has(key), 'repeats a decision for the same file and templateHash');
    seen.add(key);
    if (decision.action === 'replace') {
      const target = keyOf(decision.file, decision.replaces);
      refuse(!replaced.has(target), 'names a block or heading another replace already names');
      replaced.add(target);
      if (kind === 'missing-section') renamed.add(target);
    }

    return { file: decision.file, templateHash: decision.templateHash, action: decision.action, replaces: decision.replaces, kind };
  });
  for (const decision of normalized) {
    requireCondition(!(decision.action !== 'replace' && renamed.has(keyOf(decision.file, decision.templateHash))), 'invalid-template-decisions', `templateDecisions ${decision.action} ${decision.file} section that a rename names`);
  }

  return normalized;
}

function requireReadableDecisions(root) {
  const state = readDecisions(root);
  requireCondition(state.status !== 'unreadable', 'template-decisions-unreadable', `${DECISIONS_FILE} cannot be read: ${state.reason}; repair it, or remove it so its kept differences are presented again`);

  return state;
}

function keptFor(file, kept) {
  return new Set([...kept].filter(key => key.startsWith(`${file}:`)).map(key => key.slice(file.length + 1)));
}

const excerpt = text => (text.length > 80 ? `${text.slice(0, 77)}...` : text).split(String.fromCharCode(10))[0];

// Where a missing block or section would go, for the question (commitment 6).
function insertionPoint(difference, analysis, template) {
  if (difference.kind === 'missing-section') {
    if (difference.rename) return { renames: difference.rename.heading.text, line: difference.rename.heading.start + 1 };
    const target = analysis.sections.find(section => (sectionOrder(template, section) ?? -1) > difference.templateSection.order);

    return target ? { before: target.heading.text, line: target.heading.start + 1 } : { atEnd: true };
  }
  const ordered = difference.templateSection ? difference.templateSection.blocks : template.preamble;
  const present = new Map(difference.region.region.filter(block => block.kind === 'text').map(block => [block.text, block]));
  for (let index = ordered.findIndex(block => block.text === difference.block.text) - 1; index >= 0; index -= 1) {
    const anchor = present.get(ordered[index].text);
    if (anchor) return { after: excerpt(anchor.text), line: anchor.end + 1 };
  }
  if (difference.region.heading) return { after: difference.region.heading.text, line: difference.region.heading.start + 1 };

  return analysis.title ? { after: analysis.title.text, line: analysis.title.start + 1 } : { atStart: true };
}

function describeDifference(difference, analysis, template) {
  const section = difference.region?.heading?.text ?? difference.section?.heading?.text ?? (difference.templateSection ? template.document.lines[difference.templateSection.heading.start] : null);
  const base = { kind: difference.kind, templateHash: difference.templateHash, section };
  switch (difference.kind) {
    case 'missing-block':
      return { ...base, text: difference.block.text, insertion: insertionPoint(difference, analysis, template), candidates: difference.candidates.map(block => ({ hash: block.hash, text: block.text, line: block.start + 1 })) };
    case 'missing-section':
      return {
        ...base,
        heading: template.document.lines[difference.templateSection.heading.start],
        text: difference.absent.map(block => block.text),
        presentElsewhere: difference.present.map(block => block.text),
        insertion: insertionPoint(difference, analysis, template),
        rename: difference.rename ? { hash: difference.rename.heading.hash, heading: difference.rename.heading.text, line: difference.rename.heading.start + 1, retired: difference.renameRetired } : null,
        recommendKeep: difference.absent.length === 0 && !difference.rename,
      };
    case 'retired-block':
      return { ...base, section: null, text: difference.text, occurrences: difference.occurrences.map(({ region, block }) => ({ section: region.heading?.text ?? null, line: block.start + 1 })) };
    default:
      return { ...base, section: difference.section.heading.text, line: difference.section.heading.start + 1, removable: difference.removable, reason: difference.reason, text: difference.blocks.map(block => block.text) };
  }
}

function decodeIndex(root, file) {
  const target = projectFile(root, relative(file));
  if (!fs.existsSync(target)) return null;
  const bytes = fs.readFileSync(target);
  try { return { bytes, text: decodeUtf8(bytes), recovery: fs.existsSync(target + RECOVERY_SUFFIX) }; }
  catch { return { bytes, text: null, recovery: fs.existsSync(target + RECOVERY_SUFFIX) }; }
}

// The operation a single difference's recommended edit would make, used to find certificate holds before any answer.
function defaultOperation(difference) {
  if (difference.kind === 'missing-block') return { type: 'insert-block', difference };
  if (difference.kind === 'missing-section') return difference.rename ? { type: 'rename', difference } : { type: 'insert-section', difference };
  if (difference.kind === 'retired-block') return { type: 'remove-block', difference };

  return difference.removable ? { type: 'remove-section', difference } : null;
}

// What inspect reports about template text (commitment 8). validate runs the Ready parser over the current backlog.
function inspectTemplates(root, { validate, context = loadContext() } = {}) {
  root = fs.realpathSync.native(root);
  const decisions = readDecisions(root);
  const ready = validate ? validate() : { ok: true, report: { structuralErrors: [] } };
  const certificates = boundDestinations(root);
  const report = {
    decisionsFile: decisions.status === 'unreadable' ? { status: 'unreadable', reason: decisions.reason, path: DECISIONS_FILE } : { status: decisions.status, path: DECISIONS_FILE },
    ready: ready.ok ? { ok: true, structuralErrors: ready.report.structuralErrors } : { ok: false, error: ready.error },
    certificates: { status: certificates.status, reason: certificates.reason ?? null },
    leftovers: leftoverTemporaries(root).map(entry => ({ ...entry, safeToDelete: entry.targetState === 'readable' })),
    preserved: preservedCopies(root),
    files: [],
    inertKeeps: [],
  };
  const known = new Set();
  // A keep for a file that cannot be read now is not judged; it may name a difference the repaired file still has.
  const unjudged = new Set();
  for (const file of BACKLOG_FILES) {
    const index = decodeIndex(root, file);
    if (!index) continue;
    if (index.text === null) {
      report.files.push({ file, unreadable: 'invalid-utf8' });
      unjudged.add(file);
      continue;
    }
    const template = context.templates.get(file);
    const kept = keptFor(file, decisions.kept);
    const analysis = analyzeIndex(file, index.text, template, context.retired.get(file), kept);
    if (analysis.unreadable) {
      report.files.push({ file, unreadable: analysis.unreadable });
      unjudged.add(file);
      continue;
    }
    for (const difference of analysis.differences) known.add(keyOf(file, difference.templateHash));
    const presented = analysis.differences.filter(difference => !kept.has(difference.templateHash));
    const holds = [];
    if (index.recovery) holds.push({ reason: 'unwrap-recovery-pending' });
    if (lineEnding(index.text, TEMPLATE_NEWLINE) === null) holds.push({ reason: 'ambiguous-newline' });
    if (ACTIVE_INDEXES.has(relative(file)) && certificates.status === 'unverifiable') holds.push({ reason: 'certificate-unverifiable' });
    const entry = { file, holds, kept: analysis.differences.filter(difference => kept.has(difference.templateHash)).map(difference => difference.templateHash), count: presented.length };
    if (decisions.status !== 'unreadable' && ready.ok) {
      entry.differences = presented.map(difference => {
        const described = describeDifference(difference, analysis, template);
        const operation = defaultOperation(difference);
        if (operation && certificates.status === 'ok' && certificates.destinations.length > 0 && ACTIVE_INDEXES.has(relative(file))) {
          const planned = Buffer.from(composeFile(index.text, analysis, template, [operation], lineEnding(index.text, TEMPLATE_NEWLINE) ?? TEMPLATE_NEWLINE), 'utf8');
          const { changed } = plannedChanges(root, certificates.destinations, new Map([[relative(file), planned]]));
          if (changed.length > 0) described.certificateBound = changed.map(change => change.destination);
        }

        return described;
      });
    }
    report.files.push(entry);
  }
  report.inertKeeps = [...decisions.kept].filter(key => !known.has(key) && !unjudged.has(key.slice(0, key.lastIndexOf(':'))));

  return report;
}

// Whether a decision whose difference is gone already has its outcome, for example after an interrupted apply.
function outcomeHolds(decision, analysis, template) {
  if (decision.kind === 'missing-block') {
    const block = [...template.preamble, ...template.sections.flatMap(section => section.blocks)].find(candidate => candidate.hash === decision.templateHash);

    return Boolean(block && analysis.comparedTexts.has(block.text));
  }
  if (decision.kind === 'missing-section') {
    const section = template.sections.find(candidate => candidate.identity === decision.templateHash);

    return Boolean(section && analysis.sectionKeys.has(section.key) && section.blocks.every(block => analysis.comparedTexts.has(block.text)));
  }

  return !analysis.differences.some(difference => difference.templateHash === decision.templateHash);
}

// Turns one file's non-keep decisions into operations, recording an outcome for each decision that makes none.
function resolve(file, decisions, analysis, template, outcomes) {
  const operations = [];
  const byHash = new Map(analysis.differences.map(difference => [difference.templateHash, difference]));
  const pending = (decision, reason) => outcomes.set(decision, { outcome: 'pending', reason });
  for (const decision of decisions) {
    const difference = byHash.get(decision.templateHash);
    if (!difference) {
      if (outcomeHolds(decision, analysis, template)) outcomes.set(decision, { outcome: 'applied', already: true });
      else pending(decision, 'template-text-stale');
      continue;
    }
    if (decision.action === 'insert') {
      operations.push({ type: difference.kind === 'missing-block' ? 'insert-block' : 'insert-section', difference, decision });
    } else if (decision.action === 'replace') {
      if (difference.kind === 'missing-block') {
        const candidate = difference.candidates.find(block => block.hash === decision.replaces);
        if (candidate) operations.push({ type: 'replace', difference, candidate, decision });
        else pending(decision, 'template-text-stale');
      } else if (difference.rename && difference.rename.heading.hash === decision.replaces) {
        operations.push({ type: 'rename', difference, decision });
      } else pending(decision, 'template-text-stale');
    } else if (difference.kind === 'retired-block') {
      operations.push({ type: 'remove-block', difference, decision });
    } else if (difference.removable) {
      operations.push({ type: 'remove-section', difference, decision });
    } else pending(decision, 'not-removable');
  }

  return operations;
}

// Differences an applied operation resolves besides its own: a retired section a rename consumed, a retired block
// every occurrence of which replaces consumed, and the retired blocks a section removal deleted.
function resolvedThrough(operations, analysis) {
  const through = new Map();
  const add = (operation, difference) => through.set(operation.decision, [...(through.get(operation.decision) ?? []), { kind: difference.kind, templateHash: difference.templateHash }]);
  const replacedStarts = new Set(operations.filter(operation => operation.type === 'replace').map(operation => operation.candidate.start));
  for (const operation of operations) {
    if (operation.type === 'rename') {
      const paired = analysis.differences.find(difference => difference.kind === 'retired-section' && difference.section === operation.difference.rename);
      if (paired) add(operation, paired);
    }
    if (operation.type === 'replace') {
      const retired = analysis.differences.find(difference => difference.kind === 'retired-block' && difference.templateHash === operation.candidate.hash);
      if (retired && retired.occurrences.every(({ block }) => replacedStarts.has(block.start)) && !operations.some(other => other.decision.templateHash === retired.templateHash)) add(operation, retired);
    }
    if (operation.type === 'remove-section') {
      for (const block of operation.difference.blocks) add(operation, { kind: 'retired-block', templateHash: block.hash });
    }
  }

  return through;
}

// Renames each leftover whose target is absent or unreadable, which may hold the only copy of that file's earlier
// content, to a preserved name that no later run removes, and removes the others when removeSafe is set. Runs under lock.
function settleLeftovers(root, lock, removeSafe) {
  const kept = [];
  const removed = [];
  for (const leftover of leftoverTemporaries(root)) {
    lock.validate();
    if (leftover.targetState !== 'readable') {
      const preserved = preservedPath(leftover);
      fs.renameSync(projectFile(root, leftover.path), projectFile(root, preserved));
      kept.push({ path: preserved, from: leftover.path, target: leftover.target, reason: leftover.targetState });
    } else if (removeSafe) {
      fs.unlinkSync(projectFile(root, leftover.path));
      removed.push(leftover.path);
    }
  }

  return { kept, removed };
}

// Takes the backlog directory's unwrap lock, creating its file, and says whether it did.
function takeLock(root) {
  const directory = fs.realpathSync.native(projectFile(root, '.nightshift'));
  const created = !fs.existsSync(path.join(directory, LOCK_NAME));

  return { lock: acquireLock(directory, { create: true }), created };
}

// Setup preserves unsafe leftovers before anything in its run can change a target, since a target that unwrap recovery,
// migration or scaffolding writes would make its leftover look safe to delete; a lock failure here stops setup before any
// such change, so a rerun judges them again. Returns what adjudicate reports: { kept, lockCreated }.
function preserveUnsafeLeftovers(root) {
  root = fs.realpathSync.native(root);
  if (!leftoverTemporaries(root).some(leftover => leftover.targetState !== 'readable')) return { kept: [], lockCreated: false };
  const { lock, created } = takeLock(root);
  try { return { kept: settleLeftovers(root, lock, false).kept, lockCreated: created }; }
  finally { lock.close(); }
}

// Applies the user's decisions after relocation and scaffolding (commitments 7 and 11 to 15). decisions are the output
// of validateDecisions; validate runs the Ready parser over the current backlog; earlier is preserveUnsafeLeftovers'
// result from the start of the setup run. Returns the report; on an error part way through, error.completed lists what
// was written.
function adjudicate(root, decisions, { validate, context = loadContext(), earlier = { kept: [], lockCreated: false } } = {}) {
  root = fs.realpathSync.native(root);
  const state = requireReadableDecisions(root);
  const completed = [];
  const lockFile = created => ({ path: `.nightshift/${LOCK_NAME}`, created });
  const report = { files: [], decisions: [], decisionsFile: { path: DECISIONS_FILE, written: false }, lockFile: earlier.lockCreated ? lockFile(true) : null, leftoversRemoved: [], leftoversKept: [...earlier.kept], preserved: [], staleCertificates: [] };
  const directory = projectFile(root, '.nightshift');
  if (!fs.existsSync(directory)) return report;
  // The lock file persists once created and records this clone's identities, so an apply that can write nothing takes
  // no lock, and one that takes it names the file in its report.
  let lock = null;
  if (decisions.length > 0 || leftoverTemporaries(root).length > 0) {
    const taken = takeLock(root);
    lock = taken.lock;
    report.lockFile = lockFile(taken.created || earlier.lockCreated);
  }
  try {
    if (lock) {
      const settled = settleLeftovers(root, lock, true);
      report.leftoversKept.push(...settled.kept);
      report.leftoversRemoved.push(...settled.removed);
    }
    report.preserved = preservedCopies(root).map(({ path: file, target }) => ({ path: file, target }));
    const ready = validate ? validate() : { ok: true, report: { structuralErrors: [] } };
    const backlogInvalid = !ready.ok || ready.report.structuralErrors.length > 0;
    const runKeeps = new Set(decisions.filter(decision => decision.action === 'keep').map(decision => keyOf(decision.file, decision.templateHash)));
    const kept = new Set([...state.kept, ...runKeeps]);
    const certificates = boundDestinations(root);
    const outcomes = new Map();
    const plans = [];
    for (const decision of decisions.filter(entry => entry.action === 'keep')) outcomes.set(decision, { outcome: 'kept' });
    for (const file of BACKLOG_FILES) {
      const fileDecisions = decisions.filter(decision => decision.file === file && decision.action !== 'keep');
      const index = decodeIndex(root, file);
      const hold = reason => fileDecisions.forEach(decision => outcomes.set(decision, { outcome: 'pending', reason }));
      if (!index) {
        hold('template-text-stale');
        continue;
      }
      if (index.text === null) {
        hold('template-text-unreadable');
        continue;
      }
      const template = context.templates.get(file);
      const analysis = analyzeIndex(file, index.text, template, context.retired.get(file), keptFor(file, kept));
      const fileReport = { file, pendingDifferences: [] };
      report.files.push(fileReport);
      if (analysis.unreadable) {
        hold('template-text-unreadable');
        continue;
      }
      const decided = new Set(decisions.filter(decision => decision.file === file).map(decision => decision.templateHash));
      const undecided = result => result.differences.filter(difference => !decided.has(difference.templateHash) && !kept.has(keyOf(file, difference.templateHash))).map(difference => difference.templateHash);
      fileReport.pendingDifferences = undecided(analysis);
      if (fileDecisions.length === 0) continue;
      const newline = lineEnding(index.text, TEMPLATE_NEWLINE);
      const reason = backlogInvalid ? 'backlog-invalid' : index.recovery ? 'unwrap-recovery-pending' : newline === null ? 'ambiguous-newline'
        : ACTIVE_INDEXES.has(relative(file)) && certificates.status === 'unverifiable' ? 'certificate-unverifiable' : null;
      if (reason) {
        hold(reason);
        continue;
      }
      const operations = resolve(file, fileDecisions, analysis, template, outcomes);
      if (operations.length === 0) continue;
      const planned = composeFile(index.text, analysis, template, operations, newline);
      const check = analyzeIndex(file, planned, template, context.retired.get(file), keptFor(file, kept));
      const leftOver = check.unreadable ? operations : operations.filter(operation => check.differences.some(difference => difference.templateHash === operation.difference.templateHash));
      const renames = new Map(operations.filter(operation => operation.type === 'rename').map(operation => [operation.difference.rename.key, operation.difference.templateSection.key]));
      const entries = leftOver.length === 0 ? entriesProblem(file, index.text, planned, renames) : null;
      const holdOperations = (why, detail) => operations.forEach(operation => outcomes.set(operation.decision, { outcome: 'pending', reason: why, detail }));
      if (leftOver.length > 0) holdOperations('template-text-unplaceable');
      else if (entries) holdOperations('entries-changed', entries);
      // A difference an applied operation resolved through another decision is no longer pending once the file is written.
      else plans.push({ file, bytes: index.bytes, planned: Buffer.from(planned, 'utf8'), operations, analysis, newline, report: fileReport, remaining: undecided(check) });
    }
    if (certificates.status === 'ok' && certificates.destinations.length > 0 && plans.length > 0) {
      const { changed, stale } = plannedChanges(root, certificates.destinations, new Map(plans.map(plan => [relative(plan.file), plan.planned])));
      report.staleCertificates = stale;
      for (const plan of plans) {
        const charged = changed.filter(change => change.files.includes(relative(plan.file)));
        if (charged.length === 0) continue;
        plan.held = true;
        plan.operations.forEach(operation => outcomes.set(operation.decision, { outcome: 'pending', reason: 'certificate-bound', destinations: charged.map(change => change.destination) }));
      }
    }
    for (const plan of plans.filter(entry => !entry.held)) {
      lock.validate();
      try { replaceAtomically(root, relative(plan.file), plan.planned, plan.bytes); }
      catch (error) {
        const reason = error.code === 'template-text-drift' ? 'template-text-drift' : 'template-text-unwritable';
        plan.operations.forEach(operation => outcomes.set(operation.decision, { outcome: 'pending', reason, detail: error.message }));
        continue;
      }
      plan.report.pendingDifferences = plan.remaining;
      const through = resolvedThrough(plan.operations, plan.analysis);
      // Quotes are the file's own lines, so text taken out of an untracked backlog can be restored byte for byte.
      const verbatim = (start, end) => plan.analysis.document.lines.slice(start, end + 1).join(plan.newline);
      const replacedStarts = new Set(plan.operations.filter(operation => operation.type === 'replace').map(operation => operation.candidate.start));
      const applied = plan.operations.map(operation => {
        const record = { outcome: 'applied', through: through.get(operation.decision) ?? [] };
        if (operation.type === 'replace') record.replacedText = verbatim(operation.candidate.start, operation.candidate.end);
        if (operation.type === 'rename') record.renamedHeading = verbatim(operation.difference.rename.heading.start, operation.difference.rename.heading.start);
        if (operation.type === 'remove-block') {
          record.removedText = operation.difference.occurrences.filter(({ block }) => !replacedStarts.has(block.start)).map(({ block }) => verbatim(block.start, block.end)).join(plan.newline + plan.newline);
        }
        if (operation.type === 'remove-section') {
          const span = sectionSpan(plan.analysis.document, operation.difference.section.heading);
          record.removedText = verbatim(span.start, span.last);
        }
        outcomes.set(operation.decision, record);

        return { templateHash: operation.decision.templateHash, action: operation.decision.action };
      });
      completed.push({ kind: 'template-edit', file: relative(plan.file), decisions: applied });
    }
    const added = [...runKeeps].filter(key => !state.kept.has(key));
    if (added.length > 0) {
      lock.validate();
      replaceAtomically(root, DECISIONS_FILE, decisionsBytes(new Set([...state.kept, ...runKeeps])), state.bytes);
      completed.push({ kind: 'template-decisions', file: DECISIONS_FILE });
      report.decisionsFile.written = true;
    }
    report.decisions = decisions.map(decision => ({ file: decision.file, templateHash: decision.templateHash, action: decision.action, ...(decision.replaces ? { replaces: decision.replaces } : {}), ...outcomes.get(decision) }));
    report.completed = completed;

    return report;
  } catch (error) {
    error.completed = [...completed, ...(error.completed ?? [])];
    if (completed.length > 0 && !report.decisionsFile.written) error.message += '; keeps from this run were not recorded and are presented again';
    throw error;
  } finally { lock?.close(); }
}

module.exports = { adjudicate, inspectTemplates, loadContext, preserveUnsafeLeftovers, requireReadableDecisions, validateDecisions };
