# Second-opinion gates

Feature: cheap second-opinion gates at lifecycle checkpoints. This file is the authoritative design record.

## What it does

Add cheap second-opinion gates at lifecycle checkpoints: one fresh-eyes agent from a different model family (or a higher tier when the host consigns the session to one family) reads the complete artifact plus its scoped context and gives an independent holistic read before that artifact is handed to the next stage. Findings enter the normal skeptic/controller pipeline; the second opinion is a reader, not an authority. (Here "gate" names the lifecycle checkpoint, the point at which a second opinion runs; the reading agent is the "second opinion", a disambiguation this design is explicit about so two implementers cannot model the entity differently.)

Buy the strong-model judgment the flatten-to-cheap tier forfeits with a small number of well-placed single-pass reads. This is the best allocation of strong-model budget in the review redesign discussion, and the requirements gate is the least-costly catch point: every fix propagates monotonically downstream, and a requirement misread caught at the settled-questions list costs one re-ask where the same misread at the hardened spec costs a full re-review cycle.

## The three gates

The gates sit at the three points where an artifact graduates to become the input of the next machine:

- **Requirements gate.** Immediately after a completed brainstorm session resolves its questions, before the controller turns them into a spec. No governing spec exists yet, so this remains inside brainstorming and precedes the agreement gate.
- **Initial-spec gate.** Right after the controller writes the spec and the user agrees to its decision-complete digest in the current session, before hardening. Catches a bad requirements read or structural mis-sketch before the dimension swarm iterates on it.
- **Hardened-spec gate.** After the review stage converges and the post-review candidate either matches the accepted candidate, passes a cited contract-fit check, or receives renewed current-session agreement. This is the strong-model read on the exact artifact that will be handed off (the final invariant), and it subsumes the holistic third-phase reviewer role.

A finding-driven design edit returns to the agreement gate for classification before another second-opinion read, revise loop, planning step, or implementation transition. A cited `within-contract` result continues autonomously; `changes-contract` requires agreement to the refreshed digest, and `uncertain` fails closed through fresh presentation. Review certification and user authorization remain separate: neither substitutes for the other.

A single final-gate-only alternative was considered and rejected: it concentrates the strong-model budget at one point but forfeits the cheap early catch at the requirements list, where a misread is cheapest to correct. The three-gate allocation spends a small fixed budget where it has the highest leverage rather than the largest single read.

## Active ingredient: different family, not different tier

Sonnet-vs-Opus is not a diversity mechanism: same training lineage, shared blind spots, correlated hallucinations (the exact failure mode the reviewer-pair redundancy was meant to survive). A real second opinion means an **independent error distribution**, e.g. a DeepSeek/Qwen/Gemini read when the driving session runs Claude, or vice versa. On Anthropic, consigned to one family, the question properly reduces to higher tier *and/or* higher reasoning effort, and the skill should surface that as a distinctly different choice, not a value judgment.

This premise is an empirical claim about external model behavior that this repository cannot settle; it carries `(live-claim: provisional)` until a cross-family versus same-lineage comparison on a shared artifact corpus settles it.

When possible the second opinion should use a model of the same strength as the strongest deployable reviewer: the point is divergence, not a free weaker pass. The user picks the second-opinion model per run, because the landscape shifts on a weekly basis; the skill may ask whether to consult an external model-ranking site and fold 2-3 gated recommendations into the question, but the choice remains under user control.

## Channel: consult tool or agent-harness CLI

