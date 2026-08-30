# 026 — Procedural Cities, Multi-Modal Roads, and 3D Terrain Adaptation

Status: Draft & Design (2026-08-30).

Related plans:

- [014_procedural_sublibrary.md](014_procedural_sublibrary.md) — parent procedural design and architecture.
- [016_procedural_parts.md](016_procedural_parts.md) — procedural parts assembly and sockets.
- [020_procedural_structures.md](020_procedural_structures.md) — procedural structures, runways, launch facilities, and 2D footprint envelopes.
- [008_spline_sublibrary.md](008_spline_sublibrary.md) — continuous parametric linear curves for roads, railways, and paths.
- [004_multi_surface_terrain.md](004_multi_surface_terrain.md) — planetary and local terrain heightmaps, cut/fill grading, and surface frames.
- [012_navigation_sublibrary.md](012_navigation_sublibrary.md) — pathfinding graphs, lane networks, and navigation meshes.

- [005_scatter_sublibrary.md](005_scatter_sublibrary.md) — GPU instanced mesh scattering for grass, trees, and streetscape props.
- [015_ecology_sublibrary.md](015_ecology_sublibrary.md) — regional plant species, biomes, and seasonal foliage variation.
- [018_scatter_exclusion_zones.md](018_scatter_exclusion_zones.md) — mask and exclusion envelopes for roads, foundations, and paved areas.

---

## 1. Goal

Provide a seed-driven, deterministic, and modular **procedural city and road network system** that:
1. Generates multi-modal transportation networks (pedestrian, vehicular, rail, elevated, underground).
2. Interacts dynamically with **3D terrain** via earth grading (cut-and-fill), terracing, bridges, and tunnels.
3. Integrates **urban greenery & landscaping** (parks, tree-lined boulevards, garden courtyards, bioswales) via GPU instanced scatter and regional ecology rules.
4. Accommodates **macro anchors** (runways, transit hubs, landmarks) alongside zoned procedural buildings.
5. Supports **multiple historical eras, district typologies** (organic old town, modern grid, industrial), and **growth over time**.
6. Connects cleanly with the engine's socket/graph philosophy (`ProceduralBuildingGenerator`, `IStructureArchetype`, and `NavigationGraph`).

```
(terrain, seed, city recipe) → CityModel {
  transitGraph,        // multi-layer 3D road/rail/path graph with lane and navigation metadata
  terrainModifications,// cut-and-fill grading, tunnel bores, terrace cut requests
  blocks & parcels,    // partitioned lots with frontage sockets and zoning profiles
  macroAnchors,        // large footprint structures (runways, stations, stadiums)
  buildings,           // procedural building instances fitted with foundation plinths
  urbanGreenery,       // parks, garden courtyards, street tree trenches, flowerbeds
  streetscapeProps,    // instanced streetlights, benches, barriers, sidewalks
  lodMeshes            // hierarchical merged geometry & impostor envelopes
}
```

---

## 2. Core Functional Layers

### Layer 1: Macro Anchors & Infrastructure
- **Anchor-First Placement**: Before fine grid generation, place large functional anchors that demand strict flatness or approach corridors (airports/runways, spaceports, major train terminals, seaports, central plazas).
- **Clearance Volumes**: Anchors reserve 3D exclusion zones (e.g. flight approach slopes, harbor channels).
- **Arterial Sockets**: Anchors expose primary transit sockets that dictate high-capacity highway and rail routing.

### Layer 2: Multi-Modal 3D Transit & Roads
- **3D Graph Representation**: Road/rail splines are 3D parametric curves supporting multi-level stacking:
  - **Layer +1 (Elevated)**: Viaducts, raised skywalks, elevated monorails/highways on structural pylon sockets.
  - **Layer 0 (Surface)**: Walkable paths, streets, boulevards, tramways.
  - **Layer -1 (Sub-surface)**: Metro tunnels, subterranean utility conduits.
