# Move deterministic init-backlog mechanics out of promptspace

Feature: `init-backlog` behavior with one objectively correct answer moves from prompt instructions into bundled code and static assets. Semantic judgments remain model-owned, every project write remains approval-bound, and the deterministic layer becomes inspectable, drift-safe, recoverable, and fixture-tested. This file is the authoritative design record.

## Outcome

`skills/init-backlog/SKILL.md` currently owns both semantic workflow and a large mechanical recipe for scaffold inventory, template reproduction, file creation, structural edits, unwrapping, version-control policy, and verification. Re-executing that recipe through model prose makes identical repository states depend on prompt interpretation.

This feature extracts the one-correct-answer portion into a bundled Node controller and normalized static assets. The skill becomes the semantic, approval, and presentation layer around the controller.

The boundary rule is:

> If there is one objectively correct answer, get it out of promptspace.

The controller owns mechanical facts, deterministic proposals, validation, effects, and recovery. The model owns concept coverage, ambiguity, semantic repairs, and the conversation with the user. The user owns approval and the fresh-scaffold choice for whether the non-plan backlog surface is tracked or ignored.

## Operating context

The controller is a local, user-invoked process in a public plugin. It operates on one repository root at a time under Node 22, with no network, service, telemetry, database, or daemon surface. It supports Claude Code and Codex on Windows, Git and non-Git repositories, LF and CRLF worktrees, and existing customized backlog installations. Windows is the sole supported live platform. POSIX code paths remain inert and fail closed; shipping or validating a live POSIX workflow is an anti-goal.

Failure can corrupt or lose user-authored repository content, including ignored content with no Git recovery path. Repository contents are untrusted. Concurrent edits, path aliases, links, Git transformations, interrupted writes, and response loss are therefore part of the design boundary. The controller fails closed when it cannot prove the target identity, approved state, or safe recovery transition.

The controller is not a sandbox against an adversarial same-account process that synchronizes namespace substitutions between its individual system calls or writes the repository directly. It must reject ordinary and persistently observable escapes, aliases, links, and drift, and disclose the residual external-writer window before approval.

Crash and durability claims cover controller-process termination or handled failure while the operating system and mounted filesystem remain running. Host shutdown, power loss, kernel failure, storage-controller loss, and recovery after filesystem remount are anti-goals because Node 22 has no portable directory-entry flush contract for them.

The workload is repository-scale backlog prose. Synchronous filesystem operations are acceptable. Inspection and application stay bounded by the controlled bytes, targets, and deterministic parser work and must remain practical at repository scale; the design makes no stricter asymptotic claim.

## Complete controlled surface

The controller covers this complete initial surface:

- Four active indexes: `.claude/QUICK_WINS.md`, `.claude/FEATURES.md`, `.claude/BUGS.md`, and `.claude/PATTERNS.md`.
- Three history archives: `.claude/QUICK_WINS_HISTORY.md`, `.claude/FEATURES_HISTORY.md`, and `.claude/BUGS_HISTORY.md`.
- The structural `.claude/` parent and `.claude/features/`, `.claude/bugs/`, `.claude/patterns/`, and `.claude/plans/`.
- One logical root-guidance `Backlogs and indexes` section resolved to the active host's canonical durable project-guidance file.
- The unconditional repository-local `.claude/plans/` ignore policy in Git repositories.
- The fresh-scaffold track, ignore, or defer election for the remaining backlog surface.
- Hard-wrap inspection and repair for the seven top-level backlog files and Markdown files under `.claude/features/`, `.claude/bugs/`, and `.claude/patterns/`.

Other top-level Markdown files and `.claude/plans/` contents remain outside unwrap scope. `.claude/quick_wins/` and Quick Win breakout prose remain outside this feature until Pick-time breakouts extends the controller.

The controller does not migrate populated implemented or fixed sections into history archives, change an existing project from tracked to ignored, run mutating Git commands, add or remove index entries, autonomously author or alter user-controlled semantic prose, decide whether customized prose satisfies a concept, or generalize host-neutral routing beyond init-backlog. It may publish an exact model-authored semantic repair or a mechanical unwrap only when that effect is included in the complete manifest shown to and approved by the user.

## Ownership and architecture

`skills/init-backlog/init-backlog.js` is the private deterministic controller. It owns target discovery, root-guidance resolution, template loading, inspection, deterministic proposals, snapshot binding, effect validation, filesystem effects, Git-aware policy inspection, unwrap execution, recovery, and final ready-parser validation.

