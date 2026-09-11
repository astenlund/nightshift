'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { Setup, initialize, rewriteReferences } = require('../internal/setup');
const { RunStore } = require('../internal/runtime/store');
const { DIMENSIONS, transition } = require('../internal/runtime/lifecycle');
const { execute } = require('../internal/runtime/cli');

function git(root, args, statuses = [0]) {
  const result = spawnSync('git', args, { cwd: root, windowsHide: true, encoding: 'utf8' });
  assert.ok(statuses.includes(result.status), result.stderr);
  return result;
}

function fixture(t) {
  const parent = path.resolve(__dirname, '../.tmp/setup-tests');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'case-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, ['init', '--quiet']);
  return root;
}

function write(root, file, content) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

test('nonlocal namespaces are preserved before filesystem dot-segment normalization', t => {
  const root = fixture(t);
  write(root, '.claude/features/a.md', '# A\r\n');
  const references = ['https://example.test/../../.claude/features/a.md', 'ftp://example.test/../../.claude/features/a.md', 'file:/../.claude/features/a.md', 'C:/../.claude/features/a.md', '//example.test/../../.claude/features/a.md', '/other/../.claude/features/a.md'];
  write(root, 'consumer.json', JSON.stringify({ references, local: path.join(root, '.claude/features/a.md') }) + '\r\n');
  write(root, 'consumer.yaml', 'url: ' + references[0] + '\r\n');
  write(root, 'consumer.toml', 'url = "' + references[1] + '"\r\n');
  write(root, 'consumer.cjs', 'module.exports = ' + JSON.stringify(references) + ';\r\n');
  write(root, 'README.md', '[External](' + references[0] + ')\r\n');
  const before = Object.fromEntries(['consumer.yaml', 'consumer.toml', 'consumer.cjs', 'README.md'].map(file => [file, fs.readFileSync(path.join(root, file))]));
  const setup = new Setup(root);
  try { assert.equal(setup.apply({ historicalReferences: ['consumer.cjs'] }).status, 'complete'); } finally { setup.close(); }
  const result = JSON.parse(fs.readFileSync(path.join(root, 'consumer.json'), 'utf8'));
  assert.deepEqual(result.references, references);
  assert.equal(new URL(result.references[0]).protocol, 'https:');
  assert.equal(new URL(result.references[1]).protocol, 'ftp:');
  assert.equal(fs.readFileSync(result.local, 'utf8'), '# A\r\n');
  for (const [file, bytes] of Object.entries(before)) assert.deepEqual(fs.readFileSync(path.join(root, file)), bytes);
  assert.equal(rewriteReferences(Buffer.from('const remote = "' + references[0] + '";'), [{ source: '.claude/features/a.md', destination: '.nightshift/features/a.md' }]).toString(), 'const remote = "' + references[0] + '";');
});

for (const preserveSharp of [false, true]) {
  test(`distinct Windows filenames retain their own consumers with preserved=${preserveSharp}`, { skip: process.platform !== 'win32' }, t => {
    const root = fixture(t);
    const sharp = 'stra' + String.fromCharCode(223) + 'e.md';
    const legacy = '.claude/features/' + sharp;
    write(root, '.claude/features/STRASSE.md', 'First file\r\n');
    write(root, legacy, 'Distinct second file\r\n');
    write(root, 'consumer.json', JSON.stringify({ first: '.claude/features/STRASSE.md', second: legacy, absolute: path.join(root, legacy) }) + '\r\n');
    const setup = new Setup(root);
    try { assert.equal(setup.apply({ ownership: preserveSharp ? { [legacy]: 'preserve' } : {} }).status, 'complete'); } finally { setup.close(); }
    const values = JSON.parse(fs.readFileSync(path.join(root, 'consumer.json'), 'utf8'));
    assert.equal(fs.readFileSync(path.join(root, values.first), 'utf8'), 'First file\r\n');
    assert.equal(fs.readFileSync(path.join(root, values.second), 'utf8'), 'Distinct second file\r\n');
    assert.equal(fs.readFileSync(values.absolute, 'utf8'), 'Distinct second file\r\n');
    assert.equal(values.second, preserveSharp ? legacy : '.nightshift/features/' + sharp);
  });
}

test('unsupported case aliases are diagnosed before migration instead of choosing a destination', { skip: process.platform !== 'win32' }, t => {
  const root = fixture(t);
  write(root, '.claude/features/a.md', '# A\r\n');
  write(root, 'consumer.json', '{"file":".CLAUDE/FEATURES/A.MD"}\r\n');
  assert.equal(fs.readFileSync(path.join(root, JSON.parse(fs.readFileSync(path.join(root, 'consumer.json'), 'utf8')).file), 'utf8'), '# A\r\n');
  const setup = new Setup(root);
  try {
    assert.deepEqual(setup.inspect().referenceDecisions, ['consumer.json']);
    assert.throws(() => setup.apply(), { code: 'reference-policy-required' });
    assert.equal(fs.existsSync(path.join(root, '.claude/features/a.md')), true);
    assert.equal(fs.existsSync(path.join(root, '.nightshift/features/a.md')), false);
    write(root, 'consumer.json', '{"file":".claude/features/a.md"}\r\n');
    assert.equal(setup.apply().status, 'complete');
  } finally { setup.close(); }
});

