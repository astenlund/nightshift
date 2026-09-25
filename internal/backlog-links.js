'use strict';

// Link analysis behind three Ready notices: links and anchors between backlog
// files that no longer resolve, active index entries whose title drifted from
// the record they link, and records that no chain of links from an index
// reaches. It is pure over a root-relative catalog of backlog files, so the
// CLI and the catalog adapter report identically from the same contents.
// Only targets inside the backlog catalog scope are checked; links into
// reports, specs, migration material or code are outside what either front
// end reads and are left to the whole-backlog coherence audit.
//
// This is a model of the Markdown subset backlogs use, not a full CommonMark
// parser. Block structure (front matter, fenced and indented code, HTML
// blocks, tables, setext headings) comes from the unwrap scanner's model in
// backlog-catalog.js, so both read the same Markdown the same way; block
// quotes are unwrapped and their bodies read the same way. HTML comments are
// masked from links and anchors and dropped from heading text, and an inline
// comment never spans a block boundary. List items keep their content
// indentation here, since the shared model has no list context, so a
// blank-separated line nested under an item reads as item content, and a
// fence or heading inside an item is recognized. Links are
// inline links and images plus full, collapsed and shortcut references bound
// to the first definition of their label, with backslash escapes and
// character references honored in destinations. An index entry's record link
// is its heading's inline link, as the parser reads entries, so a
// reference-style entry heading gets no title comparison. Not modeled: lazy
// block-quote continuation lines, a fence opened on a list item's marker line
// (the shared model reads its closing line as an opener), named character
// references beyond the Latin-1 set and common punctuation, raw HTML <a href>
// links, and link text or destinations broken across lines, which the
// hard-wrap notice reports.

const path = require('path');
const { BACKLOG_FILES, LABEL_AT_START, compareTargets, describeBlocks, isCatalogTarget } = require('./backlog-catalog.js');

