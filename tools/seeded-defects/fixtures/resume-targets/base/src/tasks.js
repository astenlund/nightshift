function nextTask(tasks) {
  return tasks.find(task => task.status === 'pending') ?? null;
}

module.exports = { nextTask };
