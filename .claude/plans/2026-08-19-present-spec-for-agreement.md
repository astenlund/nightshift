# Present Chosen Spec for Agreement Before Work Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to execute this plan one task at a time, with a fresh worker and fresh review for each task.

**Goal:** Require explicit same-session agreement to a decision-complete digest before any spec-governed lifecycle work, while allowing autonomous continuation after compatible governing-text changes.

**Architecture:** Add one framework-free CommonJS agreement controller under `skills/spec-agreement/` and one public skill that owns interaction and rendering. Handover and the three public revise wrappers call that shared gate, while the revise engine checkpoints mutations before more dispatch. Reuse the controller's CommonMark fence scanner in the ready parser so candidate identity and backlog resolution agree on structural Markdown. Keep approval volatile, keep semantic contract-fit judgment in skill prose, and retain deterministic hashing, parsing, state transitions, and verdict validation in JavaScript.

**Tech Stack:** Node.js 22 CommonJS, built-in `node:test`, `assert`, `crypto`, `fs`, and `path`; Markdown skills and repository guidance; JSON fixture data.

**Spec:** [.claude/features/present-spec-for-agreement.md](.claude/features/present-spec-for-agreement.md)

## Governing specs

- Spec JSON: {"kind":"whole-file","path":".claude/features/present-spec-for-agreement.md","selectors":[],"workUnit":null}

## Global Constraints

- Run every command from the repository root in PowerShell 7 (`pwsh -NoProfile`) unless a step explicitly names another shell.
- Follow test-driven development. Add the named failing test first, run its exact command, implement only enough for that task, then rerun the focused and adjacent suites.
- Keep `skills/spec-agreement/spec-agreement.js` deterministic and interaction-free. It may accept only the filesystem, ready-parser, and volatile-store adapters named by the operation signatures below. It may not prompt, dispatch agents, run semantic judgment, or persist approval.
- Keep digest extraction, user-facing rendering, semantic fit judgment, and host interaction in `skills/spec-agreement/SKILL.md`. JavaScript validates the closed semantic verdict, proves complete hunk coverage for `within-contract`, and validates every supplied citation for the other verdicts; it never infers semantic decisiveness or containment from prose.
- Treat the accepted digest as an authorization envelope. A verified `within-contract` change refreshes volatile current state and continues without user interaction. Only `changes-contract`, `uncertain`, missing authority, or structural failure stops or re-presents.
- Do not add automatic legacy-marker replacement, provider APIs, host adapters, durable approval state, aliases for renamed selectors, or other machinery rejected or deferred by the spec.
- Preserve raw bytes. Validate UTF-8 fatally before structural scanning or digest extraction, then decode only after separately recording a leading BOM and line terminators. Map invalid input to `structural-error` with evidence kind `invalid-utf8`. In code and fixtures, express non-ASCII characters with Unicode escapes and verify edited code bytes remain ASCII.
- Use ordinal comparisons for path segments, selector order, artifact order, and fixture order. Never rely on PowerShell or Windows case-folding.
- Every helper that signals failure throws a typed controller error using the closed code categories and evidence kinds below. Callers catch only at adapter boundaries and render the original code plus evidence; no helper calls `process.exit()`.
- Before every commit, run `git diff --check`. Commit only the files named in that task, with the plan file excluded. Use Conventional Commit subjects without plan-task identifiers or commit bodies.
- The implementation changes shipped plugin behavior, so the complete unpushed batch must contain exactly one version increase from `2.5.1` to `2.5.2`. Make that edit only in the release-integration task.
- Preserve all 14 provisional live-claim markers until handover end-to-end probes resolve or knowingly defer them. Static tests do not rewrite those markers.

### Pre-execution plan conformance check

Before execution begins, verify this plan against the governing spec in PowerShell 7:

```powershell
node -e "const fs=require('fs');const p=fs.readFileSync('.claude/plans/2026-08-19-present-spec-for-agreement.md','utf8');if((p.match(/^## Governing specs$/gm)||[]).length!==1)process.exit(1);if((p.match(/^\*\*Spec:\*\*/gm)||[]).length!==1)process.exit(1);"
rg -n "automatic legacy clean[u]p|durable approva[l]|provider AP[I]|host adapte[r]" .claude/plans/2026-08-19-present-spec-for-agreement.md
git diff --check
```

Expected: the Node command and diff check exit 0. The ripgrep output contains only the explicit global prohibition or a deliberate deferral, never an implementation instruction for those out-of-scope mechanisms.

### Final agreement controller contract

The completed `skills/spec-agreement/spec-agreement.js` exports the following surface. Each task adds only the exports it implements, so its prescribed red state remains real and every intermediate module loads successfully. Once an export lands, later tasks retain it.

```js
module.exports = {
  AgreementError,
  AGREEMENT_VERSION,
  canonicalizePath,
  scanMarkdown,
  selectArtifact,
  hashSelection,
  parsePlanContract,
  serializePlanContract,
  resolveGoverningSet,
  buildCandidate,
  candidateToken,
  compareCandidates,
  buildDerivedDiff,
  validateContractFitVerdict,
  createAgreementState,
  refreshCompatibleState,
  replaceAgreementState,
  invalidateAgreementState,
  decideAgreementGate,
  detectLegacyMarkers,
  previewLegacyMarkerDeletion,
  writeProvenanceStamp,
  runCli,
};
```

`AgreementError` has `name`, stable string `code`, human-readable `message`, and JSON-safe `evidence`. Pure and internal helper calls rethrow an existing `AgreementError`. Every filesystem and volatile-store adapter boundary instead normalizes every thrown value, including an `AgreementError`, through its method-specific mapping below.

Use these exact in-process signatures. `options` contains only injected test or platform adapters named here; production calls use the defaults.

```js
canonicalizePath(projectRoot, nominatedPath, fsAdapter) -> { path, realPath }
scanMarkdown(sourceBuffer) -> { sourceBuffer, bomLength, lines, unclosedFence }
selectArtifact({ path, selectorKind, selectors, sourceBuffer }) -> selection
hashSelection(selection) -> hashedSelection
parsePlanContract({ planBuffer, projectRoot }, { fsAdapter }) -> { header, governingScopes }
serializePlanContract({ planBody, governingScopes }) -> Buffer
resolveGoverningSet(request, { fsAdapter, readyParser }) -> resolutionResult
buildCandidate({ resolution, selections }) -> { candidate, currentSources }
candidateToken(candidate) -> "a-<12 lowercase hex>"
compareCandidates({ previousCandidate, currentCandidate }) -> comparisonResult
buildDerivedDiff({ previousCandidate, currentCandidate, previousSources, currentSources }) -> { hunks }
validateContractFitVerdict({ comparison, hunks, semanticInput }) -> fitResult | fitValidationFailure
createAgreementState({ acceptedDigest, presentedCandidate, responseDecision, reconstructedCandidate, reconstructedSources }) -> sessionState
refreshCompatibleState({ agreementRecord, candidate, currentSources, fitEvidence }) -> sessionState
replaceAgreementState({ store, nextState }) -> sessionState | null
invalidateAgreementState({ reason }) -> { nextState: null, reason }
decideAgreementGate(input) -> gateAction
detectLegacyMarkers({ artifacts }) -> { matches }
previewLegacyMarkerDeletion({ sourceBuffer, baselineHash, matches }) -> { replacementBytes, deletions }
writeProvenanceStamp({ projectRoot, path, stamp, baselineHash }, { fsAdapter }) -> { bytes, alreadyApplied }
runCli({ requestText }, { fsAdapter, readyParser }) -> { exitCode, outputText }
```

Use one closed filesystem adapter, not a provider layer:

```js
fsAdapter = {
  readFile(path) -> Buffer,
  readDirectory(path) -> string[],
  realpath(path) -> string,
  replaceFileAtomically(path, nextBytes) -> void,
}
```

Production `readFile`, `readDirectory`, and `realpath` wrap the corresponding Node filesystem operations. `replaceFileAtomically` is a Nightshift adapter contract, not a Node API. Its production default opens one same-directory staging path shaped `<destination>.nightshift-<pid>-<counter>.tmp` with exclusive creation, increments the process-local counter on collision, writes and closes the complete bytes, then renames that staging file over the destination with `node:fs`. On failure after exclusive creation, remove only that call's own staging file before rethrowing; never sweep stale names. Never trust directory enumeration order; sort or resolve explicitly wherever order is contractual.

Use this exact filesystem failure mapping. A thrown `readFile`, `readDirectory`, or `realpath` during nominated-artifact resolution or provenance initial/readback access becomes `structural-error` with `{ kind: "unreadable-artifact", operation: "readFile" | "readDirectory" | "realpath", path, originalMessage }`. Evidence `path` is always the exact public adapter argument that failed. A staging-write, close, cleanup, or rename failure crossing `replaceFileAtomically` becomes `unexpected-adapter-failure` with `{ operation: "replaceFileAtomically", path, originalMessage }`, where `path` is always that method's destination argument rather than its internal staging name. For every adapter and volatile-store boundary, `originalMessage` is `thrown.message` when an `Error` has a string message, otherwise `String(thrown)`, with literal `unprintable thrown value` when coercion itself throws. Focused injected-failure tests assert exact code, kind when present, operation, path, and original message for every method, including intermediate-directory failure, provenance readback, an injected filesystem `AgreementError`, a non-Error store throw, and an internal replacement-stage failure. The documented reread-before-retry behavior still applies after a replacement succeeded but readback failed.

