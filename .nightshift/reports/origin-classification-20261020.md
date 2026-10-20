# Origin of the current bugs and quick wins

Oct 20, 2026

The by-hand classification that Step 1 and Add 1 of [the assessment worklist](assessment-worklist-20261018.md) call for: every entry under "## Current" in [BUGS.md](../BUGS.md) and [QUICK_WINS.md](../QUICK_WINS.md), as of commit f2d44db6 on 2026-10-20, classified by where it came from. Both tables use the classes original implementation, review fix, instruction change and unclear, but under different rules, each stated at the head of its section: the bugs table counts a review fix only where a repair answering a review finding introduced the defect and an instruction change only where a later edit of instruction prose did, so a defect in prose as first written is original implementation there; the quick-win table counts a review fix wherever a review raised the entry and deferred it, and an instruction change wherever the gap lies in prose agents follow. The counts are therefore not combinable across the two tables, and the bugs table's review-fix and instruction-change counts are the narrower ones. Two agents drafted the tables below, one per index, each row citing the sentence or commit that decided it; the maintainer accepted the drafts as the classification on 2026-10-20 without changes, noting that the earlier impression that most entries came from review fixes rested on no numbers and may have been recency bias, and that a late reviewer finding an issue does not mean the previous repair round introduced it.

Two limits bound what the tables can say. Nightshift delivery commits fold every in-run review repair into one commit, so git history cannot tell code written that way from the start apart from code reshaped by an in-run repair; the zero review-fix bugs means none stated in an entry or visible in git, not none in fact, and the run records under `.nightshift/runs` could settle it per delivery. And the quick-win table reads instruction change broadly, as a gap in prose as first written or an idea asking for new prose; read narrowly, as the bugs table reads it, only about six quick wins come close, none stating that a later edit introduced its defect, as the quick-win section says.

What the counts say about the worklist's premises: Add 13's context, that most current quick wins and bugs came from review fixes, does not hold on either table (16 of 71 quick wins under the broad rule, 0 of 51 bugs under the narrow one); Add 14's context, that instruction changes produce more defects than code changes, is not established by these counts: under the broad rule 25 quick-win entries concern instruction prose against 21 original-implementation entries, but that class counts gaps in prose as first written and ideas asking for new prose rather than defects from later instruction edits, and under the narrow rule the count is about 6 quick wins, the closest cases rather than stated causes, since no current quick win states that a later edit of instruction text introduced its defect, and 2 bugs. Number 8 of the fortnightly check, review-fix entries added in the fortnight ending 2026-10-18, reads 0 bugs and 4 quick wins from these tables over the entries still current on 2026-10-20; entries added in that fortnight and archived before that day, at least 9 bugs and 5 quick wins, are not classified.

## Bugs

Drafted 2026-10-20 over the 51 `### ` entries under `## Current` in `.nightshift/BUGS.md` at `f2d44db6`. Origin labels: original implementation (the defect was in the code or prose as first written), review fix (introduced by a repair answering a review finding), instruction change (arose from a later change to instruction prose), unclear (the entry, its record and git do not settle it).

Method and limits:

- "Added" is the first commit whose diff introduced the heading's title in `.nightshift/BUGS.md` (`git log -S"### <title>" --reverse`, or `-S"### [<title>]"` for the eight linked headings). The eight linked headings point to records under `.nightshift/bugs/`; the title text is given here without the link.
- "Original implementation" here means the behavior is present in the commit that first introduced the code or prose (checked with `git log -S` on a distinctive token where the evidence column cites a commit). Nightshift delivery commits fold every in-run review repair into one commit, so git cannot tell code first drafted that way from code reshaped by an in-run review repair. The run records under `.nightshift/runs` could settle that per delivery; they were not searched.
- Confidence is confidence in the label. An "unclear" with high confidence means the entry itself says the cause or mechanism is unestablished, or the defect is controller, host or external behavior with no stated origin in a change.
- No entry or record states that its defect was introduced by a repair made in response to a review finding. Many were found by a review or skeptic, which is not the same thing.

