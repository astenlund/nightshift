'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { isBuiltin } = require('node:module');
const { MANIFEST_PATH, PAYLOAD_ROOTS, encodeManifest, isPayload, makeManifest, payloadFiles } = require('../internal/releases/manifest');

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr.toString('utf8'));
  return result.stdout;
}

function validateDependencies(files, read) {
  const inventory = new Set(files);
  const required = (owner, relative) => {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(owner), relative));
    if (target === '..' || target.startsWith('../') || ![target, target + '.js', target + '.json', target + '/index.js'].some(file => inventory.has(file))) throw new Error(`${owner} references a resource outside the declared payload: ${relative}`);
  };
  for (const file of files) {
    if (!/\.(?:[cm]?js|md)$/.test(file)) continue;
    const content = read(file).toString('utf8');
    if (/\.[cm]?js$/.test(file)) {
      for (const match of content.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        if (match[1].startsWith('.')) required(file, match[1]);
        else if (!isBuiltin(match[1])) throw new Error(`${file} has an undeclared external runtime dependency: ${match[1]}`);
      }
    } else if (!file.startsWith('skills/init-backlog/templates/')) {
      // Template links describe the destination project's index filenames. The
      // template files themselves are still part of the complete payload.
      for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
        const target = match[1].split('#')[0];
        if (target && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target)) required(file, target);
      }
    }
  }
}

function validateAttributes(root, files, revision) {
  const args = ['check-attr', '-z', ...(revision ? ['--source', revision] : []), 'text', 'eol', '--', ...files, MANIFEST_PATH];
  const fields = git(root, args).toString('utf8').split('\0');
  const attributes = new Map();
  for (let index = 0; index + 2 < fields.length; index += 3) {
    const [file, attribute, value] = fields.slice(index, index + 3);
    if (!attributes.has(file)) attributes.set(file, {});
    attributes.get(file)[attribute] = value;
  }
  for (const file of [...files, MANIFEST_PATH]) {
    const policy = attributes.get(file);
    if (policy?.text !== 'unset' && !(policy?.eol === 'lf' && ['set', 'auto'].includes(policy.text))) throw new Error(`${file} lacks a locked byte policy in .gitattributes: require text with eol=lf, or explicit -text for binary resources`);
  }
}

function fromTree(root, revision) {
  const files = git(root, ['ls-tree', '-r', '--name-only', '-z', revision, '--', ...PAYLOAD_ROOTS]).toString('utf8').split('\0').filter(isPayload);
  const cache = new Map();
  const read = file => { if (!cache.has(file)) cache.set(file, git(root, ['show', `${revision}:${file}`])); return cache.get(file); };
  validateDependencies(files, read);
  validateAttributes(root, files, revision);
  return makeManifest(files, read);
}

function checkTree(root, revision) {
  const expected = encodeManifest(fromTree(root, revision));
  const actual = git(root, ['show', `${revision}:${MANIFEST_PATH}`]);
  if (!actual.equals(expected)) throw new Error(`Committed ${MANIFEST_PATH} is stale at ${revision}; regenerate it with the payload changes`);
  return true;
}

function workingManifest(root) {
  const files = payloadFiles(root);
  const read = file => fs.readFileSync(path.join(root, file));
  validateDependencies(files, read);
  validateAttributes(root, files);
  return makeManifest(files, read);
}

function main(args) {
  const root = process.cwd();
  if (args.length === 2 && args[0] === '--revision') { checkTree(root, args[1]); console.log('Committed release manifest is current.'); return; }
  if (args.length > 1 || args.length === 1 && args[0] !== '--write') throw new Error('Use --write, --revision <commit>, or no arguments to check the working tree');
  const bytes = encodeManifest(workingManifest(root));
  const file = path.join(root, MANIFEST_PATH);
  if (args[0] === '--write') fs.writeFileSync(file, bytes);
  else if (!fs.existsSync(file) || !fs.readFileSync(file).equals(bytes)) throw new Error('Working-tree release manifest is missing or stale');
  console.log(`Release manifest ${args[0] === '--write' ? 'generated' : 'verified'}.`);
}

if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(`${path.basename(process.argv[1])}: ${error.message}`); process.exitCode = 1; }
}

module.exports = { checkTree, fromTree, validateAttributes, validateDependencies, workingManifest };
