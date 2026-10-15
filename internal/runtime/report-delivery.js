'use strict';

function validReportDelivery(state, savedHash) {
  const delivery = state.closing?.reportDelivery;
  const recordedBy = delivery?.recordedBy;

  return Boolean(typeof savedHash === 'string' && savedHash.length > 0 && delivery && typeof delivery === 'object' && !Array.isArray(delivery) && delivery.sha256 === savedHash && typeof delivery.authority === 'string' && delivery.authority.trim().length > 0 && Number.isSafeInteger(delivery.revision) && delivery.revision >= 0 && delivery.revision <= state.revision && (recordedBy === undefined || recordedBy && ['claude', 'codex'].includes(recordedBy.host) && typeof recordedBy.session === 'string' && recordedBy.session.length > 0));
}

module.exports = { validReportDelivery };
