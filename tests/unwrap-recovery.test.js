'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const test = require('node:test');
const { RECOVERY_SUFFIX, MAX_FILE_BYTES, MAX_RECORD_BYTES } = require('../internal/unwrap-recovery');
const { LOCK_NAME } = require('../internal/unwrap-lock');

const checkout = path.resolve(__dirname, '..');
const unwrap = path.join(checkout, 'skills/init-backlog/unwrap.js');
const setup = path.join(checkout, 'skills/init-backlog/init-backlog.js');
const ready = path.join(checkout, 'skills/ready/ready.js');
const preload = path.join(__dirname, 'fixtures/unwrap-fault.cjs');
const original = Buffer.from('# Features\n\n### Preserved work\n\nThis paragraph starts here\nand continues here.\n\n**Requires:** none.\n');
const replacement = Buffer.from(original.toString().replace('here\nand', 'here and'));

function fixture(t, home = '.nightshift') {
  const parent = path.join(checkout, '.tmp/unwrap-recovery-tests');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'case-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = spawnSync('git', ['init', '--quiet', root], { encoding: 'utf8', windowsHide: true });
  assert.equal(git.status, 0, git.stderr);
  const directory = path.join(root, home);
  fs.mkdirSync(directory);
  const target = path.join(directory, 'FEATURES.md');
  fs.writeFileSync(target, original);
  const options = path.join(root, 'options.json');
  fs.writeFileSync(options, '{"unwrap":true}\n');
  return { root, directory, target, options, trace: path.join(root, 'fault.log') };
}

function environment(f, fault) {
  const env = { ...process.env };
  if (fault) Object.assign(env, { NODE_OPTIONS: `--require "${preload.split(path.sep).join('/')}"`, NIGHTSHIFT_UNWRAP_TARGET: f.target, NIGHTSHIFT_UNWRAP_FAULT: fault, NIGHTSHIFT_UNWRAP_TRACE: f.trace });
  return env;
}

function cli(script, args, f, fault) {
  const result = spawnSync(process.execPath, [script, '--development', ...args], { cwd: checkout, env: environment(f, fault), encoding: 'utf8', windowsHide: true, timeout: 60000 });
  assert.equal(result.error, undefined, result.error?.message);
  return result;
}

function record(f) { return JSON.parse(fs.readFileSync(f.target + RECOVERY_SUFFIX, 'utf8')); }
function savedOriginal(f) { assert.deepEqual(Buffer.from(record(f).original.bytes, 'base64'), original); }
function hit(f, stage) { assert.ok(fs.readFileSync(f.trace, 'utf8').split('\n').includes(stage), 'Fault boundary not reached: ' + stage); }
function succeeds(result) { assert.equal(result.status, 0, result.stdout + result.stderr); }
function fails(result) { assert.notEqual(result.status, 0, result.stdout + result.stderr); }

for (const [fault, stage, state] of [
  ['crash-lock-created', 'lock-created', 'lock'],
  ['crash-record-created', 'record-created', 'invalid'],
  ['record-write-error', 'record-partial', 'invalid'],
  ['record-sync-error', 'record-sync-error', 'original'],
  ['crash-record-synced', 'record-synced', 'original'],
  ['crash-target-truncated', 'target-truncated', 'partial'],
  ['crash-target-partial', 'target-partial', 'partial'],
  ['target-write-error', 'target-partial', 'partial'],
  ['crash-target-written', 'target-written', 'replacement'],
  ['target-sync-error', 'target-sync-error', 'replacement'],
  ['target-verify-error', 'target-verify-error', 'replacement'],
  ['crash-target-synced', 'target-synced', 'replacement'],
  ['crash-before-cleanup', 'before-cleanup', 'replacement'],
  ['cleanup-error', 'before-cleanup', 'replacement'],
  ['crash-after-cleanup', 'after-cleanup', 'complete'],
]) {
  test(`actual unwrap CLI preserves recovery across ${fault}`, t => {
    const f = fixture(t);
    fails(cli(unwrap, ['--write', f.target], f, fault));
    hit(f, stage);
    const beforeRetry = fs.readFileSync(f.target);
    if (['lock', 'invalid', 'original'].includes(state)) assert.deepEqual(beforeRetry, original);
    if (['original', 'partial', 'replacement'].includes(state)) savedOriginal(f);
    if (['replacement', 'complete'].includes(state)) assert.deepEqual(beforeRetry, replacement);
    const retry = cli(unwrap, ['--write', f.directory], f);
    if (['lock', 'invalid', 'partial'].includes(state)) {
      fails(retry);
      assert.deepEqual(fs.readFileSync(f.target), beforeRetry);
      fails(cli(unwrap, ['--write', f.target], f));
      assert.deepEqual(fs.readFileSync(f.target), beforeRetry);
    } else {
      succeeds(retry);
      assert.deepEqual(fs.readFileSync(f.target), replacement);
      assert.equal(fs.existsSync(f.target + RECOVERY_SUFFIX), false);
      succeeds(cli(unwrap, ['--write', f.target], f));
    }
  });
}

