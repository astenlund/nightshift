# Artifact parameters: code

## Scope

The scope is everything passed after the `code` artifact token.

If the scope is empty, determine it automatically from the conversation context — what was just implemented, changed, or discussed in this session. As a fallback, check git state (`git diff --stat`, `git diff --cached --stat`, `git log --oneline main..HEAD`) and pick whichever scope best matches the recent work. Only ask the user if genuinely ambiguous.

If a scope is provided, interpret it based on what it looks like:
- **File paths or globs** (e.g., `src/Services/*.cs`) — review those specific files
- **Git diff range** (e.g., `main..HEAD`) — review all changes in that range
- **`staged`** — staged changes only (maps to `git diff --cached`)
- **`unstaged`** — unstaged working tree changes (maps to `git diff`)
- **Natural language** (e.g., "the fetch script changes") — resolve from conversation context and file system

## Setup

**Collect the files to review.**
- **File paths or globs**: read the specified files directly (no git diff needed).
- **Git diff range, staged, or unstaged**: run the appropriate `git diff --name-only` command and read each changed file. Skip deleted files (they can't be read); review deletions from the diff text instead.
- **Auto-detected scope**: use the git diff that matches the recent work. New untracked files (present in `git status` but absent from `git diff HEAD`) are also in scope — read them directly.
- If no files are in scope (empty diff, no matching paths), report that there is nothing to review and stop.

## Loop parameters

- **Artifact**: the in-scope code changeset. Edit surface: the source files in scope; fixes are applied directly to them.

- **Model pin**: pass `model: "sonnet"` to every reviewer Agent call. Rationale: code review runs 8 dimensions (16 agents per full whole-diff iteration, more when sharded) and the build/test cycle provides an independent safety net for applied fixes, so the cheaper tier's volume wins over the stronger tier's judgment. Plan/spec review has no such net and pins opus.

- **Pre-seed sources** (for the acknowledgements list, before iteration 1):
  - Scan the project's CLAUDE.md for patterns that contradict general best practice (e.g., a wrapper that deliberately uses bare system Python instead of the venv, a custom exception that overlaps with a standard library one, an unconventional file layout) and seed them as acknowledgements proactively. Project-specific intentional deviations are the most expensive class of false positive; a 5-minute pre-scan saves 3-4 iteration cycles.
  - Any third-party-library runtime behavior the change hinges on, once you have confirmed it from the installed source (e.g. "react-hook-form's `setValueAs` runs before validation and is never called with `undefined`"). Same expensive false-positive class, cheapest to suppress before iteration 1.

- **Delivery rules**:
  - **Deliver the diff to agents without redundancy.** For diffs under ~2K lines **and** under ~15KB (`git diff <scope> | wc -c` before deciding), inline the content directly in each agent prompt — the no-tool-call benefit outweighs the repeated context. For diffs ≥ 2K lines or ≥ 15KB, write the diff to `.tmp/review-diff.patch` once (`git diff <scope> > .tmp/review-diff.patch`) and have each agent `Read` it. At 6K+ lines, inlining 16× wastes far more context than a single per-agent Read call. Either way, the agent should NOT invoke `git diff` itself — that adds multiple tool turns to its context.
  - **Always include prior-iteration fixes in subsequent iterations' patches.** Scope can take many forms (commit range, single commit, `staged`, `unstaged`, file paths, natural language), and per-session work style varies — fixes might land as new commits, amended commits, staged changes, or unstaged working-tree edits. After the first fix, regenerate the patch so it reflects what an agent will see if it opens the file directly. Pick the right `git diff` form for the current state of fixes; the principle is "the patch and the live file must agree," not any specific command. Skipping this produces a multi-iteration false-positive trap where fresh agents re-flag already-fixed issues (observed cost: 2-3 wasted iterations).

- **Sharding for large scopes**: when the changeset spans multiple independent work clusters and the patch runs past ~3K lines, shard the reviewer cells instead of running every dimension whole-diff: the local dimensions (Code Quality, Efficiency, Correctness, Maintainability, Security) get a reviewer pair per cluster reading a pathspec-cut slice (`git diff <base> -- <cluster paths> > .tmp/review-diff-<cluster>.patch`), while the cross-cutting dimensions (Code Reuse, Structural Health, Architecture) keep the whole diff. Each (dimension x cluster) cell is tracked as its own dimension for graduation, so a fix in one cluster re-runs only that cluster's pair. Verify the slice union equals the whole-scope file set before iteration 1; a file touched by two clusters appears in both slices, and slices for clusters whose files changed are regenerated alongside the whole patch after fixes. The N/A pre-triage may be applied per cell. With the workflow engine, express cells as payload sections: shared `## Criteria: <name>` sections holding the dimension text plus one short `## Dimension: <name> (<cluster>)` pointer section per cell -- reviewers read the whole payload file, so pointers resolve without repeating criteria text. Do NOT run parallel per-cluster loops instead: loop controllers apply fixes between iterations, and parallel controllers race each other in one working tree.

- **Additional prompt rules**:
  - **List the files in scope and tell the agent to batch-read them** (one Grep with multiple patterns, one Glob + targeted Reads) rather than sequential per-file Reads.
  - **For files > 200 lines, instruct the agent to use Read with `offset`/`limit`** to scope to the relevant region. A 6K-token whole-file read sits in the conversation prefix for every subsequent turn.
  - If a rule in CLAUDE.md conflicts with the code, check the branch diff to see if the rule was just updated — don't flag the code as violating an outdated rule.
  - Don't infer intent from commit messages alone. Commit titles like "DROPME", "debug", "wip" describe the state when committed, not the current state. Judge code by reading the code (is the logging guarded? does it fire sparingly? does it serve a documented purpose?). If unsure, flag with low confidence rather than demanding removal.

- **Post-fix steps**: rebuild (build only, no tests) to confirm nothing is broken. If the user explicitly set the scope to `staged` (i.e., they typed `/nightshift:revise-code staged`), stage the fixes so `git diff --cached` includes them in the next iteration. Do not stage otherwise — agents read files directly and don't need staging to see fixes.

- **Follow-up routing notes**: in this artifact type the follow-up list is the tech-debt list. Don't drop Dimension 7 (Structural Health) findings — too-large-to-fix-inline is exactly what route (b) exists for.

**Best-practice nudge for the codebase itself:** when review agents repeatedly flag something that turns out to be "future-slice plumbing" (field/method present now but only consumed in a later slice), the sustainable fix is a short `// slice N: ...` comment at the declaration so future agents (and future humans) don't re-discover the question. If you find yourself adding the same acknowledgement across two iterations, consider whether the code itself would benefit from documenting the intent inline.

**Diff-line-number trap:** when a diff is inlined or read from a patch file, agents sometimes mistake the hunk-header line numbers (`@@ -65,3 +65,6 @@`) or the cumulative line position within the diff for the live file's line numbers, producing findings that claim to be at the wrong location and may already be fixed. If a finding seems to duplicate a prior-iteration fix, or its line number lands far past the live file's length, instruct the agent (or check yourself) to re-read the live file at the claimed location before acting on it.

## Dimensions

### Dimension 1: Code Reuse

1. Search for existing utilities and helpers that could replace newly written code. Look for similar patterns elsewhere in the codebase — common locations are utility directories, shared modules, and files adjacent to the changed ones.
2. Flag any new function that duplicates existing functionality. Suggest the existing function to use instead.
3. Flag any inline logic that could use an existing utility — hand-rolled string manipulation, manual path handling, custom environment checks, ad-hoc type guards, and similar patterns are common candidates.

### Dimension 2: Code Quality

Review both new code and pre-existing code in the changed files. Light refactoring of pre-existing issues is in scope when the fix is contained within the changed files (scout rule). Flag pre-existing issues at HIGH confidence only when the fix is straightforward and low-risk.

1. **Redundant state**: state that duplicates existing state, cached values that could be derived, observers/effects that could be direct calls
2. **Parameter sprawl**: adding new parameters to a function instead of generalizing or restructuring existing ones
3. **Copy-paste with slight variation**: near-duplicate code blocks that should be unified with a shared abstraction — including pre-existing duplication in changed files
4. **Leaky abstractions**: exposing internal details that should be encapsulated, or breaking existing abstraction boundaries
5. **Stringly-typed code**: using raw strings where constants, enums (string unions), or branded types already exist in the codebase. (If no constant exists yet and the string is duplicated across layers, that belongs to Maintainability item 1 instead.)

### Dimension 3: Efficiency

1. **Unnecessary work**: redundant computations, repeated file reads, duplicate network/API calls, N+1 patterns
2. **Missed concurrency**: independent operations run sequentially when they could run in parallel
3. **Hot-path bloat**: new blocking work added to startup or per-request/per-render hot paths
4. **Recurring no-op updates**: state/store updates inside polling loops, intervals, or event handlers that fire unconditionally — add a change-detection guard so downstream consumers aren't notified when nothing changed
5. **Unnecessary existence checks**: pre-checking file/resource existence before operating (TOCTOU anti-pattern) — operate directly and handle the error
6. **Memory**: unbounded data structures, missing cleanup, event listener leaks
7. **Overly broad operations**: reading entire files when only a portion is needed, loading all items when filtering for one

### Dimension 4: Correctness

1. **Bugs and logic errors**: incorrect conditions, off-by-one errors, wrong operator, inverted logic
2. **Edge cases**: null/empty inputs, boundary values, concurrent access, error paths
3. **Missing error handling**: unhandled exceptions, ignored return values, missing validation at system boundaries
4. **Naming and style**: consistency with the rest of the codebase and CLAUDE.md conventions
5. **Test coverage gaps**: new code paths without corresponding tests, missing edge case tests
6. **Library-behavior assumptions**: before reporting a HIGH-confidence finding that depends on how a third-party library behaves at runtime — transform/validation ordering, null/undefined handling, lifecycle or event timing, default-value handling — verify it against the installed library source (under `node_modules`) or its typings, not general familiarity. Library internals are a recurring false-positive class; state the verdict only after confirming the actual code path.

### Dimension 5: Maintainability

**YAGNI guard**: do NOT suggest abstractions, interfaces, factories, or indirection "just in case." If the current code handles the current requirements cleanly, it is maintainable. The bar is: "would a reasonable developer curse this code when making a *probable* change?" For *Brittle coupling*, *Missing seams*, and *Configuration buried in code*, you must cite the specific file and line that establishes the existing pattern (or the second location of the duplication) before flagging an issue. If you cannot name a specific, probable future change that this code makes painful, say LGTM for this item.

Focus: will this code be *painful* to change when requirements shift? Only flag cases where the cost of changing later is disproportionately high compared to doing it right now. Do NOT flag speculative "what if" scenarios — only structural choices that create real friction for likely changes.

1. **Brittle coupling**: values or logic duplicated across layers that must be updated in lockstep (e.g., the same magic string in config, Bicep, and code). A single source of truth exists but isn't used.
2. **Missing seams**: implementation details inlined where an abstraction boundary would make a *likely* change trivial instead of invasive (e.g., direct SDK calls in a controller instead of behind an interface). Only flag when the codebase already has a pattern for this and the new code breaks it.
3. **Fragile assumptions**: code that silently breaks if an external contract changes (API response shapes, queue message formats, config schemas, positional arguments in calls to external tools) — hardcoded array indices, assumed response shapes without validation, implicit ordering dependencies.
4. **Deprecation risk**: use of APIs, packages, or patterns that are already deprecated or have announced deprecation timelines.
5. **Configuration buried in code**: values that are likely to change per-environment or over time but are hardcoded instead of configurable. Only flag when the codebase already externalizes similar values.

### Dimension 6: Security

1. **Injection vulnerabilities**: SQL injection, command injection, XSS, path traversal, SSRF via user-controlled URLs
2. **Auth/authz gaps**: missing permission checks, privilege escalation, insecure defaults, CORS/CSP misconfiguration
3. **Secret exposure**: hardcoded credentials, secrets in logs or error messages, sensitive data in client-facing responses
4. **Input validation**: unsanitized user input at system boundaries, trust boundaries crossed without validation, insecure deserialization
5. **Cryptographic misuse**: weak algorithms, predictable randomness, improper key/token handling

### Dimension 7: Structural Health

Lift your gaze from the changed code to the surrounding codebase. This dimension catches slow-building problems that individual dimensions miss because they're too focused on the diff. Review both new and pre-existing code in the changed files.

**"Pre-existing" is not a reason to skip.** The other dimensions review the diff; this one reviews the *files the diff touches*. If a method was already too long before this change, flag it. If a class was already accumulating responsibilities, flag it. The follow-up logging step ensures these get tracked even if they're too large to fix inline.

1. **Sprawl**: Methods that are too long, classes with too many dependencies or responsibilities, files doing too much. If a change adds to an already-large method, flag the method — not just the addition.
2. **Responsibility creep**: Classes taking on responsibilities beyond their original scope (e.g., a controller doing business logic, a service mixing I/O with computation). Look for signs that a class needs to be split.
3. **Extractable blocks**: Inline logic blocks that could be extracted into named, testable methods or services. Focus on blocks with clear inputs/outputs that are buried inside larger methods.
4. **Architectural fit**: Does the new code follow the same patterns as adjacent code? If the codebase uses service abstractions, does the new code go through them or bypass them?
5. **Stale surroundings**: Did the changes make nearby code stale? Documentation comments describing old behavior, constants that should have been updated, call sites that should use the new API but still use the old one.
6. **Missing updates**: New enum values without switch case coverage, new fields without serialization handling, new services without DI registration, new endpoints without auth checks matching existing endpoints.
7. **Growing pains**: Signs the architecture is straining — fan-out (one change touching many files for a simple feature), shotgun surgery patterns, circular or layering-violating dependencies between services.

### Dimension 8: Architecture

Zoom out to the system level. The other dimensions review files and classes; this one reviews the *project structure, dependency graph, and service decomposition*. Read the composition root (the wiring/DI entry point — `Program.cs` in .NET, the app factory or main module elsewhere), module/project references, and service interfaces to understand the system shape, then assess whether it's still well-decomposed for its current size and complexity.

**Be direct.** Working code that's poorly structured is still poorly structured. Don't hedge with "this works fine but..." — if the decomposition is wrong, say so. The follow-up logging step captures findings that are too large to fix inline. The only findings to skip are purely academic ones with no concrete cost — if you can name a specific symptom (hard to test, hard to change, hard to understand), it's worth flagging.

1. **Service decomposition**: Services that have outgrown their original scope and should be split. Look for services with many methods spanning unrelated concerns, or services whose name no longer describes what they do.
2. **Missing abstractions**: Business logic duplicated across controllers, background services, or functions that should be consolidated into a domain service. Cross-cutting concerns (retry, progress reporting, blob path construction, error sanitization) handled ad-hoc instead of centrally.
3. **Dependency graph health**: God services that everything depends on, circular knowledge between services, inappropriate coupling (e.g., a background-worker class knowing about web-host internals). Check constructor parameter counts as a smell.
4. **Data model evolution**: Entities accumulating too many fields that represent different concerns. Value objects that should be extracted. DTOs that duplicate entity structure without adding value.
5. **Project/module boundaries**: Are the module boundaries still right for what the system has become? Is shared code (a Shared project, a common package, a utils module) still genuinely shared, or does some of it belong to a single consumer? Are auxiliary deployment units (serverless functions, workers, CLIs) appropriately thin relative to the core?
6. **Scaling bottlenecks**: Singleton services that will need scoping, in-memory state that should be externalized, synchronous operations that will need to become async as load grows.