- **Cross-Section Profiles**: Each road segment defines lane widths, sidewalk profiles, curbs, median strips, green verges, and utility socket channels.
- **Navigation Contract**: Emits structured lane centerlines, pedestrian crosswalks, traffic rules, and node connections directly to the engine navigation graph.

### Layer 3: 3D Terrain Interaction & Earthworks
Roads and cities dynamically negotiate elevation using 4 mechanisms:
1. **Cut & Fill Earthworks (Grading)**:
   - Roads and parcels request smooth slope adjustments to the terrain heightmap via `TerrainModificationIntent`.
   - Max grade clamping (e.g. max 6% for rail, 12% for roads).
2. **Terracing & Retaining Walls**:
   - Parcels on moderate slopes ($10^\circ - 25^\circ$) form stepped horizontal terraces with procedural retaining walls and public stair/ramp sockets.
3. **Bridges & Viaducts**:
   - When road splines span valleys, ravines, or rivers exceeding maximum grade or ground clearance thresholds, they spawn procedural bridge decks and support piers.
4. **Tunnels**:
   - When cutting through steep hills/mountains exceeding maximum cut depths, roads transition into tunnel portals and subterranean spline segments.
5. **Foundation Plinths**:
   - Procedural buildings generate adaptive sub-grade plinths/basements to seal gaps against residual ground slopes.

### Layer 4: City Blocks & Parcel Subdivision (Meso)
- **Cycle Extraction**: Road graphs are traversed to extract closed 2D/3D polygon loops (city blocks).
- **Lot Subdivision**: Blocks are sliced into individual building parcels using recursive binary partitioning, Oriented Bounding Box (OBB) splits, or straight skeleton offsets.
- **Frontage Sockets**: Every parcel guarantees at least one street frontage socket defining vehicle driveway access, pedestrian entrance alignment, and service connections.

### Layer 5: Urban Greenery & Landscaping (Parks, Streetscapes, Yards)
- **Parks & Public Plazas (Macro/Meso)**: Dedicated park parcels with organic walking paths, lawn patches, decorative ponds, flower beds, and dense tree clusters.
- **Linear Streetscape Greenery (Micro)**:
  - Tree planting sockets along sidewalk strips at regular intervals (e.g. every 12m).
  - Green median strips and bioswales (rain-retention grass/flower channels) dividing opposing traffic lanes.
- **Private Yards & Courtyards**: Residual space within parcel setbacks and interior block courtyards filled with private gardens, hedges, and flowerbeds.
- **Rooftop & Balcony Gardens**: Sockets on building flat roofs and terraces spawning green roofs, planters, and climbing ivy.
- **Scatter & Exclusion Integration**: Connected directly to `triangular-engine/scatter` and `triangular-engine/ecology`:
  - City asphalt and building footprints generate high-priority exclusion masks (`018_scatter_exclusion_zones.md`) preventing wild scatter from clipping through pavements.
  - Urban tree species select appropriate ornamental variants conditioned by climate and season.

### Layer 6: District Typologies & Eras
Cities are composed of distinct district recipes:
- **Historic / Medieval Core**: Irregular radial / Voronoi paths, tight pedestrian-only alleys, organic lot shapes, central cathedral/market anchor, cobblestone plazas with potted shrubs.
- **Modern Grid / Downtown**: High-density orthogonal grid, multi-lane avenues, high FAR (Floor Area Ratio) building envelopes, subterranean transit integration, rooftop gardens.
- **Garden Suburb / Periphery**: Cul-de-sacs, winding contour-following roads, generous building setbacks, large private lawns, tree-canopy shaded avenues.
- **Industrial / Logistics Zone**: Long linear strip lots, rail spur connections, wide turning radiuses, flat terrain bias, minimal ornamental vegetation.

