# 004 — Multi-surface terrain

## Status

- State: Phase 2 in progress; sphere adapter and fixed demo complete
- Target entry point: `triangular-engine/terrain`
- Initial consumers: infinite plane, sphere, O'Neill-cylinder interior
- Last updated: 2026-07-22

## Objective

Build one deterministic, patch-streamed terrain system whose procedural field,
mesh output, worker scheduling, rendering, and physics integration can be reused
across different base surfaces. Plane, sphere, and cylinder keep their own
coordinate mapping, topology, and patch-selection policy; they must not grow
separate noise or biome implementations.

This is height-displaced surface terrain (2.5D): one elevation per surface
coordinate. Caves, overhangs, tunnels, and arbitrary volumetric terrain are out
of scope.

## Relationship to existing work

- `003_oneill_cylinder_poc.md` remains authoritative for the active clouds and
  atmosphere POC. Its current textured inner cylinder is the first cylinder
  consumer, not the owner of terrain algorithms.
- Bruno's Space Program is the reference implementation for deterministic
  terrain definitions, biomes, cubesphere patches, workers, LOD scheduling,
  patch-local precision, and Jolt mesh colliders. Port contracts deliberately;
  do not move, delete, or destabilise BSP code while extracting them.
- `002_water_sublibrary.md` is separate, but terrain mesh output must later
  support water/shore depth effects without coupling terrain generation to
  water rendering.

## Locked architecture

```text
serializable terrain definition
            |
            v
compiled procedural field (shape-independent)
            |
            v
surface domain (plane | sphere | cylinder)
            |
            v
patch mesher -> patch-local transferable mesh
            |
            +-> renderer / LOD / workers
            +-> optional Jolt static mesh patches
```

### Shared responsibilities

- Seeded generator layers, masks, biomes, elevation bounds, and batch sampling.
- A canonical patch-mesh result with f64 patch centre and f32 local vertices.
- Scheduler lifecycle, generation tokens, stale-result rejection, caching, and
  worker protocol.
- Three.js buffer conversion and optional Jolt mesh-patch integration.

### Domain-owned responsibilities

- Patch address and neighbour topology.
- Mapping surface coordinates to base position, displaced position, base normal,
  and continuous procedural-field coordinates.
- Split/merge topology and conservative spatial/error bounds.
- Boundary rules: infinite plane, cubesphere edges, periodic cylinder seam and
  finite axial ends.

Do not implement one mesher containing growing `if (shape === ...)` branches.
The generic mesher consumes a domain adapter; each domain owns its mapping.

## Surface conventions

| Domain            | Coordinates          | Positive elevation | Topology                         |
| ----------------- | -------------------- | ------------------ | -------------------------------- |
| Plane             | absolute X/Z metres  | local +Y           | unbounded tiled quadtree/clipmap |
| Sphere            | body-fixed direction | away from centre   | six cubesphere quadtrees         |
| Cylinder interior | angle + axial metres | toward axis        | periodic angle × bounded axis    |

The current cylinder uses local X as its axis and YZ as its radial plane:

```text
base radial = (0, cos(angle), sin(angle))
position = (axialX, radialY * (radius - elevation), radialZ * (radius - elevation))
```

Cylindrical field coordinates must include axial position and use a periodic
embedding around the circumference (for example cos/sin), so terrain neither
repeats unchanged down the axis nor develops an angular seam.

End caps are separate geometry/domains in the first implementation. There is no
wall-to-cap topology transition in this track.

## Intended mode contract

```ts
type TerrainMode = "disabled" | "visual" | "physical";
```

- `disabled`: consumer's smooth fallback surface.
- `visual`: displaced rendered patches; fallback collision remains.
- `physical`: matching rendered and streamed static mesh-collider patches.

A mode/domain change invalidates outstanding work, destroys owned geometry and
colliders, recreates the sampler/selector/scheduler, and prevents old-generation
worker results from installing. The smooth fallback remains until initial
terrain coverage is ready.

