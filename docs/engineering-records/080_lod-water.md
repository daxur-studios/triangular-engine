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

**Shoreline and land under water (noted 2026-11-01, not in W0b).** W0b draws a flat plane with no ground under it, so its numbers do not include land. The land case is covered by plan w2 (terrain-aware culling and depth from `groundAt`), not by the W0b spike. Its cost (full-density water under land) stays unmeasured until w2. *Update 2026-11-02 (night): a spike measured it, see "w2 spike, water under land" in History; the cull itself is still w2's.*

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

### 2026-11-02 (evening): Q5, wave phase precision on a 600 km sphere

**Question (plan Q5).** On a 600 km sphere with the eye 2 m up, does an anchor-relative wave phase stay within 1e-3 rad of a double-precision reference, and does the naive path (global position, as the flat spike's `heightNode` has it) fail as the control?

**Method.** Suite `water-lod-spike-precision` v1, written before its first run. Sixty-four plane waves (the spike's table, wavelengths, phases and speeds) with fixed 3D unit directions spread over the whole sphere (a spherical Fibonacci set, so some waves point along every axis). Seventy-two points on the water in rings of 1 m, 2 m, 5 m, 10 m, 30 m, 100 m, 300 m, 1 km and the 1.55 km horizon around an anchor that is not on an axis. A WGSL compute kernel (three TSL, float32) evaluates both paths and the page reads the results back; the CPU compares them with doubles. At wave times 0 and 3600 s.
- naive: `dot(global, d) * k + phase - time * omega`, the global position rounded to float32.
- anchor-relative: `dot(relative, d) * k + offset`, the relative position rounded to float32, the offset `(k (anchor . d) + phase - omega t) mod 2 pi` computed in doubles on the CPU and sent again whenever the time changes.

A wave is judged only within its range, the distance past which the vertex filter has dropped it (ultra tier, 4K: wavelength / (4 x 4 px x 5e-4)), which leaves 4144 wave and point pairs. A float32 emulation of the same two formulas runs on the CPU beside the readback and agrees with it (naive 0.74 against 0.79 rad, 0.94 against 0.99 rad), so the pure maths and the GPU tell the same story.

**Result, headless NVIDIA (`gpuVendor` nvidia, WebGPU), `auto=pass`:**

| Wave time | anchor-relative, max | naive (control), max |
| --- | --- | --- |
| 0 s | 8.1e-5 rad | 0.79 rad |
| 3600 s | 6.6e-5 rad | 0.99 rad |

The anchor path is about 12 times inside the 1e-3 limit; its worst pair is a 9.5 m wave at 1 km. The naive path is wrong by most of a radian, worst for the 0.64 m wave at 5 m, so the control fails as intended and the check can tell the paths apart. The sine of the wrapped anchor phase on the GPU is within 0.0005 of the double value (reported, not gated).

**What this does and does not show.**
- The phase formula and its CPU-side folding of the anchor, the wave time and the initial phase are sound. The offset must include the wave time: the same error grows with `omega t` on the naive path, so W1 recomputes the 64 offsets per frame in doubles (a few hundred flops).
- Position error is not measured here. The kernel is given the float32 position relative to the anchor, as a vertex buffer built relative to the anchor would have it. How the lod-surface vertex stage arrives at that position in float32 is measured by the morph spike's probe, not by this check.
- The error of the anchor path grows with the distance from the anchor (the float32 spacing of the relative position), so W1 needs a re-anchor rule. At 4K and the ultra tier the farthest a wave is evaluated is 785 radians of phase from the anchor for every wave, which is what keeps the margin. The re-anchor distance is not set by this spike.
- The adapter was recorded (nvidia) but the load was noisy (GPU 36 to 58%, CPU 68 to 87%); this is a correctness result, not timing, so the load does not matter.
- Q5 is closed for the spike. It gates nothing in the page; it is the evidence for the anchor-relative design in W1.

### 2026-11-02 (night): w2 spike, water under land

**Trigger.** The owner's goal: do not render complex water under terrain. Plan w2 owns the real implementation (a cull hook in lod-surface, which needs W1's source hook first), so this entry is the spike that sizes the problem and tests the cull rule. No library file was edited.

**What was built (spike only).** `core/water-lod-spike-land.ts`: a fixed set of eight Gaussian islands over a seabed at -30 m (CPU twin and TSL nodes, drawn by a second `<flatTerrain>` behind a **Land** button on the page, off by default); `landLowerBoundM` (a lower bound of the land over a square, exact for this field because each island falls off with distance, so the minimum is at the farthest corner); `isDrySquare` (a water leaf is dry when that bound is above the water ceiling); `measureLeaves` (runs the test over the drawn leaves of the page's own water selector and checks every call against 81 sample points of the leaf). The ceiling is the water body's global height bound as the selector holds it (waves plus the default detail-noise bound; with the default 0.04 share on a 100 km plane the noise bound is a few metres, so it dominates). Land is drawn first (render order -1) so its depth can reject water early; the land body has detail noise off so its smooth lower bound stays exact.

**Suite `water-lod-spike-land` v1** (gates written before the first run). Five views, each with the land off and on. Gates: the conservative test calls no wet leaf dry; in shore views the centre-only control (judge a leaf by the land under its centre) does call wet leaves dry, so the check can tell a safe test from an unsafe one; open sea has no dry leaf. Reported, not gated: dry share, GPU and CPU frame time, triangles. Headless specs: 62 of 62 pass for the spike (7 new for the page adapter, 7 for the land maths, including 400 random squares against the true minimum and 600 against dense sampling).

**Result** (headless hardware, NVIDIA, 2527 x 1077, noisy load, one run; `auto=pass`, all 10 cases, 0 failed checks; GPU in ms from 1 s averages, differences under 0.2 ms are noise; the adapter was not independently verified, so this is not Q1):

| View | drawn water leaves | under land (conservative) | share | control's wrong calls | GPU water only | GPU with land in front |
| --- | --- | --- | --- | --- | --- | --- |
| coast, 200 m | 1160 | 212 | 18 % | 42 | 1.4 | 0.7 |
| coast, grazing 2 m | 2412 | 75 | 3 % | 30 | 1.6 | 1.5 |
| looking down from 800 m at an island | 258 | 195 | 76 % | 15 | 1.6 | 0.3 |
| islands from 5 km | 1199 | 79 | 7 % | 38 | 2.1 | 1.7 |
| open sea, 200 m (control) | 898 | 0 | 0 % | 0 | 1.5 | 1.4 |

The leaf cap (4096) was hit in every view.

**What it shows.**
- The conservative rule is safe on the page's own selections: 0 wet leaves called dry in 5 views, against 15 to 42 wrong calls by the centre-only control. In the headless selections of the same views it finds 67 to 85 % of the leaves the control calls dry (the rest are shore leaves it cannot prove dry).
- How much water sits under land depends on the view: 3 % to 76 % of the drawn leaves. The cull matters most for a high view onto an island and least for a grazing view.
- **The fragment cost of water under land is already mostly free when the land is drawn first.** The GPU frame fell where land hides water (1.4 to 0.7 ms at the coast, 1.6 to 0.3 ms looking down), although the land adds triangles, because the depth test rejects the water fragments before the 64-wave loop, and that loop is about 70 % of the water cost (ER, cost pass). So a cull is not needed to save fragment time; this holds only while the land is opaque and draws first. A planet scene must keep that order, or water behind land costs full price.
- What the cull would still save is the water mesh work under land (vertices and triangles, about 0.4 ms of the water in the earlier cost split, scaled by the dry share) and, more important, **leaf budget**: all views were at the 4096 cap, so a share of the cap is spent on invisible leaves. The saving shows up as finer water where it is seen, not as milliseconds. That gain was **not measured**: it needs the cull to act inside the selection, which needs the library hook, and the page cannot do it.

**Not done.**
- The cull itself (a selector hook that skips or does not refine dry nodes) and its effect on visible mesh density. The library's `NodeGeometryHook` could carry it, but it replaces the node geometry rather than adding to it, so the right form is probably a small predicate on the selector; W2 decides.
- Real terrain: the islands are analytic Gaussians. The library version would test against the terrain's per-node min and max pyramid (`nodeRange`), which is a different bound and needs its own spec. The spike's bound is exact only because the field is monotone per island.
- Moving cameras (the selection changes with the view and the cull test runs per node per frame: its cost is unmeasured), a land edge at the plane border, water deeper than the seabed, and the sphere.
- A visual check of the shoreline: the land body uses the debug material, and no one has looked at the join. Timings are one noisy run on an unverified adapter.

### 2026-11-02 (late night): w2, the selector cover hook

**Trigger.** The owner chose to build the real hook after the spike. Library edit, first of Plan 080's: `NodeCoverHook` on `LodSelector` (`setCoverHook`, `cover`, `invalidateCover`) and `LodTerrainBody.setCoverHook` / `invalidateCover` (kept across `configure`, like the geometry hook). A covered leaf is not drawn and asks for no split; the 2:1 balance can still split it. The answer is asked once per node and remembered (cover generation, reset when the node's geometry is measured again), so it must not depend on the camera. `SelectorStats.covered` counts covered leaves in the frustum; `stats.drawn` excludes them. Without a hook the selection is unchanged bit for bit (a spec compares the trees). A predicate on the selector, not the geometry hook, because the geometry hook replaces a node's geometry; the cover only adds a yes or no. CHANGELOG and `lod-surface/README.md` are updated; `SelectorStats` gained a required field, so the one page that builds it by hand (the lod-surface lab) needed `covered: 0`.

**Spike side.** `createLandCoverHook` (the conservative land test with a 3 m margin for the land mesh's sag between vertices), a **Cull under land** button (needs Land), and suite `water-lod-spike-cull` v1, written before the first run. Gates: no selected leaf, drawn or not, is called dry while a dense sample of it holds water (audit over every selected leaf); with the hook on, no drawn leaf lies entirely under land in the shore views and the hook covers some; open sea covers none; hook off covers none. Reported: leaves covered, drawn, `unmet`, deepest level, mean edge of the drawn leaves that hold water, GPU and CPU time.

**Tests.** 17 selector specs (7 new: no-op hook identical, covered leaves undrawn and counted, a binding cap's budget goes to the visible side, removal restores the tree when the cap does not bind, asked once per node and again after `invalidateCover`, reselect on an unchanged view after `invalidateCover`, the 2:1 tree stays legal) and 75 of 75 in the demo app's water specs (5 new for the hook on the real selector, 8 for the page adapter). Not mine and not caused by this change: the full lod-surface run also failed 3 morph specs (sweep bench packFrames, settle share) and then lost the browser connection at 227 of 375; those paths install no cover hook, and other uncommitted edits to `lod-surface-mesh.ts` are in the tree.

**Result** (headless hardware, NVIDIA, noisy load, one run; `auto=pass`, all 10 cases, 0 failed checks; adapter not independently verified, so not Q1):

| View | drawn, no hook | drawn, hook | leaves hidden | unmet, no hook | unmet, hook | mean wet edge m (off / on) | GPU ms (off / on) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| coast, 200 m | 1160 | 1011 | 115 | 4096 | 3934 | 1052 / 1023 | 0.8 / 0.8 |
| coast, grazing 2 m | 2415 | 2379 | 42 | 3784 | 3712 | 342 / 339 | 1.9 / 1.6 |
| looking down, 800 m | 258 | 68 | 85 | 4086 | 3836 | 98 / 98 | 0.3 / 0.3 |
| islands, 5 km | 1196 | 1138 | 36 | 2516 | 2423 | 1443 / 1431 | 2.0 / 1.9 |
| open sea (control) | 898 | 898 | 0 | 4096 | 4092 | 499 / 499 | 1.4 / 1.4 |

**What it shows.**
- The hook is safe and complete here: 0 wrong calls over every selected leaf, no dry leaf drawn once it is on, nothing covered over open sea. (Without it, 66 to 192 drawn leaves per shore view are entirely under land.)
- **The visible water did not get finer.** The mean edge of the drawn wet leaves moved by 0 to 3 %, and the deepest level did not change. `unmet` fell by 70 to 250 of about 4000. The reason is in the selection: it does not depend on the heading, so the cap is spread over the whole 360 degrees and the hundred-odd leaves a view frees go to nodes behind the camera as much as in front. The 3 to 76 % dry share was a share of the drawn leaves, not of the selected tree.
- What it does save is draw work: the triangles fell 0.6 to 6 % (down-looking 6 %), and GPU time fell a little at the grazing coast (1.9 to 1.6 ms) and is otherwise inside the noise. That is small next to the land-first early-z result of the spike.
- **Cost under a moving camera** (headless spec, 600 selections sweeping 7 km of coast): median 1.1 to 1.4 ms, p95 1.6 to 2.1 ms, max 6.7 to 14.8 ms with the hook (about 69 leaves covered). The plan's selection budget is 0.2 ms for water, so the hook's test is not free: eight islands cost eight exponentials per node asked.

**Reading.** The mechanism works and is safe, but at these budgets it buys little. Where it could buy more: (1) with `cullInSelection` on, the freed budget stays in the frustum (the legacy option the library keeps for this); (2) a cheaper test (a tiled min-height pyramid of the real terrain instead of summed Gaussians) is also the form the real terrain needs; (3) a lower cap with the hook against a higher cap without it. None of these is measured yet.

**Not done.** The three options above; real terrain (`nodeRange`); the sphere (a leaf on a sphere is not an axis-aligned square); moving-camera visual check for holes at the shore (the geometry audit is the safety evidence, no one has looked); the hook inside `<flatWater>`/`<planetWater>`, which do not exist yet.

### 2026-11-02 (shoreline review): water depth as the one shore mechanism

**Trigger.** The owner tried w2 with Land on and was uneasy: the land is an inner area, so water and land overlap a lot, and wave crests appear as crescents above the land as the water animates. The goals behind it: a very clear waterline, water visibly meeting the surface (crashing, foam), river-to-ocean meeting points, and no high-resolution water under terrain at the shore. The architect (a read-only review; its notes are outside the repository) was asked whether culling is the right main strategy, what causes the crescents, what to test first, and whether the sphere and cylinder change anything.

**The review's answer.** One mechanism: the water shader reads the water depth `D = sea level - terrain height` at each vertex and pixel.
- Waterline: scale each wave's height by `w(D) = smoothstep(0, ramp, D)`. The water is flat where it meets land, so the waterline is exactly where the terrain crosses the sea level, and the depth test draws it sharply. No crest can stand above land.
- Foam and shore break: a foam band where `D` is small, breaker lines along the direction in which `D` changes; no baked distance-to-coast field.
- River mouths: rivers are separate ribbons; the same weight and a mask fade the ocean waves into the flow.
- Water under land: the land drawn first already rejects the water fragments (the spike above). A coast needs less water mesh, not more, once the waves fade there. Stop investing in culling; keep the hook and the compile queue.
- Sphere and cylinder: `D` along the local up works on every domain. Water and terrain cells share quadtree addresses, so a water cell can read the terrain's own per-cell heights: no global coast map (it has seams on a cube-sphere), and a cheap cover test too.
- Experiments, in order: (1) water detail noise off; (2) wave amplitude zero; (3) `w(D)` with a gate written first; (4) foam and depth colour from `D`; (5) per-cell terrain heights for the water, and what reading them costs; (6) only then more culling.

**What was built (spike only, no library file).** `core/water-lod-spike-land.ts`: `waterDepthM`, `shoreWeight` (the smoothstep), `auditShore` (the gate) and `landHeightNode` (the TSL twin the weight reads). `core/water-lod-spike-waves.ts`: uniforms `shore` and `shoreRampM` (12 m), `shoreWeightNode` and `shoreWeightAt`; the weight scales the vertex height (CPU twin included, so parity holds), the vertex gradient, and the shading slope in the material (the lost variance keeps the glint width). Page: **Water noise** and **Shore weight** buttons (the weight acts only with Land on). The water body used to carry the terrain's default detail noise (0.04 of a 98 m texel, about 4 m) without anyone asking; the page now defaults it off, so earlier suite numbers (aliasing, performance, land, cull) were taken with it on.

**Suite `water-lod-spike-shore` v1** (gates written before the first run; CPU only). A 5 km grid around the islands at 25 m; at every dry point (land above the sea level) the water surface the body would draw (waves at four times, detail noise when on) is compared with the land. Gates: with the weight off the water stands above the land somewhere (so the gate can see a crescent); noise off and weight on: no dry point has water more than 5 cm above the land. Reported: dry points, violations, largest and mean excess. Specs: 84 of 84 in the demo app's water specs (new: weight, audit, and the shore case of the page adapter).

**Result** (CPU gate, 18,420 dry points, the page in headless Chrome on the NVIDIA adapter, one run):

| detail noise | depth weight | dry points with water above land | largest height over land |
| --- | --- | --- | --- |
| on | off | 625 | 11.8 m |
| off | off | 565 | 11.5 m |
| on | on | 276 | 5.6 m |
| off | on | 0 | 0 m |

**What it shows.**
- **The crescents are the waves, not the noise.** Noise off alone barely moves the count (625 to 565, 11.8 to 11.5 m): the waves' own crests stand up to about 11 m above beach land. The review's first suspect (the noise) is a small part.
- With the weight on and the noise off the gate is clean: 0 points. With the noise on the weight still leaves 276 points up to 5.6 m, because the body's noise is added after the weight and is not scaled by it. The water should carry no terrain noise.
- Experiment 2 (flat vertices, shading kept) at a shoreline view: no slivers. So the land and water meshes crossing between vertices is not the cause in that view; the crests are.
- Pictures (frozen wave time 12.5 s, 12 to 50 m above a shore, headless): with the weight off a crest bulges into the land at the waterline; with the weight on the waterline is a clean line. Only I looked, on a headless run; the owner's eye on the real GPU is the check.

**Not done.**
- Foam and depth colour from `D`, breaker lines, and the river-mouth mask (experiment 4 and beyond).
- Cost of the weight: it evaluates the land height per vertex and per pixel (eight exponentials here, from the analytic islands). Not measured; the library form reads the terrain's per-cell heights (experiment 5), which is a different cost.
- The ramp (12 m) is untuned, and the weight's second-order term in the shading slope (the weight's own gradient) is dropped.
- Moving camera at the shore, the sphere, and real terrain.
- The earlier suites were not re-run with the noise off.

### 2026-11-02 (shoreline review, experiment 4): foam and depth colour from `D`

**What was built (spike only).** Both read the same water depth `D` the shore weight reads, per pixel, so they follow the waterline wherever the land crosses the sea level and need no coast map.
- Foam (`shoreFoam`, `core/water-lod-spike-land.ts`): a band at the waterline (full at `D = 0`, gone at 3 m) and breaker lines, which are stripes of constant `D` (6 m apart) that travel towards the shore at 2 m/s of depth and fade out by `D = 20 m`. Laid over the shaded colour (colour `#eef6fa`, strength 0.9 at the waterline, 0.72 on a breaker).
- Depth colour (`shoreDeepness`): the water's colour goes from a shallow turquoise to the deep colour as `1 - exp(-D / 8 m)`.
- `core/water-lod-spike-waves.ts`: uniforms `foam`, `depthColour` and the scales; `shoreLookNode` (one land-height read per pixel for both, 0 foam and deepness 1 when both are off) and its CPU twin `shoreLookAt`. Material: the deep colour is a mix by deepness, the foam mixes over the result. Page: **Foam** and **Depth colour** buttons (on by default, acting only with Land on). The scales are sized to the spike's 30 m seabed (no water is deeper than 30 m here); a planet's oceans size them from the sea's depth range.

**Suite `water-lod-spike-shore-look` v1** (gates written before the first run). CPU, over the 5 km audit grid: no gap in the waterline foam (every water point within half the edge width has foam of at least a half), no foam deeper than the breaker zone, and the water at the waterline lighter than the deep water by at least 0.3. GPU, on a coast view (frames read back at the same wave time): foam alone raises the frame's mean luminance by at least one level of 255, depth colour alone changes it by at least a quarter of a level. Specs: 94 of 94 in the demo app's water specs.

**Result** (headless Chrome on the NVIDIA adapter, one run, auto=pass): 21,981 water points, 672 at the waterline with no gap, no foam in deep water; deepness 0.12 at the waterline against 0.95 in deep water; mean luminance 79.0 with neither, 88.3 with foam, 84.6 with depth colour.

**What it shows and what it does not.**
- The first GPU gate counted bright pixels and was wrong: foam also covers the glint's own bright pixels, so the bright share went down (0.147 % to 0.128 %) while the mean luminance went up by 9. The gate now uses the mean; the bright share is reported only.
- The first screenshots showed no change at all (identical frames to the last digit) although the uniforms reached the page. After a rebuild the same code showed the foam. I did not find why; the likely cause is that a build mid-edit was served. Frames from the page, not only uniforms, are what the GPU gate reads.
- Pictures (headless, frozen wave time, 50 m above the shore, 500 m back): a foam line along the waterline, breaker stripes parallel to the shore, turquoise shallows. Only I looked; the look is untuned (stripe spacing, speed, strength, colours).
- The breaker stripes move with time in the shader and in the CPU twin, but the movement has no gate beyond a spec on the pure function (the pattern at `D + s*t` at time 0 is at `D` at time `t`).

**Not done.** River-mouth mask; breaker lines that bend with the wave direction (they are contours of `D` only); foam from the wave's own crest (whitecaps); cost of the per-pixel land read (it is the same eight exponentials as the weight, now shared by foam and colour but still computed twice, once for the weight and once for the look: `shoreLookNode` and `shoreWeightNode` each read the land); experiment 5 (per-cell terrain heights) and the sphere.

### 2026-11-02 (shoreline review, experiment 5): the water reads the terrain's baked height texture

**What the terrain actually gives the water.** The review's plan said "water and terrain cells share quadtree addresses, so a water cell can read the terrain's own per-cell heights". The library has no per-cell height tiles. A baked terrain is one height texture per face (the plane has one layer; `TextureHeightSource`, `lod-height-texture.ts`), `2^k + 1` texels a side, read by lattice point with a float32 bilinear blend. So the experiment reads that texture by world position instead; no quadtree address is involved.

**What was built (spike only, no library file).**
- `core/water-lod-spike-land.ts`: `bakeWaterLodSpikeLand` bakes the islands with the library's `bakeHeights` on a plane layout and wraps them with `createTextureHeightSource`; `bakedLandHeightNode` turns a plane position into a lattice coordinate (`u = +X`, `v = -Z`, clamped) and calls the source's own `lattice.heightNode`, so the water uses the library's read, not a copy; `bakedLandHeightM` is the CPU twin; `auditTerrainRead` is the correctness gate.
- `core/water-lod-spike-waves.ts`: `useBakedLand`, the `landBaked` uniform and `landReadNode`, which `shoreWeightNode` and `shoreLookNode` now call (weight, foam and colour all read the one switchable depth); `waterDepthReadM` is the CPU twin that the twins of the weight and the look use.
- Page: **Baked terrain** button (off by default). It switches the water's depth read and the land body's heights to the baked texture together, so what is drawn and what the water reads are the same texels. The bake is made at page start (k = 11: 2,049 texels a side, 48.8 m per texel over the 100 km plane, 16.8 MB, about 1.1 s of CPU).

**Suite `water-lod-spike-terrain-read`** (gates written before the first run). v1: CPU, over the 5 km audit grid, the baked depth is within 0.25 m of the analytic depth and no point more than 1 m from the waterline flips between wet and dry; with the baked read, noise off and the weight on, no dry point of the baked land has water above it; GPU, on the coast view the baked frame differs from the analytic frame by under 1.5 levels of mean luminance and under 0.5 % of pixels differ by over 24 levels; the baked read costs at most 25 % more GPU time. v2 is the same at three times the pixel ratio (see below). Specs: 104 of 104 in the demo app's water specs, including a coarse-bake control (780 m texels fail the 0.25 m gate).

**Result** (headless Chrome on the NVIDIA adapter, one run each; the GPU was busy and throttled in v2, which is reported, not a rejection):
- Correctness, both runs: largest depth error 0.24 m (mean 0.01 m), 5 wet or dry flips of 40,401 points, none more than 1 m from the waterline, 0 crescent points with the baked read, mean luminance difference 0.55 (v1) and 0.60 (v2) levels, no pixel over 24 levels. auto=pass.
- Cost, v1: both reads gave exactly 1.00 ms. The coast view takes about 1 ms of GPU time and the timestamp queries step in 0.1 ms, so v1 could not resolve the cost.
- Cost, v2 (3x pixel ratio): 6.57 ms analytic, 6.63 ms baked, ratio 1.02. Four texel loads and a bilinear blend per pixel cost about the same as the eight exponentials, within the timer's noise.
- The earlier `water-lod-spike-shore` v1 and `water-lod-spike-shore-look` v1 suites, re-run after the switch went in, give the same numbers as before (625 / 565 / 276 / 0 violations; 672 waterline points, no gap, mean luminance 79.0 / 88.3 / 84.6).

**What it shows and what it does not.**
- The water can take its depth from the terrain's own texture with no change to the shore weight, foam or colour, at no measurable cost here. That is the part of the review's plan that held.
- The margin on the depth gate is thin: 0.24 m against 0.25 m. The error is the texture's bilinear sag, curvature times texel squared over eight, so it falls fourfold per extra `k` (about 0.06 m at k = 12) and the texture grows fourfold (67 MB). Where the land is a flat beach, 0.24 m of depth is a long way along the ground (0.24 m over a slope of 0.01 is 24 m of waterline). These islands have steep shores; a real coast may not.
- A global texture is the limit: one resolution over the whole body, set at bake time. The review's idea of finer per-cell reads near the shore needs terrain tiles the library does not have today.
- Only the plane is covered. On a cube sphere the water's pixel stage needs the face and lattice coordinate of a direction (the library has this in CPU form, `latticeOfPosition`, and the vertex stage gets it from its own vertex); there is no TSL form for an arbitrary position, so that is new work. Not tried.
- Not covered: a moving camera at the shore, real terrain (this is the spike's analytic islands baked), and a texture streamed in tiles.
- The picture check was a headless screenshot of the baked arm by me (land drawn from the texture, foam line, shallows); the owner's eye is not in it.

**Not done.** Sphere and cylinder reads; the cost of the extra texture on a body that already reads several; higher `k` or a second finer texture near the shore; whether to move the bake's `k` from the terrain's own setting.

### 2026-11-03 (shoreline review): the spike keeps pictures and clips

The owner asked for visual evidence to be viewable in the chat without anyone opening the media. The spike now takes case stills (`thumbnail`, the page's `ScreenshotService`, 480 px WebP) and records a clip for cases with an orbit (`recording`, the canvas copied into a 640x360 canvas at 24 fps, 900 kbit/s). The new suite `water-lod-spike-coast-look` v1 has four still cases (analytic and baked at Ultra, baked at High and Low) and two 90-degree orbit cases (Ultra and High, baked). The waves are frozen for it, so anything that swims with the camera is the terrain or the water mesh, not the waves. Its gates are only that the water and the land draw; the pictures are the evidence, and `requiresVisualReview` stays pending until someone looks.

**Run.** Stills: `triangular-test-run` headless on the real GPU, six cases pass. Clips: the runner's "Record short video around each case" checkbox in headless Chrome (there is no CLI flag or launch link for recording, by design); two clips of about 300 KB, 114 and 122 frames, not blank. The labelled contact sheet comes from `triangular testing media contact-sheet` over the four stills.

**Reported by the run, not gated.** Triangles at the coast view: analytic Ultra 2.29 M, baked Ultra 1.18 M, baked High 0.32 M, baked Low 0.08 M. The analytic land source has no height range per node, so its leaves carry a plus-or-minus 865 m bound and more of them are drawn; the baked source has tight per-node ranges. The two arms of the baked toggle therefore do not draw the same land, which matters for any cost comparison between them.

**Not done.** The camera-moves-with-everything report (Land on, then a quality change, then moving the camera) is not reproduced headless: the rebuilt bodies keep the right settings and the orbit frames are consistent. Whether it shows in a headed browser is for the owner's eye on the two orbit clips.

### 2026-11-03 (shoreline review): one depth read per pixel

The owner saw the baked terrain look the same as the analytic one but cost a bit more. The water material read the land twice per pixel: the shore weight (flattening the waves) and the foam and depth colour each called `landReadNode`, eight texture loads per pixel on the baked path. The material now reads D once (`waterDepthNode`) and passes it to `shoreWeightFromDepth` and `shoreLookFromDepth`; four loads per pixel. The vertex stage is unchanged, and `shoreWeightNode` and `shoreLookNode` keep their one-argument form. The read is skipped when shore, foam and depth colour are all off.

**Run.** 111 of 111 specs pass. On the RTX at full screen (owner away), terrain-read v2, shore-look v1, shore v1 and coast-look v1 all pass with unchanged numbers (largest baked-against-analytic depth error 0.24 m; no waterline point without foam; coast-look triangles 2.18 M analytic Ultra, 1.02 M baked Ultra, 0.28 M High, 0.07 M Low). The runs were vsync-bound (frame interval 6.1 ms, GPU frame 0.6 to 1.3 ms, 0.1 ms steps) and another app held the GPU (`gpu-throttled`, `other-app-measuring`), so they cannot show a change of this size. The cost of the baked path is therefore not measured yet.

**Not done.** A frame-time A/B of baked against analytic with the same leaf counts (the two arms draw different amounts of land), at a size where the GPU frame is above the 0.1 ms step.

### 2026-11-03 (shoreline review): clips of the camera moving while the quality changes

The owner still sees the water, the wave crescent and the terrain "move with the camera" after switching to Low and rotating, and asked for a clip to check it by eye. My earlier probes could not reproduce it, and they all held the camera still with the waves frozen (the `holdView` path), so a bug that appears only while the camera moves live could not show in them. The new suite `water-lod-spike-camera-quality` v1 (visual review) moves the camera through the page's own orbit controls (`setLiveCamera`: the pose goes in each frame ahead of the controls' update, the waves keep animating) and switches quality along the path. Six 7 s clips on the coast view with the island on and the baked terrain: orbit 120 degrees at Ultra, Ultra then Low then orbit (the report's sequence), orbit at Low, zoom in then pan then zoom out then pan back at Ultra and at Low, and an orbit of 160 degrees while the quality steps High, Medium, Low. The recording copy now writes the active quality in the clip's corner.

**Run.** Seven new specs (the water spike's specs pass headless); one headless run on the real GPU passes all six cases (frame interval median 6.1 ms, longest frame 8 to 37 ms, so no stall in the page). Clips from a headless Chrome on the real GPU driven over the DevTools protocol to tick the runner's recording box (the launcher has no recording option): six WebM files of about 310 to 410 KB, 140 frames each, not blank, sent to the owner as MP4. A run in the built-in browser pane rendered at about 1 frame per second while the pane was not in front and failed the "page kept rendering" gate, as it should; it is not evidence.

**Reported by the run, not gated.** The gates are only that the water and land draw, the page kept rendering (60 frames) and every quality switch was applied. The clips are the evidence; no review is recorded, and the clips show nothing about the cause. One frame of the Ultra-then-Low clip shows a pale rectangle at the bottom edge during the orbit, which the owner may want to look at.

**Not done.** Pointer-driven orbit (damping) is not driven by the test.

### 2026-11-03 (shoreline review): the water stayed fixed to the camera after a quality change

The owner saw the clips: after the switch to Low the water moved with the camera and blocks of it were missing. A second model (Opus 5.5) was briefed with the code excerpts and asked questions instead of exploring; it agreed with the cause below (about 80 % before the check).

**Cause.** Every quality change changes `leafCap`, so `LodTerrainBody.configure` builds a new surface mesh. The water body is given one material object that every new surface is wired onto: `createLodSurfaceMesh` assigns `material.positionNode` (a graph over that surface's own per-frame anchor uniforms and instance buffers) and never flags the material. three.js 0.187 recomputes a material's program cache key only when `material.version` changes (`NodeManager.getCustomProgramCacheKey`), and a render object's cache key adds only geometry attribute names, so the new mesh found the old compiled program in `nodeBuilderCache` and drew with the old surface's uniforms, which nothing updates any more. The mesh group still follows the camera each frame, so the water sat rigidly in front of the camera, turned with it, and the new tree's leaves no longer matched the frozen view (blocks missing). With the camera held still after the switch it looks right, which is why every earlier probe passed. The land body makes a fresh default material per surface, so it compiled fresh; its odd look was most likely the camera-fixed water plane cutting through it. Not shown by direct inspection of `nodeBuilderCache`; the evidence is the code path plus the clips below.

**Fix.** `createLodSurfaceMesh` sets `material.needsUpdate = true` after wiring a supplied material (a new spec checks the version rises with each surface built on one material and that the built-in material is left at 0). This fixes every consumer that passes `[material]`, planet materials included. CHANGELOG entry added.

**Check.** The same suite rerun on the real GPU (headless, all six cases pass, median frame 6.1 ms): in the Ultra-then-Low-then-orbit clip the frame that had a rectangle of water missing at the bottom edge is whole, and the shore moves with the world through the orbit. One frame is blank at the switch (the pipeline compile, as before). Whether the owner sees any remaining effect is for the owner's eye; no review is recorded. The lod-surface specs: 402 pass, 3 fail (morph sweep budgets and a settle check, from the uncommitted selector and metric changes, not from this).

**Not done.** The object-level experiment (set `water.material.needsUpdate` after a switch on the old build, or compare the render object's node builder state) was not run. The v2 cost suite still needs a clean rerun; any earlier measurement that switched quality before measuring may have drawn the stale water, so treat those as suspect until it is rerun.

### 2026-11-03 (shoreline review): ideas from a public MIT-licensed ocean demo

The owner asked for a public WebGL2 ocean demo (Ultra Water, MIT, github.com/Humpalumps/Ultra-Water; read at commit `30ea65e`, line numbers below are for that commit) to be compared with the spike. It is raw GLSL on a 2.4 km island, not WebGPU, TSL or planet-scale, so none of it ports directly. This entry only records what it does that the spike does not, as ideas to explore later; no commitment changed and nothing was copied.

**What it has that the spike does not**

| Area | Ultra Water | Spike now |
| ---- | ----------- | --------- |
| Breaking | eikonal travel-time field for wave direction, Green's-law shoaling, height capped at 0.42 x depth, peeling, a lean ahead of the crest (`shoreMap.js`, `OceanSurface.js` 218-297) | the depth weight only, `smoothstep(0, 12 m, D)` |
| Pinched crests and the 3D waterline | the mesh is displaced horizontally as well as vertically: crests are compressed and narrow (power 1.6) and a plunging lip leans over, all inside one pinch budget so the surface never folds (`OceanSurface.js` 235-297) | height-only waves (a sum of sinusoids); the waterline is a depth contour on a flat mesh |
| Swash | analytic run-up and drain-back of each bore on the sand, as a film thickness, edge foam and wetness (`OceanSurface.js` 98-166, used by `terrain.js`); spray in `Spray.js` | none |
| Foam | Jacobian-driven foam from the crests, eroded with age into lace, advected by a two-phase flow map (`OceanSurface.js` 654-690, `bakeTextures.js`) | stripes of constant `D` that ignore wave direction |
| Glint | Poisson-disc glint facets for sub-pixel sparkle (`OceanSurface.js` 616-637) | the Gauss-Hermite quadrature, which is deliberately sparkle-free |
| Other | Snell's window, sun shafts, caustics, floaters, a Hillaire sky | not in the spike |

**Ideas, in the order they look worth trying** (each would get a gate before any code, like the earlier experiments)

1. **Depth-limited crest height.** Cap each wave's amplitude at a fraction of `D` (they use 0.42), so crests stop growing into shallows. Low effort: our waves already take the depth weight, this changes the cap from a fade to a physical limit. The pinch (idea 2) and the swash (idea 3) build on the same height-against-depth limit.
2. **Pinched, sharper crests.** Add a horizontal displacement to the waves (the Gerstner idea) so crests narrow and troughs flatten, with a budget that keeps the surface from folding. Medium effort and a real cost: our 64 waves are heightfield-only, the horizontal term changes the position the wave sum is read at, and the normal and covariance maths in the shading would need the matching Jacobian. It also interacts with the LOD morph and with the wave-phase precision gate (Q5). Whether it is worth it depends on how flat the crests look at the coast.
3. **Swash on the sand.** Run-up and drain-back from our shore amplitude and `D`, drawn on the terrain as a thin film and edge foam. Medium effort. It serves the waterline goal directly, and the water already shares one depth read per pixel with the terrain's baked height.
4. **Crest-driven foam with age erosion.** Foam where the wave Jacobian compresses, eroded over time, instead of fixed depth stripes. Medium effort. It needs the same Jacobian as idea 2.
5. **Travel-time (eikonal) bake for wave direction and shoaling.** Gives the two things experiment 4 lists as missing. High effort, and the sphere would need a per-face version, so only after 1 to 4 have passed their gates.
6. **Poisson glint facets.** Adds temporal noise, so it must pass the Q3 shimmer gate first. Lowest priority.

**Licence.** Ideas and maths are not copyrightable, so a citation here is enough. Code copied (even adapted from GLSL to TSL line by line) must carry the MIT copyright line and permission text, and a third-party notice. Their caustics code credits another project that their own notices file does not list, so check that licence before borrowing the method.

**Not done.** Nothing was tried. The pinch (idea 2) is the one the owner noticed on first sight; it is the least certain, because it changes the wave sum itself.

### 2026-11-03 (shoreline review): what the baked read costs, land body held fixed

The earlier cost run flipped the land body and the water's depth read together, and the analytic land body draws about twice the triangles of the baked one, so it could not say what the read costs. Suite `water-lod-spike-terrain-cost` v1 flips them apart: four arms (analytic or baked land body, analytic or baked depth read), two rounds in opposite order, 3x pixel ratio, GPU timestamps. The page gained `setWaterRead`, which holds the water's depth read apart from the land body. Gate, written before the first run: every arm's GPU frame at least 0.5 ms (five timer steps), and on each land body the baked read at most 10 % over the analytic read.

**Run.** 117 of 117 specs pass. On the RTX (visible browser, owner away, load clean, one repetition), auto=pass:

| View | Analytic land, analytic read | Analytic land, baked read | Baked land, analytic read | Baked land, baked read | Triangles (analytic land / baked land) |
| ---- | ---- | ---- | ---- | ---- | ---- |
| Coast | 7.33 ms | 7.40 | 7.40 | 7.37 | 2.18 M / 1.02 M |
| Look down from 800 m | 1.20 ms | 1.20 | 1.30 | 1.30 | 1.62 M / 0.22 M |

The baked read costs 0.03 and -0.02 ms on the coast view (ratio 1.00) and 0.00 ms on both land bodies in the look-down view. The baked land body costs 0.03 and -0.02 ms on the coast view and 0.10 ms (one timer step) in the look-down view. Halving the land triangles did not change the coast frame either, so that frame is bound by the water's pixel work, the same in every arm.

**What it shows.** In GPU time the baked depth read is not measurably more expensive than the analytic one, to within one timer step (about 1 % of the coast frame, about 8 % of the look-down frame). It does not reproduce the owner's "baked costs a bit more". Caveats: the machine recorded `gpu-throttled` and `gpu-adapter-unrecorded`, one repetition only, and the look-down frame is too short to resolve less than about 8 %.

**Not done.** The suite records GPU time only. If the owner's impression came from CPU time (the FPS panel's CPU frame) or from the rebuild when the toggle flips, this run would not see it. Next cheap step: record the CPU frame per arm and the time to the first drawn frame after a flip.

### 2026-11-03 (shoreline review): the owner finds the foam stylized; what two public repos do instead

The owner reviewed the regional look (Q4) and found the foam stylized: fine for some games, not for a realistic look. The spike's foam is stripes of constant `D` (`shoreFoam`), which ignore wave direction. A second public ocean demo was read beside Ultra Water: Minamo (`kanaworksai-hue/minamo`, MIT, WebGPU and TSL on three.js r186, an open bay). It was not recorded here before. Nothing was copied and no commitment changed; these are candidates for a gated experiment.

**Correction to the entry above.** It says Ultra Water's foam is eroded with age. In its source, offshore erosion follows foam density (a noise threshold, `cover = smoothstep(1.05 - foam, 1.3 - foam, pattern) * sqrt(foam)`); age enters only through the two-phase flow map, and only for shore foam.

| Area | Ultra Water | Minamo |
| ---- | ----------- | ------ |
| Open-water foam | Jacobian of the displacement, thresholded | Jacobian written per texel, decays exponentially and persists |
| Foam erosion | noise threshold on the foam density | world-noise threshold on the foam |
| Breaker foam | crest band with a trailing tail, gated by breaking | none |
| Advection | two-phase flow map at the wave's phase speed (shore foam only) | none |
| Depth colour | per-channel Beer absorption from scene depth, in-scatter over bright sand | Jerlov IA-IB per-channel absorption and scattering, closed-form single scatter |
| Sub-surface | crest SSS, breaking-lip glow | back-lit crest SSS |
| Reflection | Fresnel F0 0.02, sky cube plus planar | exact dielectric Fresnel (n 1.333), PMREM sky |
| Sun glint | GGX with a floor, Poisson facets | GGX with an angular-radius floor |
| Waterline | analytic swash, crest pinch | waterline and displacement share one function |

**Cheapest ways to look less stylized, in order**
1. Erode the foam with a noise threshold and fade it with density, instead of constant-`D` stripes. One noise sample per pixel, no wave data needed.
2. Put the breaker band on each wave train's crest, with a trailing tail, and move it at the wave's phase speed. This makes foam follow wave direction. A few taps and the per-train phase.
3. Persistent crest-compression foam with decay. Most physical for open water, but the spike's waves are height-only, so it needs the horizontal-displacement term first (idea 2 above).

Colour is a separate, cheap step: per-channel Beer absorption with published Jerlov values.

**Not done.** None of it was tried.

### 2026-11-03 (water on a planet, stage A): the plane spike's water on a 600 km sphere, with terrain and the atmosphere

The owner asked to try the water on the planet, with the atmosphere, and to confirm the game stays performant with 3D terrain, atmosphere and water together. Stage A is a second spike page, `/water-lod-spike-sphere` (`water-lod-spike/water-lod-spike-sphere.component.*`, listed on the spikes index as spike 7). Nothing in `lod-surface` core changed.

**What it is.** Two standalone `<planetTerrain>` bodies (no `<planet>`): the land (the plane spike's islands as a Gaussian-bump `HeightSource` on the sphere, `TerrainPlanetMaterial`) and the water (the plane's 64 waves as `ISphereWave` plane waves with fixed 3D directions, spherical Fibonacci, so there is no pole or face seam), plus an optional standalone `<planetAtmosphere preset="earth">` whose only surface is the land's material. Poses: orbit, 20 km, coast at 50 m, 2 m eye. Layer toggles (land, water, atmosphere, atmosphere light and haze separately), the plane spike's wireframe, filter, animate, shore, foam, depth-colour toggles and the quality slider.

**How the water works on the sphere.**
- Vertex stage: the plane's spacing-filtered sum of sines, with a naive float32 phase `k (up * R).d + phase - omega t`, times the shore weight. The CPU twin keeps every wave. The float32 phase error (Q5) is millimetres of height at the shortest wavelengths, because the amplitude there is millimetres; the geometry carries it, the shading does not.
- Fragment stage: slopes are rebuilt per pixel from a camera-anchored phase, `k dot(base - camera, d) + offset_i`, where `offset_i` is computed in doubles on the CPU each frame from `camera.matrixWorld` and the wave time (`updateSphereWaterAnchor`, the Q5 anchor path) and `base` is the position minus `up * vertexHeight` (the vertex height travels as a varying, so the vertex stage still computes it once). The footprint gate, the lost-slope covariance and the 3 x 3 Gauss-Hermite shading are the plane's. The tangent pair for the slopes is a branch-free orthonormal basis built in the home frame (no screen derivatives), continuous except on the great circle 90 degrees from home.
- The sphere's sun is the body's (`setSunDirection`); a day factor (smoothstep of `dot(up, sun)` over -0.12..0.2, ambient floor 0.06) dims the water colour, the reflected sky and the glint, because the plane's sun is always above the horizon.
- Shore weight, foam and depth colour read the land's analytic height at the base point's direction (no baked read, no cover hook).

**Verified (built-in browser, `http://triangular-demo.localhost:4200`, AMD integrated GPU, so the picture and not the timing).**
- The page compiles, loads without console errors, and draws land, water and the sky at all four poses, with and without the atmosphere. Stills were sent to the owner in chat.
- 35 new unit specs pass headless (land, waves and basis, material day factor, poses, the cost suite with a fake host, 161 passing together with the existing water spike specs).
- Not verified: any GPU timing. Suite `water-lod-spike-sphere-cost` v1 exists (five layer sets at four poses, two rounds in opposite order; gates: the water's marginal GPU cost on the land at most 0.5 ms, plan 080's gate, defined on an RTX 3080 at 2560 x 1440 in a visible browser; the full stack at most 8.3 ms, which is this spike's proposal and not a plan figure). It has not been run; it needs the owner's visible browser.

**Limits recorded now, so they are not mistaken for findings.**
- The water is a `MeshBasicNodeMaterial`, not an atmosphere surface: it gets the sky backdrop only, with no aerial haze and no atmosphere light. The sky colour in its reflection is a constant. At the coast the hazed, atmosphere-lit land stands beside un-hazed water. Making the water a surface the atmosphere lights and hazes is the next stage.
- The vertex phase is naive float32 (above). Plan 080 W1a would put the anchored phase in the lod-surface vertex stage; this spike does it in the material because the hook does not exist.
- No cover hook and no shore audit on the sphere: the water is drawn under the land by depth only.
- The orbit glint shows the 3 x 3 quadrature as a cluster of lobes (large lost variance, nine samples). The plane's far view was not checked for the same.
- The basis seam (90 degrees from home) and a 600 km radius with the plane's wavelengths were taken as they are; no other radius was tried.
- Observed, not investigated: giving the land body `renderOrder = -1` with the atmosphere on hid the land (the sky backdrop showed through where it should be). Removing the line fixed it. The page leaves both bodies at the default order.
- Running the stack on the integrated GPU gave about 18 FPS at the coast with 1.27 million triangles; that is a machine note, not a result.

**Next.** The owner runs the cost suite on the RTX 3080 (launch link below, visible browser). Then decide whether to make the water an atmosphere surface (haze and light), and whether to move the anchored phase into the vertex stage (W1a).

Launch link (auto-starts): `http://triangular-demo.localhost:4200/water-lod-spike-sphere?testSuite=water-lod-spike-sphere-cost&testVersion=1&testProfile=visible-browser&testMode=standard&testRepetitions=1&testAutoStart=1`

**First cost run (2026-11-03 22:00, visible browser, RTX 3080, one repetition; result file `water-lod-spike-sphere-cost@v1/2026-11-03T22-00-16-979Z_visible-browser_0d9a6f51-2a75e5d7.json`).** Automation failed on all four poses; performance is recorded as inconclusive.
- The machine reported `gpu-busy-before-start` (GPU 96 % busy, 87 C) and `gpu-throttled`. These are warnings, not a rejection, but the numbers are from a loaded, hot GPU and should be repeated on a quiet one before they are quoted as hardware figures. GPU timestamps come in steps of 0.1 ms.
- Water marginal GPU cost on the land (gate 0.5 ms): orbit 1.58, 20 km 2.55, coast 2.55, 2 m eye 3.28 ms. Four to seven times the gate at every pose, and the gap is far larger than the 0.1 ms step.
- Full stack (land + water + atmosphere) GPU frame: 1.90, 3.10, 3.00, 3.93 ms against the 8.3 ms proposal, so that gate was not the one that failed. Atmosphere on land costs 0.2 to 0.3 ms.
- The water body alone is 0.75 to 0.92 of the whole stack's GPU time. Its triangles equal the land's or exceed them (water 613k, 605k, 630k, 928k; land 613k, 614k, 1.33M, 1.33M).
- The other check at every pose, "land and land + water arms are at least 0.5 ms", failed too (shortest 0.2 to 0.4 ms). That is a flaw in the suite's design and not a measurement fault: the land alone is cheaper than the floor the check demands, so the marginal cost cannot be called "readable" by that rule even where it plainly is.
- CPU frame stayed at 0.6 to 1.5 ms. The longest frame after a layer switch reached 25 to 97 ms for the arms that add water (pipeline compile), against about 6 ms for the land alone.
- The cost rises as the camera nears the water (1.5 to 3.3 ms). The split run below measures what it is made of. The water also draws a full-density lattice under the land, which the cover hook was meant to remove.

**Cost split run (2026-11-03 23:11, visible browser, RTX 3080, one repetition, `water-lod-spike-sphere-split@1`; result file `water-lod-spike-sphere-split@v1/2026-11-03T23-11-59-062Z_visible-browser_feef06dd-e3b0c442.json`).** Land with the atmosphere off, then the water in seven arms, each twice (second pass reversed). Nothing is gated. The machine again reported `gpu-busy-before-start` and `gpu-throttled` (GPU 79 % busy, 78 C), and timestamps come in 0.1 ms steps, so differences under about 0.2 ms are noise. Cost over the land, in ms:

| Arm | orbit | 20 km | coast 300 m | eye 2 m |
|---|---|---|---|---|
| full (ultra) | 1.42 | 2.70 | 2.60 | 2.95 |
| no quadrature | 1.35 | 2.40 | 2.33 | 2.82 |
| no depth read | 1.40 | 2.48 | 2.68 | 3.18 |
| plain shading (both off) | 1.33 | 2.18 | 2.32 | 2.83 |
| low quality | 0.30 | 1.00 | 1.18 | 0.98 |
| cheapest (low, plain) | 0.30 | 0.55 | 1.00 | 1.03 |

Water triangles: 1.22M at ultra against 0.10M to 0.22M at low (the land alone is 0.61M to 1.33M).
- **The fragment stage is not the cost.** Removing the quadrature and the depth read together saves 0.1 to 0.5 ms of 1.4 to 3.0 ms, and the eye pose, where the water fills the screen, saves 0.1. The shading is a small part, not the dominant one.
- **Triangle count and the vertex stage are.** Dropping to the low tier (about a sixth to a tenth of the triangles) removes 1.1 to 1.9 ms at every pose and lands at 0.3 to 1.2 ms. The ultra tier's water mesh is as large as the land's or larger, and it is drawn over the whole sphere including under the land.
- **What remains at low quality** is about 1 ms at the close poses even with plain shading, against 0.3 at orbit. That fits the 64-wave vertex stage and full-screen overdraw on top of the land, but this run does not separate them.
- **Not diagnosed yet.** Whether the vertex waves or the overdraw is the remaining ~1 ms, and what the triangle count alone costs. The 0.5 ms gate is not met at any tier on this machine state. The hidden-under-land share was never measured, and the cost is large from orbit and at 20 km where land covers little, so the cover hook is a side issue, not the lead.
- **Confound in the "low quality" and "cheapest" arms above.** The page gave the land body the water's quality tier, so those two arms also dropped the land's density (4096 to 256 leaves) while the baseline "land" arm kept it at ultra. Their "cost over the land" is therefore understated. The page now gives the land the ultra mesh always (`landTier`), so a rerun of the split suite is clean; the table above stands for the other five arms.

### Density run (suite `water-lod-spike-sphere-density` v1, 2026-11-03 23:52, visible browser, RTX 3080)

Water alone (no land, no atmosphere) at the four poses, against an empty frame (0.00 ms). Ultra; ultra with every wave off in both stages (the mesh and the plain shading only); ultra without the quadrature; 4 px cells with 1024 and with 256 leaves; 10 px cells at the ultra leaf cap; the low tier's wave bias on the ultra mesh; the high and low tiers. Each arm twice, the second pass reversed; nothing gated. Machine warnings: GPU busy before start (71%), another app measuring. Timestamps come in 0.1 ms steps.

GPU ms of the water alone (triangles in thousands below):

| arm | orbit | 20 km | coast 50 m | eye 2 m |
|---|---|---|---|---|
| ultra | 1.60 | 2.85 | 3.53 | 5.67 |
| ultra, no waves | 1.37 | 2.25 | 2.25 | 3.80 |
| ultra, plain (no quadrature) | 1.32 | 2.45 | 3.15 | 5.17 |
| cap 1024 | 1.35 | 1.85 | 2.35 | 2.93 |
| cap 256 | 0.50 | 1.40 | 1.63 | 1.85 |
| cells 10 px, cap 4096 | 0.50 | 2.70 | 3.50 | 5.43 |
| bias 4 | 1.25 | 2.60 | 3.50 | 5.67 |
| high | 0.90 | 1.70 | 2.30 | 2.78 |
| low | 0.50 | 1.00 | 1.70 | 1.57 |

Triangles (k), ultra / cap 1024 / cap 256 / low: orbit 613 / 524 / 131 / 109; 20 km 605 / 166 / 53 / 53; coast 611 / 178 / 57 / 57; eye 928 / 271 / 58 / 58.

- **The triangle count is the largest cost, with no land.** The flat ultra mesh with every wave off costs 1.4, 2.3, 2.3 and 3.8 ms. Cutting the leaf cap to 1024 saves 0.25, 1.0, 1.2 and 2.7 ms; to 256, 1.1, 1.5, 1.9 and 3.8 ms.
- **The wave work is second and grows as the camera nears:** ultra minus no-waves is 0.2, 0.6, 1.3 and 1.9 ms. It is mostly the vertex stage: the wave bias (fragment gate only) changes nothing at the close poses, while the quadrature is 0.3 to 0.5 ms at every pose.
- **A floor remains with a small mesh:** about 1.0 ms at 20 km and 1.6 to 1.9 ms at the two close poses with 53k to 58k triangles. Fragment cost over a screen full of water, or the vertex stage's fixed cost, is the next thing to separate.
- **The leaf cap does bound the mesh (answered by reading the selector, see "Horizon cull" below):** a leaf is a 16 x 16 patch, 512 triangles, so cap 1024 is at most 524k triangles and 4096 is 2.1M. At orbit ultra selects only 822 leaves (613k triangles), so cap 1024 trims 20 % there, and every leaf under the cap was drawn.
- **Cells of 10 px alone do nothing at 20 km and closer:** the mesh there is cap-limited, not cell-limited. The cap is the control that works.
- **The 0.5 ms gate is not met by any arm except at orbit** (cap 256, 10 px cells and low, all 0.50 there). Hidden-under-land water was not part of this run and is not the cause: the land was off.

### Horizon cull (2026-11-04; code and specs, then measured on the GPU: see "Measured" below)

**Measured (suite `water-lod-spike-sphere-horizon@v1`, visible RTX 3080, run 2026-11-04T20:32, noisy: a game client used the GPU, so treat 0.1 ms as the noise floor).** GPU ms, water alone, 600 km planet:

| arm | orbit | 20 km | coast 300 m | eye 2 m |
| --- | --- | --- | --- | --- |
| ultra, no cull | 1.50 | 3.00 | 3.90 | 6.43 |
| ultra, cull | 1.40 | 2.80 | 3.80 | 6.13 |
| cap 1024, cull | 1.40 | 1.90 | 2.53 | 3.70 |
| cap 512, cull | 0.70 | 1.80 | 2.17 | 3.10 |
| cap 256, cull | 0.50 | 1.50 | 2.00 | 2.50 |
| cap 64, cull | 0.40 | 1.50 | 1.50 | 0.90 |
| high (cull) | 1.40 | 1.60 | 2.40 | 3.73 |
| low (cull) | 0.50 | 1.50 | 1.70 | 2.53 |
| ultra, no waves, cull | 1.40 | 2.10 | 3.10 | 4.77 |

Triangles drawn, ultra no cull vs cull: 734k → 433k at orbit, 573k → 397k at 20 km, 593k → 521k at the coast, 905k → 844k at 2 m.

- The cull removes up to 41% of the triangles from orbit but only 7–10% close up, and the GPU time falls only 0.1–0.3 ms (3–7%). It is correct and cheap but not the big lever.
- The leaf cap is the lever: at 2 m, cap 1024 is 3.7 ms against 6.1 ms for ultra's 4096. High is already cap-bound at 1024 leaves close up (same triangle count as the cap-1024 arm), so lowering ultra to 1024 would make ultra and high nearly equal close up.
- The wave math costs about 1.3 ms at 2 m (6.13 vs 4.77 without waves) and 0.7 ms at the coast; triangle count is the larger cost. A mesh of almost nothing (cap 64) still costs 0.4–1.5 ms.
- Decision pending a visual check: lower ultra's cap (candidate 2048, then 1024) and keep high at 1024 or 512.
- Done (2026-11-04): the sphere page's ultra tier is now 2048 leaves (`WATER_LOD_SPIKE_SPHERE_QUALITIES`); the plane spike's table is unchanged, and the land stays at 4096. Earlier sphere suites' "ultra" arms mean 4096 leaves.
- Done (2026-11-04): stills suite `water-lod-spike-sphere-stills` v1 (functional, visual review pending): land, water and atmosphere at 4096, 2048 and 1024 water leaves at the four poses, the wave clock held at 20 s so only the mesh differs, one 1280 px still per case. Run on the visible RTX 3080 (noisy load: a game client was running, GPU 75/97%), all checks pass. Whole-stack GPU frame (ms, noisy run, so read the steps rather than the absolute values) at 4096 / 2048 / 1024 leaves: orbit 1.9 / 1.9 / 1.9; 20 km 3.1 / 2.4 / 2.1; coast 50 m 3.0 / 2.5 / 2.3; 2 m eye 3.9 / 3.3 / 2.9. At orbit the cap does not bind (identical triangles at 4096 and 2048). A 4096-versus-2048 difference image of the stills is scattered noise with no shapes or banding (mean absolute difference about 0.8 to 1.0 of 255, the same size as WebP encoding noise). The owner's visual judgement of the stills is still open; no review was recorded.
  - Rerun: [stills suite](http://triangular-demo.localhost:4200/water-lod-spike-sphere?testSuite=water-lod-spike-sphere-stills&testVersion=1&testProfile=visible-browser&testMode=standard&testRepetitions=1&testAutoStart=1).

**What the selector does.** Reading `lod-selector.ts`: selection is by distance alone, the frustum only decides which selected leaves are drawn, and nothing culled leaves behind the planet. The leaf cap counts them, and they ran the water's 64-wave vertex stage before the depth test threw them away.

**What was added.** `SelectorSettings.horizonCull` (sphere domains, needs `cull`; `<planetTerrain [horizonCull]>`, default off): a leaf whose bounding sphere lies wholly beyond the tangent cone of the solid ball `sizeM - heightBoundM`, with its highest point and a margin for the camera slack, is left out of the drawn set (`stats.horizonHidden`, `stats.drawn`). Like the frustum, it never changes the selection or the budget. It is off while a geometry hook is installed and while the globe-to-map morph is above 0 (`setHorizonSuppressed`). Specs (`lod-selector-horizon.spec.ts`): the selected leaves are identical with and without it; for five altitudes (2 m to 6,371 km), four directions and two height bounds, every sampled point of every culled leaf is hidden by the ball (counted, 0 violations); off when suppressed, bent, inside the body, without `cull`, and by default. All 416 lod-surface specs run: 413 pass; the 3 failures are the morph specs that already failed before this change.

**How much it hides, by leaf count (600 km planet, camera at one direction, probe run in the specs' headless Chrome):** with cap 4096, 17 % at 2 m, 28 % at 300 m, 31 % at 2 km, 33 % at 20 km, 34 % at 100 km, 21 % at orbit; with cap 1024, 10 to 25 %; with cap 256, 7 to 12 %. That is a third at most, not the half I first estimated: the leaves get coarser with distance, so the far side is covered by few big leaves, and the ones that straddle the horizon stay. A leaf is 512 triangles whatever its level, so the share of leaves is the share of triangles drawn.

**Measuring it.** Suite `water-lod-spike-sphere-horizon` v1 (water alone, four poses): the shipped ultra without the cull, ultra with it, the cull with caps 1024, 512, 256 and 64 (64 is the floor), the high and low tiers, and ultra with no waves. The page has a "Horizon cull" button, on by default, so the cost suite's `land + water` arms now run with the cull on (the v1 results were without it); the density and split arms hold their variants without it, and only the horizon suite's arms turn it on.

## Scope history

<!-- tri:scope-history -->
<!-- tri:scope-baseline state="unconfirmed" -->
<!-- /tri:scope-baseline -->
<!-- /tri:scope-history -->

### 2026-11-02 (night): scene froze after Land on, then a quality change

**Report.** With Land on, changing the quality froze the scene (the UI still worked, nothing in the console).

**Cause.** Not the cover hook. A quality change rebuilds the surface mesh of both terrains in one frame, and each one calls `renderer.compileAsync`. three 0.187's `compileAsync` keeps its precompile state in one slot (`_precompilationState`, `_callDepth`), so the overlapping second call throws in `_finishPreCompile` and skips the `_callDepth--`. The error went only to `engine.error$`; the raised call depth makes later renders count as nested. Reproduced in headless Chrome by turning Land on and changing quality 20 to 250 ms apart: the engine error and a call depth that grew by one per change, and the land was not drawn (2 draw calls instead of 3).

**Fix.** `attachLodTerrain` queues compiles per renderer (`serialCompile`): one at a time, and a mesh replaced while it waited is skipped. The same sweep now shows no engine error, a steady call depth and the land drawn. Specs: a new flat-terrain spec (never two compiles at once, a replaced mesh is skipped) and the planet-terrain spec that had asserted the overlap now asserts the queue; 58 of 58 component specs pass.

**Not done.** The other pages that call `compileAsync` themselves are untouched; any of them that compiles next to a terrain can overlap the same way. Headed Chrome on the owner's hybrid GPU was not tried; the sweep ran headless.

### 2026-11-02 (shoreline review): w2 depth mechanism

Plan 080's Depth outcome, the w2 line and the testing matrix changed on this date. Before: depth meant terrain-aware culling (no water drawn under land, a cull hook in lod-surface). After: the water depth over the terrain scales the waves (`smoothstep(0, ramp, D)`), foam and river mouths read the same `D`, and culling is optional. Reason: the owner's goals (a crisp waterline, water meeting the surface, river mouths) and the spike results (land drawn first already removes most of the cost; the hook saved 0 to 6 % of triangles; crescents are wave crests above low land, and the gate is clean with the weight). The w2 acceptance gained the shore gate (`water-lod-spike-shore`). No earlier commitment was removed; the cover hook stays in the library. No baseline was confirmed.
