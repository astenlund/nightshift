'use strict'

const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { chmodSync, linkSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const test = require('node:test')

const { MAX_CONTROLLED_DISCOVERY_ENTRIES, MAX_CONTROLLED_MARKDOWN_FILES, MAX_CONTROLLED_MARKDOWN_RETAINED_BYTES, MAX_GUIDANCE_CANDIDATES, MAX_GUIDANCE_FILE_BYTES, MAX_GUIDANCE_RETAINED_BYTES, discoverControlledMarkdown, guidanceImports, resolveClaude, resolveCodex, resolveGuidance } = require('../../skills/init-backlog/lib/guidance')
const { MAX_MECHANICAL_FILE_BYTES } = require('../../skills/init-backlog/lib/protocol')
const {
  enumerateDirectory,
  probeWindowsAttributes,
  resolveTrustedExecutable,
  stableOpenFile,
  trustedWindowsPowerShellPath,
} = require('../../skills/init-backlog/lib/filesystem')

function temporaryRoot(prefix) {
  return mkdtempSync(join(tmpdir(), prefix))
}

function ordinaryFile(path, contents = 'content\n') {
  writeFileSync(path, contents)
  return path
}

function windowsAttributeProbe(paths, attributes = 0) {
  return {
    items: paths.map((path) => ({ attributes, path, reparsePoint: (attributes & 0x400) === 0x400 })),
    ok: true,
    systemDirectory: 'C:\\Windows\\System32',
  }
}

function runDiscoveryCases(repositoryRoot) {
  test('stable-open reports an ordinary single-link file with BigInt identity and numeric mode', () => {
    const root = temporaryRoot('nightshift-discovery-stable-')
    try {
      const path = ordinaryFile(join(root, 'file.md'))
      const opened = stableOpenFile(root, path, { platform: 'linux', requireSingleLink: true })

      assert.equal(typeof opened.identity, 'string')
      assert.equal(typeof opened.mode, 'number')
      assert.equal(opened.mode, Number(lstatSync(path, { bigint: true }).mode & 0o7777n))
      assert.deepEqual(opened.bytes, Buffer.from('content\n'))
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('stable-open rejects wrong kind, links, hard links, and escaped targets', () => {
    const root = temporaryRoot('nightshift-discovery-kinds-')
    const outsideRoot = temporaryRoot('nightshift-discovery-outside-')
    try {
      const file = ordinaryFile(join(root, 'file.md'))
      const directory = join(root, 'directory')
      mkdirSync(directory)
      assert.throws(() => stableOpenFile(root, directory))

      const link = join(root, 'link.md')
      symlinkSync(file, link)
      assert.throws(() => stableOpenFile(root, link))

      const hardLink = join(root, 'hard.md')
      linkSync(file, hardLink)
      assert.throws(() => stableOpenFile(root, file, { requireSingleLink: true }))

      const outside = ordinaryFile(join(outsideRoot, 'outside.md'))
      assert.throws(() => stableOpenFile(root, outside))
    } finally {
      rmSync(root, { force: true, recursive: true })
      rmSync(outsideRoot, { force: true, recursive: true })
    }
  })

  test('directory enumeration returns ordinal ordinary entries and rejects links', () => {
    const root = temporaryRoot('nightshift-discovery-enumerate-')
    try {
      ordinaryFile(join(root, 'b.md'))
      ordinaryFile(join(root, 'a.txt'))
      assert.deepEqual(enumerateDirectory(root, { attributeProbe: (paths) => windowsAttributeProbe(paths) }).map((entry) => entry.name), ['a.txt', 'b.md'])

      symlinkSync(join(root, 'b.md'), join(root, 'z.md'))
      assert.throws(() => enumerateDirectory(root, { attributeProbe: (paths) => windowsAttributeProbe(paths) }))
      const probedPaths = []
      assert.deepEqual(enumerateDirectory(root, {
        attributeProbe: (paths) => {
          probedPaths.push(paths)

          return windowsAttributeProbe(paths)
        },
        includeName: (name) => name === 'b.md',
      }).map((entry) => entry.name), ['b.md'])
      assert.ok(probedPaths.every((paths) => paths.length === 1 && paths[0] === join(root, 'b.md')))
      let emptyProbeCalls = 0
      assert.deepEqual(enumerateDirectory(root, {
        attributeProbe: () => {
          emptyProbeCalls += 1

          return windowsAttributeProbe([])
        },
        includeName: () => false,
      }), [])
      assert.equal(emptyProbeCalls, 0)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('controlled Markdown discovery enforces aggregate count and byte boundaries', () => {
    for (const extraFiles of [0, 1]) {
      const root = temporaryRoot('nightshift-discovery-count-bound-')
      const directory = join(root, '.claude', 'bugs')
      try {
        mkdirSync(directory, { recursive: true })
        for (let index = 0; index < MAX_CONTROLLED_MARKDOWN_FILES + extraFiles; index += 1) ordinaryFile(join(directory, `item-${index.toString().padStart(3, '0')}.md`), '')

        if (extraFiles === 0) {
          assert.equal(discoverControlledMarkdown(root, ['.claude/bugs'], { maxBytes: MAX_MECHANICAL_FILE_BYTES }).length, MAX_CONTROLLED_MARKDOWN_FILES)
        } else {
          assert.throws(() => discoverControlledMarkdown(root, ['.claude/bugs'], { maxBytes: MAX_MECHANICAL_FILE_BYTES }), (error) => error.record?.code === 'payload-too-large' && error.record?.phase === 'inspect')
        }
      } finally {
        rmSync(root, { force: true, recursive: true })
      }
    }
    for (const extraBytes of [0, 1]) {
      const root = temporaryRoot('nightshift-discovery-byte-bound-')
      const directory = join(root, '.claude', 'features')
      try {
        mkdirSync(directory, { recursive: true })
        const fullFiles = MAX_CONTROLLED_MARKDOWN_RETAINED_BYTES / MAX_MECHANICAL_FILE_BYTES
        for (let index = 0; index < fullFiles; index += 1) ordinaryFile(join(directory, `item-${index}.md`), Buffer.alloc(MAX_MECHANICAL_FILE_BYTES, 0x61))
        if (extraBytes !== 0) ordinaryFile(join(directory, 'overflow.md'), Buffer.alloc(extraBytes, 0x62))

        if (extraBytes === 0) {
          assert.equal(discoverControlledMarkdown(root, ['.claude/features'], { maxBytes: MAX_MECHANICAL_FILE_BYTES }).length, fullFiles)
        } else {
          assert.throws(() => discoverControlledMarkdown(root, ['.claude/features'], { maxBytes: MAX_MECHANICAL_FILE_BYTES }), (error) => error.record?.code === 'payload-too-large' && error.record?.phase === 'inspect')
        }
      } finally {
        rmSync(root, { force: true, recursive: true })
      }
    }
  })

  test('controlled Markdown discovery bounds aggregate entries before metadata probes', () => {
    assert.equal(MAX_CONTROLLED_DISCOVERY_ENTRIES, 1024)
    const root = temporaryRoot('nightshift-discovery-entry-bound-')
    const directory = join(root, '.claude', 'bugs')
    const nested = join(directory, 'nested')
    let closes = 0
    let opens = 0
    let probes = 0
    try {
      mkdirSync(nested, { recursive: true })
      const opendirSync = () => {
        const names = opens === 0 ? ['nested'] : Array.from({ length: MAX_CONTROLLED_DISCOVERY_ENTRIES }, (_, index) => `ignored-${index}.txt`)
        let index = 0
        opens += 1

        return {
          closeSync: () => { closes += 1 },
          readSync: () => index < names.length ? { name: names[index++] } : null,
        }
      }
      const attributeProbe = (paths) => {
        probes += 1

        return windowsAttributeProbe(paths)
      }

      assert.throws(
        () => discoverControlledMarkdown(root, ['.claude/bugs'], { attributeProbe, maxBytes: MAX_MECHANICAL_FILE_BYTES, opendirSync, platform: 'win32' }),
        (error) => error.record?.code === 'payload-too-large' && error.record?.phase === 'inspect',
      )
      assert.equal(opens, 2)
      assert.equal(closes, 2)
      assert.equal(probes, 2)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('trusted executable resolution uses an absolute stable candidate outside the repository', () => {
    const root = temporaryRoot('nightshift-discovery-executable-')
    const candidateRoot = temporaryRoot('nightshift-discovery-path-')
    try {
      const executable = ordinaryFile(join(candidateRoot, process.platform === 'win32' ? 'git.exe' : 'git'))
      if (process.platform !== 'win32') {
        chmodSync(executable, 0o755)
      }
      const resolved = resolveTrustedExecutable({ root, pathValue: candidateRoot, basename: process.platform === 'win32' ? 'git.exe' : 'git' })
      assert.equal(resolved, resolve(executable))
    } finally {
      rmSync(root, { force: true, recursive: true })
      rmSync(candidateRoot, { force: true, recursive: true })
    }
  })

  test('Windows attribute helper request and system-root derivation are injectable and fail closed', () => {
    const root = temporaryRoot('nightshift-discovery-windows-')
    try {
      const target = 'C:\\fixture\\file.md'
      const observed = probeWindowsAttributes([target], {
        platform: 'win32',
        runHelper: (request) => ({ items: [{ attributes: 0, path: request.paths[0], reparsePoint: false }], ok: true, systemDirectory: 'C:\\Windows\\System32' }),
      })
      assert.equal(observed.items[0].path, target)
      assert.equal(observed.items[0].reparsePoint, false)
      assert.throws(() => probeWindowsAttributes([target], {
        platform: 'win32',
        runHelper: () => ({ ok: false, code: 'attribute-read-failed', index: 0 }),
      }))
      assert.throws(() => trustedWindowsPowerShellPath({ systemRoot: '', root, platform: 'win32' }))
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('guidance resolution selects the root Claude adapter and scans controlled candidates', () => {
    const root = temporaryRoot('nightshift-discovery-guidance-')
    try {
      ordinaryFile(join(root, 'CLAUDE.md'), '# CLAUDE.md\n')
      const resolved = resolveGuidance(root, 'claude-code', { claudeRootExclusionStatus: 'included', claudeContextSource: 'host-observed' })
      assert.equal(resolved.resolvedTarget, 'CLAUDE.md')
      assert.equal(resolved.baseAdapter, 'CLAUDE.md')
      assert.ok(resolved.graphPaths.includes('CLAUDE.md'))
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('guidance discovery skips .git metadata at every depth and still finds ordinary nested guidance', () => {
    const root = temporaryRoot('nightshift-discovery-git-skip-')
    try {
      ordinaryFile(join(root, 'CLAUDE.md'), '# CLAUDE.md\n')
      mkdirSync(join(root, 'nested'))
      ordinaryFile(join(root, 'nested', 'CLAUDE.md'), '# nested\n')
      mkdirSync(join(root, '.git', 'objects'), { recursive: true })
      ordinaryFile(join(root, '.git', 'CLAUDE.md'), '# repository metadata\n')
      ordinaryFile(join(root, '.git', 'objects', 'CLAUDE.local.md'), '# repository metadata\n')
      mkdirSync(join(root, 'vendor', '.git'), { recursive: true })
      ordinaryFile(join(root, 'vendor', '.git', 'CLAUDE.md'), '# submodule metadata\n')

      const resolved = resolveGuidance(root, 'claude-code', { claudeRootExclusionStatus: 'included', claudeContextSource: 'host-observed' })

      assert.deepEqual(resolved.candidates, ['CLAUDE.md', 'nested/CLAUDE.md'])
      assert.deepEqual(resolved.independentPaths, ['nested/CLAUDE.md'])
      assert.equal(resolved.graphPaths.some((target) => target.includes('.git/')), false, 'no .git path may enter the guidance graph')
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('overlapping Claude traversals emit each import edge once', () => {
    const root = temporaryRoot('nightshift-discovery-overlap-')
    try {
      ordinaryFile(join(root, 'CLAUDE.md'), '# root\n\n@nested/CLAUDE.md\n')
      mkdirSync(join(root, 'nested'))
      ordinaryFile(join(root, 'nested', 'CLAUDE.md'), '# nested\n\n@child.md\n')
      ordinaryFile(join(root, 'nested', 'child.md'), '# child\n')

      const resolved = resolveGuidance(root, 'claude-code', { claudeRootExclusionStatus: 'included', claudeContextSource: 'host-observed' })

      assert.deepEqual(resolved.independentPaths, ['nested/CLAUDE.md', 'nested/child.md'])
      assert.deepEqual(resolved.imports, [
        { adapterCandidate: true, source: 'CLAUDE.md', target: 'nested/CLAUDE.md' },
        { adapterCandidate: false, source: 'nested/CLAUDE.md', target: 'nested/child.md' },
      ])
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('guidance resolution applies Codex fallback precedence and reports missing roots', () => {
    const root = temporaryRoot('nightshift-discovery-codex-')
    try {
      mkdirSync(join(root, 'sub'))
      ordinaryFile(join(root, 'AGENTS.md'), 'root\n')
      ordinaryFile(join(root, 'sub', 'AGENTS.override.md'), 'sub\n')
      const resolved = resolveGuidance(root, 'codex', {
        claudeContextSource: null,
        claudeRootExclusionStatus: null,
        codexContextSource: 'user-confirmed',
        codexInvocationDirectory: 'sub',
        codexProjectDocMaxBytes: 65536,
        codexProjectInstructions: ['PROJECT.md'],
      })
      assert.equal(resolved.resolvedTarget, 'AGENTS.md')
      assert.deepEqual(resolved.graphPaths, ['AGENTS.md', 'sub/AGENTS.override.md'])
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('Codex guidance caches each candidate under the confirmed byte bound', () => {
    const calls = []
    const maximumBytes = 8192
    const resolved = resolveCodex('C:\\synthetic-root', {
      claudeContextSource: null,
      claudeRootExclusionStatus: null,
      codexContextSource: 'user-confirmed',
      codexInvocationDirectory: '.',
      codexProjectDocMaxBytes: maximumBytes,
      codexProjectInstructions: ['PROJECT.md'],
    }, {
      readCandidate: (root, target, options) => {
        calls.push({ maximumBytes: options.maxBytes, root, target })

        return target === 'AGENTS.md' ? { bytes: Buffer.from('guidance\n'), text: 'guidance\n' } : null
      },
    })

    assert.equal(resolved.resolvedTarget, 'AGENTS.md')
    assert.deepEqual(calls.map((item) => item.target), ['AGENTS.override.md', 'AGENTS.md', 'PROJECT.md'])
    assert.equal(calls.every((item) => item.maximumBytes === maximumBytes), true)
    assert.equal(new Set(calls.map((item) => item.target)).size, calls.length, 'each candidate is read once even when selection, total-size, and section checks consume it')
  })

  test('guidance resolution owns closed candidate resource budgets', () => {
    assert.equal(MAX_GUIDANCE_FILE_BYTES, 65536)
    assert.equal(MAX_GUIDANCE_RETAINED_BYTES, 1048576)
    assert.equal(MAX_GUIDANCE_CANDIDATES, 256)
  })

  test('Claude guidance rejects an oversized imported candidate before decoding it', () => {
    const root = temporaryRoot('nightshift-discovery-claude-file-budget-')
    try {
      ordinaryFile(join(root, 'CLAUDE.md'), '@large.md\n')
      ordinaryFile(join(root, 'large.md'), Buffer.alloc(MAX_GUIDANCE_FILE_BYTES + 1, 0x61))

      assert.throws(() => resolveClaude(root, {
        claudeRootExclusionStatus: 'included',
        claudeContextSource: 'host-observed',
      }, { platform: 'linux' }), (error) => error.record?.code === 'payload-too-large' && error.record?.phase === 'inspect' && error.record?.target === 'large.md')
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('Claude guidance rejects a graph that exceeds the retained-byte budget', () => {
    const root = temporaryRoot('nightshift-discovery-claude-retained-budget-')
    try {
      const importDirectory = join(root, 'imports')
      mkdirSync(importDirectory)
      const importNames = Array.from({ length: (MAX_GUIDANCE_RETAINED_BYTES / MAX_GUIDANCE_FILE_BYTES) }, (_, index) => `imports/file-${index}.md`)
      ordinaryFile(join(root, 'CLAUDE.md'), `${importNames.map((target) => `@${target}`).join('\n')}\n`)
      for (const target of importNames) {
        ordinaryFile(join(root, target), Buffer.alloc(MAX_GUIDANCE_FILE_BYTES, 0x61))
      }

      assert.throws(() => resolveClaude(root, {
        claudeRootExclusionStatus: 'included',
        claudeContextSource: 'host-observed',
      }, { platform: 'linux' }), (error) => error.record?.code === 'guidance-resolution')
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('Codex guidance clamps the confirmed per-file limit to the controller ceiling', () => {
    const observedLimits = []
    resolveCodex('C:\\synthetic-root', {
      claudeContextSource: null,
      claudeRootExclusionStatus: null,
      codexContextSource: 'user-confirmed',
      codexInvocationDirectory: '.',
      codexProjectDocMaxBytes: MAX_GUIDANCE_FILE_BYTES * 2,
      codexProjectInstructions: [],
    }, {
      readCandidate: (root, target, options) => {
        observedLimits.push(options.maxBytes)

        return target === 'AGENTS.md' ? { bytes: Buffer.from('guidance\n'), text: 'guidance\n' } : null
      },
    })

    assert.equal(observedLimits.every((maximumBytes) => maximumBytes === MAX_GUIDANCE_FILE_BYTES), true)
  })

  test('Codex guidance accepts the retained-byte boundary and rejects its next candidate', () => {
    const invoke = (candidateCount) => resolveCodex('C:\\synthetic-root', {
      claudeContextSource: null,
      claudeRootExclusionStatus: null,
      codexContextSource: 'user-confirmed',
      codexInvocationDirectory: '.',
      codexProjectDocMaxBytes: MAX_GUIDANCE_RETAINED_BYTES * 2,
      codexProjectInstructions: Array.from({ length: candidateCount - 2 }, (_, index) => `PROJECT-${index}.md`),
    }, {
      readCandidate: () => ({ bytes: Buffer.alloc(MAX_GUIDANCE_FILE_BYTES, 0x61), text: 'guidance' }),
    })
    const boundaryCount = MAX_GUIDANCE_RETAINED_BYTES / MAX_GUIDANCE_FILE_BYTES

    assert.doesNotThrow(() => invoke(boundaryCount))
    assert.throws(() => invoke(boundaryCount + 1), (error) => error.record?.code === 'guidance-resolution')
  })

  test('Codex guidance accepts the candidate-count boundary and rejects its next probe', () => {
    const invoke = (candidateCount) => resolveCodex('C:\\synthetic-root', {
      claudeContextSource: null,
      claudeRootExclusionStatus: null,
      codexContextSource: 'user-confirmed',
      codexInvocationDirectory: '.',
      codexProjectDocMaxBytes: MAX_GUIDANCE_RETAINED_BYTES,
      codexProjectInstructions: Array.from({ length: candidateCount - 2 }, (_, index) => `PROJECT-${index}.md`),
    }, {
      readCandidate: () => null,
    })

    assert.doesNotThrow(() => invoke(MAX_GUIDANCE_CANDIDATES))
    assert.throws(() => invoke(MAX_GUIDANCE_CANDIDATES + 1), (error) => error.record?.code === 'guidance-resolution')
  })

  test('Claude guidance requires the exact root provenance pair for present and missing roots', () => {
    const missingRoot = temporaryRoot('nightshift-discovery-claude-missing-context-')
    try {
      assert.throws(() => resolveGuidance(missingRoot, 'claude-code', {}), (error) => error.record?.code === 'guidance-resolution')
      assert.throws(() => resolveGuidance(missingRoot, 'claude-code', {
        claudeRootExclusionStatus: 'included',
        claudeContextSource: 'host-observed',
      }), (error) => error.record?.code === 'guidance-resolution')
      assert.doesNotThrow(() => resolveGuidance(missingRoot, 'claude-code', {
        claudeRootExclusionStatus: 'unexcluded-missing',
        claudeContextSource: 'user-confirmed',
      }))
    } finally {
      rmSync(missingRoot, { force: true, recursive: true })
    }

    const presentRoot = temporaryRoot('nightshift-discovery-claude-present-context-')
    try {
      ordinaryFile(join(presentRoot, 'CLAUDE.md'), '# CLAUDE.md\n')
      assert.throws(() => resolveGuidance(presentRoot, 'claude-code', {
        claudeRootExclusionStatus: 'unexcluded-missing',
        claudeContextSource: 'user-confirmed',
      }), (error) => error.record?.code === 'guidance-resolution')
      assert.doesNotThrow(() => resolveGuidance(presentRoot, 'claude-code', {
        claudeRootExclusionStatus: 'included',
        claudeContextSource: 'host-observed',
      }))
    } finally {
      rmSync(presentRoot, { force: true, recursive: true })
    }
  })

  test('Claude base-rooted adapter delegation requires one distinct recognized candidate', () => {
    const repeatedRoot = temporaryRoot('nightshift-discovery-claude-repeated-delegate-')
    try {
      ordinaryFile(join(repeatedRoot, 'CLAUDE.md'), '@shared/AGENTS.md\n@shared/AGENTS.md\n')
      mkdirSync(join(repeatedRoot, 'shared'))
      ordinaryFile(join(repeatedRoot, 'shared', 'AGENTS.md'), '# shared\n')
      const resolved = resolveClaude(repeatedRoot, {
        claudeRootExclusionStatus: 'included',
        claudeContextSource: 'host-observed',
      }, { platform: 'linux' })
      assert.equal(resolved.resolvedTarget, 'shared/AGENTS.md')
    } finally {
      rmSync(repeatedRoot, { force: true, recursive: true })
    }

    const ambiguousRoot = temporaryRoot('nightshift-discovery-claude-ambiguous-delegate-')
    try {
      ordinaryFile(join(ambiguousRoot, 'CLAUDE.md'), '@a/CLAUDE.md\n@b/AGENTS.md\n')
      mkdirSync(join(ambiguousRoot, 'a'))
      mkdirSync(join(ambiguousRoot, 'b'))
      ordinaryFile(join(ambiguousRoot, 'a', 'CLAUDE.md'), '# a\n')
      ordinaryFile(join(ambiguousRoot, 'b', 'AGENTS.md'), '# b\n')
      assert.throws(() => resolveClaude(ambiguousRoot, {
        claudeRootExclusionStatus: 'included',
        claudeContextSource: 'host-observed',
      }, { platform: 'linux' }), (error) => error.record?.code === 'guidance-resolution')
    } finally {
      rmSync(ambiguousRoot, { force: true, recursive: true })
    }
  })

  test('Claude controlled-section ownership covers imported base files except the final adapter', () => {
    const conflictRoot = temporaryRoot('nightshift-discovery-claude-import-conflict-')
    try {
      ordinaryFile(join(conflictRoot, 'CLAUDE.md'), '@notes.md\n')
      ordinaryFile(join(conflictRoot, 'notes.md'), '## Backlogs and indexes\n')
      assert.throws(() => resolveGuidance(conflictRoot, 'claude-code', {
        claudeRootExclusionStatus: 'included',
        claudeContextSource: 'host-observed',
      }), (error) => error.record?.code === 'guidance-resolution')
    } finally {
      rmSync(conflictRoot, { force: true, recursive: true })
    }

    const delegatedRoot = temporaryRoot('nightshift-discovery-claude-delegated-owner-')
    try {
      ordinaryFile(join(delegatedRoot, 'CLAUDE.md'), '@adapter/AGENTS.md\n')
      mkdirSync(join(delegatedRoot, 'adapter'))
      ordinaryFile(join(delegatedRoot, 'adapter', 'AGENTS.md'), '## Backlogs and indexes\n')
      const resolved = resolveClaude(delegatedRoot, {
        claudeRootExclusionStatus: 'included',
        claudeContextSource: 'host-observed',
      }, { platform: 'linux' })
      assert.equal(resolved.resolvedTarget, 'adapter/AGENTS.md')
    } finally {
      rmSync(delegatedRoot, { force: true, recursive: true })
    }
  })

  test('Claude import scanning skips every Markdown code and raw HTML token', () => {
    assert.deepEqual(guidanceImports('    @imports/indented.md'), [])
    assert.deepEqual(guidanceImports('~~~\n@imports/tilde-fenced.md\n~~~'), [])
    assert.deepEqual(guidanceImports('```\n@imports/backtick-fenced.md\n```'), [])
    assert.deepEqual(guidanceImports('`@imports/inline-code.md`'), [])
    assert.deepEqual(guidanceImports('<span>@imports/raw-html.md</span>'), [])
    assert.deepEqual(guidanceImports('<!-- @imports/comment.md -->'), [])
    assert.deepEqual(guidanceImports('ordinary @imports/ordinary.md text'), ['imports/ordinary.md'])
  })

  test('Claude import scanning masks all CommonMark raw HTML block types through their terminators', () => {
    const closedBlocks = [
      '<!--\n@imports/comment.md\n-->\nordinary @imports/comment-after.md',
      '<script>\n@imports/script.md\n</script>\nordinary @imports/script-after.md',
      '<?processing\n@imports/processing.md\n?>\nordinary @imports/processing-after.md',
      '<!DOCTYPE html\n@imports/declaration.md\n>\nordinary @imports/declaration-after.md',
      '<![CDATA[\n@imports/cdata.md\n]]>\nordinary @imports/cdata-after.md',
      '<div>\n@imports/block-tag.md\n\nordinary @imports/block-tag-after.md',
      '<custom-element>\n@imports/complete-tag.md\n\nordinary @imports/complete-tag-after.md',
    ]
    const closedExpected = [
      'comment-after.md',
      'script-after.md',
      'processing-after.md',
      'declaration-after.md',
      'cdata-after.md',
      'block-tag-after.md',
      'complete-tag-after.md',
    ].map((name) => `imports/${name}`)
    for (const [index, text] of closedBlocks.entries()) {
      assert.deepEqual(guidanceImports(text), [closedExpected[index]])
    }

    const unclosedBlocks = [
      '<!--\n@imports/comment.md',
      '<script>\n@imports/script.md',
      '<?processing\n@imports/processing.md',
      '<!DOCTYPE html\n@imports/declaration.md',
      '<![CDATA[\n@imports/cdata.md',
      '<div>\n@imports/block-tag.md',
      '<custom-element>\n@imports/complete-tag.md',
    ]
    for (const text of unclosedBlocks) {
      assert.deepEqual(guidanceImports(text), [])
    }

    const typeOneBlocks = [
      '<script>\n@imports/script.md\n</script>\n@imports/script-after.md',
      '<pre>\n@imports/pre.md\n</pre>\n@imports/pre-after.md',
      '<style>\n@imports/style.md\n</style>\n@imports/style-after.md',
      '<textarea>\n@imports/textarea.md\n</textarea>\n@imports/textarea-after.md',
    ]
    const typeOneExpected = ['script-after.md', 'pre-after.md', 'style-after.md', 'textarea-after.md'].map((name) => `imports/${name}`)
    for (const [index, text] of typeOneBlocks.entries()) {
      assert.deepEqual(guidanceImports(text), [typeOneExpected[index]])
    }

    for (const tag of ['script', 'pre', 'style', 'textarea']) {
      assert.deepEqual(guidanceImports(`<${tag}>\n@imports/${tag}.md`), [])
    }
  })

  test('invalid POSIX directory names map to the owning public failure with no target', () => {
    const injectedRoot = temporaryRoot('nightshift-discovery-invalid-name-injected-')
    try {
      const invalidName = Buffer.from([0xff])
      const readdirSync = () => [invalidName]
      mkdirSync(join(injectedRoot, '.claude', 'bugs'), { recursive: true })
      assert.throws(() => discoverControlledMarkdown(injectedRoot, ['.claude/bugs'], { platform: 'linux', readdirSync }), (error) => error.record?.code === 'invalid-target' && error.record.phase === 'inspect' && error.record.target === null)
      ordinaryFile(join(injectedRoot, 'CLAUDE.md'), '# CLAUDE.md\n')
      assert.throws(() => resolveGuidance(injectedRoot, 'claude-code', {
        claudeRootExclusionStatus: 'included',
        claudeContextSource: 'host-observed',
      }, { platform: 'linux', readdirSync }), (error) => error.record?.code === 'guidance-resolution' && error.record.phase === 'resolve' && error.record.target === null)
    } finally {
      rmSync(injectedRoot, { force: true, recursive: true })
    }

    if (process.platform === 'win32') {
      return
    }
    const root = temporaryRoot('nightshift-discovery-invalid-name-')
    try {
      const invalidDirectory = Buffer.concat([Buffer.from(root), Buffer.from('/invalid-'), Buffer.from([0xff])])
      mkdirSync(invalidDirectory)
      assert.throws(() => enumerateDirectory(root), (error) => error.code === 'invalid-directory-name')

      const controlledRoot = join(root, '.claude', 'bugs')
      mkdirSync(controlledRoot, { recursive: true })
      const invalidFile = Buffer.concat([Buffer.from(controlledRoot), Buffer.from('/entry-'), Buffer.from([0xff]), Buffer.from('.md')])
      ordinaryFile(invalidFile, 'content\n')
      assert.throws(() => require('../../skills/init-backlog/lib/guidance').discoverControlledMarkdown(root, ['.claude/bugs']), (error) => error.record?.code === 'invalid-target' && error.record.target === null)

      mkdirSync(join(root, '.claude', 'rules'), { recursive: true })
      const invalidRule = Buffer.concat([Buffer.from(root), Buffer.from('/.claude/rules/rule-'), Buffer.from([0xff]), Buffer.from('.md')])
      ordinaryFile(invalidRule, 'content\n')
      ordinaryFile(join(root, 'CLAUDE.md'), '# CLAUDE.md\n')
      assert.throws(() => resolveGuidance(root, 'claude-code', {
        claudeRootExclusionStatus: 'included',
        claudeContextSource: 'host-observed',
      }), (error) => error.record?.code === 'guidance-resolution' && error.record.target === null)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('Codex guidance requires complete confirmed context and confined canonical fallbacks', () => {
    const root = temporaryRoot('nightshift-discovery-codex-context-')
    try {
      assert.throws(() => resolveGuidance(root, 'codex', {
        codexContextSource: 'user-confirmed',
        codexProjectDocMaxBytes: 4096,
      }), (error) => error.record?.code === 'guidance-resolution')
      const base = {
        claudeContextSource: null,
        claudeRootExclusionStatus: null,
        codexContextSource: 'user-confirmed',
        codexInvocationDirectory: '.',
        codexProjectDocMaxBytes: 4096,
        codexProjectInstructions: [],
      }
      const omittedFallbacks = { ...base }
      delete omittedFallbacks.codexProjectInstructions
      assert.throws(() => resolveGuidance(root, 'codex', omittedFallbacks), (error) => error.record?.code === 'guidance-resolution')
      for (const fallback of ['AGENTS.md', 'AGENTS.override.md', 'C:foo', '/absolute', 'a/b', '.', '..', 'a/../b']) {
        assert.throws(() => resolveGuidance(root, 'codex', { ...base, codexProjectInstructions: [fallback] }), (error) => error.record?.code === 'guidance-resolution')
      }
      assert.throws(() => resolveGuidance(root, 'codex', { ...base, codexProjectInstructions: ['A.md', 'A.md'] }), (error) => error.record?.code === 'guidance-resolution')
      assert.throws(() => resolveGuidance(root, 'codex', { ...base, codexInvocationDirectory: 'missing/../dir' }), (error) => error.record?.code === 'guidance-resolution')
      if (process.platform === 'win32') {
        mkdirSync(join(root, 'Physical'))
        assert.throws(() => resolveGuidance(root, 'codex', { ...base, codexInvocationDirectory: 'physical' }), (error) => error.record?.code === 'guidance-resolution')
      }
      assert.doesNotThrow(() => resolveGuidance(root, 'codex', { ...base, codexProjectInstructions: ['PROJECT.md'] }))
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('Windows directory enumeration requires stable complete attribute probes', () => {
    const root = temporaryRoot('nightshift-discovery-windows-probe-')
    try {
      ordinaryFile(join(root, 'entry.md'))
      let calls = 0
      assert.throws(() => enumerateDirectory(root, { platform: 'win32', attributeProbe: () => null }))
      assert.throws(() => enumerateDirectory(root, { platform: 'win32', attributeProbe: (paths) => {
        calls += 1
        return windowsAttributeProbe(paths, calls === 1 ? 0 : 1)
      } }))
      assert.equal(calls, 2)
      assert.throws(() => enumerateDirectory(root, { platform: 'win32' }))
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('Windows attribute helper accepts only canonical request bytes', () => {
    const helperPath = resolve(repositoryRoot, 'skills/init-backlog/windows-attributes.ps1')
    const target = resolve(repositoryRoot, 'AGENTS.md')
    const canonical = JSON.stringify({ operation: 'attributes', paths: [target] })
    const executable = trustedWindowsPowerShellPath({ platform: 'win32', root: repositoryRoot })
    const invoke = (input) => spawnSync(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', helperPath], { input, encoding: null })

    const positive = invoke(Buffer.from(`${canonical}\n`, 'utf8'))
    assert.equal(positive.status, 0)
    assert.notEqual(positive.stdout.length, 0)

    const unicodeRoot = temporaryRoot('nightshift-discovery-windows-unicode-')
    try {
      for (const codePoint of [0x2028, 0x2029]) {
        const unicodePath = join(unicodeRoot, `entry-${String.fromCodePoint(codePoint)}.md`)
        ordinaryFile(unicodePath)
        const observed = probeWindowsAttributes([unicodePath], {
          platform: 'win32',
          helperPath,
          trustedWindowsPowerShellPath: executable,
        })
        assert.equal(observed.items[0].path, unicodePath)
      }
    } finally {
      rmSync(unicodeRoot, { force: true, recursive: true })
    }

    const malformed = [
      ` ${canonical}\n`,
      `${canonical} \n`,
      `{"operation":"attributes","operation":"attributes","paths":[${JSON.stringify(target)}]}\n`,
      `{"paths":[${JSON.stringify(target)}],"operation":"attributes"}\n`,
      `{"operation":"attributes","paths":["C:\\u0047it\\nightshift\\AGENTS.md"]}\n`,
      `${canonical}\n\n`,
    ]
    for (const input of malformed) {
      const result = invoke(Buffer.from(input, 'utf8'))
      assert.equal(result.status, 2)
      assert.equal(result.stdout.length, 0)
    }

    for (const codePoint of [0x2028, 0x2029]) {
      const separator = String.fromCodePoint(codePoint)
      const unicodeTarget = `${target}${separator}entry`
      const unicodeCanonical = JSON.stringify({ operation: 'attributes', paths: [unicodeTarget] })
      const unicodeResult = invoke(Buffer.from(`${unicodeCanonical}\n`, 'utf8'))
      assert.equal(unicodeResult.status, 1)
      assert.notEqual(unicodeResult.stdout.length, 0)
      const escaped = String.fromCharCode(0x5c, 0x75, ...codePoint.toString(16).split('').map((character) => character.charCodeAt(0)))
      const escapedResult = invoke(Buffer.from(`${unicodeCanonical.replace(separator, escaped)}\n`, 'utf8'))
      assert.equal(escapedResult.status, 2)
      assert.equal(escapedResult.stdout.length, 0)
    }
  })
}

module.exports = { runDiscoveryCases }
