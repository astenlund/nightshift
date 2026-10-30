'use strict';

// Mistral Vibe as a lead reviewer host: the launcher's table of model entries, eligibility before reservation, the isolation every
// attempt runs under, the effective-configuration check, and the report and attribution rules that dispatch and import share.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { isDeepStrictEqual: sameValue } = require('node:util');
const { RunError, requireCondition } = require('./store');
const { resolveTrustedExecutable } = require('../filesystem-primitives');
const { compareVersions, parseModel } = require('./models');
const { ALLOWLISTED_KEYS, COMPARED_DEFAULTS, FIXED_SHAPE_KEYS, MODEL_ENTRY_ALLOWLISTED, MODEL_ENTRY_COMPARED, PER_ENTRY_KEYS, PROVIDER_DEFAULTS } = require('./vibe-config');

const VERSION_FLOOR = Object.freeze([3, 0, 0]);
const AGENT = 'nightshift-reviewer';
// Headless Vibe refuses every tool call outside this list, whatever tools it advertises.
const TOOLS = Object.freeze(['read_file']);
// Vibe's output is held whole for parsing, so a runaway stream is cut off below the Windows job's own 32 MiB output capacity.
const OUTPUT_LIMIT = 24 * 1024 * 1024;
// The system variables a Windows process needs; every other variable of the controller stays out of the reviewer's environment.
const SYSTEM_VARIABLES = Object.freeze(['PATH', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'LOCALAPPDATA', 'APPDATA']);

// The Vibe identifiers the launcher can run, each with the models entry it writes for it: underlying name, provider, offered thinking
// levels, the offered level a low effort runs at, sampling and the figures Vibe reports cost and compaction by. An entry is added
// only when it offers high, the level every other effort runs at. The entry turns image support off, since Vibe otherwise takes it
// from its own table of known models, and Vibe records the entry's other compared fields at their defaults: no top_p, output or
// context limit. Holding an entry does not admit a model; mistral-large-4 is in no
// admitted family and is run only by the seeded-defect suite's evaluation launcher.
const MODELS = Object.freeze({
  'glm-5-3': Object.freeze({ name: 'zai-glm-5-3', provider: 'mistral', levels: Object.freeze(['low', 'high', 'max']), low: 'low', temperature: 1.0, input_price: 1.4, output_price: 4.4, auto_compact_threshold: 800000 }),
  'mistral-large-4': Object.freeze({ name: 'mistral-large-4', provider: 'mistral', levels: Object.freeze(['off', 'high']), low: 'off', temperature: 1.0, input_price: 1.36, output_price: 4.18, auto_compact_threshold: 800000 }),
});
const MODEL_ENTRY_DEFAULTS = Object.freeze({ top_p: null, max_output_tokens: null, supports_images: false, max_context_length: null });

const ALIAS = 'glm';

function newestGlm() {
  const glm = Object.keys(MODELS).filter(model => parseModel('vibe', model)?.family === ALIAS);

  return glm.sort((left, right) => compareVersions(parseModel('vibe', left).version, parseModel('vibe', right).version)).at(-1);
}

// A Vibe candidate may name the alias glm, which stands for the newest GLM table entry, so no receipt ever records the alias.
function resolveAlias(host, model) {
  return host === 'vibe' && model === ALIAS ? newestGlm() : model;
}

// A requested low runs at the entry's level that sends no reasoning, and every other requested effort at high: GLM's high and max
// are the same on the wire, and Mistral Large 4 offers no other level.
function effortLevel(model, effort) {
  return effort === 'low' ? MODELS[model].low : 'high';
}

function executable(root) {
  return resolveTrustedExecutable({ root, basename: process.platform === 'win32' ? 'vibe.exe' : 'vibe' });
}

