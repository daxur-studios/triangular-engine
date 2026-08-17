import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  Vector3,
  type Vector3Tuple,
} from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import {
  GROUND_COVER_MEADOW_GRASS_ARCHETYPE,
  GROUND_COVER_MEADOW_GRASS_COLORS,
  buildGroundCoverClumpMesh,
  hashProceduralKey,
} from 'triangular-engine/procedural';
import {
  generateTerrainPatchMesh,
  PlaneTerrainDomain,
  type IPlaneTerrainPatchAddress,
  type ITerrainField,
  type ITerrainFieldSample,
  type ITerrainPatchMesh,
  type TerrainVector3,
} from 'triangular-engine/terrain';
import {
  buildScatterInstancedMesh,
  enableScatterWindSway,
  generateTerrainScatterInstances,
  ScatterStreamingService,
  selectFixedLevelScatterCells,
  type IScatterWindHandle,
  type ITerrainScatterInstance,
  type ScatterPlacementRules,
  type ScatterScaleRange,
  type ScatterStreamingViewpoint,
  type ScatterWindDefinition,
} from 'triangular-engine/scatter';

const PLANE_PATCH_SIZE_M = 24;
const GRID_RADIUS = 1;
const TERRAIN_RESOLUTION = 12;
const SCATTER_SELECT_RADIUS_M = 1_000_000;
/**
 * Grass needs a much finer identity cell than trees so density reads as a
 * field rather than a scatter of dots — two levels deeper than a root patch
 * is 16 cells per root (quadtree), vs. flora-scatter-lab's one level (4).
 */
const SCATTER_FIXED_LEVEL_DEPTH = 2;
const WORLD_SEED = 4_211;

const GRASS_LAYER_ID = 'meadow-grass';
const GRASS_SPECIES_ID = GROUND_COVER_MEADOW_GRASS_ARCHETYPE.id;
const GRASS_GENERATOR_VERSION = 1;
/**
 * `baseDensity01` (below) clamps to [0,1] inside scatter's placement math, so
 * it can only ever thin this base pool, never grow past it — density values
 * above 1x scale the pool itself instead, see rebuildGrass().
 */
const GRASS_CANDIDATE_POOL_SIZE_BASE = 22;
const GRASS_DENSITY_MULTIPLIER_DEFAULT = 0.55;
const GRASS_DENSITY_MULTIPLIER_MAX = 5;
const GRASS_RULES: ScatterPlacementRules = {
  alignment: 'align-to-surface-up',
  slopeMax01: 0.85,
};
const GRASS_SCALE: ScatterScaleRange = { min: 0.75, max: 1.4 };
const GRASS_GUST_AMPLITUDE_DEFAULT = 0.12;
const GRASS_GUST_AMPLITUDE_MAX = 0.5;
/**
 * Field is ~72m across (GRID_RADIUS 1 → 3x3 patches of PLANE_PATCH_SIZE_M
 * 24). Min gives many tight, choppy swirls; max gives a couple of broad,
 * slow-turning eddies comfortably larger than the field.
 */
const GRASS_GUST_WAVELENGTH_DEFAULT_M = 18;
const GRASS_GUST_WAVELENGTH_MIN_M = 4;
const GRASS_GUST_WAVELENGTH_MAX_M = 90;
/**
 * How fast the curl-noise field's domain drifts (roughly m/s) — higher
 * makes eddies visibly travel and rotate faster. Default bumped up from an
 * initial 6 because at low drift speed the gust is technically present but
 * reads as nearly static over the few seconds someone actually watches it.
 */
const GRASS_GUST_DRIFT_SPEED_DEFAULT_MS = 10;
const GRASS_GUST_DRIFT_SPEED_MIN_MS = 0.5;
const GRASS_GUST_DRIFT_SPEED_MAX_MS = 60;
/**
 * Distance-based density falloff (`generateTerrainScatterInstances`'s
 * `distanceFade` option) — grass thins out approaching `viewDistanceM` and
 * is gone past it, instead of popping or rendering uniformly all the way to
 * the field's edge (~51m at the far corners, GRID_RADIUS 1 of
 * PLANE_PATCH_SIZE_M 24). `fadeStartM` is a fixed fraction of the slider
 * value rather than its own control — one slider is enough to demonstrate
 * and tune the effect without another row of UI.
 */
