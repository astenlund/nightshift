# Close minor repairs at the fresh gate

## Outcome and authority

A repaired minor finding no longer waits for the reviewer that raised it to be resumed: the relevant checks and the fresh assessment that every repaired record already needs confirm it. A repaired critical or important finding keeps resumed closure as today. This is Add 4 of [the assessment worklist](../reports/assessment-worklist-20261018.md), which the user adopted on 2026-11-10 and scheduled on 2026-11-23 to follow the steering step, shipped in 3.3.43 as [the project review model](review-model.md). The user's decision of 2026-11-10 replaced the resumed-reviewer experiment as this rule's gate: the fresh gate is what catches later problems.

The evidence it answers, from the fortnightly table: minor-only repair cycles were 33.2 percent of repair transitions at the baseline, 41.2 percent at the check of 2026-11-15 and 35.1 percent cumulatively at the reading of 2026-11-27; across this repository's store, resumed sessions spent 576,406,559 measured tokens in the closed repair batches beside 1,068,777,583 for fresh ones. Each minor-only batch today pays for a resumed closure and then a fresh gate; this spec removes the first.

## Commitments

1. **Which repairs owe resumed closure.** `repair` sets pending closure only on the repaired findings whose recorded severity is critical or important. A repaired minor finding is marked repaired, with its repair revision, and owes no closure. Severity is the one the raising reviewer recorded at import; neither the skeptic's verdict nor the controller's disposition changes it.

2. **How a repaired minor finding settles.** It settles at the gate of its kind, which already refuses while any finding of that kind was repaired at or after the latest assessment's revision, and which requires a complete fresh assessment and the record's recorded checks to pass. Nothing else is added: a minor repair with a check closes on that check passing and the fresh assessment; a minor repair with no practical check goes straight to the fresh assessment, with no closure step. A minor finding that the fresh assessment itself raises and the controller repairs needs another fresh assessment, by the same gate, and no resumed closure; deferring such a finding as a follow-up remains available, and the review model decides whether it is worth acting on.

3. **Mixed batches.** In a batch that repairs critical or important findings beside minor ones, the reviewers that raised the critical or important findings are resumed for their closure and their cumulative reassessment, as today, and that reassessment covers the minor repairs with the rest of the change. A reviewer that raised only minor findings in the batch is not resumed. The fresh gate follows once no critical or important finding awaits repair or closure, as today.

4. **Dispose the whole batch before repairing.** `repair` refuses, with its own refusal code, while any finding on the same record lacks a disposition. The controller therefore disposes every open finding, deferrals and skips included, before the first repair edit of a batch, as the operating brief already asks.

5. **Scope.** The rule applies to every record kind that repairs: code, docs, spec and lore tasks and the closing record. In a spec task's own repair loop, a minor-only batch goes to a fresh whole-spec assessment rather than a resumed one. Runs keep their exact release for life, so runs created before the release that ships this spec keep today's rule; no stored finding is rewritten.

6. **Instructions change with the runtime.** Every operating instruction and rule string that tells the controller to resume the reviewer that raised each repaired finding, or to resume the reviewer after every repair batch, changes in the same release to say it for critical and important findings only; today these include the operating brief, WORKFLOW.md, the revise-code, revise-docs and revise-spec skills, the runtime reference and the status rule strings.

## Boundaries

- The fresh gate stays mandatory after every repair batch; this spec does not make any repair self-closing.
- The repair rule's failing-check and reader-tracing requirements are unchanged for minor findings.
- Severity calibration is not changed here: the rubric shipped in 3.3.18 under Add 6 defines it.
- The repair conversation of the Resumed reviewers section, which would replace resumed closure for every severity, is not part of this spec.

## Acceptance evidence

- Deterministic runtime tests: a minor-only repair sets no pending closure and the gate still refuses until a fresh assessment later than the repair; a mixed batch sets pending closure only on its critical and important findings and status routes resumption only to their lineages; a minor raised by a fresh assessment and repaired needs another fresh assessment; `repair` refuses while a finding on the record lacks a disposition; the closing record and a spec task follow the same rule; a run created on an earlier release keeps today's rule.
- The release gate, including the settled-record verdict tripwire, which lists `internal/runtime/lifecycle.js`, decided under the runtime reference's rule-identity rule.
- The controller's choice to skip a resume for a minor-only batch is model-owned behavior; installed-host evidence of it is gathered on at least one host or the release notes mark it provisional.
- After release, numbers 2 and 4 of the fortnightly table, read per batch, show whether minor-only batches got cheaper; that reading confirms and does not gate.
