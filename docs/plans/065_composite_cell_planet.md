---
type: Plan
title: Composite Cell Planet on WebGPURenderer
description: Put a game's first planet on WebGPURenderer ahead of the engine-wide default flip, and give games one Angular component that assembles the cell-planet surface, ocean, morph, streamed material, atmosphere and clouds from the existing building blocks.
timestamp: 2026-10-25T00:00:00Z
tags: [cell-planet, planet-material, atmosphere, cloud-volumes, worldgen, webgpu, renderer, components, consumer-api]
runbook: /docs/runbook/065_composite_cell_planet.md
performance: []
---

# Plan 065: Composite Cell Planet on WebGPURenderer

Status: **draft, nothing built.** Written 2026-10-25 from code reading only. Nothing was run or measured. Waiting
on the owner's review of the decisions below. Evidence: [Runbook 065](/docs/runbook/065_composite_cell_planet.md).

**Goal:** a game gets a morphing cell planet with its atmosphere and clouds by writing one tag and its children:

```html
<cellPlanet [world]="world" [radiusM]="600_000" [morph]="morph()" [sunDirection]="sunBodyFixed()"
            [lodPosition]="cameraBodyFixedM()" [renderOrigin]="originBodyFixedM()" quality="high">
  <planetAtmosphere preset="earth" [stars]="0.6" />
  <planetCloudShell [coverage]="moistureCoverage" />
</cellPlanet>
```

It runs on `WebGPURenderer`, with no GLSL patches. The first consumer is a space game whose game route draws only
cell planets and simple spheres. It ships before the engine-wide default flip in
[Plan 056](/docs/plans/056_webgpu_default_renderer.md) Phase 6.

**Builds on:**
- [Plan 056](/docs/plans/056_webgpu_default_renderer.md): `WebGPURenderer` as the engine default (D1, decided
  2026-10-19). This plan does not re-decide that. It needs only a subset of 056 Phases 0–1, listed below.
- [Plan 050](/docs/plans/050_tsl_planet_surface_material.md): `PlanetSurfaceMaterial`, its stock layers and the
  ocean material.
- [Plan 049](/docs/plans/049_morphing_planet_atmosphere.md): `PlanetAtmosphere` and `<planetAtmosphere>` (Phase 4a).
- [Plan 051](/docs/plans/051_cloud_volumes.md): cloud volumes, and the far shell (option A, its Phase 6), which is not
  built yet.
- [Plan 046](/docs/plans/046_cell_planet_shared_worker_pipeline.md): the shared cell-planet worker pipeline.

## The gap this closes

Every building block exists. Assembling them is still page code:

| Where | What it wires by hand | Size |
|---|---|---|
| Demo `/cell-planet-tsl` | streaming view, `PlanetSurfaceMaterial` and its seam twin, `MaterialStreaming` (streamed tiles; demo-only file), ocean, `<planetAtmosphere>`, morph, worker setup | 1,762 lines in the page folder, about half benchmark |
| Demo `/atmosphere-planet` | `PlanetSurfaceMaterial` on a plain globe plus `<planetAtmosphere>` | 339 lines |
| First consumer's planet body | streaming view, `MeshStandardMaterial` plus four GLSL `onBeforeCompile` helpers (`enableTerrainMacroVariation`, `enableStreamedTerrainMaterial`, `enablePlanetMorphProjection`, `enablePlanetMorphLighting`), streamed tile runtime, local flattening, colliders | about 980 lines |

The consumer's planet is on the classic GLSL path, so none of 049, 050 or 051 can reach it. The pieces that are not
about one game (world build, streaming, material, tiles, ocean, morph, sun) are written once per page. This plan
moves those into the engine.

## Renderer decision for this plan

**Facts (code reading and earlier runbooks):**
- TSL node materials run only on `WebGPURenderer`, on its WebGPU or WebGL2 backend. Classic `WebGLRenderer` cannot
  draw them. "TSL on classic WebGL first, then flip the renderer" is not an available step.
- `WebGPURenderer({ logarithmicDepthBuffer: true })` held planet-scale depth from 0.5 m near to 1e7 m far, from orbit
  at 1.56e6 m down to 60 km (Runbook 050, Phase 0 spike). Not checked beyond a 1e7 m far plane.
