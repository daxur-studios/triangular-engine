# 008 — Spline sub-library

## Status

- State: **Phase 0A complete.** `triangular-engine/spline` exists with
  `core/` geometry: types + validation, linear and cubic Bezier evaluation,
  adaptive arc-length sampling, a brute-force `closestPoint` reference
  solver, and schema-versioned JSON serialization. 68 tests passing; entry
  point builds cleanly via `npm run build:triangular-engine`; `spline/core`
  has zero Three.js/Angular imports (grep-verified).
- Entry point name `triangular-engine/spline` used as recommended — still
  worth an explicit user confirmation since it's now load-bearing in
  `public-api.ts`, `angular.json`, and the README/entry-points matrix.
- Immediate consumers: `/river-lab` (`006`), a new landscape-editor demo page,
  future road/area authoring, Bruno's Space Program base placement zones
- Blocked on: nothing for Phase 0B (Catmull-Rom, channels, frames, editing) or
  0C (BVH acceleration). Phase 1B is blocked on the surface adapter in
  decision 2 — `ITerrainSurfaceDomain` has **no inverse** from a field
  position back to `(address, u, v)`, so projection and snapping cannot be
  written against it as it currently stands.
- Last updated: 2026-08-02

## Objective

One authoring-neutral curve/path package that owns geometry and evaluation, so
that every feature which needs "a line on a surface" — rivers, roads, coastline
and island outlines, mountain-range areas, biome regions, keep-out zones,
fences, cable runs — shares the same runtime data instead of reinventing it.

The target use case, stated by the user, is an Unreal-style landscape editor:

- **Closed splines** define areas — the outline of an island, the footprint of
  a mountain range, a biome or exclusion region.
- **Open splines** define linear features — roads, rivers, ridgelines, walls.
- Each spline produces a greyscale **mask**, and masks are combined with noise
  through an ordered layer stack (add / subtract / multiply / min / max) to
  produce the final terrain.

The hard requirement is that the **core is solid before anything visual is
built on it**. Every downstream feature (carving, masking, road meshes, editor
gizmos) is a consumer of the same evaluation and query API; if that API is
wrong, all of them are wrong at once.

## Naming

Sibling entry points are singular: `terrain`, `water`, `scatter`, `trail`,
`jolt`. Recommendation is therefore **`triangular-engine/spline`**, which also
matches the package name already written into `006_river_poc.md`.

Rejected alternatives:

- `splines` — inconsistent with every existing entry point.
- `path` / `paths` — collides with filesystem/URL "path" in every code review
  and in `import` lines.
- `curve` — Three.js already exports `Curve`; ambiguous in mixed files.
- `geometry2d` — the data is 3D in field space, not 2D.

The word "spline" is slightly narrow (the package also holds plain polylines
and masks), but it is the term the domain uses. Confirm or override before
Phase 0A creates directories.

## Relationship to existing work

- `006_river_poc.md` already locked the boundary: the spline package owns
  "geometry and authoring-neutral path operations" and "must not know how a
  path is rendered as water, carved into terrain, or used as a road." This
  document implements that boundary; it does not renegotiate it.
- `004_multi_surface_terrain.md` owns surface domains, meshing, LOD and field
  composition. Splines are expressed in **field space** and bind to a surface
  through an adapter (decision 2). Terrain must never import spline; spline may
  depend on terrain **contracts** only.
- `005_scatter_sublibrary.md` sets the folder shape (`core/` framework-free,
  `three/` renderers, `engine/` Angular) and the "instances are derived data"
  rule. Spline masks follow the same rule in a different form: masks are
  fields, images are caches.
- `trail` is adjacent but distinct: trails are generated from runtime motion
  and are consumed immediately. A future refactor may let the trail ribbon
  builder consume a spline, but trails are not spline authoring.
- Hydrology (`006`) stays a separate future package. Rivers are a spline
  consumer plus flow semantics; they do not live here.

## Core decisions

### 1. Two curve kinds: ambient 3D and surface-bound

The canonical representation is a list of 3-component f64 positions in the same
**field space** that `ITerrainField` samples, matching `TerrainVector3`. A
spline stored as 2D XY would be unusable on a planet.

But "a curve in field space" and "a curve on a surface" are not the same object,
and conflating them is the fastest route to a package that quietly breaks on
spheres:

- A Cartesian cubic between two points 10 km apart on a 600 km radius body sags
  roughly `L²/(8R)` ≈ 21 m **below** the surface. At 100 km apart it is over
  2 km underground. Ambient interpolation does not stay on the surface.
- Euclidean distance to the centreline is a chord, not a geodesic. The error is
  negligible at corridor widths and is not negligible at region scale.
- "Inside", signed lateral offset, and winding are **undefined** for an
  arbitrary 3D curve. Each needs a surface normal and a topology.

So the package splits along that line:

| | `core` (ambient) | surface-bound (`terrain/`) |
|---|---|---|
| Evaluation | Cartesian | re-projected onto the sampled surface |
| Distance | unsigned Euclidean | surface distance per the adapter's metric |
| Lateral offset | only with a caller-supplied reference normal | signed, from the surface normal |
| Containment | not available | `signedAreaDistance` with winding + seam handling |

`core` therefore exposes **no unqualified signed quantity**. Anything with a
sign needs a frame, and a frame needs a normal.

Field-space units are domain-defined: `getFieldPosition` maps into "continuous
procedural-field space", while only `getSurfacePosition` is documented as
metres. A `…M` suffix on a core query is therefore a lie unless something
supplies the field-space-to-metres scale. Core distances carry no unit suffix;
metric quantities appear only once an adapter is bound.

### 2. Surface binding is an explicit adapter, not an assumption

`ITerrainSurfaceDomain` maps `(address, u, v) -> fieldPosition` and
`(address, u, v, elevationM) -> worldPositionM`. It has **no inverse** —
nothing maps an arbitrary field position back to surface coordinates.
Projection, snapping, and containment all need that inverse.

Extending every terrain domain with `projectFieldPosition()` is premature: it
burdens every current and future domain implementer with an inverse most of
them will never use. Instead spline declares what it needs and ships the
concrete implementations:

```ts
interface ISplineSurfaceAdapter {
  /** Nearest surface point plus local frame for an arbitrary field position. */
  project(fieldPosition: TerrainVector3): ISplineSurfacePoint;
  /** Outward reference normal used for signs, winding and frames. */
  normalAt(fieldPosition: TerrainVector3): TerrainVector3;
  /** Field-space to metres, for width/falloff channels. */
  metricScaleAt(fieldPosition: TerrainVector3): number;
  /** Surface distance between two surface points. */
  surfaceDistance(a: TerrainVector3, b: TerrainVector3): number;
  /** Wrap/seam policy; identity on a plane. */
  normalizeAcrossSeam(fieldPosition: TerrainVector3): TerrainVector3;
}
```

Plane, sphere and cylinder adapters are written in `spline/terrain/` from each
domain's known closed-form math, with **no change to `ITerrainSurfaceDomain`**.
If a domain later gains a genuine inverse it can supply an adapter directly.

Interior orientation for a closed spline is an adapter concern, not a core one:
the interior is the side the loop winds counter-clockwise around when viewed
along `normalAt`, and is required to be the **smaller** region unless the
definition sets `invertInterior`. On a plane the smaller-region rule is inert;
on a sphere it is the entire disambiguation.

### 3. Masks are fields; images are caches

A spline mask is a function `fieldPosition -> [0,1]`, evaluated on the CPU at
any resolution. Baked images exist only as an optimisation or an export.

This is the same rule `005` and `006` already enforce for displacement: if the
authoritative mask lived in a texture, CPU sampling (physics placement, scatter
density, collider heights) and GPU sampling (the rendered surface) would
disagree, and terrain detail would be locked to the bake resolution. Rocks
float and grass sinks exactly the same way here.

Where a raster is genuinely wanted — editor preview, export to an external
tool, a very expensive composite that is stable for a session — it is produced
by `bakeMaskTile()` from the same field, per patch/tile, and is explicitly
labelled a cache tagged with the `revision` it was baked from.

### 4. The two queries that everything else is built on

Get these right and the rest is bookkeeping:

```ts
/** Ambient nearest point. No signed quantities — see decision 1. */
interface ISplineProximity {
  readonly distance: number;        // unsigned 3D distance, field-space units
  readonly arcLength: number;       // distance along the spline of that point
  readonly t: number;               // global arc-normalized parameter in [0,1]
  readonly point: TerrainVector3;
  readonly tangent: TerrainVector3;
  readonly segmentIndex: number;
}

// core — ambient, unsigned
closestPoint(position: TerrainVector3): ISplineProximity;

// core — signed only when the caller supplies the frame
lateralOffset(
  proximity: ISplineProximity,
  position: TerrainVector3,
  referenceNormal: TerrainVector3,
): number;
signedAreaDistance(          // closed splines only
  position: TerrainVector3,
  referenceNormal: TerrainVector3,
): number;
```

