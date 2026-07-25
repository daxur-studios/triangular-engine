import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  BoxGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
  type Vector3Tuple,
} from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import {
  PostprocessingComposerComponent,
  ToneMappingEffectComponent,
} from 'triangular-engine/postprocessing';
import {
  CylinderTerrainDomain,
  PlaneTerrainDomain,
  SphereTerrainDomain,
  SPHERE_TERRAIN_FACES,
  TerrainSurfaceComponent,
  type ITerrainField,
  type ITerrainFieldSample,
  type ITerrainSurfaceColorContext,
  type ITerrainPatchMesh,
  type ITerrainSurfaceGenerationRequest,
  type TerrainVector3,
} from 'triangular-engine/terrain';
import {
  CylinderWaterDomain,
  PlaneWaterDomain,
  SphereWaterDomain,
  WaterService,
  WaterSurfaceComponent,
  type WaterTracker,
  type WaterMotionPresetName,
  type WaterQualityPresetName,
  type WaterSurfaceDomain,
} from 'triangular-engine/water';
import { WaterUnderwaterEffectComponent } from 'triangular-engine/water/postprocessing';

type DomainKind = 'plane' | 'sphere' | 'cylinder';

interface DemoDomain {
  readonly label: string;
  readonly description: string;
}

const SPHERE_RADIUS = 180;
const CYLINDER_RADIUS = 180;
const CYLINDER_LENGTH = 600;

const DOMAINS: Readonly<Record<DomainKind, DemoDomain>> = {
  plane: {
    label: 'Flat world',
    description:
      'A 1.6 km coast with beaches, sandbars, a continental shelf, and a deep offshore basin.',
  },
  sphere: {
    label: 'Sphere',
    description:
      'A terrain-generated ocean planet with continents, island chains, shelves, trenches, and abyssal basins.',
  },
  cylinder: {
    label: 'Cylinder',
    description: 'Interior ocean on an O’Neill-cylinder wall.',
  },
};

const DOMAIN_KEYS = Object.keys(DOMAINS) as DomainKind[];
const QUALITY_KEYS: readonly WaterQualityPresetName[] = [
  'performance',
  'balanced',
  'cinematic',
];
const MOTION_KEYS: readonly WaterMotionPresetName[] = [
  'calmLake',
  'oceanSwell',
  'storm',
];

