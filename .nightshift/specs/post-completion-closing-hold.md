# The post-completion closing hold

## Outcome and authority

A completed delivery whose closing record still owes post-completion closing work holds the project's next handover back. Today the hold is hard to see and, without the owning session, cannot be cleared: Ready lists a complete record only while it is the current selection and its morning report awaits its recipient, `handover` refuses `overlapping-run` without naming a record, or `delivery-consistency-unavailable` when the held record is not the current selection or its only failure is a closing check that has not passed; status reads the closing review with no way forward; and `close-manifest` answers `close-not-needed` for every complete record. This design makes the hold visible wherever a session meets it and gives the user an explicit route to drop the held work through the administrative close.

It discharges the bug "A post-completion closing hold blocks the next handover invisibly and cannot be closed", shaped by the user on 2026-11-20:
- **Route.** A session other than the owner clears the hold through `close`, on the user's authority, rather than by adopting the completed record. A held record closes as a stopped record does, so a live owner does not refuse it; the owner keeps its own routes until then.
- **Counting.** A record closed from `complete` counts as closed, not as complete, as [Close settled records](close-settled-records.md) already rules for every closed record.
- **Governance.** A short spec settles the commitments before implementation.
- **Trigger.** Giving the ready parser a route as a recorded check, the most common way into the hold, stays with the quick win "Make the ready parser usable as a delivery check".

What the closing record owes after completion, as the creation-gate paragraph of [the runtime reference](../../internal/runtime/REFERENCE.md) states it, is unchanged. Only the hold's visibility, its refusal code and the close route change.

## Commitments

### 1. One predicate

A delivery is held when all of these hold:
- its status is `complete`, it is not retired, and its accounting is current;
- its completion is not discharged, and every reason it is not discharged is outstanding closing work recorded since completion.

Outstanding closing work is a closing check recorded since completion whose files the latest closing assessment has not seen, as the creation-gate paragraph requires; a latest closing check that failed or is pending; an unsettled closing finding or a closing finding repaired after the latest closing review; a pending closure or carried finding that belongs to the closing record; and a latest closing review that is incomplete, unattributed or missing a docs dimension. This list is complete: anything else that keeps a completion from being discharged, such as an unresolvable or invalid snapshot, an invalid closing baseline, or a closing record replaced since completion (no production writer replaces it while the status stays `complete`), is a failure of evidence, not work, and keeps the `delivery-consistency-unavailable` refusal. A record failing for work and for evidence together is not held and keeps that refusal, which also names the closing work it found.

The creation gate, status, Ready, `close` and `close-manifest` judge the hold through one shared predicate, so none of them can disagree about whether a record is held, as the creation gate and `close-manifest` disagree today. The predicate reports each cause by the check, finding, closure or review it concerns.

### 2. The creation gate

The grouped refusal for records without independent accounting keeps its place and code. After it, when held records are what keep creation from proceeding, selected or not, creation refuses `overlapping-run` naming each held record, its causes and the routes commitment 5 lists. The other refusals keep their codes; an `overlapping-run` refusal for an unfinished record or an active worker names its record too.

### 3. Status

On a held record, status names the hold, its causes and the routes, and no closing way forward reads `null` while the hold stands. With freshness verification skipped, the hold reads `'reconcile at acceptance'`, as `staleChecks` does. Status still writes nothing.

### 4. Ready

Ready's run state reports a held record as open, with its causes, its routes and a `close` offer when commitment 5 admits one. A held record whose morning report awaits its recipient shows both `present-report` and the close offer.

