# 005a — Scatter Phase 3 implementation plan (Jolt collider ring + removal overlay)

Implementation plan for Phase 3 of [`005_scatter_sublibrary.md`](005_scatter_sublibrary.md).
Phases 0–2 are done; this doc is the step-by-step for an implementing agent.

## TL;DR

Phase 3 gives scatter instances physics without breaking the derived-data
rule. Four new core/three modules (residency ring, removal overlay, collider
descriptors), one new `ScatterJoltColliderAdapter` in the jolt entry that owns
one **static compound body per physics cell** (sub-shape userData → instance
index), and a hit-resolution path that runs through the *vehicle's* existing
`onContactAdded` rather than new engine-level contact plumbing. Nothing is
persisted: removals are a game-owned overlay set applied identically to render
batches and collider cells.

## Ground rules carried from 005

- Scatter core never imports Jolt. Jolt imports scatter, never the reverse.
- Identity cells, render batches, and physics residency stay three separate
  axes. Physics residency reuses identity-cell addresses but gets its **own
  radius, own anchor, own hysteresis** — it follows the player/vehicle with
  velocity look-ahead, never the camera.
- Instance transforms stay anchor-relative (f32) with an f64 cell anchor.
  The compound body's position is the f64 anchor; sub-shapes are f32 local.
- The library does descriptors + derivation + stable IDs. Falling trees,
  wood yields, respawn, and save files are the game's.

## Verified engine/binding facts this plan depends on

Checked against `d:\code\_external\JoltPhysics.js\JoltJS.idl` and the existing
jolt entry — do not re-derive, but do re-check if bindings are upgraded:

- `CompoundShapeSettings.AddShape(position, rotation, shape, userData)` takes a
  32-bit `unsigned long` userData per sub-shape.
- `Shape.GetSubShapeUserData(SubShapeID)` returns it back at contact time.
- `ContactManifold` exposes `mSubShapeID1`, `mSubShapeID2`,
  `mWorldSpaceNormal`, and `GetWorldSpaceContactPointOn1/2(index)`.
- `BodyInterface.ActivateBodiesInAABox(box, broadPhaseFilter, objectFilter)`
  exists (needed after removing a collider under a resting body).
- **Contact events are dispatched to `JoltRigidBodyComponent`s only.**
  `JoltPhysicsComponent.OnContactAdded` resolves both bodies through
  `userDataToComponent` / `bodyIdToComponent` and returns early when neither
  side has subscribers. Bodies created directly through `bodyInterface` — as
  `TerrainJoltColliderAdapter` does and as this adapter will — therefore
  receive **no** contact callbacks. This is why hit resolution is driven from
  the vehicle side (step 5), and why no engine-level contact-sink registry is
  being added in this phase.
- `OnContactAdded` has no solved impulse available (only the manifold), so the
  impact test is an approximation — see step 5.

## Step 1 — Physics residency ring (`scatter/core`)

New file `scatter/core/scatter-physics-residency.ts`. Pure, no three.js.

```ts
export interface IScatterPhysicsAnchorOptions {
  readonly positionM: readonly [number, number, number];
  readonly velocityMps: readonly [number, number, number];
  /** Ring centre is pushed this far along velocity, so a fast rover never outruns its colliders. */
  readonly lookAheadSeconds: number;
  /** Clamp so a very fast vehicle doesn't drag the ring off its own position entirely. */
  readonly maxLookAheadM: number;
}

export function computeScatterPhysicsAnchor(
  options: IScatterPhysicsAnchorOptions,
): readonly [number, number, number];

export interface IScatterResidencyDiffOptions {
  readonly residentKeys: ReadonlySet<string>;
  readonly candidates: readonly { key: string; centreWorldM: readonly [number, number, number] }[];
  readonly anchorWorldM: readonly [number, number, number];
  readonly addRadiusM: number;
  /** Must be > addRadiusM; the gap is the ring's hysteresis band. */
  readonly removeRadiusM: number;
}

export interface IScatterResidencyDiff {
  readonly toAdd: readonly string[];
  readonly toRemove: readonly string[];
  readonly residentKeys: ReadonlySet<string>;
}

export function diffScatterPhysicsResidency(
  options: IScatterResidencyDiffOptions,
): IScatterResidencyDiff;
```

