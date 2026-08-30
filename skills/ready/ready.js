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
// History archives are never parsed for work: the walk-and-remove convention
// keeps active Requires lines authoritative. PATTERNS.md is a pattern
// registry, not a work backlog, so it is not parsed either. Every backlog
// file is still read once for the hard-wrap notice, since the line
// discipline covers the whole .claude/ backlog.
//
// Usage: node ready.js [repo-root-or-.claude-dir]   (defaults to cwd)

const fs = require('fs');
const path = require('path');
const { stableOpenFile } = require('../init-backlog/lib/filesystem.js');
const { scanMarkdown } = require('../spec-agreement/spec-agreement.js');
const { LABEL_AT_START, CatalogError, canonicalBacklogRootIdentity, canonicalPath, compareTargets, detectHardWraps, collectMarkdownFiles, isContainedPath, normalizeCatalogItems } = require('../init-backlog/unwrap.js');

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
// wrapped Requires or External line; inline **bold** mid-line does not. The
// pattern is imported from the unwrapper so both read the same block boundary.
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
const ANALYSIS_EVIDENCE = Symbol('analysisEvidence');

function readCanonicalText(rootIdentity, target) {
  try {
    return stableOpenFile(rootIdentity, target, { requireSingleLink: false }).bytes.toString('utf8');
  } catch (error) {
    try {
      if (fs.lstatSync(target).isDirectory()) error.code = 'EISDIR';
    } catch {
      // Preserve the deciding stable-open failure when the classification probe also fails.
    }
    throw error;
  }
}

function sidecarItem(kind, ordinal, evidencePaths) {
  return {
    kind,
    ordinal,
    evidencePaths: [...new Set(evidencePaths)].sort(compareTargets),
  };
}

function pushAnalysisItem(output, kind, item, evidencePaths) {
  const items = output[kind];
  items.push(item);
  output[ANALYSIS_EVIDENCE][kind].push(sidecarItem(kind, items.length - 1, evidencePaths));
}

function pushStructuralError(output, item, evidencePaths) {
  pushAnalysisItem(output, 'structuralErrors', item, evidencePaths);
}

function pushNotice(output, notice, evidencePaths) {
  pushAnalysisItem(output, 'notices', notice, evidencePaths);
}

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
  // The separator may be a spaced em-dash, en-dash, or plain hyphen. The token
  // quantifier is lazy so the FIRST separator ends the prefix: a slice name
  // that itself contains a spaced dash keeps everything after that first one,
  // instead of losing every phrase up to its last separator.
  cur = cur.replace(/^\S+(?: \S+)*? [\u2014\u2013-] /, '');
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
function parseInlineLink(raw, allowTrailingPeriod = false) {
  const opening = /^\[([^\]]*)\]\(/.exec(raw);
  if (opening === null) return null;
  const targetStart = opening[0].length;
  let depth = 1;
  for (let index = targetStart; index < raw.length; index++) {
    if (raw[index] === '(') {
      depth++;
      continue;
    }
    if (raw[index] !== ')') continue;
    depth--;
    if (depth !== 0) continue;
    const suffix = raw.slice(index + 1);
    if (suffix !== '' && !(allowTrailingPeriod && suffix === '.')) return null;

    return {
      display: opening[1].trim(),
      target: raw.slice(targetStart, index).trim(),
    };
  }

  return null;
}

