'use strict';

// The comparison model setup adjudication and the retired-guidance tool share: Ready's heading boundaries, the
// shared block model's blocks, and the comparison text and hashes derived from them. Changing anything here that
// alters a comparison text changes hashes that projects remember and that the retired list records, so it needs
// COMPARISON_RULES increased and the retired list regenerated (tools/retired-guidance.js --write).
const { createHash } = require('node:crypto');
const { scanMarkdown } = require('../markdown');
const { describeBlocks, maskRawHtmlBlocks } = require('../backlog-catalog');

const COMPARISON_RULES = 1;
const PLACEHOLDER_TEXTS = new Set(['Nothing captured yet.', 'Nothing tracked yet.', 'Nothing being explored yet.', 'Nothing currently tracked.', 'Nothing yet.']);
const PLACEHOLDER_HEADINGS = new Set(['(add sections as features emerge)', '(add sections as work emerges)']);
const CONSTRUCTS = new Set(['fence', 'html', 'table', 'indented-code']);
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);

const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');

// Ready's section-key normalization (normalizeSectionKey in skills/ready/ready.js).
const normalizeHeading = title => title.trim().toLowerCase().replace(/\.$/, '');

// Ready's entry grammar treats only column-0 ATX lines as boundaries: '# ' closes a section, '## ' opens one and '### '
// opens an entry; deeper, indented and setext headings are block content.
function boundary(record, rawHtml) {
  if (!record || rawHtml.has(record) || record.opensFence || !record.outsideFence) return null;
  const match = /^(#{1,3}) (.+)$/.exec(record.content);

  return match ? { level: match[1].length, title: match[2] } : null;
}

// Joins continuation lines as unwrap does (joinContinuations in internal/backlog-catalog.js), then trims each line's
// trailing whitespace and drops trailing blank lines, joining the result with line feeds.
function comparisonText(lines, described, start, end) {
  const joined = [];
  for (let index = start; index <= end; index += 1) {
    if (described[index].continuation !== null && joined.length > 0) {
      const next = lines[index].trimStart();
      const tail = / {2,}$/.test(next) ? `${next.trimEnd()}  ` : next.trimEnd();
      joined[joined.length - 1] = `${joined[joined.length - 1].replace(/\s+$/, '')} ${tail}`;
    } else {
      joined.push(lines[index]);
    }
  }
  const trimmed = joined.map(line => line.replace(/\s+$/, ''));
  while (trimmed.length > 0 && trimmed[trimmed.length - 1] === '') trimmed.pop();

  return trimmed.join(LF);
}

function closeBlock(block, lines, described) {
  let end = block.end;
  while (end > block.start && lines[end].trim() === '') end -= 1;
  block.end = end;
  block.text = comparisonText(lines, described, block.start, end);
  block.hash = sha256(block.text);
  block.placeholder = block.kind === 'text' && PLACEHOLDER_TEXTS.has(block.text);

  return block;
}

// Splits decoded Markdown into heading and text blocks. Returns { unreadable } instead when the text cannot be compared
// reliably: an unclosed fence, or a lone carriage return, which the two scanners would count as different line breaks.
function describeDocument(text) {
  if (new RegExp(`${CR}(?!${LF})`).test(text)) return { unreadable: 'lone-carriage-return' };
  const scan = scanMarkdown(Buffer.from(text, 'utf8'));
  const { lines, described, unclosedFence } = describeBlocks(text);
  if (scan.unclosedFence || unclosedFence) return { unreadable: 'unclosed-fence' };
  const rawHtml = maskRawHtmlBlocks(scan.lines);
  const count = text.endsWith(LF) ? lines.length - 1 : lines.length;
  const blocks = [];
  let current = null;
  const finish = () => {
    if (current) blocks.push(closeBlock(current, lines, described));
    current = null;
  };
  for (let index = 0; index < count; index += 1) {
    const entry = described[index];
    if (entry.block === 'frontmatter') {
      finish();
      continue;
    }
    const heading = boundary(scan.lines[index], rawHtml);
    if (heading) {
      finish();
      blocks.push({ kind: 'heading', level: heading.level, title: heading.title, key: normalizeHeading(heading.title), start: index, end: index, text: lines[index].replace(/\s+$/, ''), hash: sha256(normalizeHeading(heading.title)), placeholder: false });
      continue;
    }
    if (CONSTRUCTS.has(entry.block)) {
      const opensFence = entry.block === 'fence' && scan.lines[index]?.opensFence;
      const tableHeader = entry.block === 'table' && current && current.construct === null && current.end === index - 1 && current.start === current.end;
      if (tableHeader) current.construct = 'table';
      else if (!current || current.construct !== entry.block || current.end !== index - 1 || opensFence) {
        finish();
        current = { kind: 'text', construct: entry.block, start: index, end: index, bullet: false };
      }
      current.end = index;
      continue;
    }
    if (lines[index].trim() === '') {
      finish();
      continue;
    }
    if ((entry.continuation !== null || entry.setext !== null) && current && current.end === index - 1) {
      current.end = index;
      continue;
    }
    finish();
    current = { kind: 'text', construct: null, start: index, end: index, bullet: /^- /.test(lines[index]) };
  }
  finish();

  return { lines, count, blocks };
}

// Groups a document's blocks into its title, preamble and level-two sections. A section's compared region runs from
// its heading to its first entry: a level-three heading, or, where the grammar says so, a column-0 bullet. Level-one
// headings after the title close the current section, and what follows them until the next level-two heading is not
// compared. grammar is { bulletEntriesExcept: Set of normalized section keys } or null.
function describeSections(document, grammar = null) {
  const sections = [];
  const preamble = { key: null, heading: null, region: [], entries: false };
  let title = null;
  let current = preamble;
  let compared = true;
  for (const block of document.blocks) {
    if (block.kind === 'heading' && block.level === 1) {
      if (title === null && current === preamble && preamble.region.length === 0) title = block;
      else {
        current = null;
        compared = false;
      }
      continue;
    }
    if (block.kind === 'heading' && block.level === 2) {
      current = { key: block.key, heading: block, region: [], entries: false };
      sections.push(current);
      compared = true;
      continue;
    }
    if (!current) continue;
    const bulletEntry = grammar && block.bullet && current.heading && !grammar.bulletEntriesExcept.has(current.key);
    if ((block.kind === 'heading' && block.level === 3) || bulletEntry) {
      current.entries = true;
      compared = false;
      continue;
    }
    if (compared && current.entries === false) current.region.push(block);
  }

  return { title, preamble, sections };
}

// The line ending an edit must use, or null for a file that mixes them.
function lineEnding(text, fallback) {
  const crlf = (text.match(new RegExp(`${CR}${LF}`, 'g')) ?? []).length;
  const lf = (text.match(new RegExp(LF, 'g')) ?? []).length;
  if (lf === 0) return fallback;
  if (crlf === lf) return CR + LF;

  return crlf === 0 ? LF : null;
}

module.exports = { COMPARISON_RULES, PLACEHOLDER_HEADINGS, PLACEHOLDER_TEXTS, describeDocument, describeSections, lineEnding, normalizeHeading, sha256 };
