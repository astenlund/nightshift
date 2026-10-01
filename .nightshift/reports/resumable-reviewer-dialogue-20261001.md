# Resumable reviewer and adversarial repair dialogue: acceptance

Acceptance evidence for the [governing spec](../specs/resumable-reviewer-dialogue.md) of [Resumable reviewer and adversarial repair dialogue](../features/resumable-reviewer-dialogue.md), delivered in run `edb0199e-f5f3-4fab-a55f-8fa909a08289` as the local 3.3.0 candidate on 2026-10-01. Nothing is published.

## What was delivered

- Resuming a reviewer: `review.resume` names a completed review or skeptic dispatch of the same task, and the runtime continues that native session (Claude Code `--resume`, Codex `thread/resume`) with its recorded host, model and effort in a new private copy, whose location the prompt names while marking earlier copies stale. A resume is refused for an unknown, foreign, incomplete, sessionless or superseded dispatch, while an active or unverified worker holds the session, for a requested kind or model that differs from the named dispatch, with candidates, and when a request supplies the runtime-only `continuation` or `continuationContext`. A resumed Codex thread is charged only its own turn, by difference from the thread's earlier total.
- Replacement: `review.replaces` dispatches a fresh reviewer given the replaced reviewer's record. It keeps the replaced reviewer's lineage, so it owns and closes the same findings.
- Failure classification: a resume that fails in its session, including an attempt timeout or an unusable report, fails with `resume-failed` and no fallback. Failures that do not concern the session keep their codes, among them input drift, the resource and operation-time refusals and independence refusals, and a failure to write the attempt's own artifact files keeps its operating-system error on both host runners. Unproven termination outranks both.
- Repair proposals: every confirmed skeptic verdict carries `repairProposal`, and `repair` refuses an implement disposition whose current verdict has none.
- Closure: a repair marks each repaired finding pending closure for the lineage that raised it. A continued lead's report returns one closure per such finding, and only a complete continued report ends a pending closure. The code, spec and docs gates, the closing record and `complete` (`closure-pending`) refuse while a finding they check is pending closure, and pending closures survive replacement of the closing record. Every closing finding not yet settled survives that replacement too, by re-recorded triage or by a reset, so completion still waits for its validation and disposition; before this release such a finding was dropped.
- Dialogue: `review.dialogue` on a resume or replacement asks a reviewer for a position on each named finding (maintain, revise or withdraw), imported with the new `dialogue` operation, or a skeptic for its verdicts again, imported with `validate`; the two never exchange messages directly.
- Receipt-backed continuation: a dispatch can be resumed, replaced or named as a resume target only when it produced a receipt, whose host, model, effort and session the continuation uses, whatever its worker record says. A failed final bookkeeping write therefore cannot strand a lineage's pending closures, and a worker reconciled as complete without a receipt never supersedes one; an active or unverified worker still holds its session.
- Artifact writes and skeptic assignments: runtime artifacts are written through a temporary file and a rename, so a failed write leaves no partial receipt, and a receipt that cannot be read counts as none. A skeptic is assigned each finding's claim, not the saved record with its validation snapshot of the project inventory.
- Fresh-only gates: a continued assessment, from a resumed or replacement reviewer, satisfies no gate, coverage, closing record or triage baseline.
- Acknowledgements: `review.acknowledgements` passes settled statements to a reviewer so they are not raised again.
- Status: each listed task and the closing record report `review: {next, resumeTargets, freshDue}`; `resumeTargets` names the reviewers owing closures and, after a task repair, the latest assessment of each other kind whose inputs the repair changed: one its gate accepts when that gate finds it stale, so backlog relief and covering assessments still count, and any other, such as a continued or incomplete one, once its reviewed inputs changed. The hook's lightweight brief marks the stale targets it does not evaluate.
- A host-runner defect found while testing the artifact failure path: a Windows-job host whose attempt failed before the job reported its start was never told to terminate, and the attempt waited indefinitely; the runner now requests termination whether or not the job has reported a process id.
- Guidance in the operating brief, the revise-code, revise-spec, revise-docs and handover skills and the runtime reference, and documentation in WORKFLOW.md, the v3 feature record and the README.

## Independent review

The spec took four whole-spec assessments on Codex `gpt-6-astra`, with four, three, one and no findings; the eight were confirmed by fresh skeptics and repaired, and the user accepted the spec on 2026-10-01.

The implementation took cumulative code dispatches until a clean fresh assessment of the final inputs; the first seventeen, of which the run imported sixteen, ran as follows.

