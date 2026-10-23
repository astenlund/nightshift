function parseConfig(text) {
  const entries = [];
  const problems = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim() || line.startsWith('#')) return;
    const match = /^(\w+)\s*=\s*(.*)$/.exec(line);
    if (!match) problems.push(`line ${index + 1}: not a key = value pair`);
    else entries.push({ key: match[1], value: match[2] });
  });
  return { entries, problems };
}

module.exports = { parseConfig };
