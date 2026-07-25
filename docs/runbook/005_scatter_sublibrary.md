# 005 — Ground scatter sub-library

## Status

- State: Phases 0-3 complete. Phase 3 (`scatter-physics-lab`: driveable
  rover, throwable rock, click-to-cut, drive-into-tree felling,
  residency-ring debug viz, HUD counters) is runtime-verified in-browser —
  both bugs found during play-testing (stale debug-renderer wireframe on
  felled trees; walk-speed unconditionally felling every tree) are fixed and
  confirmed working. Leftover diagnostic `console.warn` logging removed from
  the demo page. Phases 4-5 not started.
- Entry point: `triangular-engine/scatter` (decided — "foliage" rejected as
  the name because rocks/stones/clutter are first-class, not an exception)
- Initial consumers: `scatter-lab` demo page (`projects/demo-app`), terrain-lab
  demo surfaces, Bruno's Space Program planets
- Last updated: 2026-07-25

## Objective

Build one instanced ground-scatter system that covers trees, grass, shrubs,
rocks, stones, and other small surface clutter across every terrain domain
(plane, sphere, cylinder). Games define scatter as serializable data (species +
placement rules + density inputs) and get deterministic placement, streaming,
LOD, optional wind, optional Jolt collisions, and stable per-instance identity
for interaction (cutting trees, mining rocks, crash destruction).

Reference point: the KSP Parallax mod, which treats trees, grass, rocks, and
ice chunks as one unified scatter system rather than separate features. The
differences between object types are traits (wind, collider, interactable),
not separate systems.

## Core decision — instances are derived data

Scatter instances are never stored scene objects. The system stores rules
(species definition + density function + seed); each cell deterministically
derives its instances when it streams in and discards them when it streams
out. Determinism gives:

- Streaming with zero persistence: regenerating a cell yields identical
  instances.
- Stable instance IDs for gameplay: "this tree was cut" is a delta overlay
  set persisted by the game, not by this library.
- Derived physics: colliders are spawned for nearby instances only and can
  always be re-derived.

### Identity — candidate sets, not indices

Instance IDs are **not** `cell + accepted-array index`: changing density or
placement rules would renumber every later instance. Instead each cell
deterministically generates a fixed-size **candidate set**; identity is:

```text
world seed + layer ID + species ID + generator version
  + canonical cell key + candidate key
```

Density is a deterministic threshold over candidate hashes: raising density
reveals more candidates without moving or renumbering existing instances.
Consequence: maximum density per cell is bounded by the candidate-pool size,
and pool size is part of `generator version` — changing it is a breaking
regeneration, by design.

## Three groupings that must never be conflated

External review's strongest point, adopted as a hard rule. These are three
independent axes, not one abstraction:

1. **Identity/generation cells** — deterministic identity and streaming
   residency. Fixed per layer; never change with camera distance.
2. **Render batches** — how many cells share one `InstancedMesh`. Free to
   merge cells into pages for draw-call budgets; free to change at runtime.
3. **Physics residency** — which instances currently have colliders. Follows
   players and fast vehicles (with velocity look-ahead), not the camera, and
   uses its own radius.

Terrain patches (the visual quadtree cut) are a fourth, unrelated axis.
Phase 1 may ship one batch per cell, but the public API must keep identity
separate from batching from day one.

### Identity cells are fixed-level patch addresses

Original draft mapped scatter cells 1:1 to the *adaptive* terrain cut —
rejected: the cut splits/merges with camera movement, so instances would be
regenerated under different addresses (unstable IDs, transient duplicates).

The fix reuses existing machinery rather than inventing a parallel grid:
scatter cells are terrain patch addresses **at one fixed quadtree level per
layer** (trees coarser, grass finer). This inherits domain topology, bounds,
and field mapping for free, stays stable regardless of the visual cut, and
still allows per-layer cell sizing. Scatter samples the underlying
`ITerrainField` directly — never the currently rendered terrain mesh.

## Relationship to existing work

- `004_multi_surface_terrain.md` owns the surface. Scatter consumes the
  surface-sampler contract below plus domain addressing.
- Jolt bridge lives in the existing `triangular-engine/jolt` entry as a
  `ScatterJoltColliderAdapter`, following the `TerrainJoltColliderAdapter`
  precedent (`jolt/terrain/`). Scatter core must not import Jolt, and Jolt
  is not an optional peer of scatter itself.
