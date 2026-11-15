# Origin of the bugs and quick wins added in two fortnights

Nov 15, 2026

The by-hand classification behind number 8 of the fortnightly check in [the assessment worklist](assessment-worklist-20261018.md), for the checks of 2026-11-01 and 2026-11-15: every entry added to [BUGS.md](../BUGS.md) or [QUICK_WINS.md](../QUICK_WINS.md) from 2026-10-19 to 2026-11-01 and from 2026-11-02 to 2026-11-15, classified by where it came from. It continues [the origin classification of 2026-10-20](origin-classification-20261020.md) and applies that report's rules: the bugs table counts a review fix only where a repair answering a review finding introduced the defect, and an instruction change only where a later edit of instruction prose did, so a defect in prose as first written is original implementation there; the quick-win table counts a review fix wherever a review raised the entry and deferred it, or it arose from a repair made in response to a review finding, taking precedence over the other classes, and an instruction change wherever the gap lies in prose agents follow (the operating brief, a SKILL.md, AGENTS.md, a runtime or releases reference, init-backlog templates, reviewer prompt text) with the remedy there. Unclear covers an entry whose provenance does not place it, a host verification, a naming preference, or a feature request whose remedy is split between code and instructions, and here also run bookkeeping, which this report reads as provenance that places an entry in neither code nor prose. As before, the two tables' counts are not combinable. The maintainer accepted the classification as drafted on 2026-11-15.

## Method

The entries come from Git history, not from the indexes as they stand: for each window, every commit whose author date falls in it and that touches either index, taking each `### ` heading the commit adds that was not a heading in BUGS.md, QUICK_WINS.md, BUGS_HISTORY.md, QUICK_WINS_HISTORY.md, FEATURES.md or FEATURES_HISTORY.md at the parent of the window's first such commit, with a linked heading `### [Title](record)` compared by its title. A heading that a later commit in the window renamed is counted once, under its current name; two renames were found, of "Repair the deferred Vibe reviewer host documentation minors" in `f67f0e08`, in the first window, and of "Tell reviewers that probe copies hold no installed dependencies" in `50eb2820`, in the second. A heading that renames an entry existing before the window is not a new entry and is left out: listing every commit in the two windows that both removes and adds a heading in those six files found one among the bugs and quick wins, `a7551d16` on 2026-11-12 renaming "Spec reviewers are not told the code is context", added on 2026-10-12 and classified in the report of 2026-10-20, to "Reviewers are not told what other stages cover". Unlike the baseline of 2026-10-18, entries archived or moved since they were added are included, and their current location is given; left out, the first window would read 5 quick wins rather than 6, without "Give the evaluated Vibe skeptic the launcher's guidance", and the second 10 rather than 11, without "Settle the deferred minor findings of the documentation paths and closing condition spec". Each entry was classified from its text where it now lives, or from the commit that added it when it is no longer an index heading, reading the whole entry where the opening sentence did not settle it.

## Results

| Window | Entries | Bugs: original, review fix, instruction change, unclear | Quick wins: original, review fix, instruction change, unclear | Number 8 |
| --- | --- | --- | --- | --- |
| 2026-10-19 to 2026-11-01 | 15 | 5, 0, 0, 0 | 2, 6, 0, 2 | 0 bugs and 6 quick wins |
| 2026-11-02 to 2026-11-15 | 43 | 9, 0, 0, 0 | 12, 11, 8, 3 | 0 bugs and 11 quick wins |

Instruction-change quick wins appear only in the second window, all eight from the user's inbox triage, a retrospective and the applicability evaluation; under the narrow rule none states that a later edit of instruction text introduced its gap.

## 2026-10-19 to 2026-11-01

