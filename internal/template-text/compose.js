'use strict';

// Applies one file's resolved decisions to its text (commitment 11 of .nightshift/specs/setup-index-text-adjudication.md).
// Untouched lines keep their bytes; inserted text is the template's own lines, separated by blank lines.
const BOM = String.fromCharCode(0xfeff);
const LF = String.fromCharCode(10);

const isBlank = line => line.trim() === '';

// The template order position each index section occupies: its template section's, or for a section the template does
// not have, the template's entry slot (its placeholder section, or else its first container), where projects keep their
// own sections.
function sectionOrder(template, section) {
  const own = template.sections.find(candidate => candidate.key === section.key);
  if (own) return own.order;
  const slot = template.sections.find(candidate => candidate.kind === 'placeholder') ?? template.sections.find(candidate => candidate.kind === 'container');

  return slot ? slot.order : null;
}

// The lines a section removal deletes: from its heading to the line before the next level-one or level-two heading,
// with last the final non-blank line of that span.
function sectionSpan(document, heading) {
  const next = document.blocks.find(block => block.start > heading.start && block.kind === 'heading' && block.level <= 2) ?? null;
  const inside = document.blocks.filter(block => block.start > heading.start && (!next || block.start < next.start));

  return { start: heading.start, last: inside.length > 0 ? Math.max(...inside.map(block => block.end)) : heading.start, next };
}

// Where a missing block stands among its region's template blocks, so inserts are placed in template order.
const templatePosition = (template, difference) => (difference.templateSection ? difference.templateSection.blocks : template.preamble).indexOf(difference.block);

