'use strict';

const { workerIsActive } = require('./runtime/workers');

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { spawnSync } = require('node:child_process');
const { hash, projectFile } = require('./runtime/evidence');
const { RunStore, requireCondition, safeDirectory } = require('./runtime/store');
const { UnresolvedPathError, hasUnsupportedPathLiterals, relocated, relocationMoves, rewriteReferences } = require('./migration-references');
const { discoverUnwrapArtifacts, recoveryDiagnostics, recoverPendingUnwrap } = require('./backlog-catalog');
const { isLockName, acquireLock, inspectLock } = require('./unwrap-lock');
const { RECOVERY_SUFFIX } = require('./unwrap-recovery');

const BACKLOG_FILES = ['FEATURES.md', 'BUGS.md', 'QUICK_WINS.md', 'PATTERNS.md', 'FEATURES_HISTORY.md', 'BUGS_HISTORY.md', 'QUICK_WINS_HISTORY.md'];
const OWNED_DIRECTORIES = ['features', 'bugs', 'patterns', 'inbox', 'plans', 'specs', 'runs'];

const LITERAL_PATHSPEC_COMMANDS = ['ls-files', 'add'];

function git(root, args, allowed = [0], input) {
  // check-ignore rejects pathspec magic; its index must be bypassed separately.
  const argumentsForGit = LITERAL_PATHSPEC_COMMANDS.includes(args[0]) ? ['--literal-pathspecs', ...args] : args;
  const result = spawnSync('git', argumentsForGit, { cwd: root, windowsHide: true, encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024, input });
  requireCondition(!result.error && allowed.includes(result.status), 'git-failed', result.error?.message ?? result.stderr);
  return result;
}

function policy(root, relative) {
  const tracked = git(root, ['ls-files', '--error-unmatch', '--', relative], [0, 1]).status === 0;
  const ignored = !tracked && git(root, ['check-ignore', '--no-index', '-q', '--', relative], [0, 1]).status === 0;
  return { tracked, ignored, index: tracked ? indexEntry(root, relative) : null };
}

// hash-object applies the path's filters, so a clean checkout under autocrlf still matches its index blob.
function workingTreeMatchesIndex(root, relative, index) {
  return index !== null && git(root, ['hash-object', '--', relative]).stdout.trim() === index.blob;
}

function indexEntry(root, relative) {
  const rows = git(root, ['ls-files', '--stage', '-z', '--', relative]).stdout.split('\0').filter(Boolean);
  if (rows.length === 0) return null;
  requireCondition(rows.length === 1 && /^\d+ [a-f0-9]+ 0\t/.test(rows[0]), 'unmerged-index', 'Resolve index conflicts before migration');
  const match = /^(\d+) ([a-f0-9]+) 0\t/.exec(rows[0]);
  return { mode: match[1], blob: match[2] };
}

function relocateIndex(root, move) {
  const source = indexEntry(root, move.source);
  const destination = indexEntry(root, move.destination);
  const same = entry => entry?.mode === move.index.mode && entry.blob === move.index.blob;
  if (source === null && same(destination)) return;
  requireCondition(same(source) && destination === null, 'migration-index-drift', 'Index changed during relocation; preserve staged work and reconcile before retrying');
  const zeros = '0'.repeat(move.index.blob.length);
  git(root, ['update-index', '-z', '--index-info'], [0], `0 ${zeros}\t${move.source}\0${move.index.mode} ${move.index.blob}\t${move.destination}\0`);
}

// The reference rewrite leaves a relocated destination with its rename staged and its new content unstaged. It is restaged
// only when the journaled rewrite decision found no staged-versus-working difference and the migration's own entry is still current.
function restageRewritten(root, move) {
  if (!move.restage) return;
  const current = indexEntry(root, move.destination);
  if (current?.mode !== move.index.mode || current.blob !== move.index.blob) return;
  git(root, ['add', '--', move.destination]);
}

function ownershipDecision(ownership, relative) {
  return Object.entries(ownership).filter(([name]) => relative === name || relative.startsWith(name + '/')).sort((a, b) => b[0].length - a[0].length)[0]?.[1];
}