At each ready-parser adapter call, normalize every thrown value, including an `AgreementError`, to `unexpected-adapter-failure` with exact evidence `{ operation, originalMessage }`. The closed operation values are `readyParser.normalizeSliceName`, `readyParser.parseSlices`, and `readyParser.findSlicesByNormalizedName`; use the same thrown-value message rule above. One table-driven injected-failure test distributes an `Error`, an `AgreementError`, and a non-Error value across those three operations and asserts the exact mapped result.

Use these exact shared records. Object keys stay in the displayed order wherever they enter canonical JSON.

```js
line = { rawStart, rawEnd, content, terminator, outsideFence, heading, topLevelBullet }
heading = null | { level, exactLine }
range = { start, end }
scope = { kind, path, selectors, workUnit }
selection = { path, selectorKind, selectors, selectedBytes, sourceSpans, sourceRanges }
hashedSelection = { path, selectorKind, selectors, selectedBytes, sourceSpans, sourceRanges, contentHash, sourceHash }
artifactSnapshot = { path, selectorKind, selectors, sourceBuffer }
request = {
  mode, projectRoot, target, seeds, planBuffer,
  selectedSliceDeclaration, allowSpecLess, allowCompletedNoOp,
}
currentSource = { path, selectorKind, selectors, selectedBytes, sourceSpans, sourceRanges }
comparisonResult = { kind, evidence }
canonicalHunk = { ordinal, path, kind, before, after }
representationHunk = { ordinal, path, kind, beforeSourceHash, afterSourceHash }
fitResult = { verdict, reason, citations }
semanticJson = { kind, text }
semanticFailure = { kind, detail }
validationIssue = { kind, path, hunk, detail }
fitValidationFailure = { verdict, reason, errors }
responseDecision = { kind, digest, evidence }
agreementRecord = { acceptedDigest, acceptedCandidate, currentCandidate, currentSources }
sessionState = { agreementRecord, fitEvidence }
pendingPresentation = { digest, candidate, currentSources }
controllerContext = { sessionState, pendingPresentation, storeQuarantined }
legacyMatch = { path, kind, rawStart, rawEnd, rawLine }
legacyDeletion = { path, kind, rawStart, rawEnd, rawLine, ownedBlankLine }
unfinishedArtifact = { path, signals }
unfinishedEvidence = { artifacts }
completionEvidence = { target, archivePath, matchedDeclaration }
serializedError = { code, message, evidence }
gateInput = {
  phase, request, resolution, sessionState, pendingPresentation,
  candidate, currentSources, acceptedDigest, response, fitResult, legacyDeletions,
}
gateAction = { kind, sessionState, digest, evidence }
callerResult = { agreement, governingScopes }
```

`line.rawStart` is inclusive and `rawEnd` exclusive in the original Buffer. `content` is normalized UTF-8 text without a terminator, `terminator` is the exact raw terminator Buffer, `outsideFence` is the structural-token eligibility flag, and `topLevelBullet` is boolean. `mode` is exactly `handover`, `lifecycle`, `revise-spec`, `revise-plan`, `revise-code`, `planning`, or `final-presentation`. `target` is a canonical scope or null; `seeds` is an ordered scope array; `planBuffer` is a Buffer or null; `selectedSliceDeclaration` is an exact raw declaration string or null; the two allow fields are booleans. Resolved artifacts are ordered `artifactSnapshot` records. `buildCandidate` accepts ordered `hashedSelection` records matching those snapshots one-for-one. `currentSources` is an ordered array of `currentSource`. Reject missing, extra, reordered, or shape-mismatched fields.

`sourceSpans` is an ordered Buffer array, `sourceRanges` is an ordered array of the closed `range` record over canonical selected bytes, and the two arrays must retain the selector's one-to-one span order. `currentSource` has exactly the displayed fields and entries remain in candidate artifact order. `comparisonResult.kind` is `equal`, `structural-change`, or `source-change`; `evidence` is an ordered array of candidate citations and is empty only for equal or source-only comparison. `canonicalHunk.kind` is exactly `canonical`; its `before` and `after` are the canonical UTF-8 strings deleted and inserted by that hunk. `representationHunk.kind` is exactly `representation-only`; its two hash fields are full lowercase source hashes. A derived diff is an ordered array of only those two closed variants. `fitResult` uses the spec's closed verdict and citation shapes. `fitValidationFailure.verdict` is exactly `uncertain`; `reason` is nonblank; `errors` is a nonempty ordered array of `validationIssue`; issue kind is exactly `classifier-failure`, `malformed-json`, `invalid-schema`, `invalid-citation`, or `incomplete-coverage`; `path` and positive one-based `hunk` are nullable; and `detail` is nonblank. `fitEvidence` is null or the complete validated `within-contract` fit result; it is not an agreement authority. `agreementRecord.acceptedDigest` is the exact nonblank rendered digest string, and both candidate fields use the closed candidate shape. `sessionState` is null when no authority exists; otherwise its agreement record is complete and its fit evidence is null only for new or renewed agreement. `storeQuarantined` is a caller-held boolean outside the store. `legacyMatch.kind` and `legacyDeletion.kind` are `status` or `hardening-refresh`; `rawLine` is the exact matched Buffer, and `ownedBlankLine` is a nullable `range`. `unfinishedArtifact.signals` is a nonempty ordered subset of `frontmatter` and `index`. `matchedDeclaration` is the exact archived declaration or null for an unsliced completion. Every `gateInput` field is present and nullable except `phase` and `request`; phase is exactly `lifecycle-entry`, `final-presentation`, `planning-result`, or `post-mutation`. `callerResult.agreement` is either a complete agreement record or the literal `not-applicable`; `governingScopes` is empty only for the latter. Buffers remain Buffers in-process and lowercase hex at the CLI boundary. Only candidate serialization is authorization identity, but every CLI-crossing record still uses the displayed key order and rejects extra keys.

`semanticInput` is null or exactly one closed variant: `semanticJson` has `kind: "json"` and nonblank raw compact JSON `text`; `semanticFailure` has `kind: "classifier-failure"` and nonblank `detail`. Require null for structural and representation-only-only deterministic branches, reject null when canonical hunks need semantic judgment, and reject nonnull input on deterministic branches. The validator parses raw text, requires byte-for-byte equality with compact reserialization before schema validation, and maps malformed input or the failure variant to the matching controller-owned issue. `responseDecision.kind` is exactly `agree`, `changes-requested`, `decline`, or `ambiguous`; `digest` must equal the immediately preceding presented digest; and `evidence` is nonblank volatile current-session response evidence. The interaction skill owns natural-language classification. Only explicit unqualified assent is `agree`; requested edits are `changes-requested`; explicit rejection is `decline`; every other response is `ambiguous`.

`pendingPresentation` is nullable and contains the complete volatile tuple retained immediately before rendering a stable digest. On the response path, `candidate` and `currentSources` are the separately reconstructed current tuple. `legacyDeletions` is null except after complete baseline-bound detection and preview, when it is the nonempty ordered closed deletion array. Create or replace pending presentation before every digest rendering; discard and replace it on drift restart; clear it on successful agreement creation, requested changes, decline, ambiguous stop, invalidation, completion, abandonment, or session end. It never enters durable state.

`baselineHash` is exactly the 64-character lowercase hexadecimal SHA-256 digest of the complete raw source-file Buffer, including a leading BOM, every original line terminator, and the complete Hardening section. Both mutation helpers recompute it over their complete current Buffer before producing or applying a mutation and compare it byte-for-byte with the supplied value.

Use this closed `gateAction` matrix. Every unlisted field is null, and every listed evidence value uses the exact closed record above:

| `kind` | `sessionState` | `digest` | `evidence` |
|---|---|---|---|
| `continue` | complete created, retained, or refreshed state | null | null |
| `not-applicable` | null | null | null |
| `present-digest` | null | nonblank digest | null for fresh presentation or validated `changes-contract` `fitResult` |
| `render-uncertain-then-present` | null | nonblank digest | validated semantic `uncertain` `fitResult` or controller-owned `fitValidationFailure` |
| `return-to-design` | null | null | `changes-requested` `responseDecision` |
| `stop-declined` | null | null | `decline` `responseDecision` |
| `stop-ambiguous` | null | null | `ambiguous` `responseDecision` |
| `reviewed-migration` | null | null | `{ deletions: legacyDeletion[] }` with at least one deletion |
| `brainstorming-required` | null | null | `unfinishedEvidence` |
| `completed-no-op` | null | null | `completionEvidence` |
| `stop-error` | null | null | `serializedError` |

`decideAgreementGate` returns `not-applicable` only for a resolver result of the same kind whose request permits spec-less work. The skill maps it directly to `{ agreement: "not-applicable", governingScopes: [] }`; a caller that requires a spec receives `stop-error`. It returns `reviewed-migration` only when the supplied `legacyDeletions` array is nonempty and every deletion matches the current recorded baseline; missing, empty, or mismatched evidence stops. For a response path, the gate calls `createAgreementState` only after `agree`; `changes-requested` returns to design, while `decline` and `ambiguous` stop the invoking workflow without authority or further dispatch. For `continue`, pass `action.sessionState` unchanged to `replaceAgreementState`, then derive `callerResult.agreement` from its nested agreement record; exact retention may reuse the same state object, while compatible refresh returns the complete replacement with its fit evidence.

