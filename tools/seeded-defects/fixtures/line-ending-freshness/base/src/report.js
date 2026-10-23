function summarize(results) {
  const stale = results.filter(result => !result.fresh).length;
  return `${stale} of ${results.length - 1} files are stale`;
}

module.exports = { summarize };
