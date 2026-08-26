---
name: revise-plan
description: "Use when an implementation plan has been written and needs hardening before execution begins."
---

# revise-plan

Resolve `../spec-agreement/SKILL.md` relative to this skill and execute it first in `lifecycle-entry` phase with caller mode `revise-plan` and fixed artifact type `plan`.

If the agreement skill is missing or unreadable, report exactly this single line, then stop before starting review work.
SPEC_AGREEMENT_UNAVAILABLE ../spec-agreement/SKILL.md

When the host supplies usable scope text, pass the same text unchanged to the agreement skill and, after authority is present, to the engine. When scope is missing, empty, or whitespace-only, omit it from the agreement request.

Continue to the engine only when `callerResult.agreement` is a complete agreement record or the literal `not-applicable`; stop without dispatch on every other outcome.

Resolve `../../internal/revise/SKILL.md` relative to this skill and follow it as the shared review procedure with the same artifact type.

If the engine is missing or unreadable, report exactly this single line, then stop before starting review work.
REVISE_ENGINE_UNAVAILABLE ../../internal/revise/SKILL.md

When the host supplies usable scope text, pass it to the engine without intentional normalization. When scope is missing, empty, or whitespace-only, omit it so the engine performs its existing inference and clarification behavior.
