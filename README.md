# Nightshift

Nightshift carries agreed project work through implementation, independent review, verification, documentation, session retrospective and follow-up triage. You decide what matters; the controller keeps the authorized work moving while you are away.

Its priorities are ordered: autonomy first, quality second, then speed and economy. The v3 workflow uses a strong controller and fresh independent reviewers. Fable and Astra are interchangeable; using both is an optional advantage.

**Status:** Nightshift 3.2.10 is in development. A handover on Claude Code now runs unattended once the registered Stop hook is verified, since that host has no native goal and its models do not yield early, while Codex still needs a native goal, and the acknowledgement of such a handover is to say plainly that it is accepted; the [acceptance report](.nightshift/reports/unattended-stop-hook-20260926.md) qualifies the installed-host evidence, including the unverified Codex lane. In 3.2.9, Ready reports, as notices, backlog links and heading anchors that no longer resolve, active index entries whose title differs from the record they link, and backlog records that no index reaches, and the init-backlog templates spell the empty dependency line as `**Requires:** none.`, the form the parser accepts. In 3.2.8, a host process that Windows cannot start reports its executable, the launch stage that failed and, where Windows refused to create the process, the Windows error. In 3.2.7, a review dispatch whose attempts cannot fit the launcher's time bound is refused before any worker is reserved, every attempt, check and probe ends before that bound, a Codex reviewer stuck streaming whitespace is ended so its fallback can run, and a runtime request with a missing or unknown action is refused with the accepted actions. These build on 3.2.6, whose Stop hook stays silent after each reply in an attended run without a handover and which refuses a probe with an unresolvable executable or an out-of-range timeout before reserving a worker, and on 3.2.5, which resolves a bare executable name in runtime checks from PATH and names an assessment made stale by later edits, and on 3.2.4, which makes Ready recommend a small selection, turn a reply that names no items into a proposed selection to confirm, and continue agreed work in the current session without a handover or separate-task question; the [acceptance report](.nightshift/reports/ready-selection-boundary-20260924.md) records its installed-host evidence on both hosts. Version 3.2.3 added safe run adoption and reliable renewed continuation under the [agreed executive scope](.nightshift/specs/run-adoption-and-continuation-executive.md). Installed checks demonstrate the eight takeover combinations, preserved work and reports, renewed Codex goal continuation, and native Stop/admission recovery on both hosts. Both hosts also demonstrated unavailable-claim handling and unknown-controller refusal. The [acceptance report](.nightshift/reports/run-adoption-and-continuation-20260921.md) states the exact evidence and remaining native limitations; the [technical design](.nightshift/specs/run-adoption-and-continuation.md) preserves the compatibility contract. This builds on 3.2.2 and its [recoverable setup and unwrap](.nightshift/reports/recoverable-unwrap-20260921.md). Earlier [handover](.nightshift/reports/handover-transition-and-morning-report-20260919.md), [retained-release](.nightshift/reports/retained-plugin-releases-20260914.md) and [v3 MVP](.nightshift/reports/v3-acceptance-272m-20260910.md) reports preserve their evidence and qualifications. See [VISION.md](VISION.md), [WORKFLOW.md](WORKFLOW.md) and the [v3 feature](.nightshift/features/nightshift-v3.md) for supported scope.

## Workflow

1. Investigate the request and confirm consequential behavior with a short "did I understand this correctly" readback. Substantial work gets a concise governing spec; independent spec assessment can run alongside the user's review.
2. Implement directly from accepted commitments. An implementation plan is optional when delegation to a less capable worker makes it useful.
3. Have a fresh strong agent assess the cumulative change and surrounding code. Every finding goes to an independent skeptic, then the controller separates factual validity, repair authority and practical value.
4. Apply worthwhile authorized repairs, run meaningful checks, and repeat the full cumulative assessment. Every repair needs another review, including tiny fixes. A credible broad assessment with no remaining repair does not need an extra pass solely to produce LGTM.
5. Update documentation and backlog, perform the session retrospective, then present follow-ups one at a time. Unanswered follow-ups stay saved. A missing user decision blocks dependent work while authorized independent work continues.

