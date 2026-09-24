'use strict';

// Recorded Codex reviewers have streamed only whitespace for many minutes after starting their final report and never
// completed, while the longest whitespace stretch in a completed review lasted seconds. Both bounds must be reached.
const OUTPUT_LOOP_MIN_MS = 120000;
const OUTPUT_LOOP_MIN_DELTAS = 1000;

function outputLoopDetector({ minMs = OUTPUT_LOOP_MIN_MS, minDeltas = OUTPUT_LOOP_MIN_DELTAS } = {}) {
  let item = null;
  let count = 0;
  let since = null;
  let lastTextAt = null;

  return ({ itemId, delta, at }) => {
    if (itemId !== item) {
      item = itemId;
      count = 0;
      since = null;
    }
    if (/\S/.test(delta)) {
      count = 0;
      since = null;
      lastTextAt = at;

      return null;
    }
    count++;
    since ??= at;

    return count >= minDeltas && at - since >= minMs ? { deltas: count, durationMs: at - since, lastTextAt } : null;
  };
}

function outputLoopMessage(loop) {
  const lastText = loop.lastTextAt === null ? 'without any text' : `after its last text at ${new Date(loop.lastTextAt).toISOString()}`;

  return `Reviewer streamed only whitespace for ${Math.round(loop.durationMs / 1000)} s (${loop.deltas} deltas) ${lastText}; the attempt was ended as an output loop`;
}

module.exports = { OUTPUT_LOOP_MIN_DELTAS, OUTPUT_LOOP_MIN_MS, outputLoopDetector, outputLoopMessage };
