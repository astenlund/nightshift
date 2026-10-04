# Features

Upcoming work and deferred extensions to the delivered v3 MVP. Its delivery is recorded in [FEATURES_HISTORY.md](FEATURES_HISTORY.md). The original v2 proposals and their agreed dispositions are preserved in [MIGRATION_STATUS.md](MIGRATION_STATUS.md) and [the historical index](migration/v2/FEATURES.md). Readiness is not implementation authority.

## Current work

### [Whole-backlog coherence audit](features/backlog-coherence-audit.md)

A whole-backlog mode of `revise-docs` that walks every active index, breakout and pattern file and checks that relationships between entries, excerpts against their records, and claims about the current code still hold. Every finding gets fresh skeptic validation; the audit repairs when attended and writes an inbox report for later triage when unattended. Raised and settled by the user on 2026-09-25; the MVP is manual only.

**Slices:**

- **MVP - manual audit.** The user triggers the audit explicitly.
- **Scheduled trigger.** A scheduled run aborts unless a commit has landed since the last audited commit; where it executes, where its report lands and where the last audited commit is recorded remain open.
  **External:** User decision on where scheduled audits execute, where their report lands and where the last audited commit is recorded.

**Requires:** none.

### [Separate run-time guidance from reference material](features/runtime-guidance-separation.md)

Keep what agents follow during a run in instruction files, separate from reference material that only informs design. The operating brief stays run-time guidance; the operating passages of both REFERENCE files move to a run-time operations guide the skills link to, and the REFERENCE files remain as design references that no run loads. Implementation starts with a one-for-one inventory of directing sentences, verified by independent review. Raised and settled by the user on 2026-09-25; it needs a concise governing spec and an evidence decision before implementation.

**Requires:** none.

### [Verify faked boundaries live](features/live-boundary-verification.md)

Have the operating brief ask for a change that crosses a boundary the deterministic tests fake (processes, host or shell, filesystem, credentials, network, model behavior) to be exercised in the real environment once those tests pass, with verification reports stating what stayed test-only as a limit. Settle the live-evidence allowance at handover, carrying the two budget quick wins this entry absorbed with their original terms. Raised by the user on 2026-09-26 after most recent live-found defects turned out not to be model-owned but to sit where the deterministic tests use stand-ins or never reach; the direction is proposed, not agreed, and it needs a concise governing spec and an evidence decision before implementation. A passive half, proposed by the controller on 2026-09-28, marks fixes or behavior changes shipped without installed-host evidence and has each session retrospective record, per host, any such marker the run exercised. On 2026-10-01 the user folded in v2's live-claim marker protocol for specs, which the v3 change removed without a disposition naming it. On 2026-10-03 the triage of the user's global spec-writing rules routed two live-claim clauses here: a recorded probe covers each distinct context or marks the rest provisional, and each model-owned branch gets its own per-host claim rather than a representative probe.

**Requires:** none.

### [Reproduce a bug with a failing check before repairing it](features/reproduce-before-repair.md)

Have the operating brief ask the controller, for defect work, to run a check that reproduces the failure before the repair, confirm it fails for the defect's reason, and rerun it under the same name after the repair, and have its Tests and evidence code dimension ask whether a fix carries that pair. This is guidance only: the existing check evidence already keeps both runs and gates acceptance on the latest, so the runtime stays unchanged. The agreed scope identifies defect work, and for a defect without a practical automated reproduction the controller is to record why and what evidence stands in, reported as a verification limit. From the user's 2026-09-26 ideas document; the commitments were agreed with the user on 2026-09-28 and are recorded in the linked record. It changes model-owned behavior, so it needs a version increase and a decision on installed-host evidence before implementation.

**Requires:** none.

### [Run-free revise](features/run-free-revise.md)

Let revise-code, revise-spec, revise-docs and revise-lore run without creating a runtime run when invoked on their own, while inside an active run they keep using its tasks. Runs stay with agreed implementation delivery: the attended run a project lifecycle requirement starts, and a handed-over run. Make the review operations usable without a run through a lightweight review record holding receipts, skeptic verdicts, dispositions and repairs, with no controller claim, continuation, closing stages or completion gate, so isolated read-only review copies, cross-host dispatch and attributed receipts are kept; a run-free invocation lists its follow-ups in its final message. Raised and agreed by the user on 2026-09-28 after a standalone revise-docs pass created run `a0eaaee7-6c97-4261-960d-346c6a4654aa`, which then needed a retrospective and triage to close. It changes the skill and runtime text that ties standalone revision to a run, and its spec settles how that relates to the v3 decision on shared machinery, so it needs a concise governing spec, a version increase and a decision on installed-host evidence before implementation. On 2026-10-01 the user added scope selection (staged, unstaged, a commit range or an older range as a patch), which the v3 change removed from revise-code without a disposition naming it.

**Requires:** none.

### [Project inboxes](features/project-inboxes.md)

Give every project that uses Nightshift a `.nightshift/inbox/` for raw suggestions and reports about that project, owned by the report's subject. Setup is to create an inbox when absent and leave an existing inbox's contents and choice unchanged; since 2026-10-04, instead of ignoring every inbox by default, setup asks a separate track, ignore or defer question for it, owned by [Restore fresh-scaffold track, ignore or defer choice](features/setup-tracking-choice.md), and writes nothing without an answer. Reports are to be dated Markdown files that never overwrite each other and leave design to triage. During a run, observations about the run's own project stay follow-ups, while those about another Nightshift project whose location is known go to its inbox and are named in the run's report. Ready is to list untriaged reports in their own section, omitted when the inbox is empty or absent, and triage runs only at the user's request, deleting each report once its disposition is recorded. Reports about Nightshift itself go to the Nightshift project's own inbox, located through the maintainer's instructions. Requested by the user on 2026-09-13; the commitments were agreed with the user on 2026-09-28 and are recorded in the linked record. It reverses the v3 decision that setup creates no inbox in other projects, so it needs a concise governing spec, a version increase and a decision on installed-host evidence before implementation. On 2026-10-02 the user's idea that ideas raised mid-run go to the inbox instead reopened its run and follow-up commitment as an open question in the record; the user's refinement routes adjustments within the run's agreed outcome to follow-ups, and to the inbox anything that would extend it, including a related new slice, or is unrelated.

**Requires:** none.

### [Degraded assessment mode](features/degraded-assessment-mode.md)

