# Slide outline: trust lives in the seams

A keynote answering "How do you trust the results without reviewing the code yourself?" It opens with the whole workflow, inverts it to show that trust lives in the seams between the steps, zooms into each seam, and then watches one real run pass through them. Evidence IDs refer to the [seams catalog](catalog.md), which holds the verbatim quotes and sources.

Assumed format: about 30 minutes for a technical audience. [Cuts for 20 minutes](#cuts-for-20-minutes) are listed at the end.

## Visual language

- **Night.** The overview runs left to right from day to night. The left side, where you are present, is light; everything after handover is dark; the morning report returns to light.
- **Soft steps, hard seams.** Steps are soft, rounded, muted boxes. Seams are crisp gates between them and carry the color.
- **Solid and dashed gates.** A solid gate is one the runtime can refuse mechanically. A dashed gate relies on procedure and model judgment. Only Agreement is dashed (L3 shows why). Inside every solid gate a model still judges what passes, which is why the limits section exists.
- **Objections as titles.** Each zoom is titled with the audience's doubt, in quotes, not with the seam's name.
- **Mini-map.** Every zoom slide has the overview in a corner with the current seam lit.
- **Evidence footer.** Each zoom ends with a small line naming the report it comes from. It tells a technical audience that the example is on record and not invented for the talk.
- **Real output only.** Show a refusal code as terminal output only if it was captured from a real or fixture run. The catalog's [gaps](catalog.md#gaps-in-the-evidence) list which codes the reports actually show.

## Open (2 minutes)

### 1. The question

- **On slide:** "How do you trust code you didn't review?"
- **Visual:** black slide, one line.
- **Say:** this is the question everyone asks about unattended AI engineering. If trust means reading every line, the answer is that you can't. This talk is about what else trust can mean.

### 2. The promise

- **On slide:** "Hand it over. Go to bed. Come back to a result you can act on." Two pillars below: Autonomy and Trust.
- **Say:** reliability has two equal parts. A run that finishes by lowering its standard is not reliable, and neither is a sound result that sat waiting for you. Neither is bought at the other's expense.

## Overview (2 minutes)

### 3. The whole night

- **On slide:** the overview diagram: Agree, then a vertical handover line, then Implement, Review with a loop back through Repair, Document, Retrospective, Morning report, Triage. A thin bar underneath the whole diagram: "durable run state".
- **Build:** stages appear left to right. The user icon leaves at the handover line and returns at the morning report.
- **Say:** walk it in about a minute. Agree on what to build; a strong model implements it directly; independent reviewers check it; docs and a retrospective close the run; in the morning you get a report and decide the follow-ups one at a time.

### 4. You've seen this diagram

- **On slide:** the same diagram. The Implement box cycles between model names.
- **Say:** the steps are what any careful team does. The models are interchangeable and there is no special planning stage. If the steps were the answer, any agent loop would earn your trust. The steps are not where trust comes from.

## Inversion (2 minutes)

### 5. Trust lives in the seams

- **On slide:** "A seam is where a claim has to survive a check before work crosses. And the system can say no."
- **Build:** Magic Move from slide 4. The boxes fade to grey, and the gaps between them light up as gates.
- **Say:** "agreed", "reviewed", "done" and "delivered" are all claims. At each seam the claim meets evidence, and when the evidence does not hold, the work does not cross.

### 6. Three kinds of seam

- **On slide:** three labeled groups on the overview:
  - **Authority** (you and the machine): agreement, handover, report delivery. Only your words move them.
  - **Evidence** (step to step): independent review, staleness, finding validation. Evidence is bound to the exact bytes it examined.
  - **Continuity** (session to session): compaction and takeover. Nothing is inherited on trust.
- **Build:** the solid and dashed legend appears last.
- **Say:** be honest early. Most gates are mechanical and one is procedural. The limits section comes back to what that means.

## Zooms (14 minutes)

Each zoom follows the same rhythm: the objection, the mechanism in one picture, one real example, the evidence footer.

### 7. "It'll build the wrong thing" (Agreement)

- **On slide:** "Shall I begin?" / "Yes." Under it: "Only a yes to a plain question counts. The draft reaches you while independent review runs."
- **Visual:** dashed gate.
- **Story:** S1.1. A controller spent about 90 minutes polishing a technical draft before showing the user the short scope, and the user could no longer tell refinements from additions. The report says the later approval "does not prove that earlier additions were agreed". That is why the draft now goes to you immediately, while review runs alongside.
- **Evidence line:** S1.2. After a related bug, acceptance was graded from native event logs, "not the model's prose": project edits appeared only in the turn after the user agreed.
- **Evidence:** S1.1, S1.2; backup S1.3.

### 8. "It'll stall at 2am, or quit early" (Handover)

- **On slide:** five prompt wordings, each struck through, then a hook icon. Headline: "We couldn't prompt our way there, so we built a seam."
- **Story:** S6.1. Across five wordings the model went straight into the work without telling the user they could leave; one model wrote the acknowledgement only in its private reasoning. Now the acknowledgement ends the turn, a verified Stop hook blocks that stop, and the work resumes. When the hooks were not live, the runtime refused to admit the session and the controller told the user not to leave yet.
- **Say:** this seam protects autonomy, but it matters for trust too: a run that quits early and reports "blocked" is not a result you can act on (S6.3 happened for real).
- **Evidence:** S6.1, S6.4; backup S6.3.

### 9. "What if the reviewer hangs?" (Handover, continued)

- **On slide:** a stream of whitespace, a timer, a fallback reviewer. Big number: "8 real firings, 6 finished by the fallback."
- **Story:** S6.2. A reviewer streamed whitespace for 29 minutes. The runtime now ends such an attempt as `output-loop` after two minutes and hands the review to the next permitted reviewer. It has fired eight times in real work.
- **Evidence:** S6.2.

### 10. "Why not just trust the tests?" (Independent review)

- **On slide:** "231 tests passed." Then, on build: "An independent review found 8 more problems. One of them lost data."
- **Story:** S2.4. The independent audit treated earlier accounting as leads, not authority, and found a disk-full failure that cut a file to 6 bytes while every selected test stayed green. Present it as a setup-tooling defect found by an independent audit during triage, not by the review gate.
- **Say:** tests check what someone thought to test. Independence is what finds the rest.
- **Evidence:** S2.4, L1.

### 11. "It's grading its own homework" (Independent review)

- **On slide:** two host lanes. The reviewer sits on the other lane, works in a read-only copy, and returns a receipt stamped with its verified model and session.
- **Story:** S2.1. A reviewer later took over as controller. Its own review was refused, and a fresh independent assessment was required.
- **Evidence:** S2.1, S2.6.

### 12. "What if the good reviewer is unavailable?" (Independent review)

- **On slide:** two strong reviewers greyed out, a weaker one labelled "advisory". The gate stays closed until a strong review arrives.
- **Story:** S2.2, from real work. Neither strong model was available: one allowance was used up and the host refused the other for exceeding its limit. An available weaker review was recorded as advisory only, "deliberately not recorded as the cumulative assessment", and publication waited. In the test campaign, the easier path of self-review was refused as well (S2.3).
- **Evidence:** S2.2, S2.3; backup S2.7.

### 13. "They'll change it after it's approved" (Staleness)

- **On slide:** a review stamp pinned to a file's contents. An edit flips the stamp to STALE and the gate closes.
- **Build:** the edit arrives, the stamp flips, the gate closes.
- **Story:** S3.1. The controller's own documentation work changed files while a spec review was running. The finished review was refused as evidence, and its 125,622 tokens were spent anyway. Paid work was thrown away rather than accept a review of bytes that no longer existed.
- **Evidence:** S3.1.

### 14. "Strict, and it costs" (Staleness, continued)

- **On slide:** "One stray image blocked a finished review." / "Two edits to a report: 17 minutes of reruns."
- **Story:** S3.2 and S3.3. An unrelated image appeared after a review snapshot and the completed review could not be counted. Report-only edits invalidated a 306-test check twice. The same strictness caught the acceptance harness itself trying to use a superseded receipt (S3.4).
- **Say:** the seam errs toward invalidation. That is the right direction for trust, and it has a price that you pay in time, not in correctness.
- **Evidence:** S3.2, S3.3, S3.4.

### 15. "Reviewers hallucinate" (Skeptic)

- **On slide:** big number: "15 of 20 findings refuted." Beneath it: "Every finding gets its own fresh skeptic. Missing evidence stays unresolved."
- **Story:** S4.2. In the largest Codex run, a fresh skeptic checked each finding against evidence; most did not survive, the agreed contract stayed unchanged, and the three real improvements were made and re-reviewed. The earlier version shared one cheap verdict across findings and failed open (S4.11).
- **Say:** the 75% is arithmetic on the report's tallies; say so if asked. Skepticism also corrects false alarms (S4.9).
- **Evidence:** S4.2, S4.11; backup S4.3, S4.7.

### 16. "Fixes break things" (Cumulative re-review)

- **On slide:** the loop: review, skeptic, decide, repair, then back to "review the whole change", not "review the patch".
- **Build:** the re-entry arrow lands on the whole change. Hold it.
- **Say:** after every repair, however small, the reviewer re-examines the complete cumulative change, including sibling code and earlier fixes. The earlier version ran fixed rounds and ended on a literal LGTM (S4.10). Now a repair voids the pass and only a new whole-change review restores it. Tease the case study: "Keep this loop in mind; in a few minutes you'll see it catch something the tests missed."
- **Evidence:** S4.10; backup S4.4, S4.5.

### 17. "It forgets when the context fills up" (Continuity)

- **On slide:** a context meter draining from 215,588 to 17,531 tokens while three open findings stay pinned to the durable-state bar. Second panel: a Codex session goes dark and a Claude session picks up the same run.
- **Story:** S5.2, from real work. The original Codex session became unavailable; a Claude controller adopted the same run under the user's explicit authority, the handover was recorded in the run history, and the work finished and was published. The compaction panel previews the case study (S5.1).
- **Say:** all eight same-host and cross-host takeover combinations were exercised, and live or unknown activity blocks a takeover (S5.3).
- **Evidence:** S5.2, S5.1, S5.3.

### 18. "It'll just say it's done" (Closing)

- **On slide:** the closing gates in order: retrospective, report, triage, complete. Delivery is recorded only from your actual reply.
- **Story:** S7.2. A report admitted that the work had not run the required review, documentation and retrospective workflows, and that catching up later does not count backwards. And S7.3: a controller ended with "The morning report is saved in this session" instead of showing it, and the rule was tightened so the final message is the report itself.
- **Evidence:** S7.2, S7.3; backup S7.4, S7.5.

## Case study: one run (5 minutes)

One slide with builds, or a short Magic Move sequence, on the running example [R](catalog.md#r-running-example-one-run-five-seams). A mini-map lights each seam as the run crosses it. Say once, up front: "This was an acceptance fixture; the interesting parts were not scripted."

### 19. One run, five seams

- **Beat 1, the reviewer hangs (handover, review):** 28,895 deltas, mostly whitespace, in about 15 minutes. The timeout reclaims it, a permitted fallback finishes the review, and the half-finished output claiming completion never counts.
- **Beat 2, compaction (continuity):** three findings open. History drops from 215,588 to 17,531 tokens. Recall is checked against the saved state before any edit.
- **Beat 3, the skeptic and the fix (skeptic):** a fresh skeptic confirms all three and marks two required. The repair lands; 14 tests and the product check suite pass; four new tests fail against the old code, so they are able to catch the bug.
- **Beat 4, the catch (cumulative re-review):** see slide 20.
- **Beat 5, not done (closing):** the budget runs out at revision 34, and the run is left incomplete rather than declared done. It was finished later, and when it closed, the record showed ten findings where the model's own summary said nine. The record won.

### 20. `[10]` became `[15]`

- **On slide:** the regression, large: `forEach` skips empty array slots, so `[10]` becomes `[15]`. Beneath it: "after 14 green tests".
- **Say:** everything was green. The next whole-change review found the regression, independent execution reproduced it, and the gate stayed shut. This is the answer to "fixes break things", in one run.
- **Evidence:** R steps 4 to 5, S4.1.

## Limits (3 minutes)

### 21. What the seams didn't catch

- **On slide:** four short items:
  - After the full lifecycle, a later review still found a bug (L2).
  - A model wrote files before creating the run it was required to create first. Dashed gates are dashed (L3).
  - A budget guard swallowed its own error and the allowance was overrun; the overrun is on record, not rewritten (L4).
  - A host exit can still end an unattended night; other operating systems are unverified (L8).
- **Say:** name the failures before someone asks. The seams make errors discoverable; they do not make the models infallible, and cross-host review does not guarantee independent errors (L9).

### 22. What it costs

- **On slide:** "7.3 million tokens for two tiny handovers." "17 minutes of reruns for two edits to a report."
- **Say:** assurance is expensive and the reports say so; they also decline to convert tokens into money, so don't either. Speed and economy count only where they cost neither autonomy nor trust.
- **Evidence:** L6, S3.3.

### 23. These were not silently passed

- **On slide:** the quote, alone.
- **Say:** every report states what did not run, what stayed qualified and what is still open. That candour is itself a seam: the run cannot claim more than its evidence (S7.6, L7).

## Close (2 minutes)

### 24. The answer

- **On slide:** the overview returns with every seam lit. Headline: "You don't trust the model. You trust the seams."
- **Build:** Magic Move from slide 5, with all gates lit.
- **Say:** return to the question from slide 1. You trust code you didn't review by trusting evidence that had to survive being checked, from a system that tells you plainly when it didn't.

### 25. Questions

## Appendix

Keep these for questions; they are detail, not mechanism.

- **A1. The review lenses.** The four spec and six code dimensions every reviewer considers (`WORKFLOW.md`, "Review dimensions").
- **A2. The acceptance arc.** The 8M to 272M campaign table from the catalog.
- **A3. Before and after.** v2's digest gate, fixed review rounds and fail-open judge against v3 (S1.6, S4.10, S4.11, S5.8).
- **A4. Headline numbers.** The catalog's [headline numbers](catalog.md#headline-numbers) table.
- **A5. Model assignment.** Strong interchangeable models, cross-host reviewer placement and the strong review gate.
- **A6. Refusal codes.** The runtime's named refusals, labelled as documented behavior unless captured output exists.

## Cuts for 20 minutes

- Drop slide 9 and mention the `output-loop` detector in the case study's first beat.
- Merge slides 11 and 12 into one independence slide.
- Drop slide 14, keeping its cost line for slide 22.
- Drop slide 22 and keep one cost line on slide 21.
- Run the case study as slide 20 alone, narrating the earlier beats over it.

## Decisions for you

- **Audience and length:** the timings above assume a technical audience and 30 minutes.
- **Model names:** whether to name Fable, Astra and Opus, or say "two strong models on two hosts".
- **Captured refusals:** whether to capture real refusal output from a fixture run for the staleness and closing slides; the reports describe those refusals without printing them.
- **Candour:** the limits section uses Nightshift's own failures. Keep all four items or trim.
