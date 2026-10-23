const MAX_ATTEMPTS = 5;

function scheduleRetry(attempt, delayMs) {
  if (attempt >= MAX_ATTEMPTS) return null;
  return { attempt: attempt + 1, at: Date.now() + delayMs * 2 ** attempt };
}

function scheduleCheck(delayMs, name) {
  return { name, at: Date.now() + delayMs };
}

module.exports = { MAX_ATTEMPTS, scheduleCheck, scheduleRetry };