| Entry heading | Added | Origin | Confidence | Evidence |
| --- | --- | --- | --- | --- |
| Unwrap joins adjacent link reference definitions | 2026-09-25 | original implementation | medium | "Pre-existing"; `scanWraps` dates from `37ddc71f` (extracted 2026-08-30) and has no ref-definition handling; earlier unwrap.js history not traced |
| Shared block model misreads a fence opened on a list item's marker line | 2026-09-25 | original implementation | medium | `describeLines` first added in feature `fff72393`; "`internal/backlog-links.js` declares the construct unmodeled" |
| Controller interrupts a progressing reviewer on file-size evidence | 2026-09-24 | unclear | high | controller judgment; "Investigate which runtime liveness and progress signals a controller should rely on" |
| Adoption replay bypasses fresh reconciliation after an intervening revision | 2026-09-22 | original implementation | medium | replay shortcut (`last?.observedRevision === request.revision`) introduced in feature commit `6b3fdaa0`; in-run review history not checked |
| Executive governing scope is missing during early review | 2026-09-22 | unclear | high | "Whether guidance, interpretation, sequencing or actual presentation caused the failure remains open" |
| Available recovery is mistaken for a terminal blocker | 2026-09-22 | unclear | high | controller classification; "Investigate how blocker classification accounts for remaining authorized investigation" |
| Automatic blocker checks repeat handover reports | 2026-09-22 | unclear | high | "the respective roles of controller behavior, reporting guidance and goal continuation remain unverified" |
| Acceptance tooling expands beyond demonstrated verification needs | 2026-09-22 | unclear | high | controller choice; "whether the entire harness was avoidable ... remains unassessed" |
| Report edits invalidate unrelated regression checks | 2026-09-22 | unclear | medium | "the broad input declaration coupled prose edits to behavioral regression checks"; who chose the inputs and why not stated |
| Permitted validation fallbacks are lost between runs | 2026-09-22 | unclear | high | "Investigate why applicable model-role decisions were not carried into current selection" |
| Retrospectives omit work-selection and policy failures | 2026-09-22 | unclear | high | "whether the gap lies there or in execution is not established" |
| Interrupted template creation is accepted as a complete existing file | 2026-09-21 | original implementation | high | v3 `initialize` in `8ca3cb46` already did `if (fs.existsSync(target)) continue;`; audit: "Confirmed interrupted-setup regression" (relative to v2) |
| Exploring and Ready omit explicit parser problem reporting requirements | 2026-09-21 | instruction change | high | `structuralErrors` and `indexes.missing` added to the Exploring skill in `12d9a6c5`, removed by the v3 rewrite `8ca3cb46`; follow-ups report: "Confirmed instruction loss" |
| New setup templates ignore effective project newline policy | 2026-09-21 | original implementation | high | `8ca3cb46` `initialize`: `.replace(/\r?\n/g, '\r\n')` |
| Setup inspection omits current backlog completeness | 2026-09-21 | original implementation | medium | audit: inspect "inventories `.claude`, not current `.nightshift` completeness" at the 3.2.0 baseline; v3 setup written in `8ca3cb46`, later changes not traced |
| Setup does not diagnose actual pre-v3 recovery residue | 2026-09-21 | original implementation | medium | audit: "Current inventory excludes root `.nightshift-init-backlog.lock`"; capability lost in the v3 rewrite, not traced further |
| Fresh setup does not distinguish non-Git roots from broken Git metadata | 2026-09-21 | original implementation | medium | audit: "`setup.js` ... has no initial repository-kind classifier" |
| Legacy backlog migration fails in non-Git projects | 2026-09-21 | original implementation | medium | v3 `8ca3cb46` `git()` raises `git-failed`; audit: "The reduced migration path requires Git" |
| Overlapping Markdown roots can lose or duplicate collected files | 2026-09-21 | unclear | low | record: "A visited-root early return therefore fixes some duplication cases by introducing loss"; the shortcut came from fix `d9855895` (2026-08-23, same day as feature `2036f8b7`), whose review provenance is unrecorded; first tracked in `.claude/BUGS.md` 2026-08-31 (`f234e72c`) |
| Missing session activation blocks agreed work until restart | 2026-09-19 | unclear | high | "whether the hook ran at startup or clear, and whether it failed or its record was removed remain unverified" |
| Probe evidence about the host is discarded on any edit | 2026-09-18 | original implementation | medium | "The mechanism is the documented one"; probe evidence in the runtime reference since `8ca3cb46` |
| Codex hook launcher may lose the plugin root under PowerShell | 2026-09-18 | unclear | high | "Hypothesis"; "Not established: that Codex runs hook commands through that shell path" |
| Permission-only recovery invalidates accepted specs | 2026-09-15 | original implementation | high | `unblock` appending to `task.agreement.decisions` and `spec.agreement.decisions` is in `8ca3cb46` |
| Controller treats internal token ceilings as user-owned budget decisions | 2026-09-13 | unclear | high | controller behavior; "The controller imposed a 60,000-token checkpoint threshold" |
| Tool warnings dismissed without assessing their retrospective value | 2026-09-13 | unclear | high | controller behavior; "The controller treated the warning as incidental" |
| Git-history review probes lack the evidence they need | 2026-09-13 | unclear | medium | "the reviewer supplied none"; when the empty-repository probe behavior began was not traced |
| Review-transfer approval interrupts an authorized handover | 2026-09-13 | unclear | high | external approval rejection plus controller misattribution; no change named |
| Fable-only acceptance gate rejects supported worker roles | 2026-09-10 | original implementation | medium | temporary harness; the independent review of the new mechanism found that "`verifyFableAssessors` line 35 asserts every new worker's role is in `['reviewer', 'skeptic']`" |
| Temporary acceptance controls are unsafe to rerun in place | 2026-09-10 | original implementation | medium | temporary harness; the same review found that the controls "write their results beside themselves" |
| Compaction/resume acceptance harness needs precision repairs | 2026-09-10 | original implementation | low | temporary harness; the review lists a pre-existing driver issue and preparation-material issues; the provenance of the driver revisions the review did not cover is unrecorded |
| Directory ignore probe can misreport tracked backlog directories as ignored | 2026-09-11 | original implementation | medium | `check-ignore --no-index` on a directory already in `8ca3cb46` `setup.js`; the trigger is Git behavior |
| Auto-mode classifier denies the runtime CLI | 2026-09-11 | unclear | high | "Claude Code auto-mode classifier behavior that the plugin cannot change"; trigger unestablished |
| Windows job pipe and containment fixtures fail outside the code they cover | 2026-09-12 | unclear | high | "Actual process leakage, the precise cause and identity with the earlier Node 26 failure remain unverified" |
| Wait reports a missing runner for a check that is finishing | 2026-10-05 | original implementation | low | `runner-missing` introduced with `wait` in feature `d958883a`; the window is "inferred, not investigated" |
| A resource blocker refuses read-only diagnostic review of saved evidence | 2026-10-10 | original implementation | high | `task-blocked` refusal of every non-block action is in `8ca3cb46` `lifecycle.js`; "The 3.3.10 source keeps the rule" |
| Codex controller overflows its context window instead of compacting | 2026-10-10 | unclear | high | host behavior; "Why the session overflowed rather than compacted is not established" |
| A hook generation change strands a running run's session | 2026-10-12 | original implementation | medium | "The refusal follows the designed rule" of the retained-releases spec (feature `87e1d5c9`); the trigger was a 3.3.8 bootstrap change, by inference |
| Spec reviewers are not told the code is context | 2026-10-12 | original implementation | medium | lead scope sentence "surrounding code and sibling paths" unchanged since `8ca3cb46`; no spec role brief ever found |
| Unverified job cleanup fails a finished operation and leaves its lease running | 2026-10-12 | original implementation | medium | "Guarded operation descendants could not be reconciled" refusal since feature `87e1d5c9`; why the job was not empty is unestablished |
| Migration leaves embedded and placeholder backlog paths without a diagnostic | 2026-10-12 | original implementation | medium | `rewriteReferences` since `8ca3cb46`; its whole-string rule not separately traced |
| Stop hook continuation prints the whole obligation brief | 2026-10-12 | original implementation | high | `8ca3cb46` `hook.js`: `'Nightshift continuation. ...' + JSON.stringify(brief)` as the Stop block reason |
| Skeptic validation accepts inputs edited after the finding was raised | 2026-10-12 | original implementation | medium | `8ca3cb46` `validate` checks only `fresh(state.root, validation.snapshot)`; need surfaced from controller ordering failures |
| Run store keeps a full state copy for every revision | 2026-10-12 | original implementation | high | `INSERT INTO history` of the full state since `8ca3cb46` `store.js` |
| Repository maintenance commands launch Git by bare name | 2026-10-15 | original implementation | high | bare `spawnSync('git'` from the first commits of `tools/release-gate.js` (`37b41a91`) and `tools/release-manifest.js` (`87e1d5c9`); hooks not traced |
| Retained release reports omit retained payload size | 2026-10-15 | original implementation | high | "A direct publication review saved this gap" in the retained-release delivery run `2a89bde5` itself |
| A check failed on input drift with no known change to its files | 2026-10-18 | unclear | high | "which the report marks as a hypothesis"; if confirmed, the code came from bug fix `fc33f5b5` (line-ending renormalization), a category not listed |
| The morning report's closing step lets any reply confirm delivery and start triage | 2026-10-18 | original implementation | medium | "Their first reply is the delivery authority" first written in the brief by feature `5d232192` (2026-09-18); defect lives in instruction prose |
| Claude Code can store the in-turn handover acknowledgement as thinking | 2026-10-18 | instruction change | medium | handover skill's "Keep this same tool-use turn active" added by `285a7219` (2026-10-08), replacing the 3.2.10 turn-ending route; host cause unestablished |
| A host result without termination evidence can still yield a receipt | 2026-10-18 | original implementation | high | `descendantsReclaimed !== false, 'termination-unverified'` in `review.js` since `8ca3cb46` |
| Claude reviewers read outside their private review copy | 2026-10-18 | original implementation | medium | Claude reviewer `--tools Read,Glob,Grep` without a sandbox since `8ca3cb46` `hosts.js` |
| Recorded checks pass the bound runtime's resource context to the commands they run | 2026-10-19 | unclear | medium | "this is inferred from the variables and the error, not traced" |

