# Compact run history

## Outcome and boundary

Stop run history from costing a full state copy per revision, for new revisions and for every existing run, retired runs included, without changing any byte a reader, hash or certificate sees. It realizes the storage part of the bug [Run store keeps a full state copy for every revision](../BUGS.md#run-store-keeps-a-full-state-copy-for-every-revision). The bug's other parts, shrinking what a state carries (its repeated `commitments` copies and its finished workers, checks, reviews and findings), change what states hold and are outside this spec.

Two changes, which ship together: a third store version whose `history` table holds most rows as small structural deltas behind one read helper, and an administrative action that rewrites an existing store into that version. Both apply to the delivery store `state.sqlite` and the review store `review-state.sqlite`, which `RunStore` writes alike. Runtime changes ship with a version increase.

## Measured basis

Measured read-only on 2026-11-01 with session scripts over this repository's store and the disco-elysium-companion store. A structural delta between consecutive history rows of one run, replayed onto the parsed earlier row and serialized with `JSON.stringify`, rebuilt the stored bytes exactly on 847 of 847 rows, in three windows (149 late revisions of `67af3471`, the first 400 of `dcd9e840`, 300 of the companion's `cffcf94d`) covering about two dozen transition kinds. Deltas were 113 to 1,600 times smaller than their rows; progress ticks took about 280 to 840 bytes against rows of 0.1 to 2.7 MB. Computing a delta took 1.2 to 32 ms per row, growing with state size. For comparison, brotli on whole rows gave 6.7 to 11 times. The largest run's history was 4.89 GiB over 3,518 revisions, and 64% of its bytes were progress revisions.

## Stored form

Store version 3 replaces the `history` table with these columns, in order: `run_id TEXT NOT NULL REFERENCES runs(id)`, `revision INTEGER NOT NULL`, `kind TEXT NOT NULL`, `recorded_at TEXT NOT NULL`, `encoding TEXT NOT NULL`, `bytes INTEGER NOT NULL`, `digest TEXT NOT NULL` and `body TEXT NOT NULL`, with primary key `(run_id, revision)`. `run_id`, `revision`, `kind` and `recorded_at` keep their version 2 meaning. `bytes` is the UTF-8 byte length of the revision's full state text, the value `length(CAST(state AS BLOB))` gives in version 2. `digest` is the lowercase hex SHA-256 of that full text. `encoding` is `full` or `delta`: a `full` row's `body` is the full state text itself, and a `delta` row's `body` is the JSON text of a backward delta, the change that turns the next revision's full state into this one.

Which rows are full: the row at a run's current revision, every row whose revision is a multiple of 64, and a row with nothing to diff against, because the next revision has no row or is not JSON, or whose own text is not JSON or does not round-trip as described below. Every other row is a delta. A revision is rebuilt from the nearest full row at or above it, applying the deltas downward one revision at a time, so a rebuild reads at most 64 rows. Backward deltas keep the rows that readers fetch most, each run's current and latest rows, full, and they keep a retired run's whole history unchanged once written, since its current row stays full and no later revision is ever added.

The delta grammar, mirroring the spike that measured it: a delta is `null` when the two states are identical; `{"set": value}` replaces a value outright; `{"fields": {key: delta}}` changes the named keys of an object whose key order is unchanged, and `{"keys": [...], "fields": {...}}` does the same when the key order changed, listing the result's complete key order; `{"length": n, "items": {index: delta}}` gives an array its length `n` and changes the listed indices, with every index at or past the source's length given by `set`. Applying a delta yields a value; the rebuilt text is `JSON.stringify` of it. Any other shape is invalid.

Every rebuild is checked: the rebuilt text's byte length must equal the row's `bytes` and its SHA-256 its `digest`, or the read fails with the new error `history-unavailable`, naming the run and revision, and no partial state is returned. Since each delta is applied to the revision above it, a damaged full row also leaves the delta rows below it, down to the next full row, unreadable, and they fail the same way. A writer checks before it commits: when it replaces a full row by a delta, it rebuilds that row from the delta and the new full row and compares the result with the bytes it replaces, and when they differ it keeps the row full. A full row is always a valid form, so the fallback never loses anything, and a state whose serialization does not round-trip, such as text written by another tool, simply stays full.

