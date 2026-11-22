---
type: Plan
title: "brepjs parametric part POC"
description: "Prove that exact B-Rep geometry from brepjs can drive a live parametric part inside a triangular-engine scene."
timestamp: 2026-11-22T00:00:00Z
tags: [plan, brepjs, poc]
plan_id: plan-089
---

# Plan 089: brepjs parametric part POC

Engineering Record: [ER-089](/docs/engineering-records/089_brepjs_poc.md).

## Goal

Show, in one small app, that `brepjs` (exact B-Rep on OpenCascade WASM) and
Triangular Engine compose: the engine renders and orbits an exact solid, a
slider rebuilds it on a real kernel, and the same solid exports as STEP/STL.
Not a product feature, and not a decision to depend on brepjs.

## Hypothesis

Exact geometry can drive a live parametric part at interactive rates inside an
engine scene, with manufacturable output, without brepjs owning the renderer,
camera or tick loop.

## Steps

1. Third Angular application in the workspace, `projects/brep-poc`, using the
   local engine source through the existing tsconfig paths.
2. Load `brepjs` lazily and initialise `occt-wasm` explicitly from an asset URL.
3. One parametric bracket (plate, flange, drilled holes, vertical fillets).
4. Feed the tessellation into an engine scene mesh plus a true B-Rep edge overlay.
5. Property panel with sliders, measurements and STEP/STL export.

## Done when

- Slider change rebuilds and re-renders the part with no console errors.
- Measurements (volume, triangles, build time) are visible per rebuild.
- STEP and STL exports download and open in another tool.

## Out of scope

- Worker offload, LOD generation, physics colliders, STEP import, assembly.
- Any production dependency or publishable API.
