#!/usr/bin/env node
'use strict';

// Deterministic parser behind the flightdeck:ready skill. Reads the active
// .claude/ indexes (QUICK_WINS.md, FEATURES.md, BUGS.md), resolves each
// entry's **Requires:** line, expands sliced features into per-slice work
// units, and emits a JSON report on stdout:
//
//   { indexes, ready, blocked, external, structuralErrors, notices }
//
// History archives are never read: the walk-and-remove convention keeps
// active Requires lines authoritative. PATTERNS.md is a pattern registry,
// not a work backlog, so it is not parsed either.
//
// Usage: node ready.js [repo-root-or-.claude-dir]   (defaults to cwd)

const fs = require('fs');
const path = require('path');

const INDEX_FILE_STEMS = new Set([
  'QUICK_WINS', 'FEATURES', 'BUGS', 'PATTERNS',
  'QUICK_WINS_HISTORY', 'FEATURES_HISTORY', 'BUGS_HISTORY',
]);

const EXCLUDED_SECTIONS = {
  QUICK_WINS: ['history'],
  // 'requires lines' and 'slicing' are template convention sections; they
  // carry prose and examples, never work entries.
  FEATURES: ['exploring', 'author tooling', 'history', 'implemented', 'requires lines', 'slicing'],
  BUGS: ['history', 'fixed', 'requires lines'],
};

const PLACEHOLDER_LINES = new Set([
  'nothing tracked yet.', 'nothing captured yet.', 'nothing yet.',
  'nothing currently tracked.', 'nothing being explored yet.',
]);

// A bold label at line start (e.g. **Slices:**, **Shipped:**) terminates a
// wrapped Requires line; inline **bold** mid-line does not.
const LABEL_AT_START = /^\*\*[^*]+?:\*\*/;
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
// leading "<token>( <token)* — " slice-type prefix (
// "MVP — ", "Continuation — ", "Slice 2 — "), then stable
// strip again, then case-fold.
function normalizeSliceName(s) {
  let cur = stripStable(s);
  cur = cur.replace(/^\S+(?: \S+)* — /, '');
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

function parseRequiresItem(raw) {
  const linkMatch = raw.match(/^\[([^\]]*)\]\(([^)]*)\)\.?$/);
  if (linkMatch) {
    return { kind: 'link', display: linkMatch[1].trim(), target: linkMatch[2].trim() };
  }
  if (/^none\.?$/i.test(raw)) {
    return { kind: 'none' };
  }
  return { kind: 'external', text: raw.replace(/\.$/, '') };
}

