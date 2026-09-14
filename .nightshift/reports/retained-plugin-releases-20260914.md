# Retained plugin releases: acceptance checkpoint

The cache-replacement implementation and independent code assurance are complete locally. Delivery acceptance remains incomplete because Claude's Fable quota prevents eleven model-owned scenarios. The cache-replacement bug remains active, and publication is not authorized. This report accompanies [the governing design](../specs/retained-plugin-releases.md); durable run `2a89bde5-9c0c-4ba5-b67f-dadc545bfcc4` owns current workflow state.

## Delivered implementation

Nightshift retains complete manifest-verified releases outside replaceable plugin caches. A stable host-level launcher and user hooks preserve exact session/run/worker identities. New work can select the currently enabled release before admission; existing work keeps its bound release. Explicit setup/removal preserves unrelated host configuration. Guarded installed entry points require the retained invocation, and deliberate checkout execution uses `--development`. Shared skill-binding policy has one governing location.

All ordinary repository text has LF attributes, including hashed release and review inputs. Deliberate byte fixtures retain explicit exceptions. Fresh checkout tests with `core.autocrlf=true` verify payload hashes, manifest identity, repository-only text and CRLF fixture preservation. The committed release gate passes from 3.0.12 to 3.1.0, covering 42 shipped changed files. No production profile or live installed cache was modified by acceptance fixtures.

Independent assessment and fresh skeptical validation repaired interrupted run attachment, partial collection recovery, custom-store notice routing, missing-state preservation, verification-mode inheritance, interrupted removal activation, completed-run identity inheritance, concurrent runtime observation and unknown-worker ownership. The final changes reuse the runtime's read-only action and worker-ownership predicates to avoid divergent classifications.

## Independent assurance and verification

Whole-spec assessment `6a1240c5-bba1-4aac-9ff6-078407993090` and cumulative code assessment `34a97cfa-a5ce-4908-a0bd-a422b660b9df` were complete and clean before this acceptance-report update. All findings received fresh skeptical validation before disposition and repair. Subsequent assessment of this report and its evidence is recorded in the runtime; an earlier receipt is not presented as covering later edits.

Current deterministic checks include 60 retention/configuration/packaging/probe cases, 134 runtime/setup cases, the actual 51-case CI retention step, 19 private boundary cases and five identity/legacy cases. Counts overlap. Earlier Ready and unwrap fixtures passed 143 and 38 cases respectively. Documentation links, uniform line endings, the real Ready parser and backlog line checks pass. Fifteen named runtime checks now cover deterministic verification and the recorded native campaigns.

## Installed-host observations

The Windows campaign used Node 22.23.2, Codex CLI 0.153.4 and Claude Code 2.1.268. Code-owned native boundaries were tested without inference; model-owned behavior used real native sessions. Synthetic receipt fixtures remain deterministic evidence only.

| Acceptance item | Codex | Claude |
| --- | --- | --- |
| Initial capture | Observed | Observed |
| Pre-work rediscovery and instruction refresh | Observed | Pending Fable |
| Incomplete capture refusal | Observed | Pending Fable |
| First skill use | Observed | Pending Fable |
| Explicit development selection | Observed | Pending Fable |
| Unbound installed-entry rejection | Observed | Pending Fable |
| Unrelated activation failure stays silent | Observed | Observed |
| Existing session survives source loss | Observed | Pending Fable |
| Saved-run restart | Observed | Pending Fable |
| Native compaction and subsequent reconciliation | Observed | Pending Fable |
| Unattended Stop continuation | Observed | Pending Fable |
| Active review survives source loss | Observed | Pending Fable |
| Receipt import after source loss | Observed | Pending Fable |
| Unavailable exact identity is not replaced | Observed | Observed |
| Disabled-hook admission refusal | Observed | Observed |
| Untrusted or changed registration refusal | Observed | Observed |
| Setup preserves unrelated hooks and trust | Observed | Observed |
| Removal preserves unrelated hooks and trust | Observed | Observed |
| Later trust or definition invalidation | Observed | Observed |
| Duplicate registration conflict handling | Observed | Observed |

Codex has observations for all twenty items. Claude has nine native code-owned observations; the remaining eleven require Fable model execution. Claude has no Codex-style per-hook hash trust. Its changed-registration test modifies an owned hook definition after actual activation and verifies refusal. The two hosts' distinct trust mechanisms are not treated as identical.

The model-driven Codex cases used normal scoped command approvals. Early fixture attempts had missing Windows sandbox configuration or nested-process restrictions. The successful upgrade, fresh-session and restart/compaction cases declared their entire isolated fixture directory writable, including the project, retained store and sibling evidence directories; their approval files also lived under that broader root. Later development, raw-entry, pre-work and Stop cases declared only the project writable and stored approval decisions outside that writable scope. Observed model writes and individually approved launcher operations do not narrow the earlier declared permissions. Archived approvals use plain one-command acceptance, with no persistent execpolicy amendment. These scope differences qualify the permission environment; they are not evidence of tampering and do not negate the recorded functional outcomes.

