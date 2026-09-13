# Features

Upcoming work and deferred extensions to the delivered v3 MVP. Its delivery is recorded in [FEATURES_HISTORY.md](FEATURES_HISTORY.md). The original v2 proposals and their agreed dispositions are preserved in [MIGRATION_STATUS.md](MIGRATION_STATUS.md) and [the historical index](migration/v2/FEATURES.md). Readiness is not implementation authority.

## Current work

No active feature deliveries.

## Exploring

### [Project inboxes](features/project-inboxes.md)

Give every Nightshift project a `.nightshift/inbox/` for suggestions and reports about that project. `init-backlog` creates it, and `ready` lists untriaged reports separately from actionable work. Reports about Nightshift itself continue to belong in Nightshift's maintainer inbox.

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

### [Initial reviewer selection](features/initial-reviewer-selection.md)

Policy for the initial spec/code lead: Fable or Astra only, prefer the other host, preserve the author or implementer effort floor, and use hard when effort is unknown. Strong same-host fallback takes precedence over a weaker cross-host reviewer. Additional enforcement style, if any, remains open.

### [Structured model teams](features/structured-model-teams.md)

Later deliberate model-role arrangements. The MVP uses task-fit preferences and controller judgment, with interchangeable strong roles and equivalent-strength cross-host review when suitable.

### [Interactive Codex and Claude Code collaboration](features/interactive-session-collaboration.md)

Later pairing of visible interactive sessions, including optional Windows Terminal pane launch/reuse and user steering of both. No interactive bridge is required by the MVP.

## History

Delivered features belong in [FEATURES_HISTORY.md](FEATURES_HISTORY.md). When shipping an entry, remove its satisfied Requires references from active indexes; retirement is recorded separately.
