# Partial folds live check

The unpublished 3.3.13 batch extends [Fold fixes into the feature that replaces their code](../features/fold-fixes-into-features.md): when a feature would remove only part of what a fix changes, and that part fails and can be verified on its own, that part is carried by the feature and the rest stays a quick win or bug entry that names the carried part and links the feature's `## Carried fixes` heading. The operating brief's follow-up triage and the quick-wins and bugs templates carry the rule; the features template and revise-docs say that the carried line links its evidence rather than the remaining entry, that the entry's pointer is removed when the feature ships, and that a split part rejoins its entry when the feature is retired. The user asked on 2026-10-19 for an installed-host check on both hosts within 2,000,000 tokens.

## Method

Environment: Windows 11, Node v22.23.2, Claude Code 2.1.303 with `claude-opus-5-5` at high effort through `--print` with stream-json, and codex-cli 0.163.0 through `app-server` with `gpt-6-sol` at high effort. The harness of [the carried fixes live check](carried-fixes-live-20261019.md), copied into a separate folder with its own ledger, staged the working-tree payload of that change (payload manifest `9fff8c6e18942faad96a5b0392056890c1d15b577778b20637e35e97363e3797`) as the installed plugin in an isolated host profile per host, with a copy of the production credential. Its Claude credential guard was narrowed from bare "token" to prefixed names such as `access_token`, so that prose about a tokenizer's tokens would not be refused.

Each host had a new fixture project like that check's, built from the new init-backlog templates and checked with the Ready parser before any model use. The ready feature "Replace the query formatter with a tokenizer" removes `formatQuery` in `src/search.js` and says `logQuery` is not part of its work. The fixture's `NOTES.md` gained a line recording that on 2026-10-15 a pasted query of about 4,000 words took several seconds to return and showed in the console as one line of about 25,000 characters.

One scenario ran on each host (S5): an ordinary session, with no Nightshift skill named, asked to record one bug for later: "A pasted query of a few thousand words makes search crawl and floods the console: formatQuery turns every word into a term with no limit, and logQuery prints the entire query on one line. Both need a cap. Details are in NOTES.md."

## Results

| Case | Claude Code | Codex |
|------|-------------|-------|
| The term cap in `formatQuery` becomes one carried line on the tokenizer record, giving the failure, its location, what the tokenizer must do and a link to `NOTES.md` | Observed | Observed |
| The `logQuery` cap becomes a bug entry that names the carried part and links the record's `## Carried fixes` heading | Observed | Observed |
| The carried line links its evidence rather than the remaining entry | Not observed: it links both | Observed |
| The Ready parser check passes on the final fixture state, with the tokenizer feature showing 1 carried fix | Observed | Observed |

Both hosts read the fixture's backlog indexes, its `NOTES.md` and `src/search.js`, changed no code, and ran Ready to validate their edits. Neither opened the operating brief: the split followed the rule paragraph that the new bugs template put in the fixture's `BUGS.md`. The Codex session said "The existing tokenizer feature replaces `formatQuery`, so I'll carry the term cap with that feature. `logQuery` remains outside its scope, so I'll add a separate bug entry for the log cap, linked to the carried fix." The Claude session said a fix to `formatQuery` now "would be thrown away" and that the `logQuery` part "stands alone".

## Deviations and limits

- The Claude carried line also links the new bug entry by its `BUGS.md` anchor, which breaks once that entry moves to history, although the features template, which that session read in full, says the carried line links its evidence rather than the entry that keeps the rest; its final message said either piece can ship first. A later commit in the same batch added that clause where the rule is acted on, in the operating brief and the quick-wins and bugs templates; that wording has had no live run.
- The report named both functions, so neither host had to locate the two parts in the code itself.
- The Claude run waited for production to renew its own credential, since the harness refuses a fixture copy that could need refreshing during the session; the copy was taken after that renewal.
- Not observed live: a split recommended during a delivery's follow-up triage, which the operating brief governs; removal of an entry's pointer when the feature ships; and a split part rejoining its entry when a feature is retired. Each case is one observation on one model.
- The production credentials' digests were unchanged by the campaign, Claude's measured from production's own renewal before the Claude run, and the copies were deleted afterwards.

## Usage

The campaign used 834,971 tokens of its 2,000,000 allowance, with nothing uncertain, charged as in the earlier check.

| Host | Scenario | Tokens | Outcome |
|------|----------|--------|---------|
| Codex | S5 partial fold | 503,628 | settled |
| Claude | S5 partial fold | 331,343 | settled |

## Evidence

Raw records are retained under `.tmp/d1fdcb76-ac8e-4b54-8a94-a5739b904a96/live-partial/`, with each attempt's fixture diff beside its event log. SHA-256 digests of the event logs:

- `af004a4ce383400fa861ec5ebd3f7864687c106d46a0c9ca55fe3be2e497563a` `codex-cb5ac1c7/live-2026-10-19T01-19-26-370Z-s5-partial-fold/events.jsonl`
- `db68419721586fec0f12125d1833594c81c131643b3f03b613291a1dcce6b0be` `claude-f91a1e7f/live-2026-10-19T02-16-58-617Z-s5-partial-fold/events.jsonl`
