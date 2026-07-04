---
description: "Use at the end of a session whose implementation work is complete and ready to ship, whether the front-end was driven manually or by /flightdeck:takeoff."
---

# land

## Scope

Triggered by `/flightdeck:land`, "land the plane", "land", or close conversational variants. Used at the end of a session whose front-end (brainstorm, spec, plan, implementation) was driven directly, and invoked by `/flightdeck:takeoff` as its late-stage tail. If the late-stage workflow already ran in this session, `/flightdeck:land` is a no-op.

Build a single flat TaskCreate queue containing the 8 steps below before starting; mark each step completed as its sub-skill graduates and pull through to completion. Accumulate user-decision-required items from `/flightdeck:revise-code` and any deferrals carried over from the front-end (whether driven manually or by `/flightdeck:takeoff`) into a single "follow-up items" list maintained in conversation memory; step 8 presents this list for triage. Per-step user gates inside sub-skills still apply: an auto-accept or autonomous mode that suppresses routine tool-permission prompts does not bypass workflow-level confirmation steps embedded in a skill or command.

## Procedure

1. `/flightdeck:revise-code` - run to graduation per the skill's own criteria. Valid-but-deferred findings flow into the follow-up items list across all iterations; do not prompt on them at end-of-loop.
2. **Verify end-to-end.** Drive the affected flow in the running app or tool and observe the behavior (the `verify` skill's discipline, if that skill is available: exercise the change, don't just trust tests or typecheck). Skip with a one-line note when the session's diff has no runtime surface to drive (docs-only or test-only changes).
3. `/flightdeck:revise-docs` - update project docs to reflect what shipped.
4. **Backlog bookkeeping check.** In projects with the four-index `.claude/` layout, confirm the shipping protocol ran for everything that landed this session: history-archive entries appended (`FEATURES_HISTORY.md` / `BUGS_HISTORY.md` / `QUICK_WINS_HISTORY.md`), slice bullets struck through and the parent's top-level `**Requires:**` line advanced where a slice shipped, and the walk-and-remove sweep applied to every other `**Requires:**` line in `FEATURES.md` / `BUGS.md`. `/flightdeck:revise-docs`' Completed-features guideline owns the protocol; this step exists as an explicit checkpoint because `/flightdeck:ready`'s correctness depends on the sweep having run. Skip with a one-line note in projects without the layout.
5. `/flightdeck:revise-lore` - review the session for CLAUDE.md / plugin updates worth persisting.
6. **Persist workflow edits.** If step 5 changed flightdeck plugin files (commands, skills), apply the edits in the plugin repo clone (not the installed cache) and commit them there; leave pushing to the user unless directed. If changes touched files outside the plugin (e.g. a global CLAUDE.md), persist them via whatever mechanism backs those files locally.
7. Run the project's full test suite as defined in the project's CLAUDE.md. This phrase is the explicit ask that overrides any per-project "never run the full suite without filter" rule. If the suite is not green, halt and surface failures before triage; test failures are not follow-up items.
8. **Follow-up triage.** Surface the accumulated follow-up items (from step 1, plus any items deferred during the front-end) with a default route proposed for each: (a) fix now (small, scout-rule, low-risk), (b) track as `QUICK_WINS.md` entry, (c) skip. The user picks one top-level action:
    - **apply as presented**: execute the proposed routes verbatim.
    - **apply with edits**: wait for the user to name which items deviate and the replacement route, then execute the stated deviations plus the proposed defaults for everything else in one pass.
    - **defer all to a single QW**: log every item as one `QUICK_WINS.md` entry under a descriptive section header (typically the feature/area touched). Useful when the user wants to ship promptly and triage later.
