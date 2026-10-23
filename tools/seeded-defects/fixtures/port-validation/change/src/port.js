function describe(value) {
  try {
    return String(value);
  } catch {
    return `a value of type ${typeof value}`;
  }
}

function parsePort(text) {
  if (typeof text !== 'string' || !/^\d+$/.test(text)) throw new RangeError(`invalid port: ${describe(text)}`);
  const port = Number(text);
  if (port < 1 || port > 65535) throw new RangeError(`invalid port: ${text}`);
  return port;
}

module.exports = { parsePort };
