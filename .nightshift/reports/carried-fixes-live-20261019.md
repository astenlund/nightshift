# Carried fixes live check

The unpublished 3.3.13 batch adds [Fold fixes into the feature that replaces their code](../features/fold-fixes-into-features.md) at commit `89290b3d`: the operating brief's follow-up triage, the quick-wins and bugs templates and the features template carry the rule, the Ready skill shows the `carriedFixes` count Ready now reports, and a feature's readback covers its carried fixes. The user asked on 2026-10-19 for an installed-host check on both hosts and granted 24,000,000 tokens for it.

## Method

Environment: Windows 11, Node v22.23.2, Claude Code 2.1.303 with `claude-opus-5-5` at high effort through `--print` with stream-json, and codex-cli 0.163.0 through `app-server` with `gpt-6-sol` at high effort. The live harness kept in `.tmp/handover-live`, copied into this session's own scratch folder and adapted, staged the working-tree payload of commit `89290b3d` (payload manifest `321a880884f7b91a897aaea1d0720e338d6e051e5b8adbe3df4eb9b03f15d16e`) as the installed plugin in an isolated host profile per host, with a copy of the production credential. It offered the Claude fixture AskUserQuestion and answered each call with a denial saying the user would reply in the next message; the Codex driver offers no question tool. The fixture told each controller not to dispatch independent model reviews unless a user message authorized them.

Each host had one fixture project whose backlog was built from the new init-backlog templates and checked with the Ready parser before any model use. `src/search.js` holds `formatQuery`, `logQuery` and `pageResults`, and `src/render.js` holds `escapeHtml`. The ready feature "Replace the query formatter with a tokenizer" removes `formatQuery`; the ready feature "Page search results" rewrites `pageResults`, touches `src/render.js` and says `formatQuery`, `logQuery` and `escapeHtml` stay as they are, and its record already carried one fix; the Exploring draft "Render results through templates" would replace `escapeHtml`. Three reported bugs exercised each branch: a quoted phrase split by `formatQuery` should fold into the tokenizer feature, `logQuery` ignoring the logging setting touches a feature's module without qualifying, and `escapeHtml` double-escaping ampersands qualifies only for the Exploring draft. The project was restored to its baseline commit between scenarios that edit it.

Scenarios: Ready, then selecting the paging feature (S1); an ordinary session asked to record the three bugs in the backlog for later, with no Nightshift skill named (S2); a handover of the fixture's quick win in which the user gives the three bugs for triage on return (S3); and the returning user answering "Go with your recommendation." to each triage item (S4).

## Results

| Case | Claude Code | Codex |
|------|-------------|-------|
| Ready shows the count beside the ready feature that carries a fix and weighs it in the recommendation | Observed | Observed |
| Selecting that feature gives a readback that covers its carried fix | Observed | Observed |
| An ordinary session folds the qualifying bug as one carried line and records the other two as bug entries | Observed | Observed |
| Delivery records each bug as a follow-up whose recommendation names the feature to fold into or says that none qualifies | Observed | Observed |
| Triage presents each item with that recommendation, one at a time | Observed, through AskUserQuestion | Observed, as plain-text questions |
| The tracking edits after triage fold the first bug and add entries for the other two | Observed | Observed |

On both hosts Ready listed the paging feature with "1 carried fix" and recommended it first because that fix addresses the recorded loss of results, and the readback after selection named the carried fix; the Claude readback also said the history entry would list it. In S2 both hosts added `## Carried fixes` to the tokenizer record with a line giving the failure, its location in `formatQuery`, what the tokenizer must do and a link, and filed the other two bugs in `BUGS.md`; the Claude entry for the `escapeHtml` bug said the Exploring draft "has not settled that yet, so this stays a standalone bug". In S3 and S4 the Claude controller's follow-ups and questions said the tokenizer feature removes `formatQuery`, that both ready features leave `logQuery` alone, and that the draft "is still an exploring draft, so it can't carry the fix". The Codex controller's questions recommended folding the first bug into the tokenizer feature because it removes `formatQuery`, and tracking the second because that feature leaves `logQuery` alone and the third because the template-rendering idea is still Exploring and the paging feature leaves `escapeHtml` unchanged. The Ready parser check passed on the Claude S2 rerun and on both hosts' final fixture states.

## Deviations and limits

