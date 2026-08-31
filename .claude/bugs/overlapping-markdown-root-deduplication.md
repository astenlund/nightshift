# Overlapping Markdown roots can lose or duplicate collected files

Bug: Markdown collection can emit duplicate files or omit files when its inputs repeat or alias the same paths, or when one root contains another.

## Observed behavior

The defect was confirmed during the second deterministic init-backlog review run. `collectMarkdownFiles` receives roots and individual files that may be repeated, expressed through absolute aliases, or nested beneath one another, but its traversal and emission bookkeeping do not share a complete identity and coverage contract.

The deciding counterexample is nested-root order. When a nested root is visited before its parent, marking that subtree as visited can cause a later recursive walk from the parent to skip the subtree without having emitted every file that the parent traversal owns. A visited-root early return therefore fixes some duplication cases by introducing loss in another ordering.

Normal `/nightshift:ready` use supplies one root, so the confirmed defect was routed rather than repaired inside the completed slice. Callers that compose or alias roots still need deterministic complete results.

## Expected behavior

Collection returns each Markdown file once by canonical file identity while preserving the first accepted path and its authority spelling in the result. Repeated roots, repeated files, absolute aliases, and overlapping roots produce the same complete ordered set regardless of which overlapping root appears first.

Traversal coverage and emitted-file identity are separate concerns: proof that a root was visited does not imply that every file needed by a later traversal has already been emitted.

## Fix boundary

- Define canonical file identity for repeated and aliased file inputs and apply it consistently to emission de-duplication.
- Define traversal coverage for overlapping roots independently from emitted-file identity.
- Preserve the first path and authority spelling selected for each emitted file.
- Retain current behavior for the normal single-root ready path and avoid changing Markdown parsing or backlog authority rules.

## Regression needs

- A single root still returns its complete current result.
- Repeating the same root does not duplicate files.
- An absolute alias of an already supplied root or file does not duplicate files and preserves the first spelling.
- Repeating an individual file emits it once.
- A nested root followed by its parent emits every file once.
- A parent followed by its nested root emits the same complete file set once.

## Status

Confirmed as a collector defect in revise-code Round 61 and retained by morning-report triage on 2026-08-31. The repair requires deliberate traversal semantics rather than a root-only visited shortcut.
