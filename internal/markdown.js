'use strict';

const { isUtf8 } = require('node:buffer');

function fenceOpener(content) {
  const match = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(content);
  if (!match) {
    return null;
  }

  const marker = match[2][0];
  if (marker === '`' && match[3].includes('`')) {
    return null;
  }

  return { marker, length: match[2].length };
}

function isFenceCloser(content, fence) {
  const match = /^( {0,3})(`+|~+)([ \t]*)$/.exec(content);

  return match !== null && match[2][0] === fence.marker && match[2].length >= fence.length;
}

function headingFor(content) {
  const match = /^( {0,3})(#{1,6})[ \t]+.*?$/.exec(content);

  return match ? { level: match[2].length, exactLine: content } : null;
}

function isTopLevelBullet(content) {
  return /^( {0,3})[-*+][ \t]+\S.*$/.test(content);
}

function scanMarkdownUncached(sourceBuffer) {
  if (!Buffer.isBuffer(sourceBuffer) || !isUtf8(sourceBuffer)) throw new Error('Artifact is not valid UTF-8');
  const bomLength = sourceBuffer.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) ? 3 : 0;
  const lines = [];
  let start = bomLength;
  let fence = null;

  while (start < sourceBuffer.length) {
    let end = start;
    while (end < sourceBuffer.length && sourceBuffer[end] !== 0x0a && sourceBuffer[end] !== 0x0d) {
      end += 1;
    }

    let terminatorEnd = end;
    if (sourceBuffer[end] === 0x0d && sourceBuffer[end + 1] === 0x0a) {
      terminatorEnd += 2;
    } else if (end < sourceBuffer.length) {
      terminatorEnd += 1;
    }

    const content = sourceBuffer.subarray(start, end).toString('utf8');
    const terminator = sourceBuffer.subarray(end, terminatorEnd);
    const outsideFence = fence === null;
    const opener = outsideFence ? fenceOpener(content) : null;
    const closesFence = fence !== null && isFenceCloser(content, fence);
    lines.push({
      rawStart: start,
      rawEnd: terminatorEnd,
      content,
      terminator,
      outsideFence,
      opensFence: opener !== null,
      heading: outsideFence ? headingFor(content) : null,
      topLevelBullet: outsideFence && isTopLevelBullet(content),
    });

    if (opener) {
      fence = opener;
    } else if (closesFence) {
      fence = null;
    }

    start = terminatorEnd;
  }

  if (start === sourceBuffer.length && sourceBuffer.length === bomLength) {
    return { sourceBuffer, bomLength, lines, unclosedFence: false };
  }

  return { sourceBuffer, bomLength, lines, unclosedFence: fence !== null };
}

function scanMarkdown(sourceBuffer) {
  return scanMarkdownUncached(sourceBuffer);
}

module.exports = { scanMarkdown };
