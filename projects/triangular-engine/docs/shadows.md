# Cascaded Shadow Maps (CSM)

Triangular Engine provides built-in Cascaded Shadow Maps (CSM) via the `<csm>` component, powered by Three.js's integrated CSM engine (`three/examples/jsm/csm/CSM.js`).

CSM is the industry standard for outdoor, open-world directional lighting (sun / moon). It partitions the camera's view frustum into multiple depth cascades (typically 3 to 4), delivering razor-sharp contact shadows near the camera while maintaining shadow coverage all the way to the horizon without abrupt cutoffs or blocky aliasing.

---

## Why CSM? (Comparison with Standard Directional Shadows)

Standard directional shadows use a **single orthographic box** (`<directionalLight [castShadow]="true">`):
- If the box is small ($\approx 20\text{m}$), shadows look sharp up close, but everything beyond 20 meters abruptly loses shadows.
- If the box is large ($\approx 300\text{m}$), the shadow texture is spread thin across the entire world: shadows near the player's feet become blocky, pixelated, and jittery.

**CSM solves this completely**:
- **Cascade 0 (Foreground)**: Covers 0.1m to ~10m with dense shadow texels for fingers, grass, and characters.
- **Cascade 1 & 2 (Midground)**: Covers 10m to ~100m for vehicles and trees.
- **Cascade 3 (Far)**: Covers 100m to 500m+ for mountains and distant structures.
- **Cascade Blending (`[fade]="true"`)**: Smooth mathematical transitions eliminate visible boundary seams.

---

## Quick Start

Import `EngineModule` or `EngineLightModule` from `triangular-engine`:

```html
<scene>
  <!-- Ambient fill light -->
  <ambientLight [intensity]="0.35" color="#b0bec5" />

  <!-- Cascaded Shadow Maps Sun Rig -->
  <csm
    [lightDirection]="[-1, -1.5, -1]"
    [intensity]="3.0"
    [cascades]="4"
    [maxDistance]="450"
    [mode]="'practical'"
    [fade]="true"
    [debug]="false"
  />

  <!-- Camera & Controls -->
  <orbitControls [cameraPosition]="[0, 6, 18]" [target]="[0, 1.5, 0]" />

  <!-- Landscape & Objects automatically receive cascaded shadows -->
  <mesh [position]="[0, 0, 0]">
    <planeGeometry [params]="[200, 200, 1, 1]" orientation="horizontal" />
    <meshStandardMaterial [params]="{ color: '#37474f' }" />
  </mesh>
</scene>
```

> [!NOTE]
> `<csm>` creates and orchestrates its own internal directional lights (one per cascade). You do not need to add a separate `<directionalLight>` with `[castShadow]="true"`.

---

## Component Inputs (`<csm>`)

| Input | Type | Default | Description |
|---|---|---|---|
| `lightDirection` | `Vector3 \| Vector3Tuple` | `[-1, -1.5, -1]` | 3D vector representing the sun's travel direction. |
| `color` | `string \| ColorRepresentation` | `'#ffffff'` | Color of the cascade sun lights. |
| `intensity` | `number` | `3` | Base intensity applied across all cascade lights. |
| `cascades` | `number` | `4` | Number of depth cascades (1 to 4). |
| `maxDistance` | `number` | `500` | Maximum distance (in meters) that shadows extend from the camera. |
| `mode` | `CsmSplitMode` | `'practical'` | Frustum split formula: `'practical'`, `'uniform'`, or `'logarithmic'`. |
| `shadowMapSize` | `number` | `2048` | Resolution of each cascade shadow texture (e.g. 1024, 2048, 4096). |
| `shadowBias` | `number` | `-0.0001` | Shadow depth bias to eliminate shadow acne. |
| `fade` | `boolean` | `true` | Enables smooth interpolation across cascade boundaries to hide seams. |
| `autoRegisterMaterials` | `boolean` | `true` | Automatically traverses scene meshes and registers standard materials. |
| `adaptiveRange` | `CsmAdaptiveRange` | `undefined` | Planetary scale adaptive altitude config (see below). |
| `debug` | `boolean` | `false` | Displays real-time 3D wireframe frustums via `CSMHelper`. |

---

## Planetary & Orbit Scale (`adaptiveRange`)

When building a planetary game with seamless transitions from ground to orbit, zooming out thousands of kilometers can stretch or disconnect ground-level cascades.

The `adaptiveRange` input dynamically scales `maxDistance` and smoothly fades shadows into the planet's native day/night terminator as the camera rises into space:

```html
<csm
  [adaptiveRange]="{
    center: [0, 0, 0],
    surfaceRadius: 6000,
    minDistance: 200,
    maxDistance: 4000,
    altitudeScale: 1.5,
    fadeOutAltitude: 2500,
    maxFadeAltitude: 6000
  }"
/>
```

- **On the Ground**: Shadows use `minDistance` (200m) for maximum contact precision.
- **Ascending**: Expands coverage outward to maintain landscape shadow continuity.
- **Deep Orbit**: Smoothly attenuates to 0, handing visual day/night over to standard PBR lighting ($N \cdot L$).

---

## Selective Shadow Opt-Out (`[csmReceiver]`)

By default, `<csm>` automatically finds all compatible lit materials (`MeshStandardMaterial`, `MeshPhysicalMaterial`, `MeshLambertMaterial`, `MeshPhongMaterial`, `MeshToonMaterial`).

To opt-out a specific mesh from receiving cascaded shadows, use `[csmReceiver]="false"`:

```html
<mesh [csmReceiver]="false">
  <boxGeometry />
  <meshStandardMaterial />
</mesh>
```
