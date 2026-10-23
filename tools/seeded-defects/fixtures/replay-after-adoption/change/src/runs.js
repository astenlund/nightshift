const runs = new Map();
const seen = new Map();

function createRun(id, owner) {
  if (runs.has(id)) throw new Error(`run ${id} already exists`);
  runs.set(id, { id, owner, state: 'open' });
  return { ...runs.get(id) };
}

function adopt(id, newOwner) {
  const run = runs.get(id);
  run.owner = newOwner;
  return { ...run };
}

function update(request) {
  const run = runs.get(request.runId);
  if (seen.has(request.id)) {
    const recorded = seen.get(request.id);
    run.owner = recorded.owner;
    run.state = recorded.state;
    return { state: run.state, replayed: true };
  }
  if (run.owner !== request.owner) throw new Error('not the owner');
  run.state = request.state;
  seen.set(request.id, { owner: request.owner, state: request.state });
  return { state: run.state };
}

module.exports = { adopt, createRun, update };
