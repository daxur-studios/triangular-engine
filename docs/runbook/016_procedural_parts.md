# Procedural parts (flora pattern, for craft/vessel parts)

Status: M0–M4 implemented in `triangular-engine/procedural` & demo-app `/parts-lab` (2026-08-17).

Related plans:

- [014_procedural_sublibrary.md](014_procedural_sublibrary.md) — the parent
  procedural design. Flora ships in `triangular-engine/procedural`; parts are
  the second domain in the same entry point. Adopts 014's core principle,
  entry-point layout decision (D11), collider approach, and lab-page
  conventions wholesale.
- [013_sketch_sublibrary.md](013_sketch_sublibrary.md) — the sibling
  human-authored shape system. 014 recorded the boundary for flora; this doc
  extends the same boundary to parts (see "Relationship to sketch" below).
- [005_scatter_sublibrary.md](005_scatter_sublibrary.md) — owns placement,
  instancing, and physics residency for _scattered_ generated things. Parts are
  authored onto vessels rather than scattered across terrain, so scatter is
  referenced for its collider-descriptor conventions only (see "Physics").
- `triangular-engine/jolt` — the consumer facing. `ScatterJoltColliderAdapter`
  (`jolt/scatter/scatter-jolt-collider-adapter.ts`) shows the exact primitive
  collider set and param order this library's descriptors must match;
  `JoltLandingLegComponent` (`jolt/jolt-leg/`) is the runtime suspension
  behavior this library's leg parts bolt visual+collider geometry onto.
- `<private-app>/docs/case-studies/009_landing-legs-no-hold-and-teleport-freeze.md` —
  empirical proof that Jolt's native WASM `VehicleConstraint` on compound bodies
  traps memory and must NOT be used for spacecraft moving parts; raycast suspension
  - kinematic visual mesh posing is the proven production path.

## Goal

Seed-driven, deterministic, low-poly procedural **parts** for gameplay —
aircraft wings, rocket landing legs, rocket engines, and later fins, tanks,
gimbal mounts, fairings. Same contract shape as the procedural trees:

```
(archetype params, seed) → variant {
  solids,       // concrete primitive-solid assembly this variant uses
  mesh,         // BufferGeometry built from the solids (plus optional Group helper)
  sockets,      // typed functional points: attach, thrust, foot, pivot, lift
  colliders,    // scatter-compatible primitive descriptors (Jolt-ready)
  mass,         // exact volume + center of mass derived from primitive solids
  joint         // optional single hinge for a rotating link
}
```

Function first, looks second — identical to 014's "sockets are the product;
the mesh is the decoration". A landing leg is not a shape; it is a shape plus a
mount face, a hinge point, a hinge axis, and a foot contact point, all stable
per seed.

Target games (Bruno's, concrete, from 013's KSP-like vessel direction):

1. **KSP-like vessel game (Jolt physics).** Vessels are assembled from
   generated, seed-varied parts that carry attachment sockets and primitive
   colliders. The wanted layers (looks → colliders → mass properties →
   aerodynamics) get exact geometric data from day one.
2. **Any future game needing families of functional parts** (modular base
   fittings, rovers, crane arms, turrets, static props with functional points).
3. **Aerodynamics consumers**: `lift` sockets at quarter-chord and derived
   projected areas give the vessel game geometrically-derived inputs; the force
   model itself stays consumer-side.

## Relationship to sibling sublibraries

The clear separation of concerns across `triangular-engine`:

| Sublibrary                                                   | Primary Domain                                                    | Core Generation Model                                                |
| :----------------------------------------------------------- | :---------------------------------------------------------------- | :------------------------------------------------------------------- |
| **`procedural/parts`** (this doc)                            | Modular functional vehicle/base components (wings, engines, legs) | Seed-driven assembly of primitive solids with sockets & articulation |
| **`procedural/flora`** ([014](014_procedural_sublibrary.md)) | Environmental vegetation (trees, bushes, flowers)                 | Recursive branch skeleton + wind-weight vertex attributes            |
| **`sketch`** ([013](013_sketch_sublibrary.md))               | Custom structural solids (fuselages, fairings, buildings)         | Replayable human-authored 2D profile extrude/revolve recipe          |
| **`spline`** ([008](008_spline_sublibrary.md))               | Roads, paths, linear bridges, rivers                              | 1D parametric curves swept into 3D continuous ribbon meshes          |