### Bug counts

All 51 current entries:

| Origin | Count |
| --- | --- |
| original implementation | 29 |
| review fix | 0 |
| instruction change | 2 |
| unclear | 20 |

Entries added 2026-10-05 to 2026-10-18 inclusive (17 entries; the 2026-10-19 entry falls after the fortnight and is unclear):

| Origin | Count |
| --- | --- |
| original implementation | 14 |
| review fix | 0 |
| instruction change | 1 |
| unclear | 2 |

### Notes

- Contestable: "Overlapping Markdown roots" could be a review fix if `d9855895` answered a review finding; "The morning report's closing step" is prose first written by its feature, so it reads as original implementation by the definition used but as an instruction-prose defect by locus; "Claude Code can store the in-turn handover acknowledgement as thinking" may be host or model behavior that predates the route change; the five setup audit entries are regressions relative to v2 introduced by the v3 rewrite, counted as original implementation of the v3 code.
- By locus rather than origin, three entries have their defect in instruction prose (Exploring and Ready reporting, morning report closing step, in-turn acknowledgement); thirteen unclear entries describe controller, host or external behavior with no code locus named.

## Quick wins

Drafted on 2026-10-20 for the assessment worklist's Step 1 and Add 1 (tests the premises of Add 13 and Add 14). Scope: every `### ` heading under `## Current` in `.nightshift/QUICK_WINS.md` at `f2d44db6` (71 entries). No current quick win links a record of its own under `.nightshift/features/` or `.nightshift/bugs/`; the features they link are related work, so provenance comes from the entry text and Git history.

