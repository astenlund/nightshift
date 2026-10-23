const MAX_NAME = 64;

function validName(name) {
  return typeof name === 'string' && name.length > 0 && name.length <= MAX_NAME;
}

module.exports = { MAX_NAME, validName };
