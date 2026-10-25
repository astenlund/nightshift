# Vibe reviewer host

## Outcome and boundary

Let the runtime dispatch lead assessments through Mistral Vibe on GLM, so that lead review tokens, the largest share of review spend, come out of the Vibe plan instead of Claude or Codex usage. The fortnightly baseline in [the assessment worklist](../reports/assessment-worklist-20261018.md) measured, over this store's repair batches, about 367M tokens on fresh leads, 165M on resumed leads and 49M on skeptics. It realizes the Exploring entry [Admit Mistral Vibe and GLM as a reviewer host](../FEATURES.md#admit-mistral-vibe-and-glm-as-a-reviewer-host), on the evidence of [the GLM 5.3 review evaluation](../reports/glm-5-3-review-evaluation-20261023.md) and [the cross-paired run](../reports/seeded-defect-baseline-20261024.md#cross-paired-glm-53-run).

GLM is admitted as a strong lead for every lead kind, including a fresh assessment that closes a task or record, and is never admitted as a skeptic. The evaluation found GLM at parity on detection, decoy refutation and clean-change false positives, but its lead raised more weak scope findings, and as a skeptic it confirmed every unmatched finding it judged, from its own lead and from Opus's alike. The skeptic is the role that filters noise, so it stays on the Claude and Codex strong families. Detection was at the ceiling for every model in the suite, so GLM's ability to close a task on harder defects is unmeasured, an accepted risk of this design.

In scope: the `code`, `spec` and `docs` assessment kinds, fresh, resumed (closure and lead dialogue turns) and replacement dispatches, in delivery runs and standalone review contexts alike. Out of scope, each staying as today: Vibe as a controller host; Vibe for in-host workers registered through the `worker` action, peers included; the `skeptic` kind, including a skeptic's dialogue turn; implementers; model families other than GLM on Vibe; operating systems other than Windows.

## Admission

`internal/runtime/models.js` replaces the single strong test with admission by role. A role is `lead` for the `code`, `spec` and `docs` kinds and `skeptic` for the `skeptic` kind. The Claude and Codex families and their floors are unchanged and admitted for both roles. Vibe gains one family, `glm`, with floor 5.3, admitted for `lead` only. Vibe's plain identifier form is `glm-<major>-<minor>`, version parts as for the other hosts (at most three digits, no leading zero), matching the identifier Vibe journals as its active model (`glm-5-3`); a variant or suffix is refused like any other non-plain form.

Both existing gate points apply the role: `validateRequest` in `internal/runtime/review.js` checks every candidate against the role of the request's kind, and `readReceipt` checks the receipt's host and model against the role of the receipt's kind. A Vibe candidate on a skeptic request is refused with `review-strength`, whose message names the role. The receipt's `strength` stays `strong`, meaning admitted as strong for its kind, so the fresh-assessment test in `internal/runtime/lifecycle.js`, which requires `strength === 'strong'`, is unchanged and a clean fresh GLM assessment passes the gate. `requiredModel` and `substitutionReason` keep their rules; a candidate list may mix Vibe and other hosts.

## Launcher

`internal/runtime/hosts.js` gains `runVibe`, promoted from `tools/seeded-defects/vibe-launcher.js`, and `executable` and `runAgent` accept `vibe`. The suite then uses the runtime's launcher for Vibe leads, and keeps its evaluated-host injection only for a Vibe skeptic, which the runtime does not admit.

