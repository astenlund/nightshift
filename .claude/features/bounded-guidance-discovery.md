# Bounded guidance discovery

Feature: bound recursive repository guidance discovery while preserving a deterministic and explainable discovery contract. This file is the authoritative capture record for the feature direction.

## Problem and goal

Guidance discovery currently walks the repository except for `.git`. Dependency, vendor, distribution, and build trees can therefore impose unbounded traversal and a Windows attribute probe for every inspected directory. The goal is a deterministic bound that avoids pathological repository cost while making every excluded or budget-limited discovery boundary visible.

## Required design surface

- Choose an explicit conventional-directory skip policy, a depth or entry budget, or a defined combination of those mechanisms.
- Define ordering and accounting so the same repository state produces the same visited set, admitted guidance, exclusions, and budget result.
- Define what the user sees when a conventional directory is skipped or a budget is exhausted, including whether the run continues, returns incomplete, or fails closed.
- Define the complementary path for guidance outside skipped trees and below all budgets, including nested guidance precedence.
- Add fixtures proving which guidance remains discoverable across ordinary repositories, dependency trees, build outputs, nested roots, boundary depths, and exhausted budgets.

## Current boundary

No directory list, traversal limit, precedence rule, or exhaustion disposition is settled by this capture. Discovery must not silently skip conventional directories or truncate a walk until the governing design makes those semantics explicit. The item has high practical priority for repositories with large dependency trees.

## Status

Tracked as an active performance and behavior feature after the deterministic init-backlog review. The bounding mechanism, reporting, failure semantics, precedence, and fixture matrix require a governing design before implementation.
