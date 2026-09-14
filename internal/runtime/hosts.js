'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const { requireCondition } = require('./store');
const { resolveTrustedExecutable } = require('../filesystem-primitives');
const { spawnWindowsJob } = require('./windows-job');

function executable(host, root) {
  requireCondition(['codex', 'claude'].includes(host), 'unsupported-host', 'Unknown agent host');
  return resolveTrustedExecutable({ root, basename: host + (process.platform === 'win32' ? '.exe' : '') });
}

function pluginVersion() {
  const manifest = ['../../.codex-plugin/plugin.json', '../../.claude-plugin/plugin.json'].map(file => path.resolve(__dirname, file)).find(file => fs.existsSync(file));
  requireCondition(manifest !== undefined, 'plugin-manifest-missing', 'Plugin manifest not found at the plugin root');
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  } catch {
    // A corrupt manifest is reported as invalid below rather than as a bare parse error.
    parsed = null;
  }
  requireCondition(typeof parsed?.version === 'string' && parsed.version.length > 0, 'plugin-manifest-invalid', 'Plugin manifest has no readable version');
  return parsed.version;
}

function tokenTotal(usage) {
  return ['inputTokens', 'outputTokens', 'cacheReadInputTokens', 'cacheCreationInputTokens'].reduce((sum, key) => sum + (usage[key] ?? 0), 0);
}

function codexModelContradiction(event, session, expectedModel) {
  return event.method === 'model/rerouted' && event.params?.threadId === session && (event.params.fromModel !== expectedModel || event.params.toModel !== expectedModel);
}

function startProcess(file, args, options) {
  fs.mkdirSync(options.artifacts, { recursive: true });
  const launch = process.platform === 'win32' && !options.directProcess ? spawnWindowsJob : spawn;
  const child = launch(file, [...(options.commandPrefix ?? []), ...args], {
    cwd: options.cwd, shell: false, windowsHide: true,
    protectedRoot: options.protectedRoot,
    stdio: ['pipe', 'pipe', 'pipe'], env: options.env ?? process.env,
  });
  let failure = null;
  let timedOut = false;
  let resolveReady;
  let timer;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  const errors = fs.createWriteStream(path.join(options.artifacts, 'stderr.txt'), { flags: 'wx' });
  const fail = error => {
    failure ??= error;
    clearTimeout(timer);
    resolveReady();
    if (child.pid && child.exitCode === null && child.signalCode === null) child.kill();
  };
  child.on('error', fail);
  child.stdin.on('error', fail);
  child.stdout.on('error', fail);
  child.stderr.on('error', fail);
  errors.on('error', fail);
  child.stderr.pipe(errors);
  child.once('spawn', () => {
    try { options.onProcess?.(child.pid); } catch (error) { fail(error); }
    resolveReady();
  });
  const exited = new Promise(resolve => {
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolveReady();
      resolve({ code, signal, timedOut, error: failure?.message ?? null, descendantsReclaimed: child.jobEmpty ?? null, jobEvents: child.diagnostics ?? null });
    });
  });
  timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, options.timeoutMs ?? 900000);
  const finish = async () => {
    try { return await exited; } finally { clearTimeout(timer); }
  };
  return { child, ready, finish, fail, failed: () => failure !== null };
}


async function runClaude(options) {
  const args = ['--print', '--model', options.model, '--effort', options.effort ?? 'high', '--safe-mode', '--strict-mcp-config', '--no-chrome', '--permission-mode', 'dontAsk', '--permission-prompts', 'none', '--output-format', 'stream-json', '--verbose', '--system-prompt-file', options.systemFile, '--tools', 'Read,Glob,Grep', '--allowedTools', 'Read,Glob,Grep'];
  if (options.session) args.push('--resume', options.session);
  if (options.schema) args.push('--json-schema', JSON.stringify(options.schema));
  const execution = startProcess(options.executable ?? executable('claude', options.protectedRoot ?? options.cwd), args, options);
  const events = [];
  const log = fs.createWriteStream(path.join(options.artifacts, 'events.jsonl'), { flags: 'wx' });
  let malformed = false;
  readline.createInterface({ input: execution.child.stdout }).on('line', line => {
    log.write(line + '\n');
    try {
      const event = JSON.parse(line);
      events.push(event);
      if (event.type === 'system' && event.subtype === 'init') options.onSession?.(event.session_id);
    } catch { malformed = true; }
  });
  await execution.ready;
  if (!execution.failed()) execution.child.stdin.end(options.prompt);
  const exit = await execution.finish();
  await new Promise(resolve => log.end(resolve));
  const result = events.findLast(event => event.type === 'result');
  const authored = events.filter(event => event.type === 'assistant' && event.message?.model && event.message.model !== '<synthetic>');
  const attributionVerified = authored.length > 0 && authored.every(event => event.message.model === options.model && event.session_id === result?.session_id);
  const tokens = result?.modelUsage ? Object.values(result.modelUsage).reduce((sum, usage) => sum + tokenTotal(usage), 0) : null;
  return { host: 'claude', model: options.model, effort: options.effort ?? 'high', session: result?.session_id ?? null, attributionVerified, status: !malformed && !exit.error && !exit.timedOut && exit.code === 0 && result?.subtype === 'success' && result.is_error === false ? 'complete' : 'failed', output: result?.structured_output ?? result?.result ?? null, tokens, exit, events };
}

