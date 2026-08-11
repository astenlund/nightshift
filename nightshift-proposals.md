# Nightshift review-system proposals

This document summarizes the proposals discussed for the Nightshift Claude Code and Codex plugin.

The main design goal is **high-confidence unattended operation**. Token efficiency matters only insofar as it does not materially reduce output quality or reliability.

## 1. Replace reviewer pairs with repeated review phases

Use a single repeated construct: a **review phase**.

At the start of every phase:
- Reactivate every applicable review dimension.
- Each active dimension gets **one fresh reviewer at a time**.
- If a reviewer produces an accepted finding that requires an artifact change:
  - apply the fix;
  - mark the phase as changed/dirty;
  - keep that dimension active and review it again with a fresh reviewer.
- Once a dimension receives LGTM, it becomes inactive for the rest of that phase.
- Other dimensions continue independently until they also receive LGTM.

Example:

```text
phase N

Correctness      → finding → fix → finding → fix → LGTM
Maintainability  → LGTM
Tests            → finding → fix → LGTM
Security         → LGTM

phase ends when all dimensions are LGTM
```

This preserves per-dimension convergence: one difficult dimension may require seven reviews while another finishes after one.

## 2. Require at least two review phases

Phase 1 can never complete the review stage.

The review stage completes only when:
1. at least two review phases have run; and
2. the latest review phase completed with **no artifact changes**.

Example:

```text
phase 1
  some findings/fixes
  all dimensions eventually LGTM

phase 2
  all dimensions LGTM
  no fixes

DONE
```

If phase 2 contains a fix:

```text
phase 1
  converges

phase 2
  Maintainability → finding → fix → LGTM
  other dimensions → LGTM

phase 2 changed artifact

phase 3
  all dimensions LGTM
  no fixes

DONE
```

This provides at least two independent clean reviews per dimension over the lifetime of the stage without requiring two consecutive globally clean sweeps during initial convergence.

## 3. A phase is dirty only when the artifact changes

`phase_changed` / `phase_dirty` should mean that the artifact itself was mutated.

It should **not** become dirty merely because:
- a reviewer raised a finding;
- the skeptic rejected a finding;
- the controller rejected a finding;
- an acknowledgement was added;
- review metadata changed.

Only an accepted finding that causes an artifact mutation should dirty the phase.

## 4. Do not rerun already-LGTM dimensions inside the same phase

If one dimension has already reached LGTM and another dimension later makes a fix, do **not** reactivate the already-LGTM dimension inside the same phase.

Example:

```text
phase 2

Correctness      → LGTM
Maintainability  → finding → fix → LGTM
Tests            → finding → fix → finding → fix → LGTM
Security         → LGTM
```

Correctness and Security stay dormant for the rest of phase 2.

Because phase 2 contains artifact changes, it cannot complete the stage anyway. Phase 3 will reactivate every dimension and provide the global re-review barrier.

This avoids repeated cross-dimension invalidation logic while still guaranteeing that the final artifact is reviewed by every dimension.

## 5. Final invariant

The resulting review system should guarantee:

> **The exact artifact being handed off passed a complete review phase in which every applicable dimension received LGTM and no artifact changes occurred.**

This removes the current sticky-graduation problem, where a dimension can graduate and later dimensions can modify the artifact without forcing it to inspect the final result.

## 6. Minimal review-stage state

The orchestration can be reduced to roughly:

```text
phase = 1

loop:
    phase_changed = false
    activate all applicable dimensions

    while any dimension is active:
        for each active dimension independently:
            run one fresh reviewer

            if reviewer reports findings:
                adjudicate findings

                if accepted finding causes artifact mutation:
                    apply fix
                    phase_changed = true
                    keep dimension active
                else:
                    require an actual clean review before LGTM
            else:
                mark dimension LGTM/inactive for this phase

    if phase >= 2 and !phase_changed:
        complete review stage

    phase++
```

Independent dimensions can still run in parallel; these are logical semantics, not a requirement for serial execution.

## 7. One reviewer per dimension per iteration

Drop the current default of two simultaneous discovery reviewers for each dimension.

