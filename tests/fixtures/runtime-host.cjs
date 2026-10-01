'use strict';

const readline = require('node:readline');
const mode = process.env.NIGHTSHIFT_TEST_HOST_MODE ?? 'success';
const args = process.argv.slice(2);
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
// A resumed thread keeps its id and reports cumulative usage: the earlier turn's total on resume, then the new turn's running total.
let thread = 'fixture-session';
let turnTotal = 17;
const completeTurn = () => {
  send({ method: 'item/completed', params: { threadId: thread, item: { type: 'agentMessage', text: process.env.NIGHTSHIFT_TEST_HOST_REPORT ?? 'Fixture assessment' } } });
  send({ method: 'thread/tokenUsage/updated', params: { threadId: thread, turnId: 'fixture-turn', tokenUsage: { total: { totalTokens: turnTotal, cachedInputTokens: 8, reasoningOutputTokens: 2 } } } });
  send({ method: 'turn/completed', params: { threadId: thread, turn: { id: 'fixture-turn', status: 'completed' } } });
};
const record = (file, value) => require('node:fs').writeFileSync(file, JSON.stringify(value) + '\n');

if (args.includes('--duplex-leaf')) {
  const bytes = Buffer.alloc(2 * 1024 * 1024, 120);
  let written = 0;
  while (written < bytes.length) written += require('node:fs').writeSync(1, bytes, written, bytes.length - written);
  let received = 0;
  const digest = require('node:crypto').createHash('sha256');
  process.stdin.on('data', data => { received += data.length; digest.update(data); });
  process.stdin.on('end', () => process.stdout.write('\nREAD:' + received + ':' + digest.digest('hex') + '\n'));
} else if (args.includes('--no-input-leaf')) {
  process.stdout.write('READY\n');
  setInterval(() => {}, 1000);
} else if (args.includes('--descendant-leaf')) setInterval(() => {}, 1000);
else if (mode === 'descendant') {
  process.stdin.resume();
  process.stdin.on('end', () => {
    // Detached, so only the Windows job, not libuv's own kill-on-close job, can end it.
    const child = require('node:child_process').spawn(process.execPath, [__filename, '--descendant-leaf'], { detached: true, stdio: 'ignore', windowsHide: true });
    require('node:fs').writeFileSync('descendant.pid', String(child.pid) + '\n');
    setInterval(() => {}, 1000);
  });
} else if (mode === 'timeout') setInterval(() => {}, 1000);
else if (mode === 'early-close') process.exitCode = 0;
else if (args.includes('--print')) {
  process.stdin.resume();
  process.stdin.on('end', () => {
    record('claude-args.json', args);
    const resumed = args.includes('--resume') ? args[args.indexOf('--resume') + 1] : null;
    if (mode === 'resume-missing') {
      process.stderr.write(`No conversation found with session ID: ${resumed}\n`);
      process.exitCode = 1;
      return;
    }
    const session = mode === 'resume-new-session' ? 'unrequested-session' : resumed ?? 'fixture-session';
    const model = mode === 'wrong-model' ? 'weaker-model' : args[args.indexOf('--model') + 1];
    if (mode === 'malformed') process.stdout.write('not-json\n');
    send({ type: 'system', subtype: 'init', session_id: session });
    send({ type: 'assistant', session_id: session, message: { model, content: [] } });
    send({ type: 'result', session_id: session, subtype: 'success', is_error: mode === 'error-result', result: 'Fixture assessment', modelUsage: { [model]: { inputTokens: 2, outputTokens: 3, cacheReadInputTokens: 4, cacheCreationInputTokens: 5 } } });
  });
} else {
  let pendingTurn;
  readline.createInterface({ input: process.stdin }).on('line', line => {
    const request = JSON.parse(line);
    if (request.id === undefined) return;
    if (request.error && request.id === pendingTurn) {
      if (request.error.code !== -32000) throw new Error('Unexpected server-request response');
      send({ id: pendingTurn, result: {} });
      completeTurn();
      return;
    }
    if (mode === 'colliding-request' && request.method === 'turn/start') {
      pendingTurn = request.id;
      send({ id: request.id, method: 'item/commandExecution/requestApproval', params: {} });
      return;
    }
    if (mode === 'request-error') { send({ id: request.id, error: { code: -32602, message: 'fixture request rejected' } }); return; }
    if (mode === 'malformed') process.stdout.write('not-json\n');
    const expectedVersion = process.env.NIGHTSHIFT_TEST_EXPECTED_VERSION;
    if (request.method === 'initialize' && expectedVersion !== undefined && request.params.clientInfo?.version !== expectedVersion) {
      send({ id: request.id, error: { code: -32602, message: 'fixture rejected client version ' + request.params.clientInfo?.version } });
      return;
    }
    if (request.method === 'thread/start') send({ id: request.id, result: { thread: { id: 'fixture-session' }, model: mode === 'wrong-model' ? 'weaker-model' : request.params.model } });
    else if (request.method === 'thread/resume') {
      record('resume-params.json', request.params);
      thread = mode === 'resume-new-session' ? 'unrequested-session' : request.params.threadId;
      // The answer and the starting usage go out in one write, as one output chunk can carry both.
      const answer = { id: request.id, result: { thread: { id: thread }, model: request.params.model, cwd: request.params.cwd } };
      const starting = { method: 'thread/tokenUsage/updated', params: { threadId: thread, turnId: 'earlier-turn', tokenUsage: { total: { totalTokens: 100 } } } };
      process.stdout.write([answer, ...(mode === 'resume-no-baseline' ? [] : [starting])].map(value => JSON.stringify(value) + '\n').join(''));
      turnTotal = 130;
    } else if (request.method === 'turn/start') send({ id: request.id, result: { turn: { id: 'fixture-turn', status: 'inProgress' } } });
    else send({ id: request.id, result: {} });
    if (request.method === 'turn/start') {
      if (mode.startsWith('reroute-')) {
        const reroute = (fromModel, toModel) => send({ method: 'model/rerouted', params: { threadId: mode === 'reroute-foreign' ? 'unrelated-session' : 'fixture-session', turnId: 'fixture-turn', fromModel, toModel, reason: 'highRiskCyberActivity' } });
        if (mode === 'reroute-return-only') reroute('other-model', 'gpt-6-astra');
        else reroute('gpt-6-astra', mode === 'reroute-same' ? 'gpt-6-astra' : 'other-model');
        if (mode === 'reroute-back') reroute('other-model', 'gpt-6-astra');
      }
      if (mode === 'missing-params') send({ method: 'item/completed' });
      if (mode === 'missing-item') send({ method: 'item/completed', params: { threadId: 'fixture-session' } });
      if (mode === 'missing-usage') send({ method: 'thread/tokenUsage/updated', params: { threadId: 'fixture-session', tokenUsage: {} } });
      const delta = text => send({ method: 'item/agentMessage/delta', params: { threadId: 'fixture-session', turnId: 'fixture-turn', itemId: 'fixture-message', delta: text } });
      if (mode === 'whitespace-loop') {
        delta('{');
        setInterval(() => delta('\n'), 5);
        return;
      }
      if (mode === 'whitespace-burst') {
        delta('{');
        for (let index = 0; index < 30; index++) delta('  ');
        delta('}');
      }
      completeTurn();
    }
  });
}
