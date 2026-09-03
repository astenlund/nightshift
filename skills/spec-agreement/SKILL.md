---
name: spec-agreement
description: "Use for any standalone planning request; when a final governing design is being presented for agreement; or before validation, review, implementation, or handover whose governing spec is selected or discoverable."
---

# spec-agreement

This skill owns the interaction boundary between a governing design and substantive lifecycle work. It presents the current decision surface and accepts authority only from explicit agreement in the active session. Read `spec-agreement.js` beside this file and invoke its exported operations before validation, queue creation, review dispatch, planning, implementation, or another lifecycle transition. The controller owns deterministic bytes, paths, selectors, candidates, plans, comparisons, and state transitions. This skill owns discovery prompts, digest synthesis, response classification, semantic contract-fit judgment, and rendering.

Use this skill even when the user does not name Nightshift. Standalone planning always activates this skill, including when no governing spec is selected or discoverable. Its zero-scope path returns `{ agreement: "not-applicable", governingScopes: [] }` and still uses the `planning-result` and `serializePlanContract` contract. Natural-language requests to validate, review, implement, or hand over work activate it whenever a governing spec is selected or discoverable. A final governing design presentation also activates it before the approval response. Work nomination, backlog readiness, graduation, a prior-session response, and a diagnostic candidate token are never agreement.

The controller is callable two ways. Its exports take closed ordered shapes validated by `exactOrderedKeys`, including the filesystem adapter (`readFile`, `readDirectory`, `realpath`, `replaceFileAtomically`, in that order) and the ready-parser adapter (`normalizeSliceName`, `parseSlices`, `findSlicesByNormalizedName`); a hand-assembled record with a missing or reordered key fails as a structural error. The bundled CLI wraps those shapes: run `node spec-agreement.js` with one JSON envelope `{"operation": ..., "input": ...}` on stdin, operations `plan-parse`, `plan-serialize`, `resolve`, `candidate`, `locate`, `compare`, `diff`, `fit`, `state-create`, `state-refresh`, `state-invalidate`, `gate`, `legacy-detect`, `legacy-preview`, `provenance-write`, and `operating-context-write`, and read one `{ok, value | error}` envelope on stdout.

Driving the CLI, the closed shapes a caller cannot infer from prose: a `bullet-entry` selector is `{"parentHeading": "## <heading text including its hashes>", "entryTitle": "<the entire bullet text after the leading dash and space>"}` and an `index-entry` selector pairs `parentHeading` with `entryHeading` (the `### ` line, hashes included); `selectors` is always a one-element array of that record; in `lifecycle` and `handover` modes the resolver derives the governing set from `seeds` alone, so the target must also be passed as the first seed (with `seeds: []` the result is `brainstorming-required` with an empty `unfinished` list, a plausible-looking wrong answer rather than an error); every Buffer field crosses the CLI only under its hex alias: the complete input set is `planBytesHex`, `planBodyBytesHex`, `sourceBytesHex`, `selectedBytesHex`, `sourceSpansHex`, `rawLineHex`, and `sectionBytesHex`, while `bytesHex` and `replacementBytesHex` appear only in results, and a null Buffer stays `null` under the alias; `legacyDeletions` is `null` when `legacy-detect` found no markers; the `gate` operation returns `{kind, sessionState, digest, evidence}`; `revise-plan` mode requires the plan bytes and derives its seeds from the plan's `## Governing specs` contract (pass `seeds: []` unless co-governing seeds are intended), and `revise-code` mode does the same whenever plan bytes are supplied.

## Invocation modes

Choose one phase and map it to one controller request mode before calling `resolveGoverningSet`:

| Phase | Caller | Request mode |
|---|---|---|
| `lifecycle-entry` | handover | `handover` |
| `lifecycle-entry` | revise-spec wrapper | `revise-spec` |
| `lifecycle-entry` | revise-plan wrapper | `revise-plan` |
| `lifecycle-entry` | revise-code wrapper | `revise-code` |
| `lifecycle-entry` | standalone planning | `planning` |
| `lifecycle-entry` | any other natural-language validation, review, or implementation entry | `lifecycle` |
| `final-presentation` | brainstorming or another final-design flow | `final-presentation` |
| `planning-result` | any planner returning a plan | `planning` |
| `post-mutation` | active volatile flow | the originating request mode retained by that flow |
| `post-mutation` | durable revise resume with no retained volatile flow | the artifact-specific `revise-spec`, `revise-plan`, or `revise-code` mode |

