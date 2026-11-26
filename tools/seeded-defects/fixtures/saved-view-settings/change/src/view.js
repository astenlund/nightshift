'use strict';

const { padding } = require('./width');

function labelOf(settings) {
  return settings.label.trim();
}

function render(settings) {
  const label = labelOf(settings);

  return label + ' ' + padding(settings.width);
}

module.exports = { render };