## Writing

On a version 3 store, `RunStore.save` inserts the new revision as a full row and, in the same transaction, replaces the previous revision's row by its backward delta unless that revision is a multiple of 64. It builds the delta from the predecessor state it already parses and the encoded state it is about to write, so it reads no extra rows. `runs` is unchanged: it still holds each run's full current state. Retired runs are never written, as now. Saving costs the delta computation and its check, at most about twice the measured 32 ms on the largest states.

On a version 1 or 2 store, `save` writes full rows exactly as today. A store moves to version 3 only through the action below, or by being created after this change ships, when `RunStore` initializes a fresh store directly at version 3.

## Reading

One helper module owns history access. Through a reader for one run, it returns a revision's `revision`, `kind`, `recordedAt`, `bytes` and exact full text, or its metadata alone without rebuilding; a range is read as its metadata and then each revision's text through one reader, which keeps the states it rebuilt, so walking consecutive revisions parses each full row once. It also returns a run's metadata over a revision range, every revision's `revision`, `kind` and time for one run or for every run, and every run's rows of given kinds with their text. It reads version 1, 2 and 3 stores alike. Every bound that today measures a history row with `length(CAST(state AS BLOB))` measures `bytes` instead, which is the same number, before anything is rebuilt, and charges the same budgets the same amounts. A rebuild reads at most 64 rows, which the helper reads directly; their stored sizes are not charged, since the budgets bound the states a caller receives, not the rows read to produce them.

Every current reader of `history` moves to the helper, by file:

- `internal/runtime/store.js`: `transitions` (metadata), `history` (range), `save` (the write above, and creation's check that no history exists).
- `internal/runtime/progress-store.js`: `committed`, `reminderProvenance` and `recover`, whose 256-revision replay and gap check keep their meaning, since every revision still has a row.
- `internal/runtime/creation-consistency.js`: the latest-row sum, the latest-revision check, the latest row's state, and the latest `complete` revision.
- `internal/runtime/legacy-inventory.js`: the latest-row sum, the latest-revision and latest-row reads in `load`, and `rawInspect`'s range.
- `internal/runtime/legacy-certificates.js`: the earlier revisions a certificate chain validates.
- `tools/fortnight.js`: the metadata scan and the states it reads for its state and dispatch kinds; it reads other projects' stores, so it must read all three versions.

Apart from the helper and the migration action below, which reads the original store's rows and writes the new store's directly, nothing in `internal`, `skills`, `tools` or `hooks` queries `history`. Tests whose SQL depends on the history columns, to read a row's text or to write or rewrite one, use the helper or a version-aware fixture builder, or are rewritten for the version 3 columns; tests that only count or delete rows keep their SQL, which reads no version-specific column; tests that build earlier-version stores to exercise migration keep the earlier columns; and the damage cases gain version 3 counterparts (a corrupted delta, a wrong digest, a missing full row).

The schema checks in `internal/runtime/legacy-store.js` (`schemaState` and the expected columns, keys, types, nullability and foreign keys) gain a version 3 description of `history`, and the retirement triggers on `history` are defined over the version 3 table with the same events and test. `STORE_VERSIONS` in `internal/runtime/store.js` gains 3, which also admits it in `internal/releases/service.js` and `internal/runtime/review-inventory.js`, neither of which reads `history`. Migration inventory's store hash counts a version 3 store as version 2, since the version changes only how history is stored, not the records an approval binds, so a retirement manifest approved before compaction stays current after it and an identical retirement retry is still recognized.

## Compatibility

A release from before this change refuses a version 3 store, since every reader checks the version: `RunStore` with `state-version`, the launcher service with `run-resource-state-unavailable`, and review inventory with its own refusal. That is the intended fail-closed outcome, not a silent misread. It rests on those releases' own version checks, which admit no version above 2, so this change's tests cannot exercise it. It means a session still bound to an older retained release cannot operate a project once its store is migrated, which is why the action refuses while any record in the store is running.

## Migration action

A new action, `compact-history`, on the administrative migration entry (`internal/runtime/migration-cli.js`), with current administrative admission as `retire` requires. It takes the store to migrate, `delivery` or `review`, and acts on that one file.

It refuses, changing nothing, when: the store is already version 3; any record in it has status `running`; a SQLite journal, WAL or shared-memory sidecar of the store exists, so that no interrupted transaction is pending; the store is not an ordinary singly linked file or fails `schemaState` or `verifyTriggers`; a backup from an earlier compaction, below, sits beside a store that is not version 3, with `compaction-backup-present`; or the project write lock cannot be taken. It holds that lock throughout.

It builds the migrated store in a new file beside the original, named after it with `.compacting` appended, never in place, so its disk need is the migrated size, not a second copy of the original. Into that file it writes the version 3 schema, copies whichever of `runs`, `active`, `artifacts`, `accounting_commits`, `discharge_index` and `legacy_retirements` the original has, row for row and byte for byte, adds an empty `artifacts` table when the original, a version 1 store, has none, since version 3 requires one, rewrites every history row into the version 3 form by the rules above, creates the retirement triggers, and sets `user_version` to 3. Before swapping, it verifies the new file against the original: every history row rebuilds to the original row's bytes, kind and time, every other table holds the same rows, the two hold the same tables apart from that added empty `artifacts`, so an original table outside the copied set fails verification rather than being dropped, the new file passes `schemaState` and `verifyTriggers`, and the row counts match. A failed verification removes the new file and refuses with the first difference named.

The swap renames the original to the same name with `.pre-compaction` appended, then renames the new file to the original name. The original stays as that backup until a second invocation, `compact-history` with `finish`, verifies the migrated store against it once more and deletes it. Each durable state and what a rerun does in it:

- No new file and no backup: start.
- A new file and the original, no backup: the new file is never authoritative; delete it and start again.
- A backup and a new file, no store at the original name: complete the second rename, then report as swapped. Until then the runtime finds no store and fails closed with `missing-state`, as it does for any missing store.
- The migrated store and a backup: report as swapped; `finish` verifies and deletes the backup.
- The migrated store alone: done; `finish` reports nothing to finish.
- A backup alone, with neither a store nor a new file, which the action never leaves itself: it refuses, naming the backup, and the user restores the original by renaming the backup back to the store name.

On Windows a rename fails while another process holds the file open, such as a hook's read-only connection. The action then stops in the state it reached, refuses with `compaction-swap-incomplete`, and a rerun continues from that state. Deleting the backup in `finish` can fail the same way; it then refuses with `compaction-finish-incomplete`, keeping the backup, and `finish` can be run again. Of the states above, only the backup alone, which the action never produces, needs the user to rename a file by hand.

Every swapped result, including one from a resumed or repeated run, reports the store's size before and after, the before size being the backup's, the history row and byte counts by encoding, read from the migrated store, and the backup's path.

## Out of scope and open decisions

The state-size parts of the bug stay tracked there: replacing the `commitments` copies on workers and reviews with a fingerprint, since every reader only compares them for equality, and keeping finished workers and closed task content out of the per-revision state, which first needs every reader of `workers` classified.

Decided here unless the user changes them: a keyframe every 64 revisions; migration only through the explicit action, never automatically at creation; and the backup kept until `finish`. An unmigrated store therefore keeps full rows for new runs until its user runs the action, which the handover and setup documentation should point to once this ships.

## Verification

Deterministic tests: the delta grammar's round trip on states covering key reordering, added and removed keys, integer-like keys, array growth and shrinkage, nested changes, Unicode and empty values, each rebuilt byte-exact, and every invalid delta shape refused; a writer keeping a row full when its delta does not round-trip; reads of every kind through the helper on version 1, 2 and 3 stores returning identical text; `history-unavailable` for a corrupted delta, a wrong digest or a missing full row; the existing runtime suites passing against version 3 stores, including accounting recovery, reminder provenance, creation and certificate validation over retired runs with superseded certificates; a review store compacted as the delivery store is; `compact-history` refusing each precondition, verifying, and resuming from every durable state listed above, including a simulated failed rename; `finish` before and after the swap; and `tools/fortnight.js` producing the same rows on a store before and after migration.

On real data: migrate a copy of this repository's store, never the original, and record its size before and after, the action's time, and that every operation's results, `inventory`, `raw-inspect` ranges and `tools/fortnight.js` output among them, match the unmigrated copy.