test('JSON consumer paths are decoded before Windows identity and ownership mapping', { skip: process.platform !== 'win32' }, t => {
  const root = fixture(t);
  const slash = String.fromCharCode(92);
  const native = (...parts) => ['.claude', ...parts].join(slash);
  const accented = 'a-' + String.fromCharCode(233) + '.md';
  write(root, '.claude/features/a.md', '# A\r\n');
  write(root, '.claude/features/' + accented, '# Encoded filename\r\n');
  write(root, '.claude/settings.json', '{}\r\n');
  const values = { directory: native('features'), file: native('features', 'a.md'), dot: ['.', native('features', 'a.md')].join(slash), absolute: path.join(root, '.claude/features/a.md'), encoded: '.claude/features/' + accented, host: native('settings.json'), sibling: native('features-old'), external: 'https://example.test/.claude/features/a.md' };
  const encoded = JSON.stringify(values).replaceAll(String.fromCharCode(233), slash + 'u00e9');
  write(root, 'consumer.json', encoded + '\r\n');
  write(root, 'escaped-dot.json', '{"file":"' + slash + 'u002eclaude/features/a.md"}\r\n');
  write(root, 'escaped-slashes.json', '{"file":' + JSON.stringify('.claude/features/a.md').replaceAll('/', slash + '/') + '}\r\n');
  write(root, 'consumer.cjs', "const fs = require('node:fs'); const value = require('./consumer.json'); fs.readdirSync(value.directory); for (const key of ['file', 'dot', 'absolute', 'encoded', 'host']) fs.readFileSync(value[key]); for (const file of ['escaped-dot.json', 'escaped-slashes.json']) fs.readFileSync(require('./' + file).file);\r\n");
  const run = () => spawnSync(process.execPath, ['consumer.cjs'], { cwd: root, windowsHide: true, encoding: 'utf8' });
  assert.equal(run().status, 0);
  const setup = new Setup(root);
  try {
    assert.deepEqual(setup.inspect().referenceDecisions, []);
    assert.equal(setup.apply().status, 'complete');
  } finally { setup.close(); }
  assert.equal(run().status, 0);
  const result = JSON.parse(fs.readFileSync(path.join(root, 'consumer.json'), 'utf8'));
  assert.equal(result.directory, ['.nightshift', 'features'].join(slash));
  assert.equal(result.absolute, path.join(root, '.nightshift/features/a.md'));
  for (const key of ['host', 'sibling', 'external']) assert.equal(result[key], values[key]);
  assert.ok(fs.readFileSync(path.join(root, 'consumer.json')).every(byte => byte < 128));
});

for (const extension of ['yaml', 'toml']) {
  test(`unsupported native ${extension} path literals are diagnosed before relocation`, { skip: process.platform !== 'win32' }, t => {
    const root = fixture(t);
    const slash = String.fromCharCode(92);
    const native = ['.claude', 'features', 'a.md'].join(slash);
    write(root, '.claude/features/a.md', '# A\r\n');
    const content = extension === 'yaml' ? 'file: ' + native + '\r\n' : "file = '" + native + "'\r\n";
    const file = 'consumer.' + extension;
    write(root, file, content);
    const setup = new Setup(root);
    try {
      assert.deepEqual(setup.inspect().referenceDecisions, [file]);
      assert.throws(() => setup.apply(), { code: 'reference-policy-required' });
      assert.equal(fs.existsSync(path.join(root, '.claude/features/a.md')), true);
      assert.equal(fs.existsSync(path.join(root, '.nightshift/features/a.md')), false);
      assert.equal(fs.readFileSync(path.join(root, file), 'utf8'), content);
      write(root, file, content.replaceAll(slash, '/'));
      assert.equal(setup.apply().status, 'complete');
    } finally { setup.close(); }
    assert.ok(fs.readFileSync(path.join(root, file), 'utf8').includes('.nightshift/features/a.md'));
  });
}

