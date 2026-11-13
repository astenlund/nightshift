# Documentation paths and the closing condition

## Outcome and authority

Edits to documentation paths stop affecting code assessments, so backlog, report and root-Markdown edits can land at any point of a task without a reassessment or a prior docs review. After triage, a closing docs review is imported whatever else changed: the non-documentation changes become a condition that holds run completion until a fresh task assessment covers them or they are reverted, and, as today, a current closing docs review must also cover the changed code as context. A clean assessment imported after triage no longer reopens a completed task or clears the closing evidence.

This covers the rest of part one and all of part four of step 3 in [the assessment worklist](../reports/assessment-worklist-20261018.md):
- **Part one (rest):** retire the documentation relief and settle applicability at the final gate.
- **Part four:** the closing record imports a closing review whatever changed since triage, and `complete` holds on the non-documentation changes.

[Assessment change conditions](assessment-change-conditions.md) is the design context, and [Spec readiness as a condition](spec-readiness-conditions.md) is the sibling part this follows. Until [the recorded-decision operation](../features/manual-gate-bypass.md) ships as part six, no hold here is settled by the user's decision alone. Where commitment 4 names the user's decision as the way forward, the runtime offers only the existing `hold`, `stop` and administrative `close`.

## Commitments

### 1. Documentation paths are not code-assessment inputs

**Where it applies.** The rule applies to a delivery run created with the docs gate, to the code assessment of every task, whatever its kind. When the runtime compares that assessment with current inputs, it ignores changes to documentation paths.

**What counts as a documentation path.** The set is the one `isDocumentationPath` in `internal/runtime/lifecycle.js` defines today, unchanged:
- the backlog indexes and their history files;
- the record directories under `.nightshift`;
- `.nightshift/reports/`;
- Markdown at the project root other than host instruction files.

**Exceptions.** A path stays an input wherever it lives when it is either:
- the task's governing spec;
- a governing artifact named in the assessment's recorded commitments.

**Every comparison of that assessment with current inputs follows the rule, at import and afterwards,** except `nextTriageBaseline`'s whole-inventory freshness test, which "What stays unchanged" keeps. That includes its own applicability, a relevance decision over it, original reversion, `freshTargets` after a repair, historical discharge, and the `review` import's own test of whether the assessment is historical, which decides whether a continued reviewer's closures are recorded and whether the import resets or reopens. As a result, a run completed under this rule stays discharged, a decision is not undone by a later documentation edit, and a documentation edit made during a reviewer's turn neither drops its closures nor makes its import historical.

**What still reviews documentation.** Each code and docs task still needs a current docs review or a fresh mechanical exemption before it completes. No docs gate covers a lore task, so its documentation-path edits are independently reviewed only when they come after triage, by the closing docs review.

**What stays unchanged.** These keep today's comparison, and today's documentation relief and its `applicable-by-docs-review` status value where they apply today:
- spec assessments, which compare their declared deciding inputs, and docs assessments, which compare every path;
- checks, which compare their declared inputs;
- review contexts and runs without the docs gate;
- the triage baseline's own comparison, and `nextTriageBaseline`'s test of whether a task assessment is fresh against the whole inventory, which judges whether every change since the baseline, documentation included, was reviewed.

**What retires.** On a docs-gated run, `documentationRelief` and the `applicable-by-docs-review` status value no longer arise for any task. In each `assessmentApplicability` entry on such a run:
- the ignored paths appear as `documentationPaths`, sorted project-relative paths, present only when nonempty, and never also listed in `changedPaths`;
- an entry whose only changes are such paths reads `applicable`.

Every consumer of that status value set keeps handling the value wherever it still arises.

**Effect on refusals.** A documentation-only edit never makes `advance` refuse `review-required`, never makes `complete` refuse `stale-review` and never names a fresh code target, whichever stage the task is in.

### 2. Relevance call first

Every status field and refusal that names the way forward for a code assessment pending because non-documentation inputs changed follows one predicate: an applicability call is available exactly when the `applicabilityCall` defined below would be non-null. When it is available, the surface names the call first: resume the originating reviewer, or dispatch its independent replacement when it cannot be resumed, with a fresh cumulative assessment as the fallback. When it is not, the surface names the fresh cumulative assessment first, or reconciliation for an `unestablished` cause.

