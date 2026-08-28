'use strict'

const { randomBytes } = require('node:crypto')
const { TextDecoder } = require('node:util')
const { lstatSync, readFileSync, readdirSync } = require('node:fs')
const { join } = require('node:path')
const { detectHardWraps, unwrapText } = require('../unwrap')
const { analyzeCatalog } = require('../../ready/ready')
const { BACKLOG_DIRECTORY_TARGETS, PLANS_DIRECTORY_TARGET, loadManifest } = require('./assets')
const { inspectBackups } = require('./backups')
const { InitBacklogError, failureRecord } = require('./errors')
const { HTML_BLOCK_TYPE_SIX_TAGS, discoverControlledMarkdown, resolveGuidance } = require('./guidance')
const { canonicalRoot, comparableMode, createInitialLock, initialLockPaths, removeInitialLock, stableOpenFile } = require('./filesystem')
const { DIGEST_PATTERN, RECOVERY_LOCK_BASENAME, RECOVERY_MARKER_BASENAME, canonicalJson, compareOrdinal, deriveProposalId, deriveSnapshotId, sameKeys, sha256 } = require('./protocol')
const { detectGitKind, inspectGitPolicy, newlineStyle } = require('./git-policy')

function inspectError(code, detail, target = null, cause, phase = 'inspect') {
  throw new InitBacklogError(failureRecord({ code, detail, operation: 'inspect', phase, target }), cause === undefined ? undefined : { cause })
}

function lineRecords(bytes) {
  const records = []
  const bomLength = bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) ? 3 : 0
  let start = bomLength
  while (start < bytes.length) {
    let end = start
    while (end < bytes.length && bytes[end] !== 0x0a && bytes[end] !== 0x0d) end += 1
    let rawEnd = end
    if (bytes[end] === 0x0d && bytes[end + 1] === 0x0a) rawEnd += 2
    else if (end < bytes.length) rawEnd += 1
    records.push({ content: bytes.subarray(start, end).toString('utf8'), rawEnd, rawStart: start })
    start = rawEnd
  }

  return { bomLength, records }
}

const HTML_BLOCK_TYPE_SIX_START = new RegExp(`^<(?:${HTML_BLOCK_TYPE_SIX_TAGS.join('|')})(?:\\s|>)`, 'i')

function htmlBlockStart(line) {
  const match = line.match(/^ {0,3}(.*)$/)
  if (match === null) return null
  const trimmed = match[1]
  if (trimmed.startsWith('<!--')) return { terminator: '-->' }
  if (trimmed.startsWith('<?')) return { terminator: '?>' }
  if (trimmed.startsWith('<![CDATA[')) return { terminator: ']]>' }
  if (/^<![A-Z]/.test(trimmed)) return { terminator: '>' }
  const typeOne = trimmed.match(/^<(script|pre|style|textarea)(?:\s|>)/i)
  if (typeOne) return { terminator: '</', tag: typeOne[1] }
  if (HTML_BLOCK_TYPE_SIX_START.test(trimmed)) return { blank: true }
  if (/^<\/?[A-Za-z][A-Za-z0-9-]*(?:\s+[^<>]*)?\s*\/?>/.test(trimmed)) return { blank: true }

  return null
}

function maskedRecords(bytes) {
  const parsed = lineRecords(bytes)
  const masked = new Set()
  let fence = null
  let html = null
  let opaqueStartIndex = null
  parsed.records.forEach((record, index) => {
    const line = record.content
    const opener = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
    if (fence !== null) {
      masked.add(index)
      const closer = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/)
      if (closer && closer[1][0] === fence[0] && closer[1].length >= fence[1]) fence = null
      return
    }
    if (opener) {
      if (opener[1][0] === '`' && opener[2].includes('`')) return
      masked.add(index)
      fence = [opener[1][0], opener[1].length]
      opaqueStartIndex = index
      return
    }
    if (html !== null) {
      if (html.blank && line.trim() === '') {
        html = null
        return
      }
      masked.add(index)
      if (html.terminator === '</' ? new RegExp(`</${html.tag}\\s*>`, 'i').test(line) : line.includes(html.terminator)) html = null
      return
    }
    const block = htmlBlockStart(line)
    if (block) {
      masked.add(index)
      if (block.terminator === '</' && !new RegExp(`</${block.tag}\\s*>`, 'i').test(line)) html = block
      else if (block.terminator && !line.includes(block.terminator)) html = block
      else if (block.blank && line.trim() !== '') html = block
      if (html !== null) opaqueStartIndex = index
    }
  })

  return { ...parsed, masked, opaqueStartIndex, opaqueUnclosed: fence !== null || html !== null }
}

