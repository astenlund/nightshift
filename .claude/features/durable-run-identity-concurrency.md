# Durable run identity and concurrency protection

Feature: give each Nightshift run a durable identity and a scoped scratch home, and protect concurrent same-scope runs from silently overwriting each other. This file is the authoritative design record.

## What it does

Today the revision engine and handover write to a fixed set of flat scratch paths (`.tmp/revise-state.md`, `.tmp/revise-round-result.md`, `.tmp/revise-payload-{hex-cell-id}.md`, `.tmp/review-diff.patch`, `.tmp/handover-followups.md`, `.tmp/handover-queue.md`). These are unsafe in three situations:

- two Claude sessions run in the same working tree;
- stale state survives from an earlier artifact;
- a process resumes after context loss.

This feature scopes all scratch state under a per-run directory keyed by a hash of the run's durable identity, persists that identity so a resumed run can *prove* the state it adopts belongs to the same work, and adds a heartbeat-lease lock so a genuinely live concurrent run is surfaced rather than silently clobbered. It reverses the current `internal/revise/SKILL.md` invariant, "The state file marks the single active run. Do not add an ownership token or lock."

A run's complete scratch home is one directory:

```text
.tmp/nightshift/<scope-hash>/
    revise-state.md
    revise-round-result.md
    revise-payload-{hex-cell-id}.md
    review-diff.patch
    handover-followups.md
    handover-queue.md
```