`skills/init-backlog/templates/` holds the seven complete missing-file templates, the shared root-guidance section, the host-specific prologues needed to create a missing guidance file, the mandatory plans-ignore fragment, the elective non-plan backlog fragment, and a manifest that gives the assets and compositions stable logical identities.

`skills/init-backlog/SKILL.md` owns semantic classification and user interaction. It applies the existing concept checklists, distinguishes complete, missing-concept, and ambiguous customized prose, designs exact semantic repairs when unambiguous, presents the controller's complete proposal and unresolved facts, obtains approval and any election choice, submits only the approved manifest, and reports the structured result.

The ready and unwrap parsers remain the authorities for their existing grammars. The controller reuses their deterministic cores through private entry points without changing their public CLI behavior. It does not reimplement either grammar in the skill or controller.

Every writable project target is instantiated into one closed allowlist before application. Controller-owned locks, markers, temporary files, backups, and support directories form a separate closed runtime-artifact surface. A physical object cannot occupy two logical project roles or overlap the runtime surface. Wrong-kind, linked, aliased, hard-linked, escaped, unreadable, unstable, or protocol-unrepresentable controlled targets fail before proposals or writes.

## Root-guidance resolution

The logical backlog guidance section is written to the canonical durable project-guidance file for the active host, not blindly to a fixed basename.

Under Claude Code, resolution starts from root `CLAUDE.md`. A recognized root import delegation, including the common `@AGENTS.md` adapter, remains in force and may make its durable referent the insertion target. The adapter itself is not replaced or bypassed. Other independently loaded Claude project guidance, local guidance, rules, and nested guidance are read-only conflict inputs rather than additional write targets.

Under Codex, resolution uses the effective project-instruction fallback basename order and invocation context. When the host cannot expose authoritative effective values, the skill obtains user confirmation before any write. A repository cannot be written through an assumed default that conflicts with its actual Codex configuration.

Resolution validates every candidate before precedence selection, discovers conflicting loaded guidance that already owns the backlog concepts, and yields one writable target or a typed ambiguity. A missing standard target is created with the prologue matching its resolved basename and the shared section. An existing or custom target receives only the shared section. The feature does not reconcile multiple semantic owners automatically.

## Template normalization and logical identity

Correctness cannot depend on a Git attribute or checkout line-ending setting remaining stable. Every bundled text asset must be valid UTF-8 without NUL, must use either LF or CRLF consistently, and must declare whether it has a final newline. Loading converts its accepted checkout form to logical LF and rejects mixed or contradictory content.

Composed templates concatenate normalized assets exactly in manifest order without an implicit separator. Their stable logical identity is derived from the normalized composed bytes, so LF and CRLF checkouts of the same source have the same identity. Missing targets materialize from those logical bytes using the destination newline policy chosen by inspection.

A present file is exact-template only when its complete logical content equals the composed template. Customized surrounding prose is not silently treated as template-owned. Existing target bytes, BOM state, newline convention, mode where meaningful, and controlled semantic regions are inspection facts and are preserved or changed only by the exact proposal shown for approval.

## Controller contract

The controller exposes three logical capabilities: `inspect`, `apply`, and evidence-first recovery. Recovery may use separate inspect and apply operations, but it remains one capability boundary.

`inspect` validates the request, host context, repository classification, guidance target, templates, controlled targets, Git policy, wrap state, ready result, and recoverable runtime residue. It returns one deterministic snapshot containing typed target states, deterministic proposals, semantic decision slots, problems, warnings, and predicted ready effects. It performs no project-target or version-control-policy write. Any transient controller ownership used for a stable inspection is cleaned before return or retained as explicit recovery evidence when cleanup cannot be proved.

`apply` accepts the complete inspected snapshot, the approved election choice, semantic decisions, and exact approved actions. It validates the complete request and simulates its legal transitions before the first project-target write. It never invents a semantic decision, broadens an action, or reads a newer state as if it were the approved one.

Recovery inspects exactly one recognized stale owner, election marker, or abandoned backup, returns bounded evidence and the legal dispositions for that evidence, and applies only an explicitly authorized disposition. Unknown, malformed, changing, oversized, live, or unattributable residue fails closed. Unattended recovery requires authority already captured by the surrounding lifecycle; otherwise it records the unresolved state and stops.

