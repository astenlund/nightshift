# Recorded decisions on the unsettleable closing hold

## Outcome and authority

A new runtime operation records the user's decision that settles the closing hold no task assessment can settle. Today, status names the user's decision as that hold's way forward, through `hold`, `stop` and the administrative close, and notes that reverting the paths settles it. Once the decision is recorded, the hold treats the paths the decision was bound to as settled for as long as their content still matches. Status, refusals and reports show those paths as settled by the user, never as established by evidence.

This is part six of step 3 in [the assessment worklist](../reports/assessment-worklist-20261018.md), shaped by the user on 2026-11-16 as that step's notes record:
- **Authority.** The operation takes the user's words and reason as controller-supplied text, as `hold` does. Independent verification of the user's reply stays with step 3b's final-gate acceptance, which [Manual gate bypass on the user's responsibility](../features/manual-gate-bypass.md) owns.
- **Reach.** It settles the one condition commitment 1 names, and nothing else. A shortfall that evidence can still settle keeps needing that evidence until step 3b, and accepting incomplete review or verification coverage at the final gate stays in step 3b. The other unrepairable conditions stay outside this part, as Out of scope lists.
- **Binding.** A decision binds the identity of its condition's inputs. A later change reaching them reopens the condition and keeps the decision as history; unrelated changes leave it standing.
- **Waiting.** The Stop hook is unchanged.

A run keeps its exact release for life: it mutates only through its retained binding, and adoption keeps that release. So the operation exists only for runs bound to this release or a later one, and for development runs. A run bound to an earlier release keeps that release's ways forward, and the release notes and the runtime reference say so.

