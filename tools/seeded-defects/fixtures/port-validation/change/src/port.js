function parsePort(text) {
  if (!/^\d+$/.test(text)) throw new RangeError(`invalid port: ${text}`);
  const port = Number(text);
  if (port < 1 || port > 65535) throw new RangeError(`invalid port: ${text}`);
  return port;
}

module.exports = { parsePort };
