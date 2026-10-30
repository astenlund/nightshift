'use strict';

// Evaluation launcher for a Vibe model in a stage the runtime does not admit it for, injected into the runtime's review dispatch by
// the seeded-defect harness: a GLM skeptic, or a lead or skeptic of a model no admitted family holds, such as Mistral Large 4. The
// harness names a gate candidate so the runtime accepts the dispatch, and this launcher runs it on Vibe through the same isolated
// runtime launcher, which needs a table entry for the model.

const path = require('node:path');

const { runVibe } = require(path.resolve(__dirname, '../../internal/runtime/hosts.js'));

module.exports = { runVibe };
