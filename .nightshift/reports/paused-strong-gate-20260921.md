# Paused strong review gate verification

Date: 2026-09-21. Candidate: Nightshift 3.2.1. Governing agreement: the user selected "Paused strong gate pauses repair application", approved the scoped readback, directed continuing in the same task, granted 1,000,000 aggregate tokens for live testing and handed over. Runtime run: `45cf8a48-096b-4e2b-9425-76541b971dbd`. Base: `97ba1e57e5f8a31a067e06f38723cd92817c7368`. Publication is not authorized.

## Change and evidence boundary

The Model roles and ownership and Review and repair sections of `internal/workflow.md` now require a permitted strong reviewer to be secured before further repairs when the original reviewer becomes unavailable. Otherwise affected repairs pause while independent authorized work continues. Advisory assessment does not supply the required strong review coverage. Existing explicit-model restrictions, independent assessment, skeptical validation and full cumulative reassessment remain in force.

These are controlled next-decision probes using the exact brief bytes from candidate installations registered through each host's native plugin commands. Each native model received the complete installed brief and five separate checkpoint descriptions in one tool-free turn. The harness compared installed bytes with the working tree before inference. The probes establish how the models interpreted the changed guidance in these supplied contexts. They do not exercise native skill activation, runtime dispatch, actual file repair, real rate limits, recovery from provider failure or Stop-hook behavior. No such end-to-end claim is made. Independent implementation assessment and lifecycle closure are recorded separately by the runtime.

No pre-change control was run. The checkpoints explicitly supply the strong/advisory and assigned/unassigned distinctions, so passing answers do not establish a behavioral improvement over 3.2.0 or recall at action time. The controller verified the candidate's published baseline from the local `origin/main` ref at `97ba1e57e5f8a31a067e06f38723cd92817c7368`, whose plugin manifest records 3.2.0; this is not a claim that the remote was refreshed during these probes.

## Observations

| Checkpoint | Expected decision | Claude Code | Codex |
| --- | --- | --- | --- |
| Permitted other-host strong replacement available but unassigned | Secure replacement before applying repairs | Pass | Pass |
| Only an advisory reviewer available | Pause affected repairs; advisory read supplies no required coverage | Pass | Pass |
| User explicitly requires unavailable original model | Preserve restriction; do not assign another model without authority | Pass | Pass |
| Permitted strong replacement already secured | Allow the validated, authorized repair batch and require subsequent strong cumulative assessment | Pass | Pass |
| Earlier batch applied but lacks strong assessment | Preserve its unresolved review obligation and pause the next batch | Pass | Pass |

Both hosts allowed unrelated authorized work to continue in every checkpoint and retained the requirement for strong assessment of the full cumulative change after repairs. Their written reasons and required-next-review fields were read by the controller in addition to the boolean oracle. The oracle passed six deterministic tests, including mutation of every checked branch boolean, rejection of incomplete native evidence and rejection of duplicate checkpoint answers. Package integrity passed all six existing package tests. Checks recorded in the runtime are tied to current input hashes.

Claude Code 2.1.277 used `claude-fable-5-1`, session `abb83d77-953c-448e-8723-01364d13ccc7`. Codex CLI 0.155.1 used `gpt-6-astra`, session `01a0c18a-8f71-7912-adc4-d6f9dcba67fe`. Both native turns completed and Windows job cleanup was observed. Temporary copied authentication was removed after each probe.

## Accounting and reproducibility

The live-testing allowance is 1,000,000 tokens. The two completed probes used 14,264 Claude tokens and 18,644 Codex tokens, totaling 32,908. Native input and output are counted, including cached input once. There is no unresolved token reservation for these probes. Ordinary implementation review is separate from this live-testing campaign. Raw native events, prompts, results, decisions, installation metadata and the ledger remain under `.tmp/paused-gate-live/`; the runner and oracle tests are `.tmp/paused-gate-live.cjs` and `.tmp/paused-gate-live.test.cjs`. These local raw artifacts are ignored and are not distributed with the plugin.

SHA-256 evidence digest:

| Artifact | SHA-256 |
| --- | --- |
| Installed and working-tree `internal/workflow.md` | `a6150a17c70c621cfcd8d43a61a3d9c79d8631113213e498abd19c5cbb899d32` |
| `.tmp/paused-gate-live.cjs` | `b077d468956cf322ff4f428188a6c96ad05188c86392d51874ada5402fd7df6c` |
| `.tmp/paused-gate-live/claude-54552de1/probe/events.jsonl` | `c2a4e64d79839d9f992d5c55e99ae7bd4f3494c45b45946491d11e3435ec4a8a` |
| `.tmp/paused-gate-live/codex-dbb5dbe9/probe/events.jsonl` | `e031903daa54319b9c511922a3c306be6eb97b3f9a64be57d47cfb7ac37f68ae` |

Re-evaluate saved answers without inference using the saved result objects and `evaluate` exported by the runner, or run `node --test .tmp/paused-gate-live.test.cjs` from the repository root. Fresh live calls require a newly authorized or still-available campaign allowance, native host access and fresh isolated credentials. A passing oracle means the listed decision fields matched, not that the unexercised lifecycle operations succeeded.