Publication needs explicit authority. A local handover does not authorize a push, release or deployment.

## Public skills

| Skill | Purpose |
| --- | --- |
| `handover` | Carry an authorized finite queue through the remaining lifecycle |
| `revise-code` | Apply the Nightshift review, repair and closing workflow to code |
| `revise-spec` | Assess and strengthen a governing spec without routine implementation planning |
| `revise-docs` | Reconcile documentation with delivered behavior |
| `revise-lore` | Perform the session retrospective and propose durable instruction improvements |
| `ready` | Resolve the backlog dependency graph and suggest available work |
| `exploring` | Present unfinished drafts separately from ready work |
| `init-backlog` | Initialize or migrate the project backlog |

Claude Code exposes these as `/nightshift:<skill>`. Other hosts can invoke the installed skill by name. Ordinary "review" and "review-loop" requests are not plugin triggers; "revise" requests the Nightshift machinery. Neither backlog readiness nor a reviewer finding grants implementation authority.

## Independent review

One strong reviewer can cover a small change. All code reviews consider requirements and UX, correctness and integration, security and data safety, design and maintainability, performance and resources, and tests and evidence. Specs use four lenses: intent and acceptance; soundness and integration; failure, safety and recovery; and clarity, consistency and proportionality. The reviewer decides where depth is needed rather than relying on the author's prediction of relevant dimensions.

For demanding work, a review lead can use peers with the same model and effort. Only a strong agent with credible broad coverage can clear the gate. An equivalent-strength reviewer on the other host is preferred when it adds independence; same-host review remains valid. Model selection stays with the controller unless the user requires a particular model.

Reviewers receive immutable copies and read-only host access. When a deciding claim needs execution, they can propose a bounded probe for the controller to inspect and authorize. Probe execution uses controller privileges in a separate working copy, which is not a security sandbox. The command's full effects must fit the authorized verification scope.

## Continuation and recovery

The runtime saves accepted commitments, task dependencies, ownership, findings, evidence and follow-ups in a transactional local database. Focused hook context restores outstanding obligations after compaction. The controller reconciles saved state with actual files at workflow boundaries and after recovery.

The continuation mechanism depends on the host: Codex needs a native persistent goal, because its models tend to yield their turn early, while on Claude Code, which has no native goal, the registered Stop hook carries unattended work once it is verified as enabled, trusted and active in the controller's session. The controller observes current continuation and host integration at handover and recovery boundaries. Handing over an existing run records the handover in place; a verified mechanism permits unattended mode. Without one, an attended run records the handover and its reporting duty while remaining attended. Losing continuation requires explicit invalidation of stale verification, preserving the work and handover. Unavailable admission is diagnosed rather than bypassed or silently restored.

A handed-over run owes a morning report that stands on its own: the runtime requires it before completion, records delivery from your actual reply, and reminds the current owner while the report is undelivered or a follow-up remains. A functioning Stop hook protects a running handed-over run even after downgrade to attended mode; it does not itself restore a native goal. Three reminders without progress end in an incomplete recovery result. Explicit stops and limits take precedence, and a user-decision-only pause is permitted when no actionable work or active worker remains. Running dispatches are awaited inside the turn. Attended runs without handover may yield for conversation.

One run owns a checkout. Under your direction, a compatible unfinished run may be adopted after workers and operations are confirmed inactive; a running source also requires proof that its claimed controller process has ended. Adoption preserves work and leaves the new owner stopped and attended until reconciliation and explicit resumption. Engineering requires a fresh successful native controller claim. Existing workers and legacy state must be reconciled before a competing run or migration starts. Automatic host relaunch after a crash or reboot, simultaneous independent runs in one checkout, and active control transfer remain deferred.