function inspectRegions(source, declarations = []) {
  const bytes = Buffer.isBuffer(source) ? source : Buffer.from(source ?? '', 'utf8')
  const payload = bytes.subarray(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) ? 3 : 0)
  new TextDecoder('utf-8', { fatal: true }).decode(payload)
  const parsed = maskedRecords(bytes)
  if (bytes.length === parsed.bomLength) return declarations.filter((item) => item.syntax === 'empty-document').map((item) => ({ endByte: parsed.bomLength, regionId: item.regionId, startByte: parsed.bomLength }))
  const headings = []
  parsed.records.forEach((record, index) => {
    if (parsed.masked.has(index)) return
    const atx = record.content.match(/^ {0,3}(#{1,6})(?:[ \t]+|$)(.*?)[ \t]*#*[ \t]*$/)
    if (atx) headings.push({ index, level: atx[1].length, rawStart: record.rawStart })
    const next = parsed.records[index + 1]
    if (next !== undefined && !parsed.masked.has(index + 1) && record.content.trim() !== '' && /^ {0,3}(=+|-+)[ \t]*$/.test(next.content)) {
      headings.push({ index, level: next.content.trimStart()[0] === '=' ? 1 : 2, rawStart: record.rawStart })
    }
  })
  const regions = []
  const opaqueBoundaryLevel = (index) => {
    const record = parsed.records[index]
    const atx = record.content.match(/^ {0,3}(#{1,6})(?:[ \t]+|$)/)
    if (atx !== null) return atx[1].length
    const next = parsed.records[index + 1]
    if (next !== undefined && record.content.trim() !== '' && /^ {0,3}(=+|-+)[ \t]*$/.test(next.content)) return next.content.trimStart()[0] === '=' ? 1 : 2

    return null
  }
  const opaqueHidesBoundary = (declaration, matches) => {
    if (!parsed.opaqueUnclosed || parsed.opaqueStartIndex === null) return false
    if (matches.length === 0) {
      return parsed.records.slice(parsed.opaqueStartIndex + 1).some((record, offset) => {
        const level = opaqueBoundaryLevel(parsed.opaqueStartIndex + 1 + offset)
        if (level === null) return false
        if (declaration.missingPlacement === 'start') return true

        return new RegExp(`^ {0,3}${declaration.heading.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}(?:[ \\t]+|$)`).test(record.content)
      })
    }
    const matchIndex = matches[0]
    if (matchIndex >= parsed.opaqueStartIndex) return true
    const level = declaration.heading.match(/^#+/)?.[0].length ?? 1
    return parsed.records.slice(parsed.opaqueStartIndex + 1).some((record, offset) => {
      const headingLevel = opaqueBoundaryLevel(parsed.opaqueStartIndex + 1 + offset)

      return headingLevel !== null && (declaration.syntax === 'markdown-preamble' || headingLevel <= level)
    })
  }
  for (const declaration of declarations) {
    if (declaration.syntax === 'empty-document') continue
    if (declaration.syntax === 'gitignore-append') {
      regions.push({ endByte: bytes.length, regionId: declaration.regionId, startByte: bytes.length })
      continue
    }
    const matches = []
    parsed.records.forEach((record, index) => {
      if (!parsed.masked.has(index) && new RegExp(`^ {0,3}${declaration.heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`).test(record.content)) matches.push(index)
    })
    if (opaqueHidesBoundary(declaration, matches)) {
      const error = new Error('Opaque Markdown block obscures a required boundary')
      error.code = 'structural-invalid'
      throw error
    }
    if (matches.length > 1) {
      const error = new Error(`Heading is not unique: ${declaration.heading}`)
      error.code = 'structural-invalid'
      throw error
    }
    if (matches.length === 0) {
      if (declaration.missingPlacement === 'end') regions.push({ endByte: bytes.length, regionId: declaration.regionId, startByte: bytes.length })
      if (declaration.missingPlacement === 'start') {
        const boundary = headings.find((heading) => declaration.syntax === 'markdown-preamble' || heading.level <= (declaration.heading.match(/^#+/)?.[0].length ?? 1))
        if (boundary === undefined || boundary.rawStart !== parsed.bomLength) {
          const error = new Error('Start insertion would absorb uncontrolled content')
          error.code = 'structural-invalid'
          throw error
        }
        regions.push({ endByte: parsed.bomLength, regionId: declaration.regionId, startByte: parsed.bomLength })
      }
      continue
    }
    const index = matches[0]
    const level = declaration.heading.match(/^#+/)?.[0].length ?? 1
    const boundary = headings.find((heading) => heading.rawStart > parsed.records[index].rawStart && (declaration.syntax === 'markdown-preamble' || heading.level <= level))
    const endByte = boundary?.rawStart ?? bytes.length
    regions.push({ endByte, regionId: declaration.regionId, startByte: parsed.records[index].rawStart })
  }

  return regions.sort((left, right) => compareOrdinal(left.regionId, right.regionId))
}

function decodeText(source) {
  const bytes = Buffer.isBuffer(source) ? source : Buffer.from(source ?? '', 'utf8')
  const bom = bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))
  const payload = bom ? bytes.subarray(3) : bytes
  if (payload.includes(0)) throw new Error('Content contains NUL')
  const text = new TextDecoder('utf-8', { fatal: true }).decode(payload)

  return { bom, bytes, logicalBytes: Buffer.from(text, 'utf8'), style: newlineStyle(payload), text }
}

function materializeText(source, startByte, endByte, fragment, options = {}) {
  const bytes = Buffer.isBuffer(source) ? source : Buffer.from(source ?? '', 'utf8')
  const selected = options.newline ?? newlineStyle(bytes)
  const value = Buffer.isBuffer(fragment) ? fragment.toString('utf8') : String(fragment ?? '')
  const logical = value.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
  const rendered = selected === 'crlf' ? logical.replaceAll('\n', '\r\n') : logical

  return Buffer.concat([bytes.subarray(0, startByte), Buffer.from(rendered, 'utf8'), bytes.subarray(endByte)])
}

const READY_INDEX_TARGETS = new Set(['BUGS.md', 'BUGS_HISTORY.md', 'FEATURES.md', 'FEATURES_HISTORY.md', 'PATTERNS.md', 'QUICK_WINS.md', 'QUICK_WINS_HISTORY.md'])

function isReadyCatalogTarget(target) {
  if (READY_INDEX_TARGETS.has(target)) return true
  if (typeof target !== 'string' || target.includes('\\') || target.startsWith('/') || target.includes('//')) return false
  const parts = target.split('/')
  if (parts.length < 2 || !['features', 'bugs', 'patterns'].includes(parts[0]) || !parts.at(-1).endsWith('.md')) return false

  return parts.every((part) => part.length > 0 && part !== '.' && part !== '..')
}

function buildReadyCatalog(entries) {
  if (!Array.isArray(entries)) throw new TypeError('Ready catalog entries are invalid')
  const result = []
  const seen = new Set()
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.target !== 'string' || typeof entry.contents !== 'string') continue
    const target = entry.target.startsWith('.claude/') ? entry.target.slice('.claude/'.length) : entry.target
    if (!isReadyCatalogTarget(target)) continue
    if (seen.has(target)) throw new TypeError('Ready catalog target is duplicated')
    seen.add(target)
    result.push({ contents: entry.contents, target })
  }

  return result.sort((left, right) => compareOrdinal(left.target, right.target))
}

function projectReadyProblems(ready, catalog = []) {
  if (ready === null || typeof ready !== 'object') throw new TypeError('Ready result is invalid')
  if (!Array.isArray(catalog)) throw new TypeError('Ready catalog is invalid')
  if (Object.hasOwn(ready, 'legacyHistory') || Object.hasOwn(ready, 'legacy')) throw new Error('Legacy history evidence must come from the parser sidecar')
  const parserCatalog = buildReadyCatalog(catalog)
  const catalogTargets = new Set(parserCatalog.map((item) => item.target))
  let parserEvidence
  try {
    parserEvidence = analyzeCatalog(parserCatalog).evidence
  } catch (error) {
    throw new Error('Ready parser evidence could not be reproduced', { cause: error })
  }
  if (ready.evidence === null || typeof ready.evidence !== 'object' || Array.isArray(ready.evidence)) throw new Error('Ready evidence sidecar is invalid')
  if (canonicalJson(ready.evidence) !== canonicalJson(parserEvidence)) throw new Error('Ready evidence sidecar does not match the parser-owned identity sequence')
  const evidenceTarget = (value) => {
    if (typeof value !== 'string' || value.startsWith('.claude/') || value.includes('\\') || !isReadyCatalogTarget(value) || !catalogTargets.has(value)) throw new Error('Ready evidence path is outside the parser catalog')

    return `.claude/${value}`
  }
  const legacyEvidenceTarget = (value) => {
    if (typeof value !== 'string' || !value.startsWith('.claude/') || value.includes('\\')) throw new Error('Legacy history evidence path is not parser-owned')
    const target = value.slice('.claude/'.length)
    if (!isReadyCatalogTarget(target) || !catalogTargets.has(target)) throw new Error('Legacy history evidence path is outside the parser catalog')

    return value
  }
  const problems = []
  const evidence = ready.evidence
  if (!sameKeys(evidence, ['legacyHistory', 'notices', 'structuralErrors'])) throw new Error('Ready evidence sidecar is invalid')
  const evidenceItems = (category, index) => {
    const items = evidence[category]
    if (!Array.isArray(items) || items.length !== (category === 'structuralErrors' ? (ready.structuralErrors ?? []).length : (ready.notices ?? []).length) || !sameKeys(items[index], ['evidencePaths', 'kind', 'ordinal']) || items[index].kind !== category || items[index].ordinal !== index || !Array.isArray(items[index].evidencePaths)) throw new Error('Ready evidence sidecar is invalid')
    if (items[index].evidencePaths.some((path, pathIndex) => typeof path !== 'string' || pathIndex > 0 && compareOrdinal(items[index].evidencePaths[pathIndex - 1], path) >= 0)) throw new Error('Ready evidence sidecar paths are not ordered')

    return items[index].evidencePaths
  }
  for (const [index, item] of (ready.structuralErrors ?? []).entries()) {
    const evidencePaths = []
    const sidecarPaths = evidenceItems('structuralErrors', index)
    evidencePaths.push(...sidecarPaths.map(evidenceTarget))
    const unique = [...new Set(evidencePaths)].sort(compareOrdinal)
    if (unique.length === 0) throw new Error('Ready structural error lacks confined evidence')
    problems.push({ blocking: true, code: 'ready-structural', detail: item.problem, evidencePaths: unique, target: null })
  }
  for (const [index, notice] of (ready.notices ?? []).entries()) {
    const sidecarPaths = evidenceItems('notices', index)
    const evidencePaths = sidecarPaths.map(evidenceTarget)
    const target = evidencePaths.length === 1 ? evidencePaths[0] : null
    problems.push({ blocking: false, code: 'ready-notice', detail: notice, evidencePaths, target })
  }
  const legacyItems = evidence.legacyHistory
  if (legacyItems.some((item, index) => !sameKeys(item, ['historyPath', 'indexPath']) || typeof item.indexPath !== 'string' || typeof item.historyPath !== 'string' || index > 0 && compareOrdinal(`${legacyItems[index - 1].indexPath}\0${legacyItems[index - 1].historyPath}`, `${item.indexPath}\0${item.historyPath}`) >= 0)) throw new Error('Legacy history evidence is invalid')
  for (const item of legacyItems) {
    const indexPath = legacyEvidenceTarget(item.indexPath)
    const historyPath = item.historyPath
    const expectedHistory = { '.claude/BUGS.md': '.claude/BUGS_HISTORY.md', '.claude/FEATURES.md': '.claude/FEATURES_HISTORY.md', '.claude/QUICK_WINS.md': '.claude/QUICK_WINS_HISTORY.md' }[indexPath]
    if (expectedHistory !== historyPath || !historyPath.startsWith('.claude/') || !isReadyCatalogTarget(historyPath.slice('.claude/'.length))) throw new Error('Legacy history evidence is invalid')
    problems.push({ blocking: false, code: 'legacy-history-migration', detail: 'Legacy entries require user-directed migration.', evidencePaths: [indexPath], target: historyPath })
  }
  const noticeCount = (ready.notices ?? []).length
  const noticeEvidence = noticeCount === 1 ? evidenceItems('notices', 0) : []
  const warningTarget = noticeCount === 1 && noticeEvidence.length === 1 ? evidenceTarget(noticeEvidence[0]) : null
  const warnings = noticeCount === 0 ? [] : [{ code: 'nonblocking-ready-notice', detail: noticeCount === 1 ? '1 ready notice remains.' : `${noticeCount} ready notices remain.`, target: warningTarget }]

  return { problems, warnings: warnings.sort((left, right) => compareOrdinal(left.code, right.code)) }
}

function projectGitProblems(git) {
  if (git === null || typeof git !== 'object' || git.kind !== 'git') return []
  const problems = []
  if (git.plansPolicy !== 'satisfied' && git.plansPolicy !== 'not-applicable') {
    const evidencePaths = ['.gitignore', ...git.trackedPlanPaths, ...git.nonPlanUnignoredPaths].sort(compareOrdinal)
    problems.push({ blocking: true, code: 'git-policy', detail: `Git plans policy is ${git.plansPolicy}.`, evidencePaths: [...new Set(evidencePaths)], target: '.gitignore' })
  }
  if (git.nonPlanIgnoreMatches.length > 0) {
    const evidencePaths = git.nonPlanIgnoreMatches.flatMap((item) => [item.target, item.probe]).sort(compareOrdinal)
    problems.push({ blocking: true, code: 'git-policy', detail: 'Repository-local ignore rules match non-plan backlog paths.', evidencePaths: [...new Set(evidencePaths)], target: '.gitignore' })
  }
  if (git.nonPlanUnignoredPaths.length > 0 && git.electionRequired) {
    problems.push({ blocking: true, code: 'git-policy', detail: 'Fresh Git scaffold requires a track, ignore, or deferred election.', evidencePaths: git.nonPlanUnignoredPaths.slice(), target: null })
  }

  return problems
}

function composeElectionRecord(state, root, snapshotId) {
  if (!['deferred', 'ignore', 'track'].includes(state) || typeof root !== 'string' || !DIGEST_PATTERN.test(snapshotId)) throw new TypeError('Election record fields are invalid')

  return { protocolVersion: 1, root, snapshotId, state }
}

function composeElectionMarker(electionMarker, gitKind, scaffoldPresent, digest, mode = null, root = '') {
  if (!['deferred', 'track', 'ignore'].includes(electionMarker) || !['git', 'non-git'].includes(gitKind) || typeof digest !== 'string' || !DIGEST_PATTERN.test(digest) || typeof root !== 'string') throw new TypeError('Election marker fields are invalid')
  const content = Buffer.from(`${canonicalJson(composeElectionRecord(electionMarker, root, digest))}\n`, 'utf8')

  return { classification: gitKind === 'git' ? 'invalid' : 'valid-non-git', contentBase64: content.toString('base64'), gitKind, mode, policyDigest: digest, scaffoldPresent: scaffoldPresent === true }
}

function validateElectionMarkerRecord(value, root) {
  return sameKeys(value, ['protocolVersion', 'root', 'snapshotId', 'state']) && value.protocolVersion === 1 && value.root === root && ['deferred', 'track', 'ignore'].includes(value.state) && typeof value.snapshotId === 'string' && DIGEST_PATTERN.test(value.snapshotId)
}

function readElectionMarker(root, options = {}) {
  const path = join(root, RECOVERY_MARKER_BASENAME)
  let metadata
  let stable = null
  try {
    if (options.lstatSync === undefined && options.readFileSync === undefined) {
      stable = stableOpenFile(root, path, { ...options, requireSingleLink: true })
      metadata = { mode: stable.mode }
    } else {
      metadata = (options.lstatSync ?? lstatSync)(path, { bigint: true })
    }
  } catch (error) {
    if (error?.code === 'ENOENT') return { marker: 'absent', mode: null, snapshotId: null, path }
    throw new Error('Election marker metadata failed', { cause: error })
  }
  if (stable === null && (!metadata.isFile() || metadata.isSymbolicLink())) throw new Error('Election marker is not an ordinary file')
  const bytes = stable?.bytes ?? (options.readFileSync ?? readFileSync)(path)
  let value
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    if (!text.endsWith('\n') || text.slice(0, -1).includes('\n')) throw new Error('Election marker line is invalid')
    value = JSON.parse(text.slice(0, -1))
    if (canonicalJson(value) !== text.slice(0, -1)) throw new Error('Election marker is not canonical')
  } catch (error) {
    throw new Error('Election marker is malformed', { cause: error })
  }
  if (!validateElectionMarkerRecord(value, root)) throw new Error('Election marker schema is invalid')

  const mode = stable?.mode ?? comparableMode(metadata, options.platform)

  return { marker: value.state, mode, path, snapshotId: value.snapshotId }
}

function discoverInitialLockStages(root, options = {}) {
  let names
  try {
    names = (options.readdirSync ?? readdirSync)(root, { encoding: 'utf8' })
  } catch (error) {
    inspectError('runtime-lock', 'Inspection lock residue cannot be enumerated.', null, error, 'lock')
  }
  const candidates = names.filter((name) => /^\.nightshift-init-backlog\.lock\.[1-9][0-9]*\.[a-f0-9]{32}\.new$/.test(name)).sort(compareOrdinal)
  return candidates.map((name) => {
    const path = join(root, name)
    try {
      const opened = stableOpenFile(root, path, { ...options, requireSingleLink: true })

      return { name, opened, path }
    } catch (error) {
      inspectError('runtime-lock', 'Orphan initial lock stage cannot be trusted.', name, error, 'lock')
    }
  })
}

function creationMode(kind, options = {}) {
  if ((options.platform ?? process.platform) === 'win32') return null
  const umask = options.umask ?? process.umask()
  if (!Number.isInteger(umask) || umask < 0 || umask > 0o777) throw new Error('Filesystem umask is invalid')
  const base = kind === 'directory' ? 0o777 : 0o666
  const mode = (base & ~umask) & 0o7777
  if (kind === 'directory' ? (mode & 0o700) !== 0o700 : (mode & 0o600) !== 0o600) throw new Error('Filesystem creation mode lacks owner permissions')

  return mode
}

function targetPath(root, target) {
  return join(root, ...target.split('/'))
}

function targetState(target, root, options = {}) {
  const absolute = targetPath(root, target)
  let metadata
  try {
    metadata = (options.lstatSync ?? lstatSync)(absolute, { bigint: true })
  } catch (error) {
    if (error?.code === 'ENOENT') {
      const kind = options.expectedKind ?? 'file'

      return { kind, mode: creationMode(kind, options), path: absolute, present: false }
    }
    inspectError('filesystem', 'Inspected target metadata failed.', target, error)
  }
  if (metadata.isSymbolicLink() || (!metadata.isFile() && !metadata.isDirectory())) inspectError('filesystem', 'Inspected target is not an ordinary object.', target)
  if (options.expectedKind !== undefined && (options.expectedKind === 'file' ? !metadata.isFile() : !metadata.isDirectory())) inspectError('filesystem', 'Inspected target kind does not match its declaration.', target)
  if (metadata.isDirectory()) return { kind: 'directory', metadata, mode: comparableMode(metadata, options.platform), path: absolute, present: true }
  try {
    return { ...stableOpenFile(root, absolute, { ...options, requireSingleLink: true }), kind: 'file', metadata, path: absolute, present: true }
  } catch (error) {
    inspectError('filesystem', 'Inspected target cannot be stably read.', target, error)
  }
}

function targetRecord(target, descriptor, declaration, template, options = {}) {
  if (!descriptor.present) return { bom: null, cleanTextSha256: null, contentBase64: null, contentRole: 'none', editableRegions: [], finalNewline: null, kind: declaration.kind, mode: options.platform === 'win32' ? null : descriptor.mode ?? null, newline: null, rawSha256: null, states: ['missing'], target, templateId: template?.templateId ?? null, templateSha256: template?.logicalSha256 ?? null }
  if (descriptor.kind === 'directory') return { bom: null, cleanTextSha256: null, contentBase64: null, contentRole: 'none', editableRegions: [], finalNewline: null, kind: 'directory', mode: options.platform === 'win32' ? null : descriptor.mode ?? null, newline: null, rawSha256: null, states: ['present'], target, templateId: null, templateSha256: null }
  let decoded
  try {
    decoded = (options.decode ?? decodeText)(descriptor.bytes)
  } catch (error) {
    inspectError('content-invalid', 'Inspected target text is invalid.', target, error)
  }
  let editableRegions
  let boundaryInvalid = false
  try {
    editableRegions = inspectRegions(descriptor.bytes, declaration.regions)
  } catch (error) {
    if (error?.code === 'structural-invalid') {
      boundaryInvalid = true
      editableRegions = []
    } else {
      inspectError('content-invalid', 'Controlled region boundary is invalid.', target, error)
    }
  }
  const hasForbiddenMissing = decoded.logicalBytes.length !== 0 && declaration.regions.some((item) => item.missingPlacement === 'forbidden' && item.syntax !== 'empty-document' && !editableRegions.some((region) => region.regionId === item.regionId))
  const states = ['present']
  if (template && decoded.logicalBytes.equals(template.logicalBytes)) states.push('exact-template')
  if (detectHardWraps(decoded.text).length > 0) states.push('wrapped')
  if (hasForbiddenMissing || boundaryInvalid) {
    states.push('structurally-invalid')
    editableRegions = []
  }

  return { bom: decoded.bom, cleanTextSha256: options.gitKind === 'git' ? sha256(decoded.logicalBytes) : null, contentBase64: declaration.contentRole === 'mechanical' ? null : descriptor.bytes.toString('base64'), contentRole: declaration.contentRole, editableRegions, finalNewline: decoded.logicalBytes.length > 0 && decoded.logicalBytes.at(-1) === 0x0a, kind: 'file', mode: options.platform === 'win32' ? null : descriptor.mode, newline: decoded.style, rawSha256: descriptor.rawSha256, states, target, templateId: template?.templateId ?? null, templateSha256: template?.logicalSha256 ?? null }
}

function proposal(reason, condition, action, beforeBase64, afterBase64) {
  const actionWithoutId = { ...action }
  delete actionWithoutId.id
  const proposalId = deriveProposalId({ actionWithoutId, afterBase64, beforeBase64, condition, reason })

  return { action: { ...actionWithoutId, id: proposalId }, afterBase64, beforeBase64, condition, proposalId, reason }
}

function newlineVariants(policy) {
  if (policy?.style === 'choice-required') return [{ condition: 'newline-crlf', style: 'crlf' }, { condition: 'newline-lf', style: 'lf' }]

  return [{ condition: 'always', style: policy?.style === 'crlf' ? 'crlf' : 'lf' }]
}

function buildIgnoreProbes(root, descriptors) {
  const probes = []
  const seen = new Set()
  const add = (probe, target, plan = false, gate = false) => {
    if (seen.has(probe)) return
    seen.add(probe)
    probes.push(gate ? { gate: true, plan, probe, target } : { plan, probe, target })
  }
  for (const entry of descriptors) {
    if (!entry.target.startsWith('.claude/') || entry.target === '.claude/.gitignore') continue
    const relative = entry.target.slice('.claude/'.length)
    if (isReadyCatalogTarget(relative)) add(entry.target, entry.target)
  }
  add(PLANS_DIRECTORY_TARGET, `${PLANS_DIRECTORY_TARGET}/`, true, true)
  for (const directory of BACKLOG_DIRECTORY_TARGETS) {
    const plan = directory === PLANS_DIRECTORY_TARGET
    let selected = null
    for (let index = 0; index <= 65535; index += 1) {
      const suffix = index === 0 ? '' : `-${index}`
      const candidate = `${directory}/.nightshift-probe${suffix}.md`
      try {
        lstatSync(join(root, ...candidate.split('/')), { bigint: true })
      } catch (error) {
        if (error?.code === 'ENOENT') {
          selected = candidate
          break
        }
        throw error
      }
    }
    if (selected === null) throw new Error(`No free Git ignore probe for ${directory}`)
    add(selected, `${directory}/`, plan)
  }

  return probes.sort((left, right) => compareOrdinal(left.probe, right.probe))
}

function newlineFamily(target, resolvedGuidance) {
  if (target === resolvedGuidance) return 'guidance'
  const match = /^\.claude\/([^/]+)(?:\/|$)/.exec(target)
  if (match === null) return 'other'
  if (['features', 'bugs', 'patterns'].includes(match[1])) return match[1]
  return 'top-level'
}

function guidanceNewlineEvidence(root, guidance, options = {}) {
  const paths = [...new Set([...(guidance.graphPaths ?? []), ...(guidance.independentPaths ?? [])])]
  return paths.filter((target) => target.endsWith('.md')).map((target) => {
    const opened = stableOpenFile(root, join(root, ...target.split('/')), { ...options, requireSingleLink: false })

    return { style: newlineStyle(opened.bytes), target }
  }).filter((item) => item.style === 'lf' || item.style === 'crlf')
}

function gitignoreEntryBytes(descriptors) {
  const entry = descriptors.find((candidate) => candidate.target === '.gitignore')

  return entry?.descriptor.present ? entry.descriptor.bytes.toString('utf8') : undefined
}

function collectInspection(root, host, hostContext = {}, options = {}) {
  const canonical = canonicalRoot(root)
  let guidance
  try {
    guidance = resolveGuidance(canonical, host, hostContext, options)
  } catch (error) {
    if (error instanceof InitBacklogError) throw error
    inspectError('guidance-resolution', 'Guidance resolution failed.', null, error)
  }
  const bundle = loadManifest(options.templatesRoot)
  let git
  try {
    git = detectGitKind(canonical, options)
  } catch (error) {
    inspectError('git-policy', 'Git kind detection failed.', null, error)
  }
  let marker
  try {
    marker = readElectionMarker(canonical, options)
  } catch (error) {
    inspectError('runtime-marker', 'Election marker is invalid.', RECOVERY_MARKER_BASENAME, error)
  }
  if (git.kind === 'non-git' && marker.marker !== 'absent') inspectError('runtime-marker', 'Election marker is not valid outside Git.', RECOVERY_MARKER_BASENAME)
  const fixed = bundle.manifest.targets.filter((item) => item.applicability === 'always' || git.kind === 'git' && item.applicability === 'git-only')
  const descriptors = []
  for (const declaration of fixed) {
    const target = declaration.targetSelector === '@resolved-guidance' ? guidance.resolvedTarget : declaration.targetSelector
    const descriptor = targetState(target, canonical, { ...options, expectedKind: declaration.kind })
    const templateId = declaration.targetSelector === '@resolved-guidance' ? host === 'codex' ? 'guidance.codex' : 'guidance.claude' : declaration.templateRule
    descriptors.push({ declaration: { ...declaration, contentRole: target === '.gitignore' ? 'mechanical' : 'semantic' }, descriptor, target, template: templateId ? bundle.templates.get(templateId) : null })
  }
  for (const item of discoverControlledMarkdown(canonical, undefined, options)) descriptors.push({ declaration: { contentRole: 'mechanical', kind: 'file', regions: [] }, descriptor: item, target: item.target, template: null })
  // Decode and unwrap results are pure per byte buffer; the memos below let
  // the catalog scan, the target records, and the proposal loop share one
  // computation per target instead of re-decoding the same bytes.
  const decodedByBytes = new Map()
  const decodeTargetText = (bytes) => {
    let decoded = decodedByBytes.get(bytes)
    if (decoded === undefined) {
      decoded = decodeText(bytes)
      decodedByBytes.set(bytes, decoded)
    }

    return decoded
  }
  const unwrappedByBytes = new Map()
  const unwrapTargetText = (bytes) => {
    let unwrapped = unwrappedByBytes.get(bytes)
    if (unwrapped === undefined) {
      unwrapped = unwrapText(decodeTargetText(bytes).text)
      unwrappedByBytes.set(bytes, unwrapped)
    }

    return unwrapped
  }
  const catalog = []
  const wrapFindings = []
  const predictedCatalogContents = new Map()
  for (const entry of descriptors) {
    if (!entry.descriptor.present || entry.descriptor.kind !== 'file') continue
    const target = entry.target.startsWith('.claude/') ? entry.target.slice('.claude/'.length) : entry.target
    if (!isReadyCatalogTarget(target)) continue
    const decoded = decodeTargetText(entry.descriptor.bytes)
    catalog.push({ contents: decoded.text, target })
    const unwrapped = unwrapTargetText(entry.descriptor.bytes)
    const wraps = detectHardWraps(decoded.text)
    if (wraps.length > 0) {
      predictedCatalogContents.set(entry.target, unwrapped)
      let predictedEditableRegions = []
      try { predictedEditableRegions = inspectRegions(Buffer.from(unwrapped, 'utf8'), entry.declaration.regions ?? []) } catch { predictedEditableRegions = [] }
      wrapFindings.push({ target: entry.target, count: wraps.length, firstLine: wraps[0].line, beforeRawSha256: entry.descriptor.rawSha256, predictedRawSha256: sha256(Buffer.from(unwrapped, 'utf8')), predictedContentBase64: entry.declaration.contentRole === 'semantic' ? Buffer.from(unwrapped, 'utf8').toString('base64') : null, predictedEditableRegions })
    }
  }
  let ready
  let after
  let readyProblems
  try {
    ready = analyzeCatalog(buildReadyCatalog(catalog))
    const overlayCatalog = catalog.map((item) => {
      const physicalTarget = item.target.startsWith('.claude/') ? item.target : `.claude/${item.target}`
      const finding = wrapFindings.find((candidate) => candidate.target === physicalTarget)
      const predicted = predictedCatalogContents.get(physicalTarget)
      if (predicted === undefined || finding === undefined) return item

      return { ...item, contents: predicted }
    })
    after = wrapFindings.length === 0 ? ready : analyzeCatalog(buildReadyCatalog(overlayCatalog))
    readyProblems = projectReadyProblems(ready, catalog)
  } catch (error) {
    inspectError('ready-failed', 'Ready parser conversion failed.', null, error)
  }
  const targetRecords = descriptors.map((entry) => targetRecord(entry.target, entry.descriptor, { ...entry.declaration, contentRole: entry.declaration.contentRole ?? 'semantic' }, entry.template, { ...options, decode: decodeTargetText, gitKind: git.kind, unwrapFindings: wrapFindings }))
  let gitRecord
  try {
    const ignoreProbes = options.ignoreProbes ?? buildIgnoreProbes(canonical, descriptors)
    const guidanceStyles = guidanceNewlineEvidence(canonical, guidance, options)
    const newlineTargets = targetRecords.filter((item) => item.kind === 'file').map((item) => {
      const family = newlineFamily(item.target, guidance.resolvedTarget)
      const siblingStyles = family === 'guidance'
        ? guidanceStyles.filter((candidate) => candidate.target !== item.target).map((candidate) => candidate.style)
        : targetRecords.filter((candidate) => candidate.kind === 'file' && candidate.target !== item.target && newlineFamily(candidate.target, guidance.resolvedTarget) === family && candidate.newline !== null).map((candidate) => candidate.newline)

      return { family, mode: item.mode, siblingStyles, target: item.target }
    })
    gitRecord = inspectGitPolicy(canonical, { ...options, attributePaths: targetRecords.filter((item) => item.kind === 'file').map((item) => item.target), electionMarker: marker.marker, electionMarkerMode: marker.mode, electionMarkerSnapshotId: marker.snapshotId, freshScaffold: false, gitignoreText: gitignoreEntryBytes(descriptors), ignoreProbes, kind: git.kind, newlineTargets, siblingStyles: targetRecords.filter((item) => item.kind === 'file').map((item) => item.newline) })
  } catch (error) {
    inspectError('git-policy', 'Git policy inspection failed.', null, error)
  }
  const proposals = []
  const newlineByTarget = new Map(gitRecord.newlinePolicies.map((item) => [item.target, item]))
  const plansTemplate = bundle.templates.get('gitignore.plans')
  const gitignoreEntry = descriptors.find((entry) => entry.target === '.gitignore')
  const mandatoryPlans = plansTemplate?.logicalBytes ?? Buffer.alloc(0)
  for (const entry of descriptors) {
    const record = targetRecords.find((item) => item.target === entry.target)
    if (record === undefined) continue
    if (record.states[0] === 'missing' && record.kind === 'directory') {
      proposals.push(proposal('missing-target', 'always', { kind: 'ensure-directory', mode: record.mode, target: entry.target }, null, null))
    } else if (record.states[0] === 'missing' && entry.template) {
      const policy = newlineByTarget.get(entry.target)
      for (const variant of newlineVariants(policy)) {
        const newline = record.newline === 'crlf' || record.newline === 'lf' ? record.newline : variant.style
        const output = Buffer.from(entry.template.logicalBytes.toString('utf8').replaceAll('\n', newline === 'crlf' ? '\r\n' : '\n'), 'utf8')
        proposals.push(proposal(entry.target === '.gitignore' ? 'plans-policy' : 'missing-target', record.newline === 'crlf' || record.newline === 'lf' ? 'always' : variant.condition, { kind: 'create-from-template', mode: record.mode, newline, target: entry.target, templateId: entry.template.templateId }, null, output.toString('base64')))
      }
    } else if (record.kind === 'file' && record.states.includes('wrapped')) {
      const predicted = unwrapTargetText(entry.descriptor.bytes)
      const action = { afterRawSha256: sha256(Buffer.from(predicted, 'utf8')), beforeRawSha256: entry.descriptor.rawSha256, kind: 'unwrap-file', mode: record.mode, target: entry.target }
      proposals.push(proposal('hard-wrap', 'always', action, record.contentRole === 'semantic' ? record.contentBase64 : null, record.contentRole === 'semantic' ? Buffer.from(predicted, 'utf8').toString('base64') : null))
    } else if (record.kind === 'file' && entry.template && decodeTargetText(entry.descriptor.bytes).logicalBytes.length === 0) {
      const emptyTemplate = entry.target === guidance.resolvedTarget ? bundle.templates.get('guidance.section') : entry.template
      const policy = newlineByTarget.get(entry.target)
      for (const variant of newlineVariants(policy)) {
        const newline = record.newline === 'crlf' || record.newline === 'lf' ? record.newline : variant.style
        const logicalOutput = Buffer.from(emptyTemplate.logicalBytes.toString('utf8').replaceAll('\n', newline === 'crlf' ? '\r\n' : '\n'), 'utf8')
        const output = decodeTargetText(entry.descriptor.bytes).bom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), logicalOutput]) : logicalOutput
        const emptyRegion = record.editableRegions.find((item) => item.regionId.endsWith('empty-document')) ?? { endByte: 0, regionId: `${entry.target.replaceAll('/', '.')}.empty-document`, startByte: 0 }
        const before = entry.descriptor.bytes.toString('base64')
        const action = { afterBase64: output.toString('base64'), beforeBase64: before, kind: 'exact-edit', mode: record.mode, regionId: emptyRegion.regionId, target: entry.target }
        proposals.push(proposal(entry.target === '.gitignore' ? 'plans-policy' : entry.target === guidance.resolvedTarget ? 'guidance-section' : 'empty-target', record.newline === 'crlf' || record.newline === 'lf' ? 'always' : variant.condition, action, before, output.toString('base64')))
      }
    }
  }
  if (gitignoreEntry?.descriptor.present && gitignoreEntry.descriptor.kind === 'file' && decodeTargetText(gitignoreEntry.descriptor.bytes).logicalBytes.length > 0 && mandatoryPlans.length > 0 && gitRecord.plansPolicy !== 'satisfied' && gitRecord.plansPolicy !== 'nested-conflict') {
    const current = gitignoreEntry.descriptor.bytes
    const logical = decodeTargetText(current)
    if (!logical.text.split(/\r?\n/).includes('.claude/plans/')) {
      const separator = current.length === 0 || current.at(-1) === 0x0a || current.at(-1) === 0x0d ? Buffer.alloc(0) : Buffer.from(logical.style === 'crlf' ? '\r\n' : '\n')
      const fragment = Buffer.from(mandatoryPlans.toString('utf8').replaceAll('\n', logical.style === 'crlf' ? '\r\n' : '\n'), 'utf8')
      const after = Buffer.concat([current, separator, fragment])
      const region = gitignoreEntry.declaration.regions.find((item) => item.syntax === 'gitignore-append')
      proposals.push(proposal('plans-policy', 'always', { afterBase64: after.toString('base64'), beforeBase64: current.toString('base64'), kind: 'exact-edit', mode: targetRecords.find((item) => item.target === '.gitignore').mode, regionId: region.regionId, target: '.gitignore' }, current.toString('base64'), after.toString('base64')))
    }
  }
  const hasControlledContent = targetRecords.some((item) => (isReadyCatalogTarget(item.target.slice('.claude/'.length)) && item.target.startsWith('.claude/')) && item.states.includes('present'))
  const freshScaffold = git.kind === 'git' && marker.marker === 'absent' && !hasControlledContent
  gitRecord.freshScaffold = freshScaffold
  gitRecord.electionRequired = freshScaffold || marker.marker !== 'absent'
  const projectedProblems = [...readyProblems.problems, ...projectGitProblems(gitRecord)].sort((left, right) => compareOrdinal(`${left.code}\0${left.target ?? ''}\0${left.detail}`, `${right.code}\0${right.target ?? ''}\0${right.detail}`))
  let backupEvidence
  try {
    backupEvidence = inspectBackups(canonical, targetRecords, options)
  } catch (error) {
    inspectError('filesystem', 'Retained backup inspection failed.', '.tmp', error)
  }
  const result = { git: gitRecord, guidance: { baseAdapter: guidance.baseAdapter, candidates: guidance.candidates, graphPaths: guidance.graphPaths, imports: guidance.imports, independentPaths: guidance.independentPaths, resolvedTarget: guidance.resolvedTarget }, host, hostContext, ok: true, operation: 'inspect', problems: [...projectedProblems, ...backupEvidence.problems].sort((left, right) => compareOrdinal(`${left.code}\0${left.target ?? ''}\0${left.detail}`, `${right.code}\0${right.target ?? ''}\0${right.detail}`)), proposals: proposals.sort((left, right) => compareOrdinal(left.proposalId, right.proposalId)), protocolVersion: 1, retainedBackups: backupEvidence.backups, root: canonical, snapshotId: null, targets: targetRecords.sort((left, right) => compareOrdinal(left.target, right.target)), templates: descriptors.filter((entry) => entry.template).map((entry) => ({ conceptIds: entry.template.conceptIds, logicalSha256: entry.template.logicalSha256, target: entry.target, templateId: entry.template.templateId })).sort((left, right) => compareOrdinal(left.templateId, right.templateId)), unwrapReady: { after, targets: wrapFindings.map((item) => item.target).sort(compareOrdinal) }, warnings: [...readyProblems.warnings, ...backupEvidence.warnings].sort((left, right) => compareOrdinal(left.code, right.code)), wrapFindings, ready }
  result.snapshotId = deriveSnapshotId({ ...result, snapshotId: null })

  return result
}

