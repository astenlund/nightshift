---
name: revise-plan
description: "Use when an implementation plan has been written and needs hardening before execution begins."
---

# revise-plan

Resolve `../../internal/revise/SKILL.md` relative to this skill and follow it as the shared review procedure with fixed artifact type `plan`.

If the engine is missing or unreadable, report exactly this single line, then stop before starting review work.
REVISE_ENGINE_UNAVAILABLE ../../internal/revise/SKILL.md

When the host supplies usable scope text, pass it to the engine without intentional normalization. When scope is missing, empty, or whitespace-only, omit it so the engine performs its existing inference and clarification behavior.
