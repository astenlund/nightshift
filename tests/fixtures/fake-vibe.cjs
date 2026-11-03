'use strict';

// A stand-in for headless Vibe. It records how it was invoked, then writes export.json, a session journal and its JSON output as a
// real run does. The launcher hands it no controller environment, so its behavior comes from control.json in the attempt's
// artifacts folder, the parent of --output-dir.

const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const value = flag => args[args.indexOf(flag) + 1];
const outputDir = value('--output-dir');
const artifacts = path.dirname(outputDir);
const control = JSON.parse(fs.readFileSync(path.join(artifacts, 'control.json'), 'utf8'));
fs.mkdirSync(outputDir, { recursive: true });
const home = process.env.VIBE_HOME;
const listing = directory => fs.existsSync(directory) ? fs.readdirSync(directory, { recursive: true }).map(file => String(file).split(path.sep).join('/')).sort() : null;
fs.writeFileSync(path.join(artifacts, 'invocation.json'), JSON.stringify({
  args,
  env: process.env,
  home: listing(home),
  userHome: listing(process.env.USERPROFILE),
  agent: home ? fs.readFileSync(path.join(home, 'agents', 'nightshift-reviewer.toml'), 'utf8') : null,
  systemPrompt: home ? fs.readFileSync(path.join(home, 'prompts', 'nightshift-reviewer.md'), 'utf8') : null,
  trust: home ? fs.readFileSync(path.join(home, 'trusted_folders.toml'), 'utf8') : null,
  prompt: fs.readFileSync(value('--prompt-file'), 'utf8'),
}));
if (control.generationsFile) {
  const target = path.join(outputDir, 'session', 'generations');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, 'Fixture malformed journal directory');
} else {
  const generations = control.generations ?? [control.model];
  generations.forEach((model, index) => {
    const directory = path.join(outputDir, 'session', 'generations', String(index).padStart(16, '0'));
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'runtime-state.json'), JSON.stringify({ session_metadata: { active_model: model } }));
  });
}
// Each completed model call is journalled twice under one action id, as the action's result and as the input that carried it.
if (control.calls) {
  const journal = path.join(outputDir, 'session', 'journal');
  fs.mkdirSync(journal, { recursive: true });
  const records = control.calls.flatMap((usage, index) => {
    const result = { action_id: `action-${index}`, type: 'completion_succeeded', result: { usage } };
    return [{ payload: { action_id: result.action_id, result } }, { payload: { input: { command: result } } }];
  });
  fs.writeFileSync(path.join(journal, '0000000000000001.jsonl'), records.map(record => JSON.stringify(record)).join('\n') + '\n');
}
const session = control.session ?? 'vibe-session';
// A real run leaves the session's store, exported as session/ beside export.json, and the pinned plugin store under its home, which a
// later resume needs.
if (!control.generationsFile) fs.writeFileSync(path.join(outputDir, 'session', 'CURRENT'), JSON.stringify({ session_id: session }));
if (home) {
  fs.mkdirSync(path.join(home, 'logs', 'session', 'unified', session), { recursive: true });
  fs.writeFileSync(path.join(home, 'logs', 'session', 'unified', session, 'CURRENT'), JSON.stringify({ session_id: session }));
  fs.mkdirSync(path.join(home, 'logs', 'session', 'plugins', 'manifests'), { recursive: true });
  fs.writeFileSync(path.join(home, 'logs', 'session', 'plugins', 'manifests', 'fixture'), 'pinned plugin manifest');
}
const summary = { session_id: session, outcome: control.outcome ?? 'finished', vibe_version: control.vibeVersion ?? '3.0.0', usage: Object.hasOwn(control, 'usage') ? control.usage : { total_tokens: 4321 }, config: control.config };
if (control.error) summary.error = control.error;
fs.writeFileSync(path.join(outputDir, 'export.json'), JSON.stringify(summary));
const text = control.text ?? `I read the change.\n\n\`\`\`json\n${JSON.stringify(control.report)}\n\`\`\``;
// A resumed run's output carries the whole conversation, the earlier turn's report included.
const earlier = args.includes('--resume') ? [{ type: 'message', role: 'user', content: [{ type: 'text', text: 'earlier prompt' }] }, { type: 'message', role: 'assistant', content: [{ type: 'text', text: control.earlierText ?? 'Earlier report:\n```json\n{"requestId": "earlier"}\n```' }] }] : [];
process.stdout.write(JSON.stringify([...earlier, { type: 'message', role: 'user', content: [{ type: 'text', text: 'prompt' }] }, { type: 'message', role: 'assistant', content: [{ type: 'text', text }] }]));
if (control.stderr) process.stderr.write(control.stderr);
// Like the real host, the process holds its input open until the launcher ends it, so the launcher's end of stdin cannot meet an
// already closed pipe (EPIPE, which the launcher counts as a failed attempt); it then ends on its own once its output has drained.
process.exitCode = control.exitCode ?? 0;
process.stdin.resume();