const ACTIVE_INDEX_FILES = new Set(['QUICK_WINS.md', 'FEATURES.md', 'BUGS.md', 'PATTERNS.md']);
// Blocks rendered as literal text yield no links or headings. An HTML block
// renders its own markup, so an explicit anchor there still counts.
const LITERAL_BLOCKS = new Set(['frontmatter', 'fence', 'html', 'indented-code']);
const ANCHOR_HIDING_BLOCKS = new Set(['frontmatter', 'fence', 'indented-code']);
// A Requires or External label opening a line starts a dependency
// declaration, which the parser resolves itself and reports structurally.
// The declaration continues until the parser's own terminators (assembleLabel
// in skills/ready/ready.js): a blank line, a level-two or level-three heading,
// a bullet, another bold label, or a literal block; an indented annotation
// also ends at the first line that is not indented.
const DEPENDENCY_LABEL_AT_START = /^\*\*(?:Requires|External):\*\*/i;
const DEPENDENCY_HEADING = /^#{2,3} /;
const BLOCK_QUOTE = /^ {0,3}>/;
const BLOCK_QUOTE_MARKER = /^ {0,3}> ?/;
const ATX_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+|$)(.*)$/;
const LINK_REFERENCE_DEFINITION = /^ {0,3}\[([^\]]+)\]:[ \t]*(<[^>\n]*>|\S+)/;
const EXPLICIT_ANCHOR = /<a\s[^>]*?\b(?:id|name)\s*=\s*["']([^"']+)["']/gi;
const URI_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
// A character reference, unless a backslash escapes its ampersand.
const HTML_ENTITY = /(?<!\\)&(?:#(\d+)|#[xX]([0-9A-Fa-f]+)|([A-Za-z]+));/g;
const LIST_ITEM = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+|$)/;
// The named character references decoded: the Latin-1 set, in code point order
// from U+00A0, plus the markup and common punctuation names. Any other name is
// left as written.
const LATIN_1_ENTITY_NAMES = [
  'nbsp', 'iexcl', 'cent', 'pound', 'curren', 'yen', 'brvbar', 'sect', 'uml', 'copy', 'ordf', 'laquo', 'not', 'shy', 'reg', 'macr',
  'deg', 'plusmn', 'sup2', 'sup3', 'acute', 'micro', 'para', 'middot', 'cedil', 'sup1', 'ordm', 'raquo', 'frac14', 'frac12', 'frac34', 'iquest',
  'Agrave', 'Aacute', 'Acirc', 'Atilde', 'Auml', 'Aring', 'AElig', 'Ccedil', 'Egrave', 'Eacute', 'Ecirc', 'Euml', 'Igrave', 'Iacute', 'Icirc', 'Iuml',
  'ETH', 'Ntilde', 'Ograve', 'Oacute', 'Ocirc', 'Otilde', 'Ouml', 'times', 'Oslash', 'Ugrave', 'Uacute', 'Ucirc', 'Uuml', 'Yacute', 'THORN', 'szlig',
  'agrave', 'aacute', 'acirc', 'atilde', 'auml', 'aring', 'aelig', 'ccedil', 'egrave', 'eacute', 'ecirc', 'euml', 'igrave', 'iacute', 'icirc', 'iuml',
  'eth', 'ntilde', 'ograve', 'oacute', 'ocirc', 'otilde', 'ouml', 'divide', 'oslash', 'ugrave', 'uacute', 'ucirc', 'uuml', 'yacute', 'thorn', 'yuml',
];
const NAMED_ENTITIES = new Map([
  ...LATIN_1_ENTITY_NAMES.map((name, offset) => [name, String.fromCharCode(0xa0 + offset)]),
  ...[['amp', 0x26], ['lt', 0x3c], ['gt', 0x3e], ['quot', 0x22], ['apos', 0x27], ['ndash', 0x2013], ['mdash', 0x2014], ['lsquo', 0x2018], ['rsquo', 0x2019],
    ['ldquo', 0x201c], ['rdquo', 0x201d], ['bull', 0x2022], ['hellip', 0x2026], ['euro', 0x20ac], ['trade', 0x2122]].map(([name, code]) => [name, String.fromCharCode(code)]),
]);
// NUL brackets a code span placeholder. Markdown prose has no use for it; a stray
// NUL could at worst garble the text of the one heading or title containing it.
const CODE_SPAN_MARK = String.fromCharCode(0);
const CODE_SPAN_TOKEN = new RegExp(`${CODE_SPAN_MARK}(\\d+)${CODE_SPAN_MARK}`, 'g');
// ASCII punctuation, the characters a backslash escapes in CommonMark.
const ESCAPABLE = /[!-/:-@[-`{-~]/;
const ESCAPED = /\\([!-/:-@[-`{-~])/g;
// Stands in for an escaped character while a line's structure is read: not
// whitespace, a bracket, a parenthesis, a backtick or markup of any kind.
const ESCAPE_MARK = String.fromCharCode(1);

// Replaces code spans with spaces and backslash escapes with a neutral mark so
// neither can open a link, a comment or an anchor, while an escaped character
// inside a link destination still belongs to it. Every column keeps its
// position in the original line. Positions are UTF-16 code units, matching the
// indexes regular expressions report on the joined string.
function blankLiteralText(line) {
  const chars = line.split('');
  const blank = (from, to, mark = ' ') => {
    for (let i = from; i < to; i++) chars[i] = mark;
  };
  let i = 0;
  while (i < chars.length) {
    if (chars[i] === '\\' && i + 1 < chars.length && ESCAPABLE.test(chars[i + 1])) {
      blank(i, i + 2, ESCAPE_MARK);
      i += 2;
      continue;
    }
    if (chars[i] !== '`') {
      i++;
      continue;
    }
    let runEnd = i;
    while (runEnd < chars.length && chars[runEnd] === '`') runEnd++;
    const run = runEnd - i;
    let close = runEnd;
    let closed = -1;
    while (close < chars.length) {
      if (chars[close] !== '`') {
        close++;
        continue;
      }
      let closeEnd = close;
      while (closeEnd < chars.length && chars[closeEnd] === '`') closeEnd++;
      if (closeEnd - close === run) {
        closed = closeEnd;
        break;
      }
      close = closeEnd;
    }
    if (closed < 0) {
      i = runEnd;
      continue;
    }
    blank(i, closed);
    i = closed;
  }

  return chars;
}

// Parses an inline link destination whose "(" is at `open`. Returns the
// destination's [start, stop) range and the index of the closing ")", or null
// when the parenthesis never closes.
function parseDestination(chars, open) {
  let i = open + 1;
  while (chars[i] === ' ' || chars[i] === '\t') i++;
  let start = i;
  let stop;
  if (chars[i] === '<') {
    start = i + 1;
    while (i < chars.length && chars[i] !== '>') i++;
    if (i >= chars.length) return null;
    stop = i;
    i++;
  } else {
    let depth = 0;
    while (i < chars.length && !/\s/.test(chars[i])) {
      if (chars[i] === '(') depth++;
      if (chars[i] === ')') {
        if (depth === 0) break;
        depth--;
      }
      i++;
    }
    stop = i;
  }
  let quote = null;
  for (; i < chars.length; i++) {
    const c = chars[i];
    if (quote !== null) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === '\'') {
      quote = c;
    } else if (c === ')') {
      return { start, stop, end: i };
    }
  }

  return null;
}

