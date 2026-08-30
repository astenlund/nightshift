'use strict'

const { backupParts } = require('./backups')
const { RECOVERY_LOCK_BASENAME } = require('./protocol')

function backupPairKey(parts) {
  return JSON.stringify([parts.directory, parts.snapshotId, parts.manifestId, parts.targetHash])
}

function createOwnerInventoryIndex(temporaryPaths) {
  const backupByTarget = new Map()
  const backupKeyByTarget = new Map()
  const backupPeerByTarget = new Map()
  const backupTargetHashes = new Set()
  const pairs = new Map()
  const temporaryTargets = new Set()
  for (const target of temporaryPaths) {
    temporaryTargets.add(target)
    const backup = backupParts(target)
    backupByTarget.set(target, backup)
    if (backup === null) continue
    const key = backupPairKey(backup)
    const pair = pairs.get(key) ?? {}
    pair[backup.kind] = target
    pairs.set(key, pair)
    backupKeyByTarget.set(target, key)
    backupTargetHashes.add(backup.targetHash)
  }
  for (const pair of pairs.values()) {
    if (pair.stage === undefined || pair.final === undefined) continue
    backupPeerByTarget.set(pair.stage, pair.final)
    backupPeerByTarget.set(pair.final, pair.stage)
  }

  return { backupByTarget, backupKeyByTarget, backupPeerByTarget, backupTargetHashes, temporaryTargets }
}

function backupForTarget(inventory, target) {
  return inventory.backupByTarget.has(target) ? inventory.backupByTarget.get(target) : backupParts(target)
}

function validateBackupSequence(inventory, temporaryStates) {
  const laterFinalPairs = new Set()
  let laterFinalCount = 0
  for (let index = temporaryStates.length - 1; index >= 0; index -= 1) {
    const item = temporaryStates[index]
    const backup = backupForTarget(inventory, item.target)
    if (backup?.kind === 'stage' && laterFinalCount !== 0 && !laterFinalPairs.has(backupPairKey(backup))) throw new Error('Owner backup stage/final tuple differs')
    if (backup?.kind === 'final') {
      laterFinalCount += 1
      laterFinalPairs.add(backupPairKey(backup))
    }
  }
}

function validateCleanupPrefix(record, inventory, states, isRecoveryTemporary) {
  const initialLockStage = `${RECOVERY_LOCK_BASENAME}.${record.pid}.${record.ownerNonce}.new`
  const nextLockStage = `${RECOVERY_LOCK_BASENAME}.${record.ownerNonce}.next`
  const laterFinalPairs = new Set()
  let initialLockCount = 0
  let laterMatchingManifestBackups = 0
  let laterOtherBackups = 0
  let laterPresent = 0
  let laterRecoveryTemporaries = 0
  for (let index = states.length - 1; index >= 0; index -= 1) {
    const item = states[index]
    const backup = backupForTarget(inventory, item.target)
    const recoveryTemporary = isRecoveryTemporary(item.target)
    if (!item.present && laterPresent !== 0 && !recoveryTemporary) {
      let exempt = laterMatchingManifestBackups
      if (item.target === initialLockStage) {
        exempt += laterOtherBackups + laterRecoveryTemporaries
      } else {
        if (item.target === nextLockStage) exempt += initialLockCount
        if (backup?.kind === 'stage' && backup.manifestId !== record.manifestId && laterFinalPairs.has(backupPairKey(backup))) exempt += 1
      }
      if (laterPresent > exempt) throw new Error('Owner inventory is not a contiguous cleanup prefix')
    }
    if (!item.present) continue
    laterPresent += 1
    if (backup !== null) {
      if (backup.manifestId === record.manifestId) {
        laterMatchingManifestBackups += 1
      } else {
        laterOtherBackups += 1
      }
      if (backup.kind === 'final') laterFinalPairs.add(backupPairKey(backup))
    } else if (recoveryTemporary) {
      laterRecoveryTemporaries += 1
    }
    if (item.target === initialLockStage) initialLockCount += 1
  }
}

function validateOwnerInventoryStates(record, inventory, temporaryStates, directoryStates, isRecoveryTemporary) {
  validateBackupSequence(inventory, temporaryStates)
  validateCleanupPrefix(record, inventory, temporaryStates, isRecoveryTemporary)
  validateCleanupPrefix(record, inventory, directoryStates, isRecoveryTemporary)
}

module.exports = { createOwnerInventoryIndex, validateOwnerInventoryStates }
