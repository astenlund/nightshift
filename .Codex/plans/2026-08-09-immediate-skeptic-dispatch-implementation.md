# Immediate Skeptic Dispatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every revise round submit skeptic verification as soon as its reviewer returns findings, while retaining the whole-round adjudication barrier.

**Architecture:** Replace the Workflow script's serial two-stage `pipeline()` with concurrent per-dimension operations. Each operation awaits one reviewer, immediately fans out that reviewer's skeptic tasks through `parallel()`, and returns one completed cell to the unchanged stable-ID reconciliation. Update the instruction-owned manual fallback to consume individually attributable background completions, persist pending findings before fan-out, and delay all adjudication and artifact mutation until the existing round barrier is complete.

**Tech Stack:** Node.js 22, Nightshift Workflow JavaScript, the fixture-based `node:assert/strict` test runner, Markdown instruction procedures, and JSON plugin metadata.

## Global Constraints

- Submit every active reviewer before observing any reviewer completion.
- When one usable reviewer returns findings, submit all of its fresh skeptics back-to-back without waiting for another reviewer, a sibling skeptic, or adjudication.
- The round remains the unit of adjudication. Do not edit reviewable content, change dimension state, route follow-ups, or apply fixes until every required reviewer and skeptic result is usable.
- Preserve reviewer and skeptic normalization, evidence fields, stable IDs, payload isolation, repair limits, and current result reconciliation.
- Manual mode keeps the existing Agents table, repair counters, and best-effort session recovery. Do not add a cross-host adapter, new identity system, task-retirement protocol, replay or acknowledgement protocol, task deadline, or exactly-once guarantee.
- Keep `skills/revise/revise-round.workflow.js` LF-only.
- Preserve all 43 existing Workflow safety cases and add four concurrency, ordering, and metadata cases, for 47 named cases total.
- Increase `.claude-plugin/plugin.json` exactly once from `2.0.25` to `2.0.26`. Do not update marketplace metadata because its description is unchanged and it carries no matching version field.
- Do not stage or commit the pre-existing modified spec, the untracked `nightshift-proposals.md`, or this plan with implementation commits.
- Run only the targeted revise suite. Do not run the repository's full test suite.

---

## File Structure

- `skills/revise/revise-round.workflow.js`: Owns concurrent reviewer-to-skeptic scheduling and unchanged result normalization.
- `skills/revise/revise-round.test.js`: Owns the deterministic Workflow host double, event trace, structural fan-out assertion, metadata assertion, and all existing safety cases.
- `skills/revise/SKILL.md`: Owns the host-neutral manual Agent procedure, pending-finding checkpoint lifecycle, retry behavior, and round barrier.
- `.claude-plugin/plugin.json`: Owns the single shipped-version increase for this release batch.

### Task 1: Implement and test completion-driven Workflow fan-out

**Files:**

- Modify: `skills/revise/revise-round.workflow.js`
- Modify: `skills/revise/revise-round.test.js`
- Modify: `.claude-plugin/plugin.json`

**Interfaces:**

- Consumes: Workflow globals `args`, `parallel(tasks)`, and `agent(prompt, options)`; the existing `review(dimension)`, `normalizeReviewer(dimension, response)`, and `normalizeVerdict(response)` behavior.
- Produces: `runDimension(dimension) -> Promise<Cell>`, `verifyFinding(dimension, finding) -> Promise<FindingWithVerification>`, and the unchanged final `{ phase, round, fingerprint, dimensions }` result.
- Test harness contract: `runWorkflow(args, options) -> Promise<{ result, agentCalls }>` accepts ordered `reviewerReplies` and `skepticReplies`, optional `onAgentCall(call)` and `onAgentResult(call, response)` observers, the existing `dropFinalCell` outer-fan-out fault injection, and a `dropFinalFinding` nested-fan-out fault injection.

- [ ] **Step 1: Verify every replacement anchor is unique before editing**

Run each command independently:

```bash
rg -F -c "const completed = await pipeline(" skills/revise/revise-round.workflow.js
```

Expected: stdout is exactly `1`.

```bash
rg -F -c "async function runWorkflow(args, options = {}) {" skills/revise/revise-round.test.js
```

Expected: stdout is exactly `1`.

```bash
rg -F -c "description: 'One revise-loop round: 1 fresh reviewer per active dimension, then a skeptic per finding'" skills/revise/revise-round.workflow.js
```

Expected: stdout is exactly `1`.

```bash
rg -F -c '"version": "2.0.25"' .claude-plugin/plugin.json
```

Expected: stdout is exactly `1`.

If any count differs, widen the edit anchor with adjacent unchanged text before applying the edit.

- [ ] **Step 2: Add the concurrent host double and four regression cases**

Prepend these exact case names to `CASES` in this order, before every existing name. Retain all existing names after them so the intentional red-test checkpoint reaches a new case before any legacy case exercises the throwing `pipeline` double:

```javascript
'workflow metadata describes completion-driven concurrency',
'all reviewer submissions start before any reviewer completion is observed',
'one reviewer starts every skeptic while another reviewer remains blocked',
'a missing nested skeptic result is returned as needs-retry',
```

Rename both occurrences of the existing case name `a missing final pipeline cell is returned as needs-reviewer` to `a missing final concurrent cell is returned as needs-reviewer`. This preserves its behavior while removing the retired primitive from the test name.

Add this promise controller beside the existing response factories:

```javascript
function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, resolve, reject }
}
```

Replace the one current `runWorkflow` function with this concurrent host double. `pipeline` deliberately throws so the tests prove the shipped script no longer uses the serial primitive. `parallelCallIndex === 0` identifies the outer dimension fan-out and preserves the existing missing-final-cell fault injection. For the new one-dimension, two-finding regression case, `parallelCallIndex === 1` deterministically identifies its nested skeptic fan-out.

