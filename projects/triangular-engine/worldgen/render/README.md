# triangular-engine/worldgen/render: cell planets

High-level reference for AI agents and developers working with Voronoi cell planets, map projections, and the GPU morphing system.

---

## 1. Entry Points & Architecture

* **`triangular-engine/worldgen`** (Framework-free Core):
  * Graph generation (`buildPlanetGraphCore`), Voronoi cells, plate tectonics (`IPlanetTectonics`), ecology (`IPlanetEcology`), cell neighbors, border extraction, and surface samplers (`IPlanetSurfaceSampler`).
* **`triangular-engine/worldgen/render`** (Angular & Three.js Presentation):
  * `<cellPlanetMorphView>`: High-performance 3D Globe $\leftrightarrow$ 2.5D Flat Map GPU vertex reprojection with day/night solar cycle, tracking, bathymetric relief, and tactical overlays.
  * `<cellPlanetMap>`: 2D Canvas flat map with pan/zoom, seasonal temperature shifts, biomes, and graticules.
  * `<cellPlanetMorphStreamingView>`: Worker-backed quadtree terrain with GPU morphing and camera-frustum refinement.

---

## 2. Coordinate Conventions (Hard-to-find Details)

Both 3D Globe and 2.5D Map share the exact same body-fixed orientation:
* **$+Y$**: North Pole ($\text{lat} = +90^\circ$).
* **$-Y$**: South Pole ($\text{lat} = -90^\circ$).
* **$+X$**: East ($\text{lon} = +90^\circ$).
* **$+Z$**: Prime Meridian ($\text{lon} = 0^\circ$). Tangent point at $Z = 0$ facing viewer.
* **$-Z$**: Antimeridian ($\text{lon} = \pm 180^\circ$). In 3D globe, edges curl back into $-Z$. In 2.5D flat, $+Z$ is surface elevation relief.

---

## 3. `<cellPlanetMorphView>` Component

Selector: `cellPlanetMorphView` (exported by `triangular-engine/worldgen/render`).

### Essential Inputs
| Input | Type | Description |
| --- | --- | --- |
| `sampler` | `IPlanetSurfaceSampler` | Elevation/biome surface sampler. Required. |
| `graph` | `IPlanetGraphCore` | Cell graph for cell picking and border rendering. |
| `morphProgress` | `number` | `0.0` = 3D Sphere, `1.0` = 2.5D Flat Map, or intermediate unrolling. |
| `projectionKind` | `'equalEarth' \| 'equirectangular'` | Projection used for 2.5D unrolling. |
| `trackingMode` | `'none' \| 'meridian' \| 'oblique'` | Dynamic tracking behavior (see below). |
| `trackingDirection`| `IVec3 \| null` | Direction vector on the sphere to center the projection on. |
| `showMapBorder` | `boolean` | Outer perimeter frame in 2.5D mode. Fades at 60%→40% morph. |
| `mapBorderStyle` | `'cartographic' \| 'tactical' \| 'simple'` | Frame style preset. |
| `mapBorderClearance` | `number` | Elevation clearance above sea level (default 0.04) so border/knobs float proud of terrain. |
| `showBorderSliders` | `boolean` | 3D diamond slider knobs that ride along the curved/straight border tracks. |
| `projectionCenterLon` | `number` | Central longitude $\lambda_0 \in [-180^\circ, +180^\circ]$ for manual projection framing. |
| `projectionCenterLat` | `number` | Central latitude $\phi_0 \in [-90^\circ, +90^\circ]$ for manual projection framing. |
| `borderSliderColor` | `string` | Emissive color for the 3D border slider diamond knobs. |
| `dayNightEnabled` | `boolean` | Solar cycle with penumbra twilight, sunset glow, and night ambient. |
| `timeOfDay` | `number` | Hours $[0..24)$, e.g. 12 = noon at prime meridian. |
| `showCellBorders` | `boolean` | Fine Voronoi cell outlines. |
| `showTerritoryBorders` | `boolean` | Thick territory border ribbons between factions (`factionByCell`). |
| `showTacticalOverlay` | `boolean` | GPU texture-based cell highlight and movement range overlay. |