@Component({
  selector: 'app-water-page',
  imports: [
    RouterLink,
    EngineModule,
    PostprocessingComposerComponent,
    ToneMappingEffectComponent,
    TerrainSurfaceComponent,
    WaterSurfaceComponent,
    WaterUnderwaterEffectComponent,
  ],
  templateUrl: './water-page.component.html',
  styleUrl: './water-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    EngineService.provide({
      showFPS: true,
      webGLRendererParameters: { logarithmicDepthBuffer: true },
    }),
  ],
  host: { class: 'flex-page' },
})
export class WaterPageComponent {
  readonly domains = DOMAINS;
  readonly domainKeys = DOMAIN_KEYS;
  readonly qualityKeys = QUALITY_KEYS;
  readonly motionKeys = MOTION_KEYS;
  readonly activeDomain = signal<DomainKind>('plane');
  readonly activeQuality = signal<WaterQualityPresetName>('balanced');
  readonly activeMotion = signal<WaterMotionPresetName>('oceanSwell');
  readonly underwaterEnabled = signal(true);
  readonly cameraWaterState = signal('Waiting for a water sample…');
  readonly lastCrossing = signal('None yet');
  readonly crossingCount = signal(0);
  readonly wireframe = signal(false);
  readonly waterHeight = signal(0);
  readonly worldSize = signal(1);
  readonly worldScale = computed(() => 2 ** (this.worldSize() - 1));
  readonly worldSizeDescription = computed(() => {
    const scale = this.worldScale();
    switch (this.activeDomain()) {
      case 'sphere':
        return `adaptive LOD · radius ${SPHERE_RADIUS * scale} m`;
      case 'cylinder':
        return `${8 * scale} × ${4 * scale} root chunks · adaptive LOD`;
      default:
        return `${2 * scale} × ${2 * scale} root chunks · adaptive LOD`;
    }
  });
  readonly relativeUp = signal(true);
  readonly orbitUp = signal<Vector3Tuple>([0, 1, 0]);
  private readonly terrainFields: Record<DomainKind, ITerrainField> = {
    plane: new CoastalTerrainField(),
    sphere: new OceanPlanetTerrainField(),
    cylinder: new CylinderHabitatTerrainField(),
  };
  readonly activeTerrainField = computed(
    () => this.terrainFields[this.activeDomain()],
  );
  readonly activeTerrainDomain = computed(() => {
    const scale = this.worldScale();
    switch (this.activeDomain()) {
      case 'sphere':
        return new SphereTerrainDomain(SPHERE_RADIUS * scale);
      case 'cylinder':
        return new CylinderTerrainDomain({
          radiusM: CYLINDER_RADIUS * scale,
          lengthM: CYLINDER_LENGTH * scale,
          levelZeroAngularPatchCount: 8 * scale,
          levelZeroAxialPatchCount: 4 * scale,
        });
      default:
        return new PlaneTerrainDomain(COAST_PATCH_SIZE_M);
    }
  });
  readonly terrainRoots = computed<readonly any[]>(() => {
    const scale = this.worldScale();
    if (this.activeDomain() === 'sphere') {
      return SPHERE_TERRAIN_FACES.map((face) => ({
        face,
        level: 0,
        x: 0,
        y: 0,
      }));
    }
    if (this.activeDomain() === 'cylinder') {
      const domain = this.activeTerrainDomain() as CylinderTerrainDomain;
      const counts = domain.getPatchCounts(0);
      return Array.from({ length: counts.axial }, (_, axialIndex) =>
        Array.from({ length: counts.angular }, (_unused, angularIndex) => ({
          level: 0,
          angularIndex,
          axialIndex,
        })),
      ).flat();
    }
    const chunksPerSide = 2 * scale;
    const start = -Math.floor(chunksPerSide / 2);
    return Array.from({ length: chunksPerSide }, (_, zOffset) =>
      Array.from({ length: chunksPerSide }, (_unused, xOffset) => ({
        level: 0,
        x: start + xOffset,
        z: start + zOffset,
      })),
    ).flat();
  });
  readonly terrainMaxLod = computed(
    () =>
      TERRAIN_MAX_LOD_LEVEL +
      (this.activeDomain() === 'sphere' ? Math.log2(this.worldScale()) : 0),
  );
  readonly terrainRefinementDistance = computed(() => {
    const scale = this.worldScale();
    if (this.activeDomain() === 'sphere') return 720 * scale;
    if (this.activeDomain() === 'cylinder') return 520 * scale;
    return 1_100 * scale;
  });
  readonly createTerrainMaterial = () =>
    new MeshStandardMaterial({
      color: '#ffffff',
      vertexColors: true,
      roughness: 0.96,
      side: DoubleSide,
    });
  readonly createTerrainColors = (
    context: ITerrainSurfaceColorContext<any>,
  ): Float32Array => {
    const scale = this.worldScale();
    if (this.activeDomain() === 'sphere') {
      return createSphereTerrainColors(
        context.centerWorldM,
        context.surface.positions,
        SPHERE_RADIUS * scale,
      );
    }
    if (this.activeDomain() === 'cylinder') {
      return createCylinderTerrainColors(
        context.centerWorldM,
        context.surface.positions,
        CYLINDER_RADIUS * scale,
      );
    }
    return createTerrainColors(context.surface.positions);
  };
  readonly generateTerrainPatch = (
    request: ITerrainSurfaceGenerationRequest<any>,
  ): Promise<ITerrainPatchMesh<any>> => {
    const id = this.nextTerrainRequestId++;
    return new Promise((resolve, reject) => {
      this.terrainRequests.set(id, { resolve, reject });
      this.terrainWorker.postMessage({
        id,
        kind: this.activeDomain(),
        scale: this.worldScale(),
        address: request.address,
        resolution: request.resolution,
        skirtDepthM: request.skirtDepthM,
      });
    });
  };
  readonly activeWaterDomain = computed<WaterSurfaceDomain>(() => {
    const height = this.waterHeight();
    const scale = this.worldScale();
    switch (this.activeDomain()) {
      case 'sphere':
        return new SphereWaterDomain(SPHERE_RADIUS * scale + height);
      case 'cylinder':
        return new CylinderWaterDomain(
          Math.max(1, CYLINDER_RADIUS * scale - height),
          {
            axis: new Vector3(1, 0, 0),
            lengthM: CYLINDER_LENGTH * scale,
          },
        );
      default:
        return new PlaneWaterDomain({ seaLevelY: height });
    }
  });
  readonly cameraPosition = computed<Vector3Tuple>(() => {
    const scale = this.worldScale();
    switch (this.activeDomain()) {
      case 'sphere': {
        const direction = new Vector3(310, -80, 145).normalize();
        const distance = SPHERE_RADIUS * scale + 170;
        return [
          direction.x * distance,
          direction.y * distance,
          direction.z * distance,
        ];
      }
      case 'cylinder':
        return [-55, CYLINDER_RADIUS * scale - 24, 45];
      default:
        return [-430, 115, 330];
    }
  });
  readonly cameraTarget = computed<Vector3Tuple>(() => {
    const scale = this.worldScale();
    switch (this.activeDomain()) {
      case 'cylinder':
        return [35, CYLINDER_RADIUS * scale, 0];
      case 'plane':
        return [35, -6, -20];
      default:
        return [0, 0, 0];
    }
  });

