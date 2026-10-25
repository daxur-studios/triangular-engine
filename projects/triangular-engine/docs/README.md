# Triangular Engine Documentation

These guides ship in the npm package at `node_modules/triangular-engine/docs/`. The package [README](../README.md) indexes them and every entry point's guide.

## Cross-cutting guides

- [Getting started](getting-started.md): install, first scene, Draco and assets
- [Core concepts](core-concepts.md): `EngineModule`, `EngineService`, `<scene>`, the frame loop
- [Components](components.md): nodes, geometry, materials, lights, cameras, controls
- [Services](services.md): engine, physics, loader and settings services
- [Assets and loading](assets-and-loading.md): GLTF, textures, Draco
- [Shadows](shadows.md): cascaded shadow maps
- [Particles and VFX](particles.md) and [audio](audio.md)
- [Secondary entry points](entry-points.md): the import matrix and peer dependencies
- [Troubleshooting](troubleshooting.md)
- [API: selectors](api/selectors.md)
- Examples: [basic scene](examples/basic-scene.md), [multi-viewport](examples/multi-viewport.md)

## Entry-point guides

Each secondary entry point has its guide in `<entry>/README.md`, next to its code. Entries with a guide of their own include:

- [Rapier physics](../rapier/README.md) and [Jolt physics](../jolt/README.md)
- [PMNDRS helpers](../pmndrs/README.md)
- [Atmosphere](../atmosphere/README.md) and [planet material](../planet-material/README.md)
- [Cell planets](../worldgen/render/README.md) and [worldgen](../worldgen/README.md)
- [GPU data flow](../gpu-data-flow/README.md)
- [Procedural](../procedural/README.md) and [characters](../characters/README.md), including facial animation
- [Water](../water/README.md), [terrain](../terrain/README.md) and [scatter](../scatter/README.md)
- [Testing](../testing/README.md) and [Scene Tree](../scene-tree/README.md)
- [Takram clouds and atmosphere](../takram/README.md)

## Rules for new entry points and public API

- A new entry point documents itself in `<entry>/README.md`, beside its `public-api.ts`. Add it to the index in the package README and to [entry points](entry-points.md). Do not add a guide for entry-specific behaviour to this folder.
- Give each public symbol TSDoc. IDE hovers show it to consumers, so it should say what the symbol does, its units or frame where that matters, and what happens on failure.
- This folder holds only cross-cutting guides. Keep them accurate against the current public API, because the packaged skill and the entry guides link into them.
