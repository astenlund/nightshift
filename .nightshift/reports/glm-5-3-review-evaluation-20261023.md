# GLM 5.3 review evaluation

The user asked on 2026-10-23 whether Mistral Vibe running GLM 5.3 could take review work, since Codex usage is limited, and set aside the Vibe plan's tokens for finding out. This evaluation runs GLM 5.3 through the [seeded-defect suite](../specs/seeded-defect-suite.md) under the same prompts, conventions and report validation as the Opus 5.5 and Sol baseline, as evidence for the Exploring draft [Admit Mistral Vibe and GLM as a reviewer host](../FEATURES.md#admit-mistral-vibe-and-glm-as-a-reviewer-host). It does not change the runtime's reviewer gate; the user framed it as an evaluation that feeds that separate feature.

## Method

Environment: Windows 11, Node 22, Mistral Vibe 3.0.0 with its active model `glm-5-3`. The harness dispatched each review through the runtime's `dispatchReview` with a gate candidate the runtime admits, Sol on Codex, and an injected launcher, `tools/seeded-defects/vibe-launcher.js`, that ran Vibe instead, as the spec's evaluated-host paragraph describes. Vibe has no structured-output or system-prompt option, so the launcher put the system text before the prompt and stated the report schema in it; Vibe's own system prompt stayed in place. Vibe ran headless with only `read_file` enabled. Attribution came from Vibe's session journal, and tokens from the `usage.total_tokens` of the `export.json` Vibe writes.

The run covered all seventeen fixtures, two repetitions each, lead and skeptic on GLM 5.3, then `--retry` passes until every stage was complete. All dispatches share the baseline's review machinery hash (`3b7229cc6b1c`); the dispatching harness hash (`8031587d77e5`) differs from the baseline's because the evaluated-host support was added between them, so the comparison below holds the review machinery, the fixture set (`db5732ae6478`) and the conventions (`fefb60b9ff27`) equal and changes the model and host. The run is not mixed: retries ran from a checkout of the evaluation's own commit after later grader fixes, so every dispatch records the same identity. Both runs were graded by the same grader (`908131ea46ee`).

## Results

| Figure | Opus 5.5 | Sol | GLM 5.3 |
|---|---|---|---|
| Detection | 28/28 | 28/28 | 28/28 |
| Clean-change false positives per clean fixture | 0.20 (1/5) | 0.00 (0/4) | 0.00 (0/4) |
| Unmatched confirmations per other fixture | 0.14 (4/29) | 0.07 (2/30) | 0.43 (13/30) |
| Out of scope raised | 2/6 | 0/6 | 3/6 |
| Severity accuracy | 19/28 | 18/28 | 18/28 |
| Skeptic accuracy | 64/64 | 62/62 | 65/65 |
| Tokens per fixture run | 54,776 | 446,575 | 137,703 |
| Seconds per fixture run | 102 | 160 | 104 |
| Stages retried | 0 | 10 | 9 |

Detection is at the ceiling for all three models, so this fixture set cannot separate them on finding planted defects; harder fixtures are needed before detection can rank models.

GLM's ten severity misses are each one step off the rubric: seven rated too high (the important loop-failure-tokens and revision-history defects as critical in both repetitions, the important resume-targets defect as critical once, the minor tag-rule-duplicate defect as important twice) and three too low (critical defects in branch-switch-shell, check-environment and review-context-routing rated important, all three in their second repetition).

The weakest figure is unmatched confirmations: thirteen findings adjudicated false that GLM's own skeptic confirmed, against four for Opus and two for Sol. They are mostly scope and preference findings: re-exporting the new module from `src/index.js` (four), an unauthenticated `adopt()` that the requirement makes the ownership transfer path, a `replayed` marker on the replay outcome, `null` for unknown token usage, the location of a base-project helper, an empty review-context id refused, stream choice for diagnostics, an extra export, a replay against an unknown run, and values `structuredClone` cannot copy. The skeptic in every model's runs is the same model as the lead, so this figure measures how readily a model confirms its own weak findings.

Clean-change false positives are zero on four clean fixture runs, but port-validation, the third clean fixture, counted as not clean in both repetitions because GLM, like both baseline models, raised a real issue there (non-string and Symbol inputs escape the required RangeError).

