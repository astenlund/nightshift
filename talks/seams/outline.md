# Slide outline: trust lives in the seams

A one-hour keynote answering "How do you trust the results without reviewing the code yourself?" It opens with what the audience already knows, shows the whole workflow, inverts it to show that trust lives in the seams between the steps, zooms into each seam with a real story and real runtime output, and then watches one run pass through them. Story IDs (S1.1, R, L2) refer to the [seams catalog](catalog.md); output IDs (C1 to C13) refer to the [captured runtime output](captured-output.md).

## Audience and language

The audience is software developers who have used AI assistants, in chat or as an agent in their editor, but have not worked with custom workflows or agent orchestrators. They know the failure modes from experience; they have not handed over a task and walked away.

- **Build vocabulary before using it.** The primer section introduces every term the zooms rely on.
- **Start each zoom from their experience.** Each seam is introduced by a failure the audience has probably seen.
- **Show real output.** Each zoom shows the runtime refusing, edited for the slide as described in [captured-output.md](captured-output.md).
- **Say "strong models".** Headlines and explanations say "strong model"; concrete examples may name Fable (a Claude model) and Astra (a GPT model). The model in S2.2 that was recorded as advisory stays unnamed: call it "a capable model outside the approved strong set".

Terms to use on slides, defined at first use:

| Slide term | Meaning | Replaces the docs' |
|---|---|---|
| lead agent | The session that runs the work and makes decisions | controller |
| reviewer, skeptic | Fresh read-only sessions; the skeptic checks each finding | lead assessment, skeptic validation |
| strong model | A top-tier model the review gate accepts | strong role |
| host | The app an agent runs in: Claude Code or Codex | host |
| run record | Durable state kept outside any model, in a SQLite file | runtime state |
| hook | Code the host runs at fixed moments, such as when the agent tries to stop | hook |
| the whole change | Everything changed since the run started | cumulative change |
| review record | A saved review result | receipt |
| takeover | Another session continuing an unfinished run | adoption |

## Visual language

- **Night.** The overview runs left to right from day to night. The left side, where you are present, is light; everything after handover is dark; the morning report returns to light.
- **Soft steps, hard seams.** Steps are soft, rounded, muted boxes. Seams are crisp gates between them and carry the color.
- **Solid and dashed gates.** A solid gate is one the runtime refuses mechanically. Agreement is drawn dashed: the runtime enforces a recorded agreement and the spec review (C1), but whether a real yes was given is judgment, and a model once started early (L3). Inside every solid gate a model still judges what passes.
- **Failure cards.** The seven failures from slide 4 are drawn as cards. On slide 11 each card flies to its seam, and each zoom opens with its card.
- **Mini-map.** Every zoom has the overview in a corner with the current seam lit.
- **Runtime output.** Refusals use one terminal style: what the lead agent tried, then the runtime's answer. Keep the error code exact.
- **Evidence footer.** Each story ends with a small line naming its source report, so the audience knows it is on record.

## Timing

| Section | Minutes | Slides |
|---|---|---|
| Open | 3 | 1 to 2 |
| From chat to handover | 7 | 3 to 6 |
| The whole workflow | 5 | 7 to 9 |
| The inversion | 3 | 10 to 11 |
| Zooms | 22 | 12 to 26 |
| One run | 5 | 27 to 28 |
| Limits and cost | 3 | 29 to 30 |
| Take-home and close | 3 | 31 to 32 |
| Questions | 9 | 33 |

## Open (3 minutes)

### 1. The question

- **On slide:** "How do you trust code you didn't review?"
- **Visual:** black slide, one line.
- **Say:** everyone asks this about AI that works on its own. If trust means reading every line, the answer is that you can't. This talk is about what else trust can mean.

### 2. The promise

- **On slide:** "Hand it over. Go to bed. Come back to a result you can act on." Two pillars below: Autonomy and Trust.
- **Say:** reliability has two equal parts. A run that finishes by lowering its standard is not reliable, and neither is a sound result that sat waiting for you all night. The answer tonight is not "the models are good enough now".

## From chat to handover (7 minutes)

### 3. What you've done so far

- **On slide:** two panels. Chat: you paste, it answers, you judge. Editor agent: it edits, you watch, you judge.
- **Visual:** the same figure, you, sits in the loop at every step of both panels.
- **Say:** in both, the safety net is you. You read the answer, you watch the diff, you catch the mistake. Now leave the room.