Let a weaker model carry an independent assessment when no supported strong model can take a reviewer role, or when the user explicitly selects one, using the strongest permitted model available and never overriding an explicit model requirement; attended, the controller asks first, a question that, as agreed on 2026-10-03, also offers to widen the user's strong list instead once the model policy file has shipped, and unattended, it proceeds on recorded unavailability evidence. A degraded assessment covers lead review, skeptic validation and reassessment, is recorded like any other so tasks can advance past review, and is labeled as degraded in the review gate, status, obligation brief and reports, with no gate treating it as strong. The run cannot complete, and nothing is published, until a supported strong assessment covers the same content, reviewing the whole change fresh; unrecorded advisory feedback still never counts. Raised by the user during the automatic-preparation run, which was the live case: both admissible reviewers were unavailable at once and the lifecycle had no recordable fallback. It absorbs the earlier opus-review-gate follow-up; the commitments were agreed with the user on 2026-09-29 and are recorded in the linked record. It reverses the governing rule that no task advances past review without a strong assessment, so it needs a concise governing spec, a version increase and a decision on installed-host evidence before implementation.

**Requires:** none.

### [Background review and assessment of selected work](features/selection-review-and-assessment.md)

When a readback or spec that asks whether to begin implementation is presented, dispatch background agents at once, two in the agreed starting design, each on the strongest model available and preferring the other host: an independent review agent, which a plain readback does not get today, and a separate assessment agent that gives short, prioritized feedback on the selected work with suggested tweaks, as advice rather than a gate and without the controller's reasoning. The background work is also to check the selected entries' settled decisions against the current code and work landed since and suggest which to revisit; on 2026-10-03 the user left how that work is split and how many agents run to the governing spec, and asked that the agents' prompts keep them from running too long. The draft is shown without waiting; the user may say yes before the results arrive, but implementation and handover acceptance wait until the background results have been presented and any tweaks the user wants are settled. A draft presented again after a change the user requested gets fresh background work, as amended on 2026-10-04. Raised by the user on 2026-09-29 so that the user gets the model's feedback before work starts, even on an entry written without any AI input; the commitments were agreed with the user on 2026-09-29 and are recorded in the linked record. It changes the agreement rules, the Ready selection path and the handover acceptance condition, so it needs a concise governing spec, a version increase and a decision on installed-host evidence before implementation.

**Requires:** none.

### [Keep a handed-over run open for triage after delivery](features/handover-open-for-triage.md)

After delivery a handed-over run is to stay open rather than closed, with the Stop hook no longer resisting a yield, so follow-up triage, its tracking edits, their rerun checks and their closing docs review happen in the running run under the normal gates, and the run completes after them. Today it completes with follow-ups pending, triage evidence cannot be recorded afterwards, and tracking edits after completion are reviewed only as bookkeeping. Raised by the user on 2026-09-30 in run `f440497c-a0cc-4375-bada-e834e32b49a6`, where the user settled that direction. Follow-on work the user agrees at the report or during triage is to join the open run as a new task, added at triage on 2026-10-03 after such a change needed a new run that left the previous run's pending follow-ups unresolvable. Which boundary counts as delivery, how an added task returns the run to engineering, how a native persistent goal is released, the guidance that assumes completion before triage, interaction with `overlapping-run` and interrupted-run pickup, and a defined end for runs never triaged remain open, so it needs a concise governing spec, a version increase and a decision on installed-host evidence before implementation.

**Requires:** none.

### [Choose how agreed work proceeds](features/agreed-work-choice.md)

Have Ready end with a three-choice question, through the host's native question tool where available: hand over, implement without creating a runtime run, or pause with the agreed task kept ready for discussion. Raised by the user on 2026-09-30 in run `7969bab6-360c-4bd5-a5bd-33dfe3ef28d9`, who now always hands over and first asked for unattended as the standard mode, then settled on this choice. It reverses the Ready rule against asking about handover. Where the question is asked (the user suggested it could be a separate step after the readback is acknowledged), whether an attended run with the full lifecycle stays a choice, what pause keeps, how implementing without a run is reported and offered, and the unverified-continuation case remain open, so it needs a concise governing spec, a version increase and a decision on installed-host evidence before implementation.

**Requires:** none.

### [Keep every affected surface when merging findings](features/finding-affected-surfaces.md)

When one finding covers a problem that appears in several places, keep every affected surface and its evidence, as the v3 migration agreed for consolidating findings: the reviewer's finding schema gains a structured list of affected surfaces, each with its location and evidence, and the skeptic addresses every listed surface, splitting off or marking unverified any it cannot confirm. The same rule covers a lead merging its peers' findings once peer dispatch exists, without depending on it. Found on 2026-09-29 by the migration accounting audit; the commitments were agreed with the user on 2026-09-30 and are recorded in the linked record. It changes the runtime's finding schema and the reviewer and skeptic prompts, so it needs a concise governing spec, a version increase and a decision on installed-host evidence before implementation.

**Requires:** none.

### [Repairs start from current contents and respect helper ownership](features/repair-current-contents.md)

Direct every repair, by the controller or a helper, to start from the current contents and keep earlier repairs' constraints, and state that the controller routes a fix to a helper-owned artifact through that helper. The controller gives each repair assignment the earlier resolved findings and repairs on the same artifact from the run's recorded state, and the operating brief states the rules; the runtime stays unchanged, with no file lease or per-fix record format. Found on 2026-09-29 by the migration accounting audit; the commitments were agreed with the user on 2026-09-30 and are recorded in the linked record. It changes model-owned behavior, so it needs a version increase and a decision on installed-host evidence before implementation.

**Requires:** none.

### [Ground Ready recommendations in the project's direction](features/ready-project-direction.md)

Have Ready use the project's durable direction to explain its recommendations and their tradeoffs, as the v3 migration agreed, reading the documents that the project's instruction files or backlog indexes name as its direction, and the BACKLOG.md meta-index if it ships, with no filename convention and no new registry; when it finds no direction source, Ready recommends on the invariant priorities alone and says so. It stays independent of size-aware recommendations. Found on 2026-09-29 by the migration accounting audit; the commitments were agreed with the user on 2026-09-30 and are recorded in the linked record. It changes the Ready skill's model-owned behavior, so it needs a version increase and a decision on installed-host evidence before implementation.

**Requires:** none.

### [Dispatch reviewer peers and return their evidence to the lead](features/reviewer-peer-dispatch.md)

Make the agreed peer staffing executable: a lead that needs peers says so by returning `incomplete` with the peer coverage it needs, the controller dispatches bounded peer assignments of the lead's model and effort on either host, and their evidence returns to the same lead, resumed, which keeps the integrated assessment; peer coverage counts only through that assessment. Found on 2026-09-29 by the migration accounting audit; the commitments were agreed with the user on 2026-10-01 and are recorded in the linked record. Returning evidence to the same lead resumes it through the reviewer resumption delivered in the local 3.3.0 candidate, and the change adds runtime dispatch and changes the review prompts, so it needs a concise governing spec, a version increase and a decision on installed-host evidence for each host before implementation.