function composeFile(text, analysis, template, operations, newline) {
  const { document, title, sections } = analysis;
  const lines = document.lines.slice(0, document.count);
  const templateLines = block => template.document.lines.slice(block.start, block.end + 1);
  const firstContent = document.blocks.length > 0 ? Math.min(...document.blocks.map(block => block.start)) : lines.length;
  const after = new Map();
  const before = new Map();
  const atStart = [];
  const atEnd = [];
  const replaced = new Map();
  const deleted = new Set();
  const rewritten = new Map();
  const push = (map, key, chunk) => map.set(key, [...(map.get(key) ?? []), chunk]);
  // Blocks the template writes without a blank line between them, such as the items of a tight list, stay so.
  const adjacent = (earlier, later) => Boolean(earlier && later && earlier.end + 1 === later.start);

  // A template block placed by an earlier operation counts as present for later anchors in the same region.
  const placed = new Map();
  const placeInRegion = (region, orderedBlocks, absentTexts, headingLine) => {
    const present = new Map(region.region.filter(block => block.kind === 'text').map(block => [block.text, { line: block.end }]));
    orderedBlocks.forEach((block, index) => {
      if (!absentTexts.has(block.text)) return;
      let anchor = null;
      for (let earlier = index - 1; earlier >= 0 && anchor === null; earlier -= 1) {
        const text = orderedBlocks[earlier].text;
        const found = placed.get(region)?.get(text) ?? present.get(text) ?? null;
        if (found) anchor = { ...found, templateBlock: orderedBlocks[earlier] };
      }
      anchor ??= headingLine !== null ? { line: headingLine } : title ? { line: title.start } : { start: true };
      const chunk = { lines: templateLines(block), block, joined: adjacent(anchor.templateBlock, block) };
      if (anchor.start) atStart.push(chunk);
      else push(after, anchor.line, chunk);
      if (!placed.has(region)) placed.set(region, new Map());
      placed.get(region).set(block.text, { line: anchor.line, start: anchor.start });
    });
  };

  for (const operation of operations.filter(entry => entry.type === 'replace')) {
    const { difference, candidate } = operation;
    replaced.set(candidate.start, { end: candidate.end, lines: templateLines(difference.block), block: difference.block });
    if (!placed.has(difference.region)) placed.set(difference.region, new Map());
    placed.get(difference.region).set(difference.block.text, { line: candidate.end });
  }
  for (const operation of operations.filter(entry => entry.type === 'rename')) {
    const { difference } = operation;
    const section = difference.rename;
    rewritten.set(section.heading.start, template.document.lines[difference.templateSection.heading.start]);
    placeInRegion(section, difference.templateSection.blocks, new Set(difference.absent.map(block => block.text)), section.heading.start);
  }
  for (const operation of operations.filter(entry => entry.type === 'insert-block').sort((left, right) => templatePosition(template, left.difference) - templatePosition(template, right.difference))) {
    const { difference } = operation;
    const ordered = difference.templateSection ? difference.templateSection.blocks : template.preamble;
    placeInRegion(difference.region, ordered, new Set([difference.block.text]), difference.region.heading ? difference.region.heading.start : null);
  }
  for (const operation of operations.filter(entry => entry.type === 'insert-section').sort((left, right) => left.difference.templateSection.order - right.difference.templateSection.order)) {
    const { difference } = operation;
    const chunk = [template.document.lines[difference.templateSection.heading.start]];
    difference.absent.forEach((block, position) => {
      if (!adjacent(difference.absent[position - 1], block)) chunk.push('');
      chunk.push(...templateLines(block));
    });
    const target = sections.find(section => (sectionOrder(template, section) ?? -1) > difference.templateSection.order);
    if (target) push(before, target.heading.start, chunk);
    else atEnd.push(chunk);
  }
  const deleteWithBlank = (start, end) => {
    for (let line = start; line <= end; line += 1) deleted.add(line);
    if (end + 1 < lines.length && isBlank(lines[end + 1]) && !deleted.has(end + 1)) deleted.add(end + 1);
    else if (start > 0 && isBlank(lines[start - 1]) && !deleted.has(start - 1)) deleted.add(start - 1);
  };
  for (const operation of operations.filter(entry => entry.type === 'remove-block')) {
    for (const { block } of operation.difference.occurrences) {
      if (!replaced.has(block.start)) deleteWithBlank(block.start, block.end);
    }
  }
  for (const operation of operations.filter(entry => entry.type === 'remove-section')) {
    const heading = operation.difference.section.heading;
    const { next } = sectionSpan(document, heading);
    const last = next ? next.start - 1 : lines.length - 1;
    for (let line = heading.start; line <= last; line += 1) deleted.add(line);
    if (!next && heading.start > 0 && isBlank(lines[heading.start - 1])) deleted.add(heading.start - 1);
  }

  const out = [];
  const emitChunks = chunks => {
    chunks.forEach((chunk, position) => {
      const joined = position === 0 ? chunk.joined : adjacent(chunks[position - 1].block, chunk.block);
      if (!joined) out.push('');
      out.push(...chunk.lines);
    });
  };
  const emitAfter = (line, nextLine) => {
    const chunks = after.get(line);
    if (!chunks) return;
    emitChunks(chunks);
    if (nextLine < lines.length && !isBlank(lines[nextLine]) && !deleted.has(nextLine)) out.push('');
  };
  for (let index = 0; index < lines.length; index += 1) {
    if (index === firstContent && atStart.length > 0) {
      emitChunks(atStart.map((chunk, position) => (position === 0 ? { ...chunk, joined: true } : chunk)));
      out.push('');
    }
    for (const chunk of before.get(index) ?? []) {
      if (out.length > 0 && !isBlank(out[out.length - 1])) out.push('');
      out.push(...chunk, '');
    }
    const replacement = replaced.get(index);
    if (replacement) {
      out.push(...replacement.lines);
      index = replacement.end;
      emitAfter(index, index + 1);
      continue;
    }
    if (deleted.has(index)) continue;
    out.push(rewritten.get(index) ?? lines[index]);
    emitAfter(index, index + 1);
  }
  if (firstContent >= lines.length && atStart.length > 0) emitChunks(atStart.map((chunk, position) => (position === 0 ? { ...chunk, joined: out.length === 0 } : chunk)));
  if (atEnd.length > 0) {
    atEnd.forEach((chunk, position) => {
      if (position === 0 ? out.length > 0 && !isBlank(out[out.length - 1]) : true) out.push('');
      out.push(...chunk);
    });
  }
  const bom = text.startsWith(BOM) ? BOM : '';

  return bom + out.join(newline) + (text.endsWith(LF) || lines.length === 0 ? newline : '');
}

module.exports = { composeFile, sectionOrder, sectionSpan };