Tokens are Vibe's own total, not the Claude or Codex accounting the baseline figures use; whether they count cached input the same way is unverified, so the token comparison is indicative only.

## Protocol failures

Nine stages needed a retry before every fixture run was complete, three for incomplete reports and six for known failures. The superseded results show the causes: three reports marked incomplete (two leads, one skeptic), two lead reports missing their required tool-failure statement, two skeptic reports without findings or coverage, and one skeptic stage whose reply was not valid JSON twice in a row. Every retried stage then completed. A runtime launcher for Vibe would need the same retry tolerance the baseline needed for Sol, and these failures cost tokens: the evaluation spent 5,359,150 tokens in all, against 4,681,912 counted in the final fixture runs' records.

## Executed evidence

Fourteen of the 68 final receipts, across seven fixtures, report evidence from executing code, such as "verified by executing an inline copy in a sandbox" and "Executed an exact replica of parseConfig". Vibe denied every shell call the reviewers made (113 calls, all `tool_denied`), but its code mode's `run_typescript` tool stayed available despite the `read_file` restriction and runs TypeScript in Vibe's own sandbox. Every receipt that claims execution comes from an attempt with at least one `run_typescript` call, and 31 of the 68 final receipts used the tool, so the execution is real. It is not always as wide as claimed: in the one call checked in full, port-validation's second lead ran a transcribed `parsePort` over string, number, array and object inputs and recorded `[8080]` returning 8080, but no Symbol input, while its finding credits both the `[8080]` result and the Symbol TypeError to sandbox execution. The code also ran as a copy the model transcribed into the sandbox, not as the project's files, so it can diverge from the shipped code, and the receipts say so only in some cases ("verbatim copy", "inline copy"). The other thirteen claims were not checked call by call. One lead receipt said plainly that it could not execute the project code. The sandbox reached the workspace only through `read_file` in these sessions.

An earlier reading of the event logs had taken these claims for fabricated, because Vibe's event stream records the tool calls made from inside the sandbox but not the `run_typescript` call itself; the session journal under each attempt's `vibe/session` folder holds the calls and their outputs.

## Adjudications

Thirty-three unmatched GLM findings were adjudicated, following the baseline's precedents where one applied: 19 real and 14 false. Beyond issues the baseline already raised, the real ones add three fixture corrections: branch-switch-shell's `runGit` throws an error whose message is the null stderr when the spawn itself fails, check-exit-status's CLI prints a stack trace for an unreadable file, and check-exit-status's base parser rejects every CRLF line as "not a key = value pair". The last one came from a finding the GLM skeptic correctly refuted: the lead claimed parsed values carry a stray carriage return, but `.` stops before the carriage return and `$` then fails, so the line is rejected instead, which a direct run of the parser confirmed; the finding is adjudicated false and the rejection it pointed near is recorded as a pre-existing issue for the fixture.

## Observations for the admission decision

- GLM 5.3 matched the baseline on detection, clean-change false positives, severity and skeptic accuracy, at about Opus's speed and between Opus and Sol on tokens.
- Its skeptic confirms its own weak findings far more often than either baseline model, so as a skeptic for its own leads it would let more noise through.
- Its report protocol fails more often than Opus's, at about Sol's rate, so a runtime launcher must keep the retry path.
- It executes transcribed copies of code in Vibe's sandbox and reports the results as verification, at least once for an input the recorded call did not run; an admitted host's evidence rules would need to distinguish that from a probe against the project.
- Attribution worked through the session journal: it named `glm-5-3` in all 77 attempts, retried ones included. Every dispatch ran in the runtime's Windows job.

## Qualifications

- Two repetitions per fixture on seventeen fixtures, with detection at the ceiling; the figures are a first measurement, not a ranking.
- The fixture set needs the corrections the baseline and this evaluation's real adjudications call for, so the figures are not yet comparable with targets, which remain unset.
- Earlier GLM work outside these figures: two smoke runs through the harness (573,955 tokens) and hand-run probes not metered by the harness.
- The raw run folder lives in the session's scratch space under `.tmp` and is not durable.