  private readonly engine = inject(EngineService);
  private readonly water = inject(WaterService);
  private readonly cameraTracker: WaterTracker;
  private readonly waterTestFixtures = createWaterTestFixtures();
  private readonly floatingFixtureAnchor = new Vector3();
  private readonly floatingFixtureRestRotation = new Quaternion();
  private readonly floatingFixtureWaveRotation = new Quaternion();
  private fixtureLayoutKey = '';
  private readonly terrainWorker = new Worker(
    new URL('./water-terrain.worker', import.meta.url),
    { type: 'module' },
  );
  private nextTerrainRequestId = 0;
  private readonly terrainRequests = new Map<
    number,
    {
      resolve: (patch: ITerrainPatchMesh<any>) => void;
      reject: (error: Error) => void;
    }
  >();

  constructor() {
    const destroyRef = inject(DestroyRef);
    // Resolve on every sample: controls/composers may replace the active
    // camera object after this page's constructor has run.
    this.cameraTracker = this.water.track(() => this.engine.camera.position, {
      hysteresis: 0.1,
    });
    const stateSubscription = this.cameraTracker.state$.subscribe((state) => {
      if (!state.sample) {
        this.cameraWaterState.set('Outside registered water');
        return;
      }
      const signed = state.sample.signedDistance;
      this.cameraWaterState.set(
        `${signed < 0 ? 'Below' : 'Above'} · ${Math.abs(signed).toFixed(2)} m from surface`,
      );
    });
    const crossingSubscription = this.cameraTracker.crossings$.subscribe(
      (event) => {
        this.lastCrossing.set(
          `${event.type === 'enter' ? 'Entered' : 'Exited'} water`,
        );
        this.crossingCount.update((count) => count + 1);
      },
    );
    const previousBackground = this.engine.scene.background;
    this.engine.scene.background = new Color('#04121c');
    this.engine.scene.add(this.waterTestFixtures);
    this.terrainWorker.onmessage = ({
      data,
    }: MessageEvent<{
      id: number;
      patch?: ITerrainPatchMesh<any>;
      error?: string;
    }>) => {
      const pending = this.terrainRequests.get(data.id);
      if (!pending) return;
      this.terrainRequests.delete(data.id);
      if (data.patch) pending.resolve(data.patch);
      else pending.reject(new Error(data.error ?? 'Terrain worker failed.'));
    };

    const upSubscription = this.engine.postTick$.subscribe(() => {
      this.updateOrbitUp();
      this.updateWaterTestFixtures();
      this.floatSurfaceFixture();
    });
    this.updateWaterTestFixtures();
    this.floatSurfaceFixture();

    destroyRef.onDestroy(() => {
      stateSubscription.unsubscribe();
      crossingSubscription.unsubscribe();
      this.cameraTracker.dispose();
      upSubscription.unsubscribe();
      this.terrainWorker.terminate();
      for (const { reject } of this.terrainRequests.values()) {
        reject(new Error('Terrain worker was terminated.'));
      }
      this.terrainRequests.clear();
      this.engine.scene.remove(this.waterTestFixtures);
      disposeWaterTestFixtures(this.waterTestFixtures);
      this.engine.scene.background = previousBackground;
    });
  }

  selectDomain(kind: DomainKind): void {
    this.activeDomain.set(kind);
  }

  toggleUnderwater(): void {
    this.underwaterEnabled.update((value) => !value);
  }

  toggleWireframe(): void {
    this.wireframe.update((value) => !value);
  }

  setWaterHeight(input: HTMLInputElement): void {
    this.waterHeight.set(Number(input.value));
  }