### 4. What goes wrong when nobody is watching

- **On slide:** seven cards, one per failure:
  1. It built something slightly different from what you meant.
  2. It stopped halfway and said it was blocked.
  3. It said "all tests pass" about its own work.
  4. Something changed after you approved it.
  5. It reported a bug that isn't there, or fixed one and broke another.
  6. It forgot what you agreed an hour ago.
  7. It said "done". It wasn't.
- **Build:** the cards appear one at a time. Ask for a show of hands on two or three of them.
- **Say:** you have probably seen several of these. Each one gets an answer in this talk, and most of them also happened during Nightshift's own development.

### 5. The cast

- **On slide:** one diagram. You at the edge. A lead agent running the work. Reviewers and skeptics in fresh read-only sessions, when possible on the other host. A run record beneath everything. Hooks at the host boundary.
- **Say:** the lead agent is a strong model in a normal session; it implements directly, with no special planning stage. Reviewers and skeptics are fresh sessions that never saw the lead's reasoning. Fable or Astra can play any role; when both are available, the reviewer usually runs on the other host.

### 6. Models judge, code keeps the books

- **On slide:** `VISION.md:93` "Models own engineering and product judgment. Deterministic tools own mechanics where a mistake would lose work, corrupt state, or misrepresent what happened."
- **Visual:** the run record as a ledger. Every change to it is a checked transaction, and the ledger can answer "no".
- **Say:** the run record holds what was agreed, what stage each task is in, what evidence exists and which findings are open. The models ask to change it; plain code decides whether the change is allowed. Hold that thought, because the answers to all seven cards come from here.

## The whole workflow (5 minutes)

### 7. The whole night

- **On slide:** the overview: Agree, then a vertical handover line, then Implement, Review with a loop back through Repair, Document, Retrospective, Morning report, Triage. A thin bar beneath the whole diagram: "run record".
- **Build:** stages appear left to right. You leave at the handover line and return at the morning report.

### 8. One small fix, start to finish

- **On slide:** the readback, as the lead agent says it: `WORKFLOW.md:19` "Refresh should reload the list while preserving the selected status filter. Shall I go ahead and make that change?"
- **Build:** walk the overview for this fix. Yes; implement with tests; an independent review of the whole change; a skeptic checks each finding; fix; review the whole change again; update the docs; a short retrospective; the morning report; decide the follow-ups one at a time.
- **Say:** that is the whole flow for a small change. A larger feature adds a short written spec, which gets its own independent review while you read the same draft.

### 9. You've seen this diagram

- **On slide:** the same diagram. The Implement box cycles between Fable and Astra.
- **Say:** these are the steps any careful team follows. The models are interchangeable. If the steps were the answer, any agent loop would earn your trust. The steps are not where trust comes from.

## The inversion (3 minutes)

### 10. Trust lives in the seams

- **On slide:** "A seam is where a claim has to survive a check before work crosses. And the system can say no."
- **Build:** Magic Move from slide 9. The boxes fade to grey and the gaps between them light up as gates.
- **Say:** "agreed", "reviewed", "done" and "delivered" are all claims. At each seam a claim meets evidence, and when the evidence doesn't hold, the work doesn't cross.

### 11. Where the seven cards land

- **On slide:** the gates grouped into three kinds:
  - **Authority** (you and the machine): agreement, handover, report delivery. Only your words move them.
  - **Evidence** (step to step): independent review, staleness, finding validation. Evidence is tied to the exact files it examined.
  - **Continuity** (session to session): compaction and takeover. Nothing is taken on trust.
- **Build:** each card from slide 4 flies to its seam. The solid and dashed legend appears last.
- **Say:** be honest early. Most gates are mechanical and one is partly judgment. The limits section comes back to what that means.

## Zooms (22 minutes)

Each zoom follows the same rhythm: the card, the mechanism in one picture, a real story, and the runtime saying no.

### 12. "It built something slightly different" (Agreement)

- **On slide:** "Shall I begin?" / "Yes." Beneath: "Only a yes to a plain question counts. The spec goes to you while an independent reviewer reads the same draft."
- **Story:** S1.1. A lead agent spent about 90 minutes polishing a technical draft before showing the user the short scope, and the user could no longer tell refinements from additions. The report says the later approval "does not prove that earlier additions were agreed". That is why the draft now reaches you straight away, while its review runs alongside.
- **Runtime:** C1. Implementation of a spec'd task is refused until the spec has a resolved independent review.
- **Say:** after a related bug, the fix was accepted from the hosts' own event logs, "not the model's prose": edits appeared only in the turn after the user said yes (S1.2).

