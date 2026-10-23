// A feature keeps the text below its heading in body; a quick win is one bullet whose text follows its bold title.
function feature(title, body) {
  return { kind: 'feature', title, body };
}

function quickWin(title, text) {
  return { kind: 'quick-win', title, text };
}

module.exports = { feature, quickWin };