function unwrapOwnershipSubject(root, relative) {
  // Coordination artifacts belong to the directory or target they protect.
  if (isLockName(path.posix.basename(relative))) return path.posix.dirname(relative);
  return relative.toLowerCase().endsWith(RECOVERY_SUFFIX) && !fs.lstatSync(path.join(root, relative)).isDirectory()
    ? relative.slice(0, -RECOVERY_SUFFIX.length) : relative;
}

function validateOwnership(root, ownership) {
  for (const [relative, value] of Object.entries(ownership)) {
    requireCondition(relative.startsWith('.claude/') && ['nightshift', 'preserve'].includes(value), 'invalid-ownership', 'Ownership entries need .claude project paths and nightshift or preserve decisions');
    projectFile(root, relative);
  }
}

function migrationUnwrapOptions(root, ownership) {
  validateOwnership(root, ownership);
  const selected = [...BACKLOG_FILES, ...OWNED_DIRECTORIES].map(name => '.claude/' + name).concat(Object.keys(ownership));
  const overrides = Object.entries(ownership).filter(([, choice]) => choice === 'nightshift').map(([name]) => name);
  return {
    recursive: true,
    exclude(target) {
      const relative = path.relative(root, target).split(path.sep).join('/');
      const subject = unwrapOwnershipSubject(root, relative);
      if (ownershipDecision(ownership, subject) === 'preserve' && !overrides.some(name => name.startsWith(subject + '/'))) return true;
      if (subject === '.claude') return false;
      if (path.posix.dirname(relative) === '.claude' && (isLockName(path.basename(target)) || target.toLowerCase().endsWith(RECOVERY_SUFFIX))) return false;
      return !selected.some(name => subject === name || subject.startsWith(name + '/') || name.startsWith(subject + '/'));
    },
  };
}