The public caller-result projection never replaces or clears `controllerContext`; later verifier context reads `controllerContext.sessionState.fitEvidence`. If that volatile context is unavailable, use the existing fresh-presentation fallback. On `changes-contract`, render the fit evidence and refreshed digest first, then call `invalidateAgreementState({ reason: "changes-contract" })` and atomically replace the volatile store with null before waiting for or accepting a renewed response. Set caller-held session state to null. A clear failure stops and applies the existing same-turn retry and quarantine rule; old authority is never readable while renewed agreement is pending.

Map skill phase to caller mode exhaustively before constructing `request`. `final-presentation` uses `final-presentation`; `planning-result` uses `planning`; `lifecycle-entry` uses `handover` for handover, the exact `revise-spec`, `revise-plan`, or `revise-code` mode for a revise wrapper, `planning` for standalone planning, and `lifecycle` for any other natural-language validation, review, or implementation entry. `post-mutation` reuses the originating caller mode retained in the active volatile flow. On durable revise resume, derive the exact `revise-*` caller mode from the existing artifact type and create no approval state from durable data. Reject every unsupported phase and caller combination before resolution.

Closed result variants are those named in the relevant implementation section. Use this closed error-code set: `structural-error`, `unstable-governing-source`, `ambiguous-slice-selection`, `duplicate-slice-declaration`, `unclosed-fence-prevents-hardening-provenance`, `stale-baseline`, `invalid-fit-verdict`, `state-storage-failed`, `invocation-error`, and `unexpected-adapter-failure`. `structural-error` carries one exact `evidence.kind`: `path-casing`, `root-escape`, `alias-collision`, `unreadable-artifact`, `invalid-utf8`, `selector-shape`, `selector-absence`, `selector-ambiguity`, `hardening-grammar`, or `plan-contract-grammar`; focused tests assert those literal strings. Outside adapter calls, an existing `AgreementError` is rethrown unchanged. At `store.replace`, `replaceAgreementState` maps every thrown value to `state-storage-failed` with exact evidence `{ operation: "replaceAgreementState", originalMessage }`. Filesystem adapter calls use the exact method-specific mapping above. `candidateToken` is diagnostic only. State constructors and invalidation are pure; `replaceAgreementState` alone calls the volatile store. Legacy preview never writes. Provenance performs only its one filesystem adapter's atomic replacement.

The same module supplies the production bridge. When executed as a program, it reads one compact JSON request from standard input with exact keys `{ "operation", "input" }`. `operation` comes from this closed allowlist: `plan-parse`, `plan-serialize`, `resolve`, `candidate`, `compare`, `diff`, `fit`, `state-create`, `state-refresh`, `state-invalidate`, `gate`, `legacy-detect`, `legacy-preview`, or `provenance-write`. It writes one compact JSON envelope to standard output: `{ "ok": true, "value": ... }` and exit 0, or `{ "ok": false, "error": { "code", "message", "evidence" } }`. Codes `invocation-error` and `unexpected-adapter-failure` exit 2 even when represented by `AgreementError`; every other `AgreementError` exits 1.

The dispatcher maps JSON data to the in-process contracts exactly as follows: plan operations use `planBytesHex` or `planBodyBytesHex`; resolve uses the `request` record with `planBytesHex` decoded to `planBuffer`; candidate accepts the resolution result directly, maps each ordered artifact snapshot through `selectArtifact` and `hashSelection`, then calls `buildCandidate`; compare uses two candidates; diff uses two candidates plus source arrays whose Buffer fields are hex; fit uses comparison, hunks, and the closed raw `semanticInput`; state operations are pure record transformations and never receive a store; gate uses its closed data input; legacy operations use artifact or source Buffer hex. Provenance uses `projectRoot`, nominated `path`, `stamp`, and `baselineHash`; `runCli` resolves its injected or production-default `fsAdapter` before dispatch and passes that same adapter to `writeProvenanceStamp`, which revalidates the path through `canonicalizePath` before any read or write. Every returned Buffer is lowercase hex. No adapter function crosses JSON.

Library imports remain one-way: `ready.js` imports `scanMarkdown`, while imported agreement operations require explicit `readyParser` injection. The main-only CLI bootstrap is the narrow exception: assign the complete `module.exports` object first, then under `require.main === module` require `../ready/ready.js`, validate its three required functions, and inject them into `resolve`. When ready imports the scanner during that bootstrap, Node returns the already initialized agreement exports. Requiring agreement as a library never loads ready or starts the CLI.

The skill retains `controllerContext` only in host-provided volatile session state and passes its `sessionState` back as input when needed. After a pure state operation returns a complete next session state or null, the skill atomically replaces that value in the volatile store. No request, result, candidate, digest, source bytes, fit evidence, or agreement record is written to disk. Tests import functions directly and also cover every CLI operation and exit class.

## Commit the accepted governing-design baseline

**Files:**

- Commit without further edit: `.claude/features/present-spec-for-agreement.md`
- Commit without further edit: `.claude/features/durable-scope-anchor.md`
- Commit without further edit: `.claude/FEATURES.md`

The current working-tree changes are the accepted and hardened governing design plus its synchronized dependency edits. Commit them before implementation so later documentation and release-migration commits contain only their own deltas. After review convergence, the controller commits the plan content before appending its hardening stamp. During implementation, keep that uncommitted stamp out of every implementation commit.

Run in PowerShell 7:

```powershell
node skills/ready/ready.js .
git diff --check
git diff -- .claude/features/present-spec-for-agreement.md .claude/features/durable-scope-anchor.md .claude/FEATURES.md
```

Expected: ready JSON has an empty `structuralErrors` array; diff check exits 0; the displayed diff contains only the accepted agreement design and synchronized dependency changes.

Commit in PowerShell 7:

```powershell
git add .claude/features/present-spec-for-agreement.md .claude/features/durable-scope-anchor.md .claude/FEATURES.md
git commit -m "docs(agreement): finalize the approval contract"
```

The next five implementation sections and `Add the public agreement skill and universal entry contract` are one explicit commit coupling. Creating `skills/spec-agreement/` before its `SKILL.md` and public inventory update makes the exact topology suite red, while publishing the skill before its controller is complete exposes a broken entry point. Execute those sections sequentially, keep their focused checkpoints green, and do not commit any of them until the public-skill section stages the complete coupled surface.

## Implement deterministic selection and fingerprinting

**Files:**

- Create: `skills/spec-agreement/spec-agreement.js`
- Create: `skills/spec-agreement/spec-agreement.test.js`
- Create: `skills/spec-agreement/fixtures/fingerprint-v1.json`

### Add the failing scanner and golden-corpus tests

Add tests that require the new module and define a table-driven golden corpus loader. The fixture entries must have exactly these keys in this order:

```json
{"name":"design-lf","sourceBytesHex":"...","selector":{"selectorKind":"design-before-hardening","selectors":[]},"selectedBytesHex":"...","sourceSpansHex":["..."],"contentHash":"...","sourceHash":"..."}
```

Populate cases for LF, CRLF, bare CR, leading BOM, terminal newline present and absent, each selector kind, eligible and ineligible Hardening sections, fenced heading/bullet/Hardening lookalikes, and unclosed backtick and tilde fences. Generate expected hashes once from independently selected literal byte sequences with Node's `createHash`, then freeze them as literal fixture values. Do not calculate expected values by calling production selectors.

Tests must also assert:

- backtick and tilde opener/closer rules, including fence-length and trailing-content behavior;
- outside-fence heading paths and top-level bullets retain exact raw spans;
- a final closed Hardening section accepts each specified stamp and placeholder form and rejects mixed placeholders, malformed stamps, material body text, and nonterminal placement;
- repeated heading paths, arbitrary partial line ranges, invalid selector cardinality, and out-of-order section selectors throw stable structural codes;
- canonical selected bytes normalize BOM, line endings, and terminal newline exactly as the spec defines, while `sourceSpansHex` preserves the selected raw spans;
- `contentHash` hashes canonical selected bytes and `sourceHash` hashes the compact JSON serialization of the ordered lowercase-hex raw-span array, so boundary splits cannot collide.
- distinct invalid UTF-8 byte sequences that ordinary Node decoding would collapse to the same replacement character both fail before scanning, selection, candidate creation, or fit evaluation with `structural-error` and exact evidence kind `invalid-utf8`.

Run in PowerShell 7:

```powershell
node skills/spec-agreement/spec-agreement.test.js
```

Expected before implementation: Node exits nonzero with `MODULE_NOT_FOUND` for `./spec-agreement`.

### Implement byte scanning, canonical paths, selectors, and hashes

Implement `scanMarkdown(sourceBuffer)` as one byte-aware pass that returns line records with raw start/end offsets, content without its line terminator, exact terminator, fence state, outside-fence heading metadata, and outside-fence top-level bullet metadata. Match CommonMark fence rules from the spec. An unclosed fence protects through EOF.

Implement `canonicalizePath(projectRoot, nominatedPath, fsAdapter)` by:

1. rejecting absolute paths and `.` or `..` segments;
2. enumerating each directory and requiring one ordinal-exact segment match;
3. resolving the real root and target and rejecting targets outside the root;
4. returning the project-root-relative `/` path plus real target for later alias-collision detection.

Implement selector validators as closed object-shape checks. `selectArtifact` returns:

```js
{
  path,
  selectorKind,
  selectors,
  selectedBytes: Buffer,
  sourceSpans: [Buffer],
  sourceRanges: [{ start, end }],
}
```

For `design-before-hardening`, select the complete design before an eligible terminal Hardening section. For `index-entry`, include the exact enclosing `##` heading and selected `###` block through the next outside-fence heading at level 1, 2, or 3. For `bullet-entry`, include the exact enclosing `##`, selected top-level bullet, and its immediately following nonblank indented continuation lines, while fences inside the selected entry remain content until closed.

Canonicalize selected bytes exactly once after selection: strip one leading UTF-8 BOM for scanning, normalize CRLF and bare CR to LF, apply the selector, and end the selected bytes with exactly one LF. Preserve exact contributing raw spans separately, including a leading BOM when the first selected span starts at byte zero. Convert each raw span to lowercase hexadecimal, serialize the ordered string array with compact `JSON.stringify`, and hash that serialization's UTF-8 bytes for `sourceHash`. Return full lowercase SHA-256 values.

### Verify the coupled checkpoint

Run in PowerShell 7:

```powershell
node skills/spec-agreement/spec-agreement.test.js
node skills/ready/ready.test.js
git diff --check
git status --short --untracked-files=all
```

Expected: both Node commands exit 0; `git diff --check` exits 0; status lists this task's three new files and the tracked plan's hardening-stamp modification. Do not commit yet; the public topology is intentionally coupled to the completed skill.

## Make ready parsing fence-aware and collision-safe

**Files:**

- Modify: `skills/ready/ready.js`
- Modify: `skills/ready/ready.test.js`
- Modify: `skills/spec-agreement/spec-agreement.js`
- Modify: `skills/spec-agreement/spec-agreement.test.js`

### Add failing ready fixtures

Add fixture cases with fenced fake headings, bullets, `**Requires:**`, `**Slices:**`, slice bullets, and fence-like nonclosers. Add two outside-fence slice declarations whose distinct raw declarations normalize to the same key.

Insert the new test `extractEntries ignores a fenced heading lookalike` before every other new ready test. Its fixture contains outside-fence `## Area`, a fenced `### [Fake](features/fake.md)`, and outside-fence `### [Real](features/real.md)`. Its first assertion is `assert.deepStrictEqual(parsed.entries.map((entry) => entry.title), ['Real'], 'fenced heading must not create an entry')`.

Assert:

- fenced structural lookalikes remain body content and do not create entries, dependencies, or work units;
- unclosed fences protect through EOF;
- `JSON.stringify(analyze(existing unambiguous fixture inputs))` is byte-for-byte unchanged;
- `parseSlices` retains each exact raw outside-fence declaration and returns every colliding declaration;
- a dependency suffix matching a colliding normalized key is a structural ambiguity rather than first-match selection.

Run in PowerShell 7:

```powershell
node skills/ready/ready.test.js
```

Expected before parser edits: existing tests pass, then `extractEntries ignores a fenced heading lookalike` fails first with actual titles `['Fake', 'Real']`, expected `['Real']`, and message `fenced heading must not create an entry`.

### Reuse the common scanner

Import `scanMarkdown` from `../spec-agreement/spec-agreement.js` into `ready.js`. Adapt entry extraction, Requires lookup, and slice parsing to consume scanner line records and ignore structural tokens inside fences. Preserve `analyze()` and CLI output shapes for existing inputs; the exported internal `parseSlices()` result deliberately gains the exact `declaration` field. Export `findSlicesByNormalizedName(slices, requestedName)`, returning every match in document order, and use it in dependency resolution instead of the existing `.find()` path.

Keep `normalizeSliceName` as the single normalization owner. Library imports stay one-way: `ready.js` imports `scanMarkdown`, and imported agreement operations receive one validated `readyParser` dependency object containing `normalizeSliceName`, `parseSlices`, and `findSlicesByNormalizedName`. Tests pass a fake with that contract. Only the fully initialized main-only CLI bootstrap may require ready as specified in the production bridge contract. Do not introduce a second regex, a positional discriminator, a top-level circular import, or a new shared module.

### Verify the coupled checkpoint

Run in PowerShell 7:

```powershell
node skills/ready/ready.test.js
node skills/spec-agreement/spec-agreement.test.js
node skills/ready/ready.js .
git diff --check
```

Expected: both suites exit 0; the live parser emits JSON with an empty `structuralErrors` array; `git diff --check` exits 0. Do not commit yet.

## Resolve governing scopes and serialize plan contracts

**Files:**

- Modify: `skills/spec-agreement/spec-agreement.js`
- Modify: `skills/spec-agreement/spec-agreement.test.js`

### Add failing resolver and plan-contract tests

Add direct tests for:

- whole-file, section, heading-form index, bullet-form quick-win, breakout-plus-companion, pattern, umbrella, and explicit multi-artifact sets;
- canonical single-seed ordering, plural declaration ordering, companion insertion, explicit co-governing tail ordering, exact duplicate collapse, and distinct work-unit preservation;
- exact raw slice declarations, shipped state, colliding normalized keys, exact selection, interactive-choice requirement, and noninteractive ambiguity;
- ordinal path casing, root escape, and real-target alias collision errors;
- Exploring frontmatter or index placement across any governing member returning every unfinished artifact;
- archive-backed index-only completion only for unique exact unsliced title or exact case-sensitive unique slice `displayName`;
- exact `## Governing specs` parsing with `- None.` or canonical `Spec JSON` lines, and rejection of missing, duplicate, mixed, wrapped, malformed, extra-key, unresolved, or fenced lookalike forms;
- exact `**Spec:**` header order and cardinality validation;
- serialization round trips for zero, one, and multiple scopes without interpreting ordinary links or prose.

The first new test should call `parsePlanContract` against a valid one-scope plan and expect the exact canonical scope object. Run in PowerShell 7:

```powershell
node skills/spec-agreement/spec-agreement.test.js
```

Expected before this task's implementation: Node exits nonzero because `parsePlanContract` is not yet a function.

### Implement scope and plan resolution

Implement canonical scope objects with exact key order:

```js
const scope = { kind, path, selectors, workUnit };
```

Require the caller's validated `readyParser` dependency and use its `normalizeSliceName`, `parseSlices`, and `findSlicesByNormalizedName` exports rather than reimplementing slice parsing. When a normalized key has multiple distinct declarations, return `{ kind: 'slice-selection-required', declarations }` with exact raw declarations in document order. An interactive adapter presents those declarations and retries resolution with one exact declaration; a noninteractive adapter converts the same result to `AgreementError` code `ambiguous-slice-selection`. Duplicate complete raw declarations always throw `AgreementError` code `duplicate-slice-declaration` because no response can distinguish them.

Implement `resolveGoverningSet` as a pure orchestration function over injected repository snapshots. It must return either:

```js
{ kind: 'resolved', target, governingScopes, artifacts }
{ kind: 'not-applicable', target: null, governingScopes: [], artifacts: [] }
{ kind: 'completed-no-op', evidence: completionEvidence }
{ kind: 'brainstorming-required', unfinished: unfinishedEvidence }
{ kind: 'slice-selection-required', declarations }
```

or throw `AgreementError`. Only handover callers may request `completed-no-op`. Direct revise calls never take it. Do not infer a direct-call seed by recency.

Implement `parsePlanContract({ planBuffer, projectRoot }, { fsAdapter })` with the common scanner. It accepts exactly one outside-fence declaration section before every other outside-fence `##`, plus exactly one preceding outside-fence human header. Parse compact JSON and compare its reserialization byte-for-byte to enforce key order, compactness, and shape. Validate the visible header against declaration cardinality and the canonical single path.

Implement `serializePlanContract({ planBody, governingScopes })` to create both header and declaration section from the validated ordered scopes. It throws if the supplied body already contains either machine section or human header outside fences, preventing silent repair of contradictory plans.

### Verify the coupled checkpoint

Run in PowerShell 7:

```powershell
node skills/spec-agreement/spec-agreement.test.js
node skills/ready/ready.test.js
git diff --check
```

Expected: all commands exit 0. Do not commit yet.

## Implement candidate state and contract fit

**Files:**

- Modify: `skills/spec-agreement/spec-agreement.js`
- Modify: `skills/spec-agreement/spec-agreement.test.js`

### Add failing state-machine tests

Use an injected volatile store and fake filesystem. Add scenarios for:

- baseline capture and exact recheck before presentation;
- one drift restart followed by success, and repeated drift returning exact code `unstable-governing-source`;
- canonical candidate key order, token calculation, and separate accepted/current authorities;
- final-presentation transfer requiring the complete retained pre-response candidate, digest, and source set;
- direct state creation rejecting missing or malformed response decisions, non-agree decisions, stale digest binding, and response-time candidate drift, while only explicit `agree` over the current digest creates authority;
- pending presentation creation before rendering, replacement on drift restart, and clearing on every success, return-to-design, decline, ambiguous stop, invalidation, completion, abandonment, and session-end path;
- ambiguous response stopping without authority or redisplay, while absent authority, changed contract, and uncertain fit retain their separate presentation paths;
- byte-only, partial, post-edit, abandoned, completed, new-session, and concurrent-session evidence never authorizing work, including failed invalidation quarantining the stale volatile store;
- exact-match reuse, compatible refresh, renewed agreement replacement, successful null invalidation, storage failure, same-turn retry, and stale retry reconstruction;
- fresh agreement and compatible refresh passing the exact returned `sessionState` object unchanged into replacement, with exact retention preserving identity and refresh preserving validated fit evidence inside the replacement;
- every failed store replacement, including a store-thrown `AgreementError`, normalizing to exact `state-storage-failed`, leaving prior checkpoint bytes unchanged, and quarantining the store before any later invocation can read it;
- creation, refresh, retained-state gating, and diff construction rejecting candidate-to-source membership, order, selected-byte hash, or raw-span hash mismatch, with retained mismatch requiring fresh presentation;
- structural candidate changes yielding deterministic `changes-contract` evidence before semantic classification;
- `changes-contract` rendering evidence and refreshed digest, then clearing or quarantining old authority before any renewed response can be accepted;
- canonical and representation-only hunk construction with stable global ordinals, separated canonical edits producing multiple hunks, and no duplicate representation hunks, including a mixed compatible canonical-plus-representation case;
- one compatible canonical hunk mixed with one contract-changing canonical hunk aggregating to `changes-contract` and requiring renewed presentation;
- verdict validation requiring the allowed enum, correct digest-field citations, complete hunk coverage for `within-contract`, and valid ownership for every supplied `changes-contract` or `uncertain` citation;
- valid compact semantic JSON producing the closed fit result; invalid union shapes, noncompact or malformed JSON, classifier failure, invalid schema or citation, or an uncovered hunk on `within-contract` returning the exact controller-owned `fitValidationFailure` with no fabricated semantic citations;
- deterministic structural and representation-only-only branches accepting only null semantic input, canonical semantic branches rejecting null, and classifier failure remaining distinct from intentional absence;
- `uncertain` preserving renderable evidence and digest until the caller renders them, then invalidating authorities;

Run in PowerShell 7:

```powershell
node skills/spec-agreement/spec-agreement.test.js
```

Expected before implementation: Node exits nonzero on the first assertion because `buildCandidate` is not yet a function.

### Implement the closed state machine

Build candidates with exact key order and compact `JSON.stringify` semantics:

```js
const candidate = { version: 1, target, governingScopes, artifacts };
```

Store one immutable `sessionState` only in the caller-provided volatile session store. Its nested agreement record contains exactly the four authorities `acceptedDigest`, `acceptedCandidate`, `currentCandidate`, and `currentSources`; cited fit evidence sits beside that record and is never a fifth authority. The injected store exposes one operation, `replace(nextState)`, which atomically replaces the complete session state or clears it with null and returns that same value, or throws while leaving the previous complete value unchanged. After an `agree` decision, creation and renewed agreement call `createAgreementState`, which requires decision digest equality, exact presented-versus-reconstructed candidate equality, and reconstructed source validation, then returns `{ agreementRecord: { acceptedDigest, acceptedCandidate: presentedCandidate, currentCandidate: reconstructedCandidate, currentSources: reconstructedSources }, fitEvidence: null }`; pass that result unchanged to `replaceAgreementState`. The helper rejects non-agree, stale-digest, or drifted inputs and never classifies natural language. Compatible refresh atomically replaces the record and its validated fit result together. Successful invalidation replaces the stored value with null and returns null. Never read response evidence, authority, or fit evidence from `.tmp/revise-state.md` or any durable file.

Use one internal candidate-to-sources validator before state creation, compatible refresh, retained-state continuation, and derived diff construction for both previous and current pairs. In candidate artifact order it requires exact path, selector kind, selectors, membership, and order; recomputes `contentHash` from `selectedBytes`; recomputes `sourceHash` from compact JSON serialization of ordered lowercase-hex `sourceSpans`; and compares both hashes with the candidate artifact. A mismatch in newly constructed input fails structurally before storage or comparison. A retained mismatch invalidates that authority and requires fresh presentation.

Storage-failure tests require exact `state-storage-failed` evidence `{ operation: "replaceAgreementState", originalMessage }`, including when the store threw an `AgreementError`, assert byte-for-byte equality of the prior stored value, and force lifecycle continuation false. Retry `replace` only in the uninterrupted controller turn while the same candidate, response or fit verdict, and evidence remain unambiguous. If that retry is unavailable or fails, quarantine the store handle immediately in the caller-held `controllerContext`; never read that store again during the session, and create a new volatile store only after a fresh digest and response. Loss of the caller context also loses the volatile authority and therefore takes fresh presentation. Apply this same quarantine rule to creation, refresh, renewed agreement, and invalidation failures. Do not add a durable tombstone or recovery provider.

`compareCandidates` first compares target, governing scopes, and ordered artifact structural projections. For canonical changes, implement one local deterministic line-based Myers shortest-edit script over canonical UTF-8 text, retaining each line terminator. Break equal-path choices by taking deletion before insertion. Coalesce each maximal adjacent run of deletions and insertions into one zero-context canonical hunk; `before` is the deleted line sequence and `after` is the inserted line sequence, either of which may be empty. Disjoint edits separated by an unchanged line remain distinct hunks in diff order. If canonical text is unchanged but raw spans changed, emit exactly one representation-only hunk instead. One selection never emits both forms. Assign global one-based hunk ordinals across every emitted hunk in artifact order, including distinct selections of the same path. Validate source citations against the owning selected source ranges and selected-entry identity. Do not add a diff dependency or configurable diff engine.

`validateContractFitVerdict` accepts null or the closed raw `semanticInput` only after deterministic branches. A representation-only-only diff requires null and returns `within-contract` without semantic dispatch. Structural differences require null and return `changes-contract` without semantic dispatch. Canonical hunks require nonnull semantic input. One proven contract-changing canonical hunk makes the complete verdict `changes-contract` even when other canonical hunks are compatible. For a mixed canonical-plus-representation diff, the controller adds one source citation with empty `digestFields` for every representation-only hunk before validating the semantic layer's canonical-hunk citations. For `semanticJson`, parse the raw text, require exact compact reserialization, require complete exact hunk coverage for `within-contract`, and validate ownership and shape for every supplied citation on the other verdicts. A classifier, parse, schema, citation, or within-contract coverage failure returns the closed controller-owned `fitValidationFailure` with a specific nonempty issue array instead of inventing digest-field citations or passing malformed citations through. The semantic skill must return a valid `uncertain` result whenever evidence is missing or it cannot prove containment; JavaScript does not derive those judgments from the free-text reason. The gate renders valid semantic uncertain evidence or controller validation-failure evidence with the refreshed digest before fresh presentation.

`decideAgreementGate` returns only the explicit actions in the closed matrix: `continue`, `not-applicable`, `present-digest`, `render-uncertain-then-present`, `return-to-design`, `stop-declined`, `stop-ambiguous`, `reviewed-migration`, `brainstorming-required`, `completed-no-op`, or `stop-error`. It must never equate ready selection, nomination, durable markers, or a candidate token with approval.

### Verify the coupled checkpoint

Run in PowerShell 7:

```powershell
node skills/spec-agreement/spec-agreement.test.js
node internal/revise/revise-round.test.js
git diff --check
```

Expected: all commands exit 0. Do not commit yet.

## Add reviewed migration previews and provenance writes

**Files:**

- Modify: `skills/spec-agreement/spec-agreement.js`
- Modify: `skills/spec-agreement/spec-agreement.test.js`

### Add failing raw-byte mutation tests

Add tests for both closed legacy-marker grammars: case-sensitive column-one `Status: signed off` with canonical, empty, and malformed suffixes; and, only inside eligible Hardening, a column-one refreshed provenance line ending `(sign-off marker)`. Cover byte-preserving deletion previews at first, middle, and final lines across LF, CRLF, bare CR, mixed endings, BOM, and terminal-newline variants. Assert that fenced, indented, blockquoted, inline, and wrong-section lookalikes remain untouched; missing, empty, or mismatched gate deletion evidence never produces `reviewed-migration`; and a line-ending-only or Hardening-only full-file hash change returns `stale-baseline` before mutation.

Add provenance tests for first graduation into a missing or eligible empty Hardening section, replacement of each recognized sole placeholder, append-only later graduation, refresh, and completion stamps, and pre-write failure for malformed, mixed, nonterminal, or unclosed-fence sections. Reject absolute paths, dot segments, ordinal-case aliases, root escapes, and symlink escapes at the provenance entry point. Include the crash state where atomic replacement succeeded but readback failed: a retry recognizes the exact intended stamp and returns `alreadyApplied: true` without appending a duplicate.

Run in PowerShell 7:

```powershell
node skills/spec-agreement/spec-agreement.test.js
```

Expected before implementation: Node exits nonzero because `detectLegacyMarkers` is not yet a function.

### Implement narrow raw-byte helpers

`detectLegacyMarkers` scans every selected governing artifact from one recorded baseline and returns ordered closed `legacyMatch` records. `previewLegacyMarkerDeletion` returns complete replacement bytes and ordered closed `legacyDeletion` evidence but never writes. It accepts the baseline hash and rejects a changed current file before returning a replacement.

