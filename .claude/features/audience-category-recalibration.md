---
name: audience-category-recalibration
description: Sharpen the audience-category judgment so public visibility alone never earns the top baseline tier
metadata:
  type: feature
---

# Audience-category recalibration

Feature: the audience component-to-category judgment behind the rigor profile requires actual external adoption signals before a repository reads as category `public`. This file is the authoritative design record.

## What it does

Today the judgment (revise-spec grounding step in `internal/revise/spec.md`, derivation in `internal/revise/rigor.js`) maps a repo that is public on GitHub to category `public` and thus the top baseline tier, even with no adoption signals; nightshift's own specs (the wave-lifecycle Operating context, the ready-exploring-visibility one) recorded exactly that judgment. User ruling 2026-08-15: a public repo with no forks and no or few stars is a solo project that happens to have its source open; it should not earn the top baseline from visibility alone.

## Design

- `public` requires external adoption signals: forks, stars, known downstream installs. An unadopted open-source repo maps to `personal use`.
- Decide whether `AUDIENCE_BASELINE` needs a distinct category (for example `open source, unadopted`) or only sharper judgment prose in the grounding step; the rebased five-tier baseline table from Rigor-steered lifecycle is the table this edits, which is why that feature lands first.
- Sweep existing specs' Operating context sections for recorded `public` judgments and recalibrate each as a deviation entry with the new basis.
- Uplift predicates stay as-is.

## Provenance

Promoted from the `## Rigor calibration` quick win on 2026-08-22; the quick-win text is preserved above.
