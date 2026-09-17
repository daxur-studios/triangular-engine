import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  effect,
  input,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
  SphereGeometry,
  Vector3,
  Vector3Tuple,
} from 'three';
import {
  EngineService,
  GroupComponent,
  provideObject3DComponent,
  RaycastFocusContext,
  RaycastFocusResolver,
} from 'triangular-engine';
import {
  buildChunkLod1MeshData,
  buildChunkMeshData,
  buildPlanetChunks,
  buildPlanetEcology,
  buildPlanetGraphCore,
  buildPlanetTectonics,
  classifyCellBorders,
  computeCellPins,
  computeEdgeSagitta,
  extractCellBorders,
  IPlanetChunk,
  IPlanetEcology,
  IPlanetGraphCore,
  IPlanetTectonics,
  IVec3,
  sampleElevation,
} from 'triangular-engine/worldgen';
import {
  biomeColor,
  BIOME_COLORS,
  elevationColor,
  moistureColor,
  plateColor,
  temperatureColor,
} from '../color-ramps';

export type PlanetRenderMode =
  | 'elevation'
  | 'plates'
  | 'biome'
  | 'temperature'
  | 'moisture'
  | 'land';

/** dot(chunkCenter, viewDirection)-derived angular cutoff for whole-chunk horizon culling —
 * see `#updateLod()`. Mirrors `cell-planet-lab-page.component.ts`'s own constant; kept as a
 * separate copy here rather than a shared import since it's a single derived number, not
 * logic worth centralizing. */
const CULL_THRESHOLD = -0.02;
const HORIZON_ANGLE = Math.acos(CULL_THRESHOLD);

/** Per-chunk-mesh cache stashed on `Mesh.userData` — undisplaced unit direction + raw
 * elevation + owning cell id per vertex, kept so the elevation-scale input can re-displace a
 * chunk's positions in O(itsVertices) without resampling. See `worldgen`'s `chunking.ts`. */
interface IChunkMeshUserData {
  directions: Float32Array;
  elevations: Float32Array;
  cellIds: Int32Array;
  chunkId: number;
  lod: 0 | 1;
}

/**
 * Reusable Voronoi cell-graph planet renderer (runbook 022/024). Generates a graph +
 * tectonics + ecology from the generation inputs below and renders it as a chunked,
 * 2-level-LOD mesh with an optional ocean shell and river/coastline overlays — the actual
 * rendering half of what was previously only available inline inside `/cell-planet-lab`.
 *
 * Ported from that page's `regenerate()`/`rebuildPreviewMesh()`/`updateChunkLod()`/
 * `ensureOceanShell()`/`updatePreviewColors()`/`rebuildRiverOverlays()` (see
 * `docs/runbook/022_v4_voronoi_cell_planets.md`) — same structure and tuning, restated as
 * `input()`/`effect()`-driven state instead of page-local signals, following
 * `CdlodPlanetComponent`'s (`terrain/cdlod`) shape.
 *
 * Deliberately excludes the lab's debug-only features (raw site/edge point clouds, 2D map
 * canvas, chunk-boundary/pin-highlight debug coloring, the M4d collider-patch overlay) — a
 * consumer that wants a collider patch can call `buildColliderPatch()` from
 * `triangular-engine/worldgen` directly against this component's own `graph`/`tectonics`.
 */
@Component({
  standalone: true,
  selector: 'planetView',
  imports: [],
  template: '<ng-content></ng-content>',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [provideObject3DComponent(PlanetViewComponent)],
})
export class PlanetViewComponent extends GroupComponent implements OnDestroy {
  // ==========================================================================
  // Generation inputs
  // ==========================================================================
  readonly cellCount = input(1500);
  readonly seed = input(42);
  readonly relaxationIterations = input(2);
  /** Real 0..1 fraction (unlike the lab page's 0-100 slider value, which divides by 100
   * before calling into `worldgen`). */
  readonly jitter = input(0.15);
  readonly plateCount = input(10);

