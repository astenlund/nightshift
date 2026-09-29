# Slide outline: trust lives in the seams

A one-hour keynote answering "How do you trust the results without reviewing the code yourself?" It opens with what the audience already knows, shows the whole workflow, inverts it to show that trust lives in the seams between the steps, zooms into each seam with a real story and real runtime output, and then watches one run pass through them. Story IDs (S1.1, R, L2) refer to the [seams catalog](catalog.md); output IDs (C1 to C13) refer to the [captured runtime output](captured-output.md).

## Audience and language

The audience is software developers who have used AI assistants, in chat or as an agent in their editor, but have not worked with custom workflows or agent orchestrators. They know the failure modes from experience; they have not handed over a task and walked away.

- **Build vocabulary before using it.** The primer section introduces every term the zooms rely on.
- **Start each zoom from their experience.** Each seam is introduced by a failure the audience has probably seen.
- **Show real output.** Where a refusal was captured, the zoom shows the runtime refusing, edited for the slide as described in [captured-output.md](captured-output.md).
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
| Ready | The command that lists work ready to start and recommends what to pick | Ready skill |
| second opinion | A background agent that gives short feedback and suggested tweaks on the work you picked, as advice | assessment agent |
| shift supervisor | A session on a smaller model that the lead agent starts to carry routine coordination when that work fills its context | lower-tier supervisor |
| user proxy | A strong model that reasons as you, from what is on record, when a decision comes up while you are away; its answers always carry its own label | user proxy consultation |
| degraded review | A recorded review by a weaker model, used when no strong model can take the role or when you choose one; labelled everywhere and never counted as strong | degraded assessment |

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
| From chat to handover | 6 | 3 to 6 |
| The whole workflow | 5 | 7 to 9 |
| The inversion | 3 | 10 to 11 |
| Zooms | 25 | 12 to 29 |
| One run | 5 | 30 to 31 |
| Limits and cost | 4 | 32 to 33 |
| Take-home and close | 3 | 34 to 35 |
| Questions | 6 | 36 |

## Open (3 minutes)

### 1. The question

- **On slide:** "How do you trust code you didn't review?"
- **Visual:** black slide, one line.
- **Say:** everyone asks this about AI that works on its own. If trust means reading every line, the answer is that you can't. This talk is about what else trust can mean.

### 2. The promise

- **On slide:** "Hand it over. Go to bed. Come back to a result you can act on." Two pillars below: Autonomy and Trust.
- **Say:** reliability has two equal parts. A run that finishes by lowering its standard is not reliable, and neither is a sound result that sat waiting for you all night. The answer tonight is not "the models are good enough now".

## From chat to handover (6 minutes)

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

- **On slide:** one diagram. You at the edge. A lead agent running the work. Reviewers and skeptics in fresh read-only sessions, when possible on the other host. A run record beneath everything. Hooks at the host boundary. Two helpers beside the lead agent: a shift supervisor and a user proxy.
- **Say:** the lead agent is a strong model in a normal session; it implements directly, with no special planning stage. Reviewers and skeptics are fresh sessions that never saw the lead's reasoning. Fable or Astra can play any role; when both are available, the reviewer usually runs on the other host. You can also fix a team in advance, such as Fable leading and Astra implementing. When routine coordination starts filling the lead agent's context, it hands that work to a shift supervisor on a smaller model and keeps every consequential decision. The user proxy offers an answer in your place when a decision comes up while you are away.

### 6. Models judge, code keeps the books

- **On slide:** `VISION.md:93` "Models own engineering and product judgment. Deterministic tools own mechanics where a mistake would lose work, corrupt state, or misrepresent what happened."
- **Visual:** the run record as a ledger. Every change to it is a checked transaction, and the ledger can answer "no".
- **Say:** the run record holds what was agreed, what stage each task is in, what evidence exists and which findings are open. The models ask to change it; plain code decides whether the change is allowed. Hold that thought, because the answers to all seven cards come from here.

