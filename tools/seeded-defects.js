#!/usr/bin/env node
'use strict';
// Seeded-defect suite: runs one fresh code lead and one fresh skeptic per fixture through the runtime's own dispatchReview, against
// small project states whose defects are known, and grades the saved results by code. The governing spec is
// .nightshift/specs/seeded-defect-suite.md. Nothing here ships in the plugin payload.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const SUITE_ROOT = path.join(__dirname, 'seeded-defects');
const SCRIPT_NAME = path.basename(__filename, '.js');

const CODE_DIMENSIONS = Object.freeze(['requirements-ux', 'correctness-integration', 'security-data-safety', 'design-maintainability', 'performance-resources', 'tests-evidence']);
const SEVERITIES = Object.freeze(['critical', 'important', 'minor']);
const CONTAMINATION_TOKENS = Object.freeze(['seeded-defects', 'fixture.json']);
const HIDDEN_PREFIXES = Object.freeze(['.nightshift/runs/', '.nightshift/inbox/', '.tmp/']);
const ADJUDICATED_ORIGIN = /^adjudicated:[^/\\]+$/;
// A host carries no '-' and an id no '__', so neither can imitate the separators of a fixture run key.
const HOST_NAME = /^[A-Za-z0-9]+$/;
const MODEL_NAME = /^(?!.*__)[A-Za-z0-9][A-Za-z0-9._-]*$/;
const ADJUDICATION_OUTCOMES = Object.freeze(['false', 'attributed', 'real']);
const RECEIPT_ORIGIN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const INITIAL_RESERVE = 2000000;
const LINE_SLACK = 3;
const EFFORT = 'xhigh';
const REPOSITORY_PREFIX = 'nsr-';
const OWNER_FILE = 'nsr-owner';
const FIXTURE_AUTHOR = ['-c', 'user.name=Suite fixture', '-c', 'user.email=a.stenlund@gmail.com'];
const VIBE_LAUNCHER = path.join(SUITE_ROOT, 'vibe-launcher.js');
// Hosts the runtime's reviewer gate does not admit, measured through a launcher the harness injects. The dispatch names the gate
// candidate so the runtime accepts it; the launcher runs the evaluated host and model instead, and the records name both.
const EVALUATION_HOSTS = Object.freeze({
  vibe: { gate: { host: 'codex', model: 'gpt-6-sol' }, launcher: () => require(VIBE_LAUNCHER).runVibe, version: () => require(VIBE_LAUNCHER).vibeVersion() },
});

class SuiteError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function fail(code, message) {
  throw new SuiteError(code, message);
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Writes through a temporary file and a rename, so an interruption leaves the earlier record or none, never a partial one that every
// later resume would fail to parse.
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n');
    fs.renameSync(temporary, file);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

// Every regular file below root as a sorted list of forward-slash relative paths.
// Every entry under root that is neither a regular file nor a directory, such as a symbolic link or junction.
function linkedEntries(root) {
  const entries = [];
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (!entry.isFile()) entries.push(path.relative(root, full).split(path.sep).join('/'));
    }
  };
  if (fs.existsSync(root)) walk(root);

  return entries.sort();
}

function listFiles(root) {
  const files = [];
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push(path.relative(root, full).split(path.sep).join('/'));
    }
  };
  if (fs.existsSync(root)) walk(root);

  return files.sort();
}

// One hash over the relative path and content of every file in the given roots, in a stable order.
function treeHash(entries) {
  const hash = crypto.createHash('sha256');
  for (const { label, root } of entries) {
    for (const file of listFiles(root)) {
      hash.update(`${label}/${file}\0`);
      hash.update(fs.readFileSync(path.join(root, file)));
      hash.update('\0');
    }
  }

  return hash.digest('hex');
}

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, windowsHide: true, encoding: 'utf8' });
  if (result.status !== 0) fail('git-failed', `git ${args.join(' ')} failed: ${result.stderr || result.stdout || result.error?.message}`);

  return result.stdout.trim();
}

// ---------------------------------------------------------------------------------------------------------------------------
// Fixture loading

function isRange(lines) {
  return Array.isArray(lines) && lines.length === 2 && lines.every(Number.isSafeInteger) && lines[0] >= 1 && lines[0] <= lines[1];
}

function validateEntry(entry, kind, name, trees) {
  const where = `${name}: ${kind} ${entry?.id ?? '(no id)'}`;
  for (const field of ['id', 'dimension', 'file', 'severity', 'consequence', 'origin']) {
    if (typeof entry?.[field] !== 'string' || !entry[field].trim()) fail('fixture-invalid', `${where} is missing ${field}`);
  }
  if (!isRange(entry.lines)) fail('fixture-invalid', `${where} needs lines as [first, last]`);
  if (entry.symbol !== undefined && (typeof entry.symbol !== 'string' || !entry.symbol.trim())) fail('fixture-invalid', `${where} has an empty symbol`);
  if (!CODE_DIMENSIONS.includes(entry.dimension)) fail('fixture-invalid', `${where} names unknown dimension ${entry.dimension}`);
  if (!SEVERITIES.includes(entry.severity)) fail('fixture-invalid', `${where} has unknown severity ${entry.severity}`);
  const adjudicated = ADJUDICATED_ORIGIN.test(entry.origin);
  if (kind === 'incidental' && !adjudicated) fail('fixture-invalid', `${where} must have origin adjudicated:<run folder name>`);
  if (kind !== 'incidental' && adjudicated) fail('fixture-invalid', `${where} uses an adjudicated origin outside incidental`);
  const located = trees.change.has(entry.file) ? 'change' : trees.base.has(entry.file) ? 'base' : null;
  if (!located) fail('fixture-invalid', `${where} names ${entry.file}, which neither tree holds`);
}

function originKind(origin) {
  if (origin === 'synthetic') return 'synthetic';
  if (RECEIPT_ORIGIN.test(origin)) return 'fresh-gate';
  if (ADJUDICATED_ORIGIN.test(origin)) return 'adjudicated';

  return 'bug';
}

function overlaps(a, b) {
  if (a.file !== b.file) return false;
  if (a.symbol && b.symbol && a.symbol === b.symbol) return true;

  return a.lines[0] - LINE_SLACK <= b.lines[1] + LINE_SLACK && b.lines[0] - LINE_SLACK <= a.lines[1] + LINE_SLACK;
}

function containsToken(text) {
  return CONTAMINATION_TOKENS.find(token => text.includes(token)) ?? null;
}

// Loads and validates one fixture directory; the returned object carries the parsed truth and the tree file lists.
function loadFixture(directory) {
  const name = path.basename(directory);
  const file = path.join(directory, 'fixture.json');
  if (!fs.existsSync(file)) fail('fixture-invalid', `${name}: fixture.json is missing`);
  let fixture;
  try {
    fixture = readJson(file);
  } catch (error) {
    fail('fixture-invalid', `${name}: fixture.json does not parse: ${error.message}`);
  }
  const base = listFiles(path.join(directory, 'base'));
  const change = listFiles(path.join(directory, 'change'));
  if (!base.length) fail('fixture-invalid', `${name}: base/ holds no files`);
  const deletions = fixture.deletions ?? [];
  if (!Array.isArray(deletions) || deletions.some(item => !base.includes(item))) fail('fixture-invalid', `${name}: every deletion must name a base/ file`);
  // A base file the change deletes is still committed in the base, where it can hide others, so every file of both trees is checked.
  for (const item of new Set([...base, ...change])) {
    // Compared without case, since the verified Windows filesystem resolves .GIT and .Gitignore to the same entries.
    const folded = item.toLowerCase();
    if (path.posix.basename(folded) === '.gitignore' || HIDDEN_PREFIXES.some(prefix => folded.startsWith(prefix))) fail('fixture-invalid', `${name}: ${item} would be hidden from the reviewer`);
    // Materialization copies the trees over a configured repository, so a .git path could replace its configuration and run commands.
    if (folded.split('/').includes('.git')) fail('fixture-invalid', `${name}: ${item} lies in a .git folder`);
  }
  // listFiles sees regular files only, while copying would carry a link through unchecked.
  const linked = ['base', 'change'].flatMap(tree => linkedEntries(path.join(directory, tree)).map(item => `${tree}/${item}`));
  if (linked.length) fail('fixture-invalid', `${name}: ${linked.join(', ')} is a link or special file`);
  if (typeof fixture.requirements !== 'string' || !fixture.requirements.trim()) fail('fixture-invalid', `${name}: requirements are missing`);
  if (typeof fixture.audited !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fixture.audited)) fail('fixture-invalid', `${name}: audited must be a YYYY-MM-DD date`);
  for (const list of ['defects', 'outOfScope', 'incidental', 'decoys']) {
    if (fixture[list] === undefined) fixture[list] = [];
    if (!Array.isArray(fixture[list])) fail('fixture-invalid', `${name}: ${list} must be a list`);
  }
  const trees = { base: new Set(base.filter(item => !deletions.includes(item))), change: new Set(change) };
  const truth = [];
  for (const [kind, list] of [['defect', fixture.defects], ['outOfScope', fixture.outOfScope], ['incidental', fixture.incidental]]) {
    for (const entry of list) {
      validateEntry(entry, kind, name, trees);
      truth.push({ ...entry, kind });
    }
  }
  const ids = truth.map(entry => entry.id);
  if (new Set(ids).size !== ids.length) fail('fixture-invalid', `${name}: truth entry ids repeat`);
  for (let i = 0; i < truth.length; i++) {
    for (let j = i + 1; j < truth.length; j++) {
      if (overlaps(truth[i], truth[j])) fail('fixture-invalid', `${name}: truth entries ${truth[i].id} and ${truth[j].id} overlap`);
    }
  }
  for (const decoy of fixture.decoys) {
    for (const field of ['severity', 'consequence', 'evidence', 'reason']) {
      if (typeof decoy?.[field] !== 'string' || !decoy[field].trim()) fail('fixture-invalid', `${name}: a decoy is missing ${field}`);
    }
    if (!SEVERITIES.includes(decoy.severity) || typeof decoy.required !== 'boolean') fail('fixture-invalid', `${name}: a decoy needs a known severity and a boolean required`);
  }
  const texts = [fixture.requirements, ...fixture.decoys.flatMap(decoy => [decoy.severity, decoy.consequence, decoy.evidence, decoy.reason])];
  for (const text of texts) {
    const token = containsToken(text);
    if (token) fail('fixture-contaminated', `${name}: supplied text contains ${token}`);
  }
  for (const [tree, files] of [['base', base], ['change', change]]) {
    for (const item of files) {
      const token = containsToken(item) ?? containsToken(fs.readFileSync(path.join(directory, tree, item), 'utf8'));
      if (token) fail('fixture-contaminated', `${name}: ${tree}/${item} contains ${token}`);
    }
  }

  return { name, directory, fixture, truth, clean: fixture.defects.length === 0 && fixture.incidental.length === 0 };
}

