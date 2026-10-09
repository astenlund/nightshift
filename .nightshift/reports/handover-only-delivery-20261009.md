# Handover as the delivery boundary: acceptance report

This report records the evidence for [Handover as the delivery boundary](../features/handover-only-delivery.md), delivered locally as plugin 3.3.10 by run `67af3471-c7c7-4e28-ab57-88e3ba299126`. The candidate has not been published; publication remains a separate user decision.

## Scope and identities

The governing design is the feature record; `.nightshift/specs/handover-only-delivery.md` remains a short compatibility reference for the retained agreement. The implementation covers handover-only delivery creation, Ready selection released by scope confirmation, durable standalone review contexts for all four revise kinds, separation of handover authority from continuation health without execution modes, distinct continuation-failure follow-ups, the observed acknowledgement and its read-only checkpoint, shared writer protection, explicit holds, semantic progress accounting with independent provenance, and the creation consistency gate with its report-confirmation route. Interrupted-run pickup, background selection assessment, keeping delivery open for triage, reboot relaunch, advanced review-range capture and the migration of earlier-release delivery records remain separately tracked.

The run stays bound to retained 3.3.8, identity `3.3.8-6dfed0b115cdd2a1c93d2ef3993ee1f9c6718ab83510889d775dcea60c975d9a`; new semantics do not migrate it. Codex session `01a115e3-6dbe-7ad2-b270-889fd48fe430` controlled the run until 2026-10-08, when its input exceeded the model's context window. At the user's direction, after the user quit the Codex app, Claude Code session `6b424cb5-0c87-4fd3-b3e5-c85088cb6a7d` adopted the run through the runtime's adoption checks and continued it; this report records its assurance while the closing stages that follow it remain in progress. The tested-candidate Codex fixtures below used payload manifest SHA-256 `9dd18e3a6101bbaaee3f4000312612b839bd8de992c3dcc2bd7be12c83e0cd09`; the final candidate's is `f0b23454fca221243f94cd1dc3b6e94a28f268999a9351204da7f2519e577ef5`. Three repairs described under Independent assurance came after those fixtures, with their reference updates: the controller-claim prerequisite scoped to delivery runs, the Windows alias refusal in write ownership, and the closing replacement rules.

## Decisions during the run

- 2026-10-07: the user handed over the agreed scope with a 16,000,000-token live-verification allowance, later raised to 24,000,000 and 28,000,000, selected Sonnet for small Claude Code fixtures and Astra for actual-change assurance, and asked for economy.
- 2026-10-08: the user removed the live-verification cap and directed work until completion, using Claude Code only when that host is needed and Sonnet there unless a concrete reason warrants another model; strong reviews stay on Astra.
- 2026-10-08: after the Codex controller stalled, the user asked Claude Code to take over and quit the Codex app before adoption.
- 2026-10-09: for an unconfirmed morning report, the user chose to refuse a new handover while the latest completed delivery's report awaits its recipient's reply, and to let any admitted session of the project record that reply on the completed run.
- 2026-10-09: the user kept the creation gate fail-closed for delivery records saved by earlier releases and chose their migration as the next work.
- 2026-10-09: the user chose to treat a record carrying schema-2 accounting without its independent provenance as lost provenance rather than as legacy.
- 2026-10-09: after a clean fresh code gate, the user chose one current-candidate native rerun on Codex only, with Claude Code branches staying provisional and failed attempts reported rather than retried until they pass.

## Independent assurance

The governing design's final fresh whole-spec Astra assessment, `07111ca0-8f54-4e88-8661-bda39c68912a`, completed all four spec dimensions without findings after the last decision was written into the record.

Code assurance ran on Astra through repeated fresh assessments, fresh skeptic validation of every finding, dispositions, repairs and closure by the raising reviewer. Fresh code gate `0078dfdf-1a1c-4d1d-bc53-1030570ac753` completed without findings, evaluating the stored results of seven focused deterministic probes, each exit 0. Recording the user's native-acceptance decision advanced the task's requirements revision, and the next fresh gate, `621cca0a-acae-4921-9ffb-81e1f840e595`, raised one important finding: the shared operating brief and both references required `claim-controller` before canonical engineering in every controller turn, an operation standalone review contexts refuse. Fresh skeptic `7eb05276-412c-4531-a737-089dedbfb88a` confirmed it as an instruction conflict rather than a runtime defect. The repair scopes that prerequisite to delivery runs at all three sites, names the standalone route, and adds a guard in `tests/package.test.js`. Its raising reviewer closed that repair. Later fresh gates raised five more important findings, each confirmed by a fresh skeptic from private-probe evidence, repaired with deterministic regressions and closed by its raising reviewer: Windows write ownership admitted NTFS stream spellings and 8.3 short names as separate reservations (`535c212a`); a completed delivery whose closing record was reopened by renewed triage could be replaced (`2f804cd6`); closing work recorded on the same record after completion could be detached by replacement (`53d991b8`), including when restored content matched only a superseded assessment (`3dc48828`); and the resulting coverage rule over-blocked a superseded attempt of a named check (`3d545a53`). One resumed reviewer ended in an output loop and a fresh lead took its place. The final fresh Astra code gate, `cda69be5-a61f-4bbf-89c5-0c3eeae12728`, completed all six code dimensions without findings.

