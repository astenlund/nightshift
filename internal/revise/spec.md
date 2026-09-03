# Artifact parameters: spec

## Scope

The scope is everything passed after the `spec` artifact token.

Here, "spec" is the generic noun for any design-shaped file in `.claude/`: a feature, pattern, or bug-investigation file. The artifact name predates a taxonomy where specs and features are unified; the artifacts being reviewed are the design content inside feature / pattern / bug files.

If the scope is empty, determine it automatically from the conversation context: what feature, pattern, or bug-investigation file was just written, updated, or discussed in this session. Check `git diff --stat` and `git status` for recently touched files under `.claude/features/`, `.claude/bugs/`, and `.claude/patterns/`; those signals only see tracked files, so for untracked or git-ignored artifacts (a supported election; the project's `.gitignore` is the source of truth) fall back to file modification time. Only ask the user if genuinely ambiguous.

If a scope is provided, interpret it based on what it looks like:
- **File path** (e.g., `.claude/features/foo.md`): review the whole file
- **Natural language** (e.g., "the detector section in the brainstorm feature"): resolve from conversation context and the `.claude/` tree; identify both the file and the in-scope section. Sections outside the named scope are background for consistency checks but are not themselves the review target.

Git-diff scope shapes (`staged`, `unstaged`, `main..HEAD`) that the code artifact accepts are not supported here; a spec is a single design document, not a multi-file changeset, so a file path (or natural-language pointer at one) is the only meaningful scope.

## Setup

**Identify the spec file and in-scope sections.**
- For a whole-file scope, the entire file is in scope.
- For a section scope, name the section heading(s) and adjacent sections that the named section depends on or is depended on by. Read the whole file once to understand the document shape, then point agents at the in-scope sections by heading + line range.
- If the spec file does not exist, report that and stop.

## Agreement binding and fingerprint

Load `${CLAUDE_PLUGIN_ROOT}/skills/spec-agreement/spec-agreement.js`. The spec's existing resolved artifact identity and review scope supply the post-mutation request; durable revise state supplies no agreement authority. For every stable read, call `selectArtifact` with selector kind `design-before-hardening` and empty selectors, then pass that exact selection to `hashSelection`. This is the sole eligible-design fingerprint selector and hash pipeline. A `Status:` line remains eligible design content and is never excluded.

Every controller fix or user request that edits the reviewed spec is agreement-relevant. After controller fixes and all pending user requests form the complete revise-spec boundary batch, invoke `${CLAUDE_PLUGIN_ROOT}/skills/spec-agreement/SKILL.md` in `post-mutation` phase before another reviewer, skeptic, verifier, post-review item, or downstream transition. The shared controller reconstructs and classifies the complete candidate once; this profile does not reproduce governing-set mapping, candidate comparison, or fit classification. Exact equality, validated compatibility, renewed agreement, or `not-applicable` clears the engine boundary through its common protocol. Every unresolved or failed outcome remains blocked there.

## Grounding step

The operating-context section must exist and be complete before any reviewer or skeptic launches. The controller runs this step at the start of the review run, at the entry point where the user is still present (shift start). It never defaults-substitutes and never fails closed silently: a missing or incomplete section is filled by asking the user.

1. **Check.** Look for an `Operating context` section in the spec body. Absent means no such section at all. Skeletal means the section exists but (a) omits any of the six operating-context inputs (deployment environment and operational criticality; audience; failure consequence and data or security sensitivity; concurrency and compatibility risk; reversibility and recovery cost; expected feature lifetime), or (b) records inputs without applying the derivation rule in `internal/revise/rigor.js` to yield a tier and per-dimension effort, or (c) states a tier that does not follow from the inputs under that rule. Whether prose "omits an input" is a semantic judgment; when not mechanically decidable, record the detection call and its basis as a deviation entry, exactly as the derivation rule's Step 2 boundaries are recorded.
2. **Derive.** When absent or skeletal, derive the section from durable project knowledge first (repository guidance, architecture documents, established project conventions). Consult the user only when durable knowledge runs short; this consult is an entry-point action performed at shift start while the user is still present, before any unattended continuation. On an index-only backlog entry, write the derived section and any deviation entries recorded under this step as an indented continuation of the entry's own bullet, with no blank line separating them from it or from each other: the bullet-entry selector in `skills/spec-agreement/spec-agreement.js` ends the entry at the first blank line, so a blank-separated paragraph falls outside the governing scope and the post-mutation fit-check reports the spec unchanged. Apply the audience component-to-category judgment, the uplift-predicate judgments, and the derivation rule via `node internal/revise/rigor.js <audienceCategory> <firedUpliftCount>`; record every judgment boundary as a deviation entry with its basis.
3. **Persist.** When the consult answered a question durable knowledge left unanswered (a gap, not a default deviation), persist the gathered operating-context facts to the project-local instruction file the host reads: `CLAUDE.md` under Claude Code, `AGENTS.md` under Codex. Write to the file that actually holds durable content, not to a pointer file (a `CLAUDE.md` whose body is only `@AGENTS.md` points at the referent). A deviation from a documented default is never persisted; it stays in the spec. If creation is refused or the project tracks no durable instruction prose, keep the facts in the spec's own derivation notes.
4. **Recalculate the fingerprint** after adding or filling the section, so every reviewer in the run calibrates against a complete profile.
5. **Report absence as the shared error.** When the section remains absent or skeletal after the step (impossible here, since the user is present and fills it, but kept for the revise-plan side's symmetry), raise `structural-precondition-error` with its three fields: artifact path, reason (absent or skeletal with the specific missing input or rule violation), and remediation direction.

## Review parameters

- **Artifact**: the spec file. Edit surface: the spec file only: no code, no plan, no docs, no pattern-file promotions, no `*_HISTORY.md` entries during the loop; those are author decisions, not reviewer decisions, and have their own commands or workflows.

- **Model pin**: pass `model: "opus"` to every reviewer Agent call. Rationale: spec review is judgment-only; there is no build or test cycle to catch a bad fix downstream, so the stronger tier's judgment wins over the cheaper tier's volume (the code artifact makes the opposite trade).

- **Pre-seed sources** (for the acknowledgements list, before the first round): scan the spec for explicitly-deferred material (anti-goal statements, "out of scope" language, `## Open questions` entries, "later slice" / "deferred to" phrasing) and add each as an acknowledgement, along with every claim already carrying a `(live-claim: ...)` probe bullet (Design-soundness item 6 is satisfied for those and must not re-fire; D2.4 still owns whether the bullet states a concrete pass condition, so word the acknowledgement that narrowly). Reviewers reliably re-flag intentional deferrals as gaps; seeding them upfront eliminates 2-3 review rounds per spec. Typical acknowledgement shapes: "scope intentionally excludes mode-switch boxes per future-slice plan"; "alternative algorithm X was considered in section 3 and rejected as too brittle under partial input"; "the missing failure-mode for case Y is documented in `## Open questions`, not a spec gap"; "balance is intentional: section 4 is brief because the mechanism is small".

- **Delivery rules**: the document-artifact profile in SKILL.md (read-once, offset/limit above 400 lines, partial-section context-note rule, prior-fix duplicate check).

- **Reviewer calibration** (inline in every reviewer prompt): before reporting a divergence, pin, or location claim, quote the exact sentence the artifact names and build the claim from that quotation, never from a paraphrase or a neighboring sentence. Assert a failure scenario only after tracing its reachability through the shipped producers upstream of the flagged consumer. Before reporting a divergence-from-authority finding, check whether an adjacent status, history-archive, or provenance record is the authoritative owner of the described transition. Treat a recorded acknowledgement's reasoning, not just its literal wording, as settled ground; adjacent mechanics outside that reasoning remain reviewable.

- **Additional prompt rules**: the relevant CLAUDE.md excerpts to inline are the project conventions about design-document structure, indexes, the spec-trim feedback rule, and the project's plan-vs-feature taxonomy. Project context should name which neighboring feature / pattern / bug files exist and what the spec under review is for.

- **Post-fix steps**: none (specs have no build).

- **Post-loop step (hardening stamp)**: once every other post-loop step has landed, so the fingerprint matches the final shipped artifact, not an intermediate state, call `writeProvenanceStamp` from `${CLAUDE_PLUGIN_ROOT}/skills/spec-agreement/spec-agreement.js` with the complete current-file baseline hash and this provenance line:

  ```
  - revise-spec graduated <date and time> at <sha>, scope: <scope>, content: <fingerprint>
  ```

  where `<date and time>` is now (minute precision), `<sha>` is the current repo HEAD (short form), `<scope>` is `whole file` or `sections <headings or ranges>` matching this run's scope, and `<fingerprint>` is the first 8 hexadecimal characters of the `contentHash` returned by the shared `selectArtifact` and `hashSelection` pipeline above. On first graduation, the helper creates an absent eligible final Hardening section, fills an eligible empty one, or replaces the sole recognized placeholder. All later provenance stamps append after existing valid provenance; never hand-assemble a second selector, section parser, placeholder replacement, or append rule. After the provenance write joins the complete revise-spec boundary batch, run the common post-mutation contract-fit boundary before finalization. This stamp is what `/nightshift:handover` stage detection reads; skipping it silently breaks cross-session detection. Do not commit the artifact as part of stamping (committing is owned by the session's normal flow, and the artifact may be deliberately untracked).

## Dimensions

### Dimension 1: Design soundness

1. **Mechanism vs claim mismatch**: does each proposed mechanism actually achieve what its rationale claims? Walk the claim and the mechanism side by side; if the mechanism would still produce its result under conditions that violate the claim's premise, flag it. Where a mechanism relies on an external consumer supporting a given format or interface, verify that support actually holds on the target platform and version; a mechanism can be logically correct yet silently unsupported by its runtime, producing wrong behavior rather than an error.
2. **Hidden assumptions**: assumptions the spec relies on but doesn't surface: implicit bounds, environment guarantees, ordering, identity uniqueness, anything the algorithm would break under without saying so.
3. **Algorithmic correctness**: walk through the algorithm with a realistic worst-case input. Does it terminate? Does it produce the claimed output? Are loop invariants preserved? Are off-by-one or empty-input cases handled?
4. **Failure-mode realism**: when the spec describes failure handling, verify the handler's preconditions hold and that downstream consumers actually act on the signal it produces.
5. **Current-state fidelity**: any claim the spec makes about *existing* code -- file/class/method names, API shapes, config keys, "today X does Y" descriptions -- must be spot-checked against the actual source with Grep/Read. Do not trust the spec; present-tense claims are the likeliest to have rotted since writing. When a claim is stale, report the corrected reality, not just "unverified".
6. **Repo-unverifiable runtime claims**: when a spec claim's truth is owned by a runtime the repo does not contain (a third-party service, the browser engine, the OS, the host environment) and no file in the tree can settle it (item 5's spot-check has nothing to check against), review cannot resolve it and must not silently accept it. Require the spec's testing or verification section, whatever heading the spec uses (if the spec has none, requiring one is the finding), to probe the claim directly in every distinct context the feature covers (each host page, mode, or entry point, not one representative case) and mark the claim provisional until that probe runs. The mark is literal so downstream tooling can detect it: end the probe bullet with `(live-claim: provisional)`, or with `(live-claim: provisional, awaiting <precondition>)` when the probe is gated behind a precondition the run cannot produce, so the artifact itself records that the provisional status is a designed carry-forward rather than an unprobed gap; whoever runs the probe rewrites it to `(live-claim: probed <date>)` on a confirming result, or to `(live-claim: deferred <date>)` on a knowing deferral the user rules on, and the `awaiting` clause drops with that rewrite because it qualifies only the `provisional` state, while a contradicting result routes to correction or redesign, never to a `probed` marker. A claim that already carries a marked probe bullet satisfies this item; do not re-flag it as unprobed. Index-only backlog entries take marker bullets like any spec (a marker is not a stamp, and an index entry has no file-scoped fingerprint to defeat); only the stamp-refresh half of downstream handling is skipped there, with a one-line note. Item 1 owns external support that *can* be checked against platform docs and versions; this item owns the residue that cannot be checked at all. Flag here only that the claim is unsettled and unprobed; whether the probe bullet states a concrete pass condition is D2.4's call.

