function lastEvent(events, type) {
  return events.filter(event => event.type === type).at(-1) ?? null;
}

module.exports = { lastEvent };