```javascript
async function runWorkflow(args, options = {}) {
  const workflow = await loadWorkflow()
  const agentCalls = []
  const reviewerReplies = [...(options.reviewerReplies || [clean()])]
  const skepticReplies = [...(options.skepticReplies || [verdict()])]
  let parallelCallIndex = 0
  const parallel = async (tasks) => {
    const currentCallIndex = parallelCallIndex
    parallelCallIndex += 1
    const results = await Promise.all(tasks.map(task => task()))

    if (options.dropFinalCell && currentCallIndex === 0) {
      return results.slice(0, -1)
    }
    if (options.dropFinalFinding && currentCallIndex === 1) {
      return results.slice(0, -1)
    }

    return results
  }
  const pipeline = async () => {
    throw new Error('pipeline must not launch')
  }
  const agent = async (prompt, optionsForAgent) => {
    const call = { prompt, options: optionsForAgent }
    agentCalls.push(call)
    options.onAgentCall?.(call)
    const replies = optionsForAgent.phase === 'Review' ? reviewerReplies : skepticReplies
    const next = replies.shift()
    if (next instanceof Error) {
      throw next
    }
    const response = await next
    options.onAgentResult?.(call, response)

    return response
  }

  const result = await workflow(args, pipeline, parallel, agent)

  return { result, agentCalls }
}
```

Add the following tests to `TESTS`. The source assertion deliberately fixes the sibling fan-out body to task construction plus submission through `parallel`, leaving no checkpoint, wait, or unrelated operation between sibling launches.

```javascript
async 'workflow metadata describes completion-driven concurrency'() {
  const source = await readFile(SOURCE_PATH, 'utf8')
  const expectedMetadata = [
    "  description: 'One revise-loop round: concurrent reviewer-to-skeptic pipelines per active dimension',",
    '  phases: [',
    "    { title: 'Review', detail: 'all active-dimension reviewers are submitted concurrently' },",
    "    { title: 'Verify', detail: 'each finding fan-out is submitted when its reviewer returns, overlapping unfinished reviews' },",
    '  ],',
  ].join('\n')
  assert.equal(source.includes(expectedMetadata), true)
},
async 'all reviewer submissions start before any reviewer completion is observed'() {
  const firstReviewer = deferred()
  const secondReviewer = deferred()
  const allReviewersSubmitted = deferred()
  const events = []
  let reviewerSubmissions = 0
  const dimensions = [dimension('correctness'), dimension('safety', 'Safety')]
  const execution = runWorkflow(argsFor(dimensions), {
    reviewerReplies: [firstReviewer.promise, secondReviewer.promise],
    onAgentCall(call) {
      events.push(`submit:${call.options.label}`)
      if (call.options.phase === 'Review') {
        reviewerSubmissions += 1
        if (reviewerSubmissions === 2) {
          allReviewersSubmitted.resolve()
        }
      }
    },
    onAgentResult: call => events.push(`observe:${call.options.label}`),
  })
  const submissionDeadline = setTimeout(
    () => allReviewersSubmitted.reject(new Error('timed out waiting for both reviewer submissions')),
    1000,
  )

  try {
    await allReviewersSubmitted.promise
    firstReviewer.resolve(clean('Correctness checked.'))
    secondReviewer.resolve(clean('Safety checked.'))
  } finally {
    clearTimeout(submissionDeadline)
    firstReviewer.resolve(clean('Correctness checked.'))
    secondReviewer.resolve(clean('Safety checked.'))
  }

  await execution
  const secondSubmission = events.indexOf('submit:review:safety')
  const firstObservation = events.findIndex(event => event.startsWith('observe:review:'))
  assert.notEqual(secondSubmission, -1)
  assert.notEqual(firstObservation, -1)
  assert.ok(secondSubmission < firstObservation)
},
async 'one reviewer starts every skeptic while another reviewer remains blocked'() {
  const firstReviewer = deferred()
  const blockedReviewer = deferred()
  const allReviewersSubmitted = deferred()
  const firstSkeptic = deferred()
  const secondSkeptic = deferred()
  const allSkepticsSubmitted = deferred()
  const events = []
  let reviewerSubmissions = 0
  let skepticSubmissions = 0
  const twoFindings = finding('First issue')
  twoFindings.findings.push({ summary: 'Second issue', location: 'src/parser.js parseValue', evidence: 'Concrete evidence for the second issue.' })
  const dimensions = [dimension('correctness'), dimension('safety', 'Safety')]
  const execution = runWorkflow(argsFor(dimensions), {
    reviewerReplies: [firstReviewer.promise, blockedReviewer.promise],
    skepticReplies: [firstSkeptic.promise, secondSkeptic.promise],
    onAgentCall(call) {
      events.push(`submit:${call.options.label}`)
      if (call.options.phase === 'Review') {
        reviewerSubmissions += 1
        if (reviewerSubmissions === 2) {
          allReviewersSubmitted.resolve()
        }
      }
      if (call.options.phase === 'Verify') {
        skepticSubmissions += 1
        if (skepticSubmissions === 2) {
          allSkepticsSubmitted.resolve()
        }
      }
    },
    onAgentResult: call => events.push(`observe:${call.options.label}`),
  })
  const reviewerSubmissionDeadline = setTimeout(
    () => allReviewersSubmitted.reject(new Error('timed out waiting for both reviewer submissions')),
    1000,
  )
  const skepticSubmissionDeadline = setTimeout(
    () => allSkepticsSubmitted.reject(new Error('timed out waiting for both skeptic submissions')),
    1000,
  )

  try {
    await allReviewersSubmitted.promise
    firstReviewer.resolve(twoFindings)
    await allSkepticsSubmitted.promise
    const blockedSubmission = events.indexOf('submit:review:safety')
    const firstReviewObservation = events.indexOf('observe:review:correctness')
    assert.notEqual(blockedSubmission, -1)
    assert.notEqual(firstReviewObservation, -1)
    assert.ok(blockedSubmission < firstReviewObservation)
    assert.deepEqual(events.filter(event => event.startsWith('submit:verify:')), [
      'submit:verify:correctness/finding-1',
      'submit:verify:correctness/finding-2',
    ])
    assert.equal(events.some(event => event.startsWith('observe:verify:')), false)
    const source = await readFile(SOURCE_PATH, 'utf8')
    const expectedVerifyFindingLaunch = [
      'async function verifyFinding(dimension, finding) {',
      '  try {',
      '    const response = await agent(skepticPrompt(dimension, finding), agentOpts({',
    ].join('\n')
    assert.equal(source.includes(expectedVerifyFindingLaunch), true)
    const expectedFindingsReconciliation = [
      '  const completedFindings = await parallel(cell.findings.map(finding => () => verifyFinding(dimension, finding)))',
      '  const findingById = new Map(completedFindings.map(finding => [finding.id, finding]))',
      '  const findings = cell.findings.map(finding => findingById.get(finding.id) || {',
      '    ...finding,',
      "    verification: retryVerification('skeptic result was missing'),",
      '  })',
    ].join('\n')
    assert.equal(source.includes(expectedFindingsReconciliation), true)
  } finally {
    clearTimeout(reviewerSubmissionDeadline)
    clearTimeout(skepticSubmissionDeadline)
    firstReviewer.resolve(twoFindings)
    firstSkeptic.resolve(verdict())
    secondSkeptic.resolve(verdict())
    blockedReviewer.resolve(clean('Safety stayed blocked through the first skeptic fan-out.'))
  }

  const { result } = await execution
  assert.deepEqual(result.dimensions.map(cell => cell.id), ['correctness', 'safety'])
},
async 'a missing nested skeptic result is returned as needs-retry'() {
  const twoFindings = finding('First issue')
  twoFindings.findings.push({ summary: 'Second issue', location: 'src/parser.js parseValue', evidence: 'Concrete evidence for the second issue.' })
  const { result } = await runWorkflow(argsFor([dimension('correctness')]), {
    reviewerReplies: [twoFindings],
    skepticReplies: [verdict(), verdict()],
    dropFinalFinding: true,
  })
  const cell = result.dimensions[0]
  assert.equal(cell.status, 'needs-verification')
  assert.deepEqual(cell.findings.map(item => item.id), ['correctness/finding-1', 'correctness/finding-2'])
  assert.equal(cell.findings[0].verification.status, 'verified')
  assert.deepEqual(cell.findings[1].verification, { status: 'needs-retry', issue: 'skeptic result was missing' })
},
```

