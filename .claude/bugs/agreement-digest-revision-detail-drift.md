# Agreement digests drift toward micro-detail through review revisions

Bug: repeated spec-review revisions can turn the user-facing decision-complete digest into an expanding inventory of lifecycle and implementation-level details, forcing renewed approval for changes that remain within the previously accepted macro design.

## Observed behavior

The agreement skill requires every material decision to be rendered on every presentation, but it does not distinguish a governing design decision from the detailed contract wording introduced while review findings are resolved. As a spec is revised, each accepted correction can therefore enlarge the next digest. The user is repeatedly asked to approve lower-level failure branches, field lifecycles, bounds, and recovery details even when the goal, scope, architecture, ownership, and other high-level decisions are unchanged.

This progressively detailed digest undermines autonomous handover and makes approval granularity depend on the review history rather than on a changed governing decision. It also risks hiding the genuinely new macro decision inside a growing body of micro-contract text.

## Expected behavior

The digest remains decision-complete for the governing design while presenting a stable macro-level decision surface. Review revisions that fit the accepted goal, scope, architecture, ownership, and other high-level decisions do not create a new approval boundary merely because their contract details are more precise. Those details remain available in the governing artifact and review evidence, and can be routed to the implementation plan or a follow-up when they are outside the digest's approval scope.

A renewed digest and explicit agreement are required when a revision changes a high-level design decision, expands scope, changes ownership or architecture, or otherwise cannot be shown to fit the accepted macro contract. The digest must not omit a genuinely changed governing decision in the name of brevity.

## Fix boundary

- Define the macro decision surface used for agreement and distinguish it from detailed lifecycle, schema, failure, recovery, and verification wording.
- Preserve direct access to complete governing artifacts and review evidence; this is a digest-scope change, not permission to hide material contract content.
- Route compatible detail to the plan or a tracked follow-up, and require renewed agreement only for an actual macro-level change or an unresolved fit boundary.
- Keep the controller's candidate, fingerprint, exact response binding, and invalidation rules authoritative.

## Regression needs

- A sequence of compatible review corrections does not make the approval digest grow by accumulating micro-level decisions.
- A change to goal, scope, architecture, ownership, or another high-level decision does produce a renewed digest and approval boundary.
- Detailed governing text and review evidence remain discoverable even when they are not repeated in the digest.
- A compatible detail that cannot be shown to fit the accepted macro contract stops for renewed agreement rather than being silently treated as compatible.

## Status

Open. Captured after the 2026-08-31 Session focus review, where successive revisions made the approval digest increasingly granular.
