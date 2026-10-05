'use strict';

const { ReleaseService, locatorState, readRun } = require('./service');
const { registrationKey } = require('./registry');
const { hostProfile, requireValue } = require('./io');

// The service a bundled notice hook uses: a hook's registry connections keep the hook wait bound.
function noticeService(store) {
  return new ReleaseService(store, {}, { nativeHook: true });
}

async function handleNotice(input, host, dependencies = {}) {
  if (!input?.cwd || !input.session_id || !['codex', 'claude'].includes(host)) return {};
  let run;
  let registration;
  try {
    const root = require('../runtime/hook').projectRoot(input.cwd);
    // A hook's preliminary run read keeps its earlier bound and does not wait for a commit in progress.
    run = root && readRun(root, undefined, 0);
    // A setup notice must not turn an unrelated session's activation failure into
    // a warning through the sibling hook path.
    if (run?.controller?.session !== input.session_id || run.status !== 'running') return {};
    const profile = hostProfile(host, dependencies.profile);
    const key = registrationKey(host, profile);
    const locator = locatorState(profile).value;
    requireValue(locator?.state === 'registered' && locator.registration === key, 'release-setup-required', 'The host resource locator is missing or does not match this profile');
    const service = (dependencies.createService ?? noticeService)(locator.store);
    registration = service.registration(key);
    const status = await service.status(key, input.session_id, root);
    if (status.activationUsable) return {};
  } catch { /* The owned run receives a prerequisite diagnosis, never mutation. */ }
  return run?.controller?.session === input.session_id && run.status === 'running'
    ? { systemMessage: `Nightshift host setup or native activation is unavailable. Saved work remains incomplete; use the retained launcher${registration ? ` ${registration.bootstrap}` : ' after host setup'} to reconcile its resources. Bundled notices do not provide continuation.` }
    : {};
}

module.exports = { handleNotice, noticeService };
