---
type: Runbook
title: "Procedural shape verification"
description: "Dated decisions, findings and evidence for Procedural shape verification."
timestamp: 2026-10-27T00:00:00Z
tags: [engineering-records, procedural, testing]
record_id: er-068
scope_history_schema: 1
plans:
  - /docs/plans/068_procedural-shape-verification.md
performance: []
---

# Engineering Record 068: Procedural shape verification

Plan: [PLAN-068](/docs/plans/068_procedural-shape-verification.md).

## 2026-10-27 — Starting

**Goal.** Give agents a fast, deterministic, headless way to verify that a parametric procedural
part generator matches an approved reference spec and stays within budget, so iteration does not
depend on visual judgement.

**Background.** Existing procedural generators (`procedural/core` sockets and validation,
`procedural/parts`, `procedural/characters`) have unit-level validation but no check against a
desired shape. Concept art (AI multi-view sheets, perspective key art) is not view-consistent or
metric, so it cannot be the verification target directly.

**Decisions so far.**

1. Verify against a human-approved reference spec, not concept art: an orthographic three-view
   SVG with one layer per part, optional station section SVGs, and a JSON manifest (dimensions,
   tolerances, symmetry, sockets, connector interfaces).
2. Gate tiers: invariants → shape metrics (per-view, per-part IoU; section error; dimensions) →
   budgets (triangles, draw calls, generation time, memory). VLM review is advisory only.
3. Trust is earned by mutation calibration: deliberately wrong variants must fail every gate they
   target before thresholds are accepted.
4. Generators are parametric. Shape gates run on reference configurations; property tests
   (invariants, monotonic dimensions, socket counts, connector mating) run across the parameter
   space to resist overfitting a single silhouette.
5. Agent feedback is numeric plus a diff overlay image, not a screenshot to interpret.
6. First consumer is a capsule-style character kit (simple primitives, socket-based gear) because
   its views trace consistently and its gates are unambiguous; revolve vehicles, lofted
   non-circular fuselages with seat-count cockpits, and articulated gear follow.

**Open decisions and assumptions.** See the current scoped review in [the plan](/docs/plans/068_procedural-shape-verification.md).

**Checks.** Record commands and observable outcomes. Keep functional, performance and human visual evidence distinct.

## History

Append dated findings, decisions, scope changes and verification. Do not erase earlier outcomes when a plan is superseded.

### 2026-10-27 — Developer answers to Q1 and Q2

- Q1 (resolved): tolerance depends on the part's role, not one global IoU bar. The manifest gives
  each part a tolerance class: `interface` (connecting regions such as cockpit–fuselage; near-exact
  geometric match), `primary` (around 0.90 IoU) and `cosmetic` (hair and similar; around 0.70 IoU
  plus bounds and socket checks). Calibration fixes the final numbers.
- Q2: the developer will generate new reference images rather than reuse the existing art. Added
  phase `reference-prompts`: prompt templates so every sheet follows one format (orthographic
  views, flat background and lighting, shared ground line and height grid, exploded parts view).
- Q3 stays an agent investigation; it needs no developer decision.

## Scope history

<!-- tri:scope-history -->
<!-- tri:scope-baseline state="unconfirmed" -->
<!-- /tri:scope-baseline -->
<!-- /tri:scope-history -->
