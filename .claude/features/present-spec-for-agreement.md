# Present chosen spec for agreement before work

Feature: every governing spec is presented to the user as a decision-complete digest and explicitly approved before lifecycle work begins. Approval exists only as evidence in the current session and is never durable backlog state. This file is the authoritative design record.

## Goal and scope anchor

Prevent an agent from treating backlog readiness, work-item nomination, an old approval, a legacy marker, or a durable design label as authorization to begin work. Before validation, review, planning, or implementation, the user sees the current governing design and agrees to it.

This feature governs every spec that supplies the design contract, not only four-index backlog entries. A governing spec can be a dedicated spec, a feature breakout plus its index entry, a bug breakout plus its index entry, an index-only feature, bug, or quick win, a pattern used as the implementation contract, or a set of artifacts that jointly governs the selected scope.

Read-only artifact discovery, target-scope resolution, completion detection, legacy-marker cleanup, digest construction, and candidate-identity construction are in scope before approval. Validation dispatch, task-queue creation, revise loops, planning, implementation, and other substantive lifecycle work are out of bounds until approval exists for the current design content.

## Operating context

- **Deployment environment and operational criticality**: public GitHub plugin (`github.com/astenlund/nightshift`, self-hosted marketplace with autoUpdate); the primary consumer is the author's daily Claude Code and Codex workflow. The feature changes the authorization boundary for every spec-governed lifecycle entry but touches no production system or external data directly.
- **Audience**: judgment recorded as `personal use`. Public availability alone does not change the component's actual decision-maker: the engineer who owns the selected requirements and is present at the approval gate.
- **Failure consequence and data or security sensitivity**: a false positive can launch a long autonomous run against a design the user has not seen or no longer agrees with; a false negative costs one redundant digest and response. No externally consequential data or security-sensitive surface. Not fired.
- **Concurrency and compatibility risk**: the rule must survive Claude Code and Codex entry points, standalone and backlog specs, same-session compaction, and host-neutral workflow surfaces. Legacy cleanup writes governing backlog artifacts, so an unsynchronized writer could overwrite design data or strand a partially cleaned multi-file set; approval itself never crosses sessions or concurrent runs. Fired.
- **Reversibility and recovery cost**: high reversibility; git-tracked instruction prose and versioned plugin releases can be reverted or downgraded. Not fired.
- **Expected feature lifetime**: long-lived; this is a permanent human-authorization boundary. Fired.

Derivation per `internal/revise/rigor.js`: audience `personal use` gives baseline `low`; concurrency and compatibility plus expected lifetime fire two uplifts. The resulting tier is `high`, with high effort for validation, recovery, compatibility, observability, and proof.

## Approval contract

### Governing artifact and scope resolution

The shared agreement skill first resolves the target scope and the governing-set seed or seeds. Handover uses its existing selection order, including its recency fallback. A direct `revise-spec` call accepts only the artifact explicitly named by its invocation or an exact artifact that the current conversation unambiguously links to the requested review. For direct `revise-plan`, the named plan is the target and every declaration in its `## Governing specs` section is a governing-set seed, in declaration order after canonical path resolution. For direct `revise-code`, an active plan's selected whole-file or section scope is the agreement `target`; without a plan, the explicitly named or exact current-conversation governing scope is the target. The mutable logical code changeset is not an agreement target: revise-code continues to bind it with its own cumulative-patch fingerprint, while agreement authorizes the stable governing work scope before code review. Direct `revise-code` takes any explicitly named governing artifact as its first seed and also includes every declaration from its active plan's `## Governing specs` section, in declaration order; only when both sources are absent may an exact current-conversation link select a seed. Recency alone never associates a spec with a direct call. Duplicate plan declarations of the same complete scope binding collapse at their first occurrence; declarations for different work units in one artifact remain distinct. An ambiguous, unreadable, or noncanonical declaration stops the gate, and an explicit spec-less declaration yields `not-applicable` only when the caller's existing contract permits spec-less work. Resolution may read repository and conversation state but may not dispatch validation, build a task queue, or edit design content.

Handover retains one completion-only branch before governing-set construction. When its existing stage detection uniquely resolves an index-only target that is absent from the active index and present in the corresponding history archive as already shipped, it reports the completed-scope no-op and never treats the archaeological history summary as a governing spec. An unsliced target requires one exact title match. A sliced target additionally requires the history link's existing `Feature title: slice name` display to match the exact case-sensitive `displayName` produced by the ready parser for the requested slice. That display name must be unique among every same-feature slice record in the archive; a title-only match, normalized-key-only match, duplicate display name, or free-prose scope mention is inconclusive. This uses the value the shipping protocol already persists and covers a uniquely named final slice after its parent leaves the active index. Multiple matches, a legacy history line without enough scope detail, or any other ambiguity cannot prove completion and follows handover's existing fail-closed confirmation path. A direct standalone revise invocation does not take this no-op branch: if it explicitly names an archived artifact as review material, that artifact is a new explicit standalone target and must pass the normal agreement gate.

The resolver expands the seed or seeds into the complete governing set by these rules:

1. A backlog breakout and its exact index entry govern together. The breakout is primary and the index entry is its companion because the breakout owns detailed design while the index owns lifecycle classification and dependencies.
2. An index-only entry governs alone. A heading-form entry selector includes the enclosing `##` heading and complete `###` entry block. A quick-win bullet selector includes the enclosing `##` heading, its top-level `- ` line, and every immediately following nonblank indented continuation line, ending at the same boundary used by `skills/ready/ready.js`.
3. A pattern, umbrella, or other artifact joins the set only when the selected artifact or the user's current instruction explicitly says that it supplies part of the implementation contract. An ordinary related-work link does not make an artifact governing.
4. For a single-seed target, the primary artifact comes first, its companion index entry comes second, and any remaining explicitly co-governing artifacts follow in ordinal order by canonical path and selector. For direct `revise-plan`, each declared seed scope appears in declaration order with its companion artifact immediately after its first occurrence. For plan-backed direct `revise-code`, the explicit seed scope and its companion come first when present, then each plan seed scope follows in declaration order. In both plural cases, remaining explicitly co-governing artifacts follow in ordinal order by canonical path and selector. An exact duplicate scope binding is collapsed at its first occurrence; duplicate artifact selectors hash once while every distinct work-unit binding remains in `governingScopes`. If membership, scope, or ordering remains ambiguous, the controller asks the user and stops before the gate rather than silently choosing.

