# Retained plugin releases: acceptance checkpoint

The local 3.1.0 cache-replacement candidate has observations for all twenty acceptance items on both supported hosts and a complete, clean cumulative Astra assessment of the implementation, report and native evidence. The bug is archived as fixed locally. Subsequent documentation verification and delivery closure are recorded in the runtime. This report records the local delivery checkpoint before the user separately authorized publication. This report accompanies [the governing design](../specs/retained-plugin-releases.md); durable run `2a89bde5-9c0c-4ba5-b67f-dadc545bfcc4` owns current workflow state.

## Delivered implementation

Nightshift retains complete manifest-verified releases outside replaceable plugin caches. A stable host-level launcher and user hooks preserve exact session/run/worker identities. New work can select the currently enabled release before admission; existing work keeps its bound release. Explicit setup/removal preserves unrelated host configuration. Guarded installed entry points require the retained invocation, and deliberate checkout execution uses `--development`. Shared skill-binding policy has one governing location.

All ordinary repository text has LF attributes, including hashed release and review inputs. Deliberate byte fixtures retain explicit exceptions. Fresh checkout tests with `core.autocrlf=true` verify payload hashes, manifest identity, repository-only text and CRLF fixture preservation. The committed release gate passes from 3.0.12 to 3.1.0, covering 42 shipped changed files. No production profile or live installed cache was modified by acceptance fixtures.

Independent assessment and fresh skeptical validation repaired interrupted run attachment, partial collection recovery, custom-store notice routing, missing-state preservation, verification-mode inheritance, interrupted removal activation, completed-run identity inheritance, concurrent runtime observation and unknown-worker ownership. The final changes reuse the runtime's read-only action and worker-ownership predicates to avoid divergent classifications.

## Independent assurance and verification

Whole-spec assessment `6a1240c5-bba1-4aac-9ff6-078407993090` and cumulative delivery assessment `12329139-2ee6-4a44-bfd2-5e56b77161bd` are complete and clean. The latter independently checked the full implementation, all twenty per-host observations, actual native events, permission controls, usage accounting and the sixteen recorded checks. All findings received fresh skeptical validation before disposition and repair. Subsequent assessment of this report and its evidence is recorded in the runtime; an earlier receipt is not presented as covering later edits.

Current deterministic checks include 60 retention/configuration/packaging/probe cases, 134 runtime/setup cases, the actual 51-case CI retention step, 19 private boundary cases and five identity/legacy cases. Counts overlap. Earlier Ready and unwrap fixtures passed 143 and 38 cases respectively. Documentation links, uniform line endings, the real Ready parser and backlog line checks pass. The recorded runtime checks cover deterministic verification and the native campaigns, including a separate check of the completed Claude evidence. Counts describe their own suites and are not a unique-test total.

## Installed-host observations

The Windows campaign used Node 22.23.2, Codex CLI 0.153.4 and Claude Code 2.1.268. Code-owned native boundaries were tested without inference; model-owned behavior used real native sessions. Synthetic receipt fixtures remain deterministic evidence only.

| Acceptance item | Codex | Claude |
| --- | --- | --- |
| Initial capture | Observed | Observed |
| Pre-work rediscovery and instruction refresh | Observed | Observed |
| Incomplete capture refusal | Observed | Observed |
| First skill use | Observed | Observed |
| Explicit development selection | Observed | Observed |
| Unbound installed-entry rejection | Observed | Observed |
| Unrelated activation failure stays silent | Observed | Observed |
| Existing session survives source loss | Observed | Observed |
| Saved-run restart | Observed | Observed |
| Native compaction and subsequent reconciliation | Observed | Observed |
| Unattended Stop continuation | Observed | Observed |
| Active review survives source loss | Observed | Observed |
| Receipt import after source loss | Observed | Observed |
| Unavailable exact identity is not replaced | Observed | Observed |
| Disabled-hook admission refusal | Observed | Observed |
| Untrusted or changed registration refusal | Observed | Observed |
| Setup preserves unrelated hooks and trust | Observed | Observed |
| Removal preserves unrelated hooks and trust | Observed | Observed |
| Later trust or definition invalidation | Observed | Observed |
| Duplicate registration conflict handling | Observed | Observed |

Both hosts have observations for all twenty items. The user approved Astra for strong roles and Opus for Claude-specific checks; native attribution verified `claude-opus-5` for Claude skill, entry, restart, compaction and Stop behavior. The Claude-bound review/receipt cases used a real Astra reviewer, with a native Claude controller stopped before inference. They establish Claude-bound transport and receipt behavior, not Claude-model review inference. Claude has no Codex-style per-hook hash trust. Its changed-registration test modifies an owned hook definition after actual activation and verifies refusal. The two hosts' distinct trust mechanisms are not treated as identical.

