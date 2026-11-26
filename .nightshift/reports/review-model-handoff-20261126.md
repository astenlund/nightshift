# Review model handoff evidence

Recorded 2026-11-26 on Windows with Node.js 22.23.2 for the [project review model](../specs/review-model.md). Both hosts installed a local 3.3.43 candidate in an isolated plugin profile. The payload digests identify the two candidate builds. Setup seeding was checked through the installed package's development entry point in a disposable Git project for each host. Both returned `reviewModel.status: created` and seeded the bundled template byte for byte. The common template SHA-256 was `94e95e0a64dc6283142c833607504050054f6f3e8cf4fbe2ae433704ace248aa`.

| Host | Candidate payload SHA-256 | Lead handoff | Skeptic handoff |
| --- | --- | --- | --- |
| Codex 0.172.0 | `da7c17afa88d8d609bb2cdb26a8e4583f4be0d07f08373aefa02c7fce7d391a2` | Verified with `gpt-6.2-sol` | Verified with `gpt-6.2-sol` |
| Claude Code 2.1.332 | `6cca06143eba50d32b9a2b8479a70d38aed1db7768a22c8f39dc1a775e55b136` | Verified with `claude-opus-5-5` | Verified with `claude-opus-5-5` |

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

The Claude Code payload came from commit `5bf579e37582aa28c853eb1c4e31708a00d7b351`. The check used the installed runtime's controller dispatch path in a disposable Git project, with simulated controller ownership and real native reviewers. It excluded the project policy from the reviewer's file inventory so the marker could reach the reviewer only through the assignment.

The lead reported `maple register` and identified a real fixture regression where the function returned 2 instead of 1. After the runtime imported that finding, the fixture changed the project policy marker to `amber register`. The runtime recovered the lead's policy for the finding from the original assignment. The skeptic distinguished the original and current markers in its summary, confirmed the finding, and the runtime accepted that verdict. Both receipts were complete and attributable to Opus 5.5 in two distinct native sessions. The skeptic's original model was structurally equal to the lead's captured model.

| Evidence | Lead | Skeptic |
| --- | --- | --- |
| Request ID | `1e70afd6-26ea-45ff-ba26-f40a38ed64d4` | `673e457b-1fb9-4072-b560-0be075704139` |
| Current scope SHA-256 | `76357594c581acb72acf6744ca490dd339d54193d6c72112afeb573568dbe234` | `e55e268d799b5f95771f68af4193059340e1b1dae352db8312f4a3f90cf31c38` |
| Receipt SHA-256 | `b1b92fdb44e6cf8175a7490435f095f592fa42f6964290aa054051d6ccab0f4c` | `81332f88745b148dfd5a1e8b72b93c8aafae71af194519620d4ce9f749a0e3ff` |
| Native event log SHA-256 | `1417e4cc904d893be8efdd8655b9ff73ba97e373282ab884ed101f8e1afcc876` | `465607beff0ded09a1396e1827daf2bf182a5d754b8335cc5eea4522aacea03a` |
| Native tokens | 24,268 | 25,028 |

The total was 49,296 tokens against a cap of 350,000. An earlier lead request for `claude-opus-5-6` (request `2a3195d3-82ae-4ad3-97dd-39a4c675783a`) returned API status 404 and zero tokens. That attempt ended before the skeptic, and the successful retry used Opus 5.5.

## Evidence limits

The checks cover native handoff on these fixtures. They did not exercise interactive setup, controller readback, or the comparative effectiveness campaign. The raw receipts, host event logs, and setup outputs are retained in local delivery scratch. The request IDs and hashes above identify that evidence.
