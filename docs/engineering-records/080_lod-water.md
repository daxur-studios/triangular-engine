---
type: EngineeringRecord
title: "LOD Water"
description: "Dated decisions, findings and evidence for LOD Water."
timestamp: 2026-11-01T00:00:00Z
tags: [engineering-records]
record_id: er-080
scope_history_schema: 1
plans:
  - /docs/plans/080_lod-water.md
performance: []
---

# Engineering Record 080: LOD Water

Plan: [PLAN-080](/docs/plans/080_lod-water.md).

## 2026-11-01 — Starting

**Goal.** Water on the LOD surface for the plane, the sphere and an O'Neill-style cylinder, with near and far forms that share one wind field, weather presets, and suites for cost, visuals and moving cameras. Full outcome and scope in the plan.

**Design (architect, Opus 5.5).** Water is a second `lod-surface` body on the same lattice, with a new analytic wave source and water material, shipped as `triangular-engine/lod-water`. One deterministic wind field drives every wave amplitude, so the near geometry, per-pixel normal, far roughness and foam come from one parameter set. The architect's full text is kept in its side-session note; the plan carries its phases and packets.

**Findings that shaped the design.**
- The current hook calls an analytic source with an absolute float32 position (`lod-surface-mesh.ts:407`). On the 600 km sphere that is about 6 cm per step, which makes a 2 m wave swim. The fix is anchor-relative phase, wrapped to 2π on the CPU. This is the one change to lod-surface core in W1.
- A seeded, analytic wind field is the same on the CPU and the GPU, so it does not break the CPU twin. Only simulated wind would.
- There is no uniform wind on a sphere (hairy-ball theorem), so wave directions are fixed 3D unit vectors. Direction poles may show rings; Q6 measures it.
- The morph is mostly free: the bend lives in the mesh's vertex stage (G6b/G6d). What is missing is listed in the plan's could-not-verify list.

**Owner decisions (2026-11-01).**
1. Entry name: `lod-water`, approved as suggested (owner, 2026-11-01, "1 - ok"). Recorded in packet W0a.
2. Q2/Q3 thresholds, K and the foam and slick curves: take the architect's proposals now and tune later. Minamo (`D:\external\minamo`, MIT) may help with the far look.
3. Cylinder test preset R 3.2 km, L 32 km: accepted.
4. No water on the caps, ever.
5. Water morph (W4) is in scope. It can be done later, but must be designed for now.
6. Architect recommendations are followed unless the owner says otherwise.
7. The slope criterion is dropped (see the entry below); it is not part of this work.
8. Wind: a unified wind system. The architect's `WindField` is the shared hook (Plan 057 W17).
9. Tuning: later, or check Minamo.
10. Headless NVIDIA runs count as gate evidence, cross-checked in a visible browser later. A busy GPU is not a blocker.

**Phase structure (owner question, 2026-11-01).** The owner asked whether the phases should be fixed before architecting. Recommendation adopted: phases and their gates are fixed in the plan; the architect defines packets per phase when the phase starts, and a packet may be smaller or larger than a phase. The protocol's batch (task) sizes stay the same. This means the architect's first pass covers W0 only, and later phases get their packets in a further architect pass.

**Checks.** See the 2026-11-02 entry in History. The records check command is `node projects/triangular-engine/bin/triangular.mjs docs records check`; `npm run docs:records:check` does not exist in this repository.

**Open items (carried from the architect).** Could not verify: the planet-material sky and reflection API, Plan 059's runbook, and whether `<flatTerrain>` takes a custom source and material (the spike answers that). The demo build was failing on another page (soft-body lab) when the architect read the record. The plan number is now reserved as 080.

**Shoreline and land under water (noted 2026-11-01, not in W0b).** W0b draws a flat plane with no ground under it, so its numbers do not include land. The land case is covered by plan w2 (terrain-aware culling and depth from `groundAt`), not by the W0b spike. Its cost (full-density water under land) stays unmeasured until w2.

## History

