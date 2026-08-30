const { createHash } = require('node:crypto');
const { isUtf8 } = require('node:buffer');
const { closeSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } = require('node:fs');
const nodePath = require('node:path');
const { isDeepStrictEqual } = require('node:util');

let stagingCounter = 0;

class AgreementError extends Error {
  constructor(code, message, evidence = {}) {
    super(message);
    this.name = 'AgreementError';
    this.code = code;
    this.evidence = evidence;
  }
}

function structural(message, evidence) {
  throw new AgreementError('structural-error', message, evidence);
}

function requireUtf8(sourceBuffer) {
  if (!Buffer.isBuffer(sourceBuffer) || !isUtf8(sourceBuffer)) {
    structural('Artifact is not valid UTF-8.', { kind: 'invalid-utf8' });
  }
}

function decode(buffer) {
  return buffer.toString('utf8');
}

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

function isReadyBacklogHeading(line, level) {
  const prefix = `${'#'.repeat(level)} `;

  return line.outsideFence && line.heading?.level === level && line.content.startsWith(prefix) && line.content.length > prefix.length;
}

function readyBacklogBulletText(line) {
  return line.outsideFence && /^- /.test(line.content) ? line.content.slice(2).trim() : null;
}

function scanMarkdownUncached(sourceBuffer) {
  requireUtf8(sourceBuffer);
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

    const content = decode(sourceBuffer.subarray(start, end));
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

function createMarkdownScanner() {
  const scans = new WeakMap();

  return (sourceBuffer) => {
    let scanned = scans.get(sourceBuffer);
    if (scanned === undefined) {
      scanned = scanMarkdownUncached(sourceBuffer);
      scans.set(sourceBuffer, scanned);
    }

    return scanned;
  };
}

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function exactOrderedKeys(value, keys) {
  return exactKeys(value, keys) && Object.keys(value).every((key, index) => key === keys[index]);
}

function hasControlCharacters(value) {
  return typeof value === 'string' && /[\u0000-\u001f\u007f]/.test(value);
}

function validateSelectors(selectorKind, selectors) {
  if (!Array.isArray(selectors)) {
    structural('Selectors must be an array.', { kind: 'selector-shape' });
  }
  if (selectorKind === 'design-before-hardening') {
    if (selectors.length !== 0) {
      structural('Design selectors must be empty.', { kind: 'selector-shape' });
    }
    return;
  }
  if (selectorKind === 'sections') {
    if (selectors.length > 0 && selectors.every((selector) => exactOrderedKeys(selector, ['headingPath']) && Array.isArray(selector.headingPath) && selector.headingPath.length > 0 && selector.headingPath.every((heading) => typeof heading === 'string' && heading !== ''))) {
      return;
    }
    structural('Section selector is not a complete heading path.', { kind: 'selector-shape' });
  }
  if ((selectorKind === 'index-entry' || selectorKind === 'bullet-entry') && selectors.length === 1) {
    const keys = selectorKind === 'index-entry' ? ['parentHeading', 'entryHeading'] : ['parentHeading', 'entryTitle'];
    if (exactOrderedKeys(selectors[0], keys) && keys.every((key) => typeof selectors[0][key] === 'string' && selectors[0][key] !== '')) {
      return;
    }
  }

  structural('Selector has an invalid closed shape.', { kind: 'selector-shape' });
}

function requireUniqueSelectorMatch(matches, label) {
  if (matches.length === 0) {
    structural(`${label} is absent.`, { kind: 'selector-absence' });
  }
  if (matches.length > 1) {
    structural(`${label} is ambiguous.`, { kind: 'selector-ambiguity' });
  }

  return matches[0];
}

function sectionPathKey(path) {
  return path.map((heading) => `${heading.length}:${heading}`).join('');
}

function resolveSectionSelectors(lines, selectors, absenceIsFalse) {
  const paths = [];
  const headingsByPath = new Map();
  for (const [index, line] of lines.entries()) {
    if (!line.outsideFence || line.heading === null) {
      continue;
    }
    paths.splice(line.heading.level - 1);
    paths[line.heading.level - 1] = line.heading.exactLine;
    if (line.heading.level >= 2) {
      const path = paths.slice(1, line.heading.level);
      const key = sectionPathKey(path);
      const matches = headingsByPath.get(key);
      if (matches === undefined) {
        headingsByPath.set(key, [{ index }]);
      } else {
        matches.push({ index });
      }
    }
  }
  let previous = -1;
  for (const selector of selectors) {
    const key = sectionPathKey(selector.headingPath);
    const matches = headingsByPath.get(key) ?? [];
    if (matches.length === 0 && absenceIsFalse) {
      return false;
    }
    const match = requireUniqueSelectorMatch(matches, 'Section heading path');
    if (match.index <= previous) {
      structural('Section selectors are not in document order.', { kind: 'selector-shape' });
    }
    previous = match.index;
  }

  return true;
}

function validateSectionSelectorOrder(lines, selectors) {
  resolveSectionSelectors(lines, selectors, false);
}

function normalizeRawSpan(span) {
  let offset = 0;
  if (span.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) {
    offset = 3;
  }
  return Buffer.from(decode(span.subarray(offset)).replace(/\r\n|\r/g, '\n'), 'utf8');
}

function canonicalBytes(sourceSpans) {
  const normalized = Buffer.concat(sourceSpans.map((sourceSpan) => normalizeRawSpan(sourceSpan.buffer)));
  const text = decode(normalized).replace(/\n+$/, '');
  return Buffer.from(`${text}\n`, 'utf8');
}

const HARDENING_PLACEHOLDERS = new Set([
  '- (None yet; this file has not been through a revise-spec run.)',
  '- (None yet; this file has not completed a revise-spec run.)',
  '- (None entered yet; this file has not been through a revise-spec review.)',
]);
const GRADUATED_PROVENANCE = /^- revise-(?:spec|plan) graduated \d{4}-\d{2}-\d{2} \d{2}:\d{2} at [0-9a-f]{7,40}, scope: \S(?:.*\S)?, content: (?:[0-9a-f]{8}|p-[0-9a-f]{12})$/;
const REFRESHED_PROVENANCE = /^- revise-(?:spec|plan) refreshed \d{4}-\d{2}-\d{2} \d{2}:\d{2} at [0-9a-f]{7,40}, scope: \S(?:.*\S)?, content: (?:[0-9a-f]{8}|p-[0-9a-f]{12}) \(\S(?:.*\S)?\)$/;
const COMPLETED_PROVENANCE = /^- handover completed \d{4}-\d{2}-\d{2} \d{2}:\d{2} at [0-9a-f]{7,40}, scope: \S(?:.*\S)?, content: (?:[0-9a-f]{8}|p-[0-9a-f]{12})$/;
const LEGACY_STATUS_MARKER = /^Status:[ \t]+signed off(?:[ \t].*)?$/;
const LEGACY_REFRESH_MARKER = /^- [A-Za-z0-9-]+ refreshed .+ \(sign-off marker\)[ \t]*$/;

function provenanceKind(content) {
  if (GRADUATED_PROVENANCE.test(content)) {
    return 'graduated';
  }
  if (REFRESHED_PROVENANCE.test(content)) {
    return 'refreshed';
  }
  if (COMPLETED_PROVENANCE.test(content)) {
    return 'completed';
  }

  return null;
}

function hardeningGrammar(message) {
  structural(message, { kind: 'hardening-grammar' });
}

function hardeningBodyLines(lines, index) {
  for (let lineIndex = index + 1; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (line.outsideFence && line.heading) {
      hardeningGrammar('Hardening section must be terminal.');
    }
  }

  return lines.slice(index + 1).filter((line) => line.content.trim() !== '');
}

function hardeningState(lines, index, allowEmpty = false) {
  const bodyLines = hardeningBodyLines(lines, index);
  const values = bodyLines.map((line) => line.content);
  const placeholderCount = values.filter((value) => HARDENING_PLACEHOLDERS.has(value)).length;

  if (values.length === 0) {
    if (allowEmpty) {
      return { kind: 'empty', bodyLines };
    }
    hardeningGrammar('Hardening section must contain recognized provenance.');
  }
  if (placeholderCount > 0 && (placeholderCount !== 1 || values.length !== 1)) {
    hardeningGrammar('Hardening placeholders cannot be mixed.');
  }
  if (values.some((value) => !HARDENING_PLACEHOLDERS.has(value) && provenanceKind(value) === null)) {
    hardeningGrammar('Hardening section contains unrecognized material.');
  }

  return placeholderCount === 1 ? { kind: 'placeholder', bodyLines } : { kind: 'provenance', bodyLines };
}

function rangeSpan(sourceBuffer, start, end) {
  const spanStart = start === 3 && sourceBuffer.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) ? 0 : start;
  return { buffer: sourceBuffer.subarray(spanStart, end), start: spanStart, end };
}

function selection(path, selectorKind, selectors, sourceSpans) {
  const selectedBytes = canonicalBytes(sourceSpans);
  return { path, selectorKind, selectors, selectedBytes, sourceSpans: sourceSpans.map((sourceSpan) => sourceSpan.buffer), sourceRanges: sourceSpans.map(({ start, end }) => ({ start, end })) };
}

function resolveReadyEntry(lines, selectorKind, selector) {
  const parents = lines.filter((line) => isReadyBacklogHeading(line, 2) && line.content === selector.parentHeading);
  const parent = requireUniqueSelectorMatch(parents, 'Parent heading');
  const parentIndex = lines.indexOf(parent);
  const nextParent = lines.findIndex((line, index) => index > parentIndex && (isReadyBacklogHeading(line, 1) || isReadyBacklogHeading(line, 2)));
  const parentEnd = nextParent < 0 ? lines.length : nextParent;
  if (selectorKind === 'index-entry') {
    const entries = lines.slice(parentIndex + 1, parentEnd).filter((line) => isReadyBacklogHeading(line, 3) && line.content === selector.entryHeading);
    const entry = requireUniqueSelectorMatch(entries, 'Index entry');
    const entryIndex = lines.indexOf(entry);
    const endIndex = lines.findIndex((line, index) => index > entryIndex && [1, 2, 3].some((level) => isReadyBacklogHeading(line, level)));

    return { parent, entry, entryIndex, entryEnd: endIndex < 0 ? lines.length : endIndex };
  }
  const bullets = lines.slice(parentIndex + 1, parentEnd).filter((line) => readyBacklogBulletText(line) === selector.entryTitle);
  const bullet = requireUniqueSelectorMatch(bullets, 'Bullet entry');

  return { parent, bullet, bulletIndex: lines.indexOf(bullet) };
}

function selectArtifact({ path, selectorKind, selectors, sourceBuffer }, scan = scanMarkdown) {
  requireUtf8(sourceBuffer);
  validateSelectors(selectorKind, selectors);
  const scanned = scan(sourceBuffer);
  const { lines } = scanned;
  if (selectorKind === 'sections') {
    validateSectionSelectorOrder(lines, selectors);
    structural('Section selection is not an artifact selector.', { kind: 'selector-shape' });
  }
  if (selectorKind === 'design-before-hardening') {
    const hardening = lines.findIndex((line) => line.outsideFence && line.heading && line.heading.level === 2 && line.heading.exactLine === '## Hardening');
    if (hardening < 0) {
      return selection(path, selectorKind, selectors, [rangeSpan(sourceBuffer, 0, sourceBuffer.length)]);
    }
    hardeningState(lines, hardening);
    return selection(path, selectorKind, selectors, [rangeSpan(sourceBuffer, 0, lines[hardening].rawStart)]);
  }
  const selector = selectors[0];
  const resolved = resolveReadyEntry(lines, selectorKind, selector);
  if (selectorKind === 'index-entry') {
    return selection(path, selectorKind, selectors, [rangeSpan(sourceBuffer, resolved.parent.rawStart, resolved.parent.rawEnd), rangeSpan(sourceBuffer, resolved.entry.rawStart, lines[resolved.entryEnd - 1].rawEnd)]);
  }
  let entryEnd = resolved.bulletIndex + 1;
  let inFence = null;
  while (entryEnd < lines.length) {
    const line = lines[entryEnd];
    if (inFence) {
      if (isFenceCloser(line.content, inFence)) {
        inFence = null;
      }
      entryEnd += 1;
      continue;
    }
    if (line.content.trim() === '' || readyBacklogBulletText(line) !== null || [1, 2, 3].some((level) => isReadyBacklogHeading(line, level)) || !/^[ \t]+/.test(line.content)) {
      break;
    }
    const opener = fenceOpener(line.content);
    if (opener) {
      inFence = opener;
    }
    entryEnd += 1;
  }
  return selection(path, selectorKind, selectors, [rangeSpan(sourceBuffer, resolved.parent.rawStart, resolved.parent.rawEnd), rangeSpan(sourceBuffer, resolved.bullet.rawStart, lines[entryEnd - 1].rawEnd)]);
}

const LINE_LINK_FORMAT_VARIABLE = 'NIGHTSHIFT_LINE_LINK_FORMAT';
const FILE_LINK_FORMAT_VARIABLE = 'NIGHTSHIFT_FILE_LINK_FORMAT';
const LINK_RENDERING_VARIABLE = 'NIGHTSHIFT_LINK_RENDERING';

function renderLineLink(projectRoot, path, line, linkFormat) {
  const absolutePath = `${projectRoot.replace(/\\/g, '/').replace(/\/+$/, '')}/${path}`;
  if (line === null) {
    return { linkText: path, linkTarget: absolutePath };
  }
  const linkTarget = linkFormat === null || linkFormat === ''
    ? absolutePath
    : linkFormat.replace(/\{path\}|\{line\}/g, (token) => (token === '{path}' ? absolutePath : String(line)));

  return { linkText: `${path}:${line}`, linkTarget };
}

function locateSelection(input) {
  if (!exactOrderedKeys(input, ['projectRoot', 'path', 'selectorKind', 'selectors', 'sourceBuffer', 'linkFormat']) || typeof input.projectRoot !== 'string' || input.projectRoot === '' || (input.linkFormat !== null && typeof input.linkFormat !== 'string')) {
    structural('Locate input must carry projectRoot, path, selectorKind, selectors, sourceBuffer, and a string-or-null linkFormat.', { kind: 'locate-input' });
  }
  requireRelativePathShape(input.path, { shape: 'locate-input', escape: 'locate-input' });
  const { projectRoot, path, selectorKind, selectors, sourceBuffer, linkFormat } = input;
  const scan = createMarkdownScanner();
  const selected = selectArtifact({ path, selectorKind, selectors, sourceBuffer }, scan);
  let line = null;
  if (selectorKind !== 'design-before-hardening') {
    const entryStart = selected.sourceRanges[selected.sourceRanges.length - 1].start;
    line = scan(sourceBuffer).lines.findIndex((record) => record.rawStart === entryStart) + 1;
  }

  return { path, line, ...renderLineLink(projectRoot, path, line, linkFormat) };
}

function applyLinkEnvironment(location, environment) {
  const linkRendering = environment[LINK_RENDERING_VARIABLE] ?? null;
  if (linkRendering === null || linkRendering === '') {
    return location;
  }
  if (linkRendering !== 'osc8') {
    structural('Link rendering must be osc8 when explicitly configured.', { kind: 'link-rendering', value: linkRendering });
  }
  const fileLinkFormat = environment[FILE_LINK_FORMAT_VARIABLE] ?? null;
  if (fileLinkFormat !== null && typeof fileLinkFormat !== 'string') {
    structural('File-link format must be a string when explicitly configured.', { kind: 'file-link-format' });
  }
  const linkTarget = location.line === null && fileLinkFormat !== null && fileLinkFormat !== ''
    ? fileLinkFormat.replace(/\{path\}/g, () => location.linkTarget)
    : location.linkTarget;

  return { ...location, linkTarget, linkRendering };
}

function hashSelection(selectionRecord) {
  validateCurrentSource(selectionRecord);
  const contentHash = createHash('sha256').update(selectionRecord.selectedBytes).digest('hex');
  const rawSpanHex = selectionRecord.sourceSpans.map((span) => span.toString('hex'));
  const sourceHash = createHash('sha256').update(JSON.stringify(rawSpanHex), 'utf8').digest('hex');

  return {
    path: selectionRecord.path,
    selectorKind: selectionRecord.selectorKind,
    selectors: selectionRecord.selectors,
    selectedBytes: selectionRecord.selectedBytes,
    sourceSpans: selectionRecord.sourceSpans,
    sourceRanges: selectionRecord.sourceRanges,
    contentHash,
    sourceHash,
  };
}

function thrownMessage(thrown) {
  if (thrown instanceof Error && typeof thrown.message === 'string') {
    return thrown.message;
  }
  try {
    return String(thrown);
  } catch {
    return 'unprintable thrown value';
  }
}

function adapterCall(fsAdapter, operation, path) {
  try {
    return fsAdapter[operation](path);
  } catch (thrown) {
    structural('Filesystem adapter could not read the nominated artifact.', { kind: 'unreadable-artifact', operation, path, originalMessage: thrownMessage(thrown) });
  }
}