## The whole workflow (5 minutes)

### 7. The whole night

- **On slide:** the overview: Pick, Agree, then a vertical handover line, then Implement, Review with a loop back through Repair, Document, Retrospective, Morning report, Triage. A thin bar beneath the whole diagram: "run record". From Implement onward, the steps sit in a lane labelled "own worktree, own branch".
- **Build:** stages appear left to right. You leave at the handover line and return at the morning report.
- **Say:** the night starts with Ready, which lists the work that is ready to start. It recommends a few high-value items, one or two quick ones, and a larger item or group sized for a night, and explains each pick against the project's own stated direction, such as its vision document. If an earlier run was left unfinished, Ready says so and offers to pick it up. Reports waiting in the project's inbox get their own list, to triage when you choose. Each run works in its own worktree on its own branch, so your checkout stays yours through the night. While it works, a local page can show this same graph live, lighting the current step as reviewers start and files change.

### 8. One small fix, start to finish

- **On slide:** the readback, as the lead agent says it: `WORKFLOW.md:19` "Refresh should reload the list while preserving the selected status filter. Shall I go ahead and make that change?"
- **Build:** walk the overview for this fix. The readback goes out, and a reviewer and a second opinion read it while you do; yes; implement with tests; an independent review of the whole change; a skeptic checks each finding; fix; review the whole change again; update the docs and have them reviewed; a short retrospective; the morning report; decide the follow-ups one at a time.
- **Say:** that is the whole flow for a small change. A larger feature replaces the readback with a short written spec, and the same background review runs while you read it.

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
  - **Continuity** (session to session): compaction, takeover and restart. Nothing is taken on trust.
- **Build:** each card from slide 4 flies to its seam. The solid and dashed legend appears last.
- **Say:** be honest early. Most gates are mechanical and one is partly judgment. The limits section comes back to what that means.

## Zooms (25 minutes)

Each zoom follows the same rhythm: the card, the mechanism in one picture, a real story, and the runtime saying no where a refusal was captured. A mechanism with no recorded incident is shown without an evidence footer.

### 12. "It built something slightly different" (Agreement)

- **On slide:** "Shall I begin?" / "Yes." Beneath: "Only a yes to a plain question counts. The readback or spec goes to you while an independent reviewer reads the same draft."
- **Story:** S1.1. A lead agent spent about 90 minutes polishing a technical draft before showing the user the short scope, and the user could no longer tell refinements from additions. The report says the later approval "does not prove that earlier additions were agreed". That is why the draft now reaches you straight away, while its review runs alongside.
- **Runtime:** C1. Implementation of a spec'd task is refused until the spec has a resolved independent review.
- **Say:** after a related bug, the fix was accepted from the hosts' own event logs, "not the model's prose": edits appeared only in the turn after the user said yes (S1.2). A yes with a change counts as a yes to the changed plan, and a later material change comes back to you as a short delta.

### 13. "I asked for the wrong thing" (Agreement, continued)

- **On slide:** the draft in the middle, and two agents starting beside it the moment it appears. The reviewer asks "Does this match what you said and what the code does?" The second opinion asks "Is this worth doing, and is there a simpler way?"
- **Build:** the draft appears first. Review findings and suggested tweaks arrive while you read. Your yes can come early; the work and the handover wait until you have seen both and settled the tweaks you want.
- **Story:** S1.4. Review before agreement has caught a real defect before any code existed. The skeptic could not settle an encoding finding by reading, so a private probe decided it, and a rejection rule entered the spec before agreement.
- **Say:** a backlog entry may have been written without any AI input, and this is the last chance for feedback before work starts. The reviewer checks the draft against your words and the code. The second opinion is advice without a gate, from an agent that never saw the lead agent's reasoning, and the lead agent checks its facts before passing it on. A spec reviewer who asks for more detail must name the gap it closes, and asks whether something simpler would do.