for (const fault of ['target-short', 'record-short']) {
  test(`actual unwrap CLI completes ${fault} writes`, t => {
    const f = fixture(t);
    succeeds(cli(unwrap, ['--write', f.target], f, fault));
    hit(f, 'after-cleanup');
    assert.deepEqual(fs.readFileSync(f.target), replacement);
  });
}

test('actual setup partial write retains originals and all read-only or opted-out consumers refuse clean completion', t => {
  const f = fixture(t);
  fails(cli(setup, ['apply', f.root, f.options], f, 'target-write-error'));
  hit(f, 'target-partial');
  savedOriginal(f);
  const before = fs.readFileSync(f.target);
  const recovery = fs.readFileSync(f.target + RECOVERY_SUFFIX);
  for (const [script, args] of [[setup, ['apply', f.root]], [setup, ['apply', f.root, f.options]], [unwrap, [f.directory]], [unwrap, ['--write', f.directory]], [ready, [f.root]]]) {
    const result = cli(script, args, f);
    fails(result);
    assert.match(result.stdout + result.stderr, /recovery/);
    assert.deepEqual(fs.readFileSync(f.target), before);
    assert.deepEqual(fs.readFileSync(f.target + RECOVERY_SUFFIX), recovery);
  }
  const inspection = cli(setup, ['inspect', f.root], f);
  succeeds(inspection);
  assert.equal(JSON.parse(inspection.stdout).status, 'unwrap-recovery-required');
  fs.writeFileSync(f.target, original);
  succeeds(cli(setup, ['apply', f.root, f.options], f));
  assert.deepEqual(fs.readFileSync(f.target), replacement);
});

for (const alteration of ['edit', 'target-substitution', 'record-substitution', 'missing', 'hard-link']) {
  test(`pending recovery preserves ${alteration}`, t => {
    const f = fixture(t);
    fails(cli(unwrap, ['--write', f.target], f, 'crash-record-synced'));
    hit(f, 'record-synced');
    const journal = f.target + RECOVERY_SUFFIX;
    if (alteration === 'edit') fs.writeFileSync(f.target, 'Independent user edit\n');
    if (alteration === 'target-substitution' || alteration === 'record-substitution') {
      const file = alteration === 'target-substitution' ? f.target : journal;
      fs.renameSync(file, file + '.old');
      fs.copyFileSync(file + '.old', file);
    }
    if (alteration === 'missing') fs.renameSync(f.target, f.target + '.old');
    if (alteration === 'hard-link') fs.linkSync(f.target, path.join(f.root, 'alias.md'));
    const targetBefore = fs.existsSync(f.target) ? fs.readFileSync(f.target) : null;
    const journalBefore = fs.readFileSync(journal);
    fails(cli(unwrap, ['--write', f.directory], f));
    fails(cli(unwrap, [f.directory], f));
    fails(cli(ready, [f.root], f));
    assert.deepEqual(fs.existsSync(f.target) ? fs.readFileSync(f.target) : null, targetBefore);
    assert.deepEqual(fs.readFileSync(journal), journalBefore);
  });
}

test('oversized inputs and recovery evidence fail before mutation', t => {
  const f = fixture(t);
  const descriptor = fs.openSync(f.target, 'r+');
  fs.ftruncateSync(descriptor, MAX_FILE_BYTES + 1);
  fs.closeSync(descriptor);
  fails(cli(unwrap, ['--write', f.target], f));
  assert.equal(fs.statSync(f.target).size, MAX_FILE_BYTES + 1);
  assert.equal(fs.existsSync(f.target + RECOVERY_SUFFIX), false);
  fs.writeFileSync(f.target, original);
  const recovery = fs.openSync(f.target + RECOVERY_SUFFIX, 'wx');
  fs.ftruncateSync(recovery, MAX_RECORD_BYTES + 1);
  fs.closeSync(recovery);
  fails(cli(unwrap, ['--write', f.target], f));
  assert.deepEqual(fs.readFileSync(f.target), original);
});

