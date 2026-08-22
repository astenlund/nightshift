# Contract-calibrated revise admission

Feature: separate factual verification from authority to change the artifact, then let a review cell certify when every true finding is outside the approved contract. This file is the authoritative design record.

## Scope anchor

Requested outcome: stop revise hardening from turning factually true but unauthorized findings into edits or follow-ups, while preserving the correctness floor, autonomous execution, and bounded convergence.

Material exclusions: no reviewer observations schema, cross-round skeptic-verdict reuse, context-reset design, cross-run issue database, automatic backlog capture, model-vendor policy, or new round-cap policy.

## What it does

Nightshift currently separates reviewer discovery from skeptic truth verification, but a `CONFIRMED` verdict still routes directly to a fix or authoritative follow-up. The missing decision is whether the true claim is work the user authorized. The two retained incidents show both failure forms:

- A repository-relocation review developed a complete host-history migration system even though the user only wanted the relocation record corrected and later explicitly rejected history migration.
- Universal-entry hardening deepened tentative installed-host smoke machinery until a product design contained process, evidence, locking, and recovery protocol detail. The eventual correction retained the observable discovery requirement and moved implementation technique out of the specification.

This feature adds a controller-owned admission decision after skeptic verification and before repair. It consumes the Durable scope anchor as the primary user contract, verified inherited constraints as supplementary authority, the correctness floor as a non-negotiable baseline, Operating context as the rigor input, and design provenance as repair-altitude context. Every authority source is frozen and cited; truth and actionability remain separate records.

## Contract sources by artifact type

Every run freezes one contract set and its digest before dispatch:

- **Spec review:** the complete approved `## Scope anchor` in the spec under review.
- **Plan review with governing specs:** every governing spec's complete anchor. Conflicting requested outcomes or exclusions are a structural precondition error. The controller does not select one or weaken either.
- **Code review with governing plans or specs:** the resolved governing set's anchors, preserving each source identity.
- **Legitimately spec-less plan or code review:** the interactive entry point captures an equivalent run-local basis with the same `Requested outcome` and `Material exclusions` labels, presents it for approval, and persists the approved text in revise state for that review. It is not written into an unrelated artifact merely to create storage. A later review captures a fresh basis.

A new spec review without a complete anchor backfills it interactively before launch. This preflight happens before revise-state creation. An autonomous fresh review without either complete governing anchors or an already approved run-local basis atomically adds one canonical handover follow-up for the artifact and resolved scope, using `sourceItemId: admission/missing-contract` and `proposedRoute: resolve-contract`, then stops without creating review state. The existing `(source, sourceItemId)` key makes the write idempotent. Implementation detail, commit contents, artifact headings, and reviewer inference cannot silently manufacture authority.

The controller also freezes the exact Operating context sections and any durable Design provenance section relevant to the reviewed artifact. These do not expand the contract. Operating context governs how deeply admitted work must be engineered. Provenance explains why a mechanism exists and which abstraction owns a repair.

## Eligible authority catalog

Before the first reviewer launch, the controller builds one source-qualified authority catalog and supplies it unchanged to every review decision consumer:

- `scope-anchor`: each governing spec identity plus its exact approved anchor text;
- `run-basis`: source identity `run-local:<artifact-type>:<resolved-scope>` plus the exact approved spec-less basis text; the contract-context fingerprint distinguishes later reviews without depending on the separate durable-run-identity feature;
- `verified-constraint`: an exact normative sentence from a governing spec or plan, an applicable repository instruction file, or a platform contract verified from its installed source or published primary documentation, together with that source's stable identity and captured content;
- `correctness-floor`: an exact non-negotiable correctness or safety criterion already declared by the applicable bundled artifact profile or another eligible verified-constraint source, together with the bundled file or durable source identity and captured content.

A reviewer assertion, repository implementation detail, convention inferred from neighboring code, or uncited general best practice is not authority. The first implementation does not mint a universal correctness catalog from controller intuition: if no eligible source states the claimed floor, `correctness-floor` cannot admit the finding.

Initial source discovery completes before dispatch. A reviewer may identify a candidate constraint that was missed, but the current round cannot use it immediately. At the evaluated boundary the controller verifies its exact source and applicability, adds it through a contract-context refresh, clears all current actionability and certification state, and redispatches under the expanded catalog. An unavailable source, ambiguous applicability, a conflict with the approved anchor, or inability to capture the exact text produces `uncertain`; convenience never turns it into authority.

## Contract context lifecycle

