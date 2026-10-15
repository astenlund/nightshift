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

function requireBound(condition, code, message) {
  if (condition) return;
  const error = new RunError(code, message);
  error.limitExceeded = true;
  throw error;
}

function text(value, name) {
  requireCondition(typeof value === 'string' && value.trim().length > 0, 'invalid-request', `${name} must be nonempty text`);
  return value;
}

module.exports = { RunError, requireBound, requireCondition, text };
