# Sketch sub-library

Status: proposed — no implementation started.

Related plans:

- [008_spline_sublibrary.md](008_spline_sublibrary.md) — precedent for the
  framework-free-core + lab-editor approach this doc reuses.
- [012_navigation_sublibrary.md](012_navigation_sublibrary.md) — structural
  template for this document.

## Goal

A browser-based, Fusion360-*inspired* (not Fusion360-*like*) shape authoring
system for triangular-engine:

- Pick a work plane, draw a closed 2D profile on it (lines, arcs), then
  extrude or revolve that profile into a solid.
- Repeat/compose with mirror, linear pattern, circular pattern.
- Save/load the result as JSON (a "sketch document"). No interop with real
  CAD formats — this is a game asset, not an engineering artifact.
- Consume the result in games: render meshes, Jolt colliders, and derived
  physical data (volume, center of mass, projected areas for aerodynamics).
- A `sketch-lab` demo page in demo-app as the authoring environment.

Target games (Bruno's, concrete):

1. **KSP-like vessel game (Jolt physics).** Today vessels are assembled from
   parts using primitive geometries (boxes, cones). Sketch-authored solids
   replace those with procedural shapes: fuselage sections, wings, fins,
   fairings. Wanted layers, in order of ambition: looks → colliders → mass
   properties → custom aerodynamics derived from the actual shape.
2. **Base building.** Authored building shapes (walls with window holes,
   footprint-extruded structures) placed as static geometry + colliders.
3. **Future procedural-life / other games** needing runtime-generated shapes
   from stored templates.

## Core principle

**A sketch document is a recipe, not a mesh.** It is an ordered list of
features (profile → extrude → mirror → pattern …) that is deterministically
re-evaluated into geometry on demand. This directly satisfies "having an
order in which the shape was created", and it is what makes the same asset
usable at every layer:

- Evaluate once → render `BufferGeometry`.
- The same evaluation yields one solid piece per feature → one convex hull
  per piece → compound Jolt body (the existing `joltHullShape` +
  compound-shape reconciliation in `triangular-engine/jolt` already does the
  physics side).
- Closed extruded/revolved solids have computable volume, center of mass, and
  projected cross-section areas — the inputs a custom aerodynamics model
  needs.
- Later: expose named numeric parameters on features (tank length, wing span)
  and the recipe becomes a tweakable part generator, KSP-style.

What this is explicitly **not**: a parametric CAD kernel. No dimension/
constraint solver, no B-rep topology, no history-based re-edit guarantees
beyond "re-run the recipe", no STEP/IGES/OBJ interop. Full CAD is a
multi-year kernel project (OpenCascade-scale) and none of the target games
need it. Honest framing: this is a *sketch-and-extrude blockout tool with a
replayable history*, closer to SketchUp push/pull than Fusion360.

## Scope

### Sketch owns

- The document model: 2D profiles (plane + closed loops of line/arc
  segments, with holes), ordered feature list (extrude, revolve, transform,
  mirror, linear pattern, circular pattern), validation, JSON serialization
  with `schemaVersion`.
- Deterministic evaluation of a sketch document into per-feature mesh data
  (positions/normals/indices) and `BufferGeometry`.
- Pure derived-data math over evaluated meshes: volume, center of mass,
  projected area along a direction, directional area table.
- Editor support helpers: snapping math, loop-closure validation, and
  undo/redo (reusing the generic `SplineEditorHistory<T>` from
  `triangular-engine/spline`).

### Consumers own

- What a sketch-authored solid *means* in a game: part definitions,
  attachment nodes, materials/texturing, gameplay stats.
- The aerodynamics force model itself. The sketch library provides geometric
  inputs (areas, volume, COM); the vessel game owns drag/lift equations,
  occlusion rules, and integration with its flight model.
- Physics body assembly. The library produces per-feature geometry; the
  existing `joltHullShape`/`joltMeshShape`/`joltRigidBody` components (or the
  game's own Jolt code) turn that into bodies.
- Player-facing building UX. The `sketch-lab` page is a developer authoring
  lab (per the 008 precedent: "the editor is a lab, not a product"). An
  in-game simplified builder would be a separate consumer of the same core.

## Required environments

- **Demo lab (browser, Angular).** `sketch-lab` page for authoring; full
  engine scene, orbit camera, raycast-driven editing.
- **Unit tests (ChromeHeadless).** Core model, evaluation, and derived math
  must be testable without a scene; analytic solids (box, cylinder, torus)
  as ground truth.
- **Game runtime.** Evaluation at load time (or asset-bake time) in the
  vessel/base-building games. Evaluation must be DOM-free and Angular-free so
  it can move to a worker if profiling ever demands it. (Three.js math/
  geometry classes are DOM-free, so the `sketch/three` layer remains
  worker-safe.)

## Candidate representations

| Option | Verdict |
| --- | --- |
| **Baked mesh only** (editor exports a `BufferGeometry`/GLTF, no history) | Rejected as the primary format. Loses "order of creation", parameters, per-feature collider decomposition, and re-evaluation. GLTF export stays possible later as a *derived* artifact. |
| **Ordered feature list ("recipe"), whole-document re-evaluation** | **Chosen.** Cheap to implement, deterministic, serializes naturally, maps 1:1 to the UI ("what did I do, in order"), gives per-feature solids for compound colliders. Re-evaluating the whole document on every edit is fine at blockout scale (tens of features, thousands of triangles). |
| **Parametric constraint CAD** (dimensions, constraint solver, B-rep) | Rejected. Cost wildly exceeds the value for game assets; see Core principle. |

2D profile representation: a **new, small model** rather than extending
`triangular-engine/spline`. Rationale: spline's data model is 3D-point,
Catmull/Bezier-handle centric; a profile is a closed 2D loop of line/arc
(later bezier) segments on a plane, mapping 1:1 onto `THREE.Shape`/`THREE.Path`
commands. Bending spline's model to cover this would complicate both. What
*is* reused from spline: the framework-free-core architecture, validation/
serialization conventions, tolerance style, and the generic
`SplineEditorHistory<T>` for undo/redo. Splines stay relevant as a future
`extrudePath` source (sweep a profile along a spline — curved walls, pipes).

## Proposed architecture

Two entry points to start:

### 1. `triangular-engine/sketch` — framework-free core

No Angular, no DOM, no three imports. Owns the document model, validation,
serialization, editor math, and pure derived-data math over plain arrays.

### 2. `triangular-engine/sketch/three` — evaluator + adapters

Depends on three. Turns 2D profiles into `THREE.Shape` (with holes), features
into geometry via `THREE.ExtrudeGeometry` / `THREE.LatheGeometry`, applies
transform/mirror/pattern features (clone + `Matrix4`; mirror flips winding —
must reverse triangle order so normals and signed volume stay correct), and
returns both `BufferGeometry` (render) and plain-array mesh data (for core's
derived math and for `joltHullShape`). Tessellation is deliberately delegated
to three rather than re-implemented — this is the "use what three provides
procedurally" requirement, and it is the only reason this layer exists as a
separate entry from the core.

No `sketch/jolt` entry for v1: the existing `joltHullShape` / `joltMeshShape`
components already accept any `BufferGeometry`, and `joltRigidBody` already
reconciles multiple shapes into a compound body. Dynamic bodies (vessel
parts) use one convex hull per feature; large static bodies (buildings) use
`joltMeshShape`.

An Angular component layer (`sketch/engine`, e.g. a `<sketchMesh
[document]>` component) is deferred until a game actually consumes sketch
documents; the demo lab composes the pieces directly, like `spline-lab` does.

## Document model (proposed minimal shape)

```ts
export type SketchVec2 = [number, number];
export type SketchVec3 = [number, number, number];

export type SketchSegment =
  | { kind: 'line'; to: SketchVec2 }
  | { kind: 'arc'; to: SketchVec2; center: SketchVec2; clockwise: boolean };

export interface ISketchLoop {
  /** First point; the last segment must return here (within tolerance). */
  start: SketchVec2;
  segments: SketchSegment[];
}

export interface ISketchPlane {
  origin: SketchVec3;
  normal: SketchVec3;
  /** In-plane +X direction; +Y is normal × xAxis. */
  xAxis: SketchVec3;
}

/** A single 2D drawn profile, positioned on a plane. */
export interface ISketchProfile {
  id: string;
  plane: ISketchPlane;
  outer: ISketchLoop;
  holes: ISketchLoop[];
}

export type SketchFeature =
  | { kind: 'extrude'; id: string; profileId: string; distance: number }
  | { kind: 'revolve'; id: string; profileId: string;
      axisOrigin: SketchVec2; axisDirection: SketchVec2; angle: number }
  | { kind: 'transform'; id: string; sourceIds: string[];
      translation?: SketchVec3; rotationEuler?: SketchVec3; scale?: SketchVec3 }
  | { kind: 'mirror'; id: string; sourceIds: string[]; plane: ISketchPlane;
      keepSource: boolean }
  | { kind: 'linearPattern'; id: string; sourceIds: string[];
      direction: SketchVec3; count: number; spacing: number }
  | { kind: 'circularPattern'; id: string; sourceIds: string[];
      axisOrigin: SketchVec3; axisDirection: SketchVec3;
      count: number; totalAngle: number };

export interface ISketchDocument {
  schemaVersion: 1;
  id: string;
  name?: string;
  profiles: ISketchProfile[];
  /** Ordered — this IS the creation history. */
  features: SketchFeature[];
}
```

Evaluation output (from `sketch/three`):

```ts
export interface ISketchPieceMesh {
  /** Feature that produced this solid piece (pattern instances share one). */
  featureId: string;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  geometry: THREE.BufferGeometry;
}

export interface ISketchEvaluation {
  pieces: ISketchPieceMesh[];
}
```

Derived-data math (in core, over plain arrays — no three types):

```ts
export function computeMeshVolume(positions, indices): number;          // divergence theorem
export function computeMeshCenterOfMass(positions, indices): SketchVec3;
export function computeProjectedArea(positions, indices, direction): number; // flat-plate: Σ area·max(0, n·d), no occlusion in v1
export function buildDirectionalAreaTable(positions, indices, sampleDirections): Float32Array;
```

Units: meters, Y-up, matching engine conventions. Profile coordinates are in
the plane's `(xAxis, normal×xAxis)` basis.

## Design test: KSP-like vessel part

A fuel-tank + fin assembly, authored in the lab:

1. Revolve a half-profile → fuselage tank (revolve feature).
2. Draw a fin profile on the XZ plane at the tank wall → extrude 0.05 m.
3. Circular-pattern the fin ×4 around the tank axis.

Consumption in the vessel game: 5 pieces (1 revolve + 4 fin instances) →
`joltRigidBody` with 5 `joltHullShape` children (compound body). Mass/COM from
`computeMeshVolume`/`computeMeshCenterOfMass` × material density. Drag input
from `buildDirectionalAreaTable` sampled over a small direction set (e.g. 26
directions), baked at load. The library must make this whole chain possible
without any game-specific code. Honest caveat: the v1 projected-area model
ignores part-to-part occlusion (KSP itself shipped years on cruder models);
occlusion-aware aero is a game-side concern later.

## Design test: base building

A wall segment with two window holes: rectangle outer loop + two rectangular
hole loops on a vertical plane, extruded 0.3 m; linear-pattern ×6 along X.
Consumption: merged or per-piece `joltMeshShape` static collider + standard
material rendering. Verifies holes-in-profile and static-mesh consumption.

## First vertical slice

Plane pick (XY/XZ/YZ) → click-draw a closed line-segment loop with grid
snapping → extrude via numeric input → solid appears with correct normals →
save to localStorage → reload page → load → identical solid. Everything else
(arcs, holes, revolve, patterns, physics, derived data) layers on after this
works end to end.

## Implementation order

### Milestone 0: entry points, document model, serialization

Status: not started.

- Scaffold `projects/triangular-engine/sketch/` (+ `/three`) with
  `ng-package.json` files; register `tsconfig.json` paths; add a
  `test:triangular-engine:sketch` script mirroring the navigation test
  target wiring in `angular.json`/root `package.json`.
- Core: document model above, `validateSketchDocument` (closed-loop check,
  finite values, id uniqueness, feature source-id resolution, descriptive
  `RangeError`s per spline conventions), JSON round-trip.
- Tests: validation rejection cases + serialization round-trip.

Checkpoint: `npm run test:triangular-engine:sketch`,
`npm run build:triangular-engine`.

### Milestone 1: evaluate profile → extrude/revolve, derived math

Status: not started.

- `sketch/three`: profile → `THREE.Shape` (outer + holes, winding
  normalized), extrude via `ExtrudeGeometry`, revolve via `LatheGeometry`
  (or extrude-path revolve if lathe's axis constraints pinch), plane
  orientation applied to output geometry.
- Core: `computeMeshVolume` / `computeMeshCenterOfMass` /
  `computeProjectedArea`.
- Tests: unit-square extrude = box (volume 1, COM at center, projected areas
  match faces); circle-approx extrude ≈ cylinder within tolerance; revolve
  rectangle ≈ cylinder shell.

Checkpoint: same commands as M0.

### Milestone 2: transform, mirror, patterns

Status: not started.

- Clone + `Matrix4` application per instance; mirror reverses triangle
  winding (test: mirrored piece has positive `computeMeshVolume`).
- Tests: circular pattern ×4 volume = 4× source; mirror COM reflects across
  plane.

### Milestone 3: `sketch-lab` demo page (first vertical slice + arcs/holes)

Status: not started.

- New page `projects/demo-app/src/app/pages/sketch-lab/`, lazy route in
  `app.routes.ts`, following `spline-lab`'s component shape (standalone,
  `EngineModule`, `EngineService.provide`, one `<scene>`, raycast editing,
  `SplineEditorHistory` undo/redo, localStorage save slot + JSON file
  export/import).
- Grid + angle snapping (editor-level only, not stored in the model).

Human verification: draw an L-shaped profile, extrude, reload, load — same
solid; undo/redo through a full authoring session; add a hole loop and see it
in the solid.

Checkpoint: `npx ng build demo-app --configuration development`.

### Milestone 4: physics consumption demo

Status: not started.

- "Spawn as physics body" button in the lab: evaluated pieces →
  `joltRigidBody` + one `joltHullShape` per piece; route gains the standard
  `JoltPhysicsService.load()` `canActivate` guard.

Human verification: the fin-tank design test tumbles believably; an L-extrude
rests on its concave side correctly (compound of hulls, not one convex hull
over everything).

### Milestone 5: gameplay derived data surfaced

Status: not started.

- `buildDirectionalAreaTable`, mass-properties helpers exported and
  documented; lab shows volume/COM/area readouts for the current document.
- Short "consuming sketch documents in a game" section in the library
  README.

### Milestone 6 (stretch, pick by need): booleans, sweeps, parameters

Status: not started; each item independently optional.

- Boolean subtract/union via `three-bvh-csg` as a new *optional* peer
  dependency (matches how jolt/rapier/postprocessing are declared). Note:
  CSG output breaks the one-piece-one-hull collider story and clean derived
  math — only add when a design test demands it.
- Sweep: extrude along a `triangular-engine/spline` path (`extrudePath`).
- Named numeric parameters on features → tweakable parts.
- In-game simplified builder component (`sketch/engine`).

## Decisions recorded

1. A sketch document is an ordered feature recipe, re-evaluated whole; not a
   parametric constraint CAD system. (Core principle.)
2. New 2D profile model; `triangular-engine/spline` is reused for its
   conventions and generic editor history, not its data model. Splines
   reserved as future sweep paths.
3. Tessellation delegated to three (`Shape`/`ExtrudeGeometry`/
   `LatheGeometry`) inside `sketch/three`; core stays three-free and
   operates on plain arrays.
4. Physics via existing `joltHullShape`/`joltMeshShape` + compound
   `joltRigidBody`; one hull per feature piece; no new jolt adapter in v1.
5. Booleans deferred to stretch; `three-bvh-csg` as optional peer if adopted.
6. `schemaVersion` in the JSON from day one; lab persists to localStorage
   plus explicit JSON file export/import.
7. The lab page is a developer authoring tool, not a shippable player-facing
   editor (008 precedent).
8. Aerodynamics *model* is game-side; the library provides geometric inputs
   only (volume, COM, projected/directional areas, no occlusion in v1).
9. Entry point named `sketch` (not `blueprint`/`cad`): avoids Unreal
   Blueprint association, matches genericized CAD terminology (Fusion360/
   SolidWorks/Onshape all call the 2D-profile stage "sketch"), and fits the
   repo's plain-noun naming style.

## Open decisions

- Extrude options for v1: single-direction only, or symmetric/two-direction
  and draft/taper from the start?
- Parameter schema shape (M6): per-feature named numbers vs a top-level
  parameter table referenced by expressions. Decide when a game needs
  tweakables.
- Whether evaluation ever needs worker offload / caching keyed on document
  hash — defer until a real sketch document is slow.
- GLTF bake-export as a derived artifact (would let sketch documents feed
  non-engine pipelines). Not needed by any current design test.

## Change log

### 2026-08-11: initial design

Document created from Bruno's requirements (vessel game, base building,
procedural shapes with replayable creation order) plus repo research; scoped
as recipe-based sketch/extrude, explicitly rejecting parametric CAD.

### 2026-08-11: renamed blueprint → sketch

Entry point and document-model naming reworked after discussion: "Blueprint"
was too tied to Unreal Engine's scripting system. Renamed to `sketch`
(genericized CAD term, no engine-specific baggage). The former "sketch" field
name (the 2D profile drawn on a plane) was renamed to `profile` throughout to
avoid colliding with the new top-level term.