- Tessellated PBR terrain materials, orbit planet textures, and raymarched
  orbit shadows (the rest of the Parallax feature list) are terrain-lib
  scope, not scatter scope.

## New constraint on the terrain lib — surface sampler contract

`ITerrainField` returns elevation only; scatter needs position, normal, and
slope on the *same displaced surface the terrain renders*. Terrain must gain
one canonical sampler shared by terrain meshing, scatter, biome evaluation,
and physics placement, roughly:

```ts
interface ITerrainSurfaceSample {
  fieldPosition: TerrainVector3;
  worldPositionM: TerrainVector3;   // f64
  anchorRelativeM: TerrainVector3;  // f32-safe, relative to cell anchor
  normal: TerrainVector3;
  elevationM: number;
  slope01: number;
}
```

This subsumes the earlier displacement-sync rule: all displacement lives in
CPU-sampleable field code (or an identical noise function exposed to both CPU
and shader), never shader-only — otherwise rocks float and grass sinks.
Decide before terrain material work advances. This sampler is implementation
step 1, before any scatter code.

## Agreed architecture

```text
terrain ──── surface sampler ──────► scatter
                                        ▲
biomes (future sibling) ─ suitability ──┤
painted masks / game rules ─────────────┘

scatter collider descriptors ─────► jolt: ScatterJoltColliderAdapter
```

### Module layout

One public secondary entry point, `triangular-engine/scatter`, with
dependency-disciplined internal folders (separate `scatter/core` /
`scatter/rendering` entry points rejected as premature):

```text
scatter/
  core/         definitions, candidate IDs, placement, overlays (no three.js)
  surface/      generic surface/cell contracts
  terrain/      adapter onto terrain domains + surface sampler
  three/        batches, LODs, billboards, wind, picking
  components/   optional Angular convenience components
```

### Species definitions are serializable

Definitions carry **asset keys, never Three.js objects** — a runtime resolver
maps keys to geometries, materials, billboard atlases, and collider shapes.
This keeps definitions usable in workers and save files.

```ts
interface ScatterSpeciesDefinition {
  id: string;
  assetKey: string;
  placement: ScatterPlacementRules;
  lods: ScatterLodDefinition[];
  wind?: ScatterWindDefinition;
  collider?: ScatterColliderDefinition;
  interaction?: ScatterInteractionDefinition;
}
```

### Species traits

- **Wind** (vegetation): vertex-shader-only, per-instance phase attribute,
  time uniform from the engine tick. Zero CPU cost per instance. Wind, like
  everything here, is **surface-relative**: on a sphere or cylinder "up" is
  the instance's local surface frame, not global Y — applies to bending,
  billboard orientation, and alignment. `onBeforeCompile` stays an internal
  implementation detail, never public API.
- **Collider**: which LOD ring gets physics, and what shape.
- **Interactable**: exposes stable IDs to the game for cut/mine/destroy
  overlays.

### Placement rules (per species)

- Alignment: align-to-normal (grass follows slope) vs align-to-surface-up
  (trees grow vertical in the local frame) vs random tumble (rocks).
- Embed depth: boulders half-sunk into the ground.
- Slope windows: grass on flats, scree on cliffs.
- Altitude/latitude bands, feeding into the suitability function.

### Rendering ladder

Per species: full mesh → low-poly mesh → billboard/impostor → nothing.

- Grass gets no far LOD — density fades to zero at a cutoff radius.
- v1 far tiers: cross-billboards from a baked atlas, plus the terrain-shader
  cheat (density map tints/roughens ground where forest or boulder fields
  exist — nearly free and effective from orbit). Individual trees are never
  rendered from orbit.
- Clustered mid-distance "canopy cards" (aggregate billboards per forest
  clump) are a *possible* extra tier — not committed; measure whether the
  billboard tier + terrain tint already covers it.
- Octahedral impostors are a later phase (baking pipeline, atlas management,
  blending); the API reserves an impostor LOD slot from day one. Build only
  after the ordinary billboard ladder is measured.
- LOD transitions use hysteresis + dithered cross-fade.
- Shadow policy per LOD tier: trees cast at near LODs; grass and pebbles
  never cast. One flag per species per LOD.

### Physics and destructibility

