# Overnight demo: work in progress

An animated graph of one Nightshift run on a dummy project, for the [seams talk](../outline.md). Actors (you, the lead agent, reviewer, skeptic) and artifacts (files, docs, the run record) are nodes; reads, writes and handoffs are edges; the workflow steps run along a rail above the graph, with a caption per beat. The point to land is the talk's: trust lives in the seams, so the gates get the most visual weight.

Status: a prototype of one stretch of the run, parked for visual tweaks. It has not been through the Nightshift review, documentation or retrospective workflows.

## Files

- [overnight.html](overnight.html): the playable prototype. It covers step 7 only: the review gate refuses a stale review, a fresh reviewer checks the whole change, then the gate opens and the rail moves on to Docs. About 40 seconds, with restart, pause and speed controls.
- [still-step6.html](still-step6.html): a static frame from step 6, where the skeptic checks the reviewer's three findings.
- [preview.js](preview.js): renders frames of either page at chosen times, into `.tmp/demo-frames`.

Both pages are Artifact page bodies: they carry no `<!doctype>`, `<html>` or `<body>` tags because the Artifact publisher adds them. `preview.js` adds the same wrapper. The prototype is also published as a private Artifact at https://claude.ai/artifact/QtNrtYHTrDUxsQFb3vZEcR.

## Agreed so far

- **Scripted, not a real run.** The story is a scripted sequence that follows [WORKFLOW.md](../../../WORKFLOW.md), labelled "Illustrative run". Its data format could later take a captured real run.
- **The story.** A small `tasks` command-line app gets recurring tasks, a feature big enough for a spec. Ten steps: Agree, Spec and review, Handover, Implement, Code review, Validate findings, Repair and re-review, Docs, Retrospective, Morning report. The reviewer raises three findings: F1 (a monthly repeat from 31 January skips February) is confirmed and fixed, F2 (completing a task twice spawns two copies) is refuted, and F3 (no way to stop a series) is deferred to `QUICK_WINS.md`.
- **Who talks to whom.** The lead agent makes every handoff and is the only writer of the run record. The reviewer returns its report to the lead agent; the lead agent gives the findings to the skeptic; the skeptic returns all verdicts in one report, which the lead agent records before deciding anything. Reviewers and skeptics only read.
- **Encoding.** Day, dusk, night and morning on the rail sky. Actors are circles (active glows, idle is plain, done is dashed with a check, you are dim while asleep). Files are page shapes that join the graph when first touched: green outline and NEW badge for created, amber with a line count for edited, dashed for read only. Dotted edges are reads; solid edges are writes and handoffs; particles flow along active edges; earlier edges stay faint. Review stamps on files show the review revision and turn to "stale" when the file changes after review.
- **Gates.** Solid rail lines are gates the runtime enforces; the dashed one after Spec and review is your agreement. At a gate, the line drops from the rail into the graph, the graph zooms in and blurs while the line widens into a panel, and the checks appear one at a time. The first failure stops the walk, marks the rest "not reached" and shows the refusal in the talk's terminal style with the real error code. Then the panel folds back into the line and the graph returns.
- **The review gate's checks** simplify `reviewGateFailure()` in [lifecycle.js](../../../internal/runtime/lifecycle.js) in its order: the review covers the agreed commitments; a complete review by a strong, independent reviewer (dimension coverage folded in); nothing it reviewed has changed since (per-file sha256, as `fresh()` in [evidence.js](../../../internal/runtime/evidence.js) compares); every check passes on the current files; every finding checked by a skeptic and decided; accepted fixes were made before this review.

## Next

- Visual tweaks to the prototype, which the user will direct.
- Rearrange the layout so active edges from the lead agent stop passing behind the docs column.
- Make the rail gate flash more visibly before its line drops.
- Build the full storyboard across all ten steps, with a gate beat at each seam. Planned beats: `unverified-continuation` at handover until the Stop hook is observed; the re-review that catches a regression in the F1 fix after green tests (the fix moves 31 January to 28 February, and March then lands on the 28th too), mirroring the talk's `[10]` became `[15]` story; the closing gates `closing-required` and `report-required`. Error codes come from [captured-output.md](../captured-output.md).
- Consider marking the talk's three gate kinds (authority, evidence, continuity), an optional compaction beat around 01:30 where the run record hands the lead agent its brief, and an ending that fades the steps and lights every seam crossed, as on slide 32.
