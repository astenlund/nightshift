---
name: immutable-accepted-authority
description: Explore immutable agreement authority and blocker-only renewal for compatible review fixes
metadata:
  type: feature
status: exploring
---

# Immutable accepted authority for compatible refreshes

Feature: keep the accepted digest and canonical source before-images as immutable authority throughout a lifecycle run. This file is an exploring draft, not yet a settled design.

## Problem

The agreement procedure says canonical hunks are judged against the exact accepted digest, but a caller can update a canonical index excerpt alongside its breakout and then use the refreshed mutable governing set as fit evidence. Edited text can therefore help justify its own containment. The deterministic-init-backlog run exposed the circularity when successive excerpt synchronizations accompanied increasingly detailed spec fixes that were treated as compatible.

The same run exposed an overly sensitive renewal boundary. Once the user has accepted the product shape, routine review fixes should not repeatedly return for approval. A confirmed finding must fit that shape, route to follow-up when it would expand the shape, or block only when a necessary correction cannot fit and progress cannot safely continue.

## Candidate contract

- Retain the accepted digest and the before-image of every accepted canonical source as immutable comparison authority.
- Classify the complete semantic delta against that authority before synchronizing a derived or mirrored excerpt. A mutable after-image is never evidence for its own compatibility.
- Apply a compatible fix autonomously when it preserves the accepted product shape.
- Route a review suggestion to follow-up when it would expand or alter that shape but is not required for safe progress.
- Request renewed user agreement only for a genuine blocker where a necessary correction cannot fit the accepted shape and progress cannot safely continue.
- Synchronize representation mirrors and replace compatible current state only after the fit verdict is validated.

## Design questions

- Define the immutable state ownership and lifecycle across compatible refreshes, resume, handover, and controller-store loss.
- Define how semantic fit evidence cites the accepted digest and canonical before-images without allowing mutable evidence into the judgment.
- Define the structural test for genuine blockage and the fail-closed behavior when classification cannot prove compatible, follow-up, or blocker.
- Preserve parity across handover and all revise wrappers without duplicating the agreement sequence.

## Status

Promoted from a Quick Win during the 2026-08-25 deterministic-init-backlog recovery because the required immutable state, cross-caller transitions, and blocker-only renewal policy are feature-scale.