- Colliders only inside the physics-residency ring (player/vehicle-following
  with velocity look-ahead), despawned behind.
- Trees: static collider + contact-impulse threshold. Past the threshold the
  adapter reports the stable ID and impact data; the game removes the
  instance from the batch and decides whether to promote it into a
  short-lived dynamic body (falling tree), then stump/despawn. Trees are
  immovable only until the impact rule fires — never an indestructible
  infinite-mass prop the vehicle bounces off.
- Small rocks a rover drives over: merge a physics cell's collidable scatter
  into one Jolt static compound shape, created/destroyed with the ring.
- Pebble-scale clutter: no collider at all.
- The library's physics job is only: cheap per-instance removal from a batch,
  "give me instance X's transform", and collider descriptors. Simulation of
  aftermath is the game's.

### Precision on planets

Instance transforms are stored relative to a cell anchor, never world origin —
f32 instance matrices jitter at planetary radii. Matches the terrain
convention of f64 patch centre + f32 local vertices. Must hold from day one;
painful to retrofit.

## Biomes — sibling library, decided

Biome **classification** is neither terrain's nor scatter's. It becomes a
future sibling entry, `triangular-engine/biomes`. (Where 004 lists "biomes"
under shared terrain responsibilities, it means the BSP-ported generator
masks feeding elevation — field-level inputs, not classification; 004 carries
a clarifying note.)

`biomes` will own: serializable biome definitions; deterministic
classification from named environmental channels (temperature, moisture,
latitude, ocean influence, geology); **blended biome weights, not one hard
enum**; batch evaluation; optional rules translating weights into
terrain-material weights or scatter suitability.

It will not own: height generation, terrain geometry/materials, assets,
weather, gameplay spawning, or persistence.

Dependency direction — the caller feeds final terrain attributes (elevation,
slope, normal from the surface sampler) plus climate channels *into* the
biome evaluator. This avoids the cycle where terrain needs biomes for
elevation while biomes need final elevation to classify.

Scatter stays decoupled either way: it accepts a generic suitability
callback, so games can use biomes, painted masks, exclusion volumes, roads,
or custom rules without the biome package installed.

## Non-goals

- No biome authoring or classification (see above — biggest scope trap).
- No gameplay (tree health, wood yields, respawn timers) — only stable IDs +
  overlay hooks.
- No physics simulation of its own — descriptors and derivation only.
- No procedural tree/rock modelling — takes GLB/mesh assets per species per
  LOD, via the asset resolver.
- No persistence — determinism + game-owned delta overlay covers saves.

## Ordered phases

### Phase 0 — Terrain surface sampler — done

The canonical `ITerrainSurfaceSample` API in the terrain lib, shared by
meshing and scatter. Blocks everything else.

### Phase 1 — Deterministic scatter + instanced rendering — done

Fixed-level identity cells, candidate-set IDs, one species, one LOD, proven
on plane, sphere, and cylinder. This alone demonstrates large forests /
boulder fields. One batch per cell is acceptable here.

### Phase 2 — LOD ladder, billboards, wind, grass — done

Done: mesh LOD tiers with hysteresis + shader-side dithered cross-fade
(`selectScatterLodTier`, `bucketScatterInstancesByLod`,
`enableScatterDitherFade`), surface-relative alignment
(`align-to-surface-up` vs `align-to-normal` vs `random-tumble`),
density-fade grass ring, per-LOD `castShadow` flags, surface-relative wind
sway (`enableScatterWindSway`), true camera-facing cylindrical billboards for
the far tree tier (`enableScatterCylindricalBillboard`,
`buildScatterBillboardInstancedMesh`), and per-instance raycast picking
(stable candidate ID from a scatter `InstancedMesh` hit). All wired into the
`scatter-lab` demo (plane, sphere, cylinder). Batching pages beyond
one-mesh-per-tier not yet needed at demo scale. The `impostor` LOD kind is
still a label only — reserved for Phase 5.

### Phase 3 — Jolt collider ring + removal overlay — done

`ScatterJoltColliderAdapter` in the jolt entry: velocity-aware residency
ring, compound shape per physics cell for small rocks, impact-threshold
destruction promotion events, stable-ID overlay hooks. Cutting and
crash-destruction both fall out of this phase.