The decision points this changes:
- **The assessment's `assessmentApplicability` entry.** Its `next` follows the predicate.
- **`review.freshTargets`.** Today it names a fresh assessment and says the stale reviewer is not resumed. Each element of an entry's `staleChanges` gains `applicabilityCall: {taskId, requestId, taskIds, resume, continue}`:
  - `taskId` is the owner holding that stale assessment, the target the call is dispatched on, as `resumeTargets` names a dispatch's task;
  - `requestId` is that stale assessment, the one the call judges, as `relevance.requestId` names it;
  - `taskIds` is the sorted list of the stale gates' tasks that the element covers and that lie within that assessment's `coveredTaskIds`, as `relevance.taskIds` takes them, apart from each task whose latest applicability decision on the current inputs and commitments already answered `reassess` or `unresolved`;
  - `resume` is the latest dispatch that produced a receipt in that assessment's lineage on its owner, the dispatch `resumeTargets` would name;
  - `continue` is `resume` or `replace` for that dispatch, by the rule `resumeTargets` uses.

  `applicabilityCall` is null in exactly these cases:
  - its cause is `unestablished`, where reconciliation is the way forward as the applicability entry's `next` says;
  - for every task the element would name, the latest applicability decision on the current inputs and commitments already answered `reassess` or `unresolved`;
  - the stale assessment is continued, incomplete or narrow, so not a complete fresh assessment covering its kind's dimensions; a change of commitments alone does not make the call unavailable, since a preserving decision bound to the current commitments can settle it;
  - the run's outside-documentation condition (commitment 4) is unsettled, the element's changed paths include a path in its set, and the hold holds the element: a code-kind or docs-kind element always, and a spec-kind element only in a run whose hold a whole-spec assessment settles, as commitment 4 defines it: a preserving answer would pass the task gate but cannot settle the hold, which a settling assessment or reverting the paths settles and a relevance call does not;
  - its original inputs are not retained, so a preserving answer would be refused;
  - it has no request id, or its lineage has no dispatch with a receipt.

  In the hold case, the hold's `next` is the element's way forward, for code-kind and docs-kind elements alike. A spec-kind element the hold does not hold keeps its call, which settles spec readiness as [Spec readiness as a condition](spec-readiness-conditions.md) settles, while the hold is settled separately, since a fresh code assessment cannot make a stale spec assessment current. In every other case but the first, the entry's fresh assessment is its way forward. Docs-kind elements carry a call by the same rule. Otherwise the entry's fresh assessment is the fallback.
- **The refusals.** Both `review-required` at `advance`, whose text is `STALE_REVIEW`, and `stale-review` at `complete` follow the predicate for each stale assessment they name.

An earlier non-preserving decision whose inputs have since changed does not make the call unavailable, so it still leads to a new call. The implementation finds any other surface that names this way forward and orders it by the same predicate. This is guidance only: the runtime records nothing about the choice and refuses nothing over it.

### 3. The closing review imports whatever changed

On a running run, `review` on the closing record no longer refuses `closing-scope` because non-documentation paths changed since the triage baseline. On a complete run, where closing work is owner bookkeeping and no task assessment can be dispatched, that refusal stays as today. These refusals stay, unchanged, on every run:
- `closing-scope` for a missing baseline;
- `closing-scope` for a difference that cannot be established;
- `closing-scope` for malformed selected-only provenance.

A closing review remains a docs assessment. Its findings, repairs and checks are recorded as today and never reopen a task.

### 4. Non-documentation changes since triage hold completion

The paths that changed since the closing baseline and are not documentation paths form the run's outside-documentation set. The same exclusions apply as today: the latest closing review's `excludedPaths`, and selected-only context paths absent from the baseline.

**How the set is kept.** The set is recomputed at every reading, never persisted. Reverting a path removes it.

**When the condition is unsettled.** The condition is unsettled while the set is nonempty and no settling assessment exists. A settling assessment is a complete, fresh (not continued) code assessment of any of the run's tasks, whatever its kind, whose applicability on current inputs reads `applicable` and whose scope positively held every path in the set: no exclusion of its own names the path, and either its recorded snapshot lists the path or the path is absent now and lay within the scope it inventoried; a path whose standing cannot be read counts as unseen. In a run with no task that can carry a code assessment, a spec task's complete, fresh whole-spec assessment reading `applicable` also settles it, but only when every path in the set is that task's governing spec or a governing artifact named in its recorded commitments, the exception set commitment 1 uses; paths the controller declares as further deciding inputs never count.