**Requires:** none.

### [Show review progress without being asked](features/visible-revise-progress.md)

Keep review and repair progress visible without a user request, as the v3 migration agreed: after each validated review result and each repair batch, a short text update says what review established, what was repaired, what remains and why another pass is needed, with recurring problems visible through continuation and in the final report. Each update also gives the pass's token usage as uncached input, cache reads, cache writes and output, with a running total, which needs the runtime to record those categories for each attempt instead of one total; a figure it lacks shows as unknown, never zero. Since 2026-10-04 updates state observable facts only, never guessed percentages or completion estimates. Showing progress graphically is left to the [Graphical run view](features/run-graph-view.md). Found on 2026-09-29 by the migration accounting audit: the brief never contained the visible-progress rule that the migration reconciliation relied on. The commitments were agreed with the user on 2026-10-03 and are recorded in the linked record. It changes the runtime, the operating brief and the revise skills, so it needs a version increase and a decision on installed-host evidence before implementation.

**Requires:** none.

### [Check currency and external dependencies](features/check-external-dependencies.md)

State the agreed limit that a matching content digest does not show unchanged external dependencies, so a check does not stay current across a changed toolchain or environment: the runtime reference and the operating brief say that a current check shows only that its listed project inputs match what passed, and the controller reruns the affected checks after a change it makes or learns of outside the project, such as a Node or host CLI update, a global package or an environment variable the check reads. The runtime keeps judging currency by project inputs alone; recording or invalidating by external dependencies is a deliberate non-goal until a stale pass is observed. Found on 2026-09-29 by the migration accounting audit: a check stays current on its project-file digests alone, and nothing states the limit or asks for a rerun after an outside change. The commitments were agreed with the user on 2026-10-03 and are recorded in the linked record. It changes shipped guidance with model-owned behavior, so it needs a version increase and a decision on installed-host evidence before implementation.

**Requires:** none.

### [Explain for a capable user who may not know the codebase](features/capable-user-explanations.md)

Give a technically capable user who may not know the codebase concise, precise explanations of behavior, architecture, tradeoffs and risk in plain words, with the evidence needed to decide and without default source exposition, as the v3 migration agreed: the rule is stated once in the operating brief, with one pointing sentence in Ready, Exploring and init-backlog, a message that asks for a decision makes sense without its links, and follow-ups the agent turns up before a run are put to the user rather than dropped or filed. Found on 2026-09-29 by the migration accounting audit: no instruction states that audience or altitude, and decision context is asked for only in specific decisions such as follow-up triage, blocked-decision questions, the morning report and instruction proposals. The commitments were agreed with the user on 2026-10-03 and are recorded in the linked record. It changes shipped guidance with model-owned behavior, so it needs a version increase and a decision on installed-host evidence before implementation.

**Requires:** none.

### [Run the full test suite before delivery](features/full-suite-before-delivery.md)

Before a run that changed more than documentation or the backlog delivers, attended or handed over, run the project's full test suite once after the last review and repair round, as the explicit ask that a user's rule against unrequested full-suite runs needs, and as v2's handover did before its morning report. The command comes from the project's instructions or CI configuration and is named in the agreement before work starts; a run that finds none says so and reports the suite as not run. A suite that does not finish counts as a failure; a failure the run caused is repaired and the suite rerun, and any other failure stops the run for the user instead of becoming a follow-up. Found on 2026-10-01 by the audit of capabilities v2 lost without a disposition. The commitments were agreed with the user on 2026-10-03 and are recorded in the linked record. It changes shipped guidance with model-owned behavior, so it needs a version increase and a decision on installed-host evidence before implementation.

**Requires:** none.

### [Name durability and evidence in the reliability priority](features/reliability-parts.md)

Decide whether durability (durable records) and evidence (skeptic-validated findings, recorded checks) join autonomy and trust as named parts of the reliability priority, or are the means by which trust is earned, and whether trust and reliability are too adjacent to each other. Raised by the user on 2026-09-30. At graduation on 2026-10-03 the user agreed a loose leaning, recorded in the linked record, to be revisited with them when the work is picked up: durability and evidence are the means by which both parts are achieved, not new parts, both names stay, and only the vision and the operating brief's priorities sentence change. A change to the brief needs a code assessment and a version increase.

**Requires:** none.

### [Retrospective routing by audience and instruction precedence](features/revise-lore-audience-routing.md)

Have revise-lore route lessons by who the user is: a Nightshift maintainer to the Nightshift backlog or inbox, a regular user to the global or project-local instruction files, and let global and project instructions take precedence over plugin instructions when they conflict. Revise-lore follows the instructions rather than guessing: a destination the user's or project's instructions name comes first, then Nightshift's own backlog when the project is its source, and otherwise lessons about Nightshift reach a regular user as a report they can send upstream. Where precedence means a Nightshift requirement does not happen, the report says so; a requirement the runtime enforces is not worked around but put to the user. Since 2026-10-04 the retrospective also proposes recording consequential context facts the user supplied, so later sessions need not ask again. Raised by the user on 2026-09-27; the commitments were agreed with the user on 2026-10-03 and are recorded in the linked record. It changes the operating brief, revise-lore and three public skills, so it needs a version increase and a decision on installed-host evidence before implementation.

**Requires:** none.

### [Make Ready and Exploring links open at their target](features/source-link-targets.md)

Have Ready and Exploring write local links with absolute targets, which open when clicked in Claude Code's terminal UI where relative ones do not, and link an entry held in an index at that entry's line through `NIGHTSHIFT_LINE_LINK_FORMAT`, the user's `subl://` protocol form set up for Nightshift v2 and confirmed working on 2026-09-30. v3 dropped line links with the spec-agreement skill, their only consumer, when it replaced the agreement digest's presentation, and no migration disposition names them; links with a `:207` or `#L207` suffix do not open at all. Moved from the quick wins on 2026-09-30. The commitments agreed with the user on 2026-10-03, recorded in the linked record, have the parser give every returned item its file's absolute path, its line and a finished link target, built from the variable when it is set and the plain absolute path otherwise, which the skills copy; Codex handling stays unverified until tested there, the README gains an optional note on the variable, and clicking is checked by hand. It changes the parser's output, its fixtures and both skills, so it needs a version increase and a decision on installed-host evidence before implementation.

**Requires:** none.

### [Ready offers to pick up an interrupted run](features/ready-interrupted-run-pickup.md)