- [ ] **Step 3: Run the new tests against the old Workflow implementation**

Run:

```bash
node skills/revise/revise-round.test.js
```

Expected: exit code `1`; stderr names `workflow metadata describes completion-driven concurrency`. The prepended metadata case runs first and the existing serial `pipeline()` implementation must not pass it.

- [ ] **Step 4: Replace the serial Workflow pipeline with explicit concurrent dimension operations**

Update `meta` to the exact values asserted above.

Extract the existing per-finding `try` and `catch` body from `verify` into this helper without changing normalization or repair text:

```javascript
async function verifyFinding(dimension, finding) {
  try {
    const response = await agent(skepticPrompt(dimension, finding), agentOpts({
      label: `verify:${finding.id}`,
      phase: 'Verify',
      schema: VERDICT_SCHEMA,
      agentType: 'Explore',
    }))
    const verification = normalizeVerdict(response)

    return { ...finding, verification: verification || retryVerification('skeptic output was missing or invalid') }
  } catch {
    return { ...finding, verification: retryVerification('skeptic execution failed') }
  }
}
```

Replace `verify` and the unique `const completed = await pipeline(` block with:

```javascript
async function verify(cell, dimension) {
  if (cell.status !== 'usable' || cell.findings.length === 0) {
    return cell
  }
  const completedFindings = await parallel(cell.findings.map(finding => () => verifyFinding(dimension, finding)))
  const findingById = new Map(completedFindings.map(finding => [finding.id, finding]))
  const findings = cell.findings.map(finding => findingById.get(finding.id) || {
    ...finding,
    verification: retryVerification('skeptic result was missing'),
  })

  return {
    ...cell,
    status: findings.some(finding => finding.verification.status === 'needs-retry') ? 'needs-verification' : 'usable',
    findings,
  }
}

async function runDimension(dimension) {
  const cell = await review(dimension)

  return verify(cell, dimension)
}

const completed = await parallel(dimensions.map(dimension => () => runDimension(dimension)))
```

Keep the existing stable-ID `resultById` reconciliation and result shape unchanged. Do not retain a second `pipeline()` path.

- [ ] **Step 5: Apply the single release version increase**

Change the unique plugin version field:

```json
"version": "2.0.26"
```

Do not change `.claude-plugin/marketplace.json` because the plugin description remains unchanged.

- [ ] **Step 6: Run the Workflow suite and file-integrity checks**

Run each command independently:

```bash
node skills/revise/revise-round.test.js
```

Expected: exit code `0` and stdout exactly `revise-round.test: all 47 named cases passed`.

```bash
node -e "const fs=require('node:fs');const source=fs.readFileSync('skills/revise/revise-round.workflow.js','utf8');if(source.includes(String.fromCharCode(13)))process.exit(1);console.log('revise-round.workflow.js is LF-only')"
```

Expected: exit code `0` and stdout exactly `revise-round.workflow.js is LF-only`.

```bash
node -e "const plugin=require('./.claude-plugin/plugin.json');if(plugin.version!=='2.0.26')process.exit(1);console.log('nightshift version 2.0.26')"
```

Expected: exit code `0` and stdout exactly `nightshift version 2.0.26`.

```bash
git diff --check -- skills/revise/revise-round.workflow.js skills/revise/revise-round.test.js .claude-plugin/plugin.json
```

Expected: exit code `0`; no output.

- [ ] **Step 7: Commit the Workflow implementation atomically**

```bash
git add skills/revise/revise-round.workflow.js skills/revise/revise-round.test.js .claude-plugin/plugin.json
git commit -m "feat(revise): dispatch skeptics as reviewers finish"
```

Expected: one new commit containing only the Workflow script, its tests, and the version field.

### Task 2: Align the manual Agent procedure with immediate fan-out

**Files:**

- Modify: `skills/revise/SKILL.md`

**Interfaces:**

- Consumes: existing `Start round` reviewer rows, Agents table fields, result-first then state checkpoint ordering, stable derived finding IDs, skeptic evidence normalization, repair budgets, and failure retry or abandon behavior.
- Produces: the `awaiting-verification` finding state and a manual completion loop that accepts one current Session ID at a time, starts that reviewer's skeptic fan-out immediately, and exposes a cell as usable only after every required skeptic is verified.
- Failure behavior: unsupported background submission or attributable completion notification persists the existing run as failed with exact Failure JSON and stops dispatch. If a required checkpoint write, validation, or atomic rename fails, stop before any further agent submission or completion observation; the last successfully renamed canonical checkpoints remain authoritative. No exception-returning helper is introduced because this controller is instruction prose. A user-authorized retry restores reviewing and resumes the unchanged round.