Notes:

- Cell *selection* still reuses `selectFixedLevelScatterCells` with the
  physics anchor and `removeRadiusM` — do not invent a second grid.
- Asymmetric add/remove radii are mandatory, not a nicety: without them a
  vehicle parked exactly on a boundary rebuilds a compound shape every frame.
- Throw `RangeError` on `removeRadiusM <= addRadiusM` and on non-finite input,
  matching the existing validation style in `scatter-terrain-cells.ts`.

Tests (`scatter-physics-residency.spec.ts`): look-ahead direction and clamp;
stationary vehicle produces empty diffs across repeated calls; a cell inside
the band stays resident when it was resident and stays out when it wasn't;
invalid radii throw.

## Step 2 — Removal overlay (`scatter/core`)

New file `scatter/core/scatter-removal-overlay.ts`. Pure, serializable.

```ts
export interface IScatterRemovalOverlay {
  readonly removedIds: ReadonlySet<ScatterInstanceId>;
}

export function createScatterRemovalOverlay(
  removedIds?: Iterable<ScatterInstanceId>,
): IScatterRemovalOverlay;

export function withScatterInstanceRemoved(
  overlay: IScatterRemovalOverlay,
  instanceId: ScatterInstanceId,
): IScatterRemovalOverlay;

export function withScatterInstanceRestored(
  overlay: IScatterRemovalOverlay,
  instanceId: ScatterInstanceId,
): IScatterRemovalOverlay;

/** Games persist this array; the library never touches storage. */
export function serializeScatterRemovalOverlay(
  overlay: IScatterRemovalOverlay,
): readonly ScatterInstanceId[];

export function filterRemovedScatterInstances<T extends { instanceId: ScatterInstanceId }>(
  instances: readonly T[],
  overlay: IScatterRemovalOverlay,
): readonly T[];
```

Immutable-update style (returns a new overlay) so Angular signal/`computed`
consumers see a reference change.

**Hard rule to state in the JSDoc and enforce in the demo:** the same overlay
must be applied to render-batch generation *and* collider-cell generation.
A tree that is visually gone but still collidable is the canonical Phase 3 bug.

Tests: add/restore idempotence; original overlay unmutated; filter drops
exactly the removed IDs; serialize round-trips.

## Step 3 — Collider descriptors (`scatter/three`)

New file `scatter/three/scatter-collider-descriptors.ts`. Lives in `three/`
(not `core/`) because it reuses `computeScatterInstanceMatrix` for rotation —
duplicating that math in core would be a second source of truth for placement.

```ts
export interface IScatterColliderDescriptor {
  readonly instanceId: ScatterInstanceId;
  readonly speciesId: string;
  /** Anchor-relative (f32-safe); the body carries the f64 anchor. */
  readonly anchorRelativePositionM: readonly [number, number, number];
  readonly rotation: readonly [number, number, number, number]; // xyzw
  readonly shape: ScatterColliderDefinition['shape'];
  readonly params: readonly number[];
  /** Uniform scale already applied to params where the shape supports it. */
  readonly scale: number;
}

export interface IScatterCellColliderDescriptors {
  readonly cellKey: string;
  readonly anchorWorldM: readonly [number, number, number];
  readonly descriptors: readonly IScatterColliderDescriptor[];
}

export function buildScatterColliderDescriptors(options: {
  readonly cellKey: string;
  readonly anchorWorldM: readonly [number, number, number];
  readonly instances: readonly ITerrainScatterInstance[];
  readonly species: ScatterSpeciesDefinition;
  readonly scale: ScatterScaleRange;
  readonly overlay?: IScatterRemovalOverlay;
}): IScatterCellColliderDescriptors;
```

