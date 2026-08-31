# Ignore election cannot initialize a missing `.gitignore`

Bug: A Git repository with no `.gitignore` cannot take the ignore election branch because the controller has no unambiguous newline base for creating the file and refuses the operation fail closed.

## Observed behavior

The defect was confirmed during the deterministic init-backlog election work on 2026-08-28. When `.gitignore` is absent, the elective append cannot be constructed without choosing the new file's newline form. The existing gate refuses to invent that choice, so a bare repository cannot select the ignore route even though that route should be available.

The refusal is safe and pre-existing: it prevents an ambiguous write. The bug is that the election has no defined way to establish the missing file's newline form, not that the refusal should be weakened.

## Expected behavior

The ignore election is reachable when `.gitignore` is absent. The workflow establishes an explicit newline rule for creation before it proposes or applies the edit, then creates the exact elected ignore content using that rule.

If the required newline choice cannot be established, the operation still fails closed and leaves the repository unchanged. Existing-file append behavior and the election's no-write-before-acceptance boundary remain intact.

## Fix boundary

- Define where the creation newline choice comes from and make that choice visible or otherwise authoritative at the election boundary.
- Keep missing-file creation distinct from appending to an existing empty or non-empty file.
- Preserve fail-closed behavior for ambiguous or invalid newline evidence instead of silently selecting a default.
- Do not broaden the closed action schema or change unrelated Git track and ignore policy.

## Regression needs

- A repository with no `.gitignore` can elect ignore and receives the exact ignore content in the established newline form.
- An existing empty `.gitignore` follows the defined newline rule and produces valid elected content without an ambiguous base.
- Mixed-newline repository evidence follows the defined choice rule or refuses cleanly, with no partial write.
- A declined election and every failed validation path leave `.gitignore` absent or byte-identical to its original state.

## Status

Confirmed during the 2026-08-28 election fixes and retained by morning-report triage on 2026-08-31. The design must settle the newline-choice source before implementation.
