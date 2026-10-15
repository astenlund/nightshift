'use strict';

const { createHash } = require('node:crypto');
const { requireCondition } = require('./errors');
const progress = require('./progress');

const MAX_DELIVERY_RECORDS = 10000;
const MAX_RUN_ID_BYTES = 1024;
const MAX_ARTIFACT_ID_BYTES = 64;
const ACTIVE_TABLE_SQL = 'CREATE TABLE active (singleton INTEGER PRIMARY KEY CHECK(singleton=1), id TEXT NOT NULL REFERENCES runs(id))';

const SOURCE_TABLES = Object.freeze([['runs', 'id'], ['history', 'run_id'], ['accounting_commits', 'run_id'], ['discharge_index', 'run_id']]);
const EXPECTED_COLUMNS = Object.freeze({
  runs: ['id', 'revision', 'state'],
  active: ['singleton', 'id'],
  history: ['run_id', 'revision', 'kind', 'recorded_at', 'state'],
  artifacts: ['id', 'body'],
  accounting_commits: ['run_id', 'revision', 'artifact'],
  discharge_index: ['run_id', 'occurrence', 'evidence_hash', 'binding_hash', 'artifact'],
  legacy_retirements: ['run_id', 'artifact'],
});
const EXPECTED_KEYS = Object.freeze({ runs: [1, 0, 0], active: [1, 0], history: [1, 2, 0, 0, 0], artifacts: [1, 0], accounting_commits: [1, 2, 0], discharge_index: [1, 2, 3, 4, 5], legacy_retirements: [1, 0] });
const EXPECTED_TYPES = Object.freeze({ runs: ['TEXT', 'INTEGER', 'TEXT'], active: ['INTEGER', 'TEXT'], history: ['TEXT', 'INTEGER', 'TEXT', 'TEXT', 'TEXT'], artifacts: ['TEXT', 'TEXT'], accounting_commits: ['TEXT', 'INTEGER', 'TEXT'], discharge_index: ['TEXT', 'TEXT', 'TEXT', 'TEXT', 'TEXT'], legacy_retirements: ['TEXT', 'TEXT'] });
const EXPECTED_NOT_NULL = Object.freeze({ runs: [0, 1, 1], active: [0, 1], history: [1, 1, 1, 1, 1], artifacts: [0, 1], accounting_commits: [1, 1, 1], discharge_index: [1, 1, 1, 1, 1], legacy_retirements: [0, 1] });
const EXPECTED_FOREIGN = Object.freeze({ active: { from: 'id', to: 'id' }, history: { from: 'run_id', to: 'id' }, legacy_retirements: { from: 'run_id', to: 'id' } });

const CREATE_TABLES = Object.freeze({
  artifacts: 'CREATE TABLE artifacts (id TEXT PRIMARY KEY, body TEXT NOT NULL)',
  accounting_commits: 'CREATE TABLE accounting_commits (run_id TEXT NOT NULL, revision INTEGER NOT NULL, artifact TEXT NOT NULL, PRIMARY KEY(run_id, revision))',
  discharge_index: 'CREATE TABLE discharge_index (run_id TEXT NOT NULL, occurrence TEXT NOT NULL, evidence_hash TEXT NOT NULL, binding_hash TEXT NOT NULL, artifact TEXT NOT NULL, PRIMARY KEY(run_id, occurrence, evidence_hash, binding_hash, artifact))',
  legacy_retirements: 'CREATE TABLE legacy_retirements (run_id TEXT PRIMARY KEY REFERENCES runs(id), artifact TEXT NOT NULL)',
});

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function triggerDefinition(table, column, event) {
  const name = `legacy_guard_${table}_${event.toLowerCase()}`;
  const oldId = `OLD.${column}`;
  const newId = `NEW.${column}`;
  const test = event === 'INSERT' ? `run_id=${newId}` : event === 'DELETE' ? `run_id=${oldId}` : `run_id=${oldId} OR run_id=${newId}`;

  return { name, sql: `CREATE TRIGGER ${name} BEFORE ${event} ON ${table} WHEN EXISTS(SELECT 1 FROM legacy_retirements WHERE ${test}) BEGIN SELECT RAISE(ABORT, 'retired-run'); END` };
}

const TRIGGERS = Object.freeze(SOURCE_TABLES.flatMap(([table, column]) => ['INSERT', 'UPDATE', 'DELETE'].map(event => triggerDefinition(table, column, event))));

function tableNames(db) {
  return new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
}