`writeProvenanceStamp` first canonicalizes `projectRoot` plus `path` with the shared helper and uses the returned real target for every read and replacement. It then rereads current bytes. If the exact intended stamp already occurs once in the eligible Hardening section and every other byte matches the expected post-transition form, return `alreadyApplied: true` without writing. Otherwise reconstruct from current bytes, require the supplied baseline to match, compute complete next bytes, call one injected atomic replacement, reread, and claim success only when bytes match. A readback failure returns the typed error and makes the next invocation take the reread-before-retry branch; an ambiguous or mismatched current form fails closed rather than appending. It uses the closed Hardening grammar and never closes an unclosed fence. Creating a separator after unterminated design content is reported to the caller as representation-only drift so the ordinary compatible-refresh path updates volatile current state.

State the filesystem guarantee accurately in code-facing tests and prose: `baselineHash` rejects stale caller input and atomic replacement prevents torn output, but this slice does not claim to preserve a concurrent writer's edit between the baseline check and replacement. Do not add locking, compare-and-replace, automatic legacy writes, or a provider API; those require separately designed machinery.

### Verify the coupled checkpoint

Run in PowerShell 7:

```powershell
node skills/spec-agreement/spec-agreement.test.js
git diff --check
```

Expected: both commands exit 0. Do not commit yet.

## Add the public agreement skill and universal entry contract

**Files:**

- Create: `skills/spec-agreement/SKILL.md`
- Commit coupled changes from prior sections: `skills/spec-agreement/spec-agreement.js`
- Commit coupled changes from prior sections: `skills/spec-agreement/spec-agreement.test.js`
- Commit coupled changes from prior sections: `skills/spec-agreement/fixtures/fingerprint-v1.json`
- Commit coupled changes from prior sections: `skills/ready/ready.js`
- Commit coupled changes from prior sections: `skills/ready/ready.test.js`
- Modify: `tests/entry-contract.js`
- Modify: `tests/universal-skill-topology.test.js`
- Modify: `tests/host-discovery-smoke.test.js`
- Modify: `skills/spec-agreement/spec-agreement.test.js`

### Add failing public-topology and adapter tests

First add `spec-agreement` to `PUBLIC_SKILLS` in ordinal position and update the topology test name from nine to ten. Add topology assertions that the skill bundles its controller, test, and fingerprint fixture.

Add controller adapter fixtures proving:

- natural-language validation, review, planning, implementation, and final design presentation route through the gate without explicit handover wording;
- `final-presentation` captures the full candidate, digest, and sources before the approval response;
- spec-less plan and code review take `not-applicable`;
- both installed-host evidence validators expect the ten-skill inventory in ordinal order.

In the existing adapter harness, add one all-field sentinel governing set. Assert that the rendered digest places every governing path and direct full-artifact link, requested target, selected work unit, goal, exclusions, non-goals, decisions, dependencies, prerequisites, unresolved questions, and provisional or deferred live claim in its named field; includes every set member; and excludes fenced lookalikes and ordinary related links. Assert that goal and material decisions require nonblank source-backed content. Add two minimal rows that distinguish the exact outputs `none explicitly stated` and `none found after full governing-set review`. Do not add a separate renderer module.

Run in PowerShell 7:

```powershell
node --test tests/universal-skill-topology.test.js
```

Expected before creating the skill: Node exits nonzero in `public topology exposes only the ten public skills` because `skills/spec-agreement/SKILL.md` is absent.

### Implement and verify the production CLI bridge

Before authoring the skill, insert `CLI rejects malformed request envelope` as the first CLI test. It spawns `node skills/spec-agreement/spec-agreement.js`, writes `{}` to standard input, and first asserts exit status 2 with message `malformed CLI request must exit 2`. Before the bridge exists, the current module exits 0, so this exact assertion fails first.

Implement `runCli` as the single dispatcher described by the production bridge contract. The main block reads standard input once, resolves the real ready parser and production filesystem adapter only after complete exports and main-only ready bootstrap exist, passes both to `runCli`, writes exactly one output envelope, and assigns the returned exit code. Direct tests inject the same closed adapter shape into `runCli`. Decode and validate every named hex field before dispatch; encode every returned Buffer after dispatch. No adapter crosses JSON.

Add a table test with one valid request for every allowlisted operation, plus malformed JSON, missing or extra envelope keys, unknown operation, odd-length or non-hex Buffer input, an `AgreementError`, and an injected unexpected adapter failure through direct `runCli` testing. Add a production end-to-end CLI case that feeds the successful `resolve` envelope's value directly to `candidate`, without test-side selection or hashing, and asserts the returned candidate hashes and ordered `currentSources` against the resolved artifacts. Assert exact exit class, one compact JSON output line, closed envelope keys, and no stderr dependency.

Run in PowerShell 7:

```powershell
node skills/spec-agreement/spec-agreement.test.js
```

Expected after bridge implementation: the complete controller suite, including every CLI mapping and exits 0, 1, and 2, passes.

### Author the interaction skill

Give `SKILL.md` broad trigger prose for final design presentation and all spec-governed validation, review, planning, implementation, and handover entry. Require it to read and invoke `spec-agreement.js` before substantive work. Define these modes in prose: `lifecycle-entry`, `final-presentation`, `planning-result`, and `post-mutation`.

The skill must:

- resolve complete governing sets before validation, queue creation, review dispatch, or implementation;
- render all digest fields from one baseline, with direct artifact links and explicit empty-set wording;
- classify the immediate user response into the closed volatile `responseDecision`, bind it to that digest, and let the controller create authority only for explicit unqualified agreement after reconstruction;
- present reviewed legacy deletions and stop without applying them;
- retain approval only in the active session's volatile controller context;
- invoke semantic contract-fit judgment only for canonical hunks, return valid `uncertain` whenever decisive evidence is missing or containment cannot be proved, and pass its structured output through mechanical JavaScript validation;
- continue autonomously for exact matches, representation-only changes, and validated `within-contract` changes;
- render `changes-contract` evidence and refreshed digest, then clear old authority before awaiting renewed agreement;
- render uncertain evidence and refreshed digest before invalidating and re-entering fresh presentation;
- route incomplete or Exploring designs to brainstorming;
- expose planning results containing `agreement` and ordered `governingScopes` so every planner uses the serializer;
- invalidate state on completion, abandonment, rejection, or session end.

Implement the exhaustive phase-to-caller-mode mapping from the shared contract. Add adapter tests for every supported pair, including generic `lifecycle`, and for rejected unsupported pairs. Prove that post-mutation reuses the originating volatile caller mode and that a durable revise resume derives only its artifact-specific `revise-*` mode without recovering approval.

When any agreement-state storage operation fails outside its exact same-turn retry window, follow the controller contract's session-local quarantine rule. Set the caller-held session state to null, never read the quarantined store again in that session, and create a new volatile store only after a fresh digest and response.

Do not duplicate byte parsing, candidate construction, plan parsing, or transition logic in prose. Reference the controller operations by export name.

### Verify and commit

Run in PowerShell 7:

```powershell
node skills/spec-agreement/spec-agreement.test.js
node --test tests/universal-skill-topology.test.js
node tests/host-discovery-smoke.test.js
git diff --check
```

Expected: all commands exit 0 and host evidence expects exactly ten public skills.

Commit in PowerShell 7:

```powershell
git add skills/spec-agreement/SKILL.md skills/spec-agreement/spec-agreement.js skills/spec-agreement/spec-agreement.test.js skills/spec-agreement/fixtures/fingerprint-v1.json skills/ready/ready.js skills/ready/ready.test.js tests/entry-contract.js tests/universal-skill-topology.test.js tests/host-discovery-smoke.test.js
git diff --cached --check
git commit -m "feat(agreement): add the shared spec agreement gate"
```

## Gate handover and direct revise entry points

**Files:**

- Modify: `skills/handover/SKILL.md`
- Modify: `skills/revise-spec/SKILL.md`
- Modify: `skills/revise-plan/SKILL.md`
- Modify: `skills/revise-code/SKILL.md`
- Modify: `tests/entry-contract.js`
- Modify: `tests/universal-skill-topology.test.js`
- Modify: `skills/spec-agreement/spec-agreement.test.js`

### Add failing public-entry contract tests

Extend static and adapter fixtures to require:

- each revise wrapper resolves `../spec-agreement/SKILL.md`, handles its unavailable error, invokes it before `../../internal/revise/SKILL.md`, forwards unchanged host scope, and stops before dispatch when approval is absent;
- handover's stage ladder uses agreement state rather than `Status: signed off`, retains the archive completion no-op before the gate, scans reviewed migration before stage detection, and serializes `## Governing specs` during planning;
- the unattended rule blocks only when a renewed response is required, not for validated within-contract refresh.

The existing whole-body procedure-fidelity fixture predates this intentional handover redesign. Remove `handover` from `SUBSTANTIAL_ENTRIES` and replace its obsolete equality check with targeted assertions for preserved target selection, archive completion, validation, queue, lifecycle tail, and the new agreement ordering. Keep whole-body fidelity for the other substantial entries.

Run in PowerShell 7:

```powershell
node --test tests/universal-skill-topology.test.js
node skills/spec-agreement/spec-agreement.test.js
```

Expected before instruction edits: topology exits nonzero because wrappers lack the agreement precondition, and the agreement suite exits nonzero because applicable direct revise fixtures dispatch without current approval.

