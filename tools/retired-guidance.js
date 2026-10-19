#!/usr/bin/env node
'use strict';

// Generates and verifies skills/init-backlog/retired-guidance.json, the template guidance earlier template versions had
// and the current ones lack (commitment 3 of .nightshift/specs/setup-index-text-adjudication.md).
//   node tools/retired-guidance.js [--write] [--baseline <ref>]
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { BACKLOG_FILES } = require('../internal/backlog-catalog');
const { COMPARISON_RULES } = require('../internal/template-text/document');
const { retiredProblem, templateModel, templateName } = require('../internal/template-text/templates');

const SCRIPT = path.basename(__filename);
const ROOT = path.resolve(__dirname, '..');
const LIST = 'skills/init-backlog/retired-guidance.json';
const LF = String.fromCharCode(10);
const templatePath = file => `skills/init-backlog/templates/${templateName(file)}`;

class RetiredGuidanceError extends Error {}

function git(root, args, allowFailure = false) {
  const result = spawnSync('git', args, { cwd: root, windowsHide: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0 && !allowFailure) throw new RetiredGuidanceError(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);

  return result;
}

// Guidance identities of one template text: non-heading guidance block hashes and guidance heading hashes; and every
// block and heading hash it holds, placeholders and containers included.
function guidanceOf(text) {
  const model = templateModel(text);
  const guidanceSections = model.sections.filter(section => section.kind === 'guidance');

  return {
    blocks: new Set([...model.preamble, ...guidanceSections.flatMap(section => section.blocks)].map(block => block.hash)),
    headings: new Set(guidanceSections.map(section => section.heading.hash)),
    all: model.allHashes,
  };
}

// Every version of a template reachable from ref, following renames, as texts. A version that cannot be compared, such
// as one with an unclosed fence, is skipped and named in warnings.
function historicalTexts(root, ref, file, warnings) {
  const log = git(root, ['log', '--follow', '--format=COMMIT %H', '--name-only', ref, '--', templatePath(file)]).stdout.split(LF);
  const texts = [];
  for (let index = 0; index < log.length; index += 1) {
    if (!log[index].startsWith('COMMIT ')) continue;
    const commit = log[index].slice('COMMIT '.length).trim();
    const name = log.slice(index + 1).find(line => line.trim() && !line.startsWith('COMMIT '))?.trim();
    if (!name) continue;
    const shown = git(root, ['show', `${commit}:${name}`], true);
    if (shown.status === 0) texts.push({ commit, text: shown.stdout });
    else warnings.push(`${file} at ${commit.slice(0, 8)} could not be read`);
  }

  return texts;
}

// The retired list the history reachable from ref and the given current templates produce under the current rules.
// current maps a backlog file name to its template text.
function generate(root, ref, current) {
  const warnings = [];
  const retired = {};
  for (const file of BACKLOG_FILES) {
    const now = guidanceOf(current.get(file));
    const blocks = new Set();
    const headings = new Set();
    for (const { commit, text } of historicalTexts(root, ref, file, warnings)) {
      let earlier;
      try { earlier = guidanceOf(text); }
      catch (error) {
        warnings.push(`${file} at ${commit.slice(0, 8)} skipped: ${error.message}`);
        continue;
      }
      for (const hash of earlier.blocks) if (!now.all.has(hash)) blocks.add(hash);
      for (const hash of earlier.headings) if (!now.all.has(hash)) headings.add(hash);
    }
    retired[file] = { blocks: [...blocks].sort(), headings: [...headings].sort() };
  }

  return { list: { schema: 1, rules: COMPARISON_RULES, retired }, warnings };
}

function currentTemplates(root) {
  return new Map(BACKLOG_FILES.map(file => [file, fs.readFileSync(path.join(root, templatePath(file)), 'utf8')]));
}

const serialize = list => JSON.stringify(list, null, 2) + LF;

// Problems with a retired list against the history reachable from ref: every listed hash must be reproducible from
// some version and none may be a block or heading of the current template.
function verify(root, ref, list, current) {
  const problems = [];
  const malformed = retiredProblem(list);
  if (malformed) return [`retired list is malformed: ${malformed}`];
  if (list.rules !== COMPARISON_RULES) problems.push(`retired list uses comparison rules ${list.rules}, the code uses ${COMPARISON_RULES}; regenerate it with --write`);
  const reproducible = generate(root, ref, current).list.retired;
  for (const file of BACKLOG_FILES) {
    const now = guidanceOf(current.get(file));
    const listed = list.retired[file] ?? { blocks: [], headings: [] };
    for (const name of ['blocks', 'headings']) {
      for (const hash of listed[name]) {
        if (now.all.has(hash)) problems.push(`${file} ${name} lists ${hash}, which the current template holds`);
        else if (!reproducible[file][name].includes(hash)) problems.push(`${file} ${name} lists ${hash}, which no template version reachable from ${ref} produces under comparison rules ${COMPARISON_RULES}`);
      }
    }
  }

  return problems;
}

function main(argv = process.argv.slice(2)) {
  const write = argv.includes('--write');
  const baselineAt = argv.indexOf('--baseline');
  const ref = baselineAt >= 0 ? argv[baselineAt + 1] : 'origin/main';
  if (!ref) throw new RetiredGuidanceError(`Usage: node tools/${SCRIPT} [--write] [--baseline <ref>]`);
  git(ROOT, ['rev-parse', '--verify', `${ref}^{commit}`]);
  const current = currentTemplates(ROOT);
  const file = path.join(ROOT, LIST);
  if (write) {
    const { list, warnings } = generate(ROOT, ref, current);
    if (fs.existsSync(file)) {
      const existing = JSON.parse(fs.readFileSync(file, 'utf8'));
      const dropped = BACKLOG_FILES.flatMap(name => ['blocks', 'headings'].flatMap(kind => (existing.retired?.[name]?.[kind] ?? []).filter(hash => !list.retired[name][kind].includes(hash) && !guidanceOf(current.get(name)).all.has(hash))));
      if (existing.rules === COMPARISON_RULES && dropped.length > 0) throw new RetiredGuidanceError(`Regeneration would drop ${dropped.length} retired hash(es) under unchanged comparison rules ${COMPARISON_RULES}; if the comparison rules changed, increase COMPARISON_RULES in internal/template-text/document.js first`);
    }
    fs.writeFileSync(file, serialize(list));

    return { written: LIST, rules: list.rules, warnings };
  }
  const problems = verify(ROOT, ref, JSON.parse(fs.readFileSync(file, 'utf8')), current);
  if (problems.length > 0) throw new RetiredGuidanceError(problems.join(LF));

  return { verified: LIST, ref };
}

if (require.main === module) {
  try { console.log(JSON.stringify(main())); }
  catch (error) {
    console.error(`${SCRIPT}: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { LIST, RetiredGuidanceError, currentTemplates, generate, guidanceOf, serialize, templatePath, verify };
