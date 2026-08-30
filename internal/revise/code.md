# Artifact parameters: code

## Scope

The scope is everything passed after the `code` artifact token.

Resolve the intended logical changeset with this decision procedure:

1. Infer the intended logical change from the explicit invocation, implementation plan or handover target, conversation context, relevant commits, and current staged, unstaged, and untracked changes.
2. Record the resolved base, included paths, explicit exclusions, contextual same-file changes, and rationale in `.tmp/revise-state.md`.
3. Include related unexpected changes. Preserve and exclude clearly unrelated work, while supplying same-file context when reviewers need it to judge the target safely.
4. In an interactive run, ask the user only when a change remains genuinely ambiguous after inspection.
5. In autonomous handover, choose the narrowest scope that completely covers the target behavior, record the choice for the morning report, and continue. Halt only when continuing would risk overwriting or committing unrelated user work.
6. Preserve Git channels. Never stage unrelated unstaged hunks just because they share a file with staged work. Choose a patch, staging, or commit strategy appropriate to the observed worktree rather than blindly diffing `base..HEAD` or staging a whole ambiguous file. For an older commit range, deliver the intended commit patch as the review target, supply later same-file content as context, verify every finding against the live file before editing, and include only controller-accepted fixes in later cumulative patches.
7. Regenerate every later review patch from the resolved logical changeset plus all accepted fixes so the patch and live files agree.

## Setup

**Collect the files to review.** Read every included live file, review deleted files from the patch, and verify that each contextual or excluded same-file change is represented according to the recorded scope decision. If the resolved logical changeset is empty, report that there is nothing to review and stop.

## Agreement binding and fingerprint

Load `${CLAUDE_PLUGIN_ROOT}/skills/spec-agreement/spec-agreement.js`. When an active plan exists, also load `${CLAUDE_PLUGIN_ROOT}/internal/plan-binding.md`, establish its shared binding before the first plan read, and retain that binding for the complete review lifecycle. Revalidate before each authoritative plan read and before each reviewer or skeptic dispatch that receives plan-derived context. Consume only captured plan bytes returned by revalidation, including for `parsePlanContract`, acknowledgement seeds, overlap detection, and review payload content; never reopen the plan pathname for authority. Obtain every governing seed by running `parsePlanContract` against those captured plan bytes and bind the agreement target to the selected stable whole-plan or section scope. Without an active plan, bind the target to the explicitly selected governing scope. Feed every explicit seed and parsed declaration through normal `resolveGoverningSet`; do not infer a governing artifact from recency or duplicate plan parsing, scope ordering, or candidate mapping in this profile.

For each resolved governing artifact, call `selectArtifact` with its controller-resolved selector kind and selectors, then call `hashSelection` on that exact selection. Those shared operations own agreement fingerprint selection and hashing. Eligible design content includes `Status:` lines. The code review's generated cumulative patch and its review fingerprint remain separate delivery state; ordinary cumulative-patch movement never changes the stable agreement target or triggers an agreement check.

After a complete controller mutation batch, compare every mutated canonical path with the resolved governing artifact paths and the active plan path. Reconstruct only for relevant overlap: any governing-artifact mutation, or an active-plan mutation that changes the active-plan target or its exact `## Governing specs` governing declarations. Revalidate and refresh the retained binding around any active-plan mutation according to the shared procedure before parsing or dispatch resumes. Ordinary implementation changes, non-overlapping code fixes, and ordinary task-prose changes in the active plan remain outside the agreement boundary. An overlap-detection, plan-parse, resolution, reconstruction, or comparison failure blocks dispatch at the common resumable boundary.

For relevant overlap, invoke `${CLAUDE_PLUGIN_ROOT}/skills/spec-agreement/SKILL.md` in `post-mutation` phase once after controller fixes and pending user requests have fully drained. Governing-source changes use the shared contract-fit path; an active-plan target or declaration change uses the shared deterministic structural path. This profile supplies only the overlap trigger and never duplicates mapping, comparison, or semantic classification logic.

## Review parameters

- **Artifact**: the in-scope code changeset. Edit surface: the source files in scope; fixes are applied directly to them.

- **Model pin**: pass `model: "sonnet"` to every reviewer Agent call. Rationale: code review runs eight original reviewers per whole-diff round plus a variable number of skeptics, with additional reviewers when sharded, and the build/test cycle provides an independent safety net for applied fixes, so the cheaper tier's volume wins over the stronger tier's judgment. Plan/spec review has no such net and pins opus.