function relativePathShape(nominatedPath) {
  if (typeof nominatedPath !== 'string' || nominatedPath === '' || hasControlCharacters(nominatedPath)) {
    return { violation: { class: 'shape', message: 'Nominated path must be a nonempty project-relative path.' }, segments: null };
  }
  if (nodePath.isAbsolute(nominatedPath) || /^[A-Za-z]:/.test(nominatedPath)) {
    return { violation: { class: 'escape', message: 'Nominated path must remain beneath the project root.' }, segments: null };
  }
  const segments = nominatedPath.replace(/\\/g, '/').split('/');
  if (segments.some((segment) => segment === '..')) {
    return { violation: { class: 'escape', message: 'Nominated path must remain beneath the project root.' }, segments: null };
  }
  if (nominatedPath.includes('\\') || segments.some((segment) => segment === '' || segment === '.')) {
    return { violation: { class: 'shape', message: 'Nominated path must use canonical ordinal spelling.' }, segments: null };
  }

  return { violation: null, segments };
}

function requireRelativePathShape(nominatedPath, kinds) {
  const { violation, segments } = relativePathShape(nominatedPath);
  if (violation !== null) {
    structural(violation.message, { kind: kinds[violation.class], path: nominatedPath });
  }

  return segments;
}

function canonicalizePath(projectRoot, nominatedPath, fsAdapter) {
  const segments = requireRelativePathShape(nominatedPath, { shape: 'path-casing', escape: 'root-escape' });
  let current = projectRoot;
  for (const segment of segments) {
    const entries = adapterCall(fsAdapter, 'readDirectory', current);
    const matches = entries.filter((entry) => entry === segment);
    if (matches.length === 0) {
      structural('Nominated path does not match directory casing.', { kind: 'path-casing', path: nominatedPath });
    }
    if (matches.length !== 1) {
      structural('Nominated path segment is ambiguous.', { kind: 'path-casing', path: nominatedPath });
    }
    current = `${current.replace(/[\\/]$/, '')}/${segment}`;
  }
  const realRoot = adapterCall(fsAdapter, 'realpath', projectRoot);
  const realPath = adapterCall(fsAdapter, 'realpath', current);
  const relative = nodePath.relative(realRoot, realPath);
  if (relative === '' || relative === '..' || relative.startsWith(`..${nodePath.sep}`) || nodePath.isAbsolute(relative)) {
    structural('Nominated path escapes the project root.', { kind: 'root-escape', path: nominatedPath });
  }

  return { path: segments.join('/'), realPath };
}

function completeFileHash(sourceBuffer) {
  return createHash('sha256').update(sourceBuffer).digest('hex');
}

function staleBaseline(baselineHash, currentHash) {
  throw new AgreementError('stale-baseline', 'The complete artifact bytes no longer match the recorded baseline.', { baselineHash, currentHash });
}

function legacyHardeningIsEligible(lines, hardeningIndex) {
  const values = hardeningBodyLines(lines, hardeningIndex).map((line) => line.content);
  const placeholderCount = values.filter((value) => HARDENING_PLACEHOLDERS.has(value)).length;
  if (placeholderCount > 0 && (placeholderCount !== 1 || values.length !== 1)) {
    hardeningGrammar('Hardening placeholders cannot be mixed.');
  }
  if (values.some((value) => !HARDENING_PLACEHOLDERS.has(value) && provenanceKind(value) === null && !LEGACY_STATUS_MARKER.test(value) && !LEGACY_REFRESH_MARKER.test(value))) {
    hardeningGrammar('Hardening section contains unrecognized material.');
  }
}

function validateLegacyMatch(match) {
  const validShape = exactOrderedKeys(match, ['path', 'kind', 'rawStart', 'rawEnd', 'rawLine'])
    && typeof match.path === 'string'
    && match.path !== ''
    && ['status', 'hardening-refresh'].includes(match.kind)
    && Number.isSafeInteger(match.rawStart)
    && Number.isSafeInteger(match.rawEnd)
    && match.rawStart >= 0
    && match.rawEnd > match.rawStart
    && Buffer.isBuffer(match.rawLine)
    && match.rawEnd - match.rawStart === match.rawLine.length;
  if (!validShape || !isUtf8(match.rawLine)) {
    return false;
  }
  const content = decode(match.rawLine).replace(/(?:\r\n|\r|\n)$/, '');
  if (/\r|\n/.test(content)) {
    return false;
  }
  return match.kind === 'status' ? LEGACY_STATUS_MARKER.test(content) : LEGACY_REFRESH_MARKER.test(content);
}

function legacyMatchesEqual(actual, expected) {
  return actual.length === expected.length && actual.every((match, index) => {
    const detected = expected[index];

    return validateLegacyMatch(match)
      && match.path === detected.path
      && match.kind === detected.kind
      && match.rawStart === detected.rawStart
      && match.rawEnd === detected.rawEnd
      && match.rawLine.equals(detected.rawLine);
  });
}

function uniquePhysicalLegacyArtifacts(artifacts) {
  const byPath = new Map();
  for (const artifact of artifacts) {
    if (!validArtifactSnapshot(artifact)) {
      hardeningGrammar('Legacy detection artifact must use the closed snapshot shape.');
    }
    const existing = byPath.get(artifact.path);
    if (existing !== undefined) {
      if (!existing.sourceBuffer.equals(artifact.sourceBuffer)) {
        hardeningGrammar('Duplicate legacy detection snapshots for one path must contain identical physical bytes.');
      }
      continue;
    }
    byPath.set(artifact.path, artifact);
  }

  return [...byPath.values()];
}

function detectLegacyMarkers(input, scan = scanMarkdown) {
  if (!exactOrderedKeys(input, ['artifacts']) || !Array.isArray(input.artifacts)) {
    hardeningGrammar('Legacy detection requires an ordered artifact array.');
  }
  const matches = [];

  for (const artifact of uniquePhysicalLegacyArtifacts(input.artifacts)) {
    const scanned = scan(artifact.sourceBuffer);
    if (scanned.unclosedFence) {
      hardeningGrammar('Legacy detection cannot scan an unclosed fenced block.');
    }
    const hardeningHeadings = scanned.lines.map((line, index) => ({ line, index })).filter(({ line }) => line.outsideFence && line.heading?.level === 2 && line.heading.exactLine === '## Hardening');
    if (hardeningHeadings.length > 1) {
      hardeningGrammar('Artifact contains multiple Hardening sections.');
    }
    if (hardeningHeadings.length === 1) {
      legacyHardeningIsEligible(scanned.lines, hardeningHeadings[0].index);
    }

    for (const [index, line] of scanned.lines.entries()) {
      let kind = null;
      if (line.outsideFence && LEGACY_STATUS_MARKER.test(line.content)) {
        kind = 'status';
      } else if (line.outsideFence && hardeningHeadings.length === 1 && index > hardeningHeadings[0].index && LEGACY_REFRESH_MARKER.test(line.content)) {
        kind = 'hardening-refresh';
      }
      if (kind !== null) {
        matches.push({
          path: artifact.path,
          kind,
          rawStart: line.rawStart,
          rawEnd: line.rawEnd,
          rawLine: Buffer.from(artifact.sourceBuffer.subarray(line.rawStart, line.rawEnd)),
        });
      }
    }
  }

  return { matches };
}

function previewLegacyMarkerDeletion(input, scan = createMarkdownScanner()) {
  if (!exactOrderedKeys(input, ['sourceBuffer', 'baselineHash', 'matches']) || !Buffer.isBuffer(input.sourceBuffer) || !Array.isArray(input.matches)) {
    hardeningGrammar('Legacy preview input must use the closed shape.');
  }
  const currentHash = completeFileHash(input.sourceBuffer);
  if (!/^[0-9a-f]{64}$/.test(input.baselineHash) || currentHash !== input.baselineHash) {
    staleBaseline(input.baselineHash, currentHash);
  }

  return previewLegacyMarkerDeletionValidated(input, scan);
}

function previewLegacyMarkerDeletionValidated(input, scan = scanMarkdown) {
  const detected = detectLegacyMarkers({
    artifacts: [{ path: input.matches[0]?.path, selectorKind: 'design-before-hardening', selectors: [], sourceBuffer: input.sourceBuffer }],
  }, scan).matches;
  if (!legacyMatchesEqual(input.matches, detected)) {
    hardeningGrammar('Legacy deletion evidence does not match the markers detected in the current source bytes.');
  }
  const scanned = scan(input.sourceBuffer);
  let previousEnd = -1;
  let path = null;
  for (const match of input.matches) {
    if (!validateLegacyMatch(match) || (path !== null && match.path !== path) || match.rawStart < previousEnd || !input.sourceBuffer.subarray(match.rawStart, match.rawEnd).equals(match.rawLine)) {
      hardeningGrammar('Legacy deletion evidence does not match the recorded source bytes.');
    }
    path = match.path;
    previousEnd = match.rawEnd;
  }

  const matchedStarts = new Set(input.matches.map((match) => match.rawStart));
  const claimedBlankStarts = new Set();
  let lineIndex = 0;
  const deletions = input.matches.map((match) => {
    while (lineIndex < scanned.lines.length && scanned.lines[lineIndex].rawStart < match.rawStart) {
      lineIndex += 1;
    }
    const line = scanned.lines[lineIndex];
    if (line === undefined || line.rawStart !== match.rawStart || line.rawEnd !== match.rawEnd) {
      hardeningGrammar('Legacy deletion evidence does not identify one complete logical line.');
    }
    const adjacent = [scanned.lines[lineIndex + 1], scanned.lines[lineIndex - 1]].find((line) => line !== undefined
      && line.content === ''
      && !matchedStarts.has(line.rawStart)
      && !claimedBlankStarts.has(line.rawStart));
    const ownedBlankLine = adjacent === undefined ? null : { start: adjacent.rawStart, end: adjacent.rawEnd };
    if (adjacent !== undefined) {
      claimedBlankStarts.add(adjacent.rawStart);
    }
    lineIndex += 1;

    return { ...match, rawLine: Buffer.from(match.rawLine), ownedBlankLine };
  });
  const ranges = deletions.flatMap((deletion) => [
    { start: deletion.rawStart, end: deletion.rawEnd },
    ...(deletion.ownedBlankLine === null ? [] : [deletion.ownedBlankLine]),
  ]).sort((left, right) => left.start - right.start);
  const spans = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start < cursor) {
      hardeningGrammar('Legacy deletion ranges overlap.');
    }
    spans.push(input.sourceBuffer.subarray(cursor, range.start));
    cursor = range.end;
  }
  spans.push(input.sourceBuffer.subarray(cursor));

  return { replacementBytes: Buffer.concat(spans), deletions };
}

function parseHardeningForWrite(sourceBuffer) {
  const scanned = scanMarkdown(sourceBuffer);
  if (scanned.unclosedFence) {
    throw new AgreementError('unclosed-fence-prevents-hardening-provenance', 'An unclosed fence prevents Hardening provenance.', {});
  }
  const headings = scanned.lines.map((line, index) => ({ line, index })).filter(({ line }) => line.outsideFence && line.heading?.level === 2 && line.heading.exactLine === '## Hardening');
  if (headings.length > 1) {
    hardeningGrammar('Artifact contains multiple Hardening sections.');
  }
  if (headings.length === 0) {
    return { scanned, heading: null, state: { kind: 'missing', bodyLines: [] } };
  }

  return { scanned, heading: headings[0], state: hardeningState(scanned.lines, headings[0].index, true) };
}

function preferredTerminator(lines) {
  const line = [...lines].reverse().find((candidate) => candidate.terminator.length > 0);

  return line === undefined ? Buffer.from('\n') : Buffer.from(line.terminator);
}

function appendBytes(sourceBuffer, addition) {
  return Buffer.concat([sourceBuffer, ...addition]);
}

function buildProvenanceBytes(sourceBuffer, stamp) {
  const stampKind = provenanceKind(stamp);
  if (stampKind === null) {
    hardeningGrammar('Provenance stamp does not match a closed form.');
  }
  const parsed = parseHardeningForWrite(sourceBuffer);
  const terminator = preferredTerminator(parsed.scanned.lines);
  const sourceHasTerminal = parsed.scanned.lines.length > 0 && parsed.scanned.lines.at(-1).terminator.length > 0;
  const terminalStamp = sourceHasTerminal ? terminator : Buffer.alloc(0);

  if (parsed.state.kind === 'missing') {
    if (stampKind !== 'graduated') {
      hardeningGrammar('First Hardening provenance must be a graduation stamp.');
    }
    const separator = sourceBuffer.length === 0 || sourceHasTerminal ? [] : [terminator, terminator];

    return appendBytes(sourceBuffer, [...separator, Buffer.from('## Hardening'), terminator, terminator, Buffer.from(stamp), terminalStamp]);
  }
  if (parsed.state.kind === 'placeholder') {
    if (stampKind !== 'graduated') {
      hardeningGrammar('A Hardening placeholder can only be replaced by a graduation stamp.');
    }
    const placeholder = parsed.state.bodyLines[0];
    const replacement = Buffer.concat([Buffer.from(stamp), placeholder.terminator]);

    return Buffer.concat([sourceBuffer.subarray(0, placeholder.rawStart), replacement, sourceBuffer.subarray(placeholder.rawEnd)]);
  }
  if (parsed.state.kind === 'empty') {
    if (stampKind !== 'graduated') {
      hardeningGrammar('An empty Hardening section can only receive a graduation stamp.');
    }
    const lastLine = parsed.scanned.lines.at(-1);
    const hasBlankLine = lastLine !== undefined && lastLine.content === '';
    const separator = hasBlankLine ? [] : sourceHasTerminal ? [terminator] : [terminator, terminator];

    return appendBytes(sourceBuffer, [...separator, Buffer.from(stamp), terminalStamp]);
  }

  const existing = parsed.state.bodyLines.filter((line) => line.content === stamp);
  if (existing.length > 0) {
    hardeningGrammar('The intended provenance stamp already occurs in a non-retry form.');
  }
  const lastProvenance = parsed.state.bodyLines.at(-1);
  if (lastProvenance.terminator.length === 0) {
    return appendBytes(sourceBuffer, [terminator, Buffer.from(stamp)]);
  }
  const insertion = Buffer.concat([Buffer.from(stamp), Buffer.from(lastProvenance.terminator)]);

  return Buffer.concat([sourceBuffer.subarray(0, lastProvenance.rawEnd), insertion, sourceBuffer.subarray(lastProvenance.rawEnd)]);
}

function priorTerminatorStart(sourceBuffer, end) {
  if (end >= 2 && sourceBuffer[end - 2] === 0x0d && sourceBuffer[end - 1] === 0x0a) {
    return end - 2;
  }
  if (end >= 1 && (sourceBuffer[end - 1] === 0x0d || sourceBuffer[end - 1] === 0x0a)) {
    return end - 1;
  }

  return end;
}

function retryPreimages(sourceBuffer, stamp, parsed) {
  if (parsed.heading === null || parsed.state.kind !== 'provenance') {
    return [];
  }
  const occurrences = parsed.state.bodyLines.filter((line) => line.content === stamp);
  if (occurrences.length !== 1 || parsed.state.bodyLines.at(-1) !== occurrences[0]) {
    return [];
  }
  const stampLine = occurrences[0];
  const candidates = [Buffer.concat([sourceBuffer.subarray(0, stampLine.rawStart), sourceBuffer.subarray(stampLine.rawEnd)])];
  let stampCut = stampLine.rawStart;
  for (let count = 0; count < 2; count += 1) {
    stampCut = priorTerminatorStart(sourceBuffer, stampCut);
    candidates.push(Buffer.concat([sourceBuffer.subarray(0, stampCut), sourceBuffer.subarray(stampLine.rawEnd)]));
  }
  for (const placeholder of HARDENING_PLACEHOLDERS) {
    candidates.push(Buffer.concat([sourceBuffer.subarray(0, stampLine.rawStart), Buffer.from(placeholder), stampLine.terminator, sourceBuffer.subarray(stampLine.rawEnd)]));
  }
  if (parsed.state.bodyLines.length === 1) {
    let cut = parsed.heading.line.rawStart;
    candidates.push(sourceBuffer.subarray(0, cut));
    for (let count = 0; count < 2; count += 1) {
      cut = priorTerminatorStart(sourceBuffer, cut);
      candidates.push(sourceBuffer.subarray(0, cut));
    }
  }

  return candidates;
}

function isAppliedRetry(sourceBuffer, stamp, baselineHash) {
  let parsed;
  try {
    parsed = parseHardeningForWrite(sourceBuffer);
  } catch (error) {
    if (error instanceof AgreementError) {
      return false;
    }
    throw error;
  }
  if (parsed.heading === null || parsed.state.kind !== 'provenance') {
    return false;
  }
  const occurrences = parsed.state.bodyLines.filter((line) => line.content === stamp);
  if (occurrences.length !== 1 || parsed.state.bodyLines.at(-1) !== occurrences[0]) {
    return false;
  }
  return retryPreimages(sourceBuffer, stamp, parsed).some((candidate) => completeFileHash(candidate) === baselineHash && buildProvenanceBytes(candidate, stamp).equals(sourceBuffer));
}