function parseDependencyItem(raw) {
  const link = parseInlineLink(raw, true);
  if (link !== null) {
    return { kind: 'link', display: link.display, target: link.target };
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

function normalizeSectionKey(rawTitle) {
  return rawTitle.trim().toLowerCase().replace(/\.$/, '');
}

function openSection(rawTitle, excludedSections, collectSections) {
  const title = rawTitle.trim();
  const key = normalizeSectionKey(title);

  return createSectionState(title, excludedSections.has(key), collectSections.has(key));
}

function createHeadingEntry(rawHeading, sectionTitle) {
  const heading = rawHeading.trim();
  const link = parseInlineLink(heading);

  return {
    kind: 'h3',
    title: link ? link.display : heading,
    selfTarget: link ? link.target : null,
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
  return findLabelsInRecords(records, labelRe)[0] ?? null;
}

function findLabelsInRecords(records, labelRe) {
  const labels = [];
  for (let i = 0; i < records.length; i++) {
    const line = records[i].content;
    if (records[i].outsideFence && labelRe.test(line.trim()) && !/^\s+/.test(line)) {
      labels.push(assembleLabel(records, i, labelRe));
    }
  }

  return labels;
}

function findRequires(bodyLines) {
  return findLabel(bodyLines, REQUIRES_LABEL);
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
        dependencyProblems: [],
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
          if (slice.inlineRequires === null) slice.inlineRequires = content;
          else addDuplicateDependencyLabelProblem(slice.dependencyProblems, 'Requires');
        } else {
          if (slice.inlineExternal === null) slice.inlineExternal = content;
          else addDuplicateDependencyLabelProblem(slice.dependencyProblems, 'External');
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
  return Boolean(target) && !/^https?:\/\//i.test(target);
}

// True when a self-target names a real place inside the backlog: repo-relative
// and inside the closed catalog-reference grammar. Traversing, absolute, and
// backslashed targets fail it and stay broken-link notices.
function isCatalogReferenceTarget(target) {
  if (!isRepoRelativeTarget(target)) return false;
  try {
    requireCatalogReferenceTarget(target);
  } catch {
    // The grammar itself is the answer, and its refusal is not an error here.
    return false;
  }

  return true;
}

function buildRegistry(indexEntries) {
  // indexEntries: [{ index, entry }]
  const byTitle = new Map();
  const titleDupes = new Set();
  const bySlug = new Map();
  const slugDupes = new Set();
  const byPath = new Map();
  const slicesByRecord = new Map();
  // A self-target path is a node identity, so two entries claiming one are
  // indistinguishable to every consumer of the graph and byPath's single slot
  // silently binds links to whichever entry wrote it last. Every claimant is
  // retained here instead, so the collision reports structurally and resolution
  // refuses to pick either. A self-target outside the closed catalog-reference
  // grammar is already reported as a broken link, so it never joins the path
  // graph at all: admitting it would reintroduce that silent shadowing on a key
  // no duplicate report may claim. Dependency links to such targets remain
  // structural instead of falling through to a weaker identity route.
  const pathGroups = new Map();
  for (const rec of indexEntries) {
    const titleKey = normalizeTitle(rec.entry.title);
    if (byTitle.has(titleKey)) titleDupes.add(titleKey);
    else byTitle.set(titleKey, rec);
    const pathKey = targetPathKey(rec.entry.selfTarget);
    if (pathKey && isCatalogReferenceTarget(rec.entry.selfTarget)) {
      byPath.set(pathKey, rec);
      const group = pathGroups.get(pathKey);
      if (group === undefined) pathGroups.set(pathKey, [rec]);
      else group.push(rec);
      const slug = targetSlug(rec.entry.selfTarget).toLowerCase();
      if (bySlug.has(slug)) slugDupes.add(slug);
      else bySlug.set(slug, rec);
    }
    if (rec.entry.slices && rec.entry.slices.length > 0) {
      const byNormalizedName = new Map();
      for (const slice of rec.entry.slices) {
        const normalizedName = slice.name;
        const matches = byNormalizedName.get(normalizedName);
        if (matches === undefined) byNormalizedName.set(normalizedName, [slice]);
        else matches.push(slice);
      }
      slicesByRecord.set(rec, byNormalizedName);
    }
  }
  const pathDupes = new Map([...pathGroups].filter(([, records]) => records.length > 1));
  return { byTitle, titleDupes, bySlug, slugDupes, byPath, pathDupes, slicesByRecord };
}

function dependencyLookupRoute(target) {
  if (typeof target !== 'string' || target === '' || target.startsWith('/') || target.includes('\\') || /^[A-Za-z]:/.test(target) || /^https?:\/\//i.test(target)) {
    return { kind: 'invalid' };
  }
  const hashIndex = target.indexOf('#');
  const fileTarget = hashIndex < 0 ? target : target.slice(0, hashIndex);
  const anchor = hashIndex < 0 ? '' : target.slice(hashIndex + 1);
  const slug = targetSlug(fileTarget);
  if (!slug) return { kind: 'invalid' };
  if (INDEX_FILE_STEMS.has(slug)) {
    return anchor === '' ? { kind: 'invalid' } : { kind: 'title' };
  }
  if (fileTarget.includes('/')) {
    if (!isCatalogReferenceTarget(target)) return { kind: 'invalid' };

    return { kind: 'path', key: targetPathKey(fileTarget) };
  }

  return { kind: 'slug', key: slug.toLowerCase() };
}

// Look up an entry by the identity route selected by the target grammar.
// Directory-qualified paths use exact path identity, bare basenames use slug
// identity, and index anchors use display-title identity. A supplied strong
// form never falls through to a weaker match after it misses.
function lookupEntry(registry, display, target) {
  const route = dependencyLookupRoute(target);
  if (route.kind === 'path' && registry.pathDupes.has(route.key)) {
    // Qualifying the link cannot disambiguate a path both entries claim, so
    // this ambiguity carries its own remedy instead of the shared one.
    return { ambiguous: `several active entries declare the self-target path "${route.key}"`, remedy: 'give each entry its own breakout file' };
  }
  if (route.kind === 'path') {
    return registry.byPath.has(route.key) ? { rec: registry.byPath.get(route.key), via: 'path' } : {};
  }
  if (route.kind === 'slug') {
    if (registry.slugDupes.has(route.key)) {
      return { ambiguous: `several active entries share the file slug "${route.key}"` };
    }
    return registry.bySlug.has(route.key) ? { rec: registry.bySlug.get(route.key), via: 'slug' } : {};
  }
  if (route.kind === 'title' && display) {
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

const AMBIGUOUS_LINK_REMEDY = 'qualify the link target with its directory';

// Resolve one Requires link item against the registry. Returns one of:
//   { kind: 'blocked', label }         in-backlog reference, currently blocking
//   { kind: 'structural', problem }    stale/broken/typo/ambiguous reference
function resolveLink(item, registry) {
  const display = item.display;

  const whole = lookupEntry(registry, display, item.target);
  if (whole.ambiguous) {
    return {
      kind: 'structural',
      problem: `ambiguous reference "[${display}](${item.target})": ${whole.ambiguous}; ${whole.remedy ?? AMBIGUOUS_LINK_REMEDY}`,
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
        problem: `ambiguous reference "[${display}](${item.target})": ${pre.ambiguous}; ${pre.remedy ?? AMBIGUOUS_LINK_REMEDY}`,
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
    const matches = registry.slicesByRecord.get(parent)?.get(normalizeSliceName(sliceName)) ?? [];
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

function truncateExcerpt(text) {
  return text.length > 200 ? text.slice(0, 197) + '...' : text;
}

function firstExcerpt(bodyLines) {
  for (const line of bodyLines) {
    const t = line.trim();
    if (t === '' || LABEL_AT_START.test(t) || HEADING.test(line)) continue;
    return truncateExcerpt(t);
  }
  return '';
}


function bareTextProblem(text) {
  return `bare text "${text}" in **Requires:**; move it to **External:** (write none. if no link remains)`;
}

function linkInExternalProblem(display) {
  return `link "${display}" in **External:**; move it to **Requires:**`;
}

function duplicateDependencyLabelProblem(label) {
  return label === 'Requires'
    ? 'duplicate **Requires:** labels; keep exactly one line'
    : 'duplicate **External:** labels; keep at most one line';
}

function addDuplicateDependencyLabelProblem(problems, label) {
  const problem = duplicateDependencyLabelProblem(label);
  if (!problems.includes(problem)) problems.push(problem);
}

// Items of one dependency line, or none when the line is absent. An empty
// label is reported through the label's own problem text.
function dependencyLineItems(content, emptyProblem, structural) {
  if (content === null || content === undefined) return [];
  if (content === '') structural.push(emptyProblem);

  return splitTopLevelCommas(content).map(parseDependencyItem);
}

function requiresLineItems(content, structural) {
  const items = dependencyLineItems(content, EMPTY_REQUIRES_PROBLEM, structural);
  if (items.length > 1 && items.some((item) => item.kind === 'none')) {
    structural.push('none. must be the only item in **Requires:**');
  }

  return items;
}

function classifyUnit(unit, registry, out) {
  const { index, title, excerpt, requiresContent, externalContent, missingRequires, extraBlockers, dependencyProblems } = unit;

  if (missingRequires) {
    pushStructuralError(out, {
      index, title,
      problem: 'missing **Requires:** line (silence is not the same as `none.`; the dependency review has not been done)',
    }, [index]);
    return;
  }

  const blockers = [...(extraBlockers || [])];
  const externals = [];
  const structural = [...(dependencyProblems ?? [])];

  for (const item of requiresLineItems(requiresContent, structural)) {
    if (item.kind === 'none') continue;
    if (item.kind === 'text') {
      structural.push(bareTextProblem(item.text));
      continue;
    }
    const res = resolveLink(item, registry);
    if (res.kind === 'blocked') blockers.push(res.label);
    else structural.push(res.problem);
  }

  for (const item of dependencyLineItems(externalContent, EMPTY_EXTERNAL_PROBLEM, structural)) {
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

  if (structural.length > 0) {
    pushStructuralError(out, { index, title, problem: structural.join('; ') }, [index]);
    return;
  }
  // Whole-entry exclusion suppresses classification, not grammar
  // validation: a cycle member's grammar problems are filed above under its
  // own title, while its links and primitives belong to the cycle error.
  if (unit.excluded) return;
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
  const output = {
    indexes: { found: [], missing: [] },
    ready: [],
    blocked: [],
    external: [],
    exploring: [],
    structuralErrors: [],
    notices: [],
  };
  Object.defineProperty(output, ANALYSIS_EVIDENCE, {
    configurable: true,
    value: { structuralErrors: [], notices: [] },
  });

  return output;
}

// Backlog prose is one paragraph or bullet per physical line; a wrapped file is
// reported once with its count and first offending line so the reader can run
// the init-backlog unwrap pass rather than hunt for the lines by hand.
function hardWrapNotice(label, contents) {
  const wraps = detectHardWraps(contents);
  if (wraps.length === 0) return null;
  const noun = wraps.length === 1 ? 'line' : 'lines';
  return `${label} has ${wraps.length} hard-wrapped ${noun} (first at line ${wraps[0].line}); backlog prose is one paragraph or bullet per physical line; run /nightshift:init-backlog to unwrap`;
}

function parseIndexes(files, out) {
  const parsed = {};
  for (const name of WORK_INDEX_NAMES) {
    if (files[name] === undefined || files[name] === null) {
      out.indexes.missing.push(`${name}.md`);
      continue;
    }
    out.indexes.found.push(`${name}.md`);
    const notice = hardWrapNotice(`${name}.md`, files[name]);
    if (notice !== null) pushNotice(out, notice, [`${name}.md`]);
    parsed[name] = extractEntries(files[name], EXCLUDED_SECTIONS[name], {
      bullets: name === 'QUICK_WINS',
      noticeProse: name === 'QUICK_WINS',
      collectSections: name === 'FEATURES' ? [EXPLORING_SECTION] : [],
    });
  }
  if (files.PATTERNS !== undefined && files.PATTERNS !== null) {
    out.indexes.found.push('PATTERNS.md (registry only, not parsed for work items)');
    const notice = hardWrapNotice('PATTERNS.md', files.PATTERNS);
    if (notice !== null) pushNotice(out, notice, ['PATTERNS.md']);
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
    entry.requiresProblems = [];
    entry.dependencyProblems = [];

    return;
  }

  const records = scanBodyLines(entry.bodyLines);
  const requires = findLabelsInRecords(records, REQUIRES_LABEL);
  const external = findLabelsInRecords(records, EXTERNAL_LABEL);
  entry.requiresContent = requires[0]?.content ?? null;
  entry.externalContent = external[0]?.content ?? null;
  entry.requiresProblems = requires.length > 1 ? [duplicateDependencyLabelProblem('Requires')] : [];
  entry.dependencyProblems = [
    ...entry.requiresProblems,
    ...(external.length > 1 ? [duplicateDependencyLabelProblem('External')] : []),
  ];
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
      pushNotice(out,
        `${name}.md section "## ${section}" has content but no ### entries; only ### entries are parsed as work items; check that section manually`,
        [`${name}.md`]);
    }
  }

  return registryRecords;
}

function buildCycleAnalysis(registryRecords, registry) {
  const featureAndBugRecords = registryRecords.filter((record) => record.index !== 'QUICK_WINS.md');
  const depEdges = collectEntryEdges(featureAndBugRecords, registry);
  const cycles = findCycles(depEdges);
  const cycleEdges = groupCycleEdges(cycles, depEdges);
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

  return { cycles, cycleEdges, cycleMembers, nodeToRec };
}

function addQuickWins(parsed, duplicateEntries, out) {
  if (parsed.QUICK_WINS) {
    for (const entry of parsed.QUICK_WINS.entries) {
      if (duplicateEntries.has(entry)) continue;
      out.ready.push({
        index: 'QUICK_WINS.md',
        title: entry.title,
        excerpt: firstExcerpt(entry.bodyLines),
      });
    }
  }
}

// `draft` marks an exploring draft; `outcome` is a tracked entry's own
// classification outcome (`structural` or `cycle`), omitted when the entry
// resolved. Both ride on the record by presence only.
function addBreakoutTarget(breakoutTargets, index, entry, { draft = false, outcome = null } = {}) {
  if (!isRepoRelativeTarget(entry.selfTarget)) {
    return;
  }

  const target = { index, title: entry.title, target: entry.selfTarget };
  if (draft) {
    target.draft = true;
  }
  if (outcome !== null) {
    target.outcome = outcome;
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
      addBreakoutTarget(breakoutTargets, 'FEATURES.md', entry, { draft: true });
    }
  }
}

function classifySlicedEntry(index, entry, excluded, registry, out) {
  const unshipped = entry.slices.filter((slice) => !slice.struck);
  if (unshipped.length === 0) {
    pushStructuralError(out, {
      index,
      title: entry.title,
      problem: 'all slices shipped; graduate parent to FEATURES_HISTORY.md per the ## Slicing last-slice rule',
    }, [index]);

    return;
  }
  if (entry.requiresContent === null) {
    pushStructuralError(out, {
      index,
      title: entry.title,
      problem: 'missing top-level **Requires:** line (should reflect the next-to-ship slice)',
    }, [index]);

    return;
  }
  if (entry.dependencyProblems.length > 0) {
    pushStructuralError(out, { index, title: entry.title, problem: entry.dependencyProblems.join('; ') }, [index]);

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
      excerpt: truncateExcerpt(slice.raw),
      requiresContent: slice === firstUnshipped ? entry.requiresContent : slice.inlineRequires,
      externalContent: slice === firstUnshipped ? entry.externalContent : slice.inlineExternal,
      missingRequires: false,
      extraBlockers,
      dependencyProblems: slice.dependencyProblems,
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
    dependencyProblems: entry.dependencyProblems,
    excluded,
  }, registry, out);
}

function classifyTrackedEntries(parsed, registry, cycleMembers, duplicateEntries, out, breakoutTargets) {
  for (const name of ['FEATURES', 'BUGS']) {
    if (!parsed[name]) continue;
    for (const entry of parsed[name].entries) {
      const index = `${name}.md`;
      const entryNode = nodeKey({ index, entry });
      const duplicate = duplicateEntries.has(entry);
      const excluded = cycleMembers.has(entryNode) || duplicate;
      // Every linked breakout is a scan candidate, including one whose entry
      // terminated in a structural error: the breakout can still drift. The
      // outcome is measured across this entry's own classify call, never by
      // scanning the finished errors by title (two indexes can share one).
      const errorsBefore = out.structuralErrors.length;
      classifyTrackedEntry(index, entry, excluded, registry, out);
      const outcome = out.structuralErrors.length > errorsBefore || duplicate ? 'structural' : excluded ? 'cycle' : null;
      addBreakoutTarget(breakoutTargets, index, entry, { outcome });
    }
  }
}

function addCycleErrors(out, cycleAnalysis) {
  for (let cycleIndex = 0; cycleIndex < cycleAnalysis.cycles.length; cycleIndex++) {
    const cycle = cycleAnalysis.cycles[cycleIndex];
    const evidencePaths = [];
    for (const member of cycle.members) {
      const record = cycleAnalysis.nodeToRec.get(member);
      if (record === undefined) continue;
      evidencePaths.push(record.index);
      // Evidence paths are catalog references, so a traversing, absolute, or
      // backslashed self-target cannot be one. The index alone stands as this
      // member's evidence; the hostile link keeps its own broken-link notice.
      if (isCatalogReferenceTarget(record.entry.selfTarget)) evidencePaths.push(record.entry.selfTarget.split('#')[0]);
    }
    pushStructuralError(out, {
      index: '[cycle]',
      title: `${cycle.members.length}-node cycle`,
      problem: formatCycle(cycle, cycleAnalysis.cycleEdges[cycleIndex], cycleAnalysis.nodeToRec),
    }, evidencePaths);
  }
}

// Two entries claiming one self-target path collide on the node identity the
// whole graph is keyed by, so the collision is reported once per path and names
// every claimant. Reporting it here, rather than only when something links to
// the path, means an unreferenced duplicate still surfaces.
function addDuplicatePathErrors(out, registry) {
  for (const [pathKey, records] of [...registry.pathDupes].sort(([left], [right]) => compareTargets(left, right))) {
    const claimants = records.map((record) => `${record.index} "${record.entry.title}"`).join(' and ');
    const evidencePaths = records.map((record) => record.index);
    // Only catalog-reference self-targets reach the path graph, so every
    // claimant here carries one and no traversing or absolute target can be
    // offered as an evidence path.
    for (const record of records) {
      evidencePaths.push(record.entry.selfTarget.split('#')[0]);
    }
    pushStructuralError(out, {
      index: '[duplicate]',
      title: pathKey,
      problem: `duplicate self-target "${pathKey}" declared by ${claimants}; give each entry its own breakout file`,
    }, evidencePaths);
  }
}

function analyze(files) {
  // files: { QUICK_WINS?, FEATURES?, BUGS? } raw markdown strings.
  const out = createAnalysisOutput();
  const parsed = parseIndexes(files, out);
  const registryRecords = prepareRegistryRecords(parsed, out);
  const registry = buildRegistry(registryRecords);
  const duplicateEntries = new Set([...registry.pathDupes.values()].flatMap((records) => records.map((record) => record.entry)));
  const cycleAnalysis = buildCycleAnalysis(registryRecords, registry);
  const breakoutTargets = [];

  addQuickWins(parsed, duplicateEntries, out);
  addExploringDrafts(parsed, out, breakoutTargets);
  classifyTrackedEntries(parsed, registry, cycleAnalysis.cycleMembers, duplicateEntries, out, breakoutTargets);
  addCycleErrors(out, cycleAnalysis);
  addDuplicatePathErrors(out, registry);

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
// leaves the entry's classification standing. Every target passes the same
// closed catalog-reference validation as catalog mode before it is resolved,
// so an absolute, traversing, or backslashed link never reads outside the
// backlog and surfaces as the broken-link notice instead. The read is
// attempted directly and its error code classified, so there is no
// check-then-read window between an existence probe and the read.
// Shared loop for the two breakout-target scanners. The content source is
// parameterized: filesystem mode reads through a per-resolved-path cache and
// keys identities canonically, catalog mode looks the target up directly and
// the target is its own identity; catalog mode additionally records lockstep
// evidence segments for the analysis sidecar. Each distinct identity's
// dependency-line scan is parsed once; every referencing entry still gets
// its own notice and structural error from the cached results.
function scanBreakoutTargetsWith(breakoutTargets, load, collectEvidence) {
  const notices = [];
  const structuralErrors = [];
  const lineHitsCache = new Map();
  const evidence = collectEvidence ? { notices: [], structuralErrors: [] } : null;
  const pushReadNotice = (rec, code) => {
    notices.push(breakoutReadNotice(rec, code));
    if (evidence !== null) evidence.notices.push([rec.index]);
  };
  for (const rec of breakoutTargets) {
    let target;
    try {
      target = requireCatalogReferenceTarget(rec.target);
    } catch (error) {
      if (!(error instanceof CatalogError)) throw error;
      pushReadNotice(rec, 'ENOENT');
      continue;
    }
    const read = load(target);
    if (read.contents === undefined) {
      pushReadNotice(rec, read.errorCode);
      continue;
    }
    const { contents, identity } = read;
    if (!lineHitsCache.has(identity)) {
      const notice = hardWrapNotice(`breakout file ${target}`, contents);
      if (notice !== null) {
        notices.push(notice);
        if (evidence !== null) evidence.notices.push([target]);
      }
      lineHitsCache.set(identity, scanBreakoutLines(contents));
    }
    const lineHits = lineHitsCache.get(identity);
    for (const hit of lineHits) {
      structuralErrors.push({
        index: rec.index,
        title: rec.title,
        problem: `breakout file ${rec.target} carries a **${hit.label}:** line (line ${hit.line}); delete the breakout line, the index entry is the sole dependency authority (hygiene error: the entry's classification stands)`,
      });
      if (evidence !== null) evidence.structuralErrors.push([rec.index, target]);
    }
  }

  return { notices, structuralErrors, scanned: new Set(lineHitsCache.keys()), evidence };
}

function createBreakoutLoader(claudeDir, rootIdentity, options = {}) {
  const canonicalize = options.canonicalize ?? canonicalPath;
  const contains = options.contains ?? isContainedPath;
  const readFile = options.readFile ?? ((target) => readCanonicalText(rootIdentity, target));
  const resolvePath = options.resolvePath ?? path.resolve;
  const identitiesByResolved = new Map();
  const readsByIdentity = new Map();
  const failuresWithoutIdentity = new Map();

  return (target) => {
    const resolved = resolvePath(claudeDir, target);
    const priorFailure = failuresWithoutIdentity.get(resolved);
    if (priorFailure !== undefined) return priorFailure;
    let identity;
    if (identitiesByResolved.has(resolved)) {
      identity = identitiesByResolved.get(resolved);
    } else {
      try {
        identity = canonicalize(resolved);
        identitiesByResolved.set(resolved, identity);
      } catch (error) {
        const failure = { errorCode: error?.code ?? 'unknown' };
        failuresWithoutIdentity.set(resolved, failure);

        return failure;
      }
    }
    let read = readsByIdentity.get(identity);
    if (read === undefined) {
      if (!contains(rootIdentity, identity)) {
        read = { errorCode: 'ENOENT' };
      } else {
        try {
          read = { contents: readFile(identity), identity };
        } catch (error) {
          read = { errorCode: error?.code ?? 'unknown' };
        }
      }
      readsByIdentity.set(identity, read);
    }

    return read;
  };
}

function scanBreakoutTargets(breakoutTargets, claudeDir, options = {}) {
  const rootIdentity = options.rootIdentity ?? canonicalBacklogRootIdentity(claudeDir);
  if (rootIdentity === null) {
    throw new CatalogError(`backlog root escapes its repository authority: ${claudeDir}`);
  }
  const { notices, structuralErrors, scanned } = scanBreakoutTargetsWith(breakoutTargets, createBreakoutLoader(claudeDir, rootIdentity), false);

  return { notices, structuralErrors, scannedFiles: scanned };
}

// The line discipline covers every backlog file, so the files no index entry
// reaches (history archives, patterns, unlinked breakouts) get their own
// hard-wrap notice; the indexes and linked breakouts were already reported.
// Shared loop for the two unlinked-file scanners: skip the indexes and the
// already-scanned linked breakouts, report an unreadable entry (a filesystem
// possibility only), and report hard wraps; catalog mode additionally records
// lockstep evidence for the analysis sidecar.
function scanUnlinkedWith(entries, alreadyScanned, indexKeys, collectEvidence) {
  const notices = [];
  const evidence = collectEvidence ? [] : null;
  for (const entry of entries) {
    if (indexKeys.has(entry.identity) || alreadyScanned.has(entry.identity)) continue;
    const read = entry.load();
    if (read.contents === undefined) {
      notices.push(`backlog file ${entry.label} cannot be read (${read.errorCode}); retry; the file was not checked for hard wraps this run`);
      continue;
    }
    const notice = hardWrapNotice(`backlog file ${entry.label}`, read.contents);
    if (notice !== null) {
      notices.push(notice);
      if (evidence !== null) evidence.push([entry.identity]);
    }
  }
  if (evidence !== null) Object.defineProperty(notices, ANALYSIS_EVIDENCE, { value: evidence });

  return notices;
}

function scanUnlinkedBacklogFiles(claudeDir, alreadyScanned, options = {}) {
  const canonicalize = options.canonicalize ?? canonicalPath;
  const collectFiles = options.collectFiles ?? collectMarkdownFiles;
  const rootIdentity = options.rootIdentity ?? canonicalBacklogRootIdentity(claudeDir);
  if (rootIdentity === null) throw new CatalogError(`backlog root escapes its repository authority: ${claudeDir}`);
  const readFile = options.readFile ?? ((target) => readCanonicalText(rootIdentity, target));
  const indexFiles = new Set([...WORK_INDEX_NAMES, 'PATTERNS'].map((name) => canonicalize(path.resolve(claudeDir, `${name}.md`))));
  const entries = collectFiles([claudeDir]).map((file) => {
    const identity = canonicalize(file);

    return {
      identity,
      label: path.relative(claudeDir, file).replace(/\\/g, '/'),
      load: () => {
        try {
          return { contents: readFile(identity) };
        } catch (error) {
          return { errorCode: error?.code ?? 'unknown' };
        }
      },
    };
  });

  return scanUnlinkedWith(entries, alreadyScanned, indexFiles, false);
}

const MISSING_BREAKOUT_TAILS = {
  resolved: '(its Requires line still resolves normally)',
  structural: '(its own classification already reports a structural error)',
  cycle: '(it is a dependency-cycle member; see the cycle error)',
};

// ENOENT is a broken link; a directory or an anchor-only link (EISDIR) is a
// link defect; any other code (EBUSY, EACCES) is a transient read failure,
// and the notice names the code so the two read apart.
function breakoutReadNotice(rec, code) {
  const link = `${rec.index} entry "${rec.title}" links to ${rec.target}`;
  if (code === 'ENOENT') {
    const tail = rec.draft
      ? '(exploring draft; Requires lines do not apply)'
      : MISSING_BREAKOUT_TAILS[rec.outcome ?? 'resolved'];

    return `${link}, which does not exist; remove the broken link or create the file ${tail}`;
  }
  const remedy = code === 'EISDIR' ? 'fix the link' : 'retry; the file was not scanned this run';

  return `${link}, which exists but cannot be read as a file (${code}); ${remedy}`;
}

function scanCatalogBreakoutTargets(breakoutTargets, catalog) {
  const { notices, structuralErrors, scanned, evidence } = scanBreakoutTargetsWith(breakoutTargets, (target) => {
    const contents = catalog.get(target);

    return contents === undefined ? { errorCode: 'ENOENT' } : { contents, identity: target };
  }, true);
  const result = { notices, structuralErrors, scannedTargets: scanned };
  Object.defineProperty(result, ANALYSIS_EVIDENCE, { value: evidence });

  return result;
}

function scanUnlinkedCatalogItems(catalog, alreadyScanned) {
  const indexTargets = new Set([...WORK_INDEX_NAMES, 'PATTERNS'].map((name) => `${name}.md`));
  const entries = [...catalog.values()].map(({ target, contents }) => ({ identity: target, label: target, load: () => ({ contents }) }));

  return scanUnlinkedWith(entries, alreadyScanned, indexTargets, true);
}

function htmlBlockStart(line) {
  const trimmed = line.replace(/^ {0,3}/, '');
  if (trimmed.startsWith('<!--')) return { terminator: '-->' };
  if (trimmed.startsWith('<?')) return { terminator: '?>' };
  if (trimmed.startsWith('<![CDATA[')) return { terminator: ']]>' };
  if (/^<![A-Z]/.test(trimmed)) return { terminator: '>' };
  const rawTag = trimmed.match(/^<(script|pre|style|textarea)(?:\s|>|$)/i);
  if (rawTag) return { terminator: '</', tag: rawTag[1] };
  if (/^<(?:address|article|aside|base|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|ol|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|>|$)/i.test(trimmed)) return { blank: true };
  if (/^<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>/.test(trimmed)) return { blank: true };

  return null;
}

function commonMarkHeadings(contents) {
  const parsed = scanMarkdown(Buffer.from(contents, 'utf8'));
  const masked = new Set();
  let html = null;
  parsed.lines.forEach((record, index) => {
    if (record.opensFence || !record.outsideFence) {
      masked.add(index);
      return;
    }
    if (html !== null) {
      if (html.blank && record.content.trim() === '') {
        html = null;
        return;
      }
      masked.add(index);
      if (html.terminator === '</' ? new RegExp(`</${html.tag}\\s*>`, 'i').test(record.content) : record.content.includes(html.terminator)) html = null;
      return;
    }
    const block = htmlBlockStart(record.content);
    if (block === null) return;
    masked.add(index);
    if (block.terminator === '</' && !new RegExp(`</${block.tag}\\s*>`, 'i').test(record.content)) html = block;
    else if (block.terminator && !record.content.includes(block.terminator)) html = block;
    else if (block.blank && record.content.trim() !== '') html = block;
  });

  return parsed.lines.flatMap((record, index) => {
    if (masked.has(index)) return [];
    const match = /^ {0,3}(#{1,6})(?:[ \t]+|$)(.*)$/.exec(record.content);
    if (match === null) return [];
    let title = match[2].trim();
    title = title.replace(/[ \t]+#+[ \t]*$/, '').trim();

    return [{ level: match[1].length, title, rawStart: record.rawStart, rawEnd: record.rawEnd }];
  });
}

function hasPopulatedLegacySection(contents, headings, expectedTitle) {
  const bytes = Buffer.from(contents, 'utf8');
  const expectedKey = normalizeSectionKey(expectedTitle);
  let bodyStart = null;
  for (const heading of headings) {
    if (bodyStart !== null && heading.level <= 2) {
      if (/\S/.test(bytes.subarray(bodyStart, heading.rawStart).toString('utf8'))) return true;
      bodyStart = null;
    }
    if (heading.level === 2 && normalizeSectionKey(heading.title) === expectedKey) {
      bodyStart = heading.rawEnd;
    }
  }

  return bodyStart !== null && /\S/.test(bytes.subarray(bodyStart).toString('utf8'));
}

function legacyHistoryFactsFromCatalog(catalog) {
  const parents = [
    { index: 'QUICK_WINS.md', history: 'QUICK_WINS_HISTORY.md', heading: 'Implemented' },
    { index: 'FEATURES.md', history: 'FEATURES_HISTORY.md', heading: 'Implemented' },
    { index: 'BUGS.md', history: 'BUGS_HISTORY.md', heading: 'Fixed' },
  ];
  return parents.flatMap(({ index, history, heading }) => {
    const parent = catalog.get(index);
    if (parent === undefined || catalog.has(history)) return [];
    const headings = commonMarkHeadings(parent.contents);
    if (!hasPopulatedLegacySection(parent.contents, headings, heading)) return [];

    return [{ indexPath: `.claude/${index}`, historyPath: `.claude/${history}` }];
  }).sort((left, right) => compareTargets(`${left.indexPath}\0${left.historyPath}`, `${right.indexPath}\0${right.historyPath}`));
}

function requireCatalogReferenceTarget(raw) {
  if (typeof raw !== 'string') {
    throw new CatalogError('invalid catalog reference target: ' + String(raw));
  }
  const fileTarget = raw.split('#')[0];
  if (fileTarget === '' || fileTarget.startsWith('/') || fileTarget.includes('\\') || /^[A-Za-z]:/.test(fileTarget)) {
    throw new CatalogError('invalid catalog reference target: ' + raw);
  }
  const parts = fileTarget.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw new CatalogError('invalid catalog reference target: ' + raw);
  }
  const normalized = fileTarget;
  try {
    normalizeCatalogItems([{ target: normalized, contents: '' }]);
  } catch (error) {
    if (error instanceof CatalogError) {
      throw error;
    }

    throw new CatalogError('invalid catalog reference target: ' + raw);
  }

  return normalized;
}

function normalizeEvidencePath(raw, catalog) {
  if (typeof raw !== 'string') return null;
  const normalized = requireCatalogReferenceTarget(raw);

  return catalog.has(normalized) ? normalized : null;
}

function normalizeSidecar(items, catalog, kind, offset = 0) {
  return items.map((item, index) => sidecarItem(kind, offset + index, item.evidencePaths.map((target) => normalizeEvidencePath(target, catalog)).filter((target) => target !== null)));
}

// Concatenates lockstep-pushed evidence segments in their push order; each
// segment's ordinal offset is the count of items already emitted, so the
// ordinals track the segments themselves rather than re-derived array lengths.
function concatSidecarSegments(kind, catalog, segments) {
  const items = [];
  for (const segment of segments) {
    items.push(...normalizeSidecar(segment, catalog, kind, items.length));
  }

  return items;
}

// Pure controller adapter. It accepts the complete, root-relative markdown
// catalog in place of CLI discovery and reads no filesystem state.
function analyzeCatalog(items) {
  const catalogItems = normalizeCatalogItems(items);
  const catalog = new Map(catalogItems.map((item) => [item.target, item]));
  const files = {};
  for (const name of [...WORK_INDEX_NAMES, 'PATTERNS']) {
    const item = catalog.get(`${name}.md`);
    files[name] = item?.contents;
  }
  const result = analyze(files);
  const scanned = scanCatalogBreakoutTargets(result.breakoutTargets, new Map(catalogItems.map((item) => [item.target, item.contents])));
  const unlinkedNotices = scanUnlinkedCatalogItems(catalog, scanned.scannedTargets);
  result.notices.push(...scanned.notices, ...unlinkedNotices);
  result.structuralErrors.push(...scanned.structuralErrors);
  const coreEvidence = result[ANALYSIS_EVIDENCE];
  const evidence = {
    structuralErrors: concatSidecarSegments('structuralErrors', catalog, [
      coreEvidence.structuralErrors,
      scanned[ANALYSIS_EVIDENCE].structuralErrors.map((evidencePaths) => ({ evidencePaths })),
    ]),
    notices: concatSidecarSegments('notices', catalog, [
      coreEvidence.notices,
      scanned[ANALYSIS_EVIDENCE].notices.map((evidencePaths) => ({ evidencePaths })),
      [...unlinkedNotices[ANALYSIS_EVIDENCE]].map((evidencePaths) => ({ evidencePaths })),
    ]),
    legacyHistory: legacyHistoryFactsFromCatalog(catalog),
  };
  Object.defineProperty(result, 'evidence', { configurable: true, enumerable: true, value: evidence });
  delete result.breakoutTargets;

  return result;
}

// Canonical containment is established immediately before the direct read.
// Absence is folded into the result; every other read error still throws.
function readFileIfPresent(p, rootIdentity, options = {}) {
  const canonicalize = options.canonicalize ?? canonicalPath;
  const contains = options.contains ?? isContainedPath;
  const readFile = options.readFile ?? ((target) => readCanonicalText(rootIdentity, target));
  try {
    const identity = canonicalize(p);
    if (!contains(rootIdentity, identity)) return undefined;

    return readFile(identity);
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    throw error;
  }
}

function errorChainHasCode(error, code) {
  let current = error;
  for (let depth = 0; depth < 8 && current !== null && typeof current === 'object'; depth += 1) {
    if (current.code === code) return true;
    current = current.cause;
  }

  return false;
}

function acquireBacklogRootIdentity(claudeDir) {
  const resolved = path.resolve(claudeDir);
  try {
    const authority = fs.realpathSync.native(path.dirname(resolved));
    const before = fs.lstatSync(resolved, { bigint: true });
    const identity = fs.realpathSync.native(resolved);
    const after = fs.lstatSync(identity, { bigint: true });
    if (!before.isDirectory()
      || before.isSymbolicLink()
      || !after.isDirectory()
      || after.isSymbolicLink()
      || before.dev !== after.dev
      || before.ino !== after.ino
      || !isContainedPath(authority, identity)) {
      return { kind: 'invalid' };
    }

    return { authority, device: after.dev, identity, inode: after.ino, kind: 'ok', logicalPath: resolved };
  } catch (error) {
    return errorChainHasCode(error, 'ENOENT') ? { kind: 'missing' } : { kind: 'invalid' };
  }
}

function revalidateBacklogRootIdentity(acquired) {
  const current = acquireBacklogRootIdentity(acquired.logicalPath);
  if (current.kind !== 'ok') return current;
  if (current.authority !== acquired.authority
    || current.device !== acquired.device
    || current.identity !== acquired.identity
    || current.inode !== acquired.inode) {
    return { kind: 'invalid' };
  }

  return current;
}

function writeMissingBacklogRoot(claudeDir) {
  process.stdout.write(JSON.stringify({
    error: `no .claude directory found at ${claudeDir}; run /nightshift:init-backlog to scaffold the four-index layout`,
  }, null, 2) + '\n');
  process.exitCode = 1;
}

function writeInvalidBacklogRoot(claudeDir) {
  process.stdout.write(JSON.stringify({
    error: `the .claude directory escapes its repository authority: ${claudeDir}`,
  }, null, 2) + '\n');
  process.exitCode = 1;
}

function runCli(argRoot) {
  const root = path.resolve(argRoot || process.cwd());
  const claudeDir = path.basename(root) === '.claude' ? root : path.join(root, '.claude');
  const acquired = acquireBacklogRootIdentity(claudeDir);
  if (acquired.kind === 'missing') {
    writeMissingBacklogRoot(claudeDir);

    return;
  }
  if (acquired.kind !== 'ok') {
    writeInvalidBacklogRoot(claudeDir);

    return;
  }
  const rootIdentity = acquired.identity;
  const rootRemainsAcquired = () => {
    const current = revalidateBacklogRootIdentity(acquired);
    if (current.kind === 'ok') return true;
    if (current.kind === 'missing') writeMissingBacklogRoot(claudeDir);
    else writeInvalidBacklogRoot(claudeDir);

    return false;
  };
  try {
    const files = {};
    for (const name of [...WORK_INDEX_NAMES, 'PATTERNS']) {
      files[name] = readFileIfPresent(path.join(claudeDir, `${name}.md`), rootIdentity);
    }
    const result = analyze(files);
    if (!rootRemainsAcquired()) return;

    const scanned = scanBreakoutTargets(result.breakoutTargets, claudeDir, { rootIdentity });
    if (!rootRemainsAcquired()) return;
    let unlinkedNotices;
    try {
      unlinkedNotices = scanUnlinkedBacklogFiles(claudeDir, scanned.scannedFiles, { rootIdentity });
    } catch (error) {
      if (!rootRemainsAcquired()) return;
      unlinkedNotices = errorChainHasCode(error, 'ENOENT')
        ? ['backlog tree changed during traversal; retry; unlinked backlog files were not checked this run']
        : [`backlog tree could not be fully traversed (${error?.code ?? 'unknown'}); retry; unlinked backlog files were not checked this run`];
    }
    if (!rootRemainsAcquired()) return;
    result.notices.push(...scanned.notices, ...unlinkedNotices);
    result.structuralErrors.push(...scanned.structuralErrors);
    delete result.breakoutTargets;

    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } catch (error) {
    if (!errorChainHasCode(error, 'ENOENT')) throw error;
    const current = revalidateBacklogRootIdentity(acquired);
    if (current.kind !== 'missing') throw error;
    writeMissingBacklogRoot(claudeDir);
  }
}

// Stable identity for a backlog entry as a graph node. Path-qualified self
// link when present (e.g. "features/foo"), else the index plus normalized
// title; unique within an index. The path route is gated on the same closed
// catalog-reference grammar the path registry uses, so a traversing, absolute,
// or backslashed self-target keys by index and title exactly like an entry
// carrying no self-target at all. Admitting it here would let two hostile
// entries sharing a basename collapse into one graph node, conflating their
// cycle membership and their nodeToRec labels on a key the path registry
// deliberately refuses to hold.
function nodeKey(rec) {
  const pk = isCatalogReferenceTarget(rec.entry.selfTarget) ? targetPathKey(rec.entry.selfTarget) : null;
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
  const sortedAdjacency = new Map(sortedNodes.map((node) => [node, [...adj.get(node)].sort()]));
  let counter = 0;
  const index = new Map();
  const lowlink = new Map();
  const onStack = new Set();
  const componentStack = [];
  const components = [];
  const beginNode = (node, parent) => {
    index.set(node, counter);
    lowlink.set(node, counter);
    counter += 1;
    componentStack.push(node);
    onStack.add(node);

    return { neighborIndex: 0, neighbors: sortedAdjacency.get(node), node, parent };
  };
  for (const start of sortedNodes) {
    if (index.has(start)) continue;
    const traversalStack = [beginNode(start, null)];
    while (traversalStack.length > 0) {
      const frame = traversalStack[traversalStack.length - 1];
      if (frame.neighborIndex < frame.neighbors.length) {
        const neighbor = frame.neighbors[frame.neighborIndex];
        frame.neighborIndex += 1;
        if (!index.has(neighbor)) {
          traversalStack.push(beginNode(neighbor, frame.node));
        } else if (onStack.has(neighbor)) {
          lowlink.set(frame.node, Math.min(lowlink.get(frame.node), index.get(neighbor)));
        }
        continue;
      }

      traversalStack.pop();
      if (frame.parent !== null) {
        lowlink.set(frame.parent, Math.min(lowlink.get(frame.parent), lowlink.get(frame.node)));
      }
      if (lowlink.get(frame.node) === index.get(frame.node)) {
        const component = [];
        let member;
        do {
          member = componentStack.pop();
          onStack.delete(member);
          component.push(member);
        } while (member !== frame.node);
        if (component.length >= 2) components.push({ members: component.sort() });
      }
    }
  }
  return components.sort((a, b) => compareTargets(a.members[0], b.members[0]));
}

function groupCycleEdges(cycles, edges) {
  const cycleByNode = new Map();
  const grouped = cycles.map(() => []);
  for (let cycleIndex = 0; cycleIndex < cycles.length; cycleIndex++) {
    for (const member of cycles[cycleIndex].members) cycleByNode.set(member, cycleIndex);
  }
  for (const edge of edges) {
    const cycleIndex = cycleByNode.get(edge.from);
    if (cycleIndex !== undefined && cycleIndex === cycleByNode.get(edge.to)) grouped[cycleIndex].push(edge);
  }

  return grouped;
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
    if ((rec.entry.requiresProblems ?? []).length > 0) continue;
    const content = rec.entry.requiresContent;
    if (content === null || content === undefined) continue;
    const from = nodeKey(rec);
    const pending = [];
    const structuralProblems = [];
    const items = requiresLineItems(content, structuralProblems);
    let structural = structuralProblems.length > 0;
    for (const item of items) {
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
function formatCycle(cycle, cycleEdges, nodeToRec) {
  const members = [...cycle.members];
  const seen = new Set();
  const uniqueEdges = cycleEdges
    .filter((e) => {
      const key = `${e.from}::${e.to}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => compareTargets(a.from + '::' + a.to, b.from + '::' + b.to));
  const memberLabels = members.map((n) => nodeLabel(nodeToRec.get(n)));
  const edgeLabels = uniqueEdges.map((e) => `${nodeLabel(nodeToRec.get(e.from))} -> ${nodeLabel(nodeToRec.get(e.to))}`);
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
  createBreakoutLoader,
  readFileIfPresent,
  runCli,
  scanUnlinkedBacklogFiles,
  nodeKey,
  findCycles,
  groupCycleEdges,
  analyzeCatalog,
};

if (require.main === module) {
  runCli(process.argv[2]);
}
