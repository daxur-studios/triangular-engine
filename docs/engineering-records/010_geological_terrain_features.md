# Geological terrain features

Status: Phase 0 in progress, with a demo-local interactive lab.

## Goal

Build reusable, deterministic geological feature generators for game terrain.
The same definitions should be useful for a close, authored god-game volcano,
a streamed planetary surface, and other terrain consumers without embedding
gameplay, particles, audio, or physics in the terrain package.

The initial proving ground is `/geological-features-lab` in the demo app. It
lists implemented and candidate features and exposes live parameters for the
implemented volcano and canyon fixtures.

## Current position

The project currently has a working Phase 0 lab, not a reusable public geology
API yet. Volcano and canyon are deterministic demo-local height functions
rendered on high-resolution geometry. Volcanoes now combine seeded fine noise
with restrained curved ridges whose count, twist, strength, and handedness vary
by seed. The former `atan2` seam has a regression test and is no longer part of
the asymmetry function.

## Desired destination

Extract a small framework-free geology layer inside `triangular-engine/terrain`
once the shapes and composition rules are proven. The extracted layer should
feed the existing terrain sampling, patch meshing, LOD, material-mask, and
collision adapters. Bruno's Space Program can then use the same definitions on
streamed spherical planetary terrain, while a closer game adds its own lava,
eruption, destruction, VFX, audio, and gameplay systems.

## Outstanding work

The next work is still Phase 0 quality and contract discovery:

- Visually review volcano and canyon across the full slider ranges and camera
  angles; tune crater rims, erosion, canyon walls, meanders, and material
  readability.
- Add export/import of parameter presets so good landforms can be retained and
  compared.
- Define the smallest stable feature sample, bounds, composition, and metadata
  contracts before extracting code into the library.
- Add multi-feature composition and patch/LOD tests only after those contracts
  exist.

Phase 1 extraction, sphere/cylinder integration, BSP integration, active lava,
runtime terrain mutation, and the planned catalogue features remain
outstanding.

## Design decisions

### 1. A feature modifies a terrain field

A geological feature is not primarily a standalone mesh. It is a deterministic
contribution sampled in terrain/world coordinates and composed with a base
`ITerrainField`. Meshing, patch LOD, collision generation, and rendering remain
owned by the existing terrain pipeline.

```ts
interface GeologicalFeature<TParameters> {
  readonly id: string;
  readonly kind: GeologicalFeatureKind;
  readonly parameters: Readonly<TParameters>;
  sample(position: TerrainVector3): GeologicalFeatureSample;
}

interface GeologicalFeatureSample {
  readonly elevationDeltaM: number;
  readonly materialWeights?: Readonly<Record<string, number>>;
  readonly tags?: readonly string[];
}
```

The eventual composition policy must be explicit. Additive displacement is a
useful default, but channels, plateaus, and absolute authored cuts may require
`add`, `min`, `max`, or `replace` operations with falloff masks.

### 2. Shape, surface character, and activity are separate

- **Shape** owns elevation: cone, caldera, canyon channel, mesa cap, fault step.
- **Surface character** owns erosion detail and material masks: gullies, talus,
  ash, lava rock, exposed strata, snow, and vegetation eligibility.
- **Activity** is consumer-owned runtime behaviour: lava, smoke, eruptions,
  damage, village reactions, resources, sound, and quests.

This boundary lets Bruno's Space Program reuse planetary landforms while a
Black & White-style game adds active close-range behaviour to the same terrain
definition.

### 3. Definitions are seeded, serializable, and unit-explicit

Public parameters use metres and stable seeds. A definition contains no
Three.js, Angular, physics-engine, or application state. Given the same
definition and coordinates, sampling must return the same result.

### 4. Features work across terrain domains

Feature math should operate in a local tangent frame supplied by the terrain
domain. Plane, sphere, and cylinder surfaces can then share the feature shape.
Planetary consumers place a local feature frame on the globe; they do not run
volcano math directly in a cube-face UV coordinate system.

### 5. Feature metadata survives meshing

Elevation alone is insufficient for convincing terrain. Sampling should be
able to expose normalized masks such as crater interior, fresh lava, channel
floor, cliff, talus, ash, and deposition. Renderers and games may consume these
masks without the core prescribing a material system.