// Index of the "]" closing the bracket opened at `open`, or -1.
function closingBracket(chars, open) {
  let depth = 0;
  for (let j = open + 1; j < chars.length; j++) {
    if (chars[j] === '[') depth++;
    if (chars[j] !== ']') continue;
    if (depth === 0) return j;
    depth--;
  }

  return -1;
}

// A destination as written, with character references decoded and backslash
// escapes removed, as Markdown renders it.
function renderDestination(written) {
  return decodeEntities(written).replace(ESCAPED, '$1');
}

function normalizeLabel(label) {
  return label.trim().replace(/\s+/g, ' ').toLowerCase();
}

// The inline link and image destinations in one line, including links nested
// inside link text, and the labels of its full, collapsed and shortcut
// reference links. `chars` is the line after blankLiteralText.
function inlineReferences(line, chars) {
  const destinations = [];
  const labels = [];
  const destinationEnds = new Map();
  for (let i = 0; i < chars.length; i++) {
    if (destinationEnds.has(i)) {
      i = destinationEnds.get(i);
      continue;
    }
    if (chars[i] !== '[') continue;
    const close = closingBracket(chars, i);
    if (close < 0) continue;
    const text = chars.slice(i + 1, close).join('');
    const next = chars[close + 1];
    if (next === '(') {
      const destination = parseDestination(chars, close + 1);
      if (destination === null) continue;
      destinations.push(renderDestination(line.slice(destination.start, destination.stop)));
      destinationEnds.set(close, destination.end);
    } else if (next === '[') {
      const labelClose = closingBracket(chars, close + 1);
      if (labelClose < 0) continue;
      const label = chars.slice(close + 2, labelClose).join('');
      labels.push(normalizeLabel(label.trim() === '' ? text : label));
      destinationEnds.set(close, labelClose);
    } else if (next !== ':') {
      labels.push(normalizeLabel(text));
    }
  }

  return { destinations, labels };
}

