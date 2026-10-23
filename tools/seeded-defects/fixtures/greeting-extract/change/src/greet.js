function greeting(name) {
  return 'Hello, ' + name + '!';
}

function greet(name) {
  return greeting(name);
}

module.exports = { greet, greeting };
