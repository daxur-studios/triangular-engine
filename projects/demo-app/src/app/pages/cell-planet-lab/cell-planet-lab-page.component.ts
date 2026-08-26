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
  Vector3Tuple,
} from 'three';
import { EngineModule, EngineService, RaycastFocusContext, RaycastFocusResolver } from 'triangular-engine';
import {
  buildPlanetEcology,
  buildPlanetGraphCore,
  buildPlanetTectonics,
  cellCornerElevation,
  IPlanetEcology,
  IPlanetGraphCell,
  IPlanetGraphCore,
  IPlanetTectonics,
  IVec3,
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
  private readonly riverMaterial = new LineBasicMaterial({ color: '#5ec8ff', transparent: true, opacity: 0.95 });
  private readonly coastlineMaterial = new LineBasicMaterial({ color: '#f4f4f4', transparent: true, opacity: 0.9 });
  private riverLines: LineSegments | null = null;
  private coastlineLines: LineSegments | null = null;

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
      this.riverLines?.geometry.dispose();
      this.coastlineLines?.geometry.dispose();
      this.sitesMaterial.dispose();
      this.edgesMaterial.dispose();
      this.previewMaterial.dispose();
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
   * flat-shaded and colored via `resolveCellColor()` — geometry rebuilds on regenerate(),
   * only the vertex colors are re-touched on a map-mode change. Every fan vertex sits
   * exactly at a cell center or a cell-polygon corner, so its elevation is looked up
   * directly (center = the cell's own elevation, corner = `cellCornerElevation()`, the
   * average of the 3 cells meeting there) instead of going through `sampleElevation()`'s
   * general `findCellAt()` search — O(1) per vertex instead of O(cellCount), which is what
   * keeps this affordable as the cell-count slider goes up. Still no subdivision or
   * crack-free stitching across chunks (that's M4b/c) — `sampleElevation()` stays the
   * function for arbitrary (non-vertex) queries like future collider patches.
   *
   * Every vertex is clamped to sea level from its corner's land/water *consensus* — land
   * if 2+ of the 3 cells meeting there are land, water otherwise — not from whichever
   * fan happens to be drawing it. Without this, a corner's raw value is a plain average
   * of the 3 cells that share it (see `cellCornerElevation()`), so an ocean cell sitting
   * next to a mountain range got one corner dragged up by that neighbor's elevation —
   * sometimes past the elevation of unrelated, flatter land cells elsewhere. An earlier
   * version of this clamp keyed the land/water side off the *owning* cell instead of the
   * corner consensus; since the mesh isn't vertex-welded (each of the 3 fans meeting at a
   * corner pushes its own copy of that vertex), that made a coastal corner clamp to two
   * different heights depending on which fan drew it — a visible gap/cliff at the seam
   * that was a mesh artifact, not a real elevation feature. Consensus is the same set of
   * 3 cell ids regardless of which of the 3 fans is asking (same symmetry as
   * `cellCornerElevation()` itself), so both sides of a shared edge now agree. This is
   * still a placeholder for the real fix (a separate flat ocean shell, M4+), not a claim
   * that blended coastal relief is itself wrong — and it doesn't give a real cliff *face*:
   * a land/water step still meets across a single unsubdivided edge with no vertices for
   * a vertical wall, so a genuine steep drop needs edge subdivision (M4b/c), not a clamp. */
  private rebuildPreviewMesh(graph: IPlanetGraphCore, tectonics: IPlanetTectonics): void {
    const { elevation, isLand, seaLevelElevation } = tectonics;
    const positions: number[] = [];
    const directions: number[] = [];
    const elevations: number[] = [];
    const cellIds: number[] = [];
    const pushVertex = (p: IVec3, e: number, land: boolean): void => {
      const clamped = land ? Math.max(e, seaLevelElevation) : Math.min(e, seaLevelElevation);
      directions.push(p.x, p.y, p.z);
      elevations.push(clamped);
      positions.push(p.x, p.y, p.z); // overwritten by updatePreviewDisplacement() below
    };
    const cornerIsLand = (cell: IPlanetGraphCell, cornerIndex: number): boolean => {
      const n = cell.neighbors.length;
      const a = cell.id;
      const b = cell.neighbors[cornerIndex];
      const c = cell.neighbors[(cornerIndex + 1) % n];
      const landCount = (isLand[a] ? 1 : 0) + (isLand[b] ? 1 : 0) + (isLand[c] ? 1 : 0);
      return landCount >= 2;
    };
    for (const cell of graph.cells) {
      const n = cell.corners.length;
      if (n < 3) continue;
      const centerElevation = elevation[cell.id];
      for (let k = 0; k < n; k++) {
        const k2 = (k + 1) % n;
        pushVertex(cell.center, centerElevation, isLand[cell.id]);
        pushVertex(cell.corners[k], cellCornerElevation(cell, k, elevation), cornerIsLand(cell, k));
        pushVertex(cell.corners[k2], cellCornerElevation(cell, k2, elevation), cornerIsLand(cell, k2));
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
    this.updatePreviewDisplacement();
    this.updatePreviewColors();
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
  }

  private updatePreviewColors(): void {
    if (!this.previewMesh) return;
    const colorAttr = this.previewMesh.geometry.getAttribute('color') as BufferAttribute;
    const arr = colorAttr.array as Float32Array;
    const scratch = new Color();
    const cache = new Map<number, [number, number, number]>();
    for (let i = 0; i < this.previewCellIdPerVertex.length; i++) {
      const cellId = this.previewCellIdPerVertex[i];
      let rgb = cache.get(cellId);
      if (!rgb) {
        scratch.setStyle(this.resolveCellColor(cellId));
        rgb = [scratch.r, scratch.g, scratch.b];
        cache.set(cellId, rgb);
      }
      const o = i * 3;
      arr[o] = rgb[0];
      arr[o + 1] = rgb[1];
      arr[o + 2] = rgb[2];
    }
    colorAttr.needsUpdate = true;
  }

  /** Mirrors the 2D unwrap's rivers-mode overlay onto the sphere: river paths (open
   * polylines) and coastline loops (closed), both already unit-sphere point chains from
   * `buildPlanetEcology()`. Nudged a hair above radius 1 so they don't z-fight the
   * preview mesh triangles when both are visible at once. */
  private rebuildRiverOverlays(ecology: IPlanetEcology): void {
    if (this.riverLines) {
      this.root.remove(this.riverLines);
      this.riverLines.geometry.dispose();
    }
    const riverGeometry = new BufferGeometry();
    riverGeometry.setAttribute('position', new BufferAttribute(this.flattenPaths(ecology.riverPaths, false), 3));
    this.riverLines = new LineSegments(riverGeometry, this.riverMaterial);
    this.riverLines.visible = this.mapMode() === 'rivers';
    this.root.add(this.riverLines);

    if (this.coastlineLines) {
      this.root.remove(this.coastlineLines);
      this.coastlineLines.geometry.dispose();
    }
    const coastGeometry = new BufferGeometry();
    coastGeometry.setAttribute('position', new BufferAttribute(this.flattenPaths(ecology.coastlines, true), 3));
    this.coastlineLines = new LineSegments(coastGeometry, this.coastlineMaterial);
    this.coastlineLines.visible = this.mapMode() === 'rivers';
    this.root.add(this.coastlineLines);
  }

  private flattenPaths(paths: IVec3[][], closed: boolean): Float32Array {
    const bias = 1.004;
    const out: number[] = [];
    for (const path of paths) {
      const n = path.length;
      if (n < 2) continue;
      const segments = closed ? n : n - 1;
      for (let k = 0; k < segments; k++) {
        const a = path[k];
        const b = path[(k + 1) % n];
        out.push(a.x * bias, a.y * bias, a.z * bias, b.x * bias, b.y * bias, b.z * bias);
      }
    }
    return new Float32Array(out);
  }

  /** Strokes each consecutive pair of points as its own line segment (not one continuous
   * path), skipping any segment that crosses the ±180° seam — same guard as the edge/fill
   * seam handling above, needed here because rivers/coastlines aren't cell-local. */
  private drawPolylines(
    ctx: CanvasRenderingContext2D,
    paths: IVec3[][],
    lonLat: (p: IVec3) => { lon: number; lat: number },
    mapPoint: (ll: { lon: number; lat: number }) => { x: number; y: number },
    closed: boolean,
  ): void {
    for (const path of paths) {
      const n = path.length;
      if (n < 2) continue;
      const lls = path.map(lonLat);
      const segments = closed ? n : n - 1;
      for (let k = 0; k < segments; k++) {
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
        ctx.lineWidth = Math.max(1.4, dpr * 1.2);
        ctx.globalAlpha = 1;
        this.drawPolylines(ctx, ecology.riverPaths, lonLat, mapPoint, false);
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