## Package boundary

Proposed first-level layout:

```text
projects/triangular-engine/terrain/
  core/       definitions, field compiler, samples (framework-free)
  domains/    plane, sphere, cylinder mappings/topology
  meshing/    generic patch mesher, normals, skirts
  streaming/  selection contracts, scheduler, workers, cache
  three/      Three.js geometry/render composition
  jolt/       optional physics entry point, added later
```

The core/domain/mesh contracts must not import Angular, Three.js, Jolt, or DOM.
Rendering must not import Jolt. Physics consumes the same base surface triangles
as rendering and never includes visual skirts.

## Ordered phases

### Phase 0 — Contract and extraction audit

- [x] Inventory BSP terrain contracts and identify which are copied/generalised,
      which remain game-specific, and which require a breaking redesign.
- [x] Freeze plain TS interfaces for terrain field, domain adapter, patch
      addresses, patch mesh, and lifecycle/mode ownership.
- [x] Scaffold the `triangular-engine/terrain` secondary entry point.
- [x] Confirm framework-free dependency isolation through the independently
      built secondary entry point.

Exit gate: contracts compile and a constant-height fake domain produces a patch
without any plane/sphere/cylinder conditional in the generic mesher.

### Phase 1 — Infinite plane proof

- [x] Implement absolute-coordinate plane tiles and deterministic sampling.
- [x] Prove adjacent patch positions/normals agree and negative/unbounded tile
      addresses work.
- [x] Add a fixed-patch demo.
- [x] Add camera-local selection and eviction.
- [x] Verify patch-local precision under floating-origin-scale coordinates.

Exit gate: continuous terrain while travelling across tile boundaries, with
bounded resident geometry and no seed reset per tile.

### Phase 2 — Sphere adapter

- [x] Port/generalise BSP's canonical cubesphere projection and address rules.
- [x] Port edge, corner, normal, and precision fixtures.
- [ ] Port LOD fixtures.
- [ ] Compare output against BSP regression fixtures before adopting it.

Exit gate: all six faces stream without cracks or visible face seams.

### Phase 3 — Cylinder visual terrain

- [ ] Implement periodic angular × axial addressing and neighbour lookup.
- [ ] Generate inward-displaced patch-local meshes with inhabitant-facing
      normals and winding.
- [ ] Prove exact angular seam continuity and deliberate axial-end behaviour.
- [ ] Add `disabled | visual` to `/takram-cylinder-clouds`; preserve its current
      smooth textured cylinder as fallback.

Exit gate: the complete inner cylinder can toggle terrain without leaks, stale
patches, seam discontinuity, or damage to clouds/atmosphere.

### Phase 4 — Shared streaming and workers

- [ ] Generalise selection around domain-provided bounds/topology rather than
      forcing identical selection algorithms.
- [ ] Add generation tokens, stale rejection, parent retention, budgets, cache,
      and transferable worker results.
- [ ] Exercise fast travel and runtime mode/domain switching.

Exit gate: all three domains converge asynchronously without blank coverage or
unbounded geometry growth.

### Phase 5 — Physical terrain

- [ ] Add optional Jolt entry point consuming base mesh triangles.
- [ ] Stream static patches around relevant dynamic bodies, not only camera.
- [ ] Validate inward cylinder contact, patch-border behaviour, rebasing,
      teardown, and high-speed residency.
- [ ] Enable `physical` mode in the cylinder proof after the fixed-patch drop
      test succeeds.

Exit gate: bodies rest and travel on visibly matching terrain in plane, sphere,
and cylinder fixtures; disabling/switching removes every owned physics body.

## First implementation slice

Only Phase 0 is authorised by this initial plan. Do not modify the active
cylinder rendering yet. The first code slice should add the entry-point shell,
plain contracts, a constant field, a fake-domain mesher fixture, and focused
tests. Review those contracts before committing topology-specific code.

## Verification

