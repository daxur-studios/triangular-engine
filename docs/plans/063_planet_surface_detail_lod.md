---
type: Plan
title: Planet Surface Detail LOD
description: Draw trees, rocks, runways and other surface objects as meshes up close and as part of the planet surface material far away, with one lighting and atmosphere model for every form.
timestamp: 2026-10-25T00:00:00Z
tags: [cell-planet, planet-material, lod, impostor, scatter, atmosphere, tsl, webgpu]
runbook: /docs/runbook/063_planet_surface_detail_lod.md
performance: []
---

# Plan 063: Planet Surface Detail LOD

Status: **spike S1 in progress: Q2 passed (runway, `/planet-surface-detail-spike`); Q1 and Q3 built, waiting for the owner's visual judgement (checklist in the runbook); Q4, Q5 open.** Design notes and reasoning: [Runbook 063](/docs/runbook/063_planet_surface_detail_lod.md).
Depends on [Plan 050](/docs/plans/050_tsl_planet_surface_material.md) (surface material, streamed pages) and
[Plan 049](/docs/plans/049_morphing_planet_atmosphere.md) (atmosphere lighting and aerial perspective).

**Goal:** surface objects on the cell planet end their LOD chain in the surface material. Near: instanced meshes.
Middle: impostors. Far: albedo, coverage, height and normal in the material, lit by the same atmosphere stages. Flat
features (runways, roads) are drawn by the material at every distance on ground flattened in the height source.

## Spike (S1) — falsifiable questions

Run on `/cell-planet-tsl` or a cloned spike page (`new-spike` skill). Nothing enters the library before the gates.

| # | Question | Pass if | Fail means |
|---|---|---|---|
| Q1 | Can a forest fade from instanced trees to a material canopy without a visible step? | In a slow zoom through the fade band, owner sees no pop or brightness step at noon and at low sun | Bake the aggregate from the instances, or widen the band |
| Q2 | Does a flattened-height runway drawn by an SDF layer stay on the ground at every terrain LOD? | No gap or cut at any zoom; markings sharp up close | Height stamp missing from a LOD path |
| Q3 | Does the height-field sun shadow (2–4 steps) read as shadows from altitude? | Owner sees directional forest-edge shadows that rotate with the sun | Fall back to the aggregate shadow term only |
| Q4 | What does the far form cost? | Added GPU time per frame on the RTX 3080 under a budget agreed before the run, measured with `?gpuTiming=1` | Drop channels or go procedural |
| Q5 | Do mesh, impostor and material forms match under the atmosphere? | No colour step in the fade band at sunset and at haze distance | Impostor lighting does not use the planet stages |

## Scope

| # | Item | Status |
|---|---|---|
| 1 | Height stamp: flatten terrain under placed flat features in the height source | spiked (Q2 pass, demo worker hook) |
| 2 | SDF feature layer: per-page list of segments/rectangles evaluated in the material | spiked (one rectangle, Q2 pass; per-page list still planned) |
| 3 | Far-form layer: coverage, canopy height and normal channel, distance fade in | spiked as an analytic density field, no baked page (owner to judge Q1); the normal channel cannot reach the lighting stage |
| 4 | Aggregate and height-field sun shadow in the far-form layer | spiked (0/2/4-step march, owner to judge Q3) |
| 5 | TSL impostor material that uses the planet lighting and haze stages | planned |
| 6 | Page bake on stream-in from deterministic scatter and placed features; invalidation on edit | planned |
| 7 | Emission channel for night lights on the far form | later |
| 8 | Test suite (functional + diagnostic cost) via `triangular-engine/testing` | planned |

## Rules

- Pages store unlit data. Lighting, transmittance, sky irradiance and aerial perspective are applied at runtime.
- Every form of an object uses the same lighting and haze stages.
- Flat features are never separate meshes over the terrain.
- Performance claims need GPU timing on the target GPU, not headless or frame cadence.