for (const populated of [false, true]) {
  test(`directory consumers share ownership-aware migration mappings with populated=${populated}`, t => {
    const root = fixture(t);
    fs.mkdirSync(path.join(root, '.claude/features'), { recursive: true });
    if (populated) write(root, '.claude/features/a.md', '# A\r\n');
    write(root, 'consumer.cjs', "require('node:fs').readdirSync('.claude/features');\r\nrequire('node:fs').readdirSync('.claude/features/');\r\n");
    write(root, 'consumer.json', '{"directory":".claude/features","slash":".claude/features/","sibling":".claude/features-old"}\r\n');
    write(root, 'consumer.yaml', 'directory: .claude/features\r\n');
    write(root, 'consumer.toml', 'directory = ".claude/features"\r\n');
    write(root, 'docs/README.md', '[Directory](../.claude/features) [Slash](../.claude/features/)\r\n\r\n[Defined]: ../.claude/features#anchor\r\n');
    write(root, 'history.md', '` .claude/features ` and [Directory](.claude/features)\r\n');
    const run = () => spawnSync(process.execPath, ['consumer.cjs'], { cwd: root, windowsHide: true, encoding: 'utf8' });
    assert.equal(run().status, 0);
    const setup = new Setup(root);
    try {
      assert.deepEqual(setup.inspect().referenceDecisions, ['consumer.cjs']);
      assert.throws(() => setup.apply(), { code: 'reference-policy-required' });
      const options = { activeReferences: ['consumer.cjs'], historicalReferences: ['history.md'] };
      assert.deepEqual(setup.inspect(options).referenceDecisions, []);
      assert.equal(setup.apply(options).status, 'complete');
      assert.equal(setup.apply().status, 'complete');
    } finally { setup.close(); }
    assert.equal(run().status, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'consumer.json'), 'utf8')), { directory: '.nightshift/features', slash: '.nightshift/features/', sibling: '.claude/features-old' });
    assert.equal(fs.readFileSync(path.join(root, 'consumer.yaml'), 'utf8'), 'directory: .nightshift/features\r\n');
    assert.equal(fs.readFileSync(path.join(root, 'consumer.toml'), 'utf8'), 'directory = ".nightshift/features"\r\n');
    assert.equal(fs.readFileSync(path.join(root, 'docs/README.md'), 'utf8'), '[Directory](../.nightshift/features) [Slash](../.nightshift/features)\r\n\r\n[Defined]: ../.nightshift/features#anchor\r\n');
    assert.equal(fs.readFileSync(path.join(root, 'history.md'), 'utf8'), '` .claude/features ` and [Directory](.nightshift/features)\r\n');
    assert.equal(fs.existsSync(path.join(root, '.claude/features')), false);
  });
}

test('partly preserved directory identities stay at their existing home', t => {
  const root = fixture(t);
  write(root, '.claude/features/owned.md', '# Owned\r\n');
  write(root, '.claude/features/preserved.md', '# Preserved\r\n');
  write(root, 'consumer.json', '{"directory":".claude/features","slash":".claude/features/","owned":".claude/features/owned.md"}\r\n');
  write(root, 'README.md', '[Directory](.claude/features) [Owned](.claude/features/owned.md)\r\n');
  const setup = new Setup(root);
  try { setup.apply({ ownership: { '.claude/features/preserved.md': 'preserve' } }); } finally { setup.close(); }
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'consumer.json'), 'utf8')), { directory: '.claude/features', slash: '.claude/features/', owned: '.nightshift/features/owned.md' });
  assert.equal(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), '[Directory](.claude/features) [Owned](.nightshift/features/owned.md)\r\n');
  assert.equal(fs.existsSync(path.join(root, '.claude/features/preserved.md')), true);
});

test('active configuration uses normalized project path identities while retaining explicit dot prefixes', t => {
  const root = fixture(t);
  write(root, '.claude/features/a.md', '# Accepted\r\n');
  write(root, '.claude/settings.json', '{}\r\n');
  write(root, 'consumer.json', JSON.stringify({ directory: './.claude/features', file: './.claude/features/./a.md', normalized: '.claude/features/../features/a.md', host: './.claude/features/../settings.json', sibling: './.claude/features-old', external: 'https://example.test/.claude/features/a.md' }) + '\r\n');
  write(root, 'consumer.cjs', "const fs = require('node:fs'); const config = require('./consumer.json'); fs.readdirSync(config.directory); fs.readFileSync(config.file); fs.readFileSync(config.normalized); fs.readFileSync(config.host);\r\n");
  const run = () => spawnSync(process.execPath, ['consumer.cjs'], { cwd: root, windowsHide: true, encoding: 'utf8' });
  assert.equal(run().status, 0);
  const setup = new Setup(root);
  try {
    assert.deepEqual(setup.inspect().referenceDecisions, []);
    assert.equal(setup.apply().status, 'complete');
  } finally { setup.close(); }
  assert.equal(run().status, 0);
  const config = JSON.parse(fs.readFileSync(path.join(root, 'consumer.json'), 'utf8'));
  assert.equal(config.directory, './.nightshift/features');
  assert.equal(config.file, './.nightshift/features/a.md');
  assert.equal(config.normalized, '.nightshift/features/a.md');
  assert.equal(config.host, './.claude/features/../settings.json');
  assert.equal(config.sibling, './.claude/features-old');
  assert.equal(config.external, 'https://example.test/.claude/features/a.md');
});

