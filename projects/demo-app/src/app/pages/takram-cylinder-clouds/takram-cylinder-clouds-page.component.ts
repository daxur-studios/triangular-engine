import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  DoubleSide,
  EquirectangularReflectionMapping,
  Group,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  NoToneMapping,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
  Vector3,
} from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import {
  CylinderTerrainDomain,
  generateTerrainPatchMesh,
  type ITerrainField,
  type ITerrainFieldSample,
  selectAdaptiveTerrainPatches,
  TerrainGenerationQueue,
  type TerrainVector3,
} from 'triangular-engine/terrain';
import { PostprocessingModule } from 'triangular-engine/postprocessing';
import { TakramModule } from 'triangular-engine/takram';
import { TakramCloudDemoTextures } from '../../shared/takram-cloud-controls/takram-cloud-demo-textures.service';

const TERRAIN_ANGULAR_PATCHES = 16;
const TERRAIN_AXIAL_PATCHES = 12;
const TERRAIN_PATCH_RESOLUTION = 16;
const TERRAIN_MAX_LOD_LEVEL = 3;
const TERRAIN_REFINEMENT_DISTANCE_M = 9_000;
const TERRAIN_SKIRT_DEPTH_M = 180;
const DEFAULT_TERRAIN_GENERATION_BUDGET = 12;

type TerrainMode = 'disabled' | 'visual';
interface TerrainShapeSettings {
  readonly seed: number;
  readonly landformScale: number;
  readonly mountainHeight: number;
  readonly mountainDetail: number;
  readonly meadowRelief: number;
  readonly waterCoverage: number;
}
type CylinderRenderMode = '2d' | '3d';
type WaterPreset = 'calmLake' | 'oceanSwell' | 'storm';
type WaterQuality = 'low' | 'medium' | 'high';

const WATER_PRESETS: Record<
  WaterPreset,
  {
    readonly label: string;
    readonly color: string;
    readonly roughness: number;
    readonly metalness: number;
    readonly opacity: number;
  }
> = {
  calmLake: {
    label: 'Calm lake',
    color: '#318eaa',
    roughness: 0.08,
    metalness: 0.12,
    opacity: 0.76,
  },
  oceanSwell: {
    label: 'Ocean swell',
    color: '#167da1',
    roughness: 0.18,
    metalness: 0.08,
    opacity: 0.82,
  },
  storm: {
    label: 'Storm',
    color: '#153f58',
    roughness: 0.32,
    metalness: 0.04,
    opacity: 0.9,
  },
};

const WATER_QUALITY_SEGMENTS: Record<
  WaterQuality,
  readonly [radial: number, height: number]
> = {
  low: [48, 8],
  medium: [96, 16],
  high: [160, 32],
};

class CylinderPocTerrainField implements ITerrainField {
  readonly minElevationM = -360;
  readonly maxElevationM = 1_100;

  constructor(private readonly settings: () => TerrainShapeSettings) {}

  sample([axialM, radialY, radialZ]: TerrainVector3): ITerrainFieldSample {
    const angle = Math.atan2(radialZ, radialY);
    return {
      elevationM: cylinderBiomeElevation(
        axialM,
        angle * 10_000,
        this.settings(),
      ),
    };
  }

  sampleBatch(
    positions: Float64Array,
    output = new Float64Array(positions.length / 3),
  ): Float64Array {
    for (let index = 0; index < output.length; index++) {
      output[index] = this.sample([
        positions[index * 3],
        positions[index * 3 + 1],
        positions[index * 3 + 2],
      ]).elevationM;
    }
    return output;
  }
}

