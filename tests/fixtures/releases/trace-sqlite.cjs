'use strict';

// Preloaded with --require into a process under test, such as the retained bootstrap, without changing its bytes: appends every
// statement the process runs through node:sqlite's DatabaseSync.exec, as it starts and as it returns or throws, to the JSON-lines
// file named by NIGHTSHIFT_FIXTURE_SQL_TRACE, so a test can see what the process attempted and whether it waited for a lock.
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const trace = process.env.NIGHTSHIFT_FIXTURE_SQL_TRACE;
const record = (sql, event, error) => fs.appendFileSync(trace, JSON.stringify({ sql, event, ...(error ? { error } : {}) }) + '\n');
const exec = DatabaseSync.prototype.exec;
DatabaseSync.prototype.exec = function (sql) {
  record(sql, 'start');
  try {
    const result = exec.call(this, sql);
    record(sql, 'done');
    return result;
  } catch (error) {
    record(sql, 'failed', error.message);
    throw error;
  }
};
