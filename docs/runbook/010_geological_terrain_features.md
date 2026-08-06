# Geological terrain features

Status: proposed, with a demo-local Phase 0 lab.

## Goal

Build reusable, deterministic geological feature generators for game terrain.
The same definitions should be useful for a close, authored god-game volcano,
a streamed planetary surface, and other terrain consumers without embedding
gameplay, particles, audio, or physics in the terrain package.

The initial proving ground is `/geological-features-lab` in the demo app. It
lists implemented and candidate features and exposes live parameters for the
implemented volcano and canyon fixtures.

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

## Initial catalogue

| Feature | Phase | Important parameters |
| --- | --- | --- |
| Volcano | Phase 0 demo | radius, height, crater radius/depth, asymmetry, erosion, seed |
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
- [ ] Visually tune profiles, crater rim, gullies, canyon walls, and meanders.
- [ ] Add export/import of parameter presets for comparing iterations.

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
