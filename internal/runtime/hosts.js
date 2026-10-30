'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const { RunError, requireCondition } = require('./store');
const { resolveTrustedExecutable } = require('../filesystem-primitives');
const { spawnWindowsJob } = require('./windows-job');
const { outputLoopDetector, outputLoopMessage } = require('./output-loop');

function executable(host, root) {
  requireCondition(['codex', 'claude', 'vibe'].includes(host), 'unsupported-host', 'Unknown agent host');
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

// A resumed Codex thread reports cumulative totals, so the attempt's own usage is its turn's last total less the thread total before
// it: the last total tagged with an earlier turn, which Codex reports on resume, or else the total recorded when the session last
// ended. Without both figures the usage is unknown rather than the whole thread's.
function resumedUsage(samples, turnId, priorThreadTokens) {
  const own = samples.filter(sample => sample.turnId === turnId).at(-1)?.total;
  const before = samples.filter(sample => sample.turnId !== turnId).at(-1)?.total ?? priorThreadTokens;

  return Number.isFinite(own) && Number.isFinite(before) && own >= before ? own - before : null;
}

function claudeInvocationTokens(usage) {
  return ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'].reduce((sum, key) => sum + (usage[key] ?? 0), 0);
}

// Claude reports modelUsage cumulatively across a resumed session, auxiliary models included, while result.usage covers only the
// invocation's main model. A resumed attempt's own usage is therefore the session total less the total recorded when the session last
// ended. It is unknown without both totals, or when the difference falls below the invocation's own usage, as it would if the host
// stopped reporting cumulatively.
function resumedClaudeUsage(threadTokens, priorThreadTokens, invocation) {
  if (!Number.isFinite(threadTokens) || !Number.isFinite(priorThreadTokens) || invocation === null || typeof invocation !== 'object') return null;
  const own = threadTokens - priorThreadTokens;

  return own >= claudeInvocationTokens(invocation) ? own : null;
}

function codexModelContradiction(event, session, expectedModel) {
  return event.method === 'model/rerouted' && event.params?.threadId === session && (event.params.fromModel !== expectedModel || event.params.toModel !== expectedModel);
}

const HOST_FAILURE_LIMIT = 2000;

// Host-reported text carried into attempt evidence, bounded so a verbose host cannot flood the record.
function boundedHostText(value) {
  return String(value).trim().slice(0, HOST_FAILURE_LIMIT);
}

function joinDetails(message, details) {
  const parts = [message, details].filter(part => part !== undefined && part !== null && String(part).trim() !== '').map(part => typeof part === 'string' ? part : JSON.stringify(part));

  return parts.length ? boundedHostText(parts.join(': ')) : null;
}

// The terminal error a Claude host reported: an error result's text with its API status and terminal reason, or, when the host produced
// no result at all, the end of its stderr.
function claudeHostFailure(result, stderr) {
  if (result?.is_error === true) {
    const context = [result.api_error_status !== undefined ? `api_error_status ${result.api_error_status}` : null, result.terminal_reason ? `terminal_reason ${result.terminal_reason}` : null].filter(Boolean);
    const text = typeof result.result === 'string' && result.result.trim() ? result.result : 'error result';

    return boundedHostText(context.length ? `${text} (${context.join(', ')})` : text);
  }
  if (!result && stderr.trim()) return boundedHostText(stderr.trim().slice(-HOST_FAILURE_LIMIT));

  return null;
}

function hostStartError(failure) {
  return new RunError('host-start-failed', `Agent host failed to start: ${failure.message}`);
}

// Unproven cleanup outranks every other host failure, which is kept in the message as its cause.
function requireReclaimed(exit, failure) {
  requireCondition(exit.descendantsReclaimed !== false, 'termination-unverified', `The native host process tree did not provide termination evidence${failure ? `; the host failed: ${failure.message}` : ''}`);
}

// A failure to write the attempt's own artifacts after the host started, such as a full disk, is the controller's infrastructure
// failing rather than the host or its session, so the attempt ends with that operating-system error once cleanup is proven.
function requireArtifactsWritten(execution, exit) {
  const failure = execution.artifactFailure();
  if (!failure) return;
  requireReclaimed(exit, failure);
  failure.descendantsReclaimed = exit.descendantsReclaimed;
  throw failure;
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
  let artifactFailure = null;
  let timedOut = false;
  // The end of the host's stderr, kept in memory so a failure can be named without waiting on the artifact file's flush.
  let stderrTail = '';
  let resolveReady;
  let timer;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  const errors = fs.createWriteStream(path.join(options.artifacts, 'stderr.txt'), { flags: 'wx' });
  // A Windows job reports its pid only once its runner starts the host, so a failure before then still requests termination; the
  // attempt timer is cleared here, and nothing else would end that host.
  const fail = error => {
    failure ??= error;
    clearTimeout(timer);
    resolveReady();
    if (child.exitCode === null && child.signalCode === null) child.kill();
  };
  // Failures of the host's own pipes can follow from the host closing them; only the attempt's artifact files are the controller's.
  const failArtifact = error => {
    artifactFailure ??= error;
    fail(error);
  };
  child.on('error', fail);
  child.stdin.on('error', fail);
  child.stdout.on('error', fail);
  child.stderr.on('error', fail);
  errors.on('error', failArtifact);
  child.stderr.pipe(errors);
  child.stderr.on('data', chunk => { stderrTail = (stderrTail + chunk.toString('utf8')).slice(-HOST_FAILURE_LIMIT); });
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
  return { child, ready, finish, fail, failArtifact, failure: () => failure, artifactFailure: () => artifactFailure, stderrTail: () => stderrTail };
}

function eventLog(execution, artifacts) {
  const log = fs.createWriteStream(path.join(artifacts, 'events.jsonl'), { flags: 'wx' });
  log.on('error', execution.failArtifact);
  return log;
}


async function runClaude(options) {
  const args = ['--print', '--model', options.model, '--effort', options.effort ?? 'high', '--safe-mode', '--strict-mcp-config', '--no-chrome', '--permission-mode', 'dontAsk', '--permission-prompts', 'none', '--output-format', 'stream-json', '--verbose', '--system-prompt-file', options.systemFile, '--tools', 'Read,Glob,Grep', '--allowedTools', 'Read,Glob,Grep'];
  if (options.session) args.push('--resume', options.session);
  if (options.schema) args.push('--json-schema', JSON.stringify(options.schema));
  const execution = startProcess(options.executable ?? executable('claude', options.protectedRoot ?? options.cwd), args, options);
  const events = [];
  const log = eventLog(execution, options.artifacts);
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
  const startFailure = execution.failure();
  if (!startFailure) execution.child.stdin.end(options.prompt);
  const exit = await execution.finish();
  await new Promise(resolve => log.end(resolve));
  const result = events.findLast(event => event.type === 'result');
  const hostFailure = claudeHostFailure(result, execution.stderrTail());
  try {
    if (startFailure) {
      requireReclaimed(exit, startFailure);
      const error = hostStartError(startFailure);
      error.descendantsReclaimed = exit.descendantsReclaimed;
      throw error;
    }
    requireArtifactsWritten(execution, exit);
  } catch (error) {
    error.hostFailure = hostFailure;
    throw error;
  }
  const authored = events.filter(event => event.type === 'assistant' && event.message?.model && event.message.model !== '<synthetic>');
  // A resumed attempt is attributable only when the host continued the session it was asked to resume.
  const continuedSession = !options.session || result?.session_id === options.session;
  const attributionVerified = continuedSession && authored.length > 0 && authored.every(event => event.message.model === options.model && event.session_id === result?.session_id);
  const threadTokens = result?.modelUsage ? Object.values(result.modelUsage).reduce((sum, usage) => sum + tokenTotal(usage), 0) : null;
  const tokens = !options.session ? threadTokens : continuedSession ? resumedClaudeUsage(threadTokens, options.priorThreadTokens, result.usage) : null;

  return { host: 'claude', model: options.model, effort: options.effort ?? 'high', session: result?.session_id ?? null, attributionVerified, status: !malformed && !exit.error && !exit.timedOut && exit.code === 0 && result?.subtype === 'success' && result.is_error === false ? 'complete' : 'failed', output: result?.structured_output ?? result?.result ?? null, tokens, threadTokens, hostFailure, exit, events };
}

async function runCodex(options) {
  const version = pluginVersion();
  const execution = startProcess(options.executable ?? executable('codex', options.protectedRoot ?? options.cwd), ['app-server', '--stdio'], options);
  const log = eventLog(execution, options.artifacts);
  let startFailure = null;
  let sequence = 0;
  let session = null;
  let actualModel = null;
  const reroutes = [];
  let output = null;
  let tokens = null;
  // Codex reports the thread's cumulative total, tagged with the turn it belongs to.
  const usage = [];
  let turnId = null;
  const attemptUsage = () => options.session ? resumedUsage(usage, turnId, options.priorThreadTokens) : tokens;
  let malformed = false;
  let ended = false;
  let outcome;
  let thrown;
  let outputLoop = null;
  const detectOutputLoop = outputLoopDetector(options.outputLoop);
  // The failures the host itself reported, in order of preference: a failed turn, an error notification for the thread, and an error
  // response to one of this attempt's own requests. An error the host meant to retry names the failure only when no turn completed, as
  // when the attempt ended mid-retry; after a completed turn it was recovered from.
  let turnFailure = null;
  let notifiedFailure = null;
  let requestFailure = null;
  let retriedFailure = null;
  let turnCompleted = false;
  const hostFailure = () => turnFailure ?? notifiedFailure ?? requestFailure ?? (turnCompleted ? null : retriedFailure);
  const pending = new Map();
  let resolveTurn;
  const turn = new Promise(resolve => { resolveTurn = resolve; });
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Host request timed out: ${method}`)); }, options.timeoutMs ?? 900000);
    pending.set(id, { method, resolve, reject, timer });
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
        if (event.error) {
          // The host's own text is carried once, as the attempt's host-reported failure.
          requestFailure ??= joinDetails(event.error.message ?? JSON.stringify(event.error), event.error.data);
          call.reject(new Error(`Host request ${call.method} failed`));
        } else call.resolve(event.result);
      } else if (event.method === 'error' && event.params?.threadId === session && event.params.error) {
        const reported = joinDetails(event.params.error.message, event.params.error.additionalDetails);
        if (event.params.willRetry === true) retriedFailure = reported;
        else notifiedFailure = reported;
      } else if (event.method === 'model/rerouted') {
        reroutes.push(event);
      } else if (event.method === 'thread/tokenUsage/updated' && event.params.threadId === session) {
        // Codex totalTokens already includes cached input and reasoning output.
        tokens = event.params.tokenUsage.total.totalTokens;
        usage.push({ turnId: event.params.turnId ?? null, total: tokens });
        options.onUsage?.(tokens);
      } else if (event.method === 'item/agentMessage/delta' && event.params.threadId === session && typeof event.params.delta === 'string' && !outputLoop) {
        outputLoop = detectOutputLoop({ itemId: event.params.itemId, delta: event.params.delta, at: Date.now() });
        if (outputLoop) execution.fail(new RunError('output-loop', outputLoopMessage(outputLoop)));
      } else if (event.method === 'item/completed' && event.params.threadId === session && event.params.item.type === 'agentMessage') {
        output = event.params.item.text;
      } else if (event.method === 'turn/completed' && event.params.threadId === session) {
        turnCompleted = true;
        if (event.params.turn?.status === 'failed' && event.params.turn.error) turnFailure = joinDetails(event.params.turn.error.message, event.params.turn.error.additionalDetails);
        resolveTurn(event.params.turn);
      }
    } catch (error) {
      malformed = true;
      execution.fail(error);
    }
  });
  try {
    await execution.ready;
    startFailure = execution.failure();
    if (startFailure) throw hostStartError(startFailure);
    await request('initialize', { clientInfo: { name: 'nightshift', version }, capabilities: { experimentalApi: true } });
    execution.child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
    const thread = { cwd: options.cwd, model: options.model, approvalPolicy: 'never', sandbox: 'read-only', baseInstructions: fs.readFileSync(options.systemFile, 'utf8'), config: { project_doc_max_bytes: 0, model_reasoning_effort: options.effort ?? 'high', features: { multi_agent: false, plugins: false, hooks: false, apps: false } } };
    // A resumed thread keeps its history but takes the new copy as its working directory and the same read-only policy. Its id is
    // known before the host answers, so usage the host reports in the same output as its answer is not dropped.
    if (options.session) session = options.session;
    const started = options.session
      ? await request('thread/resume', { ...thread, threadId: options.session, excludeTurns: true })
      : await request('thread/start', { ...thread, allowProviderModelFallback: false });
    session = started.thread.id;
    options.onSession?.(session);
    actualModel = started.model;
    const turnStarted = await request('turn/start', { threadId: session, input: [{ type: 'text', text: options.prompt }], ...(options.schema ? { outputSchema: options.schema } : {}) });
    turnId = turnStarted?.turn?.id ?? null;
    const result = await turn;
    turnId ??= result.id ?? null;
    requireCondition(!outputLoop, 'output-loop', outputLoop && outputLoopMessage(outputLoop));
    const finalModel = reroutes.findLast(event => event.params?.threadId === session)?.params.toModel ?? actualModel;
    const continuedSession = !options.session || session === options.session;
    const attributionVerified = continuedSession && actualModel === options.model && !reroutes.some(event => codexModelContradiction(event, session, options.model));
    outcome = { host: 'codex', model: finalModel, effort: options.effort ?? 'high', session, attributionVerified, status: !malformed && result.status === 'completed' ? 'complete' : 'failed', output, tokens: attemptUsage(), threadTokens: tokens, hostFailure: hostFailure() };
    return outcome;
  } catch (error) {
    thrown = error;
    throw error;
  } finally {
    if (!ended) { execution.child.stdin.end(); execution.child.kill(); }
    const exit = await execution.finish();
    // Usage the host reported before the attempt failed, as when it ended as an output loop, was spent all the same.
    if (thrown) Object.assign(thrown, { descendantsReclaimed: exit.descendantsReclaimed, tokens: attemptUsage(), hostFailure: hostFailure() });
    if (outcome) {
      outcome.exit = exit;
      if (exit.error || exit.descendantsReclaimed === false) outcome.status = 'failed';
    }
    await new Promise(resolve => log.end(resolve));
    try {
      requireReclaimed(exit, execution.failure());
      // An artifact failure replaces the closed-host error or failed turn it caused; one before the host started stays a start failure.
      if (!startFailure) requireArtifactsWritten(execution, exit);
    } catch (error) {
      Object.assign(error, { tokens: attemptUsage(), hostFailure: hostFailure() });
      throw error;
    }
  }
}

// The failure a Vibe attempt reported: the error export.json records, else the end of stderr.
function vibeHostFailure(summary, stderr) {
  const error = summary?.error;
  if (error && typeof error === 'object' && typeof error.message === 'string' && error.message.trim()) return boundedHostText(error.code ? `${error.message} (${error.code})` : error.message);
  if (typeof error === 'string' && error.trim()) return boundedHostText(error);

  return stderr.trim() ? boundedHostText(stderr.trim().slice(-HOST_FAILURE_LIMIT)) : null;
}

// Runs one lead assessment on Mistral Vibe, headless in the dispatch's private copy, under the isolation in vibe.js. Vibe has no
// structured-output option, so the report schema is stated in the prompt, and it cannot resume into a new copy, so it never resumes.
// Its JSON output exposes no partial output, so like Claude attempts its attempts are not checked for output loops.
async function runVibe(options) {
  const vibe = require('./vibe');
  const file = options.executable ?? executable('vibe', options.protectedRoot ?? options.cwd);
  // CLI dispatches retain their eligibility observation; direct callers establish their version anchor here.
  const launchVersion = (options.readVibeVersion ?? vibe.readVersion)(file);
  const preflight = options.vibePreflight;
  const preflighted = preflight !== undefined;
  requireCondition(!preflighted || preflight !== null && typeof preflight === 'object' && !Array.isArray(preflight) && Object.hasOwn(preflight, 'version') && vibe.versionSupported(preflight.version), 'unusable-review', 'The Vibe eligibility version observation is unavailable or invalid');
  const version = preflighted ? preflight.version : launchVersion;
  requireCondition(vibe.versionSupported(launchVersion), preflighted ? 'unusable-review' : 'vibe-version-unsupported', `Vibe ${launchVersion ?? 'of unreadable version'} is below the supported floor ${vibe.VERSION_FLOOR.join('.')}`);
  requireCondition(Object.hasOwn(vibe.MODELS, options.model), 'vibe-model-unknown', `The Vibe launcher has no entry for ${options.model}`);
  requireCondition(!options.session, 'resume-unsupported', 'A Vibe session cannot be resumed into a new private copy; replace the reviewer with review.replaces');
  const level = vibe.effortLevel(options.model, options.effort);
  const isolation = vibe.createIsolation(options.artifacts, options.model, level, fs.readFileSync(options.systemFile, 'utf8'));
  const promptFile = path.join(options.artifacts, 'prompt.md');
  fs.writeFileSync(promptFile, `${options.prompt}\nReply with only one JSON object that conforms to this JSON schema, with no other text:\n${JSON.stringify(options.schema)}\n`, { flag: 'wx' });
  const exportDirectory = path.join(options.artifacts, 'vibe');
  const timeLimit = Math.max(60, Math.floor((options.timeoutMs ?? 900000) / 1000) - 60);
  const args = ['--workdir', options.cwd, '--agent', vibe.AGENT, '--prompt-file', promptFile, '--output', 'json', '--output-dir', exportDirectory, '--time-limit', String(timeLimit), ...vibe.TOOLS.flatMap(tool => ['--enabled-tools', tool])];
  const execution = startProcess(file, args, { ...options, env: vibe.environment(options.env ?? process.env, isolation) });
  const stdout = [];
  let received = 0;
  let overflowed = false;
  execution.child.stdout.on('data', chunk => {
    if (overflowed) return;
    received += chunk.length;
    if (received > vibe.OUTPUT_LIMIT) {
      overflowed = true;
      execution.child.kill();

      return;
    }
    stdout.push(chunk);
  });
  await execution.ready;
  const startFailure = execution.failure();
  if (!startFailure) execution.child.stdin.end();
  const exit = await execution.finish();
  let tokens = null;
  let hostFailure = null;
  const record = { version, uncomparedKeys: [], attributionFiles: [] };
  try {
    let entries = null;
    try {
      entries = JSON.parse(Buffer.concat(stdout).toString('utf8'));
    } catch {
      // Unparsable output leaves no assessment; the attempt fails below.
    }
    try {
      fs.writeFileSync(path.join(options.artifacts, 'events.jsonl'), (Array.isArray(entries) ? entries.map(entry => JSON.stringify(entry)) : []).join('\n') + '\n', { flag: 'wx' });
    } catch (error) {
      execution.failArtifact(error);
    }
    const summary = vibe.readJsonIfPresent(path.join(exportDirectory, 'export.json'));
    tokens = Number.isSafeInteger(summary?.usage?.total_tokens) && summary.usage.total_tokens >= 0 ? summary.usage.total_tokens : null;
    hostFailure = overflowed ? `Vibe's output passed ${vibe.OUTPUT_LIMIT} bytes, so the process was stopped` : vibeHostFailure(summary, execution.stderrTail());
    const { exportFile, states } = vibe.journalFiles(exportDirectory);
    record.attributionFiles = [exportFile, ...states];
    const session = typeof summary?.session_id === 'string' && summary.session_id ? summary.session_id : null;
    if (session) options.onSession?.(session);
    if (startFailure) {
      requireReclaimed(exit, startFailure);
      throw hostStartError(startFailure);
    }
    requireArtifactsWritten(execution, exit);
    const finished = !overflowed && !exit.error && !exit.timedOut && exit.code === 0 && summary?.outcome === 'finished';
    if (finished) {
      const { differing, uncompared } = vibe.configurationDifferences(summary.config ?? null, options.model, level);
      record.uncomparedKeys = uncompared;
      if (summary.vibe_version !== version || launchVersion !== version) throw new RunError('unusable-review', `Vibe recorded version ${summary.vibe_version ?? 'none'} after launching as ${launchVersion}; expected version ${version}`);
      if (differing.length > 0) throw new RunError('unusable-review', `Vibe's effective configuration differs from the launcher's at ${differing.join(', ')}`);
    }

    return { host: 'vibe', model: options.model, effort: level, session, attributionVerified: session !== null && vibe.journalModel(states) === options.model, status: finished ? 'complete' : 'failed', output: vibe.reportFromEntries(entries), tokens, threadTokens: tokens, hostFailure: finished ? null : hostFailure, exit, vibe: record };
  } catch (error) {
    const failure = error instanceof Error ? new RunError(error.code ?? 'unusable-review', error.message) : new RunError('unusable-review', String(error));
    throw Object.assign(failure, error instanceof Error ? error : {}, { cause: error, descendantsReclaimed: exit.descendantsReclaimed, tokens, hostFailure, vibe: record });
  }
}

async function runAgent(options) {
  requireCondition(options.artifacts !== options.cwd, 'invalid-dispatch', 'Agent output must be outside the reviewed project');
  fs.mkdirSync(options.artifacts, { recursive: true });
  const run = { claude: runClaude, codex: runCodex, vibe: runVibe }[options.host];
  return run ? run(options) : Promise.reject(new Error('Unknown host'));
}

module.exports = { boundedHostText, codexModelContradiction, executable, pluginVersion, resumedUsage, runAgent, runClaude, runCodex, runVibe, tokenTotal };
