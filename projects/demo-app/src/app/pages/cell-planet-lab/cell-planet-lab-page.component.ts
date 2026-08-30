import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
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
  MeshBasicMaterial,
  MeshStandardMaterial,
  Points,
  PointsMaterial,
  Raycaster,
  SphereGeometry,
  Vector2,
  Vector3Tuple,
} from 'three';
import {
  EngineModule,
  EngineService,
  RaycastFocusContext,
  RaycastFocusResolver,
} from 'triangular-engine';
import {
  affectedCellIds,
  affectedChunkIds,
  buildChunkLod1MeshData,
  buildChunkMeshData,
  buildColliderPatch,
  buildEffectiveElevation,
  buildFeatureElevation,
  buildPlanetChunks,
  buildPlanetEcology,
  buildPlanetGraphCore,
  buildPlanetTectonics,
  cellsWithinHops,
  colliderPatchIndices,
  computeCellPins,
  computeFeatures,
  cross,
  digCells,
  findCellAt,
  flattenCells,
  getEffectiveElevation,
  IColliderPatch,
  IPlanetChunk,
  IPlanetEcology,
  IPlanetFeatures,
  IPlanetGraphCore,
  IPlanetTectonics,
  ITerrainEditLayer,
  IVec3,
  normalize,
  sampleElevation,
  WORLD_PROFILES,
  WorldProfileKind,
} from 'triangular-engine/worldgen';
import {
  biomeColor,
  BIOME_COLORS,
  createLavaFlowMaterial,
  createWaterFlowMaterial,
  elevationColor,
  featureColor,
  FEATURE_COLORS,
  formatDistanceM,
  lavaOceanColor,
  moistureColor,
  plateColor,
  temperatureColor,
  WORLD_SIZE_TIER_RADIUS_M,
  WorldSizeTier,
} from 'triangular-engine/worldgen/render';

/** dot(siteDirection, viewDirection) cutoff for the near-side cull — a small negative
 * margin past the exact horizon so boundary edges don't clip mid-line at the terminator. */
const CULL_THRESHOLD = -0.02;

/** Angular form of `CULL_THRESHOLD` (~91.1°) — used for whole-chunk horizon culling, where the
 * test needs to subtract the chunk's own angular size before comparing, which a plain dot
 * product against a fixed threshold can't do (see `updateChunkLod()`). */
const HORIZON_ANGLE = Math.acos(CULL_THRESHOLD);

export type MapMode =
  | 'graph'
  | 'plates'
  | 'elevation'
  | 'land'
  | 'temperature'
  | 'moisture'
  | 'biome'
  | 'feature'
  | 'rivers';

/** Per-chunk-mesh cache stashed on `Mesh.userData` (M4b) — undisplaced unit direction + raw
 * elevation + owning cell id per vertex, parallel arrays, kept around so the elevation-scale
 * slider can re-displace one chunk's positions in O(itsVertices) without recomputing
 * per-cell/corner elevation or touching the color attribute. Mirrors the single flat arrays
 * the M3/M4a whole-planet mesh used, just scoped per chunk now. */
interface IChunkMeshUserData {
  directions: Float32Array;
  elevations: Float32Array;
  cellIds: Int32Array;
  /** Which `IPlanetChunk` this mesh renders — index into `this.chunks`, shared by both of a
   * chunk's LOD meshes (see `updateChunkLod()`). */
  chunkId: number;
  /** 0 = full per-cell resolution (`buildChunkMeshData()`), 1 = merged-cell LOD
   * (`buildChunkLod1MeshData()`) — see `rebuildPreviewMesh()`'s M4c doc comment. */
  lod: 0 | 1;
}

/** Same golden-angle trick as `worldgen/render`'s `plateColor()`, distinct hue offset so
 * chunk-debug colors don't visually alias plate colors when both are toggled at different
 * times. One flat color per chunk mesh — see `updatePreviewColors()`'s `showChunkColors`
 * branch. Debug-only (not a real rendering concern), so it stays local to this lab page. */