- [ ] **Step 1: Verify the manual-path and result-shape anchors before editing**

Run each command independently:

```bash
rg -F -c "### Manual Agent path" skills/revise/SKILL.md
```

Expected: stdout is exactly `1`.

```bash
rg -F -c "After all usable reviewers return, assign each finding" skills/revise/SKILL.md
```

Expected: stdout is exactly `1`.

```bash
rg -F -c "Persist each completed or repairable cell in reviewer order with this shape:" skills/revise/SKILL.md
```

Expected: stdout is exactly `1`.

If any count differs, widen the target with its heading and adjacent unchanged sentence before editing.

- [ ] **Step 2: Add the pending finding checkpoint shape and lifecycle**

Immediately after the existing round-result example and before `A clean cell has`, add this exact contract:

```text
For manual completion-driven fan-out, persist a usable reviewer with findings before skeptic submission as `Status: needs-verification`, `LGTM: no`, its nonblank verified note, and its reviewer Session ID. Each finding keeps its derived ID, summary, location, and evidence and initially has exactly:

Verification status: awaiting-verification
Skeptic session ID: none

`awaiting-verification` is created before skeptic submission, refreshed only by replacing the raw `none` sentinel with the returned skeptic Session ID, replaced by the existing complete verified shape when that skeptic returns valid output, or replaced by the existing `needs-retry` shape when the associated work is missing, rejected, invalid, or unavailable under the existing repair rules. It is scoped to the current phase, round, fingerprint, delivery snapshot, cell, finding, and Session ID. Round abandonment or supersession invalidates it. Resume treats it as pending, never as a verified disposition. When the last required skeptic becomes verified and no finding remains `needs-retry`, the same result replacement sets the cell to `Status: usable`.
```

Keep the existing clean, verified, `needs-reviewer`, and `needs-retry` shapes unchanged.

Do not migrate pre-change checkpoint schemas. On resume, preserve complete canonical results, route incomplete cells or missing work through the existing bounded repair path, and reject checkpoints that fail current checkpoint validation. Do not add checkpoint conversion, deletion, or automatic restart behavior.

- [ ] **Step 3: Replace the reviewer-batch manual fallback with the completion-driven procedure**

Replace the one current paragraph under `### Manual Agent path` with the following procedure. Preserve the existing paragraph about controller-supplied evidence and conflicting verdict framings after this new block.

