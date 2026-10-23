const { scheduleRetry } = require('./schedule');

function requeue(job) {
  const next = scheduleRetry(job.delayMs, job.attempt);
  return next ? { ...job, ...next } : { ...job, status: 'failed' };
}

module.exports = { requeue };