const GRASS_VIEW_DISTANCE_DEFAULT_M = 40;
const GRASS_VIEW_DISTANCE_MIN_M = 10;
const GRASS_VIEW_DISTANCE_MAX_M = 100;
const GRASS_FADE_START_RATIO = 0.55;
/** Rebuild grass only after the camera moves this far — regenerating every cell on every frame while orbiting would be wasteful. */
const GRASS_STREAMING_MOVEMENT_THRESHOLD_M = 4;
/**
 * Directional ("pizza slice") culling: grass outside a cone in front of the
 * camera is dropped entirely, on top of (not instead of) the radial
 * distance fade above — ported from brunos-space-program's cdlod-terrain-lab,
 * which culls terrain quadtree nodes the same way (angle-to-camera-forward
 * vs. a fixed half-angle) rather than a true 6-plane frustum. Deliberately
 * wider than the actual camera FOV ("conservative"), same reasoning as that
 * reference: cheap to test, and erring wide avoids pop-in right at the
 * screen edge. Tested per-candidate (not per-cell), so the cone's edge is a
 * smooth boundary through the field rather than a blocky per-cell cutoff.
 *
 * The angle test uses the full 3D direction to each candidate against the
 * full 3D camera-forward vector — not an XZ-only/horizontal approximation.
 * That matters for two reasons: it correctly narrows/rotates the cone when
 * the camera pitches up or down (an XZ-only version stays blind to pitch,
 * so looking straight down neither adds the downward view nor drops what's
 * now behind-and-below), and it makes the test viewer-relative only, with
 * no assumption about which axis is "up" or "horizontal" — so unlike the
 * old XZ version, this works unmodified on a sphere or inside-cylinder
 * world too, not just a flat plane.
 */
const GRASS_VIEW_CONE_HALF_ANGLE_RAD = 1.31; // ~75°, conservative half-angle
const GRASS_VIEW_CONE_COS_HALF_ANGLE = Math.cos(GRASS_VIEW_CONE_HALF_ANGLE_RAD);
/**
 * Lighter and quicker than flora's TREE_WIND (strength 0.05, frequency 0.9)
 * — thin blades flutter faster than a canopy sways. `strength`/`frequency`
 * drive each blade's own desynced flutter; `gust` layers a second, *coherent*
 * curl-noise flow on top — swirling and drifting rather than sliding one
 * fixed direction, so it reads as natural eddies moving through the field
 * instead of the flutter's per-blade shimmer (or a straight traveling wall).
 * Amplitude, eddy size, and drift speed are all live-adjustable uniforms,
 * see the density-style sliders wired to
 * `setGustAmplitude`/`setGustWavelengthM`/`setGustDriftSpeedMS` in the
 * constructor.
 */
const GRASS_WIND: ScatterWindDefinition = {
  strength: 0.06,
  frequency: 2.2,
  gust: {
    wavelengthM: GRASS_GUST_WAVELENGTH_DEFAULT_M,
    driftSpeedMS: GRASS_GUST_DRIFT_SPEED_DEFAULT_MS,
    amplitude: GRASS_GUST_AMPLITUDE_DEFAULT,
  },
};

/** One clump mesh per seed, scatter buckets instances into whichever variant its instance ID hashes to — same "no per-instance mesh-variant primitive yet" workaround as flora-scatter-lab. */
const CLUMP_VARIANT_COUNT = 5;
const CLUMP_BASE_SEED = 1;

const GRASS_BASE_COLOR = new Color(GROUND_COVER_MEADOW_GRASS_COLORS.baseHex);
const GRASS_TIP_COLOR = new Color(GROUND_COVER_MEADOW_GRASS_COLORS.tipHex);

