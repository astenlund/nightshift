'use strict';

// Where one index differs from its template: missing sections and blocks, retired blocks and sections, rename
// candidates and replacement candidates (commitment 6 of .nightshift/specs/setup-index-text-adjudication.md).
const { describeDocument, describeSections } = require('./document');
const { sectionClass, sectionGrammar } = require('./templates');

function analyzeIndex(file, text, template, retired, kept = new Set()) {
  const document = describeDocument(text);
  if (document.unreadable) return { unreadable: document.unreadable };
  const { title, preamble, sections } = describeSections(document, sectionGrammar(file));
  const regions = [preamble, ...sections];
  const comparedTexts = new Set(regions.flatMap(region => region.region).filter(block => block.kind === 'text').map(block => block.text));
  const sectionByKey = new Map();
  for (const section of sections) if (!sectionByKey.has(section.key)) sectionByKey.set(section.key, section);
  const isRetiredBlock = block => block.kind === 'text' && retired.blocks.has(block.hash) && !template.allHashes.has(block.hash);
  const isRetiredSection = section => retired.headings.has(section.heading.hash) && !template.headingKeys.has(section.key);
  const differences = [];

  const removableSections = new Set();
  for (const section of sections.filter(isRetiredSection)) {
    const onlyRetired = section.region.every(block => isRetiredBlock(block) || block.placeholder);
    const keptBlock = section.region.some(block => isRetiredBlock(block) && kept.has(block.hash));
    const removable = !section.entries && onlyRetired && !keptBlock;
    if (removable) removableSections.add(section);
    const reason = removable ? null : section.entries ? 'has-entries' : keptBlock ? 'holds-kept-block' : 'holds-other-text';
    differences.push({ kind: 'retired-section', templateHash: section.heading.hash, section, removable, reason, blocks: removable ? section.region.filter(isRetiredBlock) : [] });
  }

  const occurrences = new Map();
  for (const region of regions) {
    if (removableSections.has(region)) continue;
    for (const block of region.region.filter(isRetiredBlock)) {
      if (!occurrences.has(block.hash)) occurrences.set(block.hash, []);
      occurrences.get(block.hash).push({ region, block });
    }
  }
  for (const [hash, list] of occurrences) differences.push({ kind: 'retired-block', templateHash: hash, text: list[0].block.text, occurrences: list });

  for (const block of template.preamble) {
    if (!comparedTexts.has(block.text)) differences.push({ kind: 'missing-block', templateHash: block.hash, templateSection: null, block, region: preamble });
  }
  for (const templateSection of template.sections.filter(section => section.kind === 'guidance')) {
    const indexSection = sectionByKey.get(templateSection.key);
    if (indexSection) {
      for (const block of templateSection.blocks) {
        if (!comparedTexts.has(block.text)) differences.push({ kind: 'missing-block', templateHash: block.hash, templateSection, block, region: indexSection });
      }
      continue;
    }
    differences.push({
      kind: 'missing-section', templateHash: templateSection.identity, templateSection,
      absent: templateSection.blocks.filter(block => !comparedTexts.has(block.text)),
      present: templateSection.blocks.filter(block => comparedTexts.has(block.text)),
      rename: null,
    });
  }

  for (const difference of differences.filter(entry => entry.kind === 'missing-section')) {
    const guidance = new Set(difference.templateSection.blocks.map(block => block.text));
    const newClass = sectionClass(file, difference.templateSection.heading.title);
    const qualifying = sections.filter(section => (isRetiredSection(section) || !template.headingKeys.has(section.key))
      && section.region.some(block => block.kind === 'text' && guidance.has(block.text))
      && section.region.every(block => (block.kind === 'text' && guidance.has(block.text)) || isRetiredBlock(block) || block.placeholder)
      && (!section.entries || sectionClass(file, section.heading.title) === newClass));
    if (qualifying.length === 1) {
      difference.rename = qualifying[0];
      // A retired candidate is a difference of its own; a project's own heading is not, so keeping both keeps only the section.
      difference.renameRetired = isRetiredSection(qualifying[0]);
    }
  }

  for (const difference of differences.filter(entry => entry.kind === 'missing-block')) {
    const candidates = new Map();
    for (const block of difference.region.region) {
      if (block.kind !== 'text' || block.placeholder || template.allTexts.has(block.text) || candidates.has(block.hash)) continue;
      candidates.set(block.hash, block);
    }
    difference.candidates = [...candidates.values()];
  }

  return { document, title, preamble, sections, differences, comparedTexts, sectionKeys: new Set(sectionByKey.keys()) };
}

// Every identity a decision for this file may name: what its template and its retired list define.
function knownIdentities(template, retired) {
  const missing = new Set([...template.preamble, ...template.sections.flatMap(section => section.blocks)].map(block => block.hash));
  const sections = new Set(template.sections.filter(section => section.kind === 'guidance').map(section => section.identity));
  const retiredHashes = new Set([...retired.blocks, ...retired.headings].filter(hash => !template.allHashes.has(hash)));

  return { missing, sections, retired: retiredHashes };
}

module.exports = { analyzeIndex, knownIdentities };
