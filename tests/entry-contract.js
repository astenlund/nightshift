'use strict'

const PUBLIC_SKILLS = Object.freeze([
  'exploring',
  'handover',
  'init-backlog',
  'ready',
  'revise-code',
  'revise-docs',
  'revise-lore',
  'revise-plan',
  'revise-spec',
  'spec-agreement',
])

const PROCEDURE_REPLACEMENTS = Object.freeze({
  'revise-docs': Object.freeze([]),
  'revise-lore': Object.freeze([
    Object.freeze(['a sibling command made', 'a sibling skill made']),
    Object.freeze(['command checklist item', 'skill checklist item']),
    Object.freeze(['a command file', 'a skill file']),
    Object.freeze(['nightshift commands and skills', 'nightshift public and internal skills']),
    Object.freeze(['this command (`revise-lore`)', 'this skill (`revise-lore`)']),
    Object.freeze(['command sweep', 'skill sweep']),
    Object.freeze(['each command or skill', 'each public or internal skill']),
    Object.freeze(['behavior that the command', 'behavior that the skill']),
    Object.freeze(['command file vs revise SKILL.md', 'public skill file vs internal revise SKILL.md']),
    Object.freeze([
      'This is a single pass, not a dimension loop; its cost is one agent.\n',
      'This is a single pass, not a dimension loop; its cost is one agent per pass, and the handover-deferral flow below runs two.\n\n' +
        'Under a handover deferral (the unattended rule routes proposals to follow-up items instead of applying them), run this pass as the run\'s last unattended step, over the complete drafted proposal set, and fold its findings into the follow-up items so the morning report presents vetted proposals without making the user wait. After the morning-report triage applies the approved items, run one final fresh-eyes pass over the landed edits, even when triage changed nothing: it verifies clean landing against the live files and re-checks any proposal the user amended during triage. Drafting under the unattended rule still produces the concrete edit plus its motivating evidence; no deferred proposal remains unverified after landing.\n',
    ]),
  ]),
})

const REVISE_WRAPPERS = Object.freeze({
  'revise-code': Object.freeze({ artifactType: 'code', description: 'Use when a code change (diff, staged work, or named files) is ready for deep multi-agent review before it ships.' }),
  'revise-plan': Object.freeze({ artifactType: 'plan', description: 'Use when an implementation plan has been written and needs hardening before execution begins.' }),
  'revise-spec': Object.freeze({ artifactType: 'spec', description: 'Use when a design-shaped file (feature, pattern, or bug-investigation doc) has been written or substantially revised and needs hardening before planning.' }),
})

const REVISE_ENGINE_RESOURCES = Object.freeze({
  code: 'code.md',
  plan: 'plan.md',
  rigor: 'rigor.js',
  spec: 'spec.md',
  workflow: 'revise-round.workflow.js',
})

module.exports = { PROCEDURE_REPLACEMENTS, PUBLIC_SKILLS, REVISE_ENGINE_RESOURCES, REVISE_WRAPPERS }