### Rules applied

- **review fix**: the entry states it was raised by a reviewer, skeptic, probe or assessment during a review (or a review loop) and deferred, or that it arose from a repair made in response to a review finding. This takes precedence over the other two.
- **instruction change**: not a review fix, and the gap lies in prose agents follow (operating brief, a SKILL.md, AGENTS.md, a runtime or releases reference, init-backlog templates, reviewer prompt text) and the entry's remedy is a change to that prose. The definition also counts an entry that arose from a change to instruction files; no current entry states that its defect was introduced by a later edit of instruction text, so every entry in this class qualifies at least as the "asks for one" kind. Five of them (marked v3 rewrite) record v2 provisions that the v3 rewrite of the brief or a skill dropped; see the premises section for the narrow reading.
- **original implementation**: not a review fix, and the gap or defect lies in code (runtime, launcher, tools, acceptance harness) or non-instruction prose (README) as first written, with the remedy there.
- **unclear**: the entry gives no provenance that places it, or it is a host verification, a naming preference, or a feature request whose remedy is split between code and instructions.
- **added**: author date of the first commit that introduced the entry, by `git log --reverse -S"### <heading>" -- .nightshift/QUICK_WINS.md`, following renames back to the original heading. Four entries were renamed (marked with a dagger); their current heading text first appeared later, as listed below the table. No entry was moved in from BUGS.md or FEATURES.md in its introducing commit.

