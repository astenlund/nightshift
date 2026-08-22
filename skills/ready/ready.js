#!/usr/bin/env node
'use strict';

// Deterministic parser behind the nightshift:ready skill. Reads the active
// .claude/ indexes (QUICK_WINS.md, FEATURES.md, BUGS.md), resolves each
// entry's **Requires:** line (in-backlog links) and optional **External:**
// line (external primitives), expands sliced features into per-slice work
// units, scans each linked breakout file for a stray dependency line, and
// emits a JSON report on stdout:
//
//   { indexes, ready, blocked, external, exploring, structuralErrors, notices }
//
// History archives are never read: the walk-and-remove convention keeps
// active Requires lines authoritative. PATTERNS.md is a pattern registry,
// not a work backlog, so it is not parsed either.
//
// Usage: node ready.js [repo-root-or-.claude-dir]   (defaults to cwd)

const fs = require('fs');
const path = require('path');
const { scanMarkdown } = require('../spec-agreement/spec-agreement.js');

const INDEX_FILE_STEMS = new Set([
  'QUICK_WINS', 'FEATURES', 'BUGS', 'PATTERNS',
  'QUICK_WINS_HISTORY', 'FEATURES_HISTORY', 'BUGS_HISTORY',
]);
const WORK_INDEX_NAMES = ['QUICK_WINS', 'FEATURES', 'BUGS'];

// The one excluded section whose entries are still collected (as drafts,
// never as work items). Named once so the exclusion and the collection
// cannot drift apart.
const EXPLORING_SECTION = 'exploring';

const EXCLUDED_SECTIONS = {
  QUICK_WINS: ['history'],
  // 'requires lines' and 'slicing' are template convention sections; they
  // carry prose and examples, never work entries.
  FEATURES: [EXPLORING_SECTION, 'author tooling', 'history', 'implemented', 'requires lines', 'slicing'],
  BUGS: ['history', 'fixed', 'requires lines'],
};

const PLACEHOLDER_LINES = new Set([
  'nothing tracked yet.', 'nothing captured yet.', 'nothing yet.',
  'nothing currently tracked.', 'nothing being explored yet.',
]);

// A bold label at line start (e.g. **Slices:**, **Shipped:**) terminates a
// wrapped Requires or External line; inline **bold** mid-line does not.
const LABEL_AT_START = /^\*\*[^*]+?:\*\*/;
// The two dependency labels. Requires holds in-backlog links only; External
// holds bare-text external primitives only. Both share one grammar.
const REQUIRES_LABEL = /^\*\*Requires:\*\*/i;
const EXTERNAL_LABEL = /^\*\*External:\*\*/i;
const BREAKOUT_LINE_LABELS = [['Requires', REQUIRES_LABEL], ['External', EXTERNAL_LABEL]];
// Every grammar error names its remedy: these messages are the upgrade
// path for backlogs written under the old single-field grammar.
const EMPTY_REQUIRES_PROBLEM = 'empty **Requires:** label; write none. when there are no upstream gates';
const EMPTY_EXTERNAL_PROBLEM = 'empty **External:** label; delete the line (absence is the only empty form)';
const NONE_IN_EXTERNAL_PROBLEM = 'none. in **External:**; delete the line (absence is the only empty form)';
const HEADING = /^#{2,3} /;
const BULLET = /^- /;

// ---------- normalization ----------

// Strip surrounding markers repeatedly until stable: whitespace, **bold**,
// ~~strikethrough~~, `backticks`, and a single trailing period per pass.
// A single pass leaves inner markers behind when surrounded by outer ones.
function stripStable(s) {
  let prev = null;
  let cur = String(s);
  while (cur !== prev) {
    prev = cur;
    cur = cur.trim();
    if (cur.startsWith('**') && cur.endsWith('**') && cur.length > 4) {
      cur = cur.slice(2, -2);
    }
    if (cur.startsWith('~~') && cur.endsWith('~~') && cur.length > 4) {
      cur = cur.slice(2, -2);
    }
    if (cur.startsWith('`') && cur.endsWith('`') && cur.length > 2) {
      cur = cur.slice(1, -1);
    }
    if (cur.endsWith('.')) {
      cur = cur.slice(0, -1);
    }
  }
  return cur;
}

// Full slice-name normalization: stable strip, then drop an optional
// leading "<token>( <token)* " slice-type prefix with a spaced
// em-dash, en-dash, or hyphen separator ("MVP - ", "Continuation - ",
// "Slice 2 - "), then stable strip again, then case-fold.
function normalizeSliceName(s) {
  let cur = stripStable(s);
  // The separator may be a spaced em-dash, en-dash, or plain hyphen.
  cur = cur.replace(/^\S+(?: \S+)* [\u2014\u2013-] /, '');
  cur = stripStable(cur);
  return cur.toLowerCase().replace(/\s+/g, ' ');
}

function normalizeTitle(s) {
  return stripStable(s).toLowerCase().replace(/\s+/g, ' ');
}

// ---------- low-level markdown helpers ----------

// Split "a, [b, c](x), d" on commas at bracket/paren depth 0.
function splitTopLevelCommas(s) {
  const items = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '[' || ch === '(') depth++;
    else if (ch === ']' || ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      items.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  items.push(cur);
  return items.map((i) => i.trim()).filter((i) => i.length > 0);
}

