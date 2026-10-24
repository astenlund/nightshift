'use strict';

// Evaluation launcher for Mistral Vibe, injected into the runtime's review dispatch by the seeded-defect harness. The runtime's
// reviewer gate does not admit Vibe; this launcher exists so the suite can measure a host before a separate change admits it.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PLUGIN_ROOT = path.resolve(__dirname, '../..');
// Headless Vibe disables every tool not listed here. Its code mode's run_typescript stays available and runs TypeScript in Vibe's
// own sandbox, which reaches the workspace only through the listed tools, so the reviewer can read the workspace and compute.
const TOOLS = ['read_file'];
const HOST_FAILURE_LIMIT = 4000;
// Vibe's output is held whole for parsing, so a runaway stream is cut off here rather than exhausting the harness process. The limit
// sits below the Windows job's own 32 MiB output capacity, so this check, which names the cause, is the one that fires.
const OUTPUT_LIMIT = 24 * 1024 * 1024;

// Collects stream chunks up to a shared byte limit across every stream it serves; the first chunk past it calls onOverflow once and is
// dropped, as is everything after it.
function boundedCollector(limit, onOverflow) {
  let total = 0;
  const state = { overflowed: false };
  state.into = chunks => chunk => {
    if (state.overflowed) return;
    total += chunk.length;
    if (total > limit) {
      state.overflowed = true;
      onOverflow();

      return;
    }
    chunks.push(chunk);
  };

  return state;
}

function vibeExecutable(root) {
  const { resolveTrustedExecutable } = require(path.join(PLUGIN_ROOT, 'internal/filesystem-primitives.js'));

  return resolveTrustedExecutable({ root, basename: process.platform === 'win32' ? 'vibe.exe' : 'vibe' });
}

function vibeVersion() {
  try {
    const result = spawnSync(vibeExecutable(PLUGIN_ROOT), ['--version'], { windowsHide: true, encoding: 'utf8', timeout: 30000 });

    return result.status === 0 ? result.stdout.trim() : null;
  } catch {
    // An executable that cannot be resolved or run leaves the informational version unknown.
    return null;
  }
}

function readJsonIfPresent(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// The model the session ran, from the journal's runtime state, which Vibe writes for every generation of the session.
function sessionModel(exportDirectory) {
  const generations = path.join(exportDirectory, 'session', 'generations');
  if (!fs.existsSync(generations)) return null;
  const models = new Set();
  for (const generation of fs.readdirSync(generations)) {
    const state = readJsonIfPresent(path.join(generations, generation, 'runtime-state.json'));
    models.add(state?.session_metadata?.active_model ?? null);
  }

  return models.size === 1 ? [...models][0] : null;
}

function finalAssistantText(entries) {
  const messages = (Array.isArray(entries) ? entries : []).filter(entry => entry?.type === 'message' && entry.role === 'assistant');
  const content = messages.at(-1)?.content ?? [];

  return content.filter(part => part?.type === 'text').map(part => part.text).join('') || null;
}

// Vibe has no structured-output option, and models preface the report with prose, so the report is the message's last fenced JSON
// block, or else the span from its first opening brace to its last closing one. The runtime's own parser still validates it.
function reportText(message) {
  if (message === null) return null;
  const fenced = [...message.matchAll(/```(?:json)?\s*\n([\s\S]*?)\n\s*```/g)].at(-1);
  if (fenced) return fenced[1];
  const first = message.indexOf('{');
  const last = message.lastIndexOf('}');

  return first >= 0 && last > first ? message.slice(first, last + 1) : message;
}

// Runs one assessment with the runtime's runAgent contract: the same prompt and system text, with the report schema stated in the
// prompt because Vibe has no structured-output option, and the result fields the dispatch validates.
async function runVibe(options) {
  const { spawnWindowsJob } = require(path.join(PLUGIN_ROOT, 'internal/runtime/windows-job.js'));
  fs.mkdirSync(options.artifacts, { recursive: true });
  const promptFile = path.join(options.artifacts, 'prompt.md');
  const system = fs.readFileSync(options.systemFile, 'utf8');
  fs.writeFileSync(promptFile, `${system}\n\n${options.prompt}\nReply with only one JSON object that conforms to this JSON schema, with no other text:\n${JSON.stringify(options.schema)}\n`, { flag: 'wx' });
  const exportDirectory = path.join(options.artifacts, 'vibe');
  const timeLimit = Math.max(60, Math.floor((options.timeoutMs ?? 900000) / 1000) - 60);
  const args = ['--workdir', options.cwd, '--trust', '--prompt-file', promptFile, '--output', 'json', '--output-dir', exportDirectory, '--time-limit', String(timeLimit), ...TOOLS.flatMap(tool => ['--enabled-tools', tool])];
  const stdout = [];
  const stderr = [];
  const errors = [];
  const child = spawnWindowsJob(vibeExecutable(options.protectedRoot ?? options.cwd), args, { cwd: options.cwd, env: options.env ?? process.env, protectedRoot: options.protectedRoot, closeInput: true });
  const collector = boundedCollector(OUTPUT_LIMIT, () => child.kill());
  child.stdout.on('data', collector.into(stdout));
  child.stderr.on('data', collector.into(stderr));
  child.on('error', error => errors.push(error));
  child.once('spawn', () => options.onProcess?.(child.pid));
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, options.timeoutMs ?? 900000);
  const exit = await new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal, timedOut, error: errors[0]?.message ?? null, descendantsReclaimed: child.jobEmpty ?? null, jobEvents: child.diagnostics ?? null })));
  clearTimeout(timer);
  const output = Buffer.concat(stdout).toString('utf8');
  const errorText = Buffer.concat(stderr).toString('utf8');
  fs.writeFileSync(path.join(options.artifacts, 'stderr.txt'), errorText);
  let entries = null;
  try {
    entries = JSON.parse(output);
  } catch {
    // Unparsable output leaves no assessment; the attempt fails below.
  }
  fs.writeFileSync(path.join(options.artifacts, 'events.jsonl'), (Array.isArray(entries) ? entries.map(entry => JSON.stringify(entry)) : [output]).join('\n') + '\n');
  const summary = readJsonIfPresent(path.join(exportDirectory, 'export.json'));
  const session = summary?.session_id ?? null;
  if (session) options.onSession?.(session);
  const model = sessionModel(exportDirectory);
  const tokens = Number.isSafeInteger(summary?.usage?.total_tokens) ? summary.usage.total_tokens : null;
  const failed = collector.overflowed || exit.error || exit.timedOut || exit.code !== 0 || summary?.outcome !== 'finished';
  const reason = collector.overflowed ? `Vibe's output passed ${OUTPUT_LIMIT} bytes, so the process was stopped` : summary?.error ? String(summary.error) : errorText.trim();
  const hostFailure = failed ? reason.slice(-HOST_FAILURE_LIMIT) || null : null;

  return { host: 'vibe', model: options.model, effort: options.effort, session, attributionVerified: session !== null && model === options.model, status: failed ? 'failed' : 'complete', output: reportText(finalAssistantText(entries)), tokens, threadTokens: tokens, hostFailure, exit };
}

module.exports = { OUTPUT_LIMIT, TOOLS, boundedCollector, reportText, runVibe, sessionModel, vibeVersion };