When a new session opens in a project with a stopped run, or a running one whose controlling session has ended, Ready tells the user about the unfinished work and offers to pick it up through the existing adoption, after which everything behaves as in the original session, with no pointing at report files. Raised by the user on 2026-09-19. The commitments agreed with the user on 2026-10-03, recorded in the linked record: Ready reads the run state read-only, whatever release the run is bound to, coordinating with the quick win on bound status refusing other-release runs; it offers no pickup while the run or its workers may still be active, and never a replacement run; the notice lives only in Ready; and a delivered run kept open for triage, once [Keep a handed-over run open for triage after delivery](features/handover-open-for-triage.md) ships, is presented as waiting for triage, not as interrupted. It needs a concise governing spec, a version increase and a decision on installed-host evidence before implementation.

**Requires:** none.

### [Size-aware Ready recommendations](features/ready-sized-recommendations.md)

Besides the few high-value entries Ready recommends today, also recommend one or two smaller entries for a quick session and a larger entry, or a group of entries, sized for a longer session. Raised by the user on 2026-09-29, who settled that size is the model's rough judgment from what it reads; on 2026-10-03 the user agreed the remaining commitments, recorded in the linked record: the picks are sizes only, with no tie to handover; a group is one the model judges can be built and reviewed together, is listed by its ready-set numbers and suggests an order; a pick notes an entry that still needs a spec; and a size with no fitting candidate gets one line instead of a pick. It changes the Ready skill's model-owned recommendations, so it needs a version increase and a decision on installed-host evidence before implementation.

**Requires:** none.

### [User-configurable model policy file](features/model-policy-file.md)

Move the supported strong-model list, today a constant in the runtime's review module, into a file the user can edit, which can also hold a general allow list, a deny list, or both. Raised by the user on 2026-09-29 while graduating [Degraded assessment mode](features/degraded-assessment-mode.md). The commitments agreed with the user on 2026-10-03, recorded in the linked record: one user-wide JSON file in the Nightshift store, covering both hosts, records additions to and removals from the shipped defaults; a project's file may only narrow it; a malformed file refuses new dispatches rather than falling back; the lists govern every dispatched or registered model, with the deny list winning and a clash with an explicit user requirement put to the user; and receipts record the policy in force. The user added an escape hatch the same day: when no strong model can be used and the user is present, Nightshift offers to add a model they can use to their strong list, after explaining that this lowers the review bar for all future work, and that model's reviews are then strong rather than degraded. It changes runtime behavior that governs the review gate, so it needs a concise governing spec, a version increase and a decision on installed-host evidence before implementation.

**Requires:** none.

### [Initial reviewer selection](features/initial-reviewer-selection.md)

Policy for the initial spec/code lead: a model on the strong list, Fable or Astra today, prefer the other host, preserve the author or implementer effort floor, and use hard when effort is unknown. Strong same-host fallback takes precedence over a weaker cross-host reviewer. Settled with the user on 2026-10-03 and recorded in the linked record: it is enforced as guidance backed by the runtime's existing strong-model checks, with no new gate; when no strong reviewer is available and the user is present, the user chooses between widening the strong list through the model policy file's escape hatch, a labeled degraded review and waiting, each of the first two offered only once its feature has shipped, and the review gate stays pending only when degraded mode does not start. It changes the operating brief's model-owned guidance, so it needs a version increase and a decision on installed-host evidence before implementation.

**Requires:** none.

### [Review retrospective instruction proposals like any other change](features/lore-proposal-review-gate.md)

Apply the common strong review, skeptic validation and disposition process, with cumulative reassessment after each revision, to the instruction proposals a session retrospective makes, as the v3 migration agreed. Found on 2026-09-29 by the migration accounting audit: revise-lore asks only for a fresh independent reviewer, nothing gates proposals made in a lifecycle retrospective, and a standalone lore task without an assessment completes directly. The commitments agreed with the user on 2026-10-03, recorded in the linked record: a lifecycle retrospective with a worthwhile proposal adds a lore task for it, whose assessment then gates task and run completion, through an add-task operation shared with [Keep a handed-over run open for triage after delivery](features/handover-open-for-triage.md); standalone revise-lore keeps a lore task until [Run-free revise](features/run-free-revise.md) supplies its review record; and degraded mode applies as to any assessment. It changes the runtime, revise-lore and the operating brief, so it needs a concise governing spec, a version increase and a decision on installed-host evidence before implementation.

**Requires:** none.

### [Proportionate review of tracking edits](features/tracking-review-cost.md)

Find proportionate ways to review backlog tracking edits after triage, keeping the review strong and independent without repeated full rounds over minor prose. Observed on 2026-09-30 in run `7969bab6-360c-4bd5-a5bd-33dfe3ef28d9`, where six closing docs reviews and five skeptics of about a hundred lines of tracking prose cost 13,599,797 reported tokens against 5,103,757 for the delivery's review dispatches, every finding minor. Unchecked claims drew findings, evidence outside the snapshot left a round incomplete, and routing notices raised as findings and output-loop fallbacks added cost to rounds. The commitments agreed with the user on 2026-10-03, recorded in the linked record: changed operating-instruction files go in a separate field of the docs report, needing no skeptic when a current code assessment covers them; claims about run records get a generated evidence record, one mechanism shared with the evidence-digest quick win and built by whichever ships first; and a closing review's scope is the tracking edits since triage, with the delivered change as reference only. It changes the runtime's review brief, report schema and closing review, so it needs a concise governing spec, a version increase and a decision on installed-host evidence before implementation.

**Requires:** none.

### [Make resumed reviewers actually cheap](features/resumed-reviewer-cost.md)

Measure what a resumed reviewer costs on each host, find why runtime resumes start without a cache hit, and make resumes cheap without losing the continuity they exist for. Found on 2026-10-02 in run `61461833-3c7e-4449-8282-67b3df7dd564`, where resumes were not reliably cheaper than fresh reviews and started without a cache hit on both hosts. On 2026-10-03 a dual review outside the runtime showed that Codex resumes can start with a cache hit, that a long-lived resumed reviewer's growing context still costs on Codex, which bills cached input at a tenth of uncached, and, in two trials of compacting the thread before a resume, that the compacted rounds read fewer input tokens and used fewer estimated credits than earlier rounds that are not comparable, while with the compaction's own cost unreported and more of their input uncached, a saving overall is not established; the second time the compaction ran in the background during the repairs without adding any wait. Moved from the quick wins on 2026-10-03 at the user's direction. Runtime and guidance changes ship with a version increase. Tracking does not authorize implementation.

**Requires:** none.

### [Dual strong review for critical work](features/dual-strong-review.md)

