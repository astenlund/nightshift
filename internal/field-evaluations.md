# Temporary field evaluations

This index owns temporary reporting instructions shipped for new or changed Nightshift behavior. When adding them, register a stable evaluation id, the question, introduced version, every instruction location and the evidence needed for retirement here. Put an instruction beside the behavior and a matching check in revise-lore. Use the same `Field evaluation: <id>` marker at each location, with `<id>` filled by the registered lowercase hyphenated id; an empty id is invalid. Keep entries selective and proportionate to the uncertainty.

## Reporting

For an active evaluation encountered during authorized work, report an actual observation or an applicable attempt that was blocked, skipped or left unexercised. Do not manufacture an exercise, dispatch models, rerun checks or spend additional budget for reporting. An irrelevant entry needs no report. At revise-lore, check only evaluations relevant to the session and fill evidence gaps without duplicating reports already filed.

Resolve Nightshift's source clone from the maintainer's instructions. Write reports to that clone's `.nightshift/inbox/`, creating the directory if needed, never to an installed cache or another source project's inbox. In Nightshift's self-hosting source clone, the source project and maintainer destination coincide; use that same maintainer inbox. If the clone cannot be located or written, retain the observation in the session's existing evidence and tell the user where it is; do not invent another destination or block independent authorized work.

Each report names the evaluation id, date, source project and session/run, actual plugin version or qualified source candidate, host/model when known, operation and branch attempted, observed versus expected outcome, evidence location, and uncertainty. Distinguish observed success, observed failure and not exercised; a successful baseline does not establish an unexercised branch. Record actual token/cache figures only when attributable evidence supplies them. Describe observations rather than prescribe solutions. Use a dated Markdown filename containing the evaluation id and a distinguishing suffix, created without overwriting. Reuse an existing report for the same observation; add new evidence only when it materially changes the observation. If existing reports cannot be inspected, retain a local note and report the limitation rather than assume no duplicate exists. Filing is not evaluation, triage or publication authority and never authorizes deleting inbox reports.

## Release cleanup

During release preparation, inspect every active entry. Record the maintainer's evaluation decision and supporting observations in a durable report, including any unexercised cases. Once evaluated and approved for retirement, remove every registered temporary instruction in the next release, sweep its exact marker across the shipped skills and internal resources for missed instruction locations, and move the entry to Retired with the introduced/removed versions and durable decision link. Index and historical references to a marker are provenance, not reporting instructions; classify those separately during the sweep. An unevaluated entry remains active across versions. Retirement of reporting does not establish missing assurance or waive a release obligation. Preserve useful evidence under the existing inbox-triage rules.

## Active

### assessment-applicability

- Introduced: 3.3.30.
- Question: in actual work, do canonical edits preserve attributed assessments, do reviewers make useful per-task relevance decisions, and do status and late imports preserve coverage without unnecessary reassessment or dropped findings, closures or checks?
- Instruction locations: [runtime applicability guidance](runtime/REFERENCE.md#assessment-applicability), marker `Field evaluation: assessment-applicability`; [session retrospective](../skills/revise-lore/SKILL.md#session-retrospective), the same marker.
- Retirement evidence: evaluate actual exercised and unexercised paths on Claude Code and Codex, including preserve/reassess/unresolved answers, replacement, later changes/reversion, completed/shared tasks and retained obligations. Use ordinary work and attributable cost/cache evidence where available. The maintainer decides whether evidence warrants retirement; record residual uncertainty explicitly. Deterministic fixtures alone do not establish model-owned behavior.
- Evidence context: `.nightshift/reports/assessment-applicability-20261104.md` in the resolved maintainer source clone, not in the installed payload. Record subsequent evaluation decisions in a durable report before retiring these instructions; use a source-clone reference until a published decision has a stable link.
- Observation provenance: `2026-11-04-assessment-applicability-codex-unexercised-01a1a62b.md`, qualified by the candidate implementation report; it records an unexercised relevance path, not successful relevance validation.

## Retired

No evaluations retired yet.
