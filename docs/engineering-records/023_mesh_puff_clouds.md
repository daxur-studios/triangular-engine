# 023 — Mesh Puff Clouds

## Status

- State: In progress — base spike done; style plugin system (`ICloudPuffStyle`) and domain plugin system (`ICloudPuffDomain`) implemented and build-verified with three placement domains (Box, Sphere shell, Cylinder interior).
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
| Mid-altitude, individual puffs | Instanced low-poly mesh clouds (**this doc**) | Spike complete with Styles & Domains |
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
│   └── cloud-puff-shape.ts              deterministic RNG (createCloudRandom01) + 3D value-noise/FBM +
│                                         per-variant displacement params (pure math, no three.js)
├── three/
│   ├── cloud-puff-geometry.ts           icosphere -> noise-displaced -> flat-shaded BufferGeometry
│   │                                     (used by the low-poly-blob style)
│   ├── cloud-puff-material.ts           hand-rolled ShaderMaterial: sun (directional) + up to 4
│   │                                     dynamic point lights, rim/fresnel "silver lining" and
│   │                                     from-inside glow terms
│   ├── cloud-puff-cluster.ts            places InstancedMesh batches (one per shape variant) in a
│   │                                     domain, advances wind drift/rotation,
│   │                                     setSunDirection()/setPointLights() to drive lighting live
│   ├── styles/
│   │   ├── cloud-puff-style.ts          ICloudPuffStyle plugin interface
│   │   ├── cloud-puff-style-registry.ts CLOUD_PUFF_STYLES[] + getCloudPuffStyleById()
│   │   ├── low-poly-blob-style.ts       original displaced-icosphere look (default)
│   │   └── card-stack-style.ts          flat-shaded slab-stack look
│   └── domains/
│       ├── cloud-puff-domain.ts         ICloudPuffDomain plugin interface + wind types
│       ├── cloud-puff-domain-registry.ts CLOUD_PUFF_DOMAINS[] + getCloudPuffDomainById()
│       ├── box-domain.ts                Cartesian box volume + translation wrap
│       ├── sphere-shell-domain.ts       Planetary spherical shell + polar rotation
│       └── cylinder-interior-domain.ts  O'Neill cylinder inner surface + axial/rotational drift
└── public-api.ts
```

### Style plugin system

`ICloudPuffStyle` (`three/styles/cloud-puff-style.ts`) isolates "how one puff's geometry is
built" behind `buildGeometryVariants(variantParams, { detail, shading }) -> BufferGeometry[]`.
Everything else — material, lighting, instancing, domain placement, wind — is shared and style-agnostic,
so a new look is just a new file plus one line in the registry (`three/styles/cloud-puff-style-registry.ts`).

Two styles exist today:

- **Low-poly blob** (`low-poly-blob-style.ts`, default) — the original approach: icosphere
  vertices displaced radially by 3D value-noise/FBM, then flat-shaded. Round, cauliflower-ish.
- **Card stack** (`card-stack-style.ts`) — built from flat-shaded slabs instead of a displaced
  sphere. Each puff is a wide, near-flat **base tier** (mirrors the real cumulus
  condensation-level base) with 2–4 independent, randomly-offset **turret stacks** rising out of
  it (4 tapered layers each, increasingly jittered toward the top).

### Domain plugin system

`ICloudPuffDomain` (`three/domains/cloud-puff-domain.ts`) isolates "how puffs are distributed and moved in 3D space" behind `placeInstances(context) -> ICloudPuffTransform[]` and `createWindController(group, context) -> ICloudPuffDomainWindController`.

Three domains exist today:

- **Box** (`box-domain.ts`, default) — Cartesian volume with random translation within `regionSizeM` and wrap-around translation wind drift.
- **Sphere shell** (`sphere-shell-domain.ts`) — Puffs placed on a spherical altitude band (`radiusM`, `shellThicknessM`) oriented radially outward along the surface normal; wind is a smooth rotation around the polar axis (seamless wrap with no seams).
- **Cylinder interior** (`cylinder-interior-domain.ts`) — Puffs placed on the inner curved surface of a hollow cylinder (`radiusM`, `lengthM`) facing inward towards the central axis; wind combines axial drift (wrapped) and circumferential rotation around the cylinder axis.

### Lighting model

Two light kinds, both cheap per-fragment terms — no shadow maps, no real volumetric scattering:

- **Sun** (directional): flat Lambert term + a fresnel/rim term that brightens the sun-facing
  silhouette edge ("silver lining") and darkens the shadowed core.
- **Point lights** (fixed-size array, 4 slots): distance-attenuated Lambert against each active
  light using the fragment's world position, plus a stronger backlight/fresnel "glow" term when
  the light sits roughly behind the surface from the camera's view.

### Instancing

One `InstancedMesh` per shape variant (4–6 variants), matching the pattern already used in
`scatter/three/scatter-instanced-mesh.ts`: `DynamicDrawUsage` on the instance matrix,
`frustumCulled = false`. All variant batches share one `ShaderMaterial` instance so sun direction
and point lights update once and apply cluster-wide.

## Demo

`projects/demo-app/src/app/pages/cloud-puffs-lab/` — an `OrbitControlsComponent` camera with selectors for Domain (Box, Sphere shell, Cylinder interior) and Style (Low-poly blob, Card stack), sun elevation/azimuth, puff count/scale range, wind speed, rim strength, flat/smooth toggle, and dynamic point lights (Rocket engine & Storm lightning).

## Out of scope for this spike

Orbital shell-texture layer, bounded local raymarch layer, a weather/density field shared across
layers, per-planet presets (Earth/Jupiter/Venus), rain particles — all deferred until this puff
layer is validated.

## Verification

Run the demo app, open `/cloud-puffs-lab`, and confirm:

- Switching between **Box**, **Sphere shell**, and **Cylinder interior** domains places puffs accurately in their respective geometries.
- Silhouettes read as crisp/faceted across all styles and domains.
- Wind drift is continuous, seamless, and correctly oriented (translation wrap for Box, polar rotation for Sphere, axial/angular drift for Cylinder).
- The rim/"silver lining" visibly shifts as the sun-angle slider changes.
- With "Rocket engine" and "Lightning" enabled, puffs visibly light up in all domains.
