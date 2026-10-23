const { readStore } = require('./store-io');

const HOSTS = new Set(['claude', 'codex']);

function validateBinding(binding) {
  for (const field of ['session', 'project', 'host']) {
    if (typeof binding?.[field] !== 'string' || binding[field].length === 0) throw new TypeError(`a binding needs a ${field}`);
  }
  if (!HOSTS.has(binding.host)) throw new RangeError(`unknown host: ${binding.host}`);
  if (binding.run !== undefined && (typeof binding.run !== 'string' || binding.run.length === 0)) throw new TypeError('a binding run must be a non-empty string');
}

function createRegistry() {
  return { bindings: new Map(), retired: new Set() };
}

function bind(registry, binding) {
  validateBinding(binding);
  if (registry.retired.has(binding.session)) throw new Error(`session ${binding.session} is retired`);
  if (registry.bindings.has(binding.session)) throw new Error(`session ${binding.session} is already bound`);
  registry.bindings.set(binding.session, { ...binding });
}

function unbind(registry, session) {
  if (!registry.bindings.delete(session)) return false;
  registry.retired.add(session);
  return true;
}

function attach(registry, session, run) {
  const binding = registry.bindings.get(session);
  if (!binding) throw new Error(`session ${session} is not bound`);
  if (typeof run !== 'string' || run.length === 0) throw new TypeError('a run id must be a non-empty string');
  binding.run = run;
}

function bindingsFor(registry, project) {
  return [...registry.bindings.values()].filter(binding => binding.project === project);
}

function projects(registry) {
  return [...new Set([...registry.bindings.values()].map(binding => binding.project))].sort();
}

function openRunIds(store) {
  return new Set(store.runs.filter(run => run.status !== 'closed').map(run => run.id));
}

function reconcile(registry, project) {
  const released = [];
  for (const binding of bindingsFor(registry, project)) {
    if (binding.run === undefined) continue;
    const open = openRunIds(readStore(project));
    if (!open.has(binding.run)) {
      unbind(registry, binding.session);
      released.push(binding.session);
    }
  }
  return released;
}

function hostCounts(registry) {
  const counts = { claude: 0, codex: 0 };
  for (const binding of registry.bindings.values()) counts[binding.host]++;
  return counts;
}

function describe(registry) {
  const counts = hostCounts(registry);
  return `${registry.bindings.size} bindings over ${projects(registry).length} projects (claude ${counts.claude}, codex ${counts.codex}), ${registry.retired.size} retired`;
}

function serialize(registry) {
  return JSON.stringify({ bindings: [...registry.bindings.values()], retired: [...registry.retired] });
}

function deserialize(text) {
  const data = JSON.parse(text);
  const registry = createRegistry();
  for (const session of data.retired) registry.retired.add(session);
  for (const binding of data.bindings) bind(registry, binding);
  return registry;
}

module.exports = { attach, bind, bindingsFor, createRegistry, describe, deserialize, hostCounts, projects, reconcile, serialize, unbind, validateBinding };
