# Agreement reached in ordinary chat activates the lifecycle

## Correction

[Handover as the delivery boundary](../features/handover-only-delivery.md) makes handover the sole delivery creation path, including the request made by Ready selection and released by confirmation of investigated scope. Ordinary chat agreement authorizes direct work and creates no run; standalone revise uses durable review contexts. It was delivered in the local 3.3.10 candidate by run `67af3471-c7c7-4e28-ab57-88e3ba299126`, which has not been published; [the acceptance report](../reports/handover-only-delivery-20261009.md) records which installed-host branches were exercised and which remain provisional. This record preserves the original incident.

## Historical incident evidence

Reported on 2026-10-05 to the maintainer inbox by the controller of the session it happened in, at the user's request, and tracked at the inbox triage of the same day. The session ran in this repository on `main`, on Claude Code 2.1.289 with controller `claude-fable-5-1` and installed and bound release 3.3.3: session `bf9f8d10-5668-44a7-bdee-100a0ca8380f`, attended run `7b7ad4bd-c137-4dc4-8300-eaab1be6e89b`, ended by a recorded user stop. The report says the user invoked no skill and that Ready, handover and the revise skills were not invoked in the session; the controller read skill text directly while carrying the lifecycle, for example `skills/revise-lore/SKILL.md` at 02:50:57Z in the session transcript.

The sequence, as the incident report records it:

1. In ordinary chat the user asked: "could you look over the readme, it's not quite optimal for people who don't know what the project is or what it does. and the status paragraph is pretty ludicrous...". The controller answered with an assessment and changed nothing.
2. The user replied: "not sure what the status line adds actually, maybe just remove it. confer with astra (codex cli) on how to spruce up the readme. i want it to look interesting to potential clients who are interested in ai and want to hire someone who seems to know a little about it." A little later the user asked for the GitHub About text to be reworked as well.
3. The controller consulted `gpt-6-astra` in two read-only `codex exec` turns outside any run and gave a readback of four steps: replace the README with the agreed draft, create a changelog from the old status paragraph, remove the status line with its gate check and tests, and set the GitHub About text. The readback said "Steps 1 to 3 would run as one attended Nightshift run and stay local until you push." and ended "Shall I begin?". It did not say what the run would cost. The user answered "yes, go ahead".
4. The controller created the attended run at 2026-10-05T02:26:33Z with one code task and carried the full lifecycle: recorded checks, two code assessments before any documentation review, a documentation review, two skeptics, two repair batches, four resumed reassessments, a final fresh code assessment and a final fresh documentation review, three commits, and the session retrospective at 03:32:59Z.
5. While it ran the user asked "how are we doing?". When the controller was about to start follow-up triage, the user interrupted: "no need for the nightshift mechanics, i just wanted the readme polished up a bit". The controller recorded `stop` with kind `user-stop` at 03:34:42Z. No follow-up was recorded and no triage was held.

The delivered work is three commits on `main`, confirmed present at triage: `eddfa3f` (CHANGELOG.md added, the README status line and its release-gate check removed), `8cfdc4c` (README rewrite) and `6e49f1e` (backlog entries reconciled). The report says the user pushed them after the stop and that the GitHub About text was set during the session.

## Cost

About 68 minutes passed from run creation to the stop. The incident report counts 12 review and skeptic dispatches at 10,871,813 tokens, taken from the receipts' `threadTokens` session running totals; a resumed dispatch's own share is its running total less the total of the receipt it continued. No receipt carried per-attempt usage in the fields the controller read, so the split of fresh and cached input is not known. The figures were not recomputed from the receipts at triage; the rows below do sum to the stated total.