function schemaState(db) {
  const version = db.prepare('PRAGMA user_version').get().user_version;
  requireCondition([1, 2].includes(version), 'migration-store-version', `Unsupported delivery store version ${version}`);
  const tables = tableNames(db);
  for (const name of ['runs', 'active', 'history']) requireCondition(tables.has(name), 'migration-store-unavailable', `Delivery store lacks ${name}`);
  requireCondition(version !== 2 || tables.has('artifacts'), 'migration-store-unavailable', 'Version-2 delivery store lacks artifacts');
  requireCondition(!tables.has('legacy_retirements') || tables.has('artifacts'), 'migration-store-unavailable', 'Retirement references lack their artifact store');
  for (const [name, columns] of Object.entries(EXPECTED_COLUMNS)) {
    if (!tables.has(name)) continue;
    const actual = db.prepare(`PRAGMA table_info(${name})`).all();
    requireCondition(actual.length === columns.length && columns.every((column, index) => column === actual[index].name && EXPECTED_KEYS[name][index] === actual[index].pk && EXPECTED_TYPES[name][index] === actual[index].type && EXPECTED_NOT_NULL[name][index] === actual[index].notnull && actual[index].dflt_value === null), 'migration-store-unavailable', `Delivery table ${name} has an unsupported shape`);
    const foreign = db.prepare(`PRAGMA foreign_key_list(${name})`).all();
    const expected = EXPECTED_FOREIGN[name];
    requireCondition(expected ? foreign.length === 1 && foreign[0].table === 'runs' && foreign[0].from === expected.from && foreign[0].to === expected.to && foreign[0].on_update === 'NO ACTION' && foreign[0].on_delete === 'NO ACTION' : foreign.length === 0, 'migration-store-unavailable', `Delivery table ${name} has unsupported foreign keys`);
  }
  requireCondition(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='active'").get()?.sql === ACTIVE_TABLE_SQL, 'migration-store-unavailable', 'Delivery selection table lacks its supported singleton constraint');

  return { version, tables };
}

function verifyTriggers(db, tables = tableNames(db)) {
  if (!tables.has('legacy_retirements')) return;
  const installed = new Map(db.prepare("SELECT name, sql FROM sqlite_master WHERE type='trigger'").all().map(row => [row.name, row.sql]));
  for (const trigger of TRIGGERS) requireCondition(installed.get(trigger.name) === trigger.sql, 'migration-protection-unavailable', `Retirement write protection is missing or changed: ${trigger.name}`);
}

function createSupport(db, schema = schemaState(db)) {
  for (const name of Object.keys(CREATE_TABLES)) {
    if (!schema.tables.has(name)) db.exec(CREATE_TABLES[name]);
  }
  if (schema.version === 1) db.exec('PRAGMA user_version=2');
  for (const trigger of TRIGGERS) {
    const saved = db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").get(trigger.name);
    if (!saved) db.exec(trigger.sql);
  }
  verifyTriggers(db);
}

function retirementRows(db, tables = tableNames(db)) {
  if (!tables.has('legacy_retirements')) return [];
  const stats = db.prepare('SELECT count(*) AS count, coalesce(max(length(CAST(run_id AS BLOB))), 0) AS runIdBytes, coalesce(max(length(CAST(artifact AS BLOB))), 0) AS artifactBytes FROM legacy_retirements').get();
  requireCondition(stats.count <= MAX_DELIVERY_RECORDS && stats.runIdBytes <= MAX_RUN_ID_BYTES && stats.artifactBytes <= MAX_ARTIFACT_ID_BYTES, 'migration-store-unavailable', 'Retirement reference inventory exceeds its bound');

  return db.prepare('SELECT run_id AS runId, artifact FROM legacy_retirements ORDER BY run_id').all();
}

function isRetirementCertificate(value) {
  return value?.schema === 1 && typeof value.runId === 'string' && Object.hasOwn(value, 'manifestHash') && Object.hasOwn(value, 'supersedes');
}

function readArtifactBody(db, id, maximumBytes = progress.MAX_FRONTIER_BYTES) {
  requireCondition(progress.HASH.test(id), 'migration-evidence-unavailable', 'Artifact identity is malformed');
  requireCondition(Number.isSafeInteger(maximumBytes) && maximumBytes >= 0, 'migration-evidence-unavailable', 'Artifact read bound is invalid');
  const row = db.prepare('SELECT body FROM artifacts WHERE id=? AND length(CAST(body AS BLOB))<=?').get(id, maximumBytes);
  requireCondition(row && sha256(row.body) === id, 'migration-evidence-unavailable', `Artifact ${id} is missing, oversized or changed`);

  return row.body;
}

function readArtifact(db, id, maximumBytes = progress.MAX_FRONTIER_BYTES) {
  const body = readArtifactBody(db, id, maximumBytes);

  return JSON.parse(body);
}

function writeArtifact(db, value, maximumBytes = progress.MAX_FRONTIER_BYTES) {
  const body = JSON.stringify(progress.canonical(value));
  requireCondition(Buffer.byteLength(body) <= maximumBytes, 'migration-evidence-unavailable', 'Migration artifact exceeds its byte bound');
  const id = sha256(body);
  const existing = db.prepare('SELECT body FROM artifacts WHERE id=? AND length(CAST(body AS BLOB))<=?').get(id, maximumBytes);
  requireCondition(existing || !db.prepare('SELECT 1 FROM artifacts WHERE id=?').get(id), 'migration-evidence-unavailable', 'Existing migration artifact exceeds its byte bound');
  requireCondition(!existing || existing.body === body, 'migration-evidence-unavailable', 'Existing migration artifact is corrupt');
  db.prepare('INSERT OR IGNORE INTO artifacts VALUES (?, ?)').run(id, body);

  return id;
}

module.exports = { ACTIVE_TABLE_SQL, CREATE_TABLES, MAX_ARTIFACT_ID_BYTES, MAX_DELIVERY_RECORDS, MAX_RUN_ID_BYTES, TRIGGERS, createSupport, isRetirementCertificate, readArtifact, readArtifactBody, retirementRows, schemaState, sha256, tableNames, verifyTriggers, writeArtifact };