- `<scene [logarithmicDepthBuffer]>` re-creates the renderer without `init()` (Plan 056 inventory; not run). Passing
  the option through `webGpuRendererParameters` avoids it.
- The first consumer's game route uses no post-processing, water, scatter, impostors or Takram (its own renderer
  scoping, 2026-10-18). Its only renderer couplings are the planet material and log depth. Other routes in that app
  (old game, labs) keep classic WebGL.

**Proposal (D1):** the consumer opts its game route into `preferredRenderer: 'webgpu'` per page as soon as Phase 0
lands. Every other route stays on classic WebGL until Plan 056 Phase 6. Reasons: the route has almost no WebGL-only
dependencies, so it is the cheapest real test of 056's design. It also gives 056's Phase 6 gate a real game page,
not only demos.

**What this plan needs from Plan 056 first** (056 Phases 0–1 items, pulled forward, nothing else):
1. `EngineService.rendererBackend` signal (`'webgpu' | 'webgl2-fallback' | 'webgl' | 'pending'`), shown in telemetry.
2. `'webgpu'` always constructs `WebGPURenderer` and lets three choose the backend (no shortcut to classic WebGL
   when `navigator.gpu` is missing, since that renderer cannot draw TSL).
3. Init failure emits `error$`, not a silent blank canvas.
4. Renderer recreation (`logarithmicDepthBuffer` on `<scene>`) awaits `init()`.
5. `onDeviceLost` → `error$` (056 D6 decides recreate vs reload; this plan needs only the error).
6. Dev-mode warning when `webGLRendererParameters` is set but ignored.

**Without native WebGPU** (056 D2): the WebGL2 backend. Earlier runs measured it 2–5x slower than classic WebGL on
some passes (Plan 050, three 0.186.1, busy machine; not re-run). Phase 1 measures it on the consumer's planet. If the
gate fails, D2 decides between a lower quality preset on the fallback and keeping the classic GLSL planet for
non-WebGPU users for one deprecation window.

## Design

### Entry point

New secondary entry `triangular-engine/cell-planet` (D2), Angular plus `three/webgpu`. It depends on `worldgen`,
`worldgen/render`, `planet-material` and `terrain`. It does **not** import `atmosphere` or `cloud-volumes`. Those
attach as optional children through the host contract below, so a game that wants no sky ships no sky.

### `<cellPlanet>`

Owns, for one body:
- the world (a built `ICellPlanetWorld`, or worldgen params that it builds in the shared worker of Plan 046);
- `cellPlanetMorphStreamingView` with the engine's mesh generator and the workers;
- `PlanetSurfaceMaterial` with the stock layers (base, `streamedMaterial`, `cellLookup`, `macroVariation`), its seam
  twin and the ocean material;