[Assessment change conditions](assessment-change-conditions.md) is the design context, and [Documentation paths and the closing condition](documentation-paths-and-closing-conditions.md) is the sibling part whose user-decision way forward this replaces. Following [VISION.md](../../VISION.md#record-decisions-without-locking-them), a decision is provenance: a later decision records over it once its condition reopens, and the earlier one stays as history.

## Commitments

### 1. The settleable condition

The settleable set is closed; adding a kind later is a user decision. It holds exactly one kind, as status reports it at the time of the request:
- **Unsettleable closing hold.** The closing outside-documentation hold has a computed set of changed paths, and no task assessment can settle the part of that set no decision settles: every task of the run is a spec task, so none can carry a code assessment, and no spec task's governing artifacts hold every such path.

On a completed delivery, the hold gates nothing, so it is not settleable there, and no way forward there names `record-decision`.

### 2. The operation

The operation is `record-decision`, with `{condition: {kind, identity}, authority, reason}`:
- `kind` is `closing-hold`.
- `identity` is the condition identity status reported for the hold the user was briefed on: a digest of the inputs commitment 3 names, as status computed them.
- `authority` is nonempty text containing the user's actual decision.
- `reason` is nonempty: the user's reason when they give one, and otherwise the cause as the controller briefed it.

Neither text is verified against native history in this part.

**Admission.** The operation is bookkeeping, as `hold` is, because it spends no resources. It is admitted on every delivery that is not closed and skips the resource-limit and continuation-observation checks. Like `hold`, it is exempt from the controller claim. It keeps the owner and revision guards of every mutating operation.

**Refusals,** in this order:
1. A closed record refuses with `run-closed`, as it refuses every mutation, and a review context with `delivery-required`, as it refuses every delivery-only operation.
2. A `kind` other than `closing-hold`, or a missing `identity`, refuses with `invalid-request`.
3. On a completed delivery the operation refuses with `no-condition`, since the hold gates nothing there.
4. The operation reads the hold afresh. When no path is unsettled, the operation refuses with `no-condition`.
5. When the hold's unsettled part can be settled by a task assessment, or its set cannot be computed, the operation refuses with `not-settleable` and names that case's own way forward, the `no-baseline` way forward for a set that cannot be computed.
6. When the digest of the current inputs, the unsettled paths with their content identities, differs from `identity`, the operation refuses with `condition-changed`, so a decision never binds paths the user was not briefed on. The controller then briefs the user on the current hold.

Otherwise it makes one write: it appends a decision `{id, condition, inputs, authority, reason, revision}` to a run-level `userDecisions` list. The operation changes no task status, blocker, agreement, requirements revision, finding, check, closing evidence or execution status.

A decision that still applies is recorded over only once a change reopens part of its condition, as commitment 3 says. Withdrawing a decision is out of scope, as the user chose: a decision stands until its paths change, and a user who changes their mind reverts or edits the paths, or uses `hold` or `stop`.

### 3. Binding and staleness

A decision's `inputs` are every changed path of the hold that no decision settles at the time of the request, including a path an earlier decision recorded that has changed again since. Each path carries the identity of its content on disk then, computed with the Git-equivalent line-ending treatment the runtime's comparisons use, or the path's absence. A decision records that whole set, never a subset the controller picks.

Decisions settle the hold path by path:
- A path whose current content identity equals the identity a decision recorded for it is settled, and every other path stays unsettled.
- Decisions combine rather than supersede.
- A decision applies while it settles at least one path in the current set, and lapses once it settles none, whether its paths were reverted or changed again. A lapsed decision applies again whenever a current path's content returns to the identity it recorded, since that is the content the user decided on.
- Every reader of the hold, including the test of whether a task assessment settles it, judges only the paths no decision settles.
- The exception is the re-baselining of a re-recorded triage. While any path of the hold is settled only by a decision, triage keeps the earlier baseline, as it does today while the hold is unsettled. So no new baseline absorbs paths only the user settled, the decision keeps applying, and the result keeps showing what the user settled.

Each reader matches a decision's recorded identities against the content that reader compares: content on disk for the hold and closing coverage, and the imported review's snapshot entry for the closing-scope check of an import after completion.

A decision records every path its binding needs, however many, since the binding cannot drop one. Status and refusal texts name at most 20 of a decision's paths with a count of the rest, as the hold's refusal text and the closing-scope check do today.

A decision whose record is malformed, or whose inputs cannot be compared, settles nothing and is reported as a structural failure, never as a permissive reading. It leaves the other decisions' paths settled. A lapsed decision no longer gates anything, but every decision recorded in the run stays reported as commitment 5 says.

### 4. Gates

The hold is computed through one predicate, `outsideDocumentationHold`, and paths a decision settles leave its set there. So once every path is settled, `complete` no longer refuses `closing-review-required` for the hold, and every consumer that reads the predicate reads the hold as settled. A decision recorded before completion keeps applying after it: on a complete run, closing coverage does not count its settled paths as unreviewed, and the closing-scope check of a review imported after completion does not refuse them. The closing docs review, closures and verification stay owed.

`historicalDischarge` does not evaluate the outside-documentation hold, on this release or an earlier one, so a run completed through a decision stays discharged under it and does not block a later handover. Whether an earlier release's other readers of the record, such as its creation gate meeting the new history row kind and the unknown `userDecisions` field, accept the record is confirmed by the implementation against the retained earlier release. If they do not, the release notes and the runtime reference say that a session on an earlier release restarts on this release before handing over again, as the 3.3.34 notes did.

### 5. Status, ways forward and reports

**Status.**
- A delivery's status gains a run-level `userDecisions` list. Each entry carries the decision's id, condition, authority, reason and revision, its state, and the paths it currently settles. The state is `applies`, `lapsed` or `structural-failure`. With freshness verification skipped it reads `'reconcile at acceptance'`, as `specReadiness` and `staleChecks` do. On a closed record it reads `'closed'`, a deliberate difference from fields a closed record omits, so the closed record still shows what the user settled.
- The outside-documentation hold keeps its fields and presence rule, adding `identity` when it is settleable, with `changedPaths` listing only the unsettled paths. Status with freshness verification skipped reports no identity.
- `closing.docsReview.satisfied` reads true when decisions settle the hold and nothing else holds closing coverage, and the `userDecisions` list shows that the user, not evidence, settled it.
- Status inspection writes nothing.

**Ways forward.**
- **Closing hold.** The way forward of the unsettleable hold names `record-decision`, then a complete closing docs review covering every task and current on the final inputs, as the other settling routes do, beside reverting the paths and `hold`, `stop` and the administrative close. Its `complete` refusal says the same, without the "until a fresh task assessment covers them" contradiction. The Stop hook is unchanged, so with the user away the run meets today's reminders.
- **No baseline.** The runtime gives the `no-baseline` way forward, a fresh code assessment of the whole inventory, on every run today, although the documentation-paths spec already names the user's decision for a run with no task able to carry a code assessment. There it names the user's decision through `hold`, `stop` or the administrative close instead of the code assessment, for every `no-baseline` cause, since this part leaves that condition unsettleable. Where the cause is a stored baseline in Git that passes its own checks, its digest and inventory flag, but whose comparison fails, it adds that the baseline stands until the comparison can be made. The runtime tells that case apart from a stored baseline failing its own checks and from a baseline outside Git that cannot be compared, neither of which gets the clause. Elsewhere it is unchanged.

**Reports.** The completion result carries every decision recorded in the run, with its state and what it settled, in a field that says the user settled these paths rather than evidence. The hold arises only after triage, and on a handed-over run triage needs the morning report first, so a decision follows the first morning report and reaches the user through status and the completion result. The completion label, "completed with user-accepted exceptions", stays with step 3b.

## Lifecycle and consumers

`record-decision` is the only writer of `userDecisions`. A record without the field holds no decisions. Closing resets, adoption, `close` and `compact-history` preserve the list as run state, and the implementation confirms that each one does. Each decision's state is computed from current state at every reading and never persisted.

The implementation finds and settles every reader of the hold, so that each one honours a decision that applies and none counts a decision that does not. These include `outsideDocumentationHold` with `holdSettlement` and `settlesOutsideDocumentation`, the complete-run branches of `closingCoverageFailure` and `closingScopeFailure`, `nextTriageBaseline` and the completion result. This list is illustrative; the implementation's own search makes it complete.

## Instruction and reference text

Every statement of what settles the closing hold changes with this release, including statements that list the hold's settlers without mentioning decisions, statements that no recorded decision settles it, and statements that its way forward is only `hold`, `stop` or the administrative close. Examples are the runtime reference's account of what settles the hold, the operating brief's, the status rules string and the hold's refusal text. Every statement of when a re-recorded triage keeps the earlier baseline changes too, for the exception commitment 3 adds, such as the runtime reference's, the comment on `nextTriageBaseline` and those in the sibling specs, the documentation-paths spec and the independent-documentation-review spec among them. The `no-baseline` text on a run of only spec tasks changes as commitment 5 says.

Statements that say a spec-readiness cause or another condition waits for the recorded-decision operation change too. They now say that this part does not settle those conditions, and keep their other ways forward, `hold`, `stop` and the administrative close among them. An example is the spec-readiness text's phrase "until the recorded-decision operation ships".

The sweep is by claim across `internal`, `skills`, `hooks`, WORKFLOW.md, VISION.md, README.md and the specs and backlog records that state current runtime behavior, with each hit classified by its whole paragraph. Its search terms are "recorded-decision operation", "recorded decision", "user's decision", "part six", "no-baseline", `userDecision`, "settles", "settled by", "unsettled", "reverting", "fresh task assessment covers", "earlier baseline", "re-baseline", "baseline stands" and "keeps that baseline".

The runtime reference documents `record-decision`, its refusals, the `userDecisions` list, the new status fields and which runs have the operation. The operating brief states these rules:
- Ask the user first, and record their decision only after they give it.
- The briefing names the hold's paths, what the decision will and will not settle, and the alternatives.

## Related tracked work

- **The closing hold's own module.** The quick win "Move the closing hold into its own runtime module", tracked by the user's triage decision of 2026-11-13, is the first step of this part. It moves the hold and its applicability-call guidance out of `internal/runtime/lifecycle.js` with no behavior change, before this part changes them.
- **The closing hold guidance.** The quick win "Make the closing hold guidance match every run shape" lists as its first case that, on a run with no task that can carry a code assessment, the `complete` refusal and the `no-baseline` text name a code assessment or contradict themselves. This release discharges that case, both the refusal and the `no-baseline` text, and the entry drops it when the release ships. Its other cases stay tracked.
- **The baseline that fails its own checks.** The quick win "Recover an uncomparable closing baseline like a missing one" uses "uncomparable" for a stored baseline failing its own checks, which this spec calls an unusable stored baseline. It stays separate: it changes that baseline's recovery, while this part changes only the `no-baseline` text on a run of only spec tasks.

## Verification and release

Deterministic tests cover:
- a decision recorded and settling the hold, reopened for a path whose content changes, and left standing by an unrelated change;
- a path recorded by an earlier decision and changed again joining the next decision's inputs and identity;
- settlement in part and combined across decisions, with one malformed decision leaving the others' paths settled;
- a decision covering the whole unsettled set, reading `lapsed` once it settles no current path, and applying again when a path's content returns to its recorded identity;
- `condition-changed` when an already-unsettled path's content changes between the status reading and the request;
- the hold's way forward naming `record-decision` and then the closing docs review;
- a re-recorded triage keeping the earlier baseline while a path is settled only by a decision, with the decision still applying;
- a spec assessment settling an unsettled remainder whose paths are all its governing artifacts;
- the hold field absent, `complete` no longer refusing for the hold, and `satisfied` true once every path is settled;
- on a complete run, closing coverage and a closing review imported after completion honouring a decision recorded before it;
- every refusal in its order: `run-closed`, `delivery-required`, `invalid-request` for another kind and a missing `identity`, `no-condition` on a completed delivery and with nothing unsettled, `not-settleable` for a hold a task assessment can settle and for one whose set cannot be computed, and `condition-changed` when a path changes between the status reading and the request;
- a decision recorded on a stopped run by a session holding no controller claim;
- the hold's `next` and its `complete` refusal on a run of only spec tasks naming `record-decision` without the contradiction;
- the `no-baseline` way forward on a run of only spec tasks naming `hold`, `stop` or the administrative close for every cause, adding that the baseline stands until the comparison can be made only for a valid stored baseline in Git whose comparison fails, not for one failing its own checks or one outside Git, and unchanged elsewhere;
- a spec-readiness cause's text dropping its reference to the operation and keeping its other ways forward;
- `userDecisions` states `'reconcile at acceptance'` and `'closed'`, a record without `userDecisions`, a malformed decision failing closed, and the list preserved across a closing reset, adoption, `close` and `compact-history`;
- the completion result carrying an applying, a lapsed and a structurally failing decision;
- historical discharge of a run completed through a decision;
- the closing-scope check of an import after completion matching a decision against the review's snapshot entry, not disk;
- a decision over more than 20 paths recording every path while status and refusals name 20 with a count of the rest;
- status writing nothing.

Each refusal test asserts its own code and the branch under test.

Asking the user and composing the briefing are model-owned behavior. Each needs a per-host live claim under a budget the user sets when that evidence is gathered (live-claim: provisional on Claude Code; live-claim: provisional on Codex).

The release takes a monotonic version increase in both plugin manifests, a regenerated release manifest and CHANGELOG.md notes, including the instruction word change that step 6's interim rule requires. The worklist records part six as shipped, with part two remaining.

## Out of scope

- Part two's status.next conditions for other gates.
- Step 3b's acceptance of unmet obligations, the verified reply, the completion label, publication and the stamp.
- Settling any coverage shortfall by decision, including settling a spec-readiness hold through `spec-accepted` or the user's acceptance generally, which earlier worklist text placed with this part and which stays with step 3b.
- Every spec-readiness cause, which keeps today's ways forward:
  - an unresolvable spec link: a run keeps its exact release, so runs that can hold one never gain the operation, and runs on this release reach one only through the case-variant exception [Spec readiness as a condition](spec-readiness-conditions.md) names, a link that becomes unresolvable when the filesystem stops establishing file identity;
  - an unusable spec value;
  - a missing, directory or unsafe spec file. Many runtime readers derive inputs or paths from `agreement.spec`, so a later design could settle the value and file causes by amending the agreement to drop the spec reference rather than overriding the value.
- A missing or unusable spec on a docs, lore or spec task.
- Closing changes since triage that cannot be established. A missing baseline on a run of only spec tasks, an unusable stored baseline and a baseline outside Git that cannot be compared are tracked for after [the store v4 cut](../features/store-v4-cut.md). A failing comparison against a stored, valid baseline in Git is not tracked there, since it waits until the comparison can be made.
- A Stop-hook rule that pauses a run whose only way forward is a settleable condition without a blocker.
- Withdrawing a recorded decision. A decision stands until its paths change, so a completion after a user changed their mind without changing the paths still shows those paths as settled by the user.
- The permission-only bug in `unblock`.
- The revalidation remainder of part five.
