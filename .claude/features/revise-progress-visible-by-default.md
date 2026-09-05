# Revise progress visible by default

Makes revise-run progress visible as standard behavior rather than on request: after every evaluated round the engine prints the cumulative per-round convergence log, persists it in the checkpoint so a resumed session can print it, and the morning report reviews the series.

## Motivation

The per-round convergence log was a user request during the 2026-09-02 run, refined three times before it settled. It is what surfaced the eager-staleness incident now sitting in the inbox as `revise-eager-staleness-interpretation.md`: the log made it obvious that rounds kept expanding back to seven active cells after each fix, which is the wrong lifecycle. Without asking to see convergence details, the defect would have run the whole night unnoticed.

`internal/revise/SKILL.md` already requires a report after every evaluated round, but the report's form is not pinned, so what a run shows depends on the controller's judgment that round. A defect that is only visible in the shape of the series is invisible unless the series is printed the same way every time.

This entry generalizes the earlier per-round convergence-report request from a user ask into the engine's default, and holds that request rather than tracking it separately.

## What is printed

The log is cumulative: one line per round, all rounds so far, reprinted after each evaluated round so the series is readable without scrolling back. A verifier round is its own line.

The column list settled during the run, and it is an input to this design rather than the final answer:

- round
- fingerprint
- active cells before and after
- findings, with the verdict split
- fixes
- wave boundary

No verifier column and no assessment column; a verifier round appears as its own line instead. Per-cell durations from [Dimension duration tracking and split suggestions](dimension-duration-tracking.md) would join the same line.

## The format is not locked

Two formats were exercised and both are carried here as inputs; the design is open and the choice belongs to whoever picks this up.

- The compact one-line-per-round form used in this run, with the columns above. The user chose it for scan speed across many rounds, which is the property that matters when a run reaches dozens of rounds.
- The wider table Codex rendered for its own run, with columns Round, Active cells launched, Findings, Cell outcomes as prose (for example "Requirements clarity remains active; finding confirmed and fixed"), and Next transition as prose (for example "Agreement fit check, then clarity alone reviews the new fingerprint"). It reads better per round but wraps and grows tall.

A hybrid is worth weighing: the compact line as the default, with the prose columns expanded on request. Nothing here is settled, and the pick-up should treat the two samples as evidence about what each form is good for rather than as competing proposals to choose between blind.

## Persistence and review

The log lives in the checkpoint so a resumed session prints the full series rather than starting the log over at the resume point; a series with a hole in it is exactly the artifact that hides a lifecycle defect. During the run that produced this entry the log was kept in a controller-owned scratch file, which does not survive a resume.

The morning report reviews the series rather than the final state alone, since the defects this log catches are shapes over rounds, not facts about the last round.

## Files this touches

- `internal/revise/SKILL.md`: the after-every-round report requirement gains the pinned log form and the persistence rule.
- `skills/handover/SKILL.md`: the morning report's review of the series.
- The checkpoint shape, which gains the log.

## Verification

Fixtures cover a run of several rounds (the log is cumulative and reprinted each round), a verifier round (its own line), a wave boundary (marked), a resumed run (the full series prints, including rounds from before the resume), and a run with no findings in a round. A live claim records the log over a real multi-wave run, since the log's value is a property of long series rather than of any single line.