  setWorldSize(input: HTMLInputElement): void {
    this.worldSize.set(Number(input.value));
  }

  private updateOrbitUp(): void {
    const kind = this.activeDomain();
    if (!this.relativeUp() || kind === 'plane') {
      this.setOrbitUp([0, 1, 0]);
      return;
    }

    const camera = this.engine.camera.position;
    if (kind === 'sphere') {
      const up = camera.clone().normalize();
      this.setOrbitUp([up.x, up.y, up.z]);
      return;
    }

    // Cylinder gravity points away from the habitat wall and toward its
    // X-axis, so remove the camera's axial component and negate the result.
    const up = new Vector3(0, camera.y, camera.z).normalize().negate();
    this.setOrbitUp([up.x, up.y, up.z]);
  }

  private setOrbitUp(next: Vector3Tuple): void {
    const current = this.orbitUp();
    if (
      Math.abs(current[0] - next[0]) +
        Math.abs(current[1] - next[1]) +
        Math.abs(current[2] - next[2]) >
      0.001
    ) {
      this.orbitUp.set(next);
    }
  }

  private updateWaterTestFixtures(): void {
    const layoutKey = `${this.activeDomain()}:${this.worldScale()}:${this.waterHeight()}`;
    if (layoutKey === this.fixtureLayoutKey) return;
    this.fixtureLayoutKey = layoutKey;

    const domain = this.activeWaterDomain();
    const reference = new Vector3(...this.cameraPosition());
    const frame = domain.getLocalFrame(reference);
    const fixtures = this.waterTestFixtures.children;
    const placements = [
      // A broad crate straddling the mean surface.
      { localX: 40, localZ: -80, height: 1 },
      // A bright marker at snorkelling depth.
      { localX: -100, localZ: 80, height: -8 },
      // A second marker deep enough to make distance fog obvious.
      { localX: -220, localZ: -120, height: -26 },
    ] as const;

    for (let i = 0; i < placements.length; i++) {
      const placement = placements[i];
      domain.composeWorldPosition(
        frame,
        placement.localX,
        placement.localZ,
        placement.height,
        fixtures[i].position,
      );
      if (i === 0) {
        this.floatingFixtureAnchor.copy(fixtures[i].position);
        this.floatingFixtureRestRotation.setFromUnitVectors(
          WATER_FIXTURE_UP,
          frame.normal,
        );
      }
      fixtures[i].quaternion.setFromUnitVectors(
        WATER_FIXTURE_UP,
        frame.normal,
      );
    }
  }

  private floatSurfaceFixture(): void {
    const sample = this.water.sample(
      this.floatingFixtureAnchor,
      this.engine.timer.getElapsed(),
    );
    if (!sample) return;

    const floating = this.waterTestFixtures.children[0];
    floating.position
      .copy(sample.position)
      // Keep the crate's centre slightly above the sampled surface so its
      // lower portion remains visibly submerged.
      .addScaledVector(sample.normal, 1);
    this.floatingFixtureWaveRotation.setFromUnitVectors(
      WATER_FIXTURE_UP,
      sample.normal,
    );
    floating.quaternion
      .copy(this.floatingFixtureRestRotation)
      .slerp(this.floatingFixtureWaveRotation, WATER_FIXTURE_TILT_RESPONSE);
  }
}

const COAST_PATCH_SIZE_M = 800;
const TERRAIN_MAX_LOD_LEVEL = 2;
const WATER_FIXTURE_UP = new Vector3(0, 1, 0);
// Large floating bodies normally respond less sharply than the local water
// normal. Vertical motion still follows the sampled 3D surface exactly.
const WATER_FIXTURE_TILT_RESPONSE = 0.25;

function createWaterTestFixtures(): Group {
  const group = new Group();
  group.name = 'water-effect-test-fixtures';

  const floating = new Mesh(
    new BoxGeometry(9, 3, 6),
    new MeshStandardMaterial({
      color: '#ef9f32',
      roughness: 0.72,
    }),
  );
  floating.name = 'floating-surface-crate';

  const shallow = new Mesh(
    new SphereGeometry(3.5, 24, 16),
    new MeshStandardMaterial({
      color: '#ff4f73',
      emissive: '#5c071b',
      roughness: 0.5,
    }),
  );
  shallow.name = 'shallow-submerged-marker';

  const deep = new Mesh(
    new BoxGeometry(8, 8, 8),
    new MeshStandardMaterial({
      color: '#d7ff42',
      emissive: '#334400',
      roughness: 0.58,
    }),
  );
  deep.name = 'deep-submerged-marker';

  group.add(floating, shallow, deep);
  return group;
}