// One item of a Requires or External line: a link, the word none, or bare
// text. Which kinds a label accepts is the caller's rule, not the parser's.
function parseDependencyItem(raw) {
  const linkMatch = raw.match(/^\[([^\]]*)\]\(([^)]*)\)\.?$/);
  if (linkMatch) {
    return { kind: 'link', display: linkMatch[1].trim(), target: linkMatch[2].trim() };
  }
  if (/^none\.?$/i.test(raw)) {
    return { kind: 'none' };
  }
  return { kind: 'text', text: raw.replace(/\.$/, '') };
}

// Assemble a wrapped label line starting at records[start]. Joins
// continuation lines until a terminator: blank line, ##/### heading,
// "- " bullet, or a **Label:** line at line start.
function assembleLabel(records, start, labelRe) {
  const first = records[start].content.trim();
  let content = first.replace(labelRe, '').trim();
  let i = start + 1;
  while (i < records.length) {
    const record = records[i];
    const line = record.content;
    const t = line.trim();
    if (record.opensFence || !record.outsideFence) {
      i++;
      continue;
    }
    if (
      t === '' || HEADING.test(line) || BULLET.test(t) ||
      LABEL_AT_START.test(t)
    ) {
      break;
    }
    content += ' ' + t;
    i++;
  }
  return { content: content.trim(), end: i };
}

// ---------- entry extraction ----------

// Extract entries grouped under non-excluded ## sections.
// FEATURES/BUGS entries are ### headings only (the ###-only filter is what
// excludes preface bullets by design, so no prose notices there).
// QUICK_WINS additionally parses top-level "- " bullets as entries (its
// template allows loose inline shapes) and emits a notice for sections
// whose content matches neither shape.
// opts: { bullets: boolean, noticeProse: boolean, collectSections: string[] }
// Returns { entries, proseOnlySections, collectedEntries } (collectedEntries
// holds ### entries from excluded-but-collected sections; [] unless the
// section is both excluded AND named in collectSections. A non-excluded
// section named in collectSections still pushes to entries as normal and
// leaves collectedEntries empty).
function createSectionState(title = null, excluded = false, collected = false) {
  return {
    title,
    excluded,
    collected,
    hasEntry: false,
    hasProse: false,
  };
}

function openSection(rawTitle, excludedSections, collectSections) {
  const title = rawTitle.trim();
  const key = title.toLowerCase().replace(/\.$/, '');

  return createSectionState(title, excludedSections.has(key), collectSections.has(key));
}

function createHeadingEntry(rawHeading, sectionTitle) {
  const heading = rawHeading.trim();
  const link = heading.match(/^\[([^\]]*)\]\(([^)]*)\)$/);

  return {
    kind: 'h3',
    title: link ? link[1].trim() : heading,
    selfTarget: link ? link[2].trim() : null,
    section: sectionTitle,
    bodyLines: [],
  };
}

function extractBulletTitle(text) {
  const boldMatch = text.match(/^\*\*(.+?)\*\*/);

  return stripStable(boldMatch ? boldMatch[1] : text.split('.')[0]);
}

function createBulletEntry(line, sectionTitle) {
  const text = line.replace(/^- /, '').trim();

  return {
    kind: 'bullet',
    title: extractBulletTitle(text),
    selfTarget: null,
    section: sectionTitle,
    bodyLines: [text],
  };
}

function finalizeBulletEntry(entry) {
  const text = entry.bodyLines.join(' ');
  entry.title = extractBulletTitle(text);
  entry.bodyLines = [text];
}

function recordProseOnlySection(section, opts, proseOnlySections) {
  if (opts.noticeProse && section.title !== null && !section.excluded && !section.hasEntry && section.hasProse) {
    proseOnlySections.push(section.title);
  }
}