// The installed version as `vibe --version` prints it, or null when it cannot be run or read.
function readVersion(file) {
  try {
    const result = spawnSync(file, ['--version'], { windowsHide: true, encoding: 'utf8', timeout: 30000 });
    const match = result.status === 0 ? /^vibe (\d{1,4})\.(\d{1,4})\.(\d{1,4})\s*$/.exec(result.stdout) : null;

    return match ? `${match[1]}.${match[2]}.${match[3]}` : null;
  } catch {
    // An executable that cannot be resolved or run has no readable version; the caller refuses it as unsupported.
    return null;
  }
}

function versionSupported(version) {
  return typeof version === 'string' && /^[0-9]{1,4}[.][0-9]{1,4}[.][0-9]{1,4}$/.test(version) && compareVersions(version.split('.').map(Number), VERSION_FLOOR) >= 0;
}

function tomlString(value) {
  return JSON.stringify(value);
}

function tomlList(values) {
  return `[${values.map(tomlString).join(', ')}]`;
}

// The reviewer agent file, which outranks Vibe's user, project and environment layers.
function agentFile(model, level) {
  const entry = MODELS[model];
  return [
    'display_name = "Nightshift reviewer"',
    'description = "Read-only independent reviewer launched by Nightshift"',
    `system_prompt_id = ${tomlString(AGENT)}`,
    `active_model = ${tomlString(model)}`,
    'enable_telemetry = false',
    'enable_mcp = false',
    'enable_connectors = false',
    'enable_subagents = false',
    'enable_background_processes = false',
    'include_commit_signature = false',
    'include_project_context = false',
    'experimental_enable_model_catalog = false',
    'experimental_enable_registry_skills = false',
    `enabled_tools = ${tomlList(TOOLS)}`,
    '',
    '[experiments]',
    'enable = false',
    '',
    `[models.${tomlString(model)}]`,
    `name = ${tomlString(entry.name)}`,
    `provider = ${tomlString(entry.provider)}`,
    `alias = ${tomlString(model)}`,
    `thinking = ${tomlString(level)}`,
    `thinking_levels = ${tomlList(entry.levels)}`,
    `temperature = ${entry.temperature.toFixed(1)}`,
    'supports_images = false',
    `input_price = ${entry.input_price}`,
    `output_price = ${entry.output_price}`,
    `auto_compact_threshold = ${entry.auto_compact_threshold}`,
    '',
  ].join('\n');
}

// Creates an attempt's launcher-owned Vibe home and empty user home. Vibe reads every user-scope channel from its home, and the one
// it locates from the home directory, ~/.agents/skills, from USERPROFILE and HOME; the empty trust file keeps the copy untrusted.
function createIsolation(directory, model, level, systemText) {
  try {
    const home = path.join(directory, 'vibe-home');
    const userHome = path.join(directory, 'vibe-user-home');
    fs.mkdirSync(path.join(home, 'agents'), { recursive: true });
    fs.mkdirSync(path.join(home, 'prompts'));
    fs.mkdirSync(userHome);
    fs.writeFileSync(path.join(home, 'agents', `${AGENT}.toml`), agentFile(model, level), { flag: 'wx' });
    fs.writeFileSync(path.join(home, 'prompts', `${AGENT}.md`), systemText, { flag: 'wx' });
    fs.writeFileSync(path.join(home, 'trusted_folders.toml'), '', { flag: 'wx' });

    return { home, userHome };
  } catch (error) {
    throw new RunError('vibe-isolation-unavailable', `The Vibe launcher could not create its isolation: ${error.message}`);
  }
}

// The reviewer's environment, built from an allowlist rather than inherited, so no VIBE_* variable but the launcher's own and none of
// the unprefixed variables Vibe's settings classes read reach it. Windows variable names are matched without regard to case. Node's
// process spawning still adds the variables Windows requires, such as USERNAME and HOMEPATH, when they are absent; none of them is a
// Vibe settings name, and the home directory Vibe uses comes from USERPROFILE, which is the launcher's own.
function environment(base, isolation) {
  const pick = name => Object.keys(base).find(key => key.toUpperCase() === name);
  const env = {};
  for (const name of [...SYSTEM_VARIABLES, 'MISTRAL_API_KEY']) {
    const key = pick(name);
    if (key !== undefined && base[key] !== undefined) env[name] = base[key];
  }

  return { ...env, VIBE_HOME: isolation.home, USERPROFILE: isolation.userHome, HOME: isolation.userHome };
}