| Entry | Added | Index | Now in | Origin | Deciding text |
| --- | --- | --- | --- | --- | --- |
| Recorded checks pass the bound runtime's resource context to the commands they run | 2026-10-19 | BUGS.md | BUGS.md | original implementation | a recorded check's process inherited the bound runtime's environment |
| Seeded-defect harness cannot resume past a null token reading | 2026-10-23 | BUGS.md | BUGS.md | original implementation | found during the first baseline in `dispatchStage` |
| Seeded-defect grader gives a planted defect to a nearer unrelated finding | 2026-10-24 | BUGS.md | BUGS.md | original implementation | `assign` pairs findings by line distance alone |
| Runtime preparation pins a fresh session to a completed run's release | 2026-10-25 | BUGS.md | BUGS_HISTORY.md | original implementation | preparation selected releases from completed records |
| Creation refuses every delivery once artifact bodies pass 64 MiB | 2026-10-31 | BUGS.md | BUGS_HISTORY.md | original implementation | the creation scan read every artifact body |
| Present every part of setup's template report | 2026-10-19 | QUICK_WINS.md | QUICK_WINS.md | review fix | "Three minor findings from the code review of the 3.3.13 batch" |
| Correct two stale clauses from the 3.3.13 batch | 2026-10-19 | QUICK_WINS.md | QUICK_WINS.md | review fix | "Two minor findings from the same review" |
| Resolve the seeded-defect suite's deferred review findings | 2026-10-25 | QUICK_WINS.md | QUICK_WINS.md | review fix | "Deferred as minor ... at the close of the pre-push review loop" |
| Repair the remaining deferred Vibe reviewer host documentation minors | 2026-10-27 | QUICK_WINS.md | QUICK_WINS.md | review fix | "Seven minor documentation findings ... were deferred" |
| Give the evaluated Vibe skeptic the launcher's guidance | 2026-10-27 | QUICK_WINS.md | QUICK_WINS_HISTORY.md | review fix | "One minor finding from the code review of the Vibe reviewer host delivery" |
| Reject a Vibe version mismatch before launch | 2026-10-27 | QUICK_WINS.md | QUICK_WINS.md | review fix | "One minor finding from the same review" |
| Check the Vibe image-fallback route's reachability | 2026-10-27 | QUICK_WINS.md | QUICK_WINS.md | unclear | a delivery follow-up asking for a host check |
| Complete the closing obligations of the Vibe reviewer host delivery | 2026-10-27 | QUICK_WINS.md | QUICK_WINS.md | unclear | run bookkeeping for a run closed as unfinished |
| Run requested probes in the seeded-defect suite | 2026-10-31 | QUICK_WINS.md | QUICK_WINS_HISTORY.md | original implementation | raised from a model evaluation; the suite does not execute probes |
| Evaluate candidate skeptics apart from their leads | 2026-10-31 | QUICK_WINS.md | QUICK_WINS.md | original implementation | raised by the user; `gradeFixtureRun` cannot answer the question |

## 2026-11-02 to 2026-11-15