function extractEntries(content, excludedSectionTitles, opts = {}) {
  const records = scanMarkdown(Buffer.from(content, 'utf8')).lines;
  const excluded = new Set(excludedSectionTitles.map((t) => t.toLowerCase()));
  const collectSections = new Set((opts.collectSections || []).map((t) => t.toLowerCase()));
  const entries = [];
  const proseOnlySections = [];
  const collectedEntries = [];

  let section = createSectionState();
  let current = null;

  for (const record of records) {
    const line = record.content;
    if (record.opensFence || !record.outsideFence) {
      if (current && current.kind === 'h3') {
        current.bodyLines.push(line);
      } else if (current && current.kind === 'bullet') {
        current.bodyLines.push(line.trim());
      } else if (section.title !== null && !section.excluded && line.trim() !== '') {
        section.hasProse = true;
      }
      continue;
    }
    if (record.heading?.level === 1 && /^# /.test(line)) {
      if (current?.kind === 'bullet') {
        finalizeBulletEntry(current);
      }
      recordProseOnlySection(section, opts, proseOnlySections);
      current = null;
      section = createSectionState();
      continue;
    }
    const h2 = line.match(/^## (.+)$/);
    if (h2) {
      if (current?.kind === 'bullet') {
        finalizeBulletEntry(current);
      }
      recordProseOnlySection(section, opts, proseOnlySections);
      current = null;
      section = openSection(h2[1], excluded, collectSections);
      continue;
    }
    const h3 = line.match(/^### (.+)$/);
    if (h3) {
      if (current?.kind === 'bullet') {
        finalizeBulletEntry(current);
      }
      current = null;
      if (section.title !== null && (!section.excluded || section.collected)) {
        current = createHeadingEntry(h3[1], section.title);
        if (section.excluded) {
          collectedEntries.push(current);
        } else {
          section.hasEntry = true;
          entries.push(current);
        }
      }
      continue;
    }
    if (current && current.kind === 'h3') {
      current.bodyLines.push(line);
      continue;
    }
    if (opts.bullets && BULLET.test(line) && section.title !== null && !section.excluded) {
      if (current?.kind === 'bullet') {
        finalizeBulletEntry(current);
      }
      section.hasEntry = true;
      current = createBulletEntry(line, section.title);
      entries.push(current);
      continue;
    }
    if (current && current.kind === 'bullet' && /^\s+\S/.test(line)) {
      current.bodyLines.push(line.trim());
      continue;
    }
    if (current && current.kind === 'bullet') {
      finalizeBulletEntry(current);
      current = null; // blank or non-indented line ends a bullet entry
    }
    if (section.title !== null && !section.excluded) {
      const t = line.trim();
      if (t !== '' && !PLACEHOLDER_LINES.has(t.toLowerCase())) {
        section.hasProse = true;
      }
    }
  }
  if (current?.kind === 'bullet') {
    finalizeBulletEntry(current);
  }
  recordProseOnlySection(section, opts, proseOnlySections);
  return { entries, proseOnlySections, collectedEntries };
}

// ---------- Requires + Slices parsing on an entry body ----------

function scanBodyLines(bodyLines) {
  return scanMarkdown(Buffer.from(bodyLines.join('\n'), 'utf8')).lines;
}

function findLabel(bodyLines, labelRe) {
  return findLabelInRecords(scanBodyLines(bodyLines), labelRe);
}

function findLabelInRecords(records, labelRe) {
  for (let i = 0; i < records.length; i++) {
    const line = records[i].content;
    if (records[i].outsideFence && labelRe.test(line.trim()) && !/^\s+/.test(line)) {
      return assembleLabel(records, i, labelRe);
    }
  }
  return null;
}

function findRequires(bodyLines) {
  return findLabel(bodyLines, REQUIRES_LABEL);
}

function findExternal(bodyLines) {
  return findLabel(bodyLines, EXTERNAL_LABEL);
}

// Parse the **Slices:** block. Slice-declaring bullets are "- " bullets at
// indent 0; indented continuation lines (inline **Requires:** and
// **External:** annotations) attach to the preceding bullet.
function parseSlices(bodyLines) {
  return parseSlicesInRecords(scanBodyLines(bodyLines));
}

function parseSlicesInRecords(records) {
  let start = -1;
  for (let i = 0; i < records.length; i++) {
    const line = records[i].content;
    if (records[i].outsideFence && /^\*\*Slices:\*\*\s*$/i.test(line.trim()) && !/^\s+/.test(line)) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;

  const slices = [];
  let i = start + 1;
  let sawBullet = false;
  for (; i < records.length; i++) {
    const record = records[i];
    const line = record.content;
    const t = line.trim();
    if (record.opensFence || !record.outsideFence) {
      continue;
    }
    if (t === '') {
      if (sawBullet) {
        // A blank line followed by a non-bullet, non-indented line ends
        // the block; peek ahead.
        const next = nextFenceEligibleRecord(records, i + 1);
        if (next === undefined) break;
        if (!BULLET.test(next.content.trim()) && !/^\s+\S/.test(next.content)) break;
      }
      continue;
    }
    if (BULLET.test(line)) {
      sawBullet = true;
      const text = line.replace(/^- /, '').trim();
      const struckMatch = text.match(/^~~(.+?)~~/);
      const boldMatch = text.match(/^\*\*(.+?)\*\*/);
      let nameRaw;
      if (struckMatch) nameRaw = struckMatch[1];
      else if (boldMatch) nameRaw = boldMatch[1];
      else nameRaw = text.split('.')[0];
      slices.push({
        raw: text,
        declaration: line,
        name: normalizeSliceName(nameRaw),
        displayName: stripStable(nameRaw),
        struck: Boolean(struckMatch),
        inlineRequires: null,
        inlineExternal: null,
      });
    } else if (/^\s+\S/.test(line) && slices.length > 0) {
      const labelRe = REQUIRES_LABEL.test(t) ? REQUIRES_LABEL : EXTERNAL_LABEL.test(t) ? EXTERNAL_LABEL : null;
      if (labelRe !== null) {
        // Assemble the indented inline annotation, joining further
        // indented non-bullet lines.
        let content = t.replace(labelRe, '').trim();
        let j = i + 1;
        while (j < records.length) {
          const cont = records[j];
          const ct = cont.content.trim();
          if (cont.opensFence || !cont.outsideFence) {
            j++;
            continue;
          }
          if (ct === '' || BULLET.test(cont.content) || !/^\s+\S/.test(cont.content) || LABEL_AT_START.test(ct)) break;
          content += ' ' + ct;
          j++;
        }
        const slice = slices[slices.length - 1];
        if (labelRe === REQUIRES_LABEL) {
          slice.inlineRequires = content;
        } else {
          slice.inlineExternal = content;
        }
        i = j - 1;
      }
      // Other indented continuation prose belongs to the bullet; skip.
    } else {
      // Non-indented, non-bullet, non-blank line (e.g. the top-level
      // **Requires:** label) ends the block.
      break;
    }
  }
  return slices;
}

function nextFenceEligibleRecord(records, start) {
  for (let i = start; i < records.length; i++) {
    if (!records[i].opensFence && records[i].outsideFence) {
      return records[i];
    }
  }

  return undefined;
}

function findSlicesByNormalizedName(slices, requestedName) {
  const normalizedName = normalizeSliceName(requestedName);

  return slices.filter((slice) => slice.name === normalizedName);
}

// ---------- registry + resolution ----------

function targetSlug(target) {
  if (!target) return null;
  const noAnchor = target.split('#')[0];
  const base = path.basename(noAnchor, path.extname(noAnchor));
  return base || null;
}

// Normalized directory-qualified key for a link target or entry
// self-link, e.g. "features/foo". Leading ./ and ../ segments are
// dropped: all live data is relative to the .claude/ directory the
// indexes share. Returns null for index-file targets.
function targetPathKey(target) {
  if (!target) return null;
  const noAnchor = target.split('#')[0].replace(/\\/g, '/');
  const parts = noAnchor.split('/').filter((p) => p !== '' && p !== '.' && p !== '..');
  if (parts.length === 0) return null;
  const last = parts[parts.length - 1];
  const base = path.basename(last, path.extname(last));
  if (!base || INDEX_FILE_STEMS.has(base)) return null;
  parts[parts.length - 1] = base;
  return parts.join('/').toLowerCase();
}

// A breakout link is filesystem-checkable only when it is repo-relative;
// absolute http(s) targets are skipped.
function isRepoRelativeTarget(target) {
  return Boolean(target) && !target.startsWith('http');
}

function buildRegistry(indexEntries) {
  // indexEntries: [{ index, entry }]
  const byTitle = new Map();
  const titleDupes = new Set();
  const bySlug = new Map();
  const slugDupes = new Set();
  const byPath = new Map();
  for (const rec of indexEntries) {
    const titleKey = normalizeTitle(rec.entry.title);
    if (byTitle.has(titleKey)) titleDupes.add(titleKey);
    else byTitle.set(titleKey, rec);
    const pathKey = targetPathKey(rec.entry.selfTarget);
    if (pathKey) {
      byPath.set(pathKey, rec);
      const slug = targetSlug(rec.entry.selfTarget).toLowerCase();
      if (bySlug.has(slug)) slugDupes.add(slug);
      else bySlug.set(slug, rec);
    }
  }
  return { byTitle, titleDupes, bySlug, slugDupes, byPath };
}

// Look up an entry by link target (directory-qualified path first, then
// bare basename, then display text). Returns { rec, via } on a unique
// match, { ambiguous } when several active entries share the matched key,
// or {} on no match. Path-first ordering makes features/foo.md and
// bugs/foo.md resolve correctly instead of colliding on the basename.
function lookupEntry(registry, display, target) {
  const pathKey = targetPathKey(target);
  if (pathKey && registry.byPath.has(pathKey)) {
    return { rec: registry.byPath.get(pathKey), via: 'path' };
  }
  const slug = targetSlug(target);
  const slugKey = slug && !INDEX_FILE_STEMS.has(slug) ? slug.toLowerCase() : null;
  if (slugKey) {
    if (registry.slugDupes.has(slugKey)) {
      return { ambiguous: `several active entries share the file slug "${slugKey}"` };
    }
    if (registry.bySlug.has(slugKey)) {
      return { rec: registry.bySlug.get(slugKey), via: 'slug' };
    }
  }
  if (display) {
    const titleKey = normalizeTitle(display);
    if (registry.titleDupes.has(titleKey)) {
      return { ambiguous: `several active entries share the title "${display}"` };
    }
    if (registry.byTitle.has(titleKey)) {
      return { rec: registry.byTitle.get(titleKey), via: 'title' };
    }
  }
  return {};
}

// Resolve one Requires link item against the registry. Returns one of:
//   { kind: 'blocked', label }         in-backlog reference, currently blocking
//   { kind: 'structural', problem }    stale/broken/typo/ambiguous reference
function resolveLink(item, registry) {
  const display = item.display;

  const whole = lookupEntry(registry, display, item.target);
  if (whole.ambiguous) {
    return {
      kind: 'structural',
      problem: `ambiguous reference "[${display}](${item.target})": ${whole.ambiguous}; qualify the link target with its directory`,
    };
  }

  let parent = null;
  let sliceName = null;

  const colonIdx = display.indexOf(': ');
  if (colonIdx > 0) {
    const prefix = display.slice(0, colonIdx);
    const suffix = display.slice(colonIdx + 2);
    const pre = lookupEntry(registry, prefix, item.target);
    if (pre.ambiguous) {
      return {
        kind: 'structural',
        problem: `ambiguous reference "[${display}](${item.target})": ${pre.ambiguous}; qualify the link target with its directory`,
      };
    }
    const wholeIsExactTitle = whole.rec && normalizeTitle(display) === normalizeTitle(whole.rec.entry.title);
    if (pre.rec && pre.rec.entry.slices && pre.rec.entry.slices.length > 0) {
      parent = pre.rec;
      sliceName = suffix;
    } else if (pre.rec && !wholeIsExactTitle) {
      // The display carries a slice suffix, the resolved parent has no
      // Slices block, and the full display doesn't name an entry title of
      // its own: typo territory, not a whole-entry reference. Title
      // equality is checked directly rather than via the resolution route,
      // because path-first lookup means a colon-containing title referenced
      // through its file target never resolves via 'title'.
      return {
        kind: 'structural',
        problem: `slice-suffixed reference "${display}" points at "${pre.rec.entry.title}", which has no Slices block`,
      };
    }
  }
  if (!parent) {
    parent = whole.rec || null;
  }
  if (!parent) {
    return {
      kind: 'structural',
      problem: `reference "[${display}](${item.target})" does not resolve to any active backlog entry (broken link, or stale reference left behind after the dependency shipped)`,
    };
  }

  const slices = parent.entry.slices;
  if (sliceName !== null) {
    const matches = findSlicesByNormalizedName(slices, sliceName);
    if (matches.length === 0) {
      return {
        kind: 'structural',
        problem: `slice suffix "${sliceName}" does not match any bullet in "${parent.entry.title}"'s Slices block (typo or wrong slug)`,
      };
    }
    if (matches.length > 1) {
      return {
        kind: 'structural',
        problem: `slice suffix "${sliceName}" matches multiple bullets in "${parent.entry.title}"'s Slices block; use an unambiguous declaration`,
      };
    }
    const [slice] = matches;
    if (slice.struck) {
      return {
        kind: 'structural',
        problem: `stale reference: slice "${parent.entry.title}: ${slice.displayName}" has shipped (struck through) but the reference was not removed`,
      };
    }
    return { kind: 'blocked', label: `${parent.entry.title}: ${slice.displayName}`, node: nodeKey(parent) };
  }

  if (slices && slices.length > 0) {
    // Bare link to a sliced feature: defaults to the MVP unblock point.
    const mvp = slices[0];
    if (mvp.struck) {
      return {
        kind: 'structural',
        problem: `stale reference: "${parent.entry.title}" MVP has shipped (struck through) but the bare reference was not removed`,
      };
    }
    return { kind: 'blocked', label: `${parent.entry.title}: ${mvp.displayName} (MVP)`, node: nodeKey(parent) };
  }

  return { kind: 'blocked', label: parent.entry.title, node: nodeKey(parent) };
}

// ---------- unit classification ----------

function firstExcerpt(bodyLines) {
  for (const line of bodyLines) {
    const t = line.trim();
    if (t === '' || /^\*\*[^*]+?:\*\*/.test(t) || HEADING.test(line)) continue;
    return t.length > 200 ? t.slice(0, 197) + '...' : t;
  }
  return '';
}


function bareTextProblem(text) {
  return `bare text "${text}" in **Requires:**; move it to **External:** (write none. if no link remains)`;
}

function linkInExternalProblem(display) {
  return `link "${display}" in **External:**; move it to **Requires:**`;
}

function classifyUnit(unit, registry, out) {
  const { index, title, excerpt, requiresContent, externalContent, missingRequires, extraBlockers } = unit;

  if (unit.excluded) return;

  if (missingRequires) {
    out.structuralErrors.push({
      index, title,
      problem: 'missing **Requires:** line (silence is not the same as `none.`; the dependency review has not been done)',
    });
    return;
  }

  const blockers = [...(extraBlockers || [])];
  const externals = [];
  const structural = [];

  if (requiresContent !== null && requiresContent !== undefined) {
    if (requiresContent === '') {
      structural.push(EMPTY_REQUIRES_PROBLEM);
    }
    for (const raw of splitTopLevelCommas(requiresContent)) {
      const item = parseDependencyItem(raw);
      if (item.kind === 'none') continue;
      if (item.kind === 'text') {
        structural.push(bareTextProblem(item.text));
        continue;
      }
      const res = resolveLink(item, registry);
      if (res.kind === 'blocked') blockers.push(res.label);
      else structural.push(res.problem);
    }
  }

  if (externalContent !== null && externalContent !== undefined) {
    if (externalContent === '') {
      structural.push(EMPTY_EXTERNAL_PROBLEM);
    }
    for (const raw of splitTopLevelCommas(externalContent)) {
      const item = parseDependencyItem(raw);
      if (item.kind === 'none') {
        structural.push(NONE_IN_EXTERNAL_PROBLEM);
        continue;
      }
      if (item.kind === 'link') {
        structural.push(linkInExternalProblem(item.display));
        continue;
      }
      externals.push(item.text);
    }
  }

  if (structural.length > 0) {
    out.structuralErrors.push({ index, title, problem: structural.join('; ') });
    return;
  }
  if (blockers.length > 0) {
    // A link blocker plus an External line: classify Blocked, externals
    // mentioned parenthetically. Never double-report under both categories.
    out.blocked.push({ index, title, blockers, externals });
    return;
  }
  if (externals.length > 0) {
    out.external.push({ index, title, primitives: externals });
    return;
  }
  out.ready.push({ index, title, excerpt });
}

// ---------- top level ----------

function createAnalysisOutput() {
  return {
    indexes: { found: [], missing: [] },
    ready: [],
    blocked: [],
    external: [],
    exploring: [],
    structuralErrors: [],
    notices: [],
  };
}

function parseIndexes(files, out) {
  const parsed = {};
  for (const name of WORK_INDEX_NAMES) {
    if (files[name] === undefined || files[name] === null) {
      out.indexes.missing.push(`${name}.md`);
      continue;
    }
    out.indexes.found.push(`${name}.md`);
    parsed[name] = extractEntries(files[name], EXCLUDED_SECTIONS[name], {
      bullets: name === 'QUICK_WINS',
      noticeProse: name === 'QUICK_WINS',
      collectSections: name === 'FEATURES' ? [EXPLORING_SECTION] : [],
    });
  }
  if (files.PATTERNS !== undefined && files.PATTERNS !== null) {
    out.indexes.found.push('PATTERNS.md (registry only, not parsed for work items)');
  } else {
    out.indexes.missing.push('PATTERNS.md');
  }

  return parsed;
}

function attachEntryMetadata(name, entry) {
  if (name === 'QUICK_WINS') {
    entry.requiresContent = null;
    entry.externalContent = null;
    entry.slices = null;

    return;
  }

  const records = scanBodyLines(entry.bodyLines);
  const requires = findLabelInRecords(records, REQUIRES_LABEL);
  const external = findLabelInRecords(records, EXTERNAL_LABEL);
  entry.requiresContent = requires ? requires.content : null;
  entry.externalContent = external ? external.content : null;
  entry.slices = name === 'FEATURES' ? parseSlicesInRecords(records) : null;
}

function prepareRegistryRecords(parsed, out) {
  const registryRecords = [];
  for (const name of WORK_INDEX_NAMES) {
    if (!parsed[name]) continue;
    for (const entry of parsed[name].entries) {
      attachEntryMetadata(name, entry);
      registryRecords.push({ index: `${name}.md`, entry });
    }
    for (const section of parsed[name].proseOnlySections) {
      out.notices.push(
        `${name}.md section "## ${section}" has content but no ### entries; only ### entries are parsed as work items; check that section manually`,
      );
    }
  }

  return registryRecords;
}

function buildCycleAnalysis(registryRecords, registry) {
  const featureAndBugRecords = registryRecords.filter((record) => record.index !== 'QUICK_WINS.md');
  const depEdges = collectEntryEdges(featureAndBugRecords, registry);
  const cycles = findCycles(depEdges);
  const cycleMembers = new Set();
  for (const cycle of cycles) {
    for (const member of cycle.members) {
      cycleMembers.add(member);
    }
  }
  const nodeToRec = new Map();
  for (const record of registryRecords) {
    nodeToRec.set(nodeKey(record), record);
  }

  return { depEdges, cycles, cycleMembers, nodeToRec };
}

function addQuickWins(parsed, out) {
  if (parsed.QUICK_WINS) {
    for (const entry of parsed.QUICK_WINS.entries) {
      out.ready.push({
        index: 'QUICK_WINS.md',
        title: entry.title,
        excerpt: firstExcerpt(entry.bodyLines),
      });
    }
  }
}

function addBreakoutTarget(breakoutTargets, index, entry, draft = false) {
  if (!isRepoRelativeTarget(entry.selfTarget)) {
    return;
  }

  const target = { index, title: entry.title, target: entry.selfTarget };
  if (draft) {
    target.draft = true;
  }
  breakoutTargets.push(target);
}

function addExploringDrafts(parsed, out, breakoutTargets) {
  if (parsed.FEATURES) {
    for (const entry of parsed.FEATURES.collectedEntries) {
      out.exploring.push({
        index: 'FEATURES.md',
        title: entry.title,
        // An empty link target ("[Title]()") is no target at all; the
        // renderers' contract has a null branch, not an empty-string one.
        link: entry.selfTarget || null,
        excerpt: firstExcerpt(entry.bodyLines),
      });
      addBreakoutTarget(breakoutTargets, 'FEATURES.md', entry, true);
    }
  }
}

function classifySlicedEntry(index, entry, excluded, registry, out) {
  const unshipped = entry.slices.filter((slice) => !slice.struck);
  if (unshipped.length === 0) {
    out.structuralErrors.push({
      index,
      title: entry.title,
      problem: 'all slices shipped; graduate parent to FEATURES_HISTORY.md per the ## Slicing last-slice rule',
    });

    return;
  }
  if (entry.requiresContent === null) {
    out.structuralErrors.push({
      index,
      title: entry.title,
      problem: 'missing top-level **Requires:** line (should reflect the next-to-ship slice)',
    });

    return;
  }

  const mvp = entry.slices[0];
  const firstUnshipped = unshipped[0];
  for (const slice of unshipped) {
    const extraBlockers = [];
    if (!mvp.struck && slice !== mvp) {
      extraBlockers.push(`${entry.title}: ${mvp.displayName} (implicit MVP gate)`);
    }
    classifyUnit({
      index,
      title: `[${entry.title}: ${slice.displayName}]`,
      excerpt: slice.raw.length > 200 ? slice.raw.slice(0, 197) + '...' : slice.raw,
      requiresContent: slice === firstUnshipped ? entry.requiresContent : slice.inlineRequires,
      externalContent: slice === firstUnshipped ? entry.externalContent : slice.inlineExternal,
      missingRequires: false,
      extraBlockers,
      excluded,
    }, registry, out);
  }
}

function classifyTrackedEntry(index, entry, excluded, registry, out) {
  if (entry.slices && entry.slices.length > 0) {
    classifySlicedEntry(index, entry, excluded, registry, out);

    return;
  }

  classifyUnit({
    index,
    title: entry.title,
    excerpt: firstExcerpt(entry.bodyLines),
    requiresContent: entry.requiresContent,
    externalContent: entry.externalContent,
    missingRequires: entry.requiresContent === null,
    excluded,
  }, registry, out);
}

function classifyTrackedEntries(parsed, registry, cycleMembers, out, breakoutTargets) {
  for (const name of ['FEATURES', 'BUGS']) {
    if (!parsed[name]) continue;
    for (const entry of parsed[name].entries) {
      const index = `${name}.md`;
      const entryNode = nodeKey({ index, entry });
      const excluded = cycleMembers.has(entryNode);
      // Every linked breakout is a scan candidate, including one whose entry
      // terminated in a structural error: the breakout can still drift.
      classifyTrackedEntry(index, entry, excluded, registry, out);
      addBreakoutTarget(breakoutTargets, index, entry);
    }
  }
}

function addCycleErrors(out, cycleAnalysis) {
  for (const cycle of cycleAnalysis.cycles) {
    out.structuralErrors.push({
      index: '[cycle]',
      title: `${cycle.members.length}-node cycle`,
      problem: formatCycle(cycle, cycleAnalysis.depEdges, cycleAnalysis.nodeToRec),
    });
  }
}

function analyze(files) {
  // files: { QUICK_WINS?, FEATURES?, BUGS? } raw markdown strings.
  const out = createAnalysisOutput();
  const parsed = parseIndexes(files, out);
  const registryRecords = prepareRegistryRecords(parsed, out);
  const registry = buildRegistry(registryRecords);
  const cycleAnalysis = buildCycleAnalysis(registryRecords, registry);
  const breakoutTargets = [];

  addQuickWins(parsed, out);
  addExploringDrafts(parsed, out, breakoutTargets);
  classifyTrackedEntries(parsed, registry, cycleAnalysis.cycleMembers, out, breakoutTargets);
  addCycleErrors(out, cycleAnalysis);

  out.breakoutTargets = breakoutTargets;
  return out;
}

// Lines in a breakout file that carry a dependency label: outside any
// fence, at any indentation, trimmed content starting with the label. The
// index entry is the sole dependency authority, so a breakout copy is drift.
// Inline backticked mentions in prose start with a backtick and never match.
function scanBreakoutLines(contents) {
  const records = scanMarkdown(Buffer.from(contents, 'utf8')).lines;
  const hits = [];
  records.forEach((record, i) => {
    if (record.opensFence || !record.outsideFence) return;
    const t = record.content.trim();
    for (const [label, labelRe] of BREAKOUT_LINE_LABELS) {
      if (labelRe.test(t)) hits.push({ label, line: i + 1 });
    }
  });
  return hits;
}

// Filesystem checks for breakout-file links (relative to the index dir):
// a missing file is a notice, an unreadable target is a notice, and a
// dependency line inside the file is a hygiene structural error that
// leaves the entry's classification standing. The read is attempted
// directly and its error code classified, so there is no check-then-read
// window between an existence probe and the read.
function scanBreakoutTargets(breakoutTargets, claudeDir) {
  const notices = [];
  const structuralErrors = [];
  for (const rec of breakoutTargets) {
    const target = rec.target.split('#')[0];
    const resolved = path.resolve(claudeDir, target);
    let contents;
    try {
      contents = fs.readFileSync(resolved, 'utf8');
    } catch (error) {
      notices.push(breakoutReadNotice(rec, error?.code ?? 'unknown'));
      continue;
    }
    for (const hit of scanBreakoutLines(contents)) {
      structuralErrors.push({
        index: rec.index,
        title: rec.title,
        problem: `breakout file ${rec.target} carries a **${hit.label}:** line (line ${hit.line}); delete the breakout line, the index entry is the sole dependency authority (hygiene error: the entry's classification stands)`,
      });
    }
  }

  return { notices, structuralErrors };
}

// ENOENT is a broken link; a directory or an anchor-only link (EISDIR) is a
// link defect; any other code (EBUSY, EACCES) is a transient read failure,
// and the notice names the code so the two read apart.
function breakoutReadNotice(rec, code) {
  const link = `${rec.index} entry "${rec.title}" links to ${rec.target}`;
  if (code === 'ENOENT') {
    const tail = rec.draft
      ? '(exploring draft; Requires lines do not apply)'
      : '(its Requires line still resolves normally)';

    return `${link}, which does not exist; remove the broken link or create the file ${tail}`;
  }
  const remedy = code === 'EISDIR' ? 'fix the link' : 'retry; the file was not scanned this run';

  return `${link}, which exists but cannot be read as a file (${code}); ${remedy}`;
}

function runCli(argRoot) {
  const root = path.resolve(argRoot || process.cwd());
  const claudeDir = path.basename(root) === '.claude' ? root : path.join(root, '.claude');
  if (!fs.existsSync(claudeDir)) {
    process.stdout.write(JSON.stringify({
      error: `no .claude directory found at ${claudeDir}; run /nightshift:init-backlog to scaffold the four-index layout`,
    }, null, 2) + '\n');
    process.exitCode = 1;
    return;
  }
  const files = {};
  for (const name of [...WORK_INDEX_NAMES, 'PATTERNS']) {
    const p = path.join(claudeDir, `${name}.md`);
    files[name] = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : undefined;
  }
  const result = analyze(files);

  const scanned = scanBreakoutTargets(result.breakoutTargets, claudeDir);
  result.notices.push(...scanned.notices);
  result.structuralErrors.push(...scanned.structuralErrors);
  delete result.breakoutTargets;

  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

// Stable identity for a backlog entry as a graph node. Path-qualified self
// link when present (e.g. "features/foo"), else the index plus normalized
// title; unique within an index.
function nodeKey(rec) {
  const pk = targetPathKey(rec.entry.selfTarget);
  return pk || `${rec.index}::${normalizeTitle(rec.entry.title)}`;
}

// Tarjan strongly-connected components over directed edges. Returns only
// components with >=2 distinct nodes (single-node self-loops are excluded by
// design). Iteration order is sorted so output is deterministic.
function findCycles(edges) {
  const adj = new Map();
  const nodes = new Set();
  for (const { from, to } of edges) {
    nodes.add(from);
    nodes.add(to);
    if (!adj.has(from)) adj.set(from, new Set());
    adj.get(from).add(to);
  }
  const sortedNodes = [...nodes].sort();
  for (const n of sortedNodes) {
    if (!adj.has(n)) adj.set(n, new Set());
  }
  let counter = 0;
  const index = new Map();
  const lowlink = new Map();
  const onStack = new Set();
  const stack = [];
  const components = [];
  const strongconnect = (v) => {
    index.set(v, counter);
    lowlink.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);
    for (const w of [...adj.get(v)].sort()) {
      if (!index.has(w)) {
        strongconnect(w);
        lowlink.set(v, Math.min(lowlink.get(v), lowlink.get(w)));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v), index.get(w)));
      }
    }
    if (lowlink.get(v) === index.get(v)) {
      const comp = [];
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      if (comp.length >= 2) components.push({ members: comp.sort() });
    }
  };
  for (const v of sortedNodes) strongconnect(v);
  return components.sort((a, b) => a.members[0].localeCompare(b.members[0]));
}

