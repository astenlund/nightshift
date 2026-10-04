---
name: selection-review-and-assessment
description: When a readback or spec that asks whether to begin implementation is presented, dispatch background agents, starting from a review agent and a separate assessment agent, that review the draft, suggest tweaks and check the selected entries' settled decisions while the user reads
metadata:
  type: feature
---

# Background review and assessment of selected work

## Origin

Raised by the user on 2026-09-29, outside any run, while a review loop was running, in their words: "idea: when picking one or more entries to work on, the model should give a short assessment and suggest tweaks where appropriate. the assessment will run in parallel with the model and user reviews after the readback has been presented. it'll be an opportunity for the user to receive feedback from the model before work starts. this is valuable, since the original entry might have been entirely user-directed without any ai input and this is the last opportunity before implementation starts."

Asked how the second sentence was meant, the user explained: "not sure if it works like this today, but as the readback is presented, the model should launch a review agent for the selected entry or entries. the idea is that the review happens while the user reads the readback. this is so any issues will reach the user without much delay after the readback is accepted by the user and handover is invoked. i'd like this new assessment to run in parallel with the agent review."

## Current behavior

[The Ready skill](../../skills/ready/SKILL.md) turns a confirmed selection into interactive investigation and a readback that ends with a plain question asking whether to begin the work. [The operating brief](../../internal/workflow.md#priorities-and-authority) asks for a short understanding readback and confirmation for small work, and a concise spec for substantial work. Only the spec gets an independent review while the user reads it: the controller starts the spec assessment through a nonblocking dispatch and promptly presents the same draft, and implementation waits for agreed commitments and a resolved assessment, as [revise-spec](../../skills/revise-spec/SKILL.md) also states; its lead assesses meaningful commitments, soundness, failure and recovery, and proportionality. A plain readback gets no review agent, only the user's confirmation. Neither path dispatches a separate assessment of the selected entries themselves. On 2026-09-06 the v3 migration did agree that the controller integrate a proportionate assessment into the normal readback or spec presentation, in [its disposition](../../V3-MIGRATION.md#agreement-and-informed-user-decisions) of the v2 quick win "[Present the controller's assessment of the governing text before the digest](../migration/v2/QUICK_WINS.md#agreement-presentation)": "Investigate the proposal and explain material concerns, recommended changes, and accepted tradeoffs before asking for agreement. Existing backlog entries receive scrutiny." [The migration status](../MIGRATION_STATUS.md) recorded that policy as present, carried by the concise intake and shared brief, until a search on 2026-09-29 found no sentence in the operating brief or the skills that asks for material concerns, recommended changes or accepted tradeoffs before agreement, or for scrutiny of existing backlog entries; it now records the policy as partial, tracked by this entry. [The handover skill](../../skills/handover/SKILL.md) accepts a handover only once every queued item has its readback or concise-spec agreement and known user-owned decisions are settled before the user leaves. Investigation without implementation agreement does not create a delivery run.

## Settled questions

Answered by the user on 2026-09-29, after being told that today only a spec gets a background review while the user reads it.

- **Readbacks too.** Every readback, like every spec, is to get a background review agent while the user reads it, with the new assessment running alongside.
- **Separate agent.** The assessment is to come from a second background agent, dispatched at the same time as the review agent. The 2026-10-03 amendment below leaves the number of agents open.

The When commitment below later scoped both agents to readbacks and specs that ask whether to begin implementation.

The commitments below were agreed with the user on 2026-09-29, when the entry graduated from Exploring. None of this is implemented yet.

- **When.** Presenting a readback or spec that asks whether to begin implementation, whether the work was selected through Ready or requested directly, dispatches two background agents at once, the review agent and the assessment agent, and the draft is presented promptly without waiting for either. The 2026-10-03 amendment below leaves the number of agents open. Plain readbacks gain the review a spec already gets; for a spec, the existing spec assessment is the review agent. Graduations and other agreements that only change the backlog are out of scope.
- **Review.** The review agent checks the readback against the selected entries, the user's words and the actual code: whether the commitments are captured faithfully, whether its factual claims hold, and whether anything consequential is missing.
- **Assessment.** The assessment agent gives short, prioritized feedback on the selected work itself: its value, scope, simpler alternatives, risks and concrete tweaks. It is advice, not a gate, and does not go through the finding-validation machinery the review uses. It receives the selected entries, their records and the presented draft, never the controller's reasoning, and the controller checks the factual premise of each suggestion before relaying it.
- **Timing.** Results are presented as they arrive, and the user may say yes before they do. Implementation and handover acceptance wait until both have been presented and the user has settled any tweaks they want. An accepted tweak follows the existing rule: compatible corrections preserve agreement, and material changes need the user's decision.
- **Failure.** If background dispatch is unavailable, the controller says so and runs both before implementation. If an agent fails or no suitable model is available, it reports that and the user decides whether to proceed without it.
- **Models.** Both agents use the strongest model available, preferring the other host, and fall back to a weaker model only when no top-strength model is available, so Fable or Astra is not strictly required. The reason, in the user's words, is that "the user is there (revise runs without the user)".

Amended with the user on 2026-10-03, while tracking [Offer to revisit an entry's settled decisions before starting work](../QUICK_WINS.md#offer-to-revisit-an-entrys-settled-decisions-before-starting-work), which has the readback list the selected entries' settled decisions and ask whether to revisit any, using only what its own investigation found so that the readback is not held up:

- **Settled-decision check.** The background work also checks each decision the selected entries' records mark as settled or agreed against the current code and any work landed since, and suggests which are worth revisiting. Its results arrive while the user reads, before implementation, under the Timing commitment above.
- **Agent count left open.** How the background work is split and how many agents run, including whether the settled-decision check belongs to the assessment agent or to an agent of its own, are left to the governing spec, in the user's words: "exactly how we should split the bg work and how many agents to use is left open." The two agents named under When, Separate agent, Timing, Failure and Models are the starting design, not a fixed count, and where those commitments say "both", they mean every background agent the design settles on.

The user suggested on 2026-10-03, while shaping [Controller-run experiments](controller-run-experiments.md), that deciding whether the selected work warrants an experiment, and proposing one, could be further background work running in parallel with the readback's review, so that Ready's question about spending tokens on experiments arrives with a concrete proposal. That entry tracks it; how it is split among the background agents falls under the agent count left open above.

Amended on 2026-10-04 at the triage of [the section-level audit of v2 records](../reports/v2-section-audit-20261004.md). The v2 quick win this entry answers said that "a re-presentation after a requested change re-renders" the assessment "over the changed entry", while the When commitment above covers a re-presentation only by implication; [the operating brief](../../internal/workflow.md) already gives every revised spec a whole-spec assessment, but says nothing of a revised readback:

- **Re-presentation.** A readback or spec presented again after a change the user requested gets fresh background work over the changed draft, under the same commitments as its first presentation.

## Direction

The idea as first captured; the commitments above govern where they differ.

- When the readback or spec for the selected entries is presented, dispatch the review agent and the assessment agent together, so both run while the user reads.
- The assessment is short: a view of the selected entries with suggested tweaks where appropriate, giving the user the model's feedback before work starts, since an entry may have been written by the user without any AI input.

## Before implementation

The first four points are the ones the agreement left open, the last point was added at the user's request on 2026-10-03, and the rest were found while recording it.

- Settle how the background results are recorded, since no run exists before implementation agreement. Coordinate with [Run-free revise](run-free-revise.md), and with `create`, which records a governing spec as reviewed only for an already observed valid independent assessment.
- Settle what each agent's brief contains: how far the assessment overlaps the spec dimensions, how the assessment agent of the starting design covers several selected entries, and what it receives for a direct request that has no backlog entry.
- Keep it proportionate for very small work, in cost and in latency, since implementation waits for the background results.
- It changes shipped instructions, including the operating brief's agreement rules, the Ready skill's selection path and the handover skill's acceptance condition, so it needs a concise governing spec, a version increase and a decision on installed-host evidence.
- Settle whether the Models and Failure commitments also reach a spec's existing assessment, which the When commitment makes the review agent for a spec. Today [revise-spec](../../skills/revise-spec/SKILL.md) gives that assessment to a fresh strong lead and implementation waits until it is resolved. Inside a run, the runtime also enforces its supported strong models (`STRONG_MODELS` in `internal/runtime/review.js`) at dispatch and at receipt import, while an assessment observed before any run exists is recorded by `create` without a model check. Coordinate with [Degraded assessment mode](degraded-assessment-mode.md), [Initial reviewer selection](initial-reviewer-selection.md), [User-configurable model policy file](model-policy-file.md) and [Model choice per role: Opus 5.5 versus Fable](opus-versus-fable-role-choice.md).
- Settle whether the assessment agent replaces or complements the controller's own integrated assessment that the v3 migration agreed, described under Current behavior. Either way, this entry is that policy's tracked destination in the migration status, so delivery is to supply its missing parts (material concerns, recommended changes and accepted tradeoffs before agreement, and scrutiny of existing backlog entries) or record the user's decision to amend them.
- Settle how the readback review's findings are validated before they reach the user. The agreement gives plain readbacks the review a spec already gets, which points to the skeptical validation revise-spec requires for a spec's findings; a spec's findings keep that validation.
- Sweep the governing documents, skills and runtime text by claim for every statement that a readback needs only the user's confirmation, that only a spec is reviewed before agreement, that a yes to the readback's question starts implementation or what implementation waits for, or that states the handover acceptance condition, and amend each. On delivery, also update the migration status row for the controller's assessment; the v3 migration's disposition stays as agreed history.
- Design the agents' prompts so they do not run too long, since the user is waiting to start, confirming it with live testing where feasible, as the user asked on 2026-10-03: "when designing the agent prompts in 47, care needs to be taken to make sure they don't run for too long, perhaps via some live testing".

Related: [Size-aware Ready recommendations](ready-sized-recommendations.md) shapes the selections this would assess; [Verify compatible agreement continuity across representation changes](v3-agreement-continuity.md) collects evidence for the rule an accepted tweak follows, that compatible edits preserve accepted commitments; and the v2 design archive [Second-opinion gates](second-opinion-gates.md) proposed a similar fresh-eyes read, its requirements gate, before the spec was written, which [the migration status](../MIGRATION_STATUS.md) records as replaced by the supported review path.