function gentleMeadowUndulationM(x: number, z: number): number {
  return Math.sin(x / 34) * 0.6 + Math.cos(z / 41) * 0.45;
}

class MeadowLabTerrainField implements ITerrainField {
  readonly minElevationM = -1.5;
  readonly maxElevationM = 1.5;

  sample([x, _y, z]: TerrainVector3): ITerrainFieldSample {
    return { elevationM: gentleMeadowUndulationM(x, z) };
  }

  sampleBatch(
    positions: Float64Array,
    out = new Float64Array(positions.length / 3),
  ): Float64Array {
    for (let i = 0; i < out.length; i++) {
      out[i] = gentleMeadowUndulationM(positions[i * 3], positions[i * 3 + 2]);
    }
    return out;
  }
}

interface IClumpVariant {
  readonly geometry: BufferGeometry;
}

interface IGrassScatterCell {
  readonly address: IPlaneTerrainPatchAddress;
  readonly cellKey: string;
}

/**
 * Slice 4 of the grass work: grass density fades out toward
 * `GRASS_VIEW_DISTANCE_DEFAULT_M` (`generateTerrainScatterInstances`'s
 * `distanceFade` option) and re-thins as the camera moves
 * (`ScatterStreamingService.viewpointWorldM$`), instead of rendering
 * uniformly all the way to the field's edge — on top of slice 3's
 * curl-noise gust (`GRASS_WIND.gust`, swirling and drifting as a coherent
 * flow, phased off world position + time rather than the per-instance hash)
 * over slice 2's desynced per-instance flutter (`enableScatterWindSway`,
 * same primitive flora-scatter-lab uses for trees), which itself sits on
 * slice 1's geometry + density on scatter's existing pipeline. The gust and
 * distance-fade primitives both live in scatter, not this page, so
 * flora/trees can pick them up too whenever that's the next thing worth
 * doing. See the flora-scatter-lab pattern this mirrors (one InstancedMesh
 * per seeded variant, bucketed by an instance-ID hash) — trees registered a
 * branching flora species the same way this registers a non-branching
 * ground-cover one.
 */
@Component({
  selector: 'app-meadow-lab-page',
  imports: [RouterLink, EngineModule, DecimalPipe],
  templateUrl: './meadow-lab-page.component.html',
  styleUrl: './meadow-lab-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true }), ScatterStreamingService],
  host: { class: 'flex-page' },
})
export class MeadowLabPageComponent {
  readonly grassInstanceCount = signal(0);
  readonly cellCount = signal(0);
  readonly variantCount = CLUMP_VARIANT_COUNT;
  readonly density = signal(GRASS_DENSITY_MULTIPLIER_DEFAULT);
  readonly gustAmplitude = signal(GRASS_GUST_AMPLITUDE_DEFAULT);
  readonly gustAmplitudeMax = GRASS_GUST_AMPLITUDE_MAX;
  readonly gustWavelengthM = signal(GRASS_GUST_WAVELENGTH_DEFAULT_M);
  readonly gustWavelengthMinM = GRASS_GUST_WAVELENGTH_MIN_M;
  readonly gustWavelengthMaxM = GRASS_GUST_WAVELENGTH_MAX_M;
  readonly gustDriftSpeedMS = signal(GRASS_GUST_DRIFT_SPEED_DEFAULT_MS);
  readonly gustDriftSpeedMinMS = GRASS_GUST_DRIFT_SPEED_MIN_MS;
  readonly gustDriftSpeedMaxMS = GRASS_GUST_DRIFT_SPEED_MAX_MS;
  readonly viewDistanceM = signal(GRASS_VIEW_DISTANCE_DEFAULT_M);
  readonly viewDistanceMinM = GRASS_VIEW_DISTANCE_MIN_M;
  readonly viewDistanceMaxM = GRASS_VIEW_DISTANCE_MAX_M;
  readonly cullBehindCamera = signal(true);
  readonly cullingFrozen = signal(false);

