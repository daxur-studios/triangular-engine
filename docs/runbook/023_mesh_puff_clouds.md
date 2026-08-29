# 023 — Mesh Puff Clouds

## Status

- State: In progress (first spike)
- Target entry point: `triangular-engine/clouds`
- Initial renderer: WebGL
- Last updated: 2026-08-29

## Objective

Prototype a mesh-based, low-poly "puff" cloud renderer as an alternative/complement to the
existing raymarched volumetric clouds in `triangular-engine/takram` (which wraps
`@takram/three-clouds`' `CloudsEffect`).

Target properties, roughly in priority order:

- **Crisp**, not flickery — the silhouette should read as a clean shape at any distance, not
  noisy raymarch detail the eye can't resolve.
- **Performant near and inside the cloud** — cost should not blow up as the camera flies deeper
  into a formation, which is where raymarching degrades.
- **Controllable/malleable** — shape, density, coverage, and movement should be easy to drive
  from code, not baked into a fixed look.
- **Multi-light, not just sun-driven** — a directional sun controls day-lighting/transmittance,
  but dynamic point lights (a rocket engine flying through a cloud, a lightning strike in a
  storm) need to visibly light the cloud up from inside, independent of the sun.
- **Stylized/fun over photoreal** — closer to *Breath of the Wild* or *Sky*'s faceted cloud look
  than physically-based volumetric scattering.

## Why this approach

We discussed the wider goal first: planetary-scale weather across different planet "scenes"
(Earth, Jupiter-style bands, Venus), sun-relative transmittance, flyable clouds from orbital
distance down to individual puffs, weather/density variation (denser and darker for storms),
and both large-scale swirl formations and small individual clouds. No single rendering technique
covers that whole range well — the working plan is a **distance/altitude-driven stack**:

| Scale | Technique | Status |
| --- | --- | --- |
| Orbital / planetary swirls | Animated 2D shell texture on the atmosphere sphere | Not started |
| Mid-altitude, individual puffs | Instanced low-poly mesh clouds (**this doc**) | Spike in progress |
| Inside a single cloud | Raymarch bounded to that one mesh's local volume | Not started |

This doc covers only the mesh-puff layer. It's the first spike because it's the most direct
answer to the concrete complaint (raymarch flicker + perf loss on approach), and it's cheap
enough to validate quickly before investing in the other two layers.

The core mechanism that makes edges crisp is **flat shading from noise-displaced low-poly
geometry** — not alpha-tested billboards, not raymarched density. A smooth icosphere is displaced
radially by 3D value noise, converted to non-indexed geometry, and given per-face normals
(`computeVertexNormals()` on a non-indexed geometry yields faceted normals — the same effect as a
material's `flatShading` flag, but baked into the geometry so a hand-rolled `ShaderMaterial` gets
it for free without derivative-based normal reconstruction in the fragment shader).

## Architecture

New entry point `triangular-engine/clouds`, following the existing `scatter`/`impostor` module
convention (`core/` = framework-free logic, `three/` = Three.js building, `public-api.ts` +
`ng-package.json`, registered in `tsconfig.json`).

```text
triangular-engine/clouds
├── core/
│   └── cloud-puff-shape.ts      deterministic RNG + 3D value-noise/FBM + per-variant
│                                 displacement params (pure math, no three.js)
├── three/
│   ├── cloud-puff-geometry.ts   icosphere -> noise-displaced -> flat-shaded BufferGeometry
│   ├── cloud-puff-material.ts   hand-rolled ShaderMaterial: sun (directional) + up to 4
│   │                             dynamic point lights, rim/fresnel "silver lining" and
│   │                             from-inside glow terms
│   └── cloud-puff-cluster.ts    places InstancedMesh batches (one per shape variant) in a
│                                 region, wind drift via translating the cluster's Group,
│                                 setSunDirection()/setPointLights() to drive lighting live
└── public-api.ts
```

### Lighting model

Two light kinds, both cheap per-fragment terms — no shadow maps, no real volumetric scattering:

- **Sun** (directional): flat Lambert term + a fresnel/rim term that brightens the sun-facing
  silhouette edge ("silver lining") and darkens the shadowed core. This is the "sun position
  affects transmittance" control, done cheaply.
- **Point lights** (fixed-size array, 4 slots): distance-attenuated Lambert against each active
  light using the fragment's world position, plus a stronger backlight/fresnel "glow" term when
  the light sits roughly behind the surface from the camera's view. That's the mechanism for a
  rocket engine lighting a cloud up from inside as it flies through, or a lightning strike
  flashing one puff — both go through the same `setPointLights()` call on the cluster
  (`cloud-puff-cluster.ts`), a sustained moving light for the former, an instantaneous
  spike-then-decay on one array slot for the latter. Fixed-size 4-light array keeps the fragment
  shader a simple unrolled loop with no dynamic branching cost; revisit the array size only if a
  real scene needs more simultaneous lights.

### Instancing

One `InstancedMesh` per shape variant (4–6 variants), matching the pattern already used in
`scatter/three/scatter-instanced-mesh.ts`: `DynamicDrawUsage` on the instance matrix,
`frustumCulled = false` (the default single-bounding-sphere cull is wrong once instances are
spread across a region). All variant batches share one `ShaderMaterial` instance so sun direction
and point lights update once and apply cluster-wide.

## Demo

`projects/demo-app/src/app/pages/cloud-puffs-lab/` — an `OrbitControlsComponent` camera so the
cloud cluster can be orbited from a distance down to inside a single puff, a `DirectionalLight`
standing in for the sun, and a reference ground plane for scale. Controls: sun elevation/azimuth,
puff count/coverage, puff scale range, wind speed/direction, rim strength, a flat-vs-smooth
shading toggle (to show why flat shading is what keeps edges crisp), a "rocket engine" toggle
(an emissive marker flown through the cluster, driving one point-light slot continuously), and a
"lightning" toggle (a timer that spikes a free slot to high intensity near a random puff for a
couple of frames, then decays it).

## Out of scope for this spike

Orbital shell-texture layer, bounded local raymarch layer, a weather/density field shared across
layers, per-planet presets (Earth/Jupiter/Venus), rain particles — all deferred until this puff
layer is validated.

## Verification

Run the demo app, open `/cloud-puffs-lab`, and confirm:

- Silhouettes read as crisp/faceted, not fuzzy or aliased, at both a distance and orbited in close.
- The rim/"silver lining" visibly shifts as the sun-angle slider changes.
- Wind drift is continuous and smooth.
- The FPS counter (`showFPS: true`) stays stable whether orbiting far from or close to/inside a
  puff cluster — the actual perf complaint this spike targets.
- The flat/smooth shading toggle visibly demonstrates the crispness difference.
- With "Rocket engine" enabled, nearby puffs visibly pick up the moving light's color on their
  near/inside-facing silhouette as it passes through, independent of the sun's rim.
- With "Lightning" enabled, a puff briefly flashes bright near the strike point, independent of
  the other lighting, and decays back to normal.
