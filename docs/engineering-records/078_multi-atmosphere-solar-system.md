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

### 2026-11-01 — Spike-measure run (headless-hardware, RTX 3080 Laptop GPU)

**Setup.** Lab page `/atmosphere-multi-lab` (planet A at the origin, Earth air; moon B 1737 km, 6 radii away, Earth-like air; both `PlanetAtmosphere`, no engine atmosphere code changed). Suite `atmosphere-multi-lab` v1, 25 cases, standard mode, 3 s windows, `--profile headless-hardware`. Result: `artifacts/test-runs/atmosphere-multi-lab@v1/2026-11-01T18-00-17-157Z_headless-hardware_4d5319a6-be986201.json`. Thumbnails (320 px, one per case, `<case>-r1-0.webp`) are in the folder next to it. Adapter recorded: `nvidia / ampere / 0x249c / NVIDIA GeForce RTX 3080 Laptop GPU`, the discrete GPU (not the iGPU). Fingerprint `4d5319a6`, dirty tree. Verdict: `auto=pass perf=inconclusive`, exit 1. Every case is `INVALID: Headless hardware/power profile was not independently verified`, so the numbers below are indicative only.

**Q1 in plain language (rim as seen from space).** Not answerable from this run. The cost half is answerable: at the close-to-A space view, the full-resolution march costs 0.58 ms GPU median against 0.20 ms for the half-resolution pass (about 2.9x). The visual half is not: the rim ring (1.00–1.06 radii of A) reads luma 0 in every arm, both passes, and the 320 px thumbnail (`nearA-both-full-r1-0.webp`, `nearA-both-r1-0.webp`) shows no visible limb glow at all. The probe or the view does not isolate the rim, so the rim diff (`rimMeanAbsDiffLuma` = 0) says nothing about quality. A crop at full resolution is needed before judging.

**Black wipe (reproduce or not).**
- Space, both bodies (`spaceBoth-both`): not reproduced by the halo probe. B's halo with both on is 69.06, identical to B alone (69.06). A's halo is 104.48 with both on vs 108.40 with A alone, a 4% change. Upper-third black is 1.00 in every space arm, so it carries no signal there.
- Inside A (`insideA-both`): reproduced. Upper-third black is 0.54 with both on, 0.00 with A alone (`insideA-a`). The sky behind the camera goes black when B is present.
- Inside B (`insideB-both`): not reproduced. Upper-third black is 0.00 with both, the same as B alone (`insideB-b`).
- Close to A or close to B in space (`nearA-both`, `nearB-both`): the halo reads 0 in every arm, so the probe cannot say whether a wipe happened. Only the upper-third fraction (0.87 and 0.92) is reported, and it matches the single-atmosphere arms.

**Per-planet space-march cost (GPU frame, median ms, arm difference at the same pose).**

| View | none | A only | B only | both | A cost | B cost |
|---|---|---|---|---|---|---|
| close to A (`nearA`) | 0.09 | 0.17 | 0.14 | 0.20 | +0.08 | +0.05 |
| far from A (`farA`) | 0.09 | 0.14 | 0.15 | 0.20 | +0.05 | +0.06 |
| close to B (`nearB`) | 0.10 | 0.15 | 0.17 | — | +0.05 | +0.07 |
| far from B (`farB`) | 0.09 | 0.14 | 0.14 | 0.19 | +0.05 | +0.05 |

Near versus far: A costs 0.08 ms close and 0.05 ms far; B costs 0.07 ms close and 0.05 ms far. The far numbers are not zero, so a distant atmosphere still costs about as much as the flat floor step (0.05 ms) and is not free. Where B's cost appears in the close-to-A view, B is a few pixels on screen, so that cost is per-pass overhead, not per-pixel march.

**Caveats.** Wall frame time is 6.10 ms in every case, a pacing artifact, so only GPU times are used. GPU frame times of 0.1–0.2 ms look low for full-screen passes and should be checked with a probe that covers the whole pass. The halo and rim probes read one frame after the window and gave zeros where the picture shows a planet, so they need a fix before any wipe verdict counts. No scope baseline was marked.

## Scope history

<!-- tri:scope-history -->
<!-- tri:scope-baseline state="unconfirmed" -->
<!-- /tri:scope-baseline -->
<!-- /tri:scope-history -->
