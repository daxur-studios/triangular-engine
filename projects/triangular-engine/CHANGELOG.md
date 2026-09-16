# Changelog

## Unreleased

- Added optional `triangular-engine/meshoptimizer` secondary entry point with
  indexed geometry simplification helpers backed by `meshoptimizer`.
- Added topology-aware sphere edge refinement through the optional
  `ITerrainSurfaceDomain.getPatchNeighbor()` hook, plus cached terrain-surface
  selection and edge-mask work for stationary cameras.
- Added bounded sphere quadtree selection through an optional `maxPatches`
  budget, refining the highest-error leaves first for predictable close-view
  work.
- Added optional `TerrainSurfaceComponent.batching`, which renders same-material
  resident surfaces through a shared Three.js `BatchedMesh`.

All notable changes to triangular-engine are documented here.

## [Unreleased]

### Added

- `triangular-engine/terrain` now exports shared stylized material palette and
  procedural variation helpers (`terrainMaterialColorRgb`,
  `sampleTerrainMacroVariation`, and `applyTerrainMacroVariation`) so planar and
  spherical terrain adapters can use the same material rules.

- `triangular-engine/worldgen/render` now exports planar cell-picking helpers
  (`samplePlanarHeight`, `intersectPlanarHeightField`, `mapXZToPlanetDirection`,
  `mapPlanetDirectionToMapXZ`) that resolve a camera ray against a baked 2.5D height field
  back to a canonical graph cell.

- `triangular-engine/worldgen/render` now exports a fixed-resolution spherical geometry
  adapter (`buildPlanetGlobeGeometry`, `writePlanetGlobePositions`,
  `writePlanetGlobeNormals`) that samples the shared planet surface sampler per vertex and
  applies radial displacement. The `/cell-planet-globe` demo validates geography parity,
  height exaggeration and seabed relief; chunked LOD/streaming remains runbook 031.

- `IClipmapTerrainSceneHandle.setVisible()` now allows consumers to temporarily hide
  the clipmap meshes while displaying an alternate inspection surface.

- `buildPlanetSurfaceBake()` now accepts an optional projection direction adapter, allowing
  planar caches to use a map projection footprint while keeping the canonical surface sampler
  projection-independent.

- `createPlanetSurfaceSampler()` now preserves below-sea terrain elevations for bathymetry while
  keeping land river channels clamped to the shoreline datum.

- `triangular-engine/terrain` clipmap scenes now expose `setHeightSource()` so
  bounded texture-backed terrain can be regenerated and swapped without
  rebuilding the clipmap mesh set.

- `triangular-engine/terrain` clipmap LOD renderer now enforces an immutable horizontal
  mesh lattice (`seedWorldXZ`), eliminating triangle folding, wave-bridging slivers, and
  horizontal gaps. Boundary T-junctions are closed via exact linear height interpolation
  along coarse neighbor edges ($0.000000\,\text{m}$ mathematical match), with bilinear
  height morphing in the tile interior. Added `setDebugFlatTerrain()` and `setDebugViewMode()`
  to `IClipmapTerrainSceneHandle`.

- `triangular-engine/worldgen` now derives deterministic mountain ridge networks from
  elevation crest relief, continent-continent collision strength, and connected high cells.
  `IPlanetEcology` exposes `ridgePaths`, normalized `ridgePathStrength`, and isolated `ridgePeaks`;
  ridge paths include shared deterministic Voronoi-style corridor detail between cell-centre
  anchors and avoid river corridors when assembled through ecology. The worldgen map and
  `<planetView>` expose matching `showRidges` overlays.

- `triangular-engine/characters` now exports framework-free semantic facial channel contracts
  and serializable command types (`face-semantic-channels.ts`) and a 5-layer composition
  controller (`FacialAnimationController`). Features include:
  - Canonical semantic channels for brows (`brow.left.raise`, `brow.right.raise`, `brow.lower`),
    eyelids (`eye.blink.left`, `eye.blink.right`, `eye.squint`, `eye.wide`), mouth (`mouth.smile`,
    `mouth.frown`, `mouth.jawOpen`, `mouth.lipClose`, `mouth.round`, `mouth.widen`), and cheeks.
  - Expression presets (`happy`, `sad`, `angry`, `surprised`, `skeptical`, `fearful`, `disgusted`, `neutral`).
  - Physiological eye gaze limit clamping (yaw: ±30°, pitch: ±20°).
  - Layered multi-channel blending: smiling while speaking preserves smile corners; bilabial sounds
    (`M`, `B`, `P`) seal lips via `lipClose`; timed visemes decay smoothly back to rest.
  - Repeatable deterministic articulation fixture testing distinct silhouettes (`M`, `A`, `O`, `U`, `E`, `sil`).
  - Serializable `FaceCommand` interfaces for AI agent and script control.