An extra strong review mode for critical work: two strong reviewers assess the same change independently, preferably from different suppliers when both are available, and the controller waits for both reviews before making repairs, while skeptics start validating each review's findings as soon as it arrives. Raised by the user on 2026-10-03, who settled the same day that two reviewers of the same model are an acceptable fallback without a second supplier, and that the controller merges the two results into one set of findings before any repair; the gate passes only when both reviewers come back clean, any repair sends both into a new round, and each side ends with a clean fresh-context assessment of its own. The commitments agreed with the user on 2026-10-04, recorded in the linked record: the user decides at agreement whether work gets the mode, which the controller may propose in the readback with its reason and which is never on by default, so the user accepts the roughly doubled review cost each time; a handed-over run keeps the agreed mode, with the controller recording any recommendation for it in the morning report; and when the work starts the user decides whether to enable it for all Nightshift work through the project-local AGENTS.md. Its gate needs two assessments where the runtime's reads one, so it needs a concise governing spec, a version increase and a decision on installed-host evidence before implementation.

**Requires:** none.

### [Related field for non-dependency relations](features/related-field.md)

Add an optional `**Related:**` field that declares relations between backlog entries that are not dependencies, such as shared work built by whichever ships first or a feature that offers more once another ships, so prose no longer has to carry them ambiguously. Raised by the user on 2026-10-03 after a review found three records whose mutual references could not be declared as `**Requires:**` without a cycle; the user settled that every Related relation is declared on both entries and that Related relations may form cycles. The commitments agreed with the user on 2026-10-04, recorded in the linked record: the field mirrors the `**Requires:**` grammar with whole-entry links only, no `none.` form and no note per reference, and sits after the dependency lines; it may appear on tracked entries in all three work indexes, quick wins included, but not on Exploring drafts; the parser checks that each reference resolves and has its counterpart, reporting problems as notices so a Related line never takes an entry out of the ready set; shipping or retiring an entry removes Related references to it; Ready names an item's related entries beside a recommendation or a pickup; and the implementing work sweeps the whole backlog and fills in every missing Related line. It changes the parser and the init-backlog templates, so it ships with a version increase; an agreed readback is enough.

**Requires:** none.

### [Restore fresh-scaffold track, ignore or defer choice](features/setup-tracking-choice.md)

Restore the fresh-project setup choice to track the backlog in Git, ignore it, or defer the decision. Preserve existing tracking and ignore policy on reruns. This restores a previously shipped setup capability. The commitments agreed with the user on 2026-10-04, recorded in the linked record: Nightshift ignores content only through self-ignoring folders, whose own `.gitignore` contains `*` and is never committed, and adds no rule to the project's `.gitignore` or `.git/info/exclude`, so run records ignore themselves too and the separate shared-or-clone-local choice was retired; one choice covers the backlog under `.nightshift/` and is asked only while none of it is tracked or ignored by any rule, with an existing or mixed state reported with its sources and left unchanged; track stages the files without committing, ignore writes a self-ignoring `.nightshift/.gitignore` that leaves the inbox to its own answer, and defer writes nothing, so the Git state itself shows the choice to later runs; an unanswered question counts as defer; a non-Git folder gets no question and a failed Git check writes nothing; and the inbox gets its own track, ignore or defer question, recorded by its own `.gitignore` and also deferred without an answer, which replaces the ignored-by-default decision of [Project inboxes](features/project-inboxes.md). It changes setup and the init-backlog skill, so it needs a concise governing spec, a version increase and a decision on installed-host evidence before implementation.

**Requires:** none.

### [Restore controlled mixed-line-ending repair](features/v3-mixed-ending-repair.md)

Restore inspected normalization of mixed LF/CRLF endings on the controlled backlog surface, using the effective project convention and preserving recoverability. The commitments agreed with the user on 2026-10-04, recorded in the linked record: the repair covers the backlog files Ready and unwrap read, and only files that actually mix endings; Ready reports each such file as a notice; unwrap repairs it in the same recoverable write as its hard-wrap joins; the target ending is the one Git would write on checkout, otherwise the file's majority, with a tie put to the user or, with no user, left unchanged; and only line terminators change, with invalid encodings and stray carriage returns reported but never repaired. It changes Ready and unwrap, so it ships with a version increase; an agreed readback is enough.

**Requires:** none.

### [Complete release-gate history diagnostics and checkout verification](features/v3-release-gate-diagnostics.md)

Finish the retained release-gate follow-ups for stale-branch versus genuine version decreases and robust verification of required checkout depth. Preserve current release policy and avoid reviving obsolete assertion shapes. The commitments agreed with the user on 2026-10-04, recorded in the linked record: pass/fail stays as it is and only the diagnostics change; when the baseline is not an ancestor of HEAD, a failure leads with a stale-branch note naming the merge base, and only a version lower than the merge base's, or a decrease from an ancestor baseline, is reported as genuine; and the CI path confirms the baseline commit is present before comparing and names the checkout's fetch depth when it is missing, replacing v2's pinned workflow lines. It is repository tooling outside the shipped plugin, so it needs no version increase; an agreed readback is enough.

**Requires:** none.

### [Model knowledge base](features/model-knowledge-base.md)

Keep a user-editable knowledge base where both Nightshift and the user record observations about models, such as strengths, weaknesses, cost and availability, and consult it when making model choices, within what the model policy file permits. Raised by the user on 2026-10-03 while graduating that policy file. Today the operating brief carries fixed model observations that only a release changes. The commitments agreed with the user on 2026-10-04, recorded in the linked record, replacing the earlier answer that a user's file is the only source: the brief's observations move into a shipped defaults file that is always read, and each project gets `.nightshift/MODELS.md`, which init-backlog and Ready create when missing with commented-out examples copied from the defaults and which follows the backlog's track or ignore answer; a user's claim that contradicts a default wins where both cover the same version or either is unversioned; a claim naming an exact identifier or a family and version, such as "Fable 5.1", is version-specific and weighs most for that version, an unversioned claim next and a claim about another version least; the retrospective proposes dated, sourced entries that land only with the user's yes; and every model choice reads the entries for the permitted models and cites those that influenced it. It changes the operating brief, revise-lore, init-backlog and Ready, so it needs a concise governing spec, a version increase and a decision on installed-host evidence before implementation.

**Requires:** none.

### [Recover review report formatting without repeating the assessment](features/v3-review-result-recovery.md)

Complete the retained minimal-report contract with narrow correction or clarification of malformed results, preserving original substantive findings, attribution and evidence instead of automatically repeating the full review. Today a completed review whose report fails validation is discarded and the next candidate starts a fresh assessment. The commitments agreed with the user on 2026-10-05, recorded in the linked record: the runtime resumes the reviewer's own session once to re-emit the report in valid form; form faults are corrected by re-emitting, an evidence gap only by downgrading the report to incomplete, never by adding coverage evidence, and a skeptic's unevaluated finding, a session or termination failure and changed inputs keep today's handling; the receipt records the correction and keeps the original output; and a failed correction falls back to the next candidate as today. It changes the runtime's review dispatch, so it needs a concise governing spec, a version increase and a decision on installed-host evidence before implementation.