Canonical paths are project-root-relative with `/` separators and no `.` or `..` segments. A governing artifact that cannot be expressed that way is a structural error. A direct artifact nomination selects the primary artifact but does not prove that no explicit companion or co-governing artifact exists.

Every plan created or reviewed after this feature contains exactly one outside-fence `## Governing specs` section before any other `##` section. Until the next outside-fence heading of level one or two, its nonblank body is exactly one of:

- `- None.` for an explicitly spec-less plan; or
- one or more physical lines of `- Spec JSON: <object>`, where `<object>` is compact canonical JSON with keys in this order: `kind`, project-root-relative `path`, `selectors`, and `workUnit`, using the exact shapes below.

The declaration lines are the only machine-recognized upstream-spec source. Ordinary Markdown links, prose references, and fenced examples anywhere in the plan do not add a governing seed. Mixed `None` and `Spec JSON` forms, a missing or duplicate section, wrapped or malformed JSON, extra keys, a path that does not resolve, and an unsupported selector are structural precondition errors before review; none is interpreted as spec-less. A legacy or external plan without the section must be reconciled through the planning flow before the gate can continue. The deterministic module parses actual plan bytes through the common fence scanner and returns the ordered scope objects to every plan and code adapter; adapters may not pass a hand-assembled seed list that bypasses this parser.

Every planning caller, including a standalone natural-language planning request, receives a volatile result containing `agreement` and the ordered canonical `governingScopes`; `agreement` is the current approved identity or `not-applicable`, and `governingScopes` is empty only for the latter. The plan producer serializes those scopes into `## Governing specs` before returning the new plan. It also writes a human-readable header as exactly `**Spec:** none` for zero scopes, `**Spec:** [<path>](<path>)` for one scope, or `**Spec:** multiple (see Governing specs)` for more than one. The section is machine-authoritative, but the parser validates that header cardinality and, for the single form, its canonical path agree with the declarations. A mismatch is structural rather than silently repaired. Handover planning and standalone planning consume the same result and serializer contract; an external planner that cannot do so must stop before claiming the plan is ready.

The shared gate stops and routes work to brainstorming when the invoking workflow requires a spec but none exists, when any member of the complete governing set is an Exploring draft, or when the available text cannot produce a decision-complete digest. The guard covers seeds, companions, patterns, umbrellas, and every other explicitly co-governing artifact. `status: exploring` and placement under `## Exploring` are both unfinished-design signals and cannot be overridden by a detailed draft or an approval response. In a plural set, the gate reports every unfinished artifact and authorizes none of the set; graduation must happen through the existing brainstorming flow before the digest gate can authorize lifecycle work. A direct code-review workflow with no selected or discoverable governing spec receives `not-applicable` and continues its existing non-spec path; this feature does not manufacture a spec for work that has none.

### Decision-complete digest

The user-facing digest contains the complete decision surface needed for agreement:

- governing artifact path or paths, the requested target scope, and the selected scope or work unit for every governing seed;
- requested goal or outcome;
- material exclusions and non-goals;
- material design decisions;
- upstream backlog dependencies and external prerequisites;
- unresolved questions and every provisional or deferred live claim.

Goal and material design decisions require positive source content and cannot be empty. The other fields are set-valued. Each set-valued field renders its concrete items, `none explicitly stated` when the governing text says none, or `none found after full governing-set review` when the artifacts contain no such item. Absence of a dedicated heading does not by itself make a valid quick win or index entry incomplete. If the absence leaves the implementation boundary or a prerequisite genuinely ambiguous, the spec is incomplete and returns to brainstorming.

The digest links to the full artifact or artifacts. It does not dump a long file verbatim, but it cannot omit a decision merely to stay short. It may synthesize and group source text, but it may not invent a goal, decision, exclusion, dependency, prerequisite, unresolved question, or live claim. The gate renders every digest field and constructs the candidate identity from one recorded governing-set baseline: exact complete bytes for every resolved artifact plus the canonical target and seed-scope resolution. It never rereads one representation while retaining the other from an older read.

Direct nomination such as "implement X" selects work but does not approve the current design. Agreement must respond to a digest presented in the current session. The only presentation exceptions are final same-session brainstorming evidence that meets the Creation rule below, or an exact approved identity still retained from an earlier gate. The brainstorming exception requires the complete canonical candidate identity to have been constructed and retained when the final artifact set and digest were presented, before the user's response; a byte-only snapshot is insufficient because it does not bind target scope, selectors, work unit, paths, selector kinds, or artifact order, while displaying the diagnostic token remains optional. Earlier-gate or brainstorming prose without that retained pre-response identity never reconstructs approval after state loss. Ambiguous or partial conversation evidence does not qualify.

### Candidate and session-local approval identity

Before presenting the digest, the shared gate constructs the candidate identity that the response would authorize from the same recorded baseline used to render the digest. It then rereads the complete artifact bytes, reruns governing-set and scope resolution, and requires exact equality with the baseline before presentation. Any path, byte, membership, order, selector, or work-unit drift discards both digest and candidate and restarts resolution from a new baseline; comparison failure stops with a structural error. Only after this full-baseline check may it retain the complete structured identity in current-run controller state and present the digest. The baseline exists only for one presentation attempt, is replaced rather than merged on restart, and is discarded after presentation; it is never persisted or shared across runs. It may display `a-<12 lowercase hex>`, the first 12 hexadecimal characters of the SHA-256 of the identity's canonical serialization, for diagnostics. The short token is not the equality authority.

The canonical identity is a versioned JSON object. Construct its keys in the order defined here, `governingScopes` in seed-resolution order, and `artifacts` in artifact-resolution order, then serialize it with compact ECMAScript `JSON.stringify` semantics: no replacer, no whitespace argument, standard JSON escaping, UTF-8 without a byte-order mark, and no trailing newline.