## Project files

Nightshift uses `.nightshift/` at the project root. The four indexes are `FEATURES.md`, `BUGS.md`, `QUICK_WINS.md` and `PATTERNS.md`, with breakouts and history beside them. The ready parser resolves declared dependencies and diagnoses structural problems. Drafts under `Exploring` are presented separately.

Setup inspects legacy `.claude` content, preserves staged and working bytes and existing tracking choices, and resumes interrupted migration from its saved journal. Shared plans and specs require explicit ownership decisions. Unrelated host configuration stays in place, and existing plans are preserved. Runtime records are ignored by default. Bulk rewriting of legacy instructions and general backlog structural repair are outside the supported setup scope.

The source backlog's v2 decisions are preserved in the [migration ledger](.nightshift/MIGRATION_STATUS.md) and [archived indexes](.nightshift/migration/v2/FEATURES.md). Consolidating an entry there does not claim its need has been delivered.

## Installation and prerequisites

The supported target is Windows with Node.js 22.23 or later, Git, PowerShell 7, and a native Claude Code or Codex executable. Preparation asks the host for its effective settings through the `--safe-mode` control channel on Claude Code and the app-server API on Codex; the verified baselines are Claude Code 2.1.268 and Codex CLI 0.154.0, and an older host that lacks these surfaces fails closed with a native-host diagnosis whose recovery is a host update. The current review inventory supports regular singly linked project files; linked files and submodule directories produce an explicit prerequisite diagnosis. Other operating systems and command-shim-only host installations are not yet verified.

Claude Code marketplace installation:

```text
/plugin marketplace add astenlund/nightshift
/plugin install nightshift@astenlund
```

These commands install the published release. Local checkout changes require a separate candidate installation. Codex packaging is included under `.codex-plugin`; isolated installation and update checks passed on both Windows hosts. The v3 implementation has no Superpowers dependency.

From version 3.1.1, invoking a skill prepares Nightshift automatically. Ready and Exploring can list work before background continuation is enabled. When another operation needs host approval or a reopened session, Nightshift explains the specific action required. See [the retained resource interface](internal/releases/REFERENCE.md) for technical preparation details, native trust and activation, updates and removal. Setup preserves unrelated host hooks and retains complete manifest-verified releases outside the plugin cache. Existing sessions and resumable runs keep their exact release; new sessions can capture the updated enabled installation. Plugin uninstall does not remove these user hooks automatically: use the retained launcher removal operation. The 3.1.0 independent assessment and installed-model acceptance are recorded in its acceptance report. The [3.1.1 acceptance report](.nightshift/reports/automatic-plugin-preparation-20260915.md) records the assessments and checks, the confirmed hook-disabling defect found after them, its repair, and the clean cumulative strong assessment that preceded publication. Deterministic and zero-inference checks remain distinct from model-owned observations.

## Development

Runtime operations and their input contracts are documented in [internal/runtime/REFERENCE.md](internal/runtime/REFERENCE.md). Shared controller guidance lives in [internal/workflow.md](internal/workflow.md).

Run checks relevant to the changed component, for example:

```text
node --test tests/runtime-regressions.test.js tests/runtime-hooks.test.js
node --test tests/runtime-review.test.js tests/runtime-probes.test.js
node --test tests/runtime-hosts.test.js tests/setup.test.js
node skills/ready/ready.test.js
node skills/init-backlog/unwrap.test.js
node --test tests/unwrap-recovery.test.js
```

When issuing these checkout tests through a bound installed runtime `check`, select `check.resourceMode: "development"`; genuine installed-helper checks keep the default `inherit` mode. These are deterministic fixtures, including real process-containment checks on Windows. They do not substitute for installed-model acceptance. Real-model campaigns require an explicit aggregate token budget, native usage accounting and recorded outcomes, including genuine compaction with unfinished obligations on both hosts.

## License

MIT
