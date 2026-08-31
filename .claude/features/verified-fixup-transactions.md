# Verified fixup transactions

Feature: make every fixup created by Nightshift pass through one private, deterministic creation and autosquash-simulation transaction. This file is the authoritative design record.

## Goal

Nightshift currently tells revise-code to create round-boundary `fixup!` commits but leaves target selection, publication safety, and autosquash validation to the active controller. Long runs can therefore accumulate fixups aimed at published commits, umbrella commits that no longer own the changed lines, or other fixups, discovering the resulting conflict only at the final autosquash.

The feature moves fixup creation into executable Nightshift machinery. The MVP creates only a verified fixup commit and never rewrites live history. It simulates the complete pending autosquash in isolation and records evidence so a later slice can be promoted manually when the mechanism has proved reliable.

## Slices

### MVP: verified fixup creation

Every Nightshift lifecycle path that creates a fixup calls one internal transaction service. The service admits an exact accepted repair, proves a safe target, creates the candidate with normal repository hooks in an isolated worktree, simulates autosquash on a temporary ref, publishes the verified fixup as an ordinary fast-forward, and records promotion evidence. It never rebases or autosquashes the live branch.

### Checkpoint autosquash

After manual promotion based on accumulated MVP evidence, permit actual autosquash at safe Nightshift checkpoints, including revise-run and lifecycle completion. This slice adds immutable recovery refs, clean-state and no-agent-in-flight gates, atomic branch replacement, post-rewrite verification, and explicit adoption for externally owned fixups. No simulation count enables it automatically.

## Internal architecture

The service is private to the shared revise engine under `internal/revise/`. Revise-code and handover are its consumers; neither may invoke `git commit --fixup` directly after the MVP ships. It is not a public skill, command, Git alias, installed hook, or general-purpose wrapper.

Each request binds the repository root, current branch, captured HEAD, run identity, exact accepted repair patch, complete owned-file set, proposed target, automatic or controller-judgment selection mode, target rationale, and evidence destination. The response is one closed disposition with the transaction identity, relevant commit identities, and structured evidence.

The service resolves one trusted Git executable and reconstructs the Git environment rather than inheriting ambient `GIT_*` controls. History inspection and simulation ignore replacement objects and other ambient graph overrides. Candidate commit creation still uses the repository's normal configuration and hooks inside the isolated worktree. Repository hooks are a trusted boundary because arbitrary hook code can mutate shared refs, configuration, other worktrees, or external systems beyond the transaction's control. The service snapshots detectable shared-repository refs, local configuration, and worktree state around hook execution and refuses on drift, but it neither promises nor attempts to roll back arbitrary hook side effects. The no-live-mutation guarantee applies to service-owned Git operations; a repository that requires stronger isolation must disable or constrain its hooks before requesting a transaction.

The isolated worktree and temporary refs live in controller-owned scratch that is ignored and untracked. A missing or unsafe scratch policy blocks fixup creation rather than adding an ignore rule as an incidental mutation. The service verifies ordinary, nonlinked identities for its transaction state and owned artifacts before reuse or cleanup.

## Repair ownership

The accepted repair is an exact patch plus a complete repository-relative file set. Unrelated staged, unstaged, or untracked work may coexist only on disjoint files. Any repair-owned file carrying a staged or working-tree change outside the accepted patch is an ownership overlap and fails closed.

This MVP deliberately does not implement hunk-level preservation for mixed ownership within one file. The later disjoint-file lease machinery in [Adversarial repair dialogue](adversarial-repair-dialogue.md) can supply the same ownership boundary, but neither feature depends on the other.

The service fingerprints the accepted patch, the raw working bytes and index entries of every owned path, and the disjoint ambient state needed to prove preservation. It revalidates these facts immediately before live publication. A created, deleted, renamed, staged, or unstaged path outside the owned set must remain byte-identical and retain the same index state across the transaction.

## Target selection and unpublished proof

For replacements and deletions, the service maps every changed preimage line to the last commit that touched it. When all mapped lines resolve to one unpublished non-fixup commit, that commit is the deterministic target.