function chunkColor(chunkId: number): string {
  const hue = (chunkId * 137.508 + 47) % 360;
  return `hsl(${hue.toFixed(1)}, 70%, 55%)`;
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
  private readonly mapCanvas =
    viewChild<ElementRef<HTMLCanvasElement>>('mapCanvas');

  readonly cellCount = signal(180);
  readonly seed = signal(42);
  readonly relax = signal(2);
  readonly jitter = signal(15);
  /** See `world-size-tiers.ts`'s doc comment. Changing this never touches the graph (still a
   * unit-sphere direction/elevation dataset) — it drives `root`'s own scale transform (see the
   * constructor's rescale `effect()`) plus the camera framing, so the *rendered* planet and
   * every real-world label (`avgCellSizeLabel`, `lastEditFootprintLabel`) genuinely change
   * together, not just the labels. */
  readonly worldSizeTier = signal<WorldSizeTier>('medium');
  readonly planetRadiusM = computed(() => WORLD_SIZE_TIER_RADIUS_M[this.worldSizeTier()]);
  /** World-profile spike (see `world-profile.ts` and runbook 022): picks a named bundle of
   * tectonics/climate/biome overrides plus the new per-cell feature pass and ocean substance —
   * `'terran'` is an intentional no-op that reproduces default generation exactly. */
  readonly worldProfileKind = signal<WorldProfileKind>('terran');
  readonly worldProfile = computed(() => WORLD_PROFILES[this.worldProfileKind()]);
  /** `root`'s camera framing distance, scaled with `planetRadiusM()` so switching tiers keeps
   * the whole sphere in view instead of parking the camera inside it (large tiers) or leaving
   * it absurdly far away (small tiers). `2.6` matches the previous fixed unit-sphere framing. */
  readonly cameraPosition = computed<Vector3Tuple>(() => [
    0,
    0,
    2.6 * this.planetRadiusM(),
  ]);
  /** Average angular spacing between neighboring cell centers, set once per `regenerate()` —
   * the graph-shape half of "how big is a cell," independent of `worldSizeTier()`. */
  private readonly avgCellAngleRad = signal(0);
  /** `avgCellAngleRad() * planetRadiusM()` in human units — reactive to both the graph
   * (cell count/seed/etc.) and the size tier, so switching tiers alone updates this without
   * regenerating. Answers "how big is one cell, right now, at the size I've picked". */
  readonly avgCellSizeLabel = computed(() =>
    formatDistanceM(this.avgCellAngleRad() * this.planetRadiusM()),
  );
  /** Set by `applyTerrainEdit()` to the actual angular extent of the last edit's brush,
   * converted through the current `planetRadiusM()` — the direct answer to "how big a real
   * area did that flatten/dig just cover". */
  readonly lastEditFootprintLabel = signal('—');
  readonly showSites = signal(true);
  readonly showEdges = signal(true);
  readonly showPreview3D = signal(false);
  readonly showOceanShell = signal(true);
  /** Debug overlay: flat hash color per chunk mesh instead of biome/elevation color, so chunk
   * boundaries (M4b) are visible at a glance. Free to toggle — reuses the same per-chunk color
   * attribute and mesh split that already exist for rendering, just changes what gets written
   * into it (see `updatePreviewColors()`), no extra geometry or draw calls. */
  readonly showChunkColors = signal(false);
  /** Debug A/B toggle for `computeCellPins()` (see `rebuildPreviewMesh()`'s M4c doc comment) —
   * on by default (the shipped behavior), off reproduces the pre-pinning LOD1 exactly (same
   * code path as passing `pinned: undefined`) so a feature's pop can be compared side by side
   * instead of taken on faith. Rebuilds the whole preview mesh on toggle (`togglePinning()`),
   * same cost as changing any other generation param — infrequent, user-triggered, fine to be
   * heavier than a per-frame op. */
  readonly usePinning = signal(true);
  readonly pinnedCellCount = signal(0);
  /** Recolors every pinned cell (see `usePinning`) a fixed bright magenta, overriding whatever
   * map mode is active — answers "is the specific mountain/island I'm watching even in the
   * pinned set" directly instead of inferring it from an A/B toggle, which only tells you
   * *something* changed somewhere, not *what*. Free to toggle: just re-touches the existing
   * color attribute (`updatePreviewColors()`), no geometry rebuild. */
  readonly highlightPins = signal(false);
  /** `<scene>`'s built-in `[wireframe]` override (see `SceneComponent`) — swaps every mesh's
   * material for a shared wireframe one scene-wide, restored on toggle-off. Handy alongside
   * `highlightPins` for checking a pinned cell's actual triangle layout (fan vs boundary-loop)
   * rather than just its color. */
  readonly showWireframe = signal(false);
  /** Freezes `updateChunkLod()` (both the near/far LOD split and the horizon cull below) at
   * its current state so the camera can keep orbiting while the visible/culled set stays
   * fixed — lets you park on one side, freeze, then rotate to the far side and confirm culled
   * chunks are the ones actually missing, instead of the cull re-evaluating out from under
   * you every frame as the camera moves. */
  readonly freezeCulling = signal(false);
  readonly chunkCulledCount = signal(0);
  /** M4c: camera distance, in planet radii (multiplied by `planetRadiusM()` at the one
   * comparison site in `updateChunkLod()`) beyond which a chunk switches from LOD0 (full
   * per-cell) to LOD1 (merged cells). Exposed as a slider since the right value depends on
   * `elevationScale`/camera-range settings that themselves vary in this lab; no single default
   * is "correct". */
  readonly lodDistance = signal(2);
  readonly lodSplit = signal('—');
  /** M4d: a small high-res patch built from `buildColliderPatch()` — sampled directly from
   * `sampleElevation()` at whatever `colliderPatchSampleCount()`/`colliderPatchAngularDeg()` ask
   * for, independent of the visual chunk mesh's own resolution and current LOD tier at that
   * spot (see `updateColliderPatch()`). It's a rendering proof, not a physics one yet — no Jolt
   * body — but it demonstrates the actual claim runbook 022 M4d cares about: the patch stays
   * uniformly fine-grained under the camera's look-at point even where the underlying chunk has
   * dropped to LOD1's merged-cell polygons, or where the chunk boundary itself would otherwise
   * show up as a resolution seam. */
  readonly showColliderPatch = signal(false);
  readonly colliderPatchSampleCount = signal(17);
  readonly colliderPatchAngularDeg = signal(6);
  readonly colliderPatchBuildMs = signal('—');
  /** M4d's actual Jolt/ball-drop physics proof moved out to the dedicated
   * `/planet-physics-lab` (real-scale Jolt RVec3 positions) — this page keeps only the
   * rendering-only collider-patch debug overlay above. See runbook 022 M4d's follow-up note. */
  /** M4e: sparse player-edit override layer (`cellId -> absolute elevation`) on top of the
   * graph's own generated elevation — see `terrainEdits.ts`. Kept as a plain field, not a
   * signal: it's mutated in place by `applyTerrainEdit()` and read only from inside this
   * component's own mesh-rebuild methods, never bound directly in the template. Cleared on
   * every `regenerate()` since it's keyed by cell ids from a specific graph. */
  private terrainEdits: ITerrainEditLayer = new Map();
  readonly editMode = signal<'off' | 'flatten' | 'dig'>('off');
  /** Brush radius in graph hops (`cellsWithinHops()`) — 0 edits just the clicked cell. */
  readonly editBrushHops = signal(1);
  /** Dig depth per click (unitless, same scale as `elevation[]`); flatten ignores this and
   * instead levels the brush to the clicked cell's own pre-edit elevation. */
  readonly editDigDelta = signal(-0.15);
  readonly editedCellCount = signal(0);
  /** "chunks touched by the last edit / total chunks" — the actual M4e claim made visible:
   * an edit's rebuild cost stays a small fraction of the planet, not the whole thing. */
  readonly lastEditChunksRebuilt = signal('—');
  readonly plateCount = signal(10);
  readonly mapMode = signal<MapMode>('graph');
  /** Swatch list for whichever 2D mode is currently categorical (fixed named colors, not a
   * continuous gradient) — 'biome'/'feature' have one, 'plates' doesn't (per-plate hash color,
   * unbounded count), and the gradient modes (elevation/temperature/moisture/land) don't either. */
  readonly legendEntries = computed<{ label: string; color: string }[]>(() => {
    const mode = this.mapMode();
    if (mode === 'biome') {
      return Object.entries(BIOME_COLORS).map(([key, color]) => ({
        label: key.replace(/_/g, ' '),
        color,
      }));
    }
    if (mode === 'feature') {
      return Object.entries(FEATURE_COLORS).map(([key, color]) => ({
        label: key.replace(/_/g, ' '),
        color,
      }));
    }
    return [];
  });
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
  readonly chunkTotal = signal(0);
  /** Per-feature-type instance counts from the world-profile spike's `computeFeatures()` —
   * set by `updateFeatureStats()`, same "plain signal, set imperatively" pattern as the other
   * stats above. `lavaLakeCount` counts cells, not instances (a lava lake has no shape stamp
   * of its own — see `features.ts`), the rest count `IFeatureInstance`s. */
  readonly featureCounts = signal('—');

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
  // M4b: one Mesh (draw call) per chunk instead of one mesh for the whole planet — see
  // rebuildPreviewMesh() doc comment. `previewGroup` is the single object added to `root`;
  // chunk meshes are its children so toggling visibility/raycasting stays a one-line op
  // instead of looping `previewMeshes` at every call site.
  private readonly previewGroup = new Group();
  private previewMeshes: Mesh[] = [];
  /** Parallel to `chunks` — `chunkLodMeshes[chunkId]` is that chunk's `[lod0Mesh, lod1Mesh]`
   * pair, looked up every tick by `updateChunkLod()` to flip `.visible` without touching
   * `previewMeshes` (which stays the flat list every other call site loops). */
  private chunkLodMeshes: Mesh[][] = [];
  private chunks: IPlanetChunk[] = [];
  private chunkIdByCell: number[] = [];
  /** Cached from the last `rebuildPreviewMesh()`'s `computeCellPins()` call so
   * `updatePreviewColors()`'s `highlightPins` overlay can read it without recomputing —
   * empty (all-zero-effective) whenever `usePinning()` is off. */
  private pinnedCells: Uint8Array = new Uint8Array(0);
  /** Soft target cells/chunk — see `buildPlanetChunks()`'s `targetChunkSize` doc comment.
   * Not yet exposed as a UI control; the draw-call/LOD-granularity tradeoff isn't tuned. */
  private readonly chunkTargetSize = 100;
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
  // World-profile spike: river paths render as real flowing ribbons (worldgen/render's
  // flow-path.ts, relocated from the river-lab POC) instead of a flat debug line — one Mesh
  // per `ecology.riverPaths` entry, rebuilt whole on regenerate()/elevationScale() change
  // rather than incrementally repositioned (path counts are small, a few dozen at most, so
  // this is cheap relative to a chunk rebuild). All rivers use the lava material together when
  // `worldProfile().oceanSubstance === 'lava'` (every river drains into the molten "ocean" by
  // construction — see world-profile.ts's `protoplanet` preset and features.ts's doc comment
  // on why this is a different mechanism from a local volcano-adjacent lava lake), otherwise
  // all rivers use the water material.
  private readonly waterFlowMaterial = createWaterFlowMaterial();
  private readonly lavaFlowMaterial = createLavaFlowMaterial();
  private flowTime = 0;
  private riverRibbons: Mesh[] = [];
  private readonly coastlineMaterial = new LineBasicMaterial({
    color: '#f4f4f4',
    transparent: true,
    opacity: 0.9,
  });
  private coastlineLines: LineSegments | null = null;
  // Unit directions for the coastline overlay (which rides the constant sea-level radius) —
  // cached so onElevationScale() can reposition it cheaply without re-sampling elevation on
  // every slider tick.
  private coastlineDirections = new Float32Array(0);

  // Per-cell source data driving the near-side cull, rebuilt on regenerate() and
  // re-filtered every frame against the live camera position (updateCulling()).
  private siteDirs = new Float32Array(0);
  private siteScratch = new Float32Array(0);
  private cellSegments: Float32Array[] = [];
  private edgeScratch = new Float32Array(0);

  // M4d collider-patch debug overlay — see showColliderPatch. colliderPatchRaw is the last
  // buildColliderPatch() result (undisplaced directions + raw elevations), kept around so
  // applyColliderPatchDisplacement() can re-scale positions on an elevationScale change without
  // resampling, the same discipline updatePreviewDisplacement()/updateRiverOverlayDisplacement()
  // already follow for the main terrain/rivers.
  private readonly colliderPatchMaterial = new MeshBasicMaterial({
    color: '#ff2fb0',
    wireframe: true,
    depthTest: true,
  });
  private colliderPatchMesh: Mesh | null = null;
  private colliderPatchRaw: IColliderPatch | null = null;
  private lastColliderPatchCenter: IVec3 | null = null;
  private readonly colliderPatchRaycaster = new Raycaster();
  private readonly colliderPatchNdcCenter = new Vector2(0, 0);

  constructor() {
    this.engine.scene.background = new Color('#0a0d12');
    this.root.name = 'cell-planet-graph';
    this.engine.scene.add(this.root);
    this.previewGroup.name = 'cell-planet-preview-chunks';
    this.root.add(this.previewGroup);

    // Makes the world-size tier picker actually rescale the render instead of only feeding
    // labels (`avgCellSizeLabel`/`lastEditFootprintLabel`) — `root` parents every visible piece
    // (previewGroup, ocean, sites/edges, river/coastline overlays, the collider-patch debug
    // mesh), so one scale transform here rescales all of them together. `sitesMaterial.size` is
    // a world-unit point size (`sizeAttenuation: true`), so it needs the same factor or the
    // graph-overlay points would shrink to invisible specks once `root` scales up to real
    // planet-radius magnitudes.
    effect(() => {
      const radiusM = this.planetRadiusM();
      this.root.scale.setScalar(radiusM);
      this.sitesMaterial.size = 0.022 * radiusM;
    });

    this.engine.tick$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((dt) => {
        this.updateCulling();
        this.updateSurfaceUp();
        this.updateChunkLod();
        this.updateColliderPatch();
        this.flowTime += dt;
        this.waterFlowMaterial.uniforms['time'].value = this.flowTime;
        this.lavaFlowMaterial.uniforms['time'].value = this.flowTime;
      });

    this.destroyRef.onDestroy(() => {
      this.engine.scene.remove(this.root);
      this.sitesPoints?.geometry.dispose();
      this.edgesLines?.geometry.dispose();
      for (const mesh of this.previewMeshes) mesh.geometry.dispose();
      this.oceanMesh?.geometry.dispose();
      for (const mesh of this.riverRibbons) mesh.geometry.dispose();
      this.coastlineLines?.geometry.dispose();
      this.colliderPatchMesh?.geometry.dispose();
      this.sitesMaterial.dispose();
      this.edgesMaterial.dispose();
      this.previewMaterial.dispose();
      this.oceanMaterial.dispose();
      this.waterFlowMaterial.dispose();
      this.lavaFlowMaterial.dispose();
      this.coastlineMaterial.dispose();
      this.colliderPatchMaterial.dispose();
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
    if (this.ecology) this.rebuildRiverRibbons(this.ecology);
    this.updateRiverOverlayDisplacement();
    this.applyColliderPatchDisplacement();
  }

  toggleColliderPatch(): void {
    this.showColliderPatch.update((visible) => !visible);
    if (this.showColliderPatch()) return;
    if (this.colliderPatchMesh) {
      this.root.remove(this.colliderPatchMesh);
      this.colliderPatchMesh.geometry.dispose();
      this.colliderPatchMesh = null;
    }
    this.colliderPatchRaw = null;
    this.lastColliderPatchCenter = null;
    this.colliderPatchBuildMs.set('—');
  }

  onColliderPatchSampleCount(event: Event): void {
    this.colliderPatchSampleCount.set(
      Number((event.target as HTMLInputElement).value),
    );
    this.lastColliderPatchCenter = null; // force a resample next tick, not just a redisplacement
  }

  onColliderPatchAngularWidth(event: Event): void {
    this.colliderPatchAngularDeg.set(
      Number((event.target as HTMLInputElement).value),
    );
    this.lastColliderPatchCenter = null;
  }

  setMapMode(mode: MapMode): void {
    this.mapMode.set(mode);
    this.drawMap();
    this.updatePreviewColors();
    for (const mesh of this.riverRibbons) mesh.visible = mode === 'rivers';
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
    this.previewGroup.visible = this.showPreview3D();
    if (this.oceanMesh)
      this.oceanMesh.visible = this.showPreview3D() && this.showOceanShell();
  }

  toggleOceanShell(): void {
    this.showOceanShell.update((value) => !value);
    if (this.oceanMesh)
      this.oceanMesh.visible = this.showPreview3D() && this.showOceanShell();
  }

  toggleChunkColors(): void {
    this.showChunkColors.update((value) => !value);
    this.updatePreviewColors();
  }

  togglePinning(): void {
    this.usePinning.update((value) => !value);
    if (this.graph && this.tectonics) this.rebuildPreviewMesh(this.graph, this.tectonics);
  }

  toggleHighlightPins(): void {
    this.highlightPins.update((value) => !value);
    this.updatePreviewColors();
  }

  toggleWireframe(): void {
    this.showWireframe.update((value) => !value);
  }

  toggleFreezeCulling(): void {
    this.freezeCulling.update((value) => !value);
  }

  onLodDistance(event: Event): void {
    this.lodDistance.set(Number((event.target as HTMLInputElement).value));
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
    this.upVectorTuple.set([
      camera.position.x / len,
      camera.position.y / len,
      camera.position.z / len,
    ]);
  }

  /** `raycastOrbitControls` focus resolver — hits the preview chunk meshes so wheel-zoom and
   * rotate-drag pivot on the actual displaced surface under the pointer instead of a
   * flat distance-scaled guess, which is what let zooming clip through/overshoot terrain.
   * Raycasts `previewMeshes` (two children per chunk since M4c's LOD0/LOD1 pair, see
   * rebuildPreviewMesh()) rather than a single mesh — Three's raycaster already skips
   * invisible objects, so this transparently hits whichever LOD `updateChunkLod()` currently
   * has showing. */
  readonly raycastFocusResolver: RaycastFocusResolver = (
    context: RaycastFocusContext,
  ) => {
    if (!this.previewGroup.visible) return null;
    const hit = context.raycaster.intersectObjects(
      this.previewMeshes,
      false,
    )[0];
    return hit ? hit.point.toArray() : null;
  };

  /** M4d debug overlay driver, run every tick while `showColliderPatch()` is on. Raycasts
   * straight out from the camera (NDC center — whatever the camera is currently looking at,
   * the same "where would a vessel be" stand-in `raycastFocusResolver` above uses for orbit
   * pivoting) against the live `previewMeshes`, so the probe point tracks the same displaced
   * surface the visual mesh is showing regardless of which chunk/LOD is under it. Only
   * resamples (`rebuildColliderPatch()`) once the probe has actually moved a meaningful
   * fraction of the patch's own size — re-sampling on every single tick even though it's cheap
   * (~3-5ms at the lab's default sizes, see runbook 022 M4d) would still churn a BufferGeometry
   * allocation every frame for no visible benefit while the camera is idle. */
  private updateColliderPatch(): void {
    if (!this.showColliderPatch() || !this.graph || !this.tectonics) return;
    const direction = this.raycastPlanetDirection();
    if (!direction) return;

    const angularHalfWidth = (this.colliderPatchAngularDeg() * Math.PI) / 180;
    if (this.lastColliderPatchCenter) {
      const cosAngle =
        direction.x * this.lastColliderPatchCenter.x +
        direction.y * this.lastColliderPatchCenter.y +
        direction.z * this.lastColliderPatchCenter.z;
      // Rebuild once the probe has drifted ~1/4 of the patch's own angular half-width — frequent
      // enough that following the camera reads as live, not so frequent that idling burns a
      // rebuild every tick.
      if (cosAngle > Math.cos(angularHalfWidth * 0.25)) return;
    }

    this.lastColliderPatchCenter = direction;
    this.rebuildColliderPatch(direction);
  }

  /** Samples a fresh `IColliderPatch` at `direction` via `buildColliderPatch()` — density and
   * extent controlled by `colliderPatchSampleCount()`/`colliderPatchAngularDeg()`, entirely
   * independent of `cellCount`, the current chunk's LOD tier, or chunk boundaries, which is the
   * whole point of M4d's camera/physics decoupling claim (runbook 022 Layer 2/3). Rendered as a
   * plain wireframe mesh so it visibly reads as "a separate high-res patch sitting on top of
   * whatever the chunk mesh underneath is doing" rather than blending into it. */
  private rebuildColliderPatch(direction: IVec3): void {
    if (!this.graph || !this.tectonics) return;
    const t0 = performance.now();
    const sampleCount = this.colliderPatchSampleCount();
    const angularHalfWidth = (this.colliderPatchAngularDeg() * Math.PI) / 180;
    const patch = buildColliderPatch(this.graph, this.featureElevation, direction, {
      angularHalfWidth,
      sampleCount,
    });
    const indices = colliderPatchIndices(patch);
    this.colliderPatchBuildMs.set(`${(performance.now() - t0).toFixed(2)} ms`);
    this.colliderPatchRaw = patch;

    if (this.colliderPatchMesh) {
      this.root.remove(this.colliderPatchMesh);
      this.colliderPatchMesh.geometry.dispose();
      this.colliderPatchMesh = null;
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(patch.sampleCount * patch.sampleCount * 3), 3),
    );
    geometry.setIndex(new BufferAttribute(indices, 1));
    const mesh = new Mesh(geometry, this.colliderPatchMaterial);
    mesh.name = 'collider-patch-debug';
    mesh.frustumCulled = false;
    mesh.renderOrder = 10;
    this.colliderPatchMesh = mesh;
    this.root.add(mesh);
    this.applyColliderPatchDisplacement();
  }

  /** Re-scales the cached `colliderPatchRaw` directions/elevations by the current
   * `elevationScale()` without resampling — mirrors `updatePreviewDisplacement()`'s and
   * `updateRiverOverlayDisplacement()`'s split between "resample the graph" (expensive-ish,
   * user-triggered) and "reposition already-sampled vertices" (cheap, safe on every slider
   * `input` event). */
  private applyColliderPatchDisplacement(): void {
    if (!this.colliderPatchMesh || !this.colliderPatchRaw) return;
    const scale = this.elevationScale() / 100;
    const { directions, elevations } = this.colliderPatchRaw;
    const positionAttr = this.colliderPatchMesh.geometry.getAttribute(
      'position',
    ) as BufferAttribute;
    const positions = positionAttr.array as Float32Array;
    for (let i = 0; i < elevations.length; i++) {
      const radius = 1 + elevations[i] * scale;
      const o = i * 3;
      positions[o] = directions[o] * radius;
      positions[o + 1] = directions[o + 1] * radius;
      positions[o + 2] = directions[o + 2] * radius;
    }
    positionAttr.needsUpdate = true;
    this.colliderPatchMesh.geometry.computeVertexNormals();
  }

  /** Raycasts straight out from the camera (NDC center — whatever it's currently looking at)
   * against the live `previewMeshes`, returning the hit direction normalized to the unit
   * sphere (dividing by the hit's own length cancels out `root`'s real-world scale, so this
   * stays a plain unit vector regardless of the current `worldSizeTier()`). Drives
   * `updateColliderPatch()`'s per-tick follow — same "where would a vessel be" stand-in
   * `raycastFocusResolver` uses for orbit pivoting. `/planet-physics-lab` has its own copy of
   * this same logic for its own physics-test raycasts. */
  private raycastPlanetDirection(): IVec3 | null {
    const camera = this.engine.camera$.value;
    if (!camera || this.previewMeshes.length === 0) return null;

    this.colliderPatchRaycaster.setFromCamera(this.colliderPatchNdcCenter, camera);
    const hit = this.colliderPatchRaycaster.intersectObjects(
      this.previewMeshes,
      false,
    )[0];
    if (!hit) return null;

    const len = hit.point.length() || 1;
    return {
      x: hit.point.x / len,
      y: hit.point.y / len,
      z: hit.point.z / len,
    };
  }

  jitterValue(): string {
    return (this.jitter() / 100).toFixed(2);
  }

  setWorldSizeTier(tier: WorldSizeTier): void {
    this.worldSizeTier.set(tier);
  }

  setWorldProfile(kind: WorldProfileKind): void {
    this.worldProfileKind.set(kind);
    this.regenerate();
  }

  /** Mean angle (radians) between every pair of adjacent cell centers, each edge counted once
   * — the graph-shape input to `avgCellSizeLabel()`. Purely descriptive/app-side (not a
   * `worldgen/core` concern, see `WORLD_SIZE_TIER_RADIUS_M`'s doc comment), so it lives here
   * rather than as a library export. */
  private computeAvgCellAngle(graph: IPlanetGraphCore): number {
    let totalAngle = 0;
    let edgeCount = 0;
    for (const cell of graph.cells) {
      for (const neighborId of cell.neighbors) {
        if (neighborId <= cell.id) continue; // count each edge once
        const neighbor = graph.cells[neighborId];
        const d = Math.min(
          1,
          Math.max(
            -1,
            cell.center.x * neighbor.center.x +
              cell.center.y * neighbor.center.y +
              cell.center.z * neighbor.center.z,
          ),
        );
        totalAngle += Math.acos(d);
        edgeCount++;
      }
    }
    return edgeCount > 0 ? totalAngle / edgeCount : 0;
  }

  private graph: IPlanetGraphCore | null = null;
  private tectonics: IPlanetTectonics | null = null;
  private ecology: IPlanetEcology | null = null;
  /** World-profile spike: per-cell landform typing + geological shape stamps (see
   * `features.ts`). `featureElevation` is `tectonics.elevation` with every feature instance's
   * shape composed in (`buildFeatureElevation()`) — every consumer that used to read
   * `tectonics.elevation` directly now reads this instead, the same "materialize once, hand
   * everyone the same array" pattern `buildEffectiveElevation()` already uses for M4e edits.
   * Player edits still compose on top of this, never the other way — see `rebuildPreviewMesh()`. */
  private features: IPlanetFeatures = { feature: [], instances: [], featureByCellId: new Map() };
  private featureElevation: number[] = [];

  private regenerate(): void {
    // A fresh graph means fresh cell ids — any edit layer from a previous graph is meaningless
    // against it, so M4e's override map doesn't survive a regenerate.
    this.terrainEdits = new Map();
    this.editedCellCount.set(0);
    this.lastEditChunksRebuilt.set('—');
    this.lastEditFootprintLabel.set('—');

    const t0 = performance.now();
    const graph = buildPlanetGraphCore({
      cellCount: this.cellCount(),
      seed: this.seed(),
      relaxationIterations: this.relax(),
      jitter: this.jitter() / 100,
    });
    const t1 = performance.now();

    this.graph = graph;
    this.avgCellAngleRad.set(this.computeAvgCellAngle(graph));
    const profile = this.worldProfile();
    this.tectonics = buildPlanetTectonics(graph, {
      plateCount: this.plateCount(),
      seed: this.seed(),
      ...profile.tectonics,
    });
    const land =
      this.tectonics.isLand.filter(Boolean).length /
      this.tectonics.isLand.length;
    this.landFraction.set(`${(land * 100).toFixed(0)}%`);
    this.ecology = buildPlanetEcology(graph, this.tectonics, {
      climate: profile.climate,
      biomes: profile.biomes,
    });
    this.features = computeFeatures(graph, this.tectonics, this.ecology.waterBodyKind, profile.features);
    this.featureElevation = buildFeatureElevation(this.tectonics.elevation, graph, this.features);
    this.updateFeatureStats();

    this.buildMs.set(`${(t1 - t0).toFixed(1)} ms`);
    this.rebuildSites(graph);
    this.rebuildEdges(graph);
    this.rebuildPreviewMesh(graph, this.tectonics);
    this.rebuildRiverOverlays(this.ecology);
    this.updateStats(graph);
    this.drawMap();
    this.updateCulling();
    // The graph/elevation array just got replaced — colliderPatchRaw (if any) was sampled from
    // the old one, so force updateColliderPatch() to resample against the new graph next tick
    // instead of comparing the stale center and deciding nothing moved.
    this.lastColliderPatchCenter = null;
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
    const maxVerts = this.cellSegments.reduce(
      (sum, seg) => sum + seg.length / 3,
      0,
    );
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
    if (
      !camera ||
      !this.sitesPoints ||
      !this.edgesLines ||
      this.siteDirs.length === 0
    )
      return;

    const camLen = camera.position.length() || 1;
    const vx = camera.position.x / camLen;
    const vy = camera.position.y / camLen;
    const vz = camera.position.z / camLen;

    const cellCount = this.siteDirs.length / 3;
    let visibleSites = 0;
    let edgeVerts = 0;
    for (let i = 0; i < cellCount; i++) {
      const o = i * 3;
      const dot =
        this.siteDirs[o] * vx +
        this.siteDirs[o + 1] * vy +
        this.siteDirs[o + 2] * vz;
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

    const sitesAttr = this.sitesPoints.geometry.getAttribute(
      'position',
    ) as BufferAttribute;
    (sitesAttr.array as Float32Array).set(
      this.siteScratch.subarray(0, visibleSites * 3),
    );
    sitesAttr.needsUpdate = true;
    this.sitesPoints.geometry.setDrawRange(0, visibleSites);

    const edgesAttr = this.edgesLines.geometry.getAttribute(
      'position',
    ) as BufferAttribute;
    (edgesAttr.array as Float32Array).set(
      this.edgeScratch.subarray(0, edgeVerts * 3),
    );
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

    // M4e: reads through the same effective (base + terrainEdits) elevation the 3D preview's
    // resolveVertexColor() uses, not tectonics.elevation directly — otherwise a flatten/dig
    // rebuilds the 3D mesh but leaves the 2D unwrap showing pre-edit terrain forever, since
    // this is the only other place elevation feeds into a rendered color.
    const effectiveElevation = getEffectiveElevation(
      this.featureElevation.length > 0 ? this.featureElevation : tectonics.elevation,
      this.terrainEdits,
      cellId,
    );
    const isLavaOcean =
      this.worldProfile().oceanSubstance === 'lava' && ecology?.waterBodyKind[cellId] === 'ocean';

    if (mode === 'plates') return plateColor(tectonics.plateIdByCell[cellId]);
    if (mode === 'elevation') {
      const min = Math.min(...tectonics.elevation);
      const max = Math.max(...tectonics.elevation);
      return elevationColor(
        effectiveElevation,
        tectonics.seaLevelElevation,
        min,
        max,
      );
    }
    if (mode === 'feature') {
      const feature = this.features.feature[cellId];
      if (feature !== 'none') return featureColor(feature);
      if (isLavaOcean) return lavaOceanColor();
    }
    if (ecology) {
      if (mode === 'temperature')
        return temperatureColor(ecology.temperature[cellId]);
      if (mode === 'moisture') return moistureColor(ecology.moisture[cellId]);
      if (mode === 'biome') return isLavaOcean ? lavaOceanColor() : biomeColor(ecology.biome[cellId]);
    }
    if (isLavaOcean) return lavaOceanColor();
    return effectiveElevation >= tectonics.seaLevelElevation
      ? 'hsl(100, 40%, 38%)'
      : 'hsl(210, 60%, 22%)';
  }

  /** M4b 3D preview: one chunk mesh (draw call) per ~`chunkTargetSize` cells, instead of the
   * M3/M4a single mesh for the entire planet — `buildPlanetChunks()` groups cells into
   * contiguous regions by BFS over `cell.neighbors` (cell id order carries no spatial
   * locality, see that function's doc comment), and `buildChunkMeshData()` tessellates each
   * chunk into the same triangle-fan-per-cell layout M3/M4a used (center -> corner k ->
   * corner k+1), flat-shaded and colored via `resolveVertexColor()`. Every fan vertex sits
   * exactly at a cell center or a cell-polygon corner, so its elevation is looked up
   * directly (O(1), via `buildChunkMeshData()`'s internal `cellCornerElevation()` calls)
   * instead of going through `sampleElevation()`'s general `findCellAt()` search —
   * `sampleElevation()` stays the function for arbitrary (non-vertex) queries like future
   * collider patches. No per-chunk LOD or border stitching between LOD levels yet — that's
   * M4c; every chunk here renders at full resolution regardless of camera distance.
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
   * `computeMeshWaterlineDirections()`.
   *
   * M4c: each chunk now gets two meshes, LOD0 (`buildChunkMeshData()`, full per-cell detail)
   * and LOD1 (`buildChunkLod1MeshData()`, which merges neighboring cells into single polygons
   * under a curvature-error budget — see that function's doc comment for why the merge is
   * bounded by sag rather than cell count, and why the two LODs never crack against each other
   * regardless of which one a neighboring chunk is showing). Note that at this lab's default
   * `cellCount` the budget already fits inside a single cell, so LOD1 there is just "cell
   * polygons without their fan centers" (a third fewer triangles); the merge only starts
   * paying off at the higher end of the cell-count slider, which is the intended behavior —
   * an LOD that saves more where there's more to save. On top of that, `computeCellPins()` is
   * run once per graph (not per chunk) and its result is passed to every chunk's LOD1 build as
   * `{ pinned }` — the handful of cells it marks (locally prominent peaks, coastline capes,
   * small islands) always render as their own single-cell polygon at LOD1 instead of getting
   * merged away, so those features stop popping (flattening, appearing/disappearing, or
   * shifting the shoreline) as a chunk crosses the LOD distance threshold. See that function's
   * doc comment for why it's a per-chunk budget rather than a threshold. Both are added to `previewGroup` and pushed onto the flat
   * `previewMeshes` list (so displacement/color/raycast/waterline-extraction keep working
   * unchanged, looping every mesh regardless of LOD); `chunkLodMeshes[chunk.id]` additionally
   * indexes the `[lod0, lod1]` pair so `updateChunkLod()` can flip `.visible` on exactly one
   * of the two per chunk per frame without scanning the flat list. */
  private rebuildPreviewMesh(
    graph: IPlanetGraphCore,
    tectonics: IPlanetTectonics,
  ): void {
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
    // M4c pinning: computed once here (O(cells), not per frame) rather than inside the LOD1
    // build loop below — every chunk's buildChunkLod1MeshData() call shares the same pin set,
    // and recomputing it per chunk would just repeat the same whole-graph coastline/island
    // flood-fill chunkCount times for no benefit. See computeCellPins()'s doc comment.
    // `usePinning()` off passes `undefined` through (not an all-zero array) so the "off" state
    // is bit-for-bit the same code path buildChunkLod1MeshData() already had before pinning
    // existed, not just a pin set that happens to be empty.
    const pinned = this.usePinning() ? computeCellPins(graph, tectonics.elevation, tectonics.isLand, chunks).pinned : undefined;
    this.pinnedCells = pinned ?? new Uint8Array(graph.cells.length);
    this.pinnedCellCount.set(pinned ? pinned.reduce((sum, v) => sum + v, 0) : 0);

    // M4e: mesh geometry reads elevation through this effective array (base + terrainEdits),
    // never tectonics.elevation directly — buildEffectiveElevation() returns the base array
    // itself when there are no edits, so this costs nothing on the common (unedited) path.
    // computeCellPins() above deliberately still reads the *base* elevation: prominence-based
    // pinning going stale after an edit is a minor rendering-quality edge case, not a
    // correctness bug worth complicating this method for.
    const elevation = buildEffectiveElevation(this.featureElevation, this.terrainEdits);

    for (const chunk of chunks) {
      const lod0 = this.buildChunkLodMesh(
        buildChunkMeshData(graph, elevation, chunk),
        chunk,
        0,
      );
      const lod1 = this.buildChunkLodMesh(
        buildChunkLod1MeshData(
          graph,
          elevation,
          chunkIdByCell,
          chunk,
          { pinned, isLand: tectonics.isLand },
        ),
        chunk,
        1,
      );
      this.chunkLodMeshes[chunk.id] = [lod0, lod1];
    }
    this.previewGroup.visible = this.showPreview3D();
    this.chunkTotal.set(chunks.length);

    this.currentSeaLevelElevation = tectonics.seaLevelElevation;
    this.ensureOceanShell();
    this.updatePreviewDisplacement();
    this.updatePreviewColors();
    this.updateChunkLod();
  }

  /** Builds one chunk's LOD0-or-LOD1 mesh from already-tessellated `data`, adds it to
   * `previewGroup`/`previewMeshes`, and returns it — the shared tail end of both
   * `rebuildPreviewMesh()` (every chunk, full graph rebuild) and `rebuildAffectedChunks()`
   * (M4e, just the chunks an edit actually touched). Position/color attributes start zeroed;
   * `updatePreviewDisplacement()`/`updatePreviewColors()` fill them in afterward, same as
   * every existing call site already relies on. */
  private buildChunkLodMesh(
    data: { directions: Float32Array; elevations: Float32Array; cellIds: Int32Array },
    chunk: IPlanetChunk,
    lod: 0 | 1,
  ): Mesh {
    const geometry = new BufferGeometry();
    const positionAttr = new BufferAttribute(new Float32Array(data.directions.length), 3);
    positionAttr.setUsage(DynamicDrawUsage);
    geometry.setAttribute('position', positionAttr);
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(data.directions.length), 3));
    const mesh = new Mesh(geometry, this.previewMaterial);
    mesh.name = `preview-chunk-${chunk.id}-lod${lod}`;
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
  }

  /** M4e: applies a flatten/dig brush at whatever the camera is currently looking at (reusing
   * `raycastPlanetDirection()`, the same "where would a vessel/tool be" stand-in M4d's physics
   * test uses) and rebuilds only the chunks that edit can actually change — not the whole
   * planet. Brush cells are `cellsWithinHops()` from the hit cell; the *rebuild* scope is wider
   * than the *edit* scope by one more hop (`affectedCellIds()`), because `cellCornerElevation()`
   * blends a corner from 3 cells, so editing a cell also moves corners its unedited neighbors
   * render — see `terrainEdits.ts`'s doc comments for both.
   *
   * `flatten` levels the whole brush to the *hit cell's own current effective elevation* (so
   * clicking picks the target height, rather than a fixed global value); `dig` offsets every
   * brush cell by `editDigDelta()` from its own current effective elevation, so repeated clicks
   * on the same spot keep digging deeper instead of resetting each time. */
  setEditMode(mode: 'off' | 'flatten' | 'dig'): void {
    this.editMode.update((current) => (current === mode ? 'off' : mode));
  }

  onEditBrushHops(event: Event): void {
    this.editBrushHops.set(Number((event.target as HTMLInputElement).value));
  }

  onEditDigDelta(event: Event): void {
    this.editDigDelta.set(Number((event.target as HTMLInputElement).value));
  }

  applyTerrainEdit(): void {
    const mode = this.editMode();
    if (mode === 'off' || !this.graph || !this.tectonics) return;

    const direction = this.raycastPlanetDirection();
    if (!direction) return;
    const hitCell = findCellAt(this.graph, direction);

    const brushCellIds = cellsWithinHops(this.graph, hitCell.id, this.editBrushHops());

    // How big was that, really? Max angle from the clicked cell to any brush-member cell,
    // converted through the current worldSizeTier() — the direct answer to "so this is what I
    // mean about world size": the same brush-hop count means wildly different real footprints
    // depending on cell density and the chosen planet radius, and this makes that visible
    // instead of leaving it to be inferred from the 3D view.
    let maxAngle = 0;
    for (const cellId of brushCellIds) {
      const c = this.graph.cells[cellId].center;
      const d = Math.min(
        1,
        Math.max(-1, hitCell.center.x * c.x + hitCell.center.y * c.y + hitCell.center.z * c.z),
      );
      maxAngle = Math.max(maxAngle, Math.acos(d));
    }
    this.lastEditFootprintLabel.set(
      `${formatDistanceM(maxAngle * this.planetRadiusM())} radius (${brushCellIds.size} cells)`,
    );

    if (mode === 'flatten') {
      const targetElevation = getEffectiveElevation(this.tectonics.elevation, this.terrainEdits, hitCell.id);
      flattenCells(this.terrainEdits, brushCellIds, targetElevation);
    } else {
      digCells(this.terrainEdits, this.tectonics.elevation, brushCellIds, this.editDigDelta());
    }
    this.editedCellCount.set(this.terrainEdits.size);

    const rebuildCellIds = affectedCellIds(this.graph, brushCellIds);
    const rebuildChunkIds = affectedChunkIds(this.chunkIdByCell, rebuildCellIds);
    this.rebuildAffectedChunks(rebuildChunkIds);
    this.lastEditChunksRebuilt.set(`${rebuildChunkIds.size} / ${this.chunks.length}`);

    // Both of these read a stale snapshot otherwise: the 2D unwrap only redraws from
    // setMapMode()/toggleSites()/toggleEdges()/regenerate(), none of which an edit triggers on
    // its own; and updateColliderPatch() only resamples once the camera's look-at direction has
    // drifted from lastColliderPatchCenter, which an edit alone never changes (the camera hasn't
    // moved), so the M4d debug patch would otherwise keep showing pre-edit terrain until the
    // user happens to orbit enough to trip the drift check.
    this.drawMap();
    this.lastColliderPatchCenter = null;
  }

  /** M4e's actual "affordable" claim: rebuilds only the given chunks' LOD0/LOD1 meshes (real
   * tessellation work, `buildChunkMeshData()`/`buildChunkLod1MeshData()`) instead of every
   * chunk on the planet, the same way `rebuildPreviewMesh()` builds all of them on a full
   * regenerate. Disposes each affected chunk's old pair first so their GPU buffers don't leak.
   * `updatePreviewDisplacement()`/`updatePreviewColors()` still loop the *whole* `previewMeshes`
   * list afterward — a per-vertex position/color write is already the "cheap, every slider
   * tick" tier this file's other displacement passes rely on, so re-running it isn't the cost
   * this method exists to avoid; the chunk-rebuild (BFS regrouping + boundary-loop
   * triangulation) is. */
  private rebuildAffectedChunks(chunkIds: ReadonlySet<number>): void {
    if (!this.graph || !this.tectonics || chunkIds.size === 0) return;

    const elevation = buildEffectiveElevation(this.featureElevation, this.terrainEdits);
    const pinned = this.usePinning() ? this.pinnedCells : undefined;

    for (const chunkId of chunkIds) {
      const chunk = this.chunks[chunkId];
      if (!chunk) continue;

      const pair = this.chunkLodMeshes[chunkId];
      if (pair) {
        for (const mesh of pair) {
          this.previewGroup.remove(mesh);
          mesh.geometry.dispose();
          const idx = this.previewMeshes.indexOf(mesh);
          if (idx !== -1) this.previewMeshes.splice(idx, 1);
        }
      }

      const lod0 = this.buildChunkLodMesh(buildChunkMeshData(this.graph, elevation, chunk), chunk, 0);
      const lod1 = this.buildChunkLodMesh(
        buildChunkLod1MeshData(this.graph, elevation, this.chunkIdByCell, chunk, {
          pinned,
          isLand: this.tectonics.isLand,
        }),
        chunk,
        1,
      );
      this.chunkLodMeshes[chunkId] = [lod0, lod1];
    }

    this.updatePreviewDisplacement();
    this.updatePreviewColors();
    this.updateChunkLod();
  }

  /** Discards every M4e edit and rebuilds the whole preview from the graph's own generated
   * elevation — a reset action, so a full `rebuildPreviewMesh()` (not the affected-chunks-only
   * path above) is the right cost here. */
  resetTerrainEdits(): void {
    if (!this.graph || !this.tectonics) return;
    this.terrainEdits = new Map();
    this.editedCellCount.set(0);
    this.lastEditChunksRebuilt.set('—');
    this.lastEditFootprintLabel.set('—');
    this.rebuildPreviewMesh(this.graph, this.tectonics);
    this.drawMap();
    this.lastColliderPatchCenter = null;
  }

  /** Picks LOD0 vs LOD1 per chunk from the live camera's distance to that chunk's centroid
   * (`chunk.center`, an undisplaced unit-sphere direction — `previewGroup`/`root` carry no
   * transform of their own, so this is already world space, and ignoring elevation
   * displacement here is a fine approximation for a distance *threshold*) against the
   * `lodDistance()` slider, then flips exactly one of `chunkLodMeshes[chunk.id]`'s two meshes
   * visible. Cheap: O(chunkCount) distance/angle checks per frame, no geometry touched — the
   * actual mesh data for both LODs was already built once in `rebuildPreviewMesh()`. Runs even
   * when the preview is hidden (harmless — `previewGroup.visible = false` already skips
   * rendering either way) so the `lodSplit` stat stays live for the slider.
   *
   * Also does whole-chunk horizon culling: a chunk entirely on the far side of the planet from
   * the camera gets *both* its LOD meshes set `.visible = false`, which drops it from the
   * draw-call list Three submits to the GPU entirely — unlike `previewMaterial`'s `DoubleSide`
   * setting (or a `FrontSide` swap), which only discards individual back-facing *triangles* in
   * the rasterizer after they've already been vertex-shaded and their draw call issued. The
   * existing per-cell near-side cull (`updateCulling()`, for the sites/edges graph overlay) uses
   * a flat `dot(direction, view) <= CULL_THRESHOLD` test, which is fine for a single point but
   * wrong for a whole chunk: a chunk's centroid can already be past the horizon while cells at
   * its edge are still visible. So this converts the dot product to an angle and subtracts the
   * chunk's own angular size (`chunk.boundingRadius`, precomputed by `buildPlanetChunks()`
   * specifically for this) before comparing against `HORIZON_ANGLE` — a chunk is only culled once
   * even its nearest edge (toward the camera) is past the horizon margin, so a chunk straddling
   * the terminator stays visible (at whichever LOD distance already picked) rather than popping
   * off early.
   *
   * `freezeCulling()` short-circuits both the LOD pick and the horizon cull at their current
   * `.visible` state, so a chunk set exactly for testing (see `toggleFreezeCulling()`'s doc
   * comment) — orbit to confirm the far side stayed correctly culled instead of the cull
   * silently re-running every frame as the camera moves. */
  private updateChunkLod(): void {
    if (this.chunks.length === 0) return;
    if (this.freezeCulling()) return;
    const camera = this.engine.camera$.value;
    if (!camera) return;
    // `root` now carries a real `planetRadiusM()` scale (see the constructor's rescale
    // `effect()`), but `chunk.center` is still an undisplaced *local* unit-sphere direction —
    // both the slider threshold and `chunk.center` itself need that same factor to compare
    // against `camera.position`, which is world space (the camera is a scene sibling of
    // `root`, not a child, so it's never itself scaled).
    const radiusM = this.planetRadiusM();
    const threshold = this.lodDistance() * radiusM;

    const camLen = camera.position.length() || 1;
    const vx = camera.position.x / camLen;
    const vy = camera.position.y / camLen;
    const vz = camera.position.z / camLen;

    let nearCount = 0;
    let culledCount = 0;
    for (const chunk of this.chunks) {
      const pair = this.chunkLodMeshes[chunk.id];
      if (!pair) continue;
      const [lod0, lod1] = pair;

      const dot =
        chunk.center.x * vx + chunk.center.y * vy + chunk.center.z * vz;
      const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
      const behindHorizon = angle - chunk.boundingRadius > HORIZON_ANGLE;
      if (behindHorizon) {
        lod0.visible = false;
        lod1.visible = false;
        culledCount++;
        continue;
      }

      const dx = camera.position.x - chunk.center.x * radiusM;
      const dy = camera.position.y - chunk.center.y * radiusM;
      const dz = camera.position.z - chunk.center.z * radiusM;
      const near = Math.hypot(dx, dy, dz) <= threshold;
      lod0.visible = near;
      lod1.visible = !near;
      if (near) nearCount++;
    }
    this.chunkCulledCount.set(culledCount);
    this.lodSplit.set(
      `${nearCount} near / ${this.chunks.length - nearCount - culledCount} far / ${culledCount} culled`,
    );
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
   * event, no geometry rebuild or color re-touch needed. Loops `previewMeshes` (M4b: one
   * per chunk) instead of touching a single whole-planet mesh. */
  private updatePreviewDisplacement(): void {
    const scale = this.elevationScale() / 100;
    for (const mesh of this.previewMeshes) {
      const { directions, elevations } = mesh.userData as IChunkMeshUserData;
      const positionAttr = mesh.geometry.getAttribute(
        'position',
      ) as BufferAttribute;
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

  /** Per-vertex color for the 3D preview — unlike `resolveCellColor()` (the 2D unwrap's flat
   * per-cell-polygon fill), this classifies land vs water from each vertex's own already-
   * blended elevation instead of the cell's coarse `isLand[]` flag, so it can never disagree
   * with the height at that same vertex — see the `rebuildPreviewMesh()` doc comment. Not
   * cached per-cell (unlike the old version) since the land/water split and the elevation
   * ramp both now vary per vertex within a single cell's fan, not just per cell. Loops
   * `previewMeshes` (M4b: one per chunk) instead of touching a single whole-planet mesh.
   *
   * When `showChunkColors()` is on, every vertex in a mesh gets the same
   * `chunkColor(mesh.userData.chunkId)` instead of the biome/elevation color — both of a
   * chunk's LOD meshes share the same chunk id, so LOD0/LOD1 always agree on the debug color
   * even as `updateChunkLod()` swaps which one is visible. This is the whole cost of the debug
   * overlay: one `Color.setStyle()` per mesh instead of per vertex, still writing into the
   * same pre-allocated color attribute — no new geometry, no extra draw calls.
   *
   * When `highlightPins()` is also on, any vertex whose `cellId` is in `pinnedCells` gets
   * force-overridden to a fixed magenta regardless of mode/chunk-color, on top of whatever
   * base color was just computed — this is the direct answer to "is the specific feature I'm
   * looking at actually protected", rather than inferring it indirectly from an A/B toggle. */
  private updatePreviewColors(): void {
    if (!this.tectonics) return;
    const scratch = new Color();
    const mode = this.mapMode();
    const tectonics = this.tectonics;
    const chunkColors = this.showChunkColors();
    const highlight = this.highlightPins();
    const pins = this.pinnedCells;
    const highlightColor = new Color('#ff17e0');
    const elevMin = Math.min(...tectonics.elevation);
    const elevMax = Math.max(...tectonics.elevation);
    this.previewMeshes.forEach((mesh) => {
      const { elevations, cellIds, chunkId } =
        mesh.userData as IChunkMeshUserData;
      const colorAttr = mesh.geometry.getAttribute('color') as BufferAttribute;
      const arr = colorAttr.array as Float32Array;

      if (chunkColors) {
        scratch.setStyle(chunkColor(chunkId));
        for (let i = 0; i < cellIds.length; i++) {
          const pinned = highlight && pins[cellIds[i]] === 1;
          const c = pinned ? highlightColor : scratch;
          const o = i * 3;
          arr[o] = c.r;
          arr[o + 1] = c.g;
          arr[o + 2] = c.b;
        }
      } else {
        for (let i = 0; i < cellIds.length; i++) {
          const cellId = cellIds[i];
          const vertexElevation = elevations[i];
          const pinned = highlight && pins[cellId] === 1;
          if (pinned) {
            scratch.copy(highlightColor);
          } else {
            scratch.setStyle(
              this.resolveVertexColor(
                cellId,
                vertexElevation,
                mode,
                tectonics,
                elevMin,
                elevMax,
              ),
            );
          }
          const o = i * 3;
          arr[o] = scratch.r;
          arr[o + 1] = scratch.g;
          arr[o + 2] = scratch.b;
        }
      }
      colorAttr.needsUpdate = true;
    });
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
    if (mode === 'elevation')
      return elevationColor(
        vertexElevation,
        tectonics.seaLevelElevation,
        elevMin,
        elevMax,
      );

    const land = vertexElevation >= tectonics.seaLevelElevation;
    // Substance override: on a WorldProfile with oceanSubstance 'lava' (the `protoplanet`
    // preset), the single largest water component reads as molten regardless of map mode —
    // see world-profile.ts and color-ramps.ts's lavaOceanColor().
    const isLavaOcean =
      !land &&
      this.worldProfile().oceanSubstance === 'lava' &&
      this.ecology?.waterBodyKind[cellId] === 'ocean';

    const ecology = this.ecology;
    if (ecology) {
      if (mode === 'temperature')
        return temperatureColor(ecology.temperature[cellId]);
      if (mode === 'moisture') return moistureColor(ecology.moisture[cellId]);
      if (mode === 'feature') {
        const feature = this.features.feature[cellId];
        if (feature !== 'none') return featureColor(feature);
        return isLavaOcean ? lavaOceanColor() : land ? 'hsl(100, 30%, 30%)' : 'hsl(210, 50%, 26%)';
      }
      if (mode === 'biome') {
        if (isLavaOcean) return lavaOceanColor();
        if (!land)
          return ecology.biome[cellId] === 'lake'
            ? BIOME_COLORS['lake']
            : BIOME_COLORS['ocean'];
        const biome = ecology.biome[cellId];
        return biome === 'ocean' || biome === 'lake'
          ? 'hsl(95, 45%, 45%)'
          : biomeColor(biome);
      }
    }
    if (isLavaOcean) return lavaOceanColor();
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
    this.rebuildRiverRibbons(ecology);

    if (this.coastlineLines) {
      this.root.remove(this.coastlineLines);
      this.coastlineLines.geometry.dispose();
    }
    this.coastlineDirections = this.computeMeshWaterlineDirections();
    const coastGeometry = new BufferGeometry();
    coastGeometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(this.coastlineDirections.length), 3),
    );
    this.coastlineLines = new LineSegments(
      coastGeometry,
      this.coastlineMaterial,
    );
    this.coastlineLines.visible = this.mapMode() === 'rivers';
    this.root.add(this.coastlineLines);

    this.updateRiverOverlayDisplacement();
  }

  /** Builds one flowing ribbon mesh (`worldgen/render`'s `createFlowRibbon()`) per
   * `ecology.riverPaths` entry — replaces any previous set wholesale (path count is small, a
   * handful to a few dozen, so a full rebuild on regenerate()/elevation-scale change is cheap
   * relative to a chunk rebuild, unlike the old cached-direction incremental reposition this
   * replaces). Width comes from `sqrt(riverFlow)` — `rivers.ts`'s own doc comment names this as
   * the intended use of that field — scaled by `avgCellAngleRad()` so width tracks cell size
   * instead of a fixed constant that would look wrong across `cellCount`/world-size-tier
   * combinations. All paths share one material, picked once by `worldProfile().oceanSubstance`
   * (see the field doc comment above for why that's the right granularity, not per-path). */
  private rebuildRiverRibbons(ecology: IPlanetEcology): void {
    for (const mesh of this.riverRibbons) {
      this.root.remove(mesh);
      mesh.geometry.dispose();
    }
    this.riverRibbons = [];

    const graph = this.graph;
    if (!graph || this.featureElevation.length === 0) return;

    const scale = this.elevationScale() / 100;
    const bias = 1.002;
    const widthScale = Math.max(1e-5, this.avgCellAngleRad()) * 0.12;
    const material =
      this.worldProfile().oceanSubstance === 'lava' ? this.lavaFlowMaterial : this.waterFlowMaterial;
    const visible = this.mapMode() === 'rivers';

    ecology.riverPaths.forEach((path, pathIndex) => {
      const n = path.length;
      if (n < 2) return;
      const flow = ecology.riverFlow[pathIndex];

      const positions = new Float32Array(n * 2 * 3);
      const uvs = new Float32Array(n * 2 * 2);
      const indices: number[] = [];
      for (let i = 0; i < n; i++) {
        const point = path[i];
        const radial = normalize(point);
        const elevationHere = sampleElevation(graph, this.featureElevation, point);
        const radius = (1 + elevationHere * scale) * bias;
        const previous = path[Math.max(0, i - 1)];
        const next = path[Math.min(n - 1, i + 1)];
        const tangent = { x: next.x - previous.x, y: next.y - previous.y, z: next.z - previous.z };
        const perpendicular = normalize(cross(radial, tangent));
        const halfWidth = Math.sqrt(Math.max(0, flow[i])) * widthScale;

        for (let side = 0; side < 2; side++) {
          const sign = side === 0 ? -1 : 1;
          const vertex = i * 2 + side;
          positions[vertex * 3] = radial.x * radius + perpendicular.x * halfWidth * sign;
          positions[vertex * 3 + 1] = radial.y * radius + perpendicular.y * halfWidth * sign;
          positions[vertex * 3 + 2] = radial.z * radius + perpendicular.z * halfWidth * sign;
          uvs[vertex * 2] = side;
          uvs[vertex * 2 + 1] = i / (n - 1);
        }
        if (i < n - 1) {
          const start = i * 2;
          indices.push(start, start + 2, start + 1, start + 1, start + 2, start + 3);
        }
      }

      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(positions, 3));
      geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      const mesh = new Mesh(geometry, material);
      mesh.renderOrder = 1;
      mesh.visible = visible;
      this.root.add(mesh);
      this.riverRibbons.push(mesh);
    });
  }

  /** Re-derives coastline positions from their cached directions for the current
   * `elevationScale()` — cheap, no re-sampling — so it can run on every elevation-scale slider
   * `input` event alongside `updatePreviewDisplacement()`. Rivers rebuild wholesale instead
   * (`rebuildRiverRibbons()`) since their ribbon width/shape isn't a pure radial reposition. */
  private updateRiverOverlayDisplacement(): void {
    const scale = this.elevationScale() / 100;
    const bias = 1.0015; // tiny radial nudge so lines don't z-fight the terrain/ocean surfaces

    if (this.coastlineLines && this.tectonics) {
      const radius = (1 + this.tectonics.seaLevelElevation * scale) * bias;
      const attr = this.coastlineLines.geometry.getAttribute(
        'position',
      ) as BufferAttribute;
      const positions = attr.array as Float32Array;
      for (let i = 0; i < this.coastlineDirections.length; i++) {
        positions[i] = this.coastlineDirections[i] * radius;
      }
      attr.needsUpdate = true;
    }
  }

  /** Extracts the land/water boundary directly from the preview chunk meshes' own triangles
   * instead of `buildPlanetEcology()`'s per-cell edge chain — walks each fan triangle's 3
   * stored (direction, elevation) vertices (see `rebuildPreviewMesh()`) and, for any edge
   * whose two endpoints straddle sea level, linearly interpolates the crossing direction. A
   * triangle crosses sea level along exactly 0 or 2 of its edges in the generic case (a
   * vertex sitting exactly on sea level is the only way to get 1, ignored here as a
   * measure-zero edge case for a debug lab), so each qualifying triangle contributes exactly
   * one line segment. M4b: each chunk's vertex data (`mesh.userData`) is still laid out as
   * consecutive triangles internally (`buildChunkMeshData()` preserves the fan order), so
   * this walks every chunk in turn and concatenates their segments — chunk boundaries never
   * split a triangle, so no cross-chunk stitching is needed here. M4c: only walks each chunk's
   * LOD0 mesh, never LOD1 — LOD1's merged polygons are a much coarser approximation of
   * the coastline, and since `updateChunkLod()` swaps LOD per chunk every frame based on
   * camera distance, extracting from whichever one happens to be visible would make the
   * coastline overlay redraw itself (and briefly look inconsistent) as the camera moves. This
   * runs once per `regenerate()`, not per frame, so always sourcing it from the stable,
   * always-built LOD0 data is both simpler and correct.
   * `updateRiverOverlayDisplacement()` then places these at the same sea-level radius as the
   * ocean shell, since a crossing point's elevation is exactly `seaLevel` by construction. */
  private computeMeshWaterlineDirections(): Float32Array<ArrayBuffer> {
    const tectonics = this.tectonics;
    const out: number[] = [];
    if (!tectonics) return new Float32Array(out);
    const seaLevel = tectonics.seaLevelElevation;

    for (const mesh of this.previewMeshes) {
      const userData = mesh.userData as IChunkMeshUserData;
      if (userData.lod !== 0) continue;
      const { directions: dirs, elevations: elevs } = userData;

      const crossing = (
        a: number,
        b: number,
      ): [number, number, number] | null => {
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
          out.push(
            hits[0][0],
            hits[0][1],
            hits[0][2],
            hits[1][0],
            hits[1][1],
            hits[1][2],
          );
        }
      }
    }
    return new Float32Array(out);
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
        if (flow)
          ctx.lineWidth =
            baseLineWidth *
            (1 + 0.5 * Math.sqrt(Math.max(0, flow[(k + 1) % n] - 1)));
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

  private updateFeatureStats(): void {
    const counts = { volcano: 0, mesa: 0, crater: 0 };
    for (const instance of this.features.instances) counts[instance.kind]++;
    const lavaLakes = this.features.feature.filter((f) => f === 'lava_lake').length;
    const parts = [
      counts.volcano > 0 ? `${counts.volcano} volcano` : null,
      counts.mesa > 0 ? `${counts.mesa} mesa` : null,
      counts.crater > 0 ? `${counts.crater} crater` : null,
      lavaLakes > 0 ? `${lavaLakes} lava lake` : null,
    ].filter((p): p is string => p !== null);
    this.featureCounts.set(parts.length > 0 ? parts.join(', ') : '—');
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
        const wraps = lls.some(
          (ll, k) => Math.abs(ll.lon - lls[(k + 1) % n].lon) > Math.PI * 0.9,
        );
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
        this.drawPolylines(
          ctx,
          ecology.riverPaths,
          lonLat,
          mapPoint,
          false,
          ecology.riverFlow,
          Math.max(1.4, dpr * 1.2),
        );
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
