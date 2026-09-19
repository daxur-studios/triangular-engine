---
type: Architecture Note
title: pages
description: TODO: describe purpose + why, not what
timestamp: 2026-09-06T23:48:26.110Z
generated: true
tags: [token-map, stub]
---

# projects/demo-app/src/app/pages

<!-- doc-section section-id="sec_2e04ee384dbd" path="projects/demo-app/src/app/pages" baseline-tokens="403464" -->
Houses the interactive feature showcases, proof-of-concept (POC) spikes, and engineering diagnostic fixtures for `triangular-engine`. These routed pages provide in-browser validation environments for Three.js rendering pipelines, physics integrations, procedural generation, and planetary scale experiments before or alongside library formalization.

### Structure & Categories

- **Catalogs & Navigation**:
  - `demo-index`: Curated showcase of stable consumer-facing engine capabilities.
  - `spikes-index`: Complete directory of all experimental labs and diagnostic fixtures.
- **Water & Hydrodynamics**:
  - `water`, `water-buoyancy-poc`, `water-cylinder-poc`, `water-lod-poc`, `water-surface-spike`: Clipmap LOD validation across planar, spherical, and O'Neill cylindrical domains.
- **Planetary Terrain & Meshing**:
  - `cell-planet-lab`, `cdlod-planet-lab`, `terrain-composer-lab`: Evaluation of Voronoi cell partitioning, quadtree LOD, and GPU heightfield rendering.
  - `cell-subdivision-lod-lab`: Spike 3 (not performant) evaluating region-scoped Voronoi cell subdivision for crack-free LOD boundaries.
- **Procedural Generation & Ecology**:
  - `animals-lab`, `animals-herd-worlds-lab`, `flora-lab`, `structures-lab`, `cities-lab`, `life-lab`: Generative ecosystems, flocking behaviours, and procedural asset synthesis.
- **Atmosphere & Physics**:
  - `takram-clouds`, `takram-mini-planet`, `cloud-puffs-lab`, `planet-physics-lab`, `soft-body-poc`: Volumetric cloud shaders, gravity fields, and constraint solvers.

### Architectural Rules

1. **One-Way Dependency**: Pages import from `triangular-engine` (or linked library dist builds); library source code must never import from `demo-app`.
2. **Diagnostic vs Demo**: Maintain clear separation between consumer-ready reference implementations (`demo-index`) and rough diagnostic fixtures (`spikes-index`).
<!-- /doc-section -->