- The first, on Astra, returned incomplete with four important findings and two probe requests. Fresh skeptics confirmed all four, and they were repaired: Codex usage capture on resume, the classification of resume failures by their origin, resume targets across tasks, and the CI test list.
- The second, on Astra, returned incomplete with a probe of continuation-obligation boundaries, which the controller ran in a private copy.
- The third, on Astra, returned incomplete with a probe request about session-callback failures and was not imported, so the run holds no result for that probe. The calibration of the next assessment records the two changes made before it: a repair records its revision on its task, and a resumed dispatch no longer passes the session-reporting callback, so its reserved session stays held.
- The fourth ran on `claude-fable-5-1` after the Astra attempt failed. It found seven minor findings, all confirmed and repaired. The repairs covered the post-repair resume set, the hook brief's marking of unevaluated stale targets, storage of carried closing findings' snapshots, the copy location in the resumed prompt, artifact write failures on both runners, the shared lineage and continuation records, and missing guard tests. The Windows-job termination defect above was found and repaired in the same batch.
- The fifth, on Astra, found one minor finding: a continued assessment of another kind was left out of the resume set. Because the spec's Done means lists the resume set, it was disposed as required and repaired.
- The sixth, on Astra, returned incomplete with a probe of resumed attempts cut short by the run deadline or the launcher's operation window. The probe showed them reported as `resume-failed` on both runners.
- The seventh, on Astra, raised that behavior as an important finding, and a fresh Fable skeptic refuted it. The spec names an attempt timeout a session failure, and the claimed consequence cannot occur, because a passed run deadline refuses every later operation and a dispatch is refused unless its full attempt fits the operation window. The controller verified those claims in the sources and recorded two follow-ups for triage: tests for resumed limit refusals, and naming the capping bound in a capped attempt's evidence. The code gate passed on this assessment.
- The documentation stage then changed descriptive documentation, which made that assessment stale. The eighth, on Astra, returned incomplete with a probe of an incomplete docs review after a code repair. The probe showed that such a review, though resumable, was left out of the resume set.
- The ninth, on Astra, raised that as an important finding, and a fresh Fable skeptic confirmed it. It was the third related finding in the resume-set selection, after the fourth and fifth assessments, and shared their cause: the selection considered only assessments a gate accepts and finds stale. The repair covers the whole class. A gate's judgment stands for an assessment it accepts, so backlog relief and covering assessments still count, and any other assessment is outdated once its reviewed inputs changed.
- The tenth, on Astra, returned incomplete with a probe of a transient failure while recording a completed worker. The probe showed a deadlock: the worker was left marked failed while its receipt stayed importable, and once its finding was repaired, neither a resume, a replacement nor worker reconciliation could close it, so the run could never complete.
- The eleventh ran on Fable after an Astra attempt ended as an output loop. It raised that deadlock as an important finding, together with two sibling paths found by reading: a resumed worker reconciled as complete without a receipt superseded the real dispatch, and a worker whose final write failed lacked the host and model a resume needs. A fresh Astra skeptic confirmed it. The repair keys continuation on the receipt instead of the worker's status.
- The twelfth, on Astra, returned incomplete with a probe of an interrupted receipt write. The probe showed that this repair had introduced a regression: a partial receipt made status, resume and replacement throw, stranding a pending closure again.
- The thirteenth ran on Fable after an Astra output loop. It raised that regression as an important finding, together with a second important one: a skeptic's dialogue turn was assigned the saved finding records, each carrying a validation snapshot of the whole project inventory, so the turn's prompt grew with the project. A fresh Astra skeptic confirmed both. Artifacts are now written through a temporary file and a rename, a receipt that cannot be read counts as none, and a skeptic is assigned each finding's claim instead of its record.
- The fourteenth, on Astra, returned incomplete with a probe of closing-record replacement. The probe showed an unvalidated important closing finding dropped by re-recorded triage, directly or after a reset, after which the run completed.
- The fifteenth, on Astra, raised that as an important finding, and a fresh Fable skeptic confirmed it with a narrower reach: the gate still fails closed while tracking edits remain, and dropping unsettled closing findings predates this release. The user chose on 2026-10-01 to fix it in this item. The repair carries every unsettled closing finding across both replacement paths, as pending closures already were.
- The sixteenth, on Astra, returned incomplete with a probe of re-importing a closing receipt after the record's replacement. The probe showed that this repair had introduced a regression: the new record held the carried finding without its review, so the import was not recognised as a duplicate, and a second copy under the same id blocked completion.
- The seventeenth, on Astra, raised that as an important finding, and a fresh Fable skeptic confirmed it. A review import is now refused with `duplicate-review` when its findings are already held, as one already recorded already was.

