---
type: Plan
title: "Multi-atmosphere solar-system support"
description: "Let several planet atmospheres coexist in one scene, and tint real 3D bodies seen through air."
timestamp: 2026-11-01T00:00:00Z
tags: [engineering-records]
record: /docs/engineering-records/078_multi-atmosphere-solar-system.md
map_schema: 1
document_id: plan-078
initiative_id: "multi-atmosphere-solar-system"
performance: []
---

# Plan 078: Multi-atmosphere solar-system support

Status: **planned**. Evidence and decisions: [ER 078](/docs/engineering-records/078_multi-atmosphere-solar-system.md).

<!-- tri:scope -->

## Intended outcome

A scene with a planet and its moon, or a whole solar system, can give several bodies an
atmosphere at once. Each atmosphere renders correctly when the camera is inside its air or in
space, a distant body costs close to nothing, and real 3D bodies seen through an atmosphere
(a moon, a distant planet, a station) take on its haze and colour.

Today `<planetAtmosphere>` assumes one planet. Each `AtmosphereBackdrop` is an opaque
full-screen quad with depth test and depth write off, so a second one wipes the first to black.
[Plan 049](/docs/plans/049_morphing_planet_atmosphere.md) states that only one atmosphere is
"inside" at a time and puts overlap out of scope; this plan closes that gap.

Constraints:

- A scene where the camera travels between bodies must work. Sky objects drawn as untextured
  discs at infinity (`AtmosphereSkyBody`) do not suit it, because the camera can reach the
  object. Tinting applies to real scene objects, not stand-ins at an unreachable distance.
- Cost must scale with how many atmospheres are near or large on screen, not with how many exist.
- Which body "owns the sky" is the consumer's decision (for example the gravity primary). The
  engine provides the mechanism and a documented way to choose.

Out of scope: changing the default renderer ([Plan 056](/docs/plans/056_webgpu_default_renderer.md)
Phase 6); textured sky bodies; earthshine and night-side moonlight as atmosphere features (a real
lit mesh gets them from ordinary scene lighting); the screen-pass coverage work in Plan 049 Phase 4.

## Phases and acceptance

- **spike-measure** — Measure the cost and failure modes today: two `PlanetAtmosphere` instances in one scene (planet plus moon), camera inside one and in space, with the existing half-resolution space march. Acceptance: a `triangular-engine/testing` suite records frame time and a screenshot for each case on a recorded GPU adapter, and the record states the black-screen failure and the per-planet space cost with numbers.
- **bounded-backdrop** — A space-mode backdrop that covers only the body's screen bounds and outputs alpha, while the full-screen quad is kept only for the single atmosphere the camera is inside. Acceptance: a planet and a moon with atmospheres both render from space, from inside either one, and while moving between them, with no black wipe; a far atmosphere costs measurably less than a near one in the same suite.
- **body-tint** — A way to make a real mesh's material show the air between it and the camera: view-ray transmittance and in-scatter for a body beyond the air, and the existing froxel aerial perspective for objects inside it. Delivered as the free `withAtmosphere(NodeMaterial)` hook deferred by Plan 049 Phase 4, or a narrower beyond-air equivalent if a spike shows the free hook is too broad. Acceptance: a mesh moon seen from inside the air is visibly blue-hazed and the same mesh seen from space is not; a mesh inside the air matches the haze of terrain at the same range; the sky-disc API is unchanged and documented as a distant-only convenience.
- **docs-demo** — Update the atmosphere README, add a demo scene with a planet and moon, and CHANGELOG entry. Acceptance: README states the multi-atmosphere rules, the tint hook and the sky-disc limitation; the demo page uses the engine portal layout and has a saved test run.

## Relationships

- **builds-on**: [Morphing planet atmosphere](/docs/plans/049_morphing_planet_atmosphere.md)
- **related-to**: [WebGPU default renderer](/docs/plans/056_webgpu_default_renderer.md)
- **related-to**: [Composite cell planet](/docs/plans/065_composite_cell_planet.md)
<!-- /tri:scope -->

## Current phase status

| Phase            | State   |
| ---------------- | ------- |
| spike-measure    | planned |
| bounded-backdrop | planned |
| body-tint        | planned |
| docs-demo        | planned |

<!-- tri:review version="1" scope-hash="b6151e4bde9194c0a00364281f07a0279adc1c33a1f440cdbb883350bb73455e" reviewed="2026-11-01" reviewer="agent" -->
<!-- tri:item id="Q1" kind="investigation" applies-to="bounded-backdrop" blocks="bounded-backdrop" state="open" -->

- [ ] Is a bounded alpha quad or shell enough for the space view, or does the limb need a
      full-resolution march near the screen edge of the planet?
  - Why it matters: it decides how much of the current space march is reused and how much
    cheaper a distant atmosphere can be.
  - Next action: the spike-measure suite compares both on the owner's discrete GPU and records
    the result in the Engineering Record.
    <!-- /tri:item -->
    <!-- tri:item id="Q2" kind="intent" applies-to="body-tint" blocks="body-tint" state="open" -->
- [ ] Should the tint hook be the general free `withAtmosphere(NodeMaterial)` or only a
      beyond-air tint for large distant bodies?
  - Why it matters: the general hook touches every material path and the haze cost budget;
    the narrow one covers the moon and distant planets and is cheaper to ship.
  - Next action: the developer decides after the spike shows both costs.
    <!-- /tri:item -->
    <!-- tri:item id="Q3" kind="assumption" applies-to="docs-demo" blocks="none" state="open" -->
- [ ] The default-renderer change (Plan 056 Phase 6) lands separately and does not gate this plan.
  - Why it matters: the atmosphere needs `WebGPURenderer`, which already has a WebGL2 backend;
    consumers opt in with `preferredRenderer: 'webgpu'` until the default flips.
  - Next action: the developer confirms or links the Plan 056 decision.
    <!-- /tri:item -->
    <!-- /tri:review -->

## Delivery progress

Record dated milestones, evidence and material changes in the linked Engineering Record.

Scope history in the Engineering Record is append-only. Confirm a specific baseline only after
explicit developer confirmation; document review and checked boxes do not imply confirmation.