### Layer 7: Temporal Growth & Evolution
- **Epoch 0 (Settlement)**: Historic seed at a natural geographical crossroad or harbor.
- **Epoch 1 (Radial Expansion)**: Primary arteries extend outwards; ring roads encircle the core.
- **Epoch 2 (Densification & Renewal)**: Inner core parcels are rezoned, replacing low-density seeds with taller procedural structures; central public parks established.
- **Epoch 3 (Modern Bypass & Infrastructure)**: Outer highway rings, airport corridors, and high-speed rail lines cut through or bridge across existing topography.

---

## 3. Sockets & Data Contracts

```ts
export interface ITerrainModificationIntent {
  kind: 'cut-and-fill' | 'terrace' | 'tunnel-bore' | 'flatten-polygon';
  polygon?: Vector2[];
  splineCenterline?: Vector3[];
  targetElevation: number;
  blendDistance: number;
  maxSlopeDegrees?: number;
}

export interface ICityTransitNode {
  id: string;
  position: Vector3;
  layer: number; // -1: underground, 0: surface, 1: elevated
  junctionType: 'intersection' | 'roundabout' | 'bridge-abutment' | 'tunnel-portal' | 'station-dock';
  sockets: ICitySocket[];
}

export interface ICityParcel {
  id: string;
  districtId: string;
  polygon: Vector2[];
  groundElevation: { min: number; max: number; average: number };
  frontageSocket: { position: Vector3; forward: Vector3; roadSegmentId: string };
  zoning: {
    archetypeCategory: 'residential' | 'commercial' | 'industrial' | 'civic' | 'park' | 'monument';
    maxHeight: number;
    setback: number;
    eraStyle: string;
    greeneryDensity: number; // 0.0 (paved) to 1.0 (lush botanical/park)
  };
}

export interface ICityMacroAnchor {
  id: string;
  type: 'runway' | 'launchpad' | 'train-terminal' | 'seaport' | 'stadium' | 'central-park' | 'plaza';
  footprintPolygon: Vector2[];
  approachCorridor?: { direction: Vector3; clearanceAngleDegrees: number; distance: number };
  transitConnections: { socketId: string; position: Vector3; allowedTransitTypes: string[] }[];
}
```

---

## 4. Milestone Roadmap

### Phase 1: Transit Graph & 3D Terrain Conformance (Foundations)
- **M0**: `CityTransitGraph` 2D/3D spline network data structures, node types, and cross-section profiles (including sidewalks and green verges).
- **M1**: Terrain interaction engine: `TerrainModificationIntent` (cut-and-fill heightmap baking), bridge span trigger on steep drops, and tunnel portal generation.
- **M2**: Procedural road mesh generation (curbs, markings, intersection fillets, bridge piers) + Jolt collision generation.

### Phase 2: Blocks, Parcels & Building Integration
- **M3**: Planar graph cycle extraction $\rightarrow$ City Block polygons.
- **M4**: Parcel subdivision (OBB/Skeleton partitioning) with frontage sockets and terrain terracing / retaining walls.
- **M5**: Integration with `procedural/structures` & `procedural/parts` to spawn zoned buildings with adaptive ground plinths.

### Phase 3: Urban Greenery, Macro Anchors & Multi-Modal Stacking
- **M6**: Urban Greenery pipeline: Sidewalk tree sockets, green medians, park generation, and scatter exclusion masking.
- **M7**: Anchor-first reservation engine (runways, launchpads, train stations, central parks) with approach clearance corridors.
- **M8**: Multi-layer transit routing (elevated skyways, surface roads, sub-surface rail/metro).
- **M9**: Navigation graph generation (lane centerlines, pedestrian crosswalks, traffic signals).

### Phase 4: Typologies, Eras & Growth Simulation
- **M10**: District generator profiles (Medieval organic, American grid, Garden suburb, Industrial strip).
- **M11**: Temporal growth simulation pipeline (Epoch 0 settlement $\rightarrow$ Epoch 3 modern metropolis).
- **M12**: Interactive City Lab in demo app with live seed controls, terrain slicing, greenery toggles, and transit visualization.

---

## 5. Demo App Lab (`/cities-lab`) & Testing Plan