Append dated findings, decisions, scope changes and verification. Do not erase earlier outcomes when a plan is superseded.

### 2026-11-02: W0b spike, aliasing gates and the water that passes them

**Problem.** The owner's screenshots of the first spike water showed concentric rings and a grid pattern in the far field, and a colour step between near and far. Two causes: the 12 wave directions and wavelengths were evenly spread, so their sum is a lattice that no filter removes; and nothing measured aliasing, so the owner was the test.

**Spectrum.** 64 waves from 300 m to 0.5 m with seeded jittered wavelengths and directions (`buildWaterLodSpikeWaveTable`, seed 80). A spec compares the autocorrelation of the slope field at large lags against the old evenly spread table (the control): the new spectrum's rms must be below 0.6 times the control's for all waves and for waves of 20 m and longer.

**Shading.** Each wave fades from the shading by its pixel footprint (weight 1 down to about 3 px per wavelength, 0 at about 1.4) and from the vertex heights by mesh spacing (1 at 8 cells per wavelength, 0 at 4). The slope variance that the fades remove is kept: the colour is the shading averaged over a Gaussian slope distribution (5 x 5 Gauss-Hermite rule, spread by the lost covariance), each sample clamped to the displayable range, weighted by visible area. Two calibration constants were fitted against the supersampled reference: visibility exponent 0.4 and lost-covariance scale 0.8. Specular anti-aliasing from screen derivatives was tried and removed: no measured benefit.

**Suite `water-lod-spike-aliasing` v1 (GPU readback).** Three held views (grazing 12 m, elevated 80 m, high 600 m), time frozen at 12.5 s. The reference is the unfiltered surface supersampled with 32 Halton-jittered frames per view, averaged in linear light (averaging the encoded bytes made the reference too dark; the first runs were wrong for that reason). Arms: filtered, transfer off (colour-step control), filter off (aliasing control). Gates:
- Q2 colour step: the band-mean error against the reference changes by at most 2/255 between neighbouring bands (32 bands).
- Colour match: at most 6/255 from the reference in any of 8 bands.
- Q3 shimmer: the change of the error against the reference between views half a pixel apart is at most 0.5 times the control's, or 2.5/255 when the control barely aliases.
- Moire: RMS of 8 x 8 block errors after removing each block row's mean, at most 2 times the control's.
- The water must be drawn (reference mean above 20/255) and at least 100 rows below the horizon.

**Gate history, stated plainly.** The gates were written before the first run, but the first definitions measured the wrong things and were changed after seeing data, by the agent and not on the owner's instruction: (1) shimmer compared raw frames half a pixel apart, which counts resolved waves moving with the shift as flicker; it now uses the change of the error against the reference. (2) Moire compared 8 x 8 block means with the reference, so a smooth colour bias counted as structure; it now removes each block row's mean error, and the threshold is relative to the control. (3) Colour step compared band means with the reference, which is a bias, not a step; it now uses the change between neighbouring bands, and the bias has its own 6/255 gate. (4) Shimmer got an absolute floor of 2.5/255 because the grazing control hardly aliases. The owner has not confirmed these thresholds; Q2 and Q3 in the plan stay proposals.

**Results, headless hardware profile (NVIDIA, noisy GPU, 2026-11-02 01:18 UTC; not a clean hardware number).** All checks pass in all three views (`auto=pass`).

| View | shimmer filtered / control | moire filtered / control | step filtered / transfer off / control | colour error filtered |
| --- | --- | --- | --- | --- |
| grazing 12 m | 2.4 / 3.9 | 1.3 / 1.0 | 0.8 / 0.8 / 0.2 | 0.5 |
| elevated 80 m | 6.1 / 12.7 | 2.9 / 2.0 | 1.1 / 3.6 / 0.2 | 2.1 |
| high 600 m | 8.4 / 26.1 | 5.6 / 3.8 | 1.7 / 4.5 / 0.4 | 3.8 |