Every consumer is a thin wrapper over these:

| Consumer | Built from |
|---|---|
| River/road carving | `closestPoint` + width/depth profile |
| Area mask (island, mountain, biome) | `signedAreaDistance` + falloff |
| Scatter exclusion / inclusion | mask sample as a density multiplier |
| Road ribbon mesh | arc-length sampling + rotation-minimizing frames |
| Editor hit-testing | `closestPoint` against a ray-projected position |
| BSP keep-out zones | `signedAreaDistance` sign test on a known plane |

Both queries must be deterministic, including tie-breaking on exactly
equidistant segments (rule: lowest `segmentIndex`, then lowest `t`).

`signedAreaDistance` stays in `core` rather than moving to the surface layer:
winding **given a normal** is pure geometry, it must be testable without
terrain, and a known-plane consumer such as BSP keep-out zones needs it without
dragging in a terrain domain. The adapter's job is to supply the normal and the
seam policy, not to own the math.

### 5. Rotation-minimizing frames, not Frenet

Frenet frames flip on inflection points and are undefined on straight segments
— both are guaranteed to occur in hand-authored roads. Use parallel transport
(double-reflection) frames, with:

- an explicit initial reference vector (from the adapter's `normalAt` at
  `t = 0` when surface-bound, otherwise caller-supplied);
- per-point authored `roll` added on top of the transported frame;
- for closed splines, the residual twist after a full loop distributed
  uniformly along arc length so the frame closes within `frameClosureTol`.

Frame continuity is the difference between a usable road ribbon and a ribbon
that visibly corkscrews.

### 6. Arc-length is first class; channels have declared interpolation policies

Uniform parameter `t` bunches samples on tight curves. All public sampling
takes **distance along the spline**, backed by an adaptive subdivision table
with a documented chord tolerance and monotonic inverse lookup. `t` remains
available for editors but is not the sampling currency.

Per-point channels interpolate in arc length too — otherwise a road authored
with sparse points changes width faster on curves than on straights. But not
every channel may be lerped, so each declares a policy:

```ts
type SplineChannelInterpolation = 'linear' | 'step' | 'angle';

interface ISplineChannelDefinition {
  readonly defaultValue: number;
  readonly interpolation: SplineChannelInterpolation;
}
```

- `linear` — width, falloff distance, elevation offset.
- `step` — `materialId`, flags, lane count. Holds the previous point's value
  until the next point. Lerping a material id to `2.5` is a bug that renders.
- `angle` — `roll` and any heading, interpolated on the shortest arc so
  `350° → 10°` crosses zero instead of sweeping backwards through 180°.

A point that omits a channel takes `defaultValue`; it is **not** a hole to
interpolate across, because that would make adding a single keyframe silently
change the value everywhere else on the spline.

Reserved channel names live in a typed constants object
(`SPLINE_CHANNELS.widthM`), never string literals, so a typo is a compile error
rather than a silently-zero width.

### 7. Immutable definitions, runtime revision, identity-keyed caches

`schemaVersion` is the **serialization format** version and must never be used
for cache invalidation — it changes when the file format changes, not when a
user drags a point.

- `ISplineDefinition` values are immutable; every edit returns a new object.
- In-memory caches (arc-length table, segment BVH, frames) are keyed by object
  identity in a `WeakMap`, so a superseded definition's caches are collected
  with it and there is no counter to forget to bump.
- Artifacts that outlive the object — baked mask tiles, exported rasters —
  carry a `revision` from the runtime handle that owns the definition. A
  `WeakMap` cannot tag those, and `schemaVersion` must not.
- `revision` lives on the runtime handle only and is excluded from serialized
  JSON, so the same saved file always reloads to identical bytes.

### 8. Tolerances are API, not implementation details

Each of these is a separate number with a separate default, documented and
overridable. Folding them into one `epsilon` is how curve libraries become
untunable:

| Tolerance | Governs | Who notices when it is wrong |
|---|---|---|
| `duplicatePointTol` | rejecting coincident control points | validation, NaN tangents |
| `chordTol` | arc-length subdivision density | sample spacing, ribbon smoothness |
| `closestPointTol` | proximity solver convergence | mask edge quality |
| `bvhLeafSpan` | segment BVH leaf size | query cost only, never correctness |
| `frameClosureTol` | residual twist on a closed loop | ribbon corkscrew |
| `projectionTol` | surface-projection convergence | snapping, sag correction |

Defaults are expressed relative to the spline's bounding extent rather than as
absolute numbers, so a 10 m garden path and a 500 km coastline both behave
without per-consumer tuning.

## Proposed data model

```ts
type SplineInterpolation = 'linear' | 'catmullRom' | 'bezier';

interface ISplinePoint {
  readonly position: TerrainVector3;      // field space, f64
  /** Bezier handles, field space, relative to position. Ignored otherwise. */
  readonly handleIn?: TerrainVector3;
  readonly handleOut?: TerrainVector3;
  readonly handleMode?: 'auto' | 'mirrored' | 'broken' | 'linear';
  readonly roll?: number;                 // radians, added to the transported frame
  readonly channels?: Readonly<Record<string, number>>;
}

interface ISplineDefinition {
  readonly schemaVersion: number;         // format only — never cache invalidation
  readonly id: string;
  readonly interpolation: SplineInterpolation;
  readonly closed: boolean;
  readonly tension?: number;              // catmullRom only, per spline
  readonly points: readonly ISplinePoint[];
  readonly channelSchema?: Readonly<Record<string, ISplineChannelDefinition>>;
  readonly invertInterior?: boolean;      // closed only
}
```

`channels` is an open record rather than fixed fields so hydrology can add
`dischargeM3s` and a road can add `laneCount` without editing this type. The
package defines and documents a small set of **reserved** channel names
(`widthM`, `falloffM`, `elevationOffsetM`) that the built-in profiles read.

**Interpolation is fully specified before any code is written:**

- **Catmull-Rom is centripetal (α = 0.5)** by default. Uniform parameterization
  produces cusps and self-intersection on unevenly spaced points, which
  hand-authored splines always have. `tension` is per spline, not per point.
- **Open-spline endpoints** use a reflected phantom point
  (`p₀ − (p₁ − p₀)`), not a duplicated one, so the end tangent is non-zero.
- **Missing Bezier handles** fall back to the `auto` handle (one third of the
  chord toward each neighbour), never to the point itself.
- **Zero-length and near-zero segments** are rejected at validation via
  `duplicatePointTol` rather than carried into evaluation as NaN tangents.
- **Closed splines do not repeat the first point** in serialized data; the wrap
  segment is implied by `closed: true`. A round trip must not grow the array.
- **`t` is the global arc-normalized parameter** in `[0,1]` — not a segment
  parameter and not uniform-per-segment. `segmentIndex` plus a local parameter
  is exposed separately for editors.
- **Minimum point counts**: open ≥ 2, closed ≥ 3. A closed loop of two points
  is a degenerate back-and-forth with no interior and is rejected.

Mask side:

```ts
interface ISplineMask extends IScalarField {
  /** 0 outside influence, 1 fully inside. Deterministic and side-effect free. */
  sample(fieldPosition: TerrainVector3): number;
  sampleBatch(positions: Float64Array, out?: Float64Array): Float64Array;
  /** Conservative field-space bounds; outside these sample() is exactly 0. */
  readonly bounds: IFieldBounds;
}
```

`sampleBatch` mirrors `ITerrainField.sampleBatch` so a mask can be evaluated
per patch without per-point call overhead, and `bounds` lets terrain skip whole
patches — without it, a landscape with 200 splines samples all 200 per vertex.

## Scalar sources — the composability boundary

`ITerrainField.sample()` returns `{ elevationM }`; a mask sample is a bare
`[0,1]` scalar. As written they are **not composable**, and the layer stack has
to consume both.

The neutral contract is `IScalarField`, and it must live in **`terrain`**, not
in `spline`:

```ts
interface IScalarField {
  sample(fieldPosition: TerrainVector3): number;
  sampleBatch(positions: Float64Array, out?: Float64Array): Float64Array;
  readonly bounds?: IFieldBounds;   // conservative; undefined means unbounded
}
```

If `IScalarField` lived in `spline`, terrain would have to import spline to
express its own layer stack — precisely the reverse dependency `006` forbids.
So terrain owns it: `ITerrainField` becomes expressible as an `IScalarField`
plus an elevation adapter, and `ISplineMask extends IScalarField`. Spline
imports the contract; terrain imports nothing.

