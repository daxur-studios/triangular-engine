---
type: Plan
title: "Procedural shape verification"
description: "Deterministic shape, invariant and budget verification for agent-written procedural part generators."
timestamp: 2026-10-27T00:00:00Z
tags: [engineering-records, procedural, testing]
runbook: /docs/runbook/068_procedural-shape-verification.md
map_schema: 1
document_id: plan-068
initiative_id: "procedural-shape-verification"
performance: []
---

# Plan 068: Procedural shape verification

Status: **planned**. Evidence and decisions: [ER 068](/docs/runbook/068_procedural-shape-verification.md).

## Intended outcome

Agents can write or change a parametric procedural part generator and get a fast, deterministic,
headless verdict on whether it matches an approved reference spec and stays within budget. The
verdict is numeric (per-view, per-part silhouette IoU, cross-section error, dimension tolerances,
invariants, triangle/draw-call/generation-time budgets) plus a diff overlay image, so an agent can
iterate on it without visual judgement.

Core principle: concept art is inspiration; a human-approved **reference spec** is the verification
target. A spec is an orthographic three-view SVG with one named layer per part, optional
cross-section SVGs at named stations, and a JSON manifest of dimensions, tolerances, symmetry,
sockets and connector interface sizes.

Constraints:

- Shape gates are deterministic geometry only. VLM review is advisory and never gates a change.
- The verifier is trusted only after mutation calibration: deliberately wrong variants must fail.
- Generators are parametric (discrete counts and continuous parameters), not single meshes; reference
  configurations are shape-checked, the whole parameter space is property-checked.
- Builds on the existing `procedural` core (sockets, validation), `procedural/parts` (joints,
  skeleton, sockets) and `testing` entry points; optional integrations stay out of core.

Out of scope: fully automatic concept-art-to-model without human spec approval; fine organic detail
(hair, cloth) beyond socket and bounds checks; image-generation tooling itself.

<!-- tri:scope -->

## Phases and acceptance

- **spec-format** — Define the reference spec: three-view SVG conventions (orthographic, metres, library axes, Y-up, one layer per part id), station section SVGs and the JSON manifest schema, including a tolerance class per part (`interface`, `primary`, `cosmetic`). Acceptance: a documented, validated schema with one hand-authored example spec that loads and rasterises to per-part masks in a unit test.
- **reference-prompts** — A prompt helper for generating new reference sheets in one fixed format: orthographic front/side/top/back on a neutral flat background, flat lighting, a shared ground line and height grid, one exploded parts view per sheet (e.g. a vehicle split into cockpit, fuselage, wings, gear), and character turnarounds in a fixed pose. Acceptance: documented prompt templates for vehicle part sheets and character turnarounds, plus one generated sheet traced into a spec with its view disagreement recorded in the ER.
- **verifier-core** — Headless verifier: render a generator's output orthographically with per-part ID colours, compare against the spec masks (IoU per view and part, boundary distance), sample sections, check invariants (finite, bounds, symmetry, sockets on surface, no part interpenetration) and budgets; emit a JSON report and a diff overlay PNG. Acceptance: one command produces the report for a given generator and configuration in a headless, non-watching run.
- **calibration** — Mutation calibration: a set of deliberately wrong variants (part scaled ±15%, offset, missing part, wrong section) per reference. Acceptance: every mutant fails its gate and the unmutated reference passes; chosen thresholds and margins are recorded in the ER.
- **capsule-character-spike** — First consumer: a capsule-style character body (two-tone capsule, tube limbs along curves, boots, sphere eyes) and space-gear sockets (helmet, back pack, headset), traced from a front/side/back base-body sheet. Acceptance: reference rest pose passes per-part IoU and fit checks (head within helmet clearance, back pack contact without intersection), the parameter sweep passes invariants, and the spike page has a runnable `triangular-engine/testing` scenario.
- **parametric-revolve** — A surface-of-revolution vehicle (stacked stages, radial boosters on sockets) with discrete stage/booster counts. Acceptance: reference configurations pass shape gates and property tests hold across the counts.
- **lofted-sections** — Lofted fuselage from non-circular parametric cross-section families (crown, chine, flat belly, corner rounding) with a cockpit section modifier whose length grows by seat bays (1–3 seats) rather than scaling. Acceptance: per-station section error and side/top IoU pass for each seat-count reference; seat sockets equal seat count; connector rings mate.
- **articulated-parts** — Articulated parts with named states (e.g. landing gear retracted/extended). Acceptance: each state passes envelope checks, sampled poses along the transition do not collide with the host, and extended contact points meet the spec.

## Relationships

<!-- /tri:scope -->

## Current phase status

| Phase                   | State   |
| ----------------------- | ------- |
| spec-format             | planned |
| reference-prompts       | planned |
| verifier-core           | planned |
| calibration             | planned |
| capsule-character-spike | planned |
| parametric-revolve      | planned |
| lofted-sections         | planned |
| articulated-parts       | planned |

<!-- tri:review version="1" scope-hash="d47082db5be2a2d4b466b9692330ec78ccf67d227612275a388cadf080f0500e" reviewed="2026-10-27" reviewer="agent" -->
<!-- tri:item id="Q1" kind="intent" applies-to="spec-format,calibration,capsule-character-spike" blocks="calibration" state="resolved" -->

- [x] Is a per-part silhouette IoU of 0.90 the intended pass bar, or should thresholds be set per
      part from calibration margins?
  - Why it matters: a single global bar may be too loose for large parts and too strict for thin
    ones (limbs, wing tips), which changes what agents optimise for.
  - Next action: calibration sets the numbers for each tolerance class and records the margins.
  - Resolution: no single bar. Each part declares a tolerance class in the manifest: `interface`
    (where parts meet, e.g. the cockpit–fuselage connector; checked geometrically for ring/face
    match, near-exact), `primary` (main silhouette, around 0.90 IoU) and `cosmetic` (hair,
    antennae; loose, around 0.70 IoU, plus bounds and socket checks). Starting values are
    provisional until calibration.
    <!-- /tri:item -->

<!-- tri:item id="Q2" kind="investigation" applies-to="spec-format,reference-prompts,capsule-character-spike" blocks="capsule-character-spike" state="open" -->

- [ ] Are AI-generated front/side/back sheets consistent enough to trace into a three-view spec?
  - Why it matters: inconsistent views make the spec itself wrong and every downstream gate
    meaningless.
  - Next action: the developer generates new sheets with the reference-prompts templates; the
    agent traces one, overlays the views on a shared height scale and records the measured
    disagreement in the ER.
    <!-- /tri:item -->

<!-- tri:item id="Q3" kind="investigation" applies-to="verifier-core" blocks="verifier-core" state="open" -->

- [ ] Are orthographic ID-colour mask renders bit-stable across SwiftShader and hardware headless
      runs?
  - Why it matters: unstable masks would make IoU results depend on the machine.
  - Next action: render the same spec on both profiles and compare masks; record the outcome in the
    ER.
    <!-- /tri:item -->
    <!-- /tri:review -->

## Delivery progress

Record dated milestones, evidence and material changes in the linked Engineering Record.

Scope history in the Engineering Record is append-only. Confirm a specific baseline only after
explicit developer confirmation; document review and checked boxes do not imply confirmation.
