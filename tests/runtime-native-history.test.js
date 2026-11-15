'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const test = require('node:test');
const { readAssistantMessages } = require('../internal/runtime/native-history');

const scratch = path.resolve(__dirname, '../.tmp/native-history-tests');
fs.mkdirSync(scratch, { recursive: true });
const TEXT = 'Visible fixture assistant text.';

function fixture(t, host = 'codex') {
  const directory = fs.mkdtempSync(path.join(scratch, 'case-'));
  const root = path.join(directory, 'project');
  const profile = path.join(directory, 'profile');
  fs.mkdirSync(root);
  fs.mkdirSync(profile);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const controller = { host, session: randomUUID() };
  const state = { id: randomUUID(), root: fs.realpathSync.native(root), controller };
  return { profile: fs.realpathSync.native(profile), state };
}

function historyFile(value) {
  const { state, profile } = value;
  return state.controller.host === 'claude'
    ? path.join(profile, 'projects', state.root.replace(/[^a-zA-Z0-9]/g, '-'), state.controller.session + '.jsonl')
    : path.join(profile, 'sessions/2026/10/07', 'rollout-fixture-' + state.controller.session + '.jsonl');
}

function messageRow(value, overrides = {}, text = TEXT) {
  const { state } = value;
  const timestamp = new Date().toISOString();
  return state.controller.host === 'claude'
    ? { type: 'assistant', sessionId: state.controller.session, cwd: state.root, uuid: randomUUID(), timestamp, isSidechain: false, message: { role: 'assistant', model: 'fixture-model', content: [{ type: 'text', text }] }, ...overrides }
    : { type: 'response_item', timestamp, payload: { type: 'message', id: randomUUID(), role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text }] }, ...overrides };
}

function nativeFile(value, overrides = {}) {
  const file = historyFile(value);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const rows = value.state.controller.host === 'codex' ? [{ type: 'session_meta', payload: { id: value.state.controller.session, cwd: value.state.root } }, messageRow(value, overrides)] : [messageRow(value, overrides)];
  fs.writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  return file;
}

const readMessages = (value, bounds) => readAssistantMessages(value.state, value.profile, bounds);
const UNAVAILABLE = { code: 'native-history-unavailable' };

for (const host of ['claude', 'codex']) {
  test(`${host} native visible assistant output is read with its attribution`, t => {
    // Arrange
    const value = fixture(t, host);
    nativeFile(value);

    // Act
    const messages = readMessages(value);

    // Assert
    assert.equal(messages.length, 1);
    assert.equal(messages[0].text, TEXT);
    assert.match(messages[0].hash, /^[a-f0-9]{64}$/);
  });
}

test('a Claude thinking block is never read as visible text, alone or beside a text block', t => {
  // Arrange
  const thinking = 'Fixture text held only in a thinking block.';
  const alone = fixture(t, 'claude');
  nativeFile(alone, { message: { role: 'assistant', model: 'fixture-model', content: [{ type: 'thinking', thinking }] } });
  const mixed = fixture(t, 'claude');
  nativeFile(mixed, { message: { role: 'assistant', model: 'fixture-model', content: [{ type: 'thinking', thinking }, { type: 'text', text: TEXT }] } });

  // Act
  const aloneTexts = readMessages(alone).map(message => message.text);
  const mixedTexts = readMessages(mixed).map(message => message.text);

  // Assert
  assert.equal(aloneTexts.some(text => text.includes(thinking)), false);
  assert.deepEqual(mixedTexts, [TEXT]);
});

for (const variant of ['user', 'analysis', 'synthetic', 'sidechain']) {
  test(`native ${variant} output is not read as visible assistant output`, t => {
    // Arrange
    const host = ['synthetic', 'sidechain'].includes(variant) ? 'claude' : 'codex';
    const value = fixture(t, host);
    const overrides = variant === 'synthetic' ? { message: { role: 'assistant', model: '<synthetic>', content: [{ type: 'text', text: TEXT }] } }
      : variant === 'sidechain' ? { isSidechain: true }
      : { payload: { type: 'message', role: variant === 'user' ? 'user' : 'assistant', phase: variant === 'analysis' ? 'analysis' : 'commentary', content: [{ type: 'output_text', text: TEXT }] } };
    nativeFile(value, overrides);

    // Act and assert
    assert.deepEqual(readMessages(value), []);
  });
}

for (const variant of ['bom', 'malformed', 'wrong-session']) {
  test(`native ${variant} history is unavailable`, t => {
    // Arrange
    const value = fixture(t);
    const file = nativeFile(value);
    if (variant === 'bom') fs.writeFileSync(file, Buffer.concat([Buffer.from([239, 187, 191]), fs.readFileSync(file)]));
    if (variant === 'malformed') fs.appendFileSync(file, '{broken}\n');
    if (variant === 'wrong-session') fs.writeFileSync(file, JSON.stringify({ type: 'session_meta', payload: { id: randomUUID(), cwd: value.state.root } }) + '\n');

    // Act and assert
    assert.throws(() => readMessages(value), UNAVAILABLE);
  });
}