Pure insertions, mixed blame, and ambiguous context return target candidates to the controller. The controller may select one candidate with a recorded semantic rationale. Simulation verifies that the chosen fixup works mechanically; the rationale remains the audit record for why that commit owns the repair. Controller judgment cannot override any unpublishedness, ancestry, repository-state, or ownership guard. Zero safe candidates returns `standalone-required` when a normal commit remains possible and `blocked` otherwise.

When independently meaningful hunks resolve to different targets, the controller may repackage them as separately verifiable repairs. An atomic repair spanning targets becomes a standalone follow-up commit. Deferral remains a discouraged escape valve when an expected manual autosquash may collapse temporary target ambiguity: the controller improvises custody without a formal patch queue and must abandon deferral if it cannot prove that the repair remains current and recoverable.

A target must be an ancestor of captured HEAD, must not itself be a fixup, squash, or amend commit, and must be absent from every fetched published ref the service treats as authoritative. The request freezes the configured upstream and authoritative remote set. With a configured upstream, the service performs a fresh read-only fetch before admission. With no upstream but at least one configured remote, it fetches every explicitly authoritative remote; if it cannot resolve that set, fixup form is refused. Required fetches use `--no-write-fetch-head` and explicit refspecs into transaction-owned refs rather than updating ordinary remote-tracking refs. A repository with no configured remotes uses local refs as the complete publication boundary. If a required fetch fails, publishedness remains uncertain, or the refreshed refs show the branch behind or diverged, fixup form is refused and the controller may choose a standalone commit.

Immediately before live publication, after hooks and simulation, the service refreshes the same authoritative remote set again and rechecks target reachability, branch behind or divergence state, and every unpublishedness guard. A target that became published during the transaction is therefore refused before the service advances the branch.

## Candidate creation and simulation

The service materializes an isolated worktree at captured HEAD, applies only the accepted repair, and invokes normal `git commit --fixup=<target>` so repository commit hooks run. Hook failure refuses the transaction. Any hook-created file outside the owned set or any hook-induced difference from the accepted repair tree also refuses it.

Simulation runs plain autosquash without conflict-favoring strategy options over the complete unpublished rewrite range containing every pending fixup that could affect the result. It must complete without conflict, produce a tree exactly equal to the candidate fixup tree, and leave no fixup, squash, or amend marker in the simulated history. A command failure, undecidable range, tree mismatch, or residual marker is a refusal, never a clean result.

Pre-existing fixups participate in MVP simulation because they affect the real rewrite range. A fixup is Nightshift-owned only when a retained repo-scoped ownership record binds its commit identity to a completed Nightshift transaction; absent or invalid proof classifies it conservatively as external. The ignored and untracked ownership ledger lives outside run cleanup, is refreshed when a verified fixup is published, and is pruned only after the commit leaves unpublished branch history through an observed autosquash, adoption, or removal. Every run validates ledger entries against the repository and commit binding before use. Evidence labels external fixups and excludes them from Nightshift reliability counts. The Checkpoint autosquash slice refuses to rewrite a range containing any externally owned fixup unless the user explicitly adopts it into that transaction.

## Durable transaction lifecycle

Controller state owns a stable transaction identity and the following write-ahead lifecycle. The transaction's scratch artifacts are subordinate to that state rather than a second authority. Before every Git or evidence side effect, the controller durably records the intended identities and expected pre-state; after the side effect, it records the observed result.

