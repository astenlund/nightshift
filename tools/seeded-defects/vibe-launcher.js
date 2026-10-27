'use strict';

// Evaluation launcher for a Vibe skeptic, injected into the runtime's review dispatch by the seeded-defect harness. The runtime admits
// GLM on Vibe as a lead and runs it through its own launcher, but never as a skeptic; the harness names a gate candidate so the
// runtime accepts the skeptic dispatch, and this launcher runs it on Vibe through the same isolated runtime launcher.

const path = require('node:path');

const { runVibe } = require(path.resolve(__dirname, '../../internal/runtime/hosts.js'));

module.exports = { runVibe };
