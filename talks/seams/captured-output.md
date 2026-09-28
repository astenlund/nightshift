# Captured runtime output

Real responses from the Nightshift runtime for the refusal slides. Each capture gives the raw response verbatim and a slide version edited for brevity and clarity. The [slide outline](outline.md) cites captures by ID.

## How these were captured

[capture.js](capture.js) drives the runtime (plugin 3.2.15) in scratch projects under the ignored `.tmp/talk-capture`, the same way the repository's runtime tests do. Run it from the repository root with `node talks/seams/capture.js`.

- **Real:** the runtime's state machine, its checks and every error code and message below.
- **Staged:** the scenarios and requests. The script, not a model, issues each request, and the task and finding text were written for the capture. The finding echoes the regression from the running example ([catalog R](catalog.md#r-running-example-one-run-five-seams)), but the fixture does not run that code.
- **Stubbed:** the Windows process observer, so the capture runs on any operating system. Review, skeptic and check results are recorded directly instead of coming from live model dispatch.

If asked on stage: "These are the runtime's real responses, triggered deliberately in a test project."

**Slide format.** Show what was attempted in plain words, then the runtime's answer. Keep the error code exactly as captured; edited messages keep the original meaning.

```text
→ what the lead agent tried
← error-code
  What the runtime said.
```

## S1. Agreement

### C1 Implementation before the spec is independently reviewed

A task governed by a spec, with no independent spec review yet.

Raw:

```json
{"error":"spec-review-required","message":"Substantial implementation requires resolved independent spec assessment"}
```

Slide:

```text
→ start implementing the feature
← spec-review-required
  Substantial work needs a resolved, independent review of its spec first.
```

## S2. Independent review

### C2 Advancing past review with only an advisory review

The only review on record came from a reviewer below the required strength.

Raw:

```json
{"error":"review-required","message":"A complete strong broad assessment and resolved findings are required"}
```

Slide:

```text
→ move on from review
← review-required
  A complete, strong, broad review with every finding resolved is required.
```

### C3 A required reviewer model with a fallback to another model

The request required Fable and also listed another model as a substitute.

Raw:

```json
{"error":"model-requirement","message":"Explicit model requirements prohibit fallback to another model"}
```

Slide:

```text
→ dispatch a review: Fable required, another model as backup
← model-requirement
  A required model cannot fall back to another model.
```

## S3. Staleness

### C4 Advancing after a reviewed file changed

A strong review was recorded, then one line was added to the README it had covered.

Raw:

```json
{"error":"review-required","message":"The latest assessment is stale: reviewed inputs changed after its import. Dispatch a current cumulative assessment that covers the changes"}
```

Slide:

```text
→ move on from review (after a one-line README edit)
← review-required
  The latest review is stale: files it reviewed have changed.
  Run a new review of the whole change.
```

## S4. Skeptic and findings

### C5 Deciding a finding no skeptic has validated

A reviewer's finding, with no skeptic verdict yet, marked "skip".

Raw:

```json
{"error":"unvalidated-finding","message":"Missing evidence is unresolved"}
```

Slide:

```text
→ skip a finding that no skeptic has checked
← unvalidated-finding
  Missing evidence is unresolved.
```

### C6 Skipping a confirmed finding that the agreement requires

The skeptic confirmed the finding; the lead agent classified it as required by the agreed outcome and tried to skip it anyway.

Raw:

```json
{"error":"required-obligation","message":"An agreed required obligation cannot be waived"}
```

Slide:

```text
→ skip a confirmed finding ("edge case, costly to fix")
← required-obligation
  An agreed requirement cannot be waived.
```

## S5. Continuity

### C7 The status brief the lead agent reads after compaction

The same run as C6, after the refused skip. The script trimmed the brief to its `next`, `closing` and `rules` fields.

Raw:

```json
{
  "next": [
    {
      "id": "change",
      "title": "Increment every element",
      "stage": "review",
      "agreement": {
        "source": "User reply: \"yes, go ahead\"",
        "outcome": "Every element, including sparse slots, is handled"
      },
      "unresolvedFindings": [
        {
          "id": "4:sparse",
          "consequence": "forEach skips missing array slots, so [10] becomes [15]",
          "verdict": "confirmed",
          "disposition": null,
          "evidence": "Reproduced with a sparse array"
        }
      ],
      "reviewCurrent": false
    }
  ],
  "closing": {
    "ready": false,
    "stage": "retrospective"
  },
  "rules": "Continue authorized independent work and recovery. Every repair needs cumulative strong broad review. Validate every finding with a fresh skeptic before disposition. Preserve writer ownership. Update documentation, then retrospective, then follow-up triage; a handed-over run records its morning report before triage. Missing or stale evidence is incomplete. Publication requires authority. Reconcile this record with actual files after compaction."
}
```

Slide:

```text
next:     Increment every element (stage: review)
agreed:   Every element, including sparse slots, is handled
open:     forEach skips missing array slots, so [10] becomes [15]
          confirmed by skeptic, no decision yet
review:   not current
rules:    Every repair needs a cumulative strong review.
          Validate every finding with a fresh skeptic.
          Missing or stale evidence is incomplete.
          Reconcile this record with actual files after compaction.
```

### C8 Writing with an out-of-date revision

Raw:

```json
{"error":"stale-owner","message":"Read current state and reconcile the controller identity before changing or dispatching work"}
```

Slide:

```text
→ record a change based on an old view of the run
← stale-owner
  Read the current state before changing anything.
```

### C9 Writing from a different session

Raw (identical code and message to C8):

```json
{"error":"stale-owner","message":"Read current state and reconcile the controller identity before changing or dispatching work"}
```

Slide:

```text
→ another session tries to continue the work
← stale-owner
  Read the current state and reconcile who owns this run first.
```

### C10 Starting a second run over an unfinished one

Raw:

```json
{"error":"overlapping-run","message":"An unfinished run already owns this checkout; reconcile or resume it"}
```

Slide:

```text
→ start a fresh run in the same checkout
← overlapping-run
  An unfinished run already owns this checkout. Reconcile or resume it.
```

## S6. Handover

### C11 Handing over without verified continuation

The user said they were going to bed. The mechanism that keeps the run going was configured but not observed working.

Raw:

```json
{"error":"unverified-continuation","message":"Unattended continuation requires observed host evidence"}
```

Slide:

```text
→ accept "I'm going to bed, take it from here" (hook configured, not verified)
← unverified-continuation
  Unattended work needs observed evidence that it will keep running.
```

## S7. Closing

### C12 Completing before the retrospective

A handed-over run whose only task was finished.

Raw:

```json
{"error":"closing-required","message":"Complete session retrospective and follow-up triage before final acceptance"}
```

Slide:

```text
→ mark the run complete
← closing-required
  Finish the retrospective and follow-up triage first.
```

### C13 Triage before the morning report

The same run after its retrospective.

Raw:

```json
{"error":"report-required","message":"A handed-over run records its morning report before follow-up triage"}
```

Slide:

```text
→ start follow-up triage
← report-required
  A handed-over run writes its morning report first.
```
