# Maintainer inbox triage, 2026-09-21

The user reviewed four reports individually in Codex session `01a0c16c-8778-7a20-9e72-0da0148879f8`. Every disposition below was explicitly agreed. This report preserves the decisions and evidence needed by the destination entries; the original reports were retained under the ignored `.nightshift/inbox/triaged` directory until their deletion on 2026-09-24. These are tracking decisions, not implementation or publication authority.

## Migration leaves root backlog references unchanged

Disposition: add the incident as concrete evidence and an acceptance case to [Restore setup guidance discovery and instruction routing](../features/v3-guidance-routing.md). The user replied "agree" to that recommendation.

Source: `2026-09-21-featherpod-migration-root-references.md`, reporting nightshift:init-backlog 3.2.1 in `C:/Git/FeatherPod-Private`, session `01a0c33a-c35d-70b0-839a-34746f7f6e02`. Setup inspect reported no referenceDecisions. Apply moved 42 tracked backlog files from .claude to .nightshift and reported complete, with no parser errors or notices after unwrapping. AGENTS.md remained unchanged, retaining old paths to indexes, histories and feature/bug/pattern directories. CLAUDE.md contained only @AGENTS.md; both files were ordinary tracked, non-ignored files. A later scoped repair updated the references.

The source report records old paths at AGENTS.md lines 6-8, 171, 180-181, 190-193 and 198-200 immediately after apply, with no root instruction changes in the diff. The migration journal remains in the source project's .nightshift/setup/journal.sqlite. Ready returned 52 ready and 8 blocked entries. The reported whitespace-normalized comparison preserved content across all 42 files, allowing path relocation and a duplicate Requires line removed before migration; no backlog content loss was reported.

Triage confirmed that current setup code unconditionally excludes root instruction files, while skill guidance distinguishes mechanical authorized references from broader instruction edits. The original invocation was not replayed. Acceptance should cover the canonical instruction source, import adapter, relocated paths and honest reporting of unresolved references.

## Unwrapping collapses lettered workflow steps

Disposition: track the incident under [Restore customized backlog and legacy-guidance repair](../features/v3-setup-compatibility.md), cross-linked to [shared parser consistency](../features/v3-parser-consistency.md). The user proposed converting a simple a./b./c. list into `a) foo, b) bar, c) baz`, then replied "yes" to the readback: compact simple lettered lists and preserve hierarchy when items contain nested content.

Source: `2026-09-21-featherpod-unwrap-workflow-steps.md`, reporting nightshift:init-backlog with unwrap enabled, installed 3.2.1, in the same FeatherPod project and session. The Flow section of .claude/features/youtube-import.md contained indented a. through h. lines under an outer numbered Background task item. The Create episode step contained four metadata bullets. Unwrap joined a. through e. into the Background task line and f. through h. into the UploadSource metadata bullet. An independent reviewer noticed that the words survived but workflow grouping became misleading. Ready reported no errors or notices, and whitespace-normalized preservation checks passed.

Original bytes are identified by commit `5a7019add4d685fd5c236105c634c9bbbe04adf4` and path `.claude/features/youtube-import.md`, Flow section. The combined output appeared at .nightshift/features/youtube-import.md lines 55 and 59. The local repair used eight numbered substeps, retaining metadata beneath episode creation. Those historical locations identify the evidence, not current line positions. The input letter markers were not standard Markdown ordered-list syntax; supported-syntax classification remains unsettled, and triage did not replay the transformation.

The selected flat-list outcome is:

```text
a. foo
b. bar
c. baz
```

```text
a) foo, b) bar, c) baz
```

Nested content must retain hierarchy rather than being flattened into a preceding metadata bullet. Recognition and ambiguous marker-like prose remain design questions within that agreed outcome.

## Ready selection prompts an unnecessary separate-task choice

Disposition: merge the incident into the existing quick win and rename it [Continue agreed Ready work in the current session](../QUICK_WINS_HISTORY.md). The user replied "agree" to the merge and rename, preserving the distinction between agreeing scope and explicitly handing work over.

Source: `2026-09-21-ready-selection-unnecessary-separate-task-question.md`, reporting Ready selection of Paused strong gate pauses repair application in this repository and session, installed and bound 3.2.0. After investigation and readback, the controller asked whether work should occur in the current task or a separate task. The user had not requested a new conversation, asked what that meant, then chose to continue here and questioned whether the option was improvised. No separate task was created and implementation had not yet begun.

The Ready skill did not require a separate-task choice. The controller had seen the older quick-win title and said it confused execution-context settlement with opening another conversation. That causal account remains the controller's hypothesis. The observed defect is the unnecessary decision and clarification exchange, not an established runtime fault.

The tracked outcome is ordinary implementation in the current session after selection and agreed scope, with investigation/readback still preceding agreement. Handover and a new conversation remain explicit user directions, not questions automatically appended to a readback.

## Ready omits the init-backlog recovery suggestion

Disposition: add this incident and the required recovery suggestion to [Exploring and Ready omit explicit parser problem reporting requirements](../bugs/exploring-parser-diagnostics.md). The user replied "agree": when Ready identifies a setup or migration prerequisite, name and offer the relevant skill.

Source: `2026-09-21-ready-suggest-init-backlog-01a0c324.md`, reporting Codex desktop with installed 3.2.1 in `C:/Git/disco-elysium-companion`, task `01a0c324-2a98-7940-8c22-728158b8aa4e`. The four indexes existed under .claude and there was no .nightshift backlog. Ready exited 1 with a diagnostic naming nightshift:init-backlog, but its response only described the layout incompatibility and offered to investigate migration. The user then invoked init-backlog, which inspected a valid legacy backlog and completed migration.

The user requested that Ready offer or at least suggest init-backlog. The omission was in the user-facing response; the parser already supplied the recovery action. Whether skill wording contributed remains unverified. Verify the legacy-layout response and unrelated parser failures on both installed hosts without treating this single report as cross-host evidence.
