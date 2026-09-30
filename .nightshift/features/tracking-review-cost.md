---
name: tracking-review-cost
description: Closing review of backlog tracking edits can cost more than reviewing the delivered change; find proportionate ways to keep it strong and independent without repeated full rounds over minor prose
metadata:
  type: feature
status: exploring
---

# Proportionate review of tracking edits

## Origin

Observed on 2026-09-30 in run `7969bab6-360c-4bd5-a5bd-33dfe3ef28d9`. After triage the controller reported that the closing docs review of the tracking edits had cost more than twice the delivery and offered to capture it; the user replied "yes, let's capture that".

## Evidence

The delivery, a runtime change with guidance, tests and packaging, took eight review dispatches and 5,103,757 reported tokens. The tracking edits that triage called for, about a hundred lines of backlog prose in three indexes and two new records, then took six closing docs reviews and five skeptics, 13,599,797 reported tokens plus two attempts whose usage was not recorded, and every finding was minor:

| Round | Docs review | Findings besides the routing notice | Skeptic |
| --- | --- | --- | --- |
| 1 | `164f8ed9`, Codex `gpt-6-astra`, 908,578 | A current-behavior baseline the controller overstated | `6c2d1494`, 705,380 |
| 2 | `482b4fa3`, Codex attempt ended as an output loop, Fable fallback 2,874,643 | A misattributed observed case, related sources left out, a missing vision sentence | `b0577cb0`, 579,545 |
| 3 | `3dc623d6`, Codex output loop again, Fable fallback 4,418,957 | Two points in the controller's rewrite for the user's mid-triage refinement | `868b9030`, 234,227 |
| 4 | `72ce429c`, Codex, 1,184,732 | An absence claim ("the only recorded loss") the records contradicted | `528b7226`, 412,907 |
| 5 | `2d2dd2c5`, Codex, 951,078 | Returned incomplete: the numbers in the tracking text rested on ignored run records outside its snapshot | none; not imported |
| 6 | `2d13e3f9`, Codex, 851,580 | A README overstatement from the delivery that earlier reviews missed | `5d3f89ca`, 478,170 |

Causes seen in that run:

- **Routing notices as findings.** The docs-review brief in `internal/runtime/review.js` asks the reviewer to report every changed operating-instruction file as a finding. Every closing review and both of the task's docs reviews raised the same notice although a current code assessment covered those files, and each imported one needed skeptic validation and a disposition; one skeptic dispatch of the task (`78983c09`, 308,130 tokens) validated nothing else.
- **Unchecked claims in tracking prose.** Counts, absences and baselines the controller wrote without checking them drew findings in rounds 1, 2 and 4.
- **Evidence outside the snapshot.** Round 5 could not verify claims about run records until a generated evidence record was supplied as a selected artifact, the lesson [Acceptance reports carry a checkable evidence digest](../QUICK_WINS.md#acceptance-reports-carry-a-checkable-evidence-digest) records, whose proposed brief sentence the user widened to any agreed requirement whose evidence is gathered outside recorded checks.
- **Whole-change context for every round.** Each closing review assessed the tracking edits against the complete cumulative change, at 0.85 to 1.2 million tokens per Codex round.
- **Output-loop fallbacks.** Two Codex attempts were ended as output loops and fell back to Fable at 2.9 and 4.4 million tokens; the loop attempts recorded no usage, as [Output-loop attempts record no token usage](../BUGS.md#output-loop-attempts-record-no-token-usage) describes.

## Open questions

- Whether the docs review should report operating-instruction routing in a separate field of its report rather than as a finding, so that it needs no skeptic or disposition when a current code assessment already covers the files.
- Whether the first closing dispatch should always carry a generated evidence record for claims about run records, which overlaps the widened brief sentence of the evidence-digest quick win; whether that sentence, written for evidence backing an agreed requirement, covers claims about run records in tracking prose is open.
- Whether a repair batch of minor wording fixes in tracking prose can be reassessed more narrowly than a full round over the whole cumulative change, and how that squares with the operating brief's rule that every repair batch gets another strong assessment of the full cumulative change.
- How this relates to [Orchestration efficiency](orchestration-efficiency.md), whose measurements attribute almost all review-dispatch cost to context re-read on every call, the same cause as the whole-change context of every round here.