- the streamed material tiles (promote the demo's `MaterialStreaming` into the entry);
- morph: the `uMorph` uniform and the projection;
- the body-fixed group that everything hangs under, kept at the render origin for a floating-origin game.

Inputs (signals): `world` or `params`, `radiusM`, `heightScaleM`, `morph` (0–1), `projection`, `sunDirection`
(body-fixed), `lodPosition` (body-fixed metres), `renderOrigin` (body-fixed metres), `quality`
(`'low' | 'medium' | 'high'`, which maps to `maxLod`, `resolution`, `generationBudget`, `maxPatches`), `ocean`
(boolean), `materialTiles` (boolean), `layers` (extra `PlanetSurfaceMaterial` layers, order ≥ 1000), `heightModifier`
(an optional elevation function, for runways and flattened sites; it bumps the selection revision when it changes),
`castShadow`, `receiveShadow`.

Outputs: `lodChange`, `ready` (first full LOD set resident).

Public fields (for games and tests): `group`, `surface`, `ocean`, `sampler` (height and normal at a body-fixed
direction, the same field the mesh uses), `stats`.

Stays in the game: physics and colliders (built from `sampler`), frame conversions, orbits, time warp, which body is
focused, the morph UI.

### Host contract (D3)

```ts
interface ICellPlanetHost {
  readonly group: Object3D;                       // body-fixed
  readonly radiusM: Signal<number>;
  readonly radiusUnits: Signal<number>;
  readonly surfaces: Signal<readonly IPlanetStageSurface[]>;  // surface, seam twin, ocean
  readonly morph: IUniform<number>;
  readonly sunDirection: Signal<Vector3>;         // body-fixed
  addSunOcclusion(entry: ISunOcclusionEntry): () => void;     // returns a remover
}
const CELL_PLANET_HOST: InjectionToken<ICellPlanetHost>;
```

`<planetAtmosphere>` injects the host optionally. Inside `<cellPlanet>`, `planet`, `surfaces`, `radius`,
`radiusUnits`, `morph` and `sunDirection` default from the host. Its explicit inputs still win, so today's use keeps
working unchanged. Clouds use the same token. The token and interface must live in an entry that `atmosphere` and
`cloud-volumes` may import without pulling in worldgen. The proposal is the core `triangular-engine` entry, which is
already Angular and already imports `three/webgpu`.

### Clouds (D5)

`<planetCloudShell>` in `cloud-volumes`: Plan 051's far shell (option A), a sphere at cloud altitude with a 2D
coverage map, ground shadows through `host.addSunOcclusion`, lit and hazed by the atmosphere when one is present.
That is what a game sees from orbit, and it is not built yet. Flyable `CloudVolume`s attach later as
`<planetCloudVolume>` with the same host, after 051's own phases.

### Surface source seam

The terrain detail work ([Plan 055](/docs/plans/055_planet_shape_system.md), [059](/docs/plans/059_lod_surface_core.md),
[063](/docs/plans/063_planet_surface_detail_lod.md)) may replace the streaming view's meshes. `<cellPlanet>` keeps
the mesh source behind one internal interface (patch selection plus mesh generation plus material), so a later
surface can swap in without changing the tag's inputs. This plan does not build or choose that surface.

## Phases

Every phase lists its headless specs (`npm test`, `ChromeHeadless`, `--watch=false`, `forceWebGL` for GPU specs) and
its runner suite. Native WebGPU numbers come only from the browser test runner on the reference machine, with the
adapter recorded. SwiftShader and headless runs are smoke evidence, never performance.

### Phase 0. Renderer readiness for one game route

- The six Plan 056 items above, in `engine.service.ts` and `scene.component.ts`, with 056's specs for them
  (`engine-renderer-selection.spec.ts`, init-failure, recreation, backend telemetry).
- Record in Runbook 056 that they landed from this plan, and tick them in 056's phases.
- **Done when:** the specs pass, the library builds, and `/cell-planet-tsl` reports `rendererBackend` on both
  backends.

### Phase 1. Consumer spike: the planet material on WebGPURenderer (go/no-go)

Done in the consumer, on its game route, behind a query flag. No engine API is added in this phase.
- Swap the consumer's GLSL material for `PlanetSurfaceMaterial` with the stock layers, through the streaming view's
  existing `createMaterial` input.
- Run the route on classic WebGL (old material, the baseline), WebGPU and the WebGL2 fallback.
- **Gate (owner sets the numbers before the run; proposal from 056 D8):** on the reference machine, WebGPU GPU ms
  p50 ≤ classic × 1.10 and CPU frame ms p50 ≤ classic × 1.15. No depth artefacts from the ground to the far body the
  game draws (check the far plane the game really uses; Runbook 050 only covers 1e7 m). Morph scrub with no seam
  tears. The colliders still match the drawn ground. The WebGL2 fallback numbers are recorded, then D2 is decided.
- **Fail means:** stop and record why in Runbook 065 before Phase 2 builds an API on the result.

### Phase 2. `<cellPlanet>`

- New entry `cell-planet` with `<cellPlanet>`, quality presets, promoted `MaterialStreaming`, `sampler`, the host
  token, README, entry-point docs, CHANGELOG, package README index, token map.
- Rewrite `/cell-planet-tsl` on the component, keeping its benchmark. The page should shrink to its controls.
- **Tests:** a component spec (adds and removes its objects, follows `morph` and `sunDirection` per frame, disposes
  materials and workers). A quality-preset table spec. A `sampler` vs mesh-height spec at fixed seeds. A
  `heightModifier` spec (selection revision bumps, flattened height under the site). A pixel parity spec against the
  hand-wired page at the same seed, camera and morph, on `forceWebGL`.
- **Runner:** `cell-planet-tsl` suites re-run; numbers must match the hand-wired page within the recorded spread.

### Phase 3. Atmosphere as a child

- `<planetAtmosphere>` injects `CELL_PLANET_HOST` optionally (D3). Explicit inputs still win.
- `/cell-planet-tsl` uses `<planetAtmosphere>` as a child; `/atmosphere-planet` stays explicit, which covers the
  standalone path.
- **Morph:** the atmosphere on a bent planet is Plan 049 3b–3c, and it waits on the owner's go-ahead. Until it lands,
  the child fades the sky with morph exactly as `/cell-planet-tsl` does today. This plan does not implement 3b.
- **Tests:** child-mode spec (host defaults applied, explicit inputs override, removal restores the stock stages on
  every host surface including the ocean). The existing 049 specs stay green.

### Phase 4. Cloud shell as a child

- Plan 051 Phase 6 far shell, exposed as `<planetCloudShell>`, coverage from a texture or from a cell field (moisture),
  ground shadows through the host.
- **Tests:** spec that the shell adds one sun-occlusion entry and removes it on destroy. A coverage-to-shadow pixel
  spec on `forceWebGL`. **Runner:** shell GPU cost from orbit on the reference machine against 051's G7 budget (a
  fraction of a millisecond).