Reject every other phase and caller combination before resolution. A durable revise resume derives only its artifact-specific mode. It never recovers approval, a response, a candidate, a digest, sources, or contract-fit evidence from durable state.

## Volatile controller context

Keep one host-provided, session-local `controllerContext` with exactly these roles:

- `sessionState`: null or the complete state returned by the controller;
- `pendingPresentation`: null or the complete digest, candidate, and ordered current sources retained immediately before rendering;
- `storeQuarantined`: whether the prior volatile store is forbidden for the rest of this session;
- `heldSections`: null or the held or overridden Operating context section and deviation entries per covered artifact, created by the shift-start check below, cleared with the pending presentation except across an override re-presentation, and released by a successful `operating-context-write`; a store quarantine clears it like any other pending-presentation loss and abandons the pending write;
- the originating request mode for `post-mutation` reuse.

Never write this context, any agreement record, candidate, digest, response, selected bytes, fit verdict, or fit evidence to the repository, review scratch, provenance, backlog metadata, or a cross-session cache. The one carve-out is that the agreed section bytes in `heldSections` leave this context through `operating-context-write` on the gate's `continue`, and by no other path. Loss or ambiguity takes the fresh-presentation path.

After a pure state operation, pass the returned complete next state or null to `replaceAgreementState`. On a storage failure, retry only in the exact uninterrupted turn while the candidate, response or verdict, and evidence remain unchanged and unambiguous. Outside that window, or after a failed retry, set caller-held `sessionState` and `pendingPresentation` to null, set `storeQuarantined` to true, and never read or write the quarantined store again in this session. Create a new volatile store only after a fresh stable digest has been presented and the user has responded to it.

## Entry procedure

### Resolve before substantive work

1. Resolve the requested target, ordered seeds, plan bytes when applicable, selected raw slice declaration when applicable, and caller permissions through `resolveGoverningSet`. Direct plan declarations are obtained only through `parsePlanContract`. Do not hand-assemble a replacement declaration list.
2. When handover resolution returns a `completed-no-op` resolution, pass it immediately with the unchanged closed request and repository adapters to `decideAgreementGate`. Report completion and stop only when the returned action is `completed-no-op`; every other action stops without authority. Do not attempt artifact scanning or candidate construction for this terminal result.
3. For every nonterminal active-artifact result, finish complete governing-set resolution before validation, queue creation, review dispatch, planning, or implementation. Ordinary related links do not join the set. Ask and stop when membership, target scope, selector, work unit, or ordering is ambiguous.
4. Map a permitted spec-less planning or code-review result directly to `{ agreement: "not-applicable", governingScopes: [] }`. A workflow that requires a spec treats the same absence as an error or routes to design.

### Review legacy deletions

Run `detectLegacyMarkers` over the complete resolved nonterminal active-artifact baseline before any active-artifact completion check, unfinished-design guard, or digest construction. When matches exist, run `previewLegacyMarkerDeletion` against that same baseline, render every path and exact deletion, and pass the complete evidence to `decideAgreementGate`. On `reviewed-migration`, stop without editing or applying the deletion. After a clean scan, including after the ordinary reviewed migration has been applied, discard the old baseline and restart complete resolution from disk. Never treat a legacy marker as authority.

For caller mode `handover`, yield control to handover after that clean rescan so it can evaluate its active-artifact completion no-op. Handover resumes this same procedure only when the no-op does not apply. Every direct revise wrapper executes the complete procedure without that yield; it records completion only as context and continues toward the requested review.

### Check completion and unfinished design

1. On handover resumption, preserve the controller-reported completion result and stop when the active-artifact completion no-op applies. A standalone revise request does not inherit it.
2. If resolution reports an incomplete design or any Exploring member, name every unfinished artifact, authorize none of the set, and route the whole scope to brainstorming.