### 6. Canyon coherence is path-based, not tile-based

A canyon must not be generated independently inside each visible patch. Its
stable definition owns a world-scale centreline or branching network, while
terrain patches only sample that definition. This keeps bends, tributaries,
width, strata, and erosion coherent as the camera moves and as LOD changes.

```ts
interface CanyonNetworkDefinition {
  readonly id: string;
  readonly seed: number;
  readonly paths: readonly GeologicalPathDefinition[];
  readonly profile: CanyonProfileDefinition;
  readonly detail: CanyonDetailDefinition;
}

interface GeologicalPathDefinition {
  readonly points: readonly GeologicalAnchor[];
  readonly closed?: boolean;
  readonly parentPathId?: string;
}
```

The path representation is domain-aware at placement time:

- Plane anchors use stable world coordinates in metres.
- Sphere anchors use unit directions or latitude/longitude and interpolate on
  the sphere, never through cube-face UV or wrapped longitude subtraction.
- Cylinder anchors use axial position plus a periodic angle.

Sampling finds the nearest path segment in the domain's surface metric and
constructs a local frame from along-path, across-path, and surface-normal
directions. The shared canyon profile is evaluated from signed distance across
the path and progress along it. A longitude seam or cube-face edge therefore
has no geological meaning and cannot terminate or offset the canyon.

### 7. Scale is expressed in physical bands

Map extent and feature scale are independent. Width, depth, bend wavelength,
tributary spacing, and detail wavelengths are stored in metres. Enlarging a
map reveals more terrain; it does not stretch an existing canyon or its noise.

Use nested deterministic bands so a feature remains readable at every view:

- **Network scale:** trunk route, drainage direction, major bends, tributaries.
- **Landform scale:** width, depth, terraces, escarpments, floodplain.
- **Surface scale:** cliff breakup, strata, talus, gullies, channel roughness.
- **Render scale:** material and normal detail that does not alter topology.

Each band has an amplitude and wavelength in metres plus an LOD relevance
range. Coarse patches sample the same network and low-frequency shape as fine
patches. Fine patches add higher-frequency bands; they must not replace or
re-route the trunk.

### 8. Regional systems compose related features

A Grand Canyon-style area should be represented as one serialized regional
system: a primary trunk, major tributaries, shared erosion/profile style, and
optional local overrides. It is not one enormous noise function and not a set
of unrelated tile cuts. Independent ravines remain separate feature instances
when they do not need shared drainage or styling.

This gives two useful authoring levels:

- `CanyonFeature`: one path and cross-section, suitable for a focused fixture
  or a small authored ravine.
- `CanyonNetworkFeature`: a trunk and branches sharing a regional style,
  suitable for large coherent canyon country.

Network generation can come later. The first implementation should accept
explicit paths so topology, seams, and scale can be tested without committing
to a procedural drainage algorithm.

## Canyon and scale implementation plan

## Large-scale composition plan

The first composition implementation remains demo-local and intentionally
small. It proves how multiple authored geological instances can form a region
before a public library API or streamed cube-sphere integration is introduced.

### Composition contract

- A composition is a deterministic ordered set of feature instances.
- Each instance owns a feature kind, metre-based local offset, strength, and
  composition operation.
- Initial operations are `max` for raised landforms, `carve` for negative
  channels, and `add` for additive contributions.
- Feature sampling remains local and reusable; composition owns placement and
  blending.
- Initial presets are a volcanic field and a canyon network, both with fixed
  metre-based instances and seed offsets.

### Composition milestones

- [x] Add demo-local feature instances and explicit composition operations.
- [x] Add deterministic volcanic-field and canyon-network presets.
- [x] Add basic demo preset controls.
- [x] Add numeric determinism and regional-carving tests.
- [ ] Add visible instance bounds and centreline diagnostics.
- [ ] Add configurable instance count, spacing, and regional seed.
- [ ] Move the stable contract into framework-free triangular-engine terrain
  code after visual review.
- [ ] Reuse the composition contract for mesas, craters, ridges, and rifts.

Exit gate: a large plane can show one coherent regional preset, repeated
renders agree numerically, and changing the map extent does not stretch the
individual features.