The older redundancy made sense when:
- models were weaker;
- review dimensions were broader;
- a single reviewer had more territory to inspect.

With stronger models and narrower dimensions, one focused reviewer per dimension is likely enough during convergence.

The second independent look is preserved structurally by later review phases.

This moves redundancy from:

> two agents examining every intermediate artifact

to:

> every dimension independently re-examines the integrated artifact in a later phase

That is a better allocation of review effort for an unattended quality-first workflow.

## 8. Keep fresh reviewers

A dimension should still use a **fresh agent** for each review attempt rather than allowing one reviewer to carry its own assumptions indefinitely.

This helps prevent anchoring to:
- previous findings;
- its own fixes;
- earlier interpretations of intentional behavior.

The acknowledgement mechanism remains useful so fresh reviewers do not repeatedly raise already-adjudicated intentional behavior.

## 9. Keep skeptic/controller adjudication

Retain the separation between:
1. reviewer;
2. skeptic;
3. controller/adjudicator.

The principle remains:

> **Convergence raises verification priority, not truth.**

Agreement does not automatically make a finding correct.

The skeptic/controller layer helps prevent duplicate hallucinations, plausible-but-wrong findings, unnecessary refactors, and reviewers treating intentional behavior as defects.

The proposed redesign changes scheduling, not the core finding-adjudication machinery.

## 10. Require an actual clean review before LGTM

A dimension should not become LGTM merely because its latest reported finding was rejected.

For example:

```text
reviewer → finding
controller → rejected
```

should not automatically equal:

```text
dimension → LGTM
```

A subsequent fresh review should return no accepted findings / explicit LGTM before the dimension becomes inactive for the phase.

Otherwise a reviewer that never actually performed a clean pass could accidentally be treated as having certified the dimension.

# Additional hardening proposals

## 11. Fail closed if reviewer execution is incomplete

The current workflow defensively filters reviewer results, roughly:

```js
const reviewers = (pair || []).filter(Boolean)
```

If orchestration expects a specific number of reviewer results, missing/falsy results should not silently degrade review quality.

For the new single-reviewer model:

> If the expected reviewer invocation does not produce exactly one valid reviewer result, the review attempt fails.

Retry or fail the workflow invocation rather than interpreting incomplete execution as success.

Also reject structurally inconsistent output such as:

```text
lgtm: true
findings: [ ... ]
```

unless the schema explicitly defines that combination.

## 12. Make Workflow mode and Agent fallback semantically equivalent

Workflow mode and Agent fallback should expose equivalent review context.

If Workflow reviewers receive a payload containing all active dimensions while fallback reviewers receive only their assigned dimension, Workflow mode can:
- reduce reviewer focus;
- increase correlation between dimensions;
- make supposedly independent dimensions less independent.

Prefer:

```text
common review context
+
only the assigned dimension's criteria
```

for every reviewer, regardless of execution mode.

Possible implementations:
- one common payload plus per-dimension payloads;
- line-range/offset extraction;
- dynamically generated reviewer prompts.

## 13. Add durable run identity and concurrency protection

*(Moved to the feature file `.claude/features/durable-run-identity-concurrency.md`, its authoritative design record.)*

## 14. Add dependency-cycle detection to `/ready`

*(Moved to the feature file `.claude/features/dependency-cycle-detection.md`, its authoritative design record.)*

## 15. Centralize reviewable-content fingerprints in a bundled helper

Controllers and review agents currently reproduce the content-selection recipe themselves. This creates two recurring failure modes:

- hashing the whole file instead of the reviewable content;
- producing different hashes because the active shell or checkout uses different line endings.

Make one bundled Node helper the sole authority for selecting and hashing reviewable document content. Callers should pass the artifact path and the required digest length or named mode, rather than reimplementing filtering.

Potential issue:

- LF checkout on one system;
- CRLF checkout on another;
- identical semantic content;
- different byte-level hash.

Prefer a small bundled Node helper that:

1. reads the artifact;
2. normalizes line endings;
3. removes excluded sections such as `Status:` / hardening metadata if required;
4. computes SHA-256 over normalized content;
5. emits the existing 12-character transient review fingerprint or 8-character durable provenance fingerprint as requested.

