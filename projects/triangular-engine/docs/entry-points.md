# Secondary entry points

Import optional features from their secondary entry point so applications only ship what they use.

| Import | Purpose | Optional dependencies |
| --- | --- | --- |
| `triangular-engine` | Core Angular/Three.js scene graph, cameras, lights, geometry, materials, GLTF, services, UI, and renderer lifecycle. | `three`, `dexie`, `three-mesh-bvh` |
| `triangular-engine/rapier` | Rapier rigid bodies, colliders, joints, and physics components. | `@dimforge/rapier3d-compat` |
| `triangular-engine/jolt` | Jolt physics, rigid bodies, constraints, debug rendering, terrain/scatter adapters, and high-precision workflows. | `jolt-physics` |
| `triangular-engine/pmndrs` | Angular components for PMNDRS billboard and sparkles helpers. | `@pmndrs/vanilla` |
| `triangular-engine/postprocessing` | Declarative effect composer and post-processing effects. | `postprocessing` |
| `triangular-engine/takram` | Atmosphere, aerial perspective, sky/sun lighting, and cloud components. | `@takram/three-atmosphere`, `@takram/three-clouds`, `@takram/three-geospatial` |
| `triangular-engine/water` | Plane, sphere, and cylinder water surfaces, LOD, quality/motion presets, underwater effects, and surface sampling. | `three` |
| `triangular-engine/water/jolt` | Water buoyancy integration with Jolt. | `jolt-physics` |
| `triangular-engine/water/postprocessing` | Water-specific post-processing effects. | `postprocessing` |
| `triangular-engine/terrain` | Domain-aware terrain fields, patch meshing, surface sampling, and streamed LOD selection. | — |
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

`engine-stats` reports FPS, CPU frame time, draw calls, triangles, renderer resource counts, material count, estimated geometry/texture memory, and optional physics/asset timings. GPU timing is shown when a renderer integration provides it; otherwise it is displayed as `n/a`.

Physics and custom asset pipelines can publish their timings through:

```ts
engine.fpsController.recordPhysicsTime(milliseconds);
engine.fpsController.recordAssetLoadingTime(milliseconds);
```