The condition is evaluated on every run that is not complete and has a closing baseline, as Baseline cases states, a stopped or held run included, so it holds both of `nextTriageBaseline`'s re-baselining branches whenever triage can be recorded, and a stopped run's status reports `outsideDocumentation` as a running run's does. On a complete run, `outsideDocumentation` is absent and closing coverage keeps today's reading, in which a non-documentation change since triage reads as not covered.
- **A relevance decision does not settle it**, because a preserving applicability call says the change leaves an earlier assessment standing, not that the changed code was reviewed.
- **The closing review does not settle it**, because it is a docs assessment.

Every consumer reads that one predicate, never the raw set: `complete`, `satisfied`, the presence of `outsideDocumentation` and its `next`, and `nextTriageBaseline`. While the condition is unsettled, `complete` refuses `closing-review-required` with a message naming the paths and saying that reverting them also settles it. Documentation paths changed since triage still need the closing review, exactly as today.

**The docs side.** Docs assessments keep comparing every path (commitment 1), so a non-documentation edit after triage also leaves stale every task docs review, every docs exemption and any closing review imported before it. Completion therefore also needs, as today's gates already require, a complete closing docs review that covers every task and is current on the final inputs. That one review satisfies each task's docs gate as a covering docs review, and closing coverage. The hold's `next` and refusal message name both steps in order: the settling assessment (or the revert), then that closing docs review.

**Status.** `closing.docsReview` gains `outsideDocumentation`, present only while the condition is unsettled. After a reset clears the closing record on a run that is not complete, the condition is judged against the baseline the reset carried forward, and `outsideDocumentation`, with the same shape and presence rule, sits directly under `closing` until a closing record exists again. It holds:
- `changedPaths`: the set as sorted project-relative paths, or null when the set cannot be computed;
- `next`: one sentence.

When `changedPaths` is null, `next` names the `no-baseline` recovery the failure branches state. Otherwise `next` also says that reverting the paths settles the condition, and: every task except a spec task can carry a code assessment, and when the run has such a task, `next` names a fresh code assessment on one of them, listing their ids, with the changed paths passed as `artifactPaths`, since a dispatch need not select an ignored path into its scope by itself, followed by the closing docs review the docs side requires. It lists first the tasks whose fresh code assessment would also cover the run's other code gates the same edit staled, by the `coveredTaskIds` rule of the cumulative assessment. When the run has none but every path in the set is a spec task's governing spec or a governing artifact named in its recorded commitments, `next` names a fresh whole-spec assessment on that spec task, followed by the closing docs review. Otherwise it names the user's decision, which until part six ships means `hold`, `stop` or the administrative `close`. `satisfied` reads false while the condition is unsettled. A task code gate the same edit staled that the chosen assessment does not cover is reported separately, by `stale-review` with the way forward commitment 2 sets.

With freshness verification skipped, `outsideDocumentation` and `satisfied` both read `'reconcile at acceptance'`, as `current` already does.

**Baseline cases.** The outside-Git baseline case and the missing-baseline case keep their current causes. On a run whose closing baseline is the outside-Git documentation baseline, which holds documentation files only, the outside-documentation condition is not evaluated: `outsideDocumentation` is absent, and completion and `nextTriageBaseline` read as today. The condition is not evaluated either while the run has no closing baseline to judge against: before its first triage, or after a reset when no triage had recorded a baseline, missing or not. Those are the only cases in which it is not evaluated on a run that is not complete; a closing baseline that is missing, whether on the closing record or carried forward by a reset, takes the failure branch's status shape, as Lifecycle and consumers states. Over a recorded earlier baseline, a re-recorded triage keeps that baseline while the condition is unsettled, whichever of `nextTriageBaseline`'s branches would otherwise re-baseline: the closing-review branch and the task-assessment branch each re-baseline only when the condition is settled. The earlier baseline also stands, as today, while documentation paths changed since it lack a current closing review and no task assessment is fresh against the whole inventory, every path compared. Recording triage again over a recorded baseline therefore never absorbs unsettled non-documentation changes, through a docs review or any other assessment that does not settle the condition, nor documentation changes no review has covered. Over a missing baseline, the failure branch under Lifecycle and consumers is the one rule.

