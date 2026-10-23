class Store {
  #history = [];
  #state = { revision: 0, tasks: [] };

  constructor() {
    this.#history.push(structuredClone(this.#state));
  }

  apply(change) {
    const next = { ...this.#state, ...structuredClone(change), revision: this.#state.revision + 1 };
    this.#history.push(structuredClone(next));
    this.#state = next;
    return next.revision;
  }

  revision(number) {
    if (!Number.isInteger(number) || number < 0 || number >= this.#history.length) throw new RangeError(`no revision ${number}`);
    return structuredClone(this.#history[number]);
  }
}

module.exports = { Store };
