'use strict';

// The bundled init-backlog templates as comparison models, the retired-guidance list, and the entry grammar of each
// backlog file.
const fs = require('node:fs');
const path = require('node:path');
const { BACKLOG_FILES } = require('../backlog-catalog');
const { requireCondition } = require('../runtime/errors');
const { COMPARISON_RULES, PLACEHOLDER_HEADINGS, describeDocument, describeSections, normalizeHeading, sha256 } = require('./document');

const TEMPLATE_DIRECTORY = path.resolve(__dirname, '../../skills/init-backlog/templates');
const RETIRED_FILE = path.resolve(__dirname, '../../skills/init-backlog/retired-guidance.json');
const HASH = /^[a-f0-9]{64}$/;
const LF = String.fromCharCode(10);
// Ready's index name for each backlog file whose entries it parses.
const READY_INDEXES = { 'FEATURES.md': 'FEATURES', 'BUGS.md': 'BUGS', 'QUICK_WINS.md': 'QUICK_WINS', 'PATTERNS.md': 'PATTERNS' };

const templateName = file => `${path.basename(file, '.md').toLowerCase().replaceAll('_', '-')}.md`;

function readyGrammar(file) {
  const name = READY_INDEXES[file];
  if (!name) return null;
  if (name === 'PATTERNS') return { name, excluded: [], bullets: false, collectSections: [] };
  const { entryGrammar } = require('../../skills/ready/ready');

  return { name, ...entryGrammar(name) };
}

// The grammar describeSections needs: which sections' column-0 bullets are entries.
function sectionGrammar(file) {
  const grammar = readyGrammar(file);

  return grammar?.bullets ? { bulletEntriesExcept: new Set(grammar.excluded.map(normalizeHeading)) } : null;
}

// How Ready treats entries under a section heading in this file: 'work', 'draft' or 'excluded'. Files Ready does not
// parse for work treat every section alike.
function sectionClass(file, title) {
  const grammar = readyGrammar(file);
  if (!grammar || grammar.name === 'PATTERNS') return 'unparsed';
  const key = normalizeHeading(title);
  if (!grammar.excluded.map(normalizeHeading).includes(key)) return 'work';

  return grammar.collectSections.map(normalizeHeading).includes(key) ? 'draft' : 'excluded';
}

// A template's guidance model: its preamble blocks, its sections in order with their kind, and every text and
// heading key it holds, placeholders and containers included, which are never retired.
function templateModel(text) {
  const document = describeDocument(text);
  requireCondition(!document.unreadable, 'template-unreadable', `Template cannot be compared: ${document.unreadable}`);
  const { title, preamble, sections } = describeSections(document);
  const guidanceBlocks = blocks => blocks.filter(block => !block.placeholder);
  const modelSections = sections.map((section, order) => {
    const blocks = guidanceBlocks(section.region);
    const kind = PLACEHOLDER_HEADINGS.has(section.key) ? 'placeholder' : blocks.length === 0 ? 'container' : 'guidance';
    const identity = sha256(section.key + blocks.map(block => LF + block.text).join(''));

    return { key: section.key, heading: section.heading, blocks: kind === 'guidance' ? blocks : [], kind, order, identity };
  });
  const allTexts = new Set([...(title ? [title.text] : []), ...document.blocks.filter(block => block.kind === 'text').map(block => block.text)]);
  const allHashes = new Set(document.blocks.map(block => block.hash));

  return {
    document,
    title,
    preamble: guidanceBlocks(preamble.region),
    sections: modelSections,
    headingKeys: new Set(modelSections.map(section => section.key)),
    guidanceTexts: new Set([...guidanceBlocks(preamble.region), ...modelSections.flatMap(section => section.blocks)].map(block => block.text)),
    allTexts,
    allHashes,
  };
}

function loadTemplates(directory = TEMPLATE_DIRECTORY) {
  return new Map(BACKLOG_FILES.map(file => [file, templateModel(fs.readFileSync(path.join(directory, templateName(file)), 'utf8'))]));
}

// Validates a parsed retired-guidance list; returns null when it is well formed, or the reason it is not.
function retiredProblem(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schema !== 1) return 'unsupported schema';
  if (!Number.isSafeInteger(value.rules) || value.rules < 1) return 'rules must be a positive integer';
  if (!value.retired || typeof value.retired !== 'object' || Array.isArray(value.retired)) return 'retired must be an object';
  for (const [file, lists] of Object.entries(value.retired)) {
    if (!BACKLOG_FILES.includes(file)) return `unknown backlog file ${file}`;
    for (const name of ['blocks', 'headings']) {
      const list = lists?.[name];
      if (!Array.isArray(list) || !list.every(hash => HASH.test(hash))) return `${file} ${name} must be a list of hashes`;
      if (list.some((hash, index) => index > 0 && list[index - 1] >= hash)) return `${file} ${name} must be sorted without duplicates`;
    }
  }

  return null;
}

// The bundled retired-guidance list as sets per file. Its rules version must match the comparison rules setup uses,
// since hashes computed under other rules would match nothing.
function loadRetired(file = RETIRED_FILE) {
  let value;
  try { value = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { requireCondition(false, 'retired-guidance-unavailable', `Retired guidance list is unreadable: ${error.message}`); }
  const problem = retiredProblem(value);
  requireCondition(problem === null, 'retired-guidance-unavailable', `Retired guidance list is malformed: ${problem}`);
  requireCondition(value.rules === COMPARISON_RULES, 'retired-guidance-unavailable', `Retired guidance list uses comparison rules ${value.rules}, setup uses ${COMPARISON_RULES}`);

  return new Map(BACKLOG_FILES.map(name => [name, { blocks: new Set(value.retired[name]?.blocks ?? []), headings: new Set(value.retired[name]?.headings ?? []) }]));
}

module.exports = { READY_INDEXES, RETIRED_FILE, TEMPLATE_DIRECTORY, loadRetired, loadTemplates, readyGrammar, retiredProblem, sectionClass, sectionGrammar, templateModel, templateName };
