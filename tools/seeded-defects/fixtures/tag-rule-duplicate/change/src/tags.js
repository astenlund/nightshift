function validTag(tag) {
  return typeof tag === 'string' && tag.length > 0 && tag.length <= 64;
}

function normalizeTags(tags) {
  const lowered = tags.map(tag => (typeof tag === 'string' ? tag.toLowerCase() : tag));
  return [...new Set(lowered.filter(validTag))];
}

module.exports = { normalizeTags, validTag };