1. `version`: integer `1`;
2. `target`: an object containing keys in this order: `kind`, canonical primary `path`, `selectors`, and `workUnit` for the requested stable lifecycle or review scope. For direct code review this is the selected active-plan scope, or without a plan the selected governing scope, never the mutable code changeset;
3. `governingScopes`: a nonempty array with one object per distinct governing seed scope, each containing keys in this order: `kind`, canonical `path`, `selectors`, and `workUnit`; companions are represented in `artifacts`, not duplicated here;
4. `artifacts`: an array whose entries contain keys in this order: canonical `path`, `selectorKind` (`design-before-hardening`, `index-entry`, or `bullet-entry`), `selectors`, and a full 64-character lowercase SHA-256 `contentHash`.

Every `workUnit` is `null` for an unsliced scope or an object with keys in this order: `normalizedKey`, `declaration`, and `state`. `normalizedKey` is produced by `skills/ready/ready.js`; `declaration` is the parser's exact raw outside-fence slice-bullet text, including strike delimiters when present; and `state` is exactly `unshipped` or `shipped`, derived from that same declaration. A completed sliced scope therefore remains constructible and differs from its earlier unshipped identity. This session-local lifecycle field is not an approval or design-status label and is never persisted by the gate. Within one seed, candidate construction rejects duplicate complete raw declarations because indistinguishable slice declarations cannot be authorized safely. When a requested normalized key matches multiple distinct declarations, the resolver never takes the first match: an exact raw declaration supplied by the invocation selects it, otherwise an interactive run presents every matching raw declaration and requires the user to identify one exactly; unavailable or ambiguous selection fails closed. Colliding normalized keys with a chosen distinct declaration therefore produce constructible, distinct identities without a positional discriminator.

`target.kind` fixes the exact `selectors` shape:

- `whole-file`: the empty array;
- `sections`: one or more objects in document order, each containing only `headingPath`, an array of exact heading lines from the governing `##` ancestor through the selected heading. Every path must resolve exactly once in the artifact; a repeated heading hierarchy is ambiguous rather than an implicit occurrence selector. Numeric line ranges must resolve to complete uniquely named heading paths before candidate construction; an arbitrary partial range is ambiguous and stops for user clarification;
- `index-entry`: exactly one object with keys `parentHeading` and `entryHeading`, containing the exact `##` and `###` heading lines;
- `bullet-entry`: exactly one object with keys `parentHeading` and `entryTitle`, containing the exact `##` heading line and ready-parser-produced bullet title.

Every `target` and `governingScopes` entry uses the selector shape for its `kind`. Each artifact entry uses the same selector objects: `design-before-hardening` requires an empty array; `index-entry` and `bullet-entry` require exactly the corresponding single object above. Duplicate or out-of-document-order section paths, a section path that resolves zero or multiple times, extra keys, wrong cardinality, unresolved ranges, or a selector kind that disagrees with its shape are structural errors.

All Markdown structural scanning in candidate construction uses one CommonMark fenced-block grammar. An opener is zero to three spaces followed by at least three backticks or at least three tildes; a backtick opener's trailing info string may not contain a backtick. A closer has zero to three leading spaces, the same fence character repeated at least the opener's length, and only spaces or tabs afterward. A fence-like line with other trailing content is body text, and an unclosed fence protects through end of file. Headings, top-level bullets, backlog labels, and slice declarations inside a fence are content, never selector candidates, entry boundaries, or work units; while a selected entry is inside a fence, blank and non-indented body lines likewise remain content until the fence closes.

For `design-before-hardening`, governing content is the artifact's complete content before the first exact outside-fence `## Hardening` heading. A section-scoped target still hashes that complete design content; target scope remains a separate identity field. This intentionally accepts a redundant prompt after an unrelated design-section edit rather than allowing digest material to change without invalidation. For `index-entry`, governing content concatenates the exact enclosing outside-fence `##` heading line, including one normalized LF, with the selected outside-fence `###` entry heading and every line through the line before the next outside-fence heading of level one through three. For `bullet-entry`, governing content concatenates that parent heading line and normalized LF with the selected outside-fence top-level bullet and its contiguous continuation content; outside a fence, a blank line, another top-level bullet, a heading, or any other non-indented line ends the entry. Both index selectors bind entry content and lifecycle classification. `workUnit` separately binds the chosen outside-fence slice when multiple work units share one entry block.

Every artifact hash and digest extraction uses this exact ordered byte pipeline: take the captured raw bytes; strip one leading UTF-8 byte-order mark when present; convert CRLF and bare CR to LF while preserving all other bytes; apply the selector and common fence scanner to that normalized text; make the selected byte sequence end with exactly one LF; then compute SHA-256 over those exact selected bytes. The inline implementation and later `selectAndHashContent` helper must return identical selected bytes and digests for the same raw input. Duplicate JSON keys, missing selectors, an absent heading boundary, or a path and selector that do not resolve to the presented content are structural errors.

Before using either a new response or a retained approval identity, the shared gate reconstructs the candidate from a new recorded governing-set baseline and completes the same full-byte and resolution recheck before comparing identities. Drift during reconstruction restarts the attempt rather than accepting a mixed multi-file view; a reconstruction or comparison failure stops with the structural error. After a new response, if the reconstructed identity differs from the presented candidate, the response authorizes neither version: the gate discards it, presents a fresh digest for the new candidate, and waits again. A retained identity is usable only when its canonical serialization equals the stable reconstruction. Only byte-for-byte equality permits the gate to atomically store or continue with that current candidate as the approval identity. It is never written to a backlog artifact, provenance section, committed file, or cross-session cache.

The identity lifecycle is complete:

- **Creation**: construct the candidate before presentation, then reconstruct and compare it immediately after the response and store it only when explicit agreement names a still-current digest. The same-session brainstorming exception may store a candidate without a second presentation only when that complete canonical candidate was constructed and retained at the final presentation, and conversation evidence proves that the artifact set, target work unit, and every digest field were approved after the last design edit. The post-response reconstruction must equal that pre-response identity. A token need not have been displayed during brainstorming because it is diagnostic rather than the equality authority; a missing candidate, state loss, or any uncertainty requires the normal digest.
- **Refresh**: construct and present a new candidate, reconstruct it after the response, then atomically replace the prior identity only when the reconstruction still matches and the user explicitly agreed.
- **Invalidation**: any change to governing content, artifact set, target scope, or canonical selection; loss or ambiguity of controller state; completion or abandonment of the authorized lifecycle workflow that consumed the identity; or the end of the session. Successful `final-presentation` is a producer, not a consuming lifecycle workflow: it transfers the approved identity into the same volatile session-scoped agreement state before brainstorming returns, and ordinary brainstorming completion does not invalidate it. Continued brainstorming, rejection, abandonment before transfer, or any later design edit invalidates it.
- **Consumers**: the initial pre-work gate; every pre-implementation transition after a step that can edit a governing spec, governing set, or target scope; and the narrow post-implementation exception for a code-review controller mutation that overlaps an active plan or governing artifact.
- **Absent or stale state**: present the current digest again and wait. Never infer approval.
- **Candidate construction failure**: stop before asking for agreement and report the path, selector, or hashing error. A response cannot authorize an identity that was not constructed.
- **Identity storage failure**: stop after the response with a concrete controller-state error and perform no lifecycle work. Retry storage only while the same candidate and response remain unambiguous in the uninterrupted controller turn; otherwise reconstruct and present the digest again.

The controller may retain this identity in host-provided session or task state. It must not add a repository file solely to make approval durable. If compaction or host limitations lose or blur the identity, the safe recovery is another digest, not reconstruction from old markers, timestamps, or durable labels.

### Re-gating after design changes

The active workflow controller compares the current candidate identity with the approved identity after every pre-implementation step that can edit a spec. The known consumers are:

- `revise-spec`, including controller-applied review fixes;
- live-claim probe fold-back before planning;
- revise-plan Spec Reconciliation;
- second-opinion finding fixes;
- any other design correction made before implementation starts.

When identity changes, the controller invokes the shared gate to present the refreshed digest and wait before the next lifecycle phase. Provenance-only changes under `## Hardening` do not move the identity and do not prompt again. If comparison cannot be completed, the controller treats the identity as stale and invokes the gate.

`revise-spec` enforces that boundary inside the shared revise engine, not only at its public wrapper. After the whole-round adjudication barrier applies review fixes, the engine completes the evaluated-round checkpoint, drains every pending user request and checkpoints those controller mutations, then pauses before constructing or dispatching another reviewer, skeptic, verifier, post-review step, or downstream transition. It invokes the agreement gate with the final post-drain governing set and target scope, retains the returned current identity only in host-provided volatile session or task state outside `.tmp/revise-state.md`, and resumes scheduling only after approval. Durable revise state may record only that the resumable boundary requires agreement; it never records the candidate, token, response, approved identity, or a satisfied flag. Any resume presents again unless a separately retained identity is provably scoped to the same live session and still matches current content. Review fixes and user-request mutations applied at one boundary produce one refreshed digest after the complete batch; a request arriving after that drain remains pending and prevents dispatch until it is drained and the resulting candidate is approved. A provenance-only write whose reconstructed identity still equals the approved identity continues without a prompt. Rejection, ambiguity, unavailable interaction, identity storage failure, or gate failure leaves the review checkpoint resumable and dispatches nothing further.

`revise-plan` uses the same evaluated-round and drained-request boundary to reconstruct and compare the complete candidate before further dispatch. A changed `target`, `governingScopes`, or `artifacts` invokes the shared gate on the new identity. This includes a selected plan heading being renamed or rebound as well as post-collapse upstream additions, removals, repoints, reorders, or selected-work-unit changes. Removing or reordering only redundant duplicate references leaves the canonical identity unchanged and does not prompt. A plan edit that leaves the complete canonical candidate unchanged likewise continues without a prompt. Spec Reconciliation invokes the same gate after any governing-spec edit.

`revise-code` detects overlap between every controller-mutation path, including review fixes and user requests, and the active plan or any governing artifact. After an overlapping mutation batch, it reconstructs and compares the complete candidate at the evaluated-round boundary and re-gates on any identity change before further reviewer, skeptic, verifier, or post-review dispatch. The active plan is a scope and governing-declaration source, not itself an approval artifact: changing ordinary plan task prose without changing the selected target, governing declarations, or governing artifacts leaves the identity unchanged and does not prompt. Non-overlapping source edits stay within the implementation phase and do not prompt. If overlap detection or identity comparison fails, code review stops at its resumable checkpoint; it never assumes that an instruction-prose file is non-governing merely because it arrived through the code profile.

If the user requests changes, the work returns to brainstorming or localized design editing and is presented again. If the user declines, is unavailable, or provides an ambiguous response, the invoking workflow stops. This approval gate is a narrow exception to the unattended rule and cannot be deferred to the morning report.

Once implementation starts under an approved current design, Nightshift's existing execution-phase decision and follow-up rules continue to apply. Ordinary implementation and code changes never re-gate. The sole post-implementation exception is a code-review controller mutation that changes a governing artifact or changes the active plan's selected target or governing declarations: that edit changes the approved design identity, reopens the authorization boundary, and must be presented before review continues. Ordinary task-prose edits in the active plan do not. This is not a loop over implementation changes.

### Boundary timing

The gate follows scope resolution, legacy cleanup, completion detection over the cleaned bytes, and candidate construction because the user must see the exact current artifact set and decision surface. Gating at handover invocation is too early: the governed scope is not yet known. Gating at the first artifact edit is too late: validation, review, and queue construction already spend effort and can bias or change the design before authorization. Read-only stage detection and deterministic removal of obsolete authorization markers are prerequisites to an honest digest, not lifecycle advancement.

Final design presentation is also an explicit entry point. When a brainstorming flow has written the final governing artifact set and is about to ask whether that design is agreed, it invokes `skills/spec-agreement/SKILL.md` in `final-presentation` mode instead of issuing its own approval question. The shared gate captures the baseline, renders the decision-complete digest, retains the pre-response candidate, and owns the response check; agreement can then satisfy the same-session Creation rule without a duplicate later prompt. Rejection or requested changes returns to brainstorming and invalidates the candidate. The skill description and generated project guidance trigger this mode for any final spec presentation, including a non-Nightshift brainstorming procedure. If a host or external brainstorming skill fails to invoke it, no approval is inferred and the later lifecycle gate safely presents the digest again.

The requirements second opinion remains inside brainstorming when no governing spec exists. Once a spec exists, the same-session brainstorming agreement must precede its initial second-opinion or revise-spec review. Any finding-driven pre-implementation edit invalidates that agreement and requires a refreshed digest before another review, planning, or implementation transition. The hardened-spec second opinion therefore runs only after the latest review edits have been presented and approved.