for (const host of ['claude', 'codex']) {
  test(`${host} missing history is unavailable`, t => {
    // Arrange
    const value = fixture(t, host);

    // Act and assert
    assert.throws(() => readMessages(value), UNAVAILABLE);
  });

  test(`${host} invalid UTF-8 inside a complete line is unavailable history, in a whole read and in a window read`, t => {
    // Arrange
    const whole = fixture(t, host);
    const wholeFile = nativeFile(whole);
    fs.appendFileSync(wholeFile, Buffer.concat([Buffer.from('{"type":"filler","pad":"'), Buffer.from([255]), Buffer.from('"}\n')]));
    const windowed = fixture(t, host);
    const windowedFile = sizedNativeFile(windowed, { before: 3 * SMALL.windowBytes, after: 512 });
    fs.appendFileSync(windowedFile, Buffer.concat([Buffer.from('{"type":"filler","pad":"'), Buffer.from([255]), Buffer.from('"}\n')]));

    // Act and assert
    assert.throws(() => readMessages(whole), UNAVAILABLE);
    assert.throws(() => readMessages(windowed, SMALL), UNAVAILABLE);
  });

  test(`${host} reads a message followed by an unfinished final line holding an invalid byte and half-written JSON`, t => {
    // Arrange
    const value = fixture(t, host);
    const file = nativeFile(value);
    fs.appendFileSync(file, Buffer.concat([Buffer.from('{"type":"assistant","pad":"'), Buffer.from([255])]));

    // Act
    const messages = readMessages(value);

    // Assert
    assert.equal(messages.length, 1);
    assert.equal(messages[0].text, TEXT);
  });
}

// Fixture bounds that make a small history stand in for one past the real 64 MiB window.
const SMALL = { windowBytes: 4096, firstLineBytes: 1024 };

// A history whose message row sits after `before` filler bytes and before `after` filler bytes, written as raw lines so a test can
// place an invalid byte or a BOM where the window does not reach.
function sizedNativeFile(value, { before = 0, after = 0, prefix = Buffer.alloc(0), metaPad = 0, messageId = randomUUID() } = {}) {
  const { state } = value;
  const row = state.controller.host === 'claude' ? messageRow(value) : messageRow(value, { payload: { type: 'message', ...(messageId ? { id: messageId } : {}), role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: TEXT }] } });
  const filler = bytes => {
    const lines = [];
    for (let total = 0, index = 0; total < bytes; index++) {
      const line = JSON.stringify({ type: 'filler', index, pad: 'x'.repeat(200) }) + '\n';
      lines.push(line);
      total += line.length;
    }
    return lines.join('');
  };
  const meta = state.controller.host === 'codex' ? JSON.stringify({ type: 'session_meta', payload: { id: state.controller.session, cwd: state.root, pad: 'm'.repeat(metaPad) } }) + '\n' : '';
  const file = historyFile(value);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([Buffer.from(meta), prefix, Buffer.from(filler(before) + JSON.stringify(row) + '\n' + filler(after))]));
  return file;
}

for (const host of ['claude', 'codex']) {
  test(`${host} reads a recent message in the final window of a history past the read bound`, t => {
    // Arrange
    const value = fixture(t, host);
    const file = sizedNativeFile(value, { before: 5 * SMALL.windowBytes, after: 512 });

    // Act
    const messages = readMessages(value, SMALL);

    // Assert
    assert.ok(fs.statSync(file).size > 5 * SMALL.windowBytes);
    assert.equal(messages.length, 1);
  });

  test(`${host} leaves a message before the window unread rather than reporting the history unavailable`, t => {
    // Arrange
    const value = fixture(t, host);
    sizedNativeFile(value, { before: 512, after: 3 * SMALL.windowBytes });

    // Act and assert
    assert.deepEqual(readMessages(value, SMALL), []);
  });

  test(`${host} checks encoding over the bytes it reads: an invalid byte before the window passes, a BOM at the start does not`, t => {
    // Arrange
    const invalid = fixture(t, host);
    sizedNativeFile(invalid, { prefix: Buffer.from([255, 10]), before: 3 * SMALL.windowBytes });
    const bom = fixture(t, host);
    const file = sizedNativeFile(bom, { before: 3 * SMALL.windowBytes });
    fs.writeFileSync(file, Buffer.concat([Buffer.from([239, 187, 191]), fs.readFileSync(file)]));

    // Act and assert
    assert.equal(readMessages(invalid, SMALL).length, 1);
    assert.throws(() => readMessages(bom, SMALL), { code: 'native-history-unavailable' });
  });
}

test('an oversized Codex rollout whose first line exceeds its bound is unavailable history', t => {
  // Arrange
  const value = fixture(t, 'codex');
  sizedNativeFile(value, { metaPad: 2 * SMALL.firstLineBytes, before: 3 * SMALL.windowBytes });

  // Act and assert
  assert.throws(() => readMessages(value, SMALL), { code: 'native-history-unavailable', message: /first line exceeds/ });
});

test('a Codex message without its own id keeps its byte-offset identity across a whole read and a tail read after growth', t => {
  // Arrange
  const value = fixture(t, 'codex');
  const file = sizedNativeFile(value, { before: 1024, messageId: null });

  // Act
  const [whole] = readMessages(value);
  fs.appendFileSync(file, Array.from({ length: 40 }, (_, index) => JSON.stringify({ type: 'filler', index, pad: 'y'.repeat(200) }) + '\n').join(''));
  const [tail] = readMessages(value, { windowBytes: fs.statSync(file).size - 512, firstLineBytes: SMALL.firstLineBytes });

  // Assert
  assert.match(whole.id, /^offset:\d+$/);
  assert.equal(tail.id, whole.id);
  assert.equal(tail.hash, whole.hash);
});