```text
If Workflow or its script is unavailable, or Workflow fails, use the active Agent tool only when it exposes background submission and individually attributable completion notifications carrying the same canonical Session ID returned by submission. Inspect that exposed interface before the first manual submission in the started round. If either primitive is absent, set `Status: failed`, retain `Round status: in-flight`, phase, round, fingerprint, delivery snapshot, result header, and every pre-created in-flight reviewer Agents row with Session ID `none`, and set `Failure JSON: "manual immediate dispatch is unsupported by the active Agent tool"`. Dispatch nothing. A user-authorized retry clears Failure, restores `Status: reviewing`, repeats the inspection, and resumes the unchanged round. After successful inspection, submit every retained reviewer row whose Session ID is `none` back-to-back through the initial reviewer submission sequence before observing any completion. Never restore the reviewer-batch barrier.

If any required checkpoint write, schema validation, or atomic rename fails during manual dispatch, stop before any further agent submission or completion observation. The last successfully renamed canonical result and state checkpoints remain authoritative. Report the failed checkpoint operation and error. If an atomic state replacement still succeeds without changing canonical result authority, set `Status: failed` with `Failure JSON: "<failed checkpoint operation and error>"`. A user-authorized retry whose canonical phase, round, fingerprint, and delivery snapshot still match clears Failure, restores `Status: reviewing`, reconciles the last successfully renamed result and state under unchanged-fingerprint in-flight resume, and resumes only missing work; an identity mismatch follows drift abandonment.

At initial manual dispatch, submit one fresh background `Explore` reviewer for every active stable cell with the profile model pin. Each reviewer reads only its exact payload and has no prior context. Issue all reviewer submissions back-to-back, persist each returned canonical Session ID in its existing Agents row, then observe the host's normal completion notifications across the full in-flight reviewer set. A rejected or identity-less reviewer submission does not stop the initial loop: attempt every remaining original reviewer submission before checkpointing the rejection, observing completions, or launching any repair. After all original reviewer submissions have been attempted, replace the result first with a complete `needs-reviewer` cell for each rejected submission: retain its identity fields, set `Issue JSON: "reviewer submission failed or returned no canonical Session ID"`, use raw `Reviewer session ID: none`, and omit LGTM, note, and findings. Then replace state to set each matching reviewer Agents row to Status `needs-retry`, Session ID `none`, and its unchanged zero repair count. The existing selector increments that stable counter only immediately before launching the fresh repair. A separate resume handle never replaces the canonical Session ID; session resume remains the existing best-effort optimization.

When one reviewer completion arrives, accept it only when its Session ID matches the current in-flight reviewer row and the phase, round, fingerprint, and delivery snapshot still match. Validate and normalize the complete response before processing another completion. A clean usable reviewer completes its row and launches no skeptic. An incomplete or contradictory response becomes `needs-reviewer` and launches no skeptic until normal bounded repair produces a usable response.

For a usable reviewer with findings, assign `<cell-id>/finding-<one-based-result-index>` and atomically persist the complete reviewer cell with every finding in `awaiting-verification` before launching skeptic work. Then replace state by completing that reviewer row and appending one in-flight skeptic Agents row with Session ID `none` for every derived finding. This result-first then state ordering makes every required verification durable before submission, so interruption recovery can identify and repair only missing skeptic work.

Submit all fresh skeptics for that reviewer back-to-back. The sibling submission loop performs only request construction and submission: collect returned skeptic Session IDs in memory and do not checkpoint, wait, adjudicate, or perform unrelated work between sibling submissions. After every sibling submission call has been initiated, replace the result to persist every returned skeptic Session ID and replace each rejected or identity-less finding with the complete existing `needs-retry` shape, using `Issue JSON: "skeptic submission failed or returned no canonical Session ID"` and raw `Skeptic session ID: none`. Then replace state with returned IDs in successful in-flight skeptic Agents rows and set each rejected row to Status `needs-retry`, Session ID `none`, and its unchanged zero repair count before observing any skeptic completion. The existing selector increments that stable counter only immediately before launching the fresh repair.

Whenever bounded repair selects a reviewer or skeptic row, atomically increment its stable repair counter from `k` to `k+1` before dispatch, as required by the existing repair rules. If a reviewer repair submission returns canonical Session ID `R`, replace the result first so the same complete `needs-reviewer` cell carries Reviewer session ID `R`, then replace state so its reviewer Agents row carries Session ID `R`, Status `in-flight`, and repair count `k+1`. If that submission is rejected or identity-less, replace the result first with the complete `needs-reviewer` cell, `Issue JSON: "reviewer repair submission failed or returned no canonical Session ID"`, and raw `Reviewer session ID: none`, then replace state so the reviewer row has Session ID `none`, Status `needs-retry`, and repair count `k+1`. If a skeptic repair submission returns canonical Session ID `S`, replace the finding's retry shape first with `Verification status: awaiting-verification`, remove `Issue JSON`, persist Skeptic session ID `S`, and keep the enclosing cell `needs-verification`; then replace state so its skeptic Agents row carries Session ID `S`, Status `in-flight`, and repair count `k+1`. If that submission is rejected or identity-less, replace the result first with the complete `needs-retry` finding, `Issue JSON: "skeptic repair submission failed or returned no canonical Session ID"`, and raw `Skeptic session ID: none`, then replace state so the skeptic row has Session ID `none`, Status `needs-retry`, and repair count `k+1`. Observe no repair completion before both replacements finish. Failure of either post-submission checkpoint follows the existing checkpoint-failure rule and unchanged-identity reconciliation before any further completion observation or agent dispatch.

Continue observing unfinished reviewers and skeptics together. Match every completion to the current in-flight Agents row by Session ID. Persist a normalized skeptic verdict through the shared evidence contract, mark that skeptic row completed, and make its cell usable in the same result replacement that records the final required verified skeptic when no finding remains `needs-retry`. Missing, rejected, invalid, or unavailable work follows the existing bounded repair path. A completion from an abandoned or superseded Session ID is stale and changes neither results nor counters.

Controller interruption, drift, and explicit abandon retain the existing best-effort semantics. Resume preserves complete reviewer results, verified skeptic results, and live matching `awaiting-verification` work when the host still exposes the persisted Session ID. On unchanged-identity resume, first inspect durable `needs-verification` cells: when one has valid derived findings but state still has its reviewer row in flight and lacks their skeptic rows, replace the result first to change each missing finding from `awaiting-verification` to `needs-retry` with `Issue JSON: "skeptic submission missing after checkpoint interruption"`, then replace state to mark the reviewer row completed and append one skeptic Agents row per missing finding ID with Status `needs-retry`, Session ID `none`, and zero repairs. The existing selector atomically increments that stable skeptic repair counter before launching its fresh replacement. If an `awaiting-verification` finding and its matching in-flight skeptic Agents row both have Session ID `none`, replace the result to set the finding to `needs-retry` with the same interruption issue, then replace state to set that existing row to Status `needs-retry` while preserving its repair counter. Before result-recovery transitions or repair selection, reconcile each current-identity result-owned pending session against its matching Agents row whether that row is `in-flight` or `needs-retry`: the reviewer form is a `needs-reviewer` cell with a non-`none` Reviewer session ID, and the skeptic form is an `awaiting-verification` finding with a non-`none` Skeptic session ID. When the host still exposes that exact live session, atomically copy the result-owned ID into the row, set the row to Status `in-flight`, preserve its repair counter, and exclude it from repair selection and later result-recovery transitions during this resume. When the session is unavailable, replace the result first: keep the reviewer form `needs-reviewer` but set `Issue JSON: "reviewer session unavailable during checkpoint resume"` and raw `Reviewer session ID: none`, or replace the skeptic form with the complete `needs-retry` shape using `Issue JSON: "skeptic session unavailable during checkpoint resume"` and raw `Skeptic session ID: none` while keeping its cell `needs-verification`. Then replace state to set the matching row to Status `needs-retry`, Session ID `none`, and its preserved repair counter. Only after both unavailable-session replacements succeed may repair selection include that row. Session reconciliation neither resets nor increments the repair counter. After session reconciliation, if a current `needs-reviewer` cell with raw Reviewer session ID `none` matches an in-flight reviewer Agents row with Session ID `none`, rewrite only that row to Status `needs-retry` while preserving its repair counter. If a current `needs-retry` finding with raw Skeptic session ID `none` matches an in-flight skeptic Agents row with Session ID `none`, rewrite only that row to Status `needs-retry` while preserving its repair counter. In both result-recovery transitions the durable result is already authoritative, so do not rewrite it; an atomic state-write failure leaves the same pair for the next resume. Then, before observing completions or selecting repairs, atomically mark any other in-flight reviewer Agents row completed only when its matching stable cell and Session ID have either a clean usable cell or a `needs-verification` cell with a fully normalized usable reviewer response, never `needs-reviewer`; mark an in-flight skeptic Agents row completed when its matching derived finding ID and Session ID have a complete canonical verification. After this reconciliation, only missing reviewer or skeptic work becomes repairable. This procedure adds no stronger task-retirement, replay, acknowledgement, deadline, identity, or exactly-once guarantee.
```

- [ ] **Step 4: Tighten the Workflow-path summary and preserve the round barrier**

In the same existing Workflow summary paragraph, replace the unique phrase:

```text
Require the Task 1 exact input types
```

with:

```text
Require the Workflow invocation contract's exact input types
```

Replace the unique sentence:

```text
The Workflow launches one original reviewer per input cell and one skeptic per finding.
```

with:

```text
The Workflow starts every input cell as a concurrent reviewer-to-skeptic operation: one original reviewer per cell, followed immediately by one fresh skeptic per finding from that reviewer while unrelated reviewers may still be in flight.
```

