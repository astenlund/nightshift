---
status: exploring
---

# Revise prompt-prefix caching

Draft exploring a prompt layout for the revise engine's reviewer fan-out that makes the common context a byte-identical prompt prefix across all N reviewers (identical system prompt plus identical first message, with the dimension criteria arriving only in the final, divergent portion), so Anthropic prompt caching gives agents 2..N the cache-read discount on the shared tokens with zero independence loss. Captured 2026-08-15 from a user idea mid-handover.

Why it could be large: a revise round dispatches 7+ reviewers plus skeptics and dedup judges, each ingesting the same multi-thousand-token common context (project context, instruction excerpts, acknowledgements, operating context). Today that context arrives as a per-agent tool result AFTER a per-cell first message (the payload path and cell ID), so byte divergence begins in message one and agents plausibly share only the system-prompt cache.

Open questions the design hinges on (probe before designing):

- Cache-boundary mechanics: breakpoints land at content-block and message boundaries; a shared leading portion inside one text block with a divergent tail may produce no reusable cache entry. The shared prefix must become its own block or turn; does the harness's subagent dispatch (Workflow `agent()` and the Agent tool, both single-prompt-string) permit either?
- Delivery of the divergent criteria: a second user turn (identical first turn, criteria via follow-up message) exists only on the manual path via SendMessage and perturbs the scheduling contract; the Workflow path has no second-turn primitive today.
- Concurrent-write behavior: simultaneous fan-out means agent 1's cache write may not land before agents 2..N issue their requests; a warm-up request or staggered first dispatch may be needed to turn writes into reads.
- Skeptics and dedup judges carry per-finding prompt content; whether their payload-file read (identical tool result, but after divergent bytes) can share anything, or whether only reviewers benefit.
- Measurement: how to observe actual cache hits from the harness (token accounting per subagent) so the win is verified rather than assumed.

## Forking variant (same goal, different mechanism)

Second candidate mechanism, captured 2026-08-15 from the same discussion: instead of prompt layout, share the common context through conversation identity. A fresh "primer" agent ingests only the common payload, then forks itself once per dimension (criteria in each fork's divergent tail). Forks continue the primer's byte-identical cached prefix, so agents 2..N pay cache-read prices without any prompt-layout support from the harness; independence is preserved because the primer's conversation IS the controlled common context, nothing else.

- Fork-of-controller is explicitly rejected: a controller fork inherits spec authoring, prior findings, and adjudication reasoning, contaminating the fresh-eyes property the engine exists for. Record this as the variant's anti-goal.
- Costs are orchestration-shaped: the primer becomes a sub-orchestrator (fork results aggregate through it, so per-cell session attribution and repair counters must flow through it); a replacement fork needs the primer session alive, with classic full-cost dispatch as the repair fallback; forks inherit the primer's model with no override, welding the profile pin to the primer; skeptics fan out on completion timing, so either the primer stays resumable mid-round or a first slice forks the reviewer wave only and leaves skeptics classic.
- Decision axis vs the prefix-layout mechanism: layout is the lighter change if cache boundaries cooperate; forking provably caches today but rewrites more of the dispatch and checkpoint contract. Probe the layout question first; forking is the fallback.

No Requires line yet; graduates to a themed section once the harness probes settle what is achievable.
