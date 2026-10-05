# Changelog

Release notes for the Nightshift plugin, newest first. The plugin manifests carry the current version. Deterministic and zero-inference checks remain distinct from model-owned observations.

The entries through 3.3.3 were moved here from the README on 2026-10-05 and split by version. A version without an entry had no notes recorded there.

## 3.3.6

- Native process inspection, which identifies the controller for claims, the session's activation owner at admission and the runtime's own helper before a check, probe or dispatch, now allows 30 seconds in total instead of a fixed 10, and retries once an attempt that fails before its time is up; a registered hook keeps a 10-second total, retry included, inside the host's 60-second hook timeout. A failed inspection still grants nothing, and the refusals that rest on it now name its cause, such as a timeout or PowerShell's exit code with an excerpt of its error output: `operation-owner-unavailable`, the claim reason and `controller-claim-required`, `hook-activation-required`, which for a failed inspection says to retry rather than reopen the session, and `native-activation-unavailable` at SessionStart. Error codes are unchanged. Two live measurements through the runtime check operation, each with 48 busy-loop processes on a 24-CPU machine, timed owner lookups of the kind a controller claim makes at 8.5 to 11.6 seconds, eight of the twelve longer than the old bound, and plain lookups at 3.9 to 9.8 seconds; all twenty-four answered within the new budget. Deterministic tests simulate slow, failing and timed-out inspections. The cause of the original refusals stays inferred, since their failure output was never captured, the trigger of the recurrence seen without load was not identified, and no installed session has run the change yet.

## 3.3.5

- The runtime `history` operation lists every transition with its revision, kind and recorded time but without the run state, and returns full states only for `fromRevision` through an optional `toRevision`, at most 10 revisions, refusing other ranges with `invalid-history-range`. Every state expands the evidence it references, so on a long run the complete history failed with "Invalid string length". A deterministic test reproduced that failure before the fix, and a live check against a snapshot copy of this repository's run store reproduced it on 3.3.4 for the 706-revision run `5196a103` and showed the new default answering with every transition.
- Runtime status lists under `staleChecks` every latest named check, of any task including completed ones and of the closing record, that no longer passes on current inputs, with the reason (`inputs-changed`, `failed` or `pending`), so the controller can rerun it before task or run completion refuses; the operating brief asks for those reruns. A recorded input that can no longer be read as a regular file, such as one replaced by a directory or a link, now counts as changed wherever freshness is judged, so such evidence is stale and the brief still answers, while recording new evidence still refuses the entry; an independent review's probe showed that without this, such an entry would make every status brief fail once the list reads completed tasks' checks, including the reply to a mutation that had already been saved. Every brief carries the list, so its freshness tests run as one batch that compares each input file's bytes once across all checks and verifies line-ending renormalizations with one batched Git hash, starting at most two Git processes; on this repository's runs that added about 0.1 s to a status brief, where testing each check separately had added up to 1.5 s and tripled the runtime suite's time. A live check against this repository's completed run `5196a103` matched the list with an independent byte comparison of each check's recorded inputs; the controller's use of the list is model-owned behavior with no installed-host observation yet.
- Launcher calls wait up to 30 seconds, instead of 5, for another process's write transaction on the retained registry, and the bootstrap now sets that wait before its first read, so a read-only `status`, `inspect` or `wait` rides out a lock that a running check or dispatch holds for up to that long instead of failing with "database is locked"; the launcher's read-only reads of the project's run store, which had no wait at all, now wait up to 5 seconds for a commit, as the runtime's own store connections do. Hooks keep their earlier bounds, the bundled notice hook included, and a hook's preliminary run read still does not wait. A deterministic test reproduced each failure through the bootstrap before its fix: a 7-second reserved registry lock, a 7-second exclusive registry lock, which every registry commit takes while it writes, and a 3-second exclusive lock on the run store, each giving the same "database is locked" error the bug recorded. A measurement on a scratch copy of the retained store, with three concurrent callers while the runtime test files ran, found holds of up to 2.8 seconds and one wait of 4.8 seconds; the longest holds came from reconciling every session binding of the project after an operation, which grows with the number of bindings. Which connection held the lock in the originally reported failures was not identified, that measurement on the unchanged code saw no failure, and no installed session has run the fix yet, so the evidence is the deterministic reproduction of each closed path. The bootstrap carries the bound, so it reaches an installed session once the next preparation installs the new administrative bootstrap.
- After a repair, status lists a reviewer to resume only when findings await its closure. An assessment of another review kind that the repair made stale appears instead under `freshTargets` as a fresh assessment due, naming the task to dispatch it on: for a completed task, an open code or docs task whose assessment covers it, so the completed task is no longer reopened, and only when none can cover it the completed task itself, marked as reopening it. The operating brief stops resuming such reviewers, which had nothing to close and needed a fresh assessment afterwards anyway, and dispatches the fresh assessments once the repaired kind's own cycle has settled; the hook's lightweight brief marks the list for reconciliation at acceptance. No completion gate changed. Deterministic tests cover the open, completed-and-covered and completed-and-uncovered cases; the controller's use of the list is model-owned behavior with no installed-host observation yet.

