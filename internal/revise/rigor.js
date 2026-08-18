#!/usr/bin/env node
'use strict'

// Deterministic derivation core behind the rigor profile (the "Operating
// context" section) for revise-spec and revise-plan. Implements the three
// firm steps of the calibrate-first-draft-rigor feature:
//
//   Step 1: audience category -> baseline tier (AUDIENCE_BASELINE)
//   Step 2: fired uplift count -> tier uplift, capped at TIER_CAP
//   Step 3: settled tier -> per-dimension effort on the five scaling
//           dimensions (DIMENSION_EFFORT)
//
// Only the deterministic machinery lives here. Judgment boundaries are
// deliberately NOT encoded as numbers: mapping the four audience components
// to a category, and deciding whether each uplift predicate fired, are
// author judgments recorded as deviation entries in the spec prose. This
// module takes those settled values as input and derives what follows
// mechanically.
//
// Usage: node rigor.js <audienceCategory> <firedUpliftCount>

const AUDIENCE_BASELINE = Object.freeze({
  'personal use': 'low',
  'trusted circle': 'low',
  'paying customers': 'medium',
  'organization': 'high',
  'public': 'high',
})

const TIER_CAP = 'high'

const UPLIFTS = Object.freeze([
  'deployment_criticality',
  'failure_consequence',
  'concurrency_compatibility',
  'reversibility_recovery',
  'expected_lifetime',
])

const DIMENSION_EFFORT = Object.freeze({
  low: {
    validation: 'low',
    recovery: 'low',
    compatibility: 'low',
    observability: 'low',
    proofEffort: 'low',
  },
  medium: {
    validation: 'medium',
    recovery: 'medium',
    compatibility: 'medium',
    observability: 'medium',
    proofEffort: 'medium',
  },
  high: {
    validation: 'high',
    recovery: 'high',
    compatibility: 'high',
    observability: 'high',
    proofEffort: 'high',
  },
})

function baselineTier(audienceCategory) {
  const tier = AUDIENCE_BASELINE[audienceCategory]
  if (tier === undefined) {
    throw new Error(`unknown audience category: ${audienceCategory}`)
  }
  return tier
}

function upliftedTier(baseline, firedUpliftCount) {
  if (!Number.isInteger(firedUpliftCount) || firedUpliftCount < 0) {
    throw new Error(`negative or non-integer uplift count: ${firedUpliftCount}`)
  }
  const ordinal = { low: 0, medium: 1, high: 2 }
  const base = ordinal[baseline]
  if (base === undefined) {
    throw new Error(`unknown baseline tier: ${baseline}`)
  }
  const clamped = Math.min(base + firedUpliftCount, ordinal[TIER_CAP])
  return Object.keys(ordinal).find((tier) => ordinal[tier] === clamped)
}

function dimensionEffort(tier) {
  const effort = DIMENSION_EFFORT[tier]
  if (effort === undefined) {
    throw new Error(`unknown tier: ${tier}`)
  }
  return effort
}

function derive({ audienceCategory, firedUplifts }) {
  const tier = upliftedTier(baselineTier(audienceCategory), firedUplifts)
  return { tier, effort: dimensionEffort(tier) }
}

module.exports = {
  AUDIENCE_BASELINE,
  TIER_CAP,
  UPLIFTS,
  baselineTier,
  upliftedTier,
  dimensionEffort,
  derive,
}

if (require.main === module) {
  const usage =
    'Usage: node rigor.js <audienceCategory> <firedUpliftCount>\n' +
    '  audienceCategory: one of ' + Object.keys(AUDIENCE_BASELINE).join(' | ') + '\n' +
    '  firedUpliftCount: non-negative integer (0-5)'
  const [, , audienceCategory, firedUpliftsRaw] = process.argv
  if (audienceCategory === undefined || firedUpliftsRaw === undefined) {
    process.stderr.write(usage + '\n')
    process.exit(1)
  }
  try {
    const firedUplifts = Number(firedUpliftsRaw)
    const result = derive({ audienceCategory, firedUplifts })
    process.stdout.write(JSON.stringify(result) + '\n')
  } catch (err) {
    process.stderr.write(usage + '\n' + err.message + '\n')
    process.exit(1)
  }
}
