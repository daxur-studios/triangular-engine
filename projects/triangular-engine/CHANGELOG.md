# Changelog

All notable changes to triangular-engine are documented here.

## [Unreleased]

### Added

- Added a step-driven deterministic navigation-avoidance scenario API and a
  headed navigation-lab viewer that uses the same core as tests and scripts.
- Navigation avoidance scenario snapshots now expose shared walkable geometry;
  the staged opposing fixture respects agent radius, returns through an
  authored safe bay route, and has per-step wall-crossing and unexpected-stop
  assertions.
- `<joltPhysics>` now emits `(physicsFaulted)` when a Jolt world step (or a
  subscriber throw during its `tick$`/`postTick$` phases) is caught, and it
  reports the fault through `EngineService.error$`. A `step` fault means the
  WASM heap is in an undefined state, so the component stops stepping that
  world — the render loop survives and degrades to "no physics" instead of
  freezing the page. Because the guard stops re-entering the corrupted heap,
  after a `step` fault the component also stops reading body transforms into
  the render loop. This is defensive only: a trap crushed inside Jolt workers
  can still hard-freeze the page (see the Jolt skill), so the symptom to watch
  is whether a page fault message is followed by a freeze.
- `<joltPhysics>` now accepts `[maxWorkerThreads]` (default `4`): the worker
  thread count passed to Jolt's `JoltSettings` at world creation (`0` =
  single-threaded stepping). Read once at init, so switch/restart the world to
  apply it. Default `4` preserves prior behavior.
- `triangular-engine/navigation` provides framework-free, serializable navigation
  data and query contracts, deterministic bounded-work request scheduling, and
  synthetic benchmark fixtures. It now also exports the explicit Y-up/X-Z
  coordinate contract and validation helpers, plus a deterministic local
  heightfield-grid A\* planner with slope, clearance, and expansion-budget
  limits. Grid change sets now advance immutable snapshots and provide
  per-cell route dependency validation for local invalidation. A deterministic
  benchmark harness covers 1, 100, and 1,000-agent scenarios and reports
  expanded work and timing without asserting universal limits. The entry point
  also includes route simplification, shared-destination goal fields, a
  deterministic region/portal graph planner, and dependency-aware route
  caching for the first RTS-scale routing slice.
  It now also includes the first local-avoidance baseline: a deterministic
  uniform spatial index and bounded separation steering for ground agents and
  circular obstacles. This is an experiment, not a collision guarantee or an
  ORCA implementation.
  It also exports a bounded velocity-obstacle-style candidate sampler and
  configurable yielding/stuck/local-replan/global-replan state classification
  for M4 comparison work.
  Reproducible 1/100/1,000-agent avoidance benchmark fixtures are also
  available for hardware-specific measurements.
- The navigation entry point now exports a framework-free recovery strategy
  contract and deterministic queue/yield baseline for congestion handling.
- The navigation entry point now exports a bounded decentralised encounter
  resolver with deterministic right-of-way, transferable priority, expiring
  retreat signals, and explicit blocked outcomes.
- The navigation entry point now exports a compact deterministic avoidance
  scenario harness for headless baseline/priority-yield comparisons, including
  stationary, oscillation, overlap, and blocked-outcome metrics.
- `getCompoundSubShapeUserData(shape, subShapeId)` (`triangular-engine/jolt`) —
  resolves a compound shape's per-child `AddShapeShape` userData from a
  contact's `SubShapeID`. `Shape.GetSubShapeUserData` always returns 0 in this
  binding, even after casting to `CompoundShape`; this decodes the child
  index from the ID directly instead. See the Jolt skill's "Compound sub-shape
  user data always reads as 0" troubleshooting entry.
- `triangular-engine/animals` now provides lightweight deterministic flock
  steering controls (`travelDirection`, neighbour range, turn rate, and steering
  acceleration) plus `presentInterpolatedFlock()` for smooth renderer-only
  snapshots and a bounded banking hint.
- `triangular-engine/animals` now exports stable planetary group identity
  contracts and `sampleAnimalGroupTimeline()` for bounded direct sampling of
  one authored group cycle at arbitrary universal time without tick replay.
