# Artifact parameters: spec

## Scope

The scope is everything passed after the `spec` artifact token.

Here, "spec" is the generic noun for any design-shaped file in `.claude/`: a feature, pattern, or bug-investigation file. The artifact name predates a taxonomy where specs and features are unified; the artifacts being reviewed are the design content inside feature / pattern / bug files.

If the scope is empty, determine it automatically from the conversation context — what feature, pattern, or bug-investigation file was just written, updated, or discussed in this session. Check `git diff --stat` and `git status` for recently touched files under `.claude/features/`, `.claude/bugs/`, and `.claude/patterns/`; those signals only see tracked files, so for untracked or git-ignored artifacts (a supported election; the project's `.gitignore` is the source of truth) fall back to file modification time. Only ask the user if genuinely ambiguous.

If a scope is provided, interpret it based on what it looks like:
- **File path** (e.g., `.claude/features/foo.md`) — review the whole file
- **Natural language** (e.g., "the detector section in the brainstorm feature") — resolve from conversation context and the `.claude/` tree; identify both the file and the in-scope section. Sections outside the named scope are background for consistency checks but are not themselves the review target.

Git-diff scope shapes (`staged`, `unstaged`, `main..HEAD`) that the code artifact accepts are not supported here — a spec is a single design document, not a multi-file changeset, so a file path (or natural-language pointer at one) is the only meaningful scope.

## Setup

**Identify the spec file and in-scope sections.**
- For a whole-file scope, the entire file is in scope.
- For a section scope, name the section heading(s) and adjacent sections that the named section depends on or is depended on by. Read the whole file once to understand the document shape, then point agents at the in-scope sections by heading + line range.
- If the spec file does not exist, report that and stop.

## Loop parameters

- **Artifact**: the spec file. Edit surface: the spec file only — no code, no plan, no docs, no pattern-file promotions, no `*_HISTORY.md` entries during the loop; those are author decisions, not reviewer decisions, and have their own commands or workflows.

- **Model pin**: pass `model: "opus"` to every reviewer Agent call. Rationale: spec review is judgment-only — there is no build or test cycle to catch a bad fix downstream, so the stronger tier's judgment wins over the cheaper tier's volume (the code artifact makes the opposite trade).

- **Pre-seed sources** (for the acknowledgements list, before iteration 1): scan the spec for explicitly-deferred material (anti-goal statements, "out of scope" language, `## Open questions` entries, "later slice" / "deferred to" phrasing) and add each as an acknowledgement. Reviewers reliably re-flag intentional deferrals as gaps; seeding them upfront eliminates 2-3 iterations per spec. Typical acknowledgement shapes: "scope intentionally excludes mode-switch boxes per future-slice plan"; "alternative algorithm X was considered in section 3 and rejected as too brittle under partial input"; "the missing failure-mode for case Y is documented in `## Open questions`, not a spec gap"; "balance is intentional — section 4 is brief because the mechanism is small".

- **Delivery rules**: the document-artifact profile in SKILL.md (read-once, offset/limit above 400 lines, partial-section context-note rule, prior-fix duplicate check).

- **Additional prompt rules**: the relevant CLAUDE.md excerpts to inline are the project conventions about design-document structure, indexes, the spec-trim feedback rule, and the project's plan-vs-feature taxonomy. Project context should name which neighboring feature / pattern / bug files exist and what the spec under review is for.

- **Post-fix steps**: none (specs have no build).

- **Post-loop step (hardening stamp)**: when the loop graduates, append a provenance line to the artifact under a `## Hardening` section (created at the end of the document if absent):

  ```
  - revise-spec graduated <date and time> at <sha>, scope: <scope>, content: <fingerprint>
  ```

  where `<date and time>` is now (minute precision), `<sha>` is the current repo HEAD (short form), `<scope>` is `whole file` or `sections <headings or ranges>` matching this run's scope, and `<fingerprint>` is the artifact's content fingerprint per the canonical recipe in `${CLAUDE_PLUGIN_ROOT}/commands/handover.md` (Provenance stamps section): `awk '/^## Hardening$/{exit} !/^Status:/' <artifact> | sha256sum | cut -c1-8`. Stamps accumulate, one line per graduated run. This stamp is what `/nightshift:handover`'s stage detection reads; skipping it silently breaks cross-session detection. Do not commit the artifact as part of stamping (committing is owned by the session's normal flow, and the artifact may be deliberately untracked).

