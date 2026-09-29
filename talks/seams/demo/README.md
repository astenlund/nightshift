# Overnight demo

An animated graph of one Nightshift night on a dummy project, as a companion to the [seams talk](../outline.md). It is not part of the slides. Actors (you, the lead agent, reviewers and a reviewer's peer, skeptics, the second-opinion advisor, a shift supervisor, the user proxy and Night Guard) and artifacts (files, docs and the run record) are nodes. Reads, writes and handoffs are edges. The workflow steps run along a rail above the graph, with a caption for each beat. The point to land is the talk's: trust lives in the seams, so the gates get the most visual weight.

Like the talk, this version presents every feature in [FEATURES.md](../../../.nightshift/FEATURES.md) as of 2026-09-29 as shipped, as an exercise. The run itself is scripted and labelled "Illustrative run": its times, revisions, token counts and findings are invented for the story, and nothing in it is recorded evidence.

## Files

- [overnight.html](overnight.html): the demo, 42 beats across 11 steps, with seven gate zooms and a closing card. It plays for about seven minutes at 1×. Use ← and → to step between beats, also while paused, space to pause and Home to start over; the speed button cycles 1×, 2× and 0.5×. It is made for a large screen: at phone width it has no sideways scroll, but the graph's text is too small to read.
- [preview.js](preview.js): renders frames of the page at chosen times into `.tmp/demo-frames`.

The page is an Artifact page body: it carries no `<!doctype>`, `<html>` or `<body>` tags because the Artifact publisher adds them. `preview.js` adds the same wrapper. It is also published as a private Artifact at https://claude.ai/artifact/QtNrtYHTrDUxsQFb3vZEcR.

## How it works

- **The story.** A small `tasks` command-line app gets recurring tasks. The steps are Pick work, Agree, Spec review, Handover, Implement, Code review, Validate findings, Repair and re-review, Docs, Retrospective and Morning report. The review raises F1 (a monthly repeat from 31 January skips February), F2 (completing a task twice spawns two copies) and F3 (no way to stop a series). F2 is refuted, F3 is deferred on the user proxy's advice, and fixing F1 causes F4 (March lands on the 28th), which a degraded re-review catches while no strong model is available. The documentation review raises D1, and a last strong review covers the whole change, docs included. The run completes at night after the retrospective, the report and triage evidence for the two open decisions. In the morning your reply records the report as delivered, and triage follows.
- **Who writes what.** Only the lead agent writes the run record and edits project files, as the runtime accepts writes only from the run's owner. Reviewers, skeptics, the supervisor and Night Guard read and report back.
- **Encoding.** Day, dusk, night and morning on the rail sky. Actors are circles: active glows, idle is plain, done is dashed with a check, unavailable has a red cross, a restarting session is dashed, and you are dim while asleep. Degraded reviewers and skeptics are drawn in amber. The ring around the lead agent shows how full its context is. Files are page shapes that join the graph when first touched: green outline and NEW badge for created, amber with a line count for edited, dashed for read only, and dashed amber with a PROPOSAL badge for a proposed instruction change. Review stamps on files show the review revision, turn red and "stale" when the file changes after review, and turn amber while only a degraded review covers them. Check pills show named checks such as month-end.
- **Gates.** Solid rail lines are gates the runtime enforces; the dashed one before Handover is your agreement. At a gate, the line drops from the rail into the graph, the graph zooms in and blurs while the line widens into a panel, and the checks appear one at a time. The first failure stops the walk, marks the rest "not reached" and shows the refusal in the talk's terminal style with the real error code. Then the panel folds back into the line and the graph returns. The agreement gate has a dashed panel. A check that rests on judgment or guidance rather than a runtime record has a dashed dot.
- **The review gate's checks** simplify `reviewGateFailure()` in [lifecycle.js](../../../internal/runtime/lifecycle.js), in its order. The staleness check compares per-file sha256, as `fresh()` in [evidence.js](../../../internal/runtime/evidence.js) does. The closing order follows the [runtime reference](../../../internal/runtime/REFERENCE.md) for a handed-over run: retrospective, report, triage, complete, with the undecided items recorded as deferred; your first reply is the delivery. The other gates list the checks the backlog's features add.
- **Engine.** Each beat's state is computed by applying beats 1 to n to an empty state, so any beat can be shown directly. Edges from earlier beats stay as faint history.

## Where each feature appears

Beat numbers match the counter under the controls. The 35 features with a moment in the night:

| Feature | Beats |
|---|---|
| Independent documentation review | 35, 36 |
| Verify faked boundaries live | 15 and its gate, 40 |
| Reproduce a bug with a failing check before repairing it | 24, 25, 29 |
| Project inboxes | 2, 37 |
| Degraded assessment mode | 26, 27, 28, 30 and its gate, 31 |
| Background review and assessment of selected work | 5, 6, agreement gate at 9 |
| Shared BACKLOG.md meta-index | 1 |
| Recover review report formatting without repeating the assessment | 27 |
| Carry settled decisions and experiment evidence into later reviews | 13, 26 |
| Complete the spec-review safeguard and authoring guidance | 6 |
| Preserve run preferences and enforce supported resource budgets | handover gate at 10, the run record's budget, 40 |
| Verify repair-commit and autosquash safety in ordinary delivery | 25, 29, 40 |
| Repairs start from current contents and respect helper ownership | 25 |
| Check currency and external dependencies | verification gate at 15 |
| Verify compatible agreement continuity across representation changes | 8, agreement gate at 9 |
| Relaunch unfinished work after host exit or restart | 34 |
| Ready offers to pick up an interrupted run | 1 |
| Size-aware Ready recommendations | 2 |
| Ground Ready recommendations in the project's direction | 1, 2 |
| Show review progress without being asked | 19, 30 |
| Retrospective routing by audience and instruction precedence | 37 |
| Review retrospective instruction proposals like any other change | 38, closing gate at 39 |
| Deliver each run on its own branch or worktree | 10, 40 |
| User proxy consultation and opt-in user profile | 22, dispose gate at 23, 41 |
| Explain for a capable user who may not know the codebase | 4 |
| Spawn a shift supervisor when admin work fills the controller's context | 14 |
| Night Guard | 10, 33 |
| Incremental revise finding delivery | 18 |
| Keep every affected surface when merging findings | 19 |
| Resumable reviewer and adversarial repair dialogue | 21 |
| Dispatch reviewer peers and return their evidence to the lead | 17 |
| Initial reviewer selection | 16 |
| Model choice per role: Opus 5.5 versus Fable | 14 |
| User-configurable model policy file | 16 |
| Structured model teams | handover gate at 10 |

The closing card lists the other 25, grouped: setup and backlog tooling (guidance discovery and routing, customized backlog repair, shared parsing, the fresh-scaffold tracking choice, ignore-shape election, mixed line-ending repair); Windows platform and runtime (filesystem metadata, recovery artifact ownership, launch identity, private request artifacts, bounded host transports, native event validation, review snapshot reuse); packaging and release (marketplace contents, release-gate diagnostics, run-time guidance separation); verification and measurement (verification infrastructure, defect detection measurement, orchestration efficiency, review-run command enforcement); and other ways to work (run-free revise, review mode, the whole-backlog coherence audit, interactive collaboration, the graphical run view).

## Next

- Rearrange the layout so active edges from the lead agent stop passing behind the backlog and docs columns.
- Make the rail gate flash more visibly before its line drops.