test('explicit ownership preserves unrelated specs and survives interrupted relocation', t => {
  const root = fixture(t);
  write(root, '.claude/specs/owned.md', '# Nightshift spec\n');
  write(root, '.claude/specs/other.md', '# Another tool owns this\n');
  write(root, 'tests/fixtures/links.md', '[Owned](../../.claude/specs/owned.md) [Other](../../.claude/specs/other.md)\n');
  write(root, 'VISION.md', '` .claude/specs/owned.md `\n');
  const options = { ownership: { '.claude/specs/owned.md': 'nightshift', '.claude/specs/other.md': 'preserve' } };
  let setup = new Setup(root);
  try {
    assert.deepEqual(setup.inspect().undecided, ['.claude/specs/other.md', '.claude/specs/owned.md']);
    assert.throws(() => setup.apply(), { code: 'uncertain-ownership' });
    assert.throws(() => setup.apply({ ...options, afterCopy: () => { throw new Error('interrupted'); } }), /interrupted/);
  } finally { setup.close(); }
  setup = new Setup(root);
  try {
    assert.throws(() => setup.apply({ ownership: { '.claude/specs': 'nightshift' } }), { code: 'migration-policy-drift' });
    const result = setup.apply();
    assert.equal(result.status, 'complete');
    assert.deepEqual(result.policy.ownership, options.ownership);
    assert.equal(setup.apply().status, 'complete');
  } finally { setup.close(); }
  assert.equal(fs.readFileSync(path.join(root, '.claude/specs/other.md'), 'utf8'), '# Another tool owns this\n');
  assert.equal(fs.existsSync(path.join(root, '.claude/specs/owned.md')), false);
  assert.equal(fs.readFileSync(path.join(root, 'tests/fixtures/links.md'), 'utf8'), '[Owned](../../.nightshift/specs/owned.md) [Other](../../.claude/specs/other.md)\n');
  assert.equal(fs.readFileSync(path.join(root, 'VISION.md'), 'utf8'), '` .nightshift/specs/owned.md `\n');
});

for (const source of ['.claude/custom-spec.md', '.claude/specs/known.md']) {
  test(`explicit file ownership relocates ${source} and reconciles its empty parent`, t => {
    const root = fixture(t);
    write(root, source, '# Accepted custom spec\n');
    const setup = new Setup(root);
    try {
      const result = setup.apply({ ownership: { [source]: 'nightshift' } });
      assert.equal(result.status, 'complete');
      assert.equal(result.files.length, 1);
      assert.equal(setup.apply().status, 'complete');
    } finally { setup.close(); }
    assert.equal(fs.existsSync(path.join(root, source)), false);
    assert.equal(fs.readFileSync(path.join(root, source.replace('.claude/', '.nightshift/')), 'utf8'), '# Accepted custom spec\n');
  });
}

test('historical inline examples retain literal Markdown while real navigation moves', () => {
  const content = '`[Example](.claude/features/a.md)` and ``[Other](.claude/features/a.md)``\r\n\r\n[Live](.claude/features/a.md)\r\n';
  const rewritten = rewriteReferences(Buffer.from(content), [{ source: '.claude/features/a.md', destination: '.nightshift/features/a.md' }], { markdown: true, historical: true });
  assert.equal(rewritten.toString(), '`[Example](.claude/features/a.md)` and ``[Other](.claude/features/a.md)``\r\n\r\n[Live](.nightshift/features/a.md)\r\n');
});

test('whole configuration documents migrate independently of their first token and retain external URLs', t => {
  const root = fixture(t);
  write(root, '.claude/features/a.md', '# Accepted\n');
  write(root, 'active.yaml', 'spec: .claude/features/a.md\n');
  write(root, 'active.toml', '# Active configuration\nspec = ".claude/features/a.md"\n');
  write(root, 'active.json', '{"spec":".claude/features/a.md","remote":"https://example.test/.claude/features/a.md"}\n');
  const setup = new Setup(root);
  try { assert.equal(setup.apply().status, 'complete'); } finally { setup.close(); }
  assert.equal(fs.readFileSync(path.join(root, 'active.yaml'), 'utf8'), 'spec: .nightshift/features/a.md\n');
  assert.equal(fs.readFileSync(path.join(root, 'active.toml'), 'utf8'), '# Active configuration\nspec = ".nightshift/features/a.md"\n');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'active.json'), 'utf8')), { spec: '.nightshift/features/a.md', remote: 'https://example.test/.claude/features/a.md' });
});

