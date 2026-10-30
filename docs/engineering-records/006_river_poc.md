# 006 — River POC and spline/hydrology direction

## Status

- State: POC visually accepted in the demo; ready for contract hardening
- Current consumer: `/river-lab`
- Current implementation: demo-local, not yet a published secondary entry point
- Last updated: 2026-08-01

## Objective

Prove that a river can be represented once and consumed by terrain and water
rendering without either sub-library importing the other. The first slice is a
procedural river: a deterministic centreline with per-point elevation, width,
and downstream flow. The same description must be usable for a future authored
spline and for generated drainage networks.

The POC is deliberately height-field based. It does not attempt caves,
overhangs, braided channels, hydraulic erosion, a full river network editor, or
production-quality water shading.

## Current vertical slice

```text
procedural generator
        |
        v
RiverPath (centreline + width + elevation + flow)
        |
        +--> RiverCarvedTerrainField --> triangular-engine/terrain
        |
        +--> bounded water ribbon + flow shader
             (implements the triangular-engine/water WaterSurface contract)
```

The current demo code lives in:

- `projects/demo-app/src/app/pages/river-lab/river-system.ts`
- `projects/demo-app/src/app/pages/river-lab/river-lab-page.component.ts`
- `projects/demo-app/src/app/pages/river-lab/river-system.spec.ts`

`RiverPath` is the canonical runtime sample for height, normal, and flow.
`RiverCarvedTerrainField` composes channel depth and bank falloff over an
existing `ITerrainField`; terrain remains unaware that the modifier came from a
river. The demo ribbon is bounded and follows the sampled centreline, unlike
the existing large plane/sphere/cylinder water renderer.

## Locked boundaries

### Terrain

Terrain owns surface domains, patch selection, meshing, LOD, and optional
colliders. It consumes a composed `ITerrainField`. It must not import a river
or water package to carve a channel.

### Water

Water owns surface sampling, flow queries, bounded-surface rendering,
depth/shore treatment, and water interaction. A river surface is one
implementation of `WaterSurface`; it is not an ocean motion preset.

### Spline/path data

The future spline package owns geometry and authoring-neutral path operations:

- open and closed paths;
- control points and interpolation;
- arc-length sampling;
- tangent, normal, width, and profile channels;
- stable serialization and deterministic evaluation.

It must not know how a path is rendered as water, carved into terrain, or used
as a road.

### Hydrology

The future hydrology package owns river-specific semantics:

- sources, mouths, tributary links, and flow direction;
- monotonic downstream constraints;
- width/depth discharge profiles;
- procedural drainage generation from terrain;
- modifiers that turn a network into terrain and water consumers.

Hydrology may depend on spline contracts and terrain sampling contracts, but
terrain and water must remain independent of hydrology.

## Next steps

### Phase 0 — POC visual verification

- [x] Verify `/river-lab` from above, at channel level, and underwater.
- [x] Verify the river remains aligned while orbiting and zooming.
- [x] Verify logarithmic depth with terrain both above and below the water.
- [x] Verify no visible cracks at terrain patch boundaries or river endpoints.
- [x] Verify the flow direction is visually downstream for the complete path.

Exit gate: the user can inspect the scene and the river reads as a carved,
flowing channel rather than a ribbon hovering over terrain.

### Phase 1 — Stabilize the shared path contract

- [ ] Extract the framework-free path types from the demo into a reviewed
      contract, still without publishing a new package.
- [ ] Replace nearest-segment-only sampling with arc-length tables and a
      documented out-of-bounds policy.
- [ ] Add explicit bank profile, bed profile, and surface-normal contracts.
- [ ] Add tests for reversed paths, short segments, zero-width rejection,
      monotonic flow, and deterministic serialization.
- [ ] Define how a path reports joins, endpoints, and tributary branches.

Exit gate: a hand-authored path and a generated path produce identical samples
for the same serialized data.

### Phase 2 — Production bounded water surface

- [ ] Add a framework-free bounded ribbon/strip renderer to
      `triangular-engine/water`.
- [ ] Move the demo flow shader to the water package and use the existing
      logarithmic-depth shader chunks by default.
- [ ] Add shore fade based on shared bathymetry, not an independent visual
      approximation.
- [ ] Support segment LOD, endpoint caps, joins, and optional bank foam.
- [ ] Make CPU `getHeight/getNormal/getFlow` use the exact same river profile
      that drives the GPU surface.

Exit gate: a bounded water surface can be mounted by a non-demo consumer and
passes CPU/GPU alignment, depth, disposal, and log-depth tests.

### Phase 3 — Terrain channel modifier

- [ ] Extract `RiverCarvedTerrainField` as a generic terrain modifier only if
      the field-composition contract is accepted by terrain maintainers.
- [ ] Add width/depth/bank profiles and a configurable blend policy.
- [ ] Add optional sediment/biome masks as outputs rather than baking river
      colours into the terrain field.
- [ ] Add matching terrain-collider sampling after visual carving is stable.

Exit gate: visual terrain, generated river bed, and optional collider agree at
patch boundaries and after LOD replacement.

### Phase 4 — Procedural drainage and authored splines

- [ ] Add a deterministic drainage generator that traces downhill paths,
      resolves flats and pits, and creates a directed river network.
- [ ] Add tributary confluences and discharge accumulation.
- [ ] Add an authored spline adapter using the same network/path runtime data.
- [ ] Demonstrate the same consumer pipeline for a road, lake shoreline, and
      ocean boundary without adding feature branches to terrain or water.

Exit gate: generated and authored networks share serialization, sampling,
terrain modification, water rendering, and flow semantics.

## Proposed package layout

```text
triangular-engine/spline/       # generic open/closed paths and sampling
triangular-engine/hydrology/   # river networks and terrain-driven generation
triangular-engine/terrain/     # field composition and surface meshing
triangular-engine/water/       # bounded water rendering and WaterSurface
```

Do not create a `river` package that owns all four concerns. Rivers are a
consumer of shared path, terrain, and water contracts; making them a monolith
would make roads, lakes, and oceans repeat the same architecture.

## Non-goals for this POC

- physically simulated erosion;
- volumetric water or tunnels;
- automatic global watershed generation;
- editor UI or spline gizmos;
- terrain colliders before the visual field/carving contract is stable;
- replacing the existing ocean/lake renderer with the river ribbon.

## Verification

Run the focused river tests and demo build while the contract is demo-local:

```text
npx ng test demo-app --watch=false --browsers=ChromeHeadless \
  --include=projects/demo-app/src/app/pages/river-lab/river-system.spec.ts
npx ng build demo-app --configuration development
```

Visual acceptance remains a user check. Preserve unrelated dirty/staged work;
do not reset, restore, stash, clean, or broadly stage the workspace.

## Decision log

### 2026-08-01 — Initial River POC

- Added `/river-lab` with a deterministic procedural centreline.
- Used one `RiverPath` for terrain carving and water height/flow sampling.
- Kept rendering demo-local because the bounded river renderer is a new water
  capability, not an ocean preset.
- Used the water package's shared logarithmic-depth GLSL chunks in the custom
  ribbon shader so it composes correctly with the terrain renderer.
- Chose spline plus hydrology as future sibling concerns rather than coupling
  either `terrain` or `water` to a river-specific implementation.

### 2026-08-01 — Visual acceptance

- User visually verified the River POC and reported that it looks good.
- Phase 0 is complete. Follow-up work should focus on the framework-free path
  contract and sampling semantics, not additional demo-scene polish.
