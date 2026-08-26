'use strict'

const SYSTEM_CODE_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/

function trustedSystemCode(error) {
  return error !== null && typeof error === 'object' && typeof error.code === 'string' && SYSTEM_CODE_PATTERN.test(error.code) ? error.code : null
}

function failureRecord(fields = {}) {
  return {
    actionId: fields.actionId ?? null,
    code: fields.code ?? 'filesystem',
    detail: fields.detail ?? 'Controller operation failed.',
    manifestId: fields.manifestId ?? null,
    ok: false,
    operation: fields.operation ?? null,
    outcomes: fields.outcomes ?? [],
    phase: fields.phase ?? 'inspect',
    protocolVersion: 1,
    recovery: fields.recovery ?? { retainedBackups: [], status: 'none', warnings: [] },
    systemCode: fields.systemCode ?? null,
    target: fields.target ?? null,
  }
}

class InitBacklogError extends Error {
  constructor(record, options = {}) {
    super(record.detail ?? record.code ?? 'Init backlog operation failed.', options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'InitBacklogError'
    this.record = record
  }
}

function throwInitBacklogError(fields, cause) {
  throw new InitBacklogError(failureRecord({ ...fields, systemCode: fields.systemCode ?? trustedSystemCode(cause) }), { cause })
}

function wrapInitBacklogError(error, fields) {
  if (error instanceof InitBacklogError) {
    throw error
  }

  throwInitBacklogError(fields, error)
}

module.exports = { InitBacklogError, failureRecord, throwInitBacklogError, trustedSystemCode, wrapInitBacklogError }
