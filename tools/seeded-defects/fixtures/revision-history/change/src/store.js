class Store {
  constructor() {
    this.history = [];
    this.state = { revision: 0, tasks: [] };
  }

  apply(change) {
    const next = { ...structuredClone(this.state), ...change, revision: this.state.revision + 1 };
    this.history.push(structuredClone(next));
    this.state = next;
    return next.revision;
  }
}

module.exports = { Store };
