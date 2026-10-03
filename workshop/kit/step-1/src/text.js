// Small text helpers for the workshop.

function wordCount(text) {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

module.exports = { wordCount };
