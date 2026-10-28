# Triangular Engine

Angular-first 3D engine powered by Three.js, with optional physics and UI integrations. Build interactive 3D scenes using ergonomic standalone Angular components for scenes, cameras, meshes, lights, materials, GLTF loading, physics, and more.

This page is the index. Each secondary entry point documents itself in its own `README.md`, which ships in the package beside the entry's code (`node_modules/triangular-engine/<entry>/README.md`). Cross-cutting guides live in [`docs/`](docs/README.md), which also ships.

## Start here

- [Getting started](docs/getting-started.md): compatibility, install, first scene, Draco and assets
- [Core concepts](docs/core-concepts.md) and [components](docs/components.md)
- [Services](docs/services.md) and [assets and loading](docs/assets-and-loading.md)
- [Secondary entry points](docs/entry-points.md): the import and peer-dependency matrix
- [Troubleshooting](docs/troubleshooting.md)
- [CHANGELOG](CHANGELOG.md): release history
- AI agents: the shipped `triangular-engine` skill (`skills/triangular-engine/SKILL.md` in the installed package) holds the agent conventions and points at the entry guides below.

Install a standalone Angular app with:

```bash
ng add triangular-engine
```

Manual installation and peer versions are in [getting started](docs/getting-started.md).

For reusable game tests and one-click visual or performance test URLs, use the `triangular-engine-testing` skill (`skills/triangular-engine-testing/SKILL.md` in the installed package) and the [testing guide](testing/README.md).

## Features

- Standalone Angular components: `scene`, `camera`, `mesh`, `materials`, `lights`, `gltf`, `physics`, `particleEmitter`, `audioListener`, `positionalAudio`, `ambientAudio`, `css2d/css3d`, post-processing, and more
- Declarative Object3D graph with inputs for `position`, `rotation`, `scale`, `visible`, and common options
- High-performance GPU-instanced Particle & VFX System (`<particleEmitter>`, `VfxService`) with presets (fire, smoke, sparks, explosion, magic, snow, rain)
- 3D Spatial Audio & Multi-Bus Mixer (`<audioListener>`, `<positionalAudio>`, `<ambientAudio>`, `AudioService`)
- Rapier 3D physics integration: rigid bodies, colliders, joints, instanced rigid bodies
- GLTF loader with optional BVH acceleration for fast raycasts
- Engine UI helpers: stats overlay and Portal Layout HUD, with opt-in Material Scene Tree inspection
- Signals-based services: engine tick, inputs, and camera switching
- Stacking overlays: support top, bottom, left sidebar, right sidebar, main, modal, and notification layers

## Entry points

Import optional features from their secondary entry point so applications only ship what they use. The table links each entry to its guide.

