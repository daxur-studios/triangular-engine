# Cell Planets & Seamless 2.5D ↔ 3D Morph

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
