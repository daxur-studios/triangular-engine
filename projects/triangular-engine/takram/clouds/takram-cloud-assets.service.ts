import { Injectable } from '@angular/core';
import {
  CLOUD_SHAPE_DETAIL_TEXTURE_SIZE,
  CLOUD_SHAPE_TEXTURE_SIZE,
  type CloudsEffect,
} from '@takram/three-clouds';
import {
  DataTextureLoader,
  DEFAULT_STBN_URL,
  parseUint8Array,
  STBNLoader,
} from '@takram/three-geospatial';
import {
  Data3DTexture,
  LinearFilter,
  LinearMipMapLinearFilter,
  LoadingManager,
  NoColorSpace,
  RedFormat,
  RepeatWrapping,
  Texture,
  TextureLoader,
} from 'three';

/** Owns the default GPU textures used by one declarative cloud component. */
@Injectable()
export class TakramCloudAssetsService {
  private textures: Texture[] | undefined;

  loadDefaults(effect: CloudsEffect, assetBaseUrl: string): Promise<void> {
    if (this.textures) {
      this.assign(effect, this.textures);
      return Promise.resolve();
    }

    const baseUrl = assetBaseUrl.replace(/\/$/, '');
    const manager = new LoadingManager();
    const completed = new Promise<void>((resolve, reject) => {
      manager.onLoad = () => resolve();
      manager.onError = (url) =>
        reject(new Error(`Failed to load Takram cloud texture: ${url}`));
    });

    const textureLoader = new TextureLoader(manager);
    const configure2D = (texture: Texture): void => {
      texture.minFilter = LinearMipMapLinearFilter;
      texture.magFilter = LinearFilter;
      texture.wrapS = RepeatWrapping;
      texture.wrapT = RepeatWrapping;
      texture.colorSpace = NoColorSpace;
    };
    const localWeather = textureLoader.load(
      `${baseUrl}/local_weather.png`,
      configure2D,
    );
    const turbulence = textureLoader.load(
      `${baseUrl}/turbulence.png`,
      configure2D,
    );

    const loadVolume = (url: string, size: number): Data3DTexture =>
      new DataTextureLoader(Data3DTexture, parseUint8Array, {
        width: size,
        height: size,
        depth: size,
        format: RedFormat,
        minFilter: LinearFilter,
        magFilter: LinearFilter,
        wrapS: RepeatWrapping,
        wrapT: RepeatWrapping,
        wrapR: RepeatWrapping,
        colorSpace: NoColorSpace,
        manager,
      }).load(url);
    const shape = loadVolume(
      `${baseUrl}/shape.bin`,
      CLOUD_SHAPE_TEXTURE_SIZE,
    );
    const shapeDetail = loadVolume(
      `${baseUrl}/shape_detail.bin`,
      CLOUD_SHAPE_DETAIL_TEXTURE_SIZE,
    );
    const stbn = new STBNLoader(manager).load(DEFAULT_STBN_URL);

    this.textures = [localWeather, turbulence, shape, shapeDetail, stbn];
    this.assign(effect, this.textures);
    return completed;
  }

  dispose(): void {
    this.textures?.forEach((texture) => texture.dispose());
    this.textures = undefined;
  }

  private assign(effect: CloudsEffect, textures: Texture[]): void {
    const [localWeather, turbulence, shape, shapeDetail, stbn] = textures;
    effect.localWeatherTexture = localWeather;
    effect.turbulenceTexture = turbulence;
    effect.shapeTexture = shape as Data3DTexture;
    effect.shapeDetailTexture = shapeDetail as Data3DTexture;
    effect.stbnTexture = stbn as Data3DTexture;
  }
}
