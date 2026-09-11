'use strict';

const readline = require('node:readline');
const mode = process.env.NIGHTSHIFT_TEST_HOST_MODE ?? 'success';
const args = process.argv.slice(2);
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
const completeTurn = () => {
  send({ method: 'item/completed', params: { threadId: 'fixture-session', item: { type: 'agentMessage', text: process.env.NIGHTSHIFT_TEST_HOST_REPORT ?? 'Fixture assessment' } } });
  send({ method: 'thread/tokenUsage/updated', params: { threadId: 'fixture-session', tokenUsage: { total: { totalTokens: 17, cachedInputTokens: 8, reasoningOutputTokens: 2 } } } });
  send({ method: 'turn/completed', params: { threadId: 'fixture-session', turn: { status: 'completed' } } });
};

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
    const child = require('node:child_process').spawn(process.execPath, [__filename, '--descendant-leaf'], { stdio: 'ignore', windowsHide: true });
    require('node:fs').writeFileSync('descendant.pid', String(child.pid) + '\n');
    setInterval(() => {}, 1000);
  });
} else if (mode === 'timeout') setInterval(() => {}, 1000);
else if (mode === 'early-close') process.exitCode = 0;
else if (args.includes('--print')) {
  process.stdin.resume();
  process.stdin.on('end', () => {
    const model = mode === 'wrong-model' ? 'weaker-model' : args[args.indexOf('--model') + 1];
    if (mode === 'malformed') process.stdout.write('not-json\n');
    send({ type: 'system', subtype: 'init', session_id: 'fixture-session' });
    send({ type: 'assistant', session_id: 'fixture-session', message: { model, content: [] } });
    send({ type: 'result', session_id: 'fixture-session', subtype: 'success', is_error: mode === 'error-result', result: 'Fixture assessment', modelUsage: { [model]: { inputTokens: 2, outputTokens: 3, cacheReadInputTokens: 4, cacheCreationInputTokens: 5 } } });
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
      completeTurn();
    }
  });
}