@Component({
  selector: 'app-takram-cylinder-clouds-page',
  imports: [EngineModule, PostprocessingModule, TakramModule],
  templateUrl: './takram-cylinder-clouds-page.component.html',
  styleUrl: './takram-cylinder-clouds-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    EngineService.provide({
      showFPS: true,
      pixelRatio: 1,
      toneMapping: NoToneMapping,
      // The reference cylinder POC uses a deliberately high photographic
      // exposure because its artistic cloud irradiance is physically small.
      toneMappingExposure: 12,
      webGLRendererParameters: {
        antialias: false,
        logarithmicDepthBuffer: true,
      },
    }),
    TakramCloudDemoTextures,
  ],
  host: { class: 'flex-page' },
})
export class TakramCylinderCloudsPageComponent {
  readonly radius = 10_000;
  readonly length = this.radius * 5;
  readonly worldToCylinder = new Matrix4();
  readonly doubleSide = DoubleSide;
  readonly renderMode = signal<CylinderRenderMode>('2d');
  readonly terrainMode = signal<TerrainMode>('disabled');
  readonly enabled = signal(true);
  readonly temporalUpscale = signal(true);
  readonly resolutionScale = signal(0.5);
  readonly altitude = signal(450);
  readonly cloudHeight = signal(1_400);
  readonly coverage = signal(0.28);
  readonly densityScale = signal(0.5);
  readonly distanceShell = signal(true);
  readonly distanceShellOpacity = signal(0.24);
  readonly distanceShellEvolution = signal(0.025);
  readonly distanceShellEvolutionSpeed = signal(4);
  readonly distanceShellFadeStart = signal(3_000);
  readonly distanceShellFadeEnd = signal(7_000);
  readonly windSpeedX = signal(0.005);
  readonly haze = signal(true);
  readonly hazeModel = signal<'legacy' | 'bounded-v2'>('bounded-v2');
  readonly atmosphereDensity = signal(0.000005);
  readonly atmosphereScaleHeight = signal(500);
  readonly atmosphereSkyLight = signal(0.2);
  readonly atmosphereEnabled = signal(true);
  readonly atmosphereScatteringDensity = signal(0.000008);
  readonly atmosphereIntensity = signal(0.12);
  readonly wireframe = signal(false);
  readonly waterHeight = signal(85);
  readonly waterPreset = signal<WaterPreset>('oceanSwell');
  readonly waterQuality = signal<WaterQuality>('medium');
  readonly waterPresetKeys = Object.keys(WATER_PRESETS) as WaterPreset[];
  readonly waterPresetLabels = Object.fromEntries(
    Object.entries(WATER_PRESETS).map(([key, value]) => [key, value.label]),
  ) as Record<WaterPreset, string>;
  readonly waterQualityKeys: WaterQuality[] = ['low', 'medium', 'high'];
  readonly waterAppearance = computed(() => WATER_PRESETS[this.waterPreset()]);
  readonly waterSegments = computed(
    () => WATER_QUALITY_SEGMENTS[this.waterQuality()],
  );
  readonly terrainStreamingRadius = signal(1);
  readonly terrainGenerationBudget = signal(DEFAULT_TERRAIN_GENERATION_BUDGET);
  readonly terrainSeed = signal(7);
  readonly terrainLandformScale = signal(1);
  readonly terrainMountainHeight = signal(1);
  readonly terrainMountainDetail = signal(0.55);
  readonly terrainMeadowRelief = signal(0.45);
  readonly terrainWaterCoverage = signal(0.48);
  readonly terrainQueuedPatchCount = signal(0);
  readonly terrainPatchCount = signal(0);
  readonly terrainLodLabel = signal('L0: 0');
  readonly cylinderUp = signal(false);
  readonly cameraUp = signal<[number, number, number]>([0, 1, 0]);
  readonly sunAngle = signal(120);
  readonly sunAxialPosition = signal(0.6);
  readonly sunSize = signal(0.035);
  readonly sunLightIntensity = signal(2.5);
  readonly cloudTextures = inject(TakramCloudDemoTextures);
  readonly sunPosition = computed<[number, number, number]>(() => {
    const angle = (this.sunAngle() * Math.PI) / 180;
    const radialDistance = this.radius * 0.35;
    return [
      this.radius * this.sunAxialPosition(),
      Math.cos(angle) * radialDistance,
      Math.sin(angle) * radialDistance,
    ];
  });
  readonly sunDirection = computed(() =>
    new Vector3(...this.sunPosition()).normalize(),
  );
  readonly terrainTexture = createTerrainTexture();
  readonly starTexture = createStarTexture();