### Dimension 2: Requirements clarity

1. **Ambiguity**: could two implementers read this and produce different things? Soft words that should be concrete thresholds or named constants are the most common offenders.
2. **Missing concrete values**: vague-magnitude phrases that should be numbers (with units), or named constants whose value is fixed somewhere else.
3. **Inputs and outputs**: are the data shapes for inputs and outputs (including error shapes) named, sized, and typed? Are field semantics specified (required vs optional, range, encoding)?
4. **Success criteria**: how does an implementer know they're done? Is there a concrete "this passes when..." or only prose?
5. **Naming consistency**: does the spec use one term per concept, or drift between synonyms? Pick one and stick with it.

### Dimension 3: Scope and decomposition

1. **Slice size**: is the slice tractable as a single coherent implementation, or does it bundle two unrelated changes? If it's borderline, are sub-slices listed?
2. **Deferred items called out explicitly**: every "this is deferred" or "later slice" should have a one-line motivation ("polling loop deferred so we can validate calibration in isolation"). Silent omission is worse than explicit deferral.
3. **Anti-goals named**: things the spec explicitly is NOT trying to solve, when the surrounding context might suggest it should.
4. **Out-of-scope drift**: paragraphs that wander into adjacent concerns (e.g., a detector spec drifting into describing the polling loop's lock-file behavior); that content either belongs in a different section/file or should be a one-sentence reference.

### Dimension 4: Internal consistency

1. **Cross-section agreement**: do different sections of the spec describe the same behavior consistently? If section A says "the output is JSON", does section B also treat it as JSON? If section A says "step 3 retries on failure", does section B account for retries?
2. **Data-shape boundary integrity**: when data crosses an interface (input -> algorithm -> output -> persistence), is the shape consistent at each step? Watch for field renames mid-document.
3. **Cross-reference validity**: do "see section X" pointers refer to sections that exist and say what's claimed? Stale cross-references rot specs from the inside.
4. **Constants in lockstep**: numeric values, field names, and file paths that appear in multiple places (e.g., a coordinate pinned in CSS, code, and spec) should agree across all sites. The spec is one of those sites.

### Dimension 5: Completeness

1. **Error paths**: what happens when the underlying operation fails partway through? Is the failure recoverable, surfaced to the user, or silently swallowed? Is each error class named?
2. **Recovery flows**: if a transient failure leaves the system in a partial state, how does it recover? Is there a crash-recovery story?
3. **Concurrency**: are there race conditions (two operations on the same resource, two clients sharing state)? Is the spec silent on ordering when ordering matters?
4. **Idempotency**: is re-running an operation safe? What happens on duplicate input?
5. **Edge cases**: empty inputs, single-element inputs, very large inputs, malformed inputs, missing files, missing config.
6. **Lifecycle gaps**: start, steady-state, shutdown, restart, upgrade. Specs frequently cover steady-state behavior cleanly but skip the transitions.
7. **Unpinned deliberate rules**: when the spec commits to a deliberate exception or positive permission ("X proceeds under Y"), check that the verification surface the spec prescribes (fixtures, pins, checks) pins that rule; an unpinned deliberate rule regresses silently to the conservative default. When the spec prescribes a verification surface, walk every deliberate rule in the spec against it in one pass and report all unpinned rules together, not the first one found.

**Anti-goal triage before flagging.** Before reporting a missing error-path, recovery flow, concurrency guard, or lifecycle handler as a *gap*, decide whether the omission is a deliberate scope cut or a genuine oversight. If the spec's MVP framing or surrounding context implies the case is intentionally out of scope, flag it as "this omission should be made explicit as an anti-goal" rather than "this must be handled." A missing handler for a real in-scope operation is a completeness defect; a missing handler for an out-of-scope concern is a documentation gap in the anti-goals list, not a behavior gap. Report omissions of either kind, but label which it is, so the fix routes to the right place (handler vs. one-line anti-goal) instead of pressuring the spec to over-build. D5's lens is *behavioral*: a real operation lacks a handler. Whether the resulting anti-goal is *worded* well is D3.3's call and whether it's a sound deferral is D7.3's; so don't audit the anti-goals section yourself; just flag the behavioral omission.

**Capture-stage stub guard.** For capture-stage stubs (files that explicitly defer detail to a scheduled dedicated brainstorm), two additional filters apply. (1) Do not flag cases that arise only under an implementation model the stub has not committed to (e.g., an entry-collision that requires a positioning model the spec leaves as an open question); note them as brainstorm inputs, not findings. (2) If a candidate finding would be the third consecutive refinement of the same paragraph across review rounds, route it to the scheduled brainstorm instead of the stub. Completeness review of a committed flow enumerates cases faster than fixes close them, and the brainstorm owns that altitude. (Observed 2026-07-04: a D5 run spent 4 rounds on one persistence bullet; rounds 3-4 produced six findings of which five were refuted for exactly these two reasons.)

### Dimension 6: Design reasoning preservation

1. **Non-obvious decisions documented**: surprising choices (a chosen algorithm, an unusual data shape, an asymmetric handling) should explain *why*. If a future reader will ask "why this and not the obvious alternative?", the answer should be in the spec.
2. **Alternatives surfaced and rejected**: for design decisions with multiple viable options, the rejected options should be named with their reasons. Future-you will wonder if X was considered; the spec should say "yes, X was considered but rejected because Y".
3. **Hard-won reasoning preserved**: design reasoning is NOT verbosity. Be especially wary of recommending the deletion of paragraphs that explain *why a constraint exists* or *why a non-obvious choice was made*; those are the parts of a spec that are most expensive to re-derive later. Cut verbose justifications and implementation-tuning numbers before cutting reasoning.
4. **Inline rather than reference where appropriate**: design-reasoning content should live in the spec, not in a memory file or scratch doc, since specs survive across sessions and machines.

### Dimension 7: Forward-fit and balance

1. **Future-feature compatibility**: will this design need to be torn out when a known future feature lands? Check the project's tracking files for related work (in projects with the four-index `.claude/` layout: `.claude/FEATURES.md`, `.claude/BUGS.md`, `.claude/QUICK_WINS.md`, `.claude/PATTERNS.md`; otherwise the equivalent the project uses), and verify the spec's choices don't quietly violate an invariant declared elsewhere.
2. **Upstream/downstream dependencies named**: features or constraints this slice depends on (and that are not yet built) should be explicit, not assumed. Reverse direction too: features that will depend on this slice should be flagged where the dependency is load-bearing. Also check same-file contention: does another backlog entry plan to touch the same files, functions, or UI surfaces? If so, the cheaper landing order should be recorded as prose in both entries -- sequencing that lives in nobody's file is itself a finding.
3. **Anti-goals as explicit deferrals**: where the spec sidesteps a hard problem ("for now we just X, not Y"), is Y a real follow-up item (in `.claude/FEATURES.md` or equivalent) or a punt that will become a forced redesign?
4. **Balance**: is each section's depth proportionate to its risk/complexity? Are some sections bloated with micro-detail while siblings are stub-thin? Spec readers' attention is finite; lopsided depth misallocates it. Out-of-scope drift is D3.4's concern; flag here only when the depth ratio itself is the problem, regardless of topic relevance, so the two dimensions don't double-fire on the same paragraph.
5. **Open questions hygiene**: items in `## Open questions` (or the equivalent live-decisions section the spec uses) should be live decisions, not resolved-but-stale text. Resolved questions move out; new uncertainties move in.
6. **Duplicate tracking**: is this work -- or a distinct slice of it -- already tracked by another index entry (a quick win, another feature, a bug's fix direction)? If so, flag for consolidation: one entry becomes the canonical home, the other retires with a pointer. Parallel tracking with slightly different shapes is how an implementer discovers mid-flight that the work is specified twice.

## Retrospective extras

In addition to the retrospective items in SKILL.md:

- **Reasoning-cut pressure**: did any agent recommend cutting paragraphs that document design reasoning? If yes, the dimension prompts (especially D6) may need to be tightened to discourage this default. This is the documented anti-pattern for this artifact type; repeated occurrences of declined cut-suggestions are a signal the prompt isn't pushing back hard enough.