The model-driven Codex cases used normal scoped command approvals. Early fixture attempts had missing Windows sandbox configuration or nested-process restrictions. The successful upgrade, fresh-session and restart/compaction cases declared their entire isolated fixture directory writable, including the project, retained store and sibling evidence directories; their approval files also lived under that broader root. Later development, raw-entry, pre-work and Stop cases declared only the project writable and stored approval decisions outside that writable scope. Observed model writes and individually approved launcher operations do not narrow the earlier declared permissions. Archived approvals use plain one-command acceptance, with no persistent execpolicy amendment. These scope differences qualify the permission environment; they are not evidence of tampering and do not negate the recorded functional outcomes.

The Codex upgrade case installed fixture version 3.1.1 and deleted the old 3.1.0 cache. The same model session reran Ready through its retained 3.1.0 binding while the old cache stayed absent. A fresh session selected 3.1.1 without changing the older bound run. The pre-work case changed releases before any binding existed and used a test-only instruction in the replacement to verify that the model refreshed its skill instructions. An incomplete replacement was refused without a partial binding or a false empty-backlog report.

A real bound Codex fixture run survived process restart and native compaction. A distinct post-compaction model turn read the retained runtime and recovered the same run id, resource identity and unresolved decision. An actual attributed native reviewer remained active while its original source was removed; its real receipt preserved the resource identity and passed production receipt validation and import afterward.

Codex native Stop blocked an early final answer after source removal, restored the unfinished fixture task, and the model resumed documentation work. A conservative controller threshold interrupted the last completion step. The same native conversation subsequently finished that step and received a normal final Stop. This is a recovered continuation sequence, not an uninterrupted-attempt claim.

Claude used normal manual permissions with native stdio approval requests, Windows process containment and isolated profiles. The controller inspected writes and runtime mutations individually; constrained policies admitted only fixture reference reads and exact Ready or read-only runtime requests. No persistent permission suggestions were applied. Approval decisions lived outside the model project. This is scoped native tool permission evidence, not a claim of an additional operating-system filesystem sandbox. The initial host-only approval route denied tools instead of forwarding requests; it was corrected to use the documented stdio control protocol, and the unsuccessful attempt remains in the ledger.

For Claude pre-work admission, the controller changed the native installation while the first resolve command remained unapproved and verified that no binding existed. A complete replacement was selected, and Opus reread its bound skill and emitted an instruction marker unique to that replacement. With a required file withheld from both replacement cache and marketplace, capture refused the manifest mismatch, created no binding and produced an unavailable-readiness report. Explicit development succeeded; an unbound direct installed invocation returned resource-context-required. A development probe prompt caused one extra literal argument; that request was rejected and corrected before execution.

Claude exposes both a versioned cache and a marketplace skill source. The Ready and review/receipt cases parked only the old versioned cache after a real native update; the marketplace source remained present. The saved-run, restart, compaction and Stop cases removed both original source copies. The same saved run, revision, exact resource identity and unresolved decision survived reopening and real manual compaction. Claude cumulative modelUsage included 53,040 compaction tokens even though that command reported zero turn-level usage.

The Claude-bound review retained an attributed live Astra reviewer across old-cache removal, then imported its real receipt through the original retained runtime. The old cache was restored only after import during cleanup. The separate Stop case blocked a premature checkpoint answer, returned the unfinished task to Opus, and completed README verification, documentation, retrospective, triage and run closure in the same native process. It recovered from missing original references through retained resources and received a normal final Stop. Unlike the qualified Codex Stop sequence, this Claude attempt completed without interruption.

## Evidence locations

Raw events, scoped approvals, usage records, harness snapshots and fixture results remain under `.tmp/cache-retention`. The per-host inventory is `live-claims.json`. Focused manifests are `live-entry-evidence.json`, `live-prework-evidence.json`, `native-boundary-evidence.json`, `claude-native-boundary-evidence.json` and `native-stop-evidence.json`.

