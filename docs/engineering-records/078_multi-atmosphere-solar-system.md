---
type: EngineeringRecord
title: "Multi-atmosphere solar-system support"
description: "Dated decisions, findings and evidence for Multi-atmosphere solar-system support."
timestamp: 2026-11-01T00:00:00Z
tags: [engineering-records]
record_id: er-078
scope_history_schema: 1
plans:
  - /docs/plans/078_multi-atmosphere-solar-system.md
performance: []
---

# Engineering Record 078: Multi-atmosphere solar-system support

Plan: [PLAN-078](/docs/plans/078_multi-atmosphere-solar-system.md).

## 2026-11-01 — Starting

**Goal.** Let several planet atmospheres coexist (planet plus moon, or a solar system), keep
distant ones cheap, and tint real 3D bodies seen through air.

**Open decisions and assumptions.** See the current scoped review in [the plan](/docs/plans/078_multi-atmosphere-solar-system.md).

**Checks.** None run yet. This entry is read-only analysis from a consumer-app integration
attempt; no engine code has changed.

## History

### 2026-11-01 — Findings from reading the code

- **Cause of the collision.** `AtmosphereBackdrop` is a full-screen `PlaneGeometry(2,2)`, opaque,
  depth test and write off, `renderOrder -1000`, output `vec4(sky, 1)`. Two instances at the same
  order: the last wipes the screen, and rays that miss its planet are black. Inside the air it reads
  the sky-view LUT; in space it runs a half-resolution march (`spaceScale` 0.5, about 32 steps per
  planet pixel) that is costliest when the planet fills the screen.
- **Overlap was out of scope.** [Plan 049](/docs/plans/049_morphing_planet_atmosphere.md) says only
  one atmosphere is "inside" at a time and others use the space path.
- **Sky objects are discs at infinity.** `AtmosphereSkyBody` (`renderOrder -999`) is untextured and
  cannot represent a body the camera can reach. `backdrop.atmosphereSky(dir)` and `skyObject()` tint
  with one backdrop's model and are direction-based, so the maths can be reused for a real mesh; the
  per-fragment hook is missing. The free `withAtmosphere(NodeMaterial)` was deferred in Plan 049
  Phase 4.
- **Haze cost evidence exists.** [ER 051](/docs/engineering-records/051_cloud_volumes.md) holds two
  `cloud-haze-cost@v1` runs: static views meet the 0.1 ms goal, the fly-by is about 2x over, and
  the per-pixel haze was kept. The adapter was unrecorded and both runs warned
  `gpu-busy-before-start`, so treat the numbers as indicative.
- **Renderer.** The atmosphere needs `WebGPURenderer` (native WebGPU or its WebGL2 backend). The
  engine default is still `'webgl'` (`engine.service.ts`); the flip is
  [Plan 056](/docs/plans/056_webgpu_default_renderer.md) Phase 6 and is not part of this plan.

### 2026-11-01 — Proposed split with a consumer app

The consumer owns which bodies get an atmosphere (data-driven, by proximity or influence sphere)
and which one owns the sky. The engine owns the bounded space-mode backdrop and the body-tint
mechanism. Order: measure, bounded backdrop, body tint, docs. Proposed by an agent; not yet
confirmed by the developer.

## Scope history

<!-- tri:scope-history -->
<!-- tri:scope-baseline state="unconfirmed" -->
<!-- /tri:scope-baseline -->
<!-- /tri:scope-history -->
