'use strict';

// The statuses a delivery run or standalone review context can hold. `closed` is terminal: the user dropped the record's remaining
// obligations through the administrative close action, which is distinct from discharging them through `complete`.
const RECORD_STATUSES = Object.freeze(['running', 'stopped', 'complete', 'closed']);

function isRecordStatus(status) { return RECORD_STATUSES.includes(status); }

function isClosed(state) { return state?.status === 'closed'; }

// A record nothing further can happen to in the current release: completed, or closed by the user.
function isFinished(state) { return state?.status === 'complete' || state?.status === 'closed'; }

module.exports = { RECORD_STATUSES, isClosed, isFinished, isRecordStatus };