## Layer composition — who owns it

The user's "combine noise with black and white additions of those layers" is
**terrain field composition**, which `006` already assigned to terrain. Split:

- `spline` provides mask **sources** (`ISplineMask` implementations: area fill,
  corridor, distance ramp) and the raster **baker** for preview/export.
- `terrain` provides the ordered layer stack that consumes any `IScalarField` —
  noise, spline masks, imported heightmaps — with blend ops (`add`, `subtract`,
  `multiply`, `min`, `max`, `lerpByMask`) producing one composed
  `ITerrainField`.

Do not build the layer graph inside `spline`. If it lands there, the spline
package becomes a terrain authoring tool and terrain gains a hidden dependency
on spline for a feature that has nothing to do with curves.

The landscape-editor stack for the target use case then reads:

```text
base ocean field
  + islandArea.mask       (closed spline, wide falloff)  * islandHeightNoise
  + mountainArea.mask     (closed spline, ridged noise)  * mountainAmplitude
  - riverCorridor.mask    (open spline, depth profile)
  - roadCorridor.mask     (open spline, flatten-to-centreline)
```

Each line is one layer in the terrain stack; each mask is one spline. That is
the whole editor model.

## Proposed package layout

```text
projects/triangular-engine/spline/
  core/                     # framework-free, no Three.js, no Angular, ambient 3D
    spline-definition.ts        # types above + validation
    spline-channels.ts          # reserved names, schemas, interpolation policies
    spline-tolerances.ts        # named tolerances + relative defaults
    spline-evaluate.ts          # position/tangent/channel at t
    spline-arc-length.ts        # subdivision table + inverse lookup
    spline-frames.ts            # rotation-minimizing frames
    spline-proximity.ts         # closestPoint (brute force + BVH) 
    spline-area.ts              # winding + signedAreaDistance(pos, normal)
    spline-edit.ts              # immutable insert/remove/move/split/reverse
    spline-serialization.ts     # schema-versioned JSON round trip
    spline-mask.ts              # ISplineMask + area/corridor/ramp masks
    spline-profile.ts           # falloff curves, width/depth profiles
  terrain/                  # depends on terrain *contracts* only
    spline-surface-adapter.ts     # ISplineSurfaceAdapter contract
    spline-plane-adapter.ts       # closed-form, identity seam policy
    spline-sphere-adapter.ts      # geodesic metric, pole/seam handling
    spline-cylinder-adapter.ts    # wrap seam handling
    spline-surface-projection.ts  # snap + sag correction onto the sampled surface
    spline-mask-tile.ts           # bakeMaskTile for preview/export
  three/                    # Three.js renderers, no Angular
    spline-line-geometry.ts       # centreline + handle visualisation
    spline-ribbon-geometry.ts     # extruded profile along the spline
    spline-handle-meshes.ts       # control point / tangent gizmo meshes
    spline-picking.ts             # ray -> closestPoint hit testing
  engine/                   # Angular
    spline-editor.service.ts      # selection, drag, undo/redo, snapping
    spline.component.ts           # <spline> declarative host
  public-api.ts
  ng-package.json
  README.md
```

Dependency direction is one-way: `core` ← `terrain` ← `three` ← `engine`.
`core` must build and test with no Three.js import at all; that is the test
that the geometry is genuinely reusable.

## Phases

### Phase 0A — Definitions and a reference implementation

- [x] `ISplineDefinition` / `ISplinePoint` types plus validation (min point
      counts, finite values, closed-loop rules, `duplicatePointTol` rejection).
      `spline-definition.ts`.
- [x] `evaluate(t)` for **linear and cubic Bezier only**, open and closed.
      `spline-evaluate.ts` (raw-parameter basis); `catmullRom` throws an
      explicit "lands in Phase 0B" error rather than silently no-oping.
- [x] Arc-length table with documented `chordTol`; `evaluateAtDistance()` and
      `distanceToT` / `tToDistance` inverses. `spline-arc-length.ts`, with an
      identity+tolerance-keyed `WeakMap` cache per decision 7.
- [x] **Brute-force** `closestPoint` over dense samples — deliberately slow,
      deliberately obviously correct. `spline-proximity.ts`: uniform dense
      scan (64 samples/segment default) plus a fixed-iteration ternary-search
      refinement, independent of the arc-length table's own build logic.