Step-by-step implementation plan:
[`005a_scatter_phase3_plan.md`](005a_scatter_phase3_plan.md).

Implemented (steps 1-5 of the plan): `scatter/core/scatter-physics-residency.ts`
(velocity look-ahead anchor + hysteresis diff), `scatter/core/scatter-removal-overlay.ts`
(immutable removed-ID set), `scatter/three/scatter-collider-descriptors.ts`
(anchor-relative descriptors reusing `computeScatterInstanceMatrix`),
`jolt/scatter/ScatterJoltColliderAdapter` (one static compound body per
physics cell, sub-shape userData → instance index, `resolveInstanceId` for
contact-time lookup), and `jolt/scatter/estimateScatterImpactMomentumNs`
(approach-momentum approximation, since `OnContactAdded` has no solved
impulse yet). `ScatterColliderDefinition.impactThresholdN` renamed to
`impactThresholdNs` to match (momentum, not force). All new core/three
modules covered by specs (28 new, 237/237 passing); the jolt adapter itself
has no headless-Jolt test harness and is verified via the demo instead.

Step 6 (demo wiring) is done, as a new dedicated page rather than an
addition to `scatter-lab`: `projects/demo-app/src/app/pages/scatter-physics-lab/`.
`scatter-lab.component.ts` was already ~900 lines juggling three terrain
shapes, LOD bucketing, and picking — a real driveable rover only makes sense
on a flat plane anyway (sphere/cylinder need surface-relative vehicle
orientation, a separate problem), so a focused new page kept the physics
wiring out of that file. It has: a WASD-driveable dynamic rover
(`JoltRigidBodyComponent`, camera-relative movement, imperative velocity
control mirroring `terrain-lab`'s character controller), a throwable-rock
spawner (mass/speed sliders; radius is derived from mass at a fixed density
so the slider also drives the rock's real simulated mass, not just the
momentum formula — thrown from the camera along its look direction, so
"aim" is orbiting the camera), `ScatterJoltColliderAdapter.reconcile` driven
every tick off the rover's own position + velocity (not the camera), a
shared `handleImpact` path used by both the rover's and every projectile's
`onContactAdded` (tries both `mSubShapeID1`/`mSubShapeID2` per the plan's
note on manifold body-ordering), click-to-cut sharing the same removal
overlay as felling, wireframe rings visualizing the add/remove residency
radii, and HUD counters (resident cells/colliders, removed/felled counts,
last impact momentum + source). Ground is a small flat `PlaneTerrainDomain`
grid with a static `TerrainJoltColliderAdapter` collider, built once (no
LOD streaming — the area is small and bounded on purpose, to keep this a
focused physics proof rather than a second terrain-streaming demo).

Verified: `ng build demo-app` compiles clean (the jolt/scatter code this
exercises has no Karma coverage, so the build is the only automated check),
and the demo has been driven in a real browser — rover driving, rock
throwing, click-to-cut, and drive-into-tree felling all confirmed working.

Two bugs surfaced and fixed during that play-test:

- **Stale debug-renderer wireframe**: felled trees kept showing their
  collider wireframe until the debug checkbox was manually toggled off/on.
  Root cause: `jolt-debug-renderer.component.ts` cached fallback edge
  geometry keyed only by body ID, with a `GetNumSubShapes()` cache-busting
  check that silently never engaged — that method is bound on
  `CompoundShape`, not on the base `Jolt.Shape` type `body.GetShape()`
  returns, so `typeof shape.GetNumSubShapes === 'function'` was always
  `false`. Fixed by checking `shape.GetSubType()` against
  `EShapeSubType_StaticCompound` / `EShapeSubType_MutableCompound` and
  `Jolt.castObject(shape, Jolt.CompoundShape)` before calling it — the same
  subtype-cast pattern already used elsewhere in the jolt entry.
- **Felling was effectively unconditional**: the flat `impactThresholdNs`
  (900) was well below rover walk-speed momentum (~4550 Ns), so any contact
  at all felled a tree regardless of speed or tree size. Fixed by (a) reading
  each instance's own `impactThresholdNs`, now scaled by that instance's
  placement scale in `buildScatterColliderDescriptors` so bigger trees
  resist more, plumbed through `ScatterJoltColliderAdapter.resolveImpactThresholdNs`,
  and (b) raising the demo's base threshold 900 → 4000 Ns so walk speed no
  longer clears it for every tree. Confirmed in-browser: walk fells smaller
  trees but not the largest, sprint fells reliably, a max-dialed thrown rock
  can still fell the smallest trees.

### Phase 4 — Biome-driven suitability — not started

`triangular-engine/biomes` sibling entry feeding the suitability callback and
the terrain-material tint.

### Phase 5 — Octahedral impostor baker — not started

Baking pipeline, atlas management, LOD blending into the reserved impostor
slot. Only after Phase 2 is measured.

### Deferred — GPU scatter

Parallax 2.0 generates scatter on the GPU per frame. CPU-per-cell is correct
for v1; a WebGPU compute path could later slot in behind the same species
definitions if grass density demands it.

## Destructibility and growth — use-case notes

Captured from design discussion, informs Phase 3 (colliders) and is a note
for a possible later phase (growth) — not scheduled, no phase number yet.

**Three collidability tiers per species** (all expressible via
`ScatterColliderDefinition` already defined above):
- No `collider` → visible only, never physical.
- `collider`, no (or unreachable) `impactThresholdNs` → visible + collidable,
  permanent.
- `collider` + `impactThresholdNs` → destructible. On exceeding threshold the
  library only **emits an event** (instanceId, contact point, normal,
  momentum) — it never decides the outcome. The game chooses: remove only, or
  remove-from-static-compound-and-spawn-its-own-standalone-dynamic-body from
  the same descriptor (rolling rock, falling tree).

**Persistence is always game-owned.** Scatter instances stay derived/
deterministic; the only scatter-owned state is the removal-overlay (a set of
removed instance IDs). Anything promoted to a free dynamic body (rolling
rock, falling tree) leaves scatter's world and is saved like any other game
prop — unrelated to scatter's save format. "Respawn after time" falls out for
free: clearing an instance ID from the overlay regenerates the exact same
deterministic instance, no extra data needed.

**Worked examples:**
- Car hits a big rock, it rolls, must persist the new spot: impact event →
  overlay-remove the original instance → game spawns a normal dynamic body
  from the descriptor → physics settles it → game saves that prop's transform
  via its own object-save system. On reload: overlay suppresses regeneration
  of the original; the game's save respawns the settled rock. Two independent
  systems, not one.
- Villager cuts a tree: not a collision — a direct game-triggered removal via
  the interaction's stable ID. Game may spawn a temporary falling-tree body
  for the animation and despawns it after "collection." Scatter never sees
  "collected" (inventory is a non-goal, see above).
- Vehicle hits a tree, it falls, then disappears or respawns: same
  impact-event path as the rock; "respawn after time" = clear the overlay
  entry after a timer.

**Dynamically growing trees — two distinct cases, not one feature:**
- *Ambient background growth* (whole forests aging): fits the derived-data
  model for free. Bake a `plantedAtSeed` into candidate generation (same
  seeded-random source as rotation/scale today); scale or discrete
  mesh-stage becomes a pure function of `currentTime - plantedTime`. Discrete
  stage swaps (sapling → young → adult mesh) can reuse the existing LOD-swap
  + dither-crossfade machinery, keyed by age instead of camera distance —
  no new architecture needed.
- *Individually meaningful trees* (player-planted, must persist and grow
  specifically): not a scatter candidate at all — same category as a
  promoted dynamic rock. Game owns identity, growth stage, and save state;
  it may borrow scatter's LOD/mesh-swap rendering plumbing for efficiency,
  but growth progression and persistence are 100% game-side.

## Investigation log

### 2026-07-24 — Initial design discussion

Captured from design conversation: derived-data core decision, unification of
foliage/rocks/clutter into one scatter system (Parallax reference), dependency
layout, traits and placement rules, rendering ladder, physics/destructibility
pattern, precision rule, displacement-sync constraint, non-goals, phasing.

### 2026-07-24 — External review incorporated

Adopted: fixed identity cells decoupled from the adaptive cut; the
identity/render-batch/physics-residency separation; candidate-set IDs with
density-as-threshold; canonical surface-sampler contract (supersedes the
displacement-sync note); assetKey-based serializable definitions; Jolt
adapter in the jolt entry with velocity-aware residency; surface-relative
wind; biomes as a sibling library; single `scatter` entry point with internal
folders; name settled as `scatter`.

Modified rather than adopted wholesale: identity cells are fixed-level
terrain patch addresses (reusing domain addressing) instead of a new
standalone grid; candidate pools have an explicit size cap tied to generator
version; clustered canopy cards remain optional pending measurement; per-cell
batching allowed in Phase 1 as long as the API keeps identity separate from
batching.

### 2026-07-24 — Phase 0-2 implemented; LOD dither/hysteresis interaction bug fixed

Implemented in `projects/triangular-engine/scatter` and exercised via the
`scatter-lab` demo page: surface sampler, fixed-level identity cells,
candidate-set instance IDs, per-species placement rules (including
surface-relative alignment), density-fade grass ring, mesh LOD tiers with
hysteresis, and a shader-side dithered cross-fade
(`enableScatterDitherFade`, 4×4 Bayer discard) for the near/far tree tier
pop, on plane, sphere, and cylinder.

Bug found via demo testing: scrubbing the LOD/view-distance slider (which
moves a tier's `maxDistanceM` boundary past a stationary instance, rather
than the more common case of the viewpoint moving past a stationary
boundary) produced a visible ring where trees snapped fully back to
high-detail then snapped forward again. Root cause in
`selectScatterLodTier`: once hysteresis resisted a raw tier change, the
resisted tier's `distanceToBoundaryM` could go negative (already past its
own boundary), and the old dither-blend guard (`>= 0`) treated that as
"outside the band" and reset `blend01` to 0 — discarding an in-progress
fade. Fixed by clamping instead of gating: `distanceToBoundaryM < ditherBandM`
now maps negative distances to `blend01 = 1` (already fully faded) rather
than snapping back to 0. Regression test added in
`scatter-lod-selection.spec.ts`.

