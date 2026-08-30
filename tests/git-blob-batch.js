'use strict'

function parseGitBlobBatch(bytes, items, { batchLabel, blobLimitLabel, maxBlobBytes, maxTotalBytes }) {
  if (!Buffer.isBuffer(bytes) || !Array.isArray(items) || typeof batchLabel !== 'string' || typeof blobLimitLabel !== 'string' || !Number.isSafeInteger(maxBlobBytes) || maxBlobBytes < 0 || !Number.isSafeInteger(maxTotalBytes) || maxTotalBytes < 0) {
    throw new Error('Git blob batch parser received an invalid contract')
  }
  const sourceFiles = new Map()
  let offset = 0
  let totalBytes = 0
  for (const item of items) {
    const path = typeof item === 'string' ? item : item.path
    const expectedObjectId = typeof item === 'string' ? null : item.objectId
    const headerEnd = bytes.indexOf(0x0a, offset)
    if (headerEnd === -1) {
      throw new Error(`${batchLabel} is missing an object header`)
    }
    const header = bytes.subarray(offset, headerEnd).toString('ascii')
    const matched = /^([a-f0-9]{40,64}) blob ([0-9]+)$/.exec(header)
    if (matched === null) {
      throw new Error(`${batchLabel} returned an invalid object header: ${path}`)
    }
    if (expectedObjectId !== null && matched[1] !== expectedObjectId) {
      throw new Error(`${batchLabel} returned an unexpected object ID: ${path}`)
    }
    const size = Number(matched[2])
    if (!Number.isSafeInteger(size) || size > maxBlobBytes) {
      throw new Error(`${blobLimitLabel} exceed their byte limit`)
    }
    const contentStart = headerEnd + 1
    const contentEnd = contentStart + size
    if (contentEnd >= bytes.length || bytes[contentEnd] !== 0x0a) {
      throw new Error(`${batchLabel} returned truncated object bytes: ${path}`)
    }
    totalBytes += size
    if (totalBytes > maxTotalBytes) {
      throw new Error(`${blobLimitLabel} exceed their byte limit`)
    }
    sourceFiles.set(path, Buffer.from(bytes.subarray(contentStart, contentEnd)))
    offset = contentEnd + 1
  }
  if (offset !== bytes.length) {
    throw new Error(`${batchLabel} returned trailing output`)
  }

  return sourceFiles
}

module.exports = { parseGitBlobBatch }
