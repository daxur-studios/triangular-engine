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
  CylinderTerrainDomain,
  generateTerrainPatchMesh,
  PlaneTerrainDomain,
  SPHERE_TERRAIN_FACES,
  SphereTerrainDomain,
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

type MeadowLabShape = 'plane' | 'sphere' | 'cylinder';

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

/**
 * Small planet by design — the whole point of a radius slider is to make
 * sphere-curvature horizon occlusion (see GRASS_VIEW_CONE_HALF_ANGLE_RAD's
 * neighbour below) visible on foot within a few seconds of walking, not to
 * simulate a realistic planet.
 */
const GRASS_SPHERE_RADIUS_DEFAULT_M = 25;
const GRASS_SPHERE_RADIUS_MIN_M = 10;
const GRASS_SPHERE_RADIUS_MAX_M = 150;
/**
 * Fixed, unlike the sphere — the ask that motivated a radius slider was
 * specifically about small *spheres*; the cylinder has no horizon test to
 * tune against (see docs/runbook/017), so a slider here would just be
 * another control with nothing new to demonstrate.
 */
const GRASS_CYLINDER_RADIUS_M = 20;
const GRASS_CYLINDER_LENGTH_M = 60;
const GRASS_CYLINDER_ANGULAR_PATCHES = 6;
const GRASS_CYLINDER_AXIAL_PATCHES = 3;

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
 * The math itself now lives in `scatter/core/scatter-view-cull` (promoted
 * out of this page — see docs/runbook/017) as a full 3D angle test: the
 * full 3D direction to each candidate against the full 3D camera-forward
 * vector, not an XZ-only/horizontal approximation. That matters for two
 * reasons: it correctly narrows/rotates the cone when the camera pitches up
 * or down (an XZ-only version stays blind to pitch, so looking straight
 * down neither adds the downward view nor drops what's now behind-and-
 * below — a symmetric cone pointed straight down at flat ground reads as a
 * circle around the point below the camera, which is correct, not a bug),
 * and it makes the test viewer-relative only, with no assumption about
 * which axis is "up" or "horizontal" — so it works unmodified on the
 * sphere/cylinder shapes below, not just this flat plane.
 */
const GRASS_VIEW_CONE_HALF_ANGLE_RAD = 1.31; // ~75°, conservative half-angle
/**
 * Widens both the cone and (on the sphere) horizon boundary so a clump near
 * the edge isn't dropped just because its single anchor point tests
 * outside — grass's own rough footprint, not a dramatic demonstration
 * object (a large landmark proving this at scale is a `flora-scatter-lab`
 * follow-up, not this slice — see docs/runbook/017).
 */
const GRASS_OBJECT_RADIUS_M = 0.35;
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

class MeadowLabPlaneField implements ITerrainField {
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

/** `sample`'s input is the unit sphere direction (not world meters) scaled by radiusM into the same field-space `gentleMeadowUndulationM` expects — same convention scatter-lab's SphereScatterField uses. */
class MeadowLabSphereField implements ITerrainField {
  readonly minElevationM = -1.5;
  readonly maxElevationM = 1.5;
  constructor(private readonly radiusM: number) {}

  sample([x, _y, z]: TerrainVector3): ITerrainFieldSample {
    return { elevationM: gentleMeadowUndulationM(x * this.radiusM, z * this.radiusM) };
  }

  sampleBatch(
    positions: Float64Array,
    out = new Float64Array(positions.length / 3),
  ): Float64Array {
    for (let i = 0; i < out.length; i++) {
      out[i] = this.sample([
        positions[i * 3],
        positions[i * 3 + 1],
        positions[i * 3 + 2],
      ]).elevationM;
    }
    return out;
  }
}

/** Axis runs along world X; `sample`'s second/third components are the (radialY, radialZ) point on the circular cross-section, converted to a circumferential field coordinate via atan2 — same convention scatter-lab's CylinderScatterField uses. */
class MeadowLabCylinderField implements ITerrainField {
  readonly minElevationM = -1.5;
  readonly maxElevationM = 1.5;
  constructor(private readonly radiusM: number) {}