test('exact path rewriting preserves filename-prefix siblings, including spaces', t => {
  const root = fixture(t);
  write(root, '.claude/features/a.md', '# Moving\n');
  write(root, '.claude/features/a.md.bak', 'Preserved backup\n');
  write(root, '.claude/features/a.md backup', 'Preserved spaced backup\n');
  write(root, 'config.json', '{"moving":".claude/features/a.md","backup":".claude/features/a.md.bak","spaced":".claude/features/a.md backup"}\n');
  write(root, 'config.yaml', 'moving: .claude/features/a.md   # current\nbackup: .claude/features/a.md.bak\nspaced: .claude/features/a.md backup\n');
  write(root, 'README.md', '` .claude/features/a.md.bak ` and `.claude/features/a.md backup`\n');
  const setup = new Setup(root);
  try { setup.apply({ ownership: { '.claude/features/a.md.bak': 'preserve', '.claude/features/a.md backup': 'preserve' } }); } finally { setup.close(); }
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8')), { moving: '.nightshift/features/a.md', backup: '.claude/features/a.md.bak', spaced: '.claude/features/a.md backup' });
  assert.equal(fs.readFileSync(path.join(root, 'config.yaml'), 'utf8'), 'moving: .nightshift/features/a.md   # current\nbackup: .claude/features/a.md.bak\nspaced: .claude/features/a.md backup\n');
  assert.equal(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), '` .claude/features/a.md.bak ` and `.claude/features/a.md backup`\n');
});

test('literal Git identities and escaped ignore rules preserve bracketed filenames', t => {
  const root = fixture(t);
  write(root, '.claude/features/a.md', '# Tracked sibling\n');
  write(root, '.claude/features/[ab].md', '# Private literal filename\n');
  write(root, '.git/info/exclude', '/.claude/features/\\[ab\\].md\n');
  git(root, ['add', '.claude/features/a.md']);
  const setup = new Setup(root);
  try {
    const file = setup.inspect().files.find(move => move.source.endsWith('/[ab].md'));
    assert.equal(file.tracked, false);
    assert.equal(file.ignored, true);
    assert.equal(setup.apply().status, 'complete');
  } finally { setup.close(); }
  assert.equal(git(root, ['--literal-pathspecs', 'ls-files', '--error-unmatch', '--', '.nightshift/features/[ab].md'], [0, 1]).status, 1);
  assert.equal(git(root, ['check-ignore', '--no-index', '-q', '--', '.nightshift/features/[ab].md'], [0, 1]).status, 0);
  assert.equal(fs.readFileSync(path.join(root, '.nightshift/features/[ab].md'), 'utf8'), '# Private literal filename\n');
  assert.equal(git(root, ['ls-files', '--error-unmatch', '--', '.nightshift/features/a.md']).status, 0);
});

for (const name of ['plans', 'inbox', 'runs']) {
  test(`migration retains ${name} visibility exceptions and future ignore patterns`, t => {
    const root = fixture(t);
    write(root, '.gitignore', `/.claude/${name}/*\r\n!/.claude/${name}/keep.md\r\n`);
    write(root, `.claude/${name}/keep.md`, '# Deliberately visible\r\n');
    write(root, `.claude/${name}/private.md`, '# Private\r\n');
    const ignored = file => git(root, ['check-ignore', '-q', '--', file], [0, 1]).status === 0;
    assert.equal(ignored(`.claude/${name}/keep.md`), false);
    assert.equal(ignored(`.claude/${name}/private.md`), true);
    const result = initialize(root, { ownership: { [`.claude/${name}`]: 'nightshift' } });
    assert.equal(result.migration.status, 'complete');
    assert.equal(ignored(`.nightshift/${name}/keep.md`), false);
    assert.equal(ignored(`.nightshift/${name}/private.md`), true);
    assert.equal(ignored(`.nightshift/${name}/future.md`), true);
    const before = fs.readFileSync(path.join(root, '.gitignore'));
    initialize(root);
    assert.deepEqual(fs.readFileSync(path.join(root, '.gitignore')), before);
  });
}

test('fresh and partial initialization is idempotent and validated by the real parser', t => {
  const root = fixture(t);
  const first = initialize(root);
  assert.deepEqual(first.backlog.structuralErrors, []);
  assert.ok(fs.existsSync(path.join(root, '.nightshift/FEATURES.md')));
  assert.equal(git(root, ['check-ignore', '-q', '.nightshift/runs/state.sqlite'], [0, 1]).status, 0);
  assert.equal(fs.existsSync(path.join(root, '.nightshift/inbox')), false);
  assert.equal(git(root, ['check-ignore', '-q', '.nightshift/inbox/report.md'], [0, 1]).status, 1);
  const bytes = fs.readFileSync(path.join(root, '.nightshift/FEATURES.md'));
  fs.unlinkSync(path.join(root, '.nightshift/BUGS_HISTORY.md'));
  const second = initialize(root);
  assert.deepEqual(fs.readFileSync(path.join(root, '.nightshift/FEATURES.md')), bytes);
  assert.deepEqual(second.backlog.structuralErrors, []);
});