Requests and results use a versioned, bounded, closed structured protocol. Expected errors are typed results with trusted confined path carriers and enough recovery state for the skill to explain what remains. Raw exceptions, repository text, platform diagnostics, and oversized content do not leak into branching surfaces. An internal transport failure cannot convert a partial operation into apparent success.

The implementation plan owns exact schemas, field ordering, identifier grammars, constants, serialization, capacity proofs, error codes, and phase precedence. The spec owns the capability boundary, ownership, safety behavior, and acceptance criteria above.

## Snapshot, approval, and drift

Each inspect result has one deterministic identity over every fact whose change could alter the proposed actions or their safety. Each approved apply manifest has one deterministic identity over that snapshot, election choice, semantic decisions, actions, modes, and exact content effects.

The skill follows this workflow:

1. Inspect and retain the complete result.
2. Apply the semantic concept checklists to customized controlled prose and record complete, exact-repair, or deferred decisions.
3. Present every proposed effect, unresolved condition, safety disclosure, and election choice. Semantic exact edits and whole-file mechanical proposals show exact decoded before and after content. Only a mechanical unwrap of breakout prose may substitute a deterministic digest carrier because breakout content has no semantic-decision role in this feature, while top-level backlog files and root guidance can require semantic classification or an unwrap-then-repair chain whose exact intermediate content must remain reviewable. The carrier identifies the target, transformation extent, and exact before and after identities and discloses that the prose images are withheld. No other effect may replace exact content with digest-only disclosure.
4. Obtain explicit approval for the complete manifest.
5. Apply that manifest and present its complete structured outcome.

No approval, denial, deferral of the manifest, unavailable user, or auto-denial produces no apply request and no project-target, policy, marker, or backup write. A preceding standalone inspect may leave only its explicitly reported cleanup-failure evidence.

Apply revalidates all snapshot-bound facts before writing. It accepts only the approved initial state or a unique recognized intermediate or terminal state of the same manifest. Unrelated or ambiguous drift produces no new project-target write and requires fresh inspection, semantic classification, presentation, and approval.

The controller uses durable target state as progress evidence rather than a general action journal. A separately persisted progress journal could disagree with published target state when either write lands alone across a crash, creating two competing recovery authorities; target state plus the approved manifest keeps one observable authority. Repeating the same manifest after response loss is idempotent when the current state proves a unique approved prefix or completion. If the manifest is unavailable, the safe route is fresh inspection and approval against current bytes.

## Git and newline behavior

A fresh non-plan backlog scaffold is a Git repository with no valid election marker and no historical non-plan backlog evidence: none of the seven controlled top-level backlog files is present and no controlled Markdown file exists under `.claude/features/`, `.claude/bugs/`, or `.claude/patterns/`. Mere presence of `.claude/`, structural child directories, `.claude/plans/` content, or unrelated host configuration is not historical backlog evidence. This boundary uses controlled durable backlog content because the parent namespace is shared with host configuration and ephemeral plans; those unrelated occupants cannot prove that a backlog policy was previously chosen.

In every supported Git repository, the repository's own `.gitignore` must effectively ignore `.claude/plans/`, and tracked plan paths remain an explicit incomplete condition that the controller reports but never repairs through Git index mutation. This rule is unconditional and independent from the election for the rest of the backlog because plans exist only while implementation is in flight, go stale quickly, and leave code plus Git history as the durable record; the remaining backlog is durable user-authored project data whose track-or-ignore policy remains a user choice. A unified election covering plans was rejected because it would preserve ephemeral implementation artifacts whenever the durable backlog is tracked.

A fresh scaffold opens a one-time `track`, `ignore`, or `deferred` election for the non-plan backlog surface, and a valid marker reopens its still-unresolved or already-bound choice after partial progress or response loss. The unresolved or direct choice is represented durably until its approved compatibility conditions are proved, so partial creation cannot erase the choice. Track requires the controlled non-plan surface not to be repository-locally ignored. Ignore requires the approved repository-local rules to be effective and the affected paths not to remain tracked. Conflicts remain incomplete with exact evidence and manual resolution instructions. A scaffold with historical non-plan backlog evidence and no valid election marker retains its historical policy and does not reopen the election.

Non-Git repositories perform no `.gitignore` or election work. A repository that appears to contain Git metadata but cannot be classified safely fails closed instead of degrading to non-Git.

The controller predicts exact physical output from valid uniform target content, the template's logical content, Git attributes and configuration where applicable, and the approved action. It never round-trips a Windows checkout through newline-translating text mode. Invalid UTF-8, mixed line endings, bare carriage returns, unsafe BOM placement, or an indeterminate Git conversion fails before writing that target.