test('multi-file failure reports verified predecessors and stops later writes', t => {
  const f = fixture(t);
  const first = path.join(f.directory, 'BUGS.md');
  const last = path.join(f.directory, 'QUICK_WINS.md');
  fs.writeFileSync(first, original);
  fs.writeFileSync(last, original);
  const result = cli(unwrap, ['--write', f.directory], f, 'target-write-error');
  fails(result);
  const report = JSON.parse(result.stdout);
  assert.equal(report[0].file, first);
  assert.equal(report[0].rewritten, true);
  assert.equal(report[1].error, 'ENOSPC');
  assert.deepEqual(fs.readFileSync(first), replacement);
  assert.deepEqual(fs.readFileSync(last), original);
  savedOriginal(f);
});

for (const enabled of [false, true]) {
  test(`legacy repaired breakout migrates without copying locks, unwrap=${enabled}`, t => {
    const f = fixture(t, '.claude');
    const legacy = path.join(f.directory, 'features');
    fs.mkdirSync(legacy);
    const item = path.join(legacy, 'item.md');
    fs.writeFileSync(item, 'First line\ncontinued\n');
    succeeds(cli(unwrap, ['--write', item], f));
    const lock = fs.readFileSync(path.join(legacy, LOCK_NAME));
    succeeds(cli(setup, ['apply', f.root, ...(enabled ? [f.options] : [])], f));
    assert.deepEqual(fs.readFileSync(path.join(legacy, LOCK_NAME)), lock);
    const destination = path.join(f.root, '.nightshift/features/item.md');
    assert.equal(fs.existsSync(path.join(path.dirname(destination), LOCK_NAME)), false);
    fs.appendFileSync(destination, 'more wrapped text\n');
    succeeds(cli(unwrap, ['--write', destination], f));
    assert.equal(fs.existsSync(path.join(path.dirname(destination), LOCK_NAME)), true);
  });
}