// Whether a Vibe candidate can run, checked before the dispatch reserves time or registers its worker: an identifier the table
// holds, a readable version at or above the floor, and isolation the launcher can create. Returns its observed version when eligible, or a refusal.
function candidateEligibility(candidate, root, dependencies = {}) {
  if (!Object.hasOwn(MODELS, candidate.model)) return { code: 'vibe-model-unknown', reason: `The Vibe launcher has no entry for ${candidate.model}` };
  let file;
  try {
    file = (dependencies.vibeExecutable ?? executable)(root);
  } catch (error) {
    return { code: 'vibe-version-unsupported', reason: `The Vibe executable could not be resolved: ${error.message}` };
  }
  const version = (dependencies.readVibeVersion ?? readVersion)(file);
  if (!versionSupported(version)) return { code: 'vibe-version-unsupported', reason: version === null ? 'The installed Vibe version could not be read' : `Vibe ${version} is below the supported floor ${VERSION_FLOOR.join('.')}` };
  const scratch = path.join(root, '.nightshift', 'runs', 'reviews', `.vibe-eligibility-${crypto.randomUUID()}`);
  try {
    createIsolation(scratch, candidate.model, effortLevel(candidate.model, candidate.effort), 'Eligibility check');
  } catch (error) {
    return { code: 'vibe-isolation-unavailable', reason: error.message };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }

  return { version };
}

// Drops ineligible Vibe candidates, keeping each with its reason. A request whose candidates are all ineligible fails with the first
// one's code before anything is reserved. Versions follow the filtered candidate positions for this dispatch only.
function eligibleCandidates(candidates, root, dependencies = {}) {
  const eligible = [];
  const dropped = [];
  const versions = [];
  for (const candidate of candidates) {
    const observation = candidate.host === 'vibe' ? candidateEligibility(candidate, root, dependencies) : null;
    if (observation?.code) dropped.push({ host: candidate.host, model: candidate.model, ...observation });
    else {
      eligible.push(candidate);
      versions.push(observation?.version ?? null);
    }
  }
  if (eligible.length === 0) throw new RunError(dropped[0].code, `No eligible reviewer candidate: ${dropped.map(item => `${item.model}: ${item.reason}`).join('; ')}`);

  return { eligible, dropped, versions };
}

// Vibe's JSON output is one array of entries; the report is the last assistant message's text.
function finalAssistantText(entries) {
  const messages = (Array.isArray(entries) ? entries : []).filter(entry => entry?.type === 'message' && entry.role === 'assistant');
  const content = messages.at(-1)?.content ?? [];

  return content.filter(part => part?.type === 'text').map(part => part.text).join('') || null;
}

