# 003 — O'Neill Cylinder Clouds POC

## Session handoff

Use this document as the starting context for new sessions about the O'Neill
cylinder POC. Work only in:

```text
D:\code\triangular-workspace
```

Do **not** modify the older experimental copy in:

```text
D:\external\three-geospatial
```

The user runs the demo locally and performs visual verification. Do not use a
browser unless explicitly requested. Keep build verification minimal and
proportional to the change.

## Status

- State: active visual POC
- Last updated: 2026-07-22
- Demo: `/takram-cylinder-clouds`
- Engine entry point: `triangular-engine/takram`
- Renderer: WebGL with logarithmic depth enabled
- Cylinder orientation: local X is the cylinder axis; YZ is the radial plane
- Current radius: 10 km
- Current length: five cylinder radii

This work builds on the generic Takram adapter documented in
`001_add_takram_three_clouds.md`. This document covers only the cylindrical
adaptation and its current visual prototype.

## Current objective

Determine whether Takram's volumetric clouds and atmosphere can produce a
convincing habitable O'Neill-cylinder interior with:

- volumetric clouds wrapping around the inner surface;
- a readable blue atmosphere and distance fade toward the ends;
- a controllable artificial sun and day/night lighting;
- land and water areas on the inner cylinder;
- inexpensive distant cloud coverage that does not look static;
- stable rendering while moving from the surface toward the cylinder centre.

This is a feasibility and visual-tuning POC, not yet a production terrain or
physically rigorous habitat simulation.

## Important files

```text
projects/demo-app/src/app/pages/takram-cylinder-clouds/
  takram-cylinder-clouds-page.component.ts
  takram-cylinder-clouds-page.component.html
  takram-cylinder-clouds-page.component.scss

projects/triangular-engine/takram/clouds/
  takram-clouds.component.ts
  takram-cylinder-clouds-compat.ts
  takram-cylinder-cloud-shell.component.ts

projects/triangular-engine/takram/atmosphere/
  takram-cylinder-atmosphere.component.ts

projects/triangular-engine/takram/public-api.ts
```

`takram-cylinder-clouds-compat.ts` is the main cylindrical shader adaptation.
It patches Takram's existing cloud shader rather than maintaining a completely
independent volumetric cloud renderer. The dedicated cylinder atmosphere and
distant 2D cloud shell are custom Triangular components.

## What currently works

### Cylindrical volumetric clouds

- Cloud ray marching intersects concentric cylinders around the local X axis.
- Cylindrical UVs use circumference-aware axial scaling so procedural features
  are not stretched.
- Wrapped derivatives avoid the severe mip discontinuity at the UV seam.
- Density fades near the open axial ends rather than stopping abruptly.
- Cloud altitude and height are measured inward from the cylinder surface.
- Sampling uses smaller bounded steps so a thin cloud shell is not skipped when
  the camera approaches the cylinder centre.
- The regular Takram controls remain exposed, including temporal upscale,
  resolution scale, quality preset, coverage, density, haze, and wind.

The demo currently uses the `high` Takram quality preset, a configurable
resolution scale, and temporal upscaling enabled by default.

### Artificial sun and lighting

- A glowing globe and point light can be moved around the cylinder by angular
  position and along the cylinder axis.
- The same direction is supplied to the cloud and cylinder-atmosphere shaders.
- Sun intensity affects both ordinary mesh lighting and cloud lighting through
  `sunLightScale`.
- The cylinder atmosphere includes directional in-scattering from the sun.
- The background is lifted black rather than absolute black so night remains
  readable.

This is a practical visual model. It does not yet simulate a realistic external
solar-light path through end caps, mirrors, or windows.

### Cylinder atmosphere

- A custom cylindrical atmosphere component renders bounded interior
  scattering instead of applying Takram's Earth/spherical atmosphere directly.
- It supports density, scale height, intensity, sun direction, and cylinder
  dimensions.
- The cloud shader has cylindrical internal haze with selectable models.
- Atmosphere visibility is decoupled from cloud coverage, so reducing clouds
  should not remove the sky effect.
- The intended appearance is blue near the inhabited surface, accumulating
  with view distance and fading toward the open cylinder ends.

This remains visually provisional. Its stability and appearance must be judged
in the locally served demo, especially for the large-radius case and near the
cylinder centre.

### Terrain and water

- The inner cylinder has a procedural test texture with separate land and water
  regions.
- The surface can be switched between solid and wireframe for diagnosis.
- This is a scale/composition test material, not production terrain mapping.

### Distant 2D clouds

- A dedicated inexpensive cylindrical shader shell fills the far view where
  the volumetric layer becomes difficult to read.
- It uses the weather texture at multiple scales and moves phase offsets over
  time; it does not regenerate or animate a random seed.
- Smooth coverage oscillation adds subtle evolution without texture uploads or
  CPU-side generation.
- Fade start, fade end, opacity, evolution amount, and evolution speed are
  controllable.
- Two shells currently reuse the same weather texture:
  - a lower, smaller-scale, faster and more opaque layer;
  - a higher, broader, slower and softer layer.

