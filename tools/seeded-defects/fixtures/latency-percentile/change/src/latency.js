function clean(samples) {
  const kept = [];
  for (const value of samples) {
    if (value == null || value !== value || value < 0) continue;
    kept.push(value);
  }
  return kept;
}

function rank(sorted, fraction) {
  return sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)];
}

function latencyReport(samples) {
  const sorted = clean(samples).sort();
  if (sorted.length === 0) return { count: 0, median: null, p95: null };
  return { count: sorted.length, median: rank(sorted, 0.5), p95: rank(sorted, 0.95) };
}

module.exports = { latencyReport };