// Vibe has no structured-output option, and models preface the report with prose, so the report is the message's last untagged or
// json fenced block, or else the span from its first opening brace to its last closing one. Every fence is matched whatever its
// language tag, so a block of code shown before the report cannot pair its closing fence with the report's opening one.
function reportText(message) {
  if (message === null) return null;
  const fenced = [...message.matchAll(/```([^\n`]*)\n([\s\S]*?)\n[ \t]*```/g)].filter(match => ['', 'json'].includes(match[1].trim().toLowerCase())).at(-1);
  if (fenced) return fenced[2];
  const first = message.indexOf('{');
  const last = message.lastIndexOf('}');

  return first >= 0 && last > first ? message.slice(first, last + 1) : message;
}

function reportFromEntries(entries) {
  return reportText(finalAssistantText(entries));
}

function readJsonIfPresent(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // A missing or unreadable file yields nothing; the caller treats the attempt or receipt as unattributed.
    return null;
  }
}

// The export directory's attribution files: export.json and each generation's runtime state in the session journal.
function journalFiles(exportDirectory) {
  const generations = path.join(exportDirectory, 'session', 'generations');
  const states = fs.existsSync(generations) ? fs.readdirSync(generations).sort().map(generation => path.join(generations, generation, 'runtime-state.json')) : [];

  return { exportFile: path.join(exportDirectory, 'export.json'), states };
}

// The one model every generation of the session ran, or null when the journal names none or several.
function journalModel(states) {
  const models = new Set(states.map(file => readJsonIfPresent(file)?.session_metadata?.active_model ?? null));

  return states.length > 0 && models.size === 1 ? [...models][0] : null;
}

// The keys whose effective value differs from what the launcher expects, and the keys a later Vibe version added that have no known
// default to compare with. The active model's entry and its provider's entry are compared; other catalog and provider entries are not.
function configurationDifferences(config, model, level) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) return { differing: ['config'], uncompared: [] };
  const entry = MODELS[model];
  const differing = [];
  const uncompared = [];
  const compareEntry = (prefix, actual, expected, allowlisted) => {
    if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) {
      differing.push(prefix);

      return;
    }
    for (const [key, value] of Object.entries(expected)) {
      if (!Object.hasOwn(actual, key) || !sameValue(actual[key], value)) differing.push(`${prefix}.${key}`);
    }
    uncompared.push(...Object.keys(actual).filter(key => !Object.hasOwn(expected, key) && !allowlisted.includes(key)).map(key => `${prefix}.${key}`));
  };
  for (const [key, value] of Object.entries(expectedConfiguration(model))) {
    if (FIXED_SHAPE_KEYS.includes(key)) compareEntry(key, config[key], value, []);
    else if (!Object.hasOwn(config, key) || !sameValue(config[key], value)) differing.push(key);
  }
  const expectedEntry = { name: entry.name, provider: entry.provider, alias: model, thinking: level, thinking_levels: entry.levels, temperature: entry.temperature, ...MODEL_ENTRY_DEFAULTS };
  for (const key of MODEL_ENTRY_COMPARED) requireCondition(Object.hasOwn(expectedEntry, key), 'vibe-model-unknown', `The launcher's entry for ${model} lacks ${key}`);
  compareEntry(`models.${model}`, config.models?.[model], expectedEntry, MODEL_ENTRY_ALLOWLISTED);
  const providers = Array.isArray(config.providers) ? config.providers.filter(item => item?.name === entry.provider) : [];
  if (providers.length === 1) compareEntry(`providers.${entry.provider}`, providers[0], PROVIDER_DEFAULTS[entry.provider], []);
  else differing.push(`providers.${entry.provider}`);
  const known = new Set([...Object.keys(COMPARED_DEFAULTS), ...ALLOWLISTED_KEYS, ...PER_ENTRY_KEYS]);
  uncompared.push(...Object.keys(config).filter(key => !known.has(key)));

  return { differing, uncompared: uncompared.sort() };
}

// The expected value of every compared key: the launcher's own value for each key it set, else Vibe's built-in default.
// The models and providers entries are compared per entry above.
function expectedConfiguration(model) {
  return {
    ...COMPARED_DEFAULTS,
    active_model: model,
    system_prompt_id: AGENT,
    enable_telemetry: false,
    enable_mcp: false,
    enable_connectors: false,
    enable_subagents: false,
    enable_background_processes: false,
    include_commit_signature: false,
    include_project_context: false,
    experimental_enable_model_catalog: false,
    experimental_enable_registry_skills: false,
    enabled_tools: [...TOOLS],
    experiments: { ...COMPARED_DEFAULTS.experiments, enable: false },
  };
}

module.exports = {
  AGENT, ALIAS, MODELS, OUTPUT_LIMIT, TOOLS, VERSION_FLOOR,
  agentFile, configurationDifferences, createIsolation, effortLevel, eligibleCandidates, environment, executable, expectedConfiguration,
  finalAssistantText, journalFiles, journalModel, newestGlm, readJsonIfPresent, readVersion, reportFromEntries, reportText, resolveAlias, versionSupported,
};
