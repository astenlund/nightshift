const { recordFailure } = require('./attempts');

const LOOP_LIMIT = 3;

function checkForLoop(log, attempt, outputs, tokens) {
  const last = outputs.slice(-LOOP_LIMIT);
  if (last.length === LOOP_LIMIT && last.every(output => output === last[0])) {
    recordFailure(log, attempt, 'output loop');
    return true;
  }
  return false;
}

module.exports = { checkForLoop };
