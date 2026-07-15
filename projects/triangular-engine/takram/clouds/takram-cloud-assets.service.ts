import { Injectable } from '@angular/core';
import {
  CLOUD_SHAPE_DETAIL_TEXTURE_SIZE,
  CLOUD_SHAPE_TEXTURE_SIZE,
  type CloudsEffect,
  type Procedural3DTexture,
  type ProceduralTexture,
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
  localWeather?: Texture | ProceduralTexture;
  turbulence?: Texture | ProceduralTexture;
  shape?: Data3DTexture | Procedural3DTexture;
  shapeDetail?: Data3DTexture | Procedural3DTexture;
  stbn?: Data3DTexture;
}

type TakramDefaultCloudTextures = {
  localWeather?: Texture;
  turbulence?: Texture;
  shape?: Data3DTexture;
  shapeDetail?: Data3DTexture;
  stbn?: Data3DTexture;
};

/** Owns the default GPU textures used by one declarative cloud component. */
@Injectable()
export class TakramCloudAssetsService {
  private defaults: TakramDefaultCloudTextures = {};
  private ownedTextures: Texture[] = [];
  private defaultAssetBaseUrl: string | undefined;

  loadDefaults(
    effect: CloudsEffect,
    assetBaseUrl: string,
    custom: TakramCloudTextures = {},
  ): Promise<void> {
    const baseUrl = assetBaseUrl.replace(/\/$/, '');
    if (
      this.defaultAssetBaseUrl !== undefined &&
      this.defaultAssetBaseUrl !== baseUrl
    ) {
      this.dispose();
    }
    this.defaultAssetBaseUrl = baseUrl;

    const manager = new LoadingManager();
    const completed = new Promise<void>((resolve, reject) => {
      manager.onLoad = () => resolve();
      manager.onError = (url) =>
        reject(new Error(`Failed to load Takram cloud texture: ${url}`));
    });

    const textureLoader = new TextureLoader(manager);
    let startedLoad = false;
    const configure2D = (texture: Texture): void => {
      texture.minFilter = LinearMipMapLinearFilter;
      texture.magFilter = LinearFilter;
      texture.wrapS = RepeatWrapping;
      texture.wrapT = RepeatWrapping;
      texture.colorSpace = NoColorSpace;
    };
    if (custom.localWeather === undefined && !this.defaults.localWeather) {
      startedLoad = true;
      this.defaults.localWeather = textureLoader.load(
        `${baseUrl}/local_weather.png`,
        configure2D,
      );
      this.ownedTextures.push(this.defaults.localWeather);
    }
    if (custom.turbulence === undefined && !this.defaults.turbulence) {
      startedLoad = true;
      this.defaults.turbulence = textureLoader.load(
        `${baseUrl}/turbulence.png`,
        configure2D,
      );
      this.ownedTextures.push(this.defaults.turbulence);
    }

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
    if (custom.shape === undefined && !this.defaults.shape) {
      startedLoad = true;
      this.defaults.shape = loadVolume(
        `${baseUrl}/shape.bin`,
        CLOUD_SHAPE_TEXTURE_SIZE,
      );
      this.ownedTextures.push(this.defaults.shape);
    }
    if (custom.shapeDetail === undefined && !this.defaults.shapeDetail) {
      startedLoad = true;
      this.defaults.shapeDetail = loadVolume(
        `${baseUrl}/shape_detail.bin`,
        CLOUD_SHAPE_DETAIL_TEXTURE_SIZE,
      );
      this.ownedTextures.push(this.defaults.shapeDetail);
    }
    if (custom.stbn === undefined && !this.defaults.stbn) {
      startedLoad = true;
      this.defaults.stbn = new STBNLoader(manager).load(DEFAULT_STBN_URL);
      this.ownedTextures.push(this.defaults.stbn);
    }

    this.assign(effect, { ...this.defaults, ...withoutUndefined(custom) });
    return startedLoad ? completed : Promise.resolve();
  }

  /** Assigns caller-owned textures without transferring disposal ownership. */
  assignCustom(effect: CloudsEffect, custom: TakramCloudTextures): void {
    this.assign(effect, { ...this.defaults, ...withoutUndefined(custom) });
  }

  dispose(): void {
    this.ownedTextures.forEach((texture) => texture.dispose());
    this.ownedTextures = [];
    this.defaults = {};
    this.defaultAssetBaseUrl = undefined;
  }

  private assign(effect: CloudsEffect, textures: TakramCloudTextures): void {
    if (textures.localWeather)
      effect.localWeatherTexture = textures.localWeather;
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