New revise state records:

- `Admission policy: contract-v1`;
- the exact contract-source identities and approved text;
- every eligible supplementary-authority classification, stable source identity, and exact captured text;
- a contract-context fingerprint over the contract text, governing-set identities, supplementary-authority catalog, Operating context sections, and relevant durable provenance supplied to the run.

Creation occurs before the first reviewer launch. Refresh occurs only after an approved anchor or run-basis revision, a governing-set change, an eligible authority addition, removal, source-text change, or applicability change, or a change to included Operating context or provenance. Because the catalog is shared common context, refresh clears every current actionability decision, contract-clean certification, pending admission question, and verifier stamp before redispatch. A source that cannot be reverified is unavailable authority and makes any decision that needs it `uncertain`. Artifact edits that do not change contract context leave the contract-context fingerprint stable.

The run deletes its state copy during normal cleanup. Durable spec anchors and provenance remain in their source specs. A run-local basis is intentionally scoped to one review and is recaptured later.

An already active checkpoint without `Admission policy` is legacy. It continues under the pre-admission clean-LGTM and adjudication rules or is explicitly abandoned and restarted. The new engine keeps that compatibility branch; it never silently inserts `contract-v1` into an in-flight run.

## Factual verdict and actionability record

Every finding still receives the existing complete skeptic verdict, directly or through a valid same-round shared verdict. A `REFUTED` finding keeps the existing reasoned-acknowledgement route and receives no actionability record. Each `CONFIRMED` or `JUDGMENT_CALL` finding then receives exactly one compact controller-owned record:

- `Actionability`: `admitted`, `out-of-contract`, or `uncertain`;
- `Basis`: `scope-anchor`, `run-basis`, `verified-constraint`, `correctness-floor`, or `none`;
- `Citation`: exact source-qualified governing sentence or sentences, or raw `none` only for an uncertain result with no usable authority;
- `Reason`: the concise causal explanation.

The valid combinations are complete and closed:

| Actionability | Valid basis | Citation |
|---|---|---|
| `admitted` | `scope-anchor`, `run-basis`, `verified-constraint`, or `correctness-floor` | One or more exact sentences from the frozen authority catalog. |
| `out-of-contract` | `scope-anchor` or `run-basis` | The exact requested-outcome or exclusion sentence that bounds the finding. |
| `uncertain` | `none` | Every exact conflicting or insufficient candidate sentence when available; raw `none` only when authority or its citation is absent or unverifiable. |

Only a record that matches this matrix is a complete actionability result. A mechanically malformed candidate, missing field, invalid enum, contradictory combination, serialization failure, or controller execution error is rejected as incomplete admission work and follows bounded technical repair below; it never becomes a user-facing `uncertain` result. `admitted` requires a non-`none` basis and exact citation. A necessary enabler is `admitted` only when the reason demonstrates that the anchored outcome or cited correctness invariant cannot hold without it. Greater completeness, convenience, robustness, or future value is not a causal trace.

`out-of-contract` covers both adjacent improvements and explicit exclusions. Its citation and reason preserve which case applies. It authorizes no artifact edit, authoritative follow-up, or automatic backlog entry.

`uncertain` covers a valid semantic result with missing or unverifiable authority, conflicting anchors, a verified constraint that conflicts with an exclusion, or an undecidable necessary-enabler claim after the available sources were evaluated successfully. It authorizes no edit or certification.

The reviewer may suggest why a finding matters, but does not decide actionability. The skeptic verifies the factual claim and remains independent of controller scope judgment. The holistic verifier may challenge a prior actionability decision as a new finding, but cannot rewrite an anchor or declare its own broader contract.

## Durable result and crash behavior

The complete skeptic verdict is persisted before admission. A confirmed or judgment-call finding then enters `awaiting-admission` with `Admission repair attempts: 0`; only a complete actionability record makes it adjudicable. The controller persists the complete actionability unit before applying an edit, creating a follow-up, or certifying contract-clean.

Mechanical admission failure preserves `awaiting-admission` and no actionability record. Before each technical retry, the controller atomically increments that finding's `Admission repair attempts`; the existing execution-repair limit of three applies, so this adds no new cap policy. A valid record completes the work and preserves the final counter for diagnostics. Exhaustion sets existing run `Status: failed` with the exact admission validation or execution error in `Failure`, preserves the round and every complete result, and permits only the existing explicit retry or abandon lifecycle. An authorized retry resets only the affected admission counter after confirming round, artifact fingerprint, delivery snapshot, and contract-context fingerprint still match. Technical failure never asks the user to redefine the contract.

