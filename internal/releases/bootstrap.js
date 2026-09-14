#!/usr/bin/env node
'use strict';

// This small protocol-1 router is copied beside the registry. It has no package
// imports, so plugin-cache removal cannot remove its ability to find a bundle.
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };

function readRecord(database, kind, key) {
  const row = database.prepare('SELECT value FROM records WHERE kind=? AND key=?').get(kind, key);
  return row ? JSON.parse(row.value) : null;
}

function verify(root, record) {
  requireValue(record && /^[a-f0-9-]{36}$/.test(record.key) && path.relative(root, record.root) === path.join('bundles', record.key), 'Invalid retained bundle location');
  const actualRoot = fs.realpathSync.native(record.root);
  requireValue(actualRoot === record.root && !fs.lstatSync(record.root).isSymbolicLink(), 'Retained bundle location changed');
  const manifestPath = 'internal/releases/payload.json';
  const manifestBytes = fs.readFileSync(path.join(actualRoot, manifestPath));
  requireValue(hash(manifestBytes) === record.manifestDigest, 'Retained manifest changed');
  const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes));
  requireValue(manifest.schema === 1 && manifest.name === 'nightshift' && `${manifest.version}-${record.manifestDigest}` === record.identity && Array.isArray(manifest.files) && manifest.files.length <= 10000, 'Unsupported retained manifest');
  const expected = new Set([manifestPath]);
  for (const file of manifest.files) {
    requireValue(typeof file.path === 'string' && file.path.split('/').every(part => part && part !== '.' && part !== '..') && !path.win32.isAbsolute(file.path) && !file.path.includes(String.fromCharCode(92)) && !file.path.includes(':'), 'Unsafe retained manifest path');
    const target = path.join(actualRoot, file.path);
    requireValue(fs.realpathSync.native(target) === target, 'Retained resource is linked');
    const stat = fs.lstatSync(target);
    requireValue(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size === file.bytes && stat.size <= 16 * 1024 * 1024, 'Retained resource shape changed');
    const bytes = fs.readFileSync(target);
    requireValue(hash(bytes) === file.sha256, 'Retained resource content changed');
    expected.add(file.path);
  }
  const walk = relative => fs.readdirSync(path.join(actualRoot, relative), { withFileTypes: true }).flatMap(entry => {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    requireValue(!entry.isSymbolicLink(), 'Linked retained inventory entry');
    return entry.isDirectory() ? walk(name) : [name];
  });
  const actual = walk('');
  requireValue(actual.length === expected.size && actual.every(file => expected.has(file)), 'Retained inventory changed');
  return actualRoot;
}

function ownsRun(input) {
  if (!input?.cwd || !input.session_id) return false;
  let current = path.resolve(input.cwd);
  while (true) {
    const file = path.join(current, '.nightshift/runs/state.sqlite');
    if (fs.existsSync(file)) {
      let database;
      try {
        database = new DatabaseSync(file, { readOnly: true });
        const row = database.prepare('SELECT r.state FROM runs r JOIN active a ON a.id=r.id WHERE a.singleton=1').get();
        const state = row && JSON.parse(row.state);
        return state?.controller?.session === input.session_id && state.status === 'running';
      } catch { return false; }
      finally { database?.close(); }
    }
    if (fs.existsSync(path.join(current, '.git'))) return false;
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

async function main() {
  const root = fs.realpathSync.native(path.resolve(__dirname, '../..'));
  const registrationKey = process.argv[2];
  const hook = process.argv[3] === '--hook';
  let input;
  let database;
  let lease;
  try {
    requireValue(/^[a-f0-9]{64}$/.test(registrationKey), 'Invalid Nightshift registration identity');
    const bytes = fs.readFileSync(hook ? 0 : process.argv[3]);
    requireValue(bytes.length <= 4 * 1024 * 1024, 'Nightshift request exceeds its bound');
    input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    const registryFile = path.join(root, 'registry.sqlite');
    const registryStat = fs.lstatSync(registryFile);
    requireValue(registryStat.isFile() && !registryStat.isSymbolicLink() && registryStat.nlink === 1, 'Retained registry is not an ordinary file');
    database = new DatabaseSync(registryFile);
    requireValue(database.prepare('PRAGMA user_version').get().user_version === 1, 'Unsupported Nightshift store protocol');
    database.exec(`PRAGMA busy_timeout=${hook ? 0 : 5000}; BEGIN IMMEDIATE;`);
    const registration = readRecord(database, 'registration', registrationKey);
    const routes = registration ? [registration, ...(registration.routes ?? []), registration.pending].filter(Boolean) : [];
    requireValue(routes.some(route => route.bootstrap === fs.realpathSync.native(__filename) && route.bootstrapHash === hash(fs.readFileSync(__filename))), 'Nightshift bootstrap registration changed');
    const session = hook ? input.session_id : input.session;
    const binding = typeof session === 'string' ? readRecord(database, 'session', hash(JSON.stringify([registrationKey, session]))) : null;
    let record = binding?.state === 'bound' ? readRecord(database, 'bundle', binding.bundle) : null;
    let selected;
    let selectedRecord;
    if (record) {
      try { selected = verify(root, record); selectedRecord = record; }
      catch {
        const alternatives = database.prepare("SELECT value FROM records WHERE kind='bundle'").all().map(row => JSON.parse(row.value)).filter(candidate => candidate.identity === binding.identity);
        for (const candidate of alternatives) {
          try { selected = verify(root, candidate); selectedRecord = candidate; break; }
          catch { /* Exact-identity recovery may use another complete copy. */ }
        }
      }
    }
    if (!selected) {
      selectedRecord = readRecord(database, 'bundle', registration.baseBundle ?? registration.pending?.baseBundle);
      selected = verify(root, selectedRecord);
    }
    lease = randomUUID();
    database.prepare('INSERT INTO records(kind,key,value) VALUES(?,?,?)').run('operation', lease, JSON.stringify({ schema: 1, kind: 'bootstrap', state: 'running', pid: process.pid, registration: registrationKey, session: session ?? null, bundle: selectedRecord.key }));
    database.exec('COMMIT');
    database.close();
    database = null;
    const handler = require(path.join(selected, 'internal/releases/launcher.js'));
    await handler.route({ ...input, action: hook ? 'hook' : input.action, hookInput: hook ? input : undefined }, { store: root, registration: registrationKey, implementationBundle: selectedRecord.key, bootstrapOperation: lease, nativeHook: hook });
  } catch (error) {
    if (hook) process.stdout.write(JSON.stringify(ownsRun(input) ? { systemMessage: `Nightshift retained resources are unavailable: ${error.message}. Saved work remains incomplete; recover its bound resources before dependent operations.` } : {}) + '\n');
    else { process.stderr.write(JSON.stringify({ error: 'retained-bootstrap-unavailable', message: error.message }) + '\n'); process.exitCode = 1; }
  } finally {
    database?.close();
    if (lease) {
      let cleanup;
      try {
        cleanup = new DatabaseSync(path.join(root, 'registry.sqlite'));
        cleanup.exec('PRAGMA busy_timeout=5000;');
        cleanup.prepare('DELETE FROM records WHERE kind=? AND key=?').run('operation', lease);
      } catch { /* A dead bootstrap lease can be reconciled without discarding work. */ }
      finally { cleanup?.close(); }
    }
  }
}

if (require.main === module) main();
module.exports = { ownsRun, verify };
