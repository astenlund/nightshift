'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const publicSkills = ['exploring', 'handover', 'init-backlog', 'ready', 'revise-code', 'revise-docs', 'revise-lore', 'revise-spec'];

test('both packages expose the same intentional public skill surface', () => {
  const claude = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin/plugin.json'), 'utf8'));
  const codex = JSON.parse(fs.readFileSync(path.join(root, '.codex-plugin/plugin.json'), 'utf8'));
  assert.equal(claude.name, 'nightshift');
  assert.equal(codex.name, claude.name);
  assert.equal(codex.version, claude.version);
  const status = /\*\*Status:\*\* Nightshift (\d+\.\d+\.\d+) is published on `main`/.exec(fs.readFileSync(path.join(root, 'README.md'), 'utf8'));
  assert.ok(status, 'README must carry the published-version status line');
  assert.equal(status[1], claude.version);
  const discovered = fs.readdirSync(path.join(root, 'skills')).filter(name => fs.existsSync(path.join(root, 'skills', name, 'SKILL.md'))).sort();
  assert.deepEqual(discovered, publicSkills);
  for (const name of publicSkills) {
    const content = fs.readFileSync(path.join(root, 'skills', name, 'SKILL.md'), 'utf8');
    assert.match(content, new RegExp('^---\\r?\\nname: ' + name + '\\r?\\n'));
    assert.match(content, /description: "[^\r\n]+"/);
  }
});

test('bundled lifecycle hooks resolve to a shipped executable and portable native events', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(root, 'hooks/hooks.json'), 'utf8')).hooks;
  assert.deepEqual(Object.keys(hooks).sort(), ['PreCompact', 'SessionStart', 'Stop']);
  for (const matchers of Object.values(hooks)) {
    for (const matcher of matchers) {
      for (const hook of matcher.hooks) {
        assert.equal(hook.type, 'command');
        const match = /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/([^"]+)"$/.exec(hook.command);
        assert.ok(match, 'Hook must resolve a bundled script using the host-provided plugin root');
        assert.ok(fs.statSync(path.join(root, match[1])).isFile());
      }
    }
  }
});

test('active deterministic entry points load without the retired workflow machinery', () => {
  for (const module of ['internal/markdown.js', 'internal/setup.js', 'internal/runtime/cli.js', 'internal/runtime/hook.js', 'skills/ready/ready.js', 'skills/init-backlog/init-backlog.js']) assert.ok(require(path.join(root, module)));
  assert.equal(fs.existsSync(path.join(root, 'internal/revise/SKILL.md')), false);
  assert.equal(fs.existsSync(path.join(root, 'skills/spec-agreement/SKILL.md')), false);
  assert.equal(fs.existsSync(path.join(root, 'skills/revise-plan/SKILL.md')), false);
});

test('public skills and shared brief have resolvable local documentation links', () => {
  const files = [...publicSkills.map(name => 'skills/' + name + '/SKILL.md'), 'internal/workflow.md', 'internal/runtime/REFERENCE.md'];
  for (const file of files) {
    const content = fs.readFileSync(path.join(root, file), 'utf8');
    for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
      const target = match[1].split('#')[0];
      if (!target || /^(?:https?:|mailto:)/.test(target)) continue;
      assert.ok(fs.existsSync(path.resolve(root, path.dirname(file), target)), `${file} has an unresolved local link: ${target}`);
    }
  }
});
