const REQUIRES = /\*\*Requires:\*\*\s*([^\n]*?)\.?\s*$/m;

function requiresOf(entry) {
  const match = REQUIRES.exec(entry.body ?? '');
  if (!match || match[1].trim() === 'none') return [];
  return match[1].split(',').map(title => title.trim()).filter(Boolean);
}

function parseDependencies(entries) {
  const titles = new Set(entries.map(entry => entry.title));
  const requires = new Map();
  const problems = [];
  for (const entry of entries) {
    const names = requiresOf(entry);
    requires.set(entry.title, names);
    for (const name of names.filter(name => !titles.has(name))) problems.push(unknownDependency(entry, name));
  }
  return { requires, problems };
}

function unknownDependency(entry, name) {
  return `${entry.title} requires "${entry.title}", which names no entry`;
}

module.exports = { parseDependencies };
