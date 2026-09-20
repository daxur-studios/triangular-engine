import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
} from '@angular/core';
import { DoubleSide, Material, MeshStandardMaterial, Vector3 } from 'three';
import type { RaycastFocusResolver } from 'triangular-engine';
import {
  enableTerrainMacroVariation,
  ITerrainField,
  ITerrainFieldSample,
  ITerrainPatchMesh,
  ITerrainSurfaceLodStats,
  LatLonTerrainDomain,
  TerrainSurfaceComponent,
  type ILatLonTerrainPatchAddress,
  type ITerrainMacroVariationUniforms,
  type TerrainSurfaceMeshGenerator,
  type TerrainSurfacePatchSelector,
  type TerrainVector3,
} from 'triangular-engine/terrain';
import {
  createCellPlanetMorphSurfaceSelector,
} from '../cell-planet-morph-patch-selector';
import { createCellPlanetMorphRaycastFocus } from '../cell-planet-morph-raycast';
import { MapProjectionKind } from '../map-projections';
import {
  enablePlanetMorphProjection,
  IDynamicProjectionUniforms,
} from '../planet-morph-material';

/** A terrain field that never displaces - the morph streaming path samples elevation on the CPU
 * (or in a worker) while building each patch's dual-space attributes, so `TerrainSurfaceComponent`
 * itself has nothing left to displace. Exported so hosts do not need to implement this themselves. */
export class InertCellPlanetTerrainField implements ITerrainField {
  constructor(
    readonly minElevationM = -1,
    readonly maxElevationM = 1,
  ) {}
  sample(_fieldPosition: TerrainVector3): ITerrainFieldSample {
    return { elevationM: 0 };
  }
  sampleBatch(
    fieldPositions: Float64Array,
    elevationsM = new Float64Array(fieldPositions.length / 3),
  ): Float64Array {
    elevationsM.fill(0);
    return elevationsM;
  }
}

function defaultAddressKey(address: ILatLonTerrainPatchAddress): string {
  return `${address.level}:${address.x}:${address.y}`;
}

function defaultAddressLevel(address: ILatLonTerrainPatchAddress): number {
  return address.level;
}

/**
 * High-level Angular component that streams a cell planet's terrain as a quadtree of LOD chunks
 * and morphs it between a 3D sphere and a 2.5D flat map, using `TerrainSurfaceComponent` plus a
 * morph-aware patch selector and raycaster. This is the reusable extraction of the proven
 * `cell-planet-morph-streaming` demo page (triangular-workspace) - see runbook 039 for the gaps
 * it closes (morph-aware patch selection, morph-aware raycasting, the dual-space attribute
 * contract) and runbook 035 for the milestone it fulfils early (L6, consumer integration).
 *
 * What this component does NOT own, by design:
 * - **Mesh generation.** Sampling a world (worldgen graph/tectonics/ecology, or any other
 *   source) into per-vertex dual-space geometry is inherently game-specific, and Angular's
 *   `new Worker(new URL(...))` pattern requires the worker file to live in the consuming app's
 *   own build. Supply `meshGenerator`; see the demo's `cell-planet-morph-streaming.worker.ts`
 *   for a reference implementation (world caching, edge conforming, Meshoptimizer reduction,
 *   colour modes) to copy into your app's own worker.
 * - **Camera/controls.** Bind this component's `raycastFocusResolver` into your own
 *   `<raycastOrbitControls [raycastFocusResolver]>` (or custom raycaster) so each game keeps
 *   control of near/far, zoom behaviour, and camera framing.
 *
 * What it does own: quadtree LOD selection that stays correct mid-morph, morph-aware raycasting,
 * the default material recipe (`enableTerrainMacroVariation` + `enablePlanetMorphProjection`),
 * and a debounced LOD-vs-morph split so dragging a morph slider never thrashes resident meshes.
 */
