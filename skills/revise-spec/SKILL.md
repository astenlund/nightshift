---
name: revise-spec
description: "Use when a design-shaped file (feature, pattern, or bug-investigation doc) has been written or substantially revised and needs hardening before planning."
---

# revise-spec

Resolve `../../internal/revise/SKILL.md` relative to this skill and follow it as the shared review procedure with fixed artifact type `spec`.

If the engine is missing or unreadable, report exactly this single line, then stop before starting review work.
REVISE_ENGINE_UNAVAILABLE ../../internal/revise/SKILL.md

When the host supplies usable scope text, pass it to the engine without intentional normalization. When scope is missing, empty, or whitespace-only, omit it so the engine performs its existing inference and clarification behavior.
