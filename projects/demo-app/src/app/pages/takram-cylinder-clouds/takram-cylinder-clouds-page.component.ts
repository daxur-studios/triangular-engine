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
  DataTexture,
  DoubleSide,
  EquirectangularReflectionMapping,
  LinearMipmapLinearFilter,
  Matrix4,
  NoToneMapping,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
  Vector3,
} from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import { PostprocessingModule } from 'triangular-engine/postprocessing';
import { TakramModule } from 'triangular-engine/takram';
import { TakramCloudDemoTextures } from '../../shared/takram-cloud-controls/takram-cloud-demo-textures.service';

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

  constructor() {
    this.cloudTextures.source.set('procedural');
    const engine = inject(EngineService);
    const destroyRef = inject(DestroyRef);
    const previousBackground = engine.scene.background;
    engine.scene.background = this.starTexture;
    engine.postTick$.pipe(takeUntilDestroyed(destroyRef)).subscribe(() => {
      if (!this.cylinderUp()) return;
      const position = engine.camera.position;
      const radialLength = Math.hypot(position.y, position.z);
      if (radialLength > 0) {
        this.cameraUp.set([
          0,
          -position.y / radialLength,
          -position.z / radialLength,
        ]);
      }
    });
    destroyRef.onDestroy(() => {
      engine.scene.background = previousBackground;
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