- The Claude carried line written after triage ends "reported by the user on 2026-10-19" with no link, where the rule asks for a link to the evidence; the other three carried lines link the source file.
- The Codex controller applied each tracking edit right after its decision, before the next item, while the brief applies tracking edits after triage is recorded; this behavior is not part of the change.
- The first Claude S2 attempt tried to fold the first bug, but the harness refused the edit: its credential guard matched "token" inside "tokenizer". The guard was narrowed to whole words and S2 was run again, which is the observation above.
- The Claude handover reached its 4,000,000-token ceiling after recording the follow-ups and before its morning report, and the first return session reached its 5,000,000-token ceiling at the third triage question. Two further resumed turns finished it; the first asked the third question again because the interruption fell after it, and the second applied the edits. These Claude controller sessions used much more than the 2,159,052 and 2,625,663 tokens of the two Opus handovers on the 3.2.10 payload recorded in [the host-question triage report](host-question-triage-20260926.md), while the Codex handover completed in 1,997,014.
- Not observed live: a history entry listing carried fixes when a feature ships, triage again when a feature is retired, a repeat adding a date, a stopgap, and the notice for an Exploring draft that carries fixes, which rests on parser fixtures. Each case is one observation on one model.
- The production credentials' digests were unchanged after the campaign, so no fixture refreshed them, and the copies were deleted afterwards.

## Usage

The campaign used 20,021,803 tokens of its 24,000,000 allowance, with a further 128,000 reserved as uncertain for a possible in-flight response in each of the two interrupted Claude attempts: Claude 13,394,251 and Codex 6,627,552. The harness charges each attempt the sum of its messages' input, output, cache-read and cache-write counts on Claude and the thread's total on Codex, and a resumed session only its own usage.

| Host | Scenario | Tokens | Outcome |
|------|----------|--------|---------|
| Claude | S1 Ready and readback | 305,725 | settled |
| Claude | S2 track bugs, edit refused by the harness | 384,403 | settled |
| Claude | S2 track bugs, rerun | 675,178 | settled |
| Claude | S3 handover | 4,095,290 | ceiling, reconciled |
| Claude | S4 return and triage | 5,049,635 | ceiling, reconciled |
| Claude | S4 resumed, third question asked again | 327,842 | settled |
| Claude | S4 resumed, third answer and edits | 2,556,178 | settled |
| Codex | S1 Ready and readback | 479,468 | settled |
| Codex | S2 track bugs | 559,343 | settled |
| Codex | S3 handover | 1,997,014 | settled |
| Codex | S4 return and triage | 3,591,727 | settled |

## Evidence

Raw records are retained under `.tmp/d1fdcb76-ac8e-4b54-8a94-a5739b904a96/live/`, with each attempt's fixture diff beside its event log. SHA-256 digests of the event logs:

- `605f643dd8c2bf7b3b3b393b6b41ff79b56916aa74dbc7d1305f85da13cbfe08` `claude-24413941/live-2026-10-19T00-04-19-505Z-s1-ready-readback/events.jsonl`
- `d18b9961e12e1b2dfbc6f6352ecd8e65205e160eb9a00a40ac86ddfa9661793f` `claude-24413941/live-2026-10-19T00-06-06-724Z-s2-track-bugs/events.jsonl`
- `e8515ed0ba1d1d2e742158a0b67e4ab25fed4b59ccc13cdeb95189316577183b` `claude-24413941/live-2026-10-19T00-08-13-126Z-s2b-track-bugs/events.jsonl`
- `252afdb2c9f3291fcc74f27bddb2c2f6331cd930ada0cbc33f3c5c23098f3561` `claude-24413941/live-2026-10-19T00-10-24-436Z-s3-handover/events.jsonl`
- `0a0a8f48861af215b067d995e86e83a5b2b902837cd9394e5365f61f13f8ca30` `claude-24413941/live-2026-10-19T00-17-39-186Z-s4-return-triage/events.jsonl`
- `db207344b0b74f867831f215a36e887eebb631fb2b55e168ba4e506588424872` `claude-24413941/live-2026-10-19T00-33-46-137Z-s4b-triage-finish/events.jsonl`
- `127cc64df1d8efc78784a762588e03ff438b1e9c3638c97928cfbd52758de6f9` `claude-24413941/live-2026-10-19T00-34-32-678Z-s4c-triage-answer/events.jsonl`
- `0e19c0dff02fb88e04a159083ac9f186a4f2f67908ab473c2a235129355e1378` `codex-f013c33e/live-2026-10-19T00-24-07-165Z-s1-ready-readback/events.jsonl`
- `4378d8066b695af41a69f505daaadfee4f8c57137f1775d52eb58717d03c629e` `codex-f013c33e/live-2026-10-19T00-26-55-933Z-s2-track-bugs/events.jsonl`
- `a100b06aacba8ceb6746ef6b8543b61e279411cdd2ddd0f2ddb69debf62f1933` `codex-f013c33e/live-2026-10-19T00-28-52-140Z-s3-handover/events.jsonl`
- `29973ece5aa385ae1664e3ddc73ef8d53652e113308ad0feba57b39bafbb5ba5` `codex-f013c33e/live-2026-10-19T00-37-03-657Z-s4-return-triage/events.jsonl`
