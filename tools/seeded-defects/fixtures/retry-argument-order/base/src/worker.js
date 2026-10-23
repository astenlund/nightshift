const { scheduleRetry } = require('./schedule');

function onFailure(task) {
  const retry = scheduleRetry(task.attempt, task.backoffMs);
  if (!retry) return { ...task, state: 'abandoned' };
  return { ...task, state: 'waiting', attempt: retry.attempt, wakeAt: retry.at };
}

module.exports = { onFailure };