// The entry titles of the checkout's bug index and its history, a linked title read as its text.
function bugEntryTitles() {
  const titles = new Set();
  for (const file of ['BUGS.md', 'BUGS_HISTORY.md']) {
    const location = path.join(PLUGIN_ROOT, '.nightshift', file);
    if (!fs.existsSync(location)) continue;
    for (const line of fs.readFileSync(location, 'utf8').split(/\r?\n/)) {
      // Entries are third-level headings in both files; second-level headings are sections such as Current.
      const match = /^### (.+)$/.exec(line);
      if (match) titles.add(match[1].replace(/^\[(.+)\]\([^)]*\)$/, '$1').trim());
    }
  }

  return titles;
}

// The composition rules of the spec's Fixtures section, checked when a run selects the whole suite. Returns the unmet rules.
function compositionProblems(fixtures, bugTitles = bugEntryTitles()) {
  const problems = [];
  const planted = fixtures.flatMap(item => item.fixture.defects);
  // A bug origin counts toward the real-source quota only when it names an entry, so a mistyped title cannot satisfy it.
  for (const defect of planted.filter(item => originKind(item.origin) === 'bug' && !bugTitles.has(item.origin))) problems.push(`origin "${defect.origin}" names no BUGS.md or BUGS_HISTORY.md entry`);
  const origins = planted.map(defect => originKind(defect.origin));
  const real = origins.filter(kind => kind === 'bug' || kind === 'fresh-gate').length;
  if (real * 2 < planted.length) problems.push('at least half of the planted defects must have a real origin');
  if (origins.filter(kind => kind === 'bug').length < 2) problems.push('at least two planted defects must come from bug entries');
  if (origins.filter(kind => kind === 'fresh-gate').length < 2) problems.push('at least two planted defects must come from fresh-gate catches');
  for (const dimension of CODE_DIMENSIONS) {
    if (!planted.some(defect => defect.dimension === dimension)) problems.push(`no planted defect covers ${dimension}`);
  }
  if (fixtures.filter(item => item.clean).length < 3) problems.push('at least three clean fixtures are required');
  if (fixtures.filter(item => item.fixture.outOfScope.length > 0).length < 2) problems.push('at least two fixtures need an out-of-scope true finding');
  const siblings = fixtures.filter(item => item.fixture.defects.some(defect => !listFiles(path.join(item.directory, 'change')).includes(defect.file)));
  if (siblings.length < 2) problems.push('at least two fixtures need a defect in a sibling path the change leaves untouched');
  for (const item of fixtures) {
    if (item.fixture.defects.length > 0 && item.fixture.decoys.length === 0) problems.push(`${item.name} has defects but no decoy`);
  }

  return problems;
}

function loadSuite(fixturesDirectory, selected = []) {
  const names = fs.readdirSync(fixturesDirectory, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  // A fixture name opens every fixture run key, so like a model id it may not hold the '__' that separates the key's parts.
  for (const name of names.filter(item => !MODEL_NAME.test(item))) fail('fixture-invalid', `${name}: a fixture name must be letters, digits, '.', '_' or '-' without '__'`);
  for (const name of selected) {
    if (!names.includes(name)) fail('fixture-missing', `No fixture named ${name}`);
  }
  const chosen = selected.length ? [...new Set(selected)].sort() : names;
  const fixtures = chosen.map(name => loadFixture(path.join(fixturesDirectory, name)));
  const whole = selected.length === 0;
  if (whole) {
    const problems = compositionProblems(fixtures);
    if (problems.length) fail('composition-unmet', `The suite does not meet its composition rules: ${problems.join('; ')}`);
  }

  return { fixtures, whole };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Identity

// The review machinery hash: every module Node has loaded under the plugin root once internal/runtime/review.js is required.
function machineryHash() {
  require(path.join(PLUGIN_ROOT, 'internal/runtime/review.js'));
  const modules = Object.keys(require.cache).filter(file => file.startsWith(path.join(PLUGIN_ROOT, 'internal') + path.sep)).sort();
  const hash = crypto.createHash('sha256');
  for (const file of modules) {
    hash.update(path.relative(PLUGIN_ROOT, file).split(path.sep).join('/') + '\0');
    hash.update(fs.readFileSync(file));
    hash.update('\0');
  }

  return hash.digest('hex');
}

// The harness and its evaluation launchers, which decide how an evaluated host is dispatched.
function harnessHash() {
  return sha256(Buffer.concat([fs.readFileSync(__filename), Buffer.from('\0'), fs.readFileSync(VIBE_LAUNCHER)]));
}

function checkoutCommit() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: PLUGIN_ROOT, windowsHide: true, encoding: 'utf8' });

  return result.status === 0 ? result.stdout.trim() : null;
}