test('migration repairs reference definitions, moved relative links and explicitly scoped active consumers', t => {
  const root = fixture(t);
  write(root, '.claude/features/a.md', '# A\n\n[Settings](../settings.json) [Sibling](b.md)\n');
  write(root, '.claude/features/b.md', '# B\n');
  write(root, '.claude/settings.json', '{}\n');
  write(root, 'README.md', '[Design][design]\n\n[design]: .claude/features/a.md "Design title"\n');
  write(root, 'consumer.cjs', "require('node:fs').readFileSync('.claude/features/a.md');\n");
  const run = () => spawnSync(process.execPath, ['consumer.cjs'], { cwd: root, windowsHide: true, encoding: 'utf8' });
  assert.equal(run().status, 0);
  const setup = new Setup(root);
  try {
    assert.deepEqual(setup.inspect().referenceDecisions, ['consumer.cjs']);
    assert.throws(() => setup.apply(), { code: 'reference-policy-required' });
    assert.equal(fs.existsSync(path.join(root, '.claude/features/a.md')), true);
    assert.equal(setup.apply({ activeReferences: ['consumer.cjs'] }).status, 'complete');
  } finally { setup.close(); }
  assert.equal(run().status, 0);
  assert.match(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), /\[design\]: \.nightshift\/features\/a.md "Design title"/);
  assert.equal(fs.readFileSync(path.join(root, '.nightshift/features/a.md'), 'utf8'), '# A\n\n[Settings](../../.claude/settings.json) [Sibling](b.md)\n');
});

test('a migrated stopped run resumes default spec assessment with current paths and original history', async t => {
  const root = fixture(t);
  write(root, '.claude/specs/design.md', '# Accepted behavior\n');
  const baseSha = git(root, ['hash-object', '-t', 'tree', '--stdin']).stdout.trim();
  const actor = { host: 'codex', session: 'owner' };
  const legacy = new RunStore(root, { create: true, legacy: true });
  legacy.create({ objective: 'Accepted behavior', authority: 'User', controller: actor, tasks: [{ id: 'code', title: 'Code', agreement: { source: 'User', outcome: 'Accepted behavior', spec: '.claude/specs/design.md', specReviewed: true } }] });
  legacy.update(actor, 0, 'pause', state => {
    state.followups.push({ id: 'spec-directory', context: 'Later spec discussion', recommendation: 'Preserve route', route: '.claude/specs', status: 'pending' });
    state.workers.push({ id: 'finished-writer', session: 'writer', role: 'implementer', assignment: 'Write spec', writes: ['.claude/specs'], status: 'stopped' });
    transition(state, { action: 'stop', kind: 'user-stop', reason: 'User authorized migration pause' });
  });
  legacy.close();
  const setup = new Setup(root);
  try { setup.apply({ ownership: { '.claude/specs': 'nightshift' } }); } finally { setup.close(); }
  const store = new RunStore(root);
  const act = request => execute(root, { actor, revision: store.read().revision, ...request });
  try {
    assert.equal(store.read().tasks[0].agreement.spec, '.nightshift/specs/design.md');
    assert.equal(store.read().followups[0].route, '.nightshift/specs');
    assert.deepEqual(store.read().workers[0].writes, ['.nightshift/specs']);
    assert.equal(store.history(store.read().id)[0].state.tasks[0].agreement.spec, '.claude/specs/design.md');
    assert.equal(store.history(store.read().id)[1].state.followups[0].route, '.claude/specs');
    assert.deepEqual(store.history(store.read().id)[1].state.workers[0].writes, ['.claude/specs']);
    await act({ action: 'resume', authority: 'User-authorized migration resumption' });
    await act({ action: 'add-spec-review', taskId: 'code' });
    const specId = store.read().tasks[0].agreement.specReviewTaskId;
    const result = await execute(root, { action: 'dispatch', actor, revision: store.read().revision, taskId: specId, review: { kind: 'spec', baseSha, requirements: 'Accepted behavior', rules: 'Read-only fixture', candidates: [{ host: 'claude', model: 'claude-fable-5-1' }] } }, { runAgent: options => {
      assert.equal(fs.existsSync(path.join(options.cwd, 'project/.nightshift/specs/design.md')), true);
      const report = { requestId: options.schema.properties.requestId.enum[0], status: 'complete', coverage: DIMENSIONS.spec.map(dimension => ({ dimension, evidence: 'Whole governing fixture assessed' })), findings: [], probes: [], summary: 'Accepted behavior coherent' };
      fs.mkdirSync(options.artifacts, { recursive: true });
      const events = [{ type: 'assistant', session_id: 'reviewer', message: { model: options.model, content: [] } }, { type: 'result', session_id: 'reviewer', subtype: 'success', is_error: false, structured_output: report }];
      fs.writeFileSync(path.join(options.artifacts, 'events.jsonl'), events.map(event => JSON.stringify(event)).join('\n') + '\n');
      return { host: 'claude', model: options.model, session: 'reviewer', attributionVerified: true, status: 'complete', output: report, tokens: 0 };
    } });
    await act({ action: 'review', taskId: specId, receipt: path.relative(root, result.receiptFile).split(path.sep).join('/') });
    while (store.read().tasks.find(task => task.id === specId).status !== 'complete') await act({ action: 'advance', taskId: specId, evidence: 'Internal assessment closing obligation satisfied' });
    await act({ action: 'start-task', taskId: 'code' });
    assert.equal(store.read().tasks[0].status, 'active');
  } finally { store.close(); }
});

