'use strict';

// Checks that planned contents leave every entry Ready sees where it was (commitment 11 of
// .nightshift/specs/setup-index-text-adjudication.md): same entries in the same order, each in its section or in the
// section an approved rename gave a new heading, with no structural error added.
const { normalizeHeading } = require('./document');
const { readyGrammar } = require('./templates');

function readyEntries(file, text) {
  const grammar = readyGrammar(file);
  const { extractEntries } = require('../../skills/ready/ready');
  const result = extractEntries(text, grammar.excluded, grammar);

  return [...result.entries.map(entry => ({ ...entry, collected: false })), ...result.collectedEntries.map(entry => ({ ...entry, collected: true }))];
}

function structuralErrors(file, text) {
  const grammar = readyGrammar(file);
  if (grammar.name === 'PATTERNS') return 0;
  const { analyze } = require('../../skills/ready/ready');

  return analyze({ [grammar.name]: text }).structuralErrors.length;
}

// renames maps an old normalized section key to the new one. Returns null, or the reason the plan moves an entry.
function entriesProblem(file, before, after, renames = new Map()) {
  if (!readyGrammar(file)) return null;
  const previous = readyEntries(file, before);
  const planned = readyEntries(file, after);
  if (previous.length !== planned.length) return `the plan changes the number of entries from ${previous.length} to ${planned.length}`;
  for (let index = 0; index < previous.length; index += 1) {
    const was = previous[index];
    const now = planned[index];
    const section = normalizeHeading(was.section ?? '');
    const expected = renames.get(section) ?? section;
    if (was.title !== now.title || was.collected !== now.collected || expected !== normalizeHeading(now.section ?? '')) return `the plan moves entry "${was.title}"`;
  }
  if (structuralErrors(file, after) > structuralErrors(file, before)) return 'the plan adds a structural error';

  return null;
}

module.exports = { entriesProblem };
