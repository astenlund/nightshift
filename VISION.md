# Nightshift vision

Working draft, updated 2026-09-07. This document captures the direction for later changes to Nightshift's implementation and backlog. It distinguishes settled direction from choices that still need design; it does not authorize those later changes or describe them as shipped.

## Purpose

Nightshift should let a developer settle the decisions they care about, entrust the engineering work to a capable model, and return to a useful result supported by concrete evidence. The developer owns intent, consequential tradeoffs, and authority. Nightshift owns carrying authorized work through implementation, independent review, verification, and an understandable closing report.

The central design assumption is that a strong model can exercise engineering judgment from a clear outcome, meaningful constraints, and access to the real project. The workflow should support that judgment while making errors discoverable. Every additional artifact, agent role, approval boundary, and review pass must justify its contribution under the invariant priorities below, including its ongoing maintenance.

## Invariant priorities

All future Nightshift development and backlog decisions follow this fixed order:

1. **Autonomy.** The user should be able to hand over work, go to bed, and return to a useful result. Resolve known user-owned decisions and essential prerequisites before handover. Routine decisions, avoidable approval loops, and recoverable execution failures must not leave the run waiting for the user shortly after departure. Carry authorized work through with appropriate recovery, allowed fallback, and continuity.
2. **Quality.** The user cannot be expected to review the code personally. Nightshift must carry implementation quality, independent review, and verification for ambitious projects whose owner has limited time. A successful result meets its agreed obligations with concrete evidence; human code inspection is not the workflow's normal safety net.
3. **Speed, efficiency, and economy.** Keep improving observed inefficiencies, but assess these gains after autonomy and quality. Additional time or model cost can be justified when it improves reliable unattended delivery or necessary assurance, within the user's explicit limits.

The intended outcome is unattended delivery of work that meets its quality obligations. Silently dropping required work or declaring an unresolved result complete does not achieve autonomy. These priorities do not create authority to expand scope, bypass restrictions, or exceed a user-set limit. Genuine blockers remain explicit, while independent authorized work continues. An MVP may omit advanced capabilities, but its supported path must not rely on routine mid-run intervention or the user auditing the code.

## Built around capable, interchangeable models

