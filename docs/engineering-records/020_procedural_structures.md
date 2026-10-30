# 020 — Procedural structures (base & launch/catch infrastructure)

Status: In progress (M0–M4 initial implementation, 2026-08-21).

Related plans:

- [014_procedural_sublibrary.md](014_procedural_sublibrary.md) — the parent procedural design. Flora, ground-cover, and parts all live under `triangular-engine/procedural`; structures is the fourth domain in the same entry point.
- [016_procedural_parts.md](016_procedural_parts.md) — procedural parts for craft/vessels. Structures shares the primitive-solid assembly model, mass math, and multi-link kinematics with parts, but specializes in ground footprints and infrastructure sockets.
- [005_scatter_sublibrary.md](005_scatter_sublibrary.md) — Jolt primitive collider descriptors format and streaming residency.
- [013_sketch_sublibrary.md](013_sketch_sublibrary.md) — human-authored structural solids.
- [008_spline_sublibrary.md](008_spline_sublibrary.md) — continuous parametric linear curves (roads, tracks).

## Goal

Seed-driven, deterministic, low-poly procedural **structures and buildings** for spaceports, surface bases, and mobile recovery platforms:
- **Modular Runways** (variable length/width, centerline markings, approach pylons, touchdown zones).
- **Launch Tables & Landing Pads** (flame trench geometries, blast deflectors, deluge towers).
- **Launch & Catch Towers** (Mechazilla-style multi-link vertical carriage + chopstick arms).
- **Linear Accelerators & Mass Drivers** (modular support pylons, electromagnetic stator coils, guide rails).
- **Vacuum Centrifuges / SpinLaunch** (large vacuum chamber housing, high-RPM rotor arm, angled exit chimney).
- **Marine Recovery Platforms** (ASDS drone ship decks, 4-cable winch masts).

```
(archetype params, seed) → structure variant {
  solids,       // concrete primitive-solid assembly
  footprint,    // 2D bounding envelope & terrain flattening descriptor (rect/circle)
  mesh,         // BufferGeometry (merged) + Three.js Group helper for multi-link animation
  sockets,      // typed functional points: spawn-point, touchdown-zone, catch-zone, cable-anchor, power-in
  colliders,    // Jolt-compatible primitive descriptors (static compound ready)
  mass,         // closed-form volume & dry mass properties
  joints        // multi-link kinematic joints (hinges, elevators, sliders)
}
```

## Core Principles

1. **Clean Separation of Concerns**:
   - `triangular-engine/procedural/structures` owns the **geometry engine, kinematic pose solvers, socket transforms, 2D footprint bounds, and Jolt collider synthesis**.
   - The game (`brunos-space-program`) owns the **production catalogs, launch controllers, soft-docking catch solvers, and dynamic vehicle-mounted recovery sites**.
   - Any presets in `triangular-engine` are **demo fixtures only** for unit tests and the interactive `/structures-lab`.
2. **Terrain Integration via 2D Footprints**:
   - Every structure archetype declares an exact 2D footprint (`rect`, `circle`, `corridor-polygon`) with embed depths.
   - Sits flush against planetary terrain, providing exact inputs for SAT overlap checks and local terrain flattening (`localFlatten`).
3. **Multi-Link Kinematic Hierarchy**:
   - Unlike parts (which only needed a single hinge in v1), structures frequently require multiple kinematic degrees of freedom:
     - `link-0`: Ground foundation / static tower truss.
     - `link-1`: Vertical elevator carriage ($Y$-axis prismatic motion).
     - `link-2` & `link-3`: Left and right pivoting chopstick arms (hinge revolute motion).
     - `link-rotor`: SpinLaunch centrifuge rotor arm ($Z$-axis continuous rotation).
4. **Soft-Docking Catch Sockets vs. Explosive Mesh Collisions**:
   - Catch structures expose typed 3D `catch-zone` volumes. Catching is solved in gameplay via kinematic velocity matching and spring damping rather than raw high-velocity physics mesh impacts.

## Sockets Specification

```ts
export type StructureSocketKind =
  | 'spawn-point'       // Vessel launch / spawn initial pose
  | 'touchdown-zone'    // Flat landing slab target
  | 'catch-zone'        // 3D catchment funnel (chopsticks / cable web)
  | 'cable-anchor'      // Winch anchor positions for tensioned recovery
  | 'refuel-dock'       // Propellant / umbilical service mast
  | 'power-in'          // Electrical grid connection point
  | 'corridor-node'     // Base habitat modular corridor snap node
  | 'perch'             // Wildlife / maintenance drone landing perch
  | 'custom';
```

## Physics & Jolt

- Every collidable solid emits a primitive descriptor (`box`, `sphere`, `cylinder`, `capsule`, cone-as-cylinder approximation).
- Structures assemble into a single static compound Jolt rigid body on the planetary surface frame.
- Kinematic moving appendages (chopsticks, radar antennas) are animated purely visually via Three.js `Group` or re-posed kinematic colliders.

## Milestone Roadmap

- **M0**: Scaffolding, `IStructureSolid`, `IStructureArchetype`, schema validation, 2D footprint contract.
- **M1**: Skeleton generator + mesh builders (merged `BufferGeometry` + multi-link `Group`).
- **M2**: Sockets, Jolt compound colliders, closed-form mass properties, multi-link joint pose solver.
- **M3**: Demo fixtures catalog (`DEMO_RUNWAY`, `DEMO_LAUNCHPAD`, `DEMO_CHOPSTICK_TOWER`).
- **M4**: Interactive demo lab at `/structures-lab` (with live joint sliders, socket gizmos, drop ball physics, and Jolt debug rendering).
