---
name: revise-code
description: "Use when a code change (diff, staged work, or named files) is ready for deep multi-agent review before it ships."
---

# revise-code

Resolve `../../internal/revise/SKILL.md` relative to this skill and follow it as the shared review procedure with fixed artifact type `code`.

If the engine is missing or unreadable, report `REVISE_ENGINE_UNAVAILABLE` and `../../internal/revise/SKILL.md`, then stop before starting review work.

When the host supplies usable scope text, pass it to the engine without intentional normalization. When scope is missing, empty, or whitespace-only, omit it so the engine performs its existing inference and clarification behavior.