function replaceFile(fsAdapter, path, bytes) {
  try {
    fsAdapter.replaceFileAtomically(path, Buffer.from(bytes));
  } catch (thrown) {
    throw new AgreementError('unexpected-adapter-failure', 'Filesystem adapter could not atomically replace the artifact.', { operation: 'replaceFileAtomically', path, originalMessage: thrownMessage(thrown) });
  }
}

const PROVENANCE_BINDING_KEYS = ['ctimeNs', 'dev', 'ino', 'mode', 'mtimeNs', 'nlink', 'realPath', 'size'];
const PROVENANCE_FILE_STATE_KEYS = ['ctimeNs', 'dev', 'ino', 'mode', 'mtimeNs', 'nlink', 'size'];

function validateBindingAdapter(bindingAdapter) {
  if (!exactOrderedKeys(bindingAdapter, ['fileState']) || typeof bindingAdapter.fileState !== 'function') {
    hardeningGrammar('Binding adapter must use the closed ordered shape.');
  }
}

function normalizeFileState(realPath, state) {
  if (!exactOrderedKeys(state, PROVENANCE_FILE_STATE_KEYS) || PROVENANCE_FILE_STATE_KEYS.some((key) => typeof state[key] !== 'bigint' || state[key] < 0n)) {
    structural('Filesystem adapter returned invalid file-binding state.', { kind: 'invalid-file-binding', path: realPath });
  }
  if (state.nlink !== 1n || (state.mode & 0o170000n) !== 0o100000n) {
    structural('Provenance target must be one ordinary single-linked file.', { kind: 'invalid-file-binding', path: realPath });
  }

  return Object.fromEntries(PROVENANCE_FILE_STATE_KEYS.map((key) => [key, state[key].toString()]).concat([['realPath', realPath]]).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
}

function readProvenanceBinding(realPath, bindingAdapter) {
  let state;
  try {
    state = bindingAdapter.fileState(realPath);
  } catch (thrown) {
    structural('Filesystem adapter could not inspect the provenance target.', { kind: 'unreadable-artifact', operation: 'fileState', path: realPath, originalMessage: thrownMessage(thrown) });
  }

  return normalizeFileState(realPath, state);
}

function validateProvenanceBinding(binding) {
  if (!exactOrderedKeys(binding, PROVENANCE_BINDING_KEYS)
    || typeof binding.realPath !== 'string'
    || binding.realPath === ''
    || PROVENANCE_FILE_STATE_KEYS.some((key) => typeof binding[key] !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(binding[key]))
    || binding.nlink !== '1'
    || (BigInt(binding.mode) & 0o170000n) !== 0o100000n) {
    hardeningGrammar('Provenance binding must use the closed canonical shape.');
  }
}

function requireCurrentBinding(expected, current) {
  if (!isDeepStrictEqual(expected, current)) {
    structural('The retained provenance file binding is stale.', { kind: 'stale-file-binding', expected, current });
  }
}

function captureProvenanceBinding(input, options) {
  if (!exactOrderedKeys(input, ['projectRoot', 'path']) || !exactOrderedKeys(options, ['fsAdapter', 'bindingAdapter'])) {
    hardeningGrammar('Provenance binding input must use the closed ordered shape.');
  }
  const { projectRoot, path } = input;
  const { fsAdapter, bindingAdapter } = options;
  validateFsAdapter(fsAdapter, hardeningGrammar);
  validateBindingAdapter(bindingAdapter);
  const canonical = canonicalizePath(projectRoot, path, fsAdapter);

  return readProvenanceBinding(canonical.realPath, bindingAdapter);
}

function prepareProvenanceWrite(currentBytes, stamp, baselineHash) {
  requireUtf8(currentBytes);
  if (isAppliedRetry(currentBytes, stamp, baselineHash)) {
    return { alreadyApplied: true, nextBytes: Buffer.from(currentBytes) };
  }
  const currentHash = completeFileHash(currentBytes);
  if (!/^[0-9a-f]{64}$/.test(baselineHash) || currentHash !== baselineHash) {
    staleBaseline(baselineHash, currentHash);
  }

  return { alreadyApplied: false, nextBytes: buildProvenanceBytes(currentBytes, stamp) };
}

function readProvenanceReplacement(fsAdapter, realPath, nextBytes) {
  const readbackBytes = adapterCall(fsAdapter, 'readFile', realPath);
  if (!Buffer.isBuffer(readbackBytes) || !readbackBytes.equals(nextBytes)) {
    throw new AgreementError('unexpected-adapter-failure', 'Atomic replacement readback did not match the intended complete bytes.', { operation: 'replaceFileAtomically', path: realPath, originalMessage: 'atomic replacement readback mismatch' });
  }

  return Buffer.from(readbackBytes);
}

function writeProvenanceStamp(input, options) {
  if (!exactOrderedKeys(input, ['projectRoot', 'path', 'stamp', 'baselineHash']) || !exactOrderedKeys(options, ['fsAdapter'])) {
    hardeningGrammar('Provenance input must use the closed ordered shape.');
  }
  const { projectRoot, path, stamp, baselineHash } = input;
  const { fsAdapter } = options;
  if (typeof projectRoot !== 'string' || projectRoot === '' || typeof stamp !== 'string' || provenanceKind(stamp) === null || typeof baselineHash !== 'string') {
    hardeningGrammar('Provenance input contains an invalid value.');
  }
  validateFsAdapter(fsAdapter, hardeningGrammar);
  const canonical = canonicalizePath(projectRoot, path, fsAdapter);
  const currentBytes = adapterCall(fsAdapter, 'readFile', canonical.realPath);
  const prepared = prepareProvenanceWrite(currentBytes, stamp, baselineHash);
  if (prepared.alreadyApplied) {
    return { bytes: Buffer.from(currentBytes), alreadyApplied: true };
  }
  replaceFile(fsAdapter, canonical.realPath, prepared.nextBytes);
  const readbackBytes = readProvenanceReplacement(fsAdapter, canonical.realPath, prepared.nextBytes);

  return { bytes: Buffer.from(readbackBytes), alreadyApplied: false };
}

function writeBoundProvenanceStamp(input, options) {
  if (!exactOrderedKeys(input, ['projectRoot', 'path', 'stamp', 'baselineHash', 'binding']) || !exactOrderedKeys(options, ['fsAdapter', 'bindingAdapter'])) {
    hardeningGrammar('Bound provenance input must use the closed ordered shape.');
  }
  const { projectRoot, path, stamp, baselineHash, binding } = input;
  const { fsAdapter, bindingAdapter } = options;
  if (typeof projectRoot !== 'string' || projectRoot === '' || typeof stamp !== 'string' || provenanceKind(stamp) === null || typeof baselineHash !== 'string') {
    hardeningGrammar('Bound provenance input contains an invalid value.');
  }
  validateProvenanceBinding(binding);
  validateFsAdapter(fsAdapter, hardeningGrammar);
  validateBindingAdapter(bindingAdapter);
  const canonical = canonicalizePath(projectRoot, path, fsAdapter);
  requireCurrentBinding(binding, readProvenanceBinding(canonical.realPath, bindingAdapter));
  const currentBytes = adapterCall(fsAdapter, 'readFile', canonical.realPath);
  requireCurrentBinding(binding, readProvenanceBinding(canonical.realPath, bindingAdapter));
  const prepared = prepareProvenanceWrite(currentBytes, stamp, baselineHash);
  if (prepared.alreadyApplied) {
    return { bytes: Buffer.from(currentBytes), alreadyApplied: true, binding };
  }
  requireCurrentBinding(binding, readProvenanceBinding(canonical.realPath, bindingAdapter));
  replaceFile(fsAdapter, canonical.realPath, prepared.nextBytes);
  const readbackBytes = readProvenanceReplacement(fsAdapter, canonical.realPath, prepared.nextBytes);
  const refreshedBinding = readProvenanceBinding(canonical.realPath, bindingAdapter);
  const confirmedBytes = adapterCall(fsAdapter, 'readFile', canonical.realPath);
  requireCurrentBinding(refreshedBinding, readProvenanceBinding(canonical.realPath, bindingAdapter));
  if (!Buffer.isBuffer(confirmedBytes) || !confirmedBytes.equals(readbackBytes)) {
    structural('The replacement binding changed during provenance readback.', { kind: 'stale-file-binding', path: canonical.realPath });
  }

  return { bytes: Buffer.from(confirmedBytes), alreadyApplied: false, binding: refreshedBinding };
}

function planStructural(message) {
  structural(message, { kind: 'plan-contract-grammar' });
}

function scopeStructural(message, kind = 'selector-shape') {
  structural(message, { kind });
}

function validateScopeRecord(scope, evidenceKind = 'plan-contract-grammar') {
  const fail = (message) => {
    if (evidenceKind === 'plan-contract-grammar') {
      planStructural(message);
    }
    scopeStructural(message, evidenceKind);
  };
  if (!exactOrderedKeys(scope, ['kind', 'path', 'selectors', 'workUnit'])) {
    fail('Governing scope must use the closed canonical shape.');
  }
  if (!['whole-file', 'sections', 'index-entry', 'bullet-entry'].includes(scope.kind) || !canonicalScopePath(scope.path)) {
    fail('Governing scope kind and path must be canonical.');
  }
  const selectorKind = scope.kind === 'whole-file' ? 'design-before-hardening' : scope.kind;
  try {
    validateSelectors(selectorKind, scope.selectors);
  } catch (error) {
    if (error instanceof AgreementError) {
      fail('Governing scope selectors must use the closed canonical shape.');
    }
    throw error;
  }
  if (scope.workUnit !== null && (!exactOrderedKeys(scope.workUnit, ['normalizedKey', 'declaration', 'state']) || typeof scope.workUnit.normalizedKey !== 'string' || scope.workUnit.normalizedKey === '' || typeof scope.workUnit.declaration !== 'string' || scope.workUnit.declaration === '' || !['unshipped', 'shipped'].includes(scope.workUnit.state))) {
    fail('Governing scope work unit must use the closed canonical shape.');
  }
}

function canonicalScopePath(path) {
  return relativePathShape(path).violation === null;
}

function markdownPathLabel(path) {
  return path.replace(/[\\\[\]]/g, '\\$&');
}

function markdownPathDestination(path) {
  return path.split('/').map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)).join('/');
}

function parseMarkdownLinkPrefix(raw) {
  const displayEnd = raw.indexOf(']');
  if (!raw.startsWith('[') || displayEnd < 0 || raw[displayEnd + 1] !== '(') {
    return null;
  }
  const display = raw.slice(1, displayEnd).trim();
  const targetStart = displayEnd + 2;
  let depth = 1;
  for (let index = targetStart; index < raw.length; index += 1) {
    if (raw[index] === '(') {
      depth += 1;
      continue;
    }
    if (raw[index] !== ')') {
      continue;
    }
    depth -= 1;
    if (depth === 0) {
      return { display, target: raw.slice(targetStart, index).trim(), suffix: raw.slice(index + 1) };
    }
  }

  return null;
}

function parseHeadingLink(heading) {
  const link = heading.startsWith('### ') ? parseMarkdownLinkPrefix(heading.slice('### '.length)) : null;

  return link !== null && link.suffix === '' ? link : null;
}

function singleScopeHeader(path) {
  return `**Spec:** [${markdownPathLabel(path)}](${markdownPathDestination(path)})`;
}

function selectorMatches(scope, sourceBuffer, scan = scanMarkdown) {
  const { lines } = scan(sourceBuffer);
  if (scope.kind === 'whole-file') {
    return true;
  }
  if (scope.kind === 'sections') {
    return resolveSectionSelectors(lines, scope.selectors, true);
  }
  try {
    resolveReadyEntry(lines, scope.kind, scope.selectors[0]);

    return true;
  } catch (error) {
    if (error instanceof AgreementError && error.evidence?.kind === 'selector-absence') {
      return false;
    }
    throw error;
  }
}

function ensureSelectorMatches(scope, sourceBuffer, scan = scanMarkdown) {
  if (!selectorMatches(scope, sourceBuffer, scan)) {
    scopeStructural('Scope selector does not resolve.', 'selector-absence');
  }
}

function registerRealTarget(registry, canonical) {
  const existing = registry.get(canonical.realPath);
  if (existing !== undefined && existing !== canonical.path) {
    structural('Two canonical paths resolve to the same real target.', { kind: 'alias-collision', paths: [existing, canonical.path] });
  }
  registry.set(canonical.realPath, canonical.path);
}

function validateScopeAgainstFile(scope, sourceBuffer, evidenceKind, scan = scanMarkdown) {
  try {
    ensureSelectorMatches(scope, sourceBuffer, scan);
  } catch (error) {
    if (error instanceof AgreementError && ['selector-absence', 'selector-ambiguity'].includes(error.evidence.kind) && evidenceKind === 'plan-contract-grammar') {
      planStructural('Governing scope selector does not resolve exactly.');
    }
    throw error;
  }
}

function validateFsAdapter(fsAdapter, fail) {
  const keys = ['readFile', 'readDirectory', 'realpath', 'replaceFileAtomically'];
  if (!exactOrderedKeys(fsAdapter, keys) || keys.some((key) => typeof fsAdapter[key] !== 'function')) {
    fail('Filesystem adapter must use the closed ordered shape.');
  }
}

const MAX_GOVERNING_NOMINATIONS = 128;

function createArtifactSnapshot(projectRoot, fsAdapter, realTargets = new Map()) {
  const canonicalByPath = new Map();
  const sourceByRealPath = new Map();

  return {
    canonicalize: (path) => {
      if (!canonicalByPath.has(path)) {
        const canonical = canonicalizePath(projectRoot, path, fsAdapter);
        registerRealTarget(realTargets, canonical);
        canonicalByPath.set(path, canonical);
      }

      return canonicalByPath.get(path);
    },
    read: (canonical) => {
      if (!sourceByRealPath.has(canonical.realPath)) {
        sourceByRealPath.set(canonical.realPath, adapterCall(fsAdapter, 'readFile', canonical.realPath));
      }

      return sourceByRealPath.get(canonical.realPath);
    },
  };
}

function parsePlanContractSyntax(planBuffer, scan = scanMarkdown) {
  const { lines } = scan(planBuffer);
  const governingSections = lines.filter((line) => line.outsideFence && line.heading?.level === 2 && line.heading.exactLine === '## Governing specs');
  if (governingSections.length !== 1) {
    planStructural('Plan must contain exactly one governing-spec declaration section.');
  }
  const section = governingSections[0];
  const sectionIndex = lines.indexOf(section);
  if (lines.some((line, index) => index < sectionIndex && line.outsideFence && line.heading?.level === 2)) {
    planStructural('Governing-spec declarations must precede every other level-two section.');
  }
  const headers = lines.filter((line) => line.outsideFence && /^\*\*Spec:\*\*/.test(line.content));
  if (headers.length !== 1 || lines.indexOf(headers[0]) >= sectionIndex) {
    planStructural('Plan must contain exactly one preceding Spec header.');
  }
  const nextSectionIndex = lines.findIndex((line, index) => index > sectionIndex && line.outsideFence && line.heading && line.heading.level <= 2);
  const sectionEnd = nextSectionIndex < 0 ? lines.length : nextSectionIndex;
  const declarations = lines.slice(sectionIndex + 1, sectionEnd).filter((line) => line.content.trim() !== '');
  let governingScopes;
  if (declarations.length === 1 && declarations[0].content === '- None.') {
    governingScopes = [];
  } else {
    if (declarations.length === 0 || declarations.some((line) => !line.content.startsWith('- Spec JSON: '))) {
      planStructural('Governing-spec declarations must be canonical physical lines.');
    }
    if (declarations.length > MAX_GOVERNING_NOMINATIONS) {
      planStructural('Plan contains too many governing-spec declarations.');
    }
    governingScopes = declarations.map((line) => {
      const rawJson = line.content.slice('- Spec JSON: '.length);
      let parsed;
      try {
        parsed = JSON.parse(rawJson);
      } catch {
        planStructural('Governing-spec declaration JSON is malformed.');
      }
      validateScopeRecord(parsed);
      if (JSON.stringify(parsed) !== rawJson) {
        planStructural('Governing-spec declaration JSON is not compact and canonical.');
      }

      return parsed;
    });
  }

  const expectedHeader = governingScopes.length === 0
    ? '**Spec:** none'
    : governingScopes.length === 1
      ? singleScopeHeader(governingScopes[0].path)
      : '**Spec:** multiple (see Governing specs)';
  if (headers[0].content !== expectedHeader) {
    planStructural('Spec header does not match governing-spec cardinality.');
  }

  return { header: headers[0].content, governingScopes };
}

function validatePlanContractArtifacts(contract, snapshot, scan = scanMarkdown) {
  for (const governingScope of contract.governingScopes) {
    const canonical = snapshot.canonicalize(governingScope.path);
    if (canonical.path !== governingScope.path) {
      planStructural('Governing-spec path is not canonical.');
    }
    validateScopeAgainstFile(governingScope, snapshot.read(canonical), 'plan-contract-grammar', scan);
  }

  return contract;
}

