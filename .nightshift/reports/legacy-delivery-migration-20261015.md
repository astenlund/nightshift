# Legacy delivery migration in this repository

On 2026-10-15, the installed Nightshift 3.3.11 Codex administrative route retired the 45 delivery records in this repository that lacked schema-2 independent accounting. Five exact manifests were displayed and individually approved. The store at `.nightshift/runs/state.sqlite` is ignored and local to this checkout; this report records its outcome but does not recreate its certificates in another clone.

## Inventory and preservation

- Before: inventory hash `ea263cf2f58f338398b3b5801fece482f6d767943627d280f731476311c48afb`; 45 legacy records, 43 complete and two stopped, with zero retirements.
- After: inventory hash `f3390ac163db83b2154883bccb53f23be268021526293e77fa5ec6edb42da591`; 45 valid retirements, zero unretired legacy records and zero unavailable retirements.
- Inventory checks across all three pages after each retirement found every original state and latest-history hash, revision and status unchanged. The selected run remained `1baef4bd-dc5a-49a6-a2ae-263d279b507f`.

## Approved decisions

| Records | Manifest hash | Retirement and obligations |
| --- | --- | --- |
| 41 complete records | `28db6d7bd6ba9edd1c6a645a559543f8a2220ad88e4cee63ebbbda6710af34e3` | `retired-complete`; 25 report `none`, 16 `already-delivered`; no pending follow-ups |
| `1e8eccc8-d756-4af7-8a0d-6eb94a387794` | `1b79953f68d0bf3dcc59292e4d52665234a09919cef225a9e049366ae15ae210` | `retired-stopped`; unfinished publication-review task and closing acknowledged; report `none` |
| `7b7ad4bd-c137-4dc4-8300-eaab1be6e89b` | `4e46d69f40879e94e286d84c1a065cd8bf3ed7e3c7d00fea8954edbfc505952f` | `retired-stopped`; unfinished closing acknowledged; report `none` |
| `2a89bde5-9c0c-4ba5-b67f-dadc545bfcc4` | `311501b5392e966124b63761f130665157a9fbc2d2bfb7295db417680ee699d7` | `retired-complete`; report `none`; follow-up `retained-size-reporting` tracked to [Retained release reports omit retained payload size](../BUGS.md#retained-release-reports-omit-retained-payload-size), entry hash `c0a3fe1af84f6e3ad53d0bd412963c323751c950dc205356160e53151c18307b` |
| `5286ec74-ec0d-4ba8-a1cc-48877625a834` | `ae1470ac2d863b03fd8529147f2c9d812472240f2cd7d730c36ceb41b9861671` | `retired-complete`; local saved report at `.nightshift/runs/reports/run-adoption-specification-20260921.md` confirmed at SHA-256 `3b0eea697fb5619f82e79f358432aa3f268a39581ac7b73b01deeafe20812699`; attachment and whitespace-stream follow-ups dismissed; executive-scope follow-up tracked to [the existing bug](../BUGS.md#executive-governing-scope-is-missing-during-early-review), entry hash `d3f979f0071145cacfed8bbcb000bddc339122b95d8bbfd249489d20445ff23f` |

The two tracked destinations were current in the final inventory. Their later edit, move or absence can stale a certificate and block a new handover until a superseding decision is approved. Source manifests and transaction responses remain under ignored `.tmp` on this checkout. The content-addressed certificates remain in the local run database.

## Evidence limits

The installed Codex administrative preparation, inventory, `raw-inspect` with `report: true`, exact manifest and retirement paths were exercised for this repository, including use of the current administrative bundle from an older-bound session. The handover skill's plain-language migration route, a new handover after retirement and its older-session refusal, and certificate supersession were not probed here (live-claim: provisional). Other installed behavior not named in this report remains unverified by this application.

The user reports a separate successful Claude Code migration; its native evidence was not inspected for this report, so no per-branch claim about that run is made here. A valid retirement inventory does not itself prove that every other creation precondition will pass. The reusable implementation and its deterministic checks shipped in 3.3.11; [the governing spec](../specs/legacy-delivery-record-migration.md) describes the design.