test('undeclared non-document files mentioning only unmigrated legacy paths need no reference decision', t => {
  const root = fixture(t);
  write(root, '.claude/features/a.md', '# A\r\n');
  write(root, 'scripts/host.sh', '#!/bin/sh\r\ncat .claude/settings.json\r\nls .claude/skills/\r\n');
  write(root, 'scripts/consumer.sh', '#!/bin/sh\r\ncat .claude/features/a.md\r\n');
  write(root, 'scripts/computed.sh', '#!/bin/sh\r\nhome=.claude\r\ncat "$home/features/a.md"\r\n');
  const setup = new Setup(root);
  try {
    assert.deepEqual(setup.inspect().referenceDecisions, ['scripts/consumer.sh']);
    assert.deepEqual(setup.inspect({ activeReferences: ['scripts/consumer.sh', 'scripts/computed.sh'] }).referenceDecisions, ['scripts/computed.sh']);
    assert.equal(setup.apply({ activeReferences: ['scripts/consumer.sh'] }).status, 'complete');
  } finally { setup.close(); }
  assert.equal(fs.readFileSync(path.join(root, 'scripts/host.sh'), 'utf8'), '#!/bin/sh\r\ncat .claude/settings.json\r\nls .claude/skills/\r\n');
  assert.equal(fs.readFileSync(path.join(root, 'scripts/consumer.sh'), 'utf8'), '#!/bin/sh\r\ncat .nightshift/features/a.md\r\n');
});

test('legacy ignore rules are translated only when they match migrated content', t => {
  const root = fixture(t);
  const legacy = '# host\r\n.claude/skills/\r\n.claude/commands/\r\n\r\n# backlog\r\n/.claude/plans/\r\n*.lock\r\n';
  write(root, '.gitignore', legacy);
  write(root, '.claude/features/a.md', '# A\r\n');
  write(root, '.claude/plans/old.md', '# Plan\r\n');
  write(root, '.claude/skills/tool/SKILL.md', '# Host skill\r\n');
  const result = initialize(root, { ownership: { '.claude/plans': 'nightshift' } });
  assert.equal(result.migration.status, 'complete');
  assert.equal(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), legacy + '\r\n# Nightshift migrated ignore rules\r\n/.nightshift/plans/\r\n/.nightshift/runs/\r\n');
  assert.equal(git(root, ['check-ignore', '-q', '--', '.nightshift/plans/old.md'], [0, 1]).status, 0);
  assert.equal(git(root, ['check-ignore', '-q', '--', '.nightshift/features/a.md'], [0, 1]).status, 1);
  assert.equal(fs.readFileSync(path.join(root, '.claude/skills/tool/SKILL.md'), 'utf8'), '# Host skill\r\n');
  const before = fs.readFileSync(path.join(root, '.gitignore'));
  initialize(root);
  assert.deepEqual(fs.readFileSync(path.join(root, '.gitignore')), before);
});

test('migration preserves tracked staged bytes, working changes, ignored plans, host config and navigable references', t => {
  const root = fixture(t);
  write(root, '.claude/features/item.md', '# Item\r\n\r\nAccepted design.\r\n');
  write(root, '.claude/FEATURES.md', '# Features\r\n\r\n## Features\r\n\r\n### [Item](features/item.md)\r\n\r\nItem.\r\n\r\n**Requires:** none.\r\n');
  write(root, '.claude/plans/old.md', '# Existing plan\r\n\r\nPreserve this history.\r\n');
  write(root, '.claude/settings.json', '{"user":"configuration"}\r\n');
  write(root, '.gitignore', '/.claude/plans/\r\n');
  write(root, 'README.md', '[Design](.claude/features/item.md)\r\n');
  git(root, ['add', '.claude/features/item.md', '.claude/FEATURES.md', '.claude/settings.json', '.gitignore', 'README.md']);
  const staged = git(root, ['ls-files', '--stage', '.claude/features/item.md']).stdout.split(' ')[1];
  write(root, '.claude/features/item.md', '# Item\r\n\r\nWorking tree clarification.\r\n');
  const result = initialize(root, { ownership: { '.claude/plans': 'nightshift' } });
  assert.equal(result.migration.status, 'complete');
  assert.deepEqual(result.backlog.structuralErrors, []);
  assert.equal(fs.readFileSync(path.join(root, '.nightshift/features/item.md'), 'utf8'), '# Item\r\n\r\nWorking tree clarification.\r\n');
  assert.equal(git(root, ['ls-files', '--stage', '.nightshift/features/item.md']).stdout.split(' ')[1], staged);
  assert.equal(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), '[Design](.nightshift/features/item.md)\r\n');
  assert.equal(fs.readFileSync(path.join(root, '.claude/settings.json'), 'utf8'), '{"user":"configuration"}\r\n');
  assert.equal(git(root, ['check-ignore', '-q', '.nightshift/plans/old.md'], [0, 1]).status, 0);
  assert.equal(fs.existsSync(path.join(root, '.claude/features/item.md')), false);
});