### 5. A clean assessment after triage leaves closing intact

After triage evidence is recorded, a `review` import on a completed task leaves the task complete at its current stage, keeps its docs exemption record, and clears none of the closing evidence (retrospective, report, delivery or triage) when all of these hold:
- the review is not a relevance decision;
- it is current on current inputs;
- it is not superseded;
- it raises no findings;
- it is itself an assessment its gate accepts: complete and fresh (not continued), covering its kind's dimensions, and bound to the task's current commitments.

The test concerns the import alone. Other unmet conditions, such as stale docs reviews or a stale check, stay with `complete`'s existing refusals and never reopen the task. Among clean imports on a completed task after triage, only one that is not a relevance decision, not historical and not superseded, yet fails that test, such as an incomplete, continued or narrow one, reopens the task to review as today. Clean relevance decisions and clean historical or superseded imports keep today's behavior: they leave the task as it is and clear nothing.

A kept exemption still counts toward the docs gate only while it is fresh, as today, so after a non-documentation edit the closing docs review commitment 4 names takes its place. An import that raises findings reopens the task to review and resets closing exactly as today. Imports before triage evidence exists are unchanged. The closing record and its baseline survive the import in every case except a reset.

`review.freshTargets` predicts this with each entry's `reopens` flag. Before triage evidence exists, `reopens` is true for a dispatch on a completed task, as today. After triage it is `'if-findings'` for such a dispatch, meaning the task reopens only if the import raises findings or is not an assessment its gate accepts. It stays false for a dispatch on an open task.

## Instruction and reference text

**Claims to sweep.** Every statement of the behavior above changes with it. The implementer finds them by sweeping for each claim and classifying each hit by its whole paragraph:
- documentation relief and `applicable-by-docs-review`;
- `closing-scope`;
- tracking edits after triage staying within documentation;
- a closing finding whose repair lies outside the documentation paths;
- an import or assessment on a completed task reopening it;
- the ordering rule "land backlog and documentation edits after the task advances to documentation".

**Where to sweep.** `internal`, `skills`, `hooks`, WORKFLOW.md, VISION.md, README.md, [assessment change conditions](assessment-change-conditions.md), and the backlog records under `.nightshift` that state current runtime behavior.

**Known hits:**
- the runtime reference's documentation-path paragraph, its closing-record paragraph and its applicability paragraph;
- the obligation brief's rules sentence on tracking edits after triage;
- the operating brief's ordering sentence;
- the `STALE_REVIEW` text;
- the runtime reference's `freshTargets` sentence that a dispatch on a completed task reopens it, and the matching comment on `freshAssessmentTask` in `internal/runtime/lifecycle.js`.

**The ordering guidance becomes this.** Documentation-path edits the agreed outcome commits to land with the implementation, before the first cumulative assessment. Edits to governing specs, operating instructions and other Markdown below the project root outside the documentation paths are code inputs, as is a governing spec kept at a documentation path; before triage the reviewer's applicability call settles a compatible one, and after triage such an edit outside the documentation paths falls under the outside-documentation hold, which a settling assessment or reverting the paths settles and a relevance call does not.

