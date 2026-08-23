import type { Material, Object3D, PlaneGeometry, WebGLRenderer } from 'three';

import {
  buildOctahedralImpostorMesh,
  createOctahedralImpostorAtlas,
  type IOctahedralImpostorAtlas,
  type IOctahedralImpostorMaterialHandle,
  type OctahedralImpostorType,
} from 'triangular-engine/impostor';
import type { IScatterLodAssets } from './scatter-lod-instanced-meshes';

export interface IBuildScatterImpostorAssetsOptions<T extends Material> {
  readonly renderer: WebGLRenderer;
  /**
   * Bake source — its own world position leaks into the baked
   * `impostorTransform`, so this must not be the same instance actually
   * rendered on screen; use a throwaway object positioned at the world
   * origin.
   */
  readonly target: Object3D;
  readonly baseType: new () => T;
  /** Full size (px) of the square atlas. @default 2048 */
  readonly textureSize?: number;
  /** Grid cells per side; `spritesPerSide ** 2` unique baked views. @default 16 */
  readonly spritesPerSide?: number;
  readonly alphaClamp?: number;
  readonly transparent?: boolean;
  /**
   * Coverage mode of the octahedral impostor.
   * - `'hemispherical'`: 180° upper hemisphere coverage.
   * - `'spherical'`: 360° full sphere coverage.
   * @default 'hemispherical'
   */
  readonly type?: OctahedralImpostorType;
}

export interface IScatterImpostorAssets<T extends Material> extends IScatterLodAssets {
  readonly geometry: PlaneGeometry;
  readonly material: T;
  readonly atlas: IOctahedralImpostorAtlas;
  readonly materialHandle: IOctahedralImpostorMaterialHandle<T>;
}

/**
 * One-shot bake producing the `{ geometry, material }` pair a scatter LOD
 * tier needs for `kind: 'impostor'` — thin wrapper over
 * `triangular-engine/impostor`'s `createOctahedralImpostorAtlas` +
 * `buildOctahedralImpostorMesh`, reshaped to match `IScatterLodAssets` so it
 * drops straight into `assetsByTier`. The caller owns disposal of the
 * returned `atlas`/`geometry`/`material`.
 */
export function buildScatterImpostorAssets<T extends Material>(
  options: IBuildScatterImpostorAssetsOptions<T>,
): IScatterImpostorAssets<T> {
  options.target.updateMatrixWorld(true);

  const atlas = createOctahedralImpostorAtlas({
    renderer: options.renderer,
    target: options.target,
    textureSize: options.textureSize,
    spritesPerSide: options.spritesPerSide,
    type: options.type,
  });

  const { mesh, materialHandle } = buildOctahedralImpostorMesh<T>({
    target: options.target,
    baseType: options.baseType,
    albedo: atlas.albedo,
    normalDepth: atlas.normalDepth,
    spritesPerSide: options.spritesPerSide,
    alphaClamp: options.alphaClamp,
    transparent: options.transparent,
    type: options.type,
  });

  return {
    geometry: mesh.geometry,
    material: materialHandle.material,
    atlas,
    materialHandle,
  };
}
