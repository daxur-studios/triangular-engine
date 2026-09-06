---
type: Architecture Note
title: procedural
description: TODO: describe purpose + why, not what
timestamp: 2026-09-06T23:49:03.783Z
generated: true
tags: [token-map, stub]
---

# projects/triangular-engine/procedural

<!-- doc-section section-id="sec_1051eb08db18" path="projects/triangular-engine/procedural" baseline-tokens="171834" -->
Deterministic procedural generation sublibrary for synthetic 3D assets, macro-scale architecture, and ecological environments. Designed around seedable deterministic random streams and hierarchical assembly grammars, separating geometry synthesis from Three.js render loops so asset creation can run in workers or background tasks without thread stalls.

### Subsystems & Domains

- **Core & Generators (`procedural/core`)**: Seeded PRNGs, noise functions, spline utilities, and geometric layout algorithms.
- **Vegetation & Ecology (`procedural/flora`, `ground-cover`)**: Algorithmic trees, shrubs, foliage density profiles, and ground clutter.
- **Civil Infrastructure (`procedural/cities`, `structures`)**: Road network graph extraction, building footprints, zoning, and procedural structural facades.
- **Modular Assembly (`procedural/parts`, `furniture`)**: Part sockets, snap boundaries, and generative prop composition.
- **Creatures & Avatars (`procedural/characters`)**: Procedural mesh generation for humanoid and non-humanoid entities.

### Design Principles

1. **Determinism**: Identical seeds must produce identical geometry and topology across platforms and runs.
2. **BufferGeometry Output**: Output clean, indexed `BufferGeometry` structures ready for instancing or batching to minimize WebGL draw calls.
<!-- /doc-section -->