### Stage A — Prove a path-driven canyon on a plane

- [ ] Replace the demo's implicit side-to-side canyon formula with an explicit
  polyline/spline centreline and nearest-path sampling.
- [ ] Separate path controls from cross-section controls: route, width, depth,
  wall steepness, terraces, channel floor, and edge falloff.
- [ ] Add a map-size control while keeping all feature values in metres.
- [ ] Demonstrate the same serialized canyon on small and large planes without
  changing its local width, detail frequency, or route.
- [ ] Add a camera-scale/detail-band diagnostic to show which frequencies are
  contributing.

Exit gate: resizing the plane or changing patch layout cannot alter the canyon
route, and adjacent samples agree numerically.

### Stage B — Add surface-path adapters

- [ ] Define a small domain-independent path query contract returning nearest
  point, distance across, progress along, tangent, and local surface frame.
- [ ] Implement plane queries first, spherical geodesic segment queries second,
  and periodic cylinder queries third.
- [ ] Place a spherical test canyon across a cube-face boundary and the
  longitude/angle wrap used by the demo camera controls.
- [ ] Ensure antipodal/near-antipodal anchors and pole-adjacent paths either
  behave deterministically or are rejected with documented validation.

Exit gate: equivalent samples on both sides of every representation seam match
within a documented epsilon in elevation and masks.

### Stage C — Stream through the existing terrain pipeline

- [ ] Adapt the geological field to `ITerrainField` and render it through
  `TerrainSurfaceComponent`, rather than rebuilding one monolithic geometry.
- [ ] Build a spatial index over conservative path-segment bounds so each patch
  evaluates only nearby feature segments.
- [ ] Keep feature definitions and spatial-index keys stable across worker and
  main-thread generation.
- [ ] Test same-LOD patch edges, mixed-LOD joins, cube-face edges, floating
  origins, and billion-metre world coordinates.
- [ ] Specify whether high-frequency displacement is sampled geometrically,
  represented only in materials/normals, or faded by screen-space error.

Exit gate: moving from an orbital view to canyon-floor range preserves one
route and silhouette without cracks, popping, or detail swimming.

### Stage D — Add coherent regional canyon networks

- [ ] Add a serializable trunk-plus-branches definition with parent junctions.
- [ ] Blend tributary profiles into the parent without double-depth cuts or
  visible union seams.
- [ ] Add shared regional presets for strata, terrace spacing, erosion age, and
  material masks, with per-path overrides.
- [ ] Start with authored or seeded control points; evaluate procedural drainage
  generation as a separate later feature.
- [ ] Add a large-plane and large-sphere fixture showing one regional canyon
  system plus unrelated smaller ravines.

Exit gate: the network reads as one geological region, while independently
placed canyons still compose predictably.

### Planned demo controls

- Surface: plane, sphere, cylinder; surface/map size; patch and LOD diagnostics.
- Placement: path anchors, seed, path length, major bend wavelength/strength.
- Profile: width, depth, wall steepness, floor width, terraces, edge falloff.
- Network: trunk/branch mode, branch count, junction spacing, regional preset.
- Detail: erosion scale, strata scale, talus, gullies, and geometric detail cap.
- Diagnostics: centreline, segment bounds, local frames, patch borders,
  active detail bands, and seam stress-test placement.

### Acceptance tests

- Determinism: identical definition and surface position yield identical
  elevation, masks, and path query results.
- Seamlessness: sphere face edges and periodic cylinder edges agree within
  epsilon; no longitude-based discontinuity is permitted.
- Scale invariance: changing map/planet extent alone does not alter a feature's
  metre-based width, depth, wavelengths, or sampled local profile.
- LOD stability: coarse and fine patches agree on low-frequency shape and
  shared vertices; added detail cannot move the centreline.
- Network cohesion: branches meet their parent continuously and inherit the
  regional style unless explicitly overridden.
- Streaming cost: work is proportional to nearby indexed segments rather than
  every canyon in the world.

## Initial catalogue