### Run the shift-start operating-context check

Run this step only in request mode `handover` or `lifecycle`, after governing-set resolution and the unfinished-design guard have passed and immediately before the presentation baseline is captured, so a `brainstorming-required` outcome holds nothing and a design rewritten by brainstorming is derived fresh at the next shift start. In every other mode skip it: the digest still renders the field, the rigor line still renders for a complete section, and a tier election there is an ordinary requested change, routed under a standalone revise-spec run to that run's grounding step, which records it as a deviation entry, and under the revise-plan and revise-code wrappers, whose grounding step can record nothing, back to design like any other change to the governing spec's own section.

1. Run the grounding step of `internal/revise/spec.md` per governing artifact, excluding the index-entry companion the resolver adds beside a feature or bug breakout file, whose excerpt is a summary and whose breakout owns the section, so the field renders nothing for it and the write skips it. An artifact whose section is already complete keeps it; for each absent or skeletal member, derive the section from durable project knowledge and consult the user only when durable knowledge runs short. A skeletal section is held as its completed replacement, never as a from-scratch section.
2. Hold every derived or replaced section, and any deviation entries, in `heldSections`. Write nothing to a governing artifact here: nothing lands in a governing artifact before the user agrees to the digest. The grounding step's Persist substep still runs now, because the project instruction file it writes is not a governing artifact, so neither the hold rule nor the never-write carve-out reaches it.
3. Render every held and complete section in the digest's Operating context field, so the user verifies it with agreement.

### Build one stable presentation baseline

1. Read the complete resolved artifact set once. Use `selectArtifact` and `hashSelection` for each ordered snapshot, then call `buildCandidate` with that exact resolution and those selections.
2. Extract every digest field from the same selected baseline and its governing-scope resolution. Do not reread one representation while retaining another from an older read.
3. Rerun complete resolution and byte capture before presentation. Compare membership, order, paths, selectors, work units, and complete source bytes. On first drift, discard the candidate and digest and restart from a replacement baseline. On drift during the replacement attempt, stop with `unstable-governing-source`.
4. Set `pendingPresentation` to the complete stable digest, candidate, and ordered current sources before rendering any digest text or asking for agreement.

`candidateToken` may be displayed for diagnostics, but it is not authority and a response need not repeat it.

Both candidate hashes are selection-scoped: `contentHash` covers the canonical selected bytes and `sourceHash` the exact raw spans of that selection (for an `index-entry` or `bullet-entry`, the parent heading line plus the entry), so an edit elsewhere in the same index file moves neither, and `compareCandidates` reports `equal`. A change that touches only the selection's representation (line endings, BOM, terminal newline) moves `sourceHash` alone and classifies as representation-only in `buildDerivedDiff`; the whole-file read is for capture and the stability recheck, never for identity.

## Decision-complete digest

Render all fields below every time, without omitting a material decision for brevity:

1. **Governing artifacts**: every canonical path as a direct link to the full artifact, in candidate order. Render each link from `locateSelection` (CLI operation `locate`, input `{projectRoot, path, selectorKind, selectors, sourceBytesHex}` where `path` must be project-relative and canonically spelled (no absolute or drive-letter prefix, no backslash, no `..`, `.`, or empty segment) or the call fails as a `locate-input` structural error, result `{path, line, linkText, linkTarget, linkRendering?}`) over the same stable baseline bytes as the candidate, never from a fresh search and never composed by hand. When `linkRendering` is absent, render `[<linkText>](<linkTarget>)` exactly as before. When it is `osc8`, emit the exact sequence: U+001B, `]8;;`, `<linkTarget>`, U+0007, U+001B, `[36m`, `<linkText>`, U+001B, `[39m`, U+001B, `]8;;`, U+0007. This opens the OSC 8 hyperlink, selects ANSI cyan, emits the label, restores only the foreground color, and closes the hyperlink. The controller owns the link rule: for an `index-entry` or `bullet-entry`, `linkText` is `<path>:<line>` (the one-based line where the selected entry starts) and `linkTarget` is the environment variable `NIGHTSHIFT_LINE_LINK_FORMAT` with `{path}` replaced by the absolute forward-slash path and `{line}` by the line (the ripgrep `--hyperlink-format` placeholders, so one editor-protocol format such as `subl://open?url=file:///{path}&line={line}` serves both tools). When the line format is unset or empty, `linkTarget` is the bare absolute path. A `design-before-hardening` selection returns `line: null` and `linkText` equal to the path; in `osc8` mode, `linkTarget` is `NIGHTSHIFT_FILE_LINK_FORMAT` with every `{path}` replaced by the absolute forward-slash path, or the bare absolute path when that format is unset or empty. The CLI reads all three variables itself, rejects caller-owned format fields, returns no `linkRendering` field when `NIGHTSHIFT_LINK_RENDERING` is unset or empty, and accepts only `osc8` as an explicit rendering mode. The caller never detects the host or selects the rendering mode.
2. **Requested target**: the stable requested lifecycle or review scope.
3. **Selected work units**: every governing seed scope, selector, and work unit in governing-scope order.
4. **Goal**: the requested outcome, with positive source-backed content.
5. **Material exclusions**: every exclusion.
6. **Non-goals**: every non-goal.
7. **Material decisions**: every decision, with positive source-backed content.
8. **Backlog dependencies**: every upstream backlog dependency.
9. **External prerequisites**: every external prerequisite.
10. **Unresolved questions**: every unresolved decision boundary.
11. **Provisional or deferred live claims**: every such claim and its disposition.
12. **Operating context**: one block per governing artifact the check covers, in candidate order, excluding the index-entry companion the resolver adds beside a feature or bug breakout file. Each block opens with the line `<artifact> (<marker>)` using this digest's own artifact identifier (`<path>:<line>` for an index or bullet entry, the bare path for a file spec), where the marker is `complete` for a complete section rendered from the presented baseline, `derived, written on agreement` for a held section, `overridden, written on agreement` for any member carrying an override, or `absent` or `skeletal (<reason>)` when nothing is held; then the section body; then the rigor line. A section derived from scratch renders normalized to the same top-level bullets whatever placement shape the artifact uses, so an indented continuation, a heading-form block, and a file section render identically. A complete section renders its bytes as written. An overridden complete member, and a skeletal section held as its completed replacement, render the artifact's authored bytes with only the derivation record rewritten in place, or inserted in the section's own authored form when the section carries none (the Derived rigor bullet immediately after the last input bullet when the inputs are bullets, a trailing derivation paragraph after the last paragraph when they are prose, the record closing the section after any appended input bullets), and the skeletal case appends its missing inputs as bullets, so authored prose is never discarded. A governing set may mix these markers, and identical sections render in full. `<reason>` lists every failing skeletal rule in letter order, each with its missing or offending items comma-separated and rules separated by semicolons: rule (a) items are the six input labels `deployment`, `audience`, `failure`, `concurrency`, `reversibility`, and `lifetime` rendered in that order, rule (b) has the single item `derivation`, and rule (c) the single item `tier`, for example `skeletal (a: deployment, audience; c: tier)`; rule (b) fires whenever the section carries no derivation record, and rule (c) only when the section states a tier, so a section that states no tier reports `b: derivation` and never `c: tier`. When a caller in any other mode presents before its grounding step has run, every artifact renders `absent` or `skeletal (<reason>)` with a note that a standalone revise-spec run's grounding step derives it, never an inferred section; under the revise-plan wrapper, which raises its structural-precondition error, and under revise-code, which has no grounding step, the marker stands as rendered.

    Every complete or held section closes with the settled rigor on its own line, in one of two literal forms: `Rigor: <tier> (derived: <audience category>, <n> uplifts fired); effort: validation <v>, recovery <v>, compatibility <v>, observability <v>, proofEffort <v>` for a derived tier, or `Rigor: <tier> (overridden by user <date>: <basis>; derived: <derived tier> from <audience category>, <n> uplifts fired); effort: validation <v>, recovery <v>, compatibility <v>, observability <v>, proofEffort <v>` for an overridden one. An `absent` or `skeletal` artifact closes with `Rigor: not derived` instead. The parenthetical repeats the two derivation inputs, taken for a held section from what the controller passed to `internal/revise/rigor.js`, which reports only the tier and the effort, and for a complete section from its own derivation record, whether that record is a `- **Derived rigor**:` bullet or a trailing derivation paragraph, both shipped forms. The effort tail is rendered from the derivation rule's Step 3 for the settled tier in the literal spellings above whatever spelling the section's own record uses, and the `<n>` slot renders as a numeral and the `<audience category>` slot in the derivation rule's own spelling, both recomputed from the inputs the record names rather than copied from its prose. The `<basis>` slot everywhere is the user's words normalized to one line, whitespace runs collapsed and any backtick or semicolon removed so the literal grammars stay parseable, or the literal `none stated` when the user gave none. The line exists so the user can override the final tier at the same reading.

    A tier divergence across the set, meaning the settled tiers of the covered artifacts that have a tier are not all equal, renders as one further line `Divergence: <artifact> <tier>; <artifact> <tier>` over every artifact the check covers, in candidate order, showing each member's settled tier and rendering `<artifact> not derived` for an absent or skeletal member. Artifacts without a tier never trigger it, it is recomputed on every re-presentation, and the user may resolve it at the same reading through an override or a requested change. A divergence left standing at agreement is not an error: each artifact keeps its own section, and the review run surfaces the divergence as the finding `internal/revise/plan.md` already defines.