async function waitForTrace(f, stage) {
  const deadline = Date.now() + 15000;
  while (!fs.existsSync(f.trace) || !fs.readFileSync(f.trace, 'utf8').split('\n').includes(stage)) {
    if (Date.now() > deadline) throw new Error('Child did not reach ' + stage);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

test('overlapping actual CLI writers cannot steal cleanup; killed owner permits safe retry', async t => {
  const f = fixture(t, '.claude');
  const child = spawn(process.execPath, [unwrap, '--development', '--write', f.target], { env: environment(f, 'hold-record-synced'), windowsHide: true, stdio: 'ignore' });
  const closed = once(child, 'close');
  t.after(() => { if (child.exitCode === null) child.kill(); });
  await waitForTrace(f, 'record-synced');
  const second = cli(unwrap, ['--write', f.target], f);
  fails(second);
  assert.match(second.stdout, /unwrap-busy/);
  const migration = cli(setup, ['apply', f.root, f.options], f);
  fails(migration);
  assert.deepEqual(fs.readFileSync(f.target), original);
  savedOriginal(f);
  child.kill();
  await closed;
  succeeds(cli(unwrap, ['--write', f.target], f));
  assert.deepEqual(fs.readFileSync(f.target), replacement);
});

for (const kind of ['unrelated', 'substituted']) {
  test(`writer preserves ${kind} lock storage`, t => {
    const f = fixture(t);
    const lock = path.join(f.directory, LOCK_NAME);
    if (kind === 'unrelated') fs.writeFileSync(lock, 'User-owned file\n');
    else {
      succeeds(cli(unwrap, ['--write', f.target], f));
      fs.writeFileSync(f.target, original);
      fs.renameSync(lock, lock + '.old');
      fs.copyFileSync(lock + '.old', lock);
    }
    const before = fs.readFileSync(lock);
    fails(cli(unwrap, ['--write', f.target], f));
    assert.deepEqual(fs.readFileSync(lock), before);
    assert.deepEqual(fs.readFileSync(f.target), original);
  });
}

test('failed record sync on retry cannot authorize target truncation', t => {
  const f = fixture(t);
  fails(cli(unwrap, ['--write', f.target], f, 'crash-record-synced'));
  fails(cli(unwrap, ['--write', f.target], f, 'record-sync-error'));
  hit(f, 'record-sync-error');
  assert.deepEqual(fs.readFileSync(f.target), original);
  savedOriginal(f);
  succeeds(cli(unwrap, ['--write', f.target], f));
});

test('invalid schema and mismatched saved bytes cannot be adopted', t => {
  const f = fixture(t);
  fails(cli(unwrap, ['--write', f.target], f, 'crash-record-synced'));
  const journal = f.target + RECOVERY_SUFFIX;
  const saved = fs.readFileSync(journal);
  for (const mutate of [value => { value.version = 99; }, value => { value.original.sha256 = '0'.repeat(64); }, value => { value.extra = true; }]) {
    const value = JSON.parse(saved);
    mutate(value);
    fs.writeFileSync(journal, JSON.stringify(value));
    const before = fs.readFileSync(journal);
    fails(cli(unwrap, ['--write', f.target], f));
    assert.deepEqual(fs.readFileSync(f.target), original);
    assert.deepEqual(fs.readFileSync(journal), before);
  }
});

test('pending repair rejects recorded alias substitution', { skip: process.platform !== 'win32' }, t => {
  const f = fixture(t);
  const alias = path.join(f.directory, 'alias.md');
  const other = path.join(f.directory, 'other.md');
  fs.writeFileSync(other, original);
  fs.symlinkSync(f.target, alias, 'file');
  fails(cli(unwrap, ['--write', alias], f, 'crash-record-synced'));
  fs.unlinkSync(alias);
  fs.symlinkSync(other, alias, 'file');
  fails(cli(unwrap, ['--write', f.target], f));
  assert.deepEqual(fs.readFileSync(f.target), original);
  assert.deepEqual(fs.readFileSync(other), original);
  savedOriginal(f);
});

test('legacy migration resumes after copying content while preserving its old lock', t => {
  const { Setup } = require('../internal/setup');
  const f = fixture(t, '.claude');
  const directory = path.join(f.directory, 'features');
  fs.mkdirSync(directory);
  const item = path.join(directory, 'item.md');
  fs.writeFileSync(item, 'First\nsecond\n');
  succeeds(cli(unwrap, ['--write', item], f));
  const bytes = fs.readFileSync(path.join(directory, LOCK_NAME));
  const migration = new Setup(f.root);
  try { assert.throws(() => migration.apply({ afterCopy() { throw new Error('Interrupted relocation'); } }), /Interrupted relocation/); }
  finally { migration.close(); }
  succeeds(cli(setup, ['apply', f.root, f.options], f));
  assert.deepEqual(fs.readFileSync(path.join(directory, LOCK_NAME)), bytes);
  assert.equal(fs.readFileSync(path.join(f.root, '.nightshift/features/item.md'), 'utf8'), 'First second\n');
});

test('migration refuses an active source lock even without a pending repair', async t => {
  const f = fixture(t, '.claude');
  const child = spawn(process.execPath, [path.join(__dirname, 'fixtures/unwrap-lock-holder.cjs'), f.directory, f.trace], { windowsHide: true, stdio: 'ignore' });
  const closed = once(child, 'close');
  t.after(() => { if (child.exitCode === null) child.kill(); });
  await waitForTrace(f, 'locked');
  const result = cli(setup, ['apply', f.root], f);
  fails(result);
  assert.match(result.stderr, /unwrap-busy/);
  assert.deepEqual(fs.readFileSync(f.target), original);
  assert.equal(fs.existsSync(path.join(f.root, '.nightshift/FEATURES.md')), false);
  fs.writeFileSync(f.trace + '.release', 'release\n');
  await closed;
  succeeds(cli(setup, ['apply', f.root], f));
});

test('case-varied orphan recovery is visible on Windows', { skip: process.platform !== 'win32' }, t => {
  const f = fixture(t);
  fails(cli(unwrap, ['--write', f.target], f, 'crash-record-synced'));
  fs.renameSync(f.target, f.target + '.old');
  fs.renameSync(f.target + RECOVERY_SUFFIX, path.join(f.directory, 'features.md.NIGHTSHIFT-UNWRAP.JSON'));
  fails(cli(setup, ['apply', f.root], f));
  fails(cli(ready, [f.root], f));
  assert.equal(fs.existsSync(f.target), false);
});

test('directory consumers retain recovery visibility after the selecting alias is replaced', { skip: process.platform !== 'win32' }, t => {
  const f = fixture(t);
  const alias = f.target;
  f.target = path.join(f.directory, 'contained.md');
  fs.renameSync(alias, f.target);
  fs.symlinkSync(f.target, alias, 'file');
  fails(cli(unwrap, ['--write', f.directory], f, 'target-write-error'));
  hit(f, 'target-partial');
  fs.unlinkSync(alias);
  fs.writeFileSync(alias, '# Features\n');
  const damaged = fs.readFileSync(f.target);
  const journal = fs.readFileSync(f.target + RECOVERY_SUFFIX);
  for (const [script, args] of [[unwrap, [f.directory]], [unwrap, ['--write', f.directory]], [ready, [f.root]], [setup, ['apply', f.root]], [setup, ['apply', f.root, f.options]]]) {
    const result = cli(script, args, f);
    fails(result);
    assert.match(result.stdout + result.stderr, /recovery/);
  }
  assert.equal(JSON.parse(cli(setup, ['inspect', f.root], f).stdout).status, 'unwrap-recovery-required');
  assert.deepEqual(fs.readFileSync(f.target), damaged);
  assert.deepEqual(fs.readFileSync(f.target + RECOVERY_SUFFIX), journal);
  assert.equal(fs.readFileSync(alias, 'utf8'), '# Features\n');
});

for (const [consumer, scenario] of [['ready', 'before'], ['ready', 'after-failure'], ['ready', 'after-complete'], ['unwrap', 'after-failure'], ['unwrap', 'after-complete']]) {
  test(`${consumer} refuses stale read evidence when a writer runs ${scenario}`, t => {
    const f = fixture(t);
    const env = { ...process.env, NODE_OPTIONS: `--require "${path.join(__dirname, 'fixtures/unwrap-read-race.cjs').split(path.sep).join('/')}"`, NIGHTSHIFT_READ_RACE: scenario, NIGHTSHIFT_UNWRAP_TARGET: f.target, NIGHTSHIFT_UNWRAP_TRACE: f.trace };
    const result = spawnSync(process.execPath, [consumer === 'ready' ? ready : unwrap, '--development', f.directory], { env, encoding: 'utf8', windowsHide: true, timeout: 30000 });
    assert.equal(result.error, undefined);
    hit(f, 'writer-ran');
    fails(result);
    assert.match(result.stdout + result.stderr, /unwrap-recovery-required|backlog-changed/);
    if (scenario === 'after-complete') {
      assert.deepEqual(fs.readFileSync(f.target), replacement);
      assert.equal(fs.existsSync(f.target + RECOVERY_SUFFIX), false);
    } else savedOriginal(f);
  });
}

async function withHeldLock(f, directory, body) {
  const child = spawn(process.execPath, [path.join(__dirname, 'fixtures/unwrap-lock-holder.cjs'), directory, f.trace], { windowsHide: true, stdio: 'ignore' });
  const closed = once(child, 'close');
  try {
    await waitForTrace(f, 'locked');
    await body();
  } finally {
    if (child.exitCode === null) child.kill();
    await closed;
  }
}

for (const folder of ['inbox', 'plans', 'specs', 'runs', 'custom/nested']) {
  test(`migration holds existing source locks in ${folder}`, async t => {
    const f = fixture(t, '.claude');
    const directory = path.join(f.directory, folder);
    fs.mkdirSync(directory, { recursive: true });
    const item = path.join(directory, 'item.md');
    fs.writeFileSync(item, 'First\nsecond\n');
    fs.writeFileSync(f.options, JSON.stringify({ ownership: { ['.claude/' + folder]: 'nightshift' } }));
    await withHeldLock(f, directory, () => {
      const result = cli(setup, ['apply', f.root, f.options], f);
      fails(result);
      assert.match(result.stderr, /unwrap-busy/);
      assert.equal(fs.readFileSync(item, 'utf8'), 'First\nsecond\n');
      assert.equal(fs.existsSync(path.join(f.root, '.nightshift', folder, 'item.md')), false);
    });
    succeeds(cli(setup, ['apply', f.root, f.options], f));
    assert.equal(fs.readFileSync(path.join(f.root, '.nightshift', folder, 'item.md'), 'utf8'), 'First\nsecond\n');
  });
}

test('migration respects explicit preservation while another source directory is locked', async t => {
  const f = fixture(t, '.claude');
  const directory = path.join(f.directory, 'inbox');
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, 'item.md'), 'User-owned\n');
  fs.writeFileSync(f.options, JSON.stringify({ ownership: { '.claude/inbox': 'preserve' } }));
  await withHeldLock(f, directory, () => succeeds(cli(setup, ['apply', f.root, f.options], f)));
  assert.equal(fs.readFileSync(path.join(directory, 'item.md'), 'utf8'), 'User-owned\n');
  assert.equal(fs.existsSync(path.join(f.root, '.nightshift/inbox/item.md')), false);
});

