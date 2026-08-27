import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  Points,
  PointsMaterial,
  SphereGeometry,
  Vector3Tuple,
} from 'three';
import { EngineModule, EngineService, RaycastFocusContext, RaycastFocusResolver } from 'triangular-engine';
import {
  buildPlanetEcology,
  buildPlanetGraphCore,
  buildPlanetTectonics,
  cellCornerElevation,
  IPlanetEcology,
  IPlanetGraphCore,
  IPlanetTectonics,
  IVec3,
  sampleElevation,
} from 'triangular-engine/worldgen';

/** dot(siteDirection, viewDirection) cutoff for the near-side cull — a small negative
 * margin past the exact horizon so boundary edges don't clip mid-line at the terminator. */
const CULL_THRESHOLD = -0.02;

export type MapMode = 'graph' | 'plates' | 'elevation' | 'land' | 'temperature' | 'moisture' | 'biome' | 'rivers';

/** Deterministic, well-spread plate color — golden-angle hue step so adjacent plate ids never land near each other on the wheel. */
function plateColor(plateId: number): string {
  const hue = (plateId * 137.508) % 360;
  return `hsl(${hue.toFixed(1)}, 65%, 55%)`;
}

/** Elevation -> color ramp: deep ocean blue through to snow-capped peaks, split at sea level. */
function elevationColor(elevation: number, seaLevel: number, min: number, max: number): string {
  if (elevation < seaLevel) {
    const t = max > seaLevel ? (elevation - min) / (seaLevel - min || 1) : 0;
    const clamped = Math.max(0, Math.min(1, t));
    const l = 12 + clamped * 28;
    return `hsl(210, 70%, ${l}%)`;
  }
  const t = Math.max(0, Math.min(1, (elevation - seaLevel) / (max - seaLevel || 1)));
  if (t < 0.6) {
    const l = 30 + (t / 0.6) * 20;
    return `hsl(${100 - t * 30}, 45%, ${l}%)`;
  }
  const l = 50 + ((t - 0.6) / 0.4) * 40;
  return `hsl(30, ${Math.max(0, 25 - (t - 0.6) * 40)}%, ${l}%)`;
}

/** Temperature -> color ramp: cold blue through to hot red. Temperature can dip below
 * -1 from the elevation lapse on high peaks, so the cold end clamps at -1.6, not -1. */
function temperatureColor(temperature: number): string {
  const t = Math.max(-1.6, Math.min(1, temperature));
  const norm = (t + 1.6) / 2.6;
  const hue = 240 - norm * 240;
  const l = 35 + norm * 20;
  return `hsl(${hue.toFixed(1)}, 65%, ${l}%)`;
}

/** Moisture -> color ramp: arid tan through to saturated teal-blue. */
function moistureColor(moisture: number): string {
  const m = Math.max(0, Math.min(1, moisture));
  const hue = 40 + m * 160;
  const l = 30 + m * 25;
  return `hsl(${hue.toFixed(1)}, 55%, ${l}%)`;
}

const BIOME_COLORS: Record<string, string> = {
  ocean: 'hsl(210, 55%, 22%)',
  lake: 'hsl(200, 65%, 42%)',
  ice_cap: 'hsl(195, 40%, 82%)',
  tundra: 'hsl(200, 20%, 55%)',
  taiga: 'hsl(170, 25%, 35%)',
  glacier: 'hsl(190, 50%, 90%)',
  steppe: 'hsl(45, 35%, 55%)',
  meadow: 'hsl(95, 45%, 45%)',
  hills: 'hsl(85, 35%, 38%)',
  jungle: 'hsl(140, 55%, 30%)',
  desert: 'hsl(40, 65%, 60%)',
  savanna: 'hsl(55, 55%, 50%)',
  rainforest: 'hsl(150, 60%, 25%)',
  alpine: 'hsl(0, 0%, 75%)',
  canyon: 'hsl(20, 55%, 40%)',
};

function biomeColor(biome: string): string {
  return BIOME_COLORS[biome] ?? '#888';
}