For each set-valued field, render every concrete source-backed member. If the governing text explicitly states an empty set, render exactly `none explicitly stated`. If a complete governing-set review finds no item, render exactly `none found after full governing-set review`. Do not infer either form merely from a missing heading when the boundary is genuinely ambiguous. A missing or source-empty goal, or missing or source-empty material decisions, means the design is not decision-complete and returns to brainstorming.

Ignore fenced lookalikes. An ordinary related link is not a governing artifact or digest source unless the selected artifact or current user instruction explicitly makes it part of the implementation contract. Do not dump full long artifacts into the digest; the direct links preserve access to the complete sources.

## Response and authority creation

Classify only the immediate response to the displayed digest into one closed volatile `responseDecision`:

- explicit unqualified agreement: `agree`;
- a request to change the design: `changes-requested`;
- explicit rejection: `decline`;
- anything else, including partial, conditional, stale, or ambiguous assent: `ambiguous`.

Bind the decision to the exact digest just presented and retain nonblank current-session response evidence. Reconstruct the complete candidate and ordered sources from disk after the response. Pass the pending tuple, reconstructed tuple, response, and other closed gate input to `decideAgreementGate`. Only its `continue` result after `createAgreementState` may create authority. If reconstruction differs from the presented tuple, discard the response, replace the pending presentation with a freshly stable digest, and ask again.

On `return-to-design`, clear pending state and return to brainstorming or localized design editing. On `stop-declined` or `stop-ambiguous`, clear pending state and stop without validation, dispatch, planning, or implementation. A successful `final-presentation` transfers the returned state into this same volatile session before the presenting flow returns. Rejection, requested changes, or abandonment before transfer clears it.

For a `continue` action, pass `action.sessionState` unchanged to `replaceAgreementState`. Then return a caller result containing `agreement` from the nested agreement record and the resolution's ordered `governingScopes`. For `planning-result`, every planner must consume that result and invoke `serializePlanContract`; a planner may not substitute prose links or hand-built declarations.

## Post-agreement operating-context write

This section and its override channel apply only in request modes `handover` and `lifecycle`.

