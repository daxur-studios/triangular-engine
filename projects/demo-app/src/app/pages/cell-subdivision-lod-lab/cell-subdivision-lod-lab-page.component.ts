import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
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
  Mesh,
  MeshStandardMaterial,
  Vector3Tuple,
} from 'three';
import { EngineModule, EngineService, RaycastOrbitControlsComponent } from 'triangular-engine';
import {
  buildChunkMeshData,
  buildPlanetGraphCore,
  buildPlanetTectonics,
  buildSubdividedRegionMeshData,
  IPlanetGraphCore,
  IPlanetTectonics,
} from 'triangular-engine/worldgen';

/** Fixed planet radius (m) for this lab — a real `WorldSizeTier` picker (see `cell-planet-lab`)
 * is out of scope here; the only thing that needs real-world-ish units is `lodDistance`'s
 * camera-distance comparison, so one reasonable constant is enough. */
const PLANET_RADIUS_M = 500_000;

/** Must match the "Sub-cells per cell" slider's `max` in the template — used only to size the
 * detail mesh's preallocated vertex buffer once at `regenerate()` time, so it never has to grow
 * (dispose/realloc) at runtime no matter where the user drags that slider afterward. */
const SUB_CELL_COUNT_MAX = 20;
/** Heuristic worst-case vertex budget per subdivided coarse cell (fine polygons can have more
 * than 3 corners, each fan-triangulated) — generous headroom, backstopped by a runtime
 * truncate-with-warning in `rebuildDetailMesh()` if a pathological graph ever exceeds it. */
const DETAIL_VERTS_PER_SUBCELL = 30;

type CameraPreset = 'top' | 'angled' | 'free';

interface IDetailMeshData {
  directions: Float32Array;
  elevations: Float32Array;
  cellIds: Int32Array;
}

interface IMeshUserData {
  directions: Float32Array;
  elevations: Float32Array;
  cellIds: Int32Array;
}

interface ICellIndexRange {
  start: number;
  count: number;
}

/** Golden-angle hash color per cell id, written directly into `target` via HSL — same technique
 * `cell-planet-lab-page`'s own `chunkColor()` uses, just keyed by the *owning* coarse cell id of
 * each fine sub-cell instead of a chunk id, and set directly rather than through
 * `Color.setStyle('hsl(...)')` (string template + regex parse per vertex was measurably expensive
 * across a whole planet's worth of vertices). This is the whole debug overlay: it's what makes a
 * jagged mutual boundary (many small alternating-colored fine cells crossing what used to be one
 * hard edge) or a straight LOD-tier boundary (a clean color split with no fine cells on the far
 * side) visible at a glance. */
function setCellHashColor(target: Color, cellId: number): void {
  const hue = ((cellId * 137.508 + 47) % 360) / 360;
  target.setHSL(hue, 0.7, 0.55);
}