// Resolve each entry's top-level **Requires:** line to directed blocked
// edges for cycle detection. Only the entry's top-level line sources edges;
// continuation inline Requires do not participate. A structural problem on
// the top-level line (missing or empty line, bare text, or any link
// resolving structural) masks the entry's whole edge set. Intra-entry edges
// (a link resolving back to the same entry: a slice-suffixed same-feature
// reference or a whole self-reference) are dropped.
function collectEntryEdges(records, registry) {
  const edges = [];
  for (const rec of records) {
    if (rec.index === 'QUICK_WINS.md') continue;
    const content = rec.entry.requiresContent;
    if (content === null || content === undefined) continue;
    const from = nodeKey(rec);
    const pending = [];
    let structural = false;
    for (const raw of splitTopLevelCommas(content)) {
      const item = parseDependencyItem(raw);
      if (item.kind === 'none') continue;
      if (item.kind === 'text') {
        structural = true;
        continue;
      }
      const res = resolveLink(item, registry);
      if (res.kind === 'blocked') pending.push(res.node);
      else structural = true;
    }
    if (structural) continue;
    for (const to of pending) {
      if (to !== from) edges.push({ from, to });
    }
  }
  return edges;
}

function nodeLabel(rec) {
  return `${rec.index}/${rec.entry.title}`;
}

