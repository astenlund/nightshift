#!/usr/bin/env node
'use strict'

const assert = require('node:assert/strict')
const rigor = require('./rigor.js')

let failures = 0
function check(name, fn) {
  try {
    fn()
    console.log(`ok - ${name}`)
  } catch (err) {
    failures += 1
    console.error(`not ok - ${name}\n  ${err.message}`)
  }
}

check('baselineTier maps every audience category', () => {
  assert.equal(rigor.baselineTier('personal use'), 'low')
  assert.equal(rigor.baselineTier('trusted circle'), 'low')
  assert.equal(rigor.baselineTier('paying customers'), 'medium')
  assert.equal(rigor.baselineTier('organization'), 'high')
  assert.equal(rigor.baselineTier('public'), 'high')
})

check('baselineTier rejects an unknown category', () => {
  assert.throws(() => rigor.baselineTier('aliens'), /unknown audience category/)
})

check('upliftedTier caps at high and never drops below baseline', () => {
  assert.equal(rigor.upliftedTier('low', 0), 'low')
  assert.equal(rigor.upliftedTier('low', 1), 'medium')
  assert.equal(rigor.upliftedTier('low', 2), 'high')
  assert.equal(rigor.upliftedTier('low', 5), 'high')
  assert.equal(rigor.upliftedTier('medium', 1), 'high')
  assert.equal(rigor.upliftedTier('high', 1), 'high')
})

check('upliftedTier rejects a negative count', () => {
  assert.throws(() => rigor.upliftedTier('low', -1), /negative/)
})

check('upliftedTier rejects an unknown baseline tier', () => {
  assert.throws(() => rigor.upliftedTier('ultra', 1), /unknown baseline tier/)
})

check('dimensionEffort enumerates exactly the five scaling dimensions', () => {
  const low = rigor.dimensionEffort('low')
  assert.deepEqual(Object.keys(low).sort(), [
    'compatibility', 'observability', 'proofEffort', 'recovery', 'validation',
  ])
  assert.equal(low.validation, 'low')
  assert.equal(low.proofEffort, 'low')
})

check('dimensionEffort maps medium and high per the fixed rule', () => {
  const medium = rigor.dimensionEffort('medium')
  const high = rigor.dimensionEffort('high')
  assert.equal(medium.validation, 'medium')
  assert.equal(high.validation, 'high')
  assert.equal(high.recovery, 'high')
  assert.equal(high.compatibility, 'high')
  assert.equal(high.observability, 'high')
  assert.equal(high.proofEffort, 'high')
})

check('dimensionEffort rejects an unknown tier', () => {
  assert.throws(() => rigor.dimensionEffort('ultra'), /unknown tier/)
})

check('derive combines the three steps and caps at high', () => {
  const personalUseful = rigor.derive({ audienceCategory: 'personal use', firedUplifts: 0 })
  assert.equal(personalUseful.tier, 'low')
  assert.equal(personalUseful.effort.validation, 'low')

  const publicCritical = rigor.derive({ audienceCategory: 'public', firedUplifts: 5 })
  assert.equal(publicCritical.tier, 'high')
  assert.equal(publicCritical.effort.proofEffort, 'high')
})

check('derive rejects invalid inputs', () => {
  assert.throws(() => rigor.derive({ audienceCategory: 'nope', firedUplifts: 0 }), /unknown audience category/)
  assert.throws(() => rigor.derive({ audienceCategory: 'public', firedUplifts: -2 }), /negative/)
  assert.throws(() => rigor.derive({ audienceCategory: 'public', firedUplifts: 1.5 }), /non-integer/)
})

if (failures > 0) {
  console.error(`${failures} check(s) failed`)
  process.exit(1)
}
console.log('all checks passed')