| Request | Kind | Model | Fresh or resumed | Result | Own tokens |
| --- | --- | --- | --- | --- | ---: |
| `7f97746d` | code | gpt-6-astra | fresh | incomplete, no finding, asked to rerun two test files | 1,236,107 |
| `4fc88c6c` | code | gpt-6-astra | fresh | complete, no finding | 1,128,116 |
| `6de85c62` | docs | claude-fable-5-1 | fresh | complete, six minor findings | 1,561,308 |
| `8b51618b` | skeptic | gpt-6-astra | fresh | four confirmed, two refuted | 1,122,410 |
| `fde9f868` | docs | claude-fable-5-1 | resumed | four closures, nothing new | 462,737 |
| `c08d768b` | code | gpt-6-astra | resumed | nothing to close, nothing new | 1,375,206 |
| `a1dafd30` | code | claude-fable-5-1 | fresh | complete, one minor finding | 677,794 |
| `0fc8f4d6` | skeptic | gpt-6-astra | fresh | one confirmed | 170,677 |
| `7371b73b` | code | claude-fable-5-1 | resumed | one closure, nothing new | 268,570 |
| `aa2c2dba` | docs | claude-fable-5-1 | resumed | nothing to close, nothing new | 508,084 |
| `b893f5c3` | code | gpt-6-astra | fresh | complete, no finding | 1,071,972 |
| `79f9f1db` | docs | gpt-6-astra | fresh | complete, no finding | 1,288,832 |

The second repair batch was one deleted sentence in the changelog introduction, which an agreed commitment required. It took five of the twelve dispatches: a skeptic, two resumes and the two final fresh assessments. For balance, the reviews raised seven minor findings and five were confirmed and repaired: a stale README claim in a feature record, a quick win whose remaining work waited on another entry, a missing caveat on the Codex update command, two limits dropped from the README, and a changelog introduction that claimed more than the entries state.

## What the controller followed

The controller started the run on these statements, quoted by the incident report from release 3.3.3. All five were still present in the checkout at triage on 2026-10-05:

- The repository `AGENTS.md`: "The repository is self-hosting: agreed implementation work on Nightshift uses its complete lifecycle." and "After the user agrees the implementation scope, create or reconcile an attended runtime run before implementation".
- [The operating brief](../../internal/workflow.md), opening paragraph: "A project's governing requirement to use Nightshift for implementation also activates this lifecycle once the user agrees the implementation scope; handover is not required."
- The operating brief, Durable execution: "For implementation governed by a project lifecycle requirement, create an attended run before implementation or reconcile the compatible run already owned by this session."
- [The runtime reference](../../internal/runtime/REFERENCE.md), Start and observe: "Agreed implementation under a project requirement to use Nightshift starts an attended run before implementation, or reconciles an existing compatible run; it does not require handover."
- [revise-code](../../skills/revise-code/SKILL.md), description: "or required implementation review and repair in a Nightshift lifecycle, including agreed implementation under a project self-hosting requirement."

None of these passages names how the agreement was reached. The controller read "the user agrees the implementation scope" as satisfied by the "yes, go ahead" given in chat.

## Required outcome

The user's direction after the stop: "this affects plugin behaviour, so any adjustments should be made in the plugin. agreed work means through the `/ready` skill. the user should be able to get things done quickly when just chatting with the main agent." The user also rejected narrowing the repository `AGENTS.md` sentence as the fix.

Have a project's lifecycle requirement activate for work selected through Ready, and leave a request agreed in ordinary chat to be carried out directly. Explicit handover and explicit revise requests are outside this entry.

## Uncertainty

- Hypothesis, not verified: the activation wording does not separate agreement reached in ordinary chat from work selected through Ready, so a controller applies the lifecycle to any agreed change in a project that requires Nightshift. Only this one session on Claude Code was observed; Codex and other projects were not.
- Hypothesis, not verified: the user's "yes, go ahead" answered the four steps and not the one clause that mentioned a run. The user's later words are consistent with this but do not say it.
- Unknown: how much of the work the user would have wanted reviewed at all. The request was for a README polish; the approved steps also removed a release-gate check and its tests.
- Unknown: whether the same request made without the self-hosting sentence in `AGENTS.md` would have started a run. Not tested.

## Verification and related work

The fix changes shipped guidance with model-owned behavior, so it rides with a plugin version increase and a decision on installed-host evidence. [Handover as the delivery boundary](../features/handover-only-delivery.md) settles the delivery boundary and supersedes the mandatory three-choice proposal; explicit direct-work and pause requests remain available. The memory slip that followed the stop is recorded in [Retrospective routing by audience and instruction precedence](../features/revise-lore-audience-routing.md).

The incident report names the evidence it left in this checkout's ignored folders: the run state in `.nightshift/runs/state.sqlite` under the run id above, receipts in `.nightshift/runs/reviews/<request id>/` for the twelve requests in the table, and the controller's scratch folder `.tmp/readme-rewrite-20261005/`. Tracking does not authorize implementation.