### Outputs
| Output | Payload | Description |
| --- | --- | --- |
| `cellClick` | `{ cellId: number, direction: IVec3, point: Vector3 }` | Emitted on click/tap over surface. |
| `cellHover` | `{ cellId: number \| null, direction: IVec3 \| null }` | Emitted when cursor hovers over cells. |
| `projectionCenterChange` | `{ lonDeg: number, latDeg: number }` | Emitted when dragging 3D border sliders or tracks. |

### Tracking Modes
* `'none'`: Static map centered on Greenwich ($0^\circ$ lon, $0^\circ$ lat).
* `'meridian'`: Central meridian dynamically shifts East/West to center the tracked unit horizontally; poles remain locked at top/bottom.
* `'oblique'`: Full transverse oblique projection centering both latitude and longitude; allows seamless transpolar flight without seam cuts.

---

## 4. Key Public Methods & Patterns

### A. Evaluating Unit / Marker 3D World Positions
Do not manually calculate trigonometric positions for units or markers on the planet. Use:
```ts
const { position, normal } = morphView.evaluateUnitTransform(direction, elevation);
unitMesh.position.copy(position);
```
This guarantees exact alignment across all morph progress levels ($0 \to 1$), projections (Equal Earth or Equirectangular), and dynamic tracking bases.

### B. Cell Picking & Raycasting
The terrain vertex position buffer is continuously morphed on the GPU, which can cause standard Three.js raycasting to miss on flat maps. The component provides an automatic CPU-synced raycaster:
```ts
const hit = morphView.resolveCellAtScreen(clientX, clientY, canvasElement);
// hit.cellId, hit.direction, hit.point
```

### C. 60 FPS Smooth Unit Tracking
For real-time moving aircraft or units without Angular zone/change-detection overhead:
```ts
morphView.updateTracking(unitDirection, 'meridian');
```

### D. Custom Materials
Consumers can supply custom Three.js materials via `customTerrainMaterial` and `customOceanMaterial` functions that receive `(uniforms, dayNightUniforms)`.

## 5. Streaming Terrain Frustum LOD

`cellPlanetMorphStreamingView` owns patch selection and streaming; the host
supplies `radiusM`, `meshGenerator`, and camera/controls. For displaced terrain,
set `heightScaleM` to match the mesh generator:

```html
<cellPlanetMorphStreamingView
  [radiusM]="planetRadius"
  [meshGenerator]="generatePatch"
  [heightScaleM]="terrainHeightScale"
  [morphProgress]="morph"
  [frustumCulling]="true"
/>
```

`frustumCulling` defaults to `true` when the active engine camera is available.
It limits refinement, retaining a complete coarse cover outside the camera's
view. `horizonCulling` defaults to `true` and rejects terrain beyond the planet
curve only at `morphProgress=0`; a deformed map uses frustum bounds without
spherical horizon rejection. Longitude wrapping and polar regions are included.

`frustumSafetyFactor` defaults to `1.35` and is clamped to at least `1`. It
expands patch UV bounds to prepare nearby terrain before a turn. Some detail
outside the visible cone is expected from that buffer and four-child quadtree
splits. Bounds include elevations from `-2 * heightScaleM` through
`+2 * heightScaleM` (default height scale `0`), across both projections and all
morph values. Keep generated elevations within that range.

Changes to culling controls and the debounced LOD morph automatically invalidate
selection without clearing resident meshes. The wrapper also forwards
`selectionRevision` for other caller-owned selector settings. `freezeLod` keeps
the selected cut while worker jobs finish, and applies pending selection changes
on unfreeze.

For direct `createCellPlanetMorphSurfaceSelector` integration, supply its
`camera` provider to enable view culling, and invalidate the terrain surface
through `selectionRevision` when live option getters change. The camera and
patch positions must share the same planet-centred coordinate frame.