The eighth code review was required only because descriptive documentation changed: the installed 3.2.17 runtime that governs this run treats a code assessment as current after an edit only when backlog paths alone changed. Each later review followed either a code repair or the probe request of the review before it. The user noted on 2026-10-01 that documentation changes that do not affect the plugin's behavior should need only a docs review, and that is recorded as a follow-up.

The documentation took two docs reviews on Astra. The first found five minor findings. A fresh Fable skeptic confirmed them all; four were repaired in the acceptance report, the README status line, the v3 feature record and the review decision-context record. The fifth noted that the changed operating-instruction files need code assessment, and was skipped because the code gate already requires it. The second found only that routing note again, which was skipped likewise.

Every repair batch received relevant checks before the next fresh assessment. The run completes only under a clean current cumulative code assessment and a current docs review of the final inputs, and the run history records every receipt.

## Deterministic evidence

The recorded runtime check passed on the final code inputs: `node --test` over the 18 files `tests/runtime*.test.js`, `tests/release*.test.js` and `tests/package.test.js`, 433 tests with no failures. The new `tests/runtime-resume.test.js` (48 cases) runs in CI. The release manifest check and the release gate (3.2.17 to 3.3.0) passed.

Mutation probes removed or weakened each new guard and confirmed that a test fails:

- **Earlier batches:** 17 probes. Their raw outputs were not kept, but the controller's notes record that two survived at first and gained tests.
- **Fourth-assessment batch:** 22 probes, of which 16 failed tests on the first run. Of the six that survived, four gained tests that now fail. The other two were resolved by removing code: an import-time guard that the transition already enforces with the same code, and an artifact-failure branch that no deterministic test could reach.
- **Fifth-assessment batch:** two probes, of which one survived at first and gained a test.
- **Ninth-assessment batch:** three probes, all of which failed tests on the first run. They revert the selection to continued assessments only, judge accepted assessments by plain freshness, and list unaccepted assessments whatever their freshness.
- **Eleventh-assessment batch:** five probes, all of which failed tests on the first run. They key continuation, supersession or the status resume target on the worker's status, or take the resumed host, model or session from the worker record instead of the receipt.
- **Thirteenth-assessment batch:** four probes, all of which failed tests on the first run. They parse an unreadable receipt unguarded, write an artifact in place, leave the temporary file behind on failure, and assign a skeptic the saved record.
- **Fifteenth-assessment batch:** two probes, both of which failed tests on the first run. They carry only pending closures across a closing-record replacement, or carry settled findings too.
- **Seventeenth-assessment batch:** one probe, which failed tests on the first run. It recognises a prior import only from recorded reviews.

## Live campaign

The campaign ran on Windows with Node 22.23.2, under the user's own Claude Code 2.1.286 (`claude-fable-5-1`) and Codex CLI 0.158.0 (`gpt-6-astra`) profiles.

- **Driver:** a script, not a model. It staged the working tree's payload and release manifest, verified them as a retained bundle would be (identity `3.3.0-650d0fb0ca1d55d2320333264d9f58e133f746f8d59b548b0454564a8f7a6ece`), and drove that candidate's runtime in development mode.
- **Fixture:** a small project with two seeded defects in `average`: an off-by-one loop and a missing zero result for input without numbers.
- **Placement:** reviewers ran on the host under test and skeptics on the other host.
- **Forced resume failures:** a 5,000 ms attempt bound.
- **Raw evidence:** kept in the ignored `.tmp/resume-live-edb0199e`, with fixtures `claude-92eeab6f` and `codex-36d7245c`.