Claude Fable 5.1 and GPT-6 Astra are the current reference models for sustained coding and multistep work. Their documented capabilities motivate delegating engineering judgment, while their limitations still require clear scope and verification. That is the design premise to evaluate on real work, not a claim of infallibility. [Fable guidance](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1), [Astra guidance](https://developers.openai.com/api/docs/guides/latest-model).

Either model can lead, implement, review, act as skeptic, or verify. Availability, user preference, task fit, and observed performance determine assignment. One available model must support the complete workflow through independent agent contexts. Splitting work between models is an optional advantage; different families do not guarantee independent errors.

The controller chooses assignments using task fit, observed model strengths, availability, context, and cost within the invariant priorities. The user's reported tendencies inform that judgment without prescribing a fixed team or a fixed model for each stage; structured model teams are a later capability. Respect explicit model choices and preserve control of an existing run. Establish the problem before editing regardless of the chosen implementer.

Claude Code and Codex should provide the same intent and review standards through their available tools. Missing parallelism can mean sequential work. If an adequately capable model, independent review context, or required verification capability is unavailable, preserve progress and report which work is blocked. Model availability must not silently lower the completion standard.

Project-owned Nightshift files belong in a root `.nightshift` directory shared across hosts, including the backlog, feature and spec documents, and durable run records. V3 includes migration from `.claude` that preserves content, links, tracking choices, and recoverable work while retaining the backlog format. Host-owned configuration remains in its required location.

## Settle the meaningful decisions

Brainstorming should resolve what success means and which tradeoffs the user wants to own. The controller explores the existing project, challenges assumptions, and asks questions whose answers would materially change the result. Routine implementation choices remain within its delegated judgment.

A spec records the resulting commitments:

- the problem, intended outcome, and scope;
- important observable behavior and accepted exclusions;
- constraints and architectural decisions whose reversal would materially affect the result;
- meaningful failure, compatibility, data preservation, and recovery expectations;
- evidence that will demonstrate success;
- unresolved decisions that prevent implementation.

The spec's depth follows these commitments. For a small change, an agreed request or backlog entry may carry them without another document. Exact technical detail belongs where it defines a real contract or protects a consequential decision. Complete internal algorithms, speculative failure trees, verbatim implementation blocks, and exhaustive command sequences do not become mandatory just because a model could write them down.

Different implementations may satisfy the same spec. A reviewer should identify an unfulfilled commitment or a consequential ambiguity before demanding more detail. When the behavior and constraints are complete, an open implementation choice is a delegation of judgment.

Authority comes from the user's request to perform work or an explicit delegation over a defined scope, including a bounded set of backlog work. An existing spec or backlog entry supplies requirements but does not authorize its own implementation. A clear implementation request can supply both commitments and authority; brainstorming resolves consequential uncertainty rather than imposing a ceremony on every change.

Agreement should be an understandable conversation about those commitments. Compatible refinements and movement between workflow stages should not repeatedly require approval of the same intent. A material change to the accepted outcome, obligations, or authority does require the user's decision. Internal hashes and protocol state support that boundary without becoming the user's reading assignment.

## Implement directly, with evidence throughout

The normal flow is to clarify intent, record a concise spec, settle any consequential design concerns, implement and test, obtain independent review of the result, and report what is complete. Spec review remains useful, with its placement and scale chosen deliberately rather than inherited from the current full lifecycle.

Implementation plans are not a routine artifact or lifecycle stage. The implementing model reads the project, reasons about dependencies, chooses an approach, and adjusts as real code and tests provide feedback. A working task list or resumption note may support execution without becoming a separately hardened implementation document. Nightshift should operate without a Superpowers dependency.

A written implementation plan is an exception when the controller assigns work to a weaker or cheaper implementer that needs more explicit guidance. It supplies the context, boundaries, interfaces, and proof obligations that recipient needs. Producing and reviewing nearly complete code for another agent to transcribe must justify its total cost. Delegating to another strong model does not create a planning stage.

Subagents serve bounded purposes and independent review. Parallel implementation is useful where ownership is clear and integration is manageable; tightly coupled work can stay with one strong implementer. When coordination load warrants it, the controller may delegate operational detail to a lower-tier shift supervisor while retaining consequential engineering decisions, scope and authority judgments, finding dispositions, and final acceptance. The trigger is coordination load, not merely having subagents, and direct coordination remains available. Evaluate that delegation under the invariant priorities; a cost reduction is not a prerequisite for improved autonomy or quality. No fixed hierarchy or number of workers is required by this vision.

Verification happens during implementation as well as at the end. Tests, builds, targeted experiments, and live use of the affected flow resolve uncertainties against the actual system. The evidence should address realistic failure consequences and agreed acceptance criteria. Additional testing or repeated checks need a reason tied to changed code, a failure, or an unresolved concern.

## Review for useful decisions

Fresh review remains a defining strength of Nightshift. Reviewers receive the artifact, requirements, applicable constraints, and necessary project context without inheriting the author's conversational argument for its correctness. Independent context reduces one source of bias; it does not make a reviewer correct by construction.

The MVP includes cross-host reviewer dispatch. Prefer a lead reviewer of the required strength on the other host when available, while leaving placement to controller judgment about task fit, independence from the reasoning that shaped the artifact, availability, and run constraints. A fresh, equally qualified same-host reviewer remains valid when the counterpart is unavailable or that placement is more suitable. Preserve explicit model requirements and the strong review gate. Cross-host placement supports a different perspective without guaranteeing independent errors.

Multidimensional review remains available for specs and code. Every review starts with the complete dimension brief; the author does not exclude dimensions on the reviewer's behalf. A small change starts with one fresh strong reviewer, while an independent strong reviewer of larger work decides whether to recruit help and retains responsibility for the integrated assessment. Additional review staff use the lead reviewer's model and effort in fresh contexts. The [workflow's dimension brief](WORKFLOW.md#review-dimensions) defines the agreed spec and code lenses, with local structure and system architecture explicitly covered together. An implementation plan exception does not recreate the old review ladder by default.

Spec review focuses on whether the commitments are coherent, feasible, sufficiently bounded, and verifiable. Code review examines whether the implementation fulfills them and works correctly in its actual setting, including integration, maintainability, and relevant failure behavior. Progress past a review gate requires a completed assessment by a strong independent reviewer with credible broad coverage of the complete artifact or cumulative change across all dimensions, even when other reviewers examine parts of it. The controller advances only on that evidence and with required work resolved. A model label or literal LGTM is not sufficient: consider the actual scope examined, supporting evidence, and review behavior. A returned assessment from only weaker reviewers, or one whose coverage is incomplete or narrowly focused, requires a fresh strong integrated assessment even when no artifact edit occurred. If that assessment is unavailable, preserve progress and do not advance past that gate, while continuing independent authorized work.

Every reported finding receives skeptic validation against concrete evidence. Factual validity, permission to act, and practical value remain separate judgments. Findings that survive verification and fall within authorized scope receive a value assessment before repair. For straightforward, undisputed findings, the controller can decide from the reviewer's and skeptic's existing evidence. Extend the adversarial dialogue when consequence, likelihood, value, or repair quality remains unclear or disputed, weighing benefit against effort, regression risk, complexity, and maintenance. Either participant can recommend a disposition; the controller decides:

- **Implement:** meet an agreed obligation or make an improvement whose benefit warrants the cost.
- **Defer:** preserve a worthwhile improvement with a concrete reason to revisit it and a durable route, while showing that current commitments still hold.
- **Skip:** accept the behavior or tradeoff with a reason, without automatically creating backlog debt.

A false claim is acknowledged as refuted. A true finding outside authorized scope receives a reasoned acknowledgement without an unauthorized edit or automatic backlog entry. Missing evidence remains unresolved. A failure to meet an agreed requirement must be repaired or explicitly renegotiated; cost alone cannot waive it. The [adversarial dialogue feature](.nightshift/features/adversarial-repair-dialogue.md) records the retained validity-and-value direction; its mechanics will be reconciled with this vision during the later transformation.

Resolved findings must count as resolved, but finding disposition does not establish review coverage. When the reviewed artifact is unchanged and the required strong, broad independent assessment is already complete, accepted skips, verified deferrals, and refutations need not force another round solely to obtain literal LGTM. Actual repairs require validation against the finding's evidence. After every repair batch, the independent reviewer re-examines the complete cumulative change across all dimensions, including affected surrounding code and sibling paths. Repair size does not restrict coverage: a tiny fix can introduce a regression or address the problem too narrowly. Depth and specialist staffing remain proportionate, and the same qualified independent reviewer can retain useful context. Previously settled tradeoffs travel with later reviews and reopen when new evidence defeats their basis. Completion requires that review coverage and no unresolved required work; a time or cost limit cannot manufacture a clean result.

## A controller that owns the result

The controller protects intent, makes authorized decisions, follows through, and evaluates whether work is making useful progress. It explains material decisions and uncertainty in plain language. Prepare handover by resolving known blocking user decisions and checking essential execution and review capabilities within the agreed scope and limits. During an unattended run, handle routine decisions and recoverable failures without renewed permission requests; a new obligation or a decision outside existing authority remains a human boundary. When the user is unavailable, record the unanswered decision, options, and evidence, pause the dependent work, and continue independent authorized work. The closing report must identify what remains incomplete; recording a question does not supply its answer.

Models own engineering and product judgment. Deterministic tools own mechanics where a mistake would lose work, corrupt state, or misrepresent what happened. The controller should use reliable operations rather than reconstructing intricate protocols from prose in every session. The amount of machinery should be proportionate to the consequence it prevents.

Cheap observable signals, such as repeated identical failures or a finding recurring after claimed repairs, should prompt the controller to examine its approach and report unresolved obstacles. Such signals support judgment rather than declaring failure automatically. A clean review round that changes nothing is useful progress. The exact signals and intervention thresholds remain design choices.

Long runs need enough durable context to resume: accepted intent, relevant decisions, completed work, remaining obligations, evidence, and unresolved findings. A replacement model reconciles that record with the actual project and any work still in flight before taking over. Model or host changes should preserve logical progress without assuming private reasoning or live sessions can transfer between providers. Missing or contradictory evidence prompts investigation, not fabricated continuity.

Workflow adherence must also remain dependable as context fills before compaction. Supply focused current obligations and applicable rules at consequential decision boundaries, and use reliable operations to detect missing prerequisites and failed state changes. Establish this behavior through long runs and deliberate compaction during implementation and review as part of MVP acceptance.

The user should hear what has been learned, what materially changed, and what remains uncertain. The closing report presents the result, verification, accepted tradeoffs, deferred work, and any decisions still required. Follow-ups retain the existing triage: one item at a time, enough context to decide, and a recommended fix now, track, or skip route where applicable; deferred approval questions keep their own terms. Already-resolved findings do not become new approval chores. Completion within the workspace and publication are distinct; deployment or other external actions require the user's authorization.

Before follow-up triage, a session retrospective retains revise-lore's purpose: examine the run, identify useful lessons and workflow problems, and prepare worthwhile proposed improvements for user decision. Proposed instruction changes retain independent review and user approval. A retrospective need not produce a proposal when no useful change is warranted.

## How this guides the transformation

The implementation and backlog should be reassessed against this vision before work is scheduled. Existing mechanisms and proposed features are candidates, not obligations created by their age, detail, or review history. Their underlying user need may remain valid even when the proposed mechanism no longer fits.

For each candidate, ask what user outcome it serves, which observed failure it prevents, whether that failure still exists in the intended workflow, and whether its value warrants the complexity and recurring cost. Preserve useful evidence and reasoning when merging, simplifying, or retiring entries. The adversarial validity-and-value distinction is a retained direction; its surrounding mechanics remain subject to the same scrutiny.

The backlog should help choose valuable work and retain worthwhile ideas. An incidental review observation should not automatically become a feature, and an experimental workflow adjustment should not silently become a permanent instruction. Learnings need evidence of continuing usefulness, including whether an existing rule can be removed or simplified.

Evaluate the transformation in the invariant order: first reliable unattended delivery and avoidable stalls or user interventions, then escaped defects and avoidable rework, then elapsed time and model cost within explicit limits. Finding counts and document length alone cannot establish success. Compare representative real tasks before treating a new workflow shape as better, and do not optimize a lower priority by undermining a higher one.

## Decisions still open

- How to recognize when a request needs a separate spec and spec review beyond the representative cases in the workflow.
- How to choose model effort and bounded delegation based on observed results and availability.
- How to scale investigation within complete review coverage, when to extend adversarial dialogue, and how to calibrate progress signals from actual runs.
- The smallest reliable execution and resumption machinery that preserves ownership and evidence across hosts.
- Which current backlog structures and supervisory mechanisms help the intended experience enough to retain.

The settled direction is concise commitments, direct implementation by capable models, exceptional implementation plans, flexible model assignment, independent review, and evidence-based finding disposition. The open choices refine that direction without making the existing machinery the default answer.
