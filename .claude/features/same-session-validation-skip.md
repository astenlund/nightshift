# Same-session validation skip and validation stamp

Handover's validate-before-proceeding step stops running a full fresh validation agent unconditionally. When the governing agreement was obtained in the current session and the governing bytes have not moved since that digest, the step narrows or skips the fresh agent, and when it does run, a validation stamp records the commit and content hash it passed over so a later shift start can reuse the result instead of revalidating identical bytes.

## Motivation

The validation step exists to protect against a governing spec that was agreed in an earlier session, on a different tree, or by a different actor. When the agreement digest was presented and accepted minutes earlier in the same session and no byte of the governing set has changed since, the fresh validation agent re-derives conclusions the session already holds in full context, at the cost of a whole agent dispatch on the critical path between agreement and work. The user raised this directly: revalidation looks unnecessary when the session has the full context of the agreement it is validating.

The second half is the durable form of the same argument. A validation that passed is evidence about specific bytes at a specific commit, exactly like a hardening stamp. Today that evidence dies with the session, so a shift that resumes agreed, unchanged work pays for the validation again.

## Same-session narrowing

The narrowing fires only on the conjunction of two facts the controller can establish without a judgment call: the accepted agreement was bound in this session, and the governing bytes hash equal to the bytes the accepted digest was composed over. Either fact absent means the ordinary full validation runs.

The design must settle whether the narrowed path is a skip or a reduced check. A skip is cheapest and matches the user's framing. A narrowed check is a smaller fresh agent that verifies only what the session cannot vouch for by construction, for example that the governing set on disk still resolves to the same artifacts and that no sibling file the digest cited has moved. The choice is a decision this feature owns rather than an implementation detail, because it determines what the run's evidence trail claims.

Whatever the narrowed path does, the run states which path it took and why, so a reader of the report can tell a skipped validation from a passed one. A skipped validation is never reported as a passed validation.

## Validation stamp

A passed validation writes a stamp recording the commit the validation ran against and a content hash of the governing set, using the same content-fingerprint recipe the hardening stamps use, so the two stamp families are comparable and a reader does not have to learn a second hashing convention.

A later shift start reads the stamp and reuses it only when both recorded values still match: the recorded commit is an ancestor of or equal to the current HEAD for the governing paths, and the recomputed content hash equals the recorded one. Any mismatch, an unreadable stamp, or a stamp whose recipe version is unrecognized fails closed to a full validation; a failed probe is never treated as a clean stamp.

The stamp's lifecycle needs settling at pick-up: where it lives (in the governing artifact beside the hardening stamps, or in controller-owned state), whether it is a repository-tracked record or a local one, and what invalidates it besides a byte change (a plugin version bump that changes what validation checks, a rigor tier change that raises what it must cover).

## Relationship to the hardening stamps

Hardening stamps record that a document review loop converged over a fingerprint. A validation stamp records that the pre-work validation gate passed over a fingerprint. They answer different questions and neither substitutes for the other, so the stamp grammar must make the kind explicit rather than letting a reader infer it from placement.

## Verification

Fixtures cover: same-session agreement with unchanged bytes (narrowed path taken and reported as such), same-session agreement with changed bytes (full validation), cross-session agreement with unchanged bytes (full validation unless a valid stamp applies), a matching stamp at a later shift start (reuse), a stamp whose hash no longer matches (full validation), a stamp whose commit is not reachable (full validation), an unreadable or malformed stamp (full validation, reported), and a stamp written by an older recipe version (full validation).

The handover procedure's prose and any pin over its validation step move in the same change set as the behavior.

## Non-goals

- Skipping validation on the strength of conversational recollection rather than a computed byte comparison.
- Reusing a validation stamp as agreement authority; agreement remains a live-session act.
- Extending the stamp to cover review or implementation stages, which the hardening and completion records already own.
