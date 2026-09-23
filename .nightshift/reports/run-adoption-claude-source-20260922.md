# Installed Claude source-run evidence

Historical 8M checkpoint. The same source run was subsequently adopted and completed; [the current adoption report](run-adoption-and-continuation-20260921.md) supersedes the remaining-work and accounting status below. These original observations and counters are preserved.

Under the user-doubled 8,000,000-token aggregate grant, an actual Opus session used the installed 3.2.3 candidate to create a bound run, obtain its initial native controller claim, change the requested label and record a passing check. This is positive evidence for the Claude creation/initial-claim branch. It is not evidence of adoption, cross-host transfer, a later-turn claim or renewed continuation.

| Evidence | Observed value |
| --- | --- |
| Candidate | `3.2.3-e80fe10cd17b0645eeac85a067e8df7b18f25a60b92f66dcfbe64a6059a5f395` |
| Native host/model | Claude Code / `claude-opus-5` |
| Native session | `e58dbbc0-d976-4461-9948-faea14fbcc7a` |
| Actual claimed process | PID `7136`, creation identity `639256962796424240`, `claude.exe` |
| Fixture | `.tmp/na/opus-stopped-open` |
| Bound run | `1d6e1aca-8683-4a54-b5a4-42ea65a7caa5`, revision `13` |
| Source work | `NOTES.md` contains `Button label: Search notes.` |
| Check | `notes-wording`: first attempt failed, later attempt passed |
| Preserved runtime status | Running, with both internal operation workers terminal |

The first directed turn did not finish. After 39 physical requests settled, the next request could not fit its conservative reservation, so the controller shut down the actor and campaign. Native exit evidence records code 1, SIGTERM and verified descendant reclamation; campaign shutdown returned success and its process exited 0. No temporary credential snapshot or lock remains. The run was not stopped or completed through a fabricated runtime operation: its actual source process ended while its saved status remains running. Preserve this fixture for a subsequent adoption attempt; the planned stopped/open boundary was not exercised.

The 39 new requests finalized 3,492,640 aggregate tokens: 3,472,303 input, including 3,472,225 cache-related input, and 20,337 output. Cache-related input includes the cache fields counted by the agreed metric, not a claim that every token was a cache hit. No new uncertain exposure was added. The original three failed requests retain 3,434,000, leaving 1,073,360 unreserved under the 8,000,000 total. This is less than the next Opus reservation of 1,128,000 or Astra reservation of 1,178,000.

Immutable capture: `.tmp/adoption-opus-8m-campaign.json`. Native event digest: `f0f6ce7395309aa246fe1054278e74277fa656ef2a4c0a3ea133c08ef56ba462`. Complete source observation: `.tmp/adoption-live/candidate-physical-gate/observations/opus-source-after-8m-close.json`, SHA-256 `b1c3b99583416db605222b6c66184c665208915034341f5782ba756f46e50db2`. The capture retains full accounting and the source run/history; these hashes identify evidence, not unobserved acceptance results.

Before launch, 120 private-driver checks passed and cumulative independent assessment `075916ab-6bb0-4edd-bf0f-bb1f15efc839` was clean. The allowance revision journal preserves the original and revised ledger bytes, user authority and all prior reservations. The user-refreshed Claude login passed actual opening and inference. The earlier Codex event-stream failure remains unresolved. All required takeover and continuation cases remain pending, and publication is still blocked by the independent review finding.

The measured cost of reaching this first increment reinforces the already tracked acceptance-tooling proportionality concern. It does not establish that every request was unnecessary or identify a remedy. Tracking remains separate from implementation authority.