function hostVersion(host) {
  if (Object.hasOwn(EVALUATION_HOSTS, host)) return EVALUATION_HOSTS[host].version();
  try {
    const { executable } = require(path.join(PLUGIN_ROOT, 'internal/runtime/hosts.js'));
    const result = spawnSync(executable(host, PLUGIN_ROOT), ['--version'], { windowsHide: true, encoding: 'utf8', timeout: 30000 });

    return result.status === 0 ? result.stdout.trim() : null;
  } catch {
    // An executable that cannot be resolved or run leaves the informational version unknown.
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// Run folder layout

function fixtureRunKey(fixture, model, repetition) {
  const skeptic = model.skeptic ? `__s-${model.skeptic.host}-${model.skeptic.id}` : '';

  return `${fixture}__${model.host}-${model.id}${skeptic}__r${repetition}`;
}

// A model names its lead and, when they differ, the skeptic model that checks that lead's findings.
function modelLabel(model) {
  return `${model.host}:${model.id}${model.skeptic ? `@${model.skeptic.host}:${model.skeptic.id}` : ''}`;
}

function stageModel(model, stage) {
  return stage === 'skeptic' && model.skeptic ? model.skeptic : model;
}

function runPaths(runFolder, key) {
  const root = path.join(runFolder, 'runs', key);

  return {
    root,
    intent: stage => path.join(root, `${stage}.intent.json`),
    result: stage => path.join(root, `${stage}.result.json`),
    artifacts: stage => path.join(root, stage),
    claims: path.join(root, 'claims.json'),
    complete: path.join(root, 'complete.json'),
    superseded: path.join(root, 'superseded'),
  };
}

function frozenFixture(runFolder, name) {
  return path.join(runFolder, 'frozen', name);
}

// Reads the manifest of an existing run folder, which a resumed run follows without consulting the source fixtures.
function resumedManifest(options) {
  const manifest = readJson(path.join(options.out, 'manifest.json'));
  const selected = [...new Set(options.selected ?? [])].sort();
  const sameFixtures = selected.length ? !manifest.whole && JSON.stringify(manifest.fixtures) === JSON.stringify(selected) : manifest.whole;
  const same = JSON.stringify(manifest.models) === JSON.stringify(options.models) && manifest.repeat === options.repeat && sameFixtures;
  if (!same) fail('run-folder-mismatch', 'The run folder was started with other fixtures, models or repetitions; use a new run folder');
  verifyFrozen(options.out, manifest);

  return manifest;
}

// The frozen copy and rules.md must still match the hashes the manifest recorded, so every dispatch reviews, and grading reads, the
// project state and truth the run started with.
function verifyFrozen(runFolder, manifest) {
  if (fixtureSetHash(runFolder, manifest.fixtures) !== manifest.fixtureSetHash) fail('run-folder-altered', `${runFolder}: the frozen fixtures no longer match the manifest's fixture set hash`);
  if (sha256(fs.readFileSync(path.join(runFolder, 'rules.md'))) !== manifest.rulesHash) fail('run-folder-altered', `${runFolder}: rules.md no longer matches the manifest's rules hash`);
}

// Copies the selected fixtures and rules.md into a new run folder and writes its manifest.
function prepareRunFolder(options, suite) {
  const manifestFile = path.join(options.out, 'manifest.json');
  for (const item of suite.fixtures) fs.cpSync(item.directory, frozenFixture(options.out, item.name), { recursive: true });
  fs.copyFileSync(options.rules, path.join(options.out, 'rules.md'));
  const manifest = {
    created: new Date().toISOString(),
    fixtures: suite.fixtures.map(item => item.name),
    whole: suite.whole,
    models: options.models,
    repeat: options.repeat,
    seed: options.seed ?? crypto.randomInt(1, 2 ** 31),
    fixtureSetHash: fixtureSetHash(options.out, suite.fixtures.map(item => item.name)),
    rulesHash: sha256(fs.readFileSync(path.join(options.out, 'rules.md'))),
    hostVersions: Object.fromEntries([...new Set(options.models.flatMap(model => [model.host, model.skeptic?.host].filter(Boolean)))].map(host => [host, options.hostVersion(host)])),
  };
  writeJson(manifestFile, manifest);

  return manifest;
}

function fixtureSetHash(runFolder, names) {
  return treeHash(names.map(name => ({ label: name, root: frozenFixture(runFolder, name) })));
}

// ---------------------------------------------------------------------------------------------------------------------------
// Materialization

// Builds a fixture repository whose committed bytes and diff this machine's Git configuration cannot alter. The settings live in
// the repository's own configuration, so the runtime's Git commands inherit them: line-ending conversion is off, and hooks point at
// a folder that does not exist, since the fixture repository is scratch, not the user's work.
function materialize(frozen, fixture) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), REPOSITORY_PREFIX)));
  try {
    git(root, ['init', '--quiet']);
    for (const [key, value] of [['core.autocrlf', 'false'], ['core.safecrlf', 'false'], ['core.hooksPath', path.join(root, '.git', 'no-hooks')]]) git(root, ['config', key, value]);
    // A random token the intent records, so cleanup can tell this repository from any other path of the same shape.
    const owner = crypto.randomUUID();
    fs.writeFileSync(path.join(root, '.git', OWNER_FILE), owner);
    fs.cpSync(path.join(frozen, 'base'), root, { recursive: true });
    git(root, ['add', '--all']);
    const staged = new Set(git(root, ['ls-files', '-z', '--cached']).split('\0').filter(Boolean));
    const unstaged = listFiles(path.join(frozen, 'base')).filter(item => !staged.has(item));
    if (unstaged.length) fail('fixture-hidden', `${path.basename(frozen)}: ${unstaged.join(', ')} would be hidden from the reviewer by this machine's Git configuration`);
    git(root, [...FIXTURE_AUTHOR, 'commit', '--quiet', '-m', 'base']);
    const baseSha = git(root, ['rev-parse', 'HEAD']);
    if (fs.existsSync(path.join(frozen, 'change'))) fs.cpSync(path.join(frozen, 'change'), root, { recursive: true });
    for (const deletion of fixture.deletions ?? []) fs.rmSync(path.join(root, deletion), { force: true });
    const inventory = new Set(git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean));
    const deletions = fixture.deletions ?? [];
    const expected = [...listFiles(path.join(frozen, 'base')).filter(item => !deletions.includes(item)), ...listFiles(path.join(frozen, 'change'))];
    const missing = expected.filter(item => !inventory.has(item));
    if (missing.length) fail('fixture-hidden', `${path.basename(frozen)}: ${missing.join(', ')} would be hidden from the reviewer by this machine's Git configuration`);

    return { root, baseSha, owner };
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// Accounting

function dispatchTokens(record) {
  if (record.estimated !== undefined) return record.estimated;
  if (record.attemptTokens.some(value => value === null)) return null;

  return record.attemptTokens.reduce((sum, value) => sum + value, 0);
}

// Every result record in the run folder, superseded ones included, since their tokens were spent.
function allResults(runFolder) {
  const results = [];
  const runsRoot = path.join(runFolder, 'runs');
  for (const file of listFiles(runsRoot)) {
    if (/(^|\/)(lead|skeptic)\.result\.json$/.test(file)) results.push(readJson(path.join(runsRoot, file)));
  }

  return results;
}

