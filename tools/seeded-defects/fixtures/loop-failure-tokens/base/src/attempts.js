function recordSuccess(log, attempt, tokens) {
  log.push({ attempt, status: 'complete', tokens });
}

function recordFailure(log, attempt, reason) {
  log.push({ attempt, status: 'failed', reason });
}

module.exports = { recordFailure, recordSuccess };
