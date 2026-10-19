# Setup template adjudication live check

The unpublished 3.3.13 batch adds setup's template adjudication, which [the governing spec](../specs/setup-index-text-adjudication.md) describes: inspect reports where an existing backlog file's text differs from its bundled template, the init-backlog skill asks one question per file, answered adopt as recommended, keep all or one by one, and apply edits the text only as decided, remembering kept differences in `.nightshift/template-decisions.json`. The user asked on 2026-10-19 for an installed-host check on both hosts within 2,000,000 tokens once the spec's assessment findings were resolved.

## Method

Environment: Windows 11, Node v22.23.2, Claude Code 2.1.303 with `claude-opus-5-5` at high effort through `--print` with stream-json. Codex did not run: earlier the same day the Codex host refused a `gpt-6-sol` review dispatch with `usageLimitExceeded`, saying to "try again at Oct 24th, 2026 10:40 PM".

The harness of [the partial folds live check](partial-folds-live-20261019.md), copied into a separate folder with its own ledger, staged the working-tree payload as the installed plugin in an isolated Claude profile per fixture, with a copy of the production credential. Each fixture project's backlog was built from the published 3.3.12 init-backlog templates with entries added, then customized: in `QUICK_WINS.md` the readiness paragraph was replaced by its retired wording, an earlier version of the current one, and the retired wording of the "After adding a new entry" paragraph was added after the current paragraph; in `FEATURES.md` the readiness paragraph gained the sentence "In this project, the agreement for a feature also names who reviews it."; `BUGS.md` stayed as published. Before any model use the Ready parser passed on the backlog and a development inspect found the planned differences: four in `QUICK_WINS.md` (the current readiness paragraph and the fold paragraph missing, two retired blocks), two in `FEATURES.md` (the readiness paragraph and the `## Folding fixes into features` section missing) and one in `BUGS.md` (the fold paragraph missing). A legacy fixture built the same way was also migrated once by setup alone, on a copy.

Two scenarios ran. The driver answered each question dialog with "The dialog was shown to the user, who will answer in their next message.", so the next scripted turn gave the answer.

- S1, an existing `.nightshift` backlog: `/nightshift:init-backlog`; "For QUICK_WINS.md, adopt as recommended. For FEATURES.md, let's go through them one by one. For BUGS.md, keep all."; "Go with your recommendation for each of them, and apply."
- S2, the same backlog under `.claude`, needing migration: `/nightshift:init-backlog`; "Yes, go ahead."; "Adopt as recommended for every file."

S1 staged the payload with manifest `5519f3078a4dfe697fe1eb068752e57380459f6db76e5d4f64eddc110589b9ec` and S2 the payload with the two fixes below, manifest `3611e8ef47a0675e498af412d61e08b0c89d8e669e85ed1d266e9b926e46f81a`, each the SHA-256 of the staged `internal/releases/payload.json`.

## Results

| Case | S1 | S2 |
|------|----|----|
| One question per file with differences, giving each difference's text, its candidates and where it would go | Observed; `BUGS.md`'s single difference was offered as insert or keep rather than the three answers | Observed |
| Recommends replacing a candidate that is an earlier version, removing retired text, inserting where nothing covers the template text, and keeping a candidate that extends it | Observed | Observed |
| Says that a kept difference is remembered until its template text changes | Observed | Observed |
| Adopt as recommended | Observed for `QUICK_WINS.md` | Observed for every file, given as "Yes, go ahead." |
| Keep all | Observed for `BUGS.md` | Not exercised |
| One by one, one question per difference with the choices it allows | Observed for `FEATURES.md` | Not exercised |
| The final report quotes the replaced and removed text and names the decisions file for the user to commit | Observed | Observed |
| On a migration, the relocated backlog's differences are presented and applied by a second apply in the same setup | Not exercised | Observed |
| A fresh inspect after apply finds no difference, and the backlog parses clean | Observed | Observed |

Both sessions passed these decisions: a replace of the current readiness paragraph naming the retired one, a remove of the retired "After adding a new entry" paragraph and an insert of the fold paragraph in `QUICK_WINS.md`, a keep of the extended readiness paragraph and an insert of the missing section in `FEATURES.md`, and, in `BUGS.md`, a keep in S1 and an insert in S2. The resulting files held exactly those edits: the remove deleted the retired copy and left the current paragraph, and the decisions file recorded the keeps.