### 14. "It stopped halfway" (Handover)

- **On slide:** five prompt wordings, each struck through, then a hook icon. Headline: "We couldn't prompt our way there, so we built a seam."
- **Story:** S6.1. Across five wordings the model went straight into the work without telling the user they could leave; one model wrote the acknowledgement only in its private reasoning. Now the acknowledgement ends the turn, a verified Stop hook blocks the stop, and the work resumes.
- **Runtime:** C11. "I'm going to bed" is not accepted as a handover until there is observed evidence the run will keep going.
- **Say:** the hook has a limit on purpose: three reminders without progress and it lets the agent stop, so a stuck run cannot loop all night (S6.4).

### 15. "It needed a decision while I slept" (Handover, continued)

- **On slide:** a question arrives in the night. The work that depends on it pauses, everything else carries on, and the question waits for the morning. Beside it, a user proxy offers an answer with a confidence and a label reading "user proxy".
- **Build:** the proxy's answer moves into the morning triage list, still labelled, for you to confirm or overturn.
- **Story:** S1.3. In an acceptance case, a mid-run request changed agreed behavior and deliberately left one choice open. The lead agent kept the approved design, recorded the open choice without picking a fallback, and the dependent work stayed blocked on the real decision.
- **Say:** the lead agent does not settle your decisions by guessing. It can consult a user proxy, the strongest available model asked to reason as you would from what is on record, such as your instructions, the backlog and earlier decisions. The answer stays labelled as the proxy's in the run record, the report and triage. With high enough confidence the lead agent may act on it; decisions reserved for you stay yours whatever the confidence. If you opt in, a profile of your priorities builds up over time for the proxy to draw on.

### 16. "It hung" (Handover, continued)

- **On slide:** a stream of whitespace, a timer, a backup reviewer. Big number: "8 real firings, 6 finished by the backup."
- **Story:** S6.2. A reviewer streamed nothing but whitespace for 29 minutes. The runtime now ends such an attempt as `output-loop` after two minutes and hands the review to the next permitted reviewer. It has fired eight times in real work.

### 17. "It said all tests pass" (Independent review)

- **On slide:** "231 tests passed." On build: "An independent review found 8 more problems. One of them lost data."
- **Story:** S2.4. An independent audit treated earlier accounting as leads, not proof, and found a disk-full failure that cut a file to 6 bytes while every selected test stayed green. Present it as a setup-tooling defect found by an independent audit, not by the review gate.
- **Say:** tests check what someone thought to test. Independence is what finds the rest. Stand-ins are the other blind spot. When a change crosses a boundary the tests fake, such as processes, the shell, the filesystem, credentials, the network or model behavior, the lead agent also runs it for real once the tests pass, within a live-check allowance you settle at handover. The report names whatever stayed test-only as a limit. A fix that shipped without a live check stays marked until a later run is seen exercising it, one host at a time.

### 18. "It's grading its own homework" (Independent review)

- **On slide:** two host lanes. The reviewer sits on the other lane, works in a read-only copy, and returns a review record stamped with its verified model and session.
- **Build:** for a large change, peer reviewers with the reviewer's own model and effort appear beside it, and their evidence flows back into its single assessment.
- **Story:** S2.1. A reviewer later took over as lead agent. Its own review was refused, and a fresh independent review was required.
- **Say:** the lead agent's sessions, current and former, can never supply the review of their own work. The first reviewer is a strong model on the other host, working at no less effort than whoever wrote the work. If that host has no strong model free, a strong reviewer on the same host beats a weaker one on the other host. The stamp is checked against the host's own event logs, and missing model evidence stays explicit instead of being assumed. Command limits you set for a review are enforced by host controls where they matter, and a failed enforcement check never counts as permission.

### 19. "What if the good reviewer is unavailable?" (Independent review)

