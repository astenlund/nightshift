'use strict'

const { dirname, relative, resolve } = require('node:path')
const { realpathSync } = require('node:fs')
const { TextDecoder } = require('node:util')

const { InitBacklogError, throwInitBacklogError } = require('./errors')
const { canonicalRoot, enumerateDirectory, pathIsContained, probeWindowsAttributes, stableOpenFile } = require('./filesystem')
const { assertSafeWindowsScalar, compareOrdinal } = require('./protocol')

const GUIDANCE_SECTION = '## Backlogs and indexes'
const CLAUDE_CANDIDATES = ['CLAUDE.md', 'CLAUDE.local.md']
const CODEX_CANDIDATES = ['AGENTS.override.md', 'AGENTS.md']
const MAX_IMPORT_DEPTH = 4

function filesystemOptions(options = {}) {
  const platform = options.platform ?? process.platform
  if (platform === 'win32' && typeof options.attributeProbe !== 'function') {
    return { ...options, attributeProbe: (paths) => probeWindowsAttributes(paths, options) }
  }

  return options
}

function fail(detail, cause, target = null) {
  throwInitBacklogError({ code: 'guidance-resolution', detail, operation: 'inspect', phase: 'resolve', target }, cause)
}

function relativeTarget(root, target) {
  const value = relative(root, target).replaceAll('\\', '/')
  if (value.length === 0 || value === '..' || value.startsWith('../') || value.includes('/../')) {
    fail('Guidance path escapes the repository.')
  }

  return value
}

function candidatePath(root, target) {
  if (target === '') {
    return root
  }
  const absolute = resolve(root, ...target.split('/'))
  if (!pathIsContained(root, absolute)) {
    fail('Guidance path escapes the repository.')
  }

  return absolute
}

function readCandidate(root, target, options = {}) {
  const absolute = candidatePath(root, target)
  let opened
  try {
    opened = stableOpenFile(root, absolute, { ...options, requireSingleLink: false, maxBytes: options.maxBytes })
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.code === 'ENOENT') {
      return null
    }
    fail('Guidance candidate is not an ordinary readable file.', error, target)
  }

  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(opened.bytes)
  } catch (error) {
    fail('Guidance candidate is not valid UTF-8.', error, target)
  }
  if (opened.bytes.length >= 3 && opened.bytes[0] === 0xef && opened.bytes[1] === 0xbb && opened.bytes[2] === 0xbf) {
    fail('Guidance candidate contains a byte-order mark.', undefined, target)
  }
  if (opened.bytes.includes(0)) {
    fail('Guidance candidate contains NUL.', undefined, target)
  }

  return { ...opened, path: target, text }
}

function inspectDirectory(root, target, visitor, options = {}) {
  const directory = candidatePath(root, target)
  let entries
  try {
    entries = enumerateDirectory(directory, options)
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.code === 'ENOENT') {
      return
    }
    fail('Guidance directory discovery failed.', error, error?.code === 'invalid-directory-name' ? null : target === '' ? null : target)
  }
  for (const entry of entries) {
    const child = target === '' ? entry.name : `${target}/${entry.name}`
    if (entry.metadata.isDirectory()) {
      inspectDirectory(root, child, visitor, options)
    } else {
      visitor(child)
    }
  }
}

function maskRange(characters, start, end) {
  for (let index = start; index < end; index += 1) {
    if (characters[index] !== '\n' && characters[index] !== '\r') {
      characters[index] = ' '
    }
  }
}

const RAW_HTML_BLOCK_TAGS = '(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|h1|h2|h3|h4|h5|h6|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|ol|p|pre|script|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)'

function rawHtmlBlockStart(line) {
  if (/^ {0,3}<!--/.test(line)) {
    return { kind: 'comment', terminator: /-->/ }
  }
  if (/^ {0,3}<\?/.test(line)) {
    return { kind: 'processing', terminator: /\?>/ }
  }
  if (/^ {0,3}<!\[CDATA\[/.test(line)) {
    return { kind: 'cdata', terminator: /\]\]>/ }
  }
  if (/^ {0,3}<![A-Z]/.test(line)) {
    return { kind: 'declaration', terminator: />/ }
  }
  if (/^ {0,3}<(?:script|pre|style|textarea)(?:\s|>|$)/i.test(line)) {
    return { kind: 'tag', terminator: /<\/(?:script|pre|style|textarea)\s*>/i, lineTerminated: true }
  }
  if (new RegExp(`^ {0,3}</?${RAW_HTML_BLOCK_TAGS}(?:\\s|>|$)`, 'i').test(line)) {
    return { kind: 'blank', lineTerminated: true }
  }
  if (/^ {0,3}<\/?[A-Za-z][A-Za-z0-9-]*\b[^>]*>/.test(line)) {
    return { kind: 'blank', lineTerminated: true }
  }

  return null
}