**Override.** A reply that elects a different tier is a design change with its own lifecycle rather than a plain agreement. Until an unambiguous qualified agreement is accepted without re-presentation, an override names one or more members or, when it names none, applies to every member of the set, and each affected member gets its own deviation entry. The deviation entry is the rewritten Derived rigor bullet itself, in the literal form `- **Derived rigor**: overridden by user <date>: <basis>; derived tier <derived tier> from audience <category> plus <n> fired uplifts via node internal/revise/rigor.js; effective tier <tier>; per-dimension effort: validation <v>, recovery <v>, compatibility <v>, observability <v>, proofEffort <v>`, so the bullet never asserts that the derivation command yields the overridden tier, and no separate line is written because the bullet already has a literal form and a placement site. For a held member the entry lands in the held section and that section's derivation record is rewritten in whichever form it has, so the member renders marked `overridden, written on agreement` exactly as an overridden complete member does; for a complete member the controller holds that member's section as its overridden replacement, so an overridden complete member becomes a written member on `continue` and the untouched-members rule below applies only to members without an override. A further override on the re-presented digest supersedes the earlier one: its deviation entry replaces the earlier entry and still names the derived tier, never the superseded election. An override keeps the held sections through its re-presentation, and it is the one requested change that edits the held sections in memory instead of discarding them, because discarding would re-derive the same sections, could re-fire the shift-start consult mid-agreement, and would lose the deviation entry just recorded. Re-present the digest with the overridden tier and accept a plain agreement on that presentation. The grounding step's skeletal rule (c) reads a tier backed by a user-override deviation entry as complete, and per-dimension effort follows the overridden tier through the derivation rule's Step 3.

**Write.** On the gate's `continue`, when no section is held and no override was recorded, skip the write entirely: no boundary call, and the echo line reads `Operating context: no writes (no held sections)`. Otherwise write each held section, with its deviation entries, into its own governing artifact per the grounding step's placement rules, one governing scope at a time in candidate order, through `operating-context-write` in `spec-agreement.js`, which inserts or replaces one artifact's Operating context section at its placement site through the same per-file atomic replacement, readback, and applied-retry path the provenance writer uses. Its already-applied predicate is that the artifact's current bytes at the placement site equal the intended section bytes, which makes a retried write an idempotent no-op success rather than a stale baseline. Capture each member's complete-file baseline hash immediately before that member's own write, so sequential writes into one file do not invalidate each other; an edit to a governing selection between presentation and `continue` is caught earlier by the gate's reconstruction check, and an edit elsewhere in the same file is tolerated because the write replaces only the section site. Leave complete members untouched. Then run the grounding step's fingerprint step and pass the whole write through the `post-mutation` boundary, where the digest's own Operating context field is the containment evidence citing every hunk for a `within-contract` verdict through the `operatingContext` member of the controller's closed citation vocabulary.

**Failure.** A returned per-file write failure on any member, whether an adapter error, a readback mismatch, or a stale baseline caused by a concurrent writer, halts before the post-mutation boundary: invalidate authority, leave the already-written prefix in place, and report which members were written and which failed. Any verdict other than `within-contract` on a completed write is a controller or judge defect, since the written block is the digest's held section in the artifact's placement shape and the semantic judgment is told through the `operatingContext` citation that the field's normalization rule already maps every placement shape to the rendered bullets: invalidate authority, leave the writes in place, and halt reporting the verdict evidence. Under the unattended rule either halt stops the run without authority.

**Echo.** After a successful boundary, echo one line the user can check at a glance, in the literal form `Operating context: wrote <n> (<artifact> <tier> <derived|overridden>; ...); deviation entries <k>; persisted <yes|no>`, listing every written artifact in candidate order by the digest's artifact identifier, so the line grows by one item per written artifact and never wraps to a second line, where `persisted` is a single per-run boolean that reads `yes` when the shift-start Persist substep wrote consult-gathered facts to the project instruction file for at least one covered artifact and `no` otherwise.

**Held-section lifecycle.** A decline, an abandoned presentation, or a requested change other than a tier override discards the held sections with the pending presentation, so a rejected digest leaves the backlog untouched, while the shift-start Persist write stays in place on every discard branch because it records durable project facts rather than this design decision. A reply carrying both a change and an override discards and re-derives, then re-applies the override to the re-derived sections. After a requested change the next presentation re-derives and re-holds the sections first. A volatile-store failure that quarantines the store discards them with the pending presentation and abandons any write a `continue` had triggered but not yet performed, and the stability recheck does the same when it restarts from a replacement baseline, re-applying any recorded override to the re-derived sections exactly as a combined reply does, so no held section outlives the bytes it was derived from and no election is lost to drift; the consult re-fires only if durable knowledge again runs short, which lands on the present user. A crash between agreement and the last write leaves a prefix of the set written, which is a designed state rather than corruption: the next shift start finds the written members complete and the rest absent or skeletal, derives and holds sections only for the rest from the same durable knowledge, presents the mixed set in the digest, and on agreement writes only the missing members, so the half-written state converges without rollback. An override recorded at agreement but not yet written is lost with the session like any held section, the next presentation shows the derived tier again, and no override is inferred from a crashed run.