- `triangular-engine/animals` now exports `materializeAnimalGroup()` to derive
  stable nearby flock members from an arbitrary-time aggregate snapshot. Flock
  materialization also respects its configured horizontal travel direction.
- `triangular-engine/animals` now exports `handoffAnimalGroupResidency()` to
  distinguish aggregate-only, nearby materialized, interacting, and explicitly
  tracked groups while preserving deterministic unload/reload behavior.
- `triangular-engine/spline` secondary entry point (Phase 0A — core geometry
  only). Open/closed splines with linear and cubic Bezier evaluation,
  adaptive arc-length sampling, a brute-force `closestPoint` reference
  solver, and schema-versioned JSON serialization. See
  `docs/runbook/008_spline_sublibrary.md` for the phased plan; surface
  binding, masks, rendering, and editing land in later phases.

### Changed (BREAKING CHANGES)

- Jolt component selectors renamed kebab-case → camelCase to match the engine
  convention: `jolt-physics`→`joltPhysics`, `jolt-rigid-body`→`joltRigidBody`,
  `jolt-box-shape`→`joltBoxShape`, `jolt-sphere-shape`→`joltSphereShape`,
  `jolt-hull-shape`→`joltHullShape`, `jolt-mesh-shape`→`joltMeshShape`,
  `jolt-height-field-shape`→`joltHeightFieldShape`, `jolt-soft-body`→`joltSoftBody`,
  `jolt-constraint`→`joltConstraint`, `jolt-fixed-constraint`→`joltFixedConstraint`,
  `jolt-hinge-constraint`→`joltHingeConstraint`, `jolt-debug-renderer`→`joltDebugRenderer`,
  `jolt-vehicle-constraint`→`joltVehicleConstraint`, `jolt-vehicle-wheel`→`joltVehicleWheel`,
  `jolt-tracked-vehicle`→`joltTrackedVehicle`, `jolt-tracked-wheel`→`joltTrackedWheel`,
  `jolt-wheeled-vehicle`→`joltWheeledVehicle`, `jolt-wheeled-wheel`→`joltWheeledWheel`,
  and `jolt-leg`→`joltLeg`.

## [0.1.0-alpha.1] - 2026-07-12

### Added

- Dynamic layout areas/HUD overlay management utilizing TemplatePortals (`@angular/cdk/portal`).
- `EnginePortalService`, `EnginePortalDirective` (`[enginePortal]`), and `EnginePortalOutletComponent` (`engine-portal-outlet`).

### Removed (BREAKING CHANGES)

- Removed `EngineSlotDirective` (`[engineSlot]`). UI placement is now managed via `enginePortal` directives rather than custom static slots.

## [0.0.14] - 2026-05-16

### Added

- `planeGeometry` `[orientation]` input: `vertical` (default), `horizontal`, `billboard` (no geom rotation; pair with `<billboard>`)

### Fixed

- `planeGeometry` `[horizontal]` no longer rotates every plane on every effect run (only when orientation is `horizontal`)

### Deprecated

- `planeGeometry` `[horizontal]` — use `[orientation]="'horizontal'"`

## [0.0.13] - 2026-05-16

### Added

- Optional `triangular-engine/pmndrs` entry point with `billboard` and `sparkles` components wrapping `@pmndrs/vanilla`
- `PmndrsModule` for batch imports

## [0.0.12] - 2025-03-07

### Added

- feat: add triangular-engine skill definition with installation, core patterns, and component reference
- npm package updates & angular minor version updates

```
    "three": "0.183.2",
    "three-mesh-bvh": "^0.9.9",
```

## [0.0.11] - 2025-03-07

Initial changelog. See git history for changes prior to this version.

# Unreleased

- Added framework-free spline editor helpers for axis-constrained point movement and reusable undo/redo keyboard handling.
- Increased navigation retreat defaults to 6 cells initially, up to 9 after
  repeated recovery attempts. Active retreat signals remain repeatable on
  re-evaluation until expiry; the existing 64-hop propagation default is
  unchanged.
