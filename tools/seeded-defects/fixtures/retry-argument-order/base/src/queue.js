const { scheduleRetry } = require('./schedule');

function requeue(job) {
  const next = scheduleRetry(job.attempt, job.delayMs);
  return next ? { ...job, ...next } : { ...job, status: 'failed' };
}

module.exports = { requeue };
