# Ready run-state live check

The unpublished 3.3.24 change implements [Ready run-state notices](../specs/ready-run-state.md): the Ready parser adds `runState` beside its backlog result, and the Ready skill presents open delivery runs, review contexts and run-store compaction in a section before the ready set. The user asked on 2026-11-01 for an installed-host check of that presentation and set no token limit.

## Method

Environment: Windows 11, Node v22.23.2, Claude Code 2.1.316 with `claude-opus-5-5` at high effort through `--print` with stream-json. The live harness used for [the carried-fixes check](carried-fixes-live-20261019.md), copied into this session's own scratch folder and adapted, staged the working-tree payload (payload manifest `329bec718eb6f7a64999d2e5409f8a7e04dce7a0f0a44e174315c6a3559a8c9e`) as the installed plugin in an isolated Claude Code profile, with a copy of the production credential. Codex was not checked.

The fixture project had a backlog built from the init-backlog templates with one quick win, checked with the Ready parser before any model use, and run stores built through the runtime's own handover and stop and then edited directly:

- the delivery store, at version 3, holding the current delivery, stopped by its owner with `user-stop`, whose controller is another, ended session and whose saved resources mark it release-bound, so that under the session's bound context Ready routes it to the adoption eligibility check;
- in the same store, an earlier stopped delivery that is not the current selection, stopped with `resource-limit`;
- a review store at version 2, padded past the 64 MiB compaction floor, holding one running, release-bound review context with no owner observation.

The single scenario sent `/nightshift:ready`.

## Results

| Case | Claude Code |
|------|-------------|
| A "Run state" section is presented before the ready set | Observed |
| Each record shows kind, short ID, objective, status, age and task counts, with stop kind and reason for the two stopped records and none for the running review | Observed |
| The current stopped delivery is offered for adoption under the user's authority | Observed |
| The non-current stopped delivery is shown with no pickup and the not-current reason | Observed |
| The review context without a usable owner claim is shown as possibly still active, with no pickup | Observed |
| The due review store is offered `compact-history`, blocked until the running review stops, with the 3.3.23 warning | Observed |
| The delivery store, not due, is not mentioned | Observed |
| The ready set, recommendation and closing question follow unchanged | Observed |

The section listed the current delivery with "I can adopt it into this session under your authority if you'd like to resume it", the earlier one with "Only the project's current unfinished delivery run can be adopted", and the review with "It may still be active: nothing shows whether the session controlling it is still running. If that session is still live, only that session can stop the review." The compaction paragraph named the review store's size, said it is blocked until review `0d74b1fe` stops, and warned that sessions bound to a release older than 3.3.23 cannot use the project afterwards. The recommendation kept the ready set separate from the adoption offer and closed by asking which item to take on, with the adoption offered separately.

## Deviations and limits

- Observed live were only the adopt offer, the `not-current` reason, the `controller-activity-unknown` reason and a due compaction offer blocked by named records. Every other branch was not observed live: the `present-report` offer, the `report-unrecorded`, `owned-by-this-session`, `no-retained-release`, `not-development`, `controller-not-inactive` and `worker-activity-unknown` reasons, an unavailable store, the `runState.error` case, a compaction offer whose blockers are unknown, a finish offer and a backup beside an uncompacted store. These rest on the deterministic tests in `tests/run-overview.test.js` and `skills/ready/ready.test.js`, with their presentation unverified. Codex presentation is unverified.
- The release-bound records' resources point at an existing directory with a placeholder registration and identity, so adoption itself was not attempted; the check covers Ready's presentation only.
- The payload checked predates two later review repairs in `internal/runtime/run-overview.js`: a row that fails the state check is reported as `run-overview-unavailable` instead of with the opener's code, and a completed delivery with no saved report gets `report-unrecorded` instead of a report offer; neither changes a branch observed here, and the Ready skill text checked is unchanged by them.
- Each case is one observation on one model.

## Usage

The check used 185,541 tokens in one settled attempt, counted by the harness as the sum of its messages' input, output, cache-read and cache-write counts.

## Evidence

Raw records are retained under `.tmp/f0649bb2-ready-live/claude-8a48c326/`. SHA-256 of the event log:

- `5c4b8ca9b6475fc53bf348e9ea5fdd51d5ba76afa7e0bc9cd80068580b366e60` `live-2026-11-01T12-01-59-551Z-s1-ready-run-state/events.jsonl`