- Species without a `collider` yield an empty descriptor list (pebble-scale
  clutter — no collider at all, per 005).
- Decompose the instance matrix (`Matrix4.decompose`) rather than
  recomputing rotation independently.
- Scale handling: uniform scale multiplies box half-extents / sphere radius /
  capsule + cylinder dimensions. Hull params scale too, but hull support in
  the adapter is v2 — descriptors may carry it, the adapter may throw
  `not-yet-supported` on `'hull'` in this phase (state it in the JSDoc).

Tests: no collider definition → empty; removal overlay drops descriptors;
positions are anchor-relative and stay small at a planetary-radius anchor
(the precision regression test — assert magnitude, not exact values);
scale applied to params.

## Step 4 — `ScatterJoltColliderAdapter` (`jolt/scatter`)

New folder `jolt/scatter/` with `scatter-jolt-collider-adapter.ts` + `index.ts`,
re-exported from `jolt/public-api.ts` (add `export * from './scatter';`).
Mirror `TerrainJoltColliderAdapter`'s shape closely — same constructor
(`IJoltMetadata`), same `has` / `add` / `remove` / `reconcile` / `dispose`
surface, same discipline of `Jolt.destroy(...)` on every temporary.

```ts
export class ScatterJoltColliderAdapter {
  constructor(metadata: IJoltMetadata);

  get residentCellCount(): number;
  get residentInstanceCount(): number;

  has(cellKey: string): boolean;
  add(cell: IScatterCellColliderDescriptors): void;
  remove(cellKey: string): void;
  reconcile(desiredCellKeys: ReadonlySet<string>): void;

  /** Rebuilds that cell's compound minus the instance; no-op if unknown. */
  removeInstance(instanceId: ScatterInstanceId): void;

  /** Contact-time lookup: which scatter instance is this body+sub-shape? */
  resolveInstanceId(body: Jolt.Body, subShapeId: Jolt.SubShapeID): ScatterInstanceId | undefined;

  dispose(): void;
}
```

Implementation:

1. One `Jolt.StaticCompoundShapeSettings` per cell. For each descriptor,
   `AddShape(localPos, localRot, shapeSettings, index)` where `index` is the
   descriptor's position in that cell's array.
2. One static body per cell at the cell's f64 anchor
   (`Jolt.RVec3`), `EMotionType_Static`, `LAYER_NON_MOVING`, added with
   `EActivation_DontActivate` — same as the terrain adapter.
3. Keep per-cell state: `{ body, instanceIds: ScatterInstanceId[], descriptors }`
   plus a reverse `Map<ScatterInstanceId, cellKey>` for `removeInstance`.
4. `resolveInstanceId`: `body.GetShape().GetSubShapeUserData(subShapeId)` →
   index → the cell's `instanceIds[index]`. Match the body via its
   `GetID().GetIndexAndSequenceNumber()` in a `Map<number, cellKey>` — do not
   rely on `Jolt.Body` object identity across wrapPointer calls.
5. `removeInstance` rebuilds the whole cell compound minus one entry. This is
   fine: felling is rare and per-cell instance counts are small. Do not try to
   mutate a `StaticCompoundShape` in place — it is immutable by design.
6. After `remove`/`removeInstance`, wake anything resting on the destroyed
   geometry (`ActivateBodiesInAABox` over the cell bounds, or
   `ActivateBody` on a caller-supplied vehicle body — pick the simple one and
   note it). Skipping this leaves a rover hovering on a collider that no
   longer exists.
7. Empty cells (all instances removed, or a species with no collider) should
   create **no body at all** rather than an empty compound — Jolt rejects
   compound shapes with zero sub-shapes.