@Component({
  selector: 'app-cell-planet-lab-page',
  imports: [RouterLink, EngineModule],
  templateUrl: './cell-planet-lab-page.component.html',
  styleUrl: './cell-planet-lab-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class CellPlanetLabPageComponent implements AfterViewInit {
  private readonly engine = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly mapCanvas = viewChild<ElementRef<HTMLCanvasElement>>('mapCanvas');

  readonly cellCount = signal(180);
  readonly seed = signal(42);
  readonly relax = signal(2);
  readonly jitter = signal(15);
  readonly showSites = signal(true);
  readonly showEdges = signal(true);
  readonly showPreview3D = signal(false);
  readonly showOceanShell = signal(true);
  readonly plateCount = signal(10);
  readonly mapMode = signal<MapMode>('graph');
  /** Visual-only exaggeration of raw elevation (unitless, typically ~-1..1) into a radius
   * offset — a live debug-preview knob, not a gameplay constant. Deliberately low by default:
   * a flat-shaded low-poly mesh reads as a lumpy asteroid well before the terrain looks "tall". */
  readonly elevationScale = signal(2);
  /** Surface-relative up (radial from planet center) vs. fixed world-Y up for the orbit
   * camera. Off by default — matches the previous fixed-up behavior. */
  readonly useSurfaceUp = signal(false);
  readonly upVectorTuple = signal<Vector3Tuple | undefined>(undefined);

  readonly cellTotal = signal(0);
  readonly edgeTotal = signal(0);
  readonly degreeRange = signal('—');
  readonly buildMs = signal('—');
  readonly landFraction = signal('—');

  private readonly root = new Group();
  private readonly sitesMaterial = new PointsMaterial({
    color: '#f4b860',
    size: 0.022,
    sizeAttenuation: true,
  });
  private readonly edgesMaterial = new LineBasicMaterial({
    color: '#6fe3c0',
    transparent: true,
    opacity: 0.85,
  });
  private sitesPoints: Points | null = null;
  private edgesLines: LineSegments | null = null;
  private readonly previewMaterial = new MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    side: DoubleSide,
  });
  private previewMesh: Mesh | null = null;
  private previewCellIdPerVertex = new Int32Array(0);
  // Undisplaced unit direction + raw elevation per preview vertex, kept around so the
  // elevation-scale slider can re-displace positions in O(vertices) without recomputing
  // per-cell/corner elevation or touching the color attribute.
  private previewDirections = new Float32Array(0);
  private previewElevationPerVertex = new Float32Array(0);
  // Flat sea-level shell layered over the (unclamped) terrain mesh so submerged land
  // reads as underwater without the terrain mesh itself faking a shoreline — see the
  // rebuildPreviewMesh() doc comment.
  private readonly oceanMaterial = new MeshStandardMaterial({
    color: '#1c5f8a',
    transparent: true,
    opacity: 0.55,
    roughness: 0.15,
    metalness: 0.05,
    side: DoubleSide,
  });
  private oceanMesh: Mesh | null = null;
  private currentSeaLevelElevation = 0;
  private readonly riverMaterial = new LineBasicMaterial({ color: '#5ec8ff', transparent: true, opacity: 0.95 });
  private readonly coastlineMaterial = new LineBasicMaterial({ color: '#f4f4f4', transparent: true, opacity: 0.9 });
  private riverLines: LineSegments | null = null;
  private coastlineLines: LineSegments | null = null;
  // Unit directions + per-point sampled elevation for the river overlay, and unit
  // directions for the coastline overlay (which rides the constant sea-level radius
  // instead) — cached so onElevationScale() can reposition both cheaply without
  // re-sampling elevation on every slider tick.
  private riverDirections = new Float32Array(0);
  private riverElevations = new Float32Array(0);
  private coastlineDirections = new Float32Array(0);

  // Per-cell source data driving the near-side cull, rebuilt on regenerate() and
  // re-filtered every frame against the live camera position (updateCulling()).
  private siteDirs = new Float32Array(0);
  private siteScratch = new Float32Array(0);
  private cellSegments: Float32Array[] = [];
  private edgeScratch = new Float32Array(0);

  constructor() {
    this.engine.scene.background = new Color('#0a0d12');
    this.root.name = 'cell-planet-graph';
    this.engine.scene.add(this.root);

    this.engine.tick$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.updateCulling();
      this.updateSurfaceUp();
    });

    this.destroyRef.onDestroy(() => {
      this.engine.scene.remove(this.root);
      this.sitesPoints?.geometry.dispose();
      this.edgesLines?.geometry.dispose();
      this.previewMesh?.geometry.dispose();
      this.oceanMesh?.geometry.dispose();
      this.riverLines?.geometry.dispose();
      this.coastlineLines?.geometry.dispose();
      this.sitesMaterial.dispose();
      this.edgesMaterial.dispose();
      this.previewMaterial.dispose();
      this.oceanMaterial.dispose();
      this.riverMaterial.dispose();
      this.coastlineMaterial.dispose();
    });
  }

  ngAfterViewInit(): void {
    queueMicrotask(() => this.regenerate());
  }

  onCellCount(event: Event): void {
    this.cellCount.set(Number((event.target as HTMLInputElement).value));
    this.regenerate();
  }

  onSeed(event: Event): void {
    this.seed.set(Number((event.target as HTMLInputElement).value) || 0);
    this.regenerate();
  }

  shuffleSeed(): void {
    this.seed.set(Math.floor(Math.random() * 999999));
    this.regenerate();
  }

  onRelax(event: Event): void {
    this.relax.set(Number((event.target as HTMLInputElement).value));
    this.regenerate();
  }

  onJitter(event: Event): void {
    this.jitter.set(Number((event.target as HTMLInputElement).value));
    this.regenerate();
  }

  onPlateCount(event: Event): void {
    this.plateCount.set(Number((event.target as HTMLInputElement).value));
    this.regenerate();
  }

  onElevationScale(event: Event): void {
    this.elevationScale.set(Number((event.target as HTMLInputElement).value));
    this.updatePreviewDisplacement();
    this.updateRiverOverlayDisplacement();
  }

  setMapMode(mode: MapMode): void {
    this.mapMode.set(mode);
    this.drawMap();
    this.updatePreviewColors();
    if (this.riverLines) this.riverLines.visible = mode === 'rivers';
    if (this.coastlineLines) this.coastlineLines.visible = mode === 'rivers';
  }

  toggleSites(): void {
    this.showSites.update((value) => !value);
    if (this.sitesPoints) this.sitesPoints.visible = this.showSites();
    this.drawMap();
  }

  toggleEdges(): void {
    this.showEdges.update((value) => !value);
    if (this.edgesLines) this.edgesLines.visible = this.showEdges();
    this.drawMap();
  }

  togglePreview3D(): void {
    this.showPreview3D.update((value) => !value);
    if (this.previewMesh) this.previewMesh.visible = this.showPreview3D();
    if (this.oceanMesh) this.oceanMesh.visible = this.showPreview3D() && this.showOceanShell();
  }

  toggleOceanShell(): void {
    this.showOceanShell.update((value) => !value);
    if (this.oceanMesh) this.oceanMesh.visible = this.showPreview3D() && this.showOceanShell();
  }

  /** Toggles the orbit camera's up vector between fixed world-Y and surface-relative
   * (radial from the planet center) — surface-relative re-levels every tick in
   * `updateSurfaceUp()` so horizon stays level while orbiting over any latitude,
   * including near the poles where a fixed up would otherwise gimbal. */
  toggleSurfaceUp(): void {
    const next = !this.useSurfaceUp();
    this.useSurfaceUp.set(next);
    if (!next) this.upVectorTuple.set([0, 1, 0]);
  }

  private updateSurfaceUp(): void {
    if (!this.useSurfaceUp()) return;
    const camera = this.engine.camera$.value;
    if (!camera) return;
    const len = camera.position.length() || 1;
    this.upVectorTuple.set([camera.position.x / len, camera.position.y / len, camera.position.z / len]);
  }

  /** `raycastOrbitControls` focus resolver — hits the preview mesh so wheel-zoom and
   * rotate-drag pivot on the actual displaced surface under the pointer instead of a
   * flat distance-scaled guess, which is what let zooming clip through/overshoot terrain. */
  readonly raycastFocusResolver: RaycastFocusResolver = (context: RaycastFocusContext) => {
    if (!this.previewMesh?.visible) return null;
    const hit = context.raycaster.intersectObject(this.previewMesh, false)[0];
    return hit ? hit.point.toArray() : null;
  };

  jitterValue(): string {
    return (this.jitter() / 100).toFixed(2);
  }

  private graph: IPlanetGraphCore | null = null;
  private tectonics: IPlanetTectonics | null = null;
  private ecology: IPlanetEcology | null = null;

  private regenerate(): void {
    const t0 = performance.now();
    const graph = buildPlanetGraphCore({
      cellCount: this.cellCount(),
      seed: this.seed(),
      relaxationIterations: this.relax(),
      jitter: this.jitter() / 100,
    });
    const t1 = performance.now();

    this.graph = graph;
    this.tectonics = buildPlanetTectonics(graph, {
      plateCount: this.plateCount(),
      seed: this.seed(),
    });
    const land = this.tectonics.isLand.filter(Boolean).length / this.tectonics.isLand.length;
    this.landFraction.set(`${(land * 100).toFixed(0)}%`);
    this.ecology = buildPlanetEcology(graph, this.tectonics);

    this.buildMs.set(`${(t1 - t0).toFixed(1)} ms`);
    this.rebuildSites(graph);
    this.rebuildEdges(graph);
    this.rebuildPreviewMesh(graph, this.tectonics);
    this.rebuildRiverOverlays(this.ecology);
    this.updateStats(graph);
    this.drawMap();
    this.updateCulling();
  }

  private rebuildSites(graph: IPlanetGraphCore): void {
    const n = graph.cells.length;
    this.siteDirs = new Float32Array(n * 3);
    graph.cells.forEach((cell, i) => {
      this.siteDirs[i * 3] = cell.center.x;
      this.siteDirs[i * 3 + 1] = cell.center.y;
      this.siteDirs[i * 3 + 2] = cell.center.z;
    });
    this.siteScratch = new Float32Array(n * 3);

    if (this.sitesPoints) {
      this.root.remove(this.sitesPoints);
      this.sitesPoints.geometry.dispose();
    }
    const geometry = new BufferGeometry();
    const attribute = new BufferAttribute(new Float32Array(n * 3), 3);
    attribute.setUsage(DynamicDrawUsage);
    geometry.setAttribute('position', attribute);
    geometry.setDrawRange(0, 0);
    this.sitesPoints = new Points(geometry, this.sitesMaterial);
    this.sitesPoints.visible = this.showSites();
    this.sitesPoints.frustumCulled = false;
    this.root.add(this.sitesPoints);
  }

  private rebuildEdges(graph: IPlanetGraphCore): void {
    this.cellSegments = graph.cells.map((cell) => {
      const n = cell.corners.length;
      if (n < 3) return new Float32Array(0);
      const segments = new Float32Array(n * 6);
      for (let k = 0; k < n; k++) {
        const a = cell.corners[k];
        const b = cell.corners[(k + 1) % n];
        const o = k * 6;
        segments[o] = a.x;
        segments[o + 1] = a.y;
        segments[o + 2] = a.z;
        segments[o + 3] = b.x;
        segments[o + 4] = b.y;
        segments[o + 5] = b.z;
      }
      return segments;
    });
    const maxVerts = this.cellSegments.reduce((sum, seg) => sum + seg.length / 3, 0);
    this.edgeScratch = new Float32Array(maxVerts * 3);

    if (this.edgesLines) {
      this.root.remove(this.edgesLines);
      this.edgesLines.geometry.dispose();
    }
    const geometry = new BufferGeometry();
    const attribute = new BufferAttribute(new Float32Array(maxVerts * 3), 3);
    attribute.setUsage(DynamicDrawUsage);
    geometry.setAttribute('position', attribute);
    geometry.setDrawRange(0, 0);
    this.edgesLines = new LineSegments(geometry, this.edgesMaterial);
    this.edgesLines.visible = this.showEdges();
    this.edgesLines.frustumCulled = false;
    this.root.add(this.edgesLines);
  }

  /** Re-filters the sites/edges draw ranges every frame to whatever the live orbit
   * camera currently faces — sites are on a unit sphere centered at the origin, so a
   * cell's own center direction doubles as its surface normal for the visibility test. */
  private updateCulling(): void {
    const camera = this.engine.camera$.value;
    if (!camera || !this.sitesPoints || !this.edgesLines || this.siteDirs.length === 0) return;

    const camLen = camera.position.length() || 1;
    const vx = camera.position.x / camLen;
    const vy = camera.position.y / camLen;
    const vz = camera.position.z / camLen;

    const cellCount = this.siteDirs.length / 3;
    let visibleSites = 0;
    let edgeVerts = 0;
    for (let i = 0; i < cellCount; i++) {
      const o = i * 3;
      const dot = this.siteDirs[o] * vx + this.siteDirs[o + 1] * vy + this.siteDirs[o + 2] * vz;
      if (dot <= CULL_THRESHOLD) continue;

      const w = visibleSites * 3;
      this.siteScratch[w] = this.siteDirs[o];
      this.siteScratch[w + 1] = this.siteDirs[o + 1];
      this.siteScratch[w + 2] = this.siteDirs[o + 2];
      visibleSites++;

      const segment = this.cellSegments[i];
      this.edgeScratch.set(segment, edgeVerts * 3);
      edgeVerts += segment.length / 3;
    }

    const sitesAttr = this.sitesPoints.geometry.getAttribute('position') as BufferAttribute;
    (sitesAttr.array as Float32Array).set(this.siteScratch.subarray(0, visibleSites * 3));
    sitesAttr.needsUpdate = true;
    this.sitesPoints.geometry.setDrawRange(0, visibleSites);

    const edgesAttr = this.edgesLines.geometry.getAttribute('position') as BufferAttribute;
    (edgesAttr.array as Float32Array).set(this.edgeScratch.subarray(0, edgeVerts * 3));
    edgesAttr.needsUpdate = true;
    this.edgesLines.geometry.setDrawRange(0, edgeVerts);
  }

  /** Single source of truth for "what color is this cell", shared by the 2D unwrap
   * fill and the 3D preview mesh so the two views never drift apart. */
  private resolveCellColor(cellId: number): string {
    const mode = this.mapMode();
    const tectonics = this.tectonics;
    const ecology = this.ecology;
    if (!tectonics) return '#888';

    if (mode === 'plates') return plateColor(tectonics.plateIdByCell[cellId]);
    if (mode === 'elevation') {
      const min = Math.min(...tectonics.elevation);
      const max = Math.max(...tectonics.elevation);
      return elevationColor(tectonics.elevation[cellId], tectonics.seaLevelElevation, min, max);
    }
    if (ecology) {
      if (mode === 'temperature') return temperatureColor(ecology.temperature[cellId]);
      if (mode === 'moisture') return moistureColor(ecology.moisture[cellId]);
      if (mode === 'biome') return biomeColor(ecology.biome[cellId]);
    }
    return tectonics.isLand[cellId] ? 'hsl(100, 40%, 38%)' : 'hsl(210, 60%, 22%)';
  }

  /** M3+M4a 3D preview: one triangle fan per cell (center -> corner k -> corner k+1),
   * flat-shaded and colored via `resolveVertexColor()` — geometry rebuilds on regenerate(),
   * only the vertex colors are re-touched on a map-mode change. Every fan vertex sits
   * exactly at a cell center or a cell-polygon corner, so its elevation is looked up
   * directly (center = the cell's own elevation, corner = `cellCornerElevation()`, the
   * average of the 3 cells meeting there) instead of going through `sampleElevation()`'s
   * general `findCellAt()` search — O(1) per vertex instead of O(cellCount), which is what
   * keeps this affordable as the cell-count slider goes up. Still no subdivision or
   * crack-free stitching across chunks (that's M4b/c) — `sampleElevation()` stays the
   * function for arbitrary (non-vertex) queries like future collider patches.
   *
   * Elevation here is the raw blended value, never clamped to sea level. An earlier version
   * clamped each vertex up/down based on a land/water classification computed *separately*
   * from height (first the owning cell's flag, then a 3-cell corner consensus) — that made
   * color and geometry two independently-computed values that were only reconciled after
   * the fact, so lowering the elevation-scale slider shrank the visible mismatch without
   * ever removing it, and the same world-space gap got more visible at close range/planet
   * scale. `resolveVertexColor()` now classifies land/water from this exact same elevation
   * value (`elevation >= seaLevel`, per vertex), so color and height are the same statement
   * by construction — the mismatch can't reappear at any scale or elevation-scale setting.
   * The visual "water covers submerged land" effect now comes from the separate ocean shell
   * (`ensureOceanShell()`) layered on top, the standard technique instead of forcing the
   * terrain mesh to fake a shoreline.
   *
   * A per-vertex sandy "beach band" was tried and reverted: at this mesh's resolution (one
   * color sample per cell center/corner, linearly interpolated across a whole triangle) any
   * band is at minimum a full triangle wide, which reads as a chunk of the cell recolored
   * sand, not a shoreline — a mesh-resolution limit, not something tunable away with a
   * narrower threshold. A thin shoreline needs a real line overlay instead; see
   * `computeMeshWaterlineDirections()`. */
  private rebuildPreviewMesh(graph: IPlanetGraphCore, tectonics: IPlanetTectonics): void {
    const { elevation } = tectonics;
    const positions: number[] = [];
    const directions: number[] = [];
    const elevations: number[] = [];
    const cellIds: number[] = [];
    const pushVertex = (p: IVec3, e: number): void => {
      directions.push(p.x, p.y, p.z);
      elevations.push(e);
      positions.push(p.x, p.y, p.z); // overwritten by updatePreviewDisplacement() below
    };
    for (const cell of graph.cells) {
      const n = cell.corners.length;
      if (n < 3) continue;
      const centerElevation = elevation[cell.id];
      for (let k = 0; k < n; k++) {
        const k2 = (k + 1) % n;
        pushVertex(cell.center, centerElevation);
        pushVertex(cell.corners[k], cellCornerElevation(cell, k, elevation));
        pushVertex(cell.corners[k2], cellCornerElevation(cell, k2, elevation));
        cellIds.push(cell.id, cell.id, cell.id);
      }
    }

    if (this.previewMesh) {
      this.root.remove(this.previewMesh);
      this.previewMesh.geometry.dispose();
    }
    const geometry = new BufferGeometry();
    const positionAttr = new BufferAttribute(new Float32Array(positions), 3);
    positionAttr.setUsage(DynamicDrawUsage);
    geometry.setAttribute('position', positionAttr);
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(positions.length), 3));
    this.previewDirections = new Float32Array(directions);
    this.previewElevationPerVertex = new Float32Array(elevations);
    this.previewCellIdPerVertex = new Int32Array(cellIds);
    this.previewMesh = new Mesh(geometry, this.previewMaterial);
    this.previewMesh.visible = this.showPreview3D();
    this.root.add(this.previewMesh);
    this.currentSeaLevelElevation = tectonics.seaLevelElevation;
    this.ensureOceanShell();
    this.updatePreviewDisplacement();
    this.updatePreviewColors();
  }

  /** Flat sea-level shell (a plain unit sphere, scaled per-frame-cheap via `scale`, not
   * regenerated) layered over the terrain mesh. Depth-tests normally against the unclamped
   * terrain: where land pokes above sea level it renders in front and hides the shell, where
   * terrain dips below sea level the shell is in front and covers it — the same technique
   * used for this in Civ-style globes, no per-vertex land/water logic needed here at all. */
  private ensureOceanShell(): void {
    if (!this.oceanMesh) {
      const geometry = new SphereGeometry(1, 96, 48);
      this.oceanMesh = new Mesh(geometry, this.oceanMaterial);
      this.root.add(this.oceanMesh);
    }
    this.oceanMesh.visible = this.showPreview3D() && this.showOceanShell();
  }

  /** Re-displaces every preview vertex from its stored (direction, elevation) pair using
   * the current `elevationScale()` slider — cheap enough to run on every slider `input`
   * event, no geometry rebuild or color re-touch needed. */
  private updatePreviewDisplacement(): void {
    if (!this.previewMesh) return;
    const scale = this.elevationScale() / 100;
    const positionAttr = this.previewMesh.geometry.getAttribute('position') as BufferAttribute;
    const positions = positionAttr.array as Float32Array;
    for (let i = 0; i < this.previewElevationPerVertex.length; i++) {
      const radius = 1 + this.previewElevationPerVertex[i] * scale;
      const o = i * 3;
      positions[o] = this.previewDirections[o] * radius;
      positions[o + 1] = this.previewDirections[o + 1] * radius;
      positions[o + 2] = this.previewDirections[o + 2] * radius;
    }
    positionAttr.needsUpdate = true;
    this.previewMesh.geometry.computeVertexNormals();

    if (this.oceanMesh) {
      this.oceanMesh.scale.setScalar(1 + this.currentSeaLevelElevation * scale);
    }
  }

  /** Per-vertex color for the 3D preview — unlike `resolveCellColor()` (the 2D unwrap's flat
   * per-cell-polygon fill), this classifies land vs water from each vertex's own already-
   * blended elevation instead of the cell's coarse `isLand[]` flag, so it can never disagree
   * with the height at that same vertex — see the `rebuildPreviewMesh()` doc comment. Not
   * cached per-cell (unlike the old version) since the land/water split and the elevation
   * ramp both now vary per vertex within a single cell's fan, not just per cell. */
  private updatePreviewColors(): void {
    if (!this.previewMesh || !this.tectonics) return;
    const colorAttr = this.previewMesh.geometry.getAttribute('color') as BufferAttribute;
    const arr = colorAttr.array as Float32Array;
    const scratch = new Color();
    const mode = this.mapMode();
    const tectonics = this.tectonics;
    const elevMin = Math.min(...tectonics.elevation);
    const elevMax = Math.max(...tectonics.elevation);
    for (let i = 0; i < this.previewCellIdPerVertex.length; i++) {
      const cellId = this.previewCellIdPerVertex[i];
      const vertexElevation = this.previewElevationPerVertex[i];
      scratch.setStyle(this.resolveVertexColor(cellId, vertexElevation, mode, tectonics, elevMin, elevMax));
      const o = i * 3;
      arr[o] = scratch.r;
      arr[o + 1] = scratch.g;
      arr[o + 2] = scratch.b;
    }
    colorAttr.needsUpdate = true;
  }

  /** Land/water split here is `vertexElevation >= seaLevel`, checked per vertex — the same
   * elevation value that already drives that vertex's height in `updatePreviewDisplacement()`.
   * A biome-mode vertex above sea level on a cell whose own `isLand[]`/biome say "ocean" (or
   * vice versa) falls back to a generic land/ocean tone rather than that cell's specific
   * biome, since the biome itself is only computed per-cell — the goal here is just making
   * sure color never contradicts geometry at the coastline, not vertex-resolution biomes.
   * No beach/sand band here — see the `rebuildPreviewMesh()` doc comment for why that was
   * reverted; the shoreline is drawn as a separate thin line instead
   * (`computeMeshWaterlineDirections()`), so biome color runs straight to the water's edge. */
  private resolveVertexColor(
    cellId: number,
    vertexElevation: number,
    mode: MapMode,
    tectonics: IPlanetTectonics,
    elevMin: number,
    elevMax: number,
  ): string {
    if (mode === 'plates') return plateColor(tectonics.plateIdByCell[cellId]);
    if (mode === 'elevation') return elevationColor(vertexElevation, tectonics.seaLevelElevation, elevMin, elevMax);

    const land = vertexElevation >= tectonics.seaLevelElevation;

    const ecology = this.ecology;
    if (ecology) {
      if (mode === 'temperature') return temperatureColor(ecology.temperature[cellId]);
      if (mode === 'moisture') return moistureColor(ecology.moisture[cellId]);
      if (mode === 'biome') {
        if (!land) return ecology.biome[cellId] === 'lake' ? BIOME_COLORS['lake'] : BIOME_COLORS['ocean'];
        const biome = ecology.biome[cellId];
        return biome === 'ocean' || biome === 'lake' ? 'hsl(95, 45%, 45%)' : biomeColor(biome);
      }
    }
    return land ? 'hsl(100, 40%, 38%)' : 'hsl(210, 60%, 22%)';
  }

  /** Mirrors the 2D unwrap's rivers-mode overlay onto the sphere: river paths (open
   * polylines) and coastline loops (closed), both already unit-sphere point chains from
   * `buildPlanetEcology()`. Rivers flow on land, so each river point is sampled through
   * `sampleElevation()` (the same M4a bridge function the preview mesh's corners use) and
   * repositioned to actually hug the displaced terrain surface — previously these sat at a
   * fixed ~1.004 radius regardless of elevation-scale, which only happened to line up with
   * the terrain when elevation-scale was near 0 and otherwise left rivers floating above
   * peaks or buried under valleys. The coastline loop rides the same constant sea-level
   * radius as the ocean shell (the "water line") and is now extracted directly from the
   * preview mesh's own per-vertex elevation (`computeMeshWaterlineDirections()`) instead of
   * `buildPlanetEcology()`'s coarse per-cell edge chain — that coarse version walked cell
   * polygon edges classified by each cell's single `isLand[]` flag, which is a different
   * (and visibly offset) boundary from the per-vertex `elevation >= seaLevel` split the
   * terrain color/height actually use, so the two lines didn't match. Extracting from the
   * same triangles the terrain is built from makes them the same boundary by construction. */
  private rebuildRiverOverlays(ecology: IPlanetEcology): void {
    if (this.riverLines) {
      this.root.remove(this.riverLines);
      this.riverLines.geometry.dispose();
    }
    this.riverDirections = this.flattenPathDirections(ecology.riverPaths, false);
    this.riverElevations = this.sampleElevationsFor(this.riverDirections);
    const riverGeometry = new BufferGeometry();
    riverGeometry.setAttribute('position', new BufferAttribute(new Float32Array(this.riverDirections.length), 3));
    this.riverLines = new LineSegments(riverGeometry, this.riverMaterial);
    this.riverLines.visible = this.mapMode() === 'rivers';
    this.root.add(this.riverLines);

    if (this.coastlineLines) {
      this.root.remove(this.coastlineLines);
      this.coastlineLines.geometry.dispose();
    }
    this.coastlineDirections = this.computeMeshWaterlineDirections();
    const coastGeometry = new BufferGeometry();
    coastGeometry.setAttribute('position', new BufferAttribute(new Float32Array(this.coastlineDirections.length), 3));
    this.coastlineLines = new LineSegments(coastGeometry, this.coastlineMaterial);
    this.coastlineLines.visible = this.mapMode() === 'rivers';
    this.root.add(this.coastlineLines);

    this.updateRiverOverlayDisplacement();
  }

  /** Re-derives river/coastline positions from their cached (direction, elevation) pairs
   * for the current `elevationScale()` — cheap, no re-sampling — so it can run on every
   * elevation-scale slider `input` event alongside `updatePreviewDisplacement()`. */
  private updateRiverOverlayDisplacement(): void {
    const scale = this.elevationScale() / 100;
    const bias = 1.0015; // tiny radial nudge so lines don't z-fight the terrain/ocean surfaces

    if (this.riverLines) {
      const attr = this.riverLines.geometry.getAttribute('position') as BufferAttribute;
      const positions = attr.array as Float32Array;
      for (let i = 0; i < this.riverElevations.length; i++) {
        const radius = (1 + this.riverElevations[i] * scale) * bias;
        const o = i * 3;
        positions[o] = this.riverDirections[o] * radius;
        positions[o + 1] = this.riverDirections[o + 1] * radius;
        positions[o + 2] = this.riverDirections[o + 2] * radius;
      }
      attr.needsUpdate = true;
    }

    if (this.coastlineLines && this.tectonics) {
      const radius = (1 + this.tectonics.seaLevelElevation * scale) * bias;
      const attr = this.coastlineLines.geometry.getAttribute('position') as BufferAttribute;
      const positions = attr.array as Float32Array;
      for (let i = 0; i < this.coastlineDirections.length; i++) {
        positions[i] = this.coastlineDirections[i] * radius;
      }
      attr.needsUpdate = true;
    }
  }

  /** Extracts the land/water boundary directly from the preview mesh's own triangles instead
   * of `buildPlanetEcology()`'s per-cell edge chain — walks each fan triangle's 3 stored
   * (direction, elevation) vertices (see `rebuildPreviewMesh()`) and, for any edge whose two
   * endpoints straddle sea level, linearly interpolates the crossing direction. A triangle
   * crosses sea level along exactly 0 or 2 of its edges in the generic case (a vertex sitting
   * exactly on sea level is the only way to get 1, ignored here as a measure-zero edge case
   * for a debug lab), so each qualifying triangle contributes exactly one line segment,
   * connected across triangles into the mesh's exact waterline. `updateRiverOverlayDisplacement()`
   * then places these at the same sea-level radius as the ocean shell, since a crossing point's
   * elevation is exactly `seaLevel` by construction. */
  private computeMeshWaterlineDirections(): Float32Array<ArrayBuffer> {
    const tectonics = this.tectonics;
    const dirs = this.previewDirections;
    const elevs = this.previewElevationPerVertex;
    const out: number[] = [];
    if (!tectonics || dirs.length === 0) return new Float32Array(out);
    const seaLevel = tectonics.seaLevelElevation;

    const crossing = (a: number, b: number): [number, number, number] | null => {
      const ea = elevs[a];
      const eb = elevs[b];
      if (ea === eb || (ea >= seaLevel) === (eb >= seaLevel)) return null;
      const t = (seaLevel - ea) / (eb - ea);
      const ao = a * 3;
      const bo = b * 3;
      const x = dirs[ao] + (dirs[bo] - dirs[ao]) * t;
      const y = dirs[ao + 1] + (dirs[bo + 1] - dirs[ao + 1]) * t;
      const z = dirs[ao + 2] + (dirs[bo + 2] - dirs[ao + 2]) * t;
      const len = Math.hypot(x, y, z) || 1;
      return [x / len, y / len, z / len];
    };

    for (let i = 0; i + 2 < elevs.length; i += 3) {
      const hits: [number, number, number][] = [];
      const c01 = crossing(i, i + 1);
      if (c01) hits.push(c01);
      const c12 = crossing(i + 1, i + 2);
      if (c12) hits.push(c12);
      const c20 = crossing(i + 2, i);
      if (c20) hits.push(c20);
      if (hits.length === 2) {
        out.push(hits[0][0], hits[0][1], hits[0][2], hits[1][0], hits[1][1], hits[1][2]);
      }
    }
    return new Float32Array(out);
  }

  private flattenPathDirections(paths: IVec3[][], closed: boolean): Float32Array<ArrayBuffer> {
    const out: number[] = [];
    for (const path of paths) {
      const n = path.length;
      if (n < 2) continue;
      const segments = closed ? n : n - 1;
      for (let k = 0; k < segments; k++) {
        const a = path[k];
        const b = path[(k + 1) % n];
        out.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
    return new Float32Array(out);
  }

  /** One `sampleElevation()` call per point — O(cellCount) each via `findCellAt()`'s brute
   * force search, so O(points * cellCount) total. Only runs on regenerate()/mode data
   * changes, not per frame or per slider tick, which keeps it affordable at this lab's
   * scale (a few thousand cells, a few thousand path points at most). */
  private sampleElevationsFor(directions: Float32Array): Float32Array<ArrayBuffer> {
    const graph = this.graph;
    const tectonics = this.tectonics;
    const elevations = new Float32Array(directions.length / 3);
    if (!graph || !tectonics) return elevations;
    for (let i = 0; i < elevations.length; i++) {
      const o = i * 3;
      elevations[i] = sampleElevation(graph, tectonics.elevation, {
        x: directions[o],
        y: directions[o + 1],
        z: directions[o + 2],
      });
    }
    return elevations;
  }

  /** Strokes each consecutive pair of points as its own line segment (not one continuous
   * path), skipping any segment that crosses the ±180° seam — same guard as the edge/fill
   * seam handling above, needed here because rivers/coastlines aren't cell-local. */
  /** `flows`/`baseLineWidth`, when given, vary the stroke width per segment as
   * `baseLineWidth * (1 + 0.5 * sqrt(flow - 1))` — the classic Red Blob Games technique for
   * showing merged rivers widening downstream (see `IPlanetRivers.riverFlow`'s doc comment). */
  private drawPolylines(
    ctx: CanvasRenderingContext2D,
    paths: IVec3[][],
    lonLat: (p: IVec3) => { lon: number; lat: number },
    mapPoint: (ll: { lon: number; lat: number }) => { x: number; y: number },
    closed: boolean,
    flows?: number[][],
    baseLineWidth = 1,
  ): void {
    for (let pathIndex = 0; pathIndex < paths.length; pathIndex++) {
      const path = paths[pathIndex];
      const flow = flows?.[pathIndex];
      const n = path.length;
      if (n < 2) continue;
      const lls = path.map(lonLat);
      const segments = closed ? n : n - 1;
      for (let k = 0; k < segments; k++) {
        const a = lls[k];
        const b = lls[(k + 1) % n];
        if (Math.abs(a.lon - b.lon) > Math.PI * 0.9) continue;
        if (flow) ctx.lineWidth = baseLineWidth * (1 + 0.5 * Math.sqrt(Math.max(0, flow[(k + 1) % n] - 1)));
        const pa = mapPoint(a);
        const pb = mapPoint(b);
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
      }
    }
  }

  private updateStats(graph: IPlanetGraphCore): void {
    let edgeSum = 0;
    let min = Infinity;
    let max = 0;
    for (const cell of graph.cells) {
      edgeSum += cell.neighbors.length;
      min = Math.min(min, cell.neighbors.length);
      max = Math.max(max, cell.neighbors.length);
    }
    this.cellTotal.set(graph.cells.length);
    this.edgeTotal.set(edgeSum / 2);
    this.degreeRange.set(`${min} / ${max}`);
  }

  private drawMap(): void {
    const graph = this.graph;
    const canvasRef = this.mapCanvas();
    if (!graph || !canvasRef) return;

    const canvas = canvasRef.nativeElement;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.width * 0.5 * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#0a0d12';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = '#1b2330';
    ctx.lineWidth = Math.max(1, dpr);
    for (let i = 1; i < 4; i++) {
      const x = (width / 4) * i;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    const midY = height / 2;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(width, midY);
    ctx.stroke();

    const lonLat = (p: IVec3) => ({
      lon: Math.atan2(p.z, p.x),
      lat: Math.asin(Math.max(-1, Math.min(1, p.y))),
    });
    const mapPoint = (ll: { lon: number; lat: number }) => ({
      x: ((ll.lon / Math.PI) * 0.5 + 0.5) * width,
      y: (1 - ((ll.lat / (Math.PI / 2)) * 0.5 + 0.5)) * height,
    });

    const mode = this.mapMode();
    const tectonics = this.tectonics;
    const ecology = this.ecology;
    if (mode !== 'graph' && tectonics && ecology) {
      for (const cell of graph.cells) {
        const n = cell.corners.length;
        if (n < 3) continue;
        const lls = cell.corners.map(lonLat);
        // A cell whose corners straddle the ±180° seam would smear across the whole
        // map width if filled naively — skip it, same as the edge-drawing seam guard below.
        const wraps = lls.some((ll, k) => Math.abs(ll.lon - lls[(k + 1) % n].lon) > Math.PI * 0.9);
        if (wraps) continue;

        ctx.fillStyle = this.resolveCellColor(cell.id);

        ctx.beginPath();
        const p0 = mapPoint(lls[0]);
        ctx.moveTo(p0.x, p0.y);
        for (let k = 1; k < n; k++) {
          const p = mapPoint(lls[k]);
          ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();
        ctx.fill();
      }

      if (mode === 'rivers') {
        ctx.strokeStyle = '#f4f4f4';
        ctx.lineWidth = Math.max(1, dpr);
        ctx.globalAlpha = 0.9;
        this.drawPolylines(ctx, ecology.coastlines, lonLat, mapPoint, true);

        ctx.strokeStyle = '#5ec8ff';
        ctx.globalAlpha = 1;
        this.drawPolylines(ctx, ecology.riverPaths, lonLat, mapPoint, false, ecology.riverFlow, Math.max(1.4, dpr * 1.2));
      }
    }

    if (this.showEdges()) {
      ctx.strokeStyle = '#6fe3c0';
      ctx.lineWidth = Math.max(1, dpr * 0.8);
      ctx.globalAlpha = 0.8;
      for (const cell of graph.cells) {
        const n = cell.corners.length;
        if (n < 3) continue;
        const lls = cell.corners.map(lonLat);
        for (let k = 0; k < n; k++) {
          const a = lls[k];
          const b = lls[(k + 1) % n];
          if (Math.abs(a.lon - b.lon) > Math.PI * 0.9) continue;
          const pa = mapPoint(a);
          const pb = mapPoint(b);
          ctx.beginPath();
          ctx.moveTo(pa.x, pa.y);
          ctx.lineTo(pb.x, pb.y);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }

    if (this.showSites()) {
      ctx.fillStyle = '#f4b860';
      for (const cell of graph.cells) {
        const p = mapPoint(lonLat(cell.center));
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.6 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