function disposeWaterTestFixtures(group: Group): void {
  for (const child of group.children) {
    if (!(child instanceof Mesh)) continue;
    child.geometry.dispose();
    if (Array.isArray(child.material)) {
      for (const material of child.material) material.dispose();
    } else {
      child.material.dispose();
    }
  }
}

class CoastalTerrainField implements ITerrainField {
  readonly minElevationM = -58;
  readonly maxElevationM = 55;

  sample([x, _y, z]: TerrainVector3): ITerrainFieldSample {
    // The warped coast runs roughly north/south. Its wide shelf makes the
    // absorption gradient readable before the floor drops into the basin.
    const coastX =
      115 + Math.sin(z * 0.008) * 55 + Math.sin(z * 0.021 + 1.4) * 18;
    const offshoreM = coastX - x;
    const shelf = -2.5 - smoothstep(35, 235, offshoreM) * 9;
    const basin = -smoothstep(220, 570, offshoreM) * 38;

    const sandbars =
      Math.exp(-Math.pow((offshoreM - 75) / 32, 2)) *
      (3.2 + Math.sin(z * 0.035) * 1.3);
    const seabedVariation =
      Math.sin(x * 0.017 + z * 0.012) * 1.4 +
      Math.sin(x * 0.006 - z * 0.019) * 0.9;

    const inlandRise = smoothstep(-25, 260, x - coastX) * 25;
    const inlandHills =
      (Math.max(0, x - coastX) / 260) *
      (8 + Math.sin(z * 0.013) * 6 + Math.sin(x * 0.018) * 4);
    const beach = smoothstep(-18, 42, x - coastX) * 5;

    // A low island adds a second shoreline and a protected shallow lagoon.
    const islandDistance = Math.hypot(x + 230, z - 145);
    const island = smoothstep(145, 38, islandDistance) * 18;
    const lagoon = smoothstep(75, 25, Math.hypot(x + 205, z - 135)) * -7;

    return {
      elevationM:
        shelf +
        basin +
        sandbars +
        seabedVariation +
        inlandRise +
        inlandHills +
        beach +
        island +
        lagoon,
    };
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

class OceanPlanetTerrainField implements ITerrainField {
  readonly minElevationM = -46;
  readonly maxElevationM = 32;

  sample([x, y, z]: TerrainVector3): ITerrainFieldSample {
    const length = Math.hypot(x, y, z) || 1;
    const direction = new Vector3(x / length, y / length, z / length);

    // A broad, irregular continent faces the initial camera. Layering several
    // soft radial masses produces bays, peninsulas, and a long readable shelf.
    const continent =
      sphericalBump(direction, [0.9, 0.08, 0.42], 0.94, 0.38) * 55 +
      sphericalBump(direction, [0.62, -0.55, 0.56], 0.68, 0.25) * 31 +
      sphericalBump(direction, [0.54, 0.62, 0.58], 0.58, 0.2) * 24;

    const islandArc =
      sphericalBump(direction, [0.18, -0.18, 0.97], 0.24, 0.07) * 29 +
      sphericalBump(direction, [-0.04, -0.34, 0.94], 0.2, 0.06) * 25 +
      sphericalBump(direction, [-0.28, -0.42, 0.86], 0.18, 0.055) * 22;

    const abyss =
      sphericalBump(direction, [-0.62, 0.06, 0.78], 0.72, 0.22) * -13;
    const trench =
      Math.exp(
        -Math.pow(
          (direction.dot(new Vector3(-0.45, -0.35, 0.82)) - 0.91) / 0.035,
          2,
        ),
      ) * -10;
    const relief =
      Math.sin(direction.x * 17 + direction.z * 9) * 2.2 +
      Math.sin(direction.y * 23 - direction.x * 7) * 1.4 +
      Math.sin((direction.x + direction.y + direction.z) * 31) * 0.7;

    return {
      elevationM: Math.min(
        32,
        Math.max(-46, -31 + continent + islandArc + abyss + trench + relief),
      ),
    };
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

class CylinderHabitatTerrainField implements ITerrainField {
  readonly minElevationM = -42;
  readonly maxElevationM = 28;

  sample([x, y, z]: TerrainVector3): ITerrainFieldSample {
    const angle = Math.atan2(z, y);
    const coast =
      Math.sin(angle * 3 + x * 0.006) * 11 +
      Math.sin(angle * 7 - x * 0.012) * 4;
    const broadShelf = -9 + coast;
    const basin =
      -26 * smoothstep(0.25, 0.85, Math.sin(angle - x * 0.0015) * 0.5 + 0.5);
    const islands = Math.max(0, Math.sin(angle * 5 + x * 0.018) - 0.55) * 38;
    const relief =
      Math.sin(x * 0.025 + angle * 9) * 2 +
      Math.sin(x * 0.009 - angle * 13) * 1.2;
    return {
      elevationM: Math.min(
        this.maxElevationM,
        Math.max(this.minElevationM, broadShelf + basin + islands + relief),
      ),
    };
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

function createCylinderTerrainColors(
  center: TerrainVector3,
  positions: Float32Array,
  radiusM: number,
): Float32Array {
  const colors = new Float32Array(positions.length);
  const deep = new Color('#303b3c');
  const shelf = new Color('#716950');
  const beach = new Color('#b99d66');
  const green = new Color('#65754a');
  const color = new Color();

  for (let offset = 0; offset < positions.length; offset += 3) {
    const radialDistance = Math.hypot(
      positions[offset + 1] + center[1],
      positions[offset + 2] + center[2],
    );
    const elevation = radiusM - radialDistance;
    if (elevation < -12) {
      color.copy(deep).lerp(shelf, smoothstep(-42, -12, elevation));
    } else if (elevation < 3) {
      color.copy(shelf).lerp(beach, smoothstep(-12, 3, elevation));
    } else {
      color.copy(beach).lerp(green, smoothstep(3, 18, elevation));
    }
    color.toArray(colors, offset);
  }
  return colors;
}

function createSphereTerrainColors(
  center: TerrainVector3,
  positions: Float32Array,
  radiusM: number,
): Float32Array {
  const abyss = new Color('#252f35');
  const deep = new Color('#3e4a4b');
  const shelf = new Color('#756b55');
  const beach = new Color('#c0a66c');
  const green = new Color('#66794e');
  const highland = new Color('#817a6d');
  const color = new Color();
  const colors = new Float32Array(positions.length);

  for (let offset = 0; offset < positions.length; offset += 3) {
    const radius = Math.hypot(
      positions[offset] + center[0],
      positions[offset + 1] + center[1],
      positions[offset + 2] + center[2],
    );
    const elevation = radius - radiusM;
    if (elevation < -24) {
      color.copy(abyss).lerp(deep, smoothstep(-46, -24, elevation));
    } else if (elevation < -3) {
      color.copy(deep).lerp(shelf, smoothstep(-24, -3, elevation));
    } else if (elevation < 3) {
      color.copy(shelf).lerp(beach, smoothstep(-3, 3, elevation));
    } else if (elevation < 20) {
      color.copy(beach).lerp(green, smoothstep(3, 10, elevation));
    } else {
      color.copy(green).lerp(highland, smoothstep(20, 32, elevation));
    }
    color.toArray(colors, offset);
  }
  return colors;
}

function sphericalBump(
  direction: Vector3,
  center: Vector3Tuple,
  outerAngle: number,
  innerAngle: number,
): number {
  const centerDirection = new Vector3(...center).normalize();
  const angle = Math.acos(
    Math.min(1, Math.max(-1, direction.dot(centerDirection))),
  );
  return smoothstep(outerAngle, innerAngle, angle);
}

function createTerrainColors(positions: Float32Array): Float32Array {
  const deep = new Color('#313a36');
  const shelf = new Color('#665f4b');
  const sand = new Color('#b79a63');
  const grass = new Color('#687348');
  const rock = new Color('#777268');
  const color = new Color();
  const colors = new Float32Array(positions.length);

  for (let offset = 0; offset < positions.length; offset += 3) {
    const elevation = positions[offset + 1];
    if (elevation < -12) {
      color.copy(deep).lerp(shelf, smoothstep(-52, -12, elevation));
    } else if (elevation < 2.5) {
      color.copy(shelf).lerp(sand, smoothstep(-12, 2.5, elevation));
    } else if (elevation < 24) {
      color.copy(sand).lerp(grass, smoothstep(2.5, 10, elevation));
    } else {
      color.copy(grass).lerp(rock, smoothstep(24, 52, elevation));
    }
    color.toArray(colors, offset);
  }
  return colors;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