The delivery's independent docs review assesses this documentation, this report included; the morning report records its outcome.

## Deterministic verification

The task's named runtime checks, current at revision 3276:

- delivery regression checks: 249 tests passed
- semantic progress persistence: 461 tests passed
- semantic progress focused boundaries: 75 tests passed
- hook diagnostic episode compatibility: 58 tests passed
- launcher report confirmation: 27 tests passed
- package surface: 8 tests passed
- payload manifest current: the shipped manifest matches the payload bytes

Deterministic results do not establish model-owned ordering or native host behavior.

## Tested-candidate Codex evidence

On 2026-10-09 each of the five Codex scenario groups ran once against the tested candidate named under Scope and identities, each in its own isolated fixture: a separate Codex profile and retained store, Codex CLI 0.160.1, model `gpt-6-astra`, automatic approvals confined to the fixture directory, nested model reviews forbidden, and Nightshift hooks deliberately left untrusted, since the fixture may not change native trust. Each scenario asked the controller to hold before independent assurance, so none exercises assurance, closing or completion.

| Scenario | Known tokens | Observed outcome |
| --- | ---: | --- |
| Ordinary chat | 143,721 | Changed `LABEL.txt` to `new` directly and created no run or review record. The prompt itself declined Nightshift, so this shows that the candidate does not force a run, not unprompted non-activation. |
| Ready selection before agreement | 390,248 | Ready explained that selecting work requests delivery after investigation and scope confirmation; selecting the item produced a readback and a confirmation question. No run was created and `LABEL.txt` stayed `old`. |
| Ready confirmation and user hold | 602,554 | The confirmed scope created run `e22c664c-bf4f-4a63-98f4-ad968c04e782` through `handover`. The confirming reply itself also asked to accept the handover, so this shows acceptance after an explicit request, not release by scope confirmation alone. The reply began `Handover accepted:` and said `You can leave.` before the requested hold at revision 1; `LABEL.txt` stayed `old`. The untrusted hooks were recorded once as a hook-integration continuation follow-up. The model attempted no goal and recorded no continuation outcome before acknowledging and holding, although the skill directs an attempt first; with no engineering requested, the acknowledgement gate was not exercised. |
| Standalone revision, all four kinds | 1,275,380 | revise-code, revise-spec, revise-docs and revise-lore each opened a separate held review context, `00f38b8c`, `986c0e15`, `ea91b402` and `7e27f667`, in `review-state.sqlite`, with no delivery run, continuation or edit. No context reached assessment, repair or completion. |
| Explicit handover, continuation and resume | 1,340,041 | Handover created run `4237f7ae-2d47-4751-b33e-a14f8816c6a5`, created a native goal and recorded it observed active, and recorded the untrusted hooks as one follow-up, which reached seven occurrences. The runtime observed the acknowledgement in the native history (emitted 14:52:20Z, observed 14:52:40Z) before `start-task`; the controller then changed `LABEL.txt` to exactly `new` plus LF, its `exact-label-line` check passed, and it held. Resumption reopened the same run, observed the goal paused and recorded that in the next hold at revision 12; the controller reported that its tools could not reactivate the goal. |

The fixture payload predates three later repairs: the controller-claim prerequisite scoped to delivery runs, the Windows alias refusal in write ownership, and the closing replacement rules. No scenario reached canonical engineering in a standalone context, wrote through a Windows alias spelling or replaced a completed delivery, so none exercised the changed paths, and their native behavior remains unverified.

## Earlier-candidate evidence