## Legacy sign-off removal

Durable sign-off is rejected because it becomes stale as soon as design content changes and creates a second authorization signal beside the existing Exploring-to-graduated design distinction. `## Exploring` plus `status: exploring` remains the marker for an unfinished draft. Graduation into a themed section with a `**Requires:**` line means the design may be presented; it is not current approval and creates no replacement status such as approved, designed, or settled.

Before digest construction, the shared gate removes these case-sensitive, column-one legacy lines from every selected governing artifact, but only while outside fenced code blocks under the common scanner above. For matching only, it recognizes and skips one leading UTF-8 byte-order mark before the first logical line; replacement preserves that byte-order mark at byte zero, so a BOM-prefixed first-line marker is removed without changing the file's encoding marker:

- any complete line matching `^Status:[ \t]+signed off(?:[ \t].*)?$`; this deliberately removes malformed old header variants after the exact `Status: signed off` prefix as well as the canonical timestamp and fingerprint form;
- within `## Hardening` only, any complete line matching `^- [A-Za-z0-9-]+ refreshed .+ \(sign-off marker\)[ \t]*$`.

Indented examples, blockquotes, fenced-code content, inline references, and historical prose do not match and remain. The migration does not remove `status: exploring`, ordinary `graduated` or `refreshed` stamps, handover completion stamps, or prose that discusses the rejected approach.

Cleanup records each matched logical line as an exact raw-byte span in the preflight baseline. Replacement bytes are formed only by concatenating the untouched baseline slices around those spans; the cleanup path never decodes and re-encodes the file or normalizes line endings. A matched line with a terminator removes the line bytes and that exact LF, CRLF, or bare-CR terminator. A matched final line without a terminator removes only its line bytes. The optional leading BOM is a separate preserved prefix outside the first removable line span. No untouched byte or line terminator changes, and cleanup never synthesizes a terminal newline.

For a multi-artifact set, the shared gate first parses every target, records the exact baseline bytes and all matches, and verifies that every changed file can be replaced safely. If preflight fails, no file is written. Automatic cleanup requires a filesystem capability that atomically replaces a file only when its current complete bytes equal the expected baseline; a separate reread followed by rename is not an implementation of this compare-and-replace contract. In governing-set order, each successful compare-and-replace makes that artifact durably contain no matched legacy lines while later artifacts remain untouched. A baseline mismatch, write failure, or indeterminate result stops immediately; the gate reports the already cleaned, failed or drifted, and not-yet-attempted paths and performs no lifecycle work.

Portable Node filesystem APIs and the current Claude Code and Codex text-edit surfaces do not establish that raw-byte compare-and-replace contract, so the initial implementation maps neither host to an automatic provider by assertion. On those hosts, marker discovery takes the declared primary migration fallback: leave every file untouched, render the exact matched paths and raw-line deletions, and stop before lifecycle work so the user can apply or authorize an ordinary reviewed migration. The gate then restarts from disk and proceeds only after the selected governing set contains no marker. Nightshift's own release implementation applies that ordinary reviewed migration to every known marker in the same change. A future host adapter may enable automatic cleanup only after an executable capability probe proves mismatch rejection and byte preservation; absent or failed proof remains the manual-migration branch. Restart discards every old baseline, rescans the complete governing set, and safely continues because removal is idempotent; it does not roll back obsolete authorization text or claim an unproved concurrent-write guarantee.

Runtime migration is scoped to the selected governing artifacts. Read-only surfaces such as `ready` and `exploring` never sweep or mutate a repository. The Nightshift repository's implementation removes its known legacy markers in the release change.

## Enforcement and reinforcement

### Shared gate and handover enforcement

The feature depends on the Agent-host-agnostic Nightshift MVP so public lifecycle workflows exist as provider-neutral skills and legacy commands are absent. A new shared `skills/spec-agreement/SKILL.md` owns governing-set resolution, cleanup, digest construction, identity, and approval. Its description triggers both when a completed design is about to be presented for agreement and on any request to validate, review, plan, or implement work whose governing spec is selected or discoverable. `skills/handover/SKILL.md` calls it before validation or queue construction, while each directly invokable `revise-spec`, `revise-plan`, and `revise-code` skill calls the same precondition before dispatch. The direct-call wrapper creates current-run agreement state when no handover controller exists and returns either the approved identity or `not-applicable` to the invoking workflow; the shared procedure never launches that workflow itself, avoiding recursion. `not-applicable` is valid only when no governing spec is selected or discoverable and the caller's existing contract permits spec-less work. This shared fail-closed gate closes direct standalone, backlog, and explicit revise-entry bypasses in hosts that honor skill discovery.

The canonical order becomes:

1. resolve the requested handover target far enough to take the unique archive-backed index-only completion no-op when it applies;
2. resolve the governing set and target scope for every remaining path;
3. remove legacy sign-off markers from the selected artifacts through a proved automatic provider or the reviewed migration fallback;
4. rerun governing-set resolution and stage detection from the cleaned on-disk bytes, including after a resumed partial cleanup;
5. if handover selected an already completed active-artifact scope, report the no-op and stop without an approval prompt; an explicitly invoked standalone revise workflow records completion as context but continues to the agreement gate and requested review;
6. if any member of the complete governing set is Exploring, report every unfinished artifact, stop, and route the whole set to brainstorming;
7. capture one governing-set baseline, construct both digest and candidate from it, then rerun resolution and compare complete bytes before presentation; drift restarts this step, while unchanged retained same-session approval skips only the presentation;
8. reconstruct the candidate from disk; for a new response, store the session-local identity only when it still exactly matches what was presented, and for retained approval, continue only when it still exactly matches the stored identity;
9. validate the spec against the repository, build the flat task queue, and enter the detected lifecycle stage;
10. re-gate before another review, planning, or implementation transition whenever a preceding step changed governing content.

The stage ladder distinguishes whether a spec exists and whether it is hardened, planned, implemented, or completed. It contains no signed-off, approved, designed, or settled rung. Selecting a further uncompleted scope re-enters the approval gate for that scope.

### Backlog and project guidance

The universal rule is reinforced where agents select work outside explicit handover:

- each of the `QUICK_WINS.md`, `FEATURES.md`, `BUGS.md`, and `PATTERNS.md` template-controlled headers states that readiness or graduation is not approval and requires a decision-complete digest before work;
- the init-backlog canonical skill adds the same rule to its existing template-controlled project instruction block, which remains the generated root `CLAUDE.md` block until the separate host-neutral scaffolding slice changes that routing;
- the freshness checklist gives existing projects a targeted merge rather than a destructive rewrite;
- this repository's four indexes and `AGENTS.md` carry the corresponding current guidance.

These are reinforcement surfaces, not independent approval stores. The shared agreement skill is the enforcement owner and supplies direct Codex coverage before host-neutral scaffolding exists. The later scaffolding slice must preserve the rule when it moves canonical project guidance to `AGENTS.md` and generates host adapters. `/nightshift:ready` continues to report dependency readiness, and `/nightshift:exploring` continues to report draft designs; neither skill changes classification or output for approval.

## Fingerprint contract and related-feature ordering

With durable sign-off removed, document design fingerprints exclude only the `## Hardening` provenance section. A `Status:` header is ordinary content and moves the fingerprint. The canonical recipes in handover and revise drop the `!/^Status:/` filter.

The pending Content fingerprint helper must land after this feature. Its design and synchronized index excerpt change in this implementation so `partial` mode excludes only `## Hardening`, its `Status:` fixture expects both `partial` and `whole-file` fingerprints to move, and its `Requires:` line names this feature. If helper code exists when this feature is implemented despite that dependency, the same change updates the helper implementation and fixtures rather than leaving the old contract live.

Second-opinion gates must also land after this feature. Their design and synchronized index excerpt gain that dependency and the ordering described under Boundary timing. The Agent-host-agnostic Nightshift design records the reverse relationship: its universal-skill MVP precedes this feature, later migration slices preserve the agreement gate, and the portable fingerprint slice receives the helper's transitive dependency.

## Complete implementation surface

The implementation updates every current consumer of this decision, using the canonical location that exists after the host-neutral prerequisite:

- `skills/spec-agreement/SKILL.md`: canonical shared gate, broad lifecycle and final-design-presentation triggers, `final-presentation` mode, deterministic governing-set resolution, archive-backed index-only completion short-circuit, automatic compare-and-replace cleanup only through a proved provider, primary reviewed-migration fallback, digest and candidate identity, same-session evidence rules, failure handling, and session-local state contract;
- the universal-entry topology suite and both installed-host smoke expectations: advance the exact public set from nine to ten by adding `spec-agreement`, while preserving exclusion of `internal/revise` and absence of legacy commands;
- `skills/spec-agreement/spec-agreement.js`: framework-free deterministic controller module for baseline capture and recheck, actual plan-byte declaration parsing and validated plan serialization, selector and scope resolution, canonical identity construction, approval-state transitions, re-gate decisions, raw-byte legacy-cleanup planning, and the injected atomic compare-and-replace capability contract; interaction, semantic digest extraction, and user-facing rendering remain in `SKILL.md`;
- `skills/spec-agreement/spec-agreement.test.js`: fixture and in-memory adapter suite for every behavioral scenario below, including direct-entry and standalone-planning adapters, volatile session storage, durable revise-state exclusion, multi-file crash states, compare-and-replace drift or capability failure, and the shared fingerprint golden corpus;
- `skills/spec-agreement/fixtures/fingerprint-v1.json`: versioned cross-generation golden corpus whose entries contain `name`, raw `sourceBytesHex`, the canonical `selector`, expected `selectedBytesHex`, and the full expected lowercase SHA-256 `digest`; it covers LF, CRLF, bare CR, one leading BOM, terminal-line-ending variants, `design-before-hardening`, `index-entry`, `bullet-entry`, and fenced lookalikes;
- `skills/handover/SKILL.md`, its planning integration, and the public `revise-spec`, `revise-plan`, and `revise-code` skills: emit or require the canonical `## Governing specs` plan section, invoke the shared precondition at every direct lifecycle entry, preserve the unique archive-backed completion no-op, unattended-rule exception, and re-gating behavior, and remove sign-off behavior;
- the canonical init-backlog skill: four index templates, the existing generated root `CLAUDE.md` block including the final-spec-presentation trigger, freshness checklist, and targeted merge behavior; host-neutral instruction routing remains owned by its later slice;
- `internal/revise/SKILL.md`, `internal/revise/spec.md`, `internal/revise/plan.md`, and `internal/revise/code.md`: fingerprint recipes; exact `## Governing specs` declaration grammar and plural scope binding for plan-governed direct code and plan reviews; complete-candidate comparison after spec or plan mutations; governing-artifact overlap detection after code mutations; and the engine checkpoint and shared-gate hook that prohibits further dispatch or post-review transition until the current identity is approved;
- `skills/ready/ready.js` and `skills/ready/ready.test.js`: reuse the common fence scanner for entry and slice structural tokens, return every candidate for a colliding normalized slice key, make dependency parsing report that collision as a structural ambiguity rather than selecting the first match, add collision and fenced fake-slice fixtures, and preserve existing unambiguous non-fenced parser output;
- `.claude/QUICK_WINS.md`, `.claude/FEATURES.md`, `.claude/BUGS.md`, `.claude/PATTERNS.md`, and `AGENTS.md`: current repository guidance and dependency edges;
- `README.md`: workflow and human-approval terminology;
- `.github/workflows/ci.yml` and the repository command list in `AGENTS.md`: run `node skills/spec-agreement/spec-agreement.test.js` alongside the ready, revise-round, and rigor suites;
- `.claude/features/content-fingerprint-helper.md`, `.claude/features/second-opinion-gates.md`, `.claude/features/agent-host-agnostic-nightshift.md`, and their `.claude/FEATURES.md` excerpts: landing order and compatible contracts;
- `.claude/features/dependency-cycle-detection.md`, `.claude/features/ready-exploring-visibility.md`, `.Codex/specs/2026-08-09-immediate-skeptic-dispatch-design.md`, and `.Codex/specs/2026-08-09-plugin-version-bump-policy-design.md`: complete known legacy-marker cleanup, with active plan directories excluded from release-wide sweeps;
- `.claude-plugin/plugin.json`: exactly one monotonic version increase for the shipped behavior change.