## 3.3.4

- Ready reports a `**Requires:**` or `**External:**` line written on a quick win with one notice for `QUICK_WINS.md`, naming the count and the first such entry, instead of dropping it silently; quick wins stay always ready and dependency-free, the quick-wins template says so, and the Exploring skill's graduation step declares no dependency line on an entry that becomes a quick win. Parser fixtures cover the cases.
- A docs review alone now covers edits to `.nightshift/reports/` and to Markdown files at the project root other than `AGENTS.md`, `AGENTS.override.md`, `CLAUDE.md` and `CLAUDE.local.md`, besides the backlog: a code assessment stale only through those paths counts as current once a current docs review covers the task, the closing record accepts them after triage, and the outside-Git triage baseline reads them. Governing specs, skills, the operating brief, runtime references, templates, nested Markdown and other files keep needing code reassessment, and the operating brief asks for one anyway when a covered path holds operating instructions. Deterministic fixtures cover the paths; the run that delivered this was bound to 3.3.3, so no live run has used the wider relief yet.
- The runtime status and `create` result carry a `scratch` section that warns when `.tmp` is not ignored and names tracked scratch and the commits after the run's review base that added it, and `complete` refuses with `committed-scratch` while the index holds `.tmp` paths that base did not track or when Git cannot answer. The ignore check samples two file names and stays a heuristic. The operating brief's guidance to keep scratch in the ignored `.tmp` and report the notices is model-owned behavior with no installed-host observation yet; the runtime checks rest on deterministic fixtures.

## 3.3.3

- Review attempts now record their own token usage: a Codex attempt that ends as an output loop keeps the usage its host reported instead of none, and a resumed Claude attempt records its own share instead of the whole session's running total, so totals built from review receipts no longer drop or double count it. A live check on Claude Code 2.1.288 confirmed that a resumed session reports a running total and that the runner now records only the resume's share; the Codex output-loop path rests on the deterministic suite.
- The operating brief now says that review, skeptic and dialogue dispatches need no token budget and that a token or cost limit the user gives covers live verification unless the user says otherwise; this is model-owned behavior with no installed-host observation yet.

## 3.3.2

- The operating brief asks the user before a destructive, irreversible or outward-facing action that recorded authority does not cover, and with no user available blocks the task that needs it on a user decision while independent work continues; it also has the controller name the run's intended branch and checkout in its objective and confirm after every commit, its own or a helper's, that the commit landed there. Both are model-owned behavior with no installed-host observation yet.

## 3.3.1

- The ready parser takes `--check`, which keeps its report and exits nonzero unless the parse is clean, with no structural error, notice or missing index, and the operating brief records the ready parser check with it, so a backlog with structural errors no longer passes that check; the guidance to use it is model-owned behavior with no installed-host observation yet.

## 3.3.0

- A review loop continues the reviewer that raised a finding: after a repair, the runtime resumes that reviewer's own session on Claude Code or Codex in a new private copy to record the repair's closure, a replacement stands in when a session cannot be resumed, every confirmed skeptic verdict proposes the repair's approach, and the controller can relay a dialogue between reviewer and skeptic. Only a fresh-context assessment passes a review gate, so every loop that continued a reviewer ends with fresh eyes.
- The [acceptance report](.nightshift/reports/resumable-reviewer-dialogue-20261001.md) records an installed-host campaign on both hosts: resumed reviewers read their new copy, closed a repaired finding and reported a partly repaired one again, replacements stood in after forced resume failures, and skeptics gave repair proposals and dialogue replies. A gate passing on a fresh assessment rests on the deterministic suite, and the controller's own use of the new guidance is model-owned behavior with no installed-host observation yet.
- A failure to write an attempt's own artifact files now keeps its operating-system error, and a Windows-job host whose attempt fails before the job reports its start is now told to terminate rather than left running.
- A closing finding not yet settled now survives re-recorded triage or a reset of closing evidence instead of being dropped.

## 3.2.17

- An edit elsewhere in the project no longer throws away a running spec assessment: like an imported one, it now watches only its governing artifacts, normally the spec, among the project's files. Code, docs and skeptic assessments still watch the whole project, a reviewer of any kind that changes a file of its own copy still fails its dispatch, and the runtime reference now says that a change fails such a dispatch at its end, after its usage is spent.
- The user's acceptance of a governing spec is recorded with the runtime `spec-accepted` operation, bound to the spec's content and kept out of both the spec's text and the commitments assessments bind, so recording it no longer makes a clean assessment stale; the guidance to use it is model-owned behavior with no installed-host observation yet.

## 3.2.16

- Documentation gets its own strong independent review: revise-docs obtains a `docs` assessment of its complete change, code and docs tasks cannot complete without one unless a purely mechanical change records its exemption, backlog-only edits no longer force a code reassessment once a docs review covers them, and tracking edits made after triage are reviewed through a closing docs review, including after a handed-over run has completed; the [acceptance report](.nightshift/reports/independent-documentation-review-20260929.md) records its live evidence on Claude Code and leaves Codex unverified.

