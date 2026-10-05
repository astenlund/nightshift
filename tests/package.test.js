'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const publicSkills = ['exploring', 'handover', 'init-backlog', 'ready', 'revise-code', 'revise-docs', 'revise-lore', 'revise-spec'];

test('both packages expose the same intentional public skill surface', () => {
  const claude = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin/plugin.json'), 'utf8'));
  const codex = JSON.parse(fs.readFileSync(path.join(root, '.codex-plugin/plugin.json'), 'utf8'));
  assert.equal(claude.name, 'nightshift');
  assert.equal(codex.name, claude.name);
  assert.equal(codex.version, claude.version);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), /^\*\*Status:\*\*/m, 'README announces no version: the manifests own it and CHANGELOG.md holds release notes');
  const discovered = fs.readdirSync(path.join(root, 'skills')).filter(name => fs.existsSync(path.join(root, 'skills', name, 'SKILL.md'))).sort();
  assert.deepEqual(discovered, publicSkills);
  for (const name of publicSkills) {
    const content = fs.readFileSync(path.join(root, 'skills', name, 'SKILL.md'), 'utf8');
    assert.match(content, new RegExp('^---\\r?\\nname: ' + name + '\\r?\\n'));
    assert.match(content, /description: "[^\r\n]+"/);
  }
});

test('host-specific bundled notices resolve to shipped code without duplicate default hooks', () => {
  assert.equal(fs.existsSync(path.join(root, 'hooks/hooks.json')), false);
  for (const host of ['claude', 'codex']) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, '.' + host + '-plugin/plugin.json'), 'utf8'));
  const hooks = JSON.parse(fs.readFileSync(path.join(root, manifest.hooks), 'utf8')).hooks;
  assert.deepEqual(Object.keys(hooks).sort(), ['PreCompact', 'SessionStart', 'Stop']);
  for (const matchers of Object.values(hooks)) {
    for (const matcher of matchers) {
      for (const hook of matcher.hooks) {
        assert.equal(hook.type, 'command');
        const command = host === 'claude' ? `${hook.command} "${hook.args[0]}" ${hook.args[1]}` : hook.command;
        const match = /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/([^"]+)" (claude|codex)$/.exec(command);
        assert.ok(match, 'Hook must resolve a bundled script using the host-provided plugin root');
        assert.equal(match[2], host);
        assert.ok(fs.statSync(path.join(root, match[1])).isFile());
      }
    }
  }
  }
});

test('the release manifest covers current payload bytes and local dependencies', () => {
  const { workingManifest } = require('../tools/release-manifest');
  const { MANIFEST_PATH, encodeManifest } = require('../internal/releases/manifest');
  assert.deepEqual(fs.readFileSync(path.join(root, MANIFEST_PATH)), encodeManifest(workingManifest(root)));
});