| Branch | Claude Code (Fable reviewers) | Codex (Astra reviewers) |
| --- | --- | --- |
| Confirmed skeptic verdicts carry a repair proposal | Observed | Observed |
| Resumed reviewer answers a dialogue turn with a maintain position | Observed: maintain, maintain | Observed: maintain, maintain |
| Resumed reviewer answers a dialogue turn with a revise or a withdraw position | Unverified: both findings held, so neither reply was given | Unverified: both findings held, so neither reply was given |
| Resumed skeptic answers a dialogue turn in its own session | Observed | Observed |
| Forced skeptic resume failure, then a replacement skeptic | Observed: `resume-failed`, replacement in a new session | Observed: `resume-failed`, replacement in a new session |
| Resumed lead reads the new copy and not the earlier one | Observed: events reference only the new copy | Observed: events reference only the new copy |
| Resumed lead closes the fully repaired finding | Observed | Observed |
| Resumed lead keeps the partly repaired finding open and reports it again under its local id | Observed | Observed |
| Forced lead resume failure, then a replacement closes the pending findings | Observed | Observed on retry: the first replacement attempt ended as an Astra output loop; a retry on the same fixture ran in a new session, kept the lineage and closed both pending findings |
| Fresh lead given an acknowledgement does not raise the settled point | Observed | Observed |
| Gate refuses a continued assessment | Observed: `review-required` | Observed: `review-required` |
| Gate passes a fresh assessment | Not exercised: the fresh lead found a real fixture defect, NaN counted as a number, so the gate correctly withheld the pass | Not exercised: the campaign's fresh lead reported nothing, but the failed replacement had left two findings pending closure, so the gate refused; after the retry closed them, a second fresh lead found a real fixture defect, overflow to Infinity, and the gate correctly withheld the pass |
| The controller's own use of the new status, choosing to resume, replace, relay a dialogue or follow with a fresh lead | Unverified | Unverified |

A gate passing on a fresh assessment rests on the deterministic suite. The controller's own model-owned use of the new guidance and status was not exercised live. This run's controller operated under the installed 3.2.17 runtime, which predates the feature, and the campaign's controller was a script.

## Limits and incidents

- The resume feasibility probe before implementation, capped at 50,000 tokens, used 77,403, because its guard checked the remaining budget instead of the next step's cost. This was reported at the time. The campaign driver checks each step's expected cost before spending.
- The fixture's repaired version kept two defects that fresh leads found. Fable's fresh lead found NaN. Astra's first fresh lead reported neither, and its second found overflow.
- One Astra attempt failed during code review, and the fourth assessment fell back to Fable. One campaign attempt ended as an Astra output loop. The runtime handled both as designed.
- Only Windows with native Claude Code and Codex executables is verified.

## Documentation sweep

The spec's claim sweep covered the shipped skills, `internal`, WORKFLOW.md, VISION.md, README.md and `.nightshift/features`, on the terms final verifier, holistic reviewer, LGTM, final integrated assessment, cumulative strong broad assessment, fresh lead and resume. Because a keyword search shows only that words are absent, the review passages of WORKFLOW.md, VISION.md and the v3 feature record were also read topic by topic.

- **Amended:**
  - the operating brief, the revise-code, revise-spec, revise-docs and handover skills, and the runtime reference, in the implementation;
  - WORKFLOW.md's dialogue, repair and gate paragraphs, the v3 feature record's finding, repair and gate lines, and README step 4;
  - degraded-assessment-mode.md's quotations of reworded statements;
  - the lore-proposal-review-gate and reviewer-peer-dispatch records, the peer-dispatch index entry and its `Requires` line;
  - the two MIGRATION_STATUS rows that tracked this entry.
- **Consistent and unchanged:**
  - VISION.md, whose "the same qualified independent reviewer can retain useful context" describes resuming and which nowhere makes a final reviewer optional;
  - initial-reviewer-selection.md, whose "Subsequent passes can resume that reviewer" is now accurate.
- **Out of scope:**
  - historical v2 records that preserve their reasoning (review-orchestration-tests, wave-lifecycle, revise-lifecycle-rounds and adversarial-repair-dialogue);
  - uses of "resume" that mean resuming a run or a setup, not a reviewer (durable-run-identity-concurrency, contract-calibrated-revise-admission, revise-progress-visible-by-default, manual-review-dedup-parity, present-spec-for-agreement, immediate-skeptic-dispatch, and the init-backlog and handover skills' run-resumption lines).

## Usage

- **Campaign:** the agreed aggregate ceiling was 32,000,000 tokens. The ledger records 1,352,189 measured tokens across 24 dispatches, 671,185 in the Claude campaign and 681,004 in the Codex campaign including its retry. It also charges 500,000 for five attempts that reported no usage: four forced resume failures and one output loop. That makes 1,852,189 in total.
- **This run's own review:** not part of that ceiling. Through the seventeenth code assessment and the second docs review, its 38 review dispatches (spec, code, docs and skeptic) measured 64,641,738 tokens, with three attempts, one failed and two ended as output loops, that reported no usage. The final fresh assessments are recorded in the run history.
