import type { DataArrayTexture, DataTexture } from 'three';
import { clamp, exp2, float, floor, fract, int, max, min, mix, select, smoothstep, texture, uniform, vec2, vec3 } from 'three/tsl';
import type { IPlanetContext } from './planet-context';
import type { ISurfaceSample, SurfaceLayer } from './planet-surface-layers';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * What the layer reads from `TerrainMaterialTileGpu` (structurally, so this entry point does not import
 * `terrain`). Pass the real object: `streamedMaterialLayer(gpu)`.
 */
export interface IStreamedMaterialGpu {
  /** 128-texel pages with a 2-texel gutter, RGBA8, one array layer per resident page. */
  readonly pages: DataArrayTexture;
  /** 32x32 directory of `(slot | -(leaf + 1), level, x, y)`, float, nearest. */
  readonly directory: DataTexture;
  /** Leaf tables for directory cells that point at finer levels, float, nearest. */
  readonly leaves: DataArrayTexture;
  readonly enabled: { value: number };
  readonly debug: { value: number };
}

const TABLE = 32;
const INTERIOR = 128;
const PAGE = 132;
const GUTTER = 2;

export interface IStreamedMaterialLayer {
  readonly layer: SurfaceLayer;
  /** Mirrors `gpu.enabled` / `gpu.debug` each frame; nothing recompiles when they change. */
  readonly enabled: any;
  readonly debug: any;
}

/**
 * Surface layer: replaces the colour below with the streamed material tile under the fragment, via the
 * sparse two-level page table (at most two table reads, one colour read). A port of
 * `enableStreamedTerrainMaterial`.
 *
 * Every read is an explicit level-0 fetch: WGSL has no implicit derivatives in non-uniform control flow, and
 * array layers share no gutters or derivatives anyway. The "directory points at a leaf" branch is a
 * `select` over two reads, so there is no control flow around a texture fetch.
 */
export function streamedMaterialLayer(gpu: IStreamedMaterialGpu): IStreamedMaterialLayer {
  const enabled: any = uniform(gpu.enabled.value);
  const debug: any = uniform(gpu.debug.value);
  enabled.onFrameUpdate(() => {
    enabled.value = gpu.enabled.value;
  });
  debug.onFrameUpdate(() => {
    debug.value = gpu.debug.value;
  });

  const layer: SurfaceLayer = (context: IPlanetContext, below: ISurfaceSample) => {
    const domainUv = vec2(fract(context.uv.x), clamp(context.uv.y, 0, 0.9999999));
    const directoryUv = domainUv.mul(TABLE);
    const direct = texture(gpu.directory, floor(directoryUv).add(0.5).div(TABLE)).level(float(0));
    const leafLayer = int(max(direct.x.negate().sub(1), 0));
    const leafUv = floor(fract(directoryUv).mul(TABLE)).add(0.5).div(TABLE);
    const leaf = texture(gpu.leaves, leafUv).depth(leafLayer).level(float(0));
    const page = select(direct.x.lessThan(0), leaf, direct);

    const localUv = domainUv.mul(exp2(page.y)).sub(page.zw);
    const pageUv = localUv.mul(INTERIOR).add(GUTTER).div(PAGE);
    const streamed = texture(gpu.pages, pageUv).depth(int(page.x)).level(float(0)).rgb;

    const levelColour = vec3(0, 2, 4).add(page.y.mul(1.7)).cos().mul(0.5).add(0.5);
    const edge = min(localUv.x, localUv.y).min(float(1).sub(localUv.x).min(float(1).sub(localUv.y)));
    const line = float(1).sub(smoothstep(0, 0.01, edge));
    const debugged = mix(mix(streamed, levelColour, 0.5), vec3(1, 1, 1), line);
    const albedo = select(debug.greaterThan(0.5), debugged, streamed);

    return { ...below, albedo: select(enabled.greaterThan(0.5), albedo, below.albedo) };
  };

  return { layer, enabled, debug };
}