- **On slide:** the strong reviewers greyed out and a third labelled "degraded". Its review is recorded and the tasks move on. Completing the run and publishing stay shut until a strong review of the same content arrives.
- **Story:** S2.2, from real work. Neither strong model was available: one allowance was used up and the host refused the other for exceeding its limit. A capable model outside the approved strong set reviewed the work, but its review was used as advisory only, outside the run record, and publication waited for a strong review, as the user required. Degraded review exists to make that improvised split a mechanism the run record holds.
- **Runtime:** C2, moving on from review with only a below-strength review on record is refused; C3, a required model cannot quietly fall back to another.
- **Say:** a degraded review starts only when no strong model can take the role, or when you choose a weaker model yourself, and it never overrides a model you required. Its label follows it into every gate and report, and no gate treats it as strong. When a strong reviewer is back, it reviews the whole change fresh. The list of strong models lives in a policy file you can edit.

### 20. "Something changed after you approved it" (Staleness)

- **On slide:** a review stamp pinned to a file's contents. An edit flips the stamp to STALE and the gate closes.
- **Runtime:** C4. One added line in the README, and the review no longer counts.
- **Story:** S3.1. The lead agent's own documentation edits changed files while a spec review was running. The finished review was refused, and its 125,622 tokens were spent anyway: paid work thrown away rather than accept a review of files that no longer existed.
- **Say:** the content is captured once per review, and both the reviewer's copy and the stamp come from that one capture, so what was read and what was stamped are the same bytes.

### 21. "Strict, and it costs" (Staleness, continued)

- **On slide:** "One stray image blocked a finished review." / "Two edits to a report: 17 minutes of reruns."
- **Story:** S3.2 and S3.3. An unrelated image appeared after a review started and the finished review could not be counted. Edits to a report alone invalidated a 306-test check twice. The same strictness caught the test harness itself using an outdated review record (S3.4).
- **Say:** the seam errs toward "stale". That is the right direction for trust, and you pay for it in time, not in correctness. Checks can also go stale from outside the project. A matching file digest says nothing about a changed compiler or environment, so after such a change the check runs again.

### 22. "It reported a bug that isn't there" (Skeptic)

- **On slide:** big number: "15 of 20 findings refuted." Beneath: "Every finding gets its own fresh skeptic."
- **Build:** findings arrive one at a time while the reviewer keeps reading, and a skeptic starts on each as it lands.
- **Story:** S4.2. In the largest Codex run, a fresh skeptic checked each finding against evidence; most did not survive, the agreed behavior stayed unchanged, and the three real improvements were made and reviewed again. The 75% is arithmetic on the report's tallies.
- **Runtime:** C5. A finding no skeptic has checked cannot be decided: "Missing evidence is unresolved."
- **Say:** the skeptics' work overlaps the review, but nothing is decided or fixed until the review is complete. When one problem shows up in several places, the finding keeps every place with its evidence, so the check, the decision and the fix reach all of them.

### 23. "…and a real one can't be waved away" (Skeptic, continued)

- **On slide:** four outcomes for a checked finding: fix it, defer it with a reason and a place to track it, skip it as an accepted tradeoff, or mark it refuted.
- **Runtime:** C6. A confirmed finding that the agreed outcome requires cannot be skipped because it is "costly to fix".
- **Say:** skepticism works in both directions. It stops the team from chasing phantom bugs (S4.9), and it stops real ones from being argued away. When a finding's consequence, value or fix stays in dispute, the reviewer that found it and the skeptic argue it out, and that reviewer stays available through the fix. A fix needs enough reasoning to judge its approach before it is applied.

### 24. "It fixed one thing and broke another" (Re-review)