### Table

| entry heading | added | origin | confidence | evidence |
| --- | --- | --- | --- | --- |
| Restore the revise-docs writing rules | 2026-10-01 | instruction change | high | v3 rewrite; v2 capability audit: "none of those writing rules survives and no disposition names their removal" |
| Detect review input drift before the reviewer's usage is spent | 2026-09-30 | original implementation | medium | "the dispatcher has no way to cancel a running attempt when it sees drift"; the delivering run "deliberately left this part out" |
| Present a governing spec as a link with a change list | 2026-09-30 | instruction change | medium | user idea during a spec review, not a finding: "Have the operating brief and revise-spec present a governing spec and each amendment as a link" |
| Confirm when marketplace auto-update applies a pushed release | 2026-09-28 | unclear | low | host updater behavior, remedy in README and global AGENTS.md: "The cause is unverified" |
| Backlog conventions recommend commit hashes that a pre-push rewrite invalidates | 2026-09-28 | instruction change | medium | history headers and templates as written: "the `quick-wins.md` template also recommends commit hashes as anchors"; surfaced when "a review-repair fixup dropped them" |
| Hand stored probe results over after a line-ending renormalization | 2026-09-27 | review fix | high | "by the cumulative assessment of run `d42fe76e-3954-4ef8-99db-727790f12ee2` and confirmed by a skeptic" |
| Say at handover when the session runs an older release than the installed one | 2026-09-27 | unclear | low | observed in a run; remedy artifact not settled: "Shipped skill or runtime text" |
| Tell reviewers and skeptics the probe copy layout | 2026-09-27 (dagger) | instruction change | low | reviewer prompt text: "Tell every reviewer and skeptic in the assessment request how the executing release lays out a probe's working directory" |
| Codex acceptance fixtures copy the live credential | 2026-09-26 | original implementation | high | harness code: "with no remaining-life guard like the one it applies to Claude credentials" |
| Verify the Codex handover path of 3.2.10 | 2026-09-26 | unclear | low | verification debt, not a defect: "its installed-host evidence covers Claude Code only" |
| Create silently ignores unknown request fields | 2026-09-26 | original implementation | high | runtime: "unknown fields inside a request are not" |
| Honor escaped punctuation in heading anchors | 2026-09-25 | review fix | high | "Found by the final assessment of run"; tracked "rather than extend the 3.2.9 review" |
| Reviewers re-request checks the controller already recorded | 2026-09-25 | original implementation | medium | runtime does not supply recorded checks: "Whether dispatch should hand reviewers the recorded check evidence, or reviewers should accept it, is undecided" |
| Codex sandbox blocks the launcher from starting the host | 2026-09-19 | original implementation | high | launcher: "Inside the Codex sandbox the launcher cannot start the host process it inspects" |
| Acceptance reports carry a checkable evidence digest | 2026-09-19 | instruction change | low | remedy is brief text: "State in the shared brief that evidence backing an agreed requirement"; lesson came from "the final independent assessor could not verify the report" |
| Acceptance harness waits on controller approval without a bound | 2026-09-17 | original implementation | high | harness: "a Claude acceptance run timed out while awaiting controller tool approval" |
| Shared native control session helper | 2026-09-17 | review fix | high | "Found by several strong assessments of the automatic-preparation change"; "It was deferred because" |
| Settings inspection cleanup | 2026-09-17 | review fix | high | "Residual structural and coverage observations from the strong assessments" |
| Hook-path native settings resolution cost | 2026-09-17 | review fix | medium | sibling entry: "The launch-count finding from the same receipt is carried by" this item; its own text opens "Established by execution" |
| Post-review minor repairs | 2026-09-17 | review fix | high | "each confirmed by a fresh skeptic and deferred only so the verdict stayed fresh" |
| Codex inline-script guard parity | 2026-09-17 | unclear | low | arose from the user's own hook, remedy is a hook port or a rule note: "the user's global inline-script rule gained mechanical enforcement on Claude Code" |
| Expose a project-relative receipt path in dispatch results | 2026-09-13 | original implementation | high | runtime: "supplies `receiptFile` as an absolute Windows path" |
| Expose recorded probe and check results in their responses | 2026-09-13 (dagger) | original implementation | high | runtime: "but the brief carries no probe result" |
| Agent-directed rules leak into user-facing prose | 2026-09-11 | instruction change | high | "Skill texts state constraints for the agent"; agents echo them "as stiff rule quotations" |
| Documentation and backlog edits land before the first cumulative assessment | 2026-09-11 | instruction change | medium | brief ordering: "currently reads as if those edits belong after review"; triggered when "the first cumulative assessment raised it as a minor finding" |
| Test that resumed dispatches keep the limit refusal codes | 2026-10-01 | review fix | high | "by a skeptic during the code review of" |
| Name the limit that capped a review attempt | 2026-10-01 | review fix | high | "by a probe during the code review of" |
| Say that an unparseable receipt counts as none | 2026-10-01 | review fix | high | "confirmed by a skeptic and deferred to triage" |
| Have revise-code trace the readers of state a repair changed | 2026-10-01 | review fix | medium | "Two repairs in that run each broke a reader nobody traced"; raised "from the independent review of that run's retrospective proposal" |
| Runtime requests refuse a completed run bound to another release | 2026-10-02 (dagger) | original implementation | high | runtime: "takes the project's current run as its target even when that run is complete and replaceable" |
| Mid-run follow-up capture is refused while a dispatch runs | 2026-10-02 | unclear | low | runtime or guidance, possibly not a defect: "this may be the documented serialization rather than a defect" |
| Rename one of the two workflow files | 2026-10-02 | instruction change | medium | naming of the shipped brief: "a reader or an agent can mix them up by name" |
| Weigh minor fixes against the review cycle and keep the rest as follow-ups | 2026-10-02 (dagger) | instruction change | medium | brief gap: "neither asks the controller to count the review dispatches a repair causes"; prompted by the cost of repairing an optional minor finding |
| Release manifest hashes working-copy bytes | 2026-10-03 | original implementation | high | tool: "hash payload files as read from the working tree" |
| Offer to revisit an entry's settled decisions before starting work | 2026-10-03 | instruction change | medium | user idea: "the rule belongs with the readback rule in the operating brief" |
| Have docs reviews check dependency declarations and the links Ready cannot | 2026-10-03 | instruction change | medium | reviewer dimension text "asks only whether backlog changes" follow conventions; raised by the user "during the dual review of that day's backlog changes" |
| Check authorized publication prerequisites before handover | 2026-10-04 | instruction change | high | v3 rewrite; handover skill text unchanged "since v3's first commit" |
| Resolve a deferred finding only once its destination exists | 2026-10-04 | original implementation | high | runtime `dispose` "accepts a deferral as long as its route is a non-empty string" |
| Document installing and updating on both hosts | 2026-10-04 | original implementation | medium | README as written "gave update instructions for neither host"; the remaining part is a Codex host verification |
| Prefer the smallest repair that meets the obligation | 2026-10-04 | instruction change | high | v3 rewrite; "nothing asks the skeptic's repair proposal or the controller's choice of repair to prefer removing or generalizing over adding" |
| Keep the review lens text in one place | 2026-10-04 | instruction change | medium | brief and reviewer prompt drift: "their descriptions are written twice in different words" |
| Tell a later-pass reviewer to expect subtler defects | 2026-10-04 | instruction change | medium | reviewer prompt text: a fresh lead gets no earlier findings "and also no sign that it is a later pass" |
| Carry the agreed context-gathering rule into the brief | 2026-10-04 | instruction change | high | v3 rewrite; the brief "names no operating context and no rule for unknowns" |
| Show setup's change list before applying it | 2026-10-04 | instruction change | high | v3 rewrite; init-backlog skill text "leaves open whether the user sees the inventory" |
| Reclaim finished run copies | 2026-10-04 | original implementation | high | runtime: "probe copies are never removed" |
| Tell the init-backlog templates where retired features go | 2026-10-05 | review fix | high | "by the independent documentation review of the backlog session" |
| Report the morning report's landing time and the run's compactions | 2026-10-05 | unclear | low | user feature request with guidance and runtime remedy: "two things i'd like to add to the morning report" |
| Give the standard checks one input set | 2026-10-05 | unclear | low | a controller omission, no code or instruction defect named: "each controller builds that list by hand" |
| Say when registered hooks run an older bootstrap than the installed release | 2026-10-06 | original implementation | medium | launcher: "A bootstrap change therefore reaches an existing installation only through an explicit maintenance `setup`, and nothing says so" |
| Keep stored probe results when a resumed review adds an artifact | 2026-10-06 | original implementation | medium | runtime handoff; cause "is the likely cause, unverified" |
| Fit reviewer probes to real test durations | 2026-10-10 | original implementation | medium | runtime bound: "Reviewer probes are capped at 120,000 ms" |
| Give skeptics the probe evidence stored for their finding | 2026-10-10 | original implementation | medium | runtime: "joins a dispatch only when its snapshot and context digests both match" |
| Retry a review attempt that ended in an output loop | 2026-10-10 | original implementation | medium | runtime: "No dispatch recovered on its own" |
| Bound inspect output on long runs | 2026-10-10 | original implementation | high | runtime: "Agent output exceeds its capacity" |
| Name the stale check when completion refuses | 2026-10-10 | original implementation | high | runtime: "`complete` tests the review gates before it reaches its `verification-required` refusal" |
| State the expected size and offer slices before handover | 2026-10-12 | instruction change | high | "neither it nor any skill asks for a size estimate or a slicing offer" |
| Rename the init-backlog skill to setup | 2026-10-15 | unclear | low | naming preference, no gap stated: "Raised by the user on 2026-10-15" |
| Keep each session's request files in its own scratch folder | 2026-10-16 | instruction change | high | releases reference "says nothing about placing a session's files apart" |
| Select Exploring drafts by number for a staged graduation | 2026-10-16 | instruction change | medium | user idea against skill text that "lists Exploring drafts as bullets" |
| Keep each run's scratch files and evidence in its own folder | 2026-10-16 | review fix | medium | "Raised on 2026-10-16 by a documentation review of the user's new shared-scratch rule" |
| Triage a standalone revise's unfixed findings before it ends | 2026-10-16 | instruction change | medium | changes agreed skill and brief text: "The list-only ending is an agreed design point, not an oversight" |
| Check that Codex shows the triage question's dialog | 2026-10-18 | instruction change | medium | brief: "on the Codex CLI it points at a tool whose acceptance did not establish that the user saw the question" |
| Let accepted scope cover equal-strength implementation helpers | 2026-10-18 | instruction change | high | brief wording "which a controller can read as requiring approval beyond the accepted implementation scope" |
| Follow the bound release's guidance when the checkout holds newer plugin source | 2026-10-18 | instruction change | low | remedy is guidance, cause open: "Why the controller preferred the checkout after resource binding is not established" |
| Restore a blocked Codex goal when the awaited answer arrives | 2026-10-18 | instruction change | high | the brief "says nothing about a goal the controller itself blocked once the awaited answer arrives" |
| Name the changed inputs of a stale assessment in status | 2026-10-18 | original implementation | high | runtime status: `staleAssessments` "named only the request id" |
| Align the review-dispatch spec with the 3.3.13 contract | 2026-10-18 | review fix | high | "whose reviews refined four commitments of the governing spec" |
| Tighten the 3.3.13 dispatch and observer follow-ups | 2026-10-18 | review fix | high | "deferred because a repair would have reopened a review cycle" |
| Label findings by review kind and round | 2026-10-18 | unclear | low | user feature idea, runtime and skill remedy: "idea: use letters to denote revise iteration" |
| Present every part of setup's template report | 2026-10-19 | review fix | high | "Three minor findings from the code review of the 3.3.13 batch" |
| Correct two stale clauses from the 3.3.13 batch | 2026-10-19 | review fix | high | "Two minor findings from the same review, confirmed by skeptic" |