**Backlog effects.** This closes the quick win [Documentation and backlog edits land before the first cumulative assessment](../QUICK_WINS_HISTORY.md#documentation-and-backlog-edits-land-before-the-first-cumulative-assessment), which moves to its history file when this ships. The worklist records the rest of part one and all of part four as shipped.

## Lifecycle and consumers

No state is added or persisted. The outside-documentation set and the documentation-path filter are computed at each reading.

**Readers the implementation enumerates and settles.** Every reader of a code assessment's applicability, including:
- `reviewGateFailure`;
- `staleGateEntries` and `freshTargets`, including its `applicabilityCall` and `reopens` slots;
- `assessmentApplicability`;
- `historicalDischarge`;
- the relevance decision comparison;
- original reversion;
- `nextTriageBaseline`, both of whose re-baselining branches read the outside-documentation predicate in addition to their existing tests, as commitment 4's baseline cases state; its task-assessment freshness test is not a filtered applicability reader and keeps comparing every path.

**Readers of the closing coverage.** Settled the same way:
- `closingCoverageFailure`;
- `closingDocsBrief`;
- `complete`;
- the progress and reminder consumers.

**Writers whose effects change.** `review`, for the closing scope, the reset and its historical classification, which decides closure recording; and `triage`.

**Failure branches.**
- A comparison that fails is a structural failure, never a clean result.
- A governing spec whose identity cannot be established counts as a changed input.
- An outside-documentation set that cannot be computed, because the closing baseline is missing or a Git-inventory baseline's comparison fails, counts as unsettled for every consumer until a triage records a new baseline as below: completion holds with the existing `no-baseline` cause; `outsideDocumentation` is present with `changedPaths` null and a `next` naming that cause's recovery, obtaining a fresh code assessment of the whole inventory and then recording triage again once Git can inspect the project; and both of `nextTriageBaseline`'s re-baselining branches keep the earlier baseline. A missing earlier baseline gives way to the inventory at a re-recorded triage only when a complete, fresh (not continued) code assessment of one of the run's tasks is fresh against the whole inventory, every path compared, which is the one assessment that lets triage take the inventory over a missing baseline, after which the condition is judged against that new baseline; a docs review never qualifies, and a run with no task that can carry a code assessment keeps the baseline missing, with the user's decision as its way forward. Otherwise it stays missing, so the condition stays unsettled, and a reset carries it forward as missing rather than dropping it. The first triage, with no earlier closing baseline, takes the inventory as today.

## Verification and release

Deterministic tests cover:
- **Edits that no longer stale a code assessment.** A backlog edit, a report edit and a root-Markdown edit, each leaving the code assessment `applicable` with `documentationPaths` listed, made:
  - while a code task is in review, where `advance` is admitted with no `review-required` and no docs review yet imported;
  - while it is in documentation, where `advance` refuses only `docs-review-required`, never `review-required`, and is admitted once its docs review is imported;
  - after it completed, where no fresh code target is named and `complete` raises no `stale-review`;
  - for an assessed lore task before triage, where its `advance` raises no `review-required`.
- **Edits that still stale it:**
  - a feature record that is the task's governing spec;
  - a host instruction file at the root;
  - a Markdown file below the root.
- **Unchanged behavior:** a run without the docs gate and a review context, each still applying today's relief and reporting `applicable-by-docs-review`.
- **Decisions and history:**
  - a relevance decision followed by a documentation edit, still applicable by decision;
  - a run completed under the new rule staying historically discharged;
  - a continued reviewer's import after a documentation-only edit made during its turn still recording its closures.
- **Status guidance:**
  - the `assessmentApplicability` entry's `next`, each `staleChanges` element's `applicabilityCall`, and the `review-required` and `stale-review` refusals each naming the applicability call first;
  - a `freshTargets` entry covering two stale assessments from different lineages, each with its own `applicabilityCall` naming its owner `taskId`, its `taskIds` and its lineage's latest dispatch;
  - for a stale assessment whose original inputs are not retained, and for one without a request id, the applicability entry's `next` and the refusal text naming the fresh assessment first, consistent with a null `applicabilityCall`;
  - a stale assessment without a request id, an element whose cause is `unestablished`, and a stale continued or incomplete latest assessment, each with a null `applicabilityCall`;
  - after a current `reassess` answer and after a current `unresolved` answer, a null `applicabilityCall` and refusal text naming the fresh assessment first;
  - after an earlier `reassess` answer whose inputs have since changed, a new applicability call named first.
- **Closing review import and the outside-documentation hold:**
  - a closing review imported after a post-triage code edit;
  - `complete` refusing with the path named;
  - a relevance decision not settling it;
  - a clean fresh code assessment of a code task settling it;
  - in a run of only lore tasks, a lore task's clean fresh code assessment settling it;
  - reverting the edit settling it;
  - after a code-only edit following triage and the settling code assessment, `complete` still refusing for the stale docs reviews until a closing docs review covering every task is current, then completing, with `next` naming both steps in order;
  - a closing review imported, then a code edit, then triage recorded again, still reporting the hold against the earlier baseline;
  - after triage, a code edit, then a clean task docs review imported on a completed task, then triage recorded again, still reporting the hold against the earlier baseline;
  - after triage, a code edit, then a closing or task docs review imported, then `hold`, triage recorded again while stopped, and `resume`, still reporting the hold against the earlier baseline, with the stopped run's status reporting `outsideDocumentation`;
  - a run of only spec tasks whose governing spec changed after triage, settled by a fresh whole-spec assessment of that spec task, with `next` naming it;
  - a run whose only tasks cannot carry a code assessment and whose changed paths are not all one spec task's governing artifacts, reporting the user's decision as the way forward;
  - in a run with a code task, a spec assessment whose deciding inputs include the edited code file not settling the hold;
  - on a complete run, a closing review import over a non-documentation change still refused `closing-scope`, and a non-documentation edit after completion leaving `outsideDocumentation` absent with closing coverage reading as today;
  - on a docs-gated run with only lore and spec tasks, a documentation-only edit after triage followed by triage recorded again still holding `complete` with `closing-review-required`;
  - `next` listing first a task whose assessment would cover the other stale code gates, and a lore task's code gate staled by the same edit reported by `stale-review`;
  - with freshness verification skipped, `outsideDocumentation` and `satisfied` reading `'reconcile at acceptance'`;
  - an outside-documentation set that cannot be computed reporting `changedPaths` null with the `no-baseline` recovery: with a failed comparison, a triage recorded again meanwhile keeping the earlier baseline; with a missing baseline, a triage recorded again keeping it missing until a code assessment of a task is fresh against the whole inventory, then taking the inventory, a fresh whole-inventory task docs review leaving it missing, and a reset carrying it forward as missing;
  - an element covering two tasks, one with a current `reassess` answer, carrying an `applicabilityCall` whose `taskIds` names only the other;
  - a project outside Git with nothing changed since triage still completing as today, with `outsideDocumentation` absent;
  - while the hold is unsettled, a stale code assessment whose changed paths lie in its set carrying a null `applicabilityCall`, its surfaces naming the fresh assessment first;
  - in a run with a code task and a governing-spec edit after triage, the stale spec-kind element keeping its `applicabilityCall` while the code-kind element's is null;
  - a code assessment whose scope never held a changed, git-ignored governing spec not settling the hold, the code task's stale gate carrying a null `applicabilityCall` and `next` naming `artifactPaths`, and one whose scope selected that spec settling it;
  - after a post-triage import with findings resets closing, `outsideDocumentation` reported directly under `closing` against the carried baseline;
  - a stale code assessment whose commitments changed but whose inputs are otherwise current carrying an `applicabilityCall`.
- **The closing reset:**
  - after triage, a clean current assessment imported on a completed task leaving it complete, with its docs exemption and its retrospective, report, delivery and triage evidence intact;
  - one with findings reopening and resetting as today;
  - an incomplete or continued clean import on a completed task after triage reopening it as today;
  - the settling code assessment imported on a completed task after a post-triage code edit, while that task's docs gate is stale, leaving it complete with closing evidence intact;
  - a clean preserving relevance decision on a completed task after triage leaving it complete with closing evidence intact;
  - the same clean import before triage resetting as today;
  - `freshTargets` `reopens` reading true before triage and `'if-findings'` after triage for a dispatch on a completed task.
- **Existing refusals:** the missing-baseline, unestablished-difference and malformed-provenance refusals.

Every existing test that expected the old behavior is updated to the new boundary, not deleted. These include the relief, the `applicable-by-docs-review` value and the `closing-scope` refusal for non-documentation changes.

The relevance-first ordering, the guidance on when documentation edits land, and the controller's responses to the outside-documentation hold (dispatching the settling assessment and then the closing docs review, reverting the paths, or taking the user-decision halt) are model-owned behavior: whether a controller follows them has no installed-host evidence until it is observed, so it stays unverified on each host (live-claim: provisional on Claude Code; live-claim: provisional on Codex), and any installed-host check is decided when the work starts. The change ships as its own 3.3.x release. Until worklist step 6 ships, its CHANGELOG entry states the instruction word change: the before and after totals by the method of the fortnightly table's instruction-word row, with a one-sentence reason for any growth.

## Out of scope

- part six's recorded-decision operation;
- part two's `status.next` for other gates;
- the intermediate stage barriers and the session-close, publication and stamp lifecycle of step 3b, including how an import that raises findings after triage should treat the report and retrospective;
- widening the documentation path set;
- the stale validations of findings bound to a spec, which spec readiness left open.
