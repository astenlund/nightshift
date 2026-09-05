# Bullet-entry selector re-keying and within-digest continuation

Re-keys the bullet-entry selector in `skills/spec-agreement/spec-agreement.js` from an index-only entry's entire first-line text to its bold entry title, so editing an entry's body is a source change rather than a structural candidate change, and persists the standing ruling that a fix staying within the accepted digest continues on retained authority.

## Motivation

The selector keys an index-only entry on the whole text of its first line. Every spec-gate fix to such an entry therefore changes the selector itself, which the controller classifies as a changes-contract event: authority is invalidated and renewed agreement is required at that round boundary. Under the unattended rule, that stops a handover over an index-only entry at the very first applied fix, which is the ordinary case rather than an edge case. The selector is trying to identify the entry, and an entry's identity is its title, not its prose.

The two halves belong together because the ruling and the selector are the same defect seen from two sides. Re-keying stops most within-digest body edits from ever reaching the changes-contract path, and the persisted ruling covers the ones that still do.

## Selector re-keying

The selector keys on the bold entry title, the text between the leading `**` and the closing `.**` of the bullet. Body edits below that title then flow through the source-diff and contract-fit path exactly as an edit to a breakout file does, and only a title change is a structural candidate change.

Design points to settle at pick-up: how the selector behaves when two entries in one index carry the same bold title (today the whole-line key made collisions unlikely), what happens to an entry whose bullet has no bold title at all, and whether a title edit that is purely cosmetic should still be a structural change or should route through the same fit check as a body edit. The parser and the agreement controller must agree on the title extraction, so the grammar has one owner rather than two approximations.

## Persisting the within-digest continuation rule

The standing ruling is that a spec-gate fix which stays within the accepted digest's decisions does not require renewed agreement: the run continues on retained authority and the controller records its within-digest judgment. This is currently a session ruling and must become durable text in `skills/spec-agreement/SKILL.md`, stated together with the selector consequence that a structural change caused only by a bullet-entry body edit routes through the source-diff and fit path rather than changes-contract.

The persisted rule states the recorded judgment's form, so a later reader can tell a within-digest continuation from an unrecorded one, and states the complementary branch: a fix that leaves the accepted digest's decisions still requires renewed agreement, and with no user available the run stops rather than continuing on a widened reading.

## Files this touches

- `skills/spec-agreement/spec-agreement.js`: the bullet-entry selector and whatever candidate comparison consumes its key.
- `skills/spec-agreement/SKILL.md`: the persisted within-digest continuation rule and the routing consequence.
- `skills/spec-agreement/spec-agreement.test.js`: fixtures for the re-keyed selector and for the routing of a body-only edit.
- The repository guidance sentence on compatible governing-text changes, which states the same continuation rule and must not drift from the skill text.

## Verification

Fixtures cover a body-only edit under an unchanged title (source-diff and fit path, authority retained), a title edit (structural candidate change, renewed agreement), a bullet with no bold title, two entries sharing a bold title, and a fix that leaves the accepted digest's decisions (renewed agreement required, and a stop when no user is available). A handover-shaped fixture proves that an index-only entry now survives its first applied spec-gate fix without an agreement stop.