function spending(runFolder) {
  const results = allResults(runFolder);
  const amounts = results.map(dispatchTokens);
  const actual = results.filter(record => record.estimated === undefined).map(dispatchTokens).filter(value => value !== null);

  return {
    spent: amounts.filter(value => value !== null).reduce((sum, value) => sum + value, 0),
    unknown: amounts.some(value => value === null),
    estimated: results.some(record => record.estimated !== undefined),
    // The largest single dispatch actually recorded, or the initial reserve before any dispatch has spent tokens.
    reserve: Math.max(0, ...actual) || INITIAL_RESERVE,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Seeded shuffle

function generator(seed) {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);

    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFor(manifestSeed, key) {
  return (manifestSeed ^ parseInt(sha256(key).slice(0, 8), 16)) >>> 0;
}

function shuffledClaims(leadFindings, decoys, seed) {
  const items = [...leadFindings.map(finding => ({ source: 'lead', sourceId: finding.id, finding })), ...decoys.map((decoy, index) => ({ source: 'decoy', sourceId: `decoy-${index + 1}`, finding: decoy }))];
  const random = generator(seed);
  for (let index = items.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [items[index], items[other]] = [items[other], items[index]];
  }

  return items.map((item, index) => ({ id: `F${index + 1}`, source: item.source, sourceId: item.sourceId, claim: { id: `F${index + 1}`, severity: item.finding.severity, required: item.finding.required, consequence: item.finding.consequence, evidence: item.finding.evidence } }));
}

// ---------------------------------------------------------------------------------------------------------------------------
// Dispatch

function reviewsDirectory(repository, requestId) {
  return path.join(repository, '.nightshift/runs/reviews', requestId);
}

function attemptsOf(directory) {
  for (const file of ['receipt.json', 'failure.json']) {
    const full = path.join(directory, file);
    if (fs.existsSync(full)) {
      try {
        return readJson(full).attempts ?? [];
      } catch {
        // An unreadable record yields no attempts; the caller treats the stage as lost when nothing else is known.
        return null;
      }
    }
  }

  return null;
}

// Whether the runtime started an attempt in this dispatch's directory, which it names attempt-1 onward as each candidate begins.
function hasAttemptFolder(directory) {
  return fs.existsSync(directory) && fs.readdirSync(directory, { withFileTypes: true }).some(entry => entry.isDirectory() && /^attempt-\d+$/.test(entry.name));
}

// Builds a result record from what the runtime left in the dispatch's directory, copying its artifacts into the run folder.
function recordOutcome(paths, stage, intent, error, elapsedMs, identity) {
  const source = reviewsDirectory(intent.repository, intent.requestId);
  const target = paths.artifacts(stage);
  if (fs.existsSync(source)) fs.cpSync(source, target, { recursive: true });
  const receiptFile = path.join(target, 'receipt.json');
  const failureFile = path.join(target, 'failure.json');
  const attempts = attemptsOf(target);
  const record = { stage, requestId: intent.requestId, elapsedMs, identity };
  if (fs.existsSync(receiptFile)) {
    const receipt = readJson(receiptFile);
    Object.assign(record, { outcome: 'complete', reportStatus: receipt.status, attemptTokens: receipt.attempts.map(attempt => attempt.tokens ?? null) });
  } else if (fs.existsSync(failureFile)) {
    const failure = readJson(failureFile);
    Object.assign(record, { outcome: 'failed', code: failure.code ?? error?.code ?? null, message: error?.message ?? null, attemptTokens: (failure.attempts ?? []).map(attempt => attempt.tokens ?? null) });
  } else if (error && hasAttemptFolder(target)) {
    // An attempt began, so a host may have spent tokens even though failure.json is missing, as when writing it failed; the spending
    // is unknown, which stops the run before the next dispatch.
    Object.assign(record, { outcome: 'failed', code: error.code ?? null, message: error.message, attemptTokens: [null] });
  } else if (error) {
    // No attempt folder exists, so the failure came before any host launched and spent nothing.
    Object.assign(record, { outcome: 'failed', code: error.code ?? null, message: error.message, attemptTokens: [], prelaunch: true });
  } else {
    Object.assign(record, { outcome: 'lost', attemptTokens: [] });
  }
  if (attempts === null && record.outcome !== 'lost' && !record.prelaunch && record.attemptTokens.length === 0) record.attemptTokens = [null];
  record.unproven = record.code === 'termination-unverified';

  return record;
}

function stageOptions(stage, item, frozen, manifestRules, repository, model, requestId, claims) {
  const candidate = EVALUATION_HOSTS[model.host]?.gate ?? { host: model.host, model: model.id };
  const common = { id: requestId, baseSha: repository.baseSha, requirements: item.fixture.requirements, rules: manifestRules, candidates: [{ ...candidate, effort: EFFORT }] };

  return stage === 'lead' ? { ...common, kind: 'code' } : { ...common, kind: 'skeptic', findings: claims.map(claim => claim.claim) };
}

// For an evaluated host, the dispatch's agent runner is that host's launcher, or an injected runner, given the evaluated model.
function dispatchDependencies(dependencies, model) {
  const base = dependencies.dispatchDependencies ?? {};
  const evaluation = EVALUATION_HOSTS[model.host];
  if (!evaluation) return base;
  const runAgent = base.runAgent ?? evaluation.launcher();

  return { ...base, runAgent: options => runAgent({ ...options, host: model.host, model: model.id }) };
}

class StopRun extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

async function dispatchStage(context, runItem, stage, claims) {
  const { runFolder, dependencies, budget } = context;
  const paths = runPaths(runFolder, runItem.key);
  const money = spending(runFolder);
  if (money.unknown) throw new StopRun('Spending is unknown because an attempt recorded no tokens');
  if (money.spent + money.reserve > budget) throw new StopRun(`The budget of ${budget} tokens leaves no room for another dispatch (spent ${money.spent}, reserve ${money.reserve})`);
  const frozen = frozenFixture(runFolder, runItem.fixture.name);
  let repository;
  try {
    repository = dependencies.materialize(frozen, runItem.fixture.fixture);
  } catch (error) {
    // A fixture error stops the run before this dispatch's intent exists, so nothing is left to reconcile.
    if (error instanceof SuiteError) throw new StopRun(error.message);
    throw error;
  }
  const requestId = crypto.randomUUID();
  const model = stageModel(runItem.model, stage);
  const identity = { machinery: context.identity.machinery, harness: context.identity.harness, commit: context.identity.commit, hostVersion: context.hostVersions[model.host] ?? null };
  // The intent keeps the dispatch's identity, so a reconciliation after a code change still records what dispatched it.
  const intent = { stage, requestId, repository: repository.root, owner: repository.owner, started: new Date().toISOString(), identity };
  writeJson(paths.intent(stage), intent);
  const rules = fs.readFileSync(path.join(runFolder, 'rules.md'), 'utf8');
  const started = Date.now();
  let error = null;
  try {
    await dependencies.dispatchReview(repository.root, stageOptions(stage, runItem.fixture, frozen, rules, repository, model, requestId, claims), dispatchDependencies(dependencies, model));
  } catch (caught) {
    error = caught;
  }
  const record = recordOutcome(paths, stage, intent, error, Date.now() - started, identity);
  settleStage(context, runItem, stage, intent, record);
  if (record.attemptTokens.some(value => value === null)) throw new StopRun(`An attempt of ${runItem.key} ${stage} recorded no tokens`);

  return record;
}

// Whether the user has confirmed, by --termination-checked, that the host of this dispatch has ended.
function terminationConfirmed(runFolder, requestId) {
  const folder = path.join(runFolder, 'termination-checked');

  return fs.existsSync(folder) && fs.readdirSync(folder).some(file => readJson(path.join(folder, file)).requestId === requestId);
}

// Writes a stage's result and marks its intent done, from a dispatch or a reconciliation alike. Unproven host termination is blocked
// before the result is written, so an interruption anywhere leaves either the blocking record or a pending intent whose
// reconciliation blocks again, until the user confirms the host has ended; the repository is then kept for inspection.
function settleStage(context, runItem, stage, intent, record) {
  const paths = runPaths(context.runFolder, runItem.key);
  const model = stageModel(runItem.model, stage);
  const evaluation = EVALUATION_HOSTS[model.host];
  if (evaluation) record.evaluation = { host: model.host, model: model.id, gateCandidate: evaluation.gate };
  const blocked = record.unproven && !terminationConfirmed(context.runFolder, intent.requestId);
  if (blocked) writeJson(path.join(context.runFolder, 'blocking.json'), { fixtureRun: runItem.key, stage, requestId: intent.requestId, repository: intent.repository, recorded: new Date().toISOString() });
  writeJson(paths.result(stage), record);
  intent.done = true;
  writeJson(paths.intent(stage), intent);
  if (blocked) throw new StopRun(`Host termination is unproven for ${runItem.key} ${stage}; its repository is kept at ${intent.repository}`);
  if (!record.unproven && ownedRepository(intent.repository, intent.owner)) fs.rmSync(intent.repository, { recursive: true, force: true });
}

// Whether a path is the dispatch repository this intent materialized: directly under the temporary directory with the harness's
// prefix, and holding the owner token the intent recorded. A saved intent is data, so its path is never deleted on trust.
function ownedRepository(repository, owner) {
  if (typeof repository !== 'string' || typeof owner !== 'string' || !owner || !fs.existsSync(repository)) return false;
  const real = fs.realpathSync.native(repository);
  if (path.dirname(real) !== fs.realpathSync.native(os.tmpdir()) || !path.basename(real).startsWith(REPOSITORY_PREFIX)) return false;
  const marker = path.join(real, '.git', OWNER_FILE);

  return fs.existsSync(marker) && fs.readFileSync(marker, 'utf8') === owner;
}

// Reconciles an intent that was never marked done, from the repository it names.
function reconcileIntent(context, runItem, stage) {
  const paths = runPaths(context.runFolder, runItem.key);
  const intent = readJson(paths.intent(stage));
  const directory = reviewsDirectory(intent.repository, intent.requestId);
  const found = fs.existsSync(path.join(directory, 'receipt.json')) || fs.existsSync(path.join(directory, 'failure.json'));
  const identity = intent.identity;
  if (!identity) fail('intent-unidentified', `${runItem.key} ${stage}: the pending intent records no dispatch identity, so its outcome cannot be attributed`);
  let record;
  if (found) {
    record = recordOutcome(paths, stage, intent, null, null, identity);
  } else {
    const money = spending(context.runFolder);
    record = { stage, requestId: intent.requestId, outcome: 'lost', attemptTokens: [], estimated: money.reserve, elapsedMs: null, identity };
  }
  settleStage(context, runItem, stage, intent, record);

  return record;
}

function stageState(paths, stage) {
  if (!fs.existsSync(paths.intent(stage))) return 'none';
  const intent = readJson(paths.intent(stage));

  return intent.done && fs.existsSync(paths.result(stage)) ? 'done' : 'pending';
}

function leadReceipt(paths) {
  const file = path.join(paths.artifacts('lead'), 'receipt.json');

  return fs.existsSync(file) ? readJson(file) : null;
}

// The stages a fixture run requires, given its lead's result.
function requiredStages(paths, runItem) {
  const lead = fs.existsSync(paths.result('lead')) ? readJson(paths.result('lead')) : null;
  if (!lead) return ['lead'];
  if (lead.outcome !== 'complete' || lead.reportStatus !== 'complete') return ['lead'];
  const receipt = leadReceipt(paths);
  const claims = (receipt?.findings ?? []).length + runItem.fixture.fixture.decoys.length;

  return claims > 0 ? ['lead', 'skeptic'] : ['lead'];
}

function stageIncomplete(paths, stage) {
  if (!fs.existsSync(paths.result(stage))) return false;
  const record = readJson(paths.result(stage));

  return record.outcome !== 'complete' || record.reportStatus !== 'complete';
}

function retryCause(paths, stage) {
  if (stage === 'lead' && fs.existsSync(paths.result('lead')) && !stageIncomplete(paths, 'lead')) return 'contamination';
  const record = fs.existsSync(paths.result(stage)) ? readJson(paths.result(stage)) : null;
  if (!record || record.outcome === 'lost') return 'lost-outcome';
  if (record.outcome === 'failed') return 'known-failure';

  return 'incomplete-report';
}

function supersede(paths, stages, cause) {
  const target = path.join(paths.superseded, new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(target, { recursive: true });
  const retried = stages.filter(stage => fs.existsSync(paths.intent(stage)) || fs.existsSync(paths.result(stage)));
  writeJson(path.join(target, 'moving.json'), { stages, retried, cause });
  completeSupersession(paths, target);
}

// Moves a supersession's files and only then records its cause, so a folder still holding moving.json is an interrupted move, which the
// next pass over the fixture run finishes before it reads any stage; a stage left half moved would otherwise dispatch over a result
// whose tokens were never superseded.
function completeSupersession(paths, target) {
  const { stages, retried, cause } = readJson(path.join(target, 'moving.json'));
  const files = [paths.complete, ...stages.flatMap(stage => [paths.intent(stage), paths.result(stage), paths.artifacts(stage)]), ...(stages.includes('skeptic') ? [paths.claims] : [])];
  for (const file of files) {
    if (fs.existsSync(file)) fs.renameSync(file, path.join(target, path.basename(file)));
  }
  writeJson(path.join(target, 'cause.json'), { stage: stages[0], stages: retried, cause });
  fs.rmSync(path.join(target, 'moving.json'));
}

function finishInterruptedSupersessions(paths) {
  if (!fs.existsSync(paths.superseded)) return;
  for (const entry of fs.readdirSync(paths.superseded)) {
    const target = path.join(paths.superseded, entry);
    if (fs.existsSync(path.join(target, 'moving.json'))) completeSupersession(paths, target);
  }
}

function contaminated(paths) {
  for (const stage of ['lead', 'skeptic']) {
    const directory = paths.artifacts(stage);
    for (const file of listFiles(directory).filter(item => item.endsWith('events.jsonl'))) {
      if (containsToken(fs.readFileSync(path.join(directory, file), 'utf8'))) return true;
    }
  }

  return false;
}

// Applies --retry to one fixture run: every incomplete stage, and a contaminated run's lead, is superseded so it runs again.
function applyRetry(paths) {
  if (stageIncomplete(paths, 'lead') || (fs.existsSync(paths.result('lead')) && contaminated(paths))) {
    supersede(paths, ['lead', 'skeptic'], retryCause(paths, 'lead'));

    return;
  }
  if (stageIncomplete(paths, 'skeptic')) supersede(paths, ['skeptic'], retryCause(paths, 'skeptic'));
}

// Retried stages per cause, read from the cause records that supersession leaves.
function retryCounts(runFolder, key) {
  const counts = {};
  const folder = runPaths(runFolder, key).superseded;
  if (!fs.existsSync(folder)) return counts;
  for (const entry of fs.readdirSync(folder)) {
    const file = path.join(folder, entry, 'cause.json');
    if (!fs.existsSync(file)) continue;
    const { cause, stages } = readJson(file);
    // One supersession can retry both stages; a record from before stages were listed counts as one.
    counts[cause] = (counts[cause] ?? 0) + (stages?.length ?? 1);
  }

  return counts;
}

async function runFixture(context, runItem) {
  const paths = runPaths(context.runFolder, runItem.key);
  fs.mkdirSync(paths.root, { recursive: true });
  finishInterruptedSupersessions(paths);
  // Pending intents are reconciled before --retry looks at the results, so an outcome found lost now is retried in this same pass.
  for (const stage of ['lead', 'skeptic']) {
    if (stageState(paths, stage) === 'pending') reconcileIntent(context, runItem, stage);
  }
  if (context.retry) applyRetry(paths);
  if (fs.existsSync(paths.complete)) return;
  for (const stage of ['lead', 'skeptic']) {
    if (!requiredStages(paths, runItem).includes(stage)) continue;
    const state = stageState(paths, stage);
    if (state === 'pending') reconcileIntent(context, runItem, stage);
    if (state !== 'none') continue;
    let claims = null;
    if (stage === 'skeptic') {
      const receipt = leadReceipt(paths);
      claims = shuffledClaims(receipt?.findings ?? [], runItem.fixture.fixture.decoys, seedFor(context.manifest.seed, runItem.key));
      writeJson(paths.claims, { seed: seedFor(context.manifest.seed, runItem.key), claims });
    }
    await dispatchStage(context, runItem, stage, claims);
  }
  writeJson(paths.complete, { stages: requiredStages(paths, runItem), completed: new Date().toISOString() });
}

function defaultDependencies() {
  const { dispatchReview } = require(path.join(PLUGIN_ROOT, 'internal/runtime/review.js'));

  return { dispatchReview, materialize, hostVersion };
}

async function run(options, dependencies = defaultDependencies()) {
  if (!Number.isSafeInteger(options.budget) || options.budget <= 0) fail('budget-missing', 'A run needs --budget <tokens>');
  validateModels(options.models);
  // A resumed run reads only its frozen copy, so later edits to the source fixtures or rules cannot refuse or alter it.
  const resuming = fs.existsSync(path.join(options.out, 'manifest.json'));
  let suite = null;
  if (!resuming) {
    // A folder without a manifest but with content is an interrupted start or something else entirely; copying over it could keep
    // files a source fixture has since dropped, so the run refuses it rather than clearing it.
    if (fs.existsSync(options.out) && fs.readdirSync(options.out).length) fail('run-folder-unfinished', `${options.out} holds files but no manifest; remove it or use a new run folder`);
    suite = loadSuite(options.fixtures, options.selected ?? []);
    const token = containsToken(fs.readFileSync(options.rules, 'utf8'));
    if (token) fail('fixture-contaminated', `rules.md contains ${token}`);
  }
  fs.mkdirSync(options.out, { recursive: true });
  const blockingFile = path.join(options.out, 'blocking.json');
  if (fs.existsSync(blockingFile)) {
    if (!options.terminationChecked) fail('run-blocked', `The run is blocked by unproven host termination recorded in ${blockingFile}; pass --termination-checked once the host process has ended`);
    const checked = path.join(options.out, 'termination-checked');
    fs.mkdirSync(checked, { recursive: true });
    fs.renameSync(blockingFile, path.join(checked, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`));
  }
  const manifest = resuming ? resumedManifest(options) : prepareRunFolder({ ...options, hostVersion: dependencies.hostVersion }, suite);
  // A host can update itself between invocations, so a resumed run records the versions it finds now, not those of the run's start.
  const hostVersions = resuming ? Object.fromEntries(Object.keys(manifest.hostVersions).map(host => [host, dependencies.hostVersion(host)])) : manifest.hostVersions;
  const context = {
    runFolder: options.out, manifest, dependencies, budget: options.budget, retry: Boolean(options.retry), hostVersions,
    identity: { machinery: dependencies.machineryHash?.() ?? machineryHash(), harness: harnessHash(), commit: dependencies.commit?.() ?? checkoutCommit() },
  };
  const frozenSuite = manifest.fixtures.map(name => loadFixture(frozenFixture(options.out, name)));
  // Preflight: every fixture materializes once before any dispatch, so a fixture error refuses the run instead of stopping it midway.
  for (const fixture of frozenSuite) {
    const repository = dependencies.materialize(frozenFixture(options.out, fixture.name), fixture.fixture);
    fs.rmSync(repository.root, { recursive: true, force: true });
  }
  const items = [];
  for (const fixture of frozenSuite) {
    for (const model of manifest.models) {
      for (let repetition = 1; repetition <= manifest.repeat; repetition++) items.push({ fixture, model, repetition, key: fixtureRunKey(fixture.name, model, repetition) });
    }
  }
  let stopped = null;
  for (const item of items) {
    try {
      await runFixture(context, item);
    } catch (error) {
      if (!(error instanceof StopRun)) throw error;
      stopped = error.reason;
      break;
    }
  }

  return { stopped, spending: spending(options.out), fixtureRuns: items.length };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Grading

// The line ranges a text cites, a single line as a range of one; "lines 4 and 9" names two lines, not a range.
function namedRanges(text, file) {
  const ranges = [];
  const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const base = path.posix.basename(file).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const pattern of [new RegExp(`(?:${escaped}|${base}):(\\d+)(?:-(\\d+))?`, 'g'), /\blines? (\d+)(?:\s*(-|to|and)\s*(\d+))?/gi, /\bL(\d+)(?:-L?(\d+))?\b/g]) {
    for (const match of text.matchAll(pattern)) {
      const first = Number(match[1]);
      const separator = match.length === 4 ? match[2] : '-';
      const second = match.length === 4 ? match[3] : match[2];
      if (!second) ranges.push([first, first]);
      else if (separator.toLowerCase() === 'and') ranges.push([first, first], [Number(second), Number(second)]);
      else ranges.push([Math.min(first, Number(second)), Math.max(first, Number(second))]);
    }
  }

  return ranges;
}

function namesFile(text, file, siblings) {
  if (text.includes(file)) return true;
  const base = path.posix.basename(file);

  return siblings.filter(other => path.posix.basename(other) === base).length === 1 && new RegExp(`(^|[^\\w./-])${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(text);
}

// The distance of a finding to a truth entry, or null when the finding is no candidate for it.
function distance(finding, entry, siblings) {
  const text = `${finding.evidence ?? ''}\n${finding.consequence ?? ''}`;
  if (!namesFile(text, entry.file, siblings)) return null;
  // A symbol counts only where the finding locates itself; a consequence names callers and other sites in passing.
  if (entry.symbol && new RegExp(`\\b${entry.symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(finding.evidence ?? '')) return 0;
  // A cited range that overlaps the entry's range is at distance zero, so a range enclosing the defect matches it.
  const distances = namedRanges(text, entry.file).map(([first, last]) => last < entry.lines[0] ? entry.lines[0] - last : first > entry.lines[1] ? first - entry.lines[1] : 0).filter(value => value <= LINE_SLACK);

  return distances.length ? Math.min(...distances) : null;
}

// One-to-one assignment over ranked candidate pairs.
function assign(findings, truth) {
  const siblings = truth.map(entry => entry.file);
  const pairs = [];
  findings.forEach((finding, findingIndex) => truth.forEach((entry, entryIndex) => {
    const value = distance(finding, entry, siblings);
    if (value !== null) pairs.push({ value, findingIndex, entryIndex });
  }));
  pairs.sort((a, b) => a.value - b.value || a.findingIndex - b.findingIndex || a.entryIndex - b.entryIndex);
  const byFinding = new Map();
  const byEntry = new Map();
  for (const pair of pairs) {
    if (byFinding.has(pair.findingIndex) || byEntry.has(pair.entryIndex)) continue;
    byFinding.set(pair.findingIndex, pair.entryIndex);
    byEntry.set(pair.entryIndex, pair.findingIndex);
  }

  return { byFinding, byEntry };
}

function ratio(numerator, denominator) {
  return { numerator, denominator, value: denominator ? numerator / denominator : null };
}

// Grades one fixture run from its saved artifacts and the run folder's adjudications.
function gradeFixtureRun(runFolder, runItem, adjudications) {
  const paths = runPaths(runFolder, runItem.key);
  const leadRecord = fs.existsSync(paths.result('lead')) ? readJson(paths.result('lead')) : null;
  const skepticRecord = fs.existsSync(paths.result('skeptic')) ? readJson(paths.result('skeptic')) : null;
  const tokens = [leadRecord, skepticRecord].filter(Boolean).map(dispatchTokens);
  const elapsed = [leadRecord, skepticRecord].filter(Boolean).map(record => record.elapsedMs);
  const base = {
    key: runItem.key, fixture: runItem.fixture.name, model: modelLabel(runItem.model), repetition: runItem.repetition,
    // A fixture run a stopped run never dispatched has no cost to average, which is different from a dispatch that cost nothing.
    dispatched: Boolean(leadRecord),
    tokens: tokens.some(value => value === null) ? null : tokens.reduce((sum, value) => sum + value, 0),
    tokensEstimated: [leadRecord, skepticRecord].some(record => record?.estimated !== undefined),
    elapsedMs: elapsed.some(value => value === null) ? null : elapsed.reduce((sum, value) => sum + value, 0),
    identities: [leadRecord, skepticRecord].filter(Boolean).map(record => record.identity),
    retries: retryCounts(runFolder, runItem.key),
  };
  if (!leadRecord || leadRecord.outcome !== 'complete' || leadRecord.reportStatus !== 'complete') return { ...base, status: 'incomplete' };
  if (contaminated(paths)) return { ...base, status: 'contaminated' };
  const receipt = leadReceipt(paths);
  const findings = receipt.findings;
  const truth = runItem.fixture.truth;
  const { byFinding, byEntry } = assign(findings, truth);
  const own = adjudications[runItem.key] ?? {};
  const unmatched = findings.map((finding, index) => ({ finding, index })).filter(({ index }) => !byFinding.has(index));
  const pendingAdjudication = unmatched.filter(({ finding }) => !own[finding.id]).map(({ finding }) => finding.id);
  const attributed = new Map();
  const duplicates = new Set();
  const realIds = new Set();
  for (const { finding, index } of unmatched) {
    const decision = own[finding.id];
    if (!decision) continue;
    if (decision.outcome === 'real') realIds.add(finding.id);
    if (decision.outcome === 'attributed') {
      const entryIndex = truth.findIndex(entry => entry.id === decision.entry);
      if (entryIndex < 0) fail('adjudication-invalid', `${runItem.key}: ${finding.id} is attributed to unknown entry ${decision.entry}`);
      if (!byEntry.has(entryIndex) && !attributed.has(entryIndex)) attributed.set(entryIndex, index);
      else duplicates.add(finding.id);
    }
  }
  const matchOf = entryIndex => byEntry.get(entryIndex) ?? attributed.get(entryIndex);
  const matchedFindingIndices = new Set([...byFinding.keys(), ...attributed.values()]);
  const skepticComplete = skepticRecord?.outcome === 'complete' && skepticRecord.reportStatus === 'complete';
  const skepticReceipt = skepticComplete ? readJson(path.join(paths.artifacts('skeptic'), 'receipt.json')) : null;
  const claims = skepticComplete ? readJson(paths.claims).claims : [];
  const verdictOf = new Map();
  for (const verdict of skepticReceipt?.findings ?? []) {
    const claim = claims.find(item => item.id === verdict.id);
    if (claim) verdictOf.set(`${claim.source}:${claim.sourceId}`, verdict.verdict);
  }
  const planted = truth.map((entry, entryIndex) => ({ entry, entryIndex })).filter(({ entry }) => entry.kind === 'defect');
  const outOfScope = truth.map((entry, entryIndex) => ({ entry, entryIndex })).filter(({ entry }) => entry.kind === 'outOfScope');
  const detected = planted.filter(({ entryIndex }) => matchOf(entryIndex) !== undefined);
  const severityRight = detected.filter(({ entry, entryIndex }) => findings[matchOf(entryIndex)].severity === entry.severity);
  const perDimension = Object.fromEntries(CODE_DIMENSIONS.map(dimension => [dimension, {
    planted: planted.filter(({ entry }) => entry.dimension === dimension).length,
    detected: detected.filter(({ entry }) => entry.dimension === dimension).length,
  }]));
  const falseConfirmed = unmatched.filter(({ finding, index }) => !matchedFindingIndices.has(index) && !duplicates.has(finding.id) && !realIds.has(finding.id) && verdictOf.get(`lead:${finding.id}`) === 'confirmed').length;
  const clean = runItem.fixture.clean && realIds.size === 0;
  // A run whose lead left claims needs its skeptic for every figure that counts verdicts, the two false-positive figures included.
  const skepticIncomplete = (findings.length > 0 || runItem.fixture.fixture.decoys.length > 0) && !skepticComplete;
  const skepticPairs = [];
  if (skepticComplete) {
    for (const index of matchedFindingIndices) {
      const entryIndex = byFinding.get(index) ?? [...attributed.entries()].find(([, value]) => value === index)?.[0];
      if (truth[entryIndex].kind === 'incidental') continue;
      skepticPairs.push(verdictOf.get(`lead:${findings[index].id}`) === 'confirmed');
    }
    runItem.fixture.fixture.decoys.forEach((_, decoyIndex) => skepticPairs.push(verdictOf.get(`decoy:decoy-${decoyIndex + 1}`) === 'refuted'));
  }

  return {
    ...base,
    status: 'graded',
    provisional: pendingAdjudication.length > 0,
    pendingAdjudication,
    unmatched: unmatched.map(({ finding }) => finding.id),
    unmatchedConfirmed: unmatched.filter(({ finding }) => verdictOf.get(`lead:${finding.id}`) === 'confirmed').map(({ finding }) => finding.id),
    clean,
    planted: planted.length,
    detected: detected.length,
    severityRight: severityRight.length,
    perDimension,
    outOfScope: outOfScope.length,
    outOfScopeMatched: outOfScope.filter(({ entryIndex }) => matchOf(entryIndex) !== undefined).length,
    outOfScopeRequiredFalse: outOfScope.filter(({ entryIndex }) => matchOf(entryIndex) !== undefined && findings[matchOf(entryIndex)].required === false).length,
    falseConfirmed,
    skepticComplete,
    skepticIncomplete,
    skepticAgree: skepticPairs.filter(Boolean).length,
    skepticTotal: skepticPairs.length,
    attributions: attributed.size,
    duplicates: duplicates.size,
    real: realIds.size,
  };
}

function figures(graded) {
  const done = graded.filter(item => item.status === 'graded');
  const verdicted = done.filter(item => !item.skepticIncomplete);
  const cleanRuns = verdicted.filter(item => item.clean);
  const otherRuns = verdicted.filter(item => !item.clean);
  const sum = (items, field) => items.reduce((total, item) => total + item[field], 0);
  const dispatched = graded.filter(item => item.dispatched);
  const known = dispatched.filter(item => item.tokens !== null);
  const timed = dispatched.filter(item => item.elapsedMs !== null);

  return {
    detection: ratio(sum(done, 'detected'), sum(done, 'planted')),
    detectionByDimension: Object.fromEntries(CODE_DIMENSIONS.map(dimension => [dimension, ratio(done.reduce((total, item) => total + item.perDimension[dimension].detected, 0), done.reduce((total, item) => total + item.perDimension[dimension].planted, 0))])),
    cleanChangeFalsePositives: ratio(sum(cleanRuns, 'falseConfirmed'), cleanRuns.length),
    unmatchedConfirmations: ratio(sum(otherRuns, 'falseConfirmed'), otherRuns.length),
    outOfScope: { ...ratio(sum(done, 'outOfScopeMatched'), sum(done, 'outOfScope')), requiredFalse: sum(done, 'outOfScopeRequiredFalse') },
    severityAccuracy: ratio(sum(done, 'severityRight'), sum(done, 'detected')),
    skepticAccuracy: ratio(sum(done.filter(item => item.skepticComplete), 'skepticAgree'), sum(done.filter(item => item.skepticComplete), 'skepticTotal')),
    tokensPerFixture: ratio(sum(known, 'tokens'), known.length),
    elapsedMsPerFixture: ratio(sum(timed, 'elapsedMs'), timed.length),
    attributions: sum(done, 'attributions'),
    retries: graded.reduce((totals, item) => {
      for (const [cause, count] of Object.entries(item.retries)) totals[cause] = (totals[cause] ?? 0) + count;

      return totals;
    }, {}),
    provisional: done.some(item => item.provisional),
    tokensIncomplete: dispatched.some(item => item.tokens === null),
    tokensEstimated: dispatched.some(item => item.tokensEstimated),
  };
}

// The range of each figure across repetitions, for every figure a comparison reports, detection per dimension included.
function spread(groups) {
  const keys = ['detection', 'cleanChangeFalsePositives', 'unmatchedConfirmations', 'outOfScope', 'severityAccuracy', 'skepticAccuracy', 'tokensPerFixture', 'elapsedMsPerFixture'];
  const range = values => {
    const known = values.filter(value => value !== null && value !== undefined);

    return known.length > 1 ? { min: Math.min(...known), max: Math.max(...known) } : null;
  };

  return {
    ...Object.fromEntries(keys.map(key => [key, range(groups.map(group => group[key].value))])),
    detectionByDimension: Object.fromEntries(CODE_DIMENSIONS.map(dimension => [dimension, range(groups.map(group => group.detectionByDimension[dimension].value))])),
  };
}

// The targets set from a baseline, and whether they apply to a report on the given fixture set hash.
function targetsFor(fixtureSetHash, targetsFile) {
  if (!fs.existsSync(targetsFile)) return { status: 'none' };
  const targets = readJson(targetsFile);

  return targets.fixtureSetHash === fixtureSetHash ? { status: 'current', baseline: targets.baseline, figures: targets.figures } : { status: 'stale', baseline: targets.baseline };
}

function grade(runFolder, targetsFile = path.join(SUITE_ROOT, 'targets.json')) {
  const manifest = readJson(path.join(runFolder, 'manifest.json'));
  verifyFrozen(runFolder, manifest);
  const adjudicationFile = path.join(runFolder, 'adjudications.json');
  const adjudications = fs.existsSync(adjudicationFile) ? readJson(adjudicationFile) : {};
  // Every decision is checked, whether or not its finding is unmatched now, since a misspelled outcome would otherwise settle a finding silently as false.
  for (const [key, decisions] of Object.entries(adjudications)) {
    for (const [id, decision] of Object.entries(decisions ?? {})) {
      if (!ADJUDICATION_OUTCOMES.includes(decision?.outcome) || typeof decision.reason !== 'string' || !decision.reason.trim()) fail('adjudication-invalid', `${key}: ${id} needs an outcome of ${ADJUDICATION_OUTCOMES.join(', ')} and a reason`);
    }
  }
  const graded = [];
  for (const name of manifest.fixtures) {
    const fixture = loadFixture(frozenFixture(runFolder, name));
    for (const model of manifest.models) {
      for (let repetition = 1; repetition <= manifest.repeat; repetition++) graded.push(gradeFixtureRun(runFolder, { fixture, model, repetition, key: fixtureRunKey(name, model, repetition) }, adjudications));
    }
  }
  const byModel = {};
  for (const model of manifest.models) {
    const label = modelLabel(model);
    const own = graded.filter(item => item.model === label);
    const repetitions = [...new Set(own.map(item => item.repetition))].map(repetition => figures(own.filter(item => item.repetition === repetition)));
    byModel[label] = { figures: figures(own), spread: spread(repetitions) };
  }
  // Superseded results count too: a stage retried under another identity still dispatched under the first one.
  const identities = allResults(runFolder).map(record => record.identity).filter(Boolean);
  const heldEqual = new Set(identities.map(identity => `${identity.machinery}|${identity.harness}`));
  const report = {
    graded: new Date().toISOString(),
    whole: manifest.whole,
    fixtureSetHash: manifest.fixtureSetHash,
    rulesHash: manifest.rulesHash,
    // Grading reads only this file, so the launcher stays out of the grader's identity.
    graderHash: sha256(fs.readFileSync(__filename)),
    identities: [...new Map(identities.map(identity => [JSON.stringify(identity), identity])).values()],
    mixed: heldEqual.size > 1,
    targets: targetsFor(manifest.fixtureSetHash, targetsFile),
    pooled: figures(graded),
    byModel,
    incomplete: graded.filter(item => item.status === 'incomplete').map(item => item.key),
    contaminated: graded.filter(item => item.status === 'contaminated').map(item => item.key),
    skepticIncomplete: graded.filter(item => item.skepticIncomplete).map(item => item.key),
    pendingAdjudication: Object.fromEntries(graded.filter(item => item.pendingAdjudication?.length).map(item => [item.key, item.pendingAdjudication])),
    real: graded.filter(item => item.real > 0).map(item => item.key),
    // An active block names the dispatch whose host may still run and the repository kept for inspecting it.
    blocking: fs.existsSync(path.join(runFolder, 'blocking.json')) ? readJson(path.join(runFolder, 'blocking.json')) : null,
    fixtureRuns: graded,
  };
  writeJson(path.join(runFolder, 'report.json'), report);
  fs.writeFileSync(path.join(runFolder, 'report.md'), formatReport(report));

  return report;
}

function formatRatio(value) {
  if (value.value === null) return `n/a (${value.numerator}/${value.denominator})`;

  return `${(value.value * 100).toFixed(1)}% (${value.numerator}/${value.denominator})`;
}

function formatReport(report) {
  const lines = [`# Seeded-defect report`, '', `Graded ${report.graded}. Fixture set ${report.fixtureSetHash.slice(0, 12)}, rules ${report.rulesHash.slice(0, 12)}, grader ${report.graderHash.slice(0, 12)}.${report.whole ? '' : ' Subset run.'}${report.mixed ? ' Mixed run.' : ''}${report.pooled.provisional ? ' Provisional: some unmatched findings await adjudication.' : ''}`, ''];
  lines.push('| Figure | Pooled | ' + Object.keys(report.byModel).join(' | ') + ' |');
  lines.push('|---|---|' + Object.keys(report.byModel).map(() => '---|').join(''));
  const rows = [['Detection', 'detection'], ['Clean-change false positives per clean fixture', 'cleanChangeFalsePositives'], ['Unmatched confirmations per other fixture', 'unmatchedConfirmations'], ['Out of scope raised', 'outOfScope'], ['Severity accuracy', 'severityAccuracy'], ['Skeptic accuracy', 'skepticAccuracy']];
  // The two false-positive figures are counts per fixture, not shares, so they print as plain numbers.
  const perFixtureKeys = new Set(['cleanChangeFalsePositives', 'unmatchedConfirmations']);
  const cell = (key, value) => perFixtureKeys.has(key) ? (value.value === null ? `n/a (${value.numerator}/${value.denominator})` : `${value.value.toFixed(2)} (${value.numerator}/${value.denominator})`) : formatRatio(value);
  for (const [label, key] of rows) lines.push(`| ${label} | ${cell(key, report.pooled[key])} | ${Object.values(report.byModel).map(model => cell(key, model.figures[key])).join(' | ')} |`);
  const perFixture = figure => figure.value === null ? 'n/a' : Math.round(figure.value).toString();
  lines.push(`| Tokens per fixture run | ${perFixture(report.pooled.tokensPerFixture)} | ${Object.values(report.byModel).map(model => perFixture(model.figures.tokensPerFixture)).join(' | ')} |`);
  lines.push(`| Seconds per fixture run | ${report.pooled.elapsedMsPerFixture.value === null ? 'n/a' : Math.round(report.pooled.elapsedMsPerFixture.value / 1000)} | ${Object.values(report.byModel).map(model => model.figures.elapsedMsPerFixture.value === null ? 'n/a' : Math.round(model.figures.elapsedMsPerFixture.value / 1000)).join(' | ')} |`);
  if (report.targets.status === 'current') {
    lines.push('', 'Targets set from the baseline:');
    for (const [key, value] of Object.entries(report.targets.figures)) lines.push(`- ${key}: target ${value}, now ${report.pooled[key]?.value ?? 'n/a'}`);
  } else if (report.targets.status === 'stale') {
    lines.push('', `Targets are stale: they were set on another fixture set (baseline ${report.targets.baseline}).`);
  }
  if (report.blocking) lines.push('', `Blocked: host termination is unproven for ${report.blocking.fixtureRun} ${report.blocking.stage}; its repository is kept at ${report.blocking.repository}. Rerun with --termination-checked once the host process has ended.`);
  lines.push('', `Incomplete fixture runs: ${report.incomplete.length ? report.incomplete.join(', ') : 'none'}. Contaminated: ${report.contaminated.length ? report.contaminated.join(', ') : 'none'}. Without a complete skeptic: ${report.skepticIncomplete.length ? report.skepticIncomplete.join(', ') : 'none'}. Attributions: ${report.pooled.attributions}.`);
  for (const [label, model] of Object.entries(report.byModel)) {
    const retries = Object.entries(model.figures.retries);
    lines.push(`Retried stages on ${label}: ${retries.length ? retries.map(([cause, count]) => `${count} ${cause}`).join(', ') : 'none'}.`);
  }
  const pending = Object.entries(report.pendingAdjudication);
  if (pending.length) {
    lines.push('', 'Unmatched lead findings awaiting adjudication:');
    for (const [key, ids] of pending) lines.push(`- ${key}: ${ids.join(', ')}`);
  }

  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------------------------------------------------------
// Comparison

function compare(baselineFolder, laterFolder) {
  const baseline = readJson(path.join(baselineFolder, 'report.json'));
  const later = readJson(path.join(laterFolder, 'report.json'));
  const confounds = [];
  if (baseline.fixtureSetHash !== later.fixtureSetHash) confounds.push('fixture set');
  if (baseline.graderHash !== later.graderHash) confounds.push('grader (regrade the older run first)');
  if (baseline.mixed || later.mixed) confounds.push('a mixed run');
  // An incomplete or contaminated fixture run drops out of the figures, and one without a complete skeptic out of every verdict
  // figure, so the two reports would measure different samples.
  const dropped = report => (report.incomplete?.length ?? 0) + (report.contaminated?.length ?? 0) + (report.skepticIncomplete?.length ?? 0);
  if (dropped(baseline) || dropped(later)) confounds.push(`incomplete, contaminated or skeptic-incomplete fixture runs (baseline ${dropped(baseline)}, later ${dropped(later)})`);
  const hashesOf = (report, field) => [...new Set(report.identities.map(identity => identity[field]))].sort().join();
  // The dispatching harness is held equal in every comparison, so a change to it confounds whatever else varied.
  if (hashesOf(baseline, 'harness') !== hashesOf(later, 'harness')) confounds.push('dispatching harness');
  const varied = [];
  if (hashesOf(baseline, 'machinery') !== hashesOf(later, 'machinery')) varied.push('review machinery');
  if (baseline.rulesHash !== later.rulesHash) varied.push('conventions');
  if (JSON.stringify(Object.keys(baseline.byModel)) !== JSON.stringify(Object.keys(later.byModel))) varied.push('models');
  if (varied.length > 1) confounds.push(`more than one varied input (${varied.join(', ')})`);
  const informational = { commits: [...new Set([...baseline.identities, ...later.identities].map(identity => identity.commit))], hostVersions: [...new Set([...baseline.identities, ...later.identities].map(identity => identity.hostVersion))] };
  // The spread between identical runs is known per model, so a baseline of one model supplies it and a pooled one does not.
  const models = Object.values(baseline.byModel);
  const baselineSpread = models.length === 1 ? models[0].spread ?? {} : {};
  const targets = later.targets?.status === 'current' ? later.targets.figures : {};
  const change = (before, after, spread, target) => {
    const delta = before === null || before === undefined || after === null || after === undefined ? null : after - before;

    return { baseline: before ?? null, later: after ?? null, change: delta, spread: spread ?? null, withinSpread: delta === null || !spread ? null : Math.abs(delta) <= spread.max - spread.min, target: target ?? null };
  };
  const keys = ['detection', 'cleanChangeFalsePositives', 'unmatchedConfirmations', 'outOfScope', 'severityAccuracy', 'skepticAccuracy', 'tokensPerFixture', 'elapsedMsPerFixture'];
  const changes = Object.fromEntries(keys.map(key => [key, change(baseline.pooled[key]?.value, later.pooled[key]?.value, baselineSpread[key], targets[key])]));
  const detectionByDimension = Object.fromEntries(CODE_DIMENSIONS.map(dimension => [dimension, change(baseline.pooled.detectionByDimension?.[dimension]?.value, later.pooled.detectionByDimension?.[dimension]?.value, baselineSpread.detectionByDimension?.[dimension])]));

  return { varied, confounded: confounds, provisional: baseline.pooled.provisional || later.pooled.provisional, informational, targets: { status: later.targets?.status ?? 'none', baseline: later.targets?.baseline ?? null }, changes, detectionByDimension };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Command line

// <host>:<model id>, optionally followed by @<host>:<model id> naming a different skeptic model.
function parseModel(value) {
  const parse = text => {
    const separator = text.indexOf(':');
    if (separator <= 0 || separator === text.length - 1) fail('invalid-arguments', `--model takes <host>:<model id>[@<host>:<model id>], not ${value}`);

    return { host: text.slice(0, separator), id: text.slice(separator + 1) };
  };
  const [lead, skeptic, ...extra] = value.split('@');
  if (extra.length) fail('invalid-arguments', `--model takes <host>:<model id>[@<host>:<model id>], not ${value}`);
  const model = parse(lead);
  if (skeptic === undefined) return model;
  const other = parse(skeptic);

  return other.host === model.host && other.id === model.id ? model : { ...model, skeptic: other };
}

// A host and model id become path segments of every fixture run key, so each is one plain name, and a model runs once per run.
function validateModels(models) {
  for (const model of models) {
    for (const part of [model, model.skeptic].filter(Boolean)) {
      if (typeof part.host !== 'string' || !HOST_NAME.test(part.host)) fail('invalid-arguments', `A host must be letters and digits, not ${part.host}`);
      if (typeof part.id !== 'string' || !MODEL_NAME.test(part.id)) fail('invalid-arguments', `A model id must be letters, digits, '.', '_' or '-' without '__', not ${part.id}`);
    }
  }
  const labels = models.map(modelLabel);
  const repeated = labels.find((label, index) => labels.indexOf(label) !== index);
  if (repeated) fail('invalid-arguments', `--model ${repeated} is given more than once`);
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  const options = { command, models: [], selected: [], repeat: 1, fixtures: path.join(SUITE_ROOT, 'fixtures'), rules: path.join(SUITE_ROOT, 'rules.md'), positional: [] };
  for (let index = 0; index < rest.length; index++) {
    const argument = rest[index];
    const valueOf = () => {
      if (index + 1 >= rest.length) fail('invalid-arguments', `${argument} needs a value`);

      return rest[++index];
    };
    if (argument === '--fixtures') options.fixtures = path.resolve(valueOf());
    else if (argument === '--out') options.out = path.resolve(valueOf());
    else if (argument === '--model') options.models.push(parseModel(valueOf()));
    else if (argument === '--repeat') options.repeat = Number(valueOf());
    else if (argument === '--fixture') options.selected.push(valueOf());
    else if (argument === '--budget') options.budget = Number(valueOf());
    else if (argument === '--retry') options.retry = true;
    else if (argument === '--termination-checked') options.terminationChecked = true;
    else if (argument.startsWith('--')) fail('invalid-arguments', `Unknown option ${argument}`);
    else options.positional.push(argument);
  }
  if (command === 'run') {
    if (!options.out) fail('invalid-arguments', 'run needs --out <run folder>');
    if (!options.models.length) fail('invalid-arguments', 'run needs at least one --model <host>:<model id>');
    if (!Number.isSafeInteger(options.repeat) || options.repeat < 1) fail('invalid-arguments', '--repeat takes a positive integer');
    if (!Number.isSafeInteger(options.budget) || options.budget <= 0) fail('budget-missing', 'run needs --budget <tokens>');
  } else if (command === 'grade') {
    if (options.positional.length !== 1) fail('invalid-arguments', 'grade takes one run folder');
  } else if (command === 'compare') {
    if (options.positional.length !== 2) fail('invalid-arguments', 'compare takes a baseline run folder and a later run folder');
  } else {
    fail('invalid-arguments', `Usage: node tools/${SCRIPT_NAME}.js run|grade|compare ...`);
  }

  return options;
}

async function main(argv) {
  const options = parseArguments(argv);
  if (options.command === 'run') {
    const result = await run(options);
    console.log(JSON.stringify(result, null, 2));

    return result.stopped ? 1 : 0;
  }
  if (options.command === 'grade') {
    process.stdout.write(formatReport(grade(path.resolve(options.positional[0]))));

    return 0;
  }
  console.log(JSON.stringify(compare(path.resolve(options.positional[0]), path.resolve(options.positional[1])), null, 2));

  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(code => process.exit(code), error => {
    console.error(`${SCRIPT_NAME}: ${error.code ? `${error.code}: ` : ''}${error.message}`);
    process.exit(2);
  });
}

module.exports = { CODE_DIMENSIONS, SuiteError, assign, compare, compositionProblems, distance, fixtureRunKey, grade, gradeFixtureRun, loadFixture, loadSuite, materialize, parseArguments, run, runPaths, seedFor, shuffledClaims, spending, writeJson };