function parsePlanContract(input, options) {
  if (!exactOrderedKeys(input, ['planBuffer', 'projectRoot']) || !exactOrderedKeys(options, ['fsAdapter'])) {
    planStructural('Plan parser input must use the closed ordered shape.');
  }
  const { planBuffer, projectRoot } = input;
  const { fsAdapter } = options;
  validateFsAdapter(fsAdapter, planStructural);
  const scan = createMarkdownScanner();
  const contract = parsePlanContractSyntax(planBuffer, scan);
  const snapshot = createArtifactSnapshot(projectRoot, fsAdapter);

  return validatePlanContractArtifacts(contract, snapshot, scan);
}

function serializePlanContract(input) {
  if (!exactOrderedKeys(input, ['planBody', 'governingScopes'])) {
    planStructural('Plan serialization input must use the closed ordered shape.');
  }
  const { planBody, governingScopes } = input;
  if (!Buffer.isBuffer(planBody) || !Array.isArray(governingScopes)) {
    planStructural('Plan serialization input must use the closed shape.');
  }
  if (governingScopes.length > MAX_GOVERNING_NOMINATIONS) {
    planStructural('Plan contains too many governing-spec declarations.');
  }
  const { lines } = scanMarkdown(planBody);
  if (lines.some((line) => line.outsideFence && ((line.heading?.level === 2 && line.heading.exactLine === '## Governing specs') || /^\*\*Spec:\*\*/.test(line.content)))) {
    planStructural('Plan body already contains a governing-spec contract.');
  }
  for (const governingScope of governingScopes) {
    validateScopeRecord(governingScope);
    if (!canonicalScopePath(governingScope.path)) {
      planStructural('Serialized governing path must be canonical.');
    }
  }
  const header = governingScopes.length === 0
    ? '**Spec:** none'
    : governingScopes.length === 1
      ? singleScopeHeader(governingScopes[0].path)
      : '**Spec:** multiple (see Governing specs)';
  const declarations = governingScopes.length === 0 ? '- None.' : governingScopes.map((governingScope) => `- Spec JSON: ${JSON.stringify(governingScope)}`).join('\n');
  const contract = Buffer.from(`${header}\n\n## Governing specs\n\n${declarations}\n\n`, 'utf8');
  const firstSection = lines.find((line) => line.outsideFence && line.heading?.level === 2);
  const insertion = firstSection?.rawStart ?? planBody.length;
  const before = planBody.subarray(0, insertion);
  const after = planBody.subarray(insertion);
  const beforeText = before.toString('utf8');
  const separator = before.length === 0 || beforeText.endsWith('\n\n') || beforeText.endsWith('\r\n\r\n')
    ? Buffer.alloc(0)
    : Buffer.from(beforeText.endsWith('\n') || beforeText.endsWith('\r') ? '\n' : '\n\n');

  return Buffer.concat([before, separator, contract, after]);
}

function readyCall(readyParser, operation, ...args) {
  try {
    return readyParser[operation](...args);
  } catch (thrown) {
    throw new AgreementError('unexpected-adapter-failure', 'Ready parser adapter failed.', { operation: `readyParser.${operation}`, originalMessage: thrownMessage(thrown) });
  }
}

function validateReadyParser(readyParser, fail) {
  if (!exactOrderedKeys(readyParser, ['normalizeSliceName', 'parseSlices', 'findSlicesByNormalizedName'])) {
    fail('Ready parser adapter must use the closed ordered shape.');
  }
  for (const operation of ['normalizeSliceName', 'parseSlices', 'findSlicesByNormalizedName']) {
    if (typeof readyParser?.[operation] !== 'function') {
      fail('Ready parser adapter must provide every required function.');
    }
  }
}

function resolveWorkUnit(scope, sourceBuffer, request, readyParser, declarationScope = scope, scan = scanMarkdown) {
  if (scope.workUnit === null) {
    return scope;
  }
  const declarationBuffer = ['index-entry', 'bullet-entry'].includes(declarationScope.kind)
    ? selectArtifact({ path: declarationScope.path, selectorKind: declarationScope.kind, selectors: declarationScope.selectors, sourceBuffer }, scan).selectedBytes
    : sourceBuffer;
  const bodyLines = decode(declarationBuffer).split(/\r\n|\r|\n/);
  const slices = readyCall(readyParser, 'parseSlices', bodyLines);
  if (!Array.isArray(slices)) {
    scopeStructural('Selected work unit has no slice declarations.', 'selector-absence');
  }
  const matches = slices.filter((slice) => slice.name === scope.workUnit.normalizedKey);
  if (!Array.isArray(matches) || matches.length === 0) {
    scopeStructural('Selected work unit does not resolve.', 'selector-absence');
  }
  const declarationCounts = new Map();
  for (const match of matches) {
    declarationCounts.set(match.declaration, (declarationCounts.get(match.declaration) ?? 0) + 1);
  }
  if ([...declarationCounts.values()].some((count) => count > 1)) {
    throw new AgreementError('duplicate-slice-declaration', 'Duplicate slice declarations cannot be distinguished.', { declarations: matches.map((match) => match.declaration) });
  }
  const scopeSelection = matches.find((match) => match.declaration === scope.workUnit.declaration);
  const requestedSelection = request.selectedSliceDeclaration === null ? undefined : matches.find((match) => match.declaration === request.selectedSliceDeclaration);
  if (request.selectedSliceDeclaration !== null && requestedSelection === undefined) {
    throw new AgreementError('ambiguous-slice-selection', 'The supplied slice selection does not identify one exact declaration.', { declarations: matches.map((match) => match.declaration) });
  }
  const selected = requestedSelection ?? scopeSelection;
  if (selected === undefined && matches.length > 1) {
    return { kind: 'slice-selection-required', declarations: matches.map((match) => match.declaration) };
  }
  const chosen = selected ?? matches[0];
  const canonicalKey = readyCall(readyParser, 'normalizeSliceName', chosen.displayName);

  return { kind: scope.kind, path: scope.path, selectors: scope.selectors, workUnit: { normalizedKey: canonicalKey, declaration: chosen.declaration, state: chosen.struck ? 'shipped' : 'unshipped' } };
}

function scopeOrderKey(scope) {
  return `${scope.path}\u0000${JSON.stringify(scope.selectors)}`;
}

