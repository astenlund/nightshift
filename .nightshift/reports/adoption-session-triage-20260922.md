# Run-adoption session triage

The user completed one-at-a-time triage on 2026-09-22: nine incidents are tracked and two are skipped. Tracking does not authorize implementation or publication. This report preserves the decisions and evidence independently of the ignored run files. It does not declare the run-adoption candidate accepted or complete.

Source project: `C:/Git/nightshift`. The controller used retained Nightshift 3.2.1 while developing candidate 3.2.3. The specification run was `5286ec74-ec0d-4ba8-a1cc-48877625a834`; the delivery run is `b9b654ea-0368-40da-93dc-b212899db003`. Raw receipts, check output and detailed incident records remain under `.nightshift/runs`; private experiments remain under `.tmp`. Statements below distinguish observations, user reports and unresolved causes.

## Dispositions

| Incident | Decision and durable route |
| --- | --- |
| Unrelated attachment disrupted review | Skip further work; project memory saved, revisit on recurrence |
| Whitespace stream exhausted the review timeout | Skip; existing detection and recovery accepted |
| Missing executive governing scope | Track in [Bugs](../BUGS.md#executive-governing-scope-is-missing-during-early-review) |
| Deep private-probe paths | Add recurrence to [Private review copies fail at Windows path depth](../QUICK_WINS.md#private-review-copies-fail-at-windows-path-depth) |
| Premature blocker classification | Track in [Bugs](../BUGS.md#available-recovery-is-mistaken-for-a-terminal-blocker) |
| Cancellation cleanup verification | Add recurrence to [Windows job pipe and containment fixtures](../BUGS.md#windows-job-pipe-and-containment-fixtures-fail-outside-the-code-they-cover) |
| Repeated handover reports and bookkeeping | Track in [Bugs](../BUGS.md#automatic-blocker-checks-repeat-handover-reports) |
| Custom acceptance-tooling expansion | Track in [Bugs](../BUGS.md#acceptance-tooling-expands-beyond-demonstrated-verification-needs) |
| Report-triggered regression reruns | Track in [Bugs](../BUGS.md#report-edits-invalidate-unrelated-regression-checks) |
| Missed validation fallback | Track in [Bugs](../BUGS.md#permitted-validation-fallbacks-are-lost-between-runs) |
| Retrospective coverage | Track in [Bugs](../BUGS.md#retrospectives-omit-work-selection-and-policy-failures) |

The two existing backlog owners were enriched rather than duplicated. The other seven tracked concerns received separate entries. The user's design constraint is to keep model-specific plugin instructions minimal: describe general roles by capabilities and required strength, preserving explicit user choices and actual model identities in evidence.

## Skipped attachment incident

An unrelated image materialized under `.codex-remote-attachments/` after the snapshot for review `516fb299-3276-4804-a65b-75df021f4afe`. The spec was unchanged, but the completed assessment could not be imported because the input inventory had changed. Replacement review `a43579c8-77a7-4fd3-9026-b381cb01edb6` excluded the exact unrelated path and succeeded; both assignments had the same engineering snapshot digest. The image was not inspected or modified. The user believes it originated in an earlier session; materialization time does not establish its source or concurrent activity.

Commit `629cc05` adds the local ignore rule. The user chose: "skip, but log a memory. if it happens again, we'll do something about it then." The project memory `attachment-materialization-review-drift.md` was written and indexed. No broader investigation or permanent plugin workaround was authorized.

## Skipped whitespace-stream incident

Review `cbfb3262-d1f5-4fce-9b44-462fbabfac40` emitted unfinished JSON followed by 63,983 whitespace characters and reached its 900,000 ms timeout. The invalid result was refused, descendant cleanup was verified and a replacement review was obtained. The user described a known repetitive-generation trap and chose "skip: existing detection and recovery are sufficient." That disposition does not independently establish whether this particular stream originated in the model, constrained output or host transport. No new investigation or implementation is requested.

## Missing executive governing scope

The controller expanded and reviewed a technical draft before creating and presenting the concise governing artifact. The user reported roughly ninety minutes of waiting, and compaction occurred before the final executive presentation. Draft links or an extensive technical spec did not supply the missing concise commitment baseline. Without it, the user could not reliably distinguish review refinements from scope expansion. Later approval of the executive scope does not prove that earlier additions were agreed; no specific addition has been classified as scope creep.

The user chose to track this workflow failure. Existing v3 instructions already require prompt presentation alongside independent assessment. Whether guidance, interpretation, sequencing or actual presentation caused the failure remains open; historical pre-v3 approval mechanisms are not reinstated by this tracking decision.

## Deep private-probe paths

The exact source from the failed probe passed three cases at a project path length of 50 and failed all three at the original layout's length of 131. Git working directories in the failures measured 272 or 280 characters. Process creation returned null status, `ENOENT` and null output, so Git did not start; `core.longpaths=true` was already set. Baseline and candidate matched in additional shorter/deeper comparisons. This demonstrates a path-sensitive launch failure and a successful short-path recovery, not a confirmed Windows/libuv cause or an adoption regression. Evidence remains in `.tmp/adoption-nested-probe` and the delivery run's private-probe records.

## Premature blocker classification

The earlier delivery report declared a capability blocker with the live allowance untouched, although an independent accounting assessment had identified further authorized investigation and distinguished controller-added restrictions from the accepted scope. Automatic continuation then pursued that avenue without a new grant. The user chose to track the false-impasse classification. This does not establish that the subsequent custom-driver architecture was the necessary or best recovery.

## Cancellation cleanup verification

Under Node 22.23.2, source checks at delivery revisions 297 and 300 each passed 305 of 306 tests. The `--no-input-leaf` Windows cancellation case could not confirm descendant cleanup and reported `jobEmpty` false. Both variants passed in isolation, and the complete set passed with one test file at a time, without source changes or larger timeouts. One failure overlapped helper native tests; the other did not. The cause and whether a process actually leaked remain unknown. This recurrence is retained with the existing pipe/containment fixture entry, without assuming that its earlier Node 26 explanation applies.

## Repeated handover reports

After the blocked outcome had been reported, two automatic goal continuations checked unchanged barriers. The controller emitted another blocker-status final and repeated the full handover report without a new delivery result. The user called out triple reports and found their relationship to the premature-blocker incident unclear. The user chose to track repeated reporting and associated bookkeeping separately. The responsible interaction between instructions, goal continuation and controller behavior remains unresolved.

## Acceptance tooling expansion

The user required bounded aggregate token accounting and genuine host/session evidence. The controller chose a substantial temporary driver under `.tmp/adoption-live`; no requirement mandated that architecture. Repairs and repeated independent assessments of the newly introduced machinery consumed additional work before positive acceptance existed. Those reviews becoming procedurally required after changes does not establish that the original expansion was proportionate.

The driver also excluded an already permitted host-validation fallback. That restriction is established; whether the whole harness was avoidable or earlier tools could have been reused remains unassessed. The user chose to track the architecture/proportionality concern separately from the operational cost of the missed fallback. Reliable accounting and real native evidence remain requirements.

## Report-triggered regression reruns

Comparison of the saved 279-input source-check snapshots shows two report-only edits triggering 306-test checks, with two unchanged-input retries between them. The four starts were 2026-09-22 at 01:36:55, 01:42:32, 01:46:07 and 02:10:45 UTC. Their test runtimes were approximately 145.6, 161.5, 420.1 and 281.0 seconds, totaling about seventeen minutes. This measures command execution, not necessarily added wall-clock delay. The earlier check after actual code changes is outside this criticism.

Failure recovery locally justified the intervening retries. The upstream problem was the broad input declaration making a report edit invalidate unrelated behavioral checks. `.tmp/adoption-verification-history-audit.json` retains the derived comparison; the authoritative check records remain in the delivery run. The user chose to track this separately from the cleanup-test failure.

## Missed validation fallback

The [earlier preparation spec](../specs/automatic-plugin-preparation.md) and [retained-release report](retained-plugin-releases-20260914.md) record Opus for Claude-specific behavior and Astra for strong assessment, including executed precedent. The current driver hardcoded Fable for Claude and did not admit Opus. With an earlier availability warning known, two actual Fable requests produced no acceptance result. The first lacked useful response diagnostics; the second returned HTTP 429. Their conservative held exposure totals 2,256,000 tokens, with no finalized usage. This is not proven consumption and is not released by the tracking decision.

The user later identified the weekly cap, said it resets Thursday morning and reaffirmed the existing fallback roles. That exact timing was supplied afterward. The user chose to track the failure to carry applicable policy into current selection and recovery, preserving required reviewer strength and minimizing general instructions tied to particular models.

## Retrospective coverage

The retrospective recorded at delivery revision 331 identified some genuine incidents, including the missing governing artifact and premature blocker. Its driver discussion nevertheless emphasized repairs and passing checks without assessing machinery proportionality, report-only verification triggers or the missed validation fallback. Existing instructions covering a principle did not establish their application or effectiveness.

The actual retained revise-lore skill already asks for workflow failures and ineffective rules to be examined. Independent assessment is required for proposed instruction diffs; the no-proposal conclusion has no equivalent required challenge. The runtime records nonempty retrospective evidence rather than evaluating reflection quality. The immediate observed problem is incomplete controller reflection. Whether execution, skill framing or orchestration should change remains open, and another mandatory review is not presumed to be the remedy. The duplicate-report episode happened after that retrospective, so it is not retroactively treated as an omission. The detailed bounded assessment remains in `.nightshift/runs/reports/revise-lore-assessment-20260922.md`.