- `triangular-engine/procedural` now builds an art-directed reference face (`buildReferenceFaceMesh`)
  with seated eyeball spheres that rotate on local pivots (guaranteed never to leave eye sockets),
  independent upper/lower eyelid morphs for left/right blinks, high-contrast expressive eyebrows
  with independent raise/lower, and fully articulated mouth morphs with zero tearing across extreme ranges.
- Upgraded the `/characters-lab` demo with a dedicated **Face Studio (Close-Up)** mode featuring
  three-point portrait lighting, front, 3/4, and profile camera framing presets, interactive gaze reticle,
  individual channel sliders, expression presets, instant viseme testing, and a combined performance example.
- `triangular-engine/characters/three` now exports `bindCharacterFace`, `CharacterFaceBinding`, and `normalizeMorphTargetName`:
  - Automatically inspects any loaded Three.js hierarchy (GLTF, GLB, VRM, procedural) for ARKit 52 morph targets.
  - Normalizes diverse naming schemes (canonical camelCase, `_L`/`_R` suffixes, namespace prefixes, and Oculus conventions) to the canonical ARKit standard.
  - Detects eye pivot groups (`grp_eyeLeft`, `eyeLeft`, etc.) to drive gaze orientation, and projects gaze angles to standard ARKit eye morphs (`eyeLookInLeft`, `eyeLookOutRight`, etc.).
  - Bundled Three.js reference model baseline (`facecap.glb`) with KTX2/Meshopt decoding in `/characters-lab`, establishing an authored ground truth alongside procedural generation.

- `triangular-engine/characters` now exports analytic two-bone reach IK
  (`solveTwoBoneIk`) over any parent→mid→end bone chain, with elbow pole
  control, out-of-range/folded clamping, and `reached`/`elbow`/`end` results.
  `character-vector` and `character-quaternion` gained the dot/cross/arithmetic
  and shortest-arc/Euler helpers that IK depends on, and
  `solveForwardKinematics` now also returns per-bone world orientations by name.

- `triangular-engine/characters` now ships facial emotion and speech primitives:
  the ARKit 52 blendshape vocabulary (with an Oculus/VRM name translation),
  a small emotion vocabulary with `sampleEmotion`/`blendBlendShapeWeights`, and
  `preProcessText`/`wordsToVisemes`/`sampleVisemeTrack`/`visemeToBlendShapes` for
  deterministic text → timed-viseme → blendshape lipsync that works with any TTS.
  `triangular-engine/characters/three` gained `applyPoseToSkeleton` to retarget a
  `RigPose` onto any `THREE.Skeleton` sharing the canonical VRM/Mixamo bone names.

- `triangular-engine/procedural` now builds a skinned humanoid body
  (`buildCharacterBodyMesh`) with configurable finger-count LODs and an
  ARKit-compatible face, plus `arkitToCharacterFace`/`applyCharacterFacePose` to
  drive its seven face morph targets from emotion/viseme blendshape weights. The
  `/characters-lab` demo now renders that body and exposes emotion and
  browser-TTS speech controls.

- `triangular-engine/characters/three` gained `retargetMixamoClip` (with the
  `MIXAMO_BONE_MAP` name table) to retarget a Mixamo-authored `AnimationClip`
  onto the canonical skeleton via three.js `SkeletonUtils.retargetClip`,
  reconciling Mixamo's T-pose with the rig's A-pose and folding the extra
  `Spine1`/`Spine2` segments into `chest`. It resolves both `mixamorig*` and
  bare Mixamo bone names and swaps every left/right pair to undo Mixamo's X
  mirror (its `Left*` bones sit on +X while the canonical rig's `left*` sit on
  −X), so retargeted clips no longer look cross-limbed.
  `HumanoidRigVisualization` also gained `setOverlayVisible` to hide the
  skeleton helper lines and joint spheres. The `/characters-lab` demo lets you
  pick a `.fbx` from disk and drive the procedural body with it.