function maskMarkdownCodeAndHtml(text) {
  const masked = text.split('')
  let lineStart = 0
  let fence = null
  let rawBlock = null
  while (lineStart < text.length) {
    const newline = text.indexOf('\n', lineStart)
    const lineEnd = newline < 0 ? text.length : newline
    const line = text.slice(lineStart, lineEnd)
    if (fence !== null) {
      const closing = new RegExp(`^ {0,3}${fence.character}{${fence.length},}[ \\t]*$`).test(line)
      maskRange(masked, lineStart, lineEnd)
      if (closing) {
        fence = null
      }
    } else if (rawBlock !== null) {
      if (rawBlock.kind === 'blank' && /^[ \t]*$/.test(line)) {
        rawBlock = null
      } else {
        maskRange(masked, lineStart, lineEnd)
        if (rawBlock.terminator?.test(line) === true) {
          rawBlock = null
        }
      }
    } else {
      const opening = /^ {0,3}(`{3,}|~{3,})/.exec(line)
      if (opening !== null) {
        maskRange(masked, lineStart, lineEnd)
        fence = { character: opening[1][0], length: opening[1].length }
      } else if (/^(?: {4}|\t)/.test(line)) {
        maskRange(masked, lineStart, lineEnd)
      } else {
        rawBlock = rawHtmlBlockStart(line)
        if (rawBlock !== null) {
          maskRange(masked, lineStart, lineEnd)
          if (rawBlock.terminator?.test(line) === true) {
            rawBlock = null
          }
        }
      }
    }
    lineStart = newline < 0 ? text.length : newline + 1
  }

  for (let index = 0; index < text.length;) {
    if (masked[index] !== '`') {
      index += 1
      continue
    }
    let runLength = 1
    while (text[index + runLength] === '`') {
      runLength += 1
    }
    const closing = text.indexOf('`'.repeat(runLength), index + runLength)
    const end = closing < 0 ? text.indexOf('\n', index + runLength) : closing + runLength
    maskRange(masked, index, end < 0 ? text.length : end)
    index = end < 0 ? text.length : end
  }

  for (let index = 0; index < text.length;) {
    if (text[index] !== '<' || masked[index] === ' ') {
      index += 1
      continue
    }
    const commentEnd = text.indexOf('-->', index + 4)
    if (text.startsWith('<!--', index)) {
      const end = commentEnd >= 0 ? commentEnd + 3 : text.length
      maskRange(masked, index, end)
      index = end
      continue
    }
    const tag = /^<\/?([A-Za-z][A-Za-z0-9:-]*)\b[^>]*>/.exec(text.slice(index))
    if (tag === null) {
      index += 1
      continue
    }
    const tagEnd = index + tag[0].length
    const closingTag = tag[0][1] === '/' || /\/\s*>$/.test(tag[0])
    let end = tagEnd
    if (!closingTag) {
      const closing = new RegExp(`</${tag[1]}\\s*>`, 'i').exec(text.slice(tagEnd))
      if (closing !== null) {
        end = tagEnd + closing.index + closing[0].length
      }
    }
    maskRange(masked, index, end)
    index = end
  }

  return masked.join('')
}

function guidanceImports(text) {
  const imports = []
  const source = maskMarkdownCodeAndHtml(text)
  const pattern = /(?:^|[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff])@([^\s\\]+(?:\\ [^\s\\]+)*)/gu
  for (const match of source.matchAll(pattern)) {
    let value = match[1].replaceAll('\\ ', ' ')
    const fragment = value.indexOf('#')
    if (fragment >= 0) {
      value = value.slice(0, fragment)
    }
    if (value.length !== 0) {
      imports.push(value)
    }
  }

  return imports
}

function canonicalImport(root, source, token) {
  if (token.startsWith('~/')) {
    token = resolve(require('node:os').homedir(), token.slice(2))
  } else if (token.startsWith('~')) {
    fail('Guidance import uses an unsupported tilde form.', undefined, source)
  } else if (!token.startsWith('/')) {
    token = resolve(root, dirname(source), ...token.split('/'))
  }
  try {
    return relativeTarget(root, realpathSync.native(token))
  } catch (error) {
    fail('Guidance import target is missing or outside the repository.', error, source)
  }
}

function isRecognizedAdapter(target) {
  return target === 'CLAUDE.md' || target === 'AGENTS.md' || target.endsWith('/CLAUDE.md') || target.endsWith('/AGENTS.md')
}

function validCodexBasename(name, options) {
  const pathModule = options.platform === 'win32' ? require('node:path').win32 : require('node:path')
  if (typeof name !== 'string' || name.length === 0 || name === 'AGENTS.override.md' || name === 'AGENTS.md') {
    return false
  }
  if (name !== name.normalize('NFC') || name.includes('/') || name.includes('\\') || /^[A-Za-z]:/.test(name) || pathModule.isAbsolute(name) || pathModule.basename(name) !== name || (options.platform === 'win32' && /[ .]$/.test(name))) {
    return false
  }
  try {
    assertSafeWindowsScalar(name, options.platform)
  } catch {
    return false
  }

  return true
}

function validCodexInvocationDirectory(root, invocation, options) {
  if (invocation === '.') {
    return true
  }
  if (typeof invocation !== 'string' || invocation.length === 0 || invocation !== invocation.normalize('NFC') || invocation.includes('\\') || /^[A-Za-z]:/.test(invocation) || invocation.startsWith('/') || invocation.split('/').some((part) => part.length === 0 || part === '.' || part === '..')) {
    return false
  }
  try {
    assertSafeWindowsScalar(invocation, options.platform)
    const absolute = candidatePath(root, invocation)
    const directory = require('node:fs').lstatSync(absolute, { bigint: true })
    if (!directory.isDirectory() || directory.isSymbolicLink()) {
      return false
    }
    const physical = realpathSync.native(absolute)
    if (!pathIsContained(root, physical)) {
      return false
    }
    const canonical = relative(root, physical).replaceAll('\\', '/')
    return compareOrdinal(canonical, invocation) === 0
  } catch {
    return false
  }
}

function scanClaudeGraph(root, startTargets, options = {}) {
  const graph = new Map()
  const imports = []
  const visiting = new Set()
  const visited = new Set()
  function visit(target, depth, adapterCandidate) {
    if (visiting.has(target)) {
      fail('Guidance import cycle detected.', undefined, target)
    }
    if (visited.has(target)) {
      return
    }
    if (depth > MAX_IMPORT_DEPTH) {
      fail('Guidance import depth exceeds the supported limit.', undefined, target)
    }
    const file = readCandidate(root, target)
    if (file === null) {
      fail('Guidance import target is missing.', undefined, target)
    }
    visiting.add(target)
    visited.add(target)
    graph.set(target, file)
    for (const token of guidanceImports(file.text)) {
      const child = canonicalImport(root, target, token)
      imports.push({ adapterCandidate: isRecognizedAdapter(child), source: target, target: child })
      visit(child, depth + 1, adapterCandidate || isRecognizedAdapter(child))
    }
    visiting.delete(target)
  }
  for (const target of startTargets) {
    visit(target, 0, options.adapterCandidate === true)
  }

  return { graph, imports }
}

function findClaudePotential(root, options = {}) {
  const paths = new Set()
  for (const target of CLAUDE_CANDIDATES) {
    if (readCandidate(root, target) !== null) {
      paths.add(target)
    }
  }
  inspectDirectory(root, '', (target) => {
    if (target !== 'CLAUDE.md' && /(?:^|\/)CLAUDE(?:\.local)?\.md$/.test(target)) {
      paths.add(target)
    }
    if (target.startsWith('.claude/rules/') && target.endsWith('.md')) {
      paths.add(target)
    }
  }, options)

  return [...paths].sort(compareOrdinal)
}

function resolveClaude(root, hostContext, options = {}) {
  const rootFile = readCandidate(root, 'CLAUDE.md')
  const status = hostContext.claudeRootExclusionStatus
  const source = hostContext.claudeContextSource
  const validContext = rootFile === null
    ? status === 'unexcluded-missing' && source === 'user-confirmed'
    : status === 'included' && source === 'host-observed'
  if (!validContext) {
    fail('Claude root guidance context does not match the filesystem.', undefined, 'CLAUDE.md')
  }
  const starts = rootFile === null ? [] : ['CLAUDE.md']
  const potential = findClaudePotential(root, options)
  const independent = potential.filter((target) => target !== 'CLAUDE.md')
  const base = starts.length === 0 ? { graph: new Map(), imports: [] } : scanClaudeGraph(root, starts)
  const independentGraph = independent.length === 0 ? { graph: new Map(), imports: [] } : scanClaudeGraph(root, independent)
  const graph = new Map([...base.graph, ...independentGraph.graph])
  const allImports = [...base.imports, ...independentGraph.imports]
  const delegatedTargets = [...new Set(base.imports.filter((item) => item.adapterCandidate).map((item) => item.target))].sort(compareOrdinal)
  if (delegatedTargets.length > 1) {
    fail('Multiple recognized Claude adapter candidates were found.', undefined, delegatedTargets[0])
  }
  const resolvedTarget = delegatedTargets[0] ?? 'CLAUDE.md'
  const graphPaths = [...graph.keys()].sort(compareOrdinal)
  const independentPaths = [...independentGraph.graph.keys()].sort(compareOrdinal)
  for (const target of graphPaths) {
    if (target === resolvedTarget) {
      continue
    }
    if (graph.get(target)?.text.includes(GUIDANCE_SECTION)) {
      fail('A non-adapter guidance source owns the controlled section.', undefined, target)
    }
  }

  return { baseAdapter: 'CLAUDE.md', candidates: [...new Set(['CLAUDE.md', ...potential])].sort(compareOrdinal), graphPaths, independentPaths, imports: allImports.sort((a, b) => compareOrdinal(`${a.source}\0${a.target}`, `${b.source}\0${b.target}`)), resolvedTarget }
}

function resolveCodex(root, hostContext, options = {}) {
  const invocation = hostContext.codexInvocationDirectory
  const parts = invocation === '.' ? [] : typeof invocation === 'string' ? invocation.split('/') : []
  const levels = ['']
  for (let index = 0; index < parts.length; index += 1) {
    levels.push(parts.slice(0, index + 1).join('/'))
  }
  const hasFallbackField = Object.prototype.hasOwnProperty.call(hostContext, 'codexProjectInstructions')
  const fallback = hasFallbackField ? hostContext.codexProjectInstructions : null
  const validFallbacks = hasFallbackField && Array.isArray(fallback) && fallback.every((item) => validCodexBasename(item, options))
  if (hostContext.claudeContextSource !== null || hostContext.claudeRootExclusionStatus !== null || hostContext.codexContextSource !== 'user-confirmed' || !Number.isSafeInteger(hostContext.codexProjectDocMaxBytes) || hostContext.codexProjectDocMaxBytes <= 0 || !validFallbacks || new Set(fallback).size !== fallback.length || !validCodexInvocationDirectory(root, invocation, options)) {
    fail('Codex guidance context is invalid.')
  }
  const graph = []
  const candidates = []
  let rootAdapter = null
  for (const level of levels) {
    const names = [...CODEX_CANDIDATES, ...fallback]
    let selected = null
    for (const name of names) {
      const target = level === '' ? name : `${level}/${name}`
      const file = readCandidate(root, target, { ...options, maxBytes: hostContext.codexProjectDocMaxBytes })
      candidates.push(target)
      if (file !== null && file.bytes.length > 0 && selected === null) {
        selected = { file, target }
      }
    }
    if (selected !== null) {
      graph.push(selected.target)
      if (level === '') {
        rootAdapter = selected.target
      }
    }
  }
  if (rootAdapter === null) {
    rootAdapter = readCandidate(root, 'AGENTS.override.md') !== null ? 'AGENTS.override.md' : 'AGENTS.md'
  }
  const graphPaths = [...new Set(graph)].sort(compareOrdinal)
  const totalBytes = graphPaths.reduce((total, target) => total + readCandidate(root, target).bytes.length, 0)
  if (totalBytes > hostContext.codexProjectDocMaxBytes) {
    fail('Codex guidance exceeds its confirmed byte limit.')
  }
  for (const target of graphPaths.filter((item) => item !== rootAdapter)) {
    if (readCandidate(root, target)?.text.includes(GUIDANCE_SECTION)) {
      fail('A non-root Codex guidance source owns the controlled section.', undefined, target)
    }
  }

  return { baseAdapter: rootAdapter, candidates: [...new Set(candidates)].sort(compareOrdinal), graphPaths, independentPaths: [], imports: [], resolvedTarget: rootAdapter }
}

function resolveGuidance(root, host, hostContext = {}, options = {}) {
  if (!['claude-code', 'codex'].includes(host)) {
    fail('Guidance host is invalid.')
  }
  let canonical
  try {
    canonical = canonicalRoot(root)
  } catch (error) {
    fail('Guidance repository root is invalid.', error)
  }
  try {
    const resolvedFilesystemOptions = filesystemOptions(options.filesystemOptions ?? hostContext.filesystemOptions ?? options)

    return host === 'claude-code' ? resolveClaude(canonical, hostContext, resolvedFilesystemOptions) : resolveCodex(canonical, hostContext, resolvedFilesystemOptions)
  } catch (error) {
    if (error instanceof InitBacklogError) {
      throw error
    }
    fail('Guidance resolution failed.', error)
  }
}

function discoverControlledMarkdown(root, directories = ['.claude/bugs', '.claude/features', '.claude/patterns'], options = {}) {
  let canonical
  try {
    canonical = canonicalRoot(root)
  } catch (error) {
    throwInitBacklogError({ code: 'filesystem', detail: 'Controlled discovery root is invalid.', operation: 'inspect', phase: 'inspect' }, error)
  }
  const discovered = []
  const identities = new Set()
  const resolvedOptions = filesystemOptions(options)
  function walk(directory) {
    let entries
    try {
      entries = enumerateDirectory(directory, resolvedOptions)
    } catch (error) {
      throwInitBacklogError({ code: error?.code === 'invalid-directory-name' ? 'invalid-target' : 'filesystem', detail: 'Controlled directory discovery failed.', operation: 'inspect', phase: 'inspect', target: error?.code === 'invalid-directory-name' ? null : undefined }, error)
    }
    for (const entry of entries) {
      if (entry.name.includes('\\')) {
        throwInitBacklogError({ code: 'invalid-target', detail: 'Controlled target cannot contain a backslash.', operation: 'inspect', phase: 'inspect' })
      }
      if (entry.metadata.isDirectory()) {
        walk(entry.path)
        continue
      }
      if (!entry.name.endsWith('.md')) {
        continue
      }
      const target = relativeTarget(canonical, entry.path)
      let opened
      try {
        opened = stableOpenFile(canonical, entry.path, { ...resolvedOptions, requireSingleLink: true })
      } catch (error) {
        throwInitBacklogError({ code: 'filesystem', detail: 'Controlled target cannot be stably read.', operation: 'inspect', phase: 'inspect', target }, error)
      }
      if (identities.has(opened.identity)) {
        throwInitBacklogError({ code: 'filesystem', detail: 'Controlled targets share a physical identity.', operation: 'inspect', phase: 'inspect', target })
      }
      identities.add(opened.identity)
      discovered.push({ applicability: 'always', conceptIds: [], identity: opened.identity, kind: 'file', mode: opened.mode, path: entry.path, regions: [], target, templateRule: null, bytes: opened.bytes, rawSha256: opened.rawSha256 })
    }
  }
  for (const directory of directories) {
    const absolute = candidatePath(canonical, directory)
    try {
      const metadata = require('node:fs').lstatSync(absolute, { bigint: true })
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
        throw new Error('Controlled directory is not ordinary')
      }
      walk(absolute)
    } catch (error) {
      if (error !== null && typeof error === 'object' && error.code === 'ENOENT') {
        continue
      }
      if (error instanceof InitBacklogError) {
        throw error
      }
      throwInitBacklogError({ code: error?.code === 'invalid-directory-name' ? 'invalid-target' : 'filesystem', detail: 'Controlled directory is invalid.', operation: 'inspect', phase: 'inspect', target: error?.code === 'invalid-directory-name' ? null : directory }, error)
    }
  }

  return discovered.sort((left, right) => compareOrdinal(left.target, right.target))
}

module.exports = { GUIDANCE_SECTION, discoverControlledMarkdown, guidanceImports, resolveClaude, resolveCodex, resolveGuidance }