async function runCodex(options) {
  const version = pluginVersion();
  const execution = startProcess(options.executable ?? executable('codex', options.protectedRoot ?? options.cwd), ['app-server', '--stdio'], options);
  const log = fs.createWriteStream(path.join(options.artifacts, 'events.jsonl'), { flags: 'wx' });
  let sequence = 0;
  let session = null;
  let actualModel = null;
  const reroutes = [];
  let output = null;
  let tokens = null;
  let malformed = false;
  let ended = false;
  let outcome;
  let thrown;
  const pending = new Map();
  let resolveTurn;
  const turn = new Promise(resolve => { resolveTurn = resolve; });
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Host request timed out: ${method}`)); }, options.timeoutMs ?? 900000);
    pending.set(id, { resolve, reject, timer });
    execution.child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
  execution.child.once('close', () => {
    ended = true;
    for (const call of pending.values()) { clearTimeout(call.timer); call.reject(new Error('Agent host closed before returning its result')); }
    pending.clear();
    resolveTurn({ status: 'failed' });
  });
  readline.createInterface({ input: execution.child.stdout }).on('line', line => {
    try {
      log.write(line + '\n');
      const event = JSON.parse(line);
      requireCondition(event !== null && typeof event === 'object' && !Array.isArray(event), 'invalid-host-event', 'Host event must be a JSON object');
      if (event.id !== undefined && Object.hasOwn(event, 'method')) {
        execution.child.stdin.write(JSON.stringify({ id: event.id, error: { code: -32000, message: 'Read-only agent dispatch cannot approve unexpected host requests' } }) + '\n');
        return;
      }
      if (pending.has(event.id)) {
        const call = pending.get(event.id);
        pending.delete(event.id);
        clearTimeout(call.timer);
        if (event.error) call.reject(new Error(JSON.stringify(event.error)));
        else call.resolve(event.result);
      } else if (event.method === 'model/rerouted') {
        reroutes.push(event);
      } else if (event.method === 'thread/tokenUsage/updated' && event.params.threadId === session) {
        // Codex totalTokens already includes cached input and reasoning output.
        tokens = event.params.tokenUsage.total.totalTokens;
        options.onUsage?.(tokens);
      } else if (event.method === 'item/completed' && event.params.threadId === session && event.params.item.type === 'agentMessage') {
        output = event.params.item.text;
      } else if (event.method === 'turn/completed' && event.params.threadId === session) {
        resolveTurn(event.params.turn);
      }
    } catch (error) {
      malformed = true;
      execution.fail(error);
    }
  });
  try {
    await execution.ready;
    requireCondition(!execution.failed(), 'host-start-failed', 'Agent host failed to start');
    await request('initialize', { clientInfo: { name: 'nightshift', version }, capabilities: { experimentalApi: true } });
    execution.child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
    const started = await request('thread/start', { cwd: options.cwd, model: options.model, approvalPolicy: 'never', sandbox: 'read-only', allowProviderModelFallback: false, baseInstructions: fs.readFileSync(options.systemFile, 'utf8'), config: { project_doc_max_bytes: 0, model_reasoning_effort: options.effort ?? 'high', features: { multi_agent: false, plugins: false, hooks: false, apps: false } } });
    session = started.thread.id;
    options.onSession?.(session);
    actualModel = started.model;
    await request('turn/start', { threadId: session, input: [{ type: 'text', text: options.prompt }], ...(options.schema ? { outputSchema: options.schema } : {}) });
    const result = await turn;
    const finalModel = reroutes.findLast(event => event.params?.threadId === session)?.params.toModel ?? actualModel;
    const attributionVerified = actualModel === options.model && !reroutes.some(event => codexModelContradiction(event, session, options.model));
    outcome = { host: 'codex', model: finalModel, effort: options.effort ?? 'high', session, attributionVerified, status: !malformed && result.status === 'completed' ? 'complete' : 'failed', output, tokens };
    return outcome;
  } catch (error) {
    thrown = error;
    throw error;
  } finally {
    if (!ended) { execution.child.stdin.end(); execution.child.kill(); }
    const exit = await execution.finish();
    if (thrown) thrown.descendantsReclaimed = exit.descendantsReclaimed;
    if (outcome) {
      outcome.exit = exit;
      if (exit.error || exit.descendantsReclaimed === false) outcome.status = 'failed';
    }
    await new Promise(resolve => log.end(resolve));
    requireCondition(exit.descendantsReclaimed !== false, 'termination-unverified', 'The native host process tree did not provide termination evidence');
  }
}

async function runAgent(options) {
  requireCondition(options.artifacts !== options.cwd, 'invalid-dispatch', 'Agent output must be outside the reviewed project');
  fs.mkdirSync(options.artifacts, { recursive: true });
  return options.host === 'claude' ? runClaude(options) : options.host === 'codex' ? runCodex(options) : Promise.reject(new Error('Unknown host'));
}

module.exports = { codexModelContradiction, executable, pluginVersion, runAgent, runClaude, runCodex, tokenTotal };
