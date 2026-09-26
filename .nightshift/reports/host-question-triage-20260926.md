# Host-question triage acceptance

The 3.2.10 candidate defines a host question in the operating brief: every triage item except the one that ends a morning report is presented through the host's native multiple-choice question tool, such as AskUserQuestion on Claude Code, with the item's context, recommendation and the effect of each option inside the question and option descriptions; the report's own closing question stays plain text in its final message, and plain text remains the fallback where a host has no such tool. The handover skill and the two morning-report notices in `internal/runtime/hook.js` use the same distinction. The user asked for the rule to be enforced by the plugin after the triage of run `36aad5de-2825-4818-ba8c-e1ea8c8e72a4`, where the controller presented later items as plain text.

## Method

Environment: Windows 11, Node v22.23.2, Claude Code 2.1.283 with `claude-opus-5-5`, driven through `--print` by the retained `.tmp/handover-live` harness, which now offers the AskUserQuestion tool to the fixture controller and records each call, answering it with a denial that says the user will reply in the next message. The fixture staged payload manifest `8316d744ee0a1e5eeff5e366e9dcb61258eeac25a8b449094c0612b8050fdf76`, the manifest at commit `59dcd79`; review later reworded only the brief's exception sentence, so that an item first asked inside the report is a host question when asked again, which this observation did not exercise. A handover session delivered one quick win unattended and recorded a morning report with two optional follow-ups; a resumed session then played the returning user: "I'm back. My terminal was cleared, so I can't see anything from before." followed by "Track it." Codex was out of scope by agreement.

The run drew on the live-verification allowance of run `36aad5de`, as the user authorized on 2026-09-26 by answering "a" to a readback whose option (a) proposed verifying on Claude from the remainder of that allowance: its ledger now stands at 24,068,086 metered tokens plus 1,028,000 uncertain, 25,096,086 of 32,000,000. This campaign's three attempts (a first-use session 142,761, the handover 2,159,052 and the returning session 2,908,468) added 5,210,281, but the returning session resumed the handover session and the harness charges its cumulative reported usage in full, so 2,159,052 is counted twice: the campaign's own usage is about 3,051,229, and the ledger overstates the spend by that double count.

## Results

| Case | Claude Code | Codex |
|------|-------------|-------|
| Re-presented report ends with the first follow-up as a plain-text question | Observed | Not run |
| After the user's answer, the next follow-up is presented through the host's question tool with its context, recommendation and option effects | Observed | Not run |

In the first returning turn the controller re-presented the saved report in full, ending with "First follow-up: should renaming `NOTES.md` to `DECISIONS.md` ... be done now, tracked as a quick win for later (my recommendation), or skipped?". After "Track it." it recorded the delivery and the decision, applied the tracking entry, and called AskUserQuestion for the second follow-up with the question "Second follow-up from your handover: should the project get a CHANGELOG.md? ... I recommend tracking it as a quick win." and the options Track (Recommended), Fix now and Skip, each with its effect. This is one observation on one model.

## Evidence

Raw records are retained under `.tmp/handover-live/claude-749e30f8/`. SHA-256 digests of the event logs:

- `22e46768a71339465861fdd2f0d0e4424d7c8f25168860bdeb5a176b771d2b5f` `live-2026-09-26T06-55-45-068Z-hq-handover/events.jsonl`
- `a60f4ae79c5452ac701d664f6a2871ce12c6fd9bb247f561b6e1008bb4523823` `live-2026-09-26T07-01-28-021Z-hq-return/events.jsonl`