LOD mesh decimation is explicitly **out of scope** for parts: parts are built from
ultra-low-poly primitives (tens to hundreds of triangles), and vessel-level
distance culling or orbit-rail demotion is owned entirely by the game.

## Core principle

**A part is an assembly of primitive solids plus typed functional metadata.**
In v1 there is no CSG, no boolean cutting, no L-system-like recursion — parts
are authored from primitive solids positioned/oriented relative to the part
origin (or defined by endpoint spans `localStart` → `localEnd` with explicit
`embedDepthM` to prevent floating air gaps).

Why primitives and not a sketch recipe: primitives map 1:1 to the Jolt
collider set `ScatterJoltColliderAdapter` already creates (box/sphere/
capsule/cylinder), so "colliders are free and always aligned with the mesh" in
the same literal sense flora's trunk capsule is. Furthermore, primitive solids
make exact closed-form volume and center-of-mass ($\sum V_i$, $\sum V_i \mathbf{p}_i$)
trivial to compute without expensive mesh integration.

Determinism rule from 014 stands: same `(archetypeId, seed, schemaVersion)`
reproduces the identical variant forever. Socket **IDs** are persisted;
socket _positions_ are always re-derived at load/pose time (014 D12).

## Ownership boundaries

### Procedural/parts owns

- The `IPartArchetype` contract: a solid list (per-solid shape, pose or
  endpoints, dimensions, material hint, collider toggle, link assignment), socket
  configuration with role tags, joint configuration (optional), and validation with
  `schemaVersion` (reusing `core/procedural-validation.ts`).
- `generatePartSkeleton(archetype, seed)` → concrete solid list (ranges
  sampled, repeated elements counted). Deterministic.
- `buildPartMesh(skeleton, archetype)` → `BufferGeometry` (positions/normals/
  indices) from the solids, plus a per-vertex `linkId`/`partIndex` attribute
  and a `color` attribute derived from per-solid material hints.
- `buildPartMeshGroup(skeleton, archetype)` → Three.js `Group` with separate
  `Mesh` children per link (`link-0`, `link-1`) for $60\text{ fps}$ pivot rotation.
- `derivePartSockets(skeleton, archetype, seed)` → typed sockets with stable IDs
  and load-bearing primary orientations.
- `derivePartColliders(skeleton, archetype)` → one scatter-compatible
  descriptor per collidable solid (`{ shape, params, anchorRelativePositionM,
rotation }`, params in `ScatterJoltColliderAdapter` order).
- `derivePartMassProperties(skeleton, densityKgM3)` → exact closed-form volume
  ($\text{m}^3$), dry mass ($\text{kg}$), and center-of-mass centroid ($\text{m}$).
- `posePartVariant(variant, deployRad)` → framework-free hinge math that
  re-poses link-1 solids, sockets, and colliders about the joint. Pure
  quaternion/vector math, no three.js, worker-safe.
- A `parts-catalog.ts` of starter presets: aircraft wing, rocket landing leg,
  rocket engine (+ colors like `FLORA_*_COLORS`).

### Consumers own

- Where a part sits on a vessel, whether it moves, what deploying it _does_
  (unlocks, controllability, flight physics). The library emits the part pose
  and its functional points; the vessel game owns the autorotation, the
  petal-latch, the throttle curve.
- Jolt residency: building static/dynamic compound bodies. The library never
  touches Jolt directly (014 D3) and never creates physical Jolt constraints.
- Real landing leg suspension: the game uses raycast spring-damper math
  between `pivot` and `foot` sockets (BSP Case Study 009).
