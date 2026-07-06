# Artifact parameters: plan

## Scope

The scope is everything passed after the `plan` artifact token.

Here, "plan" is an implementation plan: a file describing the steps required to land a specific piece of work, typically authored ahead of executing the work. Plans are ephemeral — they're written, executed, then deleted when the work lands — but the review discipline still applies, because plans prescribe the commit graph that becomes source-of-truth history: a plan with stale APIs, unverifiable intermediate commits, or task-number leakage produces durable harm to the code or git history it prescribes.

If the scope is empty, determine it automatically. Prefer (in order):
1. The plan file path shown in the plan-mode system message, if the session is currently in plan mode.
2. The most recently modified file under `.claude/plans/` (repo-local) or `~/.claude/plans/` (global), whichever the current working directory makes more natural.
3. Recently touched plan-shaped files in `git status` and `git diff --stat`; those signals only see tracked files, so for untracked or git-ignored plans (a supported election; the project's `.gitignore` is the source of truth) fall back to file modification time.

Only ask the user if genuinely ambiguous.

If a scope is provided, interpret it based on what it looks like:
- **File path** (e.g., `.claude/plans/2026-05-15-foo.md` or an absolute path) — review the whole file.
- **Natural language** (e.g., "the plan we just wrote", "the rewrite plan") — resolve from conversation context and the filesystem; identify the file by recent modification time and content match.

Git-diff scope shapes (`staged`, `unstaged`, `main..HEAD`) that the code artifact accepts are not supported here — a plan is a single document, not a multi-file changeset, so a file path (or natural-language pointer at one) is the only meaningful scope.

## Setup

**Identify the plan file and in-scope sections.**
- For a whole-file scope, the entire file is in scope.
- For a section scope, name the section heading(s) and adjacent sections that the named section depends on or is depended on by. Read the whole file once to understand the document shape, then point agents at the in-scope sections by heading + line range.
- If the plan file does not exist, report that and stop.

## Loop parameters

- **Artifact**: the plan file. Edit surface: the plan file only — no code, no docs, no command files, no backlog entries during the loop. The sole exception is the post-loop Spec Reconciliation step below, which may edit the upstream spec with the user's per-edit approval.

- **Model pin**: pass `model: "opus"` to every reviewer Agent call. Rationale: plan review is judgment-only — there is no build or test cycle to catch a bad fix downstream, so the stronger tier's judgment wins over the cheaper tier's volume (the code artifact makes the opposite trade).

- **Pre-seed sources** (for the acknowledgements list, before iteration 1): scan the plan for explicitly-deferred items — any "Out of scope", "Trigger: when X lands", or "deferred to" language — and add each as an acknowledgement. Reviewers reliably re-flag intentional deferrals as missing scope; seeding them upfront eliminates 2-3 iterations per plan. Typical acknowledgement shapes: "D3 N/A — this plan has no cross-module signature changes"; "design punt is intentional — listed under Open questions"; "balance is intentional — the Verification section is heavier because the rewrite is structural and most reader risk lives there".

- **Delivery rules**: the document-artifact profile in SKILL.md (read-once, offset/limit above 400 lines, partial-section context-note rule, prior-fix duplicate check).

- **Additional prompt rules**: the relevant CLAUDE.md excerpts to inline are the project conventions about commit messages, task-number leakage, doc/code commit separation, and the project's plan-vs-feature taxonomy.

- **Post-fix steps**: none (plans have no build).

- **Post-loop step (hardening stamp)**: when the loop graduates, append a provenance line to the plan under a `## Hardening` section (created at the end of the document if absent):

  ```
  - revise-plan graduated <date and time> at <sha>, scope: <scope>, content: <fingerprint>
  ```

  where `<date and time>` is now (minute precision), `<sha>` is the current repo HEAD (short form), `<scope>` is `whole file` (plans are typically hardened whole-file) or `sections <headings or ranges>`, and `<fingerprint>` is the plan's content fingerprint per the canonical recipe in `${CLAUDE_PLUGIN_ROOT}/commands/handover.md` (Provenance stamps section): `awk '/^## Hardening$/{exit} !/^Status:/' <plan> | sha256sum | cut -c1-8`. Stamps accumulate, one line per graduated run. This stamp is what `/nightshift:handover`'s stage detection reads (both for plan hardening and as the baseline for its implementation-completeness evidence); skipping it silently breaks cross-session detection. Do not commit the plan as part of stamping.

## Dimensions

### Dimension 1: Plan correctness

1. **API claims verified**: method signatures, package versions, framework idioms cited in the plan match real surfaces (NuGet XML docs, package source, framework reference). Plans that prescribe a non-existent API silently waste an executor's iteration cycle.
2. **File paths exist**: every file path the plan tells the executor to touch resolves in the working tree (or is explicitly named "new file"). Stale paths after a rebase are a common failure mode.
3. **Cross-file claims**: when the plan says "module X exports Y", verify by reading X. Plan-vs-code drift after rebasing onto changed `main` is the second most common gap after API drift.
4. **Tool / command invocations and embedded literals**: flags, scripts, environment variables, and host-language literals (bash commands, regex patterns, JSON payloads, YAML fragments) quoted literally in the plan are correct. Common traps: variables inside single-quoted bash strings don't expand; regex metacharacters differ between quoted/unquoted forms; JSON requires double quotes; YAML escape rules diverge from JSON's.

### Dimension 2: Requirements clarity

1. **Ambiguity**: could two executors read this task and produce different things? Soft words ("update the validation", "improve the error handling") that should name concrete files, methods, or thresholds.
2. **Missing concrete values**: vague-magnitude phrases that should be numbers (with units), or named constants whose value is fixed somewhere else.
3. **Inputs and outputs**: for each task, are the inputs (files touched, methods called) and outputs (new methods, modified signatures, files produced) explicit?
4. **Done criteria**: how does an executor know they're done with each task? Is there a concrete "this passes when..." or only prose?
5. **Naming consistency**: does the plan use one term per concept, or drift between synonyms across tasks?

### Dimension 3: Intermediate-commit verifiability *(plan-specific)*

For each task that changes a cross-module signature or public API, the codebase must still build + tests pass at that task's commit boundary *without* relying on changes from later tasks. If a later task migrates callers to the new shape, the plan must either:

1. **Co-locate the caller migration** inside the signature-changing task,
2. **Declare the coupling explicitly** (e.g., "lands as a single commit with task N+K"), or
3. **Ship a compatibility shim** (union type, overload, delegate to old impl) that a final sweep removes.

Silent couplings across tasks make intermediate commits unverifiable and break bisection / revert workflows. Flag every cross-task signature change without one of (1), (2), or (3) declared.

This dimension may be N/A for some plans (single-commit single-file rewrites, doc edits, etc.). When the plan's task set has no cross-module signature changes, the dimension graduates on a one-sentence "no signature changes in this plan" verification note rather than launching deeper.

### Dimension 4: Risk and robustness

1. **Failure modes named**: when a step can fail (file missing, network error, lock contention, partial write), the plan should say what happens. Silent omission is a common gap.
2. **Rollback plausibility**: if a task lands halfway and breaks, can the executor revert cleanly, or is intermediate state stranded?
3. **Concurrency and ordering**: when the plan touches multiple long-running pipelines, schedulers, or external systems, the ordering must be explicit.
4. **Edge cases at boundaries**: empty inputs, very large inputs, missing config, partial state from prior runs, restart in the middle.

### Dimension 5: Scope and decomposition *(absorbs the design-punt scan)*

1. **Task right-sizing**: is each task a tractable single coherent change, or does it bundle two unrelated changes? If borderline, are sub-tasks listed?
2. **Simplicity**: no abstractions, interfaces, or indirection added "just in case". YAGNI applies to plans as much as to code.
3. **Design punts surfaced explicitly**: every "this is deferred" or "later slice" carries a one-line motivation. Silent omission of a deferral is worse than explicit deferral. Watch for: choices that defer a real decision past this slice; commits to one of N options without surfacing the rejected N-1 in the decision log; assumptions about future feature shape that aren't documented as upstream dependencies. Surface each candidate with the section, the deferred invariant or future bite, and a recommended response (address inline, file as backlog dependency, or document as explicit anti-goal).
4. **Anti-goals named** when context might suggest the plan should address something it explicitly is not addressing.

### Dimension 6: Balance *(absorbs the balance scan)*

1. **Task depth proportionate**: is each task's depth proportionate to its complexity, and verification commensurate with risk? Some tasks may be bloated with micro-detail while siblings are stub-thin.
2. **Pre-work context sized right**: not too thin for the work, not too verbose for the executor.
3. **Cross-section weight**: if one section (e.g., Verification) is heavier than the implementation prose it verifies, the plan is mis-allocating reader attention.
4. **Healthy balance is also a valid outcome**: if every task is the right depth, say so crisply. Balance is the dimension most prone to drift between iterations; a short pass that confirms balance is healthy is the right outcome when it is.

### Dimension 7: Commit and project hygiene *(plan-specific)*

1. **Commit subject length**: every `git commit -m "..."` example in the plan must be ≤72 chars per the project's Conventional Commits rule (or whichever subject-length convention CLAUDE.md establishes). Plans prescribe subjects literally, so an over-length subject in the plan produces an over-length commit and a post-hoc amend discussion.
2. **Atomic commits**: does the plan respect the "one logical change per commit" rule, or does it cram multiple concerns into a single commit? Pre-flag candidates for splitting.
3. **Doc / config commit separation**: project conventions about which classes of file must commit separately from code (e.g., `.claude/*` and `CLAUDE.md` get their own commit with a literal subject in some setups) — flag any plan instruction that would mix them.
4. **Task-number leakage**: implementation plan task numbers ("Task N", "Step N", "Phase N") reference ephemeral scaffolding deleted on land. The plan must not prescribe embedding them in source comments, docs, commit messages, or tracking files. Flag any plan instruction that would leak a task number into a durable artifact.

## Spec Reconciliation

A plan is ephemeral; the upstream spec it came from is durable. A correction the review surfaces that contradicts the spec (say, a prescribed invocation a live test disproved) is lost when the plan is deleted unless it is folded back.

After the loop graduates, reconcile against each upstream spec (skip with a one-line note if there is none):

1. **Sort each iteration's findings.** A finding belongs in the spec iff it would be lost-and-missed once the plan is gone: corrections to the contracts, invocations, assumptions, or design decisions the spec owns. Language gotchas, library quirks, and how-to-code-it detail stay in the code the plan produces; promoting them only bloats the spec.
2. **Apply the spec-worthy ones with approval.** Surface each as readable text (current wording plus proposed replacement, not buried in a tool call) and edit the spec on approval. This is the sole exception to the "plan file only" edit surface.
3. **Right-size the change.** A localized correction is an inline edit, not a reason to re-run a spec review; a candidate that would change the design rather than correct its record goes to the Follow-up logging step instead, recommending a dedicated `/nightshift:revise-spec` pass.

If nothing reconciles, say so explicitly, so the step is visibly run.

## Retrospective extras

In addition to the retrospective items in SKILL.md:

- **Reasoning-cut pressure**: did any agent recommend cutting paragraphs that document design reasoning in the plan? If yes, the dimension prompts may need to be tightened to discourage this default. Plans don't carry as much design reasoning as specs do (the spec is upstream), but when a plan does explain *why* a non-obvious approach was chosen, that reasoning is the part future-you will most want preserved.
- **Right-sizing checks**: did D3 (intermediate-commit verifiability) launch deep agents for a plan that had no signature changes? Did D5 graduate immediately on a single-task plan?
