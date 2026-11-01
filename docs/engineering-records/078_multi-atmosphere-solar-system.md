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

### 2026-11-01 — Developer answers to the open questions

Recorded from the developer's chat reply; this is not a scope baseline.

- **Q1 (rim quality).** The developer could not judge it from the wording. It stays an investigation: the
  spike run above answers cost (about 2.9x for full resolution) but not the visual difference, so a
  full-resolution rim crop is needed before `bounded-backdrop` decides.
- **Q2 (tint hook).** A narrow, cheap beyond-air tint is fine for now. It must stay extensible, because
  large structures around a planet (for example O'Neill cylinders) are wanted later.
- **Q3 (renderer flip).** The default-renderer flip ([Plan 056](/docs/plans/056_webgpu_default_renderer.md)
  Phase 6) lands separately and does not gate this plan. Consumers keep opting in with
  `preferredRenderer: 'webgpu'`.

### 2026-11-01 — Developer direction: proceed with engine phases; limb parked

Recorded from the developer's chat reply; this is not a scope baseline.

- **Q1 (limb) is parked.** Do not fix the rim probe now. `bounded-backdrop` proceeds on the cost evidence
  alone and keeps the half-resolution space march; revisit the rim only if the bounded quad shows a visible
  edge artefact.
- **Proceed with** `bounded-backdrop`, then `body-tint`, then `docs-demo`.
- **"Nearby" needs a number.** Two bodies with air at once is the case to get right. The engine should
  expose the test as apparent size (angular radius of the atmosphere shell seen from the camera), not as a
  distance, so it works for any body size. The threshold is a documented default that a consumer can
  override; it is chosen from the lab, not guessed.
- **Far bodies become star-like points.** Beyond the threshold a consumer drops the atmosphere and shows
  the body as a lit point or star, which doubles as its level of detail. That is consumer-side; the engine
  only has to make "no atmosphere for a far body" cheap and glitch-free.

### 2026-11-01 — bounded-backdrop implemented (agent; not yet reviewed by the developer)

**What changed.** `AtmosphereBackdrop` keeps its full-screen opaque quad for the sky owner and for a camera inside the
air. A backdrop with `ownsSky = false` and the camera outside its air now draws a quad over the screen bounds of its
shell only, with premultiplied alpha (custom blend One / OneMinusSrcAlpha in the opaque pass, render order -998, so after
the owner's sky at -1000 and its sky bodies at -999, before the scene). Alpha is `1 - mean(transmittance)`; it draws no stars
and no sun disc of its own. The reduced-resolution space march is scissored to the same bounds (plus 2 texels), so a far
atmosphere shades fewer pixels. Culled backdrops (shell off screen, or below the minimum apparent size) are hidden, run no
march and no sky-view update; the minimum fades in over one doubling (smoothstep), so crossing it does not pop.
`PlanetAtmosphere.update` passes the shell (planet world position, `(radiusUnits x (R + top) / R) x world scale`).

**Apparent size and the default.** `apparentAngularRadius` (asin(shellRadius / distance), a quarter turn inside) and
`minAngularRadius`, default `DEFAULT_MIN_ANGULAR_RADIUS` = 0.25 degrees. Chosen from the lab geometry and not measured
visually: at the lab's 50 degree field of view on a 1080 pixel frame that is about 4.6 pixels of radius, and the Earth-like
air is about 1% of that, under a pixel; the lab's farthest views are 2-6 degrees, a moon-sized shell reaches 0.25 degrees
at about 63 planet radii. A visual check of the threshold is not done (see below).

**Design decisions.**
- *Owner is explicit.* `ownsSky` (default true) is set by the consumer; the engine does not guess which atmosphere owns the
  sky. The default keeps single-atmosphere scenes unchanged. The lab picks the enabled atmosphere nearest the camera.
- *Inside a non-owner's air the draw is full-screen opaque.* The space march does not serve a camera in the air and the
  sky-view table is the only inside path, so overlapping shells with the camera inside both are unsupported (documented).
- *Mean transmittance as alpha.* Per-channel dimming of what is behind needs dual-source blending; one mean value was
  chosen. It slightly mis-colours the owner's sky behind a thick non-owner limb.
- *Limb stays half-resolution* (Q1 parked): no change to the rim.

**Files.** `atmosphere/atmosphere-backdrop.ts`, new `atmosphere/atmosphere-backdrop-bounds.ts` (pure maths) and its spec,
`atmosphere/planet-atmosphere.ts`, `atmosphere/public-api.ts`, specs for the backdrop and `PlanetAtmosphere`, the
atmosphere README ("Several atmospheres in one scene"), `CHANGELOG.md`, and the lab page (owner assignment per frame, and
`coverage` / apparent angle in each case's details). Suite `atmosphere-multi-lab` v1 is unchanged.

**Run.** `npm run test:triangular-engine:atmosphere` (headless): 240 of 240 passed, including the new bounds maths
(including a 400-point containment check against the projected sphere), the alpha / blend configuration, owner default,
bounded / culled / full transitions, the scissored space march shrinking with distance, and `PlanetAtmosphere` supplying
the shell. `npm run build:triangular-engine`: built; demo-app `tsc --noEmit` clean. Lab, against the owner's server,
`--profile headless-hardware --noisy`, one launcher per case (fingerprint `a9e4490d-a49e0d49`, dirty tree), all
`auto=pass perf=inconclusive`, every case marked INVALID "headless profile not independently verified" and the machine
log warns `gpu-busy-before-start`, so the timings are indicative only. Files are under
`artifacts/test-runs/atmosphere-multi-lab@v1/` stamped 2026-11-01T21-48 to 21-49.

| Case | Before (spike) | Now |
|---|---|---|
| `insideA-both` upper-third black | 0.54 | 0.00 |
| `spaceBoth-both` halo A | 104.48 (108.40 with A alone) | 108.40 |
| `nearA-both` GPU frame median | 0.20 ms | 0.16 ms (floor, no atmosphere: 0.09) |
| `farA-both` GPU frame median | 0.20 ms | 0.13 ms |

So the wipe from inside A is gone and A's halo with both on equals A alone. A far atmosphere is cheaper than a near one in
the same suite (0.13 ms vs 0.16 ms), but the gap is a few hundredths of a millisecond, close to the timer step. The
`farA-both` case no longer has the moon as a non-owner (it owns the sky there), so it does not isolate the bounded draw.

**Not verified.** Only five of the 25 lab cases were run (`insideA-both`, `spaceBoth-both`, `nearA-both`, `farA-both`,
`nearA-none`); `insideB-both`, the single-arm and `farB` cases and the full-resolution comparison were not. No screenshot
was inspected, so there is no visual confirmation of the bounded edge, the fade-in at the threshold, or the limb; the halo
and black-fraction probes remain the parked-Q1 probes. The 0.25 degree default is reasoned, not seen. Culled bodies were
not exercised in the lab (no lab pose reaches 0.25 degrees); culling is covered by unit specs only. The WebGL2 fallback
backend's handling of the scissored render target and custom blend was not run. `body-tint` is not started.

## Scope history

<!-- tri:scope-history -->
<!-- tri:scope-baseline state="unconfirmed" -->
<!-- /tri:scope-baseline -->
<!-- /tri:scope-history -->