for (const interrupt of ['afterCopy', 'afterRemove', 'afterMove', 'afterReference']) {
  test(`interrupted migration resumes after ${interrupt} without loss or duplicate authority`, t => {
    const root = fixture(t);
    write(root, '.claude/QUICK_WINS.md', '# Quick wins\r\n\r\n## Open\r\n\r\nNothing tracked yet.\r\n');
    write(root, 'README.md', '[Backlog](.claude/QUICK_WINS.md)\r\n');
    git(root, ['add', '.claude/QUICK_WINS.md', 'README.md']);
    let setup = new Setup(root);
    try { assert.throws(() => setup.apply({ [interrupt]: () => { throw new Error('simulated crash'); } }), /simulated crash/); }
    finally { setup.close(); }
    setup = new Setup(root);
    try {
      assert.equal(setup.apply().status, 'complete');
      assert.equal(fs.existsSync(path.join(root, '.claude/QUICK_WINS.md')), false);
      assert.equal(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), '[Backlog](.nightshift/QUICK_WINS.md)\r\n');
      assert.equal(git(root, ['ls-files', '--error-unmatch', '.nightshift/QUICK_WINS.md']).status, 0);
    } finally { setup.close(); }
  });
}

test('conflicting destinations and changed sources remain untouched', t => {
  const root = fixture(t);
  write(root, '.claude/BUGS.md', '# Original\r\n');
  write(root, '.nightshift/BUGS.md', '# Existing destination\r\n');
  const setup = new Setup(root);
  try { assert.throws(() => setup.apply(), { code: 'destination-conflict' }); }
  finally { setup.close(); }
  assert.equal(fs.readFileSync(path.join(root, '.claude/BUGS.md'), 'utf8'), '# Original\r\n');
  assert.equal(fs.readFileSync(path.join(root, '.nightshift/BUGS.md'), 'utf8'), '# Existing destination\r\n');
});

test('unfinished run migration preserves state and refuses active writers', t => {
  const root = fixture(t);
  const legacy = new RunStore(root, { create: true, legacy: true });
  const actor = { host: 'claude', session: 'owner' };
  legacy.create({ objective: 'Unfinished accepted work', authority: 'User handover', controller: actor, tasks: [{ id: 'task', title: 'Task', agreement: { source: 'User', outcome: 'Required behavior' } }] });
  assert.throws(() => new RunStore(root, { create: true }), { code: 'legacy-run-state' });
  assert.equal(fs.existsSync(path.join(root, '.nightshift/runs/state.sqlite')), false);
  let setup = new Setup(root);
  try { assert.throws(() => setup.apply(), { code: 'active-writer' }); }
  finally { setup.close(); }
  legacy.update(actor, 0, 'preserve-incomplete-work', state => {
    state.tasks[0].findings.push({ id: 'unresolved', consequence: 'Unfixed sibling behavior', evidence: 'Recorded counterexample', disposition: 'implement', repaired: false });
    state.tasks[0].checks.push({ name: 'earlier regression check', passed: false, output: 'Sibling still fails' });
    state.workers.push({ id: 'old-worker', role: 'implementer', session: 'worker', writes: ['src/component'], status: 'stopped', evidence: 'Process ended before migration' });
    transition(state, { action: 'stop', kind: 'user-stop', reason: 'Authorized migration pause' });
  });
  const before = legacy.read();
  legacy.close();
  setup = new Setup(root);
  try { assert.equal(setup.apply().status, 'complete'); }
  finally { setup.close(); }
  const migrated = new RunStore(root);
  try {
    assert.equal(migrated.read().id, before.id);
    assert.equal(migrated.read().objective, before.objective);
    assert.deepEqual(migrated.read().tasks[0].findings, before.tasks[0].findings);
    assert.deepEqual(migrated.read().tasks[0].checks, before.tasks[0].checks);
    assert.equal(migrated.read().homeMigration.to, '.nightshift');
    assert.equal(migrated.read().tasks[0].status, 'pending');
    assert.equal(migrated.history(before.id).length, 3);
    assert.deepEqual(migrated.history(before.id)[1].state, before);
  } finally { migrated.close(); }
});