| Import | Guide | What it provides | Optional peer |
| --- | --- | --- | --- |
| `triangular-engine` | [Core guide](docs/README.md) | Scene graph, cameras, lights, geometry, materials, GLTF, services, portal UI, renderer lifecycle | — (Angular, `three`, `dexie`, `three-mesh-bvh`, `rxjs`, `@daxur-studios/portal-layout`) |
| `triangular-engine/development-map` | [development-map/README.md](development-map/README.md) | Reusable data-driven view for project branches, example pages, plans, scope changes and saved evidence | Angular Common/Core; optional `@daxur-studios/mermaid-runtime` for relationship cards |
| `triangular-engine/scene-tree` | [scene-tree/README.md](scene-tree/README.md) | Material Scene Tree inspection panel | `@angular/material` |
| `triangular-engine/testing` | [testing/README.md](testing/README.md) | Browser test runner, launch and result contracts, adapter executor | — |
| `triangular-engine/rapier` | [rapier/README.md](rapier/README.md) | Rapier rigid bodies, colliders, joints, physics components | `@dimforge/rapier3d-compat` |
| `triangular-engine/jolt` | [jolt/README.md](jolt/README.md) | Jolt physics, constraints, debug rendering, high-precision workflows | `jolt-physics` |
| `triangular-engine/pmndrs` | [pmndrs/README.md](pmndrs/README.md) | Billboard and sparkles wrappers | `@pmndrs/vanilla` |
| `triangular-engine/postprocessing` | [postprocessing/README.md](postprocessing/README.md) | Declarative effect composer and passes | `postprocessing` |
| `triangular-engine/atmosphere` | [atmosphere/README.md](atmosphere/README.md) | Planet atmosphere profiles, lookup tables, WebGPU sky renderer | — |
| `triangular-engine/planet-material` | [planet-material/README.md](planet-material/README.md) | TSL cell-planet surface material for `WebGPURenderer` | `three` |
| `triangular-engine/worldgen` | [worldgen/README.md](worldgen/README.md) | Framework-free Voronoi cell-graph planets, tectonics, ecology, samplers | — |
| `triangular-engine/worldgen/render` | [worldgen/render/README.md](worldgen/render/README.md) | Cell-planet 3D globe ↔ 2.5D map morphing, maps, borders, overlays | `three` |
| `triangular-engine/water` | [water/README.md](water/README.md) | Plane, sphere and cylinder water, LOD, underwater effects, sampling | `three` |
| `triangular-engine/terrain` | [terrain/README.md](terrain/README.md) | Domain-aware terrain fields, patch meshing, streamed LOD | — |
| `triangular-engine/gpu-data-flow` | [gpu-data-flow/README.md](gpu-data-flow/README.md) | CPU/GPU/worker transport: upload and readback rings, job scheduler | — |
| `triangular-engine/meshoptimizer` | [meshoptimizer/README.md](meshoptimizer/README.md) | Indexed-geometry simplification helpers | `meshoptimizer` |
| `triangular-engine/image-compression` | [image-compression/README.md](image-compression/README.md) | Screenshot and impostor compression adapter | `browser-image-compression` |
| `triangular-engine/scatter` | [scatter/README.md](scatter/README.md) | Deterministic streamed placement and instanced LOD rendering | — |
| `triangular-engine/scatter/tsl` | [scatter/tsl/README.md](scatter/tsl/README.md) | TSL twins of the scatter density field, for surface materials | `three` |
| `triangular-engine/spline` | [spline/README.md](spline/README.md) | Open and closed curves, arc-length sampling, nearest-point queries | — |
| `triangular-engine/characters` | [characters/README.md](characters/README.md) | Humanoid rigs, locomotion, IK, facial animation channels | — |
| `triangular-engine/procedural` | [procedural/README.md](procedural/README.md) | Procedural flora and craft parts with sockets and colliders | `three` |
| `triangular-engine/celestial` | [celestial/README.md](celestial/README.md) | Keplerian orbits, atmospheric and gravity models, planet presets | — |
| `triangular-engine/navigation` | [navigation/README.md](navigation/README.md) | Navigation data contracts and bounded route scheduling | — |
| `triangular-engine/animals` | [animals/README.md](animals/README.md) | Deterministic animal flocks and world responses | — |
| `triangular-engine/life` | [life/README.md](life/README.md) | Fixed-step autonomous-agent movement and flocking | — |
| `triangular-engine/impostor` | [impostor/README.md](impostor/README.md) | Octahedral impostor baking and rendering | — |
| `triangular-engine/trail` | [entry points](docs/entry-points.md) | Ribbon trails, stamp decals, surface-track geometry | — |

The full matrix, including sub-entries such as `triangular-engine/water/jolt`, `triangular-engine/terrain/core` and `triangular-engine/worldgen/render/core`, is in [entry points](docs/entry-points.md).

## Compatibility

Angular ^20.3.3, Three.js ^0.186.0, Dexie ^4.2.1, RxJS ^7.8.0, three-mesh-bvh ^0.9.9, `@daxur-studios/portal-layout` ^0.0.1. Optional: Rapier `@dimforge/rapier3d-compat` ^0.18.0 or Jolt `jolt-physics` ^1.0.1, `@pmndrs/vanilla` ^1.24.0, and `@angular/material` ^20.2.14 for the Scene Tree. The full peer list is in [getting started](docs/getting-started.md).
