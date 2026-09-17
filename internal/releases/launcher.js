#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ReleaseService, defaultStore, locatorState } = require('./service');
const { hostProfile, parseJson, projectRoot, requireValue } = require('./io');

async function route(request, context = {}) {
  requireValue(request && typeof request.action === 'string', 'invalid-release-request', 'A retained-resource action is required');
  if (request.action === 'hook') requireValue(context.nativeHook === true, 'native-hook-required', 'Hook input belongs to the registered native hook path');
  const profile = hostProfile(request.host, request.profile);
  const locator = request.action === 'prepare' ? locatorState(profile).value : null;
  const service = new ReleaseService(context.store ?? request.store ?? locator?.store ?? defaultStore(), {}, context);
  const key = context.registration ?? request.registration;
  if (!context.registration) requireValue(['prepare', 'setup', 'status'].includes(request.action), 'retained-launcher-required', 'Use the registered cache-independent bootstrap for resource operations');
  let result;
  if (request.action === 'prepare') result = await service.prepare({ ...request, profile, registration: key });
  else if (request.action === 'setup') result = await service.setup(request);
  // Status is the documented recovery surface, so it resolves host settings against the
  // operating project like every admission path, and validates it like every other entry.
  else if (request.action === 'status') result = await service.status(key, request.session, request.project === undefined ? undefined : projectRoot(request.project));
  else if (request.action === 'resolve') {
    const resolved = await service.resolve(key, request);
    result = { registration: key, session: request.session, identity: resolved.bundle.identity, root: resolved.bundle.root, version: resolved.bundle.version };
  } else if (request.action === 'run') {
    const exit = await service.run(key, request);
    process.stdout.write(exit.stdout);
    process.stderr.write(exit.stderr);
    process.exitCode = exit.code ?? 1;
    return;
  } else if (request.action === 'hook') result = await service.hook(key, request.hookInput);
  else if (request.action === 'remove') result = await service.remove(key);
  else if (request.action === 'retire') result = service.retire(key, request);
  else if (request.action === 'recover') result = await service.recover(key, request);
  else if (request.action === 'collect') result = service.collect();
  else requireValue(false, 'unknown-release-action', 'Unknown retained-resource action');
  process.stdout.write(JSON.stringify(result, null, request.action === 'hook' ? undefined : 2) + '\n');
}

async function main() {
  const scriptName = path.basename(process.argv[1]);
  requireValue(process.argv.length === 3, 'usage', `Usage: node ${scriptName} <request.json>`);
  const file = process.argv[2];
  const bytes = fs.readFileSync(file);
  requireValue(bytes.length <= 4 * 1024 * 1024, 'invalid-release-request', 'Retained-resource request exceeds its bound');
  await route(parseJson(bytes, 'retained-resource request'));
}

if (require.main === module) main().catch(error => { process.stderr.write(JSON.stringify({ error: error.code ?? 'retained-resource-failed', message: error.message }) + '\n'); process.exitCode = 1; });
module.exports = { route };