- **Pre-seed sources** (for the acknowledgements list, before the first round):
  - Scan the project's CLAUDE.md for patterns that contradict general best practice (e.g., a wrapper that deliberately uses bare system Python instead of the venv, a custom exception that overlaps with a standard library one, an unconventional file layout) and seed them as acknowledgements proactively. Project-specific intentional deviations are the most expensive class of false positive; a 5-minute pre-scan saves 3-4 review rounds.
  - Any third-party-library runtime behavior the change hinges on, once you have confirmed it from the installed source (e.g. "react-hook-form's `setValueAs` runs before validation and is never called with `undefined`"). Same expensive false-positive class, cheapest to suppress before the first round.
  - The plan's Global Constraints section (and any equivalent settled-design list) when the changeset was implemented from a plan. Constraint-mandated shapes are indistinguishable from accidental duplication to a fresh reviewer (e.g. a deliberately per-entry-point helper that a constraint forbids centralizing), so each such constraint goes into the acknowledgements before it costs a skeptic cycle.

- **Delivery rules**:
  - Generate one cumulative review patch for the resolved logical changeset. For scopes under about 2K lines and 15KB, include the patch in the common context of each cell payload. For larger scopes, write it once to `.tmp/review-diff.patch` and direct reviewers to read it. Reviewers do not invoke `git diff` themselves.
  - **Always include prior-round fixes in subsequent-round patches.** Regenerate the cumulative patch after each accepted fix so it agrees with the live files, regardless of whether fixes are committed, staged, or unstaged. Skipping this creates a multi-round false-positive trap where fresh reviewers re-flag resolved issues.

- **Canonical delivery map**: the `Dimension cells`, `Resolved code paths`, and `Local slice paths` tables in `.tmp/revise-state.md` are the authority. Encode each normalized repository-relative forward-slash path as lowercase UTF-8 hex. Store one resolved row per path and one local-slice row per `(cell ID, path)` membership. Sort dimension cells by ordinal Cell ID, resolved rows by ordinal encoded path, and local-slice rows by ordinal `(Cell ID, encoded path)`. Reject duplicate decoded paths within a set and require decoding to reproduce the original path bytes exactly, including semicolons, pipes, spaces, and Markdown metacharacters. A local cell uses `local-slice`; a cross-cutting cell uses `whole-scope` and resolves from all recorded paths. Create the map before the first round and the first payload. Atomically refresh all three tables whenever scope, cluster membership, cell identity, or path membership changes, even when the stable cell ID and cluster label remain unchanged. After every refresh and on resume, prove that the decoded local-slice union equals the resolved path set. The map drives applicability, lineage, payload generation, and union verification; payloads are derived caches.

- **Scope expansion**: when an accepted fix creates, renames, or newly depends on a related file, update the recorded scope before generating the next payload. Re-evaluate applicability immediately: a contradicted N/A becomes active with no certification, and the finding's active cell remains active. Refresh the fingerprint, map, payloads, union proof, and cumulative patch before the next round; the scope-map change clears `Verifier stamp` if set and the certifications of every affected cell (whole-scope and cross-cutting cells on any map change, local cells on slice-membership change) even when the patch fingerprint holds, reactivating them so later rounds re-review every settled cell against the expanded scope.

- **Shard lineage**: mint every stable cell ID within `^[a-z0-9][a-z0-9._/-]{0,115}$`, reserve room for a numeric collision suffix, and check uniqueness against the complete map. Persisted IDs remain authoritative when labels change. An unchanged logical `(dimension, cluster)` cell keeps its ID, status, N/A reason, and certification when only its label changes; a change to its slice membership clears the certification and reactivates it, because the certification attests exactly the reviewed slice. A split or merge gets a new ID and records ordinal predecessor IDs. A genuinely new local cell starts active with no certification. First re-evaluate applicability against the exact new slice. An inapplicable cell becomes N/A with one newly evaluated reason for its complete slice. A split child whose slice is a subset of a single inactive predecessor's certified slice inherits that predecessor's certification; every other minted cell, including every merge and every cell with no applicable predecessors, starts active with no certification. An applicable cell never inherits N/A from an inapplicable relative. Cross-cutting cells retain identity and lifecycle fields while their whole-scope payloads refresh. No remap resets a stable cell's repair counter.

- **Sharding for large scopes**: when the changeset spans independent work clusters and exceeds about 3K lines, local dimensions (Code Quality, Efficiency, Correctness, Maintainability, Security) get one reviewer per stable `(dimension, cluster)` cell per round against a pathspec-cut slice. Cross-cutting dimensions (Code Reuse, Structural Health, Architecture) keep the whole scope. A fix keeps only its cell active; the staleness sweep reactivates settled cells once the active set drains, and slices regenerate between rounds. Never run parallel per-cluster controllers in one working tree.