### 5.1 Demo App Page Specification: `CitiesLabPageComponent`
Location: `projects/demo-app/src/app/pages/cities-lab/`  
Route: `/cities-lab`

The page will serve as the live visual testbed and debugging environment, featuring:
- **Interactive Control Sidebar**:
  - **Seed & Generation Trigger**: Random seed generator or text seed input.
  - **Terrain Controls**: Flat plane vs. hilly terrain vs. mountain valley heightmaps; slope severity sliders.
  - **District Typology Switcher**: Solo test presets (Grid Only, Medieval Only, Garden Suburb Only, Industrial Only) vs. Composite City.
  - **Epoch Timeline Scrubber**: Step from Epoch 0 (Settlement) $\rightarrow$ Epoch 1 (Expansion) $\rightarrow$ Epoch 2 (Densification) $\rightarrow$ Epoch 3 (Modern).
  - **Layer Toggles**: Hide/Show Elevated (+1), Surface (0), Underground (-1) networks.
  - **Greenery & Props**: Slider for urban tree/flower density; toggle for park paths and bioswales.
- **Debug Overlays & Inspection**:
  - **Spline & Lane Centerlines**: Colored lines indicating traffic directions, speed limits, and pedestrian crosswalks.
  - **Earthwork Heatmap**: Color-coded overlay showing Cut (blue), Fill (red), and Terraces (green).
  - **Socket & Lot Gizmos**: 3D arrows showing frontage sockets and parcel boundaries.
  - **Jolt Collider Wireframes**: Real-time static physics meshes for roads, bridge decks, and building envelopes.
- **Interactive Camera Modes**:
  - Orbit / Free Flycam.
  - Street-level Walk Camera (pedestrian navigation verification).
  - Vehicle Follow Camera (road spline curvature testing).

---

### 5.2 Phase-by-Phase Testing & Verification Matrix

Each milestone phase has strict automated unit tests and visual demo app verification gates:

| Phase | Automated Unit Tests (`*.spec.ts`) | Demo App Visual / Interactive Gate (`/cities-lab`) |
| :--- | :--- | :--- |
| **Phase 1: Transit & Terrain** (M0–M2) | - Graph connectivity & edge split/join math<br>- Grade calculation & slope clamping limits<br>- Cut-and-fill height calculation & blend falloffs<br>- Bridge/tunnel threshold trigger logic | - Visual inspection of road meshes conforming to rolling terrain<br>- Bridges correctly span valleys with piers snapping to ground<br>- Tunnel portals bore cleanly into steep slopes without mesh gaps |
| **Phase 2: Blocks, Parcels & Buildings** (M3–M5) | - Planar polygon cycle extraction (no degenerate loops)<br>- Parcel binary/OBB split validation (no zero-area lots)<br>- Guaranteeing 100% of lots have valid frontage sockets<br>- Building plinth height matching parcel corner heights | - Visual block slicing with setbacks and sidewalks<br>- Procedural buildings correctly orient to street frontages<br>- Sloped parcels form stepped terraces with retaining walls |
| **Phase 3: Greenery, Anchors & Transit Layers** (M6–M9) | - Scatter exclusion zones: 0 trees inside asphalt/foundations<br>- Anchor reservation SAT overlap tests (runway clearance)<br>- Multi-layer crossing clearances (elevated rail $> 5\text{ m}$ above road)<br>- Lane graph continuity for pathfinding | - Sidewalk trees align along socket trenches at regular spacing<br>- Runways and stadiums flatten designated zones cleanly<br>- Elevated skyways/rails stack over surface roads with proper pylons |
| **Phase 4: Typologies & Growth** (M10–M12) | - Deterministic seed regression (same seed $\equiv$ exact same city)<br>- District boundary blending and transitioning<br>- Epoch progression: existing artery continuity preserved across eras | - Scrubbing epoch timeline shows historic core densifying with high-rises<br>- Live district switching renders distinct architectural/grid patterns<br>- Smooth 60 FPS rendering with GPU instanced greenery and LODs |