// Deterministic per-cycle problem text: members in sorted nodeKey order,
// then in-cycle edges sorted by from-then-to (duplicates collapsed, since a
// top-level line may repeat the same Requires link).
function formatCycle(cycle, edges, nodeToRec) {
  const members = [...cycle.members];
  const inCycle = new Set(members);
  const seen = new Set();
  const cycleEdges = edges
    .filter((e) => inCycle.has(e.from) && inCycle.has(e.to))
    .filter((e) => {
      const key = `${e.from}::${e.to}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (a.from + '::' + a.to).localeCompare(b.from + '::' + b.to));
  const memberLabels = members.map((n) => nodeLabel(nodeToRec.get(n)));
  const edgeLabels = cycleEdges.map((e) => `${nodeLabel(nodeToRec.get(e.from))} -> ${nodeLabel(nodeToRec.get(e.to))}`);
  return `members: ${memberLabels.join(', ')}${edgeLabels.length ? `; edges: ${edgeLabels.join(', ')}` : ''}`;
}

module.exports = {
  analyze,
  stripStable,
  normalizeSliceName,
  normalizeTitle,
  splitTopLevelCommas,
  parseDependencyItem,
  scanBreakoutTargets,
  parseSlices,
  findSlicesByNormalizedName,
  extractEntries,
  findRequires,
  scanBreakoutLines,
  buildRegistry,
  EXCLUDED_SECTIONS,
  collectEntryEdges,
  nodeKey,
  findCycles,
};

if (require.main === module) {
  runCli(process.argv[2]);
}
