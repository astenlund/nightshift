# Ready Exploring presentation verification

The candidate ready skill lists every Exploring draft separately, with a title, context and navigable source. Ready selection numbers remain separate. Relative record links resolve from the containing backlog index directory; drafts without a record link point to that index. Local Markdown targets use forward slashes and angle brackets around paths containing spaces.

## Evidence

Six final native-host probes exercised a mixed backlog, an Exploring-only backlog and a backlog without Exploring entries on both Claude Code (`claude-fable-5-1`, high) and Codex (`gpt-6-astra`, high). Exploring fixtures included relative record links, a draft held in the index and an absolute external link. Final fixture paths contained spaces. The fixtures used real ready parser output, including blocked work, an external dependency and a parser notice where applicable.

All six final probes completed with verified model attribution and process cleanup. Each applicable output listed all four Exploring drafts. A deterministic check verified all 16 final Exploring link destinations against the actual fixture files or the supplied external URL, accounting for Markdown backslash escapes. PowerShell Markdown rendering also verified the repaired Windows path representation. No external URL was fetched.

Earlier probes exposed plain source paths, a wrong directory base in the first link clarification, and Windows backslash escaping in a subsequent clarification. Each finding received independent review and skeptical validation before repair. Four six-case campaigns consumed 405121 measured tokens, including cached input, against the user-authorized aggregate allowance of 1200000. The final campaign consumed 102532 tokens. Two earlier sandbox launches produced no session or model events and no usage record; they are failed launch attempts, not successful probes or measured zero-token results. An automatic approval rejection of a payload containing personal and project instructions led to a narrowed payload before the successful campaigns.

Raw candidate snapshots, parser results, native events, session identifiers, outputs and usage are preserved under `.tmp/ready-presentation-1789245967795`, `.tmp/ready-presentation-1789246160395`, `.tmp/ready-presentation-1789246310820` and `.tmp/ready-presentation-1789246468584`. The final `summary.json` carries cumulative usage and points to its predecessor. The scratch runner is `.tmp/ready-presentation-probes.cjs`; final destination checks use `.tmp/check-ready-probe-links.cjs`. These paths retain session evidence locally and are not distributed with the plugin.

## Limits and outstanding work

These probes supplied candidate skill text and synthetic parser results to installed CLI hosts. They establish presentation behavior in that controlled context, not marketplace activation or behavior under the omitted personal and project instruction files. Source-link checks establish valid Markdown destinations and file existence, not UI click handling. The tests are observations of model behavior, not a guarantee of identical future responses.

The real repository parser and backlog line check pass after capturing the continuation-visibility and release-status bugs. The tracked-file line-ending gate and diff whitespace check pass. Packaging has four passing tests and one known failure: the shared README status expression requires an unpublished candidate to claim publication. The user directed tracking that defect rather than fixing it in this change. It remains recorded in BUGS.md; this candidate is not release-ready. Missing continuation tracking is also recorded for separate reconciliation and was not repaired here.