- Upgrade and first skill use: `codex-implementation-15ca7479-74c1-4621-aff2-29e3d7d67f08/live-ready-87b53aeb-cd69-4ca0-82e9-1a10be5f05d5`.
- Restart and compaction: `codex-implementation-19b34d0d-5280-4421-8e9e-61d62d7ccab5/live-resume-run-64e9a907-f803-40cf-9b71-628a90837297`.
- Pre-work replacement: `codex-implementation-5663ae84-871c-4958-8d36-b240566de0c1/live-rediscovery-7d4a8825-bcf7-495a-a3bb-a0a4ec279fb2`.
- Incomplete capture: `codex-implementation-23989b6d-8bcc-4ff4-b261-5f68dba6f999/live-blocked-capture-28766269-8554-40d8-a4a0-b81501278947`.
- Real review and receipt import: `codex-implementation-0ff48658-9978-485e-b777-c603c8818ded/live-review-loss-739f103a-0bdc-4aa6-a66e-4a60016e3d84`.
- Stop and recovered completion: `codex-implementation-f93e0d0f-b57f-41c8-bbfe-16447e32f835/live-stop-44ce0dd4-2d2e-4787-96da-15346752d16e` and `live-stop-confirmation-e894ddd8-7e06-4f08-807f-acee559a4756` in the same fixture.
- Claude quota rejection: `claude-implementation-aa3adc03-07cd-47af-afce-85df211f0efe/live-claude-ready-52bac0df-0931-4aa1-a0c6-8b62b60af5c8`.

- Claude first skill use: `claude-implementation-a52157b5-30d9-410d-a655-84d88a4b6dbb/live-claude-ready-347c6102-cbf7-488f-ab82-ca1b0b6c9057`.
- Claude cache loss: `claude-implementation-a52157b5-30d9-410d-a655-84d88a4b6dbb/live-claude-ready-source-loss-47720a32-7cd1-4eaa-a674-1cf8418f66b0`.
- Claude restart and compaction: `claude-implementation-d10e20e0-7d12-40d2-b1d3-c329e6062f2d/live-claude-resume-and-compact-held-run-1c26a40f-97ae-49ad-9cca-8a2d6ffe9872`.
- Claude pre-work replacement: `claude-implementation-6e31a8f8-6de7-48de-b9de-78731ef7e5b7/live-claude-rediscovery-a91a9fb3-e744-4ad0-897f-91320657515a`.
- Claude incomplete capture: `claude-implementation-4ff5aea5-b016-41f1-ad2a-4df7c643c6b3/live-claude-blocked-capture-100e96aa-3d6f-4886-9d34-3cb4e171351e`.
- Claude-bound real review and receipt: `claude-implementation-f0a7bbde-a973-44a4-b6a4-eab71cb1f39b/live-review-loss-ccf4dcf4-23a7-4008-baef-b330293ff190`.
- Claude Stop completion: `claude-implementation-3e03e6bd-0ad9-45ab-929f-287ec35eb3c6/live-claude-stop-continuation-d20a5072-671d-4c76-badf-66d4486db5c6`.

## Authority, budget and remaining work

The user approved host-level setup and the isolated fixture/plugin-context export. On September 14 the user clarified that the 16,000,000-token allowance covers live checks only, excluding ordinary operation. The controller had incorrectly charged ordinary spec/code review and skeptical validation against it. All historical requests, measured usage and uncertainty remain preserved in `budget.json`; `budget-before-user-scope-correction.json` preserves the original ledger. Live checks use the separate `live-check-budget.json`.

At this checkpoint, live usage is 5,965,346 measured tokens plus 2,400,000 qualified interrupted-request exposure, leaving 7,634,654 available. No live attempt remains active. Codex compaction usage is recovered from native per-response records because its streaming counter omitted it. Claude compaction is charged from cumulative native modelUsage. A driver bug that confused compaction's completed turn with a subsequent observation was repaired with exact turn-id tracking and regression tests. Both that interrupted observation and the threshold-ended Stop attempt retain conservative exposure; neither is reported as zero or silently discarded. Ordinary assurance remains outside the live allowance.

The earlier Fable attempt was rejected by its seven-day limit with zero native usage. The user then authorized Astra/Opus fallback and completed a required fresh Claude login. Opus inference and the remaining native cases subsequently ran successfully. No credits, paid overage or account policy were changed. Completed fixture credential copies were removed; raw acceptance evidence remains available. Publication and production rollout remain outside this local delivery.

The original run began attended and was later handed over. The runtime still lacks an attended-to-unattended mode transition, so its historical mode field was preserved rather than edited directly. Native goal continuation was observed separately. Earlier blocked-checkpoint documentation and retrospective/triage records remain historical; final documentation, cumulative assurance and closing records are tracked separately in the runtime. Pending product follow-ups remain the permission-only spec invalidation, existing-run handover transition and clear Handover accepted acknowledgement. The missing Ready-recommendations bug is tracked separately. Publication remains user-directed.

The final cumulative Astra dispatch was initially rejected before launch twice, including a retry citing the earlier explicit full-payload authorization. The user renewed authorization with "export authorized"; the next dispatch ran and returned the complete clean assessment above. The rejected attempts made no reviewer calls. The prepared payload excluded credentials and unrelated host configuration and used the configured Codex/OpenAI Astra destination. The approval interruption is historical, not a remaining gate or a failed native acceptance case.