## 3.2.15

- A runtime check or probe finishes when its command exits: a descendant still running 5 seconds later, such as the compiler server a `dotnet build` leaves behind for reuse, is ended and named in the result instead of holding the check until its time bound, and a timeout gives a job runner that is still starting on a loaded machine 30 seconds to prove its processes ended rather than reporting unverified termination.

## 3.2.13

- A controller claim whose native process ancestry reaches an exited parent, as when Git Bash starts the launcher through `sh` or `bash` running a script, names the last live process below that parent and suggests running `node` directly or through PowerShell 7; such a claim still grants nothing.

## 3.2.12

- A readback ends with a plain question asking whether to begin the work, and agreeing with an idea, wording or direction during discussion is not agreement to implement it; this is model-owned behavior with no installed-host observation yet.
- The Stop hook resumes a handed-over controller at the run's current revision, and review, check, skeptic, spec and probe evidence stays current across a line-ending renormalization that leaves the content Git would commit unchanged; other Git transformations keep the byte comparison, and a stored probe result reaches the next assessment only when the reviewed bytes are unchanged.

## 3.2.11

- The operating instructions state reliability as the invariant priority, with autonomy and trust as equal parts and speed and economy counting only where they cost neither.

## 3.2.10

- A handover on Claude Code runs unattended once the registered Stop hook is verified, since that host has no native goal and its models do not yield early, while Codex still needs a native goal, and the acknowledgement of such a handover ends its turn by saying plainly that it is accepted; the [acceptance report](.nightshift/reports/unattended-stop-hook-20260926.md) records one observation each on Opus and Fable under Claude Code and leaves the Codex lane unverified.
- Review and probe copies sit in short directories under `.nightshift/runs/c/`, 86 characters shorter for a probe and 44 for a review, and the suites that failed on Windows path length from a copy of this repository now pass there.
- One cumulative code assessment covers the completed code and docs tasks of a run together, whichever of them it was dispatched on.
- The morning report ends with its pending follow-ups and a ready-to-triage question, and every follow-up then goes through the host's question tool; the [acceptance report](.nightshift/reports/host-question-triage-20260926.md) records one observation on Claude Code and leaves Codex unverified.

## 3.2.9

- Ready reports, as notices, backlog links and heading anchors that no longer resolve, active index entries whose title differs from the record they link, and backlog records that no index reaches, and the init-backlog templates spell the empty dependency line as `**Requires:** none.`, the form the parser accepts.

## 3.2.8

- A host process that Windows cannot start reports its executable, the launch stage that failed and, where Windows refused to create the process, the Windows error.

## 3.2.7

- A review dispatch whose attempts cannot fit the launcher's time bound is refused before any worker is reserved, every attempt, check and probe ends before that bound, a Codex reviewer stuck streaming whitespace is ended so its fallback can run, and a runtime request with a missing or unknown action is refused with the accepted actions.

## 3.2.6

- The Stop hook stays silent after each reply in an attended run without a handover, and a probe with an unresolvable executable or an out-of-range timeout is refused before reserving a worker.

## 3.2.5

- A bare executable name in runtime checks resolves from PATH, and an assessment made stale by later edits is named.

## 3.2.4

- Ready recommends a small selection, turns a reply that names no items into a proposed selection to confirm, and continues agreed work in the current session without a handover or separate-task question; the [acceptance report](.nightshift/reports/ready-selection-boundary-20260924.md) records its installed-host evidence on both hosts.

## 3.2.3

- Added safe run adoption and reliable renewed continuation under the [agreed executive scope](.nightshift/specs/run-adoption-and-continuation-executive.md). Installed checks demonstrate the eight takeover combinations, preserved work and reports, renewed Codex goal continuation, and native Stop/admission recovery on both hosts. Both hosts also demonstrated unavailable-claim handling and unknown-controller refusal. The [acceptance report](.nightshift/reports/run-adoption-and-continuation-20260921.md) states the exact evidence and remaining native limitations; the [technical design](.nightshift/specs/run-adoption-and-continuation.md) preserves the compatibility contract.

## 3.2.2

- Recoverable setup and unwrap, recorded in its [report](.nightshift/reports/recoverable-unwrap-20260921.md).

## 3.2.0

- The [handover report](.nightshift/reports/handover-transition-and-morning-report-20260919.md) preserves its evidence and qualifications.

## 3.1.1

- Invoking a skill prepares Nightshift automatically. Ready and Exploring can list work before background continuation is enabled. When another operation needs host approval or a reopened session, Nightshift explains the specific action required. The [acceptance report](.nightshift/reports/automatic-plugin-preparation-20260915.md) records the assessments and checks, the confirmed hook-disabling defect found after them, its repair, and the clean cumulative strong assessment that preceded publication.

## 3.1.0

- The independent assessment and installed-model acceptance are recorded in the [retained-release report](.nightshift/reports/retained-plugin-releases-20260914.md), which preserves its evidence and qualifications.

## 3.0.0

- The [v3 MVP report](.nightshift/reports/v3-acceptance-272m-20260910.md) preserves its evidence and qualifications.