The expected crash states are:

1. **Verdict absent:** the finding remains pending skeptic repair and authorizes nothing.
2. **Verdict present, admission absent:** resume performs or technically repairs admission against the frozen contract context and preserved repair counter; no edit or certification has occurred.
3. **Admission present, artifact unchanged, boundary absent:** resume replays boundary selection from the durable result and checks the current artifact and contract fingerprints before acting.
4. **Admission present, artifact moved, boundary absent:** an edit may have succeeded before its ledger rewrite. Resume never reapplies it. It follows the existing unexplained-drift path in `internal/revise/SKILL.md`: interactive confirmation records the missing applied-change evidence and refreshes identity; rejection or unresolved ambiguity records abandonment; autonomous operation records unexplained abandonment and continues under the moved fingerprint. The implementation adds no prepared-mutation journal for review fixes.
5. **Boundary present:** applied changes, follow-ups, acknowledgements, cell certification, and stamp basis in revise state are authoritative. Resume never re-applies an already recorded mutation.

Actionability remains in the current round result until the next round replaces it. Its durable consequences use existing run-wide sections: admitted edits and follow-ups include the basis citation, while out-of-contract findings become reasoned acknowledgements. A contract-clean certification additionally records its certification kind in the cell row, so replacing round scratch cannot turn it into an unexplained LGTM.

## Uncertainty stop lifecycle

Admission adds run status `awaiting-admission-decision` plus a `Pending admission questions` section inside existing revise state. An evaluated round containing any valid semantic `uncertain` result persists one question per uncertain finding. Each question stores round, contract-context fingerprint, artifact fingerprint, a 12-hex SHA-256 digest of the exact canonical delivery snapshot, finding ID, reason, and every available candidate citation; its stable ID is derived from that complete identity tuple. One atomic boundary rewrite creates the complete question set and changes status. The boundary applies no edit, creates no authoritative follow-up, certifies no cell, and writes no verifier stamp from that round, including for otherwise admitted sibling findings. This whole-round fail-closed rule avoids applying a sibling edit that could invalidate the unresolved finding's evidence or repair surface.

While status is `awaiting-admission-decision`, no reviewer, skeptic, verifier, or repair dialogue launches. In an interactive standalone run, the controller presents the persisted question and offers contract clarification or explicit run abandonment. A user answer changes authority only through an approved anchor or run-basis revision or a verified authority-catalog refresh; that refresh invalidates the round's actionability records and pending questions, returns status to `reviewing`, and redispatches under the new contract context. A denial that supplies no scope decision leaves the same question and status in place rather than consuming a round.

In autonomous handover, only after that revise-state rewrite succeeds, the controller atomically writes the complete new follow-up-list contents with one canonical JSON line per question using the exact schema from `skills/handover/SKILL.md`. `source` identifies the artifact type, artifact identity, and resolved scope; `sourceItemId` is `admission/<round>/<contract-context-fingerprint>/<artifact-fingerprint>/<delivery-snapshot-digest>/<finding-id>`; `text` carries the exact decision request, finding, reason, and citations; `proposedRoute` is `resolve-contract`. The pair `(source, sourceItemId)` is the idempotency key. A crash before the follow-up-list rewrite leaves authoritative pending questions that resume adds; a crash after it sees the same keys and adds nothing. Handover then stops as genuinely blocked work and leaves revise state at `awaiting-admission-decision`; it never loops the active cell or manufactures a morning answer.

Revise state remains authoritative over copied admission questions. Before presenting or adding handover items on every resume, reconcile only admission-owned entries against `Pending admission questions`: add a missing live copy and remove a copy whose key is no longer live, leaving every non-admission follow-up untouched. If artifact fingerprint, delivery snapshot, or contract context differs while awaiting a decision, do not present the stale question. Follow the existing idle or evaluated drift disposition first. Once that disposition permits continuation, one atomic revise-state rewrite records the drift outcome, clears the stale questions, and returns status to `reviewing`; the next handover-list reconciliation removes their copies before a fresh review. A crash between the authoritative state rewrite and copy cleanup leaves a stale non-authoritative item that resume removes. Pending questions are scoped to the reviewed identity, refreshed away on any identity change, and deleted with other revise state on explicit abandonment or normal cleanup.

## Repair routing by abstraction

For every admitted finding the controller asks which abstraction owns the failed obligation. When the target is hardening-derived machinery, repair order is:

1. Remove machinery not required by the admitted outcome.
2. Generalize needlessly host-specific or mechanism-specific detail.
3. Defer implementation technique from a design specification into the implementation plan or tests.
4. Deepen the mechanism only when the cited requirement still fails after the smaller options.

This order is a repair heuristic, not an authorization source. User-directed choices and verified inherited constraints remain open to wiring and correctness findings, but cannot be simplified away merely because they are expensive.

A durable `## Design provenance` section is required only when spec hardening introduces or materially changes nontrivial machinery whose reason would otherwise disappear with revise scratch. Each hardening-derived entry cites an already admitted observable requirement. `Reviewer requested it` is not a valid basis. Specs with no such machinery receive no empty ledger.

## Contract-clean certification

The current engine keeps every finding-bearing cell active until a later literal LGTM. That rule prevents a controller from manufacturing reviewer agreement, but it also means a reviewer that repeatedly reports a true adjacent improvement can keep the run alive indefinitely after the controller correctly refuses the work.

This feature adds a distinct controller certification, `contract-clean`, for the current artifact and contract-context fingerprints. It is allowed only when:

- every finding has a complete skeptic verdict;
- every `CONFIRMED` or `JUDGMENT_CALL` finding has a complete actionability record;
- every such finding is `out-of-contract`;
- no finding is `admitted` or `uncertain`;
- no artifact edit or authoritative follow-up was created in the round;
- the artifact fingerprint, delivery snapshot, and contract-context fingerprint still match;
- each out-of-contract decision is preserved as a reasoned acknowledgement with its exact citation.

A round containing a `REFUTED` finding follows the existing recheck rule and cannot use this narrow path. A mixed round with any admitted edit or follow-up keeps the cell active; normal fingerprint movement and staleness handling apply. Contract-clean never appears as reviewer LGTM and never erases the reviewer report.

Dimension-cell state gains a certification-kind value: `none`, `reviewer-lgtm`, or `contract-clean`. Active and N/A cells use `none`. A certification records both the artifact and contract-context fingerprints. Change to either identity clears it.

The holistic verifier receives the same narrow contract-clean option. Verifier state records stamp basis `reviewer-lgtm`, `contract-clean`, or the existing no-fix authoritative-follow-up exception. A verifier actionability conflict becomes `uncertain` and prevents stamping. The final report states which basis completed each cell and the verifier.

## Complete behavior by branch

### Admitted finding

The controller records the basis and citation, repairs at the owning abstraction, and records that trace in the applied-change or follow-up entry. Artifact edits advance the fingerprint and preserve existing wave and verifier behavior.

### Out-of-contract finding

The controller applies no edit and creates no authoritative follow-up or backlog item. If every finding meets the contract-clean gate, the cell certifies that fingerprint. Otherwise the existing active-cell rule applies.

### Explicit exclusion challenged as necessary

A reviewer must provide a causal counterexample showing that the anchored outcome or correctness floor cannot hold. That is stronger evidence and receives normal factual verification and fresh admission. Without the causal trace, the prior out-of-contract decision stands.

### Empty findings

A reviewer returning LGTM with a concrete note follows the existing `reviewer-lgtm` certification. No actionability record is synthesized.

### Empty exclusions

`Material exclusions: None stated.` is a complete deliberate empty set, not permission to admit every adjacent improvement. Positive outcome, verified constraints, and correctness floor still bound admission.

### Missing or conflicting contract

Interactive entry resolves the missing decision before dispatch. An autonomous fresh review uses the preflight handover item above and stops before review-state creation, edits, or a stamp. Conflicting governing anchors are structural and cannot be deduplicated or resolved by convenience.

### User denial or changed outcome

A user denial changes the contract only through the normal agreement and anchor-revision path. The revised contract-context fingerprint invalidates prior decisions and certifications. A denial that supplies no scope decision leaves the finding uncertain and the run at `awaiting-admission-decision`.

### Unattended uncertainty

The controller persists the questions through the idempotent handover schema, applies none of the round's findings, and stops at `awaiting-admission-decision`. It does not invent a route or backlog entry.

### Admission failure

A semantically valid result with absent or unverifiable authority or an undecidable conflict maps to `uncertain`, never to `admitted` or `out-of-contract`. Missing fields, invalid combinations, serialization errors, and controller execution failures leave admission incomplete and use bounded technical repair followed by existing failed-run retry or abandon behavior.

### Contract-context drift