function setsEqual(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

/**
 * POC for `buildSubdividedRegionMeshData()` (runbook TODO): a distance-based LOD boundary lab
 * to visually confirm the "Option B, no skirts" behavior this session designed — two mutually
 * in-range subdivided cells get an organic jagged shared boundary, a subdivided cell against an
 * out-of-range neighbor stays a plain straight edge with no crack, at any `elevationScale`.
 * Deliberately trimmed down from `cell-planet-lab`'s full pipeline (no ecology/rivers/biomes/
 * features — irrelevant to testing this one claim): just a graph, elevation, and this one LOD
 * mechanism.
 *
 * Rendering is split into two meshes so a routine LOD-tier crossing (zooming, orbiting) never
 * touches the whole planet:
 * - `baseMesh`: every cell as a plain fan, built once per `regenerate()`. Cells that become
 *   "active" (subdivided) are hidden by collapsing their triangles to degenerate (zero-area) ones
 *   in the index buffer — a tiny patch touching only the changed cells' index entries, never the
 *   position/color data or the GPU buffer size.
 * - `detailMesh`: a single preallocated geometry sized generously up front; each LOD change
 *   overwrites the first N vertices and calls `setDrawRange(0, N)` — no `BufferGeometry`
 *   creation/disposal, no GPU buffer reallocation, ever, after `regenerate()`.
 */
@Component({
  selector: 'app-cell-subdivision-lod-lab-page',
  imports: [RouterLink, EngineModule, RaycastOrbitControlsComponent],
  templateUrl: './cell-subdivision-lod-lab-page.component.html',
  styleUrl: './cell-subdivision-lod-lab-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class CellSubdivisionLodLabPageComponent implements AfterViewInit {
  private readonly engine = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);

  // Generation inputs
  readonly cellCount = signal(400);
  readonly seed = signal(42);
  readonly relax = signal(2);
  readonly jitter = signal(15);
  readonly plateCount = signal(8);

  // Subdivision params (forwarded to buildSubdividedRegionMeshData)
  readonly subCellCount = signal(9);
  readonly relaxIterations = signal(2);

  // LOD / rendering
  /** Camera distance threshold, in planet radii, within which a cell subdivides. */
  readonly lodDistance = signal(1.6);
  /** 0 = flat "2D map" look, >0 reveals mountains — same mesh/data either way, see class doc.
   * Same default/range as `cell-planet-lab-page`'s own proven `elevationScale` (2, capped at 15)
   * — this lab's raw `elevation[]` values are the same tectonics output, so the same scale
   * applies; anything much higher turns normal terrain into self-intersecting spikes. */
  readonly elevationScale = signal(2);
  readonly colorMode = signal<'owner' | 'elevation'>('owner');
  readonly showWireframe = signal(false);

  // Stats
  readonly activeCellCount = signal(0);
  readonly triangleCount = signal(0);
  readonly rebuildMs = signal('—');
  readonly buildMs = signal('—');
  readonly cameraPreset = signal<CameraPreset>('angled');
  readonly cameraPosition = signal<Vector3Tuple>([0, PLANET_RADIUS_M * 1.1, PLANET_RADIUS_M * 2.2]);
  readonly cameraTarget = signal<Vector3Tuple>([0, 0, 0]);

  private readonly root = new Group();
  private readonly previewMaterial = new MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    side: DoubleSide,
  });

  /** Every cell as a plain fan, built once per `regenerate()`. Active cells are hidden via
   * degenerate indices, not by touching vertex data — see class doc. */
  private baseMesh: Mesh | null = null;
  private baseCellRanges = new Map<number, ICellIndexRange>();
  private baseVertexCount = 0;

  /** Preallocated once per `regenerate()`; each LOD change overwrites the first N vertices and
   * adjusts the draw range — see class doc. */
  private detailMesh: Mesh | null = null;
  private detailMaxVertices = 0;

  private graph: IPlanetGraphCore | null = null;
  private tectonics: IPlanetTectonics | null = null;
  private lastActiveIds = new Set<number>();
  /** Skips `#updateLod()`'s O(cellCount) distance scan unless the camera has actually moved a
   * meaningful fraction of the current `lodDistance()` threshold since the last check — same
   * "don't recompute every idle tick" discipline `cell-planet-lab-page`'s own
   * `updateColliderPatch()` uses for its per-tick follow logic. */
  private lastCameraCheckPos: [number, number, number] | null = null;

  constructor() {
    this.engine.scene.background = new Color('#0a0d12');
    this.root.name = 'cell-subdivision-lod-lab-root';
    // Preview mesh vertices are unit-sphere directions (radius ~1 + elevation); scale the whole
    // root up to real-world units so it's actually visible next to a camera positioned in meters
    // (mirrors `cell-planet-lab-page`'s constructor `this.root.scale.setScalar(radiusM)`).
    this.root.scale.setScalar(PLANET_RADIUS_M);
    this.engine.scene.add(this.root);

    this.engine.tick$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.updateLod());

    this.destroyRef.onDestroy(() => {
      this.disposeMeshes();
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

  onLodDistance(event: Event): void {
    this.lodDistance.set(Number((event.target as HTMLInputElement).value));
    this.lastCameraCheckPos = null; // force a re-check next tick, threshold itself just moved
  }

  onElevationScale(event: Event): void {
    this.elevationScale.set(Number((event.target as HTMLInputElement).value));
    this.updateDisplacementAll();
  }

  onSubCellCount(event: Event): void {
    this.subCellCount.set(Number((event.target as HTMLInputElement).value));
    this.rebuildDetailMesh();
  }

  onRelaxIterations(event: Event): void {
    this.relaxIterations.set(Number((event.target as HTMLInputElement).value));
    this.rebuildDetailMesh();
  }

  setColorMode(mode: 'owner' | 'elevation'): void {
    this.colorMode.set(mode);
    this.updateColorsAll();
  }

  toggleWireframe(): void {
    this.showWireframe.update((v) => !v);
  }

  /** Top-down: straight overhead, reads like a flat 2D map (pairs naturally with
   * `elevationScale` at/near 0). Angled: oblique Civ-style strategy-game framing. Free: parks
   * the camera at a comfortable default and leaves it to `raycastOrbitControls`. */
  setCameraPreset(preset: CameraPreset): void {
    this.cameraPreset.set(preset);
    const r = PLANET_RADIUS_M;
    if (preset === 'top') {
      this.cameraPosition.set([0, r * 2.4, 0.001]);
    } else if (preset === 'angled') {
      this.cameraPosition.set([0, r * 1.1, r * 2.2]);
    } else {
      this.cameraPosition.set([r * 1.6, r * 1.2, r * 1.6]);
    }
    this.cameraTarget.set([0, 0, 0]);
  }

  private regenerate(): void {
    const t0 = performance.now();
    const graph = buildPlanetGraphCore({
      cellCount: this.cellCount(),
      seed: this.seed(),
      relaxationIterations: this.relax(),
      jitter: this.jitter() / 100,
    });
    this.graph = graph;
    this.tectonics = buildPlanetTectonics(graph, {
      plateCount: this.plateCount(),
      seed: this.seed(),
    });
    this.buildMs.set(`${(performance.now() - t0).toFixed(1)} ms`);

    this.disposeMeshes();
    this.buildBaseMesh(graph, this.tectonics.elevation);
    this.allocateDetailMesh();
    if (this.baseMesh) {
      this.applyDisplacement(this.baseMesh);
      this.applyColors(this.baseMesh);
    }
    this.triangleCount.set(this.baseVertexCount / 3);

    this.lastActiveIds = new Set<number>();
    this.lastCameraCheckPos = null;
    this.updateLod(true);
  }

  private disposeMeshes(): void {
    if (this.baseMesh) {
      this.root.remove(this.baseMesh);
      this.baseMesh.geometry.dispose();
      this.baseMesh = null;
    }
    if (this.detailMesh) {
      this.root.remove(this.detailMesh);
      this.detailMesh.geometry.dispose();
      this.detailMesh = null;
    }
    this.baseCellRanges = new Map();
    this.baseVertexCount = 0;
    this.detailMaxVertices = 0;
  }

  /** Builds the whole-planet plain-fan mesh once. Every cell's fan is one contiguous run of
   * vertices in the output (`buildChunkMeshData` loops `for cellId of chunk.cellIds`, pushing all
   * of that cell's vertices before moving to the next) — scanning the actual output for those
   * runs (rather than recomputing counts from cell shape) is what lets `#setBaseCellsHidden()`
   * safely collapse exactly one cell's triangles later. */
  private buildBaseMesh(graph: IPlanetGraphCore, elevation: number[]): void {
    const allIds = graph.cells.map((c) => c.id);
    const data = buildChunkMeshData(graph, elevation, {
      id: -1,
      cellIds: allIds,
      center: { x: 0, y: 0, z: 0 },
      boundingRadius: Math.PI,
    });
    const vertexCount = data.elevations.length;

    const ranges = new Map<number, ICellIndexRange>();
    let runStart = 0;
    for (let i = 1; i <= vertexCount; i++) {
      if (i === vertexCount || data.cellIds[i] !== data.cellIds[runStart]) {
        ranges.set(data.cellIds[runStart], { start: runStart, count: i - runStart });
        runStart = i;
      }
    }
    this.baseCellRanges = ranges;
    this.baseVertexCount = vertexCount;

    const index = new Uint32Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) index[i] = i;

    const geometry = new BufferGeometry();
    const positionAttr = new BufferAttribute(new Float32Array(vertexCount * 3), 3);
    positionAttr.setUsage(DynamicDrawUsage);
    geometry.setAttribute('position', positionAttr);
    const colorAttr = new BufferAttribute(new Float32Array(vertexCount * 3), 3);
    colorAttr.setUsage(DynamicDrawUsage);
    geometry.setAttribute('color', colorAttr);
    const indexAttr = new BufferAttribute(index, 1);
    indexAttr.setUsage(DynamicDrawUsage);
    geometry.setIndex(indexAttr);

    const mesh = new Mesh(geometry, this.previewMaterial);
    mesh.name = 'cell-subdivision-lod-base';
    mesh.userData = {
      directions: data.directions,
      elevations: data.elevations,
      cellIds: data.cellIds,
    } satisfies IMeshUserData;
    this.root.add(mesh);
    this.baseMesh = mesh;
  }

  private allocateDetailMesh(): void {
    const maxVertices = Math.min(
      1_500_000,
      Math.max(20_000, this.cellCount() * SUB_CELL_COUNT_MAX * DETAIL_VERTS_PER_SUBCELL),
    );
    const geometry = new BufferGeometry();
    const positionAttr = new BufferAttribute(new Float32Array(maxVertices * 3), 3);
    positionAttr.setUsage(DynamicDrawUsage);
    geometry.setAttribute('position', positionAttr);
    const colorAttr = new BufferAttribute(new Float32Array(maxVertices * 3), 3);
    colorAttr.setUsage(DynamicDrawUsage);
    geometry.setAttribute('color', colorAttr);
    geometry.setDrawRange(0, 0);

    const mesh = new Mesh(geometry, this.previewMaterial);
    mesh.name = 'cell-subdivision-lod-detail';
    mesh.userData = {
      directions: new Float32Array(0),
      elevations: new Float32Array(0),
      cellIds: new Int32Array(0),
    } satisfies IMeshUserData;
    this.root.add(mesh);
    this.detailMesh = mesh;
    this.detailMaxVertices = maxVertices;
  }

  /** Recomputes which cells are within LOD range of the camera and, only when that *set* actually
   * changes, patches the base mesh's index buffer for exactly the cells that flipped and rebuilds
   * the (small, preallocated) detail mesh. No debounce/throttle: every real change renders
   * immediately, on the same frame, during continuous zoom or rotation alike — what makes this
   * cheap is that a routine LOD-tier crossing no longer touches the whole planet's vertex/color
   * data or reallocates any GPU buffer, so there's nothing expensive left to coalesce. */
  private updateLod(force = false): void {
    if (!this.graph || !this.tectonics || !this.baseMesh || !this.detailMesh) return;
    const camera = this.engine.camera$.value;
    if (!camera) return;

    if (!force && this.lastCameraCheckPos) {
      const [px, py, pz] = this.lastCameraCheckPos;
      const moved = Math.hypot(camera.position.x - px, camera.position.y - py, camera.position.z - pz);
      const threshold = this.lodDistance() * PLANET_RADIUS_M;
      if (moved < threshold * 0.05) return;
    }
    this.lastCameraCheckPos = [camera.position.x, camera.position.y, camera.position.z];

    // Hysteresis: a cell already active only drops out past 1.15x the enter threshold. Without
    // this, orbiting/zooming near the threshold flickers individual cells in and out every few
    // frames, each flip triggering its own detail-mesh rebuild — this, not the mesh-wide rebuild
    // cost, is what made rotation feel bad even after the base/detail split.
    const enterThresholdSq = (this.lodDistance() * PLANET_RADIUS_M) ** 2;
    const exitThresholdSq = (this.lodDistance() * 1.15 * PLANET_RADIUS_M) ** 2;
    const active = new Set<number>();
    for (const cell of this.graph.cells) {
      const dx = camera.position.x - cell.center.x * PLANET_RADIUS_M;
      const dy = camera.position.y - cell.center.y * PLANET_RADIUS_M;
      const dz = camera.position.z - cell.center.z * PLANET_RADIUS_M;
      const distSq = dx * dx + dy * dy + dz * dz;
      const wasActive = this.lastActiveIds.has(cell.id);
      if (distSq <= (wasActive ? exitThresholdSq : enterThresholdSq)) active.add(cell.id);
    }

    if (!force && setsEqual(active, this.lastActiveIds)) return;

    const newlyActive: number[] = [];
    const newlyInactive: number[] = [];
    for (const id of active) if (!this.lastActiveIds.has(id)) newlyActive.push(id);
    for (const id of this.lastActiveIds) if (!active.has(id)) newlyInactive.push(id);
    this.lastActiveIds = active;

    this.setBaseCellsHidden(newlyActive, true);
    this.setBaseCellsHidden(newlyInactive, false);
    this.rebuildDetailMesh();
  }

  /** Hides/shows cells in the base mesh by collapsing (or restoring) their index entries — only
   * the listed cells' index range is touched, never position/color data, so this costs O(changed
   * cells' vertex count), not O(planet). */
  private setBaseCellsHidden(cellIds: readonly number[], hidden: boolean): void {
    if (cellIds.length === 0 || !this.baseMesh?.geometry.index) return;
    const arr = this.baseMesh.geometry.index.array as Uint32Array;
    for (const cellId of cellIds) {
      const range = this.baseCellRanges.get(cellId);
      if (!range) continue;
      for (let i = range.start; i < range.start + range.count; i++) {
        arr[i] = hidden ? 0 : i;
      }
    }
    this.baseMesh.geometry.index.needsUpdate = true;
  }

  /** Groups the active set into connected regions (BFS over `cell.neighbors`, same "grow within a
   * scoped set" shape as `chunking.ts`'s own `growConnectedGroups()`, kept local here since that
   * one is file-private) and calls `buildSubdividedRegionMeshData()` once per region — this is
   * what makes two adjacent in-range cells share one joint Voronoi diagram instead of each
   * getting its own independent one. */
  private buildDetailMeshData(
    graph: IPlanetGraphCore,
    elevation: number[],
    activeIds: ReadonlySet<number>,
  ): IDetailMeshData {
    const directions: number[] = [];
    const elevations: number[] = [];
    const cellIds: number[] = [];
    const pushVertex = (p: { x: number; y: number; z: number }, e: number, cellId: number): void => {
      directions.push(p.x, p.y, p.z);
      elevations.push(e);
      cellIds.push(cellId);
    };

    const visited = new Set<number>();
    for (const seed of activeIds) {
      if (visited.has(seed)) continue;
      const group: number[] = [seed];
      visited.add(seed);
      let frontier = [seed];
      while (frontier.length > 0) {
        const next: number[] = [];
        for (const id of frontier) {
          for (const neighborId of graph.cells[id].neighbors) {
            if (!activeIds.has(neighborId) || visited.has(neighborId)) continue;
            visited.add(neighborId);
            group.push(neighborId);
            next.push(neighborId);
          }
        }
        frontier = next;
      }
      buildSubdividedRegionMeshData(graph, elevation, group, pushVertex, {
        subCellCount: this.subCellCount(),
        relaxIterations: this.relaxIterations(),
        seed: this.seed(),
      });
    }

    return {
      directions: new Float32Array(directions),
      elevations: new Float32Array(elevations),
      cellIds: new Int32Array(cellIds),
    };
  }

  private rebuildDetailMesh(): void {
    if (!this.graph || !this.tectonics || !this.detailMesh) return;
    const t0 = performance.now();
    const data = this.buildDetailMeshData(this.graph, this.tectonics.elevation, this.lastActiveIds);
    this.rebuildMs.set(`${(performance.now() - t0).toFixed(2)} ms`);
    this.activeCellCount.set(this.lastActiveIds.size);

    let vertexCount = data.elevations.length;
    if (vertexCount > this.detailMaxVertices) {
      console.warn(
        `[cell-subdivision-lod-lab] detail mesh vertex count ${vertexCount} exceeds preallocated cap ${this.detailMaxVertices}; truncating. Lower cell count / sub-cells per cell, or raise DETAIL_VERTS_PER_SUBCELL.`,
      );
      vertexCount = Math.floor(this.detailMaxVertices / 3) * 3;
    }

    const directions = data.directions.subarray(0, vertexCount * 3);
    const elevations = data.elevations.subarray(0, vertexCount);
    const cellIds = data.cellIds.subarray(0, vertexCount);
    this.detailMesh.userData = { directions, elevations, cellIds } satisfies IMeshUserData;
    this.detailMesh.geometry.setDrawRange(0, vertexCount);
    this.triangleCount.set((this.baseVertexCount + vertexCount) / 3);

    this.applyDisplacement(this.detailMesh);
    this.applyColors(this.detailMesh);
  }

  private updateDisplacementAll(): void {
    if (this.baseMesh) this.applyDisplacement(this.baseMesh);
    if (this.detailMesh) this.applyDisplacement(this.detailMesh);
  }

  private updateColorsAll(): void {
    if (this.baseMesh) this.applyColors(this.baseMesh);
    if (this.detailMesh) this.applyColors(this.detailMesh);
  }

  private applyDisplacement(mesh: Mesh): void {
    const { directions, elevations } = mesh.userData as IMeshUserData;
    const scale = this.elevationScale() / 100;
    const positionAttr = mesh.geometry.getAttribute('position') as BufferAttribute;
    const positions = positionAttr.array as Float32Array;
    for (let i = 0; i < elevations.length; i++) {
      const radius = 1 + elevations[i] * scale;
      const o = i * 3;
      positions[o] = directions[o] * radius;
      positions[o + 1] = directions[o + 1] * radius;
      positions[o + 2] = directions[o + 2] * radius;
    }
    positionAttr.needsUpdate = true;
    // No computeVertexNormals(): the material is flatShading:true, and three.js's flat-shaded
    // path derives normals from screen-space position derivatives in the shader — it never reads
    // the normal attribute, so recomputing it here was pure wasted work on every rebuild.
  }

  private applyColors(mesh: Mesh): void {
    const { elevations, cellIds } = mesh.userData as IMeshUserData;
    const colorAttr = mesh.geometry.getAttribute('color') as BufferAttribute;
    const arr = colorAttr.array as Float32Array;
    const scratch = new Color();
    const mode = this.colorMode();
    const [elevMin, elevMax] = this.elevationRange();

    for (let i = 0; i < cellIds.length; i++) {
      if (mode === 'owner') {
        setCellHashColor(scratch, cellIds[i]);
      } else {
        const t = elevMax > elevMin ? (elevations[i] - elevMin) / (elevMax - elevMin) : 0.5;
        scratch.setHSL(0.33 - t * 0.33, 0.55, 0.25 + t * 0.45);
      }
      const o = i * 3;
      arr[o] = scratch.r;
      arr[o + 1] = scratch.g;
      arr[o + 2] = scratch.b;
    }
    colorAttr.needsUpdate = true;
  }

  /** Global min/max across the whole planet's raw elevation, so both meshes' "by elevation" color
   * mode share one consistent scale — cheap (one pass over `cellCount` raw values, not per
   * vertex) and independent of `elevationScale` (color reflects the underlying value, not the
   * current radial exaggeration). */
  private elevationRange(): [number, number] {
    if (!this.tectonics) return [0, 1];
    let min = Infinity;
    let max = -Infinity;
    for (const e of this.tectonics.elevation) {
      if (e < min) min = e;
      if (e > max) max = e;
    }
    return [min, max];
  }
}