- **On slide:** the loop: review, skeptic, decide, fix, then back to "review the whole change", not "review the patch".
- **Build:** the return arrow lands on the whole change. Hold it. Then the fix box opens: for a bug, first a check that fails for the bug's reason, and after the fix the same check passing.
- **Say:** after every fix, however small, a strong reviewer re-examines everything changed since the run began, including neighbouring code and earlier fixes. The earlier version of Nightshift ran a fixed number of rounds and stopped at a literal "LGTM" (S4.10). Now any fix voids the review, and only a new review of the whole change restores it. A bug fix starts with a check that fails for the bug's reason and ends with the same check passing. "Keep this loop in mind; in a few minutes you'll see it catch something the tests missed."

### 25. "It forgot what you agreed" (Continuity)

- **On slide:** a context window filling up, then compaction: the history is summarized to make room and details drop out. Beside it, the run record, untouched.
- **Runtime:** C7, the brief the lead agent reads after compaction: the agreed outcome, the open finding, and the rules, handed back by the run record rather than recalled.
- **Story:** S5.1. With three findings still open, a real compaction cut the history from 215,588 to 17,531 tokens, and recall was checked against the run record before any edit.
- **Say:** if you have used an agent for long sessions, you have seen compaction. The difference is where the obligations live: not in the model's memory, in the record. The record also keeps settled decisions, what investigations concluded and working notes, and passes the relevant ones to the next reviewer without the author's argument for why the code is right; new evidence can still reopen a decision. When routine coordination starts filling the lead agent's context, a shift supervisor takes it over and reports back with the evidence still reachable.

### 26. "Another session picks it up" (Continuity, continued)

- **On slide:** a Codex session goes dark; a Claude session picks up the same run.
- **Story:** S5.2, from real work. The original Codex session became unavailable. A Claude lead agent took over the same run with the user's explicit permission, the takeover was recorded in the run's history, and the work was finished and published.
- **Runtime:** C8, a write based on an old view of the run is refused; C10, a second run cannot start over an unfinished one.
- **Say:** all eight combinations of same-host and cross-host takeover were tested, and a takeover is blocked while the original might still be working (S5.3). A new session hears about an unfinished run from Ready, which offers to pick it up; after that, everything works as in the original session, morning report included.

### 27. "The machine restarted overnight" (Continuity, continued)

- **On slide:** a Windows restart warning with seconds on the clock. The run record is already saved. After the restart, the same run carries on.
- **Build:** the warning appears; every active Nightshift session stops starting new work and saves what it can; the screen goes dark; the host comes back, and the run resumes once its files, ownership and surviving processes are checked.
- **Story:** L8. The v3 reports recorded that automatic relaunch was deferred and that a host exit could end an unattended night. That limit is why Night Guard and relaunch exist.
- **Say:** Night Guard saves recovery state all through the run, because Windows may give only seconds of warning and a session may get none at all. It coordinates the stop across every active Nightshift session, on either host, and leaves unrelated sessions alone. Relaunch then resumes only the authorized unfinished work, after the same kind of reconciliation as a takeover. An exit is not automatically permission to restart, a saved checkpoint is not proof that work resumed, and resuming grants no new authority.

### 28. "It said done. It wasn't." (Closing)

- **On slide:** the closing gates in order: reviewed docs, retrospective, morning report, triage, complete. Delivery counts only when you reply.
- **Runtime:** C12, the run cannot be completed before the retrospective; C13, triage cannot start before the morning report is written.
- **Story:** S7.2. A report admitted that the work had skipped the required review, documentation and retrospective workflows, and that doing them later does not count backwards. And S7.3: a lead agent ended with "The morning report is saved in this session" instead of showing it, and the rule was tightened so the final message is the report itself.
- **Say:** the documentation gets its own independent review, with every claim checked against the code and records it cites, through the same skeptic and fix loop as code, and so do the backlog edits triage produces. The retrospective's proposed rule changes go through that loop too, and still wait for your approval. Lessons go to their audience: a Nightshift maintainer's to Nightshift's backlog or inbox, anyone else's to their own instruction files.

### 29. What the morning report must say