1. `opened`: repository, branch, HEAD, authoritative remote policy, accepted patch fingerprint, owned files, proposed target, selection mode, rationale, and expected-absent transaction ref namespace are frozen before any Git side effect.
2. `admission-fetch-prepared`: the exact remote refspecs and expected transaction-owned destination refs are recorded before the admission fetch.
3. `admitted`: the fetched ref identities and admission checks are persisted. A repository with no configured remotes records that no fetch was required.
4. `candidate-prepared`: the expected-absent isolated worktree and candidate ref identities are recorded before either is created or hooks run.
5. `candidate-created`: hooks produced an exact candidate fixup on the recorded isolated ref. The live branch remains unchanged.
6. `simulation-prepared`: the temporary ref, rewrite range, candidate identity, and expected-absent simulation artifacts are recorded before simulation begins.
7. `simulated`: autosquash succeeded on the temporary ref, the simulated tree equals the candidate tree, and no marker remains. The live branch remains unchanged.
8. `refresh-prepared`: the exact final remote refspecs and a fresh expected-absent transaction-owned destination namespace are recorded before the final refresh.
9. `refreshed`: the final fetched ref identities and repeated unpublishedness, behind, and divergence checks are persisted.
10. `publish-prepared`: branch, ownership, ambient-state, and no-agent gates passed; the expected old branch ref and candidate ref are recorded before compare-and-swap.
11. `published`: the compare-and-swap advanced the live branch from the recorded old ref to the candidate child commit. This is a fast-forward, not a rewrite.
12. `reconcile-prepared`: the exact owned index entries before and after reconciliation are recorded before the index write.
13. `reconciled`: only owned index entries match the candidate tree; disjoint ambient working and index state remains byte-identical.
14. `terminal-cleanup-pending`: the terminal disposition, complete evidence, report-export intent, and exact temporary artifacts eligible for cleanup are persisted. The ownership binding is required only for `fixup-created` and is explicitly absent for every refusal disposition.
15. `completed`: all recorded temporary artifacts are absent, the report export passed readback, and any required ownership binding passed readback.

The compare-and-swap publishes only when the branch still names the recorded old ref and all final gates still match. Publication never proceeds while a repair agent or controller mutation touching an owned file remains in flight.

Recovery interprets each write-ahead state deterministically. In `admission-fetch-prepared` or `refresh-prepared`, absent destination refs permit retry, an exact complete fetched namespace permits validation and advancement, an exact partial namespace is cleaned before retry, and any foreign identity blocks. In `candidate-prepared` or `simulation-prepared`, absent artifacts permit retry, exact recorded artifacts permit validation and advancement or cleanup and retry, and any foreign identity blocks. In `publish-prepared`, a branch at the old ref reruns the final gates before retrying compare-and-swap, a branch at the exact candidate verifies the binding and advances the state to `published`, and any other ref blocks without rewind. In `reconcile-prepared`, all-old index entries permit retry, all-candidate entries permit advancement, and mixed or foreign entries block. In `terminal-cleanup-pending`, absent artifacts count as already removed, exact artifacts are removed or retried later, and identity drift blocks cleanup. A state record is never advanced merely because an expected artifact exists; its identity and content must match.

Any pre-publication state may transition to `terminal-cleanup-pending` with `split-required`, `standalone-required`, `defer-eligible`, or `blocked`; it records the refusal and cleans only exact transaction-owned residue without inventing an ownership binding. If owned working bytes no longer match after publication, recovery stops with the candidate commit preserved and reports the exact mismatch; it never rewinds the branch autonomously. Unknown, missing, contradictory, or identity-drifted state fails closed. A cleanup or report-export failure remains `terminal-cleanup-pending`, not `completed`, and retries later without invalidating a correctly published fixup.

## Closed dispositions

- `fixup-created`: every guard passed, simulation passed, and the verified fixup was fast-forwarded onto the live branch.
- `split-required`: independently meaningful hunks map to different targets; the result returns the hunk-to-target map.
- `standalone-required`: the repair is atomic across targets, the target is published or uncertain, fetch failed, or fixup form is otherwise unsafe while a normal commit remains possible.
- `defer-eligible`: an expected manual autosquash may remove temporary target ambiguity, and the controller accepts the discouraged custody burden. This is a recommendation, not persisted patch machinery.
- `blocked`: branch-behind state, overlapping file ownership, concurrent branch movement, contradictory recovery state, hook drift, or another condition where neither fixup nor safe fallback can proceed automatically.

The controller chooses among returned alternatives; the service never silently converts a refused fixup into a standalone commit or deferral.

## Simulation evidence and promotion

Every service request records the target and selection mode, controller rationale and blame candidates, upstream and fetch evidence, owned files and patch fingerprint, candidate and rewrite-range identities when created, hook result, conflict or refusal result, candidate and simulated tree hashes when available, residual-marker result, externally owned fixups, final disposition, recovery activity, and cleanup result. Requests refused before simulation remain first-class evidence rather than disappearing from promotion counts.