Use focused terrain tests while contracts are being shaped, then build the
`triangular-engine` package. Build the demo app only in phases that touch a demo.
The user performs visual verification; do not browser-test unless requested.

Preserve all unrelated dirty/staged work. Never reset, restore, stash, clean, or
broadly stage this workspace.

## Open decisions

- Whether terrain definitions are adopted byte-for-byte from BSP `celestial` or
  versioned as a smaller engine contract with an adapter in BSP.
- Whether plane/cylinder selection share a reusable periodic-grid quadtree or
  only the scheduler interface.
- How physical fallback collision is hidden/replaced as resident mesh coverage
  arrives without masking tunnelling defects.
- Whether local terrain modifiers belong in core v1 or follow after the three
  domains prove the base contract.

## Investigation log

### 2026-07-22 — Initial architecture

- Chose a shape-independent procedural field plus shape-owned surface domains.
- Explicitly limited the system to height-displaced 2.5D surfaces.
- Chose plane first for the extraction proof, sphere second as the BSP parity
  gate, and cylinder third as the active POC integration.
- Reserved independent visual/physical modes and one lifecycle contract so the
  demo does not own worker, geometry, and collider cleanup itself.

### 2026-07-22 — Phase 0 foundation implemented

- Added the independently packaged `triangular-engine/terrain` entry point.
- Added framework-free `ITerrainField`, `ITerrainSurfaceDomain`, patch geometry,
  and patch mesh contracts plus a validated `ConstantTerrainField` fixture.
- Added a domain-independent patch mesher. It samples one ring outside the
  visible patch for edge normals, retains an f64 world centre, emits f32 local
  positions, chooses index width from vertex count, and delegates mapping,
  orientation, and geometric error to the domain.
- Proved the contract with a fake plane at billion-metre coordinates; no
  production plane/sphere/cylinder conditional exists in the mesher.
- Registered secondary-entry-point terrain specs in the library test target.
- Verification: focused terrain specs 4/4, complete triangular-engine suite
  43/43, and the development package build including the new terrain entry
  point all pass. No demo or active cylinder code was changed.

### 2026-07-22 — Phase 1 fixed-patch plane proof

- Added `PlaneTerrainDomain` with unbounded signed tile coordinates, quadtree
  levels, child addressing, absolute X/Z field coordinates, and +Y-facing
  surface orientation.
- Added adjacency fixtures proving shared-edge positions and normals match,
  including negative and billion-metre-scale addresses.
- Added `/terrain-lab` to the demo app. It renders 25 generated patches and can
  switch sampling between the origin and approximately one billion metres while
  retaining a small render-local coordinate frame.
- Added a toggleable border diagnostic that traces every patch's sampled outer
  edge, making the 25 independent meshes and their seamless joins explicit.
- Replaced the fixed address window with camera-local selection. Crossing a tile
  boundary installs the newly visible row/column and disposes patches that leave
  the bounded 5 × 5 resident window; stationary frames do no terrain work.
- Added a 20 km render-local orientation grid 100 m below terrain datum so large
  camera pans, rotations, and zoom-outs retain a stable spatial reference.

### 2026-07-22 — Phase 2 fixed-patch sphere proof

- Added `SphereTerrainDomain` using BSP's canonical six-face cubesphere mapping,
  quadtree addresses, outward elevation, direction-space field coordinates, and
  f64 centres with f32 patch-local vertices.
- Added a domain-owned optional normal sampler. Sphere normals use a canonical
  tangent frame derived only from the shared surface direction, so adjacent cube
  faces produce matching lighting normals instead of face-parameter derivatives.
- Added a 24-patch level-1 sphere mode to `/terrain-lab`; it reuses the generic
  mesher and the same wireframe and patch-border diagnostics as the plane.
- Kept floating-origin ownership outside the terrain package. Terrain emits f64
  world centres plus f32 local vertices; the example (and later BSP) applies the
  active render origin to patch objects.
- Verification: focused terrain specs 7/7, triangular-engine development build,
  and demo-app development build all pass.
