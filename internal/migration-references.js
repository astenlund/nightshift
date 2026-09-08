'use strict';

const path = require('node:path');
const { isUtf8 } = require('node:buffer');
const { scanMarkdown } = require('./markdown');

const PATH_TOKENS = /(["'`])((?:\\.|(?!\1)[^\\])*?)\1|[^\s"'`]+/g;

class UnresolvedPathError extends Error {}

const nonlocalReference = value => /^(?:[a-z][a-z0-9+.-]*:|[\\/]|#)/i.test(value.trimStart());

function relocationMoves(state) {
  return [...state.files, ...(state.preserved ?? []).map(source => ({ source, destination: source })), ...state.directories.map(source => ({ source: source + '/', destination: source.replace(/^\.claude\//, '.nightshift/') + '/' }))];
}

function relocated(value, moves) {
  if (nonlocalReference(value)) return value;
  const normalized = path.posix.normalize(value);
  const mapped = destination => (value.startsWith('./') ? './' : '') + destination;
  // Exact identities, including preserved files, take precedence over directory moves.
  for (const move of moves) {
    if (normalized === move.source) return mapped(move.destination);
  }
  for (const move of moves) {
    if (move.source.endsWith('/')) {
      if (normalized === move.source.slice(0, -1)) return mapped(move.destination.slice(0, -1));
      if (normalized.startsWith(move.source)) return mapped(move.destination + normalized.slice(move.source.length));
    }
  }
  if (process.platform === 'win32') {
    const possibleAlias = normalized.toUpperCase();
    if (moves.some(move => possibleAlias === move.source.toUpperCase() || move.source.endsWith('/') && (possibleAlias === move.source.slice(0, -1).toUpperCase() || possibleAlias.startsWith(move.source.toUpperCase())))) {
      throw new UnresolvedPathError('Resolve the reference against the exact recorded entry names before migration: ' + value);
    }
  }
  return value;
}

function relocatedLiteral(value, moves, root) {
  const portable = process.platform === 'win32' ? value.replaceAll('\\', '/') : value;
  const projectRoot = root?.replaceAll('\\', '/').replace(/\/+$/, '');
  const prefix = projectRoot && portable.startsWith(projectRoot + '/') ? portable.slice(0, projectRoot.length + 1) : '';
  if (!prefix && projectRoot && process.platform === 'win32' && portable.toUpperCase().startsWith(projectRoot.toUpperCase() + '/')) {
    throw new UnresolvedPathError('Resolve the reference against the exact project-root identity before migration: ' + value);
  }
  const relative = portable.slice(prefix.length);
  const target = relocated(relative, moves);
  if (target === relative) return value;
  const result = prefix + target;
  return value.includes('\\') && !value.includes('/') ? result.replaceAll('/', '\\') : result;
}

function hasUnsupportedPathLiterals(bytes, moves, root) {
  if (!isUtf8(bytes) || bytes.includes(0)) return false;
  let unsupported = false;
  bytes.toString('utf8').replace(PATH_TOKENS, (token, quote, content) => {
    const value = quote ? content : token;
    if (value.includes('\\') && relocatedLiteral(value, moves, root) !== value) unsupported = true;
    return token;
  });
  return unsupported;
}

function mapInlineCode(line, prose, code) {
  const runs = [...line.matchAll(/`+/g)];
  let cursor = 0;
  let result = '';
  for (let index = 0; index < runs.length; index++) {
    const opening = runs[index];
    const closingIndex = runs.findIndex((run, candidate) => candidate > index && run[0].length === opening[0].length);
    if (closingIndex < 0) continue;
    const closing = runs[closingIndex];
    result += prose(line.slice(cursor, opening.index));
    result += opening[0] + code(line.slice(opening.index + opening[0].length, closing.index)) + closing[0];
    cursor = closing.index + closing[0].length;
    index = closingIndex;
  }
  return result + prose(line.slice(cursor));
}

function rewriteReferences(bytes, moves, options = {}) {
  if (!isUtf8(bytes) || bytes.includes(0)) return bytes;
  const replace = value => {
    // Match complete path values rather than prefixes of another filename.
    return value.replace(PATH_TOKENS, (token, quote, content) => {
      if (quote === '"' && options.sourcePath?.endsWith('.json')) {
        const original = JSON.parse(token);
        const target = relocatedLiteral(original, moves, options.root);
        if (target === original) return token;
        return JSON.stringify(target).split('').map(unit => unit.charCodeAt(0) > 127 ? String.fromCharCode(92) + 'u' + unit.charCodeAt(0).toString(16).padStart(4, '0') : unit).join('');
      }
      if (quote) return quote + relocated(content, moves) + quote;
      return relocated(token, moves);
    });
  };
  if (!options.markdown) {
    if (options.historical) return bytes;
    const content = bytes.toString('utf8');
    if (/\.ya?ml$/.test(options.sourcePath ?? '')) {
      return Buffer.from(content.split(/(\r\n|\n|\r)/).map(line => {
        const scalar = /^([ \t]*(?:-[ \t]+)?[^\r\n:]+:[ \t]+)(\.claude\/.*?)([ \t]+#.*)?$/.exec(line);
        if (!scalar) return replace(line);
        const trailing = /[ \t]*$/.exec(scalar[2])[0];
        const target = scalar[2].slice(0, scalar[2].length - trailing.length);
        return scalar[1] + relocated(target, moves) + trailing + (scalar[3] ?? '');
      }).join(''), 'utf8');
    }
    return Buffer.from(replace(content), 'utf8');
  }
  const destination = token => {
    const angle = token.startsWith('<') && token.endsWith('>');
    const value = angle ? token.slice(1, -1) : token;
    if (/^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(value)) return token;
    if (!options.sourcePath || !options.destinationPath) return angle ? '<' + replace(value) + '>' : replace(value);
    const split = value.search(/[?#]/);
    const pathname = split < 0 ? value : value.slice(0, split);
    const suffix = split < 0 ? '' : value.slice(split);
    let decoded;
    try { decoded = decodeURI(pathname); } catch { return token; }
    const oldTarget = path.posix.normalize(path.posix.join(path.posix.dirname(options.sourcePath), decoded));
    const newTarget = relocated(oldTarget, moves);
    if (oldTarget === newTarget && options.sourcePath === options.destinationPath) return token;
    let relative = path.posix.relative(path.posix.dirname(options.destinationPath), newTarget);
    if (pathname.includes('%')) relative = encodeURI(relative);
    if (pathname.startsWith('./') && !relative.startsWith('.')) relative = './' + relative;
    return (angle ? '<' : '') + relative + suffix + (angle ? '>' : '');
  };
  const parsed = scanMarkdown(bytes);
  const chunks = [bytes.subarray(0, parsed.bomLength)];
  for (const line of parsed.lines) {
    if (!line.outsideFence || line.opensFence) { chunks.push(bytes.subarray(line.rawStart, line.rawEnd)); continue; }
    // Destinations may contain balanced parentheses; stop before optional titles.
    const navigation = value => value.replace(/(\]\([ \t]*)(<[^>\r\n]*>|(?:[^\s()\\]|\\.|\([^()]*\))+)(?=[ \t]|\))/g, (match, opening, target) => opening + destination(target));
    let content = mapInlineCode(line.content, navigation, value => options.historical ? value : value.startsWith('.claude/') ? relocated(value, moves) : replace(value));
    content = content.replace(/^( {0,3}\[[^\]]+\]:[ \t]*)(<[^>\r\n]*>|\S+)/, (match, opening, target) => opening + destination(target));
    chunks.push(Buffer.from(content, 'utf8'), line.terminator);
  }
  return Buffer.concat(chunks);
}

module.exports = { UnresolvedPathError, hasUnsupportedPathLiterals, relocated, relocationMoves, rewriteReferences };
