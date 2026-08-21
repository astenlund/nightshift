# Nightshift

A workflow plugin for [Claude Code](https://claude.com/claude-code) that carries a feature from idea to shipped, and reviews every durable artifact with agents that have never seen the conversation that produced it.

The name is about attendance, not the clock. You work the day shift: brainstorming, specs, deciding what "done" means. The plugin works the night shift: planning, implementation, review, shipping. It runs whenever you step out of the loop, at any hour.

## The problem it solves

Ask an AI agent to review the code it just wrote and it will mostly tell you the code is fine. It has every reason to think so: the same context that produced the work also produced the conviction that the work is correct. Self-review in a shared context is not review, it is a rubber stamp with extra steps.

Nightshift's answer is structural rather than motivational. Reviewers are separate agents started with no prior conversation, given the artifact and nothing else. They cannot inherit the author's blind spots because they never saw the author's reasoning. Everything else in the plugin exists to make that affordable and repeatable: a backlog that says what is worth building, a gate that pins down what was agreed, and a handover that drives the rest while you are away.

## Install

```
/plugin marketplace add astenlund/nightshift
/plugin install nightshift@astenlund
```

Skills are namespaced: `/nightshift:handover`, `/nightshift:ready`, and so on.

## What it looks like

Ask what to work on, and you get the dependency graph resolved rather than a list to re-read:

```
$ /nightshift:ready

Ready
  Quick Wins
    - Replace handover's TaskCreate queue with a durable scratch file
      (the current instruction references a tool that no longer exists)
  Features
    - Durable scope anchor          unblocks a chain of four
    - Content fingerprint helper    root of the host-adapter tree

Blocked
  On `Durable scope anchor`:      Contract-calibrated revise admission
  On `Content fingerprint helper`: Portable resource and fingerprint contract

Recommended: Durable scope anchor. It is the single unlock for the
longest blocked chain in the backlog.
```

The classification is not the model's opinion. A bundled parser reads each entry's declared `Requires:` line and resolves the graph deterministically, with fixture tests covering the grammar. If the report looks wrong, that is a parser bug with a reproducible test case, not a prompt to reword.

## The workflow

1. **Scaffold** once with `/nightshift:init-backlog`. Creates a four-index backlog under `.claude/` (`QUICK_WINS.md`, `FEATURES.md`, `BUGS.md`, `PATTERNS.md`), history archives, and a `plans/` directory. Asks once whether to track or ignore the backlog in git. Idempotent, so re-run it to add whatever is missing.

2. **Capture** ideas, bugs, refactors, and cross-cutting patterns as they come up. Each feature and bug declares its upstream gates on a `Requires:` line, which is what makes step 3 mechanical.

3. **Pick work** with `/nightshift:ready`. It reports what is unblocked, what is blocked and on what, any structural errors in the backlog, and a few argued candidates. The report nominates work; it does not authorize it, so picking an entry runs `/nightshift:spec-agreement` first. A backlog entry counts as a spec, and readiness is not agreement.

4. **Hand over** with `/nightshift:handover` once a brainstorm has produced a spec you agree with. Handover works out where the feature already stands, says so in one line, and drives the rest: spec review, plan, plan review, implementation via parallel subagents, code review, end-to-end verification, doc updates, backlog bookkeeping, and the full test suite. It asks for confirmation only when its read of the situation is genuinely unclear.

5. **Return in the morning** to a report: what shipped, what was learned, and every decision deferred along the way presented one at a time with a recommended route. Questions that came up overnight waited for you instead of stopping the run.

## Public skills

| Name | What it's for |
|---|---|
| `/nightshift:init-backlog` | Scaffold or update the four-index backlog in a project |
| `/nightshift:ready` | Report the unblocked work set by resolving `Requires:` lines |
| `/nightshift:exploring` | Render the draft pipeline in full |
| `/nightshift:handover` | Take over the remaining lifecycle, through to shipped |
| `/nightshift:revise-code` | Fresh-agent review of a code change before it ships |
| `/nightshift:revise-plan` | Fresh-agent review of an implementation plan before execution |
| `/nightshift:revise-spec` | Fresh-agent review of a design spec before planning |
| `/nightshift:revise-docs` | Update project docs to reflect implemented work |
| `/nightshift:revise-lore` | Persist session learnings into instruction files and the plugin |
| `/nightshift:spec-agreement` | Present the governing digest and obtain same-session agreement |

## How review actually works

The three `revise-*` skills share one private engine that reviews along fixed dimensions: 8 for code, 7 each for plans and specs.

Each round starts one fresh agent per dimension, none of which has seen the conversation. As a reviewer returns, its findings immediately go out to fresh **skeptics** whose job is to refute them, so a confident-sounding but wrong finding dies before it can cause an edit. Findings only influence the artifact once the whole round is in.

A dimension is not finished just because a round produced no findings. It is finished when a reviewer returns a clean verdict with a concrete verification note, which is deliberately harder than silence. A round whose findings were all refuted stays open for another pass.

Because fixing one dimension's finding can break another's conclusion, settled dimensions are automatically re-reviewed whenever the artifact moves past the version they signed off on. Only once every dimension agrees on the current version does a final reviewer look at the whole artifact. The run completes when that holistic pass and the per-dimension agreement refer to the same version of the file.

## Why it is built this way

A few decisions that are load-bearing, and the reasoning behind them:

- **Reviewers get no conversation history.** Fresh context is the entire mechanism. Handing a reviewer the session transcript to "give it more context" would reintroduce exactly the blind spot the review exists to catch.
- **The dependency graph is code, not a prompt.** Work selection is a deterministic parser with fixture tests, because a model asked to eyeball a backlog will produce a plausible answer that is wrong in ways nobody notices.
- **Agreement is explicit and same-session.** Before spec-governed work starts, the current decisions are restated and you agree to them. Readiness, a previous session's approval, and "it was in the backlog" are all explicitly not agreement.
- **Reviewing does not mean asking.** During an unattended run, checkpoints become items in the morning report rather than prompts that stall the run until you wake up. Deferral, not waiver.
- **Ephemeral plans, durable specs.** Plans are scaffolding and get deleted once work lands. Code, tests, commits, and the spec are the record.

## Dependencies

- **Node.js** on PATH. The work-selection parser runs on it.
- **[superpowers](https://github.com/obra/superpowers)** (optional, recommended): handover uses its `brainstorming`, `writing-plans`, and `subagent-driven-development` skills.
- **claude-md-management** (optional): `revise-lore` builds on its `revise-claude-md` skill.

Without the optional plugins the corresponding steps degrade gracefully. Substitute your own brainstorming and planning approach and drive the review loops directly.

## Development

```
git clone https://github.com/astenlund/nightshift
/plugin marketplace add ./nightshift
/plugin install nightshift@astenlund
```

Edits to a locally added marketplace apply on plugin reload, with no reinstall loop.

```
node skills/spec-agreement/spec-agreement.test.js
node skills/ready/ready.test.js
node internal/revise/revise-round.test.js
node internal/revise/rigor.test.js
node internal/revise/orchestration.test.js
node tests/host-discovery-smoke.test.js
node --test tests/universal-skill-topology.test.js
```

The plugin is self-hosting: changes to it are reviewed by its own review loops, and `revise-lore` routes what each session learned back into these files.

## License

MIT
