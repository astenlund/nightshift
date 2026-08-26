'use strict'

const SOURCE_COMMIT = '2f3f8187b4b6f5c3bb9da72284e277018f726643'
const SOURCE_PATHS = Object.freeze([
  '.claude-plugin/marketplace.json',
  '.claude-plugin/plugin.json',
  'internal/revise/SKILL.md',
  'internal/revise/code.md',
  'internal/revise/orchestration.js',
  'internal/revise/orchestration.test.js',
  'internal/revise/plan.md',
  'internal/revise/revise-round.test.js',
  'internal/revise/revise-round.workflow.js',
  'internal/revise/rigor.js',
  'internal/revise/rigor.test.js',
  'internal/revise/spec.md',
  'skills/exploring/SKILL.md',
  'skills/handover/SKILL.md',
  'skills/init-backlog/SKILL.md',
  'skills/init-backlog/unwrap.js',
  'skills/init-backlog/unwrap.test.js',
  'skills/ready/SKILL.md',
  'skills/ready/ready.js',
  'skills/ready/ready.test.js',
  'skills/revise-code/SKILL.md',
  'skills/revise-docs/SKILL.md',
  'skills/revise-lore/SKILL.md',
  'skills/revise-plan/SKILL.md',
  'skills/revise-spec/SKILL.md',
  'skills/spec-agreement/SKILL.md',
  'skills/spec-agreement/fixtures/fingerprint-v1.json',
  'skills/spec-agreement/spec-agreement.js',
  'skills/spec-agreement/spec-agreement.test.js',
])

module.exports = { SOURCE_COMMIT, SOURCE_PATHS }