**Requires:** none.

### [Complete the spec-review safeguard and authoring guidance](features/spec-review-safeguard.md)

Have a spec finding justify demanded detail by naming the consequential gap, contradiction or defect in the spec's commitments or approach, have spec review challenge unnecessary complexity and whether a simpler approach would serve, and have specs record important tradeoffs. Found on 2026-09-29 by the migration accounting audit: four retained needs recorded as Policy present are carried only in part, since the reviewer prompt and the brief bar unnecessary prescription and check feasibility but ask for none of these. The triage of the design-spec rules in the user's global instructions on 2026-10-03 adds repair-time guidance: one principle that a repair carries through everything it touches and removes nothing the artifact needs, applied where the runtime already separates repair proposals and continued reviews from first reviews. The section-level audit's triage on 2026-10-04 adds three authoring habits, checking restated text against its source, applying one contract across sibling surfaces and recording in the spec why review-added machinery exists. The commitments agreed with the user on 2026-10-05, recorded in the linked record: each clause has one canonical home, the safeguard in the spec lens text, the authoring habits and tradeoff clause in the operating brief, and the repair principle in the skeptic's repair-proposal prompt and the continued lead's brief; the challenge to complexity and the approach belongs to a first review or a changed approach and must name a concrete simpler alternative; the fresh lead after repairs checks the same principle against the cumulative repair delta; the `repair` operation takes an optional fixer's note that informs reviewers without determining coverage; the principle applies to code, documentation and spec reviews alike; and the operating brief gains one coordinated repair statement. It changes the runtime's review text and repair operation, the operating brief and revise-spec, so it needs a concise governing spec, a version increase and a decision on installed-host evidence before implementation.

**Requires:** none.

### [Complete shared backlog parsing and template consistency](features/v3-parser-consistency.md)

Complete shared dependency metadata and continuation handling across Ready, setup and unwrap, preserving justified grammar differences and protected content. This includes one shared backlog file vocabulary and reconciled link-target filters, which the migration accounting audit of 2026-09-29 found still duplicated and divergent. The commitments agreed with the user on 2026-10-05, recorded in the linked record: each remaining scanner difference is pinned by a fixture first, then unified where consumers read the same syntax or kept with a one-line reason, with defects split into their own bug entries and no change to dependency meaning; `BACKLOG_FILES` in the shared catalog becomes the only file vocabulary; Ready and the link notices share the stricter link-target filter; and Ready parses each entry's metadata once. It is best shipped before the Related field, the mixed-ending repair and the quick-win dependency-line bug, as ordering advice rather than a dependency. It changes shipped parser and setup code, so it ships with a version increase; an agreed readback is enough.

**Requires:** none.

## Exploring

### [Shared BACKLOG.md meta-index](features/backlog-meta-index.md)

Introduce one BACKLOG.md meta-index linking the four backlog indexes and holding their shared instructions to avoid repetition. Include it in every hook that consumes those indexes. Settle its location, instruction ownership and migration of existing guidance before implementation.

### [Restore setup guidance discovery and instruction routing](features/v3-guidance-routing.md)

Restore canonical instruction-source discovery and approved backlog guidance updates on both hosts, with bounded traversal and explicit handling of conflicting or missing sources. The migration accounting audit of 2026-09-29 added the retained precedence, host-context, gap and exclusion rules for discovery, and, for revise-docs and revise-lore, editing the durable source behind a project adapter and asking when a destination is unclear; the section-level audit of 2026-10-04 added that the same repository state yields the same discovery result. Include the reported migration that left literal root instruction references unchanged after moving backlog files. The v3 setup currently relocates files and scaffolds indexes but does not expose the earlier guidance-resolution flow.

### [Restore customized backlog and legacy-guidance repair](features/v3-setup-compatibility.md)

Restore scoped proposals and approved repairs for customized backlog content and legacy guidance. Preserve user content, identify ambiguity and keep the repair boundary explicit. Include compact inline conversion of simple lettered lists while preserving hierarchy when items contain nested content, coordinated with parser consistency.

### [Define and preserve consequential filesystem metadata](features/v3-filesystem-metadata.md)

Complete the retained preservation contract for metadata beyond bytes and meaningful modes across supported writes and recovery. Establish which Windows properties matter and verify preservation or explicit limitations.

### [Bind setup recovery to physical artifact ownership](features/v3-recovery-artifact-ownership.md)

Complete physical artifact ownership and no-overwrite recovery for supported setup operations, including safe recognition of owned partial creation. Carry clear write stages, cleanup ownership and separate validation into the recovery repairs. Since 2026-10-04 it also restores v2's rule that one setup operation owns a project at a time where the installed launcher's serialization of project operations does not already apply, starting with a probe of what remains uncovered.

### [Complete executable identity assurance for Windows launches](features/v3-launch-identity.md)

Reconcile retained launch roles with the selected executable identity and trust boundary, including replacement and path retargeting between discovery and launch. Verify the boundary rather than inferring it from a resolved path. The roles include the runtime's own Git launches, which the migration accounting audit of 2026-09-29 found unnamed.

### [Protect private request and review artifacts on Windows](features/v3-private-request-material.md)

Carry the retained request-confidentiality requirement into current request files, review copies and native evidence. Define and verify the appropriate Windows access boundary before sensitive material is written.

### [Define and verify marketplace installation contents](features/v3-marketplace-surface.md)

Finish the retained installed-package boundary: required runtime resources and intentional user documentation, with repository-maintenance material excluded where the host permits it. Distinguish marketplace caches from retained execution bundles.

### [Carry settled decisions and experiment evidence into later reviews](features/v3-review-decision-context.md)

Complete the retained concise decision and experiment record so subsequent independent reviews receive relevant settled facts and unresolved obligations after edits or compaction. Preserve the ability for new evidence to reopen a decision. The migration accounting audit of 2026-09-29 added two recording gaps: capturing a material investigation's conclusion and limits when established, and preserving implementation discoveries in working notes.

### [Maintain verification evidence, fixtures and measured efficiency](features/v3-verification-infrastructure.md)

Improve current verification tooling through explicit fixture ownership, safe evidence storage and measured reduction of unnecessary startup. Retire the 2.4.5 fixture only after reconciling supported upgrade checks and the ignored upgrade driver that still loads it. The migration accounting audit of 2026-09-29 added telling buffered output from a failure or hang, cleanup on cancellation with diagnostics when cleanup fails, and verification evidence storage, which does not exist yet. Triage on 2026-09-30 added how a live fixture's nested Claude reviewer can authenticate without a copied credential.