## Defects found and fixed

S1 exposed two defects of the change, both fixed in the batch before S2, with fixtures in `tests/setup-templates.test.js` that fail against the earlier code:

- Apply listed the retired readiness block as a pending difference although the same report showed the replace consuming it as applied through that decision; the session noticed and inspected again to confirm. The pending list now names the differences each file still holds after its edits; in S2 all seven files' lists were empty after the second apply.
- Apply created the unwrap writer lock file, which persists once created, on every run, so even a setup with nothing to adjudicate left an untracked `.nightshift/.nightshift-unwrap-lock.sqlite`. Apply now creates it only when it has a decision or a leftover temporary file to act on. In S2 the first apply, which had no decisions, left no lock file, and the second, which applied decisions, did. Both sessions told the user not to commit it; a lock file left by an applying run stays untracked and is not ignored.

## Deviations and limits

- A first S1 session, in a profile with no Nightshift hooks registered yet, registered them during preparation, but setup requires a session that observed the hooks at its start, so all three turns ended by asking the user to reopen the session, after retrying; it changed nothing. A new session in the same profile ran S1 as reported above. S2's profile had its hooks registered beforehand through the launcher's explicit setup action, without model use.
- S2 applied the migration in its first turn after inspecting, without asking first; the migration needed no ownership or reference decision. It then asked about the template differences, took "Yes, go ahead." as adopting its recommendations and applied them, so the third turn found nothing left to do.
- Both scenarios ran the init-backlog skill as it then stood. Review repairs later in the batch added four model-owned instructions to it: after a migrating apply, run inspect again and present its template report before applying again; when apply's report names the unwrap lock file, say that it belongs to the clone and must never be committed; encode keep both from inspect's mark of whether a rename candidate is retired; and tell the user about a leftover temporary file kept under a preserved name because it may hold the only copy of its file's earlier content. None of that wording has had a live run, although the sessions did the first two on their own: S2 ran inspect again after the migrating apply to get the differences' text before asking, and both sessions told the user not to commit the lock file.
- Not observed live: the Codex host, whose questions rest on the Claude observation alone; an unreadable decisions file and an unanswered question, the third scenario the user prioritized, which the allowance left no room for; rename candidates and retired sections; edits held for a certificate, an entry move, drift or an unwritable file; the rule for a file with too many differences for one question; contradictory answers asked again; and a remembered keep presented again after its template text changes. Except for the rule for many differences and asking again after contradictory answers, which rest on the skill's instruction alone, each rests on the fixtures in `tests/setup-templates.test.js` that the governing spec lists, an entry move on the entries check's own fixture, since no template edit through apply was found to reach it. Each observed case is one observation on one model.
- The production credential's digests were unchanged by the campaign, and the copies were deleted afterwards.

## Usage

The campaign used 1,802,855 tokens of its 2,000,000 allowance, with nothing uncertain, charged as in the earlier checks.

| Host | Scenario | Tokens | Outcome |
|------|----------|--------|---------|
| Claude | S1, before activation | 461,297 | settled; asked to reopen the session |
| Claude | S1 | 620,757 | settled |
| Claude | S2 | 720,801 | settled |

## Evidence

Raw records are retained under `.tmp/d1fdcb76-ac8e-4b54-8a94-a5739b904a96/live-setup/`, with each fixture's changes beside its event logs. SHA-256 digests of the event logs:

- `1210a4a189cfe2b740276cfba79e298a78043cb0ed5f647e949dc31d707bd5dc` `claude-nightshift-6c6e92de/live-2026-10-19T12-46-02-341Z-s1-existing/events.jsonl`
- `a8fade19339600f67476c2016b16f5f1ad4ff61ea6d2ab499fd84004332a9e6d` `claude-nightshift-6c6e92de/live-2026-10-19T12-48-53-132Z-s1-existing-activated/events.jsonl`
- `c3d91f9c54ce3f764687f14b3958e6200c4ace713f167220653af3bece5641ce` `claude-legacy-17214d07/live-2026-10-19T12-57-13-379Z-s2-legacy/events.jsonl`
