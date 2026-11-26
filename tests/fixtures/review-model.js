'use strict';

const { bundledModel } = require('../../internal/review-model');
const { reviewModelScopeDigest } = require('../../internal/runtime/review-model');

const fixtureReviewModelSha256 = reviewModelScopeDigest(bundledModel().text, null);

module.exports = { fixtureReviewModelSha256 };