@Component({
  selector: 'cellPlanetMorphStreamingView',
  standalone: true,
  imports: [TerrainSurfaceComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <terrainSurface
      [field]="field()"
      [domain]="domain()"
      [roots]="roots()"
      [maxLod]="maxLod()"
      [resolution]="resolution()"
      [generationBudget]="generationBudget()"
      [maxPatches]="maxPatches()"
      [batching]="batching()"
      [frustumCulled]="frustumCulled()"
      [freezeLod]="freezeLod()"
      [wireframe]="wireframe()"
      [patchSelector]="patchSelector"
      [meshGenerator]="meshGenerator()"
      [createMaterial]="resolvedCreateMaterial"
      [colorRevision]="colorRevision()"
      [getLevel]="defaultAddressLevel"
      [getKey]="defaultAddressKey"
      (lodChange)="onLodChange($event)"
    />
  `,
})
export class CellPlanetMorphStreamingViewComponent {
  readonly defaultAddressKey = defaultAddressKey;
  readonly defaultAddressLevel = defaultAddressLevel;

  // ==========================================================================
  // World shape
  // ==========================================================================
  readonly radiusM = input.required<number>();
  /** Defaults to a depth-4, width-2 lat/lon root grid - the shape proven by the demo. */
  readonly domain = computed(() => new LatLonTerrainDomain(this.radiusM(), 4, 2));
  readonly roots = computed(() => this.domain().createLevelZeroRoots());
  readonly field = input<ITerrainField>(new InertCellPlanetTerrainField());

  /** Per-patch mesh generation - see the class doc for why this is not provided by default. */
  readonly meshGenerator =
    input.required<TerrainSurfaceMeshGenerator<ILatLonTerrainPatchAddress>>();

  // ==========================================================================
  // Morph + projection
  // ==========================================================================
  /** 0 = sphere, 1 = flat map. Update this every frame while dragging; LOD selection is
   * debounced internally so slider drags never thrash resident meshes. */
  readonly morphProgress = input(0);
  readonly projectionKind = input<MapProjectionKind>('equalEarth');
  /** Debounce, in ms, between `morphProgress` changing and the LOD selector re-running. */
  readonly lodMorphDebounceMs = input(200);

  private readonly lodMorph = signal(0);
  private lodMorphDebounceTimer?: ReturnType<typeof setTimeout>;

  // ==========================================================================
  // Quality
  // ==========================================================================
  readonly maxLod = input(6);
  readonly resolution = input(32);
  readonly generationBudget = input(6);
  readonly maxPatches = input<number | undefined>(undefined);
  readonly batching = input(true);
  readonly frustumCulled = input(false);
  readonly wireframe = input(false);
  readonly freezeLod = input(false);
  /** Bump to force `TerrainSurfaceComponent` to rebuild resident patches (e.g. after a
   * generation-input change such as seed, quality preset, or colour mode). */
  readonly colorRevision = input(0);
  readonly refinementDistanceFactor = input<number | undefined>(undefined);
  readonly stickyRefinementFactor = input<number | undefined>(undefined);

  // ==========================================================================
  // Default material - macro/micro colour breakup + sphere/flat morph projection
  // ==========================================================================
  readonly macroVariationEnabled = input(true);
  readonly macroVariationStrength = input(0.35);
  readonly macroVariationScaleM = input(48);
  /** Override to fully control material creation; the default composes
   * `enableTerrainMacroVariation` + `enablePlanetMorphProjection` on a `MeshStandardMaterial`. */
  readonly createMaterial = input<(() => Material) | undefined>(undefined);

  private readonly macroUniforms: ITerrainMacroVariationUniforms = {
    uTerrainMacroEnabled: { value: 1 },
    uTerrainMacroStrength: { value: 0.35 },
    uTerrainMacroScaleM: { value: 48 },
  };

  readonly morphUniforms: IDynamicProjectionUniforms = {
    uMorph: { value: 0 },
    uProjForward: { value: new Vector3(0, 0, 1) },
    uProjUp: { value: new Vector3(0, 1, 0) },
    uProjRight: { value: new Vector3(1, 0, 0) },
    uProjMode: { value: 0 },
    uMapWidth: { value: 1 },
    uMapHeight: { value: 1 },
    uRadius: { value: 1 },
    uProjectionType: { value: 1 },
  };

  private readonly defaultCreateMaterial = (): Material => {
    const material = new MeshStandardMaterial({
      roughness: 0.92,
      metalness: 0.05,
      side: DoubleSide,
      vertexColors: true,
    });
    enableTerrainMacroVariation(material, this.macroUniforms, {
      // View space: the demo's proven default, since this breaks up the *visible* (morphed)
      // surface. `bodyFixedM` is available via a custom `createMaterial` for callers who need
      // the pattern to stay welded to geography instead.
      positionSpace: 'viewM',
    });
    enablePlanetMorphProjection(material, this.morphUniforms);
    return material;
  };

  readonly resolvedCreateMaterial = (): Material =>
    (this.createMaterial() ?? this.defaultCreateMaterial)();

  // ==========================================================================
  // LOD selection + raycasting
  // ==========================================================================
  private readonly selector = createCellPlanetMorphSurfaceSelector({
    domain: () => this.domain(),
    radiusM: () => this.radiusM(),
    morph: () => this.lodMorph(),
    projectionKind: () => this.projectionKind(),
    refinementDistanceFactor: () => this.refinementDistanceFactor(),
    stickyRefinementFactor: () => this.stickyRefinementFactor(),
  });
  readonly patchSelector: TerrainSurfacePatchSelector<ILatLonTerrainPatchAddress> = (request) =>
    this.selector.select(request);

  private surfaceRevision = 0;

  /** Bind to `<raycastOrbitControls [raycastFocusResolver]>` for morph-correct focus picking. */
  readonly raycastFocusResolver: RaycastFocusResolver = createCellPlanetMorphRaycastFocus({
    morph: () => this.morphProgress(),
    surfaceRevision: () => this.surfaceRevision,
  });

  readonly lodChange = output<ITerrainSurfaceLodStats>();

  onLodChange(stats: ITerrainSurfaceLodStats): void {
    this.surfaceRevision += 1;
    this.lodChange.emit(stats);
  }

  constructor() {
    effect(() => {
      const morph = this.morphProgress();
      this.morphUniforms.uMorph.value = morph;
    });

    effect(() => {
      const radius = this.radiusM();
      this.morphUniforms.uRadius.value = radius;
      this.morphUniforms.uMapWidth.value = 2 * Math.PI * radius;
      this.morphUniforms.uMapHeight.value = Math.PI * radius;
    });

    effect(() => {
      this.morphUniforms.uProjectionType.value = this.projectionKind() === 'equalEarth' ? 1 : 0;
    });

    effect(() => {
      this.macroUniforms.uTerrainMacroEnabled.value = this.macroVariationEnabled() ? 1 : 0;
      this.macroUniforms.uTerrainMacroStrength.value = Math.max(
        0,
        Math.min(1, this.macroVariationStrength()),
      );
      this.macroUniforms.uTerrainMacroScaleM.value = Math.max(1, this.macroVariationScaleM());
    });

    effect((onCleanup) => {
      const morph = this.morphProgress();
      if (this.lodMorphDebounceTimer !== undefined) {
        clearTimeout(this.lodMorphDebounceTimer);
      }
      this.lodMorphDebounceTimer = setTimeout(() => {
        this.lodMorph.set(morph);
      }, this.lodMorphDebounceMs());
      onCleanup(() => {
        if (this.lodMorphDebounceTimer !== undefined) {
          clearTimeout(this.lodMorphDebounceTimer);
        }
      });
    });
  }
}
