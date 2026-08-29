'use strict'

const { lstatSync } = require('node:fs')
const { join } = require('node:path')

const { boundedOpenOptions, enumerateDirectory, stableMetadata, stableOpenFile, withAttributeProbe } = require('./filesystem')
const { BACKUP_DIRECTORY, BACKUP_PATTERN, BACKUP_STAGE_PATTERN, MAX_MECHANICAL_FILE_BYTES, backupFileNames, compareOrdinal, sha256 } = require('./protocol')

function backupParts(target) {
  const stage = BACKUP_STAGE_PATTERN.exec(target)
  if (stage !== null) return { directory: BACKUP_DIRECTORY, kind: 'stage', manifestId: stage[2], snapshotId: stage[1], targetHash: stage[3] }
  const final = BACKUP_PATTERN.exec(target)
  if (final !== null) return { directory: BACKUP_DIRECTORY, kind: 'final', manifestId: final[2], snapshotId: final[1], targetHash: final[3] }

  return null
}

function backupNames(target, snapshotId, manifestId) {
  return backupFileNames(snapshotId, manifestId, sha256(Buffer.from(target, 'utf8')))
}

function backupTarget(target, snapshotId, manifestId) {
  return backupNames(target, snapshotId, manifestId).final
}

function backupStageTarget(target, snapshotId, manifestId) {
  return backupNames(target, snapshotId, manifestId).stage
}

function classifyBackup(backup, current) {
  return current === null ? 'orphan' : current.rawSha256 === backup.rawSha256 && current.mode === backup.mode ? 'redundant' : 'divergent'
}

function inspectBackups(root, targets, options = {}) {
  const directory = join(root, BACKUP_DIRECTORY)
  try {
    const metadata = stableMetadata(directory, { root })
    if (!metadata.metadata.isDirectory() || metadata.metadata.isSymbolicLink()) throw new Error('Backup directory is not an ordinary confined directory')
  } catch (error) {
    if (error?.code === 'ENOENT') return { backups: [], problems: [], warnings: [] }

    throw error
  }
  const enumerationOptions = withAttributeProbe(options)
  const entries = enumerateDirectory(directory, enumerationOptions)
  const targetByHash = new Map((targets ?? []).map((item) => [sha256(Buffer.from(item.target, 'utf8')), item.target]))
  const backups = []
  const problems = []
  for (const entry of entries) {
    const name = entry.name
    const target = `${BACKUP_DIRECTORY}/${name}`
    const parts = backupParts(target)
    if (parts === null || parts.kind !== 'final') continue
    const path = join(root, ...target.split('/'))
    const backup = stableOpenFile(root, path, boundedOpenOptions(options, MAX_MECHANICAL_FILE_BYTES, { requireSingleLink: true }))
    const currentTarget = targetByHash.get(parts.targetHash)
    let current = null
    if (currentTarget !== undefined) {
      try {
        current = stableOpenFile(root, join(root, ...currentTarget.split('/')), boundedOpenOptions(options, MAX_MECHANICAL_FILE_BYTES, { requireSingleLink: true }))
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
    }
    backups.push(target)
    if (currentTarget !== undefined && classifyBackup(backup, current) === 'divergent') {
      problems.push({ blocking: true, code: 'runtime-state', detail: 'Retained unwrap backup differs from its controlled target.', evidencePaths: [target, currentTarget].sort(compareOrdinal), target: currentTarget })
    }
  }
  backups.sort(compareOrdinal)
  problems.sort((left, right) => compareOrdinal(`${left.target}\0${left.detail}`, `${right.target}\0${right.detail}`))
  const warnings = backups.length === 0 ? [] : [{ code: 'manual-cleanup', detail: backups.length === 1 ? 'One retained unwrap backup requires manual cleanup.' : `${backups.length} retained unwrap backups require manual cleanup.`, target: backups.length === 1 ? backups[0] : null }]

  return { backups, problems, warnings }
}

function retainedBackupPaths(root, backups) {
  return backups.filter((backup) => BACKUP_PATTERN.test(backup)).filter((backup) => {
    try {
      lstatSync(join(root, ...backup.split('/')))

      return true
    } catch (error) {
      if (error?.code === 'ENOENT') return false

      throw error
    }
  }).sort(compareOrdinal)
}

module.exports = { BACKUP_PATTERN, BACKUP_STAGE_PATTERN, backupParts, backupStageTarget, backupTarget, classifyBackup, inspectBackups, retainedBackupPaths }
