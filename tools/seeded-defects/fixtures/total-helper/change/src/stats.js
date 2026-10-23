function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function total(values) {
  return values.reduce((sum, value) => sum + value, 0);
}

module.exports = { mean, total };