  // ==========================================================================
  // Rendering inputs
  // ==========================================================================
  /** Real fraction, matching `worldgen`'s `radius = 1 + elevation * scale` convention. */
  readonly elevationScale = input(0.02);
  readonly renderMode = input<PlanetRenderMode>('elevation');
  readonly showOcean = input(true);
  readonly showRivers = input(false);
  readonly showRidges = input(false);
  readonly showCoastlines = input(false);
  readonly showCellBorders = input(false);
  readonly showTerritoryBorders = input(false);
  readonly cellBorderColor = input('#ffffff');
  readonly territoryBorderColor = input('#ffd166');
  /** Silhouette-preserving LOD1 pins (`computeCellPins()`) — a mesh-quality knob, not a debug
   * toggle; off reproduces the pre-pinning LOD1 merge exactly. */
  readonly usePinning = input(true);
  /** Camera distance (world units, planet radius ~1) below which a chunk shows LOD0 (full
   * per-cell) instead of LOD1 (merged cells). */
  readonly lodNearDistance = input(2);
  /** Pauses the per-frame LOD/horizon-cull pass at its current state. */
  readonly frozen = input(false);
  readonly useSurfaceUp = input(false);

  // ==========================================================================
  // Public readonly-in-spirit state
  // ==========================================================================
  readonly graph = signal<IPlanetGraphCore | null>(null);
  readonly tectonics = signal<IPlanetTectonics | null>(null);
  readonly ecology = signal<IPlanetEcology | null>(null);
  readonly buildMs = signal<number | null>(null);
  readonly upVector = signal<Vector3Tuple>([0, 1, 0]);

  /** `raycastOrbitControls` focus resolver — hits the preview chunk meshes so wheel-zoom and
   * rotate-drag pivot on the actual displaced surface, not a flat guess. Wire to a consumer's
   * own `<orbitControls [raycastFocusResolver]>`. */
  readonly raycastFocusResolver: RaycastFocusResolver = (
    context: RaycastFocusContext,
  ) => {
    if (!this.previewGroup.visible) return null;
    const hit = context.raycaster.intersectObjects(this.previewMeshes, false)[0];
    return hit ? hit.point.toArray() : null;
  };

