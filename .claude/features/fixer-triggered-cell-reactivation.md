# Fixer-triggered cell reactivation

Lets a fixer wake a specific inactive cell as soon as its edit touches an area that cell has opinions about, instead of waiting for the all-inactive reactivation wave. The mechanism is a bounded, fixer-declared hint the controller may act on; the sweep still owns everything the hint does not name.

## Motivation

Across the 2026-09-03 batch the findings rotated predictably after each fix wave: the cell that produced the next finding was almost never the cell that triggered the fix. The risk dimension re-found the next branch of any recovery machinery a fix touched; requirements clarity and scope re-found stale cross-references and count sentences that a fix's own prose introduced. In every one of those cases the information needed to wake the right cell existed at the moment the fix was applied, and the run waited a full wave to use it.

A fix to the unwind paragraph could wake risk at once; a fix that renumbers steps could wake requirements clarity at once. The user's correction sharpens the payoff: the saving is not one round per hint. The round that a hint-woken cell runs in does not necessarily converge either, so waking early can save several rounds of the sequence in which each wave surfaces one more defect in the area the previous fix touched.

## Design tension

`internal/revise/SKILL.md` deliberately batches reactivation into the all-inactive sweep, and states that no artifact edit or finding disposition reactivates a cell directly. That rule exists so a settled cell is not re-run per small delta, and the eager-staleness incident in the inbox is the concrete record of what happens when a controller ignores it. This feature must not weaken that rule; it must carve a narrow, declared exception on top of it.

The shape that respects both: the fixer names the cells its edit is likely to concern, the controller reactivates only those, at most a bounded number per boundary, and the all-inactive sweep still owns every cell the hint did not name. The hint is recorded in the applied-change ledger so a wrong hint is visible after the fact rather than being an invisible scheduling decision.

## A speed-versus-spend setting, not a rigor matter

The user's correction settles where this belongs: quality is the same either way, because every cell still certifies the final fingerprint before the verifier launches. Waiting for the sweep means a settled cell re-runs once per wave over the accumulated delta, which is the cheaper option in tokens. Waking early means the next defect in the touched area surfaces sooner in wall-clock time, at the cost of an extra cell run.

That is a preference, so the setting sits beside the other run-shaping preferences (host, model pins, round cap) described in [Run-shaping settings: round cap and review lanes](run-shaping-settings.md) rather than in the rigor profile. The default is plain and conservative, probably wait, and the user flips it per run.

## Observability

The convergence log described in [Revise progress visible by default](revise-progress-visible-by-default.md) marks hint-driven reactivations distinctly from sweep-driven ones, so a reader can see which choice each reactivation came from and judge whether the hints were worth their extra runs.

## Files this touches

- `internal/revise/SKILL.md`: the round boundary, the applied-change shape, and the narrow exception to the no-direct-reactivation rule.
- `internal/revise/revise-round.workflow.js`: cell activation.
- The convergence log's reactivation marking.

## Verification

Fixtures cover a fix with no hint (sweep behavior unchanged), a hint naming one cell (that cell alone wakes, the rest wait for the sweep), a hint naming more cells than the per-boundary bound allows, a hint naming a cell that is already active, a wrong hint (recorded in the ledger and visible), and the setting in its wait position (no hint is acted on at all). A live claim over a real run compares rounds to convergence with the setting in each position, since the entire justification is a wall-clock-versus-spend trade.

## Non-goals

- Reactivating a cell on any signal other than an explicit fixer hint; staleness alone still waits for the sweep.
- Letting a hint substitute for the final certification every applicable cell owes the verifier's fingerprint.