### Replace sign-off with the shared gate

In handover, replace signed-off-spec rungs and marker writing with agreement outcomes. Preserve target selection and the unique archive-backed completion no-op. Order the remaining path exactly as the governing spec requires: resolution, complete legacy scan, clean-disk restart, completed active-artifact no-op, Exploring guard, stable baseline, response or retained-state classification, validation, then queue creation. Remove all logic that creates, trusts, refreshes, or fingerprints around `Status:`.

In each revise wrapper, resolve and execute `../spec-agreement/SKILL.md` first with the fixed artifact type and unchanged scope. Continue to the shared revise engine only when the returned `callerResult.agreement` is a complete agreement record or the literal `not-applicable`; stop on every other outcome. Keep the existing unavailable-engine line and add a distinct stable unavailable-agreement line.

### Verify and commit

Run in PowerShell 7:

```powershell
node skills/spec-agreement/spec-agreement.test.js
node --test tests/universal-skill-topology.test.js
git diff --check
```

Expected: all commands exit 0.

Commit in PowerShell 7:

```powershell
git add skills/handover/SKILL.md skills/revise-spec/SKILL.md skills/revise-plan/SKILL.md skills/revise-code/SKILL.md tests/entry-contract.js tests/universal-skill-topology.test.js skills/spec-agreement/spec-agreement.test.js
git commit -m "feat(handover): gate lifecycle entry on spec agreement"
```

## Gate internal revise mutation boundaries

**Files:**

- Modify: `internal/revise/SKILL.md`
- Modify: `internal/revise/spec.md`
- Modify: `internal/revise/plan.md`
- Modify: `internal/revise/code.md`
- Modify: `internal/revise/revise-round.test.js`
- Modify: `skills/spec-agreement/spec-agreement.test.js`

### Add failing boundary and profile tests

Add fixture and static checks that require:

- durable revise state records only that the current boundary requires `fit-check` or `agreement`;
- durable revise state never records candidate or digest bytes, a candidate token, source bytes, response, semantic verdict or evidence, agreement authority, or a satisfied flag;
- a complete post-mutation batch drains controller fixes and newly arrived user requests, reconstructs once, classifies once, and prohibits further reviewer, skeptic, verifier, post-review, or downstream dispatch until resolved;
- plan review regates additions, removals, repoints, reorders, and retargeting, while canonical duplicate collapse avoids false prompts;
- code review regates governing-artifact, active-plan target, or declaration overlap only, never ordinary cumulative-patch movement;
- first graduation replaces a recognized placeholder, later provenance appends, and every profile fingerprints eligible design content without excluding `Status:`.

Insert `agreement boundary blocks dispatch` as the first new revise-round test. Its first assertion reads the current checkpoint template and requires the literal field prefix `Agreement boundary:` with message `revise checkpoint must declare Agreement boundary`. Insert `revise profiles use agreement fingerprint selector` as the first new agreement-suite profile test; its first assertion requires each profile to name `skills/spec-agreement/spec-agreement.js`, with `spec.md` checked first and message `spec profile must use the agreement fingerprint selector`.

Run in PowerShell 7:

```powershell
node internal/revise/revise-round.test.js
node skills/spec-agreement/spec-agreement.test.js
```

Expected before engine edits: revise-round reaches `agreement boundary blocks dispatch` and fails `false !== true` with `revise checkpoint must declare Agreement boundary`. The separately run agreement suite reaches `revise profiles use agreement fingerprint selector` and fails first for `spec.md` with `spec profile must use the agreement fingerprint selector`.

### Add the resumable boundary checkpoint

Extend the checkpoint only with the exact enum `Agreement boundary: none`, `fit-check`, or `agreement`. Persist no agreement target, governing scopes, candidate field, token, digest, sources, response, verdict, evidence, authority, or satisfied flag. Atomically write `fit-check` after the complete mutation batch and before reconstruction or fit evaluation. Retain it on reconstruction, classification, or storage failure. When current authority cannot continue, atomically write `agreement` before rendering the digest or waiting for a response. After an exact match, validated compatible refresh, renewed agreement replacement, or `not-applicable` result succeeds, atomically restore `none` before any dispatch. A failed write leaves the last non-`none` marker authoritative and dispatches nothing.

On resume, always use the existing artifact identity and resolved review scope to reconstruct current bytes and rerun normal target and governing-set resolution. `fit-check` reruns post-mutation classification. `agreement` re-enters the gate and presents again unless separately retained same-session state exactly proves current renewed approval after reconstruction. `none` runs the normal entry gate and never authorizes work by itself. If volatile replacement succeeded but the crash occurred before writing `none`, the safe replay reconstructs and takes exact continuation before clearing the marker. Add interruption tests immediately before and after each of the three atomic rewrites.

After each complete mutation batch, invoke post-mutation mode before any other dispatch or transition. Keep review fixes and pending user requests in one batch; if another request arrives after the drain, leave it pending and block dispatch until it is drained and classified.

Update artifact profiles:

- `spec.md`: use `writeProvenanceStamp` and check contract fit after the complete revise-spec boundary batch;
- `plan.md`: parse exact plural declarations and regate after declaration, target, or Spec Reconciliation mutations;
- `code.md`: bind agreement to active-plan or governing scope and reconstruct only after relevant overlap;
- all profiles: use the controller selector and hash over eligible design content, with no `Status:` exclusion.

### Verify and commit

Run in PowerShell 7:

```powershell
node skills/spec-agreement/spec-agreement.test.js
node internal/revise/revise-round.test.js
node internal/revise/rigor.test.js
node --test tests/universal-skill-topology.test.js
git diff --check
```

Expected: all commands exit 0.

Commit in PowerShell 7:

```powershell
git add internal/revise/SKILL.md internal/revise/spec.md internal/revise/plan.md internal/revise/code.md internal/revise/revise-round.test.js skills/spec-agreement/spec-agreement.test.js
git commit -m "feat(revise): gate governing artifact mutations"
```

## Reinforce templates, guidance, and related feature ordering

**Files:**

- Modify: `skills/init-backlog/SKILL.md`
- Modify: `.claude/QUICK_WINS.md`
- Modify: `.claude/FEATURES.md`
- Modify: `.claude/BUGS.md`
- Modify: `.claude/PATTERNS.md`
- Modify: `AGENTS.md`
- Modify: `README.md`
- Modify: `.claude/features/content-fingerprint-helper.md`
- Modify: `.claude/features/second-opinion-gates.md`
- Modify: `.claude/features/durable-scope-anchor.md`
- Modify: `.claude/features/agent-host-agnostic-nightshift.md`
- Modify: `skills/spec-agreement/spec-agreement.test.js`

### Add failing prose-contract checks

Use these exact literals as the reinforcement contract:

```text
Readiness and graduation are not approval: before spec-governed work, present the current decision-complete digest and obtain explicit agreement in this session.
Compatible governing-text changes that remain within the accepted digest continue autonomously after a cited contract-fit check.
When a final governing design is presented, invoke /nightshift:spec-agreement in final-presentation mode before asking for agreement.
Existing agreement is fresh only when the complete current candidate matches or passes contract-fit evaluation in the same session.
On rerun, add missing agreement guidance with a targeted patch; never rewrite user-controlled sections.
```

Insert `live quick-win guidance requires current-session agreement` as the first new prose test. Extract the template-controlled header of `.claude/QUICK_WINS.md`, before its first work section, and assert the first literal occurs exactly once. Its assertion message is `QUICK_WINS header must contain one current-session agreement rule`; the current count is 0 and expected count is 1.

Then add section-specific assertions that prove:

- the init-backlog concept checklist contains the third, fourth, and fifth literals exactly once each;
- each of the four authoritative index template headers and each of the four live index headers contains the first literal exactly once;
- the generated fresh root guidance and existing-root append template each produce the first and second literals exactly once when their documented template composition is followed;
- README lists ten public skills and describes same-session agreement plus autonomous within-contract continuation;
- AGENTS names the ten-skill surface and contains the first and second literals once each;
- Content fingerprint helper and Second-opinion gates require this feature;
- Durable scope anchor already requires this feature and retains its accepted-digest dependency;
- Agent-host-agnostic Nightshift records the shipped universal-skill MVP before this feature and later slices preserve the gate;
- the companion `.claude/FEATURES.md` excerpts contain the same dependency target and ordering sentence as each changed related design.

Run in PowerShell 7:

```powershell
node skills/spec-agreement/spec-agreement.test.js
```

Expected before prose edits: existing agreement tests pass, then `live quick-win guidance requires current-session agreement` fails first with count 0, expected 1, and message `QUICK_WINS header must contain one current-session agreement rule`.

### Apply only reinforcement and ordering changes

Resolve the canonical init-backlog template owner from the current tree. It is currently inline in `skills/init-backlog/SKILL.md`; edit it there unless an earlier implementation commit moved it. Add targeted concepts without extracting templates or adding host-specific routing.

Update live guidance and README terminology from signed-off specs to current-session agreement. State that compatible governing-text edits continue autonomously after cited fit classification. Synchronize each edited feature breakout and its `.claude/FEATURES.md` excerpt in the same edit. Preserve the durable-scope dependency already applied during spec hardening.

Do not add a host-adapter slice, automatic migration provider, fingerprint helper implementation, second-opinion implementation, or durable anchor implementation.