| Feature | Phase | Important parameters |
| --- | --- | --- |
| Volcano | Phase 0 demo | radius, height, crater radius/depth, asymmetry, erosion, ridge count, spiralness, seed |
| Canyon | Phase 0 demo | width, depth, wall steepness, meander, erosion, seed |
| Crater / impact basin | Candidate | rim radius/height, bowl depth, ejecta, age |
| Mountain ridge | Candidate | spline, width, height, sharpness, erosion |
| Mesa / butte | Candidate | footprint, cap height, wall falloff, talus |
| Fault scarp / rift | Candidate | spline, throw, width, side, roughness |
| Valley / ravine | Candidate | spline, profile, depth, tributaries |
| Dune field | Candidate | direction, wavelength, amplitude, seed |
| Karst / sinkholes | Candidate | density, scale range, drainage, seed |

Rivers remain a sibling system because they combine terrain carving with flow,
water rendering, and downstream topology. Their carving contracts should still
be compatible with geological-feature composition.

## Proposed package layout

Keep Phase 0 in the demo. Extract only after the controls and visual result
show which contracts are stable.

```text
projects/triangular-engine/terrain/
  geology/
    geological-feature.ts
    geological-feature-field.ts
    geological-feature-frame.ts
    volcano-feature.ts
    canyon-feature.ts
    feature-noise.ts
```

If geology grows large enough to create a meaningful bundle boundary, it may
later become `triangular-engine/terrain/geology`. Until then it belongs inside
the existing terrain entry point rather than a new top-level package.

## Phases

### Phase 0 — Interactive shape lab

- [x] Add a geological-features demo route and catalogue.
- [x] Add deterministic demo-local volcano and canyon height functions.
- [x] Add live parameter sliders and reset controls.
- [x] Render slope/elevation-based diagnostic colours.
- [x] Add seed-driven ridge count, twist, strength, and handedness variation.
- [x] Make ridge count an explicit serialized/demo parameter.
- [ ] Visually tune profiles, crater rim, gullies, canyon walls, and meanders.
- [ ] Add export/import of parameter presets for comparing iterations.
- [x] Replace the canyon's implicit side-to-side cut with a deterministic
  path-driven nearest-segment sampler.
- [x] Add metre-based canyon path length and bend-wavelength controls.
- [x] Add a plane-size control demonstrating that map extent and feature scale
  are independent.

Exit gate: both fixtures read clearly as their intended landform from several
camera angles, remain deterministic, and expose a small shared sampling model.

### Phase 1 — Framework-free terrain feature core

- [ ] Define feature definition, sample, frame, bounds, and composition types.
- [ ] Extract seeded noise helpers and volcano/canyon generators.
- [ ] Compose multiple overlapping features with documented precedence.
- [ ] Return material/tag masks alongside elevation contributions.
- [ ] Add numeric tests at centres, rims, falloffs, and bounds.

Exit gate: the core imports no Angular or Three.js and can be sampled through
an `ITerrainField` adapter.

### Phase 2 — Existing terrain pipeline integration

- [ ] Use features through `TerrainSurfaceComponent` on plane terrain.
- [x] Add focused demo views for plane, large sphere, and cylinder domains.
- [x] Add a large-sphere fixture with multiple deterministic volcanoes.
- [ ] Verify patch boundaries and mixed LOD seams across feature edges.
- [ ] Add local tangent frames for sphere and cylinder domains.
- [ ] Verify large-coordinate and floating-origin behaviour.
- [ ] Derive conservative feature bounds for patch invalidation and streaming.

### Phase 3 — Visual geology

- [ ] Slope-, elevation-, curvature-, and feature-mask material blending.
- [ ] Volcano radial erosion, secondary vents, lava channels, and talus.
- [ ] Canyon strata, cliff breakup, debris fans, and tributary hooks.
- [ ] Scatter eligibility masks for rock, vegetation, snow, and ash.

### Phase 4 — Consumer adapters

- [ ] BSP fixture placing deterministic features on spherical planets.
- [ ] Close-range active-volcano example with consumer-owned lava and effects.
- [ ] Optional collider refresh policy for terrain changed at runtime.
- [ ] Authoring helpers for selecting, moving, and saving feature definitions.

## Non-goals

- Physically complete tectonic, erosion, or lava-fluid simulation.
- Gameplay concepts such as damage, worship, resources, settlements, or AI.
- One permanent mesh per landform.
- A universal material/shader package.
- Runtime terrain mutation in the first extraction.
- Claiming planetary visual plausibility from one cone function.

