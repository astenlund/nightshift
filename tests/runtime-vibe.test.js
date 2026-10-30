'use strict';

const { fixtureContinuation } = require('./fixtures/continuation');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { DIMENSIONS, obligationBrief, reviewGate } = require('../internal/runtime/lifecycle');
const { RunStore } = require('../internal/runtime/store');
const { hash } = require('../internal/runtime/evidence');
const { readReceipt, validateRequest } = require('../internal/runtime/review');
const { runVibe } = require('../internal/runtime/hosts');
const { ownTokens } = require('../tools/fortnight');
const { closureRoute } = require('../internal/runtime/continuation');
const { OPERATION_EXIT_MARGIN_MS, requireDispatchFits } = require('../internal/runtime/limits');
const vibe = require('../internal/runtime/vibe');
const { FIXED_SHAPE_KEYS, PROVIDER_DEFAULTS } = require('../internal/runtime/vibe-config');
const { fixtureControllerClaim, executeWithFixtureController } = require('./fixtures/controller-claim');

const actor = { host: 'claude', session: 'controller' };
const GLM = { host: 'vibe', model: 'glm-5-3', effort: 'high' };
const SOL = { host: 'codex', model: 'gpt-6-sol', effort: 'high' };
const OPUS = { host: 'claude', model: 'claude-opus-5-5', effort: 'high' };
const FAKE_VIBE = path.join(__dirname, 'fixtures/fake-vibe.cjs');

