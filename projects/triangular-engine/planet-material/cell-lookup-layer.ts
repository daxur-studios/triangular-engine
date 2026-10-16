import { DataTexture, FloatType, NearestFilter, NoColorSpace, RGBAFormat, UnsignedByteType } from 'three';
import { asin, atan, clamp, float, floor, mix, select, texture, uniform, vec2 } from 'three/tsl';
import type { IPlanetContext } from './planet-context';
import type { ISurfaceSample, SurfaceLayer } from './planet-surface-layers';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * The same shape as `ICellPerPixelLookupPayload` (from `buildCellPerPixelLookupPayload`), declared here so
 * this entry point does not import `worldgen/render`.
 */
export interface ICellLookupPayload {
  /** One RGBA float texel per cell; RGB is the linear display colour, A the blend weight. */
  readonly cellData: Float32Array;
  readonly cellTextureWidth: number;
  /** RG encodes the cell id as low/high bytes; one texel per atlas pixel. */
  readonly cellIdData: Uint8Array;
  readonly cellIdWidth: number;
  readonly cellIdHeight: number;
}

const PI = Math.PI;

function dataTexture(
  data: Float32Array | Uint8Array,
  width: number,
  height: number,
  type: typeof FloatType | typeof UnsignedByteType,
): DataTexture {
  const t = new DataTexture(data, width, height, RGBAFormat, type);
  // Nearest only: float textures are not filterable everywhere on WebGPU, and ids must not blend.
  t.minFilter = t.magFilter = NearestFilter;
  t.generateMipmaps = false;
  // The id texture holds integers, not colours: no sRGB conversion.
  t.colorSpace = NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Direction -> atlas uv, in the static map frame: `lon = atan2(x, z)`, as the CPU atlas builder writes it. */
export function cellAtlasUv(direction: any): any {
  const latitude = asin(clamp(direction.y, -1, 1));
  const longitude = atan(direction.x, direction.z);
  return vec2(longitude.add(PI).div(2 * PI), latitude.add(PI / 2).div(PI));
}

export interface ICellLookupLayer {
  readonly layer: SurfaceLayer;
  /** 1 = on. Uniform nodes: change `.value`, nothing recompiles. */
  readonly enabled: any;
  readonly opacity: any;
  /** Uploads a worker-produced lookup and enables the layer. Replaces (and disposes) the previous textures. */
  setLookup(payload: ICellLookupPayload): void;
  /** Rewrites only the colour table (same cell count). */
  updatePalette(cellData: Float32Array): void;
  dispose(): void;
}

/**
 * Surface layer: one cell-id atlas fetch plus one colour-table fetch per fragment, blended over the layer
 * below by `colour.a * opacity`. A port of `enableCellPerPixelLookup`. Disabled until `setLookup` runs.
 *
 * The textures live in texture nodes created once, so swapping them in `setLookup` never recompiles.
 */
export function cellLookupLayer(): ICellLookupLayer {
  let cellData = dataTexture(new Float32Array([0, 0, 0, 1]), 1, 1, FloatType);
  let cellIds = dataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, UnsignedByteType);
  const enabled = uniform(0);
  const opacity = uniform(1);
  const cellTextureWidth = uniform(1);
  const dataNode: any = texture(cellData);
  const idsNode: any = texture(cellIds);

  const layer: SurfaceLayer = (context: IPlanetContext, below: ISurfaceSample) => {
    const direction = context.sphereNormal.normalize();
    const encoded = idsNode.sample(cellAtlasUv(direction)).level(float(0));
    const cellId = floor(encoded.r.mul(255).add(0.5)).add(floor(encoded.g.mul(255).add(0.5)).mul(256));
    const colour = dataNode.sample(vec2(cellId.add(0.5).div(cellTextureWidth), float(0.5))).level(float(0));
    const blended = mix(below.albedo, colour.rgb, colour.a.mul(opacity));
    return { ...below, albedo: select(enabled.greaterThan(0.5), blended, below.albedo) };
  };

  return {
    layer,
    enabled,
    opacity,
    setLookup(payload) {
      const oldData = cellData;
      const oldIds = cellIds;
      cellData = dataTexture(payload.cellData, payload.cellTextureWidth, 1, FloatType);
      cellIds = dataTexture(payload.cellIdData, payload.cellIdWidth, payload.cellIdHeight, UnsignedByteType);
      dataNode.value = cellData;
      idsNode.value = cellIds;
      cellTextureWidth.value = payload.cellTextureWidth;
      enabled.value = 1;
      oldData.dispose();
      oldIds.dispose();
    },
    updatePalette(next) {
      const data = cellData.image.data as Float32Array;
      if (data.length !== next.length) {
        throw new RangeError('Cell palette length does not match the resident cell lookup.');
      }
      data.set(next);
      cellData.needsUpdate = true;
    },
    dispose() {
      cellData.dispose();
      cellIds.dispose();
    },
  };
}