for (const unwrapEnabled of [false, true]) {
  for (const fault of ['crash-record-synced', 'target-write-error']) {
    test(`migration preserves an individual target and its ${fault} recovery with unwrap=${unwrapEnabled}`, t => {
      const f = fixture(t, '.claude');
      const directory = path.join(f.directory, 'runs');
      fs.mkdirSync(directory);
      fs.writeFileSync(path.join(f.root, '.gitignore'), '/.claude/runs/\n');
      f.target = path.join(directory, 'item.md');
      fs.writeFileSync(f.target, original);
      fails(cli(unwrap, ['--write', f.target], f, fault));
      hit(f, fault === 'crash-record-synced' ? 'record-synced' : 'target-partial');
      const before = fs.readFileSync(f.target);
      const evidence = fs.readFileSync(f.target + RECOVERY_SUFFIX);
      const lock = fs.readFileSync(path.join(directory, LOCK_NAME));
      fs.writeFileSync(f.options, JSON.stringify({ ownership: { '.claude/runs/item.md': 'preserve' }, unwrap: unwrapEnabled }));
      succeeds(cli(setup, ['apply', f.root, f.options], f));
      assert.deepEqual(fs.readFileSync(f.target), before);
      assert.deepEqual(fs.readFileSync(f.target + RECOVERY_SUFFIX), evidence);
      assert.deepEqual(fs.readFileSync(path.join(directory, LOCK_NAME)), lock);
      assert.equal(fs.existsSync(path.join(f.root, '.nightshift/runs/item.md' + RECOVERY_SUFFIX)), false);
      const retry = cli(unwrap, ['--write', f.target], f);
      if (fault === 'crash-record-synced') {
        succeeds(retry);
        assert.deepEqual(fs.readFileSync(f.target), replacement);
        assert.equal(fs.existsSync(f.target + RECOVERY_SUFFIX), false);
      } else {
        fails(retry);
        assert.match(retry.stdout, /unwrap-recovery-conflict/);
        assert.deepEqual(fs.readFileSync(f.target), before);
        assert.deepEqual(fs.readFileSync(f.target + RECOVERY_SUFFIX), evidence);
      }
    });
  }
}