  sample([axialM, radialY, radialZ]: TerrainVector3): ITerrainFieldSample {
    const angle = Math.atan2(radialZ, radialY);
    return { elevationM: gentleMeadowUndulationM(axialM, angle * this.radiusM) };
  }

  sampleBatch(
    positions: Float64Array,
    out = new Float64Array(positions.length / 3),
  ): Float64Array {
    for (let i = 0; i < out.length; i++) {
      out[i] = this.sample([
        positions[i * 3],
        positions[i * 3 + 1],
        positions[i * 3 + 2],
      ]).elevationM;
    }
    return out;
  }
}

interface IClumpVariant {
  readonly geometry: BufferGeometry;
}

interface IGrassScatterCell {
  readonly address: unknown;
  readonly cellKey: string;
}

/**
 * One demo-only fixture per shape: reused for both terrain rendering and
 * scatter placement/culling. Mirrors scatter-lab's `IShapeFixture`, minus
 * the bird's-eye-only focus point — meadow-lab's camera always stands near
 * the surface (see setCameraForShape), so the live camera position doubles
 * as the culling/fade viewpoint directly, no separate focus point needed.
 */
interface IMeadowLabShapeFixture {
  readonly domain: {
    getPatchBounds(address: never): {
      minU: number;
      maxU: number;
      minV: number;
      maxV: number;
    };
    getSurfacePosition(
      address: never,
      u: number,
      v: number,
      elevationM: number,
    ): TerrainVector3;
    getChildren(address: never): readonly unknown[];
  };
  readonly field: ITerrainField;
  readonly roots: readonly unknown[];
  readonly getCellKey: (address: unknown) => string;
  readonly getLevel: (address: unknown) => number;
}

/**
 * Slice 5 of the grass work: the demo now switches between a flat plane, a
 * sphere, and the inside of a cylinder (`selectShape`), with terrain
 * generation, scatter placement, and camera-aware culling all working
 * unmodified across all three — placement was already shape-agnostic
 * (`sampleTerrainSurface`); culling became shape-agnostic this slice once
 * promoted into `scatter/core/scatter-view-cull` (full 3D cone test, plus a
 * sphere-only curvature horizon test — see docs/runbook/017). Slice 4's
 * distance fade and directional cone culling, slice 3's curl-noise gust,
 * slice 2's desynced per-instance flutter, and slice 1's density-on-
 * scatter's-pipeline all carry over unchanged underneath.
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
  readonly shape = signal<MeadowLabShape>('plane');
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
  readonly sphereRadiusM = signal(GRASS_SPHERE_RADIUS_DEFAULT_M);
  readonly sphereRadiusMinM = GRASS_SPHERE_RADIUS_MIN_M;
  readonly sphereRadiusMaxM = GRASS_SPHERE_RADIUS_MAX_M;

  readonly initialCameraPosition = signal<Vector3Tuple>([0, 4, 12]);
  readonly initialTarget = signal<Vector3Tuple>([0, 0.3, 0]);

  private readonly engine = inject(EngineService);

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
  private fixture!: IMeadowLabShapeFixture;
  private viewpointWorldM: ScatterStreamingViewpoint = [0, 4, 12];
  private viewForwardM: readonly [number, number, number] = [0, 0, -1];

  constructor() {
    const destroyRef = inject(DestroyRef);
    const previousBackground = this.engine.scene.background;
    this.engine.scene.background = new Color('#bcd8ea');

    this.windHandle = enableScatterWindSway(this.grassMaterial, GRASS_WIND);

    this.fixture = this.getFixture(this.shape());
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
        this.viewForwardM = this.scatterStreaming.viewForwardM;
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

  selectShape(shape: MeadowLabShape): void {
    if (shape === this.shape()) return;
    this.shape.set(shape);
    this.fixture = this.getFixture(shape);
    this.setCameraForShape(shape);
    this.seedViewpointFromCamera(this.initialCameraPosition(), this.initialTarget());
    this.rebuildWorld();
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

  setSphereRadius(value: number | string): void {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    const clamped = Math.max(GRASS_SPHERE_RADIUS_MIN_M, Math.min(GRASS_SPHERE_RADIUS_MAX_M, parsed));
    this.sphereRadiusM.set(clamped);
    if (this.shape() !== 'sphere') return;
    this.fixture = this.getFixture('sphere');
    this.setCameraForShape('sphere');
    this.seedViewpointFromCamera(this.initialCameraPosition(), this.initialTarget());
    this.rebuildWorld();
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

  /**
   * Per-shape terrain domain + field + root addresses + cell-key/level
   * accessors, mirroring `scatter-lab-page.component.ts`'s `getFixture`.
   * Reads `sphereRadiusM()` live so a radius-slider change picks up the
   * latest value without a separate cache-invalidation path.
   */
  private getFixture(shape: MeadowLabShape): IMeadowLabShapeFixture {
    if (shape === 'plane') {
      const domain = new PlaneTerrainDomain(PLANE_PATCH_SIZE_M);
      const roots: IPlaneTerrainPatchAddress[] = [];
      for (let z = -GRID_RADIUS; z <= GRID_RADIUS; z++) {
        for (let x = -GRID_RADIUS; x <= GRID_RADIUS; x++) {
          roots.push({ level: 0, x, z });
        }
      }
      return {
        domain: domain as never,
        field: new MeadowLabPlaneField(),
        roots,
        getCellKey: (a) => {
          const v = a as IPlaneTerrainPatchAddress;
          return `plane:${v.level}:${v.x}:${v.z}`;
        },
        getLevel: (a) => (a as { level: number }).level,
      };
    }
    if (shape === 'sphere') {
      const radiusM = this.sphereRadiusM();
      const domain = new SphereTerrainDomain(radiusM);
      const roots = SPHERE_TERRAIN_FACES.map((face) => ({ face, level: 0, x: 0, y: 0 }));
      return {
        domain: domain as never,
        field: new MeadowLabSphereField(radiusM),
        roots,
        getCellKey: (a) => {
          const v = a as { face: string; level: number; x: number; y: number };
          return `sphere:${v.face}:${v.level}:${v.x}:${v.y}`;
        },
        getLevel: (a) => (a as { level: number }).level,
      };
    }
    const domain = new CylinderTerrainDomain({
      radiusM: GRASS_CYLINDER_RADIUS_M,
      lengthM: GRASS_CYLINDER_LENGTH_M,
      levelZeroAngularPatchCount: GRASS_CYLINDER_ANGULAR_PATCHES,
      levelZeroAxialPatchCount: GRASS_CYLINDER_AXIAL_PATCHES,
    });
    const counts = domain.getPatchCounts(0);
    const roots = Array.from({ length: counts.axial }, (_, axialIndex) =>
      Array.from({ length: counts.angular }, (_unused, angularIndex) => ({
        level: 0,
        angularIndex,
        axialIndex,
      })),
    ).flat();
    return {
      domain: domain as never,
      field: new MeadowLabCylinderField(GRASS_CYLINDER_RADIUS_M),
      roots,
      getCellKey: (a) => {
        const v = a as { level: number; angularIndex: number; axialIndex: number };
        return `cylinder:${v.level}:${v.angularIndex}:${v.axialIndex}`;
      },
      getLevel: (a) => (a as { level: number }).level,
    };
  }

