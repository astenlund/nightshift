# Features

The active v3 work and its deferred extensions. The original v2 proposals and their agreed dispositions are preserved in [MIGRATION_STATUS.md](MIGRATION_STATUS.md) and [the historical index](migration/v2/FEATURES.md). Readiness is not implementation authority.

## Current work

### [Nightshift v3](features/nightshift-v3.md)

Implementation is complete locally under the agreed vision and workflow. Required Windows acceptance is complete. The [acceptance report](reports/v3-acceptance-272m-20260910.md) records completed verification and its qualifications. Publication remains pending; this entry does not claim a shipped release.

**Requires:** none.

## Exploring

### [Orchestration efficiency](features/orchestration-efficiency.md)

Post-MVP investigation of measured controller overhead: repeated context reads, polling, bookkeeping and mechanical tool round trips. Preserve autonomy, independent review, skeptical validation and cumulative review after fixes; verify actual time and cost improvements before claiming savings.

### [Night Guard](features/night-guard.md)

Post-MVP reboot watchdog for multiple active agent sessions. Persist recovery state continuously, use the seconds-long shutdown window for bounded stop/flush coordination, and recover from saved state even when a session receives no warning or cannot acknowledge it.

### [Native event validation](features/native-event-validation.md)

Post-MVP exploration of consistent handling for assistant messages missing model metadata and other malformed native evidence. Preserve required-model and independent-review guarantees while distinguishing legitimate event shapes and maintaining reliable recovery.

### [V3 continuations](features/v3-continuations.md)

Retained capabilities outside the first release: additional platform verification, active-controller transfer, independent overlapping runs, restart/relaunch automation, and broader legacy-guidance conversion or structural repair. The migration ledger preserves all other retained needs for evidence-based follow-up.

### [Incremental revise finding delivery](features/incremental-revise-finding-delivery.md)

Deferred beyond the MVP. Streaming could overlap validation with the remaining review, while preserving corrections, withdrawal, attribution and input stability. Completed reports remain the baseline.

### [Review-run command enforcement](features/review-run-command-enforcement.md)

Deferred exploration of stronger enforcement for explicit command restrictions. Existing restrictions remain binding; no general protected-shell mode is claimed.

### [Structured model teams](features/structured-model-teams.md)

Later deliberate model-role arrangements. The MVP uses task-fit preferences and controller judgment, with interchangeable strong roles and equivalent-strength cross-host review when suitable.

### [Interactive Codex and Claude Code collaboration](features/interactive-session-collaboration.md)

Later pairing of visible interactive sessions, including optional Windows Terminal pane launch/reuse and user steering of both. No interactive bridge is required by the MVP.

## History

Delivered features belong in [FEATURES_HISTORY.md](FEATURES_HISTORY.md). When shipping an entry, remove its satisfied Requires references from active indexes; retirement is recorded separately.