function scratch(t, name) {
  const parent = path.resolve(__dirname, '../.tmp/vibe-tests');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, `${name}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

// The effective configuration a clean isolated run records: every compared key at its expected value, the active model's and its
// provider's entries as the launcher writes them, and allowlisted keys at their defaults.
function cleanConfig(model = 'glm-5-3', level = 'high') {
  const entry = vibe.MODELS[model];
  return {
    ...structuredClone(vibe.expectedConfiguration(model)), enable_update_checks: true, log_level: null, theme: 'auto',
    models: {
      'mistral-medium-3.5': { name: 'mistral-vibe-cli-latest', provider: 'mistral', alias: 'mistral-medium-3.5', thinking: 'high', thinking_levels: ['off', 'high'] },
      [model]: { name: entry.name, provider: entry.provider, alias: model, display_name: null, temperature: entry.temperature, top_p: null, max_output_tokens: null, input_price: entry.input_price, output_price: entry.output_price, cached_input_price: null, thinking: level, thinking_levels: [...entry.levels], supports_images: false, max_context_length: null, auto_compact_threshold: entry.auto_compact_threshold },
    },
    providers: [{ ...PROVIDER_DEFAULTS.mistral }, { name: 'llamacpp', api_base: 'http://127.0.0.1:8080/v1' }],
  };
}

const REPORT = { requestId: 'r', status: 'complete', coverage: [], findings: [], probes: [], summary: 'Fixture', toolFailure: '', closures: [], positions: [] };

// Runs the real launcher against the fake Vibe executable, with an inherited environment carrying variables the reviewer must not see.
async function launch(t, { control = {}, effort = 'high', model = 'glm-5-3', installed = '3.0.0', preflight } = {}) {
  const root = scratch(t, 'launch');
  const cwd = path.join(root, 'copy');
  const artifacts = path.join(root, 'attempt');
  fs.mkdirSync(cwd);
  fs.mkdirSync(artifacts);
  const systemFile = path.join(root, 'system.md');
  fs.writeFileSync(systemFile, 'You are an independent read-only engineering assessor.');
  fs.writeFileSync(path.join(artifacts, 'control.json'), JSON.stringify({ model, config: Object.hasOwn(vibe.MODELS, model) ? cleanConfig(model, vibe.effortLevel(model, effort)) : {}, report: REPORT, ...control }));
  const env = { ...process.env, VIBE_ACTIVE_MODEL: 'mistral-medium-3.5', VIBE_HOME: path.join(root, 'user-vibe'), ENABLE: 'true', SAVE_DIR: path.join(root, 'elsewhere'), MISTRAL_API_KEY: 'fixture-key' };
  const options = { host: 'vibe', model, effort, cwd, protectedRoot: root, artifacts, systemFile, prompt: 'Fixture assessment', schema: { type: 'object' }, timeoutMs: 30000, executable: process.execPath, commandPrefix: [FAKE_VIBE], directProcess: true, readVibeVersion: () => installed, vibePreflight: preflight, env };
  let result = null;
  let error = null;
  try { result = await runVibe(options); } catch (caught) { error = caught; }
  const invocationFile = path.join(artifacts, 'invocation.json');
  return { root, cwd, artifacts, result, error, invocation: fs.existsSync(invocationFile) ? JSON.parse(fs.readFileSync(invocationFile, 'utf8')) : null };
}

test('the Vibe launcher runs headless and untrusted under its own home, agent and allowlisted environment', async t => {
  // Arrange and Act
  const { cwd, artifacts, result, invocation } = await launch(t);

  // Assert
  assert.equal(result.status, 'complete');
  assert.deepEqual([result.host, result.model, result.effort, result.session, result.tokens, result.attributionVerified], ['vibe', 'glm-5-3', 'high', 'vibe-session', 4321, true]);
  assert.deepEqual(JSON.parse(result.output), REPORT);
  assert.deepEqual(result.vibe, { version: '3.0.0', uncomparedKeys: [], attributionFiles: [path.join(artifacts, 'vibe', 'export.json'), path.join(artifacts, 'vibe', 'session', 'generations', '0000000000000000', 'runtime-state.json')] });
  const flag = name => invocation.args[invocation.args.indexOf(name) + 1];
  assert.deepEqual([flag('--workdir'), flag('--agent'), flag('--output'), flag('--output-dir')], [cwd, 'nightshift-reviewer', 'json', path.join(artifacts, 'vibe')]);
  assert.deepEqual(invocation.args.filter((arg, index) => invocation.args[index - 1] === '--enabled-tools'), ['read_file']);
  assert.equal(invocation.args.includes('--trust') || invocation.args.includes('--add-dir'), false);
  const keys = Object.keys(invocation.env).map(key => key.toUpperCase());
  assert.deepEqual(keys.filter(key => key.startsWith('VIBE_')), ['VIBE_HOME']);
  assert.equal(keys.includes('ENABLE') || keys.includes('SAVE_DIR'), false);
  // Node's process spawning adds Windows' required variables when an environment lacks them; none is a Vibe settings name.
  const spawnRequired = ['HOMEDRIVE', 'HOMEPATH', 'LOGONSERVER', 'SYSTEMDRIVE', 'USERDOMAIN', 'USERNAME'];
  assert.deepEqual(keys.filter(key => ![...spawnRequired, 'PATH', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'LOCALAPPDATA', 'APPDATA', 'MISTRAL_API_KEY', 'VIBE_HOME', 'USERPROFILE', 'HOME'].includes(key)), []);
  assert.equal(invocation.env.MISTRAL_API_KEY, 'fixture-key');
  assert.deepEqual([invocation.env.VIBE_HOME, invocation.env.USERPROFILE, invocation.env.HOME], [path.join(artifacts, 'vibe-home'), path.join(artifacts, 'vibe-user-home'), path.join(artifacts, 'vibe-user-home')]);
  assert.deepEqual(invocation.home, ['agents', 'agents/nightshift-reviewer.toml', 'prompts', 'prompts/nightshift-reviewer.md', 'trusted_folders.toml']);
  assert.deepEqual([invocation.userHome, invocation.trust], [[], '']);
  for (const line of ['active_model = "glm-5-3"', 'system_prompt_id = "nightshift-reviewer"', 'enabled_tools = ["read_file"]', 'enable_telemetry = false', 'include_project_context = false', '[experiments]', 'enable = false', '[models."glm-5-3"]', 'name = "zai-glm-5-3"', 'thinking = "high"', 'thinking_levels = ["low", "high", "max"]']) assert.ok(invocation.agent.split('\n').includes(line), line);
  assert.equal(invocation.systemPrompt, 'You are an independent read-only engineering assessor.');
  assert.match(invocation.prompt, /^Fixture assessment\nReply with only one JSON object that conforms to this JSON schema/);
});

test('the effort mapping runs GLM at low only for low, and the level read back must be the one written', async t => {
  // Arrange and Act
  const mapped = ['low', 'medium', 'high', 'xhigh', undefined].map(effort => vibe.effortLevel('glm-5-3', effort));
  const low = await launch(t, { effort: 'low' });
  const reset = await launch(t, { effort: 'low', control: { config: cleanConfig('glm-5-3', 'high') } });

  // Assert
  assert.deepEqual(mapped, ['low', 'high', 'high', 'high', 'high']);
  assert.ok(low.invocation.agent.includes('thinking = "low"'));
  assert.equal(low.result.effort, 'low');
  assert.equal(reset.error.code, 'unusable-review');
  assert.match(reset.error.message, /models\.glm-5-3\.thinking/);
  assert.equal(reset.error.tokens, 4321);
  assert.ok(Object.values(vibe.MODELS).every(entry => entry.levels.includes(entry.low) && entry.levels.includes('high')));
});

test('the launcher runs Mistral Large 4 at off for low and high otherwise, while no gate admits it in either role', async t => {
  // Arrange
  const model = 'mistral-large-4';
  const refusal = kind => {
    try {
      validateRequest({ kind, requirements: 'r', rules: 'r', findings: kind === 'skeptic' ? [] : undefined, candidates: [{ host: 'vibe', model, effort: 'high' }] });
      return null;
    } catch (error) {
      return error.code;
    }
  };

  // Act
  const mapped = ['low', 'medium', 'high', 'xhigh', undefined].map(effort => vibe.effortLevel(model, effort));
  const high = await launch(t, { model, effort: 'xhigh' });
  const low = await launch(t, { model, effort: 'low' });

  // Assert
  assert.deepEqual(mapped, ['off', 'high', 'high', 'high', 'high']);
  assert.deepEqual([high.result.status, high.result.model, high.result.effort, low.result.effort], ['complete', model, 'high', 'off']);
  for (const line of ['active_model = "mistral-large-4"', '[models."mistral-large-4"]', 'name = "mistral-large-4"', 'thinking = "high"', 'thinking_levels = ["off", "high"]', 'supports_images = false']) assert.ok(high.invocation.agent.split('\n').includes(line), line);
  assert.ok(low.invocation.agent.includes('thinking = "off"'));
  assert.equal(vibe.newestGlm(), 'glm-5-3');
  assert.deepEqual([refusal('code'), refusal('skeptic')], ['review-strength', 'review-strength']);
});

test('the effective-configuration check refuses changed, missing and entry differences and passes allowlisted preferences', async t => {
  // Arrange
  const changed = (edit) => { const config = cleanConfig(); edit(config); return { config }; };
  const cases = [
    ['default_agent', changed(config => { config.default_agent = 'auto-approve'; })],
    ['compaction_prompt_id', changed(config => { config.compaction_prompt_id = 'custom'; })],
    ['include_project_context', changed(config => { delete config.include_project_context; })],
    ['disabled_tools', changed(config => { config.disabled_tools = ['ask_user_question']; })],
    ['models.glm-5-3.provider', changed(config => { config.models['glm-5-3'].provider = 'llamacpp'; })],
    ['providers.mistral.api_base', changed(config => { config.providers[0].api_base = 'https://proxy.invalid/v1'; })],
  ];

  // Act
  const refused = [];
  for (const [key, control] of cases) refused.push([key, (await launch(t, { control })).error]);
  const preferences = await launch(t, { control: changed(config => { config.enable_update_checks = false; config.log_level = 'DEBUG'; config.models['glm-5-3'].input_price = 9; config.models['mistral-medium-3.5'].name = 'other'; }) });

  // Assert
  for (const [key, error] of refused) {
    assert.equal(error?.code, 'unusable-review', key);
    assert.ok(error.message.includes(key), `${key}: ${error.message}`);
  }
  assert.equal(preferences.result.status, 'complete');
});

test('fixed-shape Vibe configuration objects record new members and still require every known member', () => {
  // Arrange
  for (const key of FIXED_SHAPE_KEYS) {
    const config = cleanConfig();
    const members = Object.keys(config[key]);
    config[key].future_setting = { arbitrary: ['value'] };

    // Act and Assert
    assert.deepEqual(vibe.configurationDifferences(config, GLM.model, 'high'), { differing: [], uncompared: [key + '.future_setting'] });
    for (const member of members) {
      const missing = cleanConfig();
      delete missing[key][member];
      assert.deepEqual(vibe.configurationDifferences(missing, GLM.model, 'high').differing, [key + '.' + member]);
      const changed = cleanConfig();
      changed[key][member] = 'changed';
      assert.deepEqual(vibe.configurationDifferences(changed, GLM.model, 'high').differing, [key + '.' + member]);
    }
    for (const wrong of [null, [], 'invalid']) {
      const malformed = cleanConfig();
      malformed[key] = wrong;
      assert.deepEqual(vibe.configurationDifferences(malformed, GLM.model, 'high').differing, [key]);
    }
    const absent = cleanConfig();
    delete absent[key];
    assert.deepEqual(vibe.configurationDifferences(absent, GLM.model, 'high').differing, [key]);
  }
});

test('Vibe configuration arrays, open-ended maps and known entry values remain whole-value comparisons', () => {
  // Arrange
  const cases = [
    ['enabled_tools', config => { config.enabled_tools.push('shell'); }],
    ['catalog_model_aliases', config => { config.catalog_model_aliases.other = ['model']; }],
    ['tools', config => { config.tools.read_file = { instructions: 'other' }; }],
    ['models.glm-5-3.thinking_levels', config => { config.models[GLM.model].thinking_levels.push('other'); }],
    ['providers.mistral.extra_headers', config => { config.providers[0].extra_headers = { custom: 'value' }; }],
  ];

  // Act and Assert
  for (const [key, change] of cases) {
    const config = cleanConfig();
    change(config);
    assert.deepEqual(vibe.configurationDifferences(config, GLM.model, 'high').differing, [key]);
  }
});

test('a later Vibe version records new fixed-shape, active-model and provider members through the launcher', async t => {
  // Arrange
  const config = cleanConfig();
  for (const key of FIXED_SHAPE_KEYS) config[key].future_setting = true;
  config.models[GLM.model].future_setting = true;
  config.providers[0].future_setting = true;

  // Act
  const later = await launch(t, { installed: '3.1.0', control: { vibeVersion: '3.1.0', config } });

  // Assert
  assert.equal(later.error, null);
  assert.equal(later.result.status, 'complete');
  assert.deepEqual(later.result.vibe.uncomparedKeys, ['experiments.future_setting', 'models.glm-5-3.future_setting', 'project_context.future_setting', 'providers.mistral.future_setting', 'utility_models.future_setting']);
});

test('Vibe usage preserves valid counts and marks malformed exports unknown in accounting', async t => {
  // Arrange
  const cases = [
    ['negative', { total_tokens: -1 }, null],
    ['fractional', { total_tokens: 1.5 }, null],
    ['unsafe', { total_tokens: Number.MAX_SAFE_INTEGER + 1 }, null],
    ['string', { total_tokens: '4321' }, null],
    ['missing', {}, null],
    ['null', null, null],
    ['zero', { total_tokens: 0 }, 0],
    ['ordinary', { total_tokens: 4321 }, 4321],
  ];

  // Act and Assert
  for (const [name, usage, expected] of cases) {
    const { result, error } = await launch(t, { control: { usage } });
    assert.equal(error, null, name);
    assert.equal(result.tokens, expected, name);
    assert.equal(result.threadTokens, expected, name);
    const accounted = ownTokens({ host: GLM.host, threadTokens: result.threadTokens, attempts: [{ host: GLM.host, status: result.status, tokens: result.tokens }] }, new Map());
    assert.deepEqual({ known: accounted.vibe, unknown: accounted.vibeUnknownAttempts }, { known: expected ?? 0, unknown: expected === null ? 1 : 0 }, name);
  }
});

test('the version floor refuses an older or unreadable Vibe before launch, a version changed after launch, and records a later version', async t => {
  // Arrange and Act
  const older = await launch(t, { installed: '2.9.9' });
  const unreadable = await launch(t, { installed: null });
  const changed = await launch(t, { control: { vibeVersion: '3.0.1' } });
  const later = await launch(t, { installed: '3.1.0', control: { vibeVersion: '3.1.0', config: { ...cleanConfig(), future_setting: true } } });

  // Assert
  for (const refused of [older, unreadable]) {
    assert.equal(refused.error.code, 'vibe-version-unsupported');
    assert.equal(refused.invocation, null);
  }
  assert.equal(changed.error.code, 'unusable-review');
  assert.match(changed.error.message, /version 3\.0\.1 after launching as 3\.0\.0/);
  assert.equal(later.result.status, 'complete');
  assert.deepEqual(later.result.vibe.uncomparedKeys, ['future_setting']);
  assert.deepEqual([vibe.versionSupported('3.0.0'), vibe.versionSupported('10.0.0'), vibe.versionSupported('2.99.99'), vibe.versionSupported(null)], [true, true, false, false]);
});

test('a failed Vibe attempt names the error export.json reports, else the end of stderr, and a mixed journal is unattributed', async t => {
  // Arrange and Act
  const reported = await launch(t, { control: { outcome: 'infrastructure_failure', error: { message: 'Rate limited', code: '429' }, exitCode: 1 } });
  const silent = await launch(t, { control: { outcome: 'deadline', stderr: 'deadline reached after 60 s', exitCode: 1 } });
  const mixed = await launch(t, { control: { generations: ['glm-5-3', 'mistral-medium-3.5'] } });
  const unknown = await launch(t, { model: 'glm-5-4' });

  // Assert
  assert.deepEqual([reported.result.status, reported.result.hostFailure], ['failed', 'Rate limited (429)']);
  assert.deepEqual([silent.result.status, silent.result.hostFailure], ['failed', 'deadline reached after 60 s']);
  assert.equal(mixed.result.attributionVerified, false);
  assert.equal(unknown.error.code, 'vibe-model-unknown');
});

test('the Vibe report is the last untagged or json fenced block, else the outermost braces, and the journal names one model', t => {
  // Arrange
  const root = scratch(t, 'parse');
  const journal = (name, models) => models.map((model, index) => {
    const file = path.join(root, name, 'session', 'generations', String(index), 'runtime-state.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ session_metadata: { active_model: model } }));
    return file;
  });

  // Act and Assert
  assert.equal(vibe.reportText('I have checked it.\n\n```json\n{"a": {"b": 1}}\n```'), '{"a": {"b": 1}}');
  assert.equal(vibe.reportText('Report: {"a": 1} done'), '{"a": 1}');
  assert.equal(vibe.reportText('I checked the helper:\n\n```typescript\nconst x = 1;\n```\n\nHere is the report:\n\n```json\n{"a": 1}\n```'), '{"a": 1}');
  assert.equal(vibe.reportText('```typescript\nconst x = 1;\n```\nThen {"b": 2}'), '{"b": 2}');
  assert.equal(vibe.reportText(null), null);
  assert.equal(vibe.journalModel(journal('same', ['glm-5-3', 'glm-5-3'])), 'glm-5-3');
  assert.equal(vibe.journalModel(journal('mixed', ['glm-5-3', 'mistral-medium-3.5'])), null);
  assert.equal(vibe.journalModel([]), null);
  assert.ok(vibe.OUTPUT_LIMIT < 32 * 1024 * 1024);
});

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, windowsHide: true, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

let sessions = 0;

// A fixture host for runtime dispatches: on Vibe it writes the export, journal and JSON output entries a real attempt leaves and
// returns the launcher's attribution record; on Claude and Codex it writes their native events, as the other runtime tests do.
function agent(options, { findings = [], closures, positions, dimensions, calls } = {}) {
  calls?.push(options);
  fs.mkdirSync(options.artifacts, { recursive: true });
  const request = JSON.parse(fs.readFileSync(path.join(options.artifacts, '..', 'request.json'), 'utf8'));
  const report = { requestId: request.id, status: 'complete', coverage: (dimensions ?? request.dimensions).map(dimension => ({ dimension, evidence: 'Assessed the change' })), findings, probes: [], summary: 'Fixture report', toolFailure: '' };
  if (request.kind !== 'skeptic') {
    report.closures = request.continues && !request.dialogue ? closures ?? request.pendingClosures.map(finding => ({ id: finding.id, closed: true, evidence: 'The repair resolves it' })) : [];
    report.positions = request.dialogue ? positions ?? request.dialogue.findingIds.map(id => ({ id, position: 'maintain', evidence: 'The finding still holds' })) : [];
  }
  const session = options.session ?? `session-${++sessions}`;
  if (options.host === 'vibe') {
    const exportDirectory = path.join(options.artifacts, 'vibe');
    const state = path.join(exportDirectory, 'session', 'generations', '0000000000000000', 'runtime-state.json');
    fs.mkdirSync(path.dirname(state), { recursive: true });
    fs.writeFileSync(path.join(exportDirectory, 'export.json'), JSON.stringify({ session_id: session, outcome: 'finished', vibe_version: '3.0.0' }));
    fs.writeFileSync(state, JSON.stringify({ session_metadata: { active_model: options.model } }));
    const entries = [{ type: 'message', role: 'assistant', content: [{ type: 'text', text: `Report:\n\`\`\`json\n${JSON.stringify(report)}\n\`\`\`` }] }];
    fs.writeFileSync(path.join(options.artifacts, 'events.jsonl'), entries.map(entry => JSON.stringify(entry)).join('\n') + '\n');
    return { host: 'vibe', model: options.model, effort: vibe.effortLevel(options.model, options.effort), session, attributionVerified: true, status: 'complete', output: vibe.reportFromEntries(entries), tokens: 100, threadTokens: 100, vibe: { version: '3.0.0', uncomparedKeys: [], attributionFiles: [path.join(exportDirectory, 'export.json'), state] } };
  }
  const events = options.host === 'codex'
    ? [{ id: 2, result: { thread: { id: session }, model: options.model } }, { method: 'item/completed', params: { threadId: session, item: { type: 'agentMessage', text: JSON.stringify(report) } } }, { method: 'turn/completed', params: { threadId: session, turn: { status: 'completed' } } }]
    : [{ type: 'assistant', session_id: session, message: { model: options.model, content: [] } }, { type: 'result', session_id: session, subtype: 'success', is_error: false, structured_output: report }];
  fs.writeFileSync(path.join(options.artifacts, 'events.jsonl'), events.map(event => JSON.stringify(event)).join('\n') + '\n');
  return { host: options.host, model: options.model, effort: options.effort, session, attributionVerified: true, status: 'complete', output: report, tokens: 0 };
}