The set is exactly the current flat scratch files, relocated unchanged. No new scratch file is introduced and none is renamed: `handover-followups.md` and `handover-queue.md` keep their names under the scoped directory (the proposal's aspirational `handover-state.json` / `followups.md` names described a redesigned handover state that does not exist today, so they are not part of a relocation-only change).

## The durable run identity

Every run carries a frozen **identity block** captured at run creation and persisted inside the run's state. The block is the same set of fields the reviewer machinery already determines at start-up, restated as an identity so it can be compared on resume:

- artifact path/type;
- the resolved review scope (code base range / path set, or the single plan/spec artifact path);
- base commit/SHA where applicable;
- artifact fingerprint;
- the durable provenance stamp (8-character) where the artifact carries one.

The identity block is captured once and never mutated during the run; it is the ground truth against which a returning run compares. It deliberately excludes *mutable* run fields (current round, applicable cells, per-cell state and certifications, verifier counters and stamp), which live in the state body and legitimately change. An earlier candidate list mixed the two; splitting them is what makes the check meaningful: identity must be stable to prove "same work," while round and cell state is exactly what resumes.

### The scope hash

`<scope-hash>` is a lowercase-hex SHA-256 over the canonical identity block, deterministically derived. It is what makes concurrency and resume both resolvable:

- the same work always resolves to the same directory, so a resume lands on its own state;
- different work resolves to a different directory, so unrelated runs never collide at the file level even in the same working tree.

The raw artifact path is not used as the directory name: paths contain `/`, spaces, and Markdown metacharacters, and the existing payload machinery already solves this with lowercase-UTF-8-hex encoding. The scope hash follows the same portability discipline and is injective on case-sensitive and case-insensitive filesystems.

## The start-of-session boundary check

The identity/liveness check runs at **session start**, which is a boundary where the user is present and autonomy has not yet been engaged. Autonomous handover is a mode *chosen at* that start moment; it does not predate it. So the check is always answerable by a user and needs no separate mid-flight autonomous protocol. If a user has explicitly requested the run proceed unattended and a live conflict still turns up, that is a hard stop requiring disposition (a conflict is a judgment call that pauses even a self-authorized autonomous drive); it is never silently suppressed, because the user must remain aware of concurrent sessions on the same project.

At start-up the controller resolves `<scope-hash>`, reads any state present there, and classifies it:

| Found state | Identity matches? | Producer heartbeat | Verdict |
|---|---|---|---|
| none | - | - | fresh run; acquire lock; proceed |
| present | yes | **stale** | **resume**; adopt and reclaim lock |
| present | yes | **fresh** | **live concurrent run**; refuse (see below) |
| present | **no** | - | **foreign/stale**; interactive asks, autonomous fails closed |

### Foreign/stale: identity mismatch

If the state at the resolved scope-hash carries a different identity block than the current run, it belongs to different work that happens to hash-collide (or to a misberived hash). Previous SKILL.md behavior was "surface unfinished state for different work instead of overwriting it." This is preserved and made machine-checkable: interactive mode asks the user (resume / abandon / restart); autonomous handover fails closed and never overwrites the foreign state.

### Live concurrent run: heartbeats, not PIDs

A fresh-session **resume** and a genuinely **concurrent second run** present identically at start-up: both find a state file at the resolved scope-hash with a *matching* identity block. The lock file cannot be the discriminator: if it refused whenever a lock was held, it would block resume (the designed context-loss recovery path) every time. The discriminator is **liveness of the producing run**.

The Nightshift controller is agent-side, not a single OS process: it spawns shells, runs Workflow agents, and resumes across sessions, so there is **no stable PID to probe**. Liveness is instead inferred from a **heartbeat**: every state transition (Start round, round boundary write, checkpoint, post-review step) bumps a `last activity` timestamp in the state file, alongside the existing boundary writes.

At the start-of-session check, a matching-identity state whose heartbeat is *fresher than the grace window* means a live producer is actively advancing this scope -> a genuinely concurrent run -> the controller **refuses to proceed** and **presents the decision to the user**:

- **abort** (default): this new run stops without touching the live run's state;
- **force-break**: the user explicitly claims the scope and takes over, discarding the live run's lock and adopting (or abandoning) its state as they choose.

A matching-identity state whose heartbeat is *older than the grace window* means the producing run died or lost context -> **resume**, adopting the state and reclaiming the lock.

The accepted limitation is stated plainly: for an agent-side controller, "liveness" is inferred from state advancement within a grace window, not a true process-alive check. A genuinely long-lived run that sits idle at one boundary for longer than the grace window could have its state re-adopted. The grace window is therefore set generously, well past any single round's expected duration, so this is a rare deliberate edge rather than the common case. The force-break path is how a user resolves the rare genuinely-colliding case.

## Lock vs. heartbeat separation

Two concerns are kept distinct rather than conflated:

- **Lock** answers "is this scope actively worked?"; it guards *acquisition* at start-up.
- **Heartbeat** answers "is the state's producer live or dead?"; it decides *resume vs concurrent*.

The scope-hash directory already guarantees different runs never collide at the file level; the lock's only real job is detecting two concurrent same-scope runs, which the heartbeat then classifies. Because concurrent same-scope runs share an identity, the identity check cannot disambiguate them: the heartbeat is what does.

## Integration

- Create the `.tmp/nightshift/` root and a scoped directory per run at first scratch write; derive `<scope-hash>` from the canonical identity block before any state file is written.
- Relocate every existing flat scratch path (`revise-state.md`, `revise-round-result.md`, `revise-payload-{hex-cell-id}.md`, `review-diff.patch`, `handover-followups.md`, `handover-queue.md`) under the scoped directory. This is a path relocation only; it does not change the Markdown state schema, the `*.next` atomic-rename staging convention, or the hex-encoded payload filenames.
- Persist the identity block with the state (same canonical JSON-scalar discipline as other arbitrary-text scalars) and refresh the heartbeat timestamp on every boundary write.
- Run the start-of-session classification before treating any existing state as a resume candidate; everything in `internal/revise/SKILL.md`'s resume, drift, and recovery machinery then keys off the classification already made.

### Handover queue persistence binding

Queue transitions receive an opaque validated persistence binding rather than reopening `.tmp/handover-queue.md` by path. The binding owns the fixed queue path under the scoped scratch home, records its stable physical identity, verifies that Git treats it as ignored and untracked, requires a single-link file, and performs stable reads. A write compares the current durable bytes and identity with the binding before replacement, publishes through atomic replacement, and verifies the readback. Missing, stale, multiply linked, newly tracked, or identity-changed state refuses mutation and returns to controller recovery instead of letting pure queue transitions select a new authority.

The migration consumes queue protocol version 2 without resetting `implementationAuditBase`: `resumeQueue`, `bindImplementationAuditBase`, and `advanceQueue` move to the opaque binding together, the current direct `evidence` and `sourceBuffer` parameters plus caller-owned capture/replacement/readback retire together, and the field's null-to-full bind, preservation, idempotency, and restart/dead invalidation semantics remain unchanged.

## Status

Draft proposal; not yet designed as a buildable skill change or spec. Partially designed in the backlog migration (scope-hash layout, identity block split, heartbeat-lease liveness, start-boundary check) on 2026-08-11; the remaining design is to be hardened before planning. The shipped review behavior it protects is present, but the already in-flight universal-skill MVP must first establish its final engine path.

## Requirements

- The review engine's round and convergence state, atomic checkpointing, and resume machinery (shipped; this feature relocates and guards them, it does not redesign them).
- The artifact identity, resolved-scope, base-SHA, and fingerprint fields the controller already determines at start-up (shipped).

Landing order: the wave-convergence lifecycle (wave-lifecycle.md) shipped 2026-08-14 in the 2.2.0 batch; SKILL.md's lifecycle sections are wave-era prose. Derive lifecycle-touching edits from that prose.

## Hardening

- (None yet; this file has not been through a revise-spec run.)