Keep the existing absolute repair rules and the final `Do not edit reviewable content until every required cell is usable` barrier unchanged. Add one sentence after that barrier:

```text
Immediate dispatch changes scheduling only; controller adjudication, dimension transitions, follow-up routing, and reviewable artifact edits remain behind this whole-round barrier.
```

- [ ] **Step 5: Verify the manual contract is complete and the old barrier is gone**

Run:

```bash
node -e "const fs=require('node:fs');const text=fs.readFileSync('skills/revise/SKILL.md','utf8');const tick=String.fromCharCode(96);const ordered=['Verification status: awaiting-verification','Skeptic session ID: none','created before skeptic submission','Round abandonment or supersession invalidates it','Resume treats it as pending','same result replacement sets the cell','Require the Workflow invocation contract\'s exact input types','manual immediate dispatch is unsupported by the active Agent tool','A user-authorized retry clears Failure','submit every retained reviewer row','If any required checkpoint write, schema validation, or atomic rename fails during manual dispatch','stop before any further agent submission or completion observation','The last successfully renamed canonical result and state checkpoints remain authoritative','A user-authorized retry whose canonical phase, round, fingerprint, and delivery snapshot still match','attempt every remaining original reviewer submission before checkpointing the rejection','reviewer submission failed or returned no canonical Session ID','set each matching reviewer Agents row to Status '+tick+'needs-retry'+tick,'atomically persist the complete reviewer cell','This result-first then state ordering','Submit all fresh skeptics for that reviewer back-to-back','do not checkpoint, wait, adjudicate, or perform unrelated work between sibling submissions','After every sibling submission call has been initiated','skeptic submission failed or returned no canonical Session ID','set each rejected row to Status '+tick+'needs-retry'+tick,'Whenever bounded repair selects a reviewer or skeptic row','reviewer repair submission failed or returned no canonical Session ID','skeptic repair submission failed or returned no canonical Session ID','Observe no repair completion before both replacements finish','Failure of either post-submission checkpoint','Continue observing unfinished reviewers and skeptics together','A completion from an abandoned or superseded Session ID is stale','On unchanged-identity resume','skeptic submission missing after checkpoint interruption','append one skeptic Agents row per missing finding ID with Status','The existing selector atomically increments that stable skeptic repair counter','matching in-flight skeptic Agents row both have Session ID','while preserving its repair counter','reconcile each current-identity result-owned pending session','against its matching Agents row whether that row is','reviewer session unavailable during checkpoint resume','skeptic session unavailable during checkpoint resume','Only after both unavailable-session replacements succeed','Session reconciliation neither resets nor increments','matches an in-flight reviewer Agents row with Session ID','matches an in-flight skeptic Agents row with Session ID','the durable result is already authoritative','before observing completions or selecting repairs','with a fully normalized usable reviewer response','Immediate dispatch changes scheduling only'];let cursor=-1;for(const value of ordered){const next=text.indexOf(value,cursor+1);if(next===-1)throw new Error('missing or out of order: '+value);cursor=next}if(text.includes('After all usable reviewers return, assign each finding'))throw new Error('old reviewer-batch barrier remains');if(text.includes('Require the Task 1 exact input types'))throw new Error('ephemeral Task 1 reference remains');console.log('manual immediate-dispatch contract checks passed')"
```

Expected: exit code `0` and stdout exactly `manual immediate-dispatch contract checks passed`.

```bash
node skills/revise/revise-round.test.js
```

Expected: exit code `0` and stdout exactly `revise-round.test: all 47 named cases passed`.

```bash
git diff --check -- skills/revise/SKILL.md
```

Expected: exit code `0`; no output.

- [ ] **Step 6: Commit the manual procedure separately**

```bash
git add skills/revise/SKILL.md
git commit -m "feat(revise): align manual skeptic dispatch"
```

Expected: one new commit containing only `skills/revise/SKILL.md`. Do not increase the plugin version again.

### Task 3: Run the live scheduling checkpoint and integrated verification

**Files:**

- Temporarily create and remove: `.tmp/revise-live-fast.md`
- Temporarily create and remove: `.tmp/revise-live-slow.md`
- Verify only: `skills/revise/revise-round.workflow.js`
- Verify only: `skills/revise/revise-round.test.js`
- Verify only: `skills/revise/SKILL.md`
- Verify only: `.claude-plugin/plugin.json`

**Interfaces:**

- Consumes: the active host's Workflow invocation mechanism for `skills/revise/revise-round.workflow.js` when available, the small argument object below, and a host lifecycle trace that can be normalized to the exact evidence projection below.
- Produces: live evidence that all reviewer submissions were initiated before reviewer completion observation and that a completed reviewer's entire skeptic fan-out was initiated before sibling skeptic or blocked-reviewer completion observation.
- Failure behavior: if the real Workflow runtime or its event trace is unavailable, do not claim the provisional scheduling marker is validated. Report the blocked probe and retain `(live-claim: provisional)` for handover verification. If the trace observes the slow reviewer before the fast reviewer, report the overlap checkpoint as inconclusive and keep the marker provisional. If an available trace violates an ordering constraint after its required predecessor has been observed, report failure, clean up the probe payloads, and stop before final integrated verification.
- Execution report: the final implementation handoff records exactly one `Live scheduling probe` line with a passed outcome and concrete normalized trace evidence, an inconclusive outcome and the relevant normalized or unrealized-overlap evidence, an unavailable outcome and the blocking reason, or a failed outcome and the violating normalized trace evidence. No repository file is created for this report.

- [ ] **Step 1: Prepare two isolated live-probe payloads**

Before writing either payload, run this symlink-aware collision preflight:

```bash
node -e "const fs=require('node:fs');const paths=['.tmp/revise-live-fast.md','.tmp/revise-live-slow.md'];const collisions=[];for(const path of paths){try{fs.lstatSync(path);collisions.push(path)}catch(error){if(error?.code!=='ENOENT')throw new Error('live-probe preflight failed for '+path+': '+error.message)}}if(collisions.length)throw new Error('live-probe path already exists: '+collisions.join(', '));console.log('live-probe paths are absent')"
```

