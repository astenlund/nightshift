function createDelivery(request) {
  return { kind: 'delivery', tasks: request.tasks, obligations: ['handover', 'closing'] };
}

function createReview(request) {
  return { kind: 'review', context: request.reviewContextId, obligations: [] };
}

module.exports = { createDelivery, createReview };