### Verify and commit

Run in PowerShell 7:

```powershell
node skills/spec-agreement/spec-agreement.test.js
node skills/ready/ready.js .
node --test tests/universal-skill-topology.test.js
git diff --check
```

Expected: tests exit 0; live ready output has no structural errors; exact-count prose assertions pass.

Commit in PowerShell 7:

```powershell
git add skills/init-backlog/SKILL.md .claude/QUICK_WINS.md .claude/FEATURES.md .claude/BUGS.md .claude/PATTERNS.md AGENTS.md README.md .claude/features/content-fingerprint-helper.md .claude/features/second-opinion-gates.md .claude/features/durable-scope-anchor.md .claude/features/agent-host-agnostic-nightshift.md skills/spec-agreement/spec-agreement.test.js
git commit -m "docs(agreement): reinforce the approval boundary"
```

## Remove every legacy sign-off marker

**Files:**

- Modify: `.claude/features/present-spec-for-agreement.md`
- Modify: `.claude/features/dependency-cycle-detection.md`
- Modify: `.claude/features/ready-exploring-visibility.md`
- Modify: `.Codex/specs/2026-08-09-immediate-skeptic-dispatch-design.md`
- Modify: `.Codex/specs/2026-08-09-plugin-version-bump-policy-design.md`
- Modify: `skills/spec-agreement/spec-agreement.test.js`

### Add the failing release-wide migration gate

Add a static test that reuses `detectLegacyMarkers` over active `.claude` and `.Codex` Markdown while excluding `.claude/plans/`, `.Codex/plans/`, all history archives, and the historical rejection prose in this feature. It must detect both supported forms: column-one `Status: signed off...` and a Hardening refresh ending `(sign-off marker)`. Add a separate active-instruction scan for prose that creates, trusts, refreshes, or excludes a durable sign-off marker from fingerprints. Name every discovered file and exact form in the failure. Separately assert that each file in the exact five-file migration manifest has a terminal eligible provenance stamp whose content fingerprint equals the fingerprint recomputed from its current design bytes.

Run in PowerShell 7:

```powershell
node skills/spec-agreement/spec-agreement.test.js
```

Expected before cleanup: existing tests pass, then the release-wide migration test exits nonzero and names the five known marker-bearing artifacts. It reports both the Status and Hardening-refresh forms in `.claude/features/dependency-cycle-detection.md` and at least the Status form in each other file.

### Apply the reviewed migration only

On every run, inspect the exact five-file manifest in displayed order, independent of detector hits. Classify each file from current bytes:

- marker present: apply only the reviewed exact-span deletion and then refresh provenance;
- marker absent with a terminal eligible provenance stamp matching the recomputed current design fingerprint: leave it unchanged;
- marker absent with missing or stale current provenance: refresh provenance only;
- malformed or ambiguous Hardening state: fail closed before further work.

Use `detectLegacyMarkers`, the canonical design fingerprint selector, and `writeProvenanceStamp`; do not add a provider, lock, transaction log, or runtime cleanup protocol. Delete only exact detected marker spans and each migration-owned adjacent blank line, preserving every other byte. Do not add a replacement approval label. Exclude active plan directories from every sweep. Add interruption coverage for a mixed resumed worktree containing one deletion-only stale-provenance file, one already completed file, and untouched remaining files. Before the post-mutation gate, require zero matches for both marker forms and current provenance in all five files.

After all marker deletions and provenance refreshes form one complete mutation batch, reconstruct the complete governing candidate and invoke the shared gate in `post-mutation` phase with the originating `handover` caller mode before validation or commit. Add a fixture that classifies this accepted marker cleanup against the accepted digest as `within-contract`, refreshes the volatile current candidate and sources, and continues autonomously. The existing `changes-contract` and `uncertain` branches still require renewed presentation or fail closed. Do not special-case marker deletion as an approval bypass.

### Verify and commit

Run in PowerShell 7:

```powershell
node skills/spec-agreement/spec-agreement.test.js
node skills/ready/ready.js .
git diff --check
```

Expected: the suite exits 0; live ready JSON has no structural errors; diff check exits 0.

After rerunning every migration invariant, the post-mutation gate, and the verification commands, perform a concise PowerShell 7 recovery precheck over `7aa82fe..HEAD`. Match the subject `chore(agreement): remove legacy sign-off markers` with ordinal comparison and accept a candidate only when `git diff-tree --no-commit-id --name-only -r <hash>`, ordinal-sorted, equals the exact six-file manifest above. Exactly one match means this section is complete and must leave current staged and unstaged changes untouched. Multiple matches fail closed. No match with all six paths clean or with a nonempty strict subset of dirty manifest paths also fails closed. Only no match with all six manifest paths dirty follows the commit path below. Before staging, require the output of the first command, ordinal-sorted, to equal the exact six-file manifest:

```powershell
git diff --name-only HEAD -- .claude/features/present-spec-for-agreement.md .claude/features/dependency-cycle-detection.md .claude/features/ready-exploring-visibility.md .Codex/specs/2026-08-09-immediate-skeptic-dispatch-design.md .Codex/specs/2026-08-09-plugin-version-bump-policy-design.md skills/spec-agreement/spec-agreement.test.js
git add -- .claude/features/present-spec-for-agreement.md .claude/features/dependency-cycle-detection.md .claude/features/ready-exploring-visibility.md .Codex/specs/2026-08-09-immediate-skeptic-dispatch-design.md .Codex/specs/2026-08-09-plugin-version-bump-policy-design.md skills/spec-agreement/spec-agreement.test.js
git diff --cached --check -- .claude/features/present-spec-for-agreement.md .claude/features/dependency-cycle-detection.md .claude/features/ready-exploring-visibility.md .Codex/specs/2026-08-09-immediate-skeptic-dispatch-design.md .Codex/specs/2026-08-09-plugin-version-bump-policy-design.md skills/spec-agreement/spec-agreement.test.js
git commit --only -m 'chore(agreement): remove legacy sign-off markers' -- .claude/features/present-spec-for-agreement.md .claude/features/dependency-cycle-detection.md .claude/features/ready-exploring-visibility.md .Codex/specs/2026-08-09-immediate-skeptic-dispatch-design.md .Codex/specs/2026-08-09-plugin-version-bump-policy-design.md skills/spec-agreement/spec-agreement.test.js
```

Expected: the first command prints exactly the six manifest paths and exits 0; each following command exits 0; first execution creates one migration commit with exactly the six manifest paths while any unrelated staged entry remains staged and unchanged. Resume after that commit, after later uncommitted changes to the shared test file, or after a later release commit finds the single historical match and performs no commit. The mixed-worktree product fixture above remains the durable interruption coverage; do not add product fixtures for this executor-only Git recovery precheck.

## Wire release verification and version metadata

**Files:**

- Modify: `.github/workflows/ci.yml`
- Modify: `.claude-plugin/plugin.json`
- Modify: `AGENTS.md`
- Modify: `README.md`
- Modify: `skills/spec-agreement/spec-agreement.test.js`

### Add the failing release-wiring assertions

Append these assertions only after the marker-migration commit. Insert `CI runs the agreement suite` first; it requires the exact line `- run: node skills/spec-agreement/spec-agreement.test.js` once in `.github/workflows/ci.yml`, with message `CI must run the agreement suite`. Then assert the AGENTS and README command lists each name both `node tests/host-discovery-smoke.test.js` and `node skills/spec-agreement/spec-agreement.test.js` exactly once, AGENTS contains the literal `CI runs all six suites on Node 22.`, and `.claude-plugin/plugin.json` version equals literal `2.5.2`.

Run in PowerShell 7:

```powershell
node skills/spec-agreement/spec-agreement.test.js
```

Expected before release wiring: existing tests pass, then `CI runs the agreement suite` fails first with count 0, expected 1, and message `CI must run the agreement suite`.

### Add release wiring

Add the agreement suite to CI. Synchronize both repository command lists with CI by documenting the already-running host-discovery suite and the new agreement suite, and update the AGENTS numeric statement from four to six. Increase `.claude-plugin/plugin.json` exactly once from `2.5.1` to `2.5.2`. Do not change marketplace description or version metadata elsewhere.

### Run complete static verification

Run in PowerShell 7:

```powershell
node skills/spec-agreement/spec-agreement.test.js
node skills/ready/ready.test.js
node internal/revise/revise-round.test.js
node internal/revise/rigor.test.js
node --test tests/universal-skill-topology.test.js
node tests/host-discovery-smoke.test.js
node skills/ready/ready.js .
git diff --check
git status --short --branch
```

Expected: every suite exits 0; live ready JSON has no structural errors; diff check exits 0; status lists only this task's five files plus the tracked plan's hardening-stamp modification; plugin version is exactly `2.5.2`.

Commit in PowerShell 7:

```powershell
git add .github/workflows/ci.yml .claude-plugin/plugin.json AGENTS.md README.md skills/spec-agreement/spec-agreement.test.js
git commit -m "chore(release): wire agreement verification"
```

The executor then returns control to handover for revise-code, end-to-end host probes, documentation reconciliation, backlog shipping bookkeeping, lore capture, complete test-suite verification, the morning report, completion stamping, and the plan-removal offer. Those lifecycle tail actions are not implementation tasks in this plan.