The real upgrade case installed fixture version 3.1.1 and deleted the old 3.1.0 cache. The same model session reran Ready through its retained 3.1.0 binding while the old cache stayed absent. A fresh session selected 3.1.1 without changing the older bound run. The pre-work case changed releases before any binding existed and used a test-only instruction in the replacement to verify that the model refreshed its skill instructions. An incomplete replacement was refused without a partial binding or a false empty-backlog report.

A real bound fixture run survived process restart and native compaction. A distinct post-compaction model turn read the retained runtime and recovered the same run id, resource identity and unresolved decision. An actual attributed native reviewer remained active while its original source was removed; its real receipt preserved the resource identity and passed production receipt validation and import afterward.

Native Stop blocked an early final answer after source removal, restored the unfinished fixture task, and the model resumed documentation work. A conservative controller threshold interrupted the last completion step. The same native conversation subsequently finished that step and received a normal final Stop. This is a recovered continuation sequence, not an uninterrupted-attempt claim.

## Evidence locations

Raw events, scoped approvals, usage records, harness snapshots and fixture results remain under `.tmp/cache-retention`. The per-host inventory is `live-claims.json`. Focused manifests are `live-entry-evidence.json`, `live-prework-evidence.json`, `native-boundary-evidence.json`, `claude-native-boundary-evidence.json` and `native-stop-evidence.json`.

- Upgrade and first skill use: `codex-implementation-15ca7479-74c1-4621-aff2-29e3d7d67f08/live-ready-87b53aeb-cd69-4ca0-82e9-1a10be5f05d5`.
- Restart and compaction: `codex-implementation-19b34d0d-5280-4421-8e9e-61d62d7ccab5/live-resume-run-64e9a907-f803-40cf-9b71-628a90837297`.
- Pre-work replacement: `codex-implementation-5663ae84-871c-4958-8d36-b240566de0c1/live-rediscovery-7d4a8825-bcf7-495a-a3bb-a0a4ec279fb2`.
- Incomplete capture: `codex-implementation-23989b6d-8bcc-4ff4-b261-5f68dba6f999/live-blocked-capture-28766269-8554-40d8-a4a0-b81501278947`.
- Real review and receipt import: `codex-implementation-0ff48658-9978-485e-b777-c603c8818ded/live-review-loss-739f103a-0bdc-4aa6-a66e-4a60016e3d84`.
- Stop and recovered completion: `codex-implementation-f93e0d0f-b57f-41c8-bbfe-16447e32f835/live-stop-44ce0dd4-2d2e-4787-96da-15346752d16e` and `live-stop-confirmation-e894ddd8-7e06-4f08-807f-acee559a4756` in the same fixture.
- Claude quota rejection: `claude-implementation-aa3adc03-07cd-47af-afce-85df211f0efe/live-claude-ready-52bac0df-0931-4aa1-a0c6-8b62b60af5c8`.

## Authority, budget and remaining work

The user approved host-level setup and the isolated fixture/plugin-context export. On September 14 the user clarified that the 16,000,000-token allowance covers live checks only, excluding ordinary operation. The controller had incorrectly charged ordinary spec/code review and skeptical validation against it. All historical requests, measured usage and uncertainty remain preserved in `budget.json`; `budget-before-user-scope-correction.json` preserves the original ledger. Live checks use the separate `live-check-budget.json`.

At this checkpoint, live usage is 4,061,925 measured tokens plus 2,400,000 qualified interrupted-request exposure, leaving 9,538,075 available. Compaction usage is recovered from native per-response records because the streaming counter omitted it. A driver bug that confused compaction's completed turn with a subsequent observation was repaired with exact turn-id tracking and regression tests. Both that interrupted observation and the threshold-ended Stop attempt retain conservative exposure; neither is reported as zero or silently discarded. Ordinary assurance remains outside the live allowance.

The current Claude Fable attempt was rejected by its seven-day limit, with reset reported for September 17, 2026 at 07:00 UTC. Its native model usage was zero. No credits, paid overage or account settings were changed. The remaining Claude model-owned scenarios, final delivery acceptance and backlog graduation remain incomplete. Existing code/configuration observations do not substitute for those model-owned checks.

The original run began attended and was later handed over. The runtime still lacks an attended-to-unattended mode transition, so its historical mode field was preserved rather than edited directly. Native goal continuation was observed separately. Documentation and blocked-checkpoint retrospective/triage are recorded without claiming completed engineering. Pending product follow-ups remain the permission-only spec invalidation, existing-run handover transition and clear Handover accepted acknowledgement. The missing Ready-recommendations bug is tracked separately. Publication remains user-directed.