Each terminal disposition exports an immutable raw record from revise-owned state before revise cleanup. The lifecycle owner binds a stable repo-local inbox scope from canonical repository identity, lifecycle target scope, and run identity, then stores one file per transaction at `.tmp/nightshift-report/<scope-id>/fixup-evidence/<transaction-id>.json`. The directory and files must be ignored, untracked, ordinary single-link identities. Transaction IDs are unique within the scope and are the duplicate-suppression key.

Export writes the complete canonical record to an owner temporary, durably replaces an absent destination without clobber, reads back the exact bytes and identity, and only then checkpoints the export in transaction state. After a crash, an absent destination retries, an exact matching destination is an idempotent success, and a mismatching or aliased destination fails closed. At lifecycle entry, an inbox for the same incomplete scope resumes; a fully routed scope is removable; a foreign, stale, or unreported scope is never merged into the current summary or deleted without an explicit controller disposition. Handover or the attended controller retains each record through reporting, removes it only after the compact result has been durably routed and read back, and removes the scope directory only when it is empty and the lifecycle is complete.

The report distills records into successful simulations, safe refusals, controller-judgment cases, external-fixup cases, and recovery events. During a self-hosted Nightshift run, the report may append one compact entry below under `Promotion evidence`; a run in another repository routes the compact entry as a workflow-lore follow-up for the Nightshift feature rather than editing an installed plugin cache. Those compact records remain through the manual promotion decision; raw run evidence need not survive confirmed report consumption.

The exploratory [Controller-owned session experiment ledger](controller-owned-session-experiment-ledger.md) may later replace the run-local carrier. It does not block this MVP and cannot change this feature's evidence fields or manual promotion gate.

### Promotion evidence

No MVP simulation evidence recorded yet.

## Verification

The MVP ships with deterministic unit tests for target classification, closed dispositions, request and evidence validation, lifecycle transitions, and promotion summaries. Disposable-repository integration fixtures exercise real Git, hooks, worktrees, refs, indexes, upstreams, and autosquash on Windows.

The integration matrix covers unique unpublished targets; controller-selected ambiguous targets and zero-candidate fallback; split and standalone outcomes; published, uncertain, fetch-failed, branch-behind, and mid-transaction publication targets with and without upstreams; admission and final-refresh crashes with absent, partial, complete, and foreign transaction refs; hook success, failure, byte drift, and detectable shared-state mutation; exact preservation of disjoint staged, unstaged, and untracked work; same-file overlap refusal; retained, missing, invalid, and externally owned fixup provenance; autosquash conflict, tree mismatch, and residual markers; concurrent branch movement; every durable crash state and write-ahead resume branch; cleanup failure; report-inbox export crash, idempotent retry, collision, stale scope, and retention across revise cleanup; and LF and CRLF working-copy preservation.

Acceptance requires that no Nightshift path directly creates a fixup outside the service, the MVP contains no service-owned operation that rebases or autosquashes the live branch, a successful transaction leaves only the verified fixup commit while preserving disjoint ambient state, every refusal before publication leaves live history unchanged unless trusted repository hook code independently mutates it, and recovery is deterministic from every persisted state. All ten repository suites pass on Windows, and implementation includes the required plugin version increase.

POSIX live behavior remains unsupported and is not expanded by this feature.

## Anti-goals

- No public skill, command, installed hook, or general-purpose Git helper.
- No protection for fixups created manually outside Nightshift.
- No mixed repair and ambient ownership within one file.
- No exhaustive deferred-patch custody machinery.
- No autonomous live-history rewrite in the MVP.
- No automatic continuation promotion based on a success counter.
- No new POSIX live-support commitment.

## Status and requirements

Decision-complete backlog design; implementation and implementation planning are outside the filing session. The MVP has no active backlog dependency and can ship independently of Adversarial repair dialogue and Controller-owned session experiment ledger.

The Checkpoint autosquash continuation cannot ship until the MVP has produced enough real simulation, refusal, and recovery evidence for a manual promotion decision. Its detailed live-rewrite recovery contract is designed when that slice is selected, using the MVP evidence rather than assumptions.