## Dimensions

### Dimension 1: Design soundness

1. **Mechanism vs claim mismatch**: does each proposed mechanism actually achieve what its rationale claims? Walk the claim and the mechanism side by side; if the mechanism would still produce its result under conditions that violate the claim's premise, flag it. Where a mechanism relies on an external consumer supporting a given format or interface, verify that support actually holds on the target platform and version; a mechanism can be logically correct yet silently unsupported by its runtime, producing wrong behavior rather than an error.
2. **Hidden assumptions**: assumptions the spec relies on but doesn't surface — implicit bounds, environment guarantees, ordering, identity uniqueness, anything the algorithm would break under without saying so.
3. **Algorithmic correctness**: walk through the algorithm with a realistic worst-case input. Does it terminate? Does it produce the claimed output? Are loop invariants preserved? Are off-by-one or empty-input cases handled?
4. **Failure-mode realism**: when the spec describes failure handling, verify the handler's preconditions hold and that downstream consumers actually act on the signal it produces.
5. **Current-state fidelity**: any claim the spec makes about *existing* code -- file/class/method names, API shapes, config keys, "today X does Y" descriptions -- must be spot-checked against the actual source with Grep/Read. Do not trust the spec; present-tense claims are the likeliest to have rotted since writing. When a claim is stale, report the corrected reality, not just "unverified".

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
4. **Out-of-scope drift**: paragraphs that wander into adjacent concerns (e.g., a detector spec drifting into describing the polling loop's lock-file behavior) — that content either belongs in a different section/file or should be a one-sentence reference.

### Dimension 4: Internal consistency

1. **Cross-section agreement**: do different sections of the spec describe the same behavior consistently? If section A says "the output is JSON", does section B also treat it as JSON? If section A says "step 3 retries on failure", does section B account for retries?
2. **Data-shape boundary integrity**: when data crosses an interface (input → algorithm → output → persistence), is the shape consistent at each step? Watch for field renames mid-document.
3. **Cross-reference validity**: do "see section X" pointers refer to sections that exist and say what's claimed? Stale cross-references rot specs from the inside.
4. **Constants in lockstep**: numeric values, field names, and file paths that appear in multiple places (e.g., a coordinate pinned in CSS, code, and spec) should agree across all sites. The spec is one of those sites.

### Dimension 5: Completeness

1. **Error paths**: what happens when the underlying operation fails partway through? Is the failure recoverable, surfaced to the user, or silently swallowed? Is each error class named?
2. **Recovery flows**: if a transient failure leaves the system in a partial state, how does it recover? Is there a crash-recovery story?
3. **Concurrency**: are there race conditions (two operations on the same resource, two clients sharing state)? Is the spec silent on ordering when ordering matters?
4. **Idempotency**: is re-running an operation safe? What happens on duplicate input?
5. **Edge cases**: empty inputs, single-element inputs, very large inputs, malformed inputs, missing files, missing config.
6. **Lifecycle gaps**: start, steady-state, shutdown, restart, upgrade. Specs frequently cover steady-state behavior cleanly but skip the transitions.

**Anti-goal triage before flagging.** Before reporting a missing error-path, recovery flow, concurrency guard, or lifecycle handler as a *gap*, decide whether the omission is a deliberate scope cut or a genuine oversight. If the spec's MVP framing or surrounding context implies the case is intentionally out of scope, flag it as "this omission should be made explicit as an anti-goal" rather than "this must be handled." A missing handler for a real in-scope operation is a completeness defect; a missing handler for an out-of-scope concern is a documentation gap in the anti-goals list, not a behavior gap. Report omissions of either kind — but label which it is, so the fix routes to the right place (handler vs. one-line anti-goal) instead of pressuring the spec to over-build. D5's lens is *behavioral* — a real operation lacks a handler. Whether the resulting anti-goal is *worded* well is D3.3's call and whether it's a sound deferral is D7.3's, so don't audit the anti-goals section yourself; just flag the behavioral omission.

**Capture-stage stub guard.** For capture-stage stubs (files that explicitly defer detail to a scheduled dedicated brainstorm), two additional filters apply. (1) Do not flag cases that arise only under an implementation model the stub has not committed to (e.g., an entry-collision that requires a positioning model the spec leaves as an open question); note them as brainstorm inputs, not findings. (2) If a candidate finding would be the third consecutive refinement of the same paragraph across loop iterations, route it to the scheduled brainstorm instead of the stub — completeness review of a committed flow enumerates cases faster than fixes close them, and the brainstorm owns that altitude. (Observed 2026-07-04: a D5 run spent 4 iterations on one persistence bullet; iterations 3-4 produced six findings of which five were refuted for exactly these two reasons.)

### Dimension 6: Design reasoning preservation

1. **Non-obvious decisions documented**: surprising choices (a chosen algorithm, an unusual data shape, an asymmetric handling) should explain *why*. If a future reader will ask "why this and not the obvious alternative?", the answer should be in the spec.
2. **Alternatives surfaced and rejected**: for design decisions with multiple viable options, the rejected options should be named with their reasons. Future-you will wonder if X was considered; the spec should say "yes, X was considered but rejected because Y".
3. **Hard-won reasoning preserved**: design reasoning is NOT verbosity. Be especially wary of recommending the deletion of paragraphs that explain *why a constraint exists* or *why a non-obvious choice was made* — those are the parts of a spec that are most expensive to re-derive later. Cut verbose justifications and implementation-tuning numbers before cutting reasoning.
4. **Inline rather than reference where appropriate**: design-reasoning content should live in the spec, not in a memory file or scratch doc, since specs survive across sessions and machines.

### Dimension 7: Forward-fit and balance

1. **Future-feature compatibility**: will this design need to be torn out when a known future feature lands? Check the project's tracking files for related work (in projects with the four-index `.claude/` layout: `.claude/FEATURES.md`, `.claude/BUGS.md`, `.claude/QUICK_WINS.md`, `.claude/PATTERNS.md`; otherwise the equivalent the project uses), and verify the spec's choices don't quietly violate an invariant declared elsewhere.
2. **Upstream/downstream dependencies named**: features or constraints this slice depends on (and that are not yet built) should be explicit, not assumed. Reverse direction too: features that will depend on this slice should be flagged where the dependency is load-bearing. Also check same-file contention: does another backlog entry plan to touch the same files, functions, or UI surfaces? If so, the cheaper landing order should be recorded as prose in both entries -- sequencing that lives in nobody's file is itself a finding.
3. **Anti-goals as explicit deferrals**: where the spec sidesteps a hard problem ("for now we just X, not Y"), is Y a real follow-up item (in `.claude/FEATURES.md` or equivalent) or a punt that will become a forced redesign?
4. **Balance**: is each section's depth proportionate to its risk/complexity? Are some sections bloated with micro-detail while siblings are stub-thin? Spec readers' attention is finite; lopsided depth misallocates it. Out-of-scope drift is D3.4's concern — flag here only when the depth ratio itself is the problem, regardless of topic relevance, so the two dimensions don't double-fire on the same paragraph.
5. **Open questions hygiene**: items in `## Open questions` (or the equivalent live-decisions section the spec uses) should be live decisions, not resolved-but-stale text. Resolved questions move out; new uncertainties move in.
6. **Duplicate tracking**: is this work -- or a distinct slice of it -- already tracked by another index entry (a quick win, another feature, a bug's fix direction)? If so, flag for consolidation: one entry becomes the canonical home, the other retires with a pointer. Parallel tracking with slightly different shapes is how an implementer discovers mid-flight that the work is specified twice.

## Retrospective extras

In addition to the retrospective items in SKILL.md:

- **Reasoning-cut pressure**: did any agent recommend cutting paragraphs that document design reasoning? If yes, the dimension prompts (especially D6) may need to be tightened to discourage this default. This is the documented anti-pattern for this artifact type; repeated occurrences of declined cut-suggestions are a signal the prompt isn't pushing back hard enough.