  private readonly engine = inject(EngineService);
  private readonly terrainDomain = new CylinderTerrainDomain({
    radiusM: this.radius,
    lengthM: this.length,
    levelZeroAngularPatchCount: TERRAIN_ANGULAR_PATCHES,
    levelZeroAxialPatchCount: TERRAIN_AXIAL_PATCHES,
  });
  private readonly terrainField = new CylinderPocTerrainField(() => ({
    seed: this.terrainSeed(),
    landformScale: this.terrainLandformScale(),
    mountainHeight: this.terrainMountainHeight(),
    mountainDetail: this.terrainMountainDetail(),
    meadowRelief: this.terrainMeadowRelief(),
    waterCoverage: this.terrainWaterCoverage(),
  }));
  private terrainGroup: Group | null = null;
  private terrainMaterial: MeshStandardMaterial | null = null;
  private readonly terrainPatches = new Map<string, Mesh>();
  private readonly terrainGenerationQueue = new TerrainGenerationQueue<{
    readonly level: number;
    readonly angularIndex: number;
    readonly axialIndex: number;
  }>();
  private terrainSelectionSignature = '';

  constructor() {
    this.cloudTextures.source.set('procedural');
    const destroyRef = inject(DestroyRef);
    const previousBackground = this.engine.scene.background;
    this.engine.scene.background = this.starTexture;
    this.engine.postTick$.pipe(takeUntilDestroyed(destroyRef)).subscribe(() => {
      if (this.cylinderUp()) {
        const position = this.engine.camera.position;
        const radialLength = Math.hypot(position.y, position.z);
        if (radialLength > 0) {
          this.cameraUp.set([
            0,
            -position.y / radialLength,
            -position.z / radialLength,
          ]);
        }
      }
      if (this.terrainMode() === 'visual') this.updateVisualTerrain();
    });
    destroyRef.onDestroy(() => {
      this.disposeVisualTerrain();
      this.engine.scene.background = previousBackground;
      this.terrainTexture.dispose();
      this.starTexture.dispose();
    });
  }

  setNumber(target: { value: string }, setter: (value: number) => void): void {
    setter(Number(target.value));
  }

  setCylinderUp(enabled: boolean): void {
    this.cylinderUp.set(enabled);
    if (!enabled) this.cameraUp.set([0, 1, 0]);
  }

  setRenderMode(mode: CylinderRenderMode): void {
    if (mode === this.renderMode()) return;
    this.renderMode.set(mode);
    this.setTerrainMode(mode === '3d' ? 'visual' : 'disabled');
  }

  setTerrainMode(mode: TerrainMode): void {
    if (mode === this.terrainMode()) return;
    this.disposeVisualTerrain();
    this.terrainMode.set(mode);
    if (mode === 'visual') this.buildVisualTerrain();
  }

  setWireframe(enabled: boolean): void {
    this.wireframe.set(enabled);
    if (this.terrainMaterial) this.terrainMaterial.wireframe = enabled;
  }

  setTerrainStreamingRadius(target: { value: string }): void {
    this.terrainStreamingRadius.set(Number(target.value));
    this.terrainSelectionSignature = '';
    this.updateVisualTerrain();
  }

  setTerrainGenerationBudget(target: { value: string }): void {
    this.terrainGenerationBudget.set(
      Math.max(1, Math.min(32, Math.round(Number(target.value)))),
    );
  }

  setTerrainShape(
    target: { value: string },
    setting: { set(value: number): void },
  ): void {
    setting.set(Number(target.value));
    if (this.terrainMode() !== 'visual') return;
    this.disposeVisualTerrain();
    this.buildVisualTerrain();
  }

