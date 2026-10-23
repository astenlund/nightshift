function accept(request) {
  if (request.reviewContextId) return createReview(request);
  if (!Array.isArray(request.tasks) || request.tasks.length === 0) throw new Error('a delivery needs tasks');
  return createDelivery(request);
}

function createDelivery(request) {
  return { kind: 'delivery', tasks: request.tasks, obligations: ['handover', 'closing'] };
}

function createReview(request) {
  return { kind: 'review', context: request.reviewContextId, obligations: [] };
}

module.exports = { accept };
