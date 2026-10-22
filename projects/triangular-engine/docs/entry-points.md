# Secondary entry points

Import optional features from their secondary entry point so applications only ship what they use.

| Import | Purpose | Required dependencies for this entry |
| --- | --- | --- |
| `triangular-engine` | Core Angular/Three.js scene graph, cameras, lights, geometry, materials, GLTF, services, portal UI, and renderer lifecycle. | Angular Common/Core/Forms/CDK, Portal Layout, `three`, `dexie`, `three-mesh-bvh`, `rxjs` |
| `triangular-engine/scene-tree` | Opt-in Material Scene Tree inspection UI; provides its panel to core engine UI. | `@angular/material` |
| `triangular-engine/testing` | Standalone repeatable-test panel, versioned launch/result DTOs and application-neutral adapter executor. See [testing](testing.md). | Angular Core/Common/Forms |
| `triangular-engine/rapier` | Rapier rigid bodies, colliders, joints, and physics components. | `@dimforge/rapier3d-compat` |
| `triangular-engine/jolt` | Jolt physics, rigid bodies, constraints, debug rendering, terrain/scatter adapters, and high-precision workflows. | `jolt-physics` |
| `triangular-engine/pmndrs` | Angular components for PMNDRS billboard and sparkles helpers. | `@pmndrs/vanilla` |
| `triangular-engine/postprocessing` | Declarative effect composer and post-processing effects. | `postprocessing` |
| `triangular-engine/takram` | Atmosphere, aerial perspective, sky/sun lighting, and cloud components. | `@takram/three-atmosphere`, `@takram/three-clouds`, `@takram/three-geospatial` |
| `triangular-engine/water` | Plane, sphere, and cylinder water surfaces, LOD, quality/motion presets, underwater effects, and surface sampling. | `three` |
| `triangular-engine/water/jolt` | Water buoyancy integration with Jolt. | `jolt-physics` |
| `triangular-engine/water/postprocessing` | Water-specific post-processing effects. | `postprocessing` |
| `triangular-engine/terrain` | Domain-aware terrain fields, patch meshing, surface sampling, and streamed LOD selection. | — |
| `triangular-engine/terrain/core` | Framework-free terrain contracts, domains, patch meshing, material evaluation, and worker tile baking. Use this entry from web workers. | — |
| `triangular-engine/meshoptimizer` | Optional generic indexed-geometry simplification and Meshoptimizer readiness helpers. | `meshoptimizer` |
| `triangular-engine/image-compression` | Opt-in adapter for ScreenshotService and impostor image compression. | `browser-image-compression` |
| `triangular-engine/scatter` | Deterministic streamed placement, instanced LOD rendering, billboard/wind materials, picking, and collider descriptors. | — |
| `triangular-engine/trail` | Ribbon trails, stamp decals, and surface-track geometry/materials. | — |
| `triangular-engine/spline` | Authoring-neutral open/closed curves, arc-length sampling, and nearest-point queries. Core geometry only so far. | — |
| `triangular-engine/life` | Fixed-step autonomous-agent movement, flocking behaviours, local influences, and obstacle queries. | — for `core`; optional adapters may add world dependencies |
| `triangular-engine/animals` | Framework-free deterministic animal flocks: fixed-step time, stable residency, terrain clearance, disturbance flee/recover, and presentation snapshots. | — |
| `triangular-engine/animals/terrain` | Shape-neutral animal surface adapter for infinite plane, planetary sphere, and inhabited inside-cylinder terrain domains. | `triangular-engine/terrain` |
| `triangular-engine/animals/water` | Fish-safe water volumes combining sampled water surfaces with terrain bottoms across plane, sphere, and inside-cylinder worlds. | `triangular-engine/water`, `three` |
| `triangular-engine/procedural` | Deterministic procedural flora (trees, bushes, foliage) and procedural craft parts (wings, landing legs, rocket engines) with functional sockets, colliders, mass, and articulation. | `three` |
| `triangular-engine/worldgen` | Framework-free Voronoi cell-graph planets, tectonics, ecology, climate, cell connectivity, and elevation samplers. | — |
| `triangular-engine/worldgen/render` | Angular/Three.js 3D Globe ↔ 2.5D Map seamless GPU morphing, dynamic tracking, 2D canvas maps, borders, and tactical overlays (see [cell-planets.md](./cell-planets.md)). | `three` |
| `triangular-engine/worldgen/render/core` | Framework-free colour ramps, projections, world-size helpers, and worker lookup payloads. Use this entry from web workers. | — |
| `triangular-engine/atmosphere` | Planet atmosphere (Plan 049): profile format and validation, similarity scaling to any planet radius, Earth/Mars/none presets, a float64 CPU reference integrator, baked lookup tables, and a TSL sky/ground renderer for `WebGPURenderer` (`AtmosphereGpuModel`, `AtmosphereBackdrop`). Not yet wired into the cell-planet material. See [atmosphere.md](atmosphere.md). | — |
| `triangular-engine/gpu-data-flow` | CPU/GPU/worker data transport (Plan 055): upload ring with a per-frame byte budget, readback ring with frame tags and measured latency, double-buffered storage buffers, device-limit capacity guards, a per-frame job scheduler and plain-data telemetry. Logic is framework-free behind a small device interface, with a thin WebGPU binding. See [gpu-data-flow.md](gpu-data-flow.md). | — |
| `triangular-engine/planet-material` | TSL cell-planet surface material for `WebGPURenderer` (Plan 050): `PlanetSurfaceMaterial` with sphere/flat morph, an ordered surface-layer stack, sun occluders, emissives and replaceable lighting and atmosphere stages, plus stock layers, ocean and line materials. Three-only (`three/webgpu`, `three/tsl`). See [planet-material.md](planet-material.md). | `three` |