Any anchor, run basis, governing set, supplementary-authority source, Operating context, or included provenance change clears all current actionability reuse, pending admission questions, cell certifications, and verifier stamp before another launch. If status was `awaiting-admission-decision`, the same atomic refresh returns it to `reviewing`. The next admission-copy reconciliation removes any stale handover items. A pure artifact edit leaves contract context stable but follows ordinary artifact-fingerprint staleness and the awaiting-state invalidation rule above.

## Consumer behavior

- `internal/revise/SKILL.md` owns the frozen contract state, actionability lifecycle, adjudication, certification kinds, failure behavior, and reporting.
- `internal/revise/spec.md` requires or interactively backfills the spec anchor and supplies spec-specific provenance routing.
- `internal/revise/plan.md` resolves all upstream anchors, handles the genuinely spec-less approved run basis, and rejects incompatible anchor sets.
- `internal/revise/code.md` resolves governing anchors through the logical changeset and uses the approved run-local fallback only when the changeset is legitimately spec-less.
- Workflow and manual dispatch deliver the same contract context. Admission remains behind the whole-round barrier and is controller-owned in both paths.
- The holistic verifier consumes and may challenge actionability decisions under the same contract.
- `skills/handover/SKILL.md` owns the canonical follow-up-item JSON shape, idempotent handoff key, morning decision surface, and admission-owned stale-copy reconciliation for unattended uncertainty.
- `review-orchestration-tests` supplies the transition module that this feature updates atomically with contract-clean and stamp-basis fixtures.
- `adversarial-repair-dialogue` starts repair dialogue only for admitted findings.
- `fix-scoped-rounds` treats contract-clean as a no-fix certification and never narrows a payload based on an out-of-contract observation.
- `second-opinion-gates` sends its findings through factual verification and admission before repair.
- `bounded-revise-acknowledgement-context` may later compact repeated acknowledgement prose, but cannot drop the current contract citation or change actionability.
- `review-report-json-schema` remains unchanged in the first implementation because reviewer output does not gain actionability or observations fields.
- `pre-implementation-context-reset` and light revise mode remain separate. If they run after this feature, they preserve the frozen contract context and certification semantics.

## Acceptance and evaluation

Deterministic fixtures cover every actionability class and valid basis/citation combination, malformed-record technical repair and exhaustion, authority-source drift, absent and conflicting authority, certification kind, stamp basis, context invalidation, uncertainty stop and resume, artifact and delivery drift while awaiting a decision, idempotent handover copy creation and stale-copy removal, and crash state including edit-before-ledger recovery. Existing clean-LGTM, refutation, deferred-follow-up, staleness, wave, and verifier fixtures remain green except where explicitly superseded by contract-clean.

Two captured incident replays provide paired evaluation:

- A documentation-only relocation contract rejects host-history migration while admitting a planted false-path correction through the correctness floor.
- A universal-entry contract preserves observable installed discovery while removing or deferring low-level smoke process machinery that lacks an admitted requirement.

The same fact under two different anchors must classify differently without changing its factual verdict. Rigor may change repair depth but not actionability. An unavailable or ambiguous classifier must increase unresolved work, never reduce verification or produce certification.

Pilot reporting records raw findings, admitted findings, out-of-contract decisions, uncertain decisions, artifact edits, contract-clean certifications, reviewer-LGTM certifications, and verifier basis. These are evaluation metrics, not new success thresholds or a permanent general telemetry protocol.

## Explicit anti-goals

- No reviewer-authored observations array or clarification protocol in the first version.
- No cross-round or cross-run skeptic-verdict reuse.
- No automatic tracking of adjacent improvements.
- No second review-state authority outside existing revise state and round result. The pre-existing handover follow-up list carries only an idempotent copy of an unresolved question and never authorizes a finding or mutation.
- No model names or fixed model tiers in semantic rules.
- No context compaction, general issue ontology, or new review cap.

## Status

Designed through cross-project arbitration on 2026-08-18 using retained Nightshift universal-entry and Disco Elysium relocation incidents. User approved the arbitration ruling. Not yet hardened by revise-spec.

## Requirements

- The complete Durable scope anchor, including deliberate-empty, legacy, and propagation behavior.
- Executable review orchestration transitions so contract-clean changes are fixture-bound before runtime prose changes.
- Existing skeptic evidence, checkpoint, fingerprint, wave, and verifier machinery in `internal/revise/`.

## Hardening

- (None yet; this file has not been through a revise-spec run.)