for (const choice of ['preserve', 'nightshift']) {
  test(`migration honors ${choice} for an ordinary empty directory with a recovery suffix`, t => {
    const f = fixture(t, '.claude');
    const name = 'custom' + RECOVERY_SUFFIX;
    const source = path.join(f.directory, name);
    const destination = path.join(f.root, '.nightshift', name);
    fs.mkdirSync(source);
    fs.writeFileSync(f.options, JSON.stringify({ ownership: { ['.claude/' + name]: choice } }));
    succeeds(cli(setup, ['apply', f.root, f.options], f));
    assert.equal(fs.existsSync(source), choice === 'preserve');
    assert.equal(fs.existsSync(destination), choice === 'nightshift');
    assert.deepEqual(fs.readdirSync(choice === 'preserve' ? source : destination), []);
  });
}

test('legacy pending repair outside the prose catalog blocks relocation until reconciled', t => {
  const f = fixture(t, '.claude');
  const directory = path.join(f.directory, 'inbox');
  fs.mkdirSync(directory);
  f.target = path.join(directory, 'item.md');
  fs.writeFileSync(f.target, original);
  fails(cli(unwrap, ['--write', f.target], f, 'target-write-error'));
  const damaged = fs.readFileSync(f.target);
  fails(cli(setup, ['apply', f.root], f));
  fails(cli(setup, ['apply', f.root, f.options], f));
  assert.equal(JSON.parse(cli(setup, ['inspect', f.root], f).stdout).status, 'unwrap-recovery-required');
  assert.deepEqual(fs.readFileSync(f.target), damaged);
  savedOriginal(f);
});

test('interrupted migration retains explicit source lock scope when options are omitted on retry', async t => {
  const { Setup } = require('../internal/setup');
  const f = fixture(t, '.claude');
  const directory = path.join(f.directory, 'custom/nested');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'item.md'), 'First\nsecond\n');
  succeeds(cli(unwrap, ['--write', path.join(directory, 'item.md')], f));
  const migration = new Setup(f.root);
  try { assert.throws(() => migration.apply({ ownership: { '.claude/custom/nested': 'nightshift' }, afterCopy() { throw new Error('Interrupted'); } }), /Interrupted/); }
  finally { migration.close(); }
  await withHeldLock(f, directory, () => {
    const result = cli(setup, ['apply', f.root], f);
    fails(result);
    assert.match(result.stderr, /unwrap-busy/);
  });
  succeeds(cli(setup, ['apply', f.root], f));
  assert.equal(fs.readFileSync(path.join(f.root, '.nightshift/custom/nested/item.md'), 'utf8'), 'First second\n');
});

