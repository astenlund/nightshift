'use strict';

const { requireCondition } = require('./errors');

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

function runtimeId(value, name) {
  requireCondition(typeof value === 'string' && UUID.test(value), 'invalid-runtime-identity', `${name} needs an immutable UUID identity`);
  return value;
}

module.exports = { UUID, runtimeId };