- Lift/thrust force models and aerodynamics equations.
- Materials/shaders for the part (per-solid material hints are hex strings for
  the lab's tinting only).

## Proposed architecture

Follows 014 D11 exactly: one `triangular-engine/procedural` entry point (three
is already a required peer dependency, so parts need no secondary entry point).
`parts/` is a third subfolder alongside `core/` and `flora/`.

- `core/` — unchanged, framework-free, domain-free: `procedural-hash.ts`,
  `procedural-socket.ts`, `procedural-validation.ts`.
- `flora/` — unchanged.
- `parts/` — three-dependent (three for mesh assembly only):

```
parts/
  parts-solid.ts         // IPartSolid, PartSolidShape, dimension shapes/frames, endpoints
  parts-archetype.ts     // IPartArchetype + validatePartArchetype
  parts-skeleton.ts      // generatePartSkeleton: ranges/counts -> concrete solids
  parts-mesh.ts          // buildPartMesh (merged BufferGeometry) + buildPartMeshGroup (Group)
  parts-sockets.ts       // PartSocketKind, PartSocketRole + derivePartSockets
  parts-colliders.ts     // derivePartColliders -> scatter-compatible descriptors
  parts-mass.ts          // derivePartMassProperties: exact volume + COM from primitives
  parts-joint.ts         // hinge type + posePartVariant (framework-free)
  parts-catalog.ts       // wing / landing-leg / engine presets + colors
  *.spec.ts              // colocated, mirroring flora
```

`parts/public-api.ts` re-exported from `procedural/public-api.ts` so consumers
keep importing from `triangular-engine/procedural`.

## Archetype contract (v1 shape)

```ts
export type PartSolidShape = 'box' | 'cylinder' | 'cone' | 'capsule' | 'sphere';

/** A concrete solid, produced by the skeleton generator. Part frame: meters, Y-up,
 *  origin at the part's primary mount-interface point. */
export interface IPartSolid {
  readonly id: string;                 // stable within the variant (solid-0, solid-1, ...)
  readonly shape: PartSolidShape;
  readonly positionM: readonly [number, number, number];
  readonly orientation: readonly [number, number, number, number]; // xyzw quaternion
  /** Per shape: box [w,h,d]; cylinder [radius, height]; cone [radiusBottom,
   *  radiusTop, height]; capsule [radius, totalHeight]; sphere [radius]. */
  readonly dimensionsM: readonly number[];
  /** Optional endpoint-based definition for struts/limbs (synthesizes positionM/orientation). */
  readonly endpoints?: {
    readonly startM: readonly [number, number, number];
    readonly endM: readonly [number, number, number];
  };
  /** Intentional penetration depth (meters) into parent solid to prevent floating air gaps. */
  readonly embedDepthM?: number;
  /** 0 = base (bolts to host); 1 = child of the part's joint (moving link). */
  readonly linkId: number;
  /** Visual hint only (hex string); colliders don't consume it. */
  readonly materialHex?: string;
  /** Whether this solid contributes a collider descriptor (default true). Set false for cosmetic bolts/ribs. */
  readonly collidable?: boolean;
}

export interface IPartJointConfig {
  /** Hinge anchor, part frame, meters. */
  readonly anchorM: readonly [number, number, number];
  /** Hinge axis, part frame, unit vector. */
  readonly axis: readonly [number, number, number];
  /** Travel from which the pose helper rotates link-1 solids, radians. */
  readonly rangeRad: readonly [number, number];
  /** Pose angle in the generated "rest" variant, radians. */
  readonly restRad: number;
}

export type PartSocketKind =
  | 'attach'   // bolts to host; orientation primary axis = mount face outward normal
  | 'thrust'   // engine nozzle; primary axis = thrust direction
  | 'foot'     // landing contact; primary axis = foot/down axis; position = contact at full deploy
  | 'pivot'    // hinge anchor; primary axis = hinge axis
  | 'lift';    // wing center-of-pressure; primary axis = forward flight axis

export type PartSocketRole =
  | 'stack-top'     // axial top stack node for editors
  | 'stack-bottom'  // axial bottom stack node (interstage / decoupler)
  | 'radial'        // surface / radial mount face
  | 'custom';

export interface IPartSocketConfig {
  readonly kind: PartSocketKind;
  readonly role?: PartSocketRole;
  readonly size?: number;             // node class size (e.g. 0, 1, 2)
  readonly solidId?: string;          // solid to which this socket is anchored
  readonly offsetM?: readonly [number, number, number];
  readonly primaryDirection?: readonly [number, number, number];
}

export interface IPartArchetype {
  readonly schemaVersion: 1;
  readonly id: string;                 // e.g. 'part-rocket-landing-leg'
  readonly name?: string;
  readonly solids: readonly {
    ...IPartSolid definitions (ranges for dimensions, count ranges for repeats)
  }[];
  readonly sockets: readonly IPartSocketConfig[];
  readonly collider: {
    readonly hull: false;              // primitives only in v1 (014 D4)
    readonly coneApproximation: 'cylinder'; // cone solids -> cylinder collider
  };
  readonly joint?: IPartJointConfig;   // optional single hinge; link-1 solids revolve about it
}
```

## Sockets

Parts are the first procedural domain where socket **orientation is load-bearing**
(a perch's identity orientation was fine; a thrust axis is not). Convention:
applying a socket's orientation quaternion to `[0, 0, 1]` yields the socket's
**primary direction** as defined per kind above. Consumers transform to world
with the existing `transformProceduralSocket` (core) and rotate `[0,0,1]` by the
result's quaternion.

Socket placement rules (v1):

- `attach`: one per mount face. Position on the face, orientation = outward normal.
  Carries `role: 'stack-top' | 'stack-bottom' | 'radial'` for vessel editor snapping.
- `thrust`: centered on the nozzle exit disc, orientation = thrust axis.
- `foot`: position = the link-1 foot pad's contact point **at full deploy**
  (the `rangeRad[1]` pose), orientation = foot axis.
- `pivot`: one per joint, at the joint anchor, orientation = hinge axis.
- `lift`: wing quarter-chord center of pressure, orientation = forward flight axis.

Socket IDs keep core's scheme (`deriveProceduralSocketId` over
`(archetypeId, seed, schemaVersion, kind, ordinal)`) per 014 D12.

## Articulation model (framework-free hinge + pose helper)

Recorded decision — chosen over "static parts only" and over a library-driven
Jolt hinge:

- A part has **at most one hinge** in v1. Wings, engines, and tanks are static
  (an engine gimbal reuses the same hinge concept later). A landing leg is the
  canonical rotating part.
- The archetype's `joint` declares `anchorM`, `axis`, `rangeRad`, `restRad`.
  Solids with `linkId: 1` (and their sockets/colliders) revolve about the
  hinge; `linkId: 0` is the base bolted to the host.
- `posePartVariant(variant, deployRad)` (pure, no three.js) returns a copy of
  the solid list, socket list, and collider-descriptor list with link-1 items
  rotated about the joint by `deployRad` (clamped to `rangeRad`).
- Moving/suspension gameplay (landing legs) uses **raycast suspension** in the
  game's physics solver (e.g. BSP `PhysicsWorld` / `JoltLandingLegComponent`)
  casting from `pivot` to `foot`.
- Visual animation is supported two ways:
  1. Full deterministic regeneration via `posePartVariant(variant, deployRad)`
  2. Per-frame $60\text{ fps}$ pivot rotation via the `buildPartMeshGroup()` Three.js `Group` helper.

## Physics (Jolt) — no new adapter, no Jolt constraints

Same rule as 014: **a part variant emits zero or more primitive collider
descriptors; jolt/consumers do the rest.**

- Every `collidable` solid yields one descriptor whose `shape`/`params` exactly
  match `ScatterJoltColliderAdapter.createSubShapeSettings`:
  - box → `['box', [width, height, depth]]`
  - sphere → `['sphere', [radius]]`
  - cylinder → `['cylinder', [halfHeight, radius]]`
  - capsule → `['capsule', [halfHeight, radius]]`
  - cone → `['cylinder', [height / 2, radiusBottom]]` (documented
    approximation; Jolt has no cone primitive).
- `IFlatPartColliderDescriptor` is a local structural type matching scatter's
  descriptor shape (`anchorRelativePositionM`, `rotation`, `shape`, `params`)
  rather than an import from `triangular-engine/scatter` — same sibling
  non-dependency rule as flora (014 M2 note).
- **Zero Jolt constraints**: Following BSP Case Study 009 (where Jolt WASM
  vehicle/hinge constraints on compound bodies caused uncatchable heap corruption
  and tab freezes), the library emits **no physical constraints**. Moving links are
  purely kinematic visuals, and ground reaction forces are handled via raycast suspension.
- The lab's physics proof (M4) is: pose at the current `deployRad` → build the
  descriptors → feed a static Jolt compound (the same build pattern
  `ScatterJoltColliderAdapter` uses) → drop a ball onto the posed part → Jolt
  debug render lines up with the mesh.

## Mesh builder

`buildPartMesh` tessellates each solid with three's primitive constructors
(`BoxGeometry`, `CylinderGeometry` — including its `radiusTop`/`radiusBottom`
for cones — `CapsuleGeometry`, `SphereGeometry`) and merges them into one
`BufferGeometry` with a local concat (positions/normals/indices/element-index
offset; no `BufferGeometryUtils` import so the merge logic stays visible and
testable, matching flora's hand-rolled approach). Attributes:

- `position`, `normal`, `index` — merged.
- `linkId` (or `partIndex`) — per vertex, so a consumer can re-tint or hide a
  link without re-running generation.
- `color` — derived from per-solid `materialHex` of the solid that vertex came
  from (flora's windWeight→color precedent, minus the wind).
- Triangle budget guard (like `FLORA_MAX_TRIANGLES_PER_MESH`) and a solid-count
  cap in the skeleton generator (`FLORA_MAX_SKELETON_NODES` precedent).

In addition, `buildPartMeshGroup` builds a Three.js `Group` with separate `Mesh`
instances for `link-0` and `link-1`, enabling direct transform animation of moving
appendages at runtime.

Determinism: same seed → identical vertex order, identical indices, identical
colors. Tested at the mesh level like flora M1.

## Starter catalog

- **Aircraft wing** (`part-aircraft-wing`): spanwise box/tapered segments,
  static; `attach` at the root (`role: 'radial'`), `lift` at quarter chord; box
  colliders per span segment. Low-poly, seed/params vary span, chord, and taper.
- **Rocket landing leg** (`part-rocket-landing-leg`): base block (link 0) +
  strut cylinder + foot pad (link 1) + `joint` at the base hinge (`rangeRad`
  e.g. [0, ~1.2], rest stowed); sockets `attach` (`role: 'radial'`),
  `pivot` (hinge), `foot` (deployed contact).
- **Rocket engine** (`part-rocket-engine`): body cylinder/tank, nozzle cone
  (cylinder collider approx), mounting ring; static; `attach` at top
  (`role: 'stack-top'`), optional interstage `attach` (`role: 'stack-bottom'`),
  `thrust` at nozzle exit center. Seed varies bell radius/skirt length.

Colors exported like `FLORA_*_COLORS`: e.g. `PART_ENGINE_COLORS =
{ bodyHex, nozzleHex }` — hex strings only (flora precedent).

## Design tests

1. **Wing bolts onto a rocket.** Generate the wing; a consumer reads `attach`
   sockets with `role: 'radial'`, aligns the wing to a fuselage at one, and the
   collider descriptors sit exactly against the fuselage surface. Deterministic across seeds.
2. **Landing leg deploys.** Generate the leg; call `posePartVariant` at
   `deployRad = 0.8`. Assert: link-1 solids' positions rotated about the hinge
   axis by 0.8 rad; `foot` socket lands at the rotated foot pad; collider
   descriptors moved with the solids; link-0 items and `attach` unchanged;
   pose(0) equals the rest variant. Rebuild mesh+colliders at that pose and
   drop a Jolt ball — it lands on the _deployed_ strut, and the debug render
   matches the mesh.
3. **Engine's thrust point & mass.** Generate the engine; a consumer reads `thrust`,
   transforms it to a vessel frame, and its primary direction is exactly the
   nozzle axis. Mass properties report exact dry mass and center-of-mass centroid.
4. **Determinism.** Same `(archetypeId, seed)` → identical solids, mesh bytes,
   socket set, and collider params — the flora M0/M1 assertion, enforced by the
   skeleton generator sampling from one seeded stream.

## First vertical slice

One `parts-lab` page (`/parts-lab`, lazy route, linked from the demo index):
three parts from the catalog rendered side by side (seed input + regenerate,
wireframe toggle — flora-lab shape). Socket gizmos colored per kind with role
labels; the landing leg gets a `deploy` slider (0..1 → `rangeRad`) that re-poses
mesh + collider gizmos every change.

## Implementation order

### Milestone 0: entry scaffolding + contract

- Add `procedural/parts/` (public-api re-export, tsconfig paths already
  covered by the existing entry), `parts-solid.ts`, `parts-archetype.ts` +
  `validatePartArchetype`.
- Tests: validation rejections (bad shape, bad dimension arity, joint without
  link-1 solids, counts out of range), archetype JSON shape.

### Milestone 1: skeleton + mesh

- `parts-skeleton.ts` (deterministic ranges/counts → concrete solids, solid
  cap, endpoint/embedDepth support), `parts-mesh.ts` (solid → primitive → merged
  `BufferGeometry` with `linkId`/`color` attributes and `buildPartMeshGroup` helper).
- Tests: determinism, no NaNs, budget limits, attribute presence, link/color
  tagging correct per solid.

### Milestone 2: sockets + colliders + mass properties + joint

- `parts-sockets.ts` (`derivePartSockets` with socket roles `stack-top`/`stack-bottom`/`radial`),
  `parts-colliders.ts` (`derivePartColliders`), `parts-mass.ts` (`derivePartMassProperties`),
  `parts-joint.ts` (`posePartVariant`).
- Tests: socket id stability and role tags, collider param order per shape + cone
  approximation + `collidable:false`, mass properties volume/COM exactness against
  analytical solids, `posePartVariant` link-1-only rotation/clamp/idempotence/pose(0)===rest,
  no-NaN sweeps.

### Milestone 3: parts-lab demo page (first vertical slice)

- `projects/demo-app/src/app/pages/parts-lab/` per flora-lab shape; the three
  catalog presets, seed regenerate, wireframe, socket gizmos with direction
  hints and role tooltips, `deploy` slider on the leg.

### Milestone 4: Jolt proof (static compound + debug render)

- Feed `posePartVariant(…, deployRad)`'s collider descriptors into a static Jolt
  compound using the same build pattern as `ScatterJoltColliderAdapter`.
- Drop-ball onto the posed leg/engine, physics debug overlay, contact/pick
  reporting in the panel.

### Milestone 5 (stretch, pick by need): aerodynamics derived data

- Projected cross-section areas along the `lift`/`thrust` axes for a future
  aerodynamics model.
- Exploded-view inspection helper for the lab/editor.

## Decisions recorded

1. A part is an assembly of primitive solids; no CSG/boolop in v1. Primitives
   map 1:1 to the Jolt primitive collider set (box/sphere/capsule/cylinder).
2. Function-first (014's core principle transcribed): sockets and colliders
   are the product; the mesh is decoration. Added load-bearing socket
   _orientation_ (thrust/foot/pivot/lift axes) and socket _roles_ (`stack-top`,
   `stack-bottom`, `radial`).
3. No new Jolt adapter (014 D3): the library emits descriptors and pose data;
   jolt/consumers build bodies. The lab's static-compound proof is demo code,
   not a library API.
4. Primitives only in v1 (014 D4 transposed): hull colliders stay unbuilt;
   cone solids approximate to cylinder colliders (Jolt has no cone primitive),
   documented; `collidable:false` is the escape hatch for purely-cosmetic
   solids.
5. At most one joint per part, modeled as an optional archetype `joint` +
   framework-free `posePartVariant`. Chosen over static-only and over a library-driving
   real Jolt hinge (Jolt residency stays consumer-side per D3).
6. Deterministic regeneration + multi-link `Group` helper: pose changes
   re-run generation/build or animate sub-mesh transforms in a `Group`.
7. `parts/` stays inside `triangular-engine/procedural` (014 D11) — three is a
   required peer dep, so no entry-point split.
8. Collider descriptors are a local structural type matching
   `ScatterJoltColliderAdapter`'s conventions, not an import from
   `triangular-engine/scatter` (flora M2 precedent, same sibling rule).
9. Socket IDs persist; positions always re-derive from
   `(archetypeId, seed, schemaVersion)` (014 D12), including after joint poses.
10. Materials are per-solid hex hints only; real materials stay consumer-side.
11. Mass properties (volume + COM) pulled into M2: primitive solids make closed-form
    mass summation exact and cheap, directly serving spacecraft physics in Jolt.
12. The runtime suspension **behavior** stays in `JoltLandingLegComponent` / consumer
    raycast solvers. Confirmed by BSP Case Study 009: Jolt WASM constraint bindings
    are unsafe for spacecraft moving parts; raycast suspension is the robust production path.

## Known gaps

1. **No iconography for articulated behavior in the socket model.** `foot` is
   defined at full deploy but a socket carries no "pivot pair" link — the
   consumer reconstructs that from `pivot` + the joint config. Acceptable for
   v1 (documented).
2. **Per-part collision surfaces are not merged.** Adjacent boxes stay
   separate sub-shapes inside a compound body; Jolt does not weld them.
   Fine for gameplay approximations; `collidable:false` trims cosmetic detail.
3. **Deploy poses and colliders rebuild on change.** No streaming/LOD story
   needed — parts are authored onto vessels (a handful per craft), not scattered
   across terrain cells.
4. **Materials/textures are out of the library** (D10); a part cannot carry a
   real texture pipeline or PBR mapping in v1.
5. **Orientation gizmos in labs are basic.** v1 shows a socket's primary
   direction as a small axis line.

## Open decisions

- **Range-vs-fixed in `solids`.** Leaning: ranges for dominant sizing dimensions
  (span, chord, nozzle radius) and repeat counts for repeated elements, fixed
  everywhere else.
- **`PartsJoltColliderBuilder` placement.** Inline demo function, or promote to
  a small `jolt/parts` helper in `triangular-engine/jolt`? Affects M4 only.
- **Hinge semantics on multi-foot parts**: per-part joint only in v1, per-instance
  joint configs later.

## Definition of done for the design checkpoint

- The part archetype, solid model, socket kinds/roles, joint model, mass properties,
  and collider conventions are explicit and jolt-consumable.
- The wing/leg/engine starter catalog and the `parts-lab` first slice are
  written down with milestones M0–M5.
- `posePartVariant`'s contract (link-1 rotation, clamping, rest identity,
  mesh+collider agreement) is testable on paper.
- The physics proof is scoped to static compound + debug render (chosen).

## Change log

### 2026-08-17: initial design & refinement

Document created from Bruno's request for "procedural parts" (landing leg that
rotates, aircraft wing, rocket engine, keep it simple and functional like the
procedural trees) plus repo research: 014's core principle, 013's vessel-parts
wants, the real `ScatterJoltColliderAdapter` primitive set and param order,
and BSP Case Study 009 (raycast suspension validation). Refined to pull mass
properties (volume + COM) into M2, add socket roles (`stack-top`, `stack-bottom`,
`radial`), support endpoint-based struts with embed depths, provide `buildPartMeshGroup`
for $60\text{ fps}$ link animation, and formalize boundaries with `spline` and `sketch`.

### 2026-08-17: implementation of M0–M4 & interactive verification

- Implemented M0: Core solid & archetype contracts (`parts-solid.ts`, `parts-archetype.ts`) with validation.
- Implemented M1: Skeleton generator (`parts-skeleton.ts`) and mesh builders (`parts-mesh.ts` with merged BufferGeometry and multi-link Group helpers).
- Implemented M2: Typed sockets with load-bearing orientations and roles (`parts-sockets.ts`), Jolt collider descriptors (`parts-colliders.ts`), exact closed-form mass properties (`parts-mass.ts`), and kinematic single-hinge posing (`parts-joint.ts`).
- Authored starter catalog presets for wing, deployable landing leg, and rocket engine (`parts-catalog.ts`).
- Implemented M3 & M4: Interactive demo lab at `/parts-lab` with declarative Jolt rigid bodies, live deploy slider, HUD mass readouts, dynamic ball physics, and Jolt debug rendering.
- Re-exported under `triangular-engine/procedural` entry point; 551 workspace unit tests passing.