- Process: the native `vibe.exe` resolved by `resolveTrustedExecutable`, run headless in the dispatch's private copy (`--workdir`, `--trust`, `--prompt-file`, `--output json`, `--output-dir` under the attempt's artifacts, `--time-limit` derived from the attempt's timeout) inside the runtime's Windows job, with stdout and stderr bounded below the job's output capacity, as the suite's launcher does. Startup, termination-proof and artifact-write failures follow the same paths as `runClaude`.
- Tools: `read_file` only, through `--enabled-tools`.
- Prompt and report: Vibe has no structured-output or system-prompt option, so the system text precedes the prompt and the report schema is stated in it; the report is taken from the last assistant message's last untagged or `json` fenced block, else its outermost braces, and then validated by `validateReport` unchanged.
- Attribution: the session id from `export.json`, and the model from the session journal's runtime state, which must name one active model across every generation, equal to the requested one. A resumed attempt must also report the session it resumed.
- Tokens: `usage.total_tokens` from `export.json` for a fresh attempt. For a resumed attempt, the attempt's own usage when Vibe reports it per invocation, or the cumulative total less `priorThreadTokens` when it reports cumulatively, and unknown (null) when the implementation cannot establish which; the probe below settles it. Vibe's count is its own accounting and is not comparable with Claude or Codex figures, which the receipt's host already makes visible.
- Configuration (provisional, settled by the probe below): the launcher pins the model, sets the thinking level, replaces Vibe's coding system prompt and turns off code mode's `run_typescript` per invocation, without editing the user's Vibe configuration and without copying any credential under `.nightshift`. The evaluation ran with none of these, so each that cannot be applied per invocation falls back as follows: an unpinned model still has to pass attribution, so a mismatch fails the attempt; an unset thinking level is recorded as Vibe reports it; Vibe's own system prompt stays in place; and `run_typescript` stays available, with the evidence rule below.
- Effort: a Vibe candidate's `effort` maps to the thinking level only where the probe shows the levels correspond by name. The receipt records the level Vibe reports for the session, which must be a permitted effort (`low`, `medium`, `high`, `xhigh`); a level outside that set or none reported fails the attempt as unattributable, since a resumed dispatch takes its effort from the receipt and a fresh one would refuse anything else. A supplied effort the launcher cannot apply is refused before launch with `effort-not-permitted` and a recovery naming the level Vibe will run at.

## Sandbox execution evidence

Where `run_typescript` stays available, a Vibe lead can run a copy of code it transcribed into Vibe's sandbox. The evaluation found such claims real but sometimes wider than the recorded call. The lead prompt for a Vibe dispatch states that sandbox runs of transcribed code are not execution evidence of the project and that deciding execution goes through a probe request, as for every host. The skeptic, always a Claude or Codex model, validates each finding against concrete evidence as today, so no runtime gate changes.

## Resume

Whether `vibe --resume <session> --prompt-file <file>` runs headless and resumes a session from a different working directory, since every dispatch gets a new private copy, is unverified and settled by the probe below.

- When it does: resumed closure and lead dialogue turns resume Vibe sessions exactly as for the other hosts, with the runtime taking host, model and effort from the receipt. A session Vibe no longer holds fails as `resume-failed`, and the controller replaces the reviewer through `review.replaces`, as today.
- When it does not: `resolveContinuation` refuses `review.resume` on a Vibe receipt before anything launches, with a new code `resume-unsupported` whose recovery names `review.replaces`, so no tokens are spent on a resume that cannot work. Replacement candidates may be any admitted lead, Vibe included.

## Receipt import

`readReceipt` gains a Vibe branch beside the Claude and Codex ones. The Vibe launcher writes Vibe's JSON output entries as `events.jsonl`, already hashed into `eventHash`; the receipt also records `attributionEvidence`, the project-relative paths and SHA-256 hashes of the attempt's `export.json` and of each journal runtime-state file attribution read, present on Vibe receipts only. Import refuses a Vibe receipt unless every listed file still has its hash, the export's session id equals the receipt's session and its outcome is finished, the journal names exactly the receipt's model, and the report taken from the events by the launcher's rule equals the receipt's findings, probes, coverage, closures and positions, with `changed-result` or `unattributed-review` as for the other hosts. Claude and Codex receipts carry no `attributionEvidence` and are imported as today.

## Every consumer of the host value

A sweep of `internal`, `tools` and `skills` for host enumerations (`'claude'`, `'codex'`, `.host`) on 2026-10-25 found these sites:

- Changed: `hosts.js` (`executable`, `runAgent`, new `runVibe`); `models.js` (admission by role); `review.js` (`validateRequest`, `readReceipt`); `continuation.js` (`resume-unsupported`, only when the probe shows resume unsupported); `tools/seeded-defects.js` and its launcher (runtime launcher for leads, injection kept for skeptics).
- Unchanged because Vibe is never a controller or acting session: `store.js` controller host, `ownership.js`, `cli.js` report-delivery actor, `continuation-health.js`, `native-acknowledgement.js`, `acceptance-checkpoint.js` and every `internal/releases` module.
- Unchanged because Vibe is never an in-host worker: the `worker` action's host check in `lifecycle.js` and `native-worker-evidence.js`, which returns unknown for any other host.
- Host-agnostic and unchanged: the dispatch path in `cli.js`, which takes the worker's host from the receipt, and the same-session test in `continuation.js`; `tools/fortnight.js`, whose only host-specific rule is the pre-3.3.3 Claude token correction.

## Placement

Placement is controller guidance in the operating brief, not a runtime gate; the runtime admits any admitted candidate order.

- Leads: a GLM lead on Vibe is the default first candidate whenever Vibe is available, to save Claude and Codex usage. The fallback candidates in the same request are ordered Codex before Claude (Sol, then Opus), whichever host the controller runs on, keeping Claude usage for interactive work, where its harness is strongest. When Vibe is unavailable (executable missing, signed out, usage exhausted), the fallback candidates run as today, with the substitution reason recorded.
- Skeptics: each skeptic runs on a different host from the lead whose findings it validates, preferring the controller's own host, so that lead and skeptic sit on different hosts even when only Claude and Codex are available. With a GLM lead, or a Codex lead under a Claude controller, the skeptic runs on the controller's host; only when the lead runs on the controller's own host, as a Sol fallback lead under a Codex controller does, the skeptic moves to the other host. This replaces the other-host preference for skeptics.
- Disposition: GLM leads raise more weak scope findings, which the skeptic tends to confirm as true observations, so the controller's value and obligation decisions carry that filtering.

## Guidance

- `internal/workflow.md`: the strong-model paragraph says strong lead and strong skeptic admission can differ and that GLM on Vibe is a strong lead only; the placement paragraph states the placement above.
- `internal/runtime/REFERENCE.md`: the `candidates` rule lists the Vibe family, its plain form, the lead-only admission, the effort rule, `attributionEvidence` and, if it ships, `resume-unsupported`.
- `skills/revise-code` and `skills/revise-docs`: where they say to prefer the other host at equivalent strength for the lead, they also admit a Vibe lead; skeptic instructions are unchanged. `skills/revise-spec` and `skills/handover` say only "strong" lead or assessment, which the brief's definition now covers, so they are unchanged.
- `README.md`: the Hosts bullet says reviews can also lead on Vibe.
- Tracking: the Exploring entry moves to `FEATURES_HISTORY.md` as shipped, and the deferred quick win's clause about that entry's system-prompt sentence is dropped with it. `CHANGELOG.md` records the release with its evidence qualifications.

## Verification

- Probe before implementation, on Vibe tokens only: headless resume from a new working directory; per-invocation model pinning, thinking level, system prompt replacement and `run_typescript` removal; whether resumed usage is per invocation or cumulative. The results settle the provisional points above and are recorded in the release's acceptance report.
- Deterministic tests: role admission for every host and family, including a Vibe skeptic refused at dispatch and at import; the Vibe launcher's parsing, attribution, effort and failure paths, moved from `tests/seeded-defects.test.js`; the import branch, including a changed export or journal file refused; `resume-unsupported` if it ships.
- Installed-host evidence: one fresh Vibe code lead dispatched and imported through the runtime CLI on a small project, its skeptic on Opus or Sol, and one resumed closure if resume is supported.
- A seeded-defect run of GLM leads with Opus skeptics through the runtime launcher, compared as its own input rather than against the Opus targets, which the corrected baseline scopes to Opus. It spends Opus tokens on the skeptics, so it needs an explicit budget.
- Packaging: one plugin version increase, the regenerated release manifest and the release gate.
