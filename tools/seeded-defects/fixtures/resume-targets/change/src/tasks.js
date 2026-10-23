function resumeTargets(tasks) {
  return tasks.filter(task => task.status !== 'pending').map(task => task.id);
}

function nextTask(tasks) {
  return tasks.find(task => task.status === 'pending') ?? null;
}

module.exports = { nextTask, resumeTargets };
