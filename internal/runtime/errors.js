'use strict';

class RunError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RunError';
    this.code = code;
  }
}

function requireCondition(condition, code, message) {
  if (!condition) throw new RunError(code, message);
}

function text(value, name) {
  requireCondition(typeof value === 'string' && value.trim().length > 0, 'invalid-request', `${name} must be nonempty text`);
  return value;
}

module.exports = { RunError, requireCondition, text };