- [x] Schema-versioned serialization with an exact f64 round-trip test, and a
      test that a closed spline does not grow its point array.
      `spline-serialization.ts`.

Exit gate: an executable correctness baseline exists. Every acceleration added
later is validated against this implementation, not against intuition.
**Met** — 68 tests passing (`npx ng test triangular-engine --watch=false
--browsers=ChromeHeadless --include='../spline/**/*.spec.ts'`), library
builds clean, zero Three.js/Angular imports in `spline/core`. Not yet
implemented, deliberately deferred to their assigned phase: Catmull-Rom
(0B), channel interpolation policies actually driving sampled output (0B —
the types and validation exist now, execution doesn't yet), rotation-minimizing
frames (0B), immutable edit ops (0B), the segment BVH (0C).

### Phase 0B — Catmull-Rom, channels, frames, editing

- [ ] Centripetal Catmull-Rom with `tension` and reflected-phantom endpoints.
- [ ] Channel schemas with `linear` / `step` / `angle` policies and
      default-on-omission semantics.
- [ ] Rotation-minimizing frames with authored roll and closed-loop closure.
- [ ] Immutable edit operations with identity-keyed cache invalidation and the
      runtime `revision` handle.

Tests: degenerate two-point open splines; coincident control points rejected;
a closed spline at the minimum legal point count, plus rejection below it;
straight segments (where Frenet would be undefined); arc-length monotonicity
under randomised control points; `step` channels never producing an
intermediate value; `angle` channels taking the short way around; reversal
invariance (`reverse(reverse(s))` equals `s`); frame closure error on a closed
loop below `frameClosureTol`.

Exit gate: frames close, edits round-trip, and no channel interpolates against
its declared policy.

### Phase 0C — Acceleration

- [ ] Segment BVH backing `closestPoint`, with deterministic tie-breaking.
- [ ] Randomised agreement against the Phase 0A brute force within
      `closestPointTol`, across all three interpolation families.

Exit gate: `core` has no Three.js or Angular import, tests pass, and the
accelerated path agrees with the reference on randomised inputs.

### Phase 1A — Surface adapter and plane masks

- [ ] `ISplineSurfaceAdapter` contract plus the plane adapter.
- [ ] `signedAreaDistance` with planar winding and the orientation convention.
- [ ] Area mask (closed), corridor mask (open), distance-ramp mask.
- [ ] Falloff profile curves (linear, smoothstep, custom easing table) and
      width/depth profiles driven by channels.
- [ ] Conservative `bounds` per mask and a per-patch rejection test.
- [ ] `sampleBatch` implementations.
- [ ] `IScalarField` in `terrain`, and the terrain-side layer stack consuming
      masks and noise into one `ITerrainField` (lands in `terrain`, tracked
      here for sequencing).

Exit gate: an island outline plus a mountain area plus a road corridor compose
into a single `ITerrainField` on a plane that meshes without seams, and the CPU
sample at any point matches the rendered surface.

### Phase 1B — Sphere and cylinder topology

- [ ] Sphere and cylinder adapters with `normalizeAcrossSeam`, geodesic
      `surfaceDistance`, and `metricScaleAt`.
- [ ] Surface re-projection of evaluated curves, correcting the chord sag from
      decision 1 within `projectionTol`.
- [ ] Smaller-region containment on a closed surface, with explicit tests for a
      loop crossing the seam, a loop enclosing a pole, and a loop larger than a
      hemisphere.
- [ ] Surface projection and snapping helper built on the adapter.

Exit gate: the same island/road stack runs on a sphere domain, and every
ambiguous-containment case behaves per the documented rule rather than by
accident.

### Phase 2 — Rendering and raster bake

- [ ] Centreline and handle geometry for editor display, with depth-tested and
      overlay variants.
- [ ] Ribbon geometry from arc-length samples plus frames plus a profile —
      the shared basis for roads and the `006` water ribbon.
- [ ] `bakeMaskTile()` with a fully pinned contract: domain address and the
      UV→field transform used; width, height, format and bit depth; row
      orientation; border/overlap in texels so adjacent tiles do not seam; wrap
      behaviour at sphere poles and the cylinder seam; the field-space bounds
      and the source `revision`.
- [ ] State explicitly whether a "combined image" **blends** several masks into
      one channel or merely **assembles** tiles into an atlas. These are
      different features — the editor preview needs the first, export needs the
      second — and calling both "combined" guarantees one gets built wrong.

Exit gate: a road ribbon follows a curved spline with no corkscrew, and a baked
mask tile matches CPU `sample()` within quantisation error including across a
tile boundary.

### Phase 3 — Editing and placement

- [ ] `<spline>` declarative host and an editor service with selection,
      point drag, handle drag, insert/split/delete, and undo/redo over the
      immutable edit ops.
- [ ] Snapping: to the terrain surface (via the adapter), to other spline
      endpoints, to a grid, and to a fixed elevation.
- [ ] Handle modes (auto / mirrored / broken / linear) in the UI.
- [ ] Persistence in the demo app, then a documented consumer-side format.

Exit gate: a spline can be drawn, edited, saved, reloaded and re-edited without
any drift in sampled geometry.

### Phase 4 — Consumers

- [ ] `/landscape-lab` demo: island outline + mountain area + river + road over
      noise, editable live, showing the layer stack.
- [ ] Migrate `river-lab`'s `RiverPath` onto the spline core so `006` Phase 1
      is satisfied by this package rather than by demo-local code.
- [ ] Scatter density multiplier from a spline mask (keep trees off the road).
- [ ] Demonstrate the same pipeline on a sphere domain, not only a plane.

Exit gate: the river POC, a road, and an area mask all run on one spline
implementation, and none of terrain, water or scatter imports `spline` for a
feature-specific reason.

## Integration checklist

Landing a new secondary entry point is more than adding a folder:

- [ ] `spline/ng-package.json` and `spline/public-api.ts`, with exports layered
      `core` → `terrain` → `three` → `engine` as `scatter/public-api.ts` does.
- [ ] Entry point added to the test include configuration so
      `spline/**/*.spec.ts` actually runs under `npx ng test triangular-engine`.
- [ ] `projects/triangular-engine/README.md` entry-point matrix row.
- [ ] `spline/README.md` with a minimal authoring example.
- [ ] A page under `projects/triangular-engine/docs/`, and a link back from
      `006_river_poc.md`.
- [ ] `CHANGELOG.md` entry — this is a public API addition.
- [ ] Demo route registered for `/landscape-lab`.

## Non-goals

- NURBS with rational weights — add only if a real consumer needs it.
- Spline **surfaces** (patches, lofts); this package is curves plus masks.
- Automatic road intersection resolution, junction meshing, or T-junction
  stitching in the first pass.
- Follow-the-path animation and camera rails (separate concern, may consume
  this package later).
- Hydrology semantics — flow direction, discharge, tributaries — which belong
  to the future hydrology package.
- Replacing `trail`, which is runtime-motion generated, not authored.
- An in-game level editor UI; Phase 3 is a demo-app editor, not a product.

## Risks

- **Scope creep into terrain authoring.** The layer stack must land in terrain.
  Watch for `spline/core` growing a noise import.
- **The adapter becoming a second terrain domain.** `ISplineSurfaceAdapter`
  must stay a narrow projection/metric/seam contract. If it starts growing
  elevation sampling or patch selection, the package has forked terrain.
- **Ambient/surface leakage.** The moment a signed quantity appears in `core`
  without an explicit normal argument, decision 1 has been silently reversed
  and sphere support is broken again. Worth a lint or a review checklist item.
- **Mask cost per vertex.** Without `bounds` rejection, mask sampling is
  O(N splines) per terrain vertex. Spatial rejection is a Phase 1A requirement,
  not an optimisation.
- **Editor precision at planetary scale.** Handles and drags happen in f32
  screen space over f64 field positions; the drag path must apply deltas to the
  f64 value, never round-trip the position through f32.

## Verification

```powershell
npx ng test triangular-engine --watch=false --browsers=ChromeHeadless
npm run build:triangular-engine
npx ng build demo-app --configuration development
```

Confirm `spline/core` has no Three.js or Angular import, and that no file in
`terrain/`, `water/` or `scatter/` imports `spline`. Preserve unrelated
dirty/staged work; do not reset, restore, stash, clean, or broadly stage the
workspace.

## Decision log

### 2026-08-02 — Contract proposed

- Scoped the package to curves plus masks, keeping the layer/composition graph
  in terrain per the `006` boundary.
- Chose field-space f64 representation over 2D so splines work on plane,
  sphere and cylinder domains.
- Chose fields-not-images for masks, matching the existing displacement rule.
- Chose rotation-minimizing frames over Frenet, and arc-length over uniform `t`
  as the sampling currency.
- Named `closestPoint` and `signedAreaDistance` as the two primitives every
  consumer must be expressible in.
- Entry-point name `triangular-engine/spline` is a recommendation pending user
  confirmation.

### 2026-08-02 — External review applied

- Split ambient-3D curve math from surface-bound operations. The original claim
  that "closest-point and distance queries are plain 3D queries and work
  unchanged on every domain" was wrong: Cartesian interpolation sags below a
  sphere, and signed/containment queries are undefined without a normal. `core`
  now exposes no unqualified signed quantity, and `distanceM` lost its unit
  suffix because field-space units are domain-defined, not guaranteed metres.
- Added `ISplineSurfaceAdapter` after confirming `ITerrainSurfaceDomain` has no
  inverse from a field position to `(address, u, v)`. Chose an adapter over
  extending every terrain domain, which would burden implementers with an
  inverse most will never use.
- Placed `IScalarField` in `terrain`, not `spline`, so masks and elevation
  fields compose without terrain gaining a reverse dependency on spline.
- Replaced the `version` counter with identity-keyed `WeakMap` caches plus a
  runtime `revision` for artifacts that outlive the object. `schemaVersion` is
  serialization only and must never drive invalidation.
- Specified interpolation completely up front — centripetal Catmull-Rom,
  phantom endpoints, missing-handle fallback, closed-spline serialization, and
  `t` as the global arc-normalized parameter.
- Gave channels declared interpolation policies so `materialId` and flags step
  rather than lerp, and `roll` interpolates on the shortest arc.
- Promoted tolerances to named API with extent-relative defaults.
- Split Phase 0 into 0A/0B/0C and Phase 1 into 1A/1B so a brute-force
  correctness baseline exists before any acceleration or closed-surface
  topology is introduced.
- **Declined** relocating `signedAreaDistance` into `terrain` wholesale.
  Winding given a reference normal is pure geometry; exiling it would make it
  untestable without terrain and unusable for a known-plane consumer such as
  BSP keep-out zones. It stays in `core`, parameterized by an explicit normal,
  with the adapter supplying that normal and the seam policy.
- **Declined** the binary64-versus-f64 wording change. `f64` is the existing
  house term in `terrain-surface-sample.ts`; diverging here would be the
  inconsistency, not the fix.

### 2026-08-02 — Phase 0A implemented

- Built `spline/core`: `spline-math.ts`, `spline-tolerances.ts`,
  `spline-definition.ts`, `spline-evaluate.ts`, `spline-arc-length.ts`,
  `spline-proximity.ts`, `spline-serialization.ts`. 68 tests, all passing;
  `npm run build:triangular-engine` builds the new entry point cleanly.
- Defined `SplineVector3` locally in `spline/core` rather than importing
  `TerrainVector3` from `terrain` — structurally identical, but keeps
  `spline/core` at zero import dependencies on any other package, which is
  a stronger and more directly testable claim than "no Three.js import."
- Auto Bezier handle fallback implemented as one third of the immediate
  chord toward each respective neighbour (independent per handleIn/handleOut,
  not a symmetric two-neighbour average) — matches the decision-6 wording
  exactly and needs no special-casing at open-spline endpoints, since
  `handleOut` is only ever evaluated at segment starts and `handleIn` only at
  segment ends.
- Added a central-difference fallback when a Bezier derivative is
  near-zero (e.g. an explicit zero-length handle at a cusp), rather than
  letting `normalizeVec3` throw. This wasn't called out in the doc's
  interpolation spec; it's a numerical safety net, not a feature.
- Tie-breaking in `closestPoint` is implemented as "first strictly-better
  candidate wins" while scanning in increasing raw-parameter order, which
  is exactly "lowest segmentIndex, then lowest t" without separate
  bookkeeping, because raw parameter and arc length are monotonically
  related.
- `closestPoint`'s refinement step (ternary search) uses a **fixed**
  iteration count (32) rather than a `closestPointTol`-based convergence
  check — deliberately simpler to verify by inspection for a function whose
  entire purpose is being an obviously-correct oracle for Phase 0C.
- Channel schema types and validation exist now (`ISplineChannelDefinition`,
  `SPLINE_CHANNELS`), but interpolation execution honoring `linear` / `step`
  / `angle` policies is not wired into any sampling path yet — that's 0B, as
  planned. Declaring the types now avoids a breaking change to
  `ISplineDefinition` later.
