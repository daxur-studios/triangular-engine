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

export interface TakramCloudTextures {
  localWeather?: Texture;
  turbulence?: Texture;
  shape?: Data3DTexture;
  shapeDetail?: Data3DTexture;
  stbn?: Data3DTexture;
}

/** Owns the default GPU textures used by one declarative cloud component. */
@Injectable()
export class TakramCloudAssetsService {
  private defaults: TakramCloudTextures | undefined;
  private ownedTextures: Texture[] = [];

  loadDefaults(
    effect: CloudsEffect,
    assetBaseUrl: string,
    custom: TakramCloudTextures = {},
  ): Promise<void> {
    if (this.defaults) {
      this.assign(effect, { ...this.defaults, ...withoutUndefined(custom) });
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
    const localWeather = custom.localWeather ?? textureLoader.load(
      `${baseUrl}/local_weather.png`,
      configure2D,
    );
    const turbulence = custom.turbulence ?? textureLoader.load(
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
    const shape = custom.shape ?? loadVolume(
      `${baseUrl}/shape.bin`,
      CLOUD_SHAPE_TEXTURE_SIZE,
    );
    const shapeDetail = custom.shapeDetail ?? loadVolume(
      `${baseUrl}/shape_detail.bin`,
      CLOUD_SHAPE_DETAIL_TEXTURE_SIZE,
    );
    const stbn = custom.stbn ?? new STBNLoader(manager).load(DEFAULT_STBN_URL);

    this.defaults = { localWeather, turbulence, shape, shapeDetail, stbn };
    this.ownedTextures = [
      custom.localWeather ? undefined : localWeather,
      custom.turbulence ? undefined : turbulence,
      custom.shape ? undefined : shape,
      custom.shapeDetail ? undefined : shapeDetail,
      custom.stbn ? undefined : stbn,
    ].filter((texture): texture is Texture => texture !== undefined);
    this.assign(effect, { ...this.defaults, ...withoutUndefined(custom) });
    return this.ownedTextures.length === 0 ? Promise.resolve() : completed;
  }

  /** Assigns caller-owned textures without transferring disposal ownership. */
  assignCustom(effect: CloudsEffect, custom: TakramCloudTextures): void {
    this.assign(effect, { ...this.defaults, ...withoutUndefined(custom) });
  }

  dispose(): void {
    this.ownedTextures.forEach((texture) => texture.dispose());
    this.ownedTextures = [];
    this.defaults = undefined;
  }

  private assign(effect: CloudsEffect, textures: TakramCloudTextures): void {
    if (textures.localWeather) effect.localWeatherTexture = textures.localWeather;
    if (textures.turbulence) effect.turbulenceTexture = textures.turbulence;
    if (textures.shape) effect.shapeTexture = textures.shape;
    if (textures.shapeDetail) effect.shapeDetailTexture = textures.shapeDetail;
    if (textures.stbn) effect.stbnTexture = textures.stbn;
  }
}

function withoutUndefined(textures: TakramCloudTextures): TakramCloudTextures {
  return Object.fromEntries(
    Object.entries(textures).filter(([, texture]) => texture !== undefined),
  ) as TakramCloudTextures;
}