Expected: exit code `0` and stdout exactly `live-probe paths are absent`. If either path exists or inspection fails, write neither payload, delete neither path, record `Live scheduling probe: unavailable. Reason: <named collision or inspection error>`, retain the provisional marker, skip the remaining probe steps, and continue with Step 4 only.

After this preflight passes, keep a current-attempt exclusively-created path list in memory. For each payload, call Node's `fs.openSync(path, 'wx')`; immediately after the exclusive open succeeds, add that exact path to the current-attempt exclusively-created path list, write the exact UTF-8 content through the same descriptor, and close the descriptor in `finally`. Membership begins when the exclusive open succeeds and remains even if the subsequent content write fails. This prevents a post-preflight creator from being overwritten and makes any handled partial write cleanup-owned before content transfer begins. From the first exclusive open through Workflow completion, every normal or exceptional exit removes only paths in the current-attempt exclusively-created path list after revalidating that they are the two exact paths under `C:/Git/nightshift/.tmp`, then runs the Step 3 owned-path absence check. If exclusive open or either payload write fails, record the probe unavailable with the named error, perform that current-attempt cleanup, skip Workflow invocation, and continue with Step 4. Do not persist this list or treat a path from an earlier interrupted attempt as owned.

Write `.tmp/revise-live-fast.md` with exactly:

```text
# Fast scheduling probe

This is an observation-only scheduling probe, not a real artifact review. Do not edit files, create commits, or dispatch agents.

Read `C:/Git/nightshift/skills/revise/revise-round.workflow.js` once. If your role prompt identifies you as the reviewer, return `lgtm: false`, a nonblank verified note, and exactly two findings. Use summaries `Probe finding one` and `Probe finding two`; use location `skills/revise/revise-round.workflow.js`; use evidence `Synthetic scheduling probe requested this fixed finding.` for both. If your role prompt identifies you as the skeptical verifier, return `CONFIRMED`, reason `Synthetic scheduling probe finding is intentionally fixed.`, `runtimeOwned: false`, `liveProbePerformed: false`, and an empty `liveProbeEvidence` string.
```

Write `.tmp/revise-live-slow.md` with exactly:

```text
# Slow scheduling probe

This is an observation-only scheduling probe, not a real artifact review. Do not edit files, create commits, or dispatch agents.

Read `C:/Git/nightshift/skills/revise/revise-round.workflow.js` and `C:/Git/nightshift/skills/revise/revise-round.test.js` completely. Check that each file exists, that the Workflow source contains `runDimension`, and that the test source contains `all reviewer submissions start before any reviewer completion is observed`. Then return `lgtm: true`, a nonblank verified note naming those three checks, and an empty findings array.
```

- [ ] **Step 2: Invoke the real Workflow runtime when available**

Invoke `skills/revise/revise-round.workflow.js` with this small argument object, never with inline payload content:

```json
{
  "phase": 1,
  "round": 1,
  "fingerprint": "sha256:000000000000",
  "dimensions": [
    {
      "id": "probe-fast",
      "name": "Probe fast",
      "payloadFile": "C:/Git/nightshift/.tmp/revise-live-fast.md"
    },
    {
      "id": "probe-slow",
      "name": "Probe slow",
      "payloadFile": "C:/Git/nightshift/.tmp/revise-live-slow.md"
    }
  ],
  "model": "opus"
}
```

Use the active host's Workflow tool or equivalent local-script Workflow invocation and restrict evidence to this one invocation. Normalize the host lifecycle trace into an ordered list whose records have exactly `sequence`, `event`, `cellId`, and `findingId`. `sequence` is a strictly increasing positive integer assigned in controller-observation order, never reconstructed from timestamps. `event` is exactly one of `reviewer-submission`, `reviewer-completion`, `skeptic-submission`, or `skeptic-completion`. `cellId` is `probe-fast` or `probe-slow`. `findingId` is raw `none` for reviewer events and the exact derived `probe-fast/finding-1` or `probe-fast/finding-2` for skeptic events. Correlate host events through the invocation's exact agent labels, `review:<cell-id>` and `verify:<finding-id>`; submission means the controller initiated that agent call, and completion means the controller first observed that call's returned result. Ignore events from every other invocation. If the host lacks a Workflow invocation mechanism, cannot expose the required lifecycle events, or cannot populate and correlate every field of this normalized projection, classify the probe as unavailable rather than inferring order or adding an adapter.

If the invocation mechanism is available but this Workflow call rejects or throws before returning cells, preserve the invocation error and any normalized trace evidence. If that trace proves either ordering failure defined below, record the corresponding failed outcome, remove every current-attempt owned payload through Step 3, and stop before Step 4. Otherwise record `Live scheduling probe: inconclusive. Evidence: <invocation error and any normalized trace evidence>`, retain the provisional marker, remove every current-attempt owned payload through Step 3, and continue to Step 4 integrated verification.

Pass only when the real runtime returns usable cells with no cell `status` of `needs-reviewer` or `needs-verification` and no finding `verification.status` of `needs-retry`, the trace shows both reviewer submission initiations before the first reviewer completion observation, observes `probe-fast` before `probe-slow`, and then shows both `probe-fast` skeptic submission initiations before any `probe-fast` skeptic completion observation or `probe-slow` reviewer completion observation. A host may complete a task during a later serialized submission call; only controller-observed completion order decides the checkpoint.