for (const scope of ['file', 'directory']) {
  test(`write-mode no-op race reports pending recovery for ${scope} scope`, t => {
    const f = fixture(t);
    const env = { ...process.env, NIGHTSHIFT_UNWRAP_TARGET: f.target, NIGHTSHIFT_UNWRAP_TRACE: f.trace };
    delete env.NODE_OPTIONS;
    const result = spawnSync(process.execPath, ['--require', path.join(__dirname, 'fixtures/unwrap-noop-race.cjs'), unwrap, '--development', '--write', scope === 'file' ? f.target : f.directory], { env, encoding: 'utf8', windowsHide: true, timeout: 30000 });
    assert.equal(result.error, undefined);
    hit(f, 'writer-before-noop-read');
    fails(result);
    assert.match(result.stdout, /unwrap-recovery-required/);
    assert.equal(fs.readFileSync(f.target).length, 6);
    savedOriginal(f);
  });
}

test('directory-junction substitution cannot hide a nested canonical recovery record', { skip: process.platform !== 'win32' }, t => {
  const f = fixture(t);
  const contained = path.join(f.directory, 'contained');
  const alias = path.join(f.directory, 'features');
  fs.mkdirSync(path.join(contained, 'nested'), { recursive: true });
  f.target = path.join(contained, 'nested/item.md');
  fs.writeFileSync(f.target, original);
  fs.symlinkSync(contained, alias, 'junction');
  fails(cli(unwrap, ['--write', f.directory], f, 'target-write-error'));
  hit(f, 'target-partial');
  fs.unlinkSync(alias);
  fs.mkdirSync(alias);
  const before = fs.readFileSync(f.target);
  const journal = fs.readFileSync(f.target + RECOVERY_SUFFIX);
  for (const [script, args] of [[unwrap, [f.directory]], [unwrap, ['--write', f.directory]], [ready, [f.root]], [setup, ['apply', f.root]], [setup, ['apply', f.root, f.options]]]) fails(cli(script, args, f));
  assert.equal(JSON.parse(cli(setup, ['inspect', f.root], f).stdout).status, 'unwrap-recovery-required');
  assert.deepEqual(fs.readFileSync(f.target), before);
  assert.deepEqual(fs.readFileSync(f.target + RECOVERY_SUFFIX), journal);
  assert.deepEqual(fs.readdirSync(alias), []);
});

for (const protectedDirectory of ['runs', 'setup', '.git']) {
  test(`catalog aliases do not import protected ${protectedDirectory} evidence into backlog repairs`, { skip: process.platform !== 'win32' }, t => {
    const f = fixture(t);
    const directory = path.join(f.directory, protectedDirectory);
    fs.mkdirSync(directory, { recursive: true });
    const target = path.join(directory, 'private.md');
    const evidence = Buffer.from('Opaque private fixture evidence\n');
    fs.writeFileSync(target, original);
    fs.writeFileSync(target + RECOVERY_SUFFIX, evidence);
    fs.symlinkSync(directory, path.join(f.directory, 'features'), 'junction');
    succeeds(cli(unwrap, ['--write', f.directory], f));
    succeeds(cli(unwrap, [f.directory], f));
    succeeds(cli(ready, [f.root], f));
    assert.deepEqual(fs.readFileSync(target), original);
    assert.deepEqual(fs.readFileSync(target + RECOVERY_SUFFIX), evidence);
    fails(cli(unwrap, [target], f));
  });
}

for (const phase of ['current', 'legacy']) {
  test(`setup names completed ${phase} recoveries before a later conflict`, t => {
    const f = fixture(t);
    const directory = phase === 'current' ? f.directory : path.join(f.root, '.claude');
    fs.mkdirSync(directory, { recursive: true });
    const first = path.join(directory, 'BUGS.md');
    fs.writeFileSync(first, original);
    const firstFixture = { ...f, target: first, trace: path.join(f.root, 'first.log') };
    fails(cli(unwrap, ['--write', first], firstFixture, 'crash-record-synced'));
    hit(firstFixture, 'record-synced');
    fails(cli(unwrap, ['--write', f.target], f, 'target-write-error'));
    hit(f, 'target-partial');
    const secondBefore = fs.readFileSync(f.target);
    const result = cli(setup, ['apply', f.root, f.options], f);
    fails(result);
    const error = JSON.parse(result.stderr.split('\n').find(line => line.startsWith('{')));
    assert.equal(error.error, 'unwrap-recovery-conflict');
    assert.deepEqual(error.completed.map(entry => entry.file), [first]);
    assert.equal(error.completed[0].rewritten, true);
    assert.deepEqual(fs.readFileSync(first), replacement);
    assert.equal(fs.existsSync(first + RECOVERY_SUFFIX), false);
    assert.deepEqual(fs.readFileSync(f.target), secondBefore);
    savedOriginal(f);
  });
}