// Assemble a wrapped **Requires:** line starting at lines[start]. Joins
// continuation lines until a terminator: blank line, ##/### heading,
// "- " bullet, or a **Label:** line at line start.
function assembleRequires(lines, start) {
  const first = lines[start].trim();
  let content = first.replace(/^\*\*Requires:\*\*/i, '').trim();
  let i = start + 1;
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
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
// opts: { bullets: boolean, noticeProse: boolean }
// Returns { entries, proseOnlySections }.
function extractEntries(content, excludedSectionTitles, opts = {}) {
  const lines = content.split(/\r?\n/);
  const excluded = new Set(excludedSectionTitles.map((t) => t.toLowerCase()));
  const entries = [];
  const proseOnlySections = [];

  let sectionTitle = null;
  let sectionExcluded = false;
  let sectionHasEntry = false;
  let sectionHasProse = false;
  let current = null;

  const closeSection = () => {
    if (
      opts.noticeProse && sectionTitle !== null && !sectionExcluded &&
      !sectionHasEntry && sectionHasProse
    ) {
      proseOnlySections.push(sectionTitle);
    }
  };

  for (const line of lines) {
    const h2 = line.match(/^## (.+)$/);
    if (h2) {
      closeSection();
      current = null;
      sectionTitle = h2[1].trim();
      sectionExcluded = excluded.has(sectionTitle.toLowerCase().replace(/\.$/, ''));
      sectionHasEntry = false;
      sectionHasProse = false;
      continue;
    }
    const h3 = line.match(/^### (.+)$/);
    if (h3) {
      current = null;
      if (!sectionExcluded) {
        sectionHasEntry = true;
        const heading = h3[1].trim();
        const link = heading.match(/^\[([^\]]*)\]\(([^)]*)\)$/);
        current = {
          kind: 'h3',
          title: link ? link[1].trim() : heading,
          selfTarget: link ? link[2].trim() : null,
          section: sectionTitle,
          bodyLines: [],
        };
        entries.push(current);
      }
      continue;
    }
    if (current && current.kind === 'h3') {
      current.bodyLines.push(line);
      continue;
    }
    if (opts.bullets && BULLET.test(line) && sectionTitle !== null && !sectionExcluded) {
      sectionHasEntry = true;
      const text = line.replace(/^- /, '').trim();
      const boldMatch = text.match(/^\*\*(.+?)\*\*/);
      const title = stripStable(boldMatch ? boldMatch[1] : text.split('.')[0]);
      current = {
        kind: 'bullet',
        title,
        selfTarget: null,
        section: sectionTitle,
        bodyLines: [text],
      };
      entries.push(current);
      continue;
    }
    if (current && current.kind === 'bullet' && /^\s+\S/.test(line)) {
      current.bodyLines.push(line.trim());
      continue;
    }
    if (current && current.kind === 'bullet') {
      current = null; // blank or non-indented line ends a bullet entry
    }
    if (sectionTitle !== null && !sectionExcluded) {
      const t = line.trim();
      if (t !== '' && !PLACEHOLDER_LINES.has(t.toLowerCase())) {
        sectionHasProse = true;
      }
    }
  }
  closeSection();
  return { entries, proseOnlySections };
}

// ---------- Requires + Slices parsing on an entry body ----------

function findRequires(bodyLines) {
  for (let i = 0; i < bodyLines.length; i++) {
    if (/^\*\*Requires:\*\*/i.test(bodyLines[i].trim()) && !/^\s+/.test(bodyLines[i])) {
      return assembleRequires(bodyLines, i);
    }
  }
  return null;
}

// Parse the **Slices:** block. Slice-declaring bullets are "- " bullets at
// indent 0; indented continuation lines (inline **Requires:** annotations)
// attach to the preceding bullet.
function parseSlices(bodyLines) {
  let start = -1;
  for (let i = 0; i < bodyLines.length; i++) {
    if (/^\*\*Slices:\*\*\s*$/i.test(bodyLines[i].trim()) && !/^\s+/.test(bodyLines[i])) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;

  const slices = [];
  let i = start + 1;
  let sawBullet = false;
  for (; i < bodyLines.length; i++) {
    const line = bodyLines[i];
    const t = line.trim();
    if (t === '') {
      if (sawBullet) {
        // A blank line followed by a non-bullet, non-indented line ends
        // the block; peek ahead.
        const next = bodyLines[i + 1];
        if (next === undefined) break;
        if (!BULLET.test(next.trim()) && !/^\s+\S/.test(next)) break;
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
        name: normalizeSliceName(nameRaw),
        displayName: stripStable(nameRaw),
        struck: Boolean(struckMatch),
        inlineRequires: null,
      });
    } else if (/^\s+\S/.test(line) && slices.length > 0) {
      if (/^\*\*Requires:\*\*/i.test(t)) {
        // Assemble the indented inline annotation, joining further
        // indented non-bullet lines.
        let content = t.replace(/^\*\*Requires:\*\*/i, '').trim();
        let j = i + 1;
        while (j < bodyLines.length) {
          const cont = bodyLines[j];
          const ct = cont.trim();
          if (ct === '' || BULLET.test(cont) || !/^\s+\S/.test(cont) || LABEL_AT_START.test(ct)) break;
          content += ' ' + ct;
          j++;
        }
        slices[slices.length - 1].inlineRequires = content;
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

// ---------- registry + resolution ----------

function targetSlug(target) {
  if (!target) return null;
  const noAnchor = target.split('#')[0];
  const base = path.basename(noAnchor, path.extname(noAnchor));
  return base || null;
}

function buildRegistry(indexEntries) {
  // indexEntries: [{ index, entry }]
  const byTitle = new Map();
  const bySlug = new Map();
  for (const rec of indexEntries) {
    byTitle.set(normalizeTitle(rec.entry.title), rec);
    const slug = targetSlug(rec.entry.selfTarget);
    if (slug && !INDEX_FILE_STEMS.has(slug)) {
      bySlug.set(slug.toLowerCase(), rec);
    }
  }
  return { byTitle, bySlug };
}

// Resolve one Requires link item against the registry. Returns one of:
//   { kind: 'blocked', label }         in-backlog reference, currently blocking
//   { kind: 'structural', problem }    stale/broken/typo reference
function resolveLink(item, registry) {
  const display = item.display;
  const slug = targetSlug(item.target);
  const slugKey = slug && !INDEX_FILE_STEMS.has(slug) ? slug.toLowerCase() : null;

  let parent = null;
  let sliceName = null;

  const fullTitleHit = registry.byTitle.get(normalizeTitle(display));
  const slugHit = slugKey ? registry.bySlug.get(slugKey) : null;

  const colonIdx = display.indexOf(': ');
  if (colonIdx > 0) {
    const prefix = display.slice(0, colonIdx);
    const suffix = display.slice(colonIdx + 2);
    const prefixHit = registry.byTitle.get(normalizeTitle(prefix)) || slugHit;
    if (prefixHit && prefixHit.entry.slices && prefixHit.entry.slices.length > 0) {
      parent = prefixHit;
      sliceName = suffix;
    }
  }
  if (!parent) {
    parent = slugHit || fullTitleHit;
  }
  if (!parent) {
    return {
      kind: 'structural',
      problem: `reference "[${display}](${item.target})" does not resolve to any active backlog entry (broken link, or stale reference left behind after the dependency shipped)`,
    };
  }

  const slices = parent.entry.slices;
  if (sliceName !== null) {
    const norm = normalizeSliceName(sliceName);
    const slice = slices.find((s) => s.name === norm);
    if (!slice) {
      return {
        kind: 'structural',
        problem: `slice suffix "${sliceName}" does not match any bullet in "${parent.entry.title}"'s Slices block (typo or wrong slug)`,
      };
    }
    if (slice.struck) {
      return {
        kind: 'structural',
        problem: `stale reference: slice "${parent.entry.title}: ${slice.displayName}" has shipped (struck through) but the reference was not removed`,
      };
    }
    return { kind: 'blocked', label: `${parent.entry.title}: ${slice.displayName}` };
  }

  if (colonIdx > 0 && !slices) {
    // Suffixed display but the resolved parent has no Slices block and no
    // full-title match succeeded either: treat as structural (typo).
    if (!fullTitleHit) {
      return {
        kind: 'structural',
        problem: `slice-suffixed reference "${display}" points at "${parent.entry.title}", which has no Slices block`,
      };
    }
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
    return { kind: 'blocked', label: `${parent.entry.title}: ${mvp.displayName} (MVP)` };
  }

  return { kind: 'blocked', label: parent.entry.title };
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

function classifyUnit(unit, registry, out) {
  const { index, title, excerpt, requiresContent, missingRequires, extraBlockers } = unit;

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
    for (const raw of splitTopLevelCommas(requiresContent)) {
      const item = parseRequiresItem(raw);
      if (item.kind === 'none') continue;
      if (item.kind === 'external') {
        externals.push(item.text);
        continue;
      }
      const res = resolveLink(item, registry);
      if (res.kind === 'blocked') blockers.push(res.label);
      else structural.push(res.problem);
    }
  }

  if (structural.length > 0) {
    out.structuralErrors.push({ index, title, problem: structural.join('; ') });
    return;
  }
  if (blockers.length > 0) {
    // Mixed link + external: classify Blocked, externals mentioned
    // parenthetically. Never double-report under both categories.
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

function analyze(files) {
  // files: { QUICK_WINS?, FEATURES?, BUGS? } raw markdown strings.
  const out = {
    indexes: { found: [], missing: [] },
    ready: [],
    blocked: [],
    external: [],
    structuralErrors: [],
    notices: [],
  };

  const parsed = {};
  for (const name of ['QUICK_WINS', 'FEATURES', 'BUGS']) {
    if (files[name] === undefined || files[name] === null) {
      out.indexes.missing.push(`${name}.md`);
      continue;
    }
    out.indexes.found.push(`${name}.md`);
    parsed[name] = extractEntries(files[name], EXCLUDED_SECTIONS[name], {
      bullets: name === 'QUICK_WINS',
      noticeProse: name === 'QUICK_WINS',
    });
  }
  if (files.PATTERNS !== undefined && files.PATTERNS !== null) {
    out.indexes.found.push('PATTERNS.md (registry only, not parsed for work items)');
  } else {
    out.indexes.missing.push('PATTERNS.md');
  }

  // Attach slices + requires to feature/bug entries, build the registry.
  const registryRecords = [];
  for (const name of ['QUICK_WINS', 'FEATURES', 'BUGS']) {
    if (!parsed[name]) continue;
    for (const entry of parsed[name].entries) {
      if (name !== 'QUICK_WINS') {
        const req = findRequires(entry.bodyLines);
        entry.requiresContent = req ? req.content : null;
        entry.slices = name === 'FEATURES' ? parseSlices(entry.bodyLines) : null;
      } else {
        entry.requiresContent = null;
        entry.slices = null;
      }
      registryRecords.push({ index: `${name}.md`, entry });
    }
    for (const section of parsed[name].proseOnlySections) {
      out.notices.push(
        `${name}.md section "## ${section}" has content but no ### entries; only ### entries are parsed as work items — check that section manually`,
      );
    }
  }
  const registry = buildRegistry(registryRecords);

  // Quick wins: atomic, no Requires lines, always unblocked.
  if (parsed.QUICK_WINS) {
    for (const entry of parsed.QUICK_WINS.entries) {
      out.ready.push({
        index: 'QUICK_WINS.md',
        title: entry.title,
        excerpt: firstExcerpt(entry.bodyLines),
      });
    }
  }

  // Features and bugs.
  for (const name of ['FEATURES', 'BUGS']) {
    if (!parsed[name]) continue;
    for (const entry of parsed[name].entries) {
      const index = `${name}.md`;
      const slices = entry.slices;

      if (slices && slices.length > 0) {
        const unshipped = slices.filter((s) => !s.struck);
        if (unshipped.length === 0) {
          out.structuralErrors.push({
            index,
            title: entry.title,
            problem: 'all slices shipped — graduate parent to FEATURES_HISTORY.md per the ## Slicing last-slice rule',
          });
          continue;
        }
        if (entry.requiresContent === null) {
          out.structuralErrors.push({
            index, title: entry.title,
            problem: 'missing top-level **Requires:** line (should reflect the next-to-ship slice)',
          });
          continue;
        }
        const mvp = slices[0];
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
            missingRequires: false,
            extraBlockers,
          }, registry, out);
        }
      } else {
        classifyUnit({
          index,
          title: entry.title,
          excerpt: firstExcerpt(entry.bodyLines),
          requiresContent: entry.requiresContent,
          missingRequires: entry.requiresContent === null,
        }, registry, out);
      }

      // Broken breakout-file links are a notice, not a structural error;
      // the Requires line still resolves normally. Checked by the CLI
      // (needs the filesystem); analyze() records the candidates.
      if (entry.selfTarget && !entry.selfTarget.startsWith('http')) {
        out.notices._breakoutTargets = out.notices._breakoutTargets || [];
        out.notices._breakoutTargets.push({ index, title: entry.title, target: entry.selfTarget });
      }
    }
  }

  // Move the private accumulator off the notices array before returning.
  const breakoutTargets = out.notices._breakoutTargets || [];
  delete out.notices._breakoutTargets;
  out._breakoutTargets = breakoutTargets;
  return out;
}

function runCli(argRoot) {
  const root = path.resolve(argRoot || process.cwd());
  const claudeDir = path.basename(root) === '.claude' ? root : path.join(root, '.claude');
  if (!fs.existsSync(claudeDir)) {
    process.stdout.write(JSON.stringify({
      error: `no .claude directory found at ${claudeDir}; run /flightdeck:init-workflow to scaffold the four-index layout`,
    }, null, 2) + '\n');
    process.exitCode = 1;
    return;
  }
  const files = {};
  for (const name of ['QUICK_WINS', 'FEATURES', 'BUGS', 'PATTERNS']) {
    const p = path.join(claudeDir, `${name}.md`);
    files[name] = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : undefined;
  }
  const result = analyze(files);

  // Filesystem check for breakout-file links (relative to the index dir).
  for (const rec of result._breakoutTargets) {
    const target = rec.target.split('#')[0];
    const resolved = path.resolve(claudeDir, target);
    if (!fs.existsSync(resolved)) {
      result.notices.push(
        `${rec.index} entry "${rec.title}" links to ${rec.target}, which does not exist — remove the broken link or create the file (its Requires line still resolves normally)`,
      );
    }
  }
  delete result._breakoutTargets;

  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

module.exports = {
  analyze,
  stripStable,
  normalizeSliceName,
  normalizeTitle,
  splitTopLevelCommas,
  parseRequiresItem,
  parseSlices,
  extractEntries,
};

if (require.main === module) {
  runCli(process.argv[2]);
}