Tests: the jolt entry has no headless-Jolt test harness today, so this class
is verified in the demo, not in Karma. Keep every decision that *can* be
unit-tested (descriptor building, residency diff, overlay) out of this file —
that is the point of steps 1–3. Do not add a Jolt WASM dependency to the test
target for this phase.

## Step 5 — Impact-threshold destruction

Route, given contact events reach components only:

1. The game's vehicle is a `JoltRigidBodyComponent`; it already exposes
   `onContactAdded`. The demo subscribes there.
2. On each event, call `adapter.resolveInstanceId(event.otherBody, event.manifold.mSubShapeID2)`
   — with the caveat that manifold body ordering is not guaranteed, so try
   both sub-shape IDs against the resolved body and use whichever hits.
3. Estimate impact from what is available at `OnContactAdded` time
   (**no solved impulse exists yet**): approach speed along
   `manifold.mWorldSpaceNormal`, times the vehicle's mass:

```ts
export function estimateScatterImpactMomentumNs(options: {
  readonly otherBodyMassKg: number;
  readonly otherBodyVelocityMps: readonly [number, number, number];
  readonly contactNormal: readonly [number, number, number];
}): number;
```

   Put this helper in `jolt/scatter/` next to the adapter and document it
   plainly as an approximation of contact momentum, not a measured impulse.
4. Compare against the species' threshold and, above it, emit a
   `IScatterImpactEvent { instanceId, speciesId, cellKey, contactPointM, normal, momentumNs }`
   for the game to act on: remove from the overlay, remove from the batch,
   optionally spawn a short-lived dynamic body (falling tree) from the same
   descriptor, then stump/despawn.

**Species-definition change:** `ScatterColliderDefinition.impactThresholdN` is
misnamed for what is actually comparable here. Rename to
`impactThresholdNs` (contact momentum, kg·m/s) and update the JSDoc to say so.
Nothing outside the demo consumes it yet, so this is a free rename now and a
breaking one later.

## Step 6 — Demo wiring (`scatter-lab`)

Everything above is dead code until the lab exercises it. Add to
`projects/demo-app/src/app/pages/scatter-lab/`:

- A `jolt-physics` scene section with a driveable dynamic sphere/rover and the
  existing terrain collider adapter for the ground.
- Physics ring driven off the rover's position + velocity (step 1), *not* the
  camera — verify by orbiting the camera away and confirming colliders stay
  with the rover.
- `ScatterJoltColliderAdapter.reconcile` each frame from the diff.
- Debug toggle: draw the resident physics cells (the existing Jolt debug
  renderer is enough) plus the ring radii.
- Click-to-cut using the existing Phase 2 picking (`scatter-instance-picking`)
  → overlay removal → batch rebuild + `adapter.removeInstance`, proving both
  paths share one overlay.
- Drive-into-tree felling via step 5.
- HUD counters: resident cells, resident colliders, removed instances,
  last impact momentum.

## Acceptance checks

- Rover drives over rock fields and collides; colliders appear ahead of it at
  speed and despawn behind.
- Camera movement alone never changes collider residency.
- Cut/felled trees disappear from both render and physics, stay gone when the
  cell streams out and back in, and come back if the overlay is cleared.
- Parking on a residency boundary produces no per-frame add/remove churn
  (watch the HUD counters, not the console).
- No Jolt memory growth over a few minutes of driving (the existing 10s
  `[Jolt] free(bytes)` debug log in `jolt-physics.component.ts` is the check).
- `npx ng test triangular-engine --watch=false` passes with the new specs.

## Explicitly out of scope for Phase 3

- Angular convenience components for scatter physics (`scatter/components`
  stays empty this phase).
- Hull colliders (descriptors may carry them; the adapter throws).
- Any engine-level contact-sink registry — revisit only if a real consumer
  needs contacts for scatter bodies without a vehicle component on the other
  side.
- Biome-driven suitability (Phase 4) and impostor baking (Phase 5).
- Persistence of the removal overlay beyond an in-memory demo set.