- **Additional prompt rules**:
  - **List the files in scope and tell the agent to batch-read them** (one Grep with multiple patterns, one Glob + targeted Reads) rather than sequential per-file Reads.
  - **For files > 200 lines, instruct the agent to use Read with `offset`/`limit`** to scope to the relevant region. A 6K-token whole-file read sits in the conversation prefix for every subsequent turn.
  - If a rule in CLAUDE.md conflicts with the code, check the branch diff to see if the rule was just updated; don't flag the code as violating an outdated rule.
  - Don't infer intent from commit messages alone. Commit titles like "DROPME", "debug", "wip" describe the state when committed, not the current state. Judge code by reading the code (is the logging guarded? does it fire sparingly? does it serve a documented purpose?). If unsure, flag with low confidence rather than demanding removal.
  - When you verify a suspected behavior with a live probe, replicate the execution scope and context of the code under review (module vs script scope, imported vs dot-sourced, the framework's real call path), not just the expression; a probe run in a different scope can prove behavior the real code path never exhibits.

- **Post-fix steps**: rebuild (build only, no tests) to confirm nothing is broken. If the explicit scope is `staged`, stage accepted fixes so the staged channel includes them in the next round. Do not stage otherwise. Commit each round's verified fixes at the round boundary when session and project conventions permit unprompted commits: use `git commit --fixup=<sha>` for a corrected commit range and a standalone commit otherwise. Where commits require explicit direction, leave fixes uncommitted and regenerate the cumulative patch against the working tree. Never commit while round agents are in flight.

- **Follow-up routing notes**: in this artifact type the follow-up list is the tech-debt list. Don't drop Dimension 7 (Structural Health) findings; too-large-to-fix-inline is exactly what route (b) exists for.

**Best-practice nudge for the codebase itself:** when review agents repeatedly flag something that turns out to be "future-slice plumbing" (field/method present now but only consumed in a later slice), the sustainable fix is a short `// slice N: ...` comment at the declaration so future agents (and future humans) don't re-discover the question. If you find yourself adding the same acknowledgement across two rounds, consider whether the code itself would benefit from documenting the intent inline.

**Diff-line-number trap:** when a diff is inlined or read from a patch file, agents sometimes mistake the hunk-header line numbers (`@@ -65,3 +65,6 @@`) or the cumulative line position within the diff for the live file's line numbers, producing findings that claim to be at the wrong location and may already be fixed. If a finding seems to duplicate a prior-round fix, or its line number lands far past the live file's length, instruct the agent (or check yourself) to re-read the live file at the claimed location before acting on it.

## Dimensions

### Dimension 1: Code Reuse

1. Search for existing utilities and helpers that could replace newly written code. Look for similar patterns elsewhere in the codebase; common locations are utility directories, shared modules, and files adjacent to the changed ones.
2. Flag any new function that duplicates existing functionality. Suggest the existing function to use instead.
3. Flag any inline logic that could use an existing utility: hand-rolled string manipulation, manual path handling, custom environment checks, ad-hoc type guards, and similar patterns are common candidates.

### Dimension 2: Code Quality

Review both new code and pre-existing code in the changed files. Light refactoring of pre-existing issues is in scope when the fix is contained within the changed files (scout rule). Flag pre-existing issues at HIGH confidence only when the fix is straightforward and low-risk.

1. **Redundant state**: state that duplicates existing state, cached values that could be derived, observers/effects that could be direct calls
2. **Parameter sprawl**: adding new parameters to a function instead of generalizing or restructuring existing ones
3. **Copy-paste with slight variation**: near-duplicate code blocks that should be unified with a shared abstraction, including pre-existing duplication in changed files
4. **Leaky abstractions**: exposing internal details that should be encapsulated, or breaking existing abstraction boundaries
5. **Stringly-typed code**: using raw strings where constants, enums (string unions), or branded types already exist in the codebase. (If no constant exists yet and the string is duplicated across layers, that belongs to Maintainability item 1 instead.)

### Dimension 3: Efficiency

1. **Unnecessary work**: redundant computations, repeated file reads, duplicate network/API calls, N+1 patterns
2. **Missed concurrency**: independent operations run sequentially when they could run in parallel
3. **Hot-path bloat**: new blocking work added to startup or per-request/per-render hot paths
4. **Recurring no-op updates**: state/store updates inside polling loops, intervals, or event handlers that fire unconditionally; add a change-detection guard so downstream consumers aren't notified when nothing changed
5. **Unnecessary existence checks**: pre-checking file/resource existence before operating (TOCTOU anti-pattern); operate directly and handle the error
6. **Memory**: unbounded data structures, missing cleanup, event listener leaks
7. **Overly broad operations**: reading entire files when only a portion is needed, loading all items when filtering for one

### Dimension 4: Correctness

1. **Bugs and logic errors**: incorrect conditions, off-by-one errors, wrong operator, inverted logic
2. **Edge cases**: null/empty inputs, boundary values, concurrent access, error paths
3. **Missing error handling**: unhandled exceptions, ignored return values, missing validation at system boundaries
4. **Naming and style**: consistency with the rest of the codebase and CLAUDE.md conventions
5. **Test coverage gaps**: new code paths without corresponding tests, missing edge case tests
6. **Library-behavior assumptions**: before reporting a HIGH-confidence finding that depends on how a third-party library behaves at runtime, transform/validation ordering, null/undefined handling, lifecycle or event timing, default-value handling, verify it against the installed library source (under `node_modules`) or its typings, not general familiarity. Library internals are a recurring false-positive class; state the verdict only after confirming the actual code path.

### Dimension 5: Maintainability

**YAGNI guard**: do NOT suggest abstractions, interfaces, factories, or indirection "just in case." If the current code handles the current requirements cleanly, it is maintainable. The bar is: "would a reasonable developer curse this code when making a *probable* change?" For *Brittle coupling*, *Missing seams*, and *Configuration buried in code*, you must cite the specific file and line that establishes the existing pattern (or the second location of the duplication) before flagging an issue. If you cannot name a specific, probable future change that this code makes painful, say LGTM for this item.

Focus: will this code be *painful* to change when requirements shift? Only flag cases where the cost of changing later is disproportionately high compared to doing it right now. Do NOT flag speculative "what if" scenarios; only structural choices that create real friction for likely changes.

1. **Brittle coupling**: values or logic duplicated across layers that must be updated in lockstep (e.g., the same magic string in config, Bicep, and code). A single source of truth exists but isn't used.
2. **Missing seams**: implementation details inlined where an abstraction boundary would make a *likely* change trivial instead of invasive (e.g., direct SDK calls in a controller instead of behind an interface). Only flag when the codebase already has a pattern for this and the new code breaks it.
3. **Fragile assumptions**: code that silently breaks if an external contract changes (API response shapes, queue message formats, config schemas, positional arguments in calls to external tools): hardcoded array indices, assumed response shapes without validation, implicit ordering dependencies.
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

1. **Sprawl**: Methods that are too long, classes with too many dependencies or responsibilities, files doing too much. If a change adds to an already-large method, flag the method, not just the addition.
2. **Responsibility creep**: Classes taking on responsibilities beyond their original scope (e.g., a controller doing business logic, a service mixing I/O with computation). Look for signs that a class needs to be split.
3. **Extractable blocks**: Inline logic blocks that could be extracted into named, testable methods or services. Focus on blocks with clear inputs/outputs that are buried inside larger methods.
4. **Architectural fit**: Does the new code follow the same patterns as adjacent code? If the codebase uses service abstractions, does the new code go through them or bypass them?
5. **Stale surroundings**: Did the changes make nearby code stale? Documentation comments describing old behavior, constants that should have been updated, call sites that should use the new API but still use the old one.
6. **Missing updates**: New enum values without switch case coverage, new fields without serialization handling, new services without DI registration, new endpoints without auth checks matching existing endpoints.
7. **Growing pains**: Signs the architecture is straining: fan-out (one change touching many files for a simple feature), shotgun surgery patterns, circular or layering-violating dependencies between services.

### Dimension 8: Architecture

Zoom out to the system level. The other dimensions review files and classes; this one reviews the *project structure, dependency graph, and service decomposition*. Read the composition root (the wiring/DI entry point, `Program.cs` in .NET, the app factory or main module elsewhere), module/project references, and service interfaces to understand the system shape, then assess whether it's still well-decomposed for its current size and complexity.

**Be direct.** Working code that's poorly structured is still poorly structured. Don't hedge with "this works fine but..."; if the decomposition is wrong, say so. The follow-up logging step captures findings that are too large to fix inline. The only findings to skip are purely academic ones with no concrete cost; if you can name a specific symptom (hard to test, hard to change, hard to understand), it's worth flagging.

1. **Service decomposition**: Services that have outgrown their original scope and should be split. Look for services with many methods spanning unrelated concerns, or services whose name no longer describes what they do.
2. **Missing abstractions**: Business logic duplicated across controllers, background services, or functions that should be consolidated into a domain service. Cross-cutting concerns (retry, progress reporting, blob path construction, error sanitization) handled ad-hoc instead of centrally.
3. **Dependency graph health**: God services that everything depends on, circular knowledge between services, inappropriate coupling (e.g., a background-worker class knowing about web-host internals). Check constructor parameter counts as a smell.
4. **Data model evolution**: Entities accumulating too many fields that represent different concerns. Value objects that should be extracted. DTOs that duplicate entity structure without adding value.
5. **Project/module boundaries**: Are the module boundaries still right for what the system has become? Is shared code (a Shared project, a common package, a utils module) still genuinely shared, or does some of it belong to a single consumer? Are auxiliary deployment units (serverless functions, workers, CLIs) appropriately thin relative to the core?
6. **Scaling bottlenecks**: Singleton services that will need scoping, in-memory state that should be externalized, synchronous operations that will need to become async as load grows.