### [Preserve run preferences and enforce supported resource budgets](features/v3-run-preferences.md)

Complete the retained run-settings outcome across continuation: durable model and effort preferences, explicit requirements and substitutions, plus enforceable requested budgets with accurate accounting and honest unsupported limits. Since 2026-10-04 it also covers raising a recorded limit mid-run on the user's explicit authority and a closing report of the model and effort behind each role.

### [Verify repair-commit and autosquash safety in ordinary delivery](features/v3-git-repair-evidence.md)

Complete the retained reliable repair-commit outcome using ordinary Git and project policy: establish ownership and the current safe fixup target, preserve unrelated work, honor hooks and verify the intended autosquash. The migration accounting audit of 2026-09-29 found that no repair-commit instruction or check ships, so this needs instructions as well as evidence. Since 2026-10-04 the shared checks are to be the only way Nightshift creates a fixup, and an authorized rewrite confirms a safe range, no concurrent writer and recoverable original refs.

### [Capture review content once within an operation](features/v3-review-snapshot-reuse.md)

Complete the retained operation-local snapshot reuse requirement while preserving freshness and exact reviewed bytes. Reuse captured source and identity for governing artifacts and review copies where valid, without introducing a persistent cache.

### [Verify compatible agreement continuity across representation changes](features/v3-agreement-continuity.md)

Complete evidence for retained agreement behavior: qualified assent, compatible title or description edits, archival moves and repeated spec refinements preserve accepted commitments without enlarging the approval burden. The migration accounting audit of 2026-09-29 found that acting on a qualified yes and presenting material changes as understandable deltas are not yet instructions a run loads, so delivery needs instruction changes as well as evidence. Since 2026-10-04 it also keeps a record of what the user was shown and accepted: the accepted version against which an edit no finding drove is judged and recorded, an acceptance bound to the presented text, and a qualified yes recorded with its adjustment; and when an index entry is the governing text, review scope and staleness follow that entry.

### [Relaunch unfinished work after host exit or restart](features/v3-host-relaunch.md)

Restore unattended execution after a host exits or Windows restarts, beyond the currently supported user-driven reopen and reconciliation. Coordinate with Night Guard checkpointing without assuming it already restarts execution.

### [Native helper for Windows process work](features/native-process-helper.md)

Replace the pwsh helpers for process inspection and job containment with a small native helper, for performance. Raised by the user on 2026-09-30. Process inspection runs twice per controller observation and again for each check, probe, review attempt and launcher admission, at 340 to 681 ms per call on a lightly loaded machine, about 170 ms of it pwsh startup; the job runner, about 0.6 s to start when idle and far longer under load, also starts whenever admission launches the host to inspect its settings. The settings writer stays on pwsh. Language, build, packaging, trust and the Codex sandbox remain open.

### [Maintain bounded host transports and explicit runtime ownership](features/v3-transport-maintenance.md)

Assess current host transports for bounded efficient buffering, independently testable protocol decisions and one owner for every live timer. Preserve cancellation, stream closure and termination guarantees. The migration accounting audit of 2026-09-29 found the remaining work: repository verification across chunk boundaries, prompt rejection of oversized frames, a per-line output bound, and runner state decisions separated from process wiring with direct state tests.

### [Execution plan for a multi-item selection](features/multi-item-execution-plan.md)

When the user picks more than one item, the controller or the runtime proposes an execution plan that works them in parallel, in sequence, together as a unit, or a mix of the three, and includes it in the readback so the user agrees to it before any work starts. Raised by the user on 2026-10-01 during a two-item Ready selection. Who builds the plan, what a unit means for runs and reviews, and how parallel items share one checkout under the review input drift rule are open; the user suggested Git worktrees on separate branches for the last.

### [Graphical run view](features/run-graph-view.md)

Show a run as a graph of its whole workflow in a page hosted by a local web server and viewable on the same computer, highlighting the current step and animating smoothly as things happen, such as subagents spawning and files being edited. Raised by the user on 2026-09-29, who sketched later slices that add old runs and then clickable elements such as nodes with details about each step; where the file-edit and subagent events come from, who starts and stops the server, and how it stays local-only and read-only are among the questions the record lists as open. On 2026-09-30 the user added a later slice that makes it an operational UI, an alternative to the CLI, whose permitted operations and ownership rules are also open.

### [Claude Code mods for run visibility](features/claude-code-mods.md)

Consider Claude Code mods, plugins of function hooks that add a live pane, band, status line, toast or hook inside Claude Code, as an optional surface for run visibility, such as run progress, review state or CI status after a push. Raised by the user on 2026-10-01 and tracked as Exploring at inbox triage on 2026-10-02; uninvestigated. Mods exist only on Claude Code, so a mod could only add optional visibility, never machinery the lifecycle depends on.

### [Deliver each run on its own branch or worktree](features/run-worktree-delivery.md)

Implement each run in a dedicated Git worktree on a run-owned branch, so the morning report points at a reviewable diff and the user keeps working in the main checkout. From the user's 2026-09-26 ideas document comparing other agent tools. Open: the checkout lease, the recorded project path and adoption, review-copy source, worktree lifecycle and uncommitted user changes, and branch or draft pull request publication.

### [Measure whether the lifecycle catches defects](features/defect-detection-measurement.md)

Run the lifecycle against a small fixed suite of seeded defects and record detection rate, false-positive rate after skeptic validation, and time and model cost, repeating when models or review guidance change. From the user's 2026-09-26 ideas document. Open: budget and usage accounting, keeping the suite out of reviewer context, and how many runs a meaningful rate needs.

### [User proxy consultation and opt-in user profile](features/user-proxy-consultation.md)

When the controller is uncertain and the user is absent, consult the strongest available model reasoning as the user from recorded knowledge, and route its labelled answer and confidence to morning triage; with high confidence the controller might proceed. An opt-in user profile would accumulate priorities and sensibilities for it. Reserved decisions, confidence thresholds, labelling and profile consent remain open.

### [Review mode for someone else's implementation](features/review-mode.md)

Validate a feature implementation made by someone else, a human or an AI not participating in the session, against whatever material the user provides, such as links, Word documents or text in chat. It takes a local branch, commit range or worktree, a GitHub pull request or uncommitted changes; beyond reviewing the code it runs checks and tests, verifies faked boundaries live, checks documentation and backlog accuracy, and can post its verdict to the pull request with the user's explicit go-ahead each time. It reports first, then offers repairs as patch files or direct edits, taking the findings one at a time once repair is initiated. Raised by the user on 2026-09-28. Open questions include whether it is a skill or a revise-code mode distinct from plain review requests, whether it creates a run, how baseline material is ingested and confirmed, the trust boundary for running someone else's code, and how the change is checked out without disturbing the user's work; the record lists them all.