Instrumentation is available when the runtime exposes records that populate the normalized reviewer and skeptic submission and completion projection; a particular event need not occur. Otherwise record the probe as unavailable rather than passed. Classify an available normalized projection in this precedence. If either reviewer submission initiation is absent, record `Live scheduling probe: inconclusive. Evidence: <missing reviewer submission and normalized trace evidence>`. If a reviewer completion is observed before both reviewer submissions, record `Live scheduling probe: failed. Evidence: <violating normalized reviewer trace evidence>`. If `probe-fast` does not contain exactly the two prescribed normalized findings, record `Live scheduling probe: inconclusive. Evidence: <unexpected finding count and normalized trace evidence>`. If `probe-fast` was observed before the then-still-pending `probe-slow`, record `Live scheduling probe: failed. Evidence: <violating normalized skeptic trace evidence>` when a `probe-fast` skeptic completion or the `probe-slow` reviewer completion occurs before both skeptic submissions. Otherwise, if either corresponding skeptic submission initiation is absent, record `Live scheduling probe: inconclusive. Evidence: <missing skeptic submission and normalized trace evidence>`. Otherwise, if any cell `status` is `needs-reviewer` or `needs-verification`, or any finding `verification.status` is `needs-retry`, record `Live scheduling probe: inconclusive. Evidence: <repairable statuses and normalized trace evidence>`. Otherwise, if either reviewer completion observation is absent, record `Live scheduling probe: inconclusive. Evidence: <missing reviewer completion and normalized trace evidence>`. Otherwise, if `probe-slow` is observed before `probe-fast`, the intended overlap was not exercised: record `Live scheduling probe: inconclusive. Evidence: <sibling-first normalized trace evidence>`. Otherwise, if either finding lacks a complete verified result, record `Live scheduling probe: inconclusive. Evidence: <incomplete verification and normalized trace evidence>`. The remaining conforming case passes. For either failure, complete the payload cleanup in Step 3 and stop before Step 4 without reporting the implementation complete. For every inconclusive outcome, keep the marker provisional and continue to cleanup and integrated verification. In the final implementation handoff, write exactly one of `Live scheduling probe: passed. Evidence: <concrete normalized trace evidence>`, any inconclusive form above, `Live scheduling probe: unavailable. Reason: <blocking reason>`, or either failed form above. Keep the spec's `(live-claim: provisional)` marker unchanged in every case because marker fold-back belongs to handover, not this implementation plan.

- [ ] **Step 3: Remove only the two live-probe payloads**

Resolve every path in the current-attempt exclusively-created path list under `C:/Git/nightshift/.tmp`, verify it is exactly `.tmp/revise-live-fast.md` or `.tmp/revise-live-slow.md`, and remove only those listed paths. In the normal two-write path this removes both payloads. Do not delete other `.tmp` content or a fixed probe path that was not added to the current-attempt exclusively-created path list.

Run this absence check after removal:

```bash
node -e "const fs=require('node:fs');const allowed=new Set(['.tmp/revise-live-fast.md','.tmp/revise-live-slow.md']);const paths=JSON.parse(process.argv[1]);if(!Array.isArray(paths)||paths.some(path=>!allowed.has(path)))throw new Error('invalid current-attempt probe path list');const remains=path=>{try{fs.lstatSync(path);return true}catch(error){if(error?.code==='ENOENT')return false;throw new Error('live-probe cleanup inspection failed for '+path+': '+error.message)}};const remaining=paths.filter(remains);if(remaining.length)throw new Error('live-probe cleanup failed: '+remaining.join(', '));console.log('current-attempt live-probe paths removed')" '[".tmp/revise-live-fast.md",".tmp/revise-live-slow.md"]'
```

Replace the final JSON argument with the exact serialized snapshot of the current-attempt exclusively-created path list. The shown argument is the normal two-write path; `[]` is valid when this attempt owns neither path. Expected: exit code `0` and stdout exactly `current-attempt live-probe paths removed`. If any owned directory entry remains, the serialized list names any other path, or inspection fails for a reason other than `ENOENT`, stop with the named failure before final verification. A fixed probe path that is not in the current-attempt exclusively-created path list is neither checked nor removed.

- [ ] **Step 4: Run final integrated verification**

Run each command independently:

```bash
node skills/revise/revise-round.test.js
```

Expected: exit code `0` and stdout exactly `revise-round.test: all 47 named cases passed`.

```bash
node -e "const plugin=require('./.claude-plugin/plugin.json');if(plugin.version!=='2.0.26')process.exit(1);console.log('nightshift version 2.0.26')"
```

Expected: exit code `0` and stdout exactly `nightshift version 2.0.26`.

```bash
node -e "const fs=require('node:fs');const source=fs.readFileSync('skills/revise/revise-round.workflow.js','utf8');if(source.includes(String.fromCharCode(13)))process.exit(1);if(source.includes('const completed = await pipeline('))process.exit(1);console.log('workflow concurrency source checks passed')"
```

Expected: exit code `0` and stdout exactly `workflow concurrency source checks passed`.

```bash
git diff --check
```

Expected: exit code `0`; no whitespace errors. A line-ending conversion warning for the already modified spec is informational if the command still exits `0`.

```bash
git diff --quiet -- skills/revise/revise-round.workflow.js skills/revise/revise-round.test.js skills/revise/SKILL.md .claude-plugin/plugin.json
```

Expected: exit code `0`, proving the four implementation files have no unstaged changes after their two commits.

```bash
git diff --cached --quiet -- skills/revise/revise-round.workflow.js skills/revise/revise-round.test.js skills/revise/SKILL.md .claude-plugin/plugin.json
```

Expected: exit code `0`, proving the four implementation files have no staged changes after their two commits.

Do not commit the temporary live-probe files, the spec, `nightshift-proposals.md`, or this plan as part of either implementation commit.

## Spec Coverage Check

- Immediate per-reviewer Workflow skeptic dispatch: Task 1 implementation and ordering cases.
- All reviewers initiated at round start: Task 1 reviewer-order case.
- Multi-finding sibling fan-out without intervening work: Task 1 blocked-reviewer case plus structural source assertion.
- Exact Workflow metadata: Task 1 metadata case.
- Stable result normalization and repair behavior: Task 1 preserves all 43 existing cases.
- Manual background completion loop and canonical Session ID: Task 2 manual procedure.
- Pending finding creation, refresh, invalidation, resume, repair, and final cell usability: Task 2 result shape and lifecycle.
- Unsupported manual host failure and unchanged-round retry fan-out: Task 2 exact failure and retry procedure.
- Whole-round adjudication barrier: Task 2 explicit scheduling-only sentence and unchanged absolute repair barrier.
- Real-runtime provisional checkpoint: Task 3 live probe with fail-closed evidence handling.
- Targeted tests, LF-only Workflow source, and version `2.0.26`: Tasks 1 and 3.
- Explicit anti-goals and unchanged marketplace or handover behavior: Global Constraints and the restricted file list.

## Hardening

- revise-plan graduated 2026-08-10 02:35 at a696d64, scope: whole file, content: 37fb6357
