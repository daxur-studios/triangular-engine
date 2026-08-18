import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Raycaster,
  Vector2,
  Vector3,
  type Vector3Tuple,
} from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import {
  GROUND_COVER_MEADOW_GRASS_ARCHETYPE,
  GROUND_COVER_MEADOW_GRASS_COLORS,
  GROUND_COVER_WILDFLOWER_ARCHETYPE,
  GROUND_COVER_WILDFLOWER_COLORS,
  buildGroundCoverClumpMesh,
  hashProceduralKey,
  type IGroundCoverArchetype,
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
  type IScatterExclusionZone,
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
 * above 1x scale the pool itself instead, see rebuildVegetation().
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
/**
 * Circular no-grass zones (docs/runbook/018) — a building footprint stand-in.
 * World-space distance test, so it works unmodified on all three shapes;
 * a rectangle was considered and deferred (needs a per-shape surface-local
 * basis, a real problem the circle sidesteps). `featherM` gives the edge a
 * soft ramp instead of a hard crop, matching distanceFade's visual language.
 */
const GRASS_EXCLUSION_RADIUS_M = 2.5;
const GRASS_EXCLUSION_FEATHER_M = 0.6;

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

/**
 * Second scatter species, proving a scatter layer isn't grass-specific: same
 * archetype schema (`IGroundCoverArchetype`), same clump-mesh builder, same
 * placement/culling/exclusion pipeline as grass — only the archetype
 * (including its `head` bloom, a real two-crossed-quad shape at each stem's
 * tip, not just a tinted blade end), colors, and density differ. Wildflowers
 * use a much smaller candidate pool than grass (below) so they read as
 * sparse accents through the field rather than a second dense layer, and
 * deliberately reuse `GRASS_WIND` (see the wind handles in the constructor)
 * so one set of gust controls visibly drives both species — the "wind
 * should be shared across systems" idea from docs/runbook/018's design
 * trace, demonstrated rather than built out.
 */
const WILDFLOWER_LAYER_ID = 'meadow-wildflower';
const WILDFLOWER_SPECIES_ID = GROUND_COVER_WILDFLOWER_ARCHETYPE.id;
const WILDFLOWER_GENERATOR_VERSION = 1;
const WILDFLOWER_CANDIDATE_POOL_SIZE_BASE = 3;
const WILDFLOWER_SCALE: ScatterScaleRange = { min: 0.85, max: 1.25 };
const WILDFLOWER_VARIANT_COUNT = 3;
const WILDFLOWER_BASE_SEED = 101;

const WILDFLOWER_BASE_COLOR = new Color(GROUND_COVER_WILDFLOWER_COLORS.baseHex);
const WILDFLOWER_TIP_COLOR = new Color(GROUND_COVER_WILDFLOWER_COLORS.tipHex);
const WILDFLOWER_HEAD_COLOR = new Color(GROUND_COVER_WILDFLOWER_COLORS.headHex);

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
 * Slice 7 adds wildflowers as a second scatter species (`WILDFLOWER_*`
 * constants above) sharing this page's terrain/placement/culling/exclusion
 * pipeline with grass — same archetype schema, same clump-mesh builder, same
 * per-cell instancing, only the archetype, colors, density, and scale range
 * differ. Its own `speciesId`/`layerId` gives it an independent deterministic
 * candidate stream from grass, so the two interleave instead of competing for
 * the same points, and both wind handles share `GRASS_WIND` so one set of
 * gust controls visibly drives both. Slice 6 adds click-to-place circular no-grass zones
 * (`scatter/core/scatter-exclusion`, docs/runbook/018) — a stand-in for
 * "no grass under a building" — composing with the existing distance fade
 * and view cull. Slice 5 switches the demo between a flat plane, a sphere,
 * and the inside of a cylinder (`selectShape`), with terrain generation,
 * scatter placement, and camera-aware culling all working unmodified
 * across all three — placement was already shape-agnostic
 * (`sampleTerrainSurface`); culling became shape-agnostic that slice once
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
  readonly wildflowerInstanceCount = signal(0);
  readonly cellCount = signal(0);
  readonly variantCount = CLUMP_VARIANT_COUNT;
  readonly wildflowerVariantCount = WILDFLOWER_VARIANT_COUNT;
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
  readonly placingZone = signal(false);
  readonly exclusionZoneCount = signal(0);

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
  private readonly wildflowerMaterial = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
  });
  private readonly exclusionMarkerGeometry = new CircleGeometry(GRASS_EXCLUSION_RADIUS_M, 24);
  private readonly exclusionMarkerMaterial = new MeshBasicMaterial({
    color: '#c96a3a',
    transparent: true,
    opacity: 0.35,
    side: DoubleSide,
    depthWrite: false,
  });

  private readonly grassVariants: IClumpVariant[] = this.buildVariants(
    GROUND_COVER_MEADOW_GRASS_ARCHETYPE,
    CLUMP_VARIANT_COUNT,
    CLUMP_BASE_SEED,
    GRASS_BASE_COLOR,
    GRASS_TIP_COLOR,
  );
  private readonly wildflowerVariants: IClumpVariant[] = this.buildVariants(
    GROUND_COVER_WILDFLOWER_ARCHETYPE,
    WILDFLOWER_VARIANT_COUNT,
    WILDFLOWER_BASE_SEED,
    WILDFLOWER_BASE_COLOR,
    WILDFLOWER_TIP_COLOR,
    WILDFLOWER_HEAD_COLOR,
  );
  private readonly groundMeshes: Mesh[] = [];
  private readonly grassMeshes: InstancedMesh[] = [];
  private readonly wildflowerMeshes: InstancedMesh[] = [];
  private readonly cells: IGrassScatterCell[] = [];
  private readonly exclusionZones: IScatterExclusionZone[] = [];
  private readonly exclusionMarkerMeshes: Mesh[] = [];
  private readonly pickRaycaster = new Raycaster();
  private readonly grassWindHandle: IScatterWindHandle;
  private readonly wildflowerWindHandle: IScatterWindHandle;
  private readonly scatterStreaming = inject(ScatterStreamingService);
  private fixture!: IMeadowLabShapeFixture;
  private viewpointWorldM: ScatterStreamingViewpoint = [0, 4, 12];
  private viewForwardM: readonly [number, number, number] = [0, 0, -1];

  constructor() {
    const destroyRef = inject(DestroyRef);
    const previousBackground = this.engine.scene.background;
    this.engine.scene.background = new Color('#bcd8ea');

    // Both species enable wind sway off the same GRASS_WIND definition —
    // deliberately shared, not just parallel: setGustAmplitude/etc below
    // apply to both handles, so one set of controls visibly drives both.
    this.grassWindHandle = enableScatterWindSway(this.grassMaterial, GRASS_WIND);
    this.wildflowerWindHandle = enableScatterWindSway(this.wildflowerMaterial, GRASS_WIND);

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
        this.rebuildVegetation(this.density());
      });

    this.engine.elapsedTime$.pipe(takeUntilDestroyed(destroyRef)).subscribe((elapsedTimeS) => {
      this.grassWindHandle.setTimeS(elapsedTimeS);
      this.wildflowerWindHandle.setTimeS(elapsedTimeS);
    });

    this.engine.click$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe((event) => this.onGroundClick(event));

    destroyRef.onDestroy(() => {
      for (const mesh of this.groundMeshes) {
        mesh.removeFromParent();
        mesh.geometry.dispose();
      }
      for (const mesh of this.grassMeshes) {
        mesh.removeFromParent();
      }
      for (const mesh of this.wildflowerMeshes) {
        mesh.removeFromParent();
      }
      for (const mesh of this.exclusionMarkerMeshes) {
        mesh.removeFromParent();
      }
      for (const variant of this.grassVariants) variant.geometry.dispose();
      for (const variant of this.wildflowerVariants) variant.geometry.dispose();
      this.groundMaterial.dispose();
      this.grassMaterial.dispose();
      this.wildflowerMaterial.dispose();
      this.exclusionMarkerGeometry.dispose();
      this.exclusionMarkerMaterial.dispose();
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
    this.rebuildVegetation(clamped);
  }

  setGustAmplitude(value: number | string): void {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    const clamped = Math.max(0, Math.min(GRASS_GUST_AMPLITUDE_MAX, parsed));
    this.gustAmplitude.set(clamped);
    this.grassWindHandle.setGustAmplitude(clamped);
    this.wildflowerWindHandle.setGustAmplitude(clamped);
  }

  setGustWavelength(value: number | string): void {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    const clamped = Math.max(
      GRASS_GUST_WAVELENGTH_MIN_M,
      Math.min(GRASS_GUST_WAVELENGTH_MAX_M, parsed),
    );
    this.gustWavelengthM.set(clamped);
    this.grassWindHandle.setGustWavelengthM(clamped);
    this.wildflowerWindHandle.setGustWavelengthM(clamped);
  }

  setGustDriftSpeed(value: number | string): void {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    const clamped = Math.max(
      GRASS_GUST_DRIFT_SPEED_MIN_MS,
      Math.min(GRASS_GUST_DRIFT_SPEED_MAX_MS, parsed),
    );
    this.gustDriftSpeedMS.set(clamped);
    this.grassWindHandle.setGustDriftSpeedMS(clamped);
    this.wildflowerWindHandle.setGustDriftSpeedMS(clamped);
  }

  setViewDistance(value: number | string): void {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    const clamped = Math.max(GRASS_VIEW_DISTANCE_MIN_M, Math.min(GRASS_VIEW_DISTANCE_MAX_M, parsed));
    this.viewDistanceM.set(clamped);
    this.rebuildVegetation(this.density());
  }

  setCullBehindCamera(enabled: boolean): void {
    this.cullBehindCamera.set(enabled);
    this.rebuildVegetation(this.density());
  }

  setCullingFrozen(enabled: boolean): void {
    this.cullingFrozen.set(enabled);
    // Force a fresh viewpoint/forward-direction capture and rebuild on
    // unfreeze — otherwise nothing happens until the camera next moves past
    // the streaming movement threshold, which reads as unresponsive.
    if (!enabled) this.scatterStreaming.update(true);
  }

  setPlacingZone(enabled: boolean): void {
    this.placingZone.set(enabled);
  }

  clearExclusionZones(): void {
    this.disposeExclusionZones();
    this.rebuildVegetation(this.density());
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

  /** Species-agnostic: any `IGroundCoverArchetype` + color set builds its own variant set the same way. `headColor` only matters when the archetype defines `head`. */
  private buildVariants(
    archetype: IGroundCoverArchetype,
    variantCount: number,
    baseSeed: number,
    baseColor: Color,
    tipColor: Color,
    headColor?: Color,
  ): IClumpVariant[] {
    const variants: IClumpVariant[] = [];
    for (let i = 0; i < variantCount; i++) {
      const seed = baseSeed + i;
      const { geometry } = buildGroundCoverClumpMesh(archetype, seed);
      this.colorizeByHeight(geometry, baseColor, tipColor, headColor);
      variants.push({ geometry });
    }
    return variants;
  }

  /** Head-bloom vertices (`headMix01` === 1, see ground-cover-clump-mesh) get a fixed `headColor` instead of the base/tip gradient — that's what makes the bloom read as a distinct color, not just a gradient endpoint. */
  private colorizeByHeight(
    geometry: BufferGeometry,
    baseColor: Color,
    tipColor: Color,
    headColor?: Color,
  ): void {
    const height01 = geometry.getAttribute('height01');
    const headMix01 = geometry.getAttribute('headMix01');
    const colors = new Float32Array(height01.count * 3);
    const blended = new Color();
    for (let i = 0; i < height01.count; i++) {
      if (headColor && headMix01 && headMix01.getX(i) >= 0.5) {
        blended.copy(headColor);
      } else {
        blended.copy(baseColor).lerp(tipColor, height01.getX(i));
      }
      colors[i * 3] = blended.r;
      colors[i * 3 + 1] = blended.g;
      colors[i * 3 + 2] = blended.b;
    }
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  }

  private variantIndexForInstance(instanceId: string, variantCount: number): number {
    return hashProceduralKey(instanceId) % variantCount;
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

  /** Raycasts a click against the ground meshes and drops a no-grass zone there — only while `placingZone()` is on, same NDC-from-offsetX/Y pattern flora-affordance-lab/scatter-physics-lab use for instance picking. */
  private onGroundClick(event: MouseEvent | null): void {
    if (!event || !this.placingZone() || this.groundMeshes.length === 0) return;
    const resolution = this.engine.resolution$.value;
    const mouseNdc = new Vector2(
      (event.offsetX / resolution.width) * 2 - 1,
      -(event.offsetY / resolution.height) * 2 + 1,
    );
    this.pickRaycaster.setFromCamera(mouseNdc, this.engine.camera);
    const hits = this.pickRaycaster.intersectObjects(this.groundMeshes, false);
    if (hits.length === 0) return;
    const { x, y, z } = hits[0].point;
    this.addExclusionZone([x, y, z]);
  }

  private addExclusionZone(centerWorldM: TerrainVector3): void {
    this.exclusionZones.push({
      centerWorldM,
      radiusM: GRASS_EXCLUSION_RADIUS_M,
      featherM: GRASS_EXCLUSION_FEATHER_M,
    });
    this.exclusionZoneCount.set(this.exclusionZones.length);
    this.addExclusionMarker(centerWorldM);
    this.rebuildVegetation(this.density());
  }

  /** Flat translucent disc, oriented to the shape-appropriate surface "up" at that point so it lies flush against the ground on all three shapes. */
  private addExclusionMarker(centerWorldM: TerrainVector3): void {
    const marker = new Mesh(this.exclusionMarkerGeometry, this.exclusionMarkerMaterial);
    const up = this.computeZoneUpVector(centerWorldM);
    marker.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(up[0], up[1], up[2]));
    const offsetM = 0.03; // avoid z-fighting with the ground mesh
    marker.position.set(
      centerWorldM[0] + up[0] * offsetM,
      centerWorldM[1] + up[1] * offsetM,
      centerWorldM[2] + up[2] * offsetM,
    );
    this.engine.scene.add(marker);
    this.exclusionMarkerMeshes.push(marker);
  }

  /** Plane: world +Y. Sphere: direction from the origin (its center). Cylinder: radial direction from the world-X axis — same conventions setCameraForShape/the shape fixtures use. */
  private computeZoneUpVector(pointWorldM: TerrainVector3): TerrainVector3 {
    if (this.shape() === 'plane') return [0, 1, 0];
    if (this.shape() === 'sphere') {
      const lengthM = Math.hypot(pointWorldM[0], pointWorldM[1], pointWorldM[2]) || 1;
      return [pointWorldM[0] / lengthM, pointWorldM[1] / lengthM, pointWorldM[2] / lengthM];
    }
    const lengthM = Math.hypot(pointWorldM[1], pointWorldM[2]) || 1;
    return [0, pointWorldM[1] / lengthM, pointWorldM[2] / lengthM];
  }

  /** Clears zone state + markers without rebuilding — callers that are about to rebuild anyway (teardownTerrain) skip the redundant rebuildVegetation that clearExclusionZones() (the UI-facing version) does. */
  private disposeExclusionZones(): void {
    this.exclusionZones.length = 0;
    this.exclusionZoneCount.set(0);
    for (const mesh of this.exclusionMarkerMeshes) mesh.removeFromParent();
    this.exclusionMarkerMeshes.length = 0;
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

  /**
   * Disposes the current shape's ground meshes, clears streaming cells, and
   * clears no-grass zones — grass clump variant geometries are
   * shape-independent and are never touched here. Zones are world-space
   * points that only mean something relative to the shape/radius they were
   * placed on, so they're invalidated the same moment the terrain under
   * them is.
   */
  private teardownTerrain(): void {
    for (const mesh of this.groundMeshes) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
    }
    this.groundMeshes.length = 0;
    this.cells.length = 0;
    this.disposeExclusionZones();
  }

  /** Full teardown/rebuild for a shape switch or a fixture-affecting slider (sphere radius) — terrain, cells, and vegetation all regenerate from the current fixture. */
  private rebuildWorld(): void {
    this.teardownTerrain();
    this.buildTerrain();
    this.rebuildVegetation(this.density());
  }

  /**
   * Re-runs placement + instancing for both scatter species — terrain and
   * cell addresses (built once in buildTerrain, or on a shape switch via
   * rebuildWorld) stay fixed as density changes. `densityMultiplier` above 1x
   * grows each species' candidate pool itself (baseDensity01 pins at 1, fully
   * accepting it) since baseDensity01 alone can only thin the base pool, not
   * exceed it — wildflowers use the same derivation off a much smaller base
   * pool (WILDFLOWER_CANDIDATE_POOL_SIZE_BASE), so they scale with the same
   * slider but stay sparse relative to grass at every density level. Also
   * re-runs whenever the camera moves past the streaming service's movement
   * threshold, so `distanceFade`/`viewCull` keep tracking the *current*
   * viewpoint rather than a startup snapshot. distanceFade/viewCull/exclusion
   * are computed once (they don't depend on the cell or the species) and
   * reused for both `generateTerrainScatterInstances` calls per cell.
   */
  private rebuildVegetation(densityMultiplier: number): void {
    for (const mesh of this.grassMeshes) mesh.removeFromParent();
    this.grassMeshes.length = 0;
    for (const mesh of this.wildflowerMeshes) mesh.removeFromParent();
    this.wildflowerMeshes.length = 0;

    const grassCandidatePoolSize = Math.max(
      1,
      Math.round(GRASS_CANDIDATE_POOL_SIZE_BASE * Math.max(1, densityMultiplier)),
    );
    const wildflowerCandidatePoolSize = Math.max(
      1,
      Math.round(WILDFLOWER_CANDIDATE_POOL_SIZE_BASE * Math.max(1, densityMultiplier)),
    );
    const baseDensity01 = Math.min(1, densityMultiplier);
    const fadeEndM = this.viewDistanceM();
    const fadeStartM = fadeEndM * GRASS_FADE_START_RATIO;
    const distanceFade = { viewpointWorldM: this.viewpointWorldM, fadeStartM, fadeEndM };
    const viewCull = this.cullBehindCamera()
      ? {
          viewpointWorldM: this.viewpointWorldM,
          viewForwardM: this.viewForwardM,
          coneHalfAngleRad: GRASS_VIEW_CONE_HALF_ANGLE_RAD,
          objectRadiusM: GRASS_OBJECT_RADIUS_M,
          horizon:
            this.shape() === 'sphere'
              ? { curvatureCenterWorldM: [0, 0, 0] as TerrainVector3, curvatureRadiusM: this.sphereRadiusM() }
              : undefined,
        }
      : undefined;
    const exclusion = this.exclusionZones.length > 0 ? this.exclusionZones : undefined;

    const grassByVariant: ITerrainScatterInstance[][] = Array.from(
      { length: CLUMP_VARIANT_COUNT },
      () => [],
    );
    const wildflowerByVariant: ITerrainScatterInstance[][] = Array.from(
      { length: WILDFLOWER_VARIANT_COUNT },
      () => [],
    );
    let grassInstanceCount = 0;
    let wildflowerInstanceCount = 0;

    for (const cell of this.cells) {
      const grassInstances = generateTerrainScatterInstances({
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
        candidatePoolSize: grassCandidatePoolSize,
        rules: GRASS_RULES,
        baseDensity01,
        distanceFade,
        viewCull,
        exclusion,
      });
      for (const instance of grassInstances) {
        const variantIndex = this.variantIndexForInstance(instance.instanceId, CLUMP_VARIANT_COUNT);
        grassByVariant[variantIndex].push(instance);
        grassInstanceCount++;
      }

      // Different speciesId (and layerId) means a different deterministic
      // candidate stream — wildflowers naturally interleave with grass
      // instead of competing for the exact same candidate points.
      const wildflowerInstances = generateTerrainScatterInstances({
        field: this.fixture.field,
        domain: this.fixture.domain as never,
        cellAddress: cell.address as never,
        cellKey: cell.cellKey,
        identity: {
          worldSeed: WORLD_SEED,
          layerId: WILDFLOWER_LAYER_ID,
          speciesId: WILDFLOWER_SPECIES_ID,
          generatorVersion: WILDFLOWER_GENERATOR_VERSION,
        },
        candidatePoolSize: wildflowerCandidatePoolSize,
        rules: GRASS_RULES,
        baseDensity01,
        distanceFade,
        viewCull,
        exclusion,
      });
      for (const instance of wildflowerInstances) {
        const variantIndex = this.variantIndexForInstance(instance.instanceId, WILDFLOWER_VARIANT_COUNT);
        wildflowerByVariant[variantIndex].push(instance);
        wildflowerInstanceCount++;
      }
    }

    for (let i = 0; i < CLUMP_VARIANT_COUNT; i++) {
      const instances = grassByVariant[i];
      if (instances.length === 0) continue;
      const mesh = buildScatterInstancedMesh({
        instances,
        geometry: this.grassVariants[i].geometry,
        material: this.grassMaterial,
        rules: GRASS_RULES,
        scale: GRASS_SCALE,
        anchorWorldM: [0, 0, 0],
        castShadow: false,
      });
      this.engine.scene.add(mesh);
      this.grassMeshes.push(mesh);
    }

    for (let i = 0; i < WILDFLOWER_VARIANT_COUNT; i++) {
      const instances = wildflowerByVariant[i];
      if (instances.length === 0) continue;
      const mesh = buildScatterInstancedMesh({
        instances,
        geometry: this.wildflowerVariants[i].geometry,
        material: this.wildflowerMaterial,
        rules: GRASS_RULES,
        scale: WILDFLOWER_SCALE,
        anchorWorldM: [0, 0, 0],
        castShadow: false,
      });
      this.engine.scene.add(mesh);
      this.wildflowerMeshes.push(mesh);
    }

    this.grassInstanceCount.set(grassInstanceCount);
    this.wildflowerInstanceCount.set(wildflowerInstanceCount);
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