Dagger: renamed entries, original heading and commit, then the commit that introduced the current heading text:

- Tell reviewers and skeptics the probe copy layout: "Tell reviewers the bound release's probe copy layout" in `0df41fdd` (2026-09-27); current text in `9715de78` (2026-10-12).
- Expose recorded probe and check results in their responses: "Standardize the probe response and expose its recorded result" in `12075d5b` (2026-09-13); renamed in `0e05b04b` and again to the current text in `8fa7c395` (both 2026-09-28).
- Runtime requests refuse a completed run bound to another release: "Bound status refuses a completed run bound to another release" in `e4e0b890` (2026-10-02); current text in `47e2d74d` (2026-10-18).
- Weigh minor fixes against the review cycle and keep the rest as follow-ups: "Settle the optional minor findings of a passable fresh assessment without edits" in `334ac4c9`; current text in `fb5ad82f` (both 2026-10-02).

### Quick-win counts

Computed by a script over this table, which also checked that the rows match the 71 current headings in order, that each date matches the Git result (or the original heading's date for the four renamed entries), and that every quoted phrase occurs in `QUICK_WINS.md`.

| origin | all 71 | high/medium/low | added 2026-10-05 to 2026-10-18 (24) | added on or after 2026-10-05 (26) |
| --- | --- | --- | --- | --- |
| original implementation | 21 | 13/8/0 | 8 | 8 |
| review fix | 16 | 13/3/0 | 4 | 6 |
| instruction change | 25 | 10/12/3 | 8 | 8 |
| unclear | 9 | 0/0/9 | 4 | 4 |

The two entries added on 2026-10-19 fall after the fortnight ending 2026-10-18; both are review fixes. Dating the renamed entries by their current heading text instead would add "Tell reviewers and skeptics the probe copy layout" (instruction change) and "Runtime requests refuse a completed run bound to another release" (original implementation) to the fortnight.

### What the counts say about the two premises

- Add 13's premise, "most current quick wins and bugs came from review fixes", does not hold for the quick wins: 16 of 71 are review fixes, 23 percent, and 6 of the 26 added since 2026-10-05; the bugs table, under its narrower rule, has none.
- Add 14's premise, more defects from instruction changes than from code changes: 25 entries concern instruction prose against 21 in the code or other prose as first written, but none states that a later edit of instruction text introduced its defect. They are gaps in prose as written or ideas that ask for new prose. The closest to "arose from a change to instruction files" are the five v3-rewrite entries, which record v2 provisions the rewrite dropped, and "Documentation and backlog edits land before the first cumulative assessment", whose 2026-10-17 recurrence followed a brief rule ("Make these edits after the task advances to documentation") that the brief gained after the entry was filed (`edc474de`, 2026-09-24). Under that narrow reading the count is about 6, not 25.

### Contestable classifications

- Review fix or instruction change: "Have revise-code trace the readers of state a repair changed" (repairs broke readers; the remedy is skill and brief text), "Keep each run's scratch files and evidence in its own folder" (raised by a review, but of the user's global rule, and the remedy is brief text), "Weigh minor fixes against the review cycle and keep the rest as follow-ups" and "Documentation and backlog edits land before the first cumulative assessment" (both prompted by the cost of repairing a review finding, but the gap is brief guidance), "Have docs reviews check dependency declarations and the links Ready cannot" (raised by the user during a review, not by a reviewer), "Acceptance reports carry a checkable evidence digest" (an assessor's incomplete verdict prompted it).
- Review fix or original implementation: "Hook-path native settings resolution cost" (carries a review receipt's finding, but its own text says "Established by execution").
- Instruction change or original implementation: the reviewer-prompt entries, whose prose lives in `internal/runtime/review.js` ("Tell reviewers and skeptics the probe copy layout", "Tell a later-pass reviewer to expect subtler defects", "Keep the review lens text in one place", "Have docs reviews check dependency declarations and the links Ready cannot"); "Backlog conventions recommend commit hashes that a pre-push rewrite invalidates" (shipped templates); and the five v3-rewrite entries, which are prose as first written for v3 but dropped v2 text.
- The user feature ideas classified by the artifact they ask to change ("Present a governing spec as a link with a change list", "Offer to revisit an entry's settled decisions before starting work", "Select Exploring drafts by number for a staged graduation", "Rename one of the two workflow files") are not defects; a reading that excludes non-defects would move them to unclear.

### What would settle the unclear entries

- Confirm when marketplace auto-update applies a pushed release; Verify the Codex handover path of 3.2.10: whether host behavior and verification debt count as an origin at all.
- Say at handover when the session runs an older release than the installed one: whether the handover acknowledgement text is skill-owned or runtime-owned.
- Codex inline-script guard parity: whether the remedy is a hook port (code) or a note in the rule (instruction).
- Mid-run follow-up capture is refused while a dispatch runs: whether the refusal is the documented serialization (then guidance) or a runtime defect.
- Report the morning report's landing time and the run's compactions; Label findings by review kind and round; Rename the init-backlog skill to setup: user requests with no gap stated and a remedy split between runtime and skills.
- Give the standard checks one input set: whether a controller's hand-built check list counts as a gap in repository tooling.
