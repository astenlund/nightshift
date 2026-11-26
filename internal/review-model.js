'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { hash, projectFile } = require('./runtime/evidence');

const REVIEW_MODEL_PATH = '.nightshift/REVIEW.md';
const TEMPLATE_PATH = path.resolve(__dirname, '../skills/init-backlog/templates/review.md');
const decoder = new TextDecoder('utf-8', { fatal: true });
const LF = String.fromCharCode(10);
const CRLF = String.fromCharCode(13, 10);

function normalizeModelText(text) {
  return text.replaceAll(CRLF, LF);
}

function modelSource(bytes) {
  return { text: decoder.decode(bytes), sha256: hash(bytes), bytes };
}

function bundledModel() {
  return modelSource(fs.readFileSync(TEMPLATE_PATH));
}

function projectModel(root) {
  const file = projectFile(root, REVIEW_MODEL_PATH);
  if (!fs.lstatSync(file, { throwIfNoEntry: false })) return null;

  return modelSource(fs.readFileSync(file));
}

module.exports = { REVIEW_MODEL_PATH, bundledModel, normalizeModelText, projectModel };