## Risks

- **Cone-shaped volcanoes look synthetic.** Asymmetry, radial erosion,
  secondary vents, profile families, and material masks are quality work, not
  optional polish.
- **Heightfields cannot represent overhangs.** Caves and true undercuts need
  supplemental meshes, voxels, or signed-distance geometry.
- **Feature composition becomes order-dependent.** Operations and priorities
  must be serialized and tested.
- **Planet projection distortion.** Evaluate in a local tangent frame and test
  features crossing streamed patch boundaries.
- **Demo code becomes accidental API.** Keep Phase 0 helpers local and label
  catalogue status honestly until extraction gates pass.

## Verification

```powershell
npx ng test demo-app --watch=false --browsers=ChromeHeadless --include='**/geological-features/**/*.spec.ts'
npm run build:triangular-engine
npx ng build demo-app --configuration development
```

Also inspect volcano and canyon at minimum, midpoint, and maximum parameter
values, resize the control panel, and confirm switching/resetting features does
not leak geometry or materials.

## Decision log

### 2026-08-06 — Initial proposal and Phase 0 lab

- Kept geology within the terrain workstream because geological shapes are
  field contributions consumed by the existing domain, meshing, and LOD code.
- Chose demo-local volcano and canyon implementations before committing a
  public API.
- Separated static landform generation from active-volcano gameplay and VFX.
- Included a broader catalogue so future work is organized around reusable
  feature composition rather than one-off volcano code.

### 2026-08-06 — Volcano artefact fix

- Replaced polar sinusoidal erosion and non-integer angular asymmetry with
  domain-warped Cartesian noise. The previous `atan2` branch caused a seam and
  the radial sinusoid read as highly visible spiral ridges from above.
- Added a regression test sampling both sides of the former polar branch.
- Kept a restrained polar ridge component, but made ridge count, twist, and
  strength seed-driven so randomized volcanoes do not share one silhouette.
- Made ridge handedness seed-driven as well, allowing clockwise- and
  anticlockwise-looking volcanic flow patterns.

### 2026-08-06 — Canyon Stage A path sampler

- Replaced the demo canyon's implicit full-width mathematical cut with a
  deterministic centreline sampled as world-space segments.
- Kept the cross-section separate from the route so width, depth, wall profile,
  and erosion can later be reused by plane, sphere, and cylinder adapters.
- Added path length, bend wavelength, and plane-size controls to test coherence
  at different extents while retaining metre-based feature dimensions.
- Added a regression test confirming the channel remains deep at both ends of
  the sampled path.
- Kept the implementation demo-local; spherical geodesic path queries and
  `TerrainSurfaceComponent` streaming remain the next extraction stages.

### 2026-08-06 — Sphere and cylinder canyon displacement fix

- Fixed sphere canyon sampling so negative channel elevations are preserved
  instead of being discarded by volcano-oriented max blending.
- Wrapped spherical longitude deltas to the shortest arc, preventing a canyon
  from disappearing or jumping at the longitude seam.
- Corrected cylinder radial displacement so canyon floors move toward the
  cylinder axis, matching the intended inner-surface presentation.

### 2026-08-06 — Ordered terrain composition

- Regional presets and the interactive test features now use one layered
  sampler rather than replacing one another.
- Feature selection order is treated as terrain history: a canyon selected
  after a volcano carves the existing surface, while a later volcano covers an
  earlier canyon wherever its own terrain is higher.
- This is a heightfield composition rule, not a full geological simulation;
  future extracted feature definitions must retain explicit operation and
  ordering metadata.

### 2026-08-06 — Five additional interactive feature samplers

- Added deterministic demo samplers for impact craters, mountain ridges,
  mesas/buttes, fault scarps, and dune fields.
- Added starter parameter groups and controls for each feature so their scale,
  profile, and seeded variation can be compared in the existing plane, sphere,
  and cylinder workbench.
- Kept the five samplers demo-local until their shared bounds, masks, streaming,
  and composition contracts are extracted into `triangular-engine/terrain`.
- Added focused regression coverage for the basic positive/negative signatures
  and deterministic behavior of the new samplers.