## Provider configuration

Configure shared application defaults once:

```ts
import { provideTriangularEngine } from 'triangular-engine';

bootstrapApplication(AppComponent, {
  providers: [provideTriangularEngine({ showFPS: true })],
});
```

Override settings for a scene or page when needed:

```ts
providers: EngineService.provide({ showFPS: false, pixelRatio: 1 });
```

## Input actions

Use `EngineInputService` for gameplay-facing bindings instead of coupling gameplay to DOM events:

```ts
const input = inject(EngineInputService);
input.bind('moveForward', 'KeyW', 'ArrowUp');
input.actions$.subscribe(({ action, type }) => {
  if (action === 'moveForward' && type === 'pressed') startMoving();
});
```

The raw event streams remain available on `EngineService` for low-level integrations.

## Profiling

`engine-stats` reports FPS, CPU frame time, draw calls, triangles, renderer resource counts, material count, estimated geometry/texture memory, and optional physics/asset timings. GPU timing is shown when a renderer integration provides it; otherwise it is displayed as `n/a`. When expanded, it also includes a 60-second rolling FPS graph with synchronized camera motion indicators (`<telemetry-sparkline>`) and a **Copy for Agent** button for instant token-efficient performance summaries.

Physics and custom asset pipelines can publish their timings through:

```ts
engine.fpsController.recordPhysicsTime(milliseconds);
engine.fpsController.recordAssetLoadingTime(milliseconds);
```

Pages add their own state to the **Copy for Agent** report with `telemetry.register`. Each section is a name and a set of `key: value` pairs, and it is appended after the engine's block. The provider runs only when the report is copied, so it can read signals directly. Keep the returned function and call it when the component is destroyed:

```ts
const unregister = engine.fpsController.telemetry.register('planet', () => ({
  morph: morphProgress(),
  patches: stats().desired,
}));
// in DestroyRef.onDestroy:
unregister();
```

Values may be strings, numbers, booleans or `null`; `undefined` entries are omitted.

A `<terrainSurface>` needs no provider code: set `telemetrySection` to a name and it publishes its own LOD and draw counts under that name. Leave it unset, the default, and it adds nothing to the report.

Sections are also captured when a frame drop is detected. The report then shows them under `drop_event` as `at drop:`, so the queue and residency from the dropped second are kept even if the report is copied later.

### Standalone Sparkline

`<telemetry-sparkline>` is also available standalone for custom HUDs and debug overlays:

```html
<telemetry-sparkline
  [values]="engineService.fpsController.fpsHistory()"
  [motionTags]="engineService.fpsController.cameraHistory()"
  [width]="180"
  [height]="36"
/>
```

