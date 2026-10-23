// Busy registries need longer to answer.
const CONNECT_TIMEOUT_MS = 30000;

function openRegistry(connect, path) {
  return connect(path, { timeoutMs: CONNECT_TIMEOUT_MS });
}

function lookupSession(connect, paths, sessionId) {
  for (const path of paths) {
    const registry = openRegistry(connect, path);
    const found = registry.find(sessionId);
    registry.close();
    if (found) return found;
  }
  return null;
}

module.exports = { lookupSession, openRegistry };