| Entry | Added | Index | Now in | Origin | Deciding text |
| --- | --- | --- | --- | --- | --- |
| CI omits several deterministic suites | 2026-11-02 | BUGS.md | BUGS_HISTORY.md | original implementation | `ci.yml` listed test files by name |
| Codex keeps asking to trust Nightshift's hooks again | 2026-11-03 | BUGS.md | BUGS.md | original implementation | hook commands name a launcher path hashed from its bytes |
| A completed run with a current accounting marker blocks every handover | 2026-11-03 | BUGS.md | BUGS_HISTORY.md | original implementation | the creation gate charged every completed record's hydrated evidence |
| Creation hydrates every completion snapshot to judge a completed run's discharge | 2026-11-03 | BUGS.md | a bug record carried by the store cut | original implementation | split from the accounting-marker fix as its structural half |
| Vibe reviewer homes exceed the Windows path limit | 2026-11-07 | BUGS.md | BUGS_HISTORY.md | original implementation | the isolation directory layout |
| Vibe resume accepts non-canonical spellings of a recorded private copy | 2026-11-07 | BUGS.md | BUGS.md | original implementation | found while closing a review loop, but the gap is in `vibeResumeSource`, which that repair did not change |
| Unwrap inserts a space after a line-end hyphen or slash | 2026-11-08 | BUGS.md | BUGS.md | original implementation | `joinContinuations` always inserts one space |
| A Stop hook reminder write can invalidate a request launched in the background | 2026-11-12 | BUGS.md | a bug record carried by the store cut | original implementation | `store.remind` advances the revision |
| The first triage takes tracking edits made before it into the closing baseline | 2026-11-14 | BUGS.md | BUGS.md | original implementation | the closing baseline captured at the first triage |
| Close this repository's two 3.3.12 review contexts after 3.3.26 is published | 2026-11-02 | QUICK_WINS.md | QUICK_WINS_HISTORY.md | unclear | repository housekeeping recorded at triage |
| Amending a governing spec inside its code task blocks the task until a whole-spec reassessment | 2026-11-02 | QUICK_WINS.md | BUGS_HISTORY.md | original implementation | `specReady` gates every code-task action |
| Resolve the close feature's deferred review findings | 2026-11-02 | QUICK_WINS.md | QUICK_WINS.md | review fix | "Deferred as minor ... from the fresh code gate" |
| Tell the close procedure how to recover from a partial failure | 2026-11-02 | QUICK_WINS.md | QUICK_WINS.md | review fix | "Deferred as minor in delivery `ede318dd`", read as a deferred review finding |
| Map a governing spec's Verification items to tests before the first code assessment | 2026-11-02 | QUICK_WINS.md | QUICK_WINS.md | instruction change | raised in a retrospective; adds a step to the brief or revise-code |
| Point close's no-activation warning at a remedy that clears it | 2026-11-03 | QUICK_WINS.md | a bug record carried by the store cut | original implementation | the warning text in `internal/runtime/close.js` |
| Report a revision mismatch as stale state rather than a stale owner | 2026-11-03 | QUICK_WINS.md | QUICK_WINS.md | original implementation | the admission check's refusal code |
| Make the ready parser usable as a delivery check | 2026-11-03 | QUICK_WINS.md | QUICK_WINS.md | original implementation | the parser is refused as a recorded check |
| Say before selection that delivery needs a Git repository | 2026-11-03 | QUICK_WINS.md | QUICK_WINS.md | unclear | whether `handover` should refuse or Ready should warn is open |
| Say what a review import does to a task's stage and which stage an advance reached | 2026-11-03 | QUICK_WINS.md | QUICK_WINS.md | original implementation | the `advance` result does not name the stage reached |
| Resume Vibe reviewer lineages | 2026-11-03 | QUICK_WINS.md | QUICK_WINS_HISTORY.md | original implementation | `review.resume` refused a Vibe receipt |
| Keep resumed Vibe turns short enough to beat replacement | 2026-11-03 | QUICK_WINS.md | the resume-cost feature record | unclear | a measurement recorded when 3.3.28 shipped |
| Tell a per-task assessment about its sibling tasks' checks | 2026-11-08 | QUICK_WINS.md | QUICK_WINS.md | original implementation | the runtime's check attachment |
| Tell reviewers that probe copies hold no ignored or external runtime | 2026-11-08 | QUICK_WINS.md | QUICK_WINS.md | instruction change | reviewer prompt text; renamed from "Tell reviewers that probe copies hold no installed dependencies" |
| Name every docs-gate cause when a closing check also fails | 2026-11-09 | QUICK_WINS.md | QUICK_WINS.md | review fix | "Deferred as minor in delivery `ffb10269`" |
| Treat declared probe paths as a set in the repeat key | 2026-11-09 | QUICK_WINS.md | QUICK_WINS.md | review fix | "Deferred as minor in delivery `ffb10269`" |
| Use one check for a well-formed surface | 2026-11-09 | QUICK_WINS.md | QUICK_WINS.md | review fix | "Deferred as minor in delivery `ffb10269`" |
| Say in the morning report which findings the user settled during the run | 2026-11-12 | QUICK_WINS.md | QUICK_WINS.md | instruction change | morning report guidance |
| The retrospective weighs mechanical enforcement before proposing a rule | 2026-11-12 | QUICK_WINS.md | QUICK_WINS.md | instruction change | revise-lore guidance |
| Settle the deferred minor findings of the documentation paths and closing condition spec | 2026-11-13 | QUICK_WINS.md | QUICK_WINS_HISTORY.md | review fix | "Five minor findings from the independent assessment" |
| Move the closing hold into its own runtime module | 2026-11-13 | QUICK_WINS.md | QUICK_WINS.md | review fix | "A fresh code review there ... found" |
| Recover an uncomparable closing baseline like a missing one | 2026-11-13 | QUICK_WINS.md | QUICK_WINS.md | review fix | "Deferred in delivery `d7639372-2cf2-413d-94ca-9c2dac1f540c`", read as a deferred review finding |
| Make the closing hold guidance match every run shape | 2026-11-13 | QUICK_WINS.md | QUICK_WINS.md | review fix | names the confirmed minor findings |
| Include every governing spec in post-triage task dispatches | 2026-11-13 | QUICK_WINS.md | QUICK_WINS.md | review fix | "Deferred in delivery `d7639372-2cf2-413d-94ca-9c2dac1f540c`", read as a deferred review finding |
| Say when a review import could not record its closures | 2026-11-14 | QUICK_WINS.md | QUICK_WINS.md | original implementation | the import exits 0 without a warning |
| Remind at disposition to reproduce before repairing | 2026-11-14 | QUICK_WINS.md | QUICK_WINS.md | instruction change | repair guidance at disposition |
| Name a running worker when continuation stops for lack of progress | 2026-11-14 | QUICK_WINS.md | QUICK_WINS.md | original implementation | the Stop hook's message |
| Fail runtime test fixtures closed on an unwired fake host | 2026-11-14 | QUICK_WINS.md | QUICK_WINS.md | original implementation | `dependencies.runAgent ?? runAgent` |
| Drop the History section from the index templates | 2026-11-14 | QUICK_WINS.md | QUICK_WINS.md | instruction change | the init-backlog templates |
| Remember a host's reported usage limit between dispatches | 2026-11-14 | QUICK_WINS.md | QUICK_WINS.md | original implementation | no state kept between dispatches |
| Make the turn-ending acknowledgement the default under verified continuation | 2026-11-15 | QUICK_WINS.md | QUICK_WINS.md | review fix | "which the docs finding `1c879dbf:instruction-files-routing` ... raised" |
| Say how a failed controller claim is signalled | 2026-11-15 | QUICK_WINS.md | QUICK_WINS.md | instruction change | the runtime reference is silent on a failed claim's exit code |
| Tell a relevance reviewer which changed paths its gate ignores | 2026-11-15 | QUICK_WINS.md | QUICK_WINS.md | instruction change | reviewer prompt text |
| Name a stale docs review as a fresh target after a docs repair elsewhere or say why not | 2026-11-15 | QUICK_WINS.md | QUICK_WINS.md | original implementation | status's fresh targets |

## Contestable classifications

- "Vibe resume accepts non-canonical spellings of a recorded private copy" would be a review fix if the guard change it was found beside had introduced the gap; the entry places the gap in `vibeResumeSource` and `isPrivateCopyDirectory`, which that change did not touch.
- Three quick wins say only that they were deferred in a delivery, without naming a reviewer: the close procedure's partial failure, the uncomparable closing baseline and the governing specs of post-triage dispatches. They are counted as review fixes, reading a deferral in a delivery as the disposition of a finding; read strictly, the second window would read 8 quick wins.
- "Say before selection that delivery needs a Git repository" and "Say how a failed controller claim is signalled" could each be code or prose; the first is unclear because its entry leaves the remedy open, the second an instruction change because the gap it names is the reference's silence.