The first of two co-equal cross-family channels is a `consult`-style MCP tool: a stateless one-shot request to an external model router (reference implementation: McpConsultant in the user's McpTools repository, fronting OpenRouter; see its README_CONSULTANT.md). The shape fits the gate contract closely: per-call model selection matches the per-run user choice above, file attachments carry the artifact plus the scoped context package without transiting the controller's context, and statelessness structurally enforces the reader-not-authority rule, since the second opinion has no session, no memory, and no edit surface. It also makes the cross-family-diversity live-claim above settleable: the same artifact corpus can be read by a cross-family and a same-lineage model and the findings compared.

Integration consequences, worked out 2026-08-15:

- **Feature detection with fallback.** Nightshift is a public plugin and cannot require a personal MCP server. The skill detects a consult-capable tool at runtime; when no cross-family channel is available (neither this tool nor the agent-harness CLI below), the same-family higher-tier or higher-effort read described above is the degraded mode, not a co-equal alternative.
- **Probing maps to transcript replay.** The bounded probe exchange (see "The controller may probe the second opinion") is implemented by re-sending the prior exchange in each probe call's context, since the tool holds no session. Replay multiplies prompt tokens per turn, and it keeps the exchange recorded by construction, which the probe rules already require.
- **Findings arrive as prose.** The tool returns free text; the controller extracts findings before they enter the skeptic pipeline. This intersects with the [review-report-json-schema](review-report-json-schema.md) draft: a schema requested in the question text is unenforced server-side, so the controller needs a salvage path either way.
- **Client timeout is a deployment precondition.** A hardened-spec gate read at maximum effort is a long call; the MCP client's tool-execution timeout (for Claude Code, `MCP_TOOL_TIMEOUT`) must cover the server's configured request timeout, per the consultant README's registration-time check.

Server-side integration directions (conversation continuation, a frozen feature-detectable contract, schema-validated structured output) are tracked in the McpTools repository's own backlog, not here.

The second co-equal channel, raised 2026-08-15: a non-interactive cross-family agent-harness CLI installed on the machine (reference implementation: Codex CLI via `codex exec`, fronting OpenAI models). The design contemplates the generic capability, a one-shot non-interactive invocation taking a prompt and returning text, so any qualifying harness (Gemini CLI, opencode) can serve without a design change; Codex is the reference because it is present in the authoring environment. Deltas against the consult-tool contract, to be worked out when the feature is picked up:

- The harness is an agent with tools, not a stateless completion: it can read the artifact and context package from disk itself instead of receiving attachments, but reader-not-authority is not structural here and must be enforced by invoking the harness in a read-only or no-edit mode (Codex: the read-only sandbox), since a default invocation could edit the artifact.
- Statelessness holds per invocation; probing maps to the harness's own session-resume mechanism where one exists, with the transcript-replay pattern from the consult path as the general fallback.
- Model choice is constrained to the vendor family behind the harness rather than a router's menu, which still satisfies the different-family requirement whenever the harness vendor differs from the driving session's.

Channel selection: both channels are feature-detected at runtime; when both are available, the per-run user choice (see "Active ingredient") picks the carrier as part of picking the model. The same-family higher-tier or higher-effort read remains the degraded fallback only when neither channel is present.

## Context package per gate

Each gate forwards the artifact plus the minimum context that produced it, never the raw session:

- requirements gate: the user's requirement description(s) plus the settled Q&A from the brainstorm;
- initial-spec gate: the spec plus the reqs list;
- hardened-spec gate: the spec, the reqs list, the acknowledgements and explicit anti-goals.

Full requirements are not captured by a Q&A list alone: they live in whatever the user actually described. The reqs list is therefore the user requirement description(s) plus the settled Q&A, persisted as a controller-owned, short-lived artifact at the requirements-gate moment, and forwarded unchanged into later gates. It becomes the natural carrier for the [durable scope anchor](durable-scope-anchor.md), grounding completeness and soundness checks without re-requesting the conversation.

## The controller may probe the second opinion

The controller can exchange a few messages with the second-opinion agent to ask for clarifications or motivations behind a change recommendation before disposing of it. Scope the exchange to motivation and evidence the controller cannot derive from the finding text, not open-ended debate. Bound the count ("a few messages"), keep it recorded in the persisted state, and let neither party edit the artifact during the dialogue. Guard against anchoring: the controller is the neutral adjudicator and must not "come around" to agreement by repetition. This is distinct from the [adversarial-repair-dialogue](adversarial-repair-dialogue.md)'s agent-to-agent repair dialogue: there the skeptic-repair-author defends a repair against the originating reviewer; here the controller probes a recommendation.

## Post-fix re-certification, classified by fix bucket

A second-opinion finding that causes a fix mutates an artifact the earlier machinery already certified. The hard invariant governs the response: **no certifying read may span an artifact mutation.** Re-certification depends on what kind of fix landed:

- **Second-opinion-unique fix** (a cross-dimensional gap or integration look no single dimension owns): one fresh second opinion over the fixed artifact, informed of the delta just applied. That fix is the gate's own integration-look catch, so dimension certifications, which were not about what it touched, stand.
- **Dimension-owned fix** (a gap a named dimension reviewer should have caught): that dimension's LGTM is invalidated because its territory changed under it. Re-enter the owning dimension (or the dimensions whose reviewable content the fix touches) for a fresh review, not the whole ladder.
- **Structural or scope-affecting fix**: re-enter the review stage properly (new phase, all dimensions reactivated), and run the hardened-spec gate again after. A structural change re-opens the certification basis for every dimension. Scope-changing findings also keep the existing block-and-ask triage from handover.

When a dimension-owned fix lands *from a hardened-gate finding*, the hardened gate re-runs after the owning dimension converges. Without this, the gate read happens on the pre-fix artifact while the handed-off artifact receives only a same-family, single-dimension review, silently falsifying the "exact artifact being handed off" guarantee. Re-running the gate preserves the final invariant for every fix bucket, not just structural ones.

The "controller judgment call" is therefore not *whether* to re-review but *which bucket* the fix falls in, using the [rigor profile](calibrate-first-draft-rigor.md). Whatever path lands, the artifact that closes the gate must be one no certifying read spanned a mutation across.

## Resolved open questions

Five design questions surfaced during the first spec review were resolved rather than deferred:

- **Requirements-gate substrate.** The reqs list is a controller-owned, persisted, short-lived artifact holding the user's requirement description(s) plus the settled Q&A, not a session ephemeral and not a Q&A enumeration alone. See "Context package per gate". Removes the dependency on a nonexistent shipped artifact.
- **Hardened-gate re-run for dimension-owned fixes.** A dimension-owned fix that lands from a hardened-gate finding re-runs the hardened gate after the owning dimension converges, so the "exact artifact being handed off" guarantee holds for every fix bucket. See "Post-fix re-certification".
- **Gate iteration bound.** The second-opinion-unique re-certification loop and the structural re-entry loop each carry a bounded iteration cap (three gate passes, mirroring the review stage's repair discipline). Cap exhaustion is a terminal stop with a recorded failure, never a manufactured LGTM: interactive mode surfaces the failure for disposition, while autonomous handover stops per the existing failure-stop rule and leaves the artifact unshipped for a later session. Cap exhaustion is not an interactive prompt in unattended operation.
- **Gate failure and recovery.** A gate read that fails partway (missing or malformed output, unreachable user-chosen model) does not hand off silently. It follows a bounded repair path: a fresh replacement or fallback model within the user's chosen family or tier. A hardened-gate read that cannot complete blocks handoff until it does or the user explicitly defers. No ungated artifact passes.
- **Degenerate inputs.** The requirements gate certifies the combined requirements context (user requirement description(s) plus settled Q&A). An empty Q&A list is a legitimate settled state when the user's description is complete and specific; a small scope with detailed initial requirements needs no questions, and an empty list is not a halt. The degenerate case is a gate with no requirements content at all (no description and no questions), which the controller treats as not-yet-settled and does not advance. A capture-stage or near-empty spec cannot reach the initial-spec gate: it stays in brainstorming until it can produce the decision-complete digest required by the agreement gate. The initial-spec second opinion reads only a decision-complete spec covered by current-session agreement; later elaboration receives contract-fit classification before another read, continuing autonomously only when the accepted digest still contains it.

## Relationship to neighboring features

Subsumes the holistic final reviewer role, whose same-family high-tier read is weaker than a different-family read for the specific purpose of catching correlated misses. Gives the [durable scope anchor](durable-scope-anchor.md) its concrete carrier. Preserves payload isolation: regular reviewers still see only their assigned dimension plus common context; the second opinion is the deliberate holistic exception. Every second-opinion finding passes through factual verification and [contract-calibrated revise admission](contract-calibrated-revise-admission.md) before repair, so the holistic seat cannot expand the approved contract merely by reporting a true adjacent issue. Complements the [adversarial-repair-dialogue](adversarial-repair-dialogue.md): the controller checks with the same second-opinion agent after applying its admitted fix, mirroring that dialogue's reviewer-critic post-repair check.

## Unclaimed design direction: cap review phases at two

**2026-08-14 supersession note:** the wave-convergence lifecycle (wave-lifecycle.md) removed phases; the shipped limits are now 30 rounds and 10 verifier launches per run, and this section's question dissolves into those caps plus the verifier seat (see the landing-order note below). The section is retained as a historical design record.

The hardened-spec gate subsumes the holistic third-phase *reviewer* role, but nothing in this design caps the phase *machinery* itself: a structural or scope-affecting fix still "re-enter[s] the review stage properly (new phase, all dimensions reactivated)" per the post-fix re-certification rules above. Whether to go further and make phase 2 terminal, routing any third-phase requirement into the second-opinion step before the stamp, is a distinct design question. It is **not decided here and not claimed by any feature or proposal**: the review engine's phase count remains the shipped limit of 10, [review-orchestration-tests](review-orchestration-tests.md) will encode the phase transitions as they ship today, and if a phase-2 cap is ever adopted the transition table and its fixtures must be amended in the same change that sets the standard. Flagging this now so the seam is visible before either work lands.

## Status

Draft proposal; not yet designed as a buildable skill or spec. The review-phase machinery it builds on is shipped, and the pending agreement gate supplies its authorization ordering. The first spec review graduated after three review phases over an earlier fingerprint, and the five logged open questions are resolved above. The agreement-ordering edits are not covered by that historical stamp, so this design requires fresh hardening before implementation.

## Requirements

- The review engine's phase/round machinery and skeptic/controller pipeline (shipped, so no upstream backlog dependency).
- The current-session spec agreement gate (pending; required before either spec-bearing second-opinion read and after every finding-driven design edit).
- The user's requirement description(s) plus settled Q&A, produced at brainstorm time (see "Context package per gate").
- A second-opinion model selection per run, user-chosen (see "Active ingredient").
- A cross-family channel, feature-detected at runtime: a registered consult-capable MCP tool or a qualifying non-interactive agent-harness CLI; when neither is present, the same-family fallback applies, so this is a soft precondition rather than a blocking gate (see "Channel").

Present chosen spec for agreement before work lands before Second-opinion gates.

Landing order: the wave-convergence lifecycle (wave-lifecycle.md) shipped 2026-08-14 in the 2.2.0 batch. The agreement gate lands before this feature. When this feature is picked up, re-derive the gate placement against the wave model: the hardened gate maps onto the verifier seat, and the phase-cap open question dissolves into the wave and verifier caps (30 rounds, 10 verifier launches per run).

**Requires:** [Present chosen spec for agreement before work](present-spec-for-agreement.md), [Contract-calibrated revise admission](contract-calibrated-revise-admission.md).

## Hardening

- revise-spec graduated 2026-08-10 22:57 at 0cbfb1c, scope: whole file, content: d552b097