The marketplace description does not change. Hardening and completion stamps remain durable. Exploring frontmatter remains durable for drafts. Ready and exploring output remains unchanged for existing non-fenced entries; ready parser code changes only to make structural entry and slice recognition fence-aware.

Design graduation already removed `.claude/features/signed-off-stamp.md` and its Exploring entry, with the rejection preserved here. They are not implementation work.

## Rejected approaches

- **Any durable approval or replacement design-status label**: rejected because it immediately becomes stale and can be over-trusted by later sessions. No `approved`, `designed`, `settled`, timestamp, fingerprint, or equivalent backlog status replaces the retired sign-off marker. Exploring remains a draft classification, not approval.
- **Template guidance only**: rejected because it is advisory and misses standalone specs.
- **Explicit handover invocation only**: rejected because direct implementation and revise requests can bypass it. The shared agreement skill must also trigger on spec-governed lifecycle work and serve as the public lifecycle wrappers' precondition.
- **Gate at handover invocation**: rejected because artifact membership and target scope are not known yet, so the user cannot approve the exact decision surface.
- **Gate after validation or at first edit**: rejected because work and potential design influence have already begun.
- **Full spec dump on every gate**: rejected because long verbatim artifacts obscure the decision. A decision-complete digest plus direct artifact links preserves reviewability without hiding material content.
- **Narrow section-only design hashes**: rejected because decision-bearing global content can change without moving the identity. Whole design content is the fail-closed boundary.
- **Rollback after partial legacy cleanup**: rejected because restoring obsolete authorization text is unsafe. Per-file atomic, idempotent cleanup gives deterministic recovery.
- **Repository-wide cleanup during read-only commands**: rejected because a readiness or exploration read must not mutate unrelated files. Cleanup stays scoped to selected governing artifacts and explicit release migration.

## Verification

`node skills/spec-agreement/spec-agreement.test.js` runs the behavioral scenario suite with a fake filesystem, injected compare-and-replace adapter, volatile session store, durable revise-state fixture, and direct-entry adapter fixtures. It covers:

- prior-session specs requiring a digest before validation or queue creation;
- unchanged same-session approval avoiding a duplicate prompt;
- final same-session brainstorming approval creating the current candidate without requiring a previously displayed diagnostic token, while partial or post-edit evidence re-prompts;
- final brainstorming presentation retaining the complete pre-response candidate, with a byte-only snapshot rejected and response-time drift invalidating the exception;
- a final brainstorming flow invoking `final-presentation` mode before its approval question, while a flow that omits the integration receives a safe later re-prompt;
- successful final presentation transferring approval into volatile session agreement state across brainstorming completion, while continued editing or abandonment before transfer invalidates it;
- a governing edit while the user is responding invalidating that response and causing a fresh digest, and a retained approval being rechecked against disk before reuse;
- digest and candidate construction sharing one byte-and-resolution baseline, with pre-presentation drift discarding both rather than mixing versions;
- `revise-spec`, second-opinion fixes, live-claim fold-back, and Spec Reconciliation changes forcing a refreshed digest;
- controller-applied revise-spec fixes checkpointing and re-gating before any next round or post-review dispatch, including an unavailable user leaving the checkpoint resumable;
- pending revise-spec user requests joining the complete boundary mutation batch, including a request arriving after the first drain blocking dispatch until its edit is approved;
- direct revise-plan calls parsing actual plan text and binding every `Spec JSON` declaration in order, collapsing exact duplicates and failing closed on malformed or ambiguous declarations;
- plan-text fixtures proving ordinary links and fenced `## Governing specs` lookalikes are ignored, explicit `- None.` is spec-less, and missing, duplicate, mixed, wrapped, or malformed declaration sections fail closed;
- standalone and handover planning adapters serializing the gate's ordered scopes into actual plan bytes, with `**Spec:** none`, the single canonical linked path, or `**Spec:** multiple (see Governing specs)` matching section cardinality; a header-path or cardinality mismatch fails structurally;
- active-plan direct revise-code calls binding every upstream spec under the same ordering and ambiguity rules;
- direct revise-code identity using the stable selected plan or governing scope while cumulative-patch changes remain owned by code review and do not create a mid-implementation agreement loop;
- code-review fixes overlapping an active plan or governing artifact reconstructing the complete candidate and re-gating on identity change, while ordinary active-plan task edits and non-overlapping code fixes do not prompt;
- a secondary governing spec's selected slice changing while primary target and artifact bytes remain unchanged, moving `governingScopes` and invalidating approval;
- plan-review fixes and user requests that add, remove, repoint, reorder, or retarget upstream specs re-gating before another dispatch, while unrelated plan edits do not prompt;
- removing or reordering only collapsed duplicate upstream references leaving the canonical governing set unchanged and avoiding a prompt;
- a selected plan heading rename moving `target` and re-gating even when every upstream spec is unchanged;
- new sessions losing approval by construction;
- identity construction and storage failures stopping before lifecycle work;
- legacy markers being removed but never trusted, including preflight failure and every partial multi-file write state;
- a concurrent edit after cleanup preflight stopping before replacement, preserving that edit and any earlier successful removals for deterministic resume;
- absence of an atomic compare-and-replace capability leaving remaining markers untouched and stopping before lifecycle work;
- Claude Code and Codex taking that same no-provider branch, rendering exact reviewed-migration deletions, and succeeding only after the migration is applied and the complete governing set rescans clean;
- exact-looking legacy lines inside both backtick and tilde fenced examples remaining untouched;
- a BOM-prefixed first-line legacy marker being removed while the single leading BOM is preserved at byte zero;
- first, middle, and final legacy-marker removal preserving every untouched raw byte across LF, CRLF, bare CR, mixed-ending, and terminal-newline variants, including a final marker with and without its own terminator;
- fence-like body lines with non-whitespace suffixes not closing a fence, and an unclosed fence protecting through end of file;
- fenced heading and bullet lookalikes remaining selector content rather than creating entries, duplicates, or early boundaries;
- index-only, breakout, pattern, multi-artifact, section-scoped, and standalone governing specs;
- heading-form and bullet-form index entries producing distinct, boundary-correct identities;
- level-one, level-two, and level-three outside-fence headings terminating a heading-form entry at the correct boundary;
- repeated section heading paths being rejected as ambiguous rather than sharing an identity;
- two slices of one unchanged index entry producing distinct target identities through the raw declaration in `workUnit`, including colliding normalized keys;
- a colliding normalized slice key requiring exact raw-declaration selection or interactive clarification, with noninteractive ambiguity stopping rather than choosing the first match;
- fenced fake slice blocks being ignored while the real outside-fence slice declaration supplies `workUnit`;
- an unchanged entry moving between Exploring and a graduated section invalidating identity;
- direct selection of Exploring work returning to brainstorming;
- mixed graduated-plus-Exploring governing sets in direct plan and plan-backed code review, including an Exploring pattern or umbrella that joins only as an explicit co-governing artifact, reporting every unfinished artifact and routing the whole set to brainstorming;
- completed scopes cleaning selected legacy markers but avoiding an approval prompt;
- a unique archived unsliced index-only target and a final slice uniquely matched by its case-sensitive parser `displayName` taking handover's completion no-op without constructing an agreement candidate, while a duplicate display name or underspecified history match fails closed;
- explicit post-completion revise calls continuing after agreement rather than inheriting handover's no-op;
- explicit review of a completed sliced scope constructing `workUnit` from its exact struck declaration with `state: "shipped"` and producing a different identity from the unshipped form;
- missing or incomplete specs returning to brainstorming;
- rejection, absence, ambiguity, or failed comparison halting before the next phase;
- provenance-only edits proceeding without a redundant gate;
- inline agreement selection and hashing matching every expected selected-byte and digest value in `skills/spec-agreement/fixtures/fingerprint-v1.json`; when the later helper lands, its fixture suite consumes that exact file and proves `selectAndHashContent` parity rather than copying or regenerating the corpus;
- deterministic command and public-skill adapters invoking the shared gate without explicit handover wording;
- explicit direct `revise-spec`, `revise-plan`, and `revise-code` calls with an applicable governing candidate failing closed before dispatch when current approval is absent;
- spec-less direct plan and code adapters accepting `not-applicable` and continuing their existing review path;
- resume from `.tmp/revise-state.md` never recovering approval from durable scratch, while a separately retained same-session identity may continue only after a current-content comparison.

