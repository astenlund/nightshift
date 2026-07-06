---
name: revise
description: Shared fresh-agent review engine behind the revise-code, revise-plan, and revise-spec commands (the user entry points). Invoked with a first-argument artifact type (code, plan, or spec) followed by the scope; not called directly by users.
---

# revise

Iterative fresh-agent review loop shared by three artifact types. This file owns *how* the loop runs; the artifact parameter files beside it own *what* to review.

## Invocation

The first argument token selects the artifact type: `code`, `plan`, or `spec`. Everything after it is the scope, interpreted by the artifact file. Read the matching parameter file in this skill's directory before doing anything else:

- `code` → `code.md`
- `plan` → `plan.md`
- `spec` → `spec.md`

The parameter file supplies: scope resolution, the review **dimensions**, the **model pin** (with rationale), **pre-seed sources**, **delivery rules**, **additional prompt rules**, **post-fix steps**, the **edit surface** (plus named exceptions), and any post-loop extras (e.g. plan's Spec Reconciliation). If the first token is missing or isn't one of the three, ask which artifact type is meant.

## The loop

Repeat until all dimensions have graduated or 10 iterations have been reached (if the cap is reached, report which dimensions did not graduate and any outstanding issues from the last iteration). Each dimension is reviewed by 2 fresh agents per iteration. A dimension graduates the first iteration in which both of its agents return LGTM, **or** in which neither agent's findings led to an artifact change (all issues skipped or routed to follow-up). Once graduated, the dimension is no longer launched in subsequent iterations.

### Step 0: track state

**Dimension N/A pre-triage (once, before iteration 1).** The controller may declare a dimension N/A for this run when an observable scope fact makes it inapplicable (e.g., Security for a docs-only diff, Architecture for a sub-50-line localized fix, intermediate-commit verifiability for a plan with no cross-module signature changes). Each N/A declaration carries a one-line justification tied to the scope fact and is recorded in the iteration state and the final report so it stays auditable. N/A is a scope decision, not a consolidation shortcut: if any reviewer or verification result later contradicts the justification, re-activate the dimension. When in doubt, launch the dimension; graduation after one clean round is cheap.

At the start of every iteration, write a summary to the conversation listing every dimension and its current status. This is a hard prerequisite for step 1: never launch agents without updating this state first. After step 3 (evaluation), re-emit the updated state. Forgetting to launch a non-graduated dimension because of mental-model drift between batches is a known failure mode.

Also maintain an **acknowledgements & caveats** list that grows across iterations. **Pre-seed it before iteration 1** from the artifact file's pre-seed sources: intentional deviations, deliberate deferrals, and confirmed external facts are the most expensive class of false positive; agents converge on them as "obvious" findings, and each takes 1-2 iterations to suppress reactively. Every time step 3 decides to skip a finding or route it to follow-up, add it with a one-line rationale (e.g. "future-slice plumbing, used by slice 1's registerChannel"; "deliberate per spec"; "the missing failure-mode for case Y is documented in `## Open questions`, not a gap"; "balance is intentional, most reader risk lives in the heavier section"). A short list wastes no review time; a long list is the biggest single accelerator of later iterations.

**Persist the loop state to disk.** Write the dimension statuses, N/A declarations, and the acknowledgements & caveats list to `.tmp/revise-state.md` at every iteration boundary (after the step-4 summary), and re-read the file at each iteration start. Long runs can cross a context-compaction boundary; the scratch file, not conversation memory, is the authoritative copy of the loop state.

### Execution engine for steps 1-2

Two ways to run steps 1 and 2 of each iteration; prefer the workflow engine when the Workflow tool is available in the session.

**Workflow engine (preferred).** Invoke the Workflow tool once per iteration with `scriptPath: "${CLAUDE_PLUGIN_ROOT}/skills/revise/revise-iteration.workflow.js"`, passing args: `dimensions` (active dimensions only, each with name and full prompt text), `model` (the artifact file's pin), `artifact` (`description` + `deliveryInstructions` per the artifact file's delivery rules), `ackList`, `context` (project context, inlined CLAUDE.md excerpts, PATTERNS index), and `additionalRules`. The script fans out 2 fresh reviewers per dimension with structured-output schemas, then one skeptic per non-LGTM finding, and returns per-dimension results with verdicts attached: deterministic control flow that cannot forget a dimension or drop a reviewer at the queue tail, and typed findings instead of prose to re-parse. The controller resumes at step 3 with the returned findings; REFUTED findings arrive pre-verdicted and route straight to the acknowledgements list.

**Agent-tool engine (fallback).** When the Workflow tool or the script file is unavailable, run steps 1 and 2 manually as written below, using the Agent tool.

Steps 0 (state), 3 (evaluation), and 4 (summary) always remain with the controller, whichever engine ran the fan-out.

### Step 1: launch reviewers

Launch two fresh agents per non-graduated dimension, all in a single assistant message: one `<function_calls>` block containing every `Agent` invocation. (One Agent call per assistant turn serializes them regardless of intent.) Order by dimension number so that if any are dropped at the queue tail, earlier dimensions retain both reviewers. Each agent gets no prior context and must be a **fresh agent** (no `resume`), never a continuation of a prior agent. Pass the artifact file's model pin and `subagent_type: "Explore"` to each Agent call; drop to `general-purpose` only if a dimension legitimately needs to write files, which is rare in review.

In each prompt:

- Deliver the artifact per the artifact file's delivery rules.
- Include that dimension's full section (all text under its heading, including any preamble or guards).
- Include the full acknowledgements & caveats list, with the instruction "do NOT re-flag these; they are known and deliberate". This is the single biggest cycle-saver in later iterations.
- Inline the relevant CLAUDE.md excerpts instead of "read CLAUDE.md". A dozen-plus agents each reading a 10K-token CLAUDE.md is pure waste; paste the load-bearing rules once per prompt. Still tell agents to verify against the working-tree CLAUDE.md when something is ambiguous, since in-branch edits are possible.
- Inline `.claude/PATTERNS.md` (the index) verbatim, if present. Subagents dispatched via the Agent tool start with no SessionStart-hook output and no awareness of the project's pattern library; they will not consult patterns on their own. The index entries are designed to be recognition-sufficient: each one tells a reader whether the pattern applies without reading the linked breakout file. Tell the agent to open the linked `.claude/patterns/<slug>.md` files only for patterns whose index entry signals relevance to its dimension and scope.
- Give it enough project context (what kind of project this is, what the work under review is, which neighboring files matter), since it has no prior conversation history.
- Ask it to report HIGH confidence issues only, and to say "LGTM" if the artifact is clean for its dimension. Discourage rubber-stamp LGTMs by asking for a one-sentence note on what was verified (concrete claims about content, not vague verdicts).
- Apply the artifact file's additional prompt rules.

### Step 2: verify findings

**Do not edit the artifact until every agent in the current iteration has returned.** Evaluate all findings and apply all fixes strictly between iterations, then refresh the delivery state (regenerate the patch, update line ranges) before the next launch. This ordering makes it structurally impossible for an agent to review a half-fixed artifact and eliminates the stale-quote class of false positives.

Once all reviewers have returned, collect the non-LGTM findings and launch one fresh skeptic agent per finding, all in a single message (same model pin, `subagent_type: "Explore"`, artifact delivered per the same delivery rules as step 1). Give each skeptic the finding verbatim and the relevant dimension text, and ask it to try to REFUTE the finding against the artifact, returning one verdict:

- **CONFIRMED**: the issue is real; cite the artifact evidence.
- **REFUTED**: the finding is wrong; cite the artifact evidence.
- **JUDGMENT_CALL**: not factually decidable (a taste, balance, or priority question).

REFUTED findings are dropped and added to the acknowledgements list with a one-line reason so later iterations don't re-litigate them; a dropped-as-REFUTED finding counts as "skipped" for graduation purposes. CONFIRMED and JUDGMENT_CALL findings proceed to step 3. Uncoordinated reviewer convergence on a finding raises its verification priority, not its truth: converged findings still get a skeptic, and a verified-false convergent finding is dropped like any other.

### Step 3: evaluate

For each agent's response:

- If it said LGTM, mark it.
- If it reported issues, for each one:
  - If valid and actionable (small enough to fix inline): fix it in the artifact.
  - If valid but needing work beyond an inline artifact edit: add it to the follow-up list (routing happens in Follow-up logging below).
  - If incorrect, already addressed, or intentionally accepted: skip it and add a one-line entry to the acknowledgements & caveats list.

After processing all responses for a dimension's pair: **the dimension graduates this iteration iff no artifact change was made for it** (either both agents LGTM, or all of their findings were skipped/deferred). If even one agent's feedback led to a fix, the dimension does not graduate; it gets a fresh pair next iteration to verify the fix.

**No consolidation or efficiency shortcut.** Run the full prescribed round (2 fresh agents per non-graduated dimension) every iteration, including the final verification of a fix. A dimension that took ANY change (even a one-line, comment-only, or mechanical fix, even one already verified green by build or tests) is NOT graduated; it gets a fresh full pair next iteration. Never collapse that verification into a single agent, a self-review, or a "build/tests passed, so it's fine" judgement, and never skip a trailing iteration because the remaining fixes look trivial. The fresh-eyes coverage and the uncoordinated-convergence signal are the whole point, and trivial-looking final fixes are exactly where a consolidated pass has been observed to silently miss real issues that a full round then caught. If agent budget is a concern, surface it to the user rather than shortcutting on your own initiative.

Run the artifact file's post-fix steps if any fixes were applied this iteration.

### Step 4: iteration summary

Report a brief summary: what changed, which dimensions graduated, which are still active.

## Delivery profiles

**Document artifact (plan, spec).** Tell the agent the file path and the in-scope section heading(s); tell it to read the full file once for context, then focus on the in-scope sections. For files > 400 lines, instruct it to Read the in-scope sections directly via `offset`/`limit` rather than reading the whole file each turn. For partial-section reviews, include the section heading + line range explicitly; surrounding sections are background for consistency checks, and the agent should NOT flag issues outside the in-scope section as findings (they can be mentioned briefly under a "context note" header but are not the review target). **Prior-fix duplicate check**: if a finding seems to duplicate a prior-iteration fix, re-read the live file at the claimed location before acting on it; documents have no build feedback to catch mismatches. (The no-edit-until-batch-complete rule in step 2 prevents agents from ever seeing a half-fixed document, so this is a residual check, not a standing trap.)

**Code changeset.** See the delivery rules in `code.md` (diff sizing, patch file, regeneration across iterations); they are artifact-specific enough to live with the artifact file.

## Rules

- During the loop, edit only the artifact under review. No code (unless the artifact IS code), no docs, no command files, no backlog entries; those are author or execution-time decisions with their own commands and workflows. The artifact file names any exceptions.
- After the final iteration, report a summary of all changes made across all iterations, and include any cases where reviewer suggestions to cut content were declined; those are load-bearing decisions worth tracing through the final report.

## Follow-up logging

After the final iteration, collect all issues that were **valid but intentionally deferred** across all dimensions (too large to fix inline, needing follow-up beyond an artifact edit, pre-existing patterns, cosmetic refactors). For each item, **propose a route based on size and type** rather than asking open-endedly: a proposed route per item lets the user bulk-approve with one reply ("go with your suggestions") or override individually, while the open-ended form forces them to triage every item themselves. Routes:

- **(a) address now**: apply the change in the current session (small, scout-rule, low-risk; for document artifacts this includes adding to an Open questions section, documenting an anti-goal, or naming a dependency).
- **(b) track**: log to the project's tracking files (in projects with the four-index `.claude/` layout: `QUICK_WINS.md` for refactors, `FEATURES.md` for product-level design work, `BUGS.md` for defects; otherwise the equivalent the project uses). Check whether the suggested entry already exists in the target file; if so, refresh or cross-reference it rather than duplicating. This prevents the "valid but skipped" pile from silently growing across sessions.
- **(c) skip**: drop it (negligible, out of scope, or already covered elsewhere).

Name the suggested route and a one-line reason per item before the bulk-approval ask. Do NOT auto-log without asking; the user decides what's worth tracking.

## Dimension retrospective

After Follow-up logging, briefly reflect on the dimensions themselves:

1. **Coverage gaps**: did any agent finding fall outside all of the artifact file's dimensions? Would a new dimension have caught it, or does an existing one need broadening?
2. **Overlap as signal**: did multiple dimensions flag the same issue independently? Two uncoordinated reviewers converging on the same finding is one of the strongest positive signals this process produces; that agreement is a confidence boost, not waste.
3. **False positive patterns**: did agents repeatedly flag something that turned out to be correct or deliberate (an API they didn't know about, an intentional deferral)? The dimension's prompt may need a clarification or exclusion.
4. **Signal-to-noise**: did any dimension produce mostly low-value findings that wasted review cycles? Should its criteria be tightened?
5. **Missing context**: did agents lack context that led to bad calls? Should the dimension's prompt include additional project-specific guidance?

Then run any artifact-specific retrospective items the artifact file adds. If changes are warranted, route each one: loop-mechanics improvements belong in this SKILL.md (shared by all artifact types); dimension or artifact-specific improvements belong in the artifact parameter file (`code.md` / `plan.md` / `spec.md`). Edit the files in the nightshift plugin repo clone, not the installed cache. Show the diff, explain why, apply with the user's approval, and commit in the clone; pushing is the user's call.