### 2026-07-25 — Wind/billboard/picking wired; shader program cache-key collision bug fixed

Wind sway, cylindrical billboards, and instance picking wired into
`scatter-lab`, closing Phase 2. Wiring the wind trait onto both the tree and
grass materials surfaced a bug: grass instances rendered fully invisible
(2692 instances present, correct matrices, zero console errors/warnings)
while trees rendered and animated correctly.

Root cause: `Material.prototype.customProgramCacheKey()` defaults to
`this.onBeforeCompile.toString()`. A JS closure's `.toString()` returns only
its literal source text, not captured variable values — so `treeMaterial`
(patched with `enableScatterDitherFade` then `enableScatterWindSway`) and
`grassMaterial` (patched with only `enableScatterWindSway`) both ended up
with an identical final `onBeforeCompile.toString()` (the wind wrapper's
source text is the same regardless of the captured `wind` values or any
earlier chained patch). With every other program-cache-key parameter also
matching in this simple demo scene, Three.js's `WebGLPrograms` treated the
two materials as needing the same compiled program and silently reused
tree's already-compiled program (which expects a per-instance
`instanceDitherAlpha` attribute from the dither patch) for grass's draw
calls. Grass's geometry never provides that attribute, so it read as a
default `0`, and the dither fragment shader's
`if (vScatterDitherAlpha < scatterBayerDither(...)) discard;` discarded
every fragment — a valid-but-wrong render, not a GL error, hence no console
output.

Confirmed via Three.js source (`Material.js` default `customProgramCacheKey`,
`WebGLPrograms.js` consuming `parameters.customProgramCacheKey`), not
guesswork, and reproduced/isolated with a reversible diagnostic edit
(temporarily disabling `enableScatterWindSway` on grass only) before fixing.

Fix: all three `scatter/three` shader-patch functions
(`enableScatterWindSway`, `enableScatterDitherFade`,
`enableScatterCylindricalBillboard`) now also override
`customProgramCacheKey`, chained with any previous value the same way
`onBeforeCompile` is chained. `enableScatterWindSway`'s override bakes in
the actual `wind.frequency`/`wind.strength` values (since those are baked as
GLSL literals into the injected shader text); the other two use a fixed tag
string, since they don't vary their injected GLSL per call but are still
protected against colliding with any other single-patch material. General
takeaway: any `onBeforeCompile` patch whose injected GLSL depends on
captured, per-call-varying data must also patch `customProgramCacheKey` to
vary with that same data — otherwise two differently-configured materials
can silently share one compiled program with no error of any kind.