  /**
   * Near-surface standing points that keep the default `+Y` up-vector on
   * every shape (see docs/runbook/017): the sphere's `+Y` pole and the
   * cylinder's `angle = π` point are both surface locations whose local
   * "up" already equals global `+Y`, so no `upVector` template binding is
   * needed — unlike scatter-lab's bird's-eye framing, which deliberately
   * surveys each shape from outside/above instead of standing on it.
   */
  private setCameraForShape(shape: MeadowLabShape): void {
    if (shape === 'plane') {
      this.initialCameraPosition.set([0, 4, 12]);
      this.initialTarget.set([0, 0.3, 0]);
    } else if (shape === 'sphere') {
      const r = this.sphereRadiusM();
      this.initialCameraPosition.set([0, r + 4, 12]);
      this.initialTarget.set([0, r + 0.3, 0]);
    } else {
      const r = GRASS_CYLINDER_RADIUS_M;
      this.initialCameraPosition.set([12, -r + 4, 0]);
      this.initialTarget.set([0, -r + 0.3, 0]);
    }
  }

  /**
   * Seeds viewpoint/forward directly from the camera/target we just set,
   * rather than waiting on the live `engine.camera` — `OrbitControlsComponent`
   * applies `cameraPosition`/`target` input changes via an Angular `effect()`,
   * which doesn't flush synchronously, so reading `engine.camera` right after
   * a shape switch could still see the *previous* shape's stale position.
   * The natural `viewpointWorldM$` subscription re-syncs both fields again
   * once the camera actually settles, so this is only the bridge for the one
   * rebuild that happens immediately on switch.
   */
  private seedViewpointFromCamera(cameraPositionM: Vector3Tuple, targetM: Vector3Tuple): void {
    this.viewpointWorldM = cameraPositionM;
    const dx = targetM[0] - cameraPositionM[0];
    const dy = targetM[1] - cameraPositionM[1];
    const dz = targetM[2] - cameraPositionM[2];
    const lengthM = Math.hypot(dx, dy, dz) || 1;
    this.viewForwardM = [dx / lengthM, dy / lengthM, dz / lengthM];
  }