Before the calibration the same suite failed every view (colour error 7.5 to 21.3, moire 3 to 5 times the control). The filter-off control matches the reference to 0.2/255, which validates the reference. The transfer-off control exceeds the step gate in two of three views, so the step metric is shown to detect a missing transfer there; at grazing 12 m it does not (0.8), so the step gate says nothing about the transfer in that view.

**Cost.** Suite `water-lod-spike-performance` v2, grazing view, headless hardware: GPU frame 1.7 ms (WebGPU timestamp queries, 1 s averages), frame interval 6.1 ms (pinned by vsync), 3264 draw calls, 1.2 million triangles. The window size of the headless run was not recorded, and the water is the only thing drawn, so this is an upper bound for the water pass, not the Q1 number (water pass p95 at 2560 x 1440). Q1 is still open. The adapter was not independently verified.

**Not done.** Q4 (the owner's eye on regional look), Q5 (anchor-relative phase on a 600 km sphere) and Q6 (direction rings on the 10 km sphere) are not built. The suite measures three static views with the filter on and off; a moving camera, the 50 km edge of the plane and sphere curvature are not covered. The owner should look at the water; the numbers say the filtered image is close to the supersampled one, not that it looks good.

**Checks run.** `ng test demo-app` for `water-lod-spike` specs: 25 passed. Suites `water-lod-spike-aliasing` v1 and `water-lod-spike-performance` v2 run through `npm run test:run` with `--profile headless-hardware --noisy`.

### 2026-11-02 (later): cost pass on the water shader

**Trigger.** The owner looked at the water in a visible browser (NVIDIA, 2560 x 1308): the look is right, the cost leaves little headroom.

**Measuring.** `water-lod-spike-performance` v3 renders the grazing view at 0.5, 1 and 2 times the pixel ratio and records CPU frame time as well as GPU time, so the cost splits into a fixed part and a part per pixel. Switching the colour to a constant gave 0.4 ms at every size: vertices, 1.2 million triangles and submission are cheap. A quadrature-only arm (no wave loop) added about 0.6 ms at 2x. The 64-wave loop in the fragment shader was the rest, about 70 % of the frame. CPU frame time is 0.5 to 0.7 ms: draw calls are not the cost.

**Changes.** (1) Waves whose footprint has passed the fade are skipped in the fragment and vertex stages (a branch, coherent between neighbours); the lost covariance is the total minus the share of the waves still kept, so a skipped wave costs one test. (2) Resolved waves (weight 1) skip the fade arithmetic. (3) Fresnel by multiplication instead of a power. (4) One shading sample where the lost variance is negligible. (5) The quadrature is 3 x 3 instead of 5 x 5.

**Result, GPU frame in ms on the headless NVIDIA run (noisy and throttled; one run each, differences under 0.2 ms are noise):**

| Pixels | Before | After |
| --- | --- | --- |
| 0.25x (0.5 ratio) | 0.8 | 0.7 |
| 1x (2527 x 1077) | 1.7 | 1.3 |
| 4x (2 ratio) | 5.5 | 3.2 |

The aliasing suite gives the same numbers as before (shimmer 2.4 / 6.1 / 8.5, worst colour error 0.5 / 2.0 / 3.6 of 255) and passes. Items 1 and 2 are exact (the image is unchanged); item 5 changes the image slightly and measured no worse.

**Not done, and what is left.** The fragment wave loop is still most of the frame: about 0.9 ms of 1.3 at 1x, and a GPU several times slower scales it. Fewer waves (64 to about 40) or a texture-based normal field would cut it further, and either changes the look the owner approved, so neither was done. The window size, the adapter and the power profile of the owner's runs are recorded only partly. The draw-call count in `water-lod-spike-performance` v3 differs between the three cases (3200 to 8200), so it probably accumulates; not investigated. Q1 (water pass p95 at 2560 x 1440 on a verified adapter) is still not measured.

### 2026-11-02 (later still): quality tiers, and why close water looks cheap

**Trigger.** The owner compared two views in a visible browser: looking at a small patch of water from above, the GPU frame reads 0.2 ms; grazing to the horizon it reads 2.0 ms. The owner asked for a quality setting to see look and cost together, and for a status of the plan.

**Why the two views differ.** The cost is per water pixel plus the mesh. The close view covers a small part of the screen. Water filling the screen from 12 m up (56 degrees down, `down-*` cases) costs more than the grazing view, not less: every pixel is near water with all 64 waves resolved, so the fragment wave loop cannot skip any. In the same 3-repetition run on the Ultra tier: grazing 1.6 ms, looking down 1.8 ms. The worst case for the water is full-screen near water, not the horizon.

**Correction to the earlier entries.** The draw-call counts recorded above (3264, 3200 to 8200) were `renderer.info.render.calls`, which WebGPU counts cumulatively; the FPS panel already reads `drawCalls` for that reason. The spike now reads `drawCalls` too: the water is 2 draw calls per frame in every case. The earlier statement that "the draw calls are not the cost" stands, for the right reason (2 calls, CPU frame 0.5 ms). The "not investigated" item is closed.

**Quality tiers.** Page slider and test setting `quality`: Ultra, High, Medium, Low. A tier sets the shading filter bias `lodBias` (multiplies every wave's footprint, so waves fade out sooner), the vertex filter's cell size and the mesh `leafCap` (the 100 km plane reaches the default 4096-leaf cap in every test view, so the leaf cap, not `cellPixels`, sets the triangle count: 1.21 M triangles at grazing in Ultra).

| Tier | footprint bias | cell px | leaf cap | grazing GPU / triangles | looking-down GPU / triangles |
| --- | --- | --- | --- | --- | --- |
| Ultra | 1 | 4 | 4096 | 2.3 ms / 1.21 M | 4.4 ms / 0.88 M |
| High | 2 | 6 | 1024 | 2.1 ms / 0.34 M | 2.7 ms / 0.27 M |
| Medium | 3 | 8 | 512 | 1.4 ms / 0.16 M | 3.1 ms / 0.12 M |
| Low | 4 | 10 | 256 | 1.1 ms / 0.10 M | 1.8 ms / 0.05 M |

The owner found the first tier set (bias 1, 1.25, 1.5, 2; leaf cap 4096, 3072, 2048, 1024) too close together, so the old Low became High and Medium and Low were extended. Median GPU frame, suite `water-lod-spike-performance` v4, 3 repetitions of 6 s, headless NVIDIA at 2527 x 1077. **These runs were made with another application holding the GPU at 99 to 100 %**: Ultra read 2.3 and 4.4 ms against 1.6 and 1.8 ms on a quieter GPU earlier, so the absolute values are inflated and the order between neighbouring tiers (Medium looking down 3.1 ms against High 2.7 ms) is noise. The triangle counts are exact. CPU frame 0.5 ms in every case. Not Q1 (not at 2560 x 1440, adapter unverified); to be rerun on a quiet GPU.

**Look, from `water-lod-spike-aliasing` v2** (same measures as v1, against the Ultra supersampled reference, in luma/255; per view grazing - elevated - high (600 m); shimmer and moire are given with their control in v1, so only the order is meant):

| Tier | colour error | colour step | moire | shimmer (grazing) | note |
| --- | --- | --- | --- | --- | --- |
| Ultra | 0.5, 2.0, 3.6 | 0.8, 1.1, 1.8 | 1.3, 2.8, 5.4 | 2.4 | passes every gate |
| High | 1.7, 3.3, 3.8 | 1.1, 1.2, 2.2 | 2.2, 4.7, 6.6 | 4.3 | step gate (2) crossed at 600 m by 0.2; moire and shimmer gates crossed |
| Medium | 2.0, 3.4, 4.9 | 0.9, 2.1, 2.7 | 3.6, 5.7, 7.4 | 5.4 | step crossed at elevated and 600 m |
| Low | 2.6, 3.8, 5.7 | 1.6, 1.8, 3.1 | 4.8, 6.8, 8.1 | 5.9 | colour error 5.7 against the 6 limit at 600 m; step 3.1 |

Colour stays within the 6/255 gate in every tier and view, but Low is 0.3 from it at 600 m, so the 600 m view is where the tiers break first. The shimmer metric compares the filtered frame's error against the reference between half-pixel-shifted views, so detail the reference has and a blurrier tier lacks counts as shimmer: it rises with blur, by construction. **Gate change, after seeing data and not on the owner's instruction:** only Ultra carries the gates in v2 (`gated`); the other tiers report their metrics without gates. The owner looked at the tiers in the page and said they look good; the gating policy is still to be confirmed.

**Tried and removed: a cap on the number of waves.** Dropping the shortest waves outright (48, 40 and 20 waves, their slope variance left in the glint spread) was built and measured first. It saved little at 48 waves (no measurable gain), and at 48, 40 and 20 waves it put a colour step of 2.6 to 11 /255 and moiré 9 to 36 /255 (control 1 to 2) into the grazing and elevated views, plus a colour error of 6 to 22. Where those waves are still resolved the 3 x 3 quadrature does not reproduce their mean colour. The cap is not in the code. The wave loop is therefore untouched, and the full-screen near case (looking down, 1.2 to 1.8 ms) has no safe knob left except fewer leaves, which does not help its fragment cost.

**Not done.** Q1, Q4 (the owner's eye on the tiers), Q5, Q6; a moving camera; the 50 km edge; the sphere and cylinder. Mesh tiers were not looked at on screen: the vertex filter assumes `cellPixels` cells, and a leaf cap that bites makes real cells larger, so a vertex-height difference of centimetres is possible. The aliasing suite shows no step from it, but it is a silhouette effect that the readback metrics barely see. Runs of `water-lod-spike-performance` v4 and `-aliasing` v2 before 19:37 UTC used earlier tier definitions (wave caps, then the 1/1.25/1.5/2 bias set) and are superseded by the runs at 19:37 and 19:38.

**Short-window rerun (same day, 19:55 UTC).** `water-lod-spike-performance` v5 is v4 with 1 s warmup and 3 s windows; two repetitions take 1 min 21 s including start-up (v4 with three took about 3.5 min). GPU load was 55% instead of 93%, but the adapter was still not recorded and the profile is unverified, so these are diagnostics, not Q1 evidence. Median GPU ms, grazing / looking down: Ultra 1.6 / 1.9, High 1.2 / 1.4, Medium 0.8 / 1.2, Low 0.8 / 0.9. Triangles are as in v4. The tiers now order monotonically in both views; the earlier Medium-over-High inversion looking down was load noise. The GPU timer reads in 0.1 ms steps, so the Medium and Low grazing figures are indistinguishable. Use v4 when a gate needs timing evidence.

**Gating decision (same day, 20:11 UTC).** The owner delegated the call on which tiers carry pass/fail limits ("proceed as you see fit"). Aliasing v3 gates `ultra` on all four limits (shimmer, moiré, colour step, colour error) and `high` on colour error only (at most 6/255 in every band). `medium` and `low` report their numbers without limits and are judged by eye. Reason: the lower tiers are blurrier on purpose, and the shimmer and moiré numbers rise with blur by construction (High: shimmer 4.3 against 2.5, moiré 2.2 against 1.8, 600 m step 2.2 against 2.0), so those limits cannot hold a tier that is meant to be coarser. Colour error still catches a real regression such as a shader change. v3 run, headless-hardware, noisy: `auto=pass`, the same numbers as v2. The adapter was not recorded, so none of this is Q1 evidence. A spec found that the adapter reduced the setting to a boolean before `measureAliasing`; it now passes the setting through.

## Scope history

<!-- tri:scope-history -->
<!-- tri:scope-baseline state="unconfirmed" -->
<!-- /tri:scope-baseline -->
<!-- /tri:scope-history -->