function ordinalCompare(left, right) {
  const leftKey = scopeOrderKey(left);
  const rightKey = scopeOrderKey(right);

  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function deduplicateScopes(scopes) {
  const seen = new Set();

  return scopes.filter((scope) => {
    const key = JSON.stringify(scope);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function selectorKindForScope(scope) {
  return ['whole-file', 'sections'].includes(scope.kind) ? 'design-before-hardening' : scope.kind;
}

function artifactSelectorsForScope(scope) {
  return ['whole-file', 'sections'].includes(scope.kind) ? [] : scope.selectors;
}

function companionFor(scope, snapshot, scan = scanMarkdown) {
  const match = /^\.claude\/(features|bugs)\/[^/]+\.md$/.exec(scope.path);
  if (!match || !['whole-file', 'sections'].includes(scope.kind)) {
    return null;
  }
  const indexPath = match[1] === 'features' ? '.claude/FEATURES.md' : '.claude/BUGS.md';
  const canonical = snapshot.canonicalize(indexPath);
  const sourceBuffer = snapshot.read(canonical);
  const lines = scan(sourceBuffer).lines;
  let parentHeading = null;
  const matches = [];
  for (const line of lines) {
    if (isReadyBacklogHeading(line, 2)) {
      parentHeading = line.content;
      continue;
    }
    if (!isReadyBacklogHeading(line, 3) || parentHeading === null) {
      continue;
    }
    const link = parseHeadingLink(line.content);
    const fileTarget = link?.target.split('#')[0];
    if (fileTarget && canonicalScopePath(fileTarget) && `.claude/${fileTarget}` === scope.path) {
      matches.push({ parentHeading, entryHeading: line.content });
    }
  }
  if (matches.length === 0) {
    scopeStructural('Breakout artifact has no exact index companion.', 'selector-absence');
  }
  if (matches.length > 1) {
    scopeStructural('Breakout artifact has multiple index companions.', 'selector-ambiguity');
  }

  return { scope: { kind: 'index-entry', path: indexPath, selectors: [matches[0]], workUnit: null }, sourceBuffer };
}

function frontmatterIsExploring(sourceBuffer) {
  const normalized = decode(sourceBuffer).replace(/^\uFEFF/, '').replace(/\r\n|\r/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return false;
  }
  const end = normalized.indexOf('\n---\n', 4);
  if (end < 0) {
    return false;
  }

  return normalized.slice(4, end).split('\n').some((line) => /^status:[ \t]*exploring[ \t]*$/.test(line));
}

function titleForScope(scope) {
  if (scope.kind === 'index-entry') {
    const heading = scope.selectors[0].entryHeading;
    const linked = parseHeadingLink(heading);

    return linked ? linked.display : heading.replace(/^### /, '');
  }

  return scope.selectors[0].entryTitle;
}

function archivePathFor(path) {
  const match = /^\.claude\/(FEATURES|BUGS|QUICK_WINS)\.md$/.exec(path);

  return match ? `.claude/${match[1]}_HISTORY.md` : null;
}

function archiveDeclarationForLine(archivePath, line, plainFeatureTitle = null) {
  if (!line.outsideFence || !line.topLevelBullet) {
    return null;
  }
  if (archivePath === '.claude/FEATURES_HISTORY.md') {
    const linked = line.content.startsWith('- ') ? parseMarkdownLinkPrefix(line.content.slice(2)) : null;
    if (linked && (linked.suffix === ':' || /^:[ \t]/.test(linked.suffix))) {
      return { declaration: line.content, label: linked.display };
    }
    if (plainFeatureTitle === null) {
      return null;
    }
    const prefix = `- ${plainFeatureTitle}:`;
    const suffix = line.content.startsWith(prefix) ? line.content.slice(prefix.length) : null;

    return suffix !== null && (suffix === '' || /^[ \t]/.test(suffix))
      ? { declaration: line.content, label: plainFeatureTitle }
      : null;
  }
  const match = /^- \*\*(.+?)\*\*(?::|[ \t]|$)/.exec(line.content);

  return match ? { declaration: line.content, label: match[1] } : null;
}

function completionFor(target, request, readyParser, snapshot, scan = scanMarkdown) {
  if (request.mode !== 'handover' || !request.allowCompletedNoOp || !['index-entry', 'bullet-entry'].includes(target.kind)) {
    return null;
  }
  const activeBuffer = snapshot.read(snapshot.canonicalize(target.path));
  if (selectorMatches(target, activeBuffer, scan)) {
    return null;
  }
  const archivePath = archivePathFor(target.path);
  if (archivePath === null) {
    return null;
  }
  const canonicalArchive = snapshot.canonicalize(archivePath);
  const archiveBuffer = snapshot.read(canonicalArchive);
  const title = titleForScope(target);
  const plainFeatureTitle = target.workUnit === null ? title : null;
  const declarations = scan(archiveBuffer).lines.map((line) => archiveDeclarationForLine(archivePath, line, plainFeatureTitle)).filter((entry) => entry !== null);
  if (target.workUnit === null) {
    const matches = declarations.filter((entry) => entry.label === title);

    return matches.length === 1 ? { target, archivePath, matchedDeclaration: null } : null;
  }
  const parsed = readyCall(readyParser, 'parseSlices', ['**Slices:**', target.workUnit.declaration]);
  if (!Array.isArray(parsed) || parsed.length !== 1 || parsed[0].declaration !== target.workUnit.declaration) {
    return null;
  }
  const normalizedKey = readyCall(readyParser, 'normalizeSliceName', parsed[0].displayName);
  const state = parsed[0].struck ? 'shipped' : 'unshipped';
  if (normalizedKey !== target.workUnit.normalizedKey || state !== target.workUnit.state) {
    return null;
  }
  const exactLabel = `${title}: ${parsed[0].displayName}`;
  const matches = declarations.filter((entry) => entry.label === exactLabel);

  return matches.length === 1 ? { target, archivePath, matchedDeclaration: matches[0].declaration } : null;
}

const AGREEMENT_REQUEST_KEYS = ['mode', 'projectRoot', 'target', 'seeds', 'planBuffer', 'selectedSliceDeclaration', 'allowSpecLess', 'allowCompletedNoOp'];
const AGREEMENT_REQUEST_MODES = ['handover', 'lifecycle', 'revise-spec', 'revise-plan', 'revise-code', 'planning', 'final-presentation'];

function validateAgreementRequest(request, fail) {
  if (!exactOrderedKeys(request, AGREEMENT_REQUEST_KEYS)
    || !AGREEMENT_REQUEST_MODES.includes(request.mode)
    || typeof request.projectRoot !== 'string'
    || !Array.isArray(request.seeds)
    || (request.planBuffer !== null && !Buffer.isBuffer(request.planBuffer))
    || (request.selectedSliceDeclaration !== null && typeof request.selectedSliceDeclaration !== 'string')
    || typeof request.allowSpecLess !== 'boolean'
    || typeof request.allowCompletedNoOp !== 'boolean') {
    fail('Agreement request must use the closed ordered shape.');
  }
  if (request.allowCompletedNoOp && request.mode !== 'handover') {
    fail('Only handover may request the completion no-op.');
  }
  if (request.seeds.length > MAX_GOVERNING_NOMINATIONS) {
    fail('Agreement request contains too many governing nominations.');
  }
  if (request.target !== null) {
    validateScopeRecord(request.target, 'selector-shape');
  }
  for (const seed of request.seeds) {
    validateScopeRecord(seed, 'selector-shape');
  }
}

function resolveGoverningSet(request, options) {
  if (!exactOrderedKeys(options, ['fsAdapter', 'readyParser'])) {
    scopeStructural('Resolver input must use the closed ordered shape.');
  }
  const { fsAdapter, readyParser } = options;
  validateAgreementRequest(request, scopeStructural);
  validateFsAdapter(fsAdapter, scopeStructural);
  validateReadyParser(readyParser, scopeStructural);
  const scan = createMarkdownScanner();
  let planSeeds = [];
  let primarySeeds = request.seeds.slice(0, 1);
  let coGoverningSeeds = request.seeds.slice(1);
  if (request.mode === 'revise-plan') {
    if (request.planBuffer === null) {
      planStructural('revise-plan requires the actual plan bytes.');
    }
    planSeeds = parsePlanContractSyntax(request.planBuffer, scan).governingScopes;
    primarySeeds = [];
    coGoverningSeeds = request.seeds.slice();
  } else if (request.mode === 'revise-code' && request.planBuffer !== null) {
    planSeeds = parsePlanContractSyntax(request.planBuffer, scan).governingScopes;
  }
  const nominations = [
    ...primarySeeds.map((scope) => ({ scope, evidenceKind: 'selector-shape' })),
    ...planSeeds.map((scope) => ({ scope, evidenceKind: 'plan-contract-grammar' })),
    ...coGoverningSeeds.sort(ordinalCompare).map((scope) => ({ scope, evidenceKind: 'selector-shape' })),
  ];
  if (nominations.length > MAX_GOVERNING_NOMINATIONS) {
    scopeStructural('Combined governing nominations exceed the supported limit.');
  }
  const snapshot = createArtifactSnapshot(request.projectRoot, fsAdapter);
  const companionCache = new Map();
  const canonicalizeScope = (nominatedScope) => {
    const canonical = snapshot.canonicalize(nominatedScope.path);

    return { scope: { kind: nominatedScope.kind, path: canonical.path, selectors: nominatedScope.selectors, workUnit: nominatedScope.workUnit }, canonical };
  };
  const getCompanion = (governingScope) => {
    if (!companionCache.has(governingScope.path)) {
      companionCache.set(governingScope.path, companionFor(governingScope, snapshot, scan));
    }

    return companionCache.get(governingScope.path);
  };
  const resolveScopeWorkUnit = (governingScope, sourceBuffer) => {
    if (governingScope.workUnit === null) {
      return governingScope;
    }
    const companion = getCompanion(governingScope);

    return companion === null
      ? resolveWorkUnit(governingScope, sourceBuffer, request, readyParser, governingScope, scan)
      : resolveWorkUnit(governingScope, companion.sourceBuffer, request, readyParser, companion.scope, scan);
  };
  const resolvedScopeCache = new Map();
  const resolveCanonicalRecord = (record) => {
    const key = JSON.stringify(record.scope);
    if (!resolvedScopeCache.has(key)) {
      const sourceBuffer = snapshot.read(record.canonical);
      if (record.evidenceKind === 'plan-contract-grammar') {
        validateScopeAgainstFile(record.scope, sourceBuffer, record.evidenceKind, scan);
      } else {
        ensureSelectorMatches(record.scope, sourceBuffer, scan);
      }
      resolvedScopeCache.set(key, resolveScopeWorkUnit(record.scope, sourceBuffer));
    }

    return resolvedScopeCache.get(key);
  };
  let canonicalTarget = null;
  let targetRecord = null;
  if (request.target !== null) {
    targetRecord = { ...canonicalizeScope(request.target), evidenceKind: 'selector-shape' };
    canonicalTarget = targetRecord.scope;
    const completion = completionFor(canonicalTarget, request, readyParser, snapshot, scan);
    if (completion !== null) {
      return { kind: 'completed-no-op', evidence: completion };
    }
  }
  if (nominations.length === 0) {
    return request.allowSpecLess
      ? { kind: 'not-applicable', target: null, governingScopes: [], artifacts: [] }
      : { kind: 'brainstorming-required', artifacts: [], unfinished: { artifacts: [] } };
  }
  const resolvedScopes = [];
  const canonicalSeedRecords = [];
  const canonicalRecordByScope = new Map();
  for (const nomination of nominations) {
    validateScopeRecord(nomination.scope, nomination.evidenceKind);
    const canonicalRecord = { ...canonicalizeScope(nomination.scope), evidenceKind: nomination.evidenceKind };
    if (nomination.evidenceKind === 'plan-contract-grammar' && canonicalRecord.canonical.path !== nomination.scope.path) {
      planStructural('Governing-spec path is not canonical.');
    }
    const key = JSON.stringify(canonicalRecord.scope);
    const prior = canonicalRecordByScope.get(key);
    if (prior !== undefined) {
      if (nomination.evidenceKind === 'plan-contract-grammar') {
        prior.evidenceKind = nomination.evidenceKind;
      }
      continue;
    }
    canonicalRecordByScope.set(key, canonicalRecord);
    canonicalSeedRecords.push(canonicalRecord);
  }
  for (const canonicalRecord of canonicalSeedRecords) {
    const resolved = resolveCanonicalRecord(canonicalRecord);
    if (resolved.kind === 'slice-selection-required') {
      return resolved;
    }
    resolvedScopes.push(resolved);
  }
  const governingScopes = deduplicateScopes(resolvedScopes);
  if (canonicalTarget !== null) {
    const resolvedTarget = resolveCanonicalRecord(targetRecord);
    if (resolvedTarget.kind === 'slice-selection-required') {
      return resolvedTarget;
    }
    const matchingScope = governingScopes.find((governingScope) => JSON.stringify(governingScope) === JSON.stringify(resolvedTarget));
    if (matchingScope !== undefined) {
      canonicalTarget = matchingScope;
    } else {
      canonicalTarget = resolvedTarget;
    }
  }
  const artifacts = [];
  const artifactKeys = new Set();
  const addArtifact = (artifactScope, sourceProvider) => {
    const selectorKind = selectorKindForScope(artifactScope);
    const selectors = artifactSelectorsForScope(artifactScope);
    const key = JSON.stringify([artifactScope.path, selectorKind, selectors]);
    if (artifactKeys.has(key)) {
      return;
    }
    const sourceBuffer = sourceProvider();
    ensureSelectorMatches(artifactScope, sourceBuffer, scan);
    artifactKeys.add(key);
    artifacts.push({ path: artifactScope.path, selectorKind, selectors, sourceBuffer });
  };
  for (const governingScope of governingScopes) {
    addArtifact(governingScope, () => snapshot.read(snapshot.canonicalize(governingScope.path)));
    const companion = getCompanion(governingScope);
    if (companion !== null) {
      addArtifact(companion.scope, () => companion.sourceBuffer);
    }
  }
  const unfinishedByPath = new Map();
  for (const artifact of artifacts) {
    const signals = unfinishedByPath.get(artifact.path) ?? [];
    if (frontmatterIsExploring(artifact.sourceBuffer) && !signals.includes('frontmatter')) {
      signals.push('frontmatter');
    }
    if (artifact.selectorKind === 'index-entry' && artifact.selectors[0].parentHeading === '## Exploring' && !signals.includes('index')) {
      signals.push('index');
    }
    if (signals.length > 0) {
      unfinishedByPath.set(artifact.path, signals);
    }
  }
  if (unfinishedByPath.size > 0) {
    return { kind: 'brainstorming-required', artifacts, unfinished: { artifacts: [...unfinishedByPath].map(([path, signals]) => ({ path, signals })) } };
  }

  return { kind: 'resolved', target: canonicalTarget, governingScopes, artifacts };
}

const AGREEMENT_VERSION = 1;
const ARTIFACT_SELECTOR_KINDS = Object.freeze(['design-before-hardening', 'index-entry', 'bullet-entry']);

function candidateStructural(message) {
  structural(message, { kind: 'selector-shape' });
}

function jsonEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function hasDuplicateJson(records, project = (record) => record) {
  const keys = records.map((record) => JSON.stringify(project(record)));

  return new Set(keys).size !== keys.length;
}

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || Buffer.isBuffer(value) || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const child of Object.values(value)) {
    deepFreeze(child, seen);
  }

  return Object.freeze(value);
}

function cloneAndFreezeJson(value) {
  return deepFreeze(JSON.parse(JSON.stringify(value)));
}

function immutableCurrentSource(source) {
  const selectedBytes = Buffer.from(source.selectedBytes);
  const sourceSpans = source.sourceSpans.map((span) => Buffer.from(span));
  const immutableSource = {};
  Object.defineProperties(immutableSource, {
    path: { enumerable: true, value: source.path },
    selectorKind: { enumerable: true, value: source.selectorKind },
    selectors: { enumerable: true, value: cloneAndFreezeJson(source.selectors) },
    selectedBytes: { enumerable: true, get: () => Buffer.from(selectedBytes) },
    sourceSpans: { enumerable: true, get: () => sourceSpans.map((span) => Buffer.from(span)) },
    sourceRanges: { enumerable: true, value: cloneAndFreezeJson(source.sourceRanges) },
  });

  return Object.freeze(immutableSource);
}

function immutableSessionState(input) {
  const agreementRecord = Object.freeze({
    acceptedDigest: input.acceptedDigest,
    acceptedCandidate: cloneAndFreezeJson(input.acceptedCandidate),
    currentCandidate: cloneAndFreezeJson(input.currentCandidate),
    currentSources: Object.freeze(input.currentSources.map(immutableCurrentSource)),
  });

  return Object.freeze({
    agreementRecord,
    fitEvidence: input.fitEvidence === null ? null : cloneAndFreezeJson(input.fitEvidence),
  });
}

function lowercaseHash(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function validateCandidateArtifact(artifact) {
  if (!exactOrderedKeys(artifact, ['path', 'selectorKind', 'selectors', 'contentHash', 'sourceHash']) || !canonicalScopePath(artifact.path) || !ARTIFACT_SELECTOR_KINDS.includes(artifact.selectorKind) || !lowercaseHash(artifact.contentHash) || !lowercaseHash(artifact.sourceHash)) {
    candidateStructural('Candidate artifact must use the closed canonical shape.');
  }
  try {
    validateSelectors(artifact.selectorKind, artifact.selectors);
  } catch (error) {
    if (error instanceof AgreementError) {
      candidateStructural('Candidate artifact selectors must use the closed canonical shape.');
    }
    throw error;
  }
}

function validateCandidate(candidate) {
  if (!exactOrderedKeys(candidate, ['version', 'target', 'governingScopes', 'artifacts']) || candidate.version !== AGREEMENT_VERSION || !Array.isArray(candidate.governingScopes) || candidate.governingScopes.length === 0 || !Array.isArray(candidate.artifacts) || candidate.artifacts.length === 0) {
    candidateStructural('Candidate must use the closed canonical shape.');
  }
  validateScopeRecord(candidate.target, 'selector-shape');
  for (const governingScope of candidate.governingScopes) {
    validateScopeRecord(governingScope, 'selector-shape');
  }
  for (const artifact of candidate.artifacts) {
    validateCandidateArtifact(artifact);
  }
  if (hasDuplicateJson(candidate.governingScopes) || hasDuplicateJson(candidate.artifacts, (artifact) => ({ path: artifact.path, selectorKind: artifact.selectorKind, selectors: artifact.selectors }))) {
    candidateStructural('Candidate scope and artifact identities must be unique.');
  }
}

function validateRange(range) {
  return exactOrderedKeys(range, ['start', 'end']) && Number.isSafeInteger(range.start) && Number.isSafeInteger(range.end) && range.start >= 0 && range.end >= range.start;
}

function validateCurrentSource(source) {
  if (!exactOrderedKeys(source, ['path', 'selectorKind', 'selectors', 'selectedBytes', 'sourceSpans', 'sourceRanges']) || !canonicalScopePath(source.path) || !ARTIFACT_SELECTOR_KINDS.includes(source.selectorKind) || !Buffer.isBuffer(source.selectedBytes) || !Array.isArray(source.sourceSpans) || !Array.isArray(source.sourceRanges) || source.sourceSpans.length !== source.sourceRanges.length || !source.sourceSpans.every(Buffer.isBuffer) || !source.sourceRanges.every(validateRange)) {
    candidateStructural('Current source must use the closed canonical shape.');
  }
  requireUtf8(source.selectedBytes);
  for (const [index, sourceSpan] of source.sourceSpans.entries()) {
    requireUtf8(sourceSpan);
    if (source.sourceRanges[index].end - source.sourceRanges[index].start !== sourceSpan.length) {
      candidateStructural('Current source ranges must own their exact raw spans.');
    }
  }
  try {
    validateSelectors(source.selectorKind, source.selectors);
  } catch (error) {
    if (error instanceof AgreementError) {
      candidateStructural('Current source selectors must use the closed canonical shape.');
    }
    throw error;
  }
}

function validateCandidateSources(candidate, currentSources) {
  validateCandidate(candidate);
  if (!Array.isArray(currentSources) || currentSources.length !== candidate.artifacts.length) {
    candidateStructural('Current sources must match candidate artifact membership and order.');
  }
  for (const [index, source] of currentSources.entries()) {
    validateCurrentSource(source);
    const artifact = candidate.artifacts[index];
    if (source.path !== artifact.path || source.selectorKind !== artifact.selectorKind || !jsonEqual(source.selectors, artifact.selectors)) {
      candidateStructural('Current sources must match candidate artifact membership and order.');
    }
    const hashed = hashSelection(source);
    if (hashed.contentHash !== artifact.contentHash || hashed.sourceHash !== artifact.sourceHash) {
      candidateStructural('Current source bytes do not match candidate hashes.');
    }
  }
}

function currentSourcesEqual(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }

  return left.every((source, index) => {
    const other = right[index];

    return source.path === other.path
      && source.selectorKind === other.selectorKind
      && jsonEqual(source.selectors, other.selectors)
      && source.selectedBytes.equals(other.selectedBytes)
      && sameBuffers(source.sourceSpans, other.sourceSpans)
      && jsonEqual(source.sourceRanges, other.sourceRanges);
  });
}

function validateCandidateResolution(candidate, resolution) {
  validateCandidate(candidate);
  validateScopeRecord(resolution.target, 'selector-shape');
  if (!Array.isArray(resolution.governingScopes) || resolution.governingScopes.length === 0 || !Array.isArray(resolution.artifacts) || resolution.artifacts.length !== candidate.artifacts.length) {
    candidateStructural('Candidate must match resolved artifact membership and order.');
  }
  for (const governingScope of resolution.governingScopes) {
    validateScopeRecord(governingScope, 'selector-shape');
  }
  if (!jsonEqual(candidate.target, resolution.target) || !jsonEqual(candidate.governingScopes, resolution.governingScopes)) {
    candidateStructural('Candidate must match the resolved target and governing scopes.');
  }
  for (const [index, artifact] of resolution.artifacts.entries()) {
    if (!validArtifactSnapshot(artifact)) {
      candidateStructural('Resolved artifact must use the closed canonical shape.');
    }
    const candidateArtifact = candidate.artifacts[index];
    if (artifact.path !== candidateArtifact.path || artifact.selectorKind !== candidateArtifact.selectorKind || !jsonEqual(artifact.selectors, candidateArtifact.selectors)) {
      candidateStructural('Candidate must match resolved artifact membership and order.');
    }
    const currentSelection = hashSelection(selectArtifact(artifact));
    if (currentSelection.contentHash !== candidateArtifact.contentHash || currentSelection.sourceHash !== candidateArtifact.sourceHash) {
      candidateStructural('Candidate hashes must match the resolved artifact bytes.');
    }
  }
}

function validateHashedSelection(selectionRecord) {
  if (!exactOrderedKeys(selectionRecord, ['path', 'selectorKind', 'selectors', 'selectedBytes', 'sourceSpans', 'sourceRanges', 'contentHash', 'sourceHash'])) {
    candidateStructural('Hashed selection must use the closed canonical shape.');
  }
  validateCurrentSource({
    path: selectionRecord.path,
    selectorKind: selectionRecord.selectorKind,
    selectors: selectionRecord.selectors,
    selectedBytes: selectionRecord.selectedBytes,
    sourceSpans: selectionRecord.sourceSpans,
    sourceRanges: selectionRecord.sourceRanges,
  });
  if (!lowercaseHash(selectionRecord.contentHash) || !lowercaseHash(selectionRecord.sourceHash)) {
    candidateStructural('Hashed selection must carry full lowercase hashes.');
  }
}

function sameBuffers(left, right) {
  return left.length === right.length && left.every((buffer, index) => buffer.equals(right[index]));
}

function buildCandidate(input) {
  if (!exactOrderedKeys(input, ['resolution', 'selections'])) {
    candidateStructural('Candidate input must use the closed ordered shape.');
  }
  const { resolution, selections } = input;
  if (!exactOrderedKeys(resolution, ['kind', 'target', 'governingScopes', 'artifacts']) || resolution.kind !== 'resolved' || !Array.isArray(resolution.artifacts) || !Array.isArray(selections) || selections.length !== resolution.artifacts.length) {
    candidateStructural('Candidate construction requires one resolved artifact set.');
  }
  validateScopeRecord(resolution.target, 'selector-shape');
  if (!Array.isArray(resolution.governingScopes) || resolution.governingScopes.length === 0) {
    candidateStructural('Candidate construction requires governing scopes.');
  }
  for (const governingScope of resolution.governingScopes) {
    validateScopeRecord(governingScope, 'selector-shape');
  }
  const artifacts = [];
  const currentSources = [];
  for (const [index, selectionRecord] of selections.entries()) {
    validateHashedSelection(selectionRecord);
    const artifact = resolution.artifacts[index];
    if (!validArtifactSnapshot(artifact) || artifact.path !== selectionRecord.path || artifact.selectorKind !== selectionRecord.selectorKind || !jsonEqual(artifact.selectors, selectionRecord.selectors)) {
      candidateStructural('Selection does not match resolved artifact membership and order.');
    }
    const recomputed = hashSelection(selectArtifact(artifact));
    if (!recomputed.selectedBytes.equals(selectionRecord.selectedBytes) || !sameBuffers(recomputed.sourceSpans, selectionRecord.sourceSpans) || !jsonEqual(recomputed.sourceRanges, selectionRecord.sourceRanges) || recomputed.contentHash !== selectionRecord.contentHash || recomputed.sourceHash !== selectionRecord.sourceHash) {
      candidateStructural('Selection no longer matches its resolved source baseline.');
    }
    artifacts.push({
      path: selectionRecord.path,
      selectorKind: selectionRecord.selectorKind,
      selectors: selectionRecord.selectors,
      contentHash: selectionRecord.contentHash,
      sourceHash: selectionRecord.sourceHash,
    });
    currentSources.push({
      path: selectionRecord.path,
      selectorKind: selectionRecord.selectorKind,
      selectors: selectionRecord.selectors,
      selectedBytes: selectionRecord.selectedBytes,
      sourceSpans: selectionRecord.sourceSpans,
      sourceRanges: selectionRecord.sourceRanges,
    });
  }
  const candidate = { version: AGREEMENT_VERSION, target: resolution.target, governingScopes: resolution.governingScopes, artifacts };
  validateCandidateSources(candidate, currentSources);

  return { candidate, currentSources };
}

function candidateToken(candidate) {
  validateCandidate(candidate);

  return `a-${createHash('sha256').update(JSON.stringify(candidate), 'utf8').digest('hex').slice(0, 12)}`;
}

function artifactProjection(artifact) {
  return { path: artifact.path, selectorKind: artifact.selectorKind, selectors: artifact.selectors };
}

function compareCandidates(input) {
  if (!exactOrderedKeys(input, ['previousCandidate', 'currentCandidate'])) {
    candidateStructural('Candidate comparison input must use the closed ordered shape.');
  }
  const { previousCandidate, currentCandidate } = input;
  validateCandidate(previousCandidate);
  validateCandidate(currentCandidate);
  const evidence = [];
  if (!jsonEqual(previousCandidate.target, currentCandidate.target)) {
    evidence.push({ kind: 'candidate', candidateField: 'target' });
  }
  if (!jsonEqual(previousCandidate.governingScopes, currentCandidate.governingScopes)) {
    evidence.push({ kind: 'candidate', candidateField: 'governingScopes' });
  }
  if (!jsonEqual(previousCandidate.artifacts.map(artifactProjection), currentCandidate.artifacts.map(artifactProjection))) {
    evidence.push({ kind: 'candidate', candidateField: 'artifacts' });
  }
  if (evidence.length > 0) {
    return { kind: 'structural-change', evidence };
  }

  return jsonEqual(previousCandidate, currentCandidate)
    ? { kind: 'equal', evidence: [] }
    : { kind: 'source-change', evidence: [] };
}

function linesWithTerminators(text) {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

function sharedEdgeLengths(left, right) {
  let prefix = 0;
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (suffix < left.length - prefix && suffix < right.length - prefix && left[left.length - suffix - 1] === right[right.length - suffix - 1]) {
    suffix += 1;
  }

  return { prefix, suffix };
}

const MAX_DERIVED_DIFF_LCS_AREA = 4_000_000;

function reserveLcsArea(budget, leftLength, rightLength) {
  if (leftLength <= 1 || rightLength <= 1) {
    return true;
  }
  if (leftLength > Math.floor(budget.remainingArea / rightLength)) {
    return false;
  }
  budget.remainingArea -= leftLength * rightLength;

  return true;
}

function lcsPrefixLengths(left, right) {
  const lengths = new Uint32Array(right.length + 1);
  for (const leftLine of left) {
    let diagonal = 0;
    for (let index = 1; index <= right.length; index += 1) {
      const previous = lengths[index];
      if (leftLine === right[index - 1]) {
        lengths[index] = diagonal + 1;
      } else if (lengths[index - 1] > lengths[index]) {
        lengths[index] = lengths[index - 1];
      }
      diagonal = previous;
    }
  }

  return lengths;
}

function appendMappedEdits(edits, lines, kind) {
  for (const text of lines) {
    edits.push({ kind, text });
  }
}

function appendShortestEdits(left, right, edits) {
  if (left.length === 0) {
    appendMappedEdits(edits, right, 'insert');

    return;
  }
  if (right.length === 0) {
    appendMappedEdits(edits, left, 'delete');

    return;
  }
  if (left.length === 1) {
    const match = right.indexOf(left[0]);
    if (match < 0) {
      edits.push({ kind: 'delete', text: left[0] });
      appendMappedEdits(edits, right, 'insert');

      return;
    }
    appendMappedEdits(edits, right.slice(0, match), 'insert');
    edits.push({ kind: 'equal', text: left[0] });
    appendMappedEdits(edits, right.slice(match + 1), 'insert');

    return;
  }

  const midpoint = Math.floor(left.length / 2);
  const forward = lcsPrefixLengths(left.slice(0, midpoint), right);
  const backward = lcsPrefixLengths(left.slice(midpoint).reverse(), [...right].reverse());
  let split = 0;
  let best = -1;
  for (let index = 0; index <= right.length; index += 1) {
    const score = forward[index] + backward[right.length - index];
    if (score > best) {
      best = score;
      split = index;
    }
  }
  appendShortestEdits(left.slice(0, midpoint), right.slice(0, split), edits);
  appendShortestEdits(left.slice(midpoint), right.slice(split), edits);
}

function shortestEdits(before, after, budget) {
  const left = linesWithTerminators(before);
  const right = linesWithTerminators(after);
  const { prefix, suffix } = sharedEdgeLengths(left, right);
  const leftMiddle = left.slice(prefix, left.length - suffix);
  const rightMiddle = right.slice(prefix, right.length - suffix);
  if (!reserveLcsArea(budget, leftMiddle.length, rightMiddle.length)) {
    return { kind: 'bounded-replacement', before: leftMiddle.join(''), after: rightMiddle.join('') };
  }
  const edits = left.slice(0, prefix).map((text) => ({ kind: 'equal', text }));
  appendShortestEdits(leftMiddle, rightMiddle, edits);
  appendMappedEdits(edits, left.slice(left.length - suffix), 'equal');

  return { kind: 'shortest', edits };
}

function canonicalHunks(path, before, after, budget) {
  const result = shortestEdits(before, after, budget);
  if (result.kind === 'bounded-replacement') {
    return [{ path, before: result.before, after: result.after }];
  }
  const hunks = [];
  let active = null;
  for (const edit of result.edits) {
    if (edit.kind === 'equal') {
      if (active !== null) {
        hunks.push(active);
        active = null;
      }
      continue;
    }
    if (active === null) {
      active = { path, before: '', after: '' };
    }
    if (edit.kind === 'delete') {
      active.before += edit.text;
    } else {
      active.after += edit.text;
    }
  }
  if (active !== null) {
    hunks.push(active);
  }

  return hunks;
}

function buildDerivedDiff(input) {
  if (!exactOrderedKeys(input, ['previousCandidate', 'currentCandidate', 'previousSources', 'currentSources'])) {
    candidateStructural('Derived diff input must use the closed ordered shape.');
  }
  const { previousCandidate, currentCandidate, previousSources, currentSources } = input;
  validateCandidateSources(previousCandidate, previousSources);
  validateCandidateSources(currentCandidate, currentSources);
  const comparison = compareCandidates({ previousCandidate, currentCandidate });
  if (comparison.kind === 'structural-change') {
    return { hunks: [] };
  }
  const hunks = [];
  const lcsBudget = { remainingArea: MAX_DERIVED_DIFF_LCS_AREA };
  for (let index = 0; index < previousSources.length; index += 1) {
    const previousSource = previousSources[index];
    const currentSource = currentSources[index];
    if (!previousSource.selectedBytes.equals(currentSource.selectedBytes)) {
      for (const hunk of canonicalHunks(previousSource.path, decode(previousSource.selectedBytes), decode(currentSource.selectedBytes), lcsBudget)) {
        hunks.push({ ordinal: hunks.length + 1, path: hunk.path, kind: 'canonical', before: hunk.before, after: hunk.after });
      }
    } else if (previousCandidate.artifacts[index].sourceHash !== currentCandidate.artifacts[index].sourceHash) {
      hunks.push({
        ordinal: hunks.length + 1,
        path: previousSource.path,
        kind: 'representation-only',
        beforeSourceHash: previousCandidate.artifacts[index].sourceHash,
        afterSourceHash: currentCandidate.artifacts[index].sourceHash,
      });
    }
  }

  return { hunks };
}

const DIGEST_FIELDS = new Set(['goal', 'exclusions', 'decisions', 'dependencies', 'prerequisites', 'questions', 'liveClaims', 'scope']);

function validationIssue(kind, detail, path = null, hunk = null) {
  return { kind, path, hunk, detail };
}

function fitValidationFailure(issue) {
  return { verdict: 'uncertain', reason: 'Contract-fit verdict validation failed.', errors: [issue] };
}

function validateComparison(comparison) {
  if (!exactOrderedKeys(comparison, ['kind', 'evidence']) || !['equal', 'structural-change', 'source-change'].includes(comparison.kind) || !Array.isArray(comparison.evidence)) {
    throw new AgreementError('invalid-fit-verdict', 'Comparison result is malformed.', { kind: 'invalid-schema' });
  }
  if (comparison.kind === 'structural-change') {
    const seen = new Set();
    for (const citation of comparison.evidence) {
      if (!exactOrderedKeys(citation, ['kind', 'candidateField']) || citation.kind !== 'candidate' || !['target', 'governingScopes', 'artifacts'].includes(citation.candidateField) || seen.has(citation.candidateField)) {
        throw new AgreementError('invalid-fit-verdict', 'Structural comparison evidence is malformed.', { kind: 'invalid-citation' });
      }
      seen.add(citation.candidateField);
    }
    if (seen.size === 0) {
      throw new AgreementError('invalid-fit-verdict', 'Structural comparison evidence is empty.', { kind: 'invalid-citation' });
    }
  } else if (comparison.evidence.length !== 0) {
    throw new AgreementError('invalid-fit-verdict', 'Non-structural comparison evidence must be empty.', { kind: 'invalid-citation' });
  }
}

function validateHunks(hunks) {
  if (!Array.isArray(hunks)) {
    throw new AgreementError('invalid-fit-verdict', 'Derived hunks must be an array.', { kind: 'invalid-schema' });
  }
  const ordinals = new Set();
  for (const [index, hunk] of hunks.entries()) {
    if (hunk === null || typeof hunk !== 'object' || Array.isArray(hunk) || hunk.ordinal !== index + 1 || typeof hunk.path !== 'string' || hunk.path === '' || ordinals.has(hunk.ordinal)) {
      throw new AgreementError('invalid-fit-verdict', 'Derived hunk identity is malformed.', { kind: 'invalid-schema' });
    }
    if (hunk.kind === 'canonical') {
      if (!exactOrderedKeys(hunk, ['ordinal', 'path', 'kind', 'before', 'after']) || typeof hunk.before !== 'string' || typeof hunk.after !== 'string' || (hunk.before === '' && hunk.after === '')) {
        throw new AgreementError('invalid-fit-verdict', 'Canonical hunk is malformed.', { kind: 'invalid-schema' });
      }
    } else if (hunk.kind === 'representation-only') {
      if (!exactOrderedKeys(hunk, ['ordinal', 'path', 'kind', 'beforeSourceHash', 'afterSourceHash']) || !lowercaseHash(hunk.beforeSourceHash) || !lowercaseHash(hunk.afterSourceHash) || hunk.beforeSourceHash === hunk.afterSourceHash) {
        throw new AgreementError('invalid-fit-verdict', 'Representation hunk is malformed.', { kind: 'invalid-schema' });
      }
    } else {
      throw new AgreementError('invalid-fit-verdict', 'Derived hunk kind is unsupported.', { kind: 'invalid-schema' });
    }
    ordinals.add(hunk.ordinal);
  }
}

function hashHunks(hunks) {
  return createHash('sha256').update(JSON.stringify(hunks), 'utf8').digest('hex');
}

function issueFromFitError(error) {
  if (error instanceof AgreementError && error.code === 'invalid-fit-verdict') {
    return validationIssue(error.evidence.kind, error.message);
  }

  throw error;
}

function validDigestFields(digestFields, requireNonempty) {
  return Array.isArray(digestFields)
    && (!requireNonempty || digestFields.length > 0)
    && digestFields.every((field) => typeof field === 'string' && DIGEST_FIELDS.has(field))
    && new Set(digestFields).size === digestFields.length;
}

function validSourceCitationShape(citation) {
  return exactOrderedKeys(citation, ['kind', 'path', 'hunk', 'digestFields'])
    && citation.kind === 'source'
    && canonicalScopePath(citation.path)
    && Number.isSafeInteger(citation.hunk)
    && citation.hunk > 0
    && Array.isArray(citation.digestFields);
}

function citationKey(citation) {
  return `${citation.path}\u0000${citation.hunk}`;
}

function validateSemanticCitation(citation, hunksByOrdinal, seen) {
  if (!validSourceCitationShape(citation)) {
    return validationIssue('invalid-citation', 'Source citation must use the closed canonical shape.');
  }
  const hunk = hunksByOrdinal.get(citation.hunk);
  if (hunk === undefined || hunk.path !== citation.path || hunk.kind !== 'canonical') {
    return validationIssue('invalid-citation', 'Source citation does not own the cited canonical hunk.', citation.path, citation.hunk);
  }
  if (!validDigestFields(citation.digestFields, true)) {
    return validationIssue('invalid-citation', 'Canonical source citation has invalid digest fields.', citation.path, citation.hunk);
  }
  const key = citationKey(citation);
  if (seen.has(key)) {
    return validationIssue('invalid-citation', 'Source citation is duplicated.', citation.path, citation.hunk);
  }
  seen.add(key);

  return null;
}

function validateContractFitVerdict(input) {
  if (!exactOrderedKeys(input, ['comparison', 'hunks', 'semanticInput'])) {
    return fitValidationFailure(validationIssue('invalid-schema', 'Fit validator input must use the closed ordered shape.'));
  }
  const { comparison, hunks, semanticInput } = input;
  try {
    validateComparison(comparison);
    validateHunks(hunks);
  } catch (error) {
    return fitValidationFailure(issueFromFitError(error));
  }
  const hunkHash = hashHunks(hunks);
  const canonical = hunks.filter((hunk) => hunk.kind === 'canonical');
  const representation = hunks.filter((hunk) => hunk.kind === 'representation-only');
  if (comparison.kind === 'structural-change') {
    if (semanticInput !== null || hunks.length !== 0) {
      return fitValidationFailure(validationIssue('invalid-schema', 'Structural comparison accepts only null semantic input and no source hunks.'));
    }

    return { verdict: 'changes-contract', reason: 'The canonical candidate structure changed.', citations: comparison.evidence, hunkHash };
  }
  if (comparison.kind === 'equal') {
    if (semanticInput !== null || hunks.length !== 0) {
      return fitValidationFailure(validationIssue('invalid-schema', 'Equal comparison accepts only null semantic input and no source hunks.'));
    }

    return { verdict: 'within-contract', reason: 'The canonical candidate is unchanged.', citations: [], hunkHash };
  }
  if (canonical.length === 0) {
    if (representation.length === 0 || semanticInput !== null) {
      return fitValidationFailure(validationIssue('invalid-schema', 'Representation-only comparison requires hunks and null semantic input.'));
    }

    return {
      verdict: 'within-contract',
      reason: 'Only source representation changed.',
      citations: representation.map((hunk) => ({ kind: 'source', path: hunk.path, hunk: hunk.ordinal, digestFields: [] })),
      hunkHash,
    };
  }
  if (semanticInput === null) {
    return fitValidationFailure(validationIssue('invalid-schema', 'Canonical hunks require semantic input.'));
  }
  if (!exactOrderedKeys(semanticInput, semanticInput?.kind === 'json' ? ['kind', 'text'] : ['kind', 'detail'])) {
    return fitValidationFailure(validationIssue('invalid-schema', 'Semantic input must use one closed variant.'));
  }
  if (semanticInput.kind === 'classifier-failure') {
    if (typeof semanticInput.detail !== 'string' || semanticInput.detail.trim() === '') {
      return fitValidationFailure(validationIssue('invalid-schema', 'Classifier failure detail must be nonblank.'));
    }

    return fitValidationFailure(validationIssue('classifier-failure', semanticInput.detail));
  }
  if (semanticInput.kind !== 'json' || typeof semanticInput.text !== 'string' || semanticInput.text === '') {
    return fitValidationFailure(validationIssue('invalid-schema', 'Semantic JSON input is malformed.'));
  }
  let semantic;
  try {
    semantic = JSON.parse(semanticInput.text);
  } catch {
    return fitValidationFailure(validationIssue('malformed-json', 'Semantic JSON could not be parsed.'));
  }
  if (JSON.stringify(semantic) !== semanticInput.text) {
    return fitValidationFailure(validationIssue('invalid-schema', 'Semantic JSON is not compact and canonical.'));
  }
  if (!exactOrderedKeys(semantic, ['verdict', 'reason', 'citations']) || !['within-contract', 'changes-contract', 'uncertain'].includes(semantic.verdict) || typeof semantic.reason !== 'string' || semantic.reason.trim() === '' || !Array.isArray(semantic.citations) || semantic.citations.length === 0) {
    return fitValidationFailure(validationIssue('invalid-schema', 'Semantic verdict must use the closed canonical shape.'));
  }
  const hunksByOrdinal = new Map(hunks.map((hunk) => [hunk.ordinal, hunk]));
  const seen = new Set();
  for (const citation of semantic.citations) {
    const issue = validateSemanticCitation(citation, hunksByOrdinal, seen);
    if (issue !== null) {
      return fitValidationFailure(issue);
    }
  }
  if (semantic.verdict === 'within-contract') {
    for (const hunk of canonical) {
      if (!seen.has(`${hunk.path}\u0000${hunk.ordinal}`)) {
        return fitValidationFailure(validationIssue('incomplete-coverage', 'Within-contract verdict does not cover every canonical hunk.', hunk.path, hunk.ordinal));
      }
    }
  }
  const representationCitations = representation.map((hunk) => ({ kind: 'source', path: hunk.path, hunk: hunk.ordinal, digestFields: [] }));

  return { verdict: semantic.verdict, reason: semantic.reason, citations: [...semantic.citations, ...representationCitations], hunkHash };
}

function validateResponseDecision(decision) {
  if (!exactOrderedKeys(decision, ['kind', 'digest', 'evidence']) || !['agree', 'changes-requested', 'decline', 'ambiguous'].includes(decision.kind) || typeof decision.digest !== 'string' || decision.digest === '' || typeof decision.evidence !== 'string' || decision.evidence.trim() === '') {
    candidateStructural('Response decision must use the closed canonical shape.');
  }
}

function validateFitEvidence(fitEvidence) {
  if (!exactOrderedKeys(fitEvidence, ['verdict', 'reason', 'citations', 'hunkHash']) || fitEvidence.verdict !== 'within-contract' || typeof fitEvidence.reason !== 'string' || fitEvidence.reason.trim() === '' || !Array.isArray(fitEvidence.citations) || fitEvidence.citations.length === 0 || !lowercaseHash(fitEvidence.hunkHash)) {
    candidateStructural('Compatible fit evidence must be a complete within-contract result.');
  }
  const seen = new Set();
  for (const citation of fitEvidence.citations) {
    const key = validSourceCitationShape(citation) ? citationKey(citation) : null;
    if (key === null || !validDigestFields(citation.digestFields, false) || seen.has(key)) {
      candidateStructural('Compatible fit evidence contains an invalid citation.');
    }
    seen.add(key);
  }
}

function validateRetainedFitEvidence(currentCandidate, fitEvidence) {
  validateFitEvidence(fitEvidence);
  const ownedPaths = new Set(currentCandidate.artifacts.map((artifact) => artifact.path));
  const ordinals = new Set();
  for (const citation of fitEvidence.citations) {
    if (!ownedPaths.has(citation.path)) {
      candidateStructural('Compatible fit evidence does not match current candidate ownership.');
    }
    ordinals.add(citation.hunk);
  }
  if (ordinals.size !== fitEvidence.citations.length || [...ordinals].some((ordinal) => ordinal > ordinals.size)) {
    candidateStructural('Compatible fit evidence hunk ordinals must be complete and contiguous.');
  }
}

function validateAgreementRecord(agreementRecord) {
  if (!exactOrderedKeys(agreementRecord, ['acceptedDigest', 'acceptedCandidate', 'currentCandidate', 'currentSources']) || typeof agreementRecord.acceptedDigest !== 'string' || agreementRecord.acceptedDigest.trim() === '') {
    candidateStructural('Agreement record must use the closed canonical shape.');
  }
  validateCandidate(agreementRecord.acceptedCandidate);
  validateCandidateSources(agreementRecord.currentCandidate, agreementRecord.currentSources);
}

function validateSessionState(sessionState) {
  if (!exactOrderedKeys(sessionState, ['agreementRecord', 'fitEvidence'])) {
    candidateStructural('Session state must use the closed canonical shape.');
  }
  validateAgreementRecord(sessionState.agreementRecord);
  const comparison = compareCandidates({
    previousCandidate: sessionState.agreementRecord.acceptedCandidate,
    currentCandidate: sessionState.agreementRecord.currentCandidate,
  });
  if (comparison.kind === 'structural-change' || (comparison.kind === 'source-change' && sessionState.fitEvidence === null)) {
    candidateStructural('Session state fit evidence does not match candidate history.');
  }
  if (sessionState.fitEvidence !== null) {
    validateRetainedFitEvidence(sessionState.agreementRecord.currentCandidate, sessionState.fitEvidence);
  }
}

function createAgreementState(input) {
  if (!exactOrderedKeys(input, ['acceptedDigest', 'presentedCandidate', 'responseDecision', 'reconstructedCandidate', 'reconstructedSources']) || typeof input.acceptedDigest !== 'string' || input.acceptedDigest.trim() === '') {
    candidateStructural('Agreement creation input must use the closed ordered shape.');
  }
  const { acceptedDigest, presentedCandidate, responseDecision: decision, reconstructedCandidate, reconstructedSources } = input;
  validateResponseDecision(decision);
  validateCandidate(presentedCandidate);
  validateCandidateSources(reconstructedCandidate, reconstructedSources);
  if (decision.kind !== 'agree' || decision.digest !== acceptedDigest || !jsonEqual(presentedCandidate, reconstructedCandidate)) {
    candidateStructural('Agreement response does not bind the current presented candidate and digest.');
  }

  return immutableSessionState({
    acceptedDigest,
    acceptedCandidate: presentedCandidate,
    currentCandidate: reconstructedCandidate,
    currentSources: reconstructedSources,
    fitEvidence: null,
  });
}

function refreshCompatibleState(input) {
  if (!exactOrderedKeys(input, ['agreementRecord', 'candidate', 'currentSources', 'fitEvidence'])) {
    candidateStructural('Compatible refresh input must use the closed ordered shape.');
  }
  const { agreementRecord, candidate, currentSources, fitEvidence } = input;
  validateAgreementRecord(agreementRecord);
  validateCandidateSources(candidate, currentSources);
  validateFitEvidence(fitEvidence);
  const comparison = compareCandidates({ previousCandidate: agreementRecord.currentCandidate, currentCandidate: candidate });
  if (comparison.kind !== 'source-change') {
    candidateStructural('Compatible refresh requires source-only candidate changes.');
  }
  const hunks = buildDerivedDiff({
    previousCandidate: agreementRecord.currentCandidate,
    currentCandidate: candidate,
    previousSources: agreementRecord.currentSources,
    currentSources,
  }).hunks;
  if (!validFitResultForGate(fitEvidence, hunks)) {
    candidateStructural('Compatible fit evidence must cite every owned source hunk.');
  }

  return immutableSessionState({
    acceptedDigest: agreementRecord.acceptedDigest,
    acceptedCandidate: agreementRecord.acceptedCandidate,
    currentCandidate: candidate,
    currentSources,
    fitEvidence,
  });
}

function replaceAgreementState(input) {
  if (!exactOrderedKeys(input, ['store', 'nextState']) || !exactOrderedKeys(input.store, ['replace']) || typeof input.store.replace !== 'function') {
    candidateStructural('Agreement store must expose only replace.');
  }
  if (input.nextState !== null) {
    validateSessionState(input.nextState);
  }
  try {
    const stored = input.store.replace(input.nextState);
    if (stored !== input.nextState) {
      throw new Error('store.replace did not return the supplied complete state');
    }

    return stored;
  } catch (thrown) {
    throw new AgreementError('state-storage-failed', 'Volatile agreement state could not be replaced.', { operation: 'replaceAgreementState', originalMessage: thrownMessage(thrown) });
  }
}

function invalidateAgreementState(input) {
  if (!exactOrderedKeys(input, ['reason']) || typeof input.reason !== 'string' || input.reason.trim() === '') {
    candidateStructural('Agreement invalidation requires one nonblank reason.');
  }

  return { nextState: null, reason: input.reason };
}

function gateAction(kind, sessionState = null, digest = null, evidence = null) {
  return { kind, sessionState, digest, evidence };
}

function serializedError(error) {
  if (error instanceof AgreementError) {
    return { code: error.code, message: error.message, evidence: error.evidence };
  }

  return { code: 'invocation-error', message: thrownMessage(error), evidence: {} };
}

function validPendingPresentation(pendingPresentation) {
  if (!exactOrderedKeys(pendingPresentation, ['digest', 'candidate', 'currentSources']) || typeof pendingPresentation.digest !== 'string' || pendingPresentation.digest.trim() === '') {
    return false;
  }
  try {
    validateCandidateSources(pendingPresentation.candidate, pendingPresentation.currentSources);

    return true;
  } catch (error) {
    if (error instanceof AgreementError) {
      return false;
    }
    throw error;
  }
}

function validFitResultForGate(fitResult, hunks) {
  if (fitResult === null || typeof fitResult !== 'object' || Array.isArray(fitResult) || !['within-contract', 'changes-contract', 'uncertain'].includes(fitResult.verdict)) {
    return false;
  }
  if (Object.hasOwn(fitResult, 'errors')) {
    return exactOrderedKeys(fitResult, ['verdict', 'reason', 'errors'])
      && fitResult.verdict === 'uncertain'
      && typeof fitResult.reason === 'string'
      && fitResult.reason.trim() !== ''
      && Array.isArray(fitResult.errors)
      && fitResult.errors.length > 0
      && fitResult.errors.every((issue) => exactOrderedKeys(issue, ['kind', 'path', 'hunk', 'detail'])
        && ['classifier-failure', 'malformed-json', 'invalid-schema', 'invalid-citation', 'incomplete-coverage'].includes(issue.kind)
        && (issue.path === null || (typeof issue.path === 'string' && issue.path !== ''))
        && (issue.hunk === null || (Number.isSafeInteger(issue.hunk) && issue.hunk > 0))
        && typeof issue.detail === 'string'
        && issue.detail.trim() !== '');
  }
  if (!exactOrderedKeys(fitResult, ['verdict', 'reason', 'citations', 'hunkHash']) || typeof fitResult.reason !== 'string' || fitResult.reason.trim() === '' || !Array.isArray(fitResult.citations) || fitResult.citations.length === 0 || !lowercaseHash(fitResult.hunkHash) || fitResult.hunkHash !== hashHunks(hunks)) {
    return false;
  }
  const hunksByOrdinal = new Map(hunks.map((hunk) => [hunk.ordinal, hunk]));
  const cited = new Set();
  let citesCanonicalHunk = false;
  for (const citation of fitResult.citations) {
    if (!validSourceCitationShape(citation)) {
      return false;
    }
    const hunk = hunksByOrdinal.get(citation.hunk);
    const key = citationKey(citation);
    if (hunk === undefined || hunk.path !== citation.path || cited.has(key)) {
      return false;
    }
    if (hunk.kind === 'canonical') {
      if (!validDigestFields(citation.digestFields, true)) {
        return false;
      }
      citesCanonicalHunk = true;
    } else if (!validDigestFields(citation.digestFields, false) || citation.digestFields.length !== 0) {
      return false;
    }
    cited.add(key);
  }
  for (const hunk of hunks) {
    const required = fitResult.verdict === 'within-contract' || hunk.kind === 'representation-only';
    if (required && !cited.has(`${hunk.path}\u0000${hunk.ordinal}`)) {
      return false;
    }
  }
  if (fitResult.verdict === 'changes-contract' && hunks.some((hunk) => hunk.kind === 'canonical') && !citesCanonicalHunk) {
    return false;
  }

  return true;
}

function validateLegacyDeletions(deletions) {
  if (!Array.isArray(deletions) || deletions.length === 0) {
    return false;
  }

  let previous = null;

  return deletions.every((deletion) => {
    const match = {
      path: deletion?.path,
      kind: deletion?.kind,
      rawStart: deletion?.rawStart,
      rawEnd: deletion?.rawEnd,
      rawLine: deletion?.rawLine,
    };
    const valid = exactOrderedKeys(deletion, ['path', 'kind', 'rawStart', 'rawEnd', 'rawLine', 'ownedBlankLine'])
    && validateLegacyMatch(match)
    && (deletion.ownedBlankLine === null || (validateRange(deletion.ownedBlankLine)
      && (deletion.ownedBlankLine.end <= deletion.rawStart || deletion.ownedBlankLine.start >= deletion.rawEnd)))
    && (previous === null || previous.path !== deletion.path || previous.rawEnd <= deletion.rawStart);
    previous = deletion;

    return valid;
  });
}

function legacyDeletionsEqual(actual, expected) {
  return validateLegacyDeletions(actual)
    && actual.length === expected.length
    && actual.every((deletion, index) => {
      const detected = expected[index];
      const ownedBlankLineMatches = deletion.ownedBlankLine === null
        ? detected.ownedBlankLine === null
        : detected.ownedBlankLine !== null
          && deletion.ownedBlankLine.start === detected.ownedBlankLine.start
          && deletion.ownedBlankLine.end === detected.ownedBlankLine.end;

      return deletion.path === detected.path
        && deletion.kind === detected.kind
        && deletion.rawStart === detected.rawStart
        && deletion.rawEnd === detected.rawEnd
        && deletion.rawLine.equals(detected.rawLine)
        && ownedBlankLineMatches;
    });
}

function deriveLegacyDeletions(artifacts) {
  const deletions = [];
  const physicalArtifacts = uniquePhysicalLegacyArtifacts(artifacts);
  const scan = createMarkdownScanner();
  const matches = detectLegacyMarkers({ artifacts: physicalArtifacts }, scan).matches;
  let matchIndex = 0;
  for (const artifact of physicalArtifacts) {
    const firstMatchIndex = matchIndex;
    while (matchIndex < matches.length && matches[matchIndex].path === artifact.path) {
      matchIndex += 1;
    }
    const artifactMatches = matches.slice(firstMatchIndex, matchIndex);
    if (artifactMatches.length > 0) {
      const preview = previewLegacyMarkerDeletionValidated({ sourceBuffer: artifact.sourceBuffer, baselineHash: completeFileHash(artifact.sourceBuffer), matches: artifactMatches }, scan);
      for (const deletion of preview.deletions) {
        deletions.push(deletion);
      }
    }
  }
  if (matchIndex !== matches.length) {
    hardeningGrammar('Legacy detection matches must follow physical artifact order.');
  }

  return deletions;
}

function reviewedLegacyMigration(artifacts, legacyDeletions) {
  const expectedLegacyDeletions = deriveLegacyDeletions(artifacts);
  if (expectedLegacyDeletions.length > 0) {
    if (!legacyDeletionsEqual(legacyDeletions, expectedLegacyDeletions)) {
      candidateStructural('Reviewed migration evidence does not match the current resolved baseline.');
    }

    return gateAction('reviewed-migration', null, null, { deletions: expectedLegacyDeletions });
  }
  if (legacyDeletions !== null) {
    candidateStructural('Reviewed migration evidence does not match the current resolved baseline.');
  }

  return null;
}

function validArtifactSnapshot(artifact) {
  if (!exactOrderedKeys(artifact, ['path', 'selectorKind', 'selectors', 'sourceBuffer']) || !canonicalScopePath(artifact.path) || !ARTIFACT_SELECTOR_KINDS.includes(artifact.selectorKind) || !Buffer.isBuffer(artifact.sourceBuffer)) {
    return false;
  }
  try {
    validateSelectors(artifact.selectorKind, artifact.selectors);
  } catch (error) {
    if (error instanceof AgreementError) {
      return false;
    }
    throw error;
  }

  return true;
}

function validateTerminalResolution(resolution) {
  if (resolution?.kind === 'not-applicable') {
    return exactOrderedKeys(resolution, ['kind', 'target', 'governingScopes', 'artifacts'])
      && resolution.target === null
      && Array.isArray(resolution.governingScopes)
      && resolution.governingScopes.length === 0
      && Array.isArray(resolution.artifacts)
      && resolution.artifacts.length === 0;
  }
  if (resolution?.kind === 'brainstorming-required') {
    return exactOrderedKeys(resolution, ['kind', 'artifacts', 'unfinished'])
      && Array.isArray(resolution.artifacts)
      && resolution.artifacts.every(validArtifactSnapshot)
      && exactOrderedKeys(resolution.unfinished, ['artifacts'])
      && Array.isArray(resolution.unfinished.artifacts)
      && resolution.unfinished.artifacts.every((artifact) => exactOrderedKeys(artifact, ['path', 'signals'])
        && typeof artifact.path === 'string'
        && artifact.path !== ''
        && Array.isArray(artifact.signals)
        && artifact.signals.length > 0
        && artifact.signals.every((signal) => ['frontmatter', 'index'].includes(signal))
        && new Set(artifact.signals).size === artifact.signals.length);
  }
  if (resolution?.kind === 'completed-no-op') {
    return exactOrderedKeys(resolution, ['kind', 'evidence'])
      && exactOrderedKeys(resolution.evidence, ['target', 'archivePath', 'matchedDeclaration'])
      && typeof resolution.evidence.archivePath === 'string'
      && resolution.evidence.archivePath !== ''
      && (resolution.evidence.matchedDeclaration === null || typeof resolution.evidence.matchedDeclaration === 'string');
  }

  return false;
}

function decideAgreementGate(input, options = null) {
  const inputKeys = ['phase', 'request', 'resolution', 'sessionState', 'pendingPresentation', 'candidate', 'currentSources', 'acceptedDigest', 'response', 'fitResult', 'legacyDeletions'];
  if (!exactOrderedKeys(input, inputKeys)) {
    return gateAction('stop-error', null, null, serializedError(new AgreementError('structural-error', 'Gate input must use the closed ordered shape.', { kind: 'selector-shape' })));
  }
  try {
    if (!['lifecycle-entry', 'final-presentation', 'planning-result', 'post-mutation'].includes(input.phase)) {
      candidateStructural('Gate phase must use the closed shape.');
    }
    validateAgreementRequest(input.request, candidateStructural);
    if (input.resolution?.kind === 'not-applicable') {
      if (!validateTerminalResolution(input.resolution)) {
        candidateStructural('Not-applicable resolution must use the closed canonical shape.');
      }
      return input.request.allowSpecLess
        ? gateAction('not-applicable')
        : gateAction('stop-error', null, null, serializedError(new AgreementError('structural-error', 'The caller requires a governing specification.', { kind: 'selector-absence' })));
    }
    if (input.resolution?.kind === 'brainstorming-required') {
      if (!validateTerminalResolution(input.resolution)) {
        candidateStructural('Brainstorming resolution must use the closed canonical shape.');
      }
      const migration = reviewedLegacyMigration(input.resolution.artifacts, input.legacyDeletions);
      if (migration !== null) {
        return migration;
      }
      return gateAction('brainstorming-required', null, null, input.resolution.unfinished);
    }
    if (input.resolution?.kind === 'completed-no-op') {
      if (!validateTerminalResolution(input.resolution)) {
        candidateStructural('Completion resolution must use the closed canonical shape.');
      }
      validateScopeRecord(input.resolution.evidence.target, 'selector-shape');
      if (input.request.mode !== 'handover'
        || !input.request.allowCompletedNoOp
        || input.request.target === null
        || !jsonEqual(input.resolution.evidence.target, input.request.target)
        || !exactOrderedKeys(options, ['fsAdapter', 'readyParser'])
        || !jsonEqual(resolveGoverningSet(input.request, options), input.resolution)) {
        candidateStructural('Completion no-op requires matching handover authority.');
      }
      return gateAction('completed-no-op', null, null, input.resolution.evidence);
    }
    if (input.resolution?.kind !== 'resolved') {
      candidateStructural('Gate requires one closed resolver result.');
    }
    if (!exactOrderedKeys(input.resolution, ['kind', 'target', 'governingScopes', 'artifacts'])) {
      candidateStructural('Resolved gate input must use the closed ordered shape.');
    }
    const migration = reviewedLegacyMigration(input.resolution.artifacts, input.legacyDeletions);
    if (migration !== null) {
      return migration;
    }
    if (typeof input.acceptedDigest !== 'string' || input.acceptedDigest.trim() === '') {
      candidateStructural('Presentation paths require one nonblank digest.');
    }
    if (input.response !== null) {
      validateResponseDecision(input.response);
      if (input.response.kind === 'ambiguous') {
        return gateAction('stop-ambiguous', null, null, input.response);
      }
      if (!validPendingPresentation(input.pendingPresentation) || input.response.digest !== input.pendingPresentation.digest || input.pendingPresentation.digest !== input.acceptedDigest) {
        return gateAction('present-digest', null, input.acceptedDigest, null);
      }
      if (input.response.kind === 'changes-requested') {
        return gateAction('return-to-design', null, null, input.response);
      }
      if (input.response.kind === 'decline') {
        return gateAction('stop-declined', null, null, input.response);
      }
      validateCandidateSources(input.candidate, input.currentSources);
      if (!jsonEqual(input.pendingPresentation.candidate, input.candidate) || !currentSourcesEqual(input.pendingPresentation.currentSources, input.currentSources)) {
        return gateAction('present-digest', null, input.acceptedDigest, null);
      }
      validateCandidateResolution(input.candidate, input.resolution);
      const sessionState = createAgreementState({
        acceptedDigest: input.pendingPresentation.digest,
        presentedCandidate: input.pendingPresentation.candidate,
        responseDecision: input.response,
        reconstructedCandidate: input.candidate,
        reconstructedSources: input.currentSources,
      });

      return gateAction('continue', sessionState);
    }
    validateCandidateSources(input.candidate, input.currentSources);
    validateCandidateResolution(input.candidate, input.resolution);
    if (input.sessionState === null) {
      return gateAction('present-digest', null, input.acceptedDigest, null);
    }
    try {
      validateSessionState(input.sessionState);
    } catch (error) {
      if (error instanceof AgreementError) {
        return gateAction('present-digest', null, input.acceptedDigest, null);
      }
      throw error;
    }
    const comparison = compareCandidates({ previousCandidate: input.sessionState.agreementRecord.currentCandidate, currentCandidate: input.candidate });
    if (comparison.kind === 'equal') {
      return gateAction('continue', input.sessionState);
    }
    if (comparison.kind === 'structural-change') {
      const deterministicFit = validateContractFitVerdict({ comparison, hunks: [], semanticInput: null });

      return gateAction('present-digest', null, input.acceptedDigest, deterministicFit);
    }
    const hunks = buildDerivedDiff({
      previousCandidate: input.sessionState.agreementRecord.currentCandidate,
      currentCandidate: input.candidate,
      previousSources: input.sessionState.agreementRecord.currentSources,
      currentSources: input.currentSources,
    }).hunks;
    if (!validFitResultForGate(input.fitResult, hunks)) {
      candidateStructural('Changed source requires one validated fit result.');
    }
    if (input.fitResult.verdict === 'within-contract') {
      const sessionState = refreshCompatibleState({
        agreementRecord: input.sessionState.agreementRecord,
        candidate: input.candidate,
        currentSources: input.currentSources,
        fitEvidence: input.fitResult,
      });

      return gateAction('continue', sessionState);
    }
    if (input.fitResult.verdict === 'changes-contract') {
      return gateAction('present-digest', null, input.acceptedDigest, input.fitResult);
    }

    return gateAction('render-uncertain-then-present', null, input.acceptedDigest, input.fitResult);
  } catch (error) {
    return gateAction('stop-error', null, null, serializedError(error));
  }
}

function productionFsAdapter() {
  return {
    readFile: (path) => readFileSync(path),
    readDirectory: (path) => readdirSync(path),
    realpath: (path) => realpathSync(path),
    replaceFileAtomically: (path, nextBytes) => {
      const destinationMode = statSync(path).mode & 0o7777;
      let stagingPath;
      let descriptor = null;
      while (descriptor === null) {
        stagingCounter += 1;
        stagingPath = `${path}.nightshift-${process.pid}-${stagingCounter}.tmp`;
        try {
          descriptor = openSync(stagingPath, 'wx', destinationMode);
        } catch (error) {
          if (error?.code !== 'EEXIST') {
            throw error;
          }
        }
      }

      let failure = null;
      try {
        writeFileSync(descriptor, nextBytes);
        closeSync(descriptor);
        descriptor = null;
        renameSync(stagingPath, path);
      } catch (error) {
        failure = error;
      }
      if (failure === null) {
        return;
      }
      if (descriptor !== null) {
        try {
          closeSync(descriptor);
        } catch (error) {
          failure = error;
        }
      }
      try {
        unlinkSync(stagingPath);
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          failure = error;
        }
      }

      throw failure;
    },
  };
}

function productionBindingAdapter() {
  return {
    fileState: (path) => {
      const metadata = lstatSync(path, { bigint: true });

      return { ctimeNs: metadata.ctimeNs, dev: metadata.dev, ino: metadata.ino, mode: metadata.mode, mtimeNs: metadata.mtimeNs, nlink: metadata.nlink, size: metadata.size };
    },
  };
}

function invocationFailure(message, evidence = {}) {
  throw new AgreementError('invocation-error', message, evidence);
}

function rejectDuplicateJsonKeys(requestText) {
  const stack = [];
  let index = 0;
  while (index < requestText.length) {
    const character = requestText[index];
    if (character === '"') {
      const start = index;
      index += 1;
      let escaped = false;
      while (index < requestText.length) {
        const stringCharacter = requestText[index];
        index += 1;
        if (escaped) {
          escaped = false;
        } else if (stringCharacter === '\\') {
          escaped = true;
        } else if (stringCharacter === '"') {
          break;
        }
      }
      const context = stack[stack.length - 1];
      if (context?.kind === 'object' && context.expectingKey) {
        let key;
        try {
          key = JSON.parse(requestText.slice(start, index));
        } catch {
          return;
        }
        if (context.keys.has(key)) {
          invocationFailure('CLI request must not contain duplicate JSON keys.');
        }
        context.keys.add(key);
        context.expectingKey = false;
      }
      continue;
    }
    if (character === '{') {
      stack.push({ kind: 'object', keys: new Set(), expectingKey: true });
    } else if (character === '[') {
      stack.push({ kind: 'array' });
    } else if (character === '}' || character === ']') {
      stack.pop();
    } else if (character === ',') {
      const context = stack[stack.length - 1];
      if (context?.kind === 'object') {
        context.expectingKey = true;
      }
    }
    index += 1;
  }
}

const CLI_BUFFER_ALIASES = Object.freeze({
  planBuffer: 'planBytesHex',
  planBody: 'planBodyBytesHex',
  sourceBuffer: 'sourceBytesHex',
  selectedBytes: 'selectedBytesHex',
  sourceSpans: 'sourceSpansHex',
  rawLine: 'rawLineHex',
  replacementBytes: 'replacementBytesHex',
  bytes: 'bytesHex',
});
const CLI_INPUT_HEX_KEYS = new Set(['planBytesHex', 'planBodyBytesHex', 'sourceBytesHex', 'selectedBytesHex', 'sourceSpansHex', 'rawLineHex']);

function validateCliWireKeys(value, path = 'input') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateCliWireKeys(entry, `${path}[${index}]`));

    return;
  }
  if (value === null || typeof value !== 'object') {
    return;
  }
  for (const rawKey of Object.keys(CLI_BUFFER_ALIASES)) {
    if (!Object.hasOwn(value, rawKey)) {
      continue;
    }
    const hexKey = CLI_BUFFER_ALIASES[rawKey];
    if (Object.hasOwn(value, hexKey)) {
      invocationFailure(`CLI fields ${path}.${rawKey} and ${path}.${hexKey} are aliases and cannot coexist.`, { fields: [`${path}.${rawKey}`, `${path}.${hexKey}`] });
    }
    invocationFailure(`CLI field ${path}.${rawKey} is an in-process Buffer key and cannot cross JSON.`, { field: `${path}.${rawKey}` });
  }
  for (const [key, entry] of Object.entries(value)) {
    if (key.endsWith('Hex') && !CLI_INPUT_HEX_KEYS.has(key)) {
      invocationFailure(`CLI field ${path}.${key} is not allowlisted.`, { field: `${path}.${key}` });
    }
    validateCliWireKeys(entry, `${path}.${key}`);
  }
}