// A committed project with an uncommitted change and a run whose operations go through the runtime boundary, with Vibe's executable
// and version stubbed so eligibility does not depend on the machine.
function fixture(t, { tasks = [{ id: 'task', title: 'Work', agreement: { source: 'User', outcome: 'Change both paths correctly' } }], limits, version = '3.0.0' } = {}) {
  const parent = path.resolve(__dirname, '../.tmp/vibe-tests');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'run-'));
  git(root, ['init', '--quiet']);
  fs.writeFileSync(path.join(root, 'subject.txt'), 'before\r\n');
  fs.writeFileSync(path.join(root, 'spec.md'), '# Spec\r\n\r\nChange both paths.\r\n');
  fs.writeFileSync(path.join(root, 'README.md'), '# Project\r\n');
  git(root, ['add', '.']);
  git(root, ['-c', 'user.name=Nightshift fixture', '-c', 'user.email=a.stenlund@gmail.com', 'commit', '--quiet', '-m', 'test(fixture): establish vibe baseline']);
  const baseSha = git(root, ['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(root, 'subject.txt'), 'after\r\n');
  const store = new RunStore(root, { create: true });
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  store.create({ mechanism: fixtureContinuation(), objective: 'Deliver the accepted change', authority: 'User agreed the scope', controller: actor, controllerClaim: fixtureControllerClaim(actor), tasks, ...(limits ? { limits } : {}) });
  const base = { baseSha, requirements: 'Change both paths correctly', rules: 'Do not mutate reviewed inputs.' };
  const stubs = { vibeExecutable: () => 'vibe.exe', readVibeVersion: () => version };
  const act = (request, overrides = {}) => executeWithFixtureController(root, { actor, revision: store.read().revision, taskId: 'task', ...request }, { ...stubs, ...overrides });
  const receipt = result => path.relative(root, result.receiptFile).split(path.sep).join('/');
  const dispatch = (review, options = {}, taskId = 'task') => act({ action: 'dispatch', taskId, review: { ...base, ...review } }, { runAgent: agentOptions => agent(agentOptions, options) });
  const task = (id = 'task') => store.read().tasks.find(item => item.id === id);
  const brief = (id = 'task') => obligationBrief(store.read()).next.find(item => item.id === id);
  const check = (taskId = 'task') => act({ action: 'check', taskId, check: { name: 'Fixture check', executable: process.execPath, args: ['--version'], paths: ['subject.txt'] } });
  return { root, store, base, act, receipt, dispatch, task, brief, check };
}

const finding = id => ({ id, severity: 'important', required: true, consequence: 'The fixture boundary fails', evidence: 'Concrete branch through the boundary' });
const verdict = id => ({ id, verdict: 'confirmed', evidence: 'Reproduced against the change', value: 'Worth fixing', repairProposal: 'Correct the boundary where both branches meet' });

for (const kind of ['code', undefined]) {
  test(`a clean fresh Vibe ${kind ?? 'omitted-kind'} lead is imported and meets the code task's review gate`, async t => {
    // Arrange
    const f = fixture(t);
    const calls = [];
    await f.check();

    // Act
    const lead = await f.dispatch({ ...(kind ? { kind } : {}), candidates: [GLM] }, { calls });
    await f.act({ action: 'review', receipt: f.receipt(lead) });

    // Assert
    assert.equal(lead.receipt.host, 'vibe');
    assert.equal(lead.receipt.kind, 'code');
    assert.equal(lead.receipt.strength, 'strong');
    assert.equal(lead.receipt.vibeVersion, '3.0.0');
    assert.match(calls[0].prompt, /run_typescript sandbox can load project files through read_file, but the runtime neither records nor checks what runs there, so a sandbox run is not execution evidence of the project, even of project code it loaded: a deciding claim that needs execution goes through a probe request/);
    assert.ok(calls[0].prompt.includes(`Your working directory is ${calls[0].cwd}: read context/diff.patch`));
    assert.equal(reviewGate(f.root, f.task(), f.store.read()), true);
  });
}

test('a clean fresh Vibe spec lead meets a spec task\'s gate', async t => {
  // Arrange
  const f = fixture(t, { tasks: [{ id: 'task', title: 'Spec', kind: 'spec', agreement: { source: 'User', outcome: 'Settle the spec', spec: 'spec.md' } }] });

  // Act
  const lead = await f.dispatch({ kind: 'spec', candidates: [GLM] });
  await f.act({ action: 'review', receipt: f.receipt(lead) });

  // Assert
  assert.deepEqual(lead.receipt.dimensions, DIMENSIONS.spec);
  assert.equal(reviewGate(f.root, f.task(), f.store.read()), true);
});

test('a clean fresh Vibe docs lead makes the task\'s docs review current', async t => {
  // Arrange
  const f = fixture(t);

  // Act
  const lead = await f.dispatch({ kind: 'docs', candidates: [GLM] });
  await f.act({ action: 'review', receipt: f.receipt(lead) });

  // Assert
  assert.deepEqual(lead.receipt.dimensions, DIMENSIONS.docs);
  assert.equal(f.brief().docsReviewCurrent, true);
});

test('a Vibe skeptic is refused at dispatch and at import for its role', async t => {
  // Arrange
  const f = fixture(t);
  const lead = await f.dispatch({ kind: 'code', candidates: [OPUS] }, { findings: [finding('boundary')] });
  await f.act({ action: 'review', receipt: f.receipt(lead) });
  const findings = f.task().findings;
  const skeptic = await f.dispatch({ kind: 'skeptic', candidates: [SOL], findings }, { findings: findings.map(item => verdict(item.id)) });
  const saved = JSON.parse(fs.readFileSync(skeptic.receiptFile, 'utf8'));
  fs.writeFileSync(skeptic.receiptFile, JSON.stringify({ ...saved, host: 'vibe', model: 'glm-5-3' }));

  // Act
  const refused = await f.dispatch({ kind: 'skeptic', candidates: [GLM], findings }).then(() => null, error => error);
  const imported = () => readReceipt(f.root, f.receipt(skeptic), f.store.read(), 'task');

  // Assert
  assert.equal(refused.code, 'review-strength');
  assert.match(refused.message, /skeptic role/);
  assert.throws(imported, { code: 'invalid-receipt', message: /skeptic role/ });
});

test('the glm alias resolves to the newest launcher entry for a candidate and a required model, and the receipt records it', async t => {
  // Arrange
  const f = fixture(t);
  const calls = [];
  const requested = { requirements: 'r', rules: 'r', candidates: [{ host: 'vibe', model: 'glm' }], requiredModel: 'glm' };

  // Act
  validateRequest(requested);
  const lead = await f.dispatch({ kind: 'code', candidates: [{ host: 'vibe', model: 'glm', effort: 'xhigh' }], requiredModel: 'glm' }, { calls });
  const mismatch = () => validateRequest({ requirements: 'r', rules: 'r', candidates: [SOL], requiredModel: 'glm' });

  // Assert
  assert.equal(vibe.newestGlm(), 'glm-5-3');
  assert.deepEqual([requested.candidates[0].model, requested.requiredModel], ['glm-5-3', 'glm-5-3']);
  assert.deepEqual([calls[0].model, lead.receipt.model, lead.receipt.effort], ['glm-5-3', 'glm-5-3', 'high']);
  assert.throws(mismatch, { code: 'model-requirement' });
});

test('an ineligible Vibe candidate is dropped before reservation, consuming no dispatch, and a sole one fails before any worker', async t => {
  // Arrange
  const f = fixture(t, { limits: { maxDispatches: 1 } });
  const calls = [];
  const later = { host: 'vibe', model: 'glm-5-4', effort: 'high' };

  // Act
  const sole = await f.dispatch({ kind: 'code', candidates: [later] }).then(() => null, error => error);
  const workersAfterSole = f.store.read().workers.length;
  const dropped = await f.dispatch({ kind: 'code', candidates: [later, SOL], substitutionReason: 'GLM first, Sol as fallback' }, { calls });
  const old = fixture(t, { version: '2.9.0' });
  const oldRefused = await old.dispatch({ kind: 'code', candidates: [GLM] }).then(() => null, error => error);
  const unreadable = fixture(t, { version: null });
  const unreadableRefused = await unreadable.dispatch({ kind: 'code', candidates: [GLM] }).then(() => null, error => error);

  // Assert
  assert.equal(sole.code, 'vibe-model-unknown');
  assert.equal(workersAfterSole, 0);
  assert.deepEqual(calls.map(call => call.host), ['codex']);
  assert.equal(f.store.read().dispatches, 1);
  assert.deepEqual(dropped.receipt.ineligible, [{ host: 'vibe', model: 'glm-5-4', code: 'vibe-model-unknown', reason: 'The Vibe launcher has no entry for glm-5-4' }]);
  assert.equal(dropped.receipt.substitution, 'GLM first, Sol as fallback');
  assert.deepEqual([oldRefused.code, old.store.read().workers.length], ['vibe-version-unsupported', 0]);
  assert.deepEqual([unreadableRefused.code, unreadable.store.read().workers.length], ['vibe-version-unsupported', 0]);
});

for (const mode of ['preparation', 'failed-fallback']) {
  test('eligibility metadata survives a registered CLI failure: ' + mode, async t => {
    // Arrange
    const f = fixture(t);
    const later = { host: 'vibe', model: 'glm-5-4', effort: 'high' };
    const ineligible = [{ host: 'vibe', model: 'glm-5-4', code: 'vibe-model-unknown', reason: 'The Vibe launcher has no entry for glm-5-4' }];
    const substitutionReason = 'Fixture GLM was unavailable, so use Sol';
    fs.mkdirSync(path.join(f.root, 'artifact-directory'));
    let calls = 0;

    // Act
    await assert.rejects(f.act({ action: 'dispatch', review: { ...f.base, kind: 'code', candidates: [later, SOL], substitutionReason, ...(mode === 'preparation' ? { artifactPaths: ['artifact-directory'] } : {}) } }, { runAgent: () => {
      calls++;
      throw Object.assign(new Error('Fixture fallback failed'), { code: 'unusable-review', tokens: 7 });
    } }));

    // Assert
    const state = f.store.read();
    const worker = state.workers.at(-1);
    assert.equal(worker.status, 'failed');
    assert.deepEqual(worker.ineligible, ineligible);
    assert.equal(worker.substitutionReason, substitutionReason);
    assert.equal(calls, mode === 'preparation' ? 0 : 1);
    assert.equal(state.dispatches, calls);
    if (mode === 'failed-fallback') {
      const directory = path.join(f.root, worker.artifactDirectory);
      const failure = JSON.parse(fs.readFileSync(path.join(directory, 'failure.json'), 'utf8'));
      assert.deepEqual(failure.ineligible, ineligible);
      assert.equal(failure.substitutionReason, substitutionReason);
      assert.equal(failure.attempts.length, 1);
      assert.equal(failure.attempts[0].tokens, 7);
    }
  });
}

test('time is reserved only for the eligible candidates, as the dispatch reserves it after dropping ineligible ones', t => {
  // Arrange
  const root = scratch(t, 'reserve');
  const context = { operationDeadlineUtc: new Date(Date.now() + OPERATION_EXIT_MARGIN_MS + 150000).toISOString() };
  const stubs = { vibeExecutable: () => 'vibe.exe', readVibeVersion: () => '3.0.0' };
  const reserve = candidates => () => requireDispatchFits({ limits: {} }, context, vibe.eligibleCandidates(candidates, root, stubs).eligible.length, 100000);

  // Act and Assert
  reserve([{ host: 'vibe', model: 'glm-5-4' }, SOL])();
  assert.throws(reserve([GLM, SOL]), { code: 'operation-time-limit' });
});

test('a Vibe lineage is never resumed: resume is refused before launch, closure routes to a replacement, which closes the finding', async t => {
  // Arrange
  const f = fixture(t);
  const calls = [];
  const lead = await f.dispatch({ kind: 'code', candidates: [GLM] }, { findings: [finding('boundary')] });
  await f.act({ action: 'review', receipt: f.receipt(lead) });
  const findings = f.task().findings;
  const skeptic = await f.dispatch({ kind: 'skeptic', candidates: [OPUS], findings }, { findings: findings.map(item => verdict(item.id)) });
  for (const item of findings) await f.act({ action: 'validate', receipt: f.receipt(skeptic), findingId: item.id });
  for (const item of findings) await f.act({ action: 'dispose', findingId: item.id, disposition: 'implement', reason: 'Required outcome', obligation: { classification: 'required', basis: 'The accepted outcome' } });
  fs.writeFileSync(path.join(f.root, 'subject.txt'), 'repaired\r\n');
  await f.act({ action: 'repair', findingIds: findings.map(item => item.id) });
  await f.check();

  // Act
  const resumed = await f.dispatch({ kind: 'code', resume: lead.receipt.requestId }, { calls }).then(() => null, error => error);
  const route = f.brief().review.resumeTargets.map(item => [item.requestId, item.continue]);
  const replacement = await f.dispatch({ kind: 'code', replaces: lead.receipt.requestId, candidates: [GLM] }, { calls });
  await f.act({ action: 'review', receipt: f.receipt(replacement) });
  const dialogue = await f.dispatch({ kind: 'code', replaces: replacement.receipt.requestId, candidates: [GLM], dialogue: { findingIds: [findings[0].id], message: 'Does the finding still hold?' } }, { calls });

  // Assert
  assert.equal(resumed.code, 'resume-unsupported');
  assert.match(resumed.message, /review\.replaces/);
  assert.deepEqual(route, [[lead.receipt.requestId, 'replace']]);
  assert.equal(closureRoute(f.root, f.store.read(), lead.receipt.requestId), 'replace');
  assert.deepEqual(calls.map(call => call.host), ['vibe', 'vibe']);
  assert.deepEqual(replacement.receipt.continues, { kind: 'replacement', requestId: lead.receipt.requestId });
  assert.equal(f.task().findings[0].pendingClosure, undefined);
  assert.equal(f.task().findings[0].closures.at(-1).closed, true);
  assert.deepEqual(dialogue.receipt.positions.map(item => item.position), ['maintain']);
});

// Rewrites a collected Vibe receipt so that only the guard under test can refuse it.
function rewrite(f, result, edit) {
  const saved = JSON.parse(fs.readFileSync(result.receiptFile, 'utf8'));
  edit(saved);
  fs.writeFileSync(result.receiptFile, JSON.stringify(saved));
}

test('Vibe receipt import reads exactly its listed attribution files and refuses every gap or change', async t => {
  // Arrange
  const f = fixture(t);
  const read = result => () => readReceipt(f.root, f.receipt(result), f.store.read(), 'task');
  const fresh = async () => f.dispatch({ kind: 'code', candidates: [GLM] });
  const changedExport = await fresh();
  fs.appendFileSync(path.join(f.root, changedExport.receipt.attributionEvidence[0].path), ' ');
  const changedJournal = await fresh();
  fs.appendFileSync(path.join(f.root, changedJournal.receipt.attributionEvidence[1].path), ' ');
  const absent = await fresh();
  rewrite(f, absent, saved => { delete saved.attributionEvidence; });
  const empty = await fresh();
  rewrite(f, empty, saved => { saved.attributionEvidence = []; });
  const omitted = await fresh();
  const extra = path.join(f.root, path.dirname(omitted.receipt.attributionEvidence[1].path), '..', '0000000000000001', 'runtime-state.json');
  fs.mkdirSync(path.dirname(extra), { recursive: true });
  fs.writeFileSync(extra, JSON.stringify({ session_metadata: { active_model: 'glm-5-3' } }));
  const otherFile = await fresh();
  rewrite(f, otherFile, saved => { saved.attributionEvidence = [...saved.attributionEvidence, { path: 'README.md', sha256: hash(fs.readFileSync(path.join(f.root, 'README.md'))) }]; });
  const coverage = await fresh();
  rewrite(f, coverage, saved => { saved.coverageEvidence = saved.coverageEvidence.replace('Assessed the change', 'Assessed something else'); });
  const codex = await f.dispatch({ kind: 'code', candidates: [SOL] });
  rewrite(f, codex, saved => { saved.attributionEvidence = changedExport.receipt.attributionEvidence; });
  const clean = await fresh();

  // Act and Assert
  assert.throws(read(changedExport), { code: 'changed-result' });
  assert.throws(read(changedJournal), { code: 'changed-result' });
  assert.throws(read(absent), { code: 'unattributed-review' });
  assert.throws(read(empty), { code: 'unattributed-review' });
  assert.throws(read(omitted), { code: 'unattributed-review', message: /every generation/ });
  assert.throws(read(otherFile), { code: 'unattributed-review' });
  assert.throws(read(coverage), { code: 'changed-result' });
  assert.throws(read(codex), { code: 'unattributed-review', message: /Only a Vibe receipt/ });
  assert.equal(read(clean)().host, 'vibe');
});

async function launchedVibe(options, version, control = {}) {
  const request = JSON.parse(fs.readFileSync(path.join(options.artifacts, '..', 'request.json'), 'utf8'));
  fs.mkdirSync(options.artifacts, { recursive: true });
  const report = { ...REPORT, requestId: request.id, coverage: request.dimensions.map(dimension => ({ dimension, evidence: 'Assessed the fixture' })) };
  fs.writeFileSync(path.join(options.artifacts, 'control.json'), JSON.stringify({ model: options.model, vibeVersion: version, config: cleanConfig(), report, ...control }));
  return runVibe({ ...options, executable: process.execPath, commandPrefix: [FAKE_VIBE], readVibeVersion: () => version, env: { ...process.env, MISTRAL_API_KEY: 'fixture-key' } });
}

for (const mode of ['journal', 'callback', 'frozen-callback', 'non-error-callback']) {
  test('post-exit failures retain known job proof and usage: ' + mode, async t => {
    // Arrange
    const f = fixture(t);
    const calls = [];
    const runner = options => {
      calls.push(options.host);
      if (options.host !== 'vibe') return agent(options);
      const onSession = () => {
        if (mode === 'non-error-callback') throw 'Fixture post-exit callback failed';
        const error = new Error('Fixture post-exit callback failed');
        throw mode === 'frozen-callback' ? Object.freeze(error) : error;
      };
      return launchedVibe({ ...options, ...(mode === 'journal' ? {} : { onSession }) }, '3.0.0', { generationsFile: mode === 'journal' });
    };

    // Act
    const result = await f.act({ action: 'dispatch', review: { ...f.base, kind: 'code', candidates: [GLM, SOL], substitutionReason: 'An unusable Vibe attempt may use permitted Sol fallback' } }, { runAgent: runner });

    // Assert
    assert.deepEqual(calls, ['vibe', 'codex']);
    assert.equal(result.receipt.host, 'codex');
    assert.equal(result.receipt.attempts[0].status, 'failed');
    assert.equal(result.receipt.attempts[0].tokens, 4321);
    assert.equal(f.store.read().workers.at(-1).status, 'complete');
  });
}

test('post-exit failures never invent missing job proof', async t => {
  // Arrange and Act
  const { error } = await launch(t, { control: { generationsFile: true } });

  // Assert
  assert.equal(error.code, 'ENOTDIR');
  assert.equal(error.descendantsReclaimed, null);
  assert.equal(error.tokens, 4321);
});

test('the CLI Vibe preflight rejects a supported version change before accepting an assessment', async t => {
  // Arrange
  const f = fixture(t, { version: '3.0.0' });
  const runAtNewVersion = options => launchedVibe(options, '3.0.1');

  // Act
  const failure = await f.act({ action: 'dispatch', review: { ...f.base, kind: 'code', candidates: [GLM] } }, { runAgent: runAtNewVersion }).then(() => null, error => error);

  // Assert
  assert.equal(failure?.code, 'unusable-review');
  assert.match(failure.message, /version/);
  assert.match(failure.message, /3[.]0[.]0/);
  assert.match(failure.message, /3[.]0[.]1/);
});

test('Vibe preflight observations fail closed when absent or malformed and accept an unchanged version', async t => {
  // Arrange
  const invalid = [null, {}, [], '3.0.0', { version: null }, { version: 'not-a-version' }, { version: '2.9.0' }];

  // Act
  const refused = [];
  for (const preflight of invalid) refused.push(await launch(t, { preflight }));
  refused.push(await launch(t, { installed: null, preflight: { version: '3.0.0' } }));
  refused.push(await launch(t, { installed: '2.9.0', preflight: { version: '3.0.0' } }));
  const unchanged = await launch(t, { preflight: { version: '3.0.0' } });
  const changedAtLaunch = await launch(t, { installed: '3.0.1', preflight: { version: '3.0.0' }, control: { vibeVersion: '3.0.0' } });
  const changedInExport = await launch(t, { preflight: { version: '3.0.0' }, control: { vibeVersion: '3.0.1' } });

  // Assert
  for (const result of refused) {
    assert.equal(result.error?.code, 'unusable-review');
    assert.equal(result.invocation, null);
  }
  assert.equal(unchanged.result.status, 'complete');
  assert.equal(changedAtLaunch.error?.code, 'unusable-review');
  assert.match(changedAtLaunch.error.message, /3[.]0[.]1/);
  assert.equal(changedInExport.error?.code, 'unusable-review');
});

test('CLI Vibe preflight observations retain filtered and repeated candidate positions', async t => {
  // Arrange
  const filtered = fixture(t);
  const repeated = fixture(t);
  let observations = 0;
  const fallback = options => {
    if (options.host === 'claude') throw Object.assign(new Error('Fixture host unavailable'), { code: 'unusable-review' });
    return launchedVibe(options, '3.0.0');
  };

  // Act
  const afterFiltering = await filtered.act({ action: 'dispatch', review: { ...filtered.base, kind: 'code', candidates: [{ ...GLM, model: 'glm-5-4' }, OPUS, GLM], substitutionReason: 'Drop the unknown model and use GLM when the fixture Opus host is unavailable' } }, { runAgent: fallback });
  const firstRepeated = await repeated.act({ action: 'dispatch', review: { ...repeated.base, kind: 'code', candidates: [GLM, GLM], substitutionReason: 'Each repeated candidate keeps its own eligibility observation' } }, { readVibeVersion: () => ++observations === 1 ? '3.0.0' : '3.0.1', runAgent: options => launchedVibe(options, '3.0.0') });

  // Assert
  assert.equal(afterFiltering.receipt.host, 'vibe');
  assert.equal(afterFiltering.receipt.vibeVersion, '3.0.0');
  assert.deepEqual(afterFiltering.receipt.attempts.map(attempt => attempt.host), ['claude', 'vibe']);
  assert.equal(afterFiltering.receipt.ineligible[0].model, 'glm-5-4');
  assert.equal(firstRepeated.receipt.vibeVersion, '3.0.0');
  assert.equal(firstRepeated.receipt.attempts.length, 1);
});
