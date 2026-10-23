const crypto = require('node:crypto');
const fs = require('node:fs');

async function readJournal(file) {
  try {
    return JSON.parse(await fs.promises.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeJournal(file, entries) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.promises.writeFile(temporary, JSON.stringify(entries));
    await fs.promises.rename(temporary, file);
  } catch (error) {
    await fs.promises.rm(temporary, { force: true });
    throw error;
  }
}

async function appendEntry(file, entry) {
  const entries = await readJournal(file);
  entries.push({ ...entry, at: new Date().toISOString() });
  await writeJournal(file, entries);
  return entries.length;
}

module.exports = { appendEntry, readJournal, writeJournal };
