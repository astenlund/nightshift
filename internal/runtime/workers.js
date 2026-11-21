'use strict';

function workerIsActive(worker) {
  // Unknown or unverified activity retains ownership until it is reconciled.
  // An entry that is not an object cannot show a terminal status, so it reads as active too.
  return !(worker && typeof worker === 'object' && ['complete', 'failed', 'stopped'].includes(worker.status));
}

module.exports = { workerIsActive };