for (const preserveParent of [false, true]) {
  test(`individual source file includes its parent lock with preserved parent=${preserveParent}`, async t => {
    const f = fixture(t, '.claude');
    const directory = path.join(f.directory, 'custom');
    fs.mkdirSync(directory);
    const target = path.join(directory, 'x.md');
    const sibling = path.join(directory, 'y.md');
    fs.writeFileSync(target, 'Selected file\n');
    fs.writeFileSync(sibling, 'Preserved sibling\n');
    const ownership = { ...(preserveParent ? { '.claude/custom': 'preserve' } : {}), '.claude/custom/x.md': 'nightshift' };
    fs.writeFileSync(f.options, JSON.stringify({ ownership }));
    await withHeldLock(f, directory, () => {
      const result = cli(setup, ['apply', f.root, f.options], f);
      fails(result);
      assert.match(result.stderr, /unwrap-busy/);
      assert.equal(fs.readFileSync(target, 'utf8'), 'Selected file\n');
      assert.equal(fs.existsSync(path.join(f.root, '.nightshift/custom/x.md')), false);
    });
    succeeds(cli(setup, ['apply', f.root, f.options], f));
    assert.equal(fs.readFileSync(path.join(f.root, '.nightshift/custom/x.md'), 'utf8'), 'Selected file\n');
    assert.equal(fs.readFileSync(sibling, 'utf8'), 'Preserved sibling\n');
  });
}

test('individual source file includes its safe pending recovery record', t => {
  const f = fixture(t, '.claude');
  const directory = path.join(f.directory, 'custom');
  fs.mkdirSync(directory);
  f.target = path.join(directory, 'x.md');
  fs.writeFileSync(f.target, original);
  fails(cli(unwrap, ['--write', f.target], f, 'crash-record-synced'));
  hit(f, 'record-synced');
  fs.writeFileSync(f.options, JSON.stringify({ ownership: { '.claude/custom/x.md': 'nightshift' }, unwrap: true }));
  const result = cli(setup, ['apply', f.root, f.options], f);
  succeeds(result);
  assert.ok(JSON.parse(result.stdout).unwrapped.some(entry => entry.file === f.target && entry.recovered === true));
  assert.deepEqual(fs.readFileSync(path.join(f.root, '.nightshift/custom/x.md')), replacement);
});

for (const missingFirst of [false, true]) {
  test(`standalone validates missing inputs before recovery, missing first=${missingFirst}`, t => {
    const f = fixture(t);
    fails(cli(unwrap, ['--write', f.target], f, 'crash-record-synced'));
    hit(f, 'record-synced');
    const journal = fs.readFileSync(f.target + RECOVERY_SUFFIX);
    const missing = path.join(f.root, 'missing.md');
    const result = cli(unwrap, ['--write', ...(missingFirst ? [missing, f.target] : [f.target, missing])], f);
    fails(result);
    assert.match(result.stderr, /no such file/);
    assert.deepEqual(fs.readFileSync(f.target), original);
    assert.deepEqual(fs.readFileSync(f.target + RECOVERY_SUFFIX), journal);
  });
}

test('standalone collection failure cannot hide a completed pending recovery', t => {
  const f = fixture(t);
  fails(cli(unwrap, ['--write', f.target], f, 'crash-record-synced'));
  const journal = fs.readFileSync(f.target + RECOVERY_SUFFIX);
  const blocked = path.join(f.root, 'blocked');
  fs.mkdirSync(blocked);
  const env = { ...process.env, NIGHTSHIFT_UNWRAP_BLOCKED_DIRECTORY: blocked, NIGHTSHIFT_UNWRAP_TRACE: f.trace };
  delete env.NODE_OPTIONS;
  const result = spawnSync(process.execPath, ['--require', path.join(__dirname, 'fixtures/unwrap-selection-error.cjs'), unwrap, '--development', '--write', f.target, blocked], { env, encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.equal(result.error, undefined);
  hit(f, 'selection-read-failed');
  fails(result);
  assert.deepEqual(fs.readFileSync(f.target), original);
  assert.deepEqual(fs.readFileSync(f.target + RECOVERY_SUFFIX), journal);
});

test('missing standalone target reports its retained recovery location', t => {
  const f = fixture(t);
  fails(cli(unwrap, ['--write', f.target], f, 'crash-record-synced'));
  fs.renameSync(f.target, f.target + '.old');
  const result = cli(unwrap, ['--write', f.target], f);
  fails(result);
  assert.ok(JSON.parse(result.stdout).some(entry => entry.recoveryFile === f.target + RECOVERY_SUFFIX));
  assert.deepEqual(fs.readFileSync(f.target + '.old'), original);
  savedOriginal(f);
});
