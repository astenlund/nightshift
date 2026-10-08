'use strict';

const ACTIVE_WORK = ', but authorized work may continue in this active turn under valid ownership and operation permissions';
const PREVIOUS_OPTIONAL_SUFFIX = '; automatic continuation is unavailable' + ACTIVE_WORK;
const OPTIONAL_SUFFIX = '; hook integration is unavailable' + ACTIVE_WORK;
const FAILURES = Object.freeze([
  { cause: 'Nightshift hooks are disabled', legacy: 'Nightshift hooks are disabled; enable them explicitly before using Nightshift' },
  { cause: 'Nightshift hooks were removed or changed', legacy: 'Nightshift hooks were removed or changed; reconcile them explicitly before using Nightshift' },
  { cause: 'Nightshift hooks are not trusted on this host', legacy: 'Nightshift hooks are not trusted on this host; restore native trust and reopen the session' },
]);

function optionalHookDiagnostic(cause) {
  return cause + OPTIONAL_SUFFIX;
}

function hookAdmissionAliases(reason) {
  for (const failure of FAILURES) {
    const aliases = [failure.legacy, failure.cause + PREVIOUS_OPTIONAL_SUFFIX, optionalHookDiagnostic(failure.cause)];
    if (aliases.includes(reason)) return aliases;
  }
  return [reason];
}

module.exports = { hookAdmissionAliases, optionalHookDiagnostic };