### Phase 5. First consumer adopts the component

- The consumer's game route replaces its planet material, streaming and tile code with `<cellPlanet>`, keeps its
  colliders on `sampler`, and adds `<planetAtmosphere>` and `<planetCloudShell>`.
- Re-run the Phase 1 gate on the adopted route. Record the result in both runbooks.
- Whatever the consumer still has to write by hand is listed in Runbook 065 as API gaps, and becomes inputs here or is
  rejected with a reason.

### Phase 6. Second consumer check

A second consumer app that already uses `worldgen/render` (map view and morph) tries the component on one page. The
plan is done when both consumers run it without app-side copies of engine code.

## Tests summary

| Phase | Headless specs (`npm test`) | Runner / browser |
|---|---|---|
| 0 | renderer selection, init failure, recreation, backend telemetry | `/cell-planet-tsl` backend shown |
| 1 | consumer's own specs | three-renderer comparison on the consumer route (gate) |
| 2 | component, presets, sampler vs mesh, height modifier, parity pixels | `cell-planet-tsl` suites |
| 3 | atmosphere child mode, 049 specs | atmosphere look suite on `/cell-planet-tsl` |
| 4 | shell occlusion, coverage pixels | shell cost from orbit |
| 5 | consumer's own specs | Phase 1 gate again on the adopted route |

## Decisions

| # | Decision | Status |
|---|---|---|
| D1 | The first consumer's game route opts into `WebGPURenderer` per page before 056 Phase 6 (proposed), or waits for the default flip | Open |
| D2 | Without native WebGPU: WebGL2 backend at a lower quality preset (proposed), or keep the classic GLSL planet for one deprecation window. Settled by Phase 1's fallback numbers. Same question as 056 D2 | Open |
| D3 | Host token and interface in the core entry (proposed), or in `planet-material` (would make it Angular) | Open |
| D4 | Entry name `triangular-engine/cell-planet` (proposed) vs inside `worldgen/render` | Open |
| D5 | First cloud piece is the far shell (proposed), not flyable volumes | Open |
| D6 | Phase 1 gate thresholds, reference machine and far-plane distance to check | Open |
| D7 | Atmosphere at morph > 0 waits for 049 3b–3c (proposed: yes; fade until then) | Open |

## Out of scope

- The engine-wide default flip and porting `scatter`, `impostor`, `water`, post-processing, CSM (Plan 056 Phases 2–7).
- The terrain detail and shape work (Plans 055, 059, 063). The surface source seam only keeps the door open.
- Atmosphere bend morph (049 3b–3c), stylized atmosphere and clouds (049 Phase 7, 051 Phase 4).
- Scatter and surface objects on the composite planet. They follow once `scatter` and `impostor` are on TSL (056
  Phase 4, Plan 063).
- Physics. Games build colliders from `sampler`.

## Open questions

- Does the consumer's `BatchedMesh` patch batching cost more CPU on native WebGPU (one draw per instance there)?
  Plan 050 Phase 0 said batching works; the consumer's patch counts were not measured.
- Which far plane does the consumer use on its game route, and does log depth hold there on WebGPU?
- Does `getDrawingBufferSize`, used for streamed-tile selection, report the same size on both renderers?