This also avoids shell-specific dependencies such as `awk` and `sha256sum`.

Add fixtures covering LF and CRLF input, a `Status:` header, a `## Hardening` section, and body changes so controllers and reviewers cannot accidentally regress to whole-file hashing.

## 16. Move deterministic `init-backlog` work out of promptspace

`init-backlog` contains a large amount of authoritative template and mechanical scaffolding behavior.

Where there is one objectively correct result, prefer deterministic code/files over asking the model to reproduce it.

Candidates:
- static template bodies;
- directory creation;
- missing-file creation;
- unambiguous structural edits;
- hook merging where it can be done deterministically.

Leave Claude responsible for genuinely semantic decisions such as:
- whether customized existing prose already expresses a required concept;
- resolving ambiguous merges;
- deciding when user input is genuinely required.

General principle:

> **If there is one objectively correct answer, get it out of promptspace.**

## 17. Add tests for review orchestration

The deterministic backlog parser already has strong behavioral test coverage. The review engine is more important to overall quality and deserves equivalent orchestration tests.

Extract enough review-state/orchestration logic to test with mocked reviewer results.

Important cases:

### Phase progression

```text
phase 1 clean
→ phase 2 required
```

```text
phase 1 dirty
→ phase 2
```

```text
phase 2 clean
→ complete
```

```text
phase 2 dirty
→ phase 3 required
```

### Per-dimension convergence

```text
D1 LGTM after 1 review
D2 requires 7 reviews
→ D1 must not rerun inside that phase
```

### Cross-dimension mutation

```text
D1 LGTM
D2 causes fix
→ D1 remains inactive in current phase
→ all dimensions reactivate next phase
```

### Rejected findings

```text
reviewer finding
controller rejects finding
→ dimension does not automatically LGTM
→ require fresh clean review
```

### Execution failure

```text
reviewer missing/malformed
→ fail closed
```

### Completion invariant

```text
stage can never complete in phase 1
```

and:

```text
stage can only complete if final phase made zero artifact mutations
```

These tests promote important workflow rules from prose into executable invariants.

## 18. Consider a durable handover execution ledger

For truly unattended operation, context loss is only one failure mode; process/session death can also interrupt work midway.

Longer term, persist more detailed handover execution state:
- current handover step;
- completed implementation tasks;
- associated commit SHA;
- verification/test status;
- checkpoints;
- outstanding follow-ups.

Then an interrupted implementation can resume from known durable state instead of heuristically inferring which tasks appear to have landed.

This is lower priority than the review redesign and core deterministic hardening.

## 19. Preserve the user's requested outcome as a durable scope anchor

Every design spec should carry a short, durable scope anchor near its goal. The anchor paraphrases what the user actually asked to achieve, including any explicit boundaries that distinguish the requested behavior from adjacent improvements.

The anchor should:

- live in the spec body, not session memory or a raw conversation transcript;
- state the requested outcome and material exclusions without duplicating the detailed design;
- remain stable as implementation mechanics are refined;
- be copied unchanged into every reviewer payload as common context;
- constrain scope expansion without suppressing findings about how the chosen design is wired.

This gives controllers and fresh reviewers a durable reference when completeness or soundness pressure starts pulling the design into neighboring systems. It is a grounding mechanism, not an instruction to ignore real defects inside the chosen scope.

## 20. Condense a required third phase to one holistic final reviewer

*(Subsumed by the second-opinion gates feature (`.claude/features/second-opinion-gates.md`): the hardened-spec second opinion replaces the holistic final reviewer with a different-family read, which is a stronger independence mechanism than a same-family high-tier read. This section remains as the earlier design record of the role.)*

Keep dimension-specific reviewers for phases 1 and 2. If phase 2 changes the artifact and therefore requires phase 3, replace another full dimension batch with one fresh `sol-high` reviewer responsible for the complete final artifact.

The holistic reviewer should receive:

- the complete reviewable artifact;
- the design or requirements anchor;
- all applicable dimension criteria;
- narrow acknowledgements and explicit anti-goals;
- calibration that earlier phases already covered the obvious issues, so the final pass should focus on cross-dimensional gaps and the integrated result.

If that reviewer reports findings, dispatch one fresh skeptic per finding immediately. Apply only confirmed, in-scope corrections, then run another fresh holistic reviewer over the resulting artifact. Completion still requires a holistic LGTM on an artifact that did not change during that review.

This preserves detailed convergence work early while avoiding a full multi-agent batch each time late review uncovers one integrated-state defect.

## 21. Calibrate first-draft rigor to deployment context

The first design-spec draft should state an explicit rigor profile derived from the environment in which the feature will operate. Correctness remains the non-negotiable floor; validation, recovery, compatibility, observability, and proof effort above that floor should scale with the consequences and operating context.

Derive the profile from durable project knowledge before asking the user. Relevant inputs include:

- deployment environment and operational criticality;
- userbase size, trust boundary, and exposure;
- failure consequence and data or security sensitivity;
- concurrency and compatibility risk;
- reversibility and recovery cost;
- expected feature lifetime.

If repository guidance, architecture documents, or established project conventions already answer these questions, use those answers. Ask the user only when the feature differs materially from the documented defaults or unresolved ambiguity would change a design decision. Record any feature-specific deviation in the spec so fresh reviewers apply the intended standard without repeatedly reopening the question.

The aim is proportionate engineering, not permission to relax correctness or omit known requirements.

## 22. Communicate for technically sophisticated, time-constrained users

Nightshift should assume the user is an accomplished engineer who owns the requirements but does not have time to absorb the project's code-level details. Communicate technical decisions at the behavioral, architectural, and risk level with full precision, without requiring source familiarity.

Resolve routine implementation mechanics from the approved spec, project knowledge, and code. Ask the user only when a decision materially affects requirements, scope, observable behavior, risk tolerance, cost, or reversibility. Provide code-level evidence when it is necessary to explain a concern or when the user requests it.

Do not confuse unfamiliarity with the codebase for lack of technical sophistication. Avoid both unexplained implementation detail and condescending simplification. The default communication should let an experienced engineer make the decisions that actually require their judgment without first reconstructing the project's internals.

## 23. Resolve confirmed findings through an adversarial repair dialogue

*(Moved to the feature file `.claude/features/adversarial-repair-dialogue.md`, its authoritative design record.)*

## 24. Add cheap second-opinion gates at lifecycle checkpoints

*(Moved to the feature file `.claude/features/second-opinion-gates.md`, its authoritative design record.)*

# Suggested priority order

1. **Replace parallel reviewer pairs with single-reviewer repeated review phases.**
2. **Require at least two phases and a mutation-free final phase.**
3. **Add orchestration tests for the new phase semantics.**
4. **Resolve confirmed findings through an adversarial skeptic-reviewer repair dialogue** (feature file `.claude/features/adversarial-repair-dialogue.md`).
5. **Fail closed on malformed/missing reviewer execution.**
6. **Ensure reviewers see only their assigned dimension plus common context.**
7. **Add `/ready` dependency-cycle detection** (feature file `.claude/features/dependency-cycle-detection.md`).
8. **Add durable run identity/concurrency protection** (feature file `.claude/features/durable-run-identity-concurrency.md`).
9. **Centralize reviewable-content fingerprinting in Node.**
10. **Preserve the user's requested outcome as a durable scope anchor.**
11. **Add cheap second-opinion gates at lifecycle checkpoints** (feature file `.claude/features/second-opinion-gates.md`; subsumes #20's holistic final reviewer).
12. **Calibrate first-draft rigor to deployment context.**
13. **Communicate for technically sophisticated, time-constrained users.**
14. **Move deterministic `init-backlog` mechanics out of prompts.**
15. **Add a durable handover execution ledger if interrupted unattended runs remain a practical problem.**

# Core design in one sentence

> **Run one fresh reviewer per active dimension until every dimension reaches LGTM; repeat this as review phases, reactivating all dimensions at each phase boundary, and complete only when phase 2 or later finishes with every dimension LGTM and no artifact changes.**