  private buildTerrain(): void {
    let cellCount = 0;

    for (const address of this.fixture.roots) {
      const patch = generateTerrainPatchMesh(this.fixture.field, this.fixture.domain as never, {
        address: address as never,
        resolution: TERRAIN_RESOLUTION,
      }) as ITerrainPatchMesh<unknown>;
      const groundMesh = this.buildGroundMesh(patch);
      this.groundMeshes.push(groundMesh);
      this.engine.scene.add(groundMesh);

      const cellAddresses = selectFixedLevelScatterCells(this.fixture.domain as never, {
        roots: [address as never],
        anchorWorldM: [0, 0, 0],
        radiusM: SCATTER_SELECT_RADIUS_M,
        fixedLevel: this.fixture.getLevel(address) + SCATTER_FIXED_LEVEL_DEPTH,
        getLevel: this.fixture.getLevel as never,
      });
      cellCount += cellAddresses.length;

      for (const cellAddress of cellAddresses) {
        this.cells.push({
          address: cellAddress,
          cellKey: this.fixture.getCellKey(cellAddress),
        });
      }
    }

    this.cellCount.set(cellCount);
  }

  /** Disposes the current shape's ground meshes and clears streaming cells — grass clump variant geometries are shape-independent and are never touched here. */
  private teardownTerrain(): void {
    for (const mesh of this.groundMeshes) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
    }
    this.groundMeshes.length = 0;
    this.cells.length = 0;
  }

  /** Full teardown/rebuild for a shape switch or a fixture-affecting slider (sphere radius) — terrain, cells, and grass all regenerate from the current fixture. */
  private rebuildWorld(): void {
    this.teardownTerrain();
    this.buildTerrain();
    this.rebuildGrass(this.density());
  }

  /**
   * Re-runs placement + instancing only — terrain and cell addresses (built
   * once in buildTerrain, or on a shape switch via rebuildWorld) stay fixed
   * as density changes. `densityMultiplier` above 1x grows the candidate
   * pool itself (baseDensity01 pins at 1, fully accepting it) since
   * baseDensity01 alone can only thin the base pool, not exceed it. Also
   * re-runs whenever the camera moves past the streaming service's movement
   * threshold, so `distanceFade`/`viewCull` keep tracking the *current*
   * viewpoint rather than a startup snapshot.
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
        field: this.fixture.field,
        domain: this.fixture.domain as never,
        cellAddress: cell.address as never,
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
        viewCull: this.cullBehindCamera()
          ? {
              viewpointWorldM: this.viewpointWorldM,
              viewForwardM: this.viewForwardM,
              coneHalfAngleRad: GRASS_VIEW_CONE_HALF_ANGLE_RAD,
              objectRadiusM: GRASS_OBJECT_RADIUS_M,
              horizon:
                this.shape() === 'sphere'
                  ? { curvatureCenterWorldM: [0, 0, 0], curvatureRadiusM: this.sphereRadiusM() }
                  : undefined,
            }
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

  private buildGroundMesh(patch: ITerrainPatchMesh<unknown>): Mesh {
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
