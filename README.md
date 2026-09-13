# Nightshift

Nightshift carries agreed project work through implementation, independent review, verification, documentation, session retrospective and follow-up triage. You decide what matters; the controller keeps the authorized work moving while you are away.

Its priorities are ordered: autonomy first, quality second, then speed and economy. The v3 workflow uses a strong controller and fresh independent reviewers. Fable and Astra are interchangeable; using both is an optional advantage.

**Status:** Nightshift 3.0.12 is in development, clarifying activation and completion of the self-hosting lifecycle. Version 3.0.11 is published on `main`. [Ready presentation probes](.nightshift/reports/ready-exploring-presentation-20260912.md) record the earlier Ready skill verification. The release gate accepts both candidate and published status wording while requiring the status version to match the manifests. The [acceptance report](.nightshift/reports/v3-acceptance-272m-20260910.md) records the v3 MVP evidence and its qualifications. See [VISION.md](VISION.md), [WORKFLOW.md](WORKFLOW.md) and the [v3 feature](.nightshift/features/nightshift-v3.md) for the supported scope.

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

Native persistent goals are the preferred continuation mechanism. Before unattended work, establish that the actual host's continuation and trusted hooks work. Stop reminders resist premature yields in unattended mode and bound repeated reminders without recorded progress; exhaustion is an incomplete recovery result, never successful completion. A run whose only remaining blockers are user decisions may pause to ask, and a running dispatch is awaited inside the turn with the runtime wait operation. Attended runs may yield for conversation.

One run owns a checkout. Existing workers and legacy run state must be reconciled before a competing run or migration starts. Automatic host relaunch after a crash, reboot recovery, simultaneous independent runs in one checkout, and active control transfer between hosts are deferred.

## Project files

Nightshift uses `.nightshift/` at the project root. The four indexes are `FEATURES.md`, `BUGS.md`, `QUICK_WINS.md` and `PATTERNS.md`, with breakouts and history beside them. The ready parser resolves declared dependencies and diagnoses structural problems. Drafts under `Exploring` are presented separately.

Setup inspects legacy `.claude` content, preserves staged and working bytes and existing tracking choices, and resumes interrupted migration from its saved journal. Shared plans and specs require explicit ownership decisions. Unrelated host configuration stays in place, and existing plans are preserved. Runtime records are ignored by default. Bulk rewriting of legacy instructions and general backlog structural repair are outside this candidate.

The source backlog's v2 decisions are preserved in the [migration ledger](.nightshift/MIGRATION_STATUS.md) and [archived indexes](.nightshift/migration/v2/FEATURES.md). Consolidating an entry there does not claim its need has been delivered.

## Installation and prerequisites

The supported target is Windows with Node.js 22.23 or later, Git, PowerShell 7, and a native Claude Code or Codex executable. The current review inventory supports regular singly linked project files; linked files and submodule directories produce an explicit prerequisite diagnosis. Other operating systems and command-shim-only host installations are not yet verified.

Claude Code marketplace installation:

```text
/plugin marketplace add astenlund/nightshift
/plugin install nightshift@astenlund
```

These commands install the published release. Local checkout changes require a separate candidate installation. Codex packaging is included under `.codex-plugin`; isolated installation and update checks passed on both Windows hosts. The v3 implementation has no Superpowers dependency.

## Development

Runtime operations and their input contracts are documented in [internal/runtime/REFERENCE.md](internal/runtime/REFERENCE.md). Shared controller guidance lives in [internal/workflow.md](internal/workflow.md).

Run checks relevant to the changed component, for example:

```text
node --test tests/runtime-regressions.test.js tests/runtime-hooks.test.js
node --test tests/runtime-review.test.js tests/runtime-probes.test.js
node --test tests/runtime-hosts.test.js tests/setup.test.js
node skills/ready/ready.test.js
node skills/init-backlog/unwrap.test.js
```

These are deterministic fixtures, including real process-containment checks on Windows. They do not substitute for installed-model acceptance. Real-model campaigns require an explicit aggregate token budget, native usage accounting and recorded outcomes, including genuine compaction with unfinished obligations on both hosts.

## License

MIT