test('the pre-push release gate is wired to the shipped script', () => {
  const hook = fs.readFileSync(path.join(root, '.githooks/pre-push'), 'utf8');
  assert.equal(hook.includes('\r'), false, 'shell hooks must stay LF-only');
  assert.match(hook, /tools\/release-gate\.js" --pre-push/);
  assert.ok(fs.statSync(path.join(root, 'tools/release-gate.js')).isFile());
});

test('the repository hooks run the shared hooks that core.hooksPath would otherwise bypass', t => {
  const parent = path.join(root, '.tmp/package-tests');
  fs.mkdirSync(parent, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(parent, 'hooks-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const hooks = path.join(root, '.githooks');
  for (const name of ['pre-commit', 'commit-msg', 'run-shared-hook']) {
    assert.equal(fs.readFileSync(path.join(hooks, name), 'utf8').includes('\r'), false, `${name} must stay LF-only`);
  }
  const slash = value => value.replaceAll('\\', '/');
  const marker = path.join(scratch, 'shared-ran');
  const folder = (name, hook, text, mode) => {
    const dir = path.join(scratch, name);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, hook), text, { mode });
    return dir;
  };
  const failing = hook => `#!/bin/sh\necho ${hook} > "${slash(marker)}"\nexit 1\n`;
  const preCommit = folder('pre-commit', 'pre-commit', failing('pre-commit'), 0o755);
  const commitMsg = folder('commit-msg', 'commit-msg', failing('commit-msg'), 0o755);
  // No shebang and no execute bit: Git would not run this hook on Windows or POSIX.
  const inert = folder('inert', 'pre-commit', `echo pre-commit > "${slash(marker)}"\nexit 1\n`, 0o644);
  const project = path.join(scratch, 'project');
  fs.mkdirSync(project);
  const globalConfig = path.join(scratch, 'global.gitconfig');
  const systemConfig = path.join(scratch, 'system.gitconfig');
  const hooksPath = dir => (dir === null ? '' : `[core]\n\thooksPath = ${slash(dir)}\n`);
  fs.writeFileSync(globalConfig, '');
  fs.writeFileSync(systemConfig, '');
  const base = { ...process.env, GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_SYSTEM: systemConfig, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' };
  delete base.GIT_CONFIG_NOSYSTEM;
  const git = (env, ...args) => spawnSync('git', args, { cwd: project, env, windowsHide: true, encoding: 'utf8' });
  assert.equal(git(base, 'init', '--quiet').status, 0);
  assert.equal(git(base, 'config', 'core.hooksPath', slash(hooks)).status, 0);
  const commit = ({ global = null, system = null, noSystem = null } = {}) => {
    fs.writeFileSync(globalConfig, hooksPath(global));
    fs.writeFileSync(systemConfig, hooksPath(system));
    fs.rmSync(marker, { force: true });
    const result = git(noSystem === null ? base : { ...base, GIT_CONFIG_NOSYSTEM: noSystem }, 'commit', '--allow-empty', '--quiet', '-m', 'probe');
    return { passed: result.status === 0, ran: fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8').trim() : null };
  };

  assert.deepEqual(commit({ global: preCommit }), { passed: false, ran: 'pre-commit' }, 'a failing global pre-commit hook must run and block the commit');
  assert.deepEqual(commit({ system: preCommit }), { passed: false, ran: 'pre-commit' }, 'a system hooks folder applies when no global one is set');
  assert.deepEqual(commit({ system: preCommit, noSystem: '1' }), { passed: true, ran: null }, 'GIT_CONFIG_NOSYSTEM disables the system hooks folder');
  assert.deepEqual(commit({ system: preCommit, noSystem: 'FALSE' }), { passed: false, ran: 'pre-commit' }, 'a false GIT_CONFIG_NOSYSTEM in any case keeps the system hooks folder, as in Git');
  assert.deepEqual(commit({ global: '', system: preCommit }), { passed: true, ran: null }, 'an explicitly empty global hooksPath overrides the system one, as in Git');
  assert.deepEqual(commit({ global: commitMsg }), { passed: false, ran: 'commit-msg' }, 'a failing global commit-msg hook must run and block the commit');
  assert.deepEqual(commit({ global: inert }), { passed: true, ran: null }, 'a shared hook Git would not execute is skipped');
  assert.deepEqual(commit(), { passed: true, ran: null }, 'without a shared hooks folder the commit proceeds');
  assert.deepEqual(commit({ global: hooks }), { passed: true, ran: null }, 'a shared hooks folder equal to .githooks must not recurse');
});

test('active deterministic entry points load without the retired workflow machinery', () => {
  for (const module of ['internal/markdown.js', 'internal/setup.js', 'internal/runtime/cli.js', 'internal/runtime/hook.js', 'skills/ready/ready.js', 'skills/init-backlog/init-backlog.js']) assert.ok(require(path.join(root, module)));
  assert.equal(fs.existsSync(path.join(root, 'internal/revise/SKILL.md')), false);
  assert.equal(fs.existsSync(path.join(root, 'skills/spec-agreement/SKILL.md')), false);
  assert.equal(fs.existsSync(path.join(root, 'skills/revise-plan/SKILL.md')), false);
});

test('public skills and shared brief have resolvable local documentation links', () => {
  const files = [...publicSkills.map(name => 'skills/' + name + '/SKILL.md'), 'AGENTS.md', 'internal/workflow.md', 'internal/runtime/REFERENCE.md'];
  for (const file of files) {
    const content = fs.readFileSync(path.join(root, file), 'utf8');
    for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
      const target = match[1].split('#')[0];
      if (!target || /^(?:https?:|mailto:)/.test(target)) continue;
      assert.ok(fs.existsSync(path.resolve(root, path.dirname(file), target)), `${file} has an unresolved local link: ${target}`);
    }
  }
});
