---
name: spec-agreement
description: "Use for any standalone planning request; when a final governing design is being presented for agreement; or before validation, review, implementation, or handover whose governing spec is selected or discoverable."
---

# spec-agreement

This skill owns the interaction boundary between a governing design and substantive lifecycle work. It presents the current decision surface and accepts authority only from explicit agreement in the active session. Read `spec-agreement.js` beside this file and invoke its exported operations before validation, queue creation, review dispatch, planning, implementation, or another lifecycle transition. The controller owns deterministic bytes, paths, selectors, candidates, plans, comparisons, and state transitions. This skill owns discovery prompts, digest synthesis, response classification, semantic contract-fit judgment, and rendering.

Use this skill even when the user does not name Nightshift. Standalone planning always activates this skill, including when no governing spec is selected or discoverable. Its zero-scope path returns `{ agreement: "not-applicable", governingScopes: [] }` and still uses the `planning-result` and `serializePlanContract` contract. Natural-language requests to validate, review, implement, or hand over work activate it whenever a governing spec is selected or discoverable. A final governing design presentation also activates it before the approval response. Work nomination, backlog readiness, graduation, a prior-session response, and a diagnostic candidate token are never agreement.

The controller is callable two ways. Its exports take closed ordered shapes validated by `exactOrderedKeys`, including the filesystem adapter (`readFile`, `readDirectory`, `realpath`, `replaceFileAtomically`, in that order) and the ready-parser adapter (`normalizeSliceName`, `parseSlices`, `findSlicesByNormalizedName`); a hand-assembled record with a missing or reordered key fails as a structural error. The bundled CLI wraps those shapes: run `node spec-agreement.js` with one JSON envelope `{"operation": ..., "input": ...}` on stdin, operations `plan-parse`, `plan-serialize`, `resolve`, `candidate`, `locate`, `compare`, `diff`, `fit`, `state-create`, `state-refresh`, `state-invalidate`, `gate`, `legacy-detect`, `legacy-preview`, and `provenance-write`, and read one `{ok, value | error}` envelope on stdout.

Driving the CLI, the closed shapes a caller cannot infer from prose: a `bullet-entry` selector is `{"parentHeading": "## <heading text including its hashes>", "entryTitle": "<the entire bullet text after the leading dash and space>"}` and an `index-entry` selector pairs `parentHeading` with `entryHeading` (the `### ` line, hashes included); every Buffer field crosses the CLI only under its hex alias: the complete input set is `planBytesHex`, `planBodyBytesHex`, `sourceBytesHex`, `selectedBytesHex`, `sourceSpansHex`, and `rawLineHex`, while `bytesHex` and `replacementBytesHex` appear only in results, and a null Buffer stays `null` under the alias; `legacyDeletions` is `null` when `legacy-detect` found no markers; the `gate` operation returns `{kind, sessionState, digest, evidence}`; `revise-plan` mode requires the plan bytes and derives its seeds from the plan's `## Governing specs` contract (pass `seeds: []` unless co-governing seeds are intended), and `revise-code` mode does the same whenever plan bytes are supplied.

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
- the originating request mode for `post-mutation` reuse.

Never write this context, any agreement record, candidate, digest, response, selected bytes, fit verdict, or fit evidence to the repository, review scratch, provenance, backlog metadata, or a cross-session cache. Loss or ambiguity takes the fresh-presentation path.

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

### Build one stable presentation baseline

1. Read the complete resolved artifact set once. Use `selectArtifact` and `hashSelection` for each ordered snapshot, then call `buildCandidate` with that exact resolution and those selections.
2. Extract every digest field from the same selected baseline and its governing-scope resolution. Do not reread one representation while retaining another from an older read.
3. Rerun complete resolution and byte capture before presentation. Compare membership, order, paths, selectors, work units, and complete source bytes. On first drift, discard the candidate and digest and restart from a replacement baseline. On drift during the replacement attempt, stop with `unstable-governing-source`.
4. Set `pendingPresentation` to the complete stable digest, candidate, and ordered current sources before rendering any digest text or asking for agreement.

`candidateToken` may be displayed for diagnostics, but it is not authority and a response need not repeat it.

## Decision-complete digest

Render all fields below every time, without omitting a material decision for brevity:

1. **Governing artifacts**: every canonical path as a direct link to the full artifact, in candidate order. When the selection is an `index-entry` or `bullet-entry`, the link text is `<path>:<line>`, the one-based line where the selected entry starts, taken from `locateSelection` (CLI operation `locate`, input `{path, selectorKind, selectors, sourceBytesHex}`, result `{path, line}`) over the same stable baseline bytes as the candidate, never from a fresh search. The link target comes from the environment variable `NIGHTSHIFT_LINE_LINK_FORMAT` when it is set: substitute `{path}` with the absolute forward-slash path and `{line}` with the line (the ripgrep `--hyperlink-format` placeholders, so one editor-protocol format such as `subl://open?url=file:///{path}&line={line}` serves both tools). When it is unset, the target is the bare file path: terminal link handlers open a file but ignore a `#L<line>` fragment or `:<line>` suffix, and a suffixed target silently stops opening at all. A `design-before-hardening` selection returns `line: null` and links the bare path with the path alone as text.
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

## Retained authority and contract fit

Reconstruct from one stable baseline before reusing retained authority. Use `compareCandidates` against the retained current candidate.

- `equal`: continue immediately after the controller validates the candidate-to-source tuple.
- Structural candidate change: accept the controller's deterministic `changes-contract` result. Do not invoke semantic judgment.
- Source change: call `buildDerivedDiff`. Representation-only hunks are deterministic and need no semantic judgment. Invoke semantic judgment only when one or more canonical hunks exist.

For canonical hunks, judge every hunk against the exact accepted digest. Return compact canonical JSON with exactly `verdict`, `reason`, and `citations`, using only `within-contract`, `changes-contract`, or `uncertain`. Cite the owning canonical path, global one-based hunk, and named digest fields. A `within-contract` result must cover every canonical hunk. Return a valid `uncertain` whenever decisive evidence is missing, classification fails, a citation cannot be grounded, or containment within the accepted digest cannot be proved. Pass the raw semantic result through `validateContractFitVerdict`; never continue on an unvalidated judgment.

Exact equality, representation-only change, or a validated `within-contract` result continues autonomously. For compatible source change, call `refreshCompatibleState`, pass its complete state unchanged to `replaceAgreementState`, retain its cited fit evidence for volatile verifier context, and continue without asking the user.

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
