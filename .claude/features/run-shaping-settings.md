# Run-shaping settings: round cap and review lanes

Gives a revise run a small set of user-visible run-shaping settings chosen at run start: a per-run round cap derived from the rigor tier or set by the user, and the host and model pins for the reviewer, skeptic, and verifier lanes. These are speed-versus-spend preferences, distinct from the rigor profile, which governs quality.

## Motivation

Both settings were exercised repeatedly by hand during the 2026-09-02 to 2026-09-03 operating-context batch, each time as an ad-hoc deviation from a pinned engine default that had to be recorded for the morning report.

The round cap was raised five times in one spec run: from 30 at the twenty-fourth round, then to 50, 60, 70, and finally 120 late in the night, each raise made while the wave was still producing byte-level findings and the verifier had not yet launched. A long spec with a large multi-mechanism design routinely needs more rounds than the shipped default, and the raise is a mechanical interruption that carries no design information.

The lanes were repinned twice in the same batch. The verifier first moved off the engine's opus pin onto Codex with `gpt-5.6-sol` at high reasoning effort, dispatched through `codex exec`; later the verifier moved again onto Fable dispatched through the Agent tool, while reviewers and skeptics used opus for the spec run and sonnet for the plan and code runs. Every one of those was a deviation from `internal/revise/SKILL.md`, which reserves Fable for the controller and pins the verifier to opus, and each had to be written down as lore instead of being expressed as a setting.

## Round cap

The cap is a per-run value. Its default derives from the rigor tier, so a high-rigor run over a large artifact starts with more headroom than a low-rigor run over a one-line quick win, and the user can override it at run start. Raising it mid-run stays possible, but the derived default should make that the exception.

The cap interacts with an already-tracked quick win, [Stop counting verifier rounds toward the per-run round cap](../QUICK_WINS.md#wave-lifecycle-tuning), which narrows the cap to reviewer rounds and leaves the verifier tail on its own separate launch budget. That quick win stays independently landable and is folded in here by reference rather than absorbed: this feature assumes its semantics when it derives a default, and if this feature lands first it must not re-specify the reviewer-only scope in a way that contradicts the quick win's pinned limits sentence.

Open at pick-up: whether the derived default is a function of tier alone or also of artifact size, and what the run does when it reaches the cap with no user available, where the choice is between stopping with the structural state recorded and continuing on an explicit unattended allowance.

## Review lanes

A lane is one role in the run: reviewer, skeptic, or verifier. Each lane carries a host and a model pin, and the run resolves them at start. The default remains the engine's shipped pin, so a run with no stated preference behaves exactly as today.

A lane pin has to carry more than a model name, because the observed pins spanned two hosts with different dispatch mechanics: an Agent-tool dispatch with a model parameter, and a `codex exec` invocation with its own reasoning-effort setting. The setting shape therefore names the host, the model, and the host-specific effort or equivalent knob, and the run reports the resolved lanes once so the morning report no longer has to reconstruct them from lore entries.

Open at pick-up: whether lanes are settable per artifact profile (spec, plan, code) as the observed usage implies, or only per run; and how a lane pin that names an unavailable host or model fails, where fail-closed to the shipped default with a reported notice is the conservative branch.

## Placement among the settings

Round cap, lanes, and the wait-versus-wake choice described in [Fixer-triggered cell reactivation](fixer-triggered-cell-reactivation.md) are the same kind of thing: preferences about how much time and spend a run may use, with quality held constant by the engine's convergence and verifier gates. They belong in one run-shaping surface rather than three, and none of them belongs in the rigor profile.

## Verification

Fixtures cover a run with no stated preferences (shipped defaults, no behavior change), a tier-derived cap, a user-set cap, a per-lane pin naming a non-default host, a lane pin naming an unavailable host or model, and reaching the cap with and without a user available. The run's resolved settings appear in the report and in the checkpoint so a resumed run does not silently revert to defaults.