- Redesigned the procedural planetary surface architecture for `triangular-engine/celestial`
  optimized for gameplay, base-building, and exploration:
  - Added `terrace-fractal-3d` (`ITerraceFractalTerrainGeneratorDef`) for stepped flat-topped tablelands and mesas.
  - Added `canyon-3d` (`ICanyonTerrainGeneratorDef`) for carved tectonic rifts and gorges with sheer drop walls and flat floors.
  - Added `dunes-3d` (`IDuneTerrainGeneratorDef`) for wind-swept ripple sand dune fields with asymmetric slip faces.
  - Added optional 3D domain warping (`IDomainWarpDef`) across fractal, ridged, and continental generators for organic coastlines, bays, straits, and archipelagos.
  - Rebuilt `HOME_PLANET` with a 6-tier biome hierarchy (`lowland-meadows`, `rolling-hills`, `alpine-ridges`, `tableland-plateaus`, `desert-dunes`, `rift-canyons`), removing chaotic global macro noise to guarantee flat buildable meadow expanses (<1-2° slope) for bases and runways while preserving 70% Earth-like ocean coverage.
  - Updated deterministic coastal launch pad and runway placement (`HOME_BASE_COASTAL_ACCESS`, `HOME_PAD`, `HOME_RUNWAY`) on a flat coastal meadow site.

- `<scene>` now accepts a `[wireframe]` boolean input. When enabled, every mesh
  and line in the scene renders with a wireframe material for debugging; original
  materials are restored when set back to `false`, and objects added while
  enabled are picked up automatically. Points and sprites are skipped because
  they require their own material types.
- `<scene>` also accepts `[wireframeMode]` (`'uniform' | 'name-hash'`, default
  `'uniform'`) to choose the wireframe coloring: a single shared green material,
  or a deterministic color hashed per object from its `name` (or `uuid`) with one
  cached wireframe material per color.
- Added `triangular-engine/celestial` secondary entry point: Dependency-free astrodynamics,
  64-bit Keplerian orbit propagation, ephemerides, gravity and atmospheric drag models,
  stock celestial bodies (`HOME_PLANET`, `EARTH`, `MARS`, `MOON`, `SUN`), and procedural
  surface definitions.
- Added CDLOD (Continuous Distance-Dependent Level of Detail) planetary terrain rendering
  to `triangular-engine/terrain`:
  - `CdlodPlanetComponent` (`<cdlodPlanet>`): Declarative Angular planetary renderer with GPU
    vertex geomorphing, feature-adaptive relief decimation, and multi-threaded Web Workers.
  - `selectCdlodPatches`: Quadtree selection algorithm with screen-space error thresholding,
    horizon culling, view frustum culling, and 2:1 quadtree level balancing.
  - `generateCdlodPatchRawBuffers` / `generateCdlodOceanPatchRawBuffers`: High-speed typed array
    buffer generation with transferable 0-copy ArrayBuffers.
  - `CdlodWorkerPool` and `handleCdlodWorkerMessage`: Background Web Worker thread pooling for terrain
    and ocean mesh synthesis.
  - Motion look-ahead (`CdlodMotionLookAhead`, `resolveMotionLookAhead`) with linear hypersonic
    and curved Keplerian orbital velocity prediction.
  - Custom terrain and ocean shader materials (`createCdlodTerrainMaterial`, `createOceanMaterial`)
    with slope-based cliff strata and logarithmic depth buffer support.
  - Added interactive `/cdlod-planet-lab` demo in `demo-app`.
- Added deterministic consumer-provided perch selection and a tested planetary
  animal-group interaction path from reconstruction through aircraft fleeing to
  bounded landing.
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

# Unreleased

- Water rendering now retains near-camera CDLOD while selecting a second pooled
  tile grid from the camera frustum/look direction, with a seamless spherical
  far-water handoff and mutable-centre support for floating-origin scenes.
- `<waterSurface>` can use an authoritative `timeSeconds` clock and opt out of
  `WaterService` registration when simulation already owns the water body.
