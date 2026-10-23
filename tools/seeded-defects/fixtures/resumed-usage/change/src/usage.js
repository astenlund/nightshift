const { lastEvent } = require('./hosts');

// Each usage event reports the session's running total.
function attemptTokens(events) {
  const usage = lastEvent(events, 'usage');
  return usage ? usage.sessionTotal : null;
}

module.exports = { attemptTokens };
