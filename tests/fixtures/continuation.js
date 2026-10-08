'use strict';

function fixtureContinuation(host = 'codex') {
  return { verified: true, kind: host === 'claude' ? 'stop-hook' : 'goal', evidence: 'Deterministic fixture supplied a simulated active continuation mechanism' };
}

module.exports = { fixtureContinuation };
