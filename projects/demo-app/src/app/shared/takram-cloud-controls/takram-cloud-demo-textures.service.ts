import {
  computed,
  DestroyRef,
  inject,
  Injectable,
  signal,
} from '@angular/core';
import { LocalWeather, type ProceduralTexture } from '@takram/three-clouds';
import {
  DataTexture,
  LinearFilter,
  LinearMipMapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  RGBAFormat,
  type Texture,
  UnsignedByteType,
} from 'three';

export type WeatherTextureSource = 'default' | 'custom' | 'procedural';

/** Page-scoped, caller-owned textures used to exercise the public cloud API. */
@Injectable()
export class TakramCloudDemoTextures {
  readonly source = signal<WeatherTextureSource>('default');
  readonly seed = signal(7);
  readonly frequency = signal(5);
  readonly threshold = signal(0.5);

  private readonly customWeather = createWeatherTexture(256);
  private readonly proceduralWeather = new LocalWeather();

  readonly selectedTexture = computed<Texture | ProceduralTexture | undefined>(
    () => {
      switch (this.source()) {
        case 'custom':
          return this.customWeather;
        case 'procedural':
          return this.proceduralWeather;
        default:
          return undefined;
      }
    },
  );

  constructor() {
    this.regenerate();
    inject(DestroyRef).onDestroy(() => {
      this.customWeather.dispose();
      this.proceduralWeather.dispose();
    });
  }

  regenerate(): void {
    const data = this.customWeather.image.data as Uint8Array;
    const size = this.customWeather.image.width;
    const seed = this.seed();
    const frequency = Math.max(1, Math.round(this.frequency()));
    const threshold = this.threshold();
    const phase = seed * 0.61803398875;

    for (let y = 0; y < size; ++y) {
      const v = (y / size) * Math.PI * 2;
      for (let x = 0; x < size; ++x) {
        const u = (x / size) * Math.PI * 2;
        const broad =
          Math.sin(u * frequency + phase) *
          Math.sin(v * frequency - phase * 0.7);
        const detail =
          Math.sin(u * (frequency + 3) - v * 2 + phase * 1.9) * 0.35;
        const signal = 0.5 + broad * 0.32 + detail * 0.18;
        const value = smoothstep(threshold - 0.18, threshold + 0.18, signal);
        const byte = Math.round(value * 255);
        const offset = (y * size + x) * 4;
        data[offset] = byte;
        data[offset + 1] = byte;
        data[offset + 2] = byte;
        data[offset + 3] = byte;
      }
    }

    this.customWeather.needsUpdate = true;
  }
}

function createWeatherTexture(size: number): DataTexture {
  const texture = new DataTexture(
    new Uint8Array(size * size * 4),
    size,
    size,
    RGBAFormat,
    UnsignedByteType,
  );
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipMapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.colorSpace = NoColorSpace;
  return texture;
}

function smoothstep(min: number, max: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - min) / (max - min)));
  return t * t * (3 - 2 * t);
}