  private buildVisualTerrain(): void {
    const group = new Group();
    group.name = 'cylinder-visual-terrain';
    this.terrainMaterial = new MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.94,
      vertexColors: true,
      wireframe: this.wireframe(),
    });
    this.terrainGroup = group;
    this.engine.scene.add(group);
    this.terrainSelectionSignature = '';
    this.updateVisualTerrain();
  }

  private updateVisualTerrain(): void {
    if (this.terrainGroup === null || this.terrainMaterial === null) return;
    const counts = this.terrainDomain.getPatchCounts(0);
    const roots = Array.from({ length: counts.axial }, (_, axialIndex) =>
      Array.from({ length: counts.angular }, (_unused, angularIndex) => ({
        level: 0,
        angularIndex,
        axialIndex,
      })),
    ).flat();
    const camera = this.engine.camera.position;
    const selected = selectAdaptiveTerrainPatches(this.terrainDomain, {
      roots,
      cameraWorldM: [camera.x, camera.y, camera.z],
      getLevel: (address) => address.level,
      maxLevel: TERRAIN_MAX_LOD_LEVEL,
      refinementDistanceM:
        TERRAIN_REFINEMENT_DISTANCE_M * this.terrainStreamingRadius(),
    });
    const entries = selected.map((address) => ({
      address,
      key: `${address.level}:${address.angularIndex}:${address.axialIndex}`,
    }));
    const signature = entries.map(({ key }) => key).join('|');
    if (signature !== this.terrainSelectionSignature) {
      this.terrainSelectionSignature = signature;
      this.terrainGenerationQueue.reconcile(
        entries.map(({ address, key }) => ({
          key,
          value: address,
          priority: this.getTerrainPatchDistance(address),
        })),
        new Set(this.terrainPatches.keys()),
      );
      const levels = new Map<number, number>();
      for (const { address } of entries) {
        levels.set(address.level, (levels.get(address.level) ?? 0) + 1);
      }
      this.terrainLodLabel.set(
        [...levels]
          .sort(([a], [b]) => a - b)
          .map(([level, count]) => `L${level}: ${count}`)
          .join(' · '),
      );
    }
    this.terrainGenerationQueue.drain(
      this.terrainGenerationBudget(),
      ({ key, value }) => this.addTerrainPatch(key, value),
    );
    if (this.terrainGenerationQueue.pendingCount === 0) {
      for (const [key, mesh] of this.terrainPatches) {
        if (!this.terrainGenerationQueue.desired.has(key)) {
          this.removeTerrainPatch(key, mesh);
        }
      }
    }
    this.terrainPatchCount.set(this.terrainPatches.size);
    this.terrainQueuedPatchCount.set(this.terrainGenerationQueue.pendingCount);
  }

  private getTerrainPatchDistance(address: {
    level: number;
    angularIndex: number;
    axialIndex: number;
  }): number {
    const bounds = this.terrainDomain.getPatchBounds(address);
    const centre = this.terrainDomain.getSurfacePosition(
      address,
      (bounds.minU + bounds.maxU) / 2,
      (bounds.minV + bounds.maxV) / 2,
      0,
    );
    const camera = this.engine.camera.position;
    return Math.hypot(
      centre[0] - camera.x,
      centre[1] - camera.y,
      centre[2] - camera.z,
    );
  }

  private addTerrainPatch(
    key: string,
    address: { level: number; angularIndex: number; axialIndex: number },
  ): void {
    if (this.terrainGroup === null || this.terrainMaterial === null) return;
    const patch = generateTerrainPatchMesh(
      this.terrainField,
      this.terrainDomain,
      {
        address,
        resolution: TERRAIN_PATCH_RESOLUTION,
        skirtDepthM: TERRAIN_SKIRT_DEPTH_M,
      },
    );
    const mesh = new Mesh(
      this.createTerrainGeometry(patch.centerWorldM, patch.surface),
      this.terrainMaterial,
    );
    if (patch.skirt) {
      mesh.add(
        new Mesh(
          this.createTerrainGeometry(patch.centerWorldM, patch.skirt),
          this.terrainMaterial,
        ),
      );
    }
    mesh.position.set(...patch.centerWorldM);
    this.terrainGroup.add(mesh);
    this.terrainPatches.set(key, mesh);
  }

  private createTerrainGeometry(
    centerWorldM: TerrainVector3,
    source: {
      positions: Float32Array;
      normals: Float32Array;
      uvs: Float32Array;
      indices: Uint16Array | Uint32Array;
    },
  ): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(source.positions, 3));
    geometry.setAttribute('normal', new BufferAttribute(source.normals, 3));
    geometry.setAttribute('uv', new BufferAttribute(source.uvs, 2));
    geometry.setAttribute(
      'color',
      new BufferAttribute(
        createCylinderBiomeColors(centerWorldM, source.positions, this.radius),
        3,
      ),
    );
    geometry.setIndex(new BufferAttribute(source.indices, 1));
    return geometry;
  }

  private removeTerrainPatch(key: string, mesh: Mesh): void {
    mesh.removeFromParent();
    mesh.traverse((object) => {
      if (object instanceof Mesh) object.geometry.dispose();
    });
    this.terrainPatches.delete(key);
  }

  private disposeVisualTerrain(): void {
    this.terrainGenerationQueue.clear();
    const group = this.terrainGroup;
    if (group === null) return;
    group.removeFromParent();
    for (const [key, mesh] of [...this.terrainPatches])
      this.removeTerrainPatch(key, mesh);
    this.terrainMaterial?.dispose();
    this.terrainMaterial = null;
    group.clear();
    this.terrainGroup = null;
    this.terrainSelectionSignature = '';
    this.terrainPatchCount.set(0);
    this.terrainQueuedPatchCount.set(0);
    this.terrainLodLabel.set('L0: 0');
  }
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function cylinderBiomeElevation(
  axialM: number,
  arcM: number,
  settings: TerrainShapeSettings,
): number {
  const scale = Math.max(0.35, settings.landformScale);
  const x = axialM / (7_500 * scale);
  const y = arcM / (7_500 * scale);
  const seed = settings.seed;

  // Warping stops the biome boundaries following obvious noise contours.
  const warpX = fbm2(x * 0.7, y * 0.7, seed + 31, 3) * 0.42;
  const warpY = fbm2(x * 0.7 + 19, y * 0.7 - 11, seed + 73, 3) * 0.42;
  const wx = x + warpX;
  const wy = y + warpY;
  const continental = fbm2(wx, wy, seed, 5);
  const coastLevel = (settings.waterCoverage - 0.5) * 0.75;
  const landMask = smoothstep(coastLevel - 0.1, coastLevel + 0.12, continental);
  const mountainMask = smoothstep(
    coastLevel + 0.18,
    coastLevel + 0.55,
    continental,
  );

  const meadowNoise = fbm2(wx * 5.2, wy * 5.2, seed + 151, 4);
  const meadow = (18 + meadowNoise * 42) * settings.meadowRelief;

  const ridgeBase = 1 - Math.abs(fbm2(wx * 3.1, wy * 3.1, seed + 211, 5));
  const sharpRidges = Math.pow(Math.max(0, ridgeBase), 2.3);
  const fineRidges =
    (1 - Math.abs(fbm2(wx * 8.5, wy * 8.5, seed + 307, 3))) *
    settings.mountainDetail;
  const mountains =
    (150 + sharpRidges * 610 + fineRidges * 170) *
    settings.mountainHeight;

  const oceanNoise = fbm2(wx * 2.2, wy * 2.2, seed + 401, 3);
  const oceanFloor = -190 + oceanNoise * 55;
  const landElevation = meadow * (1 - mountainMask) + mountains * mountainMask;
  return oceanFloor * (1 - landMask) + landElevation * landMask;
}

