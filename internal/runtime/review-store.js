'use strict';

const { RunStore, requireCondition } = require('./store');

const { UUID } = require('./record-ids');

class ReviewStore extends RunStore {
  constructor(root, options) {
    requireCondition(typeof options?.contextId === 'string' && UUID.test(options.contextId), 'invalid-review-context', 'A standalone review context needs its immutable UUID identity');
    super(root, { ...options, review: true });
  }

  update(actor, revision, kind, change) {
    return super.update(actor, revision, kind, state => {
      if (this.ownerObservation) state.ownerObservation = this.ownerObservation;
      change(state);
    });
  }
}

module.exports = { ReviewStore, UUID };
