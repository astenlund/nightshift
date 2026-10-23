const runs = new Map();

function createRun(id, owner) {
  runs.set(id, { id, owner, state: 'open' });
  return runs.get(id);
}

function adopt(id, newOwner) {
  const run = runs.get(id);
  run.owner = newOwner;
  return run;
}

function update(request) {
  const run = runs.get(request.runId);
  if (run.owner !== request.owner) throw new Error('not the owner');
  run.state = request.state;
  return { state: run.state };
}

module.exports = { adopt, createRun, runs, update };