## Retained authority and contract fit

Reconstruct from one stable baseline before reusing retained authority. Use `compareCandidates` against the retained current candidate.

- `equal`: continue immediately after the controller validates the candidate-to-source tuple.
- Structural candidate change: accept the controller's deterministic `changes-contract` result. Do not invoke semantic judgment.
- Source change: call `buildDerivedDiff`. Representation-only hunks are deterministic and need no semantic judgment. Invoke semantic judgment only when one or more canonical hunks exist.

For canonical hunks, judge every hunk against the exact accepted digest. Return compact canonical JSON with exactly `verdict`, `reason`, and `citations`, using only `within-contract`, `changes-contract`, or `uncertain`. Cite the owning canonical path, global one-based hunk, and named digest fields. A `within-contract` result must cover every canonical hunk. Return a valid `uncertain` whenever decisive evidence is missing, classification fails, a citation cannot be grounded, or containment within the accepted digest cannot be proved. Pass the raw semantic result through `validateContractFitVerdict`; never continue on an unvalidated judgment.

Exact equality, representation-only change, or a validated `within-contract` result continues autonomously only when no held Operating context section is still unpresented; a held section not yet shown to the user is part of the decision surface and forces a fresh presentation instead. A successful `operating-context-write` releases the held set, so written members become complete members and every later boundary in the run continues on retained authority as before. For compatible source change, call `refreshCompatibleState`, pass its complete state unchanged to `replaceAgreementState`, retain its cited fit evidence for volatile verifier context, and continue without asking the user.

For validated `changes-contract`, render its evidence and the refreshed decision-complete digest first. Then call `invalidateAgreementState({ reason: "changes-contract" })`, replace the volatile store with null, and set caller-held state to null before awaiting or accepting renewed agreement. Old authority is unreadable while renewal is pending.

For semantic `uncertain` or a controller-owned fit validation failure, render the uncertainty evidence and refreshed digest first. Then invalidate the old authorities and enter normal fresh presentation. Never treat a failed classifier as a clean check.

## Post-mutation boundary

Invoke `post-mutation` after one complete batch that can alter a governing artifact, governing set, target, or plan declarations, and before another reviewer, verifier, planning step, implementation step, or downstream transition. Reuse the originating request mode retained in the active volatile flow. A durable revise resume derives only its artifact-specific mode and starts with null approval state.

Ordinary implementation changes do not re-enter this gate. The narrow post-implementation exception is a review-controller mutation that overlaps a governing artifact or changes an active plan's selected target or governing declarations.

## Outcome handling and invalidation

Handle only the closed actions returned by `decideAgreementGate`:

- `continue`: store the complete state and proceed;
- `not-applicable`: return the literal caller result described above;
- `present-digest`: retain a complete pending presentation before rendering and await a new response;
- `render-uncertain-then-present`: render evidence and digest, invalidate, then start fresh presentation;
- `return-to-design`: route to design and stop lifecycle work;
- `stop-declined`, `stop-ambiguous`, or `stop-error`: report and stop;
- `reviewed-migration`: render the reviewed deletion and stop without applying it;
- `brainstorming-required`: report every unfinished member and route to brainstorming;
- `completed-no-op`: report completion and stop.

Invalidate through `invalidateAgreementState` and volatile replacement on lifecycle completion, abandonment, rejection, and session end. Clear `pendingPresentation` on successful creation, requested changes, decline, ambiguous stop, invalidation, completion, abandonment, and session end. Never reconstruct agreement from a prior response, readiness state, provenance, a durable revise checkpoint, or a diagnostic token.
