---
name: revise-spec
description: "Use when a design-shaped file (feature, pattern, or bug-investigation doc) has been written or substantially revised and needs hardening before planning."
---

# revise-spec

Resolve `../spec-agreement/SKILL.md` relative to this skill and execute it first in `lifecycle-entry` phase with caller mode `revise-spec` and fixed artifact type `spec`.

If the agreement skill is missing or unreadable, report exactly this single line, then stop before starting review work.
SPEC_AGREEMENT_UNAVAILABLE ../spec-agreement/SKILL.md

When the host supplies usable scope text, pass the same text unchanged to the agreement skill and, after authority is present, to the engine. When scope is missing, empty, or whitespace-only, omit it from the agreement request.

Continue to the engine only when `callerResult.agreement` is a complete agreement record; stop without dispatch on `not-applicable` and every other outcome.

Resolve `../../internal/revise/SKILL.md` relative to this skill and follow it as the shared review procedure with the same artifact type.

If the engine is missing or unreadable, report exactly this single line, then stop before starting review work.
REVISE_ENGINE_UNAVAILABLE ../../internal/revise/SKILL.md

When the host supplies usable scope text, pass it to the engine without intentional normalization. When scope is missing, empty, or whitespace-only, omit it so the engine performs its existing inference and clarification behavior.
