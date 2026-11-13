'use strict';

const { fileIdentity, projectFile } = require('./evidence');

// The documentation paths: the Nightshift backlog (the four indexes, their history files and the record directories), Nightshift's
// durable reports, and Markdown files at the project root other than host instruction files. On a run created with the docs gate a
// code assessment ignores changes to them, and a closing review alone covers edits to them after triage. Governing specs, operating
// instructions, Markdown below the root and every other file stay code-assessment inputs.
const BACKLOG_FILES = Object.freeze(['.nightshift/FEATURES.md', '.nightshift/BUGS.md', '.nightshift/QUICK_WINS.md', '.nightshift/PATTERNS.md', '.nightshift/FEATURES_HISTORY.md', '.nightshift/BUGS_HISTORY.md', '.nightshift/QUICK_WINS_HISTORY.md']);
const DOCUMENTATION_DIRECTORIES = Object.freeze(['.nightshift/features/', '.nightshift/bugs/', '.nightshift/patterns/', '.nightshift/reports/']);
// The hosts load these as operating instructions; matched case-insensitively, as Windows resolves them.
const HOST_INSTRUCTION_FILES = new Set(['agents.md', 'agents.override.md', 'claude.md', 'claude.local.md']);

function isRootDocumentation(file) {
  const name = file.toLowerCase();
  return !name.includes('/') && name.endsWith('.md') && !HOST_INSTRUCTION_FILES.has(name);
}

function isDocumentationPath(file) {
  return BACKLOG_FILES.includes(file) || DOCUMENTATION_DIRECTORIES.some(directory => file.startsWith(directory)) || isRootDocumentation(file);
}

// Whether a record's code assessments ignore documentation-path changes: a delivery run created with the docs gate. Review contexts
// and runs without the gate compare every path, and keep the documentation relief a current docs review grants.
function ignoresDocumentationPaths(state) {
  return state?.docsGate === true && state.kind !== 'review';
}

// The governing artifacts that stay assessment inputs wherever they live: each task's governing spec and each one named in an
// assessment's recorded commitments.
function governingArtifacts(tasks, reviews) {
  const agreements = [...tasks.map(task => task?.agreement), ...reviews.flatMap(review => Object.values(review?.commitments ?? {}).map(value => value?.agreement))];
  return [...new Set(agreements.map(agreement => agreement?.spec).filter(file => typeof file === 'string'))];
}

// The identities of governing artifacts; throws when one cannot be established, which callers treat as a changed input.
function governingKeys(root, governing) {
  return new Set(governing.map(file => {
    projectFile(root, file);
    const identity = fileIdentity(root, file);
    if (!identity.exists) throw new Error(`Governing artifact ${file} is missing`);
    return identity.key;
  }));
}

// Splits changed paths into those a code-assessment comparison counts and the documentation paths it ignores. A governing artifact
// counts wherever it lives; when the identity of a governing artifact or of a changed documentation path cannot be established,
// every path counts.
function partitionDocumentationChanges(root, changes, governing) {
  const documentation = changes.filter(isDocumentationPath);
  if (documentation.length === 0) return { counted: changes, ignored: [] };
  try {
    const keys = governingKeys(root, governing);
    const ignored = new Set(documentation.filter(file => !governing.includes(file) && !keys.has(fileIdentity(root, file).key)));
    return { counted: changes.filter(file => !ignored.has(file)), ignored: [...ignored].sort() };
  } catch {
    // An identity that cannot be established ignores nothing, so the comparison stays cautious.
    return { counted: changes, ignored: [] };
  }
}

// Whether every path is one of the governing artifacts; false when an identity cannot be established.
function onlyGoverningArtifacts(root, paths, governing) {
  try {
    const keys = governingKeys(root, governing);
    return paths.every(file => governing.includes(file) || keys.has(fileIdentity(root, file).key));
  } catch {
    return false;
  }
}

module.exports = { BACKLOG_FILES, DOCUMENTATION_DIRECTORIES, governingArtifacts, ignoresDocumentationPaths, isDocumentationPath, isRootDocumentation, onlyGoverningArtifacts, partitionDocumentationChanges };