  readonly initialCameraPosition = signal<Vector3Tuple>([0, 4, 12]);
  readonly initialTarget = signal<Vector3Tuple>([0, 0.3, 0]);

  private readonly engine = inject(EngineService);

  private readonly domain = new PlaneTerrainDomain(PLANE_PATCH_SIZE_M);
  private readonly field = new MeadowLabTerrainField();
  private readonly groundMaterial = new MeshStandardMaterial({
    color: '#5a6b3c',
    roughness: 0.95,
  });
  private readonly grassMaterial = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
  });

  private readonly variants: IClumpVariant[] = this.buildVariants();
  private readonly groundMeshes: Mesh[] = [];
  private readonly grassMeshes: InstancedMesh[] = [];
  private readonly cells: IGrassScatterCell[] = [];
  private readonly windHandle: IScatterWindHandle;
  private readonly scatterStreaming = inject(ScatterStreamingService);
  private readonly scratchDirection = new Vector3();
  private viewpointWorldM: ScatterStreamingViewpoint = [0, 4, 12];
  private cullForward: readonly [number, number, number] = [0, 0, -1];

  constructor() {
    const destroyRef = inject(DestroyRef);
    const previousBackground = this.engine.scene.background;
    this.engine.scene.background = new Color('#bcd8ea');

    this.windHandle = enableScatterWindSway(this.grassMaterial, GRASS_WIND);

    this.buildTerrain();
    this.scatterStreaming.setMovementThresholdM(GRASS_STREAMING_MOVEMENT_THRESHOLD_M);
    // BehaviorSubject — fires immediately with the starting camera position,
    // which does the field's first (and only startup) grass build. While
    // culling is frozen, skip both the viewpoint update and the rebuild —
    // same "just stop refreshing" trick cdlod-terrain-lab uses to let the
    // camera roam freely while inspecting an already-culled boundary.
    this.scatterStreaming.viewpointWorldM$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe((viewpointWorldM) => {
        if (this.cullingFrozen()) return;
        this.viewpointWorldM = viewpointWorldM;
        this.captureCullForwardDirection();
        this.rebuildGrass(this.density());
      });

    this.engine.elapsedTime$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe((elapsedTimeS) => this.windHandle.setTimeS(elapsedTimeS));

    destroyRef.onDestroy(() => {
      for (const mesh of this.groundMeshes) {
        mesh.removeFromParent();
        mesh.geometry.dispose();
      }
      for (const mesh of this.grassMeshes) {
        mesh.removeFromParent();
      }
      for (const variant of this.variants) variant.geometry.dispose();
      this.groundMaterial.dispose();
      this.grassMaterial.dispose();
      this.engine.scene.background = previousBackground;
    });
  }

  setDensity(value: number | string): void {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    const clamped = Math.max(0.05, Math.min(GRASS_DENSITY_MULTIPLIER_MAX, parsed));
    this.density.set(clamped);
    this.rebuildGrass(clamped);
  }

  setGustAmplitude(value: number | string): void {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    const clamped = Math.max(0, Math.min(GRASS_GUST_AMPLITUDE_MAX, parsed));
    this.gustAmplitude.set(clamped);
    this.windHandle.setGustAmplitude(clamped);
  }

  setGustWavelength(value: number | string): void {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    const clamped = Math.max(
      GRASS_GUST_WAVELENGTH_MIN_M,
      Math.min(GRASS_GUST_WAVELENGTH_MAX_M, parsed),
    );
    this.gustWavelengthM.set(clamped);
    this.windHandle.setGustWavelengthM(clamped);
  }

  setGustDriftSpeed(value: number | string): void {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    const clamped = Math.max(
      GRASS_GUST_DRIFT_SPEED_MIN_MS,
      Math.min(GRASS_GUST_DRIFT_SPEED_MAX_MS, parsed),
    );
    this.gustDriftSpeedMS.set(clamped);
    this.windHandle.setGustDriftSpeedMS(clamped);
  }

  setViewDistance(value: number | string): void {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    const clamped = Math.max(GRASS_VIEW_DISTANCE_MIN_M, Math.min(GRASS_VIEW_DISTANCE_MAX_M, parsed));
    this.viewDistanceM.set(clamped);
    this.rebuildGrass(this.density());
  }

  setCullBehindCamera(enabled: boolean): void {
    this.cullBehindCamera.set(enabled);
    this.rebuildGrass(this.density());
  }

  setCullingFrozen(enabled: boolean): void {
    this.cullingFrozen.set(enabled);
    // Force a fresh viewpoint/forward-direction capture and rebuild on
    // unfreeze — otherwise nothing happens until the camera next moves past
    // the streaming movement threshold, which reads as unresponsive.
    if (!enabled) this.scatterStreaming.update(true);
  }

  private buildVariants(): IClumpVariant[] {
    const variants: IClumpVariant[] = [];
    for (let i = 0; i < CLUMP_VARIANT_COUNT; i++) {
      const seed = CLUMP_BASE_SEED + i;
      const { geometry } = buildGroundCoverClumpMesh(GROUND_COVER_MEADOW_GRASS_ARCHETYPE, seed);
      this.colorizeByHeight(geometry);
      variants.push({ geometry });
    }
    return variants;
  }

  private colorizeByHeight(geometry: BufferGeometry): void {
    const height01 = geometry.getAttribute('height01');
    const colors = new Float32Array(height01.count * 3);
    const blended = new Color();
    for (let i = 0; i < height01.count; i++) {
      blended.copy(GRASS_BASE_COLOR).lerp(GRASS_TIP_COLOR, height01.getX(i));
      colors[i * 3] = blended.r;
      colors[i * 3 + 1] = blended.g;
      colors[i * 3 + 2] = blended.b;
    }
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  }

  private variantIndexForInstance(instanceId: string): number {
    return hashProceduralKey(instanceId) % CLUMP_VARIANT_COUNT;
  }

  private captureCullForwardDirection(): void {
    // Already unit length — no degenerate/near-zero case to guard, unlike
    // an XZ-only projection of this same vector would need.
    this.engine.camera.getWorldDirection(this.scratchDirection);
    this.cullForward = [
      this.scratchDirection.x,
      this.scratchDirection.y,
      this.scratchDirection.z,
    ];
  }

  /** 1 inside the forward cone (or culling disabled), 0 outside it — the "pizza slice" cut, applied per-candidate for a smooth boundary. Full 3D angle test, so it correctly follows camera pitch (looking down/up), not just yaw. */
  private viewConeSuitability(worldPositionM: TerrainVector3): number {
    const dx = worldPositionM[0] - this.viewpointWorldM[0];
    const dy = worldPositionM[1] - this.viewpointWorldM[1];
    const dz = worldPositionM[2] - this.viewpointWorldM[2];
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 0.5) return 1;
    const cosAngle =
      (dx * this.cullForward[0] + dy * this.cullForward[1] + dz * this.cullForward[2]) / dist;
    return cosAngle >= GRASS_VIEW_CONE_COS_HALF_ANGLE ? 1 : 0;
  }

  private buildTerrain(): void {
    const roots: IPlaneTerrainPatchAddress[] = [];
    for (let z = -GRID_RADIUS; z <= GRID_RADIUS; z++) {
      for (let x = -GRID_RADIUS; x <= GRID_RADIUS; x++) {
        roots.push({ level: 0, x, z });
      }
    }

    let cellCount = 0;

    for (const address of roots) {
      const patch = generateTerrainPatchMesh(this.field, this.domain, {
        address,
        resolution: TERRAIN_RESOLUTION,
      });
      const groundMesh = this.buildGroundMesh(patch);
      this.groundMeshes.push(groundMesh);
      this.engine.scene.add(groundMesh);

      const cellAddresses = selectFixedLevelScatterCells(this.domain, {
        roots: [address],
        anchorWorldM: [0, 0, 0],
        radiusM: SCATTER_SELECT_RADIUS_M,
        fixedLevel: address.level + SCATTER_FIXED_LEVEL_DEPTH,
        getLevel: (a) => a.level,
      });
      cellCount += cellAddresses.length;

      for (const cellAddress of cellAddresses) {
        this.cells.push({
          address: cellAddress,
          cellKey: `plane:${cellAddress.level}:${cellAddress.x}:${cellAddress.z}`,
        });
      }
    }

    this.cellCount.set(cellCount);
  }

  /**
   * Re-runs placement + instancing only — terrain and cell addresses (built
   * once in buildTerrain) stay fixed as density changes. `densityMultiplier`
   * above 1x grows the candidate pool itself (baseDensity01 pins at 1, fully
   * accepting it) since baseDensity01 alone can only thin the base pool, not
   * exceed it. Also re-runs whenever the camera moves past the streaming
   * service's movement threshold, so `distanceFade` keeps thinning relative
   * to the *current* viewpoint rather than a startup snapshot.
   */
  private rebuildGrass(densityMultiplier: number): void {
    for (const mesh of this.grassMeshes) mesh.removeFromParent();
    this.grassMeshes.length = 0;

    const candidatePoolSize = Math.max(
      1,
      Math.round(GRASS_CANDIDATE_POOL_SIZE_BASE * Math.max(1, densityMultiplier)),
    );
    const baseDensity01 = Math.min(1, densityMultiplier);
    const fadeEndM = this.viewDistanceM();
    const fadeStartM = fadeEndM * GRASS_FADE_START_RATIO;

    const instancesByVariant: ITerrainScatterInstance[][] = Array.from(
      { length: CLUMP_VARIANT_COUNT },
      () => [],
    );
    let grassInstanceCount = 0;

    for (const cell of this.cells) {
      const instances = generateTerrainScatterInstances({
        field: this.field,
        domain: this.domain,
        cellAddress: cell.address,
        cellKey: cell.cellKey,
        identity: {
          worldSeed: WORLD_SEED,
          layerId: GRASS_LAYER_ID,
          speciesId: GRASS_SPECIES_ID,
          generatorVersion: GRASS_GENERATOR_VERSION,
        },
        candidatePoolSize,
        rules: GRASS_RULES,
        baseDensity01,
        distanceFade: {
          viewpointWorldM: this.viewpointWorldM,
          fadeStartM,
          fadeEndM,
        },
        suitability: this.cullBehindCamera()
          ? (s) => this.viewConeSuitability(s.worldPositionM)
          : undefined,
      });

      for (const instance of instances) {
        const variantIndex = this.variantIndexForInstance(instance.instanceId);
        instancesByVariant[variantIndex].push(instance);
        grassInstanceCount++;
      }
    }

    for (let i = 0; i < CLUMP_VARIANT_COUNT; i++) {
      const instances = instancesByVariant[i];
      if (instances.length === 0) continue;
      const mesh = buildScatterInstancedMesh({
        instances,
        geometry: this.variants[i].geometry,
        material: this.grassMaterial,
        rules: GRASS_RULES,
        scale: GRASS_SCALE,
        anchorWorldM: [0, 0, 0],
        castShadow: false,
      });
      this.engine.scene.add(mesh);
      this.grassMeshes.push(mesh);
    }

    this.grassInstanceCount.set(grassInstanceCount);
  }

  private buildGroundMesh(patch: ITerrainPatchMesh<IPlaneTerrainPatchAddress>): Mesh {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(patch.surface.positions, 3));
    geometry.setAttribute('normal', new BufferAttribute(patch.surface.normals, 3));
    geometry.setIndex(new BufferAttribute(patch.surface.indices, 1));
    const mesh = new Mesh(geometry, this.groundMaterial);
    mesh.receiveShadow = true;
    mesh.position.set(patch.centerWorldM[0], patch.centerWorldM[1], patch.centerWorldM[2]);
    return mesh;
  }
}
