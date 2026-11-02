---
type: Plan
title: "LOD Water"
description: "Water on the LOD surface for the plane, the sphere and an O'Neill-style cylinder, with near and far forms that share one wind field, presets, and suites for cost, visuals and moving cameras."
timestamp: 2026-11-01T00:00:00Z
tags: [engineering-records]
record: /docs/engineering-records/080_lod-water.md
map_schema: 1
document_id: plan-080
initiative_id: "lod-water"
performance:
  - id: water-lod-spike-performance-v1
    url: http://triangular-demo.localhost:4200/water-lod-spike?testSuite=water-lod-spike-performance&testVersion=1&testProfile=visible-browser&testRepetitions=1&testAutoStart=1
    status: runnable-diagnostic-hardware-unmeasured
---

# Plan 080: LOD Water

Status: **planned** (phases fixed; packets for a phase are defined when that phase starts). Evidence and decisions: [ER 080](/docs/engineering-records/080_lod-water.md).

<!-- tri:scope -->

## Intended outcome

Water is a second body on the `lod-surface` lattice, so it inherits the terrain's seams, folding and planet bend. It ships as the entry `triangular-engine/lod-water` (name open, see the ER).

- **Domains:** plane and sphere first; a cylinder (O'Neill-style inner wall) after.
- **Near form:** analytic waves (16 sines in four bands) that fade out per wave as their size approaches the vertex spacing.
- **Far form:** roughness, reflectivity, calm, slick and foam regions, all from one deterministic wind field `W(p, t)` shared with the near form. Lit by the planet's own stages (Plan 063 rules).
- **Presets:** calm, swell, storm, and blends between them that change amplitudes only.
- **Depth:** from the terrain height at each lattice point, so no water is drawn under land.
- **Morph:** water bends with the planet's G6 morph (phase W4).

Out of scope for v1: water on the cylinder's end caps (a border with no water and no reflection); Gerstner sideways motion (decided at the M3 review); Jolt buoyancy (`lod-water/jolt`, later); underwater look (Plan 057 W14, later); precomputed water pages (reserved).

## Phases and acceptance

Phases and their gates are fixed here. Packets (the chunks of work) are defined by the architect when the phase starts, and may be smaller or larger than a phase. A task is one batch of packets reviewed together (see the Haiku main session protocol).

- **w0** — Plan pair and spike S-W1. Acceptance: spike gates Q1–Q6 written into the suite before the first run; the owner runs the visible-browser GPU pass on the RTX 3080.
- **w1** — Core. Anchor-relative source hook in lod-surface; `lod-water/core` with waves, CPU twin, wind field, foam curve and `waterAt`. Acceptance: parity ≤ 1e-3 m within 1 km of the anchor and ≤ 1 cm to 10 km; no steady-state allocation (spec); lod-surface specs unchanged apart from the three known failures; terrain output bit-identical.
- **w2** — Water v0 on plane and sphere (= Plan 059 M3). Source, material, terrain-aware culling and depth, `<flatWater>`, `<planetWater>`, docs and suites. Acceptance: surface ≤ 0.5 ms GPU p95; water selection ≤ 0.2 ms main-thread p95 (its own budget, beside the terrain's); 0 crack pixels; Q2/Q3 metrics under motion; owner visual review of the pops and the regional look.
- **w3** — Cylinder domain and `<cylinderWater>`. Acceptance: seam bit-identity spec; 0 crack pixels in a seam sweep; anisotropic sag spec; same cost as the sphere.
- **w4** — Sphere morph for water. Blocked until the G6 GPU check is done. Acceptance: morph 0 bit-equal to W2; terrain and water bend identically at shared lattice points; 0 crack pixels with the cut masked; colour step in the sweep within the Q2 gate.
- **w5** — Weather presets. Calm, swell, storm and blends (amplitudes only), and the freeze-fraction hook for Plan 057 W17. Acceptance: blend popping score below a hard-swap control; owner check.

**Order:** W0 starts now. W1 onward runs before Plan 059 M6 (D17). Step 4 of Plan 059 (slope criterion) is dropped, so it no longer conflicts with the core files.

**File conflict to watch:** W1a and W3a both edit lod-surface core files. The owner picks which runs first if they overlap.

<!-- /tri:scope -->

## Current phase status

| Phase | State   |
| ----- | ------- |
| w0    | planned |
| w1    | planned |
| w2    | planned |
| w3    | planned |
| w4    | planned |
| w5    | planned |

<!-- tri:review version="1" scope-hash="pending" reviewed="2026-11-01" reviewer="agent" -->
<!-- tri:item id="Q1" kind="intent" applies-to="w0" blocks="none" state="resolved" -->

- [x] Entry name: `lod-water`, approved by the owner on 2026-11-01 (ER 080, decision 1).
  - Why it matters: the name is in the public API and the docs.
  - Resolution: `lod-water` approved; ER 080, decision 1.
  - Next action: none.
    <!-- /tri:item -->
    <!-- /tri:review -->

## Packets

Packets for W0 are defined now. Packets for W1 to W5 are defined when their phase starts. Each packet lists its phase, paths, invariants, one acceptance command, and whether it is always-review.

- **W0a** (W0, design work)
  - Paths: `docs/plans/080_lod-water.md`, `docs/engineering-records/080_lod-water.md`, dated notes in Plan 059 and Plan 057.
  - Invariants: nothing deleted or renumbered; no consumer names; no scope baseline confirmed.
  - Acceptance: `node projects/triangular-engine/bin/triangular.mjs docs records check`
  - Always-review: no.
- **W0b** (W0)
  - Paths: `projects/demo-app/src/app/water-lod-spike/**`, its route in `projects/demo-app/src/app/app.routes.ts`, the card in `projects/demo-app/src/app/pages/demo-index/demo-index.component.ts`; suite `water-lod-spike` v1.
  - Invariants: no library edits; no import from `triangular-engine/water`; TSL and WebGPU only; `showFps` on the provider and `<scene>`; portal layout; maths in pure files with specs; gates written into the suite before the first run.
  - Acceptance: `ng test demo-app --browsers=ChromeHeadless --watch=false --include="**/water-lod-spike/**/*.spec.ts"`
  - Always-review: no.
- **W0c** (W0; the owner runs it)
  - Paths: none.
  - Invariants: visible browser; NVIDIA adapter recorded in the result.
  - Acceptance: `npm run test:summary '--' --suite water-lod-spike --last 1`
  - Always-review: no.

**Spike S-W1 setup:** a flat 100 km plane through lod-surface's public API with a spike-local wave source and material. No library edits. If the public API cannot take a custom source or material, record that as a finding and copy what is needed.

**Spike questions (gates fixed before the run):**
- **Q1 cost:** water pass GPU p95 ≤ 0.5 ms at 2560 × 1440, at eye heights 2 m, 200 m, 5 km, and 2 m grazing to the horizon. If it fails: reduce K, or band the normals per pixel.
- **Q2 no colour step** (implemented in `water-lod-spike-aliasing` v1 as the change of the band-mean error against a supersampled reference between neighbouring bands, at most 2/255; see ER 080 for how the definition changed): time frozen; a scripted descent from 5 km to 2 m and a 200 m flyover. Luminance change per frame in the band ≤ 2/255 (proposal). A hard-switch control must exceed 5/255, or the metric is invalid. If it fails: widen the fade band.
- **Q3 no shimmer:** time frozen, camera creeping 1 mm per frame. Temporal standard deviation of luminance in the horizon band < 0.5 × the control with the transfer off (proposal). If it fails: widen the fade band.
- **Q4 regional look:** the owner judges by eye at 5 km and 50 km that calm, slick and foam regions read and move with the wind (thumbnails and a WebM).
- **Q5 precision:** pure maths plus a compute readback on a 600 km sphere at eye 2 m. Anchor-relative phase error ≤ 1e-3 rad; the naive `heightNode(global)` path must fail as the control. If it fails: the formula is wrong; fix before W1.
- **Q6 direction rings:** visual check on the 10 km sphere for rings where a wave's direction points along the up vector. If it fails: rotate the direction set per wave band, or use a per-cube-face set with blended borders.

## Testing matrix

**Unit specs (headless, correctness only):**
- dispersion, per-wave fade and slope variance;
- CPU/TSL parity within the tolerances above;
- anchor-relative phase against a double reference, with the naive control failing;
- the amplitude bound holds over all t;
- wind field determinism, advection and CPU/GPU parity;
- near foam mean equals f(U);
- terrain-aware culling (a node over land is skipped);
- lattice depth matches `groundAt`;
- cylinder seam bit-identity, sector wrap neighbours, caps as borders, quantised wavenumbers periodic;
- morph 0 bit-equal, and bend equality with terrain;
- preset blend continuity;
- no steady-state allocation.

**`triangular-engine/testing` suites:** timings only from visible-browser runs on the RTX 3080 NVIDIA adapter at 2560 × 1440. Headless runs check correctness.
- **`water-lod-spike` v1** (performance and visual review): Q1–Q6. Aliasing gates for Q2 and Q3 run as `water-lod-spike-aliasing` v1 (GPU readback against a supersampled reference); GPU and CPU frame time against pixel count as `water-lod-spike-performance` v3, by quality tier at a grazing and a looking-down view as v4, with v5 as the same sweep on short windows (aliasing by tier as `water-lod-spike-aliasing` v2; v3 gates Ultra fully and High on colour error only). Definitions and first results are in ER 080, History 2026-11-02.
- **`lod-water-baseline` v1** (performance): plane 100 km, sphere 10 km and 600 km, at eye 2 m, 200 m, 5 km, orbit and 2 m grazing, for calm, swell and storm. Metrics: water pass GPU p95, selection p95, leaves, triangles, draws, crack pixels. ABAB toggles: near waves, far form, foam, K = 8 against 16, σ² transfer, terrain-aware culling. v2 adds the cylinder.
- **`lod-water-visual` v1** (functional, `requiresVisualReview`): noon and low sun; the handover band; calm and slick patches; foam; the horizon; shore depth tint. Thumbnails for the owner.
- **`lod-water-movement` v1** (performance):
  - a 200 m flyover at 100 m/s for 30 s;
  - a log descent on the 600 km sphere from orbit to 2 m over 60 s;
  - surface crossing 2 m → −1 m → 2 m (no hole, no flash, `waterAt`'s side agrees with the rendered side);
  - a calm-to-storm preset blend over 10 s.
  - v2 adds a cylinder seam sweep across θ = 0 at 50 m, and an axial flyover to a cap.
  - Per-frame metrics: popping score, crack pixels, handover luminance step, horizon shimmer (time-frozen variants), selection p95 while moving, level changes.
- **`planet-scene` v3** (with water) and **v4** (water morph 0, 0.5 and 1, plus a sweep).

**Numeric gates:**
- surface ≤ 0.5 ms GPU p95;
- selection ≤ 0.2 ms main-thread p95 for the water body;
- no per-frame allocation (spec);
- 0 crack pixels;
- parity ≤ 1e-3 m within 1 km;
- handover step ≤ 2/255 per frame, with the control > 5/255 (proposal);
- shimmer < 0.5 × the control (proposal).

## Plan changes

- New plan and record pair (this document).
- Dated note in Plan 059: M3 is delivered by this plan; the cylinder domain and the anchored-source hook are dated scope changes to lod-surface core. (Done in packet W0a, 2026-11-01.)
- Dated note in Plan 057: narrowed to contender A as v0; the race stays parked. (Done in packet W0a, 2026-11-01.)
- Plan 063 unchanged; its Q5 is used as a gate here.
- The lod-surface README describes the hook and, later, the cylinder.

## Relationships

- Plan 059 (LOD surface core): this plan is its M3 and extends it with a cylinder domain.
- Plan 057 (planet water): narrowed; contender A is v0 here.
- Plan 063 (surface detail LOD): its lighting stages are reused; its Q5 is a gate here.

## Delivery progress

Record dated milestones, evidence and material changes in the linked Engineering Record.

Scope history in the Engineering Record is append-only. Confirm a specific baseline only after explicit developer confirmation; document review and checked boxes do not imply confirmation.
