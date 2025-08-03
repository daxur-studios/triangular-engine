import { Injectable } from '@angular/core';
import {
  AudioLoader,
  BufferGeometryLoader,
  ObjectLoader,
  RepeatWrapping,
  Texture,
  TextureLoader,
} from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { buildGraph, ObjectMap } from '../models';

@Injectable({
  providedIn: 'root',
})
export class LoaderService {
  textureLoader = new TextureLoader();
  bufferGeometryLoader = new BufferGeometryLoader();
  objectLoader = new ObjectLoader();
  svgLoader = new SVGLoader();
  gltfExporter = new GLTFExporter();
  audioLoader = new AudioLoader();

  gltfLoader = new GLTFLoader();
  dracoLoader: DRACOLoader = new DRACOLoader();
  stlLoader = new STLLoader();
  fbxLoader = new FBXLoader();

  readonly gltfCache = new Map<string, Promise<GLTF | undefined>>();
  readonly textureCache = new Map<string, Promise<Texture>>();

  constructor() {
    this.dracoLoader.setDecoderPath('/draco/'); // use Web Assembly version
    this.dracoLoader.preload();
    this.gltfLoader.setDRACOLoader(this.dracoLoader);
  }

  public loadAndCacheGltf(
    gltfPath: string,
    cachePath?: string,
    force = false,
  ): Promise<GLTF | undefined> {
    if (this.gltfCache.has(cachePath || gltfPath) && !force) {
      // Return the cached promise if the model is already loading or loaded
      return this.gltfCache.get(cachePath || gltfPath)!;
    }

    // Load the GLTF model and store the promise in the cache
    const gltfPromise = new Promise<GLTF | undefined>((resolve, reject) => {
      this.gltfLoader.load(
        gltfPath,
        (gltf) => {
          const objectMap = buildGraph(gltf.scene);

          gltf.userData['objectMap'] = objectMap;

          return resolve(gltf);
        },
        undefined,
        (error) => reject(error),
      );
    });

    this.gltfCache.set(cachePath || gltfPath, gltfPromise);

    return gltfPromise;
  }
  public loadAndCacheTexture(texturePath: string): Promise<Texture> {
    if (this.textureCache.has(texturePath)) {
      // Return the cached promise if the texture is already loading or loaded
      return this.textureCache.get(texturePath)!;
    }

    // Load the texture and store the promise in the cache
    const texturePromise = new Promise<Texture>((resolve, reject) => {
      this.textureLoader.load(
        texturePath,
        (texture) => {
          // texture.wrapS = RepeatWrapping;
          // texture.wrapT = RepeatWrapping;
          // texture.repeat.set(1, 1);

          return resolve(texture);
        },
        undefined,
        (error) => reject(error),
      );
    });

    this.textureCache.set(texturePath, texturePromise);
    return texturePromise;
  }
}
