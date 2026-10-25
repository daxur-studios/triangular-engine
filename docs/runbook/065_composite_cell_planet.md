---
type: Runbook
title: Composite Cell Planet on WebGPURenderer
description: Findings, decisions and evidence for putting a game's cell planet on WebGPURenderer and assembling surface, ocean, morph, atmosphere and clouds behind one component.
timestamp: 2026-10-25T00:00:00Z
tags: [cell-planet, planet-material, atmosphere, cloud-volumes, worldgen, webgpu, renderer, components, consumer-api]
plans: [/docs/plans/065_composite_cell_planet.md]
performance: []
---

# Runbook 065: Composite Cell Planet on WebGPURenderer

Plan: [Plan 065](/docs/plans/065_composite_cell_planet.md).

## 2026-10-25 — Readiness survey and first draft (code reading only, nothing built or run)

### Question (owner)

How far is the engine from giving its consumer games atmosphere, clouds, a morphing cell planet and better terrain
as reusable, easy-to-use components? Draft a plan for the WebGPU decision plus a composite planet component, with the
space game as the first consumer.

### Where each piece stands

| Piece | State | Renderer |
|---|---|---|
| `atmosphere` (049) | `PlanetAtmosphere` and `<planetAtmosphere>` built (Phase 4a); stars and sky bodies (Phase 5); 200 specs pass per its handover. Bend morph 3b waits on the owner. GPU cost of stars not measured | TSL only |
| `planet-material` (050) | Preview. Stages and stock layers built; no Angular component | TSL only |
| `cloud-volumes` (051) | Phases 0–3 and part of 5 (mesh source, animated noise). No component, no planet hookup, far shell (Phase 6) not built | TSL only |
| `worldgen/render` | `cellPlanetMorphStreamingView`, `cellPlanetMorphView`, `planetView`, the map components. Usable, and used by two consumer apps | Classic GLSL by default; TSL material can be passed in (`createMaterial`) |
| `terrain`, `celestial` CDLOD, `scatter`, `impostor` | Usable on classic WebGL; `onBeforeCompile` or `ShaderMaterial` | Classic WebGL only |
| Terrain detail (055, 059, 063) | Demo-app labs only; 055 contender B 3.1% wrong against a 0.5% line; 059 selection 0.4–0.6 ms against 0.2 ms; 063 spike waiting on visual checks | TSL |

Engine default: `preferredRenderer ?? 'webgl'` (`engine.service.ts:351`). Plan 056 is a draft with nothing built,
but its D1 (WebGPU default) and D9 (Takram removed) are decided.

### The first consumer's planet

- Its current game route draws every planet with one planet-body component on `cellPlanetMorphStreamingView`. The
  material is `MeshStandardMaterial` plus `enableTerrainMacroVariation`, `enableStreamedTerrainMaterial`,
  `enablePlanetMorphProjection` and `enablePlanetMorphLighting`, all `onBeforeCompile`. All four have TSL
  counterparts in `planet-material` (`macroVariationLayer`, `streamedMaterialLayer`, stage 1 morph, the lighting
  stage).
- The route imports `triangular-engine`, `celestial` (orbits and maths, not rendering), `jolt`, `terrain`,
  `worldgen` and `worldgen/render`. No `scatter`, `impostor`, `water`, post-processing or Takram on that route. The
  consumer has already removed Takram.
- App-wide engine options set only `webGLRendererParameters: { logarithmicDepthBuffer: true }`, and the route's
  `<scene>` sets `[logarithmicDepthBuffer]="true"`.
- The consumer's own scoping (2026-10-18) proposes moving the planet material to TSL "on a native-WebGL TSL path
  first". That path does not exist: classic `WebGLRenderer` cannot draw node materials. The nearest equivalent is
  `WebGPURenderer` with `forceWebGL`.

### Evidence carried over

- Log depth on `WebGPURenderer`: clean from 0.5 m near to 1e7 m far, orbit 1.56e6 m down to 60 km (Runbook 050,
  Phase 0). Larger far planes not checked.
- The WebGL2 fallback ran 2–5x slower than classic WebGL on some passes (Plan 050, three 0.186.1, busy machine).
  Flagged there for a re-run; not re-run since.
- `/cell-planet-tsl` already composes the streaming view, `PlanetSurfaceMaterial`, ocean, streamed tiles and
  `<planetAtmosphere>` by hand. That page is the reference for Phase 2.

### Decisions proposed (owner to confirm)

D1–D7 in the plan. The main one is D1: opt the consumer's game route into `WebGPURenderer` per page after a small
subset of Plan 056 Phases 0–1, instead of waiting for 056's default flip.

### Next

Owner review of the plan's decisions. Then Phase 0 (the six Plan 056 renderer items).