### 13. "It stopped halfway" (Handover)

- **On slide:** five prompt wordings, each struck through, then a hook icon. Headline: "We couldn't prompt our way there, so we built a seam."
- **Story:** S6.1. Across five wordings the model went straight into the work without telling the user they could leave; one model wrote the acknowledgement only in its private reasoning. Now the acknowledgement ends the turn, a verified Stop hook blocks the stop, and the work resumes.
- **Runtime:** C11. "I'm going to bed" is not accepted as a handover until there is observed evidence the run will keep going.
- **Say:** the hook has a limit on purpose: three reminders without progress and it lets the agent stop, so a stuck run cannot loop all night (S6.4).

### 14. "It hung" (Handover, continued)

- **On slide:** a stream of whitespace, a timer, a backup reviewer. Big number: "8 real firings, 6 finished by the backup."
- **Story:** S6.2. A reviewer streamed nothing but whitespace for 29 minutes. The runtime now ends such an attempt as `output-loop` after two minutes and hands the review to the next permitted reviewer. It has fired eight times in real work.

### 15. "It said all tests pass" (Independent review)

- **On slide:** "231 tests passed." On build: "An independent review found 8 more problems. One of them lost data."
- **Story:** S2.4. An independent audit treated earlier accounting as leads, not proof, and found a disk-full failure that cut a file to 6 bytes while every selected test stayed green. Present it as a setup-tooling defect found by an independent audit, not by the review gate.
- **Say:** tests check what someone thought to test. Independence is what finds the rest.

### 16. "It's grading its own homework" (Independent review)

- **On slide:** two host lanes. The reviewer sits on the other lane, works in a read-only copy, and returns a review record stamped with its verified model and session.
- **Story:** S2.1. A reviewer later took over as lead agent. Its own review was refused, and a fresh independent review was required.
- **Say:** the lead agent's sessions, current and former, can never supply the review of their own work.

### 17. "What if the good reviewer is unavailable?" (Independent review)

- **On slide:** the strong reviewers greyed out and a third labelled "advisory". The gate stays closed until a strong review arrives.
- **Story:** S2.2, from real work. Neither strong model was available: one allowance was used up and the host refused the other for exceeding its limit. A capable model outside the approved strong set reviewed the work, but its review was recorded as advisory only, and publication waited for a strong review.
- **Runtime:** C2, an advisory review does not pass the gate; C3, a required model cannot quietly fall back to another.

### 18. "Something changed after you approved it" (Staleness)

- **On slide:** a review stamp pinned to a file's contents. An edit flips the stamp to STALE and the gate closes.
- **Runtime:** C4. One added line in the README, and the review no longer counts.
- **Story:** S3.1. The lead agent's own documentation edits changed files while a spec review was running. The finished review was refused, and its 125,622 tokens were spent anyway: paid work thrown away rather than accept a review of files that no longer existed.

### 19. "Strict, and it costs" (Staleness, continued)

- **On slide:** "One stray image blocked a finished review." / "Two edits to a report: 17 minutes of reruns."
- **Story:** S3.2 and S3.3. An unrelated image appeared after a review started and the finished review could not be counted. Edits to a report alone invalidated a 306-test check twice. The same strictness caught the test harness itself using an outdated review record (S3.4).
- **Say:** the seam errs toward "stale". That is the right direction for trust, and you pay for it in time, not in correctness.

### 20. "It reported a bug that isn't there" (Skeptic)

- **On slide:** big number: "15 of 20 findings refuted." Beneath: "Every finding gets its own fresh skeptic."
- **Story:** S4.2. In the largest Codex run, a fresh skeptic checked each finding against evidence; most did not survive, the agreed behavior stayed unchanged, and the three real improvements were made and reviewed again. The 75% is arithmetic on the report's tallies.
- **Runtime:** C5. A finding no skeptic has checked cannot be decided: "Missing evidence is unresolved."

### 21. "…and a real one can't be waved away" (Skeptic, continued)