### [Orchestration efficiency](features/orchestration-efficiency.md)

Post-MVP investigation of measured controller overhead: repeated context reads, polling, bookkeeping and mechanical tool round trips. Preserve autonomy, independent review, skeptical validation and cumulative review after fixes; verify actual time and cost improvements before claiming savings.

### [Spawn a shift supervisor when admin work fills the controller's context](features/context-triggered-supervisor.md)

Have the controller notice when administrative work starts filling its context and spawn a lower-tier shift supervisor to carry assignments, progress, result collection and routine recovery, keeping consequential decisions and access to the underlying evidence. Raised by the user on 2026-09-29: the retained optional supervisor ships only as one brief sentence and a write-free role label, with nothing that triggers, briefs or launches one. The trigger, the supervisor's brief and reporting, and where it runs are open; since 2026-10-04 its reporting is to escalate a safety, authority or repository-integrity violation at once.

### [Controller-run experiments](features/controller-run-experiments.md)

Let the controller design and run bounded experiments within the authority already granted, such as comparing reviewer models, a reviewer guided by the review lenses against an unguided one, dual against single review, compacting a Codex reviewer before its resume, or tuning the keyword scores of the open-question search, with control and treatment arms, a cost limit and a separate evaluator where practical, and report each result for the user to adopt, repeat, revise, track or discard; results never promote themselves. Raised again by the user on 2026-10-03 after finding it no longer tracked: v2 carried it in an unshipped run-management draft whose 2026-09-06 migration disposition did not name it, while a sibling decision kept experiment evidence in the run record "without a separate ledger or experiment framework"; the user reversed the ledger part the same day, so experiments are to be recorded in a separate controller-owned ledger of material conclusions and deciding evidence, and the user added that session retrospectives could propose experiments, kept durably for future sessions, and that Ready could ask at selection whether extra tokens may be spent on experiments, only when the controller plans one, with a background agent proposing any experiment while the user reads the readback, and one question that suggests a token allowance the user can grant, adjust or decline. How much further structure it needs, budgets and evaluation, the ledger's home and lifecycle, and its authority boundary are open.

### [Answer open backlog questions cheaply in retrospectives](features/retrospective-open-questions.md)

Have the session retrospective look through the open questions in the backlog's records and answer those the session's evidence or a cheap check can settle, with the evidence; questions that are the user's to decide get a proposed answer for triage, and questions needing measurement may become proposed experiments. Raised by the user on 2026-10-03; the same session answered one such question, whether Codex counts cached input inside its input count, in minutes from stored review events. What counts as cheap, the scope, how answers land and are reviewed, and its relation to revisiting settled decisions and the coherence audit are open.

### [A greppable format for open and settled questions](features/open-questions-format.md)

Give open and settled questions in backlog records one fixed format and a function that parses them out grouped by feature, with a keyword search and a lightweight model judging its matches, and reading a random sample of records in full so that repeated runs eventually cover the backlog, to catch questions outside the format, so tools and agents can find, count and answer them. A question found outside the format becomes a proposed fix to its entry, and one only the model found also a candidate keyword; a ledger scores each keyword +10 for a confirmed match and -1 for a rejected one and retires those whose score falls too low, with the scoring for experiments to settle. Raised by the user on 2026-10-04 for the retrospective that answers open questions cheaply; that day 24 headings in the feature records marked open questions under 7 different names, and more open items sat under "Before implementation". The format, where the function lives and what it reads, the keywords and the model that judges them, the sample's size and draw, how proposed fixes and keywords land, the keyword ledger, parser enforcement or a Ready count, migrating existing records and templates, and its relation to the Related field are open.

### [Night Guard](features/night-guard.md)

Post-MVP reboot watchdog for multiple active agent sessions. Persist recovery state continuously, use the seconds-long shutdown window for bounded stop/flush coordination, and recover from saved state even when a session receives no warning or cannot acknowledge it.

### [Native event validation](features/native-event-validation.md)

Post-MVP exploration of consistent handling for assistant messages missing model metadata and other malformed native evidence. Preserve required-model and independent-review guarantees while distinguishing legitimate event shapes and maintaining reliable recovery.

### [Incremental revise finding delivery](features/incremental-revise-finding-delivery.md)

Deferred beyond the MVP. Streaming could overlap validation with the remaining review, while preserving corrections, withdrawal, attribution and input stability. Completed reports remain the baseline. Host support and worthwhile latency savings still require verification, as the agreed boundary says.

### [Review-run command enforcement](features/review-run-command-enforcement.md)

Deferred exploration of stronger enforcement for explicit command restrictions. Existing restrictions remain binding; no general protected-shell mode is claimed. The record, written for retired v2 entry points, now carries the agreed v3 question of which restrictions need enforcement and where, without a general shell-interception framework.

### [Model choice per role: Opus 5.5 versus Fable](features/opus-versus-fable-role-choice.md)

Investigate which roles could use Opus 5.5 instead of Fable without falling below their required capability and strength, and at what cost difference. The user reports Opus working well as default controller, unmeasured; live testing and pricing evidence settle any policy change.

### [Structured model teams](features/structured-model-teams.md)

Later deliberate model-role arrangements. The MVP uses task-fit preferences and controller judgment, with interchangeable strong roles and equivalent-strength cross-host review when suitable.

### [Interactive Codex and Claude Code collaboration](features/interactive-session-collaboration.md)

Later pairing of visible interactive sessions, including optional Windows Terminal pane launch/reuse and user steering of both. No interactive bridge is required by the MVP.

### [Design principles in a reference file and a run-time file](features/design-principles.md)

Collect Nightshift's reusable design principles in two files split by role, as with the workflow files: a reference `PRINCIPLES.md` beside VISION.md and WORKFLOW.md that gives each principle its reasoning and the decisions that established it, and a shipped run-time file that states each rule in one sentence for the work that makes design decisions, such as revise-spec, repairs and Exploring graduations. Raised by the user on 2026-10-05 after a session that re-derived the same rules in several graduations. The run-time file owns each rule's wording and the reference links to it through GUID anchors, which the user chose so that a rewording or retitling cannot silently break or redirect a link, with a packaging test checking that the two pair up. Each principle needs at least two decisions behind it and does not restate VISION.md. The file names, coordinated with [Rename one of the two workflow files](QUICK_WINS.md#rename-one-of-the-two-workflow-files), the anchor form, the route into what a run loads and what moves out of VISION.md are open.

## History

Delivered features belong in [FEATURES_HISTORY.md](FEATURES_HISTORY.md). When shipping an entry, remove its satisfied Requires references from active indexes; retirement is recorded separately.
