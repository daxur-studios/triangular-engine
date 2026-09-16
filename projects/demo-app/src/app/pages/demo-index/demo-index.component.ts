import {
  ChangeDetectionStrategy,
  Component,
  computed,
  HostListener,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';

export type DemoTier = 'gem' | 'lab' | 'archived';

export interface DemoCategory {
  readonly id: string;
  readonly label: string;
  readonly description: string;
}

export interface DemoItem {
  readonly id: string;
  readonly number: string;
  readonly title: string;
  readonly route: string;
  readonly categoryId: string;
  readonly tier: DemoTier;
  readonly entryPoints: readonly string[];
  readonly package: string;
  readonly description: string;
  readonly requiresJolt?: boolean;
}

export const CATEGORIES: readonly DemoCategory[] = [
  {
    id: 'water',
    label: 'Water Simulation',
    description: 'Gerstner wave dynamics, multi-domain water, and underwater postprocessing.',
  },
  {
    id: 'terrain',
    label: 'Terrain & World Composition',
    description: 'Multi-domain terrain streaming, rivers, geological features, and composer tools.',
  },
  {
    id: 'fauna',
    label: 'Fauna & Ecosystems',
    description: 'Deterministic flocking, herds, aquatic schools, and multi-biome life networks.',
  },
  {
    id: 'vegetation',
    label: 'Vegetation & Procedural Scatter',
    description: 'Procedural flora, meadow grass sway, impostor baking, and instanced scatter.',
  },
  {
    id: 'atmosphere',
    label: 'Atmosphere & Sky',
    description: 'Volumetric atmosphere, cloud layers, and daylight cycle integration.',
  },
  {
    id: 'physics',
    label: 'Physics & FX',
    description: 'Ribbon trails, vehicle physics, soft-bodies, and destruction dynamics.',
  },
  {
    id: 'core',
    label: 'Core & Architecture',
    description: 'Scene architecture, floating origin precision, pathfinding, and splines.',
  },
];

export const DEMOS: readonly DemoItem[] = [
  // --- Shining Gems ---
  {
    id: 'photo-mode-lab',
    number: '00',
    title: 'Scenic World & Photo Mode',
    route: '/photo-mode-lab',
    categoryId: 'core',
    tier: 'gem',
    entryPoints: ['procedural', 'terrain', 'scatter', 'water'],
    package: 'triangular-engine',
    description:
      'Multi-biome procedural landscape (coastal palms, meadow oaks, mountain pines, grass sway, 3D water, catch tower) with progressive anti-aliased (SSAA) 4K/8K photo capture.',
  },
  {
    id: 'water',
    number: '01',
    title: 'Water Library',
    route: '/water',
    categoryId: 'water',
    tier: 'gem',
    entryPoints: ['water', 'terrain', 'postprocessing'],
    package: 'triangular-engine/water',
    description:
      'Official flat, sphere, and cylinder water demo with quality presets, motion dynamics, and underwater postprocessing.',
  },
  {
    id: 'terrain-lab',
    number: '02',
    title: 'Terrain Lab',
    route: '/terrain-lab',
    categoryId: 'terrain',
    tier: 'gem',
    entryPoints: ['terrain', 'jolt'],
    package: 'triangular-engine/terrain',
    requiresJolt: true,
    description:
      'Multi-surface terrain (plane, sphere, cylinder), streaming worker, screen-space BSP error selector, and Jolt physics integration.',
  },
  {
    id: 'terrain-chunk-optimizer-lab',
    number: '02a',
    title: 'Terrain Chunk Optimizer',
    route: '/terrain-chunk-optimizer-lab',
    categoryId: 'terrain',
    tier: 'lab',
    entryPoints: ['terrain', 'meshoptimizer'],
    package: 'triangular-engine/terrain + meshoptimizer',
    description:
      'C0 fixture for independently simplified neighbouring terrain chunks, border locking, and ridge/river feature preservation.',
  },
  {
    id: 'terrain-chunk-streaming-lab',
    number: '02aa',
    title: 'Terrain Chunk Streaming',
    route: '/terrain-chunk-streaming-lab',
    categoryId: 'terrain',
    tier: 'lab',
    entryPoints: ['terrain', 'meshoptimizer'],
    package: 'triangular-engine/terrain + meshoptimizer',
    description:
      'C1 large-area terrain coverage with camera-driven quadtree refinement, asynchronous chunk replacement, parent fallback and live residency diagnostics.',
  },
  {
    id: 'planet-terrain-sphere-lab',
    number: '02ab',
    title: 'Planet Terrain Sphere',
    route: '/planet-terrain-sphere-lab',
    categoryId: 'terrain',
    tier: 'lab',
    entryPoints: ['terrain'],
    package: 'triangular-engine/terrain',
    description:
      'Whole-sphere terrain streaming with global continents, mountain belts, volcanic features, river valleys, and adaptive six-face LOD.',
  },
  {
    id: 'cdlod-planet-lab',
    number: '02b',
    title: 'CDLOD Planet Lab',
    route: '/cdlod-planet-lab',
    categoryId: 'terrain',
    tier: 'gem',
    entryPoints: ['terrain', 'celestial'],
    package: 'triangular-engine/terrain',
    description:
      'Continuous Distance-Dependent Level of Detail planetary terrain with GPU vertex geomorphing, roughness decimation, and motion prediction.',
  },
  {
    id: 'cell-planet-25d-map',
    number: '02c',
    title: 'Cell Planet 2.5D Map',
    route: '/cell-planet-25d-map',
    categoryId: 'terrain',
    tier: 'lab',
    entryPoints: ['worldgen', 'terrain'],
    package: 'triangular-engine/worldgen + terrain',
    description:
      'Civilization-style oblique map preview using the shared cell planet sampler, baked ridge and river relief, and GPU-morphed clipmap terrain.',
  },
  {
    id: 'cell-planet-globe',
    number: '02d',
    title: 'Cell Planet Globe',
    route: '/cell-planet-globe',
    categoryId: 'terrain',
    tier: 'lab',
    entryPoints: ['worldgen'],
    package: 'triangular-engine/worldgen + worldgen/render',
    description:
      'Fixed-resolution prototype globe that radially displaces the shared cell planet surface sampler (runbook 032): orbit/zoom, shared colour modes, height exaggeration and seabed relief. Defers chunked LOD/streaming to runbook 031.',
  },
  {
    id: 'cell-planet-morph-spike',
    number: '02e',
    title: 'Cell Planet 2.5D ↔ 3D Morph Spike',
    route: '/cell-planet-morph-spike',
    categoryId: 'terrain',
    tier: 'lab',
    entryPoints: ['worldgen'],
    package: 'triangular-engine/worldgen + worldgen/render',
    description:
      'Seamless animated transition between a 3D spherical planet and a 2.5D flat map (Equal Earth/Equirectangular) with live game units that adapt positions and surface orientation in real time.',
  },
  {
    id: 'takram-clouds',
    number: '03',
    title: 'Takram Clouds',
    route: '/takram-clouds',
    categoryId: 'atmosphere',
    tier: 'gem',
    entryPoints: ['takram'],
    package: 'triangular-engine/takram',
    description:
      'Declarative volumetric clouds and physical atmospheric haze with smooth daylight cycle transitions.',
  },
  {
    id: 'meadow-lab',
    number: '04',
    title: 'Meadow Lab',
    route: '/meadow-lab',
    categoryId: 'vegetation',
    tier: 'gem',
    entryPoints: ['procedural', 'scatter'],
    package: 'triangular-engine/procedural',
    description:
      'Ground-cover grass clumps registered as scatter species on fine identity cells, swaying under traveling wind gust bands.',
  },
  {
    id: 'flora-scatter-lab',
    number: '05',
    title: 'Flora Scatter Lab',
    route: '/flora-scatter-lab',
    categoryId: 'vegetation',
    tier: 'gem',
    entryPoints: ['procedural', 'scatter', 'jolt'],
    package: 'triangular-engine/procedural',
    requiresJolt: true,
    description:
      'Flora variants registered as scatter species — instancing, wind-weight sway, trunk colliders, and socket queries.',
  },
  {
    id: 'animals-worlds-lab',
    number: '06',
    title: 'Bird Worlds Lab',
    route: '/animals-worlds-lab',
    categoryId: 'fauna',
    tier: 'gem',
    entryPoints: ['animals'],
    package: 'triangular-engine/animals',
    description:
      'Production air-flock boids policy reconstructed directly from Universal Time on an infinite plane, planet sphere, and cylinder.',
  },
  {
    id: 'animals-herd-worlds-lab',
    number: '07',
    title: 'Herd Worlds Lab',
    route: '/animals-herd-worlds-lab',
    categoryId: 'fauna',
    tier: 'gem',
    entryPoints: ['animals'],
    package: 'triangular-engine/animals',
    description:
      'Production land-herd policy reconstructed directly from Universal Time across plane, planet sphere, and inside cylinder.',
  },
  {
    id: 'animals-fish-worlds-lab',
    number: '08',
    title: 'Fish Worlds Lab',
    route: '/animals-fish-worlds-lab',
    categoryId: 'fauna',
    tier: 'gem',
    entryPoints: ['animals', 'water'],
    package: 'triangular-engine/animals',
    description:
      'Production aquatic-school policy constrained to water volume across plane, sphere, and cylinder world geometries.',
  },
  {
    id: 'impostor-baker',
    number: '09',
    title: 'Octahedral Impostor Baker',
    route: '/impostor-baker',
    categoryId: 'vegetation',
    tier: 'gem',
    entryPoints: ['impostor', 'procedural'],
    package: 'triangular-engine/impostor',
    description:
      'Bakes procedural tree skeletons into hemispherical octahedral atlases and renders lit camera-facing impostors across thousands-strong fields.',
  },
  {
    id: 'vehicle-trail-lab',
    number: '10',
    title: 'Vehicle Trail Lab',
    route: '/vehicle-trail-lab',
    categoryId: 'physics',
    tier: 'gem',
    entryPoints: ['trail', 'jolt', 'terrain'],
    package: 'triangular-engine/trail',
    requiresJolt: true,
    description:
      'Driven box vehicle leaves live fading ribbon trails with radial gravity following ground curvature on plane, sphere, and cylinder.',
  },

  // --- Feature Labs ---
  {
    id: 'engine-demo',
    number: '11',
    title: 'Engine Demo',
    route: '/engine-demo',
    categoryId: 'core',
    tier: 'lab',
    entryPoints: ['core', 'postprocessing'],
    package: 'triangular-engine',
    description:
      'Core scene architecture, lighting, geometry, environment, and postprocessing pipeline demonstration.',
  },
  {
    id: 'camera-and-floating-origin',
    number: '12',
    title: 'Camera & Floating Origin',
    route: '/camera-and-floating-origin',
    categoryId: 'core',
    tier: 'lab',
    entryPoints: ['core'],
    package: 'triangular-engine',
    description:
      'Authoritative camera follow, coordinate rebasing, and floating origin large-distance precision.',
  },
  {
    id: 'multi-viewport-lab',
    number: '12b',
    title: 'Multi-Viewport Lab',
    route: '/multi-viewport-lab',
    categoryId: 'core',
    tier: 'lab',
    entryPoints: ['core', 'camera'],
    package: 'triangular-engine',
    description:
      'Split a single scene into multiple camera viewports: side-by-side, quadrants, or custom layouts. Same scene, multiple angles.',
  },
  {
    id: 'river-lab',
    number: '13',
    title: 'Procedural River Lab',
    route: '/river-lab',
    categoryId: 'terrain',
    tier: 'lab',
    entryPoints: ['terrain', 'water'],
    package: 'triangular-engine/terrain',
    description:
      'One continuous river spline drives terrain carving, riverbed width, elevation profiles, and downstream water flow.',
  },
  {
    id: 'terrain-composer-lab',
    number: '14',
    title: 'Terrain Composer Lab',
    route: '/terrain-composer-lab',
    categoryId: 'terrain',
    tier: 'lab',
    entryPoints: ['terrain'],
    package: 'triangular-engine/terrain',
    description:
      'Combine island boundaries, mountain ridges, rivers, and seeded noise into live procedural terrain heightmaps.',
  },
  {
    id: 'geological-features-lab',
    number: '15',
    title: 'Geological Features Lab',
    route: '/geological-features-lab',
    categoryId: 'terrain',
    tier: 'lab',
    entryPoints: ['terrain'],
    package: 'triangular-engine/terrain',
    description:
      'Interactive volcano and canyon feature modeling plus reusable terrain-feature catalogue.',
  },
  {
    id: 'navigation-lab',
    number: '16',
    title: 'Navigation Lab',
    route: '/navigation-lab',
    categoryId: 'core',
    tier: 'lab',
    entryPoints: ['navigation', 'terrain'],
    package: 'triangular-engine/navigation',
    description:
      'Flat and 3D heightfield path finding with seeded terrain elevation and live dynamic obstacles.',
  },
  {
    id: 'character-lab',
    number: '20d',
    title: 'Character Lab',
    route: '/character-lab',
    categoryId: 'core',
    tier: 'lab',
    entryPoints: ['core'],
    package: 'triangular-engine',
    description:
      'Scratch sandbox for iterating on character attempts (people and robots) — procedural mesh, svg, and other techniques side by side.',
  },
  {
    id: 'scene-inspection-lab',
    number: '16b',
    title: 'Scene Inspection Lab',
    route: '/scene-inspection-lab',
    categoryId: 'core',
    tier: 'lab',
    entryPoints: ['core'],
    package: 'triangular-engine',
    description:
      'Visualizes bounded scene snapshots, camera facts, deterministic warnings, filters, and truncation for agent-facing inspection.',
  },
  {
    id: 'animals-lab',
    number: '17',
    title: 'Animals Lab',
    route: '/animals-lab',
    categoryId: 'fauna',
    tier: 'lab',
    entryPoints: ['animals'],
    package: 'triangular-engine/animals',
    description:
      'Deterministic flock slice — Boids-style steering and velocity clamping on a seeded population.',
  },
  {
    id: 'animals-terrain-world-lab',
    number: '18',
    title: 'Animals Terrain World Lab',
    route: '/animals-terrain-world-lab',
    categoryId: 'fauna',
    tier: 'lab',
    entryPoints: ['animals', 'terrain'],
    package: 'triangular-engine/animals',
    description:
      'Animals flocking and navigation integrated onto live procedural heightfield terrain and obstacles.',
  },
  {
    id: 'flora-lab',
    number: '19',
    title: 'Flora Lab',
    route: '/flora-lab',
    categoryId: 'vegetation',
    tier: 'lab',
    entryPoints: ['procedural'],
    package: 'triangular-engine/procedural',
    description:
      'Seeded tree skeleton + low-poly mesh generator, colored by the baked windWeight vertex attribute.',
  },
  {
    id: 'flora-affordance-lab',
    number: '20',
    title: 'Flora Affordance Lab',
    route: '/flora-affordance-lab',
    categoryId: 'vegetation',
    tier: 'lab',
    entryPoints: ['procedural', 'animals'],
    package: 'triangular-engine/procedural',
    description:
      'Birds landing on queried tree branch perch sockets via stepArrival; interactive fruit slot detachment.',
  },
  {
    id: 'parts-lab',
    number: '20b',
    title: 'Procedural Parts Lab',
    route: '/parts-lab',
    categoryId: 'physics',
    tier: 'lab',
    entryPoints: ['procedural', 'jolt'],
    package: 'triangular-engine/procedural',
    requiresJolt: true,
    description:
      'Deterministic vehicle parts (wings, landing legs, rocket engines), load-bearing sockets, kinematic articulation, and mass properties.',
  },
  {
    id: 'structures-lab',
    number: '20c',
    title: 'Procedural Structures Lab',
    route: '/structures-lab',
    categoryId: 'physics',
    tier: 'lab',
    entryPoints: ['procedural', 'jolt'],
    package: 'triangular-engine/procedural',
    requiresJolt: true,
    description:
      'Deterministic spaceport structures (runways, launchpads, Mechazilla chopstick catch towers), 2D grading footprints, sockets, and Jolt compound physics.',
  },
  {
    id: 'cities-lab',
    number: '26',
    title: 'Procedural Cities & Roads Lab',
    route: '/cities-lab',
    categoryId: 'terrain',
    tier: 'lab',
    entryPoints: ['procedural', 'terrain', 'city', 'roads'],
    package: 'triangular-engine/procedural',
    description:
      'Procedural city and multi-modal transit graphs (runbook 026): dynamic 3D terrain adaptation (cut-and-fill, valley bridges, mountain tunnels), and procedural road mesh/collider synthesis.',
  },
  {
    id: 'scatter-lab',
    number: '21',

    title: 'Scatter Lab',
    route: '/scatter-lab',
    categoryId: 'vegetation',
    tier: 'lab',
    entryPoints: ['scatter', 'terrain'],
    package: 'triangular-engine/scatter',
    description:
      'Deterministic placement, spatial hashing, instancing, and LOD rendering across plane, sphere, and cylinder.',
  },
  {
    id: 'scatter-physics-lab',
    number: '22',
    title: 'Scatter Physics Lab',
    route: '/scatter-physics-lab',
    categoryId: 'vegetation',
    tier: 'lab',
    entryPoints: ['scatter', 'jolt'],
    package: 'triangular-engine/scatter',
    requiresJolt: true,
    description:
      'Jolt collider ring around camera, tree felling from collision impact momentum, and driveable rover.',
  },
  {
    id: 'trail-lab',
    number: '23',
    title: 'Trail Lab',
    route: '/trail-lab',
    categoryId: 'physics',
    tier: 'lab',
    entryPoints: ['trail'],
    package: 'triangular-engine/trail',
    description:
      'Ribbon-trail dynamic geometry and point-stamp decals for ground scorch and vehicle tracks.',
  },
  {
    id: 'water-buoyancy-poc',
    number: '24',
    title: 'Water Buoyancy Lab',
    route: '/water-buoyancy-poc',
    categoryId: 'water',
    tier: 'lab',
    entryPoints: ['water', 'jolt'],
    package: 'triangular-engine/water',
    requiresJolt: true,
    description:
      'Water surface sampling and Jolt rigid-body buoyancy simulation with wave response.',
  },
  {
    id: 'spline-lab',
    number: '25',
    title: 'Spline Lab',
    route: '/spline-lab',
    categoryId: 'core',
    tier: 'lab',
    entryPoints: ['spline'],
    package: 'triangular-engine/spline',
    description:
      'Interactive Bezier spline editor: point dragging, handle modes (auto/mirrored/broken/linear), open/closed loops.',
  },
  {
    id: 'takram-mini-planet',
    number: '26',
    title: 'Takram Mini Planet',
    route: '/takram-mini-planet',
    categoryId: 'atmosphere',
    tier: 'lab',
    entryPoints: ['takram'],
    package: 'triangular-engine/takram',
    description:
      'Small-planet scale and volumetric-to-texture cloud handoff for celestial rendering.',
  },
  {
    id: 'takram-cylinder-clouds',
    number: '27',
    title: 'O\'Neill Cylinder Clouds',
    route: '/takram-cylinder-clouds',
    categoryId: 'atmosphere',
    tier: 'lab',
    entryPoints: ['takram'],
    package: 'triangular-engine/takram',
    description:
      'Cylindrical volumetric clouds and internal atmospheric haze inside an O\'Neill habitat.',
  },

  // --- Spikes & Archived ---
  {
    id: 'takram-clouds-spike',
    number: '28',
    title: 'Takram Clouds Spike',
    route: '/takram-clouds-spike',
    categoryId: 'atmosphere',
    tier: 'archived',
    entryPoints: ['takram'],
    package: 'triangular-engine/takram',
    description:
      'Frozen plain Three.js reference spike for early Takram atmosphere port.',
  },
  {
    id: 'water-surface-spike',
    number: '29',
    title: 'Water Surface Spike',
    route: '/water-surface-spike',
    categoryId: 'water',
    tier: 'archived',
    entryPoints: ['water'],
    package: 'triangular-engine/water',
    description:
      'Phase 0: shared Gerstner wave model with CPU/GPU parity.',
  },
  {
    id: 'water-lod-poc',
    number: '30',
    title: 'Water LOD POC',
    route: '/water-lod-poc',
    categoryId: 'water',
    tier: 'archived',
    entryPoints: ['water'],
    package: 'triangular-engine/water',
    description:
      'Phase 1a: large-scale CDLOD-style morphing clipmap without seams.',
  },
  {
    id: 'water-material-poc',
    number: '31',
    title: 'Water Material POC',
    route: '/water-material-poc',
    categoryId: 'water',
    tier: 'archived',
    entryPoints: ['water'],
    package: 'triangular-engine/water',
    description:
      'Phase 1b: detail-normal chop, fresnel, and depth-texture shore fade against sloped shores.',
  },
  {
    id: 'water-sphere-poc',
    number: '32',
    title: 'Water Sphere POC',
    route: '/water-sphere-poc',
    categoryId: 'water',
    tier: 'archived',
    entryPoints: ['water'],
    package: 'triangular-engine/water',
    description:
      'Phase 1c: CDLOD grid and material curved onto a sphere via a recentring local tangent frame.',
  },
  {
    id: 'water-cylinder-poc',
    number: '33',
    title: 'Water Cylinder POC',
    route: '/water-cylinder-poc',
    categoryId: 'water',
    tier: 'archived',
    entryPoints: ['water'],
    package: 'triangular-engine/water',
    description:
      'Phase 1d: CDLOD grid curved onto the inside of an O\'Neill-cylinder wall.',
  },
  {
    id: 'life-lab',
    number: '34',
    title: 'A Little Life (Flock Spike)',
    route: '/life-lab',
    categoryId: 'fauna',
    tier: 'archived',
    entryPoints: ['life'],
    package: 'triangular-engine/life',
    description:
      'Phase 0: flock of birds avoiding a moving player influence and tree canopies.',
  },
  {
    id: 'destruction-poc',
    number: '35',
    title: 'Destruction POC',
    route: '/destruction-poc',
    categoryId: 'physics',
    tier: 'archived',
    entryPoints: ['jolt'],
    package: 'triangular-engine/jolt',
    requiresJolt: true,
    description:
      'Impact-driven permanent squash and deterministic rigid-body fracture debris.',
  },
  {
    id: 'soft-body-poc',
    number: '36',
    title: 'Soft Body POC',
    route: '/soft-body-poc',
    categoryId: 'physics',
    tier: 'archived',
    entryPoints: ['jolt'],
    package: 'triangular-engine/jolt',
    requiresJolt: true,
    description:
      'Declarative mesh-backed soft-body creation, deformation, and rendering with Jolt.',
  },
  {
    id: 'soft-body-tear-lab',
    number: '37',
    title: 'Soft-Body Tear Lab',
    route: '/soft-body-tear-lab',
    categoryId: 'physics',
    tier: 'archived',
    entryPoints: ['jolt'],
    package: 'triangular-engine/jolt',
    requiresJolt: true,
    description:
      'Manual split prototype: replace one deformable body with two fragments.',
  },
  {
    id: 'soft-bend-constraint',
    number: '38',
    title: 'Soft Bend Constraint',
    route: '/soft-bend-constraint',
    categoryId: 'physics',
    tier: 'archived',
    entryPoints: ['jolt'],
    package: 'triangular-engine/jolt',
    requiresJolt: true,
    description:
      'Jolt cloth and spheres compared with none, distance, and dihedral bend constraints.',
  },
  {
    id: 'cell-planet-lab',
    number: '39',
    title: 'Cell Planet Lab',
    route: '/cell-planet-lab',
    categoryId: 'core',
    tier: 'lab',
    entryPoints: ['worldgen'],
    package: 'triangular-engine/worldgen',
    description:
      'V4 structure-first planet generation (runbook 022): Fibonacci sphere sites, Lloyd relaxation, and their spherical Voronoi dual — 3D orbit view plus a 2D equirectangular unwrap.',
  },
  {
    id: 'cell-planet-map',
    number: '42',
    title: 'Cell Planet Map',
    route: '/cell-planet-map',
    categoryId: 'core',
    tier: 'lab',
    entryPoints: ['worldgen'],
    package: 'triangular-engine/worldgen',
    description:
      'Standalone, pan/zoomable fantasy-style 2D map of the same V4 planet graph — smooth coastline/river curves at full cell-edge resolution plus scattered biome/feature icons, decoupled from the 3D sphere mesh entirely.',
  },
  {
    id: 'cloud-puffs-lab',
    number: '40',
    title: 'Mesh Puff Clouds',
    route: '/cloud-puffs-lab',
    categoryId: 'atmosphere',
    tier: 'lab',
    entryPoints: ['clouds'],
    package: 'triangular-engine/clouds',
    description:
      'Instanced, flat-shaded low-poly cloud puffs (runbook 023): crisp sun-lit silhouettes plus dynamic point lights for a rocket engine or storm lightning glowing a cloud from inside.',
  },
  {
    id: 'planet-physics-lab',
    number: '41',
    title: 'Planet Physics Lab',
    route: '/planet-physics-lab',
    categoryId: 'physics',
    tier: 'lab',
    entryPoints: ['worldgen', 'jolt'],
    package: 'triangular-engine/jolt',
    description:
      'Real-scale Jolt physics on a Voronoi-cell planet (runbook 022 M4d, split out of Cell Planet Lab): a collider patch and dropped ball positioned in true meters via RVec3 double precision, across the same world-size tiers as Cell Planet Lab.',
  },
  {
    id: 'cell-subdivision-lod-lab',
    number: '43',
    title: 'Cell Subdivision LOD Lab',
    route: '/cell-subdivision-lod-lab',
    categoryId: 'core',
    tier: 'lab',
    entryPoints: ['worldgen'],
    package: 'triangular-engine/worldgen',
    description:
      'Boundary POC for region-scoped cell subdivision: mutually in-range coarse cells share one joint interior Voronoi diagram (a real jagged bisector between them), while an out-of-range edge stays a plain straight line — no skirts, no cracks, at any elevation scale.',
  },
];

export interface TagWithCount {
  readonly tag: string;
  readonly count: number;
}

export interface CategoryGroup {
  readonly category: DemoCategory;
  readonly demos: readonly DemoItem[];
}

@Component({
  selector: 'app-demo-index',
  imports: [RouterLink],
  templateUrl: './demo-index.component.html',
  styleUrl: './demo-index.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DemoIndexComponent {
  readonly categories = CATEGORIES;
  readonly demos = DEMOS;

  readonly searchQuery = signal('');
  readonly selectedTier = signal<'all' | DemoTier>('all');
  readonly selectedCategory = signal<string>('all');
  readonly selectedTag = signal<string>('all');

  /** All unique entry point tags with demo counts. */
  readonly allTags = computed<readonly TagWithCount[]>(() => {
    const counts = new Map<string, number>();
    for (const demo of this.demos) {
      for (const ep of demo.entryPoints) {
        counts.set(ep, (counts.get(ep) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([tag, count]) => ({ tag, count }));
  });

  /** Summary stats counts */
  readonly totalDemosCount = DEMOS.length;
  readonly gemsCount = DEMOS.filter((d) => d.tier === 'gem').length;
  readonly labsCount = DEMOS.filter((d) => d.tier === 'lab').length;
  readonly archivedCount = DEMOS.filter((d) => d.tier === 'archived').length;

  /** Demos matching active search, tier, category, and tag filters. */
  readonly filteredDemos = computed<readonly DemoItem[]>(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const tier = this.selectedTier();
    const cat = this.selectedCategory();
    const tag = this.selectedTag();

    return this.demos.filter((demo) => {
      // Tier filter
      if (tier !== 'all' && demo.tier !== tier) {
        return false;
      }
      // Category filter
      if (cat !== 'all' && demo.categoryId !== cat) {
        return false;
      }
      // Tag / entry point filter
      if (tag !== 'all' && !demo.entryPoints.includes(tag)) {
        return false;
      }
      // Search query
      if (q) {
        const matchesTitle = demo.title.toLowerCase().includes(q);
        const matchesDesc = demo.description.toLowerCase().includes(q);
        const matchesPkg = demo.package.toLowerCase().includes(q);
        const matchesNum = demo.number.includes(q);
        const matchesRoute = demo.route.toLowerCase().includes(q);
        const matchesTag = demo.entryPoints.some((ep) => ep.toLowerCase().includes(q));
        const category = this.categories.find((c) => c.id === demo.categoryId);
        const matchesCat = category?.label.toLowerCase().includes(q);

        if (
          !matchesTitle &&
          !matchesDesc &&
          !matchesPkg &&
          !matchesNum &&
          !matchesRoute &&
          !matchesTag &&
          !matchesCat
        ) {
          return false;
        }
      }
      return true;
    });
  });

  /** Shining Gems spotlight items (when no restrictive filter/search is active, or matching current search). */
  readonly featuredGems = computed<readonly DemoItem[]>(() => {
    return this.filteredDemos().filter((demo) => demo.tier === 'gem');
  });

  /** Group filtered demos by category. */
  readonly categoryGroups = computed<readonly CategoryGroup[]>(() => {
    const filtered = this.filteredDemos();
    const groups: CategoryGroup[] = [];

    for (const category of this.categories) {
      const matchingDemos = filtered.filter((d) => d.categoryId === category.id);
      if (matchingDemos.length > 0) {
        groups.push({
          category,
          demos: matchingDemos,
        });
      }
    }
    return groups;
  });

  /** Whether any non-default filter is currently active. */
  readonly hasActiveFilters = computed<boolean>(() => {
    return (
      this.searchQuery().trim().length > 0 ||
      this.selectedTier() !== 'all' ||
      this.selectedCategory() !== 'all' ||
      this.selectedTag() !== 'all'
    );
  });

  @HostListener('window:keydown', ['$event'])
  handleKeyboardShortcut(event: KeyboardEvent): void {
    if (event.key === '/' && !this.isInputElement(event.target)) {
      event.preventDefault();
      document.getElementById('demo-search-input')?.focus();
    } else if (event.key === 'Escape' && this.hasActiveFilters()) {
      this.clearAllFilters();
    }
  }

  setSearchQuery(query: string): void {
    this.searchQuery.set(query);
  }

  selectTier(tier: 'all' | DemoTier): void {
    this.selectedTier.set(tier);
  }

  selectCategory(categoryId: string): void {
    this.selectedCategory.set(categoryId);
  }

  selectTag(tag: string): void {
    this.selectedTag.update((current) => (current === tag ? 'all' : tag));
  }

  clearAllFilters(): void {
    this.searchQuery.set('');
    this.selectedTier.set('all');
    this.selectedCategory.set('all');
    this.selectedTag.set('all');
  }

  private isInputElement(target: EventTarget | null): boolean {
    return (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    );
  }
}