- **On slide:** four outcomes for a checked finding: fix it, defer it with a reason and a place to track it, skip it as an accepted tradeoff, or mark it refuted.
- **Runtime:** C6. A confirmed finding that the agreed outcome requires cannot be skipped because it is "costly to fix".
- **Say:** skepticism works in both directions. It stops the team from chasing phantom bugs (S4.9), and it stops real ones from being argued away.

### 22. "It fixed one thing and broke another" (Re-review)

- **On slide:** the loop: review, skeptic, decide, fix, then back to "review the whole change", not "review the patch".
- **Build:** the return arrow lands on the whole change. Hold it.
- **Say:** after every fix, however small, a strong reviewer re-examines everything changed since the run began, including neighbouring code and earlier fixes. The earlier version of Nightshift ran a fixed number of rounds and stopped at a literal "LGTM" (S4.10). Now any fix voids the review, and only a new review of the whole change restores it. "Keep this loop in mind; in a few minutes you'll see it catch something the tests missed."

### 23. "It forgot what you agreed" (Continuity)

- **On slide:** a context window filling up, then compaction: the history is summarized to make room and details drop out. Beside it, the run record, untouched.
- **Runtime:** C7, the brief the lead agent reads after compaction: the agreed outcome, the open finding, and the rules, handed back by the run record rather than recalled.
- **Story:** S5.1. With three findings still open, a real compaction cut the history from 215,588 to 17,531 tokens, and recall was checked against the run record before any edit.
- **Say:** if you have used an agent for long sessions, you have seen compaction. The difference is where the obligations live: not in the model's memory, in the record.

### 24. "Another session picks it up" (Continuity, continued)

- **On slide:** a Codex session goes dark; a Claude session picks up the same run.
- **Story:** S5.2, from real work. The original Codex session became unavailable. A Claude lead agent took over the same run with the user's explicit permission, the takeover was recorded in the run's history, and the work was finished and published.
- **Runtime:** C8, a write based on an old view of the run is refused; C10, a second run cannot start over an unfinished one.
- **Say:** all eight combinations of same-host and cross-host takeover were tested, and a takeover is blocked while the original might still be working (S5.3).

### 25. "It said done. It wasn't." (Closing)

- **On slide:** the closing gates in order: retrospective, morning report, triage, complete. Delivery counts only when you reply.
- **Runtime:** C12, the run cannot be completed before the retrospective; C13, triage cannot start before the morning report is written.
- **Story:** S7.2. A report admitted that the work had skipped the required review, documentation and retrospective workflows, and that doing them later does not count backwards. And S7.3: a lead agent ended with "The morning report is saved in this session" instead of showing it, and the rule was tightened so the final message is the report itself.

### 26. What the morning report must say

- **On slide:** the report's required contents, in order:
  1. What was delivered, how it was verified, and the limits of that verification.
  2. Which of the review, documentation and retrospective workflows actually ran.
  3. Commits, and whether anything was published.
  4. What the retrospective found.
  5. Whether the run stayed unattended.
  6. Last, every unresolved item: what it is, where, what failed, and the decision waiting for you.
- **Say:** the report is written for someone who saw nothing of the run, and it always ends with what is still open. Then triage goes one item at a time, each with a recommendation.

## One run (5 minutes)

