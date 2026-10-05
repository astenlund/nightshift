'use strict';

// Holds a SQLite database's write lock from a separate process: begins an immediate transaction, or an exclusive one that also
// keeps readers out, as every rollback-journal commit does while it writes, reports "held" on stdout, keeps the lock for the given
// milliseconds, then rolls back and exits.
// Usage: node hold-sqlite-lock.cjs <database> <milliseconds> [immediate|exclusive]
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const [file, milliseconds, mode = 'immediate'] = process.argv.slice(2);
const database = new DatabaseSync(file);
database.exec(`PRAGMA busy_timeout=0; BEGIN ${mode === 'exclusive' ? 'EXCLUSIVE' : 'IMMEDIATE'}`);
// Written synchronously, since the wait below blocks the event loop that would flush an asynchronous write.
fs.writeSync(1, 'held\n');
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(milliseconds));
database.exec('ROLLBACK');
database.close();