The implementation plan owns the exact Git commands, transports, ignore-source recognition, platform home resolution, rule simulation, EOL conversion table, and append algorithm. Those mechanics must satisfy the outcomes above on Git and non-Git repositories, LF and CRLF worktrees, and Windows. Injected-platform tests may exercise inert POSIX branches to retain their fail-closed behavior, but no live POSIX compatibility contract is implied.

## Writes and recovery

Only one apply or mutating recovery owns a repository root at a time. Ownership identifies the operation and every controller-created temporary or backup that may survive it. A live or indeterminate owner blocks mutation. Stale ownership is never removed by an ordinary run and is handled only through evidence-first recovery that cannot delete a successor owner's state.

Every project-target effect is published atomically within its filesystem after validation of the exact expected input. Required parent directories are created only through approved deterministic actions. A controller-created temporary is confined to its target filesystem and removed after verified publication or retained in the owner's recovery inventory.

Lossy unwrap is one aggregate operation. Before replacing any batch member, the controller creates and verifies the recovery material needed to restore the approved original bytes. It validates the predicted ready result for the complete batch, publishes in deterministic order, verifies the observed aggregate result, and removes backups only after the entire batch is accepted. An observed result that exactly matches the approved prediction is accepted even when that prediction contains structural errors: the unwrapped bytes remain durable and the run returns incomplete with those errors for manual resolution. Parser failure or aggregate mismatch restores every published member when possible; failed restoration or cleanup retains exact recovery evidence and blocks ordinary mutation.

Every multi-write transition has a finite set of recognizable durable states and one deterministic resume or recovery action for each state. No unrecognized partial state is treated as progress. Cleanup happens only after the durable user-visible state is verified. Cleanup failure never changes a successful project write into an undocumented state, but the operation result is failed even when completed approved effects remain durable; it reports those effects, the retained paths, and the recovery direction.

External edits after the final pre-write validation remain outside controller ownership. The skill discloses that window before approval, apply detects every observable mismatch, and a later run inspects the resulting bytes as current user state rather than assuming controller ownership.

## Completion and errors

An apply result is complete only when every required controlled target, semantic decision, unwrap repair, guidance ownership rule, mandatory plans policy, selected election branch, and final ready-parser condition is satisfied. The final ready-parser condition requires a successful parse whose result contains no structural errors; notices do not block completion unless another explicit completion rule classifies their underlying state as incomplete.

An approved run may return incomplete when the user deliberately deferred a semantic or election decision, a Git conflict requires manual work, an independently approvable action landed while another target remains unresolved, or an accepted exact predicted unwrap result contains structural errors that require manual resolution. Partial progress is permitted only when every landed action was separately visible in and authorized by the complete manifest, its preconditions and effects do not depend on the unresolved decision or target, and complete simulation proves that landing it neither narrows the unresolved choice nor creates a completion claim. A dependency or unresolved ambiguity blocks every action in its connected set; the implementation plan may choose ordering only among actions that satisfy this eligibility rule. All-or-nothing manifest admission was rejected because an unrelated unresolved choice would withhold separately approved repairs that can safely reduce the remaining repair set, while the explicit incomplete result preserves that the scaffold is not yet complete. Every incomplete condition is typed, bound to a trusted target or evidence carrier, and presented to the user. Incomplete is never reported as failure or full completion, and controller cleanup failure follows the failed-result rule above instead.

A failure means the controller could not validate, publish, verify, restore, clean, or serialize the requested operation. The result identifies the failing capability boundary, completed approved effects, retained recovery evidence, and safe next action without exposing untrusted content as control data. A failure cannot manufacture completion, silently retry a changed action, or erase durable evidence.

## Verification contract

The implementation adds fixture-driven controller tests and exactly one new project suite while preserving the ready and unwrap suites and their public CLIs. Verification covers the complete controlled surface, missing and customized targets, semantic regions, strict content validation, path confinement, aliases and links, Git and non-Git classification, track, ignore, defer, denial, unavailable-user, and conflict branches, LF and CRLF materialization, snapshot drift, response-loss resume, partial multi-write states, restoration, stale ownership, marker recovery, abandoned backups, and cleanup failure on Windows. Injected-platform cases retain fail-closed coverage for inert POSIX branches; the POSIX-gated permission test and real-filesystem POSIX mode assertions are outside the Windows-only live verification matrix. Verification separately proves that structural directories, plans content, or unrelated host configuration without controlled non-plan backlog evidence still opens the fresh election, while any controlled non-plan backlog file without a valid marker retains historical policy. It also proves that an independently authorized action can land and return incomplete beside an unrelated deferred decision, while an action connected to that unresolved decision remains blocked.