// The ATX heading on a line as { level, title }, or null. An optional closing
// run of "#" after whitespace is not part of the title.
function atxHeading(line) {
  const match = ATX_HEADING.exec(line);
  if (match === null) return null;

  return { level: match[1].length, title: match[2].trim().replace(/[ \t]+#+[ \t]*$/, '').trim() };
}

function decodeEntities(text) {
  return text.replace(HTML_ENTITY, (match, decimal, hex, name) => {
    if (name !== undefined) return NAMED_ENTITIES.get(name) ?? match;
    const code = decimal !== undefined ? Number(decimal) : Number.parseInt(hex, 16);

    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

// The rendered text of inline Markdown, as a heading's text content: link and
// image markup reduced to its text, code spans to their contents, emphasis
// markers and inline HTML tags removed, character references decoded.
function plainText(markdown) {
  // Code spans are set aside first, since link text can contain them and
  // their contents keep every character the rules below would change.
  const spans = [];
  const text = markdown
    .replace(/(`+)([\s\S]*?)\1/g, (match, ticks, code) => {
      spans.push(code.trim());
      return `${CODE_SPAN_MARK}${spans.length - 1}${CODE_SPAN_MARK}`;
    })
    .replace(/!?\[([^\]]*)\]\((?:[^()]|\([^()]*\))*\)/g, '$1')
    .replace(/!?\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?[A-Za-z][^>]*>/g, '')
    // Emphasis markers go only as matched pairs; a lone "*" is literal text,
    // and an underscore inside a word never delimits emphasis.
    .replace(/(\*\*|~~)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/\*(?=\S)([\s\S]*?\S)\*/g, '$1')
    .replace(/(^|[^\p{L}\p{N}_])(__?)(?=\S)([\s\S]*?\S)\2(?![\p{L}\p{N}_])/gu, '$1$3');

  return decodeEntities(text).replace(CODE_SPAN_TOKEN, (match, index) => spans[Number(index)]).trim();
}

// GitHub's heading anchor: lowercase text content with punctuation removed and
// each space turned into a hyphen; repeated slugs gain -1, -2 and so on.
function slugAnchors(headings) {
  const anchors = new Set();
  const counts = new Map();
  for (const heading of headings) {
    const base = plainText(heading.title).toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replace(/ /g, '-');
    let slug = base;
    while (anchors.has(slug)) {
      const next = (counts.get(base) ?? 0) + 1;
      counts.set(base, next);
      slug = `${base}-${next}`;
    }
    anchors.add(slug);
  }

  return anchors;
}

// Replaces HTML comment spans in a blanked line with spaces. `open` says
// whether a comment is still open from an earlier line; returns the same for
// the next line.
function blankComments(chars, open) {
  const text = chars.join('');
  let inComment = open;
  let i = 0;
  while (i < text.length) {
    if (!inComment) {
      const start = text.indexOf('<!--', i);
      if (start < 0) return false;
      inComment = true;
      i = start;
      continue;
    }
    const close = text.indexOf('-->', i);
    const end = close < 0 ? text.length : close + 3;
    for (let j = i; j < end; j++) chars[j] = ' ';
    if (close < 0) return true;
    inComment = false;
    i = end;
  }

  return inComment;
}

// Leading whitespace width, with a tab advancing to the next multiple of four.
function indentWidth(text) {
  let width = 0;
  for (const character of text) {
    if (character === ' ') width += 1;
    else if (character === '\t') width += 4 - (width % 4);
    else break;
  }

  return width;
}

// The line with up to `columns` columns of leading whitespace removed.
function stripIndent(line, columns) {
  let width = 0;
  let index = 0;
  while (index < line.length && width < columns && (line[index] === ' ' || line[index] === '\t')) {
    width = line[index] === '\t' ? width + 4 - (width % 4) : width + 1;
    index++;
  }

  return line.slice(index);
}

// The shared block model keeps no list context, so it reads a blank-separated
// line indented under a list item as indented code. `list` tracks the content
// indentation of open items (`indents`) and a fence opened inside an item
// (`fence`). Returns the line's block, with such a line read as item content
// (null) or as a fence it opens or continues, unless it is indented four
// columns past the item's content, which is code inside the item. `content`
// is the line relative to its enclosing item, where a heading is recognized.
function listAwareBlock(line, { block, continuation }, list) {
  const blank = line.trim() === '';
  const indent = indentWidth(line);
  if (list.fence !== null) {
    if (blank || indent >= list.fence.indent) {
      const closer = /^(`{3,}|~{3,})[ \t]*$/.exec(line.trim());
      if (closer !== null && closer[1][0] === list.fence.char && closer[1].length >= list.fence.length) list.fence = null;

      return { block: 'fence', content: line };
    }
    // A fence inside an item ends with the item.
    list.fence = null;
  }
  if (blank || (block !== null && block !== 'indented-code')) return { block, content: line };
  const container = list.indents.findLast((contentIndent) => contentIndent <= indent);
  const itemContent = container !== undefined && indent < container + 4;
  if (block !== null && !itemContent) return { block, content: line };
  if (block !== null) {
    const opener = /^(`{3,}|~{3,})(.*)$/.exec(line.trim());
    if (opener !== null && !(opener[1][0] === '`' && opener[2].includes('`'))) {
      list.fence = { char: opener[1][0], length: opener[1].length, indent: container };

      return { block: 'fence', content: line };
    }
  }
  const item = LIST_ITEM.exec(line);
  if (item !== null) {
    while (list.indents.length > 0 && list.indents.at(-1) > indent) list.indents.pop();
    const gap = item[3] === '' || indentWidth(item[3]) > 4 ? 1 : indentWidth(item[3]);
    list.indents.push(indentWidth(item[1]) + item[2].length + gap);

    return { block: null, content: line.slice(item[0].length) };
  }
  if (continuation === null) {
    while (list.indents.length > 0 && list.indents.at(-1) > indent) list.indents.pop();
  }

  return { block: null, content: container === undefined ? line : stripIndent(line, container) };
}

// The rendered parts of a document or block-quote body, in document order:
// inline links, reference definitions and used labels, headings and explicit
// anchors. `lineOffset` places a block-quote body's lines in its document.
function walkDocument(contents, lineOffset = 0) {
  const { lines, described } = describeBlocks(contents);
  const parts = { links: [], definitions: [], usedLabels: new Map(), headings: [], explicitAnchors: [] };
  let dependency = null;
  let inComment = false;
  const list = { indents: [], fence: null };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const { setext } = described[index];
    const { block, content } = listAwareBlock(line, described[index], list);
    const lineNumber = lineOffset + index + 1;
    if (block === null && BLOCK_QUOTE.test(line)) {
      let end = index;
      while (end < lines.length && described[end].block === null && BLOCK_QUOTE.test(lines[end])) end++;
      const quoted = walkDocument(lines.slice(index, end).map((text) => text.replace(BLOCK_QUOTE_MARKER, '')).join('\n'), lineOffset + index);
      for (const key of ['links', 'definitions', 'headings', 'explicitAnchors']) parts[key].push(...quoted[key]);
      for (const [label, inProse] of quoted.usedLabels) markLabelUse(parts.usedLabels, label, inProse);
      dependency = null;
      index = end - 1;
      continue;
    }
    const chars = blankLiteralText(line);
    // Inline content never crosses a block boundary, so an inline comment left
    // open continues only into the wrapped lines of the same paragraph or item.
    if (block !== 'html' && described[index].continuation === null) inComment = false;
    if (!ANCHOR_HIDING_BLOCKS.has(block)) {
      inComment = blankComments(chars, inComment);
      for (const match of chars.join('').matchAll(EXPLICIT_ANCHOR)) parts.explicitAnchors.push(match[1].toLowerCase());
    }
    if (LITERAL_BLOCKS.has(block)) {
      dependency = null;
      continue;
    }
    if (setext !== null) {
      parts.headings.push({ level: setext.level, title: lines.slice(setext.from, index).map((text) => text.trim()).join(' ') });
      continue;
    }
    const trimmed = line.trim();
    if (DEPENDENCY_LABEL_AT_START.test(trimmed)) {
      dependency = { indented: /^\s/.test(line) };
    } else if (dependency !== null && (trimmed === '' || DEPENDENCY_HEADING.test(line) || trimmed.startsWith('- ') || LABEL_AT_START.test(trimmed) || (dependency.indented && !/^\s+\S/.test(line)))) {
      dependency = null;
    }
    const heading = atxHeading(content);
    if (heading !== null) parts.headings.push(heading);
    const definition = LINK_REFERENCE_DEFINITION.exec(chars.join(''));
    if (definition !== null) {
      const start = definition.index + definition[0].length - definition[2].length;
      const raw = renderDestination(line.slice(start, start + definition[2].length).replace(/^<(.*)>$/, '$1'));
      parts.definitions.push({ line: lineNumber, raw, dependency: dependency !== null, label: normalizeLabel(definition[1]) });
      continue;
    }
    const { destinations, labels } = inlineReferences(line, chars);
    for (const raw of destinations) parts.links.push({ line: lineNumber, raw, dependency: dependency !== null });
    for (const label of labels) markLabelUse(parts.usedLabels, label, dependency === null);
  }

  return parts;
}

// Records a reference label's use; `inProse` is true unless the use sits in a
// dependency declaration, which the parser resolves itself.
function markLabelUse(usedLabels, label, inProse) {
  usedLabels.set(label, usedLabels.get(label) === true || inProse);
}

// One walk over a document's rendered structure. Returns its links in line
// order as { line, raw, dependency }, its heading and explicit anchors, and its
// title (the first level-one heading as text, or null). A reference
// definition counts as a link only when it is the first definition of its
// label and the document uses that label; used only from dependency
// declarations, it is a dependency link.
function scanDocument(contents) {
  const parts = walkDocument(contents);
  const firstDefinitions = new Map();
  for (const definition of parts.definitions) {
    if (!firstDefinitions.has(definition.label)) firstDefinitions.set(definition.label, definition);
  }
  const used = [...firstDefinitions.values()]
    .filter((definition) => parts.usedLabels.has(definition.label))
    .map(({ label, ...link }) => ({ ...link, dependency: link.dependency || !parts.usedLabels.get(label) }));
  const links = [...parts.links, ...used].sort((left, right) => left.line - right.line);
  const title = parts.headings.find((heading) => heading.level === 1);

  return {
    links,
    anchors: new Set([...slugAnchors(parts.headings), ...parts.explicitAnchors]),
    title: title === undefined ? null : plainText(title.title),
  };
}

function extractLinks(contents) {
  return scanDocument(contents).links;
}

function headingAnchors(contents) {
  return scanDocument(contents).anchors;
}

function decodeLinkPath(raw) {
  try {
    return decodeURIComponent(raw);
  } catch {
    // A malformed escape is left as written; it then fails to resolve like any other misspelling.
    return raw;
  }
}

// Resolves a link destination written in `source` against the backlog scope.
// Returns { file, anchor } for a checkable target, or null when the link is
// external, absolute, non-portable or outside the backlog catalog scope.
function resolveLink(source, raw) {
  if (raw === '' || URI_SCHEME.test(raw) || raw.startsWith('/') || raw.includes('\\')) return null;
  const hash = raw.indexOf('#');
  const filePart = hash < 0 ? raw : raw.slice(0, hash);
  const anchor = hash < 0 ? null : decodeLinkPath(raw.slice(hash + 1));
  if (filePart.includes('?')) return null;
  if (filePart === '') return anchor ? { file: source, anchor } : null;
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(source), decodeLinkPath(filePart)));
  if (resolved.startsWith('../') || resolved === '..' || !isCatalogTarget(resolved)) return null;

  return { file: resolved, anchor: anchor || null };
}

function createCatalogView(files) {
  const contentsByTarget = new Map(files.map(({ target, contents }) => [target, contents]));
  const documents = new Map();

  return {
    targets: [...contentsByTarget.keys()].sort(compareTargets),
    has: (target) => contentsByTarget.has(target),
    readable: (target) => contentsByTarget.get(target) !== undefined,
    unreadable: [...contentsByTarget.values()].some((contents) => contents === undefined),
    document(target) {
      if (!documents.has(target)) documents.set(target, scanDocument(contentsByTarget.get(target)));
      return documents.get(target);
    },
  };
}

function brokenLinkNotices(view, coveredTargets) {
  const notices = [];
  for (const source of view.targets) {
    const isSource = ACTIVE_INDEX_FILES.has(source) || source.includes('/');
    if (!isSource || !view.readable(source)) continue;
    for (const link of view.document(source).links) {
      if (link.dependency) continue;
      const resolved = resolveLink(source, link.raw);
      if (resolved === null) continue;
      const at = `${source} line ${link.line} links to ${link.raw}`;
      if (!view.has(resolved.file)) {
        if (coveredTargets.has(`${source}\0${resolved.file}`)) continue;
        notices.push({ notice: `${at}, which does not exist; fix or remove the link`, evidencePaths: [source] });
        continue;
      }
      if (resolved.anchor === null || !view.readable(resolved.file)) continue;
      if (!view.document(resolved.file).anchors.has(resolved.anchor.toLowerCase())) {
        notices.push({ notice: `${at}, but ${resolved.file} has no heading with that anchor; fix the anchor or the heading`, evidencePaths: [source, resolved.file] });
      }
    }
  }

  return notices;
}

// Only a record, a file inside a backlog directory, has a title to match; an
// entry heading that links a section of its record still names that record.
function titleDriftNotices(view, linkedEntries, normalizeTitle) {
  const notices = [];
  for (const entry of linkedEntries) {
    const resolved = resolveLink(entry.index, entry.target);
    if (resolved === null || !resolved.file.includes('/') || !view.has(resolved.file) || !view.readable(resolved.file)) continue;
    const { title } = view.document(resolved.file);
    if (title === null || normalizeTitle(plainText(entry.title)) === normalizeTitle(title)) continue;
    notices.push({
      notice: `${entry.index} entry "${entry.title}" links to ${resolved.file}, whose title is "${title}"; align the entry title and the record heading`,
      evidencePaths: [entry.index, resolved.file],
    });
  }

  return notices;
}

// Records reachable from the seven index files through links of every kind,
// including dependency declarations and history entries. A record is any
// catalog file inside a backlog directory.
function unreachableRecordNotices(view) {
  if (view.unreadable) {
    return [{ notice: 'backlog records were not checked for reachability this run because a backlog file could not be read; retry', evidencePaths: [] }];
  }
  const reached = new Set(BACKLOG_FILES.filter((target) => view.has(target)));
  const queue = [...reached];
  while (queue.length > 0) {
    const source = queue.pop();
    for (const link of view.document(source).links) {
      const resolved = resolveLink(source, link.raw);
      if (resolved === null || reached.has(resolved.file) || !view.has(resolved.file)) continue;
      reached.add(resolved.file);
      queue.push(resolved.file);
    }
  }
  const unreachable = view.targets.filter((target) => target.includes('/') && !reached.has(target));
  if (unreachable.length === 0) return [];
  const noun = unreachable.length === 1 ? 'record is' : 'records are';

  return [{
    notice: `${unreachable.length} backlog ${noun} not reachable by links from any backlog index: ${unreachable.join(', ')}; link each from the index entry, history entry or parent record that tracks it, or move it out of the backlog directories`,
    evidencePaths: unreachable,
  }];
}

// files: [{ target, contents }] for every backlog file, with contents
// undefined when the file exists but could not be read (its own notice
// reports that). linkedEntries: [{ index, title, target }] for active index
// entries whose heading links a record. coveredTargets: "source\0file" keys
// whose missing file another check already reports. normalizeTitle: the
// parser's title normalization. Returns [{ notice, evidencePaths }].
function analyzeBacklogLinks({ files, linkedEntries, coveredTargets, normalizeTitle }) {
  const view = createCatalogView(files);

  return [
    ...brokenLinkNotices(view, coveredTargets),
    ...titleDriftNotices(view, linkedEntries, normalizeTitle),
    ...unreachableRecordNotices(view),
  ];
}

module.exports = { analyzeBacklogLinks, atxHeading, extractLinks, headingAnchors, resolveLink };
