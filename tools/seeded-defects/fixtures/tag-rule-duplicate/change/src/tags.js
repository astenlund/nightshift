function validTag(tag) {
  return typeof tag === 'string' && tag.length > 0 && tag.length <= 64;
}

function normalizeTags(tags) {
  return [...new Set(tags.filter(validTag).map(tag => tag.toLowerCase()))];
}

module.exports = { normalizeTags, validTag };
