'use strict';

const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const SHIPPED_PREFIXES = ['skills/', 'internal/', 'hooks/'];
const MANIFESTS = ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json'];
const README_STATUS = /^\*\*Status:\*\* Nightshift (\d+\.\d+\.\d+) is (?:in development|published on `main`)(?=[., \t\r\n]|$)/m;
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const ZERO_SHA = /^0+$/;
const PUBLISHED_REF = 'refs/heads/main';

class GateError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GateError';
  }
}

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, windowsHide: true, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new GateError(`git ${args.join(' ')} failed: ${result.error?.message ?? result.stderr.trim()}`);
  return result.stdout;
}

function isTest(file) {
  return /\.test\.[cm]?js$/.test(file);
}

function isShipped(file) {
  return SHIPPED_PREFIXES.some(prefix => file.startsWith(prefix)) && !isTest(file);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}

function withoutVersion(manifest) {
  return JSON.stringify(stable({ ...manifest, version: undefined }));
}

function readJson(root, revision, file) {
  try {
    return JSON.parse(git(root, ['show', `${revision}:${file}`]));
  } catch (error) {
    throw new GateError(`Cannot read ${file} at ${revision}: ${error.message}`);
  }
}

function parseVersion(text, origin) {
  const match = SEMVER.exec(text ?? '');
  if (!match) throw new GateError(`${origin} has no x.y.z version (found ${JSON.stringify(text ?? null)})`);
  return match.slice(1).map(Number);
}

function compareVersions(a, b) {
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

function evaluateRelease(root, baseline, head) {
  const problems = [];
  const changed = git(root, ['diff', '--name-only', '-z', '--no-renames', baseline, head]).split('\0').filter(Boolean);
  const shipped = changed.filter(isShipped);
  const headManifests = MANIFESTS.map(file => readJson(root, head, file));
  const baselineManifests = MANIFESTS.map(file => readJson(root, baseline, file));
  const headVersion = parseVersion(headManifests[0].version, `${MANIFESTS[0]} at ${head}`);
  const baselineVersion = parseVersion(baselineManifests[0].version, `${MANIFESTS[0]} at ${baseline}`);
  if (headManifests[1].version !== headManifests[0].version) problems.push(`Manifest versions differ at ${head}: ${MANIFESTS[0]} ${headManifests[0].version}, ${MANIFESTS[1]} ${headManifests[1].version}`);
  const manifestFieldsChanged = MANIFESTS.filter((file, index) => withoutVersion(headManifests[index]) !== withoutVersion(baselineManifests[index]));
  const comparison = compareVersions(headVersion, baselineVersion);
  if (comparison < 0) problems.push(`Version decreases from ${baselineManifests[0].version} to ${headManifests[0].version}`);
  else if (comparison === 0 && (shipped.length > 0 || manifestFieldsChanged.length > 0)) problems.push(`Shipped plugin behavior changed without a version increase over ${baselineManifests[0].version}: ${[...shipped, ...manifestFieldsChanged].join(', ')}`);
  const status = README_STATUS.exec(git(root, ['show', `${head}:README.md`]));
  if (!status) problems.push(`README.md at ${head} has no recognizable candidate or published version status line`);
  else if (status[1] !== headManifests[0].version) problems.push(`README.md status announces ${status[1]} while the manifests carry ${headManifests[0].version}`);
  if (git(root, ['ls-tree', '--name-only', head, '--', 'internal/releases/launcher.js']).trim()) {
    try { require('./release-manifest').checkTree(root, head); }
    catch (error) { problems.push(`Retained release manifest is invalid: ${error.message}`); }
  }
  return { baseline, head, changed, shipped, manifestFieldsChanged, baselineVersion: baselineManifests[0].version, headVersion: headManifests[0].version, problems };
}

function parseArguments(argv) {
  const options = { root: process.cwd(), baseline: 'origin/main', head: 'HEAD', prePush: false };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--pre-push') options.prePush = true;
    else if (['--baseline', '--head', '--root'].includes(argument)) {
      if (index + 1 >= argv.length) throw new GateError(`${argument} needs a value`);
      options[argument.slice(2)] = argv[++index];
    } else throw new GateError(`Unknown argument: ${argument}`);
  }
  return options;
}

function requireLocalCommit(root, sha, ref) {
  const probe = spawnSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: root, windowsHide: true, encoding: 'utf8' });
  if (probe.error || probe.status !== 0) throw new GateError(`Published baseline ${sha} for ${ref} is not available locally; fetch it and retry`);
}

function prePushRanges(input) {
  return input.split(/\r?\n/).filter(Boolean).map(line => {
    const [localRef, localSha, remoteRef, remoteSha] = line.split(' ');
    return { localRef, localSha, remoteRef, remoteSha };
  });
}

function report(result) {
  const summary = `${result.baseline} -> ${result.head}: version ${result.baselineVersion} -> ${result.headVersion}, ${result.shipped.length} shipped file(s) changed`;
  if (result.problems.length === 0) {
    console.log(`Release gate passed: ${summary}`);
    return true;
  }
  console.error(`Release gate failed: ${summary}`);
  for (const problem of result.problems) console.error(`  - ${problem}`);
  return false;
}

function main(argv) {
  const options = parseArguments(argv);
  const root = git(options.root, ['rev-parse', '--show-toplevel']).trim();
  if (!options.prePush) {
    if (ZERO_SHA.test(options.baseline)) {
      console.log('Release gate skipped: no published baseline was supplied');
      return 0;
    }
    return report(evaluateRelease(root, options.baseline, options.head)) ? 0 : 1;
  }
  let passed = true;
  for (const range of prePushRanges(fs.readFileSync(0, 'utf8'))) {
    if (range.remoteRef !== PUBLISHED_REF) console.log(`Release gate skipped for ${range.remoteRef}: only ${PUBLISHED_REF} is a published baseline`);
    else if (ZERO_SHA.test(range.localSha)) console.log(`Release gate skipped for ${range.remoteRef}: a ref deletion has no outgoing content`);
    else if (ZERO_SHA.test(range.remoteSha)) console.log(`Release gate skipped for ${range.remoteRef}: no published baseline for a new ref`);
    else {
      requireLocalCommit(root, range.remoteSha, range.remoteRef);
      if (!report(evaluateRelease(root, range.remoteSha, range.localSha))) passed = false;
    }
  }
  return passed ? 0 : 1;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`Release gate could not run: ${error.message}`);
    process.exitCode = 2;
  }
}

module.exports = { GateError, README_STATUS, evaluateRelease, isShipped, prePushRanges };
