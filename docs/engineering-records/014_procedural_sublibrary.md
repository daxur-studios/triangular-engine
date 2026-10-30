# Procedural sub-library (flora first)

Status: in progress — M0–M5 done, M6 not started (see Milestones below).

Related plans:

- [013_sketch_sublibrary.md](013_sketch_sublibrary.md) — sibling shape system
  (human-authored recipes); see "Relationship to sketch" below for the
  boundary. Structural template for this document.
- [005_scatter_sublibrary.md](005_scatter_sublibrary.md) — scatter owns
  placement, streaming, instancing, and physics residency for everything this
  library generates.
- [011_animals_sublibrary.md](011_animals_sublibrary.md) /
  [009_life_sublibrary.md](009_life_sublibrary.md) — the intended consumers
  of flora affordances (perch, nest, fruit, flower).

## Goal

Seed-driven procedural mesh generation for triangular-engine, starting with
**flora** (trees, then flowers/bushes), deliberately simple and abstract —
low-poly, stylized, readable at a distance. Not photorealistic.

The defining requirement, and the reason this is worth building instead of
importing tree assets: **every generated mesh ships with typed functional
metadata**. A tree is not just a shape; it is a shape plus a list of places
where a bird can perch, an animal can nest, a fruit can hang, an insect can
land. Function first, looks second.