function inventory(root, ownership = {}) {
  const files = [];
  const directories = [];
  const preserved = [];
  const undecided = [];
  const visited = new Set();
  const decision = relative => ownershipDecision(ownership, unwrapOwnershipSubject(root, relative));
  validateOwnership(root, ownership);
  const visit = relative => {
    if (visited.has(relative)) return;
    visited.add(relative);
    const target = projectFile(root, relative);
    if (!fs.existsSync(target)) return;
    if (isLockName(path.basename(target))) {
      if (decision(relative) === 'preserve') { preserved.push(relative); return; }
      inspectLock(path.dirname(target));
      return;
    }
    if (fs.statSync(target).isDirectory()) {
      const keptBefore = preserved.length;
      const unknownBefore = undecided.length;
      for (const entry of fs.readdirSync(target)) visit(relative + '/' + entry);
      const empty = fs.readdirSync(target).length === 0;
      if (empty && decision(relative) === 'preserve') preserved.push(relative);
      else if (empty && /^\.claude\/(?:plans|specs)(?:\/|$)/.test(relative) && !decision(relative)) undecided.push(relative);
      else if (preserved.length === keptBefore && undecided.length === unknownBefore) directories.push(relative);
    } else if (decision(relative) === 'preserve') preserved.push(relative);
    else if (/^\.claude\/(?:plans|specs)\//.test(relative) && !decision(relative)) undecided.push(relative);
    else files.push({ source: relative, destination: relative.replace(/^\.claude\//, '.nightshift/'), sha256: hash(fs.readFileSync(target)), ...policy(root, relative) });
  };
  for (const name of [...BACKLOG_FILES, ...OWNED_DIRECTORIES]) visit('.claude/' + name);
  for (const relative of Object.keys(ownership)) visit(relative);
  return { files, directories, preserved, undecided };
}

function migrationPolicy(options) {
  const policy = { ownership: options.ownership ?? {}, excludeReferences: options.excludeReferences ?? [], historicalReferences: options.historicalReferences ?? [], activeReferences: options.activeReferences ?? [] };
  for (const key of ['excludeReferences', 'historicalReferences', 'activeReferences']) requireCondition(Array.isArray(policy[key]) && policy[key].every(value => typeof value === 'string' && value.length > 0), 'invalid-policy', `${key} must contain project-relative paths or directory prefixes ending in /`);
  return policy;
}

function matchesPurpose(file, paths) {
  return paths.some(candidate => file === candidate || candidate.endsWith('/') && file.startsWith(candidate));
}

function ignorePath(relative) {
  return '/' + relative.replace(/[\\*?\[\]]/g, '\\$&');
}

function excludedReference(file, policy) {
  return ['.tmp/', '.nightshift/setup/', '.nightshift/runs/', '.claude/runs/'].some(prefix => file.startsWith(prefix)) || ['AGENTS.md', 'CLAUDE.md', '_AGENTS.md', '_CLAUDE.md'].includes(file) || matchesPurpose(file, policy.excludeReferences ?? []);
}

function assertQuiescent(root) {
  for (const home of ['.claude', '.nightshift']) {
    const file = projectFile(root, home + '/runs/state.sqlite');
    if (!fs.existsSync(file)) continue;
    const database = new DatabaseSync(file, { readOnly: true });
    try {
      const row = database.prepare('SELECT r.state FROM runs r JOIN active a ON a.id=r.id WHERE a.singleton=1').get();
      if (!row) continue;
      const state = JSON.parse(row.state);
      requireCondition(['stopped', 'complete', 'paused'].includes(state.status) && state.workers.every(worker => !workerIsActive(worker)), 'active-writer', 'Stop or pause the owning run and reconcile every worker before migration');
    } finally { database.close(); }
  }
}

class Setup {
  constructor(root) {
    this.root = fs.realpathSync.native(root);
    this.directory = safeDirectory(this.root, '.nightshift/setup', true);
    const ignore = path.join(this.directory, '.gitignore');
    if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, '*\r\n', { flag: 'wx' });
    const database = path.join(this.directory, 'journal.sqlite');
    projectFile(this.root, '.nightshift/setup/journal.sqlite');
    this.db = new DatabaseSync(database);
    this.db.exec('PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS migration (singleton INTEGER PRIMARY KEY CHECK(singleton=1), body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS edits (path TEXT PRIMARY KEY, before_hash TEXT NOT NULL, after_bytes BLOB NOT NULL, after_hash TEXT NOT NULL);');
  }

  close() { this.db.close(); }

  saved() {
    const row = this.db.prepare('SELECT body FROM migration WHERE singleton=1').get();
    return row ? JSON.parse(row.body) : null;
  }

  save(state) {
    this.db.prepare('UPDATE migration SET body=? WHERE singleton=1').run(JSON.stringify(state));
  }

  unwrapScope(options) {
    const ownership = this.saved()?.policy?.ownership ?? migrationPolicy(options).ownership;
    return { targets: [path.join(this.root, '.claude')], options: migrationUnwrapOptions(this.root, ownership) };
  }

  pendingUnwrap(options) {
    const scope = this.unwrapScope(options);
    return [...recoveryDiagnostics(scope.targets, scope.options), ...recoveryDiagnostics([path.join(this.root, '.nightshift')])];
  }

  inspect(options = {}) {
    assertQuiescent(this.root);
    const unwrapRecovery = this.pendingUnwrap(options);
    if (unwrapRecovery.length > 0) return { root: this.root, status: 'unwrap-recovery-required', unwrapRecovery };
    const saved = this.saved();
    if (saved) return saved;
    const policy = migrationPolicy(options);
    const found = inventory(this.root, policy.ownership);
    for (const move of found.files) {
      const destination = projectFile(this.root, move.destination);
      requireCondition(!fs.existsSync(destination), 'destination-conflict', `Destination already exists; reconcile ownership before migration: ${move.destination}`);
    }
    const directoryPolicies = found.directories.map(source => ({
      source, destination: source.replace(/^\.claude\//, '.nightshift/'),
      ignored: git(this.root, ['check-ignore', '--no-index', '-q', '--', source + '/'], [0, 1]).status === 0,
    }));
    const referenceDecisions = this.referenceDecisions(found, policy);
    const backlog = found.files.length > 0 ? validateBacklog(this.root, '.claude') : null;
    return { root: this.root, status: 'prepared', ...found, directoryPolicies, policy, referenceDecisions, backlog };
  }

  apply(options = {}) {
    const locks = [];
    try {
      const scope = this.unwrapScope(options);
      for (const parent of discoverUnwrapArtifacts(scope.targets, scope.options).locks) locks.push(acquireLock(parent, { create: false }));
      return this.applyLocked(options);
    } finally { for (const lock of locks.reverse()) lock?.close(); }
  }

  applyLocked(options = {}) {
    assertQuiescent(this.root);
    const pending = this.pendingUnwrap(options);
    requireCondition(pending.length === 0, 'unwrap-recovery-required', 'Resolve unfinished unwrap before migration: ' + JSON.stringify(pending));
    let state = this.saved();
    if (!state) {
      // The parser report is a pre-relocation snapshot for the caller; the journal keeps only the migration inventory.
      const { backlog, ...prepared } = this.inspect(options);
      requireCondition(prepared.undecided.length === 0, 'uncertain-ownership', 'Classify ambiguous legacy content as nightshift or preserve before applying: ' + prepared.undecided.join(', '));
      requireCondition(prepared.referenceDecisions.length === 0, 'reference-policy-required', 'Classify active or historical consumers, or normalize unsupported path literals and computed paths before migration: ' + prepared.referenceDecisions.join(', '));
      if (backlog) requireValidBacklog(backlog, '.claude');
      state = prepared;
      this.db.prepare('INSERT INTO migration VALUES (1, ?)').run(JSON.stringify(state));
    }
    const policy = state.policy ?? migrationPolicy({});
    for (const key of ['ownership', 'excludeReferences', 'historicalReferences', 'activeReferences']) if (options[key] !== undefined) requireCondition(require('node:util').isDeepStrictEqual(options[key], policy[key]), 'migration-policy-drift', 'Resume using the saved ownership and reference policy; reconcile conflicting instructions first');
    const remaining = () => {
      const found = inventory(this.root, policy.ownership);
      return [...found.files.map(file => file.source), ...found.undecided.filter(directory => !state.directories.includes(directory))];
    };
    requireCondition(state.root === this.root, 'wrong-project', 'Migration journal belongs to another project');
    if (state.status === 'complete') {
      requireCondition(remaining().length === 0, 'new-legacy-content', 'New legacy files appeared after migration; reconcile them before starting work');
      this.rebindRun(state);
      return state;
    }
    const record = () => this.save(state);
    for (const directory of state.directories) safeDirectory(this.root, directory.replace(/^\.claude\//, '.nightshift/'), true);
    for (const move of state.files) {
      const source = projectFile(this.root, move.source);
      const destination = projectFile(this.root, move.destination);
      const sourceExists = fs.existsSync(source);
      const destinationExists = fs.existsSync(destination);
      if (move.done) {
        requireCondition(!sourceExists && destinationExists, 'migration-drift', 'Completed relocation no longer has one authoritative destination');
        continue;
      }
      if (sourceExists) requireCondition(hash(fs.readFileSync(source)) === move.sha256, 'migration-drift', `Source changed during migration: ${move.source}`);
      if (destinationExists) requireCondition(hash(fs.readFileSync(destination)) === move.sha256, 'migration-drift', `Destination changed during migration: ${move.destination}`);
      requireCondition(sourceExists || destinationExists, 'migration-data-loss', 'Neither source nor destination exists');
      safeDirectory(this.root, path.posix.dirname(move.destination), true);
      if (!destinationExists) {
        fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
        const handle = fs.openSync(destination, 'r+');
        try { fs.fsyncSync(handle); } finally { fs.closeSync(handle); }
        options.afterCopy?.(move);
      }
      requireCondition(hash(fs.readFileSync(destination)) === move.sha256, 'migration-drift', 'Copied destination does not match its source');
      if (sourceExists) {
        requireCondition(hash(fs.readFileSync(source)) === move.sha256, 'migration-drift', 'Source changed before removal');
        fs.unlinkSync(source);
      }
      options.afterRemove?.(move);
      if (move.tracked) relocateIndex(this.root, move);
      options.afterMove?.(move);
      move.done = true;
      record();
    }
    state.status = 'relocated';
    record();
    this.updateReferences(state, { ...options, ...policy });
    this.rebindRun(state);
    this.preservePolicies(state);
    const leftovers = remaining();
    requireCondition(leftovers.length === 0, 'new-legacy-content', 'New legacy files appeared during migration; reconcile writers before proceeding');
    for (const directory of [...state.directories].sort((a, b) => b.length - a.length)) {
      const target = projectFile(this.root, directory);
      if (fs.existsSync(target) && fs.readdirSync(target).length === 0) fs.rmdirSync(target);
    }
    state.status = 'complete';
    record();
    return state;
  }

  referenceDecisions(state, policy) {
    const moves = relocationMoves(state);
    if (!moves.some(move => move.source !== move.destination)) return [];
    const candidates = git(this.root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']).stdout.split('\0').filter(Boolean);
    const unresolved = [];
    for (const file of new Set([...candidates, ...state.files.map(move => move.source)])) {
      if (file === '.gitignore' || excludedReference(file, policy) || file.startsWith('.claude/plans/') || matchesPurpose(file, policy.historicalReferences ?? [])) continue;
      const target = projectFile(this.root, file);
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) continue;
      const bytes = fs.readFileSync(target);
      try {
        if (file.endsWith('.json')) {
          rewriteReferences(bytes, moves, { sourcePath: file, root: this.root });
          continue;
        }
        if (/\.(?:md|toml|ya?ml)$/.test(file)) {
          if (!file.endsWith('.md') && hasUnsupportedPathLiterals(bytes, moves, this.root)) unresolved.push(file);
          rewriteReferences(bytes, moves, { markdown: file.endsWith('.md'), sourcePath: file, root: this.root });
          continue;
        }
        if (!require('node:buffer').isUtf8(bytes) || bytes.includes(0) || !bytes.toString('utf8').includes('.claude')) continue;
        // An undeclared consumer that the rewrite would change needs classification; a declared one the rewrite leaves unchanged hides a computed or unsupported path.
        const active = matchesPurpose(file, policy.activeReferences ?? []);
        const rewritten = !rewriteReferences(bytes, moves).equals(bytes);
        if (active !== rewritten) unresolved.push(file);
      } catch (error) {
        if (!(error instanceof SyntaxError || error instanceof UnresolvedPathError)) throw error;
        unresolved.push(file);
      }
    }
    return [...new Set(unresolved)];
  }

  rebindRun(migration) {
    if (!migration.files.some(move => move.source === '.claude/runs/state.sqlite')) return;
    const store = new RunStore(this.root);
    try {
      const saved = store.read();
      if (!saved || saved.homeMigration?.to === '.nightshift') return;
      const moves = relocationMoves(migration);
      const translate = value => {
        if (typeof value !== 'string') return value;
        const absolute = path.isAbsolute(value);
        const relative = absolute ? path.relative(this.root, value).split(path.sep).join('/') : value;
        const suffixAt = relative.search(/[?#]/);
        const name = suffixAt < 0 ? relative : relative.slice(0, suffixAt);
        const mapped = relocated(name, moves);
        if (mapped === name) return value;
        return (absolute ? path.join(this.root, mapped) : mapped) + (suffixAt < 0 ? '' : relative.slice(suffixAt));
      };
      store.update(saved.controller, saved.revision, 'project-home-migrated', state => {
        for (const task of state.tasks) {
          if (task.agreement.spec) task.agreement.spec = translate(task.agreement.spec);
          for (const reference of task.probeEvidence ?? []) reference.path = translate(reference.path);
          for (const finding of task.findings) if (finding.route) finding.route = translate(finding.route);
          // Historical snapshots/receipts retain original provenance. Relocated inputs
          // and commitments must be checked again through the normal review gate.
          task.requirementsRevision = state.revision + 1;
        }
        for (const worker of state.workers) {
          for (const key of ['artifactDirectory', 'receipt']) if (worker[key]) worker[key] = translate(worker[key]);
          worker.writes = worker.writes.map(translate);
        }
        for (const followup of state.followups) if (followup.route) followup.route = translate(followup.route);
        state.homeMigration = { from: '.claude', to: '.nightshift', previousRevision: state.revision };
      });
    } finally { store.close(); }
  }

  updateReferences(state, options) {
    const moves = relocationMoves(state);
    if (!moves.some(move => move.source !== move.destination)) return;
    const candidates = git(this.root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']).stdout.split('\0').filter(Boolean);
    for (const file of new Set([...candidates, ...state.files.map(move => move.destination)])) {
      if (excludedReference(file, options)) continue;
      if (!/\.(?:md|json|toml|ya?ml)$/.test(file) && !matchesPurpose(file, options.activeReferences ?? [])) continue;
      const target = projectFile(this.root, file);
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) continue;
      const move = state.files.find(candidate => candidate.destination === file);
      let edit = this.db.prepare('SELECT * FROM edits WHERE path=?').get(file);
      if (!edit) {
        const before = fs.readFileSync(target);
        const historical = file.startsWith('.nightshift/plans/') || matchesPurpose(file, options.historicalReferences ?? []);
        const after = rewriteReferences(before, moves, { markdown: file.endsWith('.md'), historical, sourcePath: move?.source ?? file, destinationPath: file, root: this.root });
        if (after.equals(before)) continue;
        if (move) {
          // Decided on the bytes the rewrite starts from and journaled before the edits row, so a rerun reuses it and an
          // edit made to the destination during an interruption is never swept into the index.
          move.restage = move.tracked && workingTreeMatchesIndex(this.root, file, move.index);
          this.save(state);
        }
        this.db.prepare('INSERT INTO edits VALUES (?, ?, ?, ?)').run(file, hash(before), after, hash(after));
        edit = this.db.prepare('SELECT * FROM edits WHERE path=?').get(file);
      }
      const currentHash = hash(fs.readFileSync(target));
      if (currentHash !== edit.after_hash) {
        requireCondition(currentHash === edit.before_hash, 'reference-drift', `Navigable references changed during migration: ${file}`);
        const temporary = target + '.nightshift-new';
        if (fs.existsSync(temporary)) requireCondition(hash(fs.readFileSync(temporary)) === edit.after_hash, 'reference-drift', 'Interrupted reference write has conflicting content');
        else fs.writeFileSync(temporary, Buffer.from(edit.after_bytes), { flag: 'wx' });
        fs.renameSync(temporary, target);
        options.afterReference?.(file);
      }
      if (move) restageRewritten(this.root, move);
    }
  }

  matchedIgnoreLines(state) {
    // Only rules git reports matching relocated content are translated; host-only .claude/ rules keep their original meaning.
    const paths = [...state.files.map(move => move.source), ...state.directories.map(directory => directory + '/')];
    if (paths.length === 0) return new Set();
    const report = git(this.root, ['check-ignore', '--no-index', '--verbose', '-z', '--stdin'], [0, 1], paths.join('\0') + '\0').stdout.split('\0');
    const lines = new Set();
    for (let index = 0; index + 3 < report.length; index += 4) {
      const [source, line] = report.slice(index, index + 2);
      if (source === '.gitignore') lines.add(Number(line));
    }
    return lines;
  }

  preservePolicies(state) {
    const target = projectFile(this.root, '.gitignore');
    const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
    const newline = existing.includes('\r\n') || !existing.includes('\n') ? '\r\n' : '\n';
    const lines = existing.split(/\r?\n/);
    const translated = [...this.matchedIgnoreLines(state)].sort((a, b) => a - b).map(line => lines[line - 1]).filter(line => !line.startsWith('#') && line.includes('.claude/')).map(line => line.replaceAll('.claude/', '.nightshift/'));
    if (translated.length > 0) {
      const block = '# Nightshift migrated ignore rules' + newline + translated.join(newline) + newline;
      const separator = existing === '' || /\r?\n\r?\n$/.test(existing) ? '' : existing.endsWith('\n') ? newline : newline + newline;
      if (!existing.includes(block)) fs.writeFileSync(target, existing + separator + block);
    }
    const rules = [];
    for (const move of state.files) {
      const current = policy(this.root, move.destination);
      if (move.tracked) requireCondition(current.tracked, 'tracking-drift', 'A tracked file lost its tracking state');
      else if (move.ignored !== current.ignored) {
        requireCondition(move.ignored, 'ignore-conflict', `Destination policy hides previously visible content: ${move.destination}`);
        rules.push(ignorePath(move.destination));
      }
    }
    if (!state.directories.includes('.claude/runs')) rules.push('/.nightshift/runs/');
    for (const directory of state.directoryPolicies ?? []) {
      const ignored = git(this.root, ['check-ignore', '--no-index', '-q', '--', directory.destination + '/'], [0, 1]).status === 0;
      if (directory.ignored && !ignored) rules.push(ignorePath(directory.destination) + '/');
    }
    const previous = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
    const missing = [...new Set(rules)].filter(rule => !previous.split(/\r?\n/).includes(rule));
    if (missing.length > 0) fs.writeFileSync(target, previous + (previous && !previous.endsWith('\n') ? newline : '') + missing.join(newline) + newline);
    for (const move of state.files) {
      const current = policy(this.root, move.destination);
      requireCondition(current.tracked === move.tracked && (move.tracked || current.ignored === move.ignored), 'ignore-conflict', `Final ignore rules changed the original tracking or visibility choice for ${move.destination}; reconcile the rules before completing migration`);
    }
  }
}

function runBundledScript(script, args) {
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '..', script), ...require('./releases/entry').helperArguments(args)], { windowsHide: true, encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  let json = null;
  try { json = JSON.parse(result.stdout); } catch { /* Non-JSON output is reported by the caller through the exit status and stderr. */ }
  return { ...result, json };
}

function validateBacklog(root, home) {
  const parser = runBundledScript('skills/ready/ready.js', [path.join(root, home)]);
  requireCondition(!parser.error && parser.status === 0 && parser.json !== null, 'backlog-validation', parser.error?.message ?? (parser.json ? JSON.stringify(parser.json) : parser.stderr));
  return parser.json;
}

function requireValidBacklog(report, home) {
  const { structuralErrors, notices } = report;
  requireCondition(structuralErrors.length === 0, 'backlog-validation', `Backlog under ${home} has structural problems; scoped repair is required: ` + JSON.stringify({ structuralErrors, notices }));
}

function unwrapBacklog(root) {
  const unwrap = runBundledScript('skills/init-backlog/unwrap.js', ['--write', path.join(root, '.nightshift')]);
  try {
    requireCondition(!unwrap.error && unwrap.status === 0 && Array.isArray(unwrap.json), 'backlog-unwrap', unwrap.error?.message ?? (unwrap.json ? JSON.stringify(unwrap.json) : unwrap.stderr));
  } catch (error) {
    error.completed = Array.isArray(unwrap.json) ? unwrap.json.filter(entry => entry.rewritten === true) : [];
    throw error;
  }
  return unwrap.json;
}

function initialize(root, options = {}) {
  requireCondition(options.unwrap === undefined || typeof options.unwrap === 'boolean', 'invalid-policy', 'unwrap must be true or false');
  root = fs.realpathSync.native(root);
  assertQuiescent(root);
  const setup = new Setup(root);
  const completed = [];
  try {
    const pending = setup.pendingUnwrap(options);
    requireCondition(options.unwrap === true || pending.length === 0, 'unwrap-recovery-required', 'Unfinished unwrap must be resolved before setup: ' + JSON.stringify(pending));
    const scope = setup.unwrapScope(options);
    if (options.unwrap === true) {
      completed.push(...recoverPendingUnwrap(scope.targets, scope.options));
      completed.push(...recoverPendingUnwrap([path.join(root, '.nightshift')]));
    }
    const migration = setup.apply(options);
    for (const directory of ['features', 'bugs', 'patterns', 'runs']) safeDirectory(setup.root, '.nightshift/' + directory, true);
    for (const file of BACKLOG_FILES) {
      const target = projectFile(setup.root, '.nightshift/' + file);
      if (fs.existsSync(target)) continue;
      const template = path.basename(file, '.md').toLowerCase().replaceAll('_', '-') + '.md';
      const content = fs.readFileSync(path.resolve(__dirname, '../skills/init-backlog/templates', template), 'utf8').replace(/\r?\n/g, '\r\n');
      fs.writeFileSync(target, content, { flag: 'wx' });
    }
    if (options.unwrap === true) completed.push(...unwrapBacklog(setup.root));
    const unwrapped = options.unwrap === true ? completed : null;
    const backlog = validateBacklog(setup.root, '.nightshift');
    requireValidBacklog(backlog, '.nightshift');
    return { migration, unwrapped, backlog };
  } catch (error) {
    error.completed = [...completed, ...(error.completed ?? [])];
    throw error;
  } finally { setup.close(); }
}

module.exports = { BACKLOG_FILES, OWNED_DIRECTORIES, Setup, assertQuiescent, initialize, inventory, rewriteReferences };