This amends [Ready's run state](ready-run-state.md), whose module never reads `history` or accounting tables and does not evaluate discharge. The tradeoff, accepted here: Ready reads what the predicate needs for each complete record that is not retired and has no current settled-record verdict, within the creation gate's own input bounds, in a read-only transaction that writes no verdict. A record whose hold Ready cannot judge, for a bound or a read failure, gets a record-level `unavailable` entry, `{store, id, code, message}`, and is never read as not held; the store's other records are still reported. The record-level entry is a new form beside today's per-store entries.

### 5. Routes

The owner discharges the hold as today: it reruns each closing check until it passes, settles the closing findings and closures, and obtains the fresh complete closing docs review the creation-gate paragraph requires.

Any session, on the user's authority, drops the held work through `close`. `close` and `close-manifest` admit a complete record only while the predicate holds it; a complete record that is not held still answers `close-not-needed`. Otherwise a held record closes exactly as a stopped record does under [Close settled records](close-settled-records.md): the same manifest, reply, report choice (`waived` while a handed-over record's report awaits its recipient), older-release guard and worker eligibility, with no owner liveness check, so an owner still live afterwards meets `run-closed`. A held record's manifest names the causes the close drops. The closure keeps `previousStatus: complete`, as it already does, and the creation gate counts the record discharged by its close row, as it counts every closed record.

`hold` and `stop` are not routes: they would turn a completed delivery into a stopped one.

### 6. The owner's final report

When an owner session ends its work, including follow-up triage and post-completion tracking edits, while the hold stands, its final message says that the hold will block the next handover in this project, names the causes, and names both routes: resume this session to discharge it, or have the user close the record. It never presents the hold only as a residual limitation. The operating brief states this rule.

## Lifecycle and consumers

The predicate is computed at every reading from saved state and the project files historical discharge reads, and never persisted. Closing a held record is a new transition from `complete` to `closed`. The implementation finds every consumer that reads a record's status or a closure's previous status and confirms each treats a record closed from `complete` as closed. `tools/fortnight.js` already counts closed runs on their own and needs no change.

Statements that a complete record cannot be closed, that `close-not-needed` answers every complete record, that eligibility admits only `running` and `stopped`, or that Ready never reads history or accounting change with this release, including the Eligibility section and consumer table of [Close settled records](close-settled-records.md) and the store-reading and open-record rules of [Ready's run state](ready-run-state.md). The sweep is by claim over `internal`, `skills`, `hooks`, the specs and the backlog, with search terms `close-not-needed`, "nothing is left to close", "complete record", "completed record", "`running` or `stopped`", `overlapping-run`, "cannot be adopted", "never reads" and "does not evaluate", each hit classified by its whole paragraph.

A run keeps its exact release, but the creation gate, Ready and `close` read every record in the project's store, so a record held under an earlier release is judged and closed by this release's code. The implementation confirms that an earlier release's creation gate reads a record closed from `complete` as discharged; if not, the release notes say that a session on an earlier release restarts on this release before handing over. The implementation follows the rule-identity rule of the settled-record verdict paragraph of the runtime reference and re-pins the verdict tripwire if a pinned module changes.

## Verification and release

Deterministic tests cover:
- a record held for each kind of outstanding closing work, and a record failing for evidence, or for evidence and work together, not held;
- a retired complete record never held, and `close` answering it `close-not-needed`;
- creation refusing `overlapping-run` naming each held record and its causes, selected and nonselected, with two held records, and the grouped refusal for records without independent accounting keeping precedence;
- status naming the hold with a way forward that is never `null` while it stands, and reading `'reconcile at acceptance'` with freshness verification skipped;
- Ready reporting a held record with its close offer, with `present-report` beside it when its report awaits its recipient, and a record it cannot judge as a record-level `unavailable` entry while the store's other records are still reported;
- `close-manifest` and `close` admitting a held record with a live owner and with the `waived` report choice, refusing an active worker as for a stopped record, answering `close-not-needed` for a complete record that is not held, and a later handover succeeding once the record is closed.

Each refusal test asserts its own code and the branch under test, and each new test is confirmed to fail without the change.

The owner's final report is model-owned behavior and needs a per-host live claim under a budget the user sets when that evidence is gathered (live-claim: provisional on Claude Code; live-claim: provisional on Codex).

The release takes a monotonic version increase in both plugin manifests, a regenerated release manifest and CHANGELOG.md notes. The bug entry moves to `BUGS_HISTORY.md` when the release ships.

## Out of scope

- A route for the ready parser as a recorded check, and the stale task checks after completion, which stay with the quick win "Make the ready parser usable as a delivery check".
- Adoption of a completed record.
- Changing what the closing record owes after completion.
- A SessionStart notice for a resumed owner; the owner meets the hold through status.
- Whether `hold` and `stop` should be admitted on a complete record at all.