function decodeHex(value, field) {
  if (typeof value !== 'string' || value.length % 2 !== 0 || !/^[a-f0-9]*$/.test(value)) {
    invocationFailure(`CLI field ${field} must contain lowercase even-length hexadecimal.`, { field });
  }

  return Buffer.from(value, 'hex');
}

function decodeCliValue(value, path = 'input') {
  if (Array.isArray(value)) {
    return value.map((entry, index) => decodeCliValue(entry, `${path}[${index}]`));
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  const decoded = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'planBytesHex') {
      decoded.planBuffer = entry === null ? null : decodeHex(entry, `${path}.${key}`);
    } else if (key === 'planBodyBytesHex') {
      decoded.planBody = decodeHex(entry, `${path}.${key}`);
    } else if (key === 'sourceBytesHex') {
      decoded.sourceBuffer = decodeHex(entry, `${path}.${key}`);
    } else if (key === 'selectedBytesHex') {
      decoded.selectedBytes = decodeHex(entry, `${path}.${key}`);
    } else if (key === 'sourceSpansHex') {
      if (!Array.isArray(entry)) {
        invocationFailure(`CLI field ${path}.${key} must be an array of hexadecimal strings.`, { field: `${path}.${key}` });
      }
      decoded.sourceSpans = entry.map((span, index) => decodeHex(span, `${path}.${key}[${index}]`));
    } else if (key === 'rawLineHex') {
      decoded.rawLine = decodeHex(entry, `${path}.${key}`);
    } else if (key.endsWith('Hex')) {
      invocationFailure(`CLI field ${path}.${key} is not allowlisted.`, { field: `${path}.${key}` });
    } else {
      Object.defineProperty(decoded, key, {
        value: decodeCliValue(entry, `${path}.${key}`),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  }

  return decoded;
}

function encodeCliValue(value) {
  if (Buffer.isBuffer(value)) {
    return value.toString('hex');
  }
  if (Array.isArray(value)) {
    return value.map(encodeCliValue);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  const encoded = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'sourceBuffer') {
      encoded.sourceBytesHex = entry.toString('hex');
    } else if (key === 'selectedBytes') {
      encoded.selectedBytesHex = entry.toString('hex');
    } else if (key === 'sourceSpans') {
      encoded.sourceSpansHex = entry.map((span) => span.toString('hex'));
    } else if (key === 'rawLine') {
      encoded.rawLineHex = entry.toString('hex');
    } else if (key === 'replacementBytes') {
      encoded.replacementBytesHex = entry.toString('hex');
    } else if (key === 'bytes') {
      encoded.bytesHex = entry.toString('hex');
    } else {
      encoded[key] = encodeCliValue(entry);
    }
  }

  return encoded;
}

function resolverAdapters(adapters) {
  return { fsAdapter: adapters.fsAdapter, readyParser: adapters.readyParser };
}

function dispatchCliOperation(operation, input, adapters, environment) {
  validateCliWireKeys(input);
  const decoded = decodeCliValue(input);
  switch (operation) {
    case 'plan-parse':
      return parsePlanContract(decoded, { fsAdapter: adapters.fsAdapter });
    case 'plan-serialize':
      return { planBytesHex: serializePlanContract(decoded).toString('hex') };
    case 'resolve':
      return resolveGoverningSet(decoded, resolverAdapters(adapters));
    case 'locate':
      if (decoded !== null && typeof decoded === 'object') {
        const callerOwnedLinkField = ['linkFormat', 'fileLinkFormat', 'linkRendering'].find((field) => Object.hasOwn(decoded, field));
        if (callerOwnedLinkField !== undefined) {
          invocationFailure(`CLI field input.${callerOwnedLinkField} is controller-owned and is read from the environment.`, { field: `input.${callerOwnedLinkField}` });
        }
      }

      return applyLinkEnvironment(locateSelection({ ...decoded, linkFormat: environment[LINE_LINK_FORMAT_VARIABLE] ?? null }), environment);
    case 'candidate': {
      if (decoded?.kind !== 'resolved' || !Array.isArray(decoded.artifacts)) {
        invocationFailure('Candidate operation requires one resolved governing-set result.');
      }
      const selections = decoded.artifacts.map((artifact) => hashSelection(selectArtifact(artifact)));

      return buildCandidate({ resolution: decoded, selections });
    }
    case 'compare':
      return compareCandidates(decoded);
    case 'diff':
      return buildDerivedDiff(decoded);
    case 'fit':
      return validateContractFitVerdict(decoded);
    case 'state-create':
      return createAgreementState(decoded);
    case 'state-refresh':
      return refreshCompatibleState(decoded);
    case 'state-invalidate':
      return invalidateAgreementState(decoded);
    case 'gate':
      return decideAgreementGate(decoded, resolverAdapters(adapters));
    case 'legacy-detect':
      return detectLegacyMarkers(decoded);
    case 'legacy-preview':
      return previewLegacyMarkerDeletion(decoded);
    case 'provenance-write':
      return writeProvenanceStamp(decoded, { fsAdapter: adapters.fsAdapter });
    case 'provenance-write-bound':
      return writeBoundProvenanceStamp(decoded, { fsAdapter: adapters.fsAdapter, bindingAdapter: adapters.bindingAdapter });
    case 'provenance-bind':
      return captureProvenanceBinding(decoded, { fsAdapter: adapters.fsAdapter, bindingAdapter: adapters.bindingAdapter });
    default:
      invocationFailure('CLI operation is not allowlisted.', { operation });
  }
}

function runCli(input, options = {}) {
  let envelope;
  let exitCode;
  try {
    if (!exactOrderedKeys(input, ['requestText']) || typeof input.requestText !== 'string') {
      invocationFailure('CLI invocation requires one requestText string.');
    }
    rejectDuplicateJsonKeys(input.requestText);
    let requestEnvelope;
    try {
      requestEnvelope = JSON.parse(input.requestText);
    } catch {
      invocationFailure('CLI request must be valid JSON.');
    }
    if (!exactOrderedKeys(requestEnvelope, ['operation', 'input']) || typeof requestEnvelope.operation !== 'string') {
      invocationFailure('CLI request must contain exactly operation and input in canonical order.');
    }
    const adapters = {
      bindingAdapter: options.bindingAdapter ?? productionBindingAdapter(),
      fsAdapter: options.fsAdapter ?? productionFsAdapter(),
      readyParser: options.readyParser,
    };
    const value = dispatchCliOperation(requestEnvelope.operation, requestEnvelope.input, adapters, options.environment ?? process.env);
    envelope = { ok: true, value: encodeCliValue(value) };
    exitCode = 0;
  } catch (thrown) {
    const error = thrown instanceof AgreementError
      ? thrown
      : new AgreementError('unexpected-adapter-failure', 'CLI dispatch failed unexpectedly.', { operation: 'runCli', originalMessage: thrownMessage(thrown) });
    envelope = { ok: false, error: { code: error.code, message: error.message, evidence: error.evidence } };
    exitCode = ['invocation-error', 'unexpected-adapter-failure'].includes(error.code) ? 2 : 1;
  }

  return { exitCode, outputText: `${JSON.stringify(envelope)}\n` };
}

module.exports = {
  AgreementError,
  AGREEMENT_VERSION,
  MAX_DERIVED_DIFF_LCS_AREA,
  MAX_GOVERNING_NOMINATIONS,
  canonicalizePath,
  canonicalScopePath,
  captureProvenanceBinding,
  scanMarkdown,
  selectArtifact,
  hashSelection,
  locateSelection,
  parsePlanContract,
  prepareProvenanceWrite,
  productionBindingAdapter,
  productionFsAdapter,
  serializePlanContract,
  resolveGoverningSet,
  buildCandidate,
  candidateToken,
  compareCandidates,
  buildDerivedDiff,
  validateContractFitVerdict,
  createAgreementState,
  refreshCompatibleState,
  replaceAgreementState,
  invalidateAgreementState,
  decideAgreementGate,
  detectLegacyMarkers,
  previewLegacyMarkerDeletion,
  writeBoundProvenanceStamp,
  writeProvenanceStamp,
  runCli,
};

if (require.main === module) {
  const requestText = readFileSync(0, 'utf8');
  const readyModule = require('../ready/ready.js');
  const requiredReadyFunctions = ['normalizeSliceName', 'parseSlices', 'findSlicesByNormalizedName'];
  let result;
  if (!requiredReadyFunctions.every((name) => typeof readyModule[name] === 'function')) {
    const unavailable = new AgreementError('invocation-error', 'Ready parser does not expose the required CLI contract.', { required: requiredReadyFunctions });
    result = { exitCode: 2, outputText: `${JSON.stringify({ ok: false, error: { code: unavailable.code, message: unavailable.message, evidence: unavailable.evidence } })}\n` };
  } else {
    const readyParser = {
      normalizeSliceName: readyModule.normalizeSliceName,
      parseSlices: readyModule.parseSlices,
      findSlicesByNormalizedName: readyModule.findSlicesByNormalizedName,
    };
    result = runCli({ requestText }, { fsAdapter: productionFsAdapter(), readyParser });
  }
  process.stdout.write(result.outputText);
  process.exitCode = result.exitCode;
}