Target games (Bruno's, concrete):

1. **BSP planets.** Replace the current sphere-as-tree with generated
   species. Scatter already places, instances, LODs, and streams vegetation;
   this library supplies what to place.
2. **Animal/life integration.** BSP-A2 in BSP's animal-world plan already
   says "one BSP building or scattered tree can provide a perch through an
   adapter" — sockets are the data that adapter forwards. Later: nest
   cavities, fruit foraging, flower pollination, trunk climbing.
3. **Future procedural fauna / structures.** If the core proves out, the same
   seeded-generation and socket concepts can serve abstract creature meshes
   and generated structures. Explicitly not designed in detail yet.

## Core principle

**Sockets are the product; the mesh is the decoration.** A generator is a
pure function: `(archetype params, seed) → { mesh data, sockets, collider
descriptors, wind weights }`. Deterministic — same inputs, same outputs,
forever. Games consume the sockets to make the world interactive; the mesh
just makes the sockets visible.

```
socket kinds (initial): perch | nest-cavity | fruit-slot | flower-head
                        | climb-path | root-base
```

What this is explicitly **not**:

- Not an L-system research playground or a botany simulator. One concrete
  recursive branching generator with a small parameter set, grown only when a
  game needs more.
- Not per-instance unique meshes. A species yields a small set of seeded
  **variants** (e.g. 6–10), which scatter instances normally. Uniqueness at
  scale comes from per-instance transform/tint, not per-instance geometry —
  anything else destroys instancing.
- Not a vegetation simulation. Growth, fire, and seasonal state are discrete
  variant/state swaps layered on later, not continuous simulation.

## Relationship to sketch (013)

Complementary, not overlapping — the split is **who decides the shape**:

| | sketch | procedural |
| --- | --- | --- |
| Author | a human, in a lab, feature by feature | an algorithm, from a seed |
| Document | ordered feature recipe (JSON) | archetype params + seed |
| Output | exact authored solid | family of varied instances |
| First use | vessel parts, buildings | trees, flowers |

Shared DNA both must honor: framework-free core, deterministic re-evaluation,
plain-array mesh data + `BufferGeometry`, physics via existing jolt
components/adapters, lab page per library. Sketch's derived-math functions
(volume, COM) can be reused if flora ever needs mass properties.

Possible future convergence, recorded but not designed: procedural
**structures** could consume parameterized sketch documents as templates
(sketch M6 named parameters) — the human authors the recipe, procedural
varies the parameters per seed. Neither library should distort its v1 for
this.

## Scope

### Procedural owns

- Deterministic seeded primitives: hashing/keyed RNG for generation.
  (Scatter and animals each have their own hash utilities already; this
  library gets its own or a shared one — see Open decisions.)
- The **socket model**: typed, oriented attachment points
  (`position`, `orientation`, `kind`, `radius`/clearance, stable per-variant
  socket IDs).
- The **flora archetype contract**: parameters describing a species' shape
  family (trunk height/taper ranges, branch depth/spread, leaf-cluster style,
  fruit/flower capacity), plus generation state (healthy/seasonal/burned as
  discrete variants, later).
- Generators: skeleton (branch graph) → low-poly mesh (positions/normals/
  indices/`BufferGeometry`), socket derivation from the skeleton, per-vertex
  **wind weight** attribute (bend increases with branch depth/height), and
  scatter-compatible **collider descriptors** (see Physics).
- Validation and JSON serialization of archetype params with
  `schemaVersion`, per spline/sketch conventions.

### Consumers own

- **Scatter**: placement, streaming, instanced rendering, LOD selection,
  distance fade, physics residency, removal/damage overlays. Procedural never
  places anything and never talks to Jolt directly.
- **Life/animals**: behavior. Sockets are inert data until a game's adapter
  exposes them as affordances (BSP-A2 perches etc.).
- **Socket occupancy/state** (fruit picked, cavity nested, perch occupied):
  BSP's, not this library's — see Known gaps #3. This library only emits the
  stable socket ID that such state is keyed against.
- **Socket spatial queries** ("what's near me"): scoped to whatever streaming
  index scatter already maintains — see Known gaps #2. This library does not
  build a second spatial structure.
- **The game (BSP)**: which species exist where, what fruit does when picked,
  gameplay meaning of nests/flowers, seasonal calendar, fire rules, and the
  wind uniform values (direction/strength) driving the shader.
- **Materials/shaders**: the wind vertex displacement itself lives with the
  consumer's material setup; procedural only bakes the per-vertex weights.

## Physics (Jolt) — no new adapter

Scatter's physics pipeline already does everything flora needs:
`IScatterColliderDescriptor` primitives (box/sphere/capsule/cylinder) per
instance, streamed static compound bodies per cell via
`ScatterJoltColliderAdapter`, contact→instance-ID resolution, and felling
impact thresholds.

So the rule is: **a flora variant emits zero or more primitive collider
descriptors, and scatter does the rest.**

- Tree: one capsule or cylinder for the trunk. Branches and canopy get no
  colliders in v1 (vehicles clip foliage; acceptable and cheap).
- Flowers, grass, small bushes: no colliders at all.
- Hull colliders: the adapter currently throws on `'hull'`; only implement if
  a design test genuinely needs a non-primitive collider. Default answer is
  "approximate with primitives".

This means physics costs nothing new: residency, compounding, and contact
mapping are already built and tested in scatter.

## Proposed architecture

**One entry point, not two.** The sketch plan (013) proposed a split
`sketch` + `sketch/three` package pair, but that split was never actually
built, and checking how the *existing, shipped* sublibraries do it shows a
different real rule: a separate secondary entry point (its own
`ng-package.json`) is used only to isolate an **optional** peer dependency
(`water/jolt`, `water/postprocessing` — jolt/rapier/postprocessing are all
`peerDependenciesMeta.optional`). Scatter needs three for its `three/`
subfolder, but three is a required peer dep for the whole library, so scatter
ships `core/`, `terrain/`, `three/`, and `engine/` all inside one
`triangular-engine/scatter` entry with one `public-api.ts`.

Flora only needs three (already required), not an optional peer. So this
library follows scatter's actual pattern:

### `triangular-engine/procedural` — one entry, two subfolders

- `core/` — no Angular, no DOM, no three imports, **and no domain
  vocabulary** (no "perch", "nest cavity", "trunk" — those belong to
  flora/). Seeded RNG/hash helpers, the generic `IProceduralSocket<TKind>`
  shape and socket-ID derivation, shared skeleton/graph types, archetype
  validation + serialization conventions, plain-array mesh-data types. Each
  domain (flora, later buildings/fauna) supplies its own `TKind` union.
- `flora/` — depends on three (`BufferGeometry` assembly, vector math only).
  Tree skeleton generator, skeleton→mesh tube/cluster construction, socket
  derivation, wind-weight baking, collider-descriptor derivation, and LOD
  mesh generation (full / reduced / far-billboard-source per variant,
  feeding scatter's existing LOD selection).

If a future generator family needs an optional peer dep that core/flora
don't (e.g. a CSG library only structures need), *that* family gets its own
entry point at that point — same reasoning as `water/jolt`. Until then, one
entry keeps build/test wiring trivial (one `ng-package.json`, one spec
glob), matching scatter rather than the unbuilt sketch aspiration.

Deferred until proven needed: `procedural/fauna` (abstract creature meshes —
note BSP's animal plan explicitly lists procedural animal meshes as a
non-goal for its first adoption, so there is no near-term consumer),
`procedural/structures` (see sketch convergence above), and any Angular
component layer — the demo lab composes pieces directly, per spline/sketch
precedent.

## Flora archetype (proposed minimal shape)

Illustrative, to be firmed up in M0 — field names follow spline/sketch
conventions:

```ts
export interface IFloraArchetype {
  schemaVersion: 1;
  id: string;
  name?: string;
  kind: 'tree' | 'flower' | 'bush';
  /** Ranges are [min, max]; each variant samples them with its seed. */
  trunk: { heightM: [number, number]; radiusM: [number, number]; taper01: number };
  branching: {
    maxDepth: number;            // 2–3 keeps it abstract
    childrenPerNode: [number, number];
    spreadAngleRad: [number, number];
    lengthFalloff01: number;
  };
  foliage: { style: 'cluster-sphere' | 'cluster-cone' | 'none'; sizeM: [number, number] };
  sockets: {
    perchesPerBranchDepth: Record<number, number>;
    nestCavityChance01: number;
    fruitSlotsMax: number;
    flowerHeads: boolean;
  };
  collider: { trunk: 'capsule' | 'cylinder' | 'none' };
}

/** Flora-specific socket kinds — core's IProceduralSocket<TKind> knows nothing
 *  about perches or nest cavities; only flora/ does. */
export type FloraSocketKind =
  | 'perch' | 'nest-cavity' | 'fruit-slot' | 'flower-head' | 'climb-path' | 'root-base';

export interface IFloraSocket extends IProceduralSocket<FloraSocketKind> {
  // positionM, orientation, clearanceRadiusM, id, kind inherited from core.
}

export interface IFloraVariant {
  archetypeId: string;
  seed: number;
  /** Kept (not discarded after mesh build) — climb paths, felling animation,
   *  and growth-stage interpolation all need the branch graph, not just the
   *  final triangles. */
  skeleton: IFloraSkeletonNode[];
  lods: IFloraLodMesh[];        // positions/normals/indices/windWeights + BufferGeometry
  sockets: IFloraSocket[];
  colliders: IScatterColliderDescriptorInput[]; // scatter-compatible primitives
}
```

Units: meters, Y-up, variant origin at the root base, matching engine
conventions.

## Design test: bird lands on a generated tree

1. Generate a tree archetype's variants; scatter places them on terrain as a
   species with the trunk capsule collider.
2. A consumer queries a placed instance's sockets (variant sockets ×
   instance transform) and filters `kind === 'perch'`.
3. An abstract bird (animals library or a stub) flies to the socket position,
   orients to its "up", and sits.

The library must make this chain possible without any game-specific code and
without the bird knowing anything about trees — it only sees sockets.

## Design test: interactable fruit

A tree variant exposes `fruit-slot` sockets. The game attaches instanced
fruit meshes at some slots, raycasts against them (or their positions), and
detaches one on pick. The library provides slot positions and stable IDs;
spawning, picking, and inventory are game-side.

## Known gaps and risks

Recorded from a design review before implementation started, so they don't
get rediscovered the hard way. Each has a default answer; the ones without a
confident default are promoted into Open decisions below.

1. **Sockets are dynamic world data, not static mesh metadata — this is the
   real theme behind gaps 2–4.** The doc's "instance transform × variant
   sockets" story only answers "where is this socket," not "which sockets
   exist near me right now" or "is this socket still valid." Both are
   consumer-side systems this plan currently hand-waves.
2. **Spatial query at scale.** The real consumer need is "find perches near
   this bird," across potentially thousands of placed instances — not a
   per-instance lookup. Default: reuse scatter's existing streaming cells as
   the index rather than building a second spatial structure; a socket query
   is scoped to the cells scatter already has resident. Unresolved: scatter
   streams by camera-centre, life simulates near a vessel/player-centre — the
   same two-centre mismatch the life plan already flags for animals applies
   to socket availability too. Promoted to Open decisions.
3. **Socket occupancy/state has no owner.** "This fruit was picked," "this
   cavity has a nest," "this perch is occupied" is mutable, per-instance,
   per-socket state that must survive saves. Scatter's removal overlay is
   instance-level, not socket-level. Default: this is explicitly BSP's
   responsibility (a sparse `Map<socketId, state>` keyed off the stable
   socket ID), not this library's — but it needs a real contract before M5,
   not an assumption. Promoted to Open decisions.
4. **Socket invalidation.** A tree gets felled, LOD-swapped to a billboard,
   or streamed out from under an animal that's using one of its sockets.
   Default: sockets tied to a scatter instance become invalid the moment
   scatter reports that instance removed/culled (reuse scatter's existing
   removal signal); the consumer polls or subscribes rather than the
   generator inventing a new liveness channel.
5. **Wind vs. static sockets.** Mesh sway is GPU vertex displacement;
   sockets are static CPU data — a bird on a swaying branch tip will visibly
   float off the geometry. Default for v1: perches only derive from
   low-wind-weight skeleton nodes (trunk, thick lower branches), sidestepping
   the mismatch instead of solving it. CPU-side wind evaluation for occupied
   sockets is a possible v2, not required now.
6. **Wind rendering is scatter's pipeline, not a free consumer-side add-on.**
   Baking per-vertex wind weights (this library) is separate from actually
   displacing vertices at render time, which happens inside scatter's
   instanced-mesh material path (`scatter-wind-material` already exists).
   Flora integration likely means wiring flora's baked weights into that
   existing material rather than inventing a new one — a scatter-side
   touchpoint that M4 should call out explicitly, not assume is free.
7. **Nest cavities aren't free geometry.** A tube-based skeleton mesh has no
   holes. Default: fake it — a dark decal/recess texture or a small
   inset/notch on the trunk mesh, not real boolean-cut topology. Matches the
   abstract art direction and avoids pulling in CSG this early.
8. **Determinism vs. generator tuning.** "Same seed forever" only holds
   until the generation algorithm itself changes. If a save ever persists a
   *socket position* rather than a socket *ID*, tuning the generator later
   silently drifts saved data. Rule (recorded as a decision below): persist
   socket IDs only; positions are always re-derived from
   `(archetypeId, seed, schemaVersion)` at load time.
9. **M5 may silently depend on unbuilt animals-library capability.**
   "Bird flies to and lands on a specific point" assumes the animals library
   supports targeted point-landing, which the current flock-first slice
   (011a) may not cover yet. Flagged so M5 planning checks this before
   committing to it as the design-test proof, rather than discovering the
   gap mid-milestone.
10. **Variant repetition.** 6–10 mesh variants per species may read
    repetitively at scale unless scatter's placement already jitters
    rotation/scale/tint per instance on top of the variant choice. Needs
    confirming against scatter's actual placement code before relying on it
    (not re-litigating scatter's design here).
11. **Tree-to-tree jumping is a navigation problem, not a socket problem.**
    An animal choosing a path across multiple trees' `perch`/`climb-path`
    sockets is routing — cross-reference
    [012_navigation_sublibrary.md](012_navigation_sublibrary.md) rather than
    solving routing inside procedural.

## First vertical slice

One `tree` archetype → generate 6 seeded variants → render side by side in a
`flora-lab` page with visible socket gizmos (colored markers per kind) → a
seed input regenerates deterministically → same seed always reproduces the
identical mesh and sockets. No scatter, no physics, no animals yet.
Everything else layers on after this works end to end.

## Implementation order

### Milestone 0: entry points, core model, determinism

Status: not started.

- Scaffold `projects/triangular-engine/procedural/` (+ `/flora`) with
  `ng-package.json` files; register `tsconfig.json` paths; add a
  `test:triangular-engine:procedural` script mirroring existing sublibrary
  test wiring.
- Core: seeded RNG/hash, socket types + socket-ID scheme, archetype
  validation (descriptive `RangeError`s per spline conventions), JSON
  round-trip.
- Tests: determinism (same seed → identical output), validation rejections,
  serialization round-trip.

Checkpoint: `npm run test:triangular-engine:procedural`,
`npm run build:triangular-engine`. Done.

### Milestone 1: tree skeleton + mesh generator

Status: done (single LOD; per-LOD budget variation is future work).

- Flora: recursive branch-skeleton generation from archetype params + seed
  (`flora-skeleton.ts`); skeleton → low-poly trunk/branch tubes + foliage
  clusters (`flora-mesh.ts`); per-vertex wind weights; triangle budget
  assertion (20k/mesh) plus a separate node-count cap in the skeleton
  generator itself (5k nodes) — added after a first cut let an exponential
  archetype hang skeleton generation before the mesh-level budget check
  could ever run.
- Bug found after M2 (foliage silently never rendered): `appendFloraFoliageCluster`
  built each tip's `OctahedronGeometry` and copied `template.getIndex()` into
  the shared index buffer — but `PolyhedronGeometry` (the three.js base class
  behind `OctahedronGeometry`) always builds **non-indexed** geometry, so
  `getIndex()` is `null` and the `if (templateIndex)` guard silently skipped
  every foliage triangle. Foliage vertices/normals were appended and correct;
  they just had no triangles referencing them, so only the trunk/branch tubes
  ever drew — visually indistinguishable from "no foliage at all" beyond the
  windWeight brown→green tint on the branch tips themselves. Fixed by
  synthesizing sequential indices (`0, 1, 2, ...`) over the non-indexed
  template's position count instead of reading a template index that never
  existed.
- Tests: determinism at mesh level, budget limits (including the
  runaway-archetype case), no NaNs, wind weight 0 at root and increasing
  with branch depth. 44/44 passing (`npm run test:triangular-engine:procedural`).

### Milestone 2: sockets + collider descriptors

Status: done.

- `flora-sockets.ts`: `deriveFloraSockets(skeleton, archetype, seed)`.
  `root-base` always emitted (one, at the origin). `perch` sockets are
  gated two ways: `perchesPerBranchDepth[depth]` picks *which generation*
  of branches is eligible (decision 14 — low depths, thick/low branches),
  and within that depth `isPerchableBranch` filters to segments that are
  actually near-horizontal (≤45° from horizontal — `PERCH_MAX_ANGLE_FROM_
  HORIZONTAL_RAD`) and thick enough (`PERCH_MIN_RADIUS_FRACTION_OF_TRUNK_
  RADIUS`, 0.15 of trunk radius). Depth alone was the original v1 rule and
  was wrong — a node's depth says nothing about whether that segment is a
  landable horizontal limb versus a near-vertical riser, and placing the
  gizmo at `node.endM` put it at the branch-fork point rather than along
  the branch. Fixed: eligible perches are now placed at the branch
  segment's midpoint, not its endpoint. `nest-cavity`: a single
  chance draw (hashed from `archetypeId|seed|nest-cavity`, independent of
  the skeleton/mesh generators' own random stream, which isn't exposed
  after generation) against `nestCavityChance01`, placed at trunk
  mid-height. `fruit-slot`/`flower-head`: derived from branch-tip nodes
  (same "no children" test as the mesh builder's foliage placement),
  capped at `fruitSlotsMax` for fruit, one per tip for flowers, both
  skipped when `foliage.style === 'none'`. Clearance radii scale off the
  branch/trunk/foliage dimensions rather than fixed constants. Orientation
  is identity for every socket in v1 — real alignment (e.g. a perch facing
  away from the trunk) is deferred, not required by any current consumer.
- `flora-collider.ts`: `deriveFloraTrunkCollider(skeleton, archetype)` →
  `{ shape: 'capsule' | 'cylinder', params: [halfHeightM, radiusM] }` from
  the root skeleton node, or `undefined` when `collider.trunk === 'none'`.
  `IFloraColliderDescriptor` is a local structural type matching scatter's
  `ScatterColliderDefinition` shape (same field names, same
  `[halfHeight, radius]` param order the jolt scatter collider adapter
  expects) rather than an import from `triangular-engine/scatter` — kept
  as a structural match, not a hard dependency between sibling libraries,
  same reasoning as core having no domain vocabulary.
- Tests: 17 new (socket determinism, id stability when an unrelated field
  like `name` changes, perch count clamping to *eligible* nodes, perch
  eligibility rejecting steep/thin branches, perch position at the branch
  midpoint rather than the fork endpoint, nest-cavity chance at 0/1,
  fruit/flower cap and skip-when-`none` behavior, no-NaN sweep, collider
  shape/param correctness and the `none` case). 61/61 passing
  (`npm run test:triangular-engine:procedural`).
- Demo page pulled the socket gizmos forward too (see M3 below) rather
  than leaving them for later, since they're the natural way to actually
  see this milestone's output.

### Milestone 3: `flora-lab` demo page (first vertical slice)

Status: mostly done — skeleton/mesh visual slice plus socket gizmos are in.
Real wind-displacement sway (previously blocked on M4) is now wired too, via
`enableScatterWindSway(material, wind, { useVertexWindWeight: true })` —
see Milestone 4.

- New page `projects/demo-app/src/app/pages/flora-lab/` (lazy route
  `/flora-lab`, linked from the demo index), following the established lab
  shape (standalone, `EngineModule`, `EngineService.provide`, one
  `<scene>`).
- Done: a row of 6 variants from consecutive seeds, seed input +
  "Regenerate" (random seed) + wireframe toggle, ground plane, orbit
  camera. Vertex color lerps trunk-brown → leaf-green from the raw
  `windWeight` attribute as a static stand-in for a wind shader (no
  animation yet). Colored gizmo spheres (one `MeshBasicMaterial` per
  socket kind, shared `SphereGeometry`) render each variant's
  `deriveFloraSockets` output, toggleable, with a color-key legend in the
  panel; the demo archetype now sets non-empty `perchesPerBranchDepth`,
  `nestCavityChance01`, and `fruitSlotsMax` so gizmos actually appear.
  `npx ng build demo-app --configuration development` passes; the tsconfig
  path had to be added in **two** places — root `tsconfig.json` (already
  done in M0) and `projects/demo-app/tsconfig.app.json`, which duplicates
  the same `paths` map rather than inheriting it. Missed the second one
  first pass; worth remembering for the next new entry point too.
- Not done: trunk collider wireframe visualization (not required to see
  M2's output — sockets are), variant-count/archetype-param controls
  beyond seed.

Human verification (do this yourself — regenerating with the same seed
should reproduce an identical row of trees and gizmo layout; not
re-confirmed here): `npx ng serve demo-app` then open `/flora-lab`.

### Milestone 4: scatter integration

Status: done.

- New page `projects/demo-app/src/app/pages/flora-scatter-lab/` (lazy route
  `/flora-scatter-lab`, linked from the demo index): registers 6 flora
  variants (`generateFloraSkeleton` + `buildFloraMesh`, one seed each) as a
  scatter species. Placement, streaming (`selectFixedLevelScatterCells`),
  and instancing (`buildScatterInstancedMesh`) are scatter's existing code,
  used unchanged. **Scatter has no per-instance mesh-variant primitive** —
  `buildScatterInstancedMesh` takes one geometry per call — so each variant
  gets its own `InstancedMesh` and instances are bucketed into one
  deterministically (`hashProceduralKey(instanceId) % variantCount`,
  demo-local, not a library API). That's the practical shape "variants as
  the species' LOD meshes" takes given the current scatter API; extending
  scatter with real per-instance mesh-variant selection is a scatter-side
  follow-up if a game needs it, not required by this milestone.
- Trunk colliders: each variant's `deriveFloraTrunkCollider` output feeds
  `buildScatterColliderDescriptors` (called once per variant, since variants
  have differing trunk dimensions — `ScatterSpeciesDefinition.collider` is a
  single shape/params per call) + `ScatterJoltColliderAdapter`, unmodified.
  The demo's field is small and static (no residency streaming ring — that
  diffing is already proven in `scatter-physics-lab`); a "drop ball" button
  spawns a dynamic Jolt sphere that free-falls onto the trees, and
  `resolveInstanceId` on contact resolves back to the correct instance +
  variant, shown in the panel.
- Instance-level socket query helper: added `transformProceduralSocket` +
  `IProceduralInstanceTransform` to `procedural/core/procedural-socket.ts`
  — generic over `TKind` (works for fauna/structures sockets later, not
  flora-specific), pure quaternion/vector math with no three.js dependency
  so it stays usable from a worker. Takes a decomposed pose
  (`{ positionM, quaternion, scale }`) rather than a `Matrix4` directly, so
  callers owning a real matrix (scatter's `computeScatterInstanceMatrix`)
  just decompose it first — kept the dependency direction one-way
  (procedural doesn't import scatter). The demo wires the two together on
  click: resolve the picked instance, `computeScatterInstanceMatrix` →
  decompose → `transformProceduralSocket` per variant socket → gizmo
  spheres at the world-space result. Scoping to "resident cells" (Known
  gaps #2) is moot in this demo (the whole small field is always resident);
  the real spatial-query-at-scale problem is unsolved, same as before.
- Wind: `enableScatterWindSway` (scatter-side, `scatter-wind-material.ts`)
  gained a `{ useVertexWindWeight?: boolean }` option — when set, the shader
  reads a baked `windWeight` vertex attribute instead of its default
  object-space-height heuristic. Flora's baked weights (branch-depth-aware,
  not just "how tall is this vertex") now drive real sway in both
  `flora-scatter-lab` and `flora-lab` (the latter's wind was the M3 item
  previously blocked on this). No new material — same file, additive
  option, existing callers unaffected (covered by new spec cases).
- Jitter (Known gaps #10): confirmed by reading
  `scatter-instance-transform.ts` — rotation (yaw around up, from
  `rotationSeed01`) and uniform scale (`scaleSeed01`) already jitter
  per-instance, unchanged, reused as-is. **Per-instance tint does not
  exist** in scatter (no color/tint seed on `ITerrainScatterInstance`, no
  `setColorAt` usage anywhere in `scatter/three`) — flagged per the runbook
  gap's own instruction ("if not, that's a scatter follow-up, not a
  procedural one"), not implemented here.

Tests: 187/187 passing across procedural + scatter
(`npx ng test triangular-engine --include='../procedural/**/*.spec.ts'
--include='../scatter/**/*.spec.ts'`) — 8 new cases (`transformProceduralSocket`
identity/translate/scale/rotate/compose-orientation/id-preservation;
`enableScatterWindSway` default-vs-attribute shader output and distinct
program cache keys).

Human verification (do this yourself — not re-confirmed here): `npx ng serve
demo-app`, open `/flora-scatter-lab`. Click a tree to see socket gizmos
appear at its world-space perch/fruit/nest positions; "Drop ball" to see a
Jolt sphere land on/against a trunk and the panel report the resolved
instance; toggle "Physics debug" to see the trunk collider capsules align
with the mesh trunks; a field of the 6 variants shouldn't read as visibly
repeated tiling (rotation/scale jitter only — no tint yet, per the gap
above).

### Milestone 5: first affordance consumer

Status: done.

- Known gaps #9 checked first, per this milestone's own instruction: the
  animals library's shipped slice (`stepFlock`) only did flock/boid steering
  toward a constant travel direction — no targeted point-landing. Rather than
  fake landing inside the flora lab, added a minimal single-agent
  seek-and-land primitive, `stepArrival`, to `triangular-engine/animals`
  (`core/flock-arrival.ts`) as the next real step on animals' *own* roadmap
  (Milestone 2 lists "landing on consumer-provided tree or building anchors"
  regardless of flora) — see
  [011_animals_sublibrary.md](011_animals_sublibrary.md) Milestone 2 for the
  implementation writeup, including a real bug it surfaced and fixed in the
  shared `rotateTowards` turn-rate-limiting helper (agents starting at rest
  got stuck unable to turn at all).
- New page `projects/demo-app/src/app/pages/flora-affordance-lab/` (lazy
  route `/flora-affordance-lab`): reuses M4's tree registration (species,
  streaming, instancing, wind) without the Jolt/collider pieces, since this
  milestone doesn't need physics. Clicking a tree runs the same
  `transformProceduralSocket` world-space query as M4; "Send bird to perch"
  picks the tree's first unoccupied `perch` socket and drives one abstract
  bird (a plain cone mesh, oriented from its velocity heading — "abstract
  geometry, no animation system" per the animals doc) toward it every tick
  via `stepArrival`, landing and stopping exactly on the socket position.
- Fruit-slot pick demo: clicking a red `fruit-slot` gizmo directly detaches it
  (no flight involved, per the design test's "click a fruit, it detaches").
  Socket gizmos are raycast-picked via `userData.socketId`/`userData.kind`
  tagged onto each gizmo mesh.
- Socket occupancy: a `Map<socketId, 'perch-occupied' | 'fruit-picked'>`
  (Known gaps #3) — landing sets `'perch-occupied'`, fruit-click sets
  `'fruit-picked'`; occupied perches render with a muted grey material (the
  bird is still visibly sitting there), picked fruit stop rendering entirely
  ("detached"). Proves the ID-keyed state contract without BSP's real
  save-backed version — exactly the milestone's scope, no more.

Tests: the new `stepArrival` primitive has 20/20 passing in
`triangular-engine/animals` (determinism, arrival deceleration, exact-landing
snap, idempotent-once-landed, max-speed and turn-rate bounds, all-finite);
combined with procedural + scatter, 207/207
(`npx ng test triangular-engine --include='../animals/**/*.spec.ts'
--include='../procedural/**/*.spec.ts' --include='../scatter/**/*.spec.ts'`).
Library build and `npx ng build demo-app --configuration development` both
clean.

Human verification (do this yourself — not re-confirmed here): `npx ng serve
demo-app`, open `/flora-affordance-lab`. Click a tree to see its sockets;
"Send bird to perch" to watch the cone fly in, decelerate, and land exactly
on a perch marker (which turns grey); click a red fruit-slot marker directly
to see it vanish immediately.

### Milestone 6 (stretch, pick by need): more life, more kinds

Status: not started; each item independently optional.

- Flowers archetype + `flower-head` sockets + a pollinator visiting them.
- Seasonal/burned discrete variants; integration with scatter's removal/
  damage overlays for eaten/burned vegetation.
- `climb-path` sockets and a trunk-climbing test.
- `procedural/fauna` exploration (abstract creatures) — only with a real
  consumer.
- `procedural/structures` via parameterized sketch documents — only after
  sketch M6 exists.

## Decisions recorded

1. Sockets (typed functional points) are the primary output; meshes serve
   them. (Core principle.)
2. Abstract/low-poly style; per-species seeded variants instanced by
   scatter, never per-instance unique geometry.
3. Placement, streaming, instancing, LOD, and physics residency stay in
   scatter; procedural only produces variant data (meshes, sockets, collider
   descriptors, wind weights). No new Jolt adapter.
4. Trunk-only primitive colliders in v1; no hull colliders, no branch/canopy
   collision.
5. Entry layout `procedural` (framework-free core) + `procedural/flora`
   (three-dependent generators); fauna/structures deferred until a consumer
   exists.
6. Sketch (013) and procedural stay separate libraries with a
   human-authored-vs-seed-generated boundary; parameterized-sketch structures
   recorded as possible future convergence only.
7. Wind is baked per-vertex weights from the generator; the displacement
   shader and wind values are consumer-side.
8. Growth, seasons, and fire are discrete variant/state swaps, not continuous
   simulation; deferred to stretch.
9. `schemaVersion` on archetype JSON from day one.
10. The lab page is a developer tool, not a shippable editor (008 precedent).
11. One `triangular-engine/procedural` entry point with `core/`/`flora/`
    subfolders, not a split `procedural`+`procedural/flora` package pair —
    corrected from the original draft after checking that shipped
    sublibraries (scatter, water) only split into a separate entry to
    isolate an *optional* peer dependency; three is required, so it doesn't
    qualify. Split later only if a specific optional peer forces it.
12. Persisted state references socket **IDs** only, never socket positions;
    positions are always re-derived from `(archetypeId, seed,
    schemaVersion)` at load time (Known gaps #8).
13. Socket occupancy/state ownership is BSP's, not this library's; socket
    spatial queries are scoped to scatter's existing streaming cells rather
    than a second spatial index (Known gaps #2, #3).
14. Perches in v1 only derive from low-wind-weight skeleton nodes (branch
    depth gates the generation), sidestep rather than solve the wind/socket
    visual mismatch (Known gaps #5). Depth alone doesn't guarantee a
    landable branch, though — within an eligible depth, `isPerchableBranch`
    additionally requires the segment to be near-horizontal and thick
    enough (added after M2's first pass placed perches on any node at the
    right depth regardless of orientation, including near-vertical risers).
15. Nest cavities are a decal/recess visual trick in v1, not boolean-cut
    topology (Known gaps #7).
16. `core`'s `IProceduralSocket` takes a generic `TKind extends string`
    instead of a fixed union — an early draft hardcoded
    `'perch' | 'nest-cavity' | ...` directly into core, which is exactly
    the domain leak the "core has no domain vocabulary" rule (see
    Proposed architecture) exists to prevent. Caught during M1 review;
    flora now defines its own `FloraSocketKind` and extends the generic.

## Open decisions

- Shared hash/RNG: extract a common seeded-hash utility used by scatter,
  animals, and procedural, or give procedural its own copy first and unify
  later? (Leaning: own copy first; unification is a refactor, not a design
  problem.)
- Socket-ID hashing scheme details (stability guarantees across archetype
  edits — which edits are allowed to reshuffle sockets?).
- Socket availability under the two-centre (camera vs. vessel/player) stream
  mismatch already flagged for animals — does a socket "exist" for query
  purposes on a tree scatter hasn't rendered nearby the player-centre but not
  the camera-centre? (Known gaps #2.)
- Exact socket-invalidation signal shape consumers subscribe to (poll vs.
  event) when scatter removes/culls the owning instance (Known gaps #4).
- Whether variant generation happens at load time or build/bake time for
  games with many species; defer until a real load is slow.
- How BSP's `HabitatSample.vegetation01` and canopy-cover derivation should
  read generated flora density — BSP-side adapter question, recorded here so
  the socket/variant data doesn't accidentally preclude it.
- Foliage rendering style (merged clusters vs separate instanced leaf cards)
  — decide in M1 against the abstract art direction.

## Change log

### 2026-08-13: initial design

Document created from Bruno's requirements (procedural life focus, trees
first, function-over-realism, sockets for birds/nests/fruit/flowers, Jolt
physics for trunks, `procedural` + `procedural/flora` entry layout, possible
future fauna/structures) plus repo research: scatter's collider-descriptor +
Jolt-adapter pipeline confirmed sufficient for flora physics with no new
adapter; sketch (013) confirmed complementary (human-authored vs
seed-generated) rather than overlapping.