The two shells are cheap compared with adding a second full volumetric Takram
effect, although they still add two transparent full-view draws.

### Camera and scale

- The demo camera far plane is set to `1_000_000_000` to avoid ordinary far
  clipping in this POC.
- Logarithmic depth is enabled for the large scale range.
- The initial camera stands approximately two metres above the inner surface.
- A one-metre reference cube is present near the initial camera position.

## Current defaults

These are intentionally softer than the earlier overcast/hazy defaults:

| Setting | Default |
|---|---:|
| Volumetric cloud altitude | 450 m |
| Volumetric cloud height | 1,400 m |
| Coverage | 0.28 |
| Density scale | 0.5 |
| Resolution scale | 0.5 |
| Temporal upscale | enabled |
| Distant-shell opacity | 0.24 |
| Distant-shell evolution | 0.025 |
| Distant-shell evolution speed | 4× |
| Distant-shell fade | 3,000–7,000 m |
| Internal haze density | 0.000005 |
| Haze/atmosphere scale height | 500 m |
| Sky-light scale | 0.2 |
| Cylinder-atmosphere density | 0.000008 |
| Cylinder-atmosphere intensity | 0.12 |
| Artificial sun intensity | 2.5 |

Treat these as tuning baselines, not physically meaningful calibrated values.

## Known limitations and open work

### Highest priority

- Visually verify the large cylinder while moving from its surface toward the
  centre. Previous versions caused the volumetric or distant 2D cloud layer to
  disappear suddenly there.
- Tune the blue-sky/scattering response so it is unmistakably visible without
  becoming an opaque blue fog.
- Tune the two distant shells. Their motion must be visible enough to avoid a
  static texture but slow and coherent enough to avoid obvious texture sliding
  or boiling.
- Check transitions between volumetric clouds and distant shells at several
  radii and camera heights.

### Atmosphere and lighting

- Improve the bounded-cylinder scattering approximation and end fade.
- Decide whether the POC needs stronger aerial perspective on terrain and water,
  not only a sky-volume effect.
- Replace the simple day/night response with a deliberate cycle that retains
  low ambient illumination on the far side rather than going fully black.
- Decide on the habitat's actual light architecture: an internal artificial
  light, external sunlight through end caps, longitudinal windows and mirrors,
  or a closed cylinder. The current glowing globe is a visual stand-in.
- Cloud shadows and visible light shafts are not yet a completed cylindrical
  feature. Takram's Beer shadow-map path would require cylinder-aware shadow
  intersection and careful performance work.

### Terrain

- Replace the procedural diagnostic material with production-quality land and
  water distribution, appropriate scale, and material response.
- Add regional variation and a strategy for avoiding obvious cylindrical UV
  repetition/seams.
- Decide whether water remains texture-only or becomes a separate reflective
  water material/geometry system.

### Cloud fidelity and performance

- Decide whether the upper layer should remain a cheap 2D shell or become an
  additional Takram volumetric cloud layer. Multiple native cloud layers can be
  packed into one Takram effect, but a convincing cylinder mapping and acceptable
  cost still need testing.
- Tune presets for small, medium, and large radii rather than applying one set of
  metre-based fades and step sizes everywhere.
- Profile GPU cost only after the visual direction is accepted.
- Add screenshot/regression coverage later if the POC becomes a maintained
  engine feature.

## Technical notes for future sessions

- Keep cylinder-space assumptions consistent: X is axial; radius is measured in
  YZ; the inhabited surface is the inner radial boundary.
- Do not reintroduce Takram's spherical/Earth altitude assumptions into the
  cylinder path.
- The cylindrical shader adaptation is intentionally localized in the compat
  file so upstream Takram behavior remains available for planets.
- Do not animate the 2D weather texture by swapping random seeds every frame.
  That causes discontinuous popping/boiling. Coherent UV/phase evolution is the
  current cheap approach.
- Keep haze/scattering independent of cloud coverage.
- An enormous finite camera far plane is used because Three.js perspective
  cameras do not use a literal infinite far plane in this setup.
- Preserve unrelated dirty or staged work in the workspace. In particular,
  never reset, restore, stash, clean, or broadly stage the repository.

## Suggested next session prompt

```text
Continue the O'Neill-cylinder POC in D:\code\triangular-workspace using
docs/runbook/003_oneill_cylinder_poc.md as the handoff. Do not touch
D:\external\three-geospatial. I run the demo locally, so do not browser-test
unless I ask. Keep build verification minimal. First inspect the current code
and my latest visual feedback, then make only the requested POC changes.
```

## Relationship to other runbooks

- `001_add_takram_three_clouds.md`: generic Angular/Takram integration,
  atmosphere adapter, packaging, and earlier mini-planet work.
- `002_water_sublibrary.md`: separate water-library work; it is not the O'Neill
  cylinder handoff.
- This file (`003_oneill_cylinder_poc.md`): authoritative session handoff for
  the current cylinder POC.
