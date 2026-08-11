---
name: review-report-json-schema
description: Explore a JSON schema that review agents validate their final report against, so malformed output is caught before the agent session is cleared
metadata:
  type: feature
status: exploring
---

# Review report JSON schema

Give review agents a JSON schema to validate their final report against before the session ends. Today a reviewer can emit a malformed report, and if the session is then cleared before the controller revives it for a well-formed version, the controller must either try to parse the erroneous report or re-run the whole review. Both are wasteful and the failure is easily avoidable by validating at the source.

The schema would pin the report shape the controller consumes (findings list, per-finding fields, verdicts), let the reviewer validate its own output before finalizing, and give the controller a deterministic parse instead of a salvage attempt. Open questions for later design: whether the schema lives in the revise skill's bundled files, how validation runs on the agent side, and what the contract is when a reviewer cannot validate its own output (retry, re-dispatch, or degraded read).

Captured 2026-08-12 from a mid-session idea while migrating the deterministic init-backlog proposal.