`createFrozenFrustumVisualizer(camera, options)` captures a camera pose and
projection independently of subsequent camera or parent-rig movement. Add its
`group` to the scene and call `dispose()` to remove it and release its geometries
and materials. The demo's Freeze LOD helper uses the camera snapshot from the
last selection. Its displayed far distance is shortened for readability; it
does not change the camera's actual far plane or the selector's visibility test.

## 6. Flat features (runways, roads)

Runways, taxiways, aprons and roads are not meshes over the terrain. One `FlatFeatureSet` (from
`triangular-engine/worldgen/render/core`, framework-free and worker-safe) both flattens the height source and feeds
`flatFeatureLayer` in `triangular-engine/planet-material`, so the paint always lies on the flat ground.

```ts
import { FlatFeatureSet, type FlatFeature } from 'triangular-engine/worldgen/render/core';

const features: FlatFeature[] = [
  // 3 km runway, 45 m wide, flat at 120 m; blends back to the terrain over 30 m + 1.4 km
  { kind: 'rectangle', id: 'runway', centre, headingRad: 0.4, lengthM: 3000, widthM: 45,
    heightM: 120, apronM: 30, shoulderM: 1400, priority: 10, markings: 'runway' },
  // road segment following the ground from 140 m to 155 m
  { kind: 'segment', id: 'road-1', start, end, widthM: 8, heightM: [140, 155], priority: 1, markings: 'road' },
];
const set = new FlatFeatureSet(features, radiusM);
```

Positions are unit directions in the planet body frame (`[x, y, z]`, the same frame as the mesh worker). A segment is
a great-circle arc of at most 45° with round ends; a rectangle is centred on a direction, `headingRad` measured from
east towards north. `flatFeatureOffset(centre, flatFeatureFrame(centre, heading), alongM, acrossM, radiusM)` lays out
an airfield in metres.

**Height stamp.** In your mesh worker, pass `modifyElevation: set.heightStamp()` in the `ICellPlanetWorkerPipelineOptions`
of `handleCellPlanetWorkerMessage` (the definitions are plain data: post them to the worker and build the set there). Inside `widthM/2 + apronM` the ground sits at the
feature's `heightM` (a segment interpolates between its two ends); over the next `shoulderM` it blends back with a
smooth step. The stamp is a function of the body-frame direction only, so every terrain LOD and every patch edge gets
the same height. Leave `heightM` out to paint a feature on the natural ground (water, ice). Use
`set.stampElevation(direction, naturalM)` on the CPU for the same height (placement, physics, camera ground).

**Overlaps and crossings.** Features blend in ascending `priority` (then list order), each pulling the height towards
its own: the higher-priority feature holds its height where they cross, and the result stays continuous. The material
layer uses the same rule for the markings.

**Per-page lists.** `FlatFeaturePageWindow(set, options)` keeps a window of `windowPages²` (default 32²) pages of an
equirectangular grid around the camera. `update(cameraDirection, altitudeM)` picks the page size from the altitude
(`max(minPageM, altitudeM × pageAltitudeRatio)`, with hysteresis), re-centres when the camera moved more than an eighth
of the window, and selects the features of pages new to the window only: up to `maxPerPage` (default 8) per page,
highest priority first. It packs them into two float textures for `flatFeatureLayer`. `stats` reports the level and
how many pages overflowed. The window option `capacity` (default 256) is the most features it holds.

**Clearance.** `set.isInClearance(direction, marginM?)` is true within a feature's `clearanceM` (default: its
`apronM`) of its edge; scatter can use it to keep trees and rocks off runways and roads. `set.nearest(direction)`
returns the nearest feature and its signed distance.

Known limits:

- Positions on the GPU are float32 unit directions: on an Earth-size planet markings step at about 0.5 m.
- Equirectangular pages narrow in longitude towards the poles; the window covers less ground there.
- Features beyond the window are not drawn; at coarse levels a full page drops its lowest-priority features (small
  roads disappear from high altitude first).
- Material tiles baked from the terrain (slope, cliff colour) do not see the stamp.
- The stamp scans every feature with a cheap reach test; it suits hundreds of features, not tens of thousands.