Golden fixtures independently pin every extracted template, composition, concept mapping, and controlled region before prompt-owned copies are removed. A controller-disabled fixture preserves the prior prompt workflow from committed bytes so behavioral evaluation can distinguish a real ownership transfer from a rewritten baseline.

Behavioral evaluation proves separately that the controller produces deterministic mechanical proposals, the model still makes semantic classifications and repairs, the user sees every action and unresolved condition, approval precedes apply, every no-approval branch issues no apply, structured results are presented completely, and repeated equivalent enabled runs yield the same seed-derived mechanical outcome. It runs both Claude Code and Codex against isolated byte-pinned scenarios and compares enabled behavior with the preserved disabled baseline. Exact natural-language wording is not an oracle. (live-claim: provisional)

The evaluation harness must isolate each run, admit only authenticated and correctly ordered controller traffic, preserve supported host authentication without publishing credential evidence, bound every preparation and session process, prove process-tree and stream closure before cleanup, finalize and verify all required evidence before publishing a verdict, retain and report the run root when safe cleanup cannot be proved, and report harness infrastructure failure rather than a feature verdict when preparation, supervision, evidence publication, or cleanup fails.

The implementation plan owns the harness topology, session driver, transport framing, environment projection, subprocess arguments, timers, stream barriers, evidence file lifecycle, fixture construction, and event schedule. Tests must prove the spec-level outcomes above and include negative mutations showing that each independent oracle can fail.

CI, the documented development-command list, universal skill topology coverage, agreement fixtures that consume extracted templates, release-surface conformance, and this repository's full then-current suite list are updated together. Landing-time verification recounts the authoritative suite set rather than pinning a total that neighboring work can change.

## Implementation-plan boundary

This spec owns externally observable behavior, safety invariants, component ownership, durable compatibility surfaces, irreversible architectural choices, anti-goals, and decidable acceptance criteria.

The implementation plan owns exact JSON schemas, constants, algorithms, path and file-operation sequences, subprocess supervision, proxy or IPC mechanics, timing values, fixture layout, command lines, error-code tables, and intermediate state encodings unless one of those details changes a spec-owned contract.

A plan choice that would change a spec-owned contract routes back through spec agreement. A reviewer request that only fills delegated machinery is a plan input, not a spec finding.

## Migration and release

Implementation first freezes independent committed-byte template and disabled-workflow oracles. It then extracts assets with parity coverage, introduces the controller and private parser entry points behind tests, switches the skill to inspect, semantic classification, approval, apply, recovery, and result presentation, and only then removes duplicated prompt-owned template bodies and deterministic instructions.

The `Stop committing implementation plans` Quick Win co-ships because it changes the same init-backlog version-control surface. Plans become unconditionally ignored while the election for the remaining backlog survives independently.

Public ready and unwrap CLI behavior remains compatible. The behavior batch includes exactly one monotonic plugin version increase, edits this clone only, and leaves publication user-directed.

## Relationship to neighboring work

The content-fingerprint-helper feature is not a prerequisite. Review-document identity and raw working-tree or template identity have different semantics and are shared only if a later helper exposes the exact required modes.

Agent-host-agnostic Nightshift depends on this work but is not absorbed by it. This feature resolves root guidance only for init-backlog. General resource roots, global instruction routing, review adapters, documentation routing, and packaging remain with that feature's later slices.

Pick-time breakouts lands after this feature and extends the closed surface for Quick Win breakout prose without replacing the controller's inspection, approval, fingerprint, recovery, or semantic-ownership boundaries.

The one-objectively-correct-answer rule remains a standing codebase directive and becomes a named pattern only after a second shipped carrier uses it.

## Status

Recovered to the approved product and architecture layer on 2026-08-25 after the revise-spec run expanded into implementation mechanics. The previous compatible-refresh authority was not reused; fresh agreement over both canonical artifacts was obtained before recovered revise-spec resumed.

## Hardening

- revise-spec graduated 2026-08-25 14:31 at 2f3f818, scope: whole file, content: 636fcfd7
- revise-spec refreshed 2026-08-30 23:37 at d41745e, scope: whole file, content: 7b9239e0 (Windows-only live support)