Runtime probes cover model-driven skill activation and session identity in every host context. An activation probe passes only when the real host, without explicit handover or skill naming, invokes the shared gate before substantive work for every listed applicable request and takes the documented `not-applicable` branch for a spec-less plan or code review. An identity probe passes only when exact candidate identity is retained for valid same-session continuation and rejected for a different or concurrent session; a context that cannot guarantee retention takes the safe re-presentation fallback:

- Claude Code natural-language validation, review, planning, and implementation requests each activate the shared gate when a governing candidate is discoverable, while spec-less plan and code review continue through `not-applicable`. (live-claim: provisional)
- Claude Code final-design presentation activates `final-presentation` mode before the approval response. (live-claim: provisional)
- Claude Code renders the same complete digest in separate fresh runs through final-presentation and lifecycle entry for a fixture with distinct sentinels for every governing artifact path, direct full-artifact link, requested target scope, selected work unit, goal, material exclusion, non-goal, material design decision, backlog dependency, external prerequisite, unresolved question, provisional live claim, and deferred live claim; every sentinel appears in its named field, every set member appears, and fenced or ordinary-related-link decoys do not. (live-claim: provisional)
- Codex natural-language validation, review, planning, and implementation requests each activate the shared gate when a governing candidate is discoverable, while spec-less plan and code review continue through `not-applicable`. (live-claim: provisional)
- Codex final-design presentation activates `final-presentation` mode before the approval response. (live-claim: provisional)
- Codex renders the same complete digest in separate fresh runs through final-presentation and lifecycle entry for the identical all-field sentinel fixture and passes the same path, link, scope, work-unit, set-completeness, and decoy-exclusion checks. (live-claim: provisional)

- Claude Code ordinary continuation retains the current identity and invalidates changed content. (live-claim: provisional)
- Claude Code compaction retains or safely loses the identity without reconstructing approval. (live-claim: provisional)
- Claude Code new-session entry cannot reuse the prior identity. (live-claim: provisional)
- Claude Code concurrent runs cannot observe each other's identity. (live-claim: provisional)
- Codex ordinary continuation retains the current identity and invalidates changed content. (live-claim: provisional)
- Codex compaction retains or safely loses the identity without reconstructing approval. (live-claim: provisional)
- Codex new-session entry cannot reuse the prior identity. (live-claim: provisional)
- Codex concurrent runs cannot observe each other's identity. (live-claim: provisional)

Static consistency checks prove that active instructions no longer create, trust, refresh, or fingerprint around durable sign-off or replacement status labels, while this file remains the sole historical rejection record. The ready parser fixture suite verifies the grammar, and a separate live `node skills/ready/ready.js .` check verifies the graduated feature, dependency edges, and removed Exploring entry leave the current backlog structurally valid. The revise round and rigor suites verify that the touched internal revise engine remains green. A final sibling sweep covers the shared agreement gate, handover, public revise wrappers and profiles, init-backlog templates, live indexes, repository instructions, README, and all three related designs.

New ready-parser fixtures are required for fenced fake headings, bullets, labels, and slice declarations because the common scanner changes structural recognition. The implementation plan must also give each remaining prose invariant a decidable post-edit search or scenario check.

## Requirements

- Agent-host-agnostic Nightshift: MVP - Universal skill entry points (pending; required so the handover skill is canonical and discoverable in Claude Code and Codex).
- Handover's governing-spec and target-scope resolution, stage ladder, task queue, unattended rule, and provenance fingerprints (existing; primary behavior migrated by the prerequisite).
- The four-index backlog templates and generated root `CLAUDE.md` block in the canonical init-backlog skill (existing after the prerequisite; reinforcement surface preserved by the later host-neutral scaffolding slice).
- The Exploring-to-graduated feature convention (existing; retained as the only durable draft distinction).
- The canonical fingerprint recipes in handover and revise (existing; Status exclusion removed).

**Requires:** [Agent-host-agnostic Nightshift: MVP - Universal skill entry points](agent-host-agnostic-nightshift.md).

## Hardening

- (None yet; this file has not completed a revise-spec run.)
