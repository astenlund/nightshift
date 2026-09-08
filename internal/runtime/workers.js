'use strict';

function workerIsActive(worker) {
  // Unknown or unverified activity retains ownership until it is reconciled.
  return !['complete', 'failed', 'stopped'].includes(worker.status);
}

module.exports = { workerIsActive };