Before the current candidate, the run's native campaign used earlier 3.3.10 sources. On Codex the same five scenario groups ran once each on 2026-10-07. On Claude Code, Sonnet sessions exercised the acknowledgement: working-hook session `be485e93-19bd-4119-a378-817536daf125` showed acknowledgement, admission, the exact byte change and a hold, before the read-only checkpoint existed; cold sessions `44248589-773e-4571-bca7-63eb4705ca62` and `b78bdc07-2172-461e-9169-78e5a333d259` left work pending and gave their complete disclosure only as terminal output. Interactive session `83576af0-0091-4bf7-8b89-d2b6e83418ac` on Claude Code 2.1.292 showed ordinary assistant text before a Read call in the same response; its later handover attempt stopped during resource preparation, before a run existed. Ordinary interactive Sonnet 5.5 session `9ef48abe-7a8d-4b53-85ad-76531553abbb` reached its 1,000,000-token threshold at 1,029,644 known tokens with its record pending and no qualifying acknowledgement, and controlled Sonnet 5.5 session `e474a46c-3c8b-4855-8a83-310b92f305b3` ended its turn without acknowledged engineering at 2,274,898 tokens. A paired read-only comparison on Claude Code 2.1.293 found both Sonnet 5.5 and Sonnet 4.6 emitting a neutral control before Read, while only Sonnet 4.6 emitted the complete hypothetical acknowledgement as ordinary text. Sonnet 4.6 session `44895a7c-4672-4c92-8af7-08735bb177da` recorded disabled-hook continuation failure, emitted the complete ordinary acknowledgement, received an available checkpoint, admitted `start-task`, wrote `new` plus LF and passed its byte check in the original turn; the controller's watchdog interrupted it before the model-owned hold, and owner cleanup recorded the hold later. Cumulative Astra assessments closed the acknowledgement-before-engineering finding on that trace, narrowly. None of this establishes uninterrupted completion or the current candidate's behavior on Claude Code.

## Live claims

Each cell is a separate host obligation; no cell borrows a sibling's evidence. Probed cells rest on the tested-candidate Codex fixtures above and do not cover the three later repairs.

| Branch | Claude Code | Codex |
| --- | --- | --- |
| Ordinary chat does not create delivery | (live-claim: provisional) | (live-claim: probed 2026-10-09), with a prompt that declined Nightshift |
| Ready selection before investigated confirmation | (live-claim: provisional) | (live-claim: probed 2026-10-09) |
| Ready confirmation releases requested handover | (live-claim: provisional) | (live-claim: provisional); acceptance after an explicit handover request was observed |
| Explicit handover creation | (live-claim: provisional) | (live-claim: probed 2026-10-09) |
| Complete acknowledgement before engineering with working continuation | (live-claim: provisional) | (live-claim: probed 2026-10-09) |
| Complete acknowledgement and engineering in one turn with failed continuation | (live-claim: provisional) | (live-claim: provisional) |
| Native Stop hook or goal invocation | (live-claim: provisional) | (live-claim: probed 2026-10-09) |
| Missing, disabled, untrusted or failed mechanism with valid admission | (live-claim: provisional) | (live-claim: probed 2026-10-09), untrusted hooks beside a working goal |
| Explicit hold | (live-claim: provisional) | (live-claim: probed 2026-10-09) |
| Explicit stop | (live-claim: provisional) | (live-claim: provisional) |
| Exhausted applicable limit | (live-claim: provisional) | (live-claim: provisional) |
| Compaction recovery | (live-claim: provisional) | (live-claim: provisional) |
| Authorized resumption | (live-claim: provisional) | (live-claim: probed 2026-10-09) |
| Standalone revise-code without delivery | (live-claim: provisional) | (live-claim: probed 2026-10-09), opening and hold only |
| Standalone revise-spec without delivery | (live-claim: provisional) | (live-claim: probed 2026-10-09), opening and hold only |
| Standalone revise-docs without delivery | (live-claim: provisional) | (live-claim: probed 2026-10-09), opening and hold only |
| Standalone revise-lore without delivery | (live-claim: provisional) | (live-claim: probed 2026-10-09), opening and hold only |
| Refusal on invalid ownership, resources or requested-operation permission | (live-claim: provisional) | (live-claim: provisional) |
| Report-delivery refusal and cross-session confirmation | (live-claim: provisional) | (live-claim: provisional) |

## Accounting

The live-verification ledger counts every model session launched solely for acceptance across both hosts, cached input once within input, output and separately reported components without duplication. Across 34 attempts it records 27,066,936 known tokens and 9,896,000 tokens of retained uncertainty, reserved exposure from interrupted attempts rather than measured use; the current-candidate Codex rerun added 3,751,944 known tokens and no uncertainty. Actual-change reviews, skeptics, controller work and implementation are accounted separately.

## Limitations

- Delivery records saved by earlier releases carry no independent provenance. A read-only measurement on 2026-10-09 against a copy of this repository's store authenticated none of its 43 earlier-release records, so this repository refuses new handover under 3.3.10 until [the migration](../features/legacy-delivery-record-migration.md) ships.
- Every Claude Code branch and the Codex branches marked provisional above lack native evidence on the tested candidate, and no native fixture exercised the three later repairs.
- The handover skill's model-owned handling of a `report-delivery-pending` refusal has no native evidence on either host.
- The Ready-hold scenario's controller acknowledged and held without attempting continuation; one observation establishes neither a defect nor its frequency.