One slide with builds, or a short Magic Move sequence, on the running example [R](catalog.md#r-running-example-one-run-five-seams). The mini-map lights each seam as the run crosses it. Say once, up front: "This was an acceptance test, but the interesting parts were not scripted."

### 27. One run, five seams

- **Beat 1, the reviewer hangs (handover, review):** about 15 minutes of mostly whitespace. The timeout reclaims it, a permitted Fable reviewer finishes the review, and the half-finished output that claimed completion never counts.
- **Beat 2, compaction (continuity):** three findings open. History drops from 215,588 to 17,531 tokens. Recall is checked against the run record before any edit.
- **Beat 3, the skeptic and the fix (skeptic):** a fresh Astra skeptic confirms all three and marks two as required. The fix lands; 14 tests and the product check suite pass, and four new tests fail against the old code, so they can catch the bug.
- **Beat 4, the catch (re-review):** slide 28.
- **Beat 5, not done (closing):** the budget runs out and the run is left incomplete, not declared done. It was finished later, and at the end the record showed ten findings where the model's own summary said nine. The record won.

### 28. `[10]` became `[15]`

- **On slide:** the regression, large: `forEach` skips empty array slots, so `[10]` becomes `[15]`. Beneath: "after 14 green tests".
- **Say:** everything was green. The next review of the whole change found the regression, running the code reproduced it, and the gate stayed shut. This is the answer to "fixed one thing and broke another", in one run.
- **Evidence:** R steps 4 and 5, S4.1.

## Limits and cost (3 minutes)

### 29. What the seams don't catch

- **On slide:** three items:
  - After the full workflow finished, a later review still found a bug (L2).
  - A model wrote files before creating the run it was required to create first. The dashed gate is dashed (L3).
  - A host exit can still end an unattended night, and only Windows is verified (L8).
- **Say:** name these before someone asks. The seams make errors discoverable; they do not make the models infallible, and a reviewer on another host does not guarantee different mistakes (L9).

### 30. What it costs

- **On slide:** "7.3 million tokens for two tiny handovers." Beneath: "These were not silently passed."
- **Say:** assurance is expensive, and the reports say so without converting tokens to money, so don't either. Every report also states what did not run and what stayed unproven (S7.6). That honesty is itself a seam: a run cannot claim more than its evidence.
- **Evidence:** L6, S7.6.

## Take-home and close (3 minutes)

### 31. Six things you can use tomorrow

- **On slide:** usable with any agent setup, with or without Nightshift:
  1. Review in a fresh session that didn't write the code, ideally with a different strong model.
  2. Make every finding prove itself before anyone acts on it.
  3. After any fix, review the whole change again, not the patch.
  4. Tie "reviewed" to the exact file contents, so any edit makes it stale.
  5. Keep the plan, the agreement and the open findings outside the model's context.
  6. Make "done" a checked state, not a sentence.

### 32. The answer

- **On slide:** the overview returns with every seam lit. Headline: "You don't trust the model. You trust the seams."
- **Build:** Magic Move from slide 10, with every gate lit.
- **Say:** return to the question from slide 1. You trust code you didn't review by trusting evidence that had to survive being checked, from a system that tells you plainly when it didn't.

### 33. Questions

## Prepared answers

| Likely question | Answer from |
|---|---|
| What does it cost? | L6, S3.3 |
| Does it run on Mac or Linux? | L8: only Windows is verified |
| What if both models make the same mistake? | L9 and L2: cross-host review reduces shared blind spots but does not remove them |
| Isn't the skeptic just another model that can be wrong? | Yes, which is why missing evidence stays unresolved and running the code decides disputes (S1.4, S4.4) |
| Couldn't the agent tamper with the run record? | L9: the checks catch ordinary mistakes, not deliberate manipulation; it is not a security boundary |
| Why not just write more tests? | S2.4 and R: green tests missed both the data loss and the regression |
| Can it use cheaper models? | For implementation, with a written plan; their reviews count only as advisory, because the gate requires a strong review (S2.2, C2) |
| What happens when it gets stuck? | S6.2, S6.3, S6.4 |

## Appendix

Keep these for questions; they are detail, not mechanism.

- **A1. The review lenses.** The four spec and six code dimensions every reviewer considers (`WORKFLOW.md`, "Review dimensions").
- **A2. The acceptance arc.** The 8M to 272M campaign table from the catalog.
- **A3. Before and after.** v2's digest gate, fixed review rounds and fail-open judge against v3 (S1.6, S4.10, S4.11, S5.8).
- **A4. Headline numbers.** The catalog's [headline numbers](catalog.md#headline-numbers) table.
- **A5. More failures.** Stories trimmed from the main path: the budget overrun (L4), the agent that declared itself blocked too early (S6.3), and the takeover gap found at publication review (S5.7).
- **A6. All captured output.** [captured-output.md](captured-output.md), including the raw responses.

## If the slot shrinks

- To 45 minutes: drop slides 14, 19 and 26, and trim the prepared answers.
- To 30 minutes: also drop slides 3, 6, 9 and 21, merge slides 16 and 17, and run the case study as slide 28 alone.

## Decisions applied

- Audience: developers who have used AI assistants but not orchestrators; the primer and the take-home slide exist for them.
- Length: one hour, with about nine minutes for questions.
- Models: "strong models" in framing; Fable and Astra by name in examples.
- Runtime output: real, captured from the runtime and edited for slides (C1 to C13).
- Failures: the limits section is trimmed to three items; the rest move to appendix A5.