  // ==========================================================================
  // Three.js resources
  // ==========================================================================
  private readonly previewGroup = new Group();
  private readonly previewMaterial = new MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    side: DoubleSide,
  });
  private previewMeshes: Mesh[] = [];
  private chunkLodMeshes: Mesh[][] = [];
  private chunks: IPlanetChunk[] = [];
  private chunkIdByCell: number[] = [];
  private pinnedCells: Uint8Array = new Uint8Array(0);
  private readonly chunkTargetSize = 100;

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

  private readonly riverMaterial = new LineBasicMaterial({
    color: '#5ec8ff',
    transparent: true,
    opacity: 0.95,
  });
  private readonly coastlineMaterial = new LineBasicMaterial({
    color: '#f4f4f4',
    transparent: true,
    opacity: 0.9,
  });
  private readonly ridgeMaterial = new LineBasicMaterial({
    color: '#8b573e',
    transparent: true,
    opacity: 0.95,
  });
  private riverLines: LineSegments | null = null;
  private ridgeLines: LineSegments | null = null;
  private coastlineLines: LineSegments | null = null;
  private riverDirections = new Float32Array(0);
  private riverElevations = new Float32Array(0);
  private ridgeDirections = new Float32Array(0);
  private ridgeElevations = new Float32Array(0);
  private coastlineDirections = new Float32Array(0);

  private readonly cellBorderMaterial = new LineBasicMaterial({
    color: '#ffffff',
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1.0,
    polygonOffsetUnits: -4.0,
  });
  private readonly territoryBorderMaterial = new LineBasicMaterial({
    color: '#ffd166',
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1.0,
    polygonOffsetUnits: -4.0,
  });
  private cellBorderLines: LineSegments | null = null;
  private territoryBorderLines: LineSegments | null = null;
  private cellBorderDirections = new Float32Array(0);
  private cellBorderElevations = new Float32Array(0);
  private territoryBorderDirections = new Float32Array(0);
  private territoryBorderElevations = new Float32Array(0);

  /** Camera position expressed in this planet's unit-sphere coordinate system. Reused every
   * frame so translated/scaled consumers (for example BSP's body-fixed surface frame) do not
   * allocate while updating LOD. */
  private readonly localCameraPosition = new Vector3();

  constructor() {
    super();
    (this.object3D() as Group).add(this.previewGroup);

    effect(() => {
      this.cellCount();
      this.seed();
      this.relaxationIterations();
      this.jitter();
      this.plateCount();
      untracked(() => {
        this.#regenerate();
      });
    });

    // usePinning affects LOD1 geometry, not just color, so it needs a mesh rebuild — but only
    // when it changes, not on every regenerate() (which already rebuilds with the current
    // value). untracked() keeps graph()/tectonics() reads from becoming extra dependencies.
    effect(() => {
      this.usePinning();
      untracked(() => {
        if (this.graph() && this.tectonics()) this.#rebuildPreviewMesh();
      });
    });

    effect(() => {
      this.elevationScale();
      this.#applyDisplacement();
      this.#applyRiverDisplacement();
      this.#applyBorderDisplacement();
    });

    effect(() => {
      this.renderMode();
      this.#updateColors();
    });

    effect(() => {
      const visible = this.showOcean();
      if (this.oceanMesh) this.oceanMesh.visible = visible;
    });
    effect(() => {
      const visible = this.showRivers();
      if (this.riverLines) this.riverLines.visible = visible;
    });
    effect(() => {
      const visible = this.showRidges();
      if (this.ridgeLines) this.ridgeLines.visible = visible;
    });
    effect(() => {
      const visible = this.showCoastlines();
      if (this.coastlineLines) this.coastlineLines.visible = visible;
    });
    effect(() => {
      const visible = this.showCellBorders();
      if (this.cellBorderLines) this.cellBorderLines.visible = visible;
    });
    effect(() => {
      const visible = this.showTerritoryBorders();
      if (this.territoryBorderLines) this.territoryBorderLines.visible = visible;
    });
    effect(() => {
      this.cellBorderColor();
      this.cellBorderMaterial.color.set(this.cellBorderColor());
    });
    effect(() => {
      this.territoryBorderColor();
      this.territoryBorderMaterial.color.set(this.territoryBorderColor());
    });

    this.engineService.tick$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (!this.frozen()) this.#updateLod();
        if (this.useSurfaceUp()) this.#updateSurfaceUp();
      });
  }

  override ngOnDestroy(): void {
    for (const mesh of this.previewMeshes) mesh.geometry.dispose();
    this.oceanMesh?.geometry.dispose();
    this.riverLines?.geometry.dispose();
    this.ridgeLines?.geometry.dispose();
    this.coastlineLines?.geometry.dispose();
    this.cellBorderLines?.geometry.dispose();
    this.territoryBorderLines?.geometry.dispose();
    this.previewMaterial.dispose();
    this.oceanMaterial.dispose();
    this.riverMaterial.dispose();
    this.ridgeMaterial.dispose();
    this.coastlineMaterial.dispose();
    this.cellBorderMaterial.dispose();
    this.territoryBorderMaterial.dispose();
    super.ngOnDestroy();
  }

  #regenerate(): void {
    const t0 = performance.now();
    const graph = buildPlanetGraphCore({
      cellCount: this.cellCount(),
      seed: this.seed(),
      relaxationIterations: this.relaxationIterations(),
      jitter: this.jitter(),
    });
    const tectonics = buildPlanetTectonics(graph, {
      plateCount: this.plateCount(),
      seed: this.seed(),
    });
    const ecology = buildPlanetEcology(graph, tectonics);

    this.graph.set(graph);
    this.tectonics.set(tectonics);
    this.ecology.set(ecology);
    this.buildMs.set(performance.now() - t0);

    this.#rebuildPreviewMesh();
    this.#rebuildRiverOverlays();
    this.#rebuildBorderOverlays();
  }

  #rebuildPreviewMesh(): void {
    const graph = this.graph();
    const tectonics = this.tectonics();
    if (!graph || !tectonics) return;

    for (const mesh of this.previewMeshes) {
      this.previewGroup.remove(mesh);
      mesh.geometry.dispose();
    }
    this.previewMeshes = [];
    this.chunkLodMeshes = [];

    const { chunks, chunkIdByCell } = buildPlanetChunks(graph, {
      targetChunkSize: this.chunkTargetSize,
    });
    this.chunks = chunks;
    this.chunkIdByCell = chunkIdByCell;
    const pinned = this.usePinning()
      ? computeCellPins(graph, tectonics.elevation, tectonics.isLand, chunks).pinned
      : undefined;
    this.pinnedCells = pinned ?? new Uint8Array(graph.cells.length);

    const buildMesh = (
      data: { directions: Float32Array; elevations: Float32Array; cellIds: Int32Array },
      chunk: IPlanetChunk,
      lod: 0 | 1,
    ): Mesh => {
      const geometry = new BufferGeometry();
      const positionAttr = new BufferAttribute(new Float32Array(data.directions.length), 3);
      positionAttr.setUsage(DynamicDrawUsage);
      geometry.setAttribute('position', positionAttr);
      geometry.setAttribute('color', new BufferAttribute(new Float32Array(data.directions.length), 3));
      const mesh = new Mesh(geometry, this.previewMaterial);
      mesh.name = `planet-view-chunk-${chunk.id}-lod${lod}`;
      mesh.userData = {
        directions: data.directions,
        elevations: data.elevations,
        cellIds: data.cellIds,
        chunkId: chunk.id,
        lod,
      } satisfies IChunkMeshUserData;
      this.previewGroup.add(mesh);
      this.previewMeshes.push(mesh);
      return mesh;
    };

    for (const chunk of chunks) {
      const lod0 = buildMesh(buildChunkMeshData(graph, tectonics.elevation, chunk), chunk, 0);
      const lod1 = buildMesh(
        buildChunkLod1MeshData(graph, tectonics.elevation, chunkIdByCell, chunk, {
          pinned,
          isLand: tectonics.isLand,
        }),
        chunk,
        1,
      );
      this.chunkLodMeshes[chunk.id] = [lod0, lod1];
    }

    this.currentSeaLevelElevation = tectonics.seaLevelElevation;
    this.#ensureOceanShell();
    this.#applyDisplacement();
    this.#updateColors();
    this.#updateLod();
  }

  /** Per-frame near/far LOD0-vs-LOD1 swap plus whole-chunk horizon culling — see
   * `cell-planet-lab-page.component.ts`'s `updateChunkLod()` doc comment for the full
   * rationale (chunk-angular-size-aware horizon test, why this differs from a flat per-point
   * dot-product cull). */
  #updateLod(): void {
    if (this.chunks.length === 0) return;
    const camera = this.engineService.camera;
    if (!camera) return;
    const threshold = this.lodNearDistance();

    const cameraPosition = this.#cameraPositionInPlanetSpace(camera);
    const camLen = cameraPosition.length() || 1;
    const vx = cameraPosition.x / camLen;
    const vy = cameraPosition.y / camLen;
    const vz = cameraPosition.z / camLen;

    for (const chunk of this.chunks) {
      const pair = this.chunkLodMeshes[chunk.id];
      if (!pair) continue;
      const [lod0, lod1] = pair;

      const dot = chunk.center.x * vx + chunk.center.y * vy + chunk.center.z * vz;
      const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
      if (angle - chunk.boundingRadius > HORIZON_ANGLE) {
        lod0.visible = false;
        lod1.visible = false;
        continue;
      }

      const dx = cameraPosition.x - chunk.center.x;
      const dy = cameraPosition.y - chunk.center.y;
      const dz = cameraPosition.z - chunk.center.z;
      const near = Math.hypot(dx, dy, dz) <= threshold;
      lod0.visible = near;
      lod1.visible = !near;
    }
  }

  /** Flat sea-level shell layered over the terrain mesh — see the lab's `ensureOceanShell()`
   * doc comment for why a separate shell instead of clamping terrain geometry. */
  #ensureOceanShell(): void {
    if (!this.oceanMesh) {
      const geometry = new SphereGeometry(1, 96, 48);
      this.oceanMesh = new Mesh(geometry, this.oceanMaterial);
      this.object3D().add(this.oceanMesh);
    }
    this.oceanMesh.visible = this.showOcean();
  }

  #applyDisplacement(): void {
    const scale = this.elevationScale();
    for (const mesh of this.previewMeshes) {
      const { directions, elevations } = mesh.userData as IChunkMeshUserData;
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
      mesh.geometry.computeVertexNormals();
    }
    if (this.oceanMesh) {
      this.oceanMesh.scale.setScalar(1 + this.currentSeaLevelElevation * scale);
    }
  }

  #updateColors(): void {
    const tectonics = this.tectonics();
    if (!tectonics) return;
    const scratch = new Color();
    const mode = this.renderMode();
    const elevMin = Math.min(...tectonics.elevation);
    const elevMax = Math.max(...tectonics.elevation);
    for (const mesh of this.previewMeshes) {
      const { elevations, cellIds } = mesh.userData as IChunkMeshUserData;
      const colorAttr = mesh.geometry.getAttribute('color') as BufferAttribute;
      const arr = colorAttr.array as Float32Array;
      for (let i = 0; i < cellIds.length; i++) {
        scratch.setStyle(
          this.#resolveVertexColor(cellIds[i], elevations[i], mode, tectonics, elevMin, elevMax),
        );
        const o = i * 3;
        arr[o] = scratch.r;
        arr[o + 1] = scratch.g;
        arr[o + 2] = scratch.b;
      }
      colorAttr.needsUpdate = true;
    }
  }

  #resolveVertexColor(
    cellId: number,
    vertexElevation: number,
    mode: PlanetRenderMode,
    tectonics: IPlanetTectonics,
    elevMin: number,
    elevMax: number,
  ): string {
    if (mode === 'plates') return plateColor(tectonics.plateIdByCell[cellId]);
    if (mode === 'elevation') {
      return elevationColor(vertexElevation, tectonics.seaLevelElevation, elevMin, elevMax);
    }

    const land = vertexElevation >= tectonics.seaLevelElevation;
    const ecology = this.ecology();
    if (ecology) {
      if (mode === 'temperature') return temperatureColor(ecology.temperature[cellId]);
      if (mode === 'moisture') return moistureColor(ecology.moisture[cellId]);
      if (mode === 'biome') {
        if (!land) {
          return ecology.biome[cellId] === 'lake' ? BIOME_COLORS['lake'] : BIOME_COLORS['ocean'];
        }
        const biome = ecology.biome[cellId];
        return biome === 'ocean' || biome === 'lake' ? 'hsl(95, 45%, 45%)' : biomeColor(biome);
      }
    }
    return land ? 'hsl(100, 40%, 38%)' : 'hsl(210, 60%, 22%)';
  }

  #rebuildRiverOverlays(): void {
    const ecology = this.ecology();
    const tectonics = this.tectonics();
    if (!ecology || !tectonics) return;

    if (this.riverLines) {
      this.object3D().remove(this.riverLines);
      this.riverLines.geometry.dispose();
    }
    this.riverDirections = this.#flattenPathDirections(ecology.riverPaths, false);
    this.riverElevations = this.#sampleElevationsFor(this.riverDirections);
    const riverGeometry = new BufferGeometry();
    riverGeometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(this.riverDirections.length), 3),
    );
    this.riverLines = new LineSegments(riverGeometry, this.riverMaterial);
    this.riverLines.visible = this.showRivers();
    this.object3D().add(this.riverLines);

    if (this.ridgeLines) {
      this.object3D().remove(this.ridgeLines);
      this.ridgeLines.geometry.dispose();
    }
    this.ridgeDirections = this.#flattenPathDirections(ecology.ridgePaths, false);
    this.ridgeElevations = this.#sampleElevationsFor(this.ridgeDirections);
    const ridgeGeometry = new BufferGeometry();
    ridgeGeometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(this.ridgeDirections.length), 3),
    );
    this.ridgeLines = new LineSegments(ridgeGeometry, this.ridgeMaterial);
    this.ridgeLines.visible = this.showRidges();
    this.object3D().add(this.ridgeLines);

    if (this.coastlineLines) {
      this.object3D().remove(this.coastlineLines);
      this.coastlineLines.geometry.dispose();
    }
    this.coastlineDirections = this.#computeMeshWaterlineDirections();
    const coastGeometry = new BufferGeometry();
    coastGeometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(this.coastlineDirections.length), 3),
    );
    this.coastlineLines = new LineSegments(coastGeometry, this.coastlineMaterial);
    this.coastlineLines.visible = this.showCoastlines();
    this.object3D().add(this.coastlineLines);

    this.#applyRiverDisplacement();
  }

  #applyRiverDisplacement(): void {
    const scale = this.elevationScale();
    const bias = 1.0015;

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

    if (this.ridgeLines) {
      const attr = this.ridgeLines.geometry.getAttribute('position') as BufferAttribute;
      const positions = attr.array as Float32Array;
      for (let i = 0; i < this.ridgeElevations.length; i++) {
        const radius = (1 + this.ridgeElevations[i] * scale) * bias;
        const o = i * 3;
        positions[o] = this.ridgeDirections[o] * radius;
        positions[o + 1] = this.ridgeDirections[o + 1] * radius;
        positions[o + 2] = this.ridgeDirections[o + 2] * radius;
      }
      attr.needsUpdate = true;
    }

    const tectonics = this.tectonics();
    if (this.coastlineLines && tectonics) {
      const radius = (1 + tectonics.seaLevelElevation * scale) * bias;
      const attr = this.coastlineLines.geometry.getAttribute('position') as BufferAttribute;
      const positions = attr.array as Float32Array;
      for (let i = 0; i < this.coastlineDirections.length; i++) {
        positions[i] = this.coastlineDirections[i] * radius;
      }
      attr.needsUpdate = true;
    }
  }

  #rebuildBorderOverlays(): void {
    const graph = this.graph();
    const tectonics = this.tectonics();
    if (!graph || !tectonics) return;

    if (this.cellBorderLines) {
      this.object3D().remove(this.cellBorderLines);
      this.cellBorderLines.geometry.dispose();
      this.cellBorderLines = null;
    }
    if (this.territoryBorderLines) {
      this.object3D().remove(this.territoryBorderLines);
      this.territoryBorderLines.geometry.dispose();
      this.territoryBorderLines = null;
    }

    const allEdges = extractCellBorders(graph);
    const { territoryEdges } = classifyCellBorders(allEdges, tectonics.plateIdByCell);

    // Cell borders
    const borderDirs: number[] = [];
    const borderElevs: number[] = [];
    for (const edge of allEdges) {
      const eA = tectonics.elevation[edge.cellA] ?? 0;
      const eB = tectonics.elevation[edge.cellB] ?? 0;
      borderDirs.push(edge.a.x, edge.a.y, edge.a.z, edge.b.x, edge.b.y, edge.b.z);
      borderElevs.push(eA, eB);
    }
    this.cellBorderDirections = new Float32Array(borderDirs);
    this.cellBorderElevations = new Float32Array(borderElevs);

    const borderGeo = new BufferGeometry();
    borderGeo.setAttribute('position', new BufferAttribute(new Float32Array(this.cellBorderDirections.length), 3));
    this.cellBorderMaterial.color.set(this.cellBorderColor());
    this.cellBorderLines = new LineSegments(borderGeo, this.cellBorderMaterial);
    this.cellBorderLines.name = 'cell-borders';
    this.cellBorderLines.renderOrder = 3;
    this.cellBorderLines.visible = this.showCellBorders();
    this.object3D().add(this.cellBorderLines);

    // Territory borders
    const terrDirs: number[] = [];
    const terrElevs: number[] = [];
    for (const edge of territoryEdges) {
      const eA = tectonics.elevation[edge.cellA] ?? 0;
      const eB = tectonics.elevation[edge.cellB] ?? 0;
      terrDirs.push(edge.a.x, edge.a.y, edge.a.z, edge.b.x, edge.b.y, edge.b.z);
      terrElevs.push(eA, eB);
    }
    this.territoryBorderDirections = new Float32Array(terrDirs);
    this.territoryBorderElevations = new Float32Array(terrElevs);

    const terrGeo = new BufferGeometry();
    terrGeo.setAttribute('position', new BufferAttribute(new Float32Array(this.territoryBorderDirections.length), 3));
    this.territoryBorderMaterial.color.set(this.territoryBorderColor());
    this.territoryBorderLines = new LineSegments(terrGeo, this.territoryBorderMaterial);
    this.territoryBorderLines.name = 'territory-borders';
    this.territoryBorderLines.renderOrder = 4;
    this.territoryBorderLines.visible = this.showTerritoryBorders();
    this.object3D().add(this.territoryBorderLines);

    this.#applyBorderDisplacement();
  }

  #applyBorderDisplacement(): void {
    const scale = this.elevationScale();
    const minClearance = 0.003;

    if (this.cellBorderLines) {
      const attr = this.cellBorderLines.geometry.getAttribute('position') as BufferAttribute;
      const positions = attr.array as Float32Array;
      for (let i = 0; i < this.cellBorderElevations.length; i += 2) {
        const oA = i * 3;
        const oB = (i + 1) * 3;
        const ax = this.cellBorderDirections[oA];
        const ay = this.cellBorderDirections[oA + 1];
        const az = this.cellBorderDirections[oA + 2];
        const bx = this.cellBorderDirections[oB];
        const by = this.cellBorderDirections[oB + 1];
        const bz = this.cellBorderDirections[oB + 2];

        const sagitta = computeEdgeSagitta({ x: ax, y: ay, z: az }, { x: bx, y: by, z: bz }, 1.0);
        const clearance = minClearance + sagitta;

        const rA = 1 + this.cellBorderElevations[i] * scale + clearance;
        const rB = 1 + this.cellBorderElevations[i + 1] * scale + clearance;

        positions[oA] = ax * rA;
        positions[oA + 1] = ay * rA;
        positions[oA + 2] = az * rA;
        positions[oB] = bx * rB;
        positions[oB + 1] = by * rB;
        positions[oB + 2] = bz * rB;
      }
      attr.needsUpdate = true;
    }

    if (this.territoryBorderLines) {
      const attr = this.territoryBorderLines.geometry.getAttribute('position') as BufferAttribute;
      const positions = attr.array as Float32Array;
      for (let i = 0; i < this.territoryBorderElevations.length; i += 2) {
        const oA = i * 3;
        const oB = (i + 1) * 3;
        const ax = this.territoryBorderDirections[oA];
        const ay = this.territoryBorderDirections[oA + 1];
        const az = this.territoryBorderDirections[oA + 2];
        const bx = this.territoryBorderDirections[oB];
        const by = this.territoryBorderDirections[oB + 1];
        const bz = this.territoryBorderDirections[oB + 2];

        const sagitta = computeEdgeSagitta({ x: ax, y: ay, z: az }, { x: bx, y: by, z: bz }, 1.0);
        const clearance = minClearance * 1.5 + sagitta;

        const rA = 1 + this.territoryBorderElevations[i] * scale + clearance;
        const rB = 1 + this.territoryBorderElevations[i + 1] * scale + clearance;

        positions[oA] = ax * rA;
        positions[oA + 1] = ay * rA;
        positions[oA + 2] = az * rA;
        positions[oB] = bx * rB;
        positions[oB + 1] = by * rB;
        positions[oB + 2] = bz * rB;
      }
      attr.needsUpdate = true;
    }
  }

  /** Extracts the land/water boundary from the LOD0 preview triangles themselves — see the
   * lab's `computeMeshWaterlineDirections()` doc comment for why LOD0 only (LOD1's merged
   * polygons would make the line redraw itself as chunks swap LOD under camera movement). */
  #computeMeshWaterlineDirections(): Float32Array<ArrayBuffer> {
    const tectonics = this.tectonics();
    const out: number[] = [];
    if (!tectonics) return new Float32Array(out);
    const seaLevel = tectonics.seaLevelElevation;

    for (const mesh of this.previewMeshes) {
      const userData = mesh.userData as IChunkMeshUserData;
      if (userData.lod !== 0) continue;
      const { directions: dirs, elevations: elevs } = userData;

      const crossing = (a: number, b: number): [number, number, number] | null => {
        const ea = elevs[a];
        const eb = elevs[b];
        if (ea === eb || ea >= seaLevel === eb >= seaLevel) return null;
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
    }
    return new Float32Array(out);
  }

  #flattenPathDirections(paths: IVec3[][], closed: boolean): Float32Array<ArrayBuffer> {
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

  #sampleElevationsFor(directions: Float32Array): Float32Array<ArrayBuffer> {
    const graph = this.graph();
    const tectonics = this.tectonics();
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

  #updateSurfaceUp(): void {
    const camera = this.engineService.camera;
    if (!camera) return;
    const cameraPosition = this.#cameraPositionInPlanetSpace(camera);
    const len = cameraPosition.length() || 1;
    this.upVector.set([
      cameraPosition.x / len,
      cameraPosition.y / len,
      cameraPosition.z / len,
    ]);
  }

  /** Converts the camera's world position through the planet root's inverse world transform.
   * Planet meshes are authored around a unit sphere, so all horizon/LOD math must happen in
   * that same space rather than assuming the planet is unscaled at the scene origin. */
  #cameraPositionInPlanetSpace(camera: {
    getWorldPosition(target: Vector3): Vector3;
  }): Vector3 {
    const root = this.object3D();
    camera.getWorldPosition(this.localCameraPosition);
    root.updateWorldMatrix(true, false);
    return root.worldToLocal(this.localCameraPosition);
  }
}