function fbm2(x: number, y: number, seed: number, octaves: number): number {
  let value = 0;
  let amplitude = 0.55;
  let frequency = 1;
  let normalizer = 0;
  for (let octave = 0; octave < octaves; octave++) {
    value += valueNoise2(x * frequency, y * frequency, seed + octave * 101) * amplitude;
    normalizer += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return value / normalizer;
}

function valueNoise2(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = noiseHash(ix, iy, seed);
  const b = noiseHash(ix + 1, iy, seed);
  const c = noiseHash(ix, iy + 1, seed);
  const d = noiseHash(ix + 1, iy + 1, seed);
  return (
    a + (b - a) * ux + (c - a) * uy +
    (d - c - b + a) * ux * uy
  );
}

function noiseHash(x: number, y: number, seed: number): number {
  let hash = Math.imul(x, 374_761_393) + Math.imul(y, 668_265_263);
  hash = Math.imul(hash ^ (hash >>> 13) ^ Math.imul(seed, 1_274_126_177), 1_274_126_177);
  return ((hash ^ (hash >>> 16)) >>> 0) / 0x7fff_ffff - 1;
}

function createCylinderBiomeColors(
  centerWorldM: TerrainVector3,
  positions: Float32Array,
  radiusM: number,
): Float32Array {
  const colors = new Float32Array(positions.length);
  const ocean = new Color('#315f78');
  const meadow = new Color('#5f9856');
  const mountain = new Color('#806f5b');
  const snow = new Color('#c3c5bc');
  const color = new Color();
  for (let offset = 0; offset < positions.length; offset += 3) {
    const y = centerWorldM[1] + positions[offset + 1];
    const z = centerWorldM[2] + positions[offset + 2];
    const elevation = radiusM - Math.hypot(y, z);
    if (elevation < -80) color.copy(ocean);
    else if (elevation < 120) color.copy(meadow);
    else if (elevation < 500)
      color.copy(meadow).lerp(mountain, (elevation - 120) / 380);
    else color.copy(mountain).lerp(snow, Math.min(1, (elevation - 500) / 180));
    colors[offset] = color.r;
    colors[offset + 1] = color.g;
    colors[offset + 2] = color.b;
  }
  return colors;
}

function createStarTexture(): DataTexture {
  const width = 4096;
  const height = 2048;
  const data = new Uint8Array(width * height * 4);
  let seed = 0x57a25;
  const random = (): number => {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    return seed / 0x1_0000_0000;
  };
  // A clean lifted-black background avoids the noisy, low-resolution look of
  // assigning random brightness independently to every texel.
  for (let index = 0; index < width * height; index++) {
    const offset = index * 4;
    data[offset] = 3;
    data[offset + 1] = 5;
    data[offset + 2] = 9;
    data[offset + 3] = 255;
  }

  // Place discrete sub-degree stars instead of magnified source pixels. Most
  // are single-texel points; a small number get a restrained two-pixel halo.
  const starCount = 7_500;
  for (let star = 0; star < starCount; ++star) {
    const x = Math.floor(random() * width);
    const y = Math.floor(random() * height);
    const magnitude = random();
    const brightness = Math.floor(75 + Math.pow(magnitude, 3) * 180);
    const warm = random() > 0.82;
    writeStarPixel(
      data,
      width,
      height,
      x,
      y,
      brightness,
      warm ? 0.88 : 0.96,
      warm ? 0.7 : 1,
    );
    if (magnitude > 0.94) {
      const halo = Math.floor(brightness * 0.2);
      writeStarPixel(data, width, height, x - 1, y, halo, 0.95, 1);
      writeStarPixel(data, width, height, x + 1, y, halo, 0.95, 1);
      writeStarPixel(data, width, height, x, y - 1, halo, 0.95, 1);
      writeStarPixel(data, width, height, x, y + 1, halo, 0.95, 1);
    }
  }
  const texture = new DataTexture(
    data,
    width,
    height,
    RGBAFormat,
    UnsignedByteType,
  );
  texture.mapping = EquirectangularReflectionMapping;
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function writeStarPixel(
  data: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  brightness: number,
  greenScale: number,
  blueScale: number,
): void {
  const wrappedX = (x + width) % width;
  if (y < 0 || y >= height) return;
  const offset = (y * width + wrappedX) * 4;
  data[offset] = Math.max(data[offset], Math.min(255, brightness));
  data[offset + 1] = Math.max(
    data[offset + 1],
    Math.min(255, Math.floor(brightness * greenScale)),
  );
  data[offset + 2] = Math.max(
    data[offset + 2],
    Math.min(255, Math.floor(brightness * blueScale)),
  );
}

function createTerrainTexture(): DataTexture {
  const size = 512;
  const data = new Uint8Array(size * size * 4);
  let seed = 0x51f15e;
  const random = (): number => {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    return seed / 0x1_0000_0000;
  };
  for (let y = 0; y < size; ++y) {
    for (let x = 0; x < size; ++x) {
      const index = (y * size + x) * 4;
      const u = (x / size) * Math.PI * 2;
      const v = (y / size) * Math.PI * 2;
      const continent =
        Math.sin(u * 2 + Math.sin(v)) * 0.42 +
        Math.sin(v * 2 - u) * 0.3 +
        Math.sin(u * 4 + v * 3) * 0.15 +
        Math.sin(u * 9 - v * 7) * 0.07;
      const detail = (random() - 0.5) * 10;
      if (continent < -0.12) {
        const depth = Math.min(1, (-0.12 - continent) * 2.5);
        data[index] = 18 + depth * 4 + detail * 0.15;
        data[index + 1] = 82 - depth * 27 + detail * 0.25;
        data[index + 2] = 116 - depth * 24 + detail * 0.3;
      } else if (continent < -0.04) {
        data[index] = 151 + detail;
        data[index + 1] = 145 + detail;
        data[index + 2] = 82 + detail * 0.5;
      } else {
        const upland = Math.min(1, Math.max(0, continent - 0.35) * 2);
        data[index] = 49 + upland * 46 + detail;
        data[index + 1] = 105 - upland * 25 + detail;
        data[index + 2] = 45 + upland * 18 + detail * 0.5;
      }
      data[index + 3] = 255;
    }
  }
  const texture = new DataTexture(
    data,
    size,
    size,
    RGBAFormat,
    UnsignedByteType,
  );
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(1, 1);
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}
