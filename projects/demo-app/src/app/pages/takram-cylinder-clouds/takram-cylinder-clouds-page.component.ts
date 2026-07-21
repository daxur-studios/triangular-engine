import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import {
  Color,
  DataTexture,
  DoubleSide,
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
  readonly coverage = signal(0.62);
  readonly densityScale = signal(0.5);
  readonly windSpeedX = signal(0.005);
  readonly haze = signal(true);
  readonly hazeModel = signal<'legacy' | 'bounded-v2'>('bounded-v2');
  readonly atmosphereDensity = signal(0.00006);
  readonly atmosphereScaleHeight = signal(1_800);
  readonly atmosphereSkyLight = signal(1);
  readonly wireframe = signal(false);
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
  readonly meadowTexture = createMeadowTexture(this.radius, this.length, 120);

  constructor() {
    this.cloudTextures.source.set('procedural');
    const engine = inject(EngineService);
    const destroyRef = inject(DestroyRef);
    const previousBackground = engine.scene.background;
    engine.scene.background = new Color('#07111f');
    destroyRef.onDestroy(() => {
      engine.scene.background = previousBackground;
      this.meadowTexture.dispose();
    });
  }

  setNumber(target: { value: string }, setter: (value: number) => void): void {
    setter(Number(target.value));
  }
}

function createMeadowTexture(
  radius: number,
  length: number,
  tileSize: number,
): DataTexture {
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  let seed = 0x51f15e;
  const random = (): number => {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    return seed / 0x1_0000_0000;
  };
  for (let y = 0; y < size; ++y) {
    for (let x = 0; x < size; ++x) {
      const index = (y * size + x) * 4;
      const variation =
        Math.sin(x * 0.075) * 8 + Math.sin(y * 0.057 + x * 0.021) * 7;
      const detail = (random() - 0.5) * 24;
      const flower = random() > 0.998;
      data[index] = flower ? 225 : 54 + variation + detail;
      data[index + 1] = flower ? 205 : 105 + variation + detail;
      data[index + 2] = flower ? 115 : 47 + variation * 0.5 + detail;
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
  texture.repeat.set((Math.PI * 2 * radius) / tileSize, length / tileSize);
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}