- **On slide:** the report's required contents, in order:
  1. What was delivered, how it was verified, and the limits of that verification, including what stayed test-only.
  2. Which of the review, documentation and retrospective workflows actually ran, and any review that is still degraded.
  3. The run's branch, its commits, and whether anything was published.
  4. What the retrospective found.
  5. Whether the run stayed unattended.
  6. Last, every unresolved item: what it is, where, what failed, and the decision waiting for you, including any answer the user proxy gave in your place.
- **Say:** the report is written for someone who saw nothing of the run and may not know the codebase. It explains behavior, tradeoffs and risk with the evidence to decide, and walks through source only when asked. The branch is a diff you can merge, adjust or discard. Repairs are committed as verified fixups to the commits they correct, or as plain follow-up commits where a fixup would be unsafe and your policy allows. Problems that kept coming back stay visible. The report always ends with what is still open. Then triage goes one item at a time, each with a recommendation.

## One run (5 minutes)

One slide with builds, or a short Magic Move sequence, on the running example [R](catalog.md#r-running-example-one-run-five-seams). The mini-map lights each seam as the run crosses it. Say once, up front: "This was an acceptance test, but the interesting parts were not scripted."

### 30. One run, five seams

- **Beat 1, the reviewer hangs (handover, review):** about 15 minutes of mostly whitespace. The timeout reclaims it, a permitted Fable reviewer finishes the review, and the half-finished output that claimed completion never counts.
- **Beat 2, compaction (continuity):** three findings open. History drops from 215,588 to 17,531 tokens. Recall is checked against the run record before any edit.
- **Beat 3, the skeptic and the fix (skeptic):** a fresh Astra skeptic confirms all three and marks two as required. The fix lands; 14 tests and the product check suite pass, and four new tests fail against the old code, so they can catch the bug.
- **Beat 4, the catch (re-review):** slide 31.
- **Beat 5, not done (closing):** the budget runs out and the run is left incomplete, not declared done. It was finished later, and at the end the record showed ten findings where the model's own summary said nine. The record won.

### 31. `[10]` became `[15]`

- **On slide:** the regression, large: `forEach` skips empty array slots, so `[10]` becomes `[15]`. Beneath: "after 14 green tests".
- **Say:** everything was green. The next review of the whole change found the regression, running the code reproduced it, and the gate stayed shut. This is the answer to "fixed one thing and broke another", in one run.
- **Evidence:** R steps 4 and 5, S4.1.

## Limits and cost (4 minutes)

### 32. What the seams don't catch

- **On slide:** three items:
  - After the full workflow finished, a later review still found a bug (L2).
  - A model wrote files before creating the run it was required to create first. The dashed gate is dashed (L3).
  - Only Windows is verified (L8).
- **Say:** name these before someone asks. The seams make errors discoverable; they do not make the models infallible, and a reviewer on another host does not guarantee different mistakes (L9). How much gets through is measured. The lifecycle runs against a fixed suite of seeded defects and records what it catches, which false alarms survive the skeptic, and the time and model cost, and the measurement is repeated whenever models or review guidance change. The host-exit limit also recorded under L8 is the one slide 27 answers.

### 33. What it costs

- **On slide:** "7.3 million tokens for two tiny handovers." Beneath: "These were not silently passed."
- **Build:** a second line: "Savings count only where the standard holds."
- **Say:** assurance is expensive, and the reports say so without converting tokens to money, so don't either. Every report also states what did not run and what stayed unproven (S7.6). That honesty is itself a seam: a run cannot claim more than its evidence. Savings follow the same rule. A less expensive model takes a role only where live tests show it meets that role's required strength. The lead agent's overhead from repeated reads, polling and bookkeeping is measured and trimmed, and a saving counts once it is measured. A review whose report is only malformed gets a narrow correction that keeps its findings and attribution, instead of being paid for twice. The budget you set is enforced with accurate accounting, your model preferences survive continuation, and any model substitution is reported to you with its reason.
- **Evidence:** L6, S7.6.

## Take-home and close (3 minutes)

### 34. Seven things you can use tomorrow

- **On slide:** usable with any agent setup, with or without Nightshift:
  1. Review in a fresh session that didn't write the code, ideally with a different strong model.
  2. Make every finding prove itself before anyone acts on it.
  3. After any fix, review the whole change again, not the patch.
  4. Tie "reviewed" to the exact file contents, so any edit makes it stale.
  5. Keep the plan, the agreement and the open findings outside the model's context.
  6. Make "done" a checked state, not a sentence.
  7. Reproduce a bug with a failing check before you fix it, and run for real what your tests fake.

### 35. The answer

- **On slide:** the overview returns with every seam lit. Headline: "You don't trust the model. You trust the seams."
- **Build:** Magic Move from slide 10, with every gate lit.
- **Say:** return to the question from slide 1. You trust code you didn't review by trusting evidence that had to survive being checked, from a system that tells you plainly when it didn't.

### 36. Questions

## Prepared answers

| Likely question | Answer from |
|---|---|
| What does it cost? | L6, S3.3; where it saves, slide 33 |
| Does it run on Mac or Linux? | L8: only Windows is verified |
| What if both models make the same mistake? | L9 and L2: cross-host review reduces shared blind spots but does not remove them; the seeded-defect measurement shows what gets through (slide 32) |
| Isn't the skeptic just another model that can be wrong? | Yes, which is why missing evidence stays unresolved and running the code decides disputes (S1.4, S4.4); a disputed finding goes back to the reviewer that found it (slide 23) |
| Couldn't the agent tamper with the run record? | L9: the checks catch ordinary mistakes, not deliberate manipulation; it is not a security boundary |
| Why not just write more tests? | S2.4 and R: green tests missed both the data loss and the regression; faked boundaries are also run for real (slide 17) |
| Can it use cheaper models? | For implementation, with a written plan. For review, only as a labelled degraded review when no strong model can take the role or you choose one, and the run cannot complete or publish until a strong review covers the same content (slide 19; S2.2 is why). Each role's model is chosen by live tests and price (slide 33) |
| What happens when it gets stuck? | S6.2, S6.3, S6.4; decisions while you are away, slide 15; restarts, slide 27 |
| How does a fix avoid undoing an earlier one? | Each fix starts from the files as they are now and keeps what earlier fixes established; a file a helper owns is fixed through that helper. After each pass, a short note says what was established, what was fixed, what is left and why another pass is needed (slide 24) |
| What if a bug can't be reproduced by a test? | The report says why and names the evidence that stood in, as a verification limit (slide 24) |
| Can my own instructions override the plugin's? | Where they conflict, your global and project instruction files take precedence over the plugin's instructions. The runtime's gates are code, so they still apply (slide 28) |
| Will it get in the way of my own work? | Slide 7: the run works in its own worktree on its own branch, and the morning report points at the diff |

## Appendix

Keep these for questions; they are detail, not mechanism.

- **A1. The review lenses.** The four spec and six code dimensions every reviewer considers (`WORKFLOW.md`, "Review dimensions").
- **A2. The acceptance arc.** The 8M to 272M campaign table from the catalog.
- **A3. Before and after.** v2's digest gate, fixed review rounds and fail-open judge against v3 (S1.6, S4.10, S4.11, S5.8).
- **A4. Headline numbers.** The catalog's [headline numbers](catalog.md#headline-numbers) table.
- **A5. More failures.** Stories trimmed from the main path: the budget overrun (L4), the agent that declared itself blocked too early (S6.3), and the takeover gap found at publication review (S5.7).
- **A6. All captured output.** [captured-output.md](captured-output.md), including the raw responses.
- **A7. Also in Nightshift.** One slide for the features the main path does not show, grouped by theme, one line each:
  - **Setup and backlog tooling**
    - Shared backlog index: one BACKLOG.md links the four backlog indexes and holds their shared instructions, and every hook that reads an index reads it too.
    - Guidance discovery: setup finds the instruction files that really govern a project, within set bounds, and routes guidance updates to them for your approval, asking when the right file is unclear.
    - Customized backlog repair: setup proposes repairs for customized backlog content and old guidance, and applies only what you approve.
    - Safe setup recovery: setup recovery touches only files it can show it owns, never overwrites, and recognizes its own partial writes.
    - One backlog grammar: Ready, setup and unwrap share one parser and file vocabulary, keeping the grammar differences that have a reason.
    - Line endings: setup normalizes mixed LF and CRLF endings in the backlog to the project's convention, recoverably.
    - Where ignore rules go: when setup needs new exclusions, you choose the shared .gitignore or the clone-local exclude file.
    - Track, ignore or defer: fresh setup asks whether to track the backlog in Git, ignore it or decide later.
  - **Windows platform hardening**
    - File metadata: writes and recovery keep the Windows file properties that matter, or say which they cannot.
    - Launch identity: every launch, including the runtime's own Git calls, checks the executable's identity and blocks when proof is missing.
    - Private review material: review requests, copies and event logs get restricted Windows access, which still does not isolate agents running as the same user.
    - Host connections: bounded buffers and frames, one owner for every timer, and runner state tested apart from process wiring.
  - **Packaging, release and guidance files**
    - Installation contents: each marketplace installs the runtime and user docs, without the repository's maintenance material where the host allows it.
    - Release gate: tells a stale branch from a real version decrease and checks that the checkout has enough history.
    - Run-time guidance: what agents follow during a run lives in an operations guide, apart from design references that no run loads.
  - **Verification infrastructure**
    - Fixtures and evidence: fixtures have owners, verification evidence has safe storage, startup is trimmed, a hang is told apart from a failure, and a cancelled check cleans up.
  - **Standalone modes**
    - Review mode: checks someone else's change, from a branch, a pull request or uncommitted work, against the material you supply, reports first, then offers repairs one finding at a time.
    - Run-free revise: a revise skill invoked on its own keeps attributed review records without starting a run, and lists its follow-ups in its final message.
    - Backlog coherence audit: on request, checks the whole backlog for stale relationships, drifting excerpts and outdated claims about the code; it repairs when you are present and files an inbox report when you are not.
    - Interactive pairing: a visible Codex session and a visible Claude Code session work side by side in Windows Terminal, exchanging tasks and results, and you can steer both.

The companion animated demo, a scripted run drawn as a live graph, is described in [demo/README.md](demo/README.md); it is a separate piece and not part of the slides.

## If the slot shrinks

- To 45 minutes: drop slides 9, 13, 15, 16, 21, 23, 27 and 29, show only the headline of slide 33, and keep questions to 3 minutes. Sections: open 3, from chat to handover 6, the whole workflow 4, the inversion 3, zooms 15, one run 5, limits and cost 3, take-home and close 3, questions 3.
- To 30 minutes: also drop slides 3, 6, 25 and 26, merge slides 18 and 19, run the case study as slide 31 alone, drop the last sentence of slide 32 and skip slide 33. Sections: open 2, from chat to handover 4, the whole workflow 3, the inversion 2, zooms 10, one run 3, limits and cost 2, take-home and close 2, questions 2.

## Decisions applied

- Audience: developers who have used AI assistants but not orchestrators; the primer and the take-home slide exist for them.
- Length: one hour, with about six minutes for questions.
- Models: "strong models" in framing; Fable and Astra by name in examples.
- Runtime output: real, captured from the runtime and edited for slides (C1 to C13).
- Failures: the limits section is trimmed to three items; the rest move to appendix A5.
- Backlog as shipped: as an exercise, this version presents the Nightshift backlog as of 2026-09-29 as shipped; its stories and captured output remain the real records.