function inspect(root, host, hostContext = {}, options = {}) {
  if (root !== null && typeof root === 'object' && root.operation === 'inspect') {
    options = root.options ?? {}
    hostContext = root.hostContext ?? {}
    host = root.host
    root = root.root
  }
  const canonical = canonicalRoot(root)
  const lockPath = join(canonical, RECOVERY_LOCK_BASENAME)
  const stages = discoverInitialLockStages(canonical, options)
  if (stages.length > 0) inspectError('runtime-lock', 'Orphan initial lock stage requires recovery.', stages[0].name, undefined, 'lock')
  try {
    lstatSync(lockPath, { bigint: true })
    inspectError('runtime-lock', 'Inspection lock already exists.', RECOVERY_LOCK_BASENAME, undefined, 'lock')
  } catch (error) {
    if (error instanceof InitBacklogError) throw error
    if (error?.code !== 'ENOENT') inspectError('runtime-lock', 'Inspection lock cannot be inspected.', RECOVERY_LOCK_BASENAME, error, 'lock')
  }
  const pid = options.pid ?? process.pid
  let ownerNonce
  try {
    ownerNonce = options.ownerNonce ?? randomBytes(16).toString('hex')
  } catch (error) {
    inspectError('runtime-lock', 'Owner nonce generation failed.', RECOVERY_LOCK_BASENAME, error)
  }
  const paths = initialLockPaths(canonical, pid, ownerNonce)
  const stageName = paths.stage.slice(canonical.length + 1).replaceAll('\\', '/')
  let lock
  try {
    lock = createInitialLock(canonical, { createdAtUnixMs: Date.now(), manifestId: null, operation: 'inspect', ownerNonce, pid, protocolVersion: 1, recoveryId: null, root: canonical, temporaryPaths: [stageName], unfinalizedDirectories: [] }, { ...options, ownerNonce, pid })
  } catch (error) {
    const code = error?.cause?.code
    inspectError(code === 'EEXIST' ? 'runtime-lock' : 'filesystem', 'Inspection lock could not be acquired.', RECOVERY_LOCK_BASENAME, error, 'lock')
  }
  try {
    const first = collectInspection(canonical, host, hostContext, options)
    options.onCollection?.(1, first)
    const second = collectInspection(canonical, host, hostContext, options)
    options.onCollection?.(2, second)
    const firstProjection = canonicalJson({ ...first, snapshotId: null })
    const secondProjection = canonicalJson({ ...second, snapshotId: null })
    if (firstProjection !== secondProjection) inspectError('snapshot-drift', 'Independent inspection collections differ.', null)

    return second
  } finally {
    try {
      removeInitialLock(canonical, lock.paths, lock.bytes, options)
    } catch (error) {
      if (error instanceof InitBacklogError) throw error
      inspectError('filesystem', 'Inspection lock cleanup failed.', RECOVERY_LOCK_BASENAME, error, 'cleanup')
    }
  }
}

module.exports = { buildIgnoreProbes, buildReadyCatalog, collectInspection, composeElectionMarker, composeElectionRecord, creationMode, decodeText, discoverInitialLockStages, inspect, inspectRegions, isReadyCatalogTarget, lineRecords, materializeText, maskedRecords, projectGitProblems, projectReadyProblems, proposal, readElectionMarker, targetRecord, targetState, validateElectionMarkerRecord }
