# Review model handoff evidence

Recorded 2026-11-26 on Windows with Node.js 22.23.2 for the [project review model](../specs/review-model.md). Both hosts installed a local 3.3.43 candidate in an isolated plugin profile. The payload digests identify the two candidate builds. Setup seeding was checked through the installed package's development entry point in a disposable Git project for each host. Both returned `reviewModel.status: created` and seeded the bundled template byte for byte. The common template SHA-256 was `94e95e0a64dc6283142c833607504050054f6f3e8cf4fbe2ae433704ace248aa`.

| Host | Candidate payload SHA-256 | Lead handoff | Skeptic handoff |
| --- | --- | --- | --- |
| Codex 0.172.0 | `da7c17afa88d8d609bb2cdb26a8e4583f4be0d07f08373aefa02c7fce7d391a2` | Verified with `gpt-6.2-sol` | Verified with `gpt-6.2-sol` |
| Claude Code 2.1.332 | `6cca06143eba50d32b9a2b8479a70d38aed1db7768a22c8f39dc1a775e55b136` | Opus request rejected by host | Dispatch halted after lead failure |

## Codex native dispatch

The fixture used the installed runtime's native dispatch helper. It captured a project policy containing the marker `maple register` for a lead reviewing a harmless change to a function that returns 1. The fixture then changed the project's policy marker to `amber register` and supplied the lead's captured model as the original model for a skeptic asked to check the false claim that the function returned 2. Both native receipts were complete and attributed to the requested model. Both summaries used `maple register`. The skeptic refuted the claim. Its receipt recorded the new current policy and an original policy structurally equal to the lead's capture.

| Evidence | Lead | Skeptic |
| --- | --- | --- |
| Request ID | `e64d4a7d-f90f-4f68-a0c8-b51b5c79064c` | `4dc64734-f763-4b13-aaa1-d63d9af50eff` |
| Current scope SHA-256 | `90d43665666456311452dda1010a9cc6d4010e6acba05b8cc430b02cea9291df` | `bff32d1b07d2dd72e1c89f414800090b63e42ebeffca3d58e0103682011b8f95` |
| Receipt SHA-256 | `784fc1c7de17d0e64f0eb70ef0ff346256b6bf4025ab47e3ba25bd712b9f40f0` | `1259085113b84d185287cec5474202dce1155a27c63efb6be0ee66f408ef72af` |
| Native event log SHA-256 | `1c9df042bd851477c506a38b6dc572a661ca7917234ad236055524799e0d0ff7` | `14fdc007720131b6c84e66c6f36050ea3b9228916adcf754f15e569338feac3c` |
| Native tokens | 122,117 | 116,792 |

The total was 238,909 tokens. The fixture supplied the original-model field to the dispatch helper directly. The controller's reconstruction of that field from a recorded finding is covered by deterministic tests.

## Claude Code native dispatch

The Claude Code payload came from commit `5bf579e37582aa28c853eb1c4e31708a00d7b351`. The planned check used the installed runtime's controller dispatch path in a disposable Git project, with simulated controller ownership and real native reviewers. It excluded the project policy from the reviewer's file inventory so the marker could reach the reviewer only through the assignment. The plan was to import a lead finding, change the policy, then check the original and current markers in the skeptic's receipt and answer.

Claude Code rejected the lead request for `claude-opus-5-6` with API status 404. The runtime recorded `unusable-review` and produced no attributable lead receipt. The native result reported zero input, output, cache-read, and cache-creation tokens. The check stopped on that failure, as agreed under the 350,000-token budget. No skeptic or substitute model was dispatched.

| Evidence | Value |
| --- | --- |
| Lead request ID | `2a3195d3-82ae-4ad3-97dd-39a4c675783a` |
| Setup output SHA-256 | `56c1c32bccd80367f5e0810a4f21471b02cf3cc638f3346e1a5282157edaaf82` |
| Native event log SHA-256 | `6cf76ef2f3219f406e879912bf03f2d861a3ec276a7d8ae2ebd386e0a0c16b20` |
| Runtime failure record SHA-256 | `155a2c5ab570a67f81c9470f51e0e15956497b08cd1a6a3e72b5eb004c3c7d36` |

## Evidence limits

Claude Code reviewer and skeptic handoff remains unverified. The checks did not exercise interactive setup, controller readback, or the comparative effectiveness campaign. The raw receipts, host event logs, and setup outputs are retained in local delivery scratch. The request IDs and hashes above identify that evidence.
