import type { TerrainMaterialRgb } from '../terrain-material';
import {
  type ITerrainMaterialTileAddress,
  type ITerrainMaterialTileBakeOptions,
  type ITerrainMaterialTileIdentity,
  type ITerrainMaterialTilePayload,
  type ITerrainMaterialTileSource,
  validateTerrainMaterialTileAddress,
  validateTerrainMaterialTileBakeOptions,
} from './terrain-material-tile';

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function toByte(value: number): number {
  return Math.round(clamp01(value) * 255);
}

function sampleLevelZero(
  source: ITerrainMaterialTileSource,
  address: ITerrainMaterialTileAddress,
  interiorSize: number,
  gutterSize: number,
): Float32Array {
  const size = interiorSize + gutterSize * 2;
  const data = new Float32Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    // localV increases from the bottom of the tile. Keeping this convention in
    // the baker and GPU adapter avoids a silent north/south inversion.
    const localV = (y - gutterSize + 0.5) / interiorSize;
    for (let x = 0; x < size; x += 1) {
      const localU = (x - gutterSize + 0.5) / interiorSize;
      const colour = source.sample(localU, localV, address);
      const offset = (y * size + x) * 4;
      data[offset] = colour[0];
      data[offset + 1] = colour[1];
      data[offset + 2] = colour[2];
      data[offset + 3] = 1;
    }
  }
  return data;
}

function downsample(data: Float32Array, size: number): { data: Float32Array; size: number } {
  const nextSize = Math.max(1, Math.floor(size / 2));
  const next = new Float32Array(nextSize * nextSize * 4);
  for (let y = 0; y < nextSize; y += 1) {
    for (let x = 0; x < nextSize; x += 1) {
      const destination = (y * nextSize + x) * 4;
      const x0 = Math.min(size - 1, x * 2);
      const x1 = Math.min(size - 1, x * 2 + 1);
      const y0 = Math.min(size - 1, y * 2);
      const y1 = Math.min(size - 1, y * 2 + 1);
      const samples = [
        (y0 * size + x0) * 4,
        (y0 * size + x1) * 4,
        (y1 * size + x0) * 4,
        (y1 * size + x1) * 4,
      ];
      for (let channel = 0; channel < 4; channel += 1) {
        next[destination + channel] =
          (data[samples[0] + channel] +
            data[samples[1] + channel] +
            data[samples[2] + channel] +
            data[samples[3] + channel]) /
          4;
      }
    }
  }
  return { data: next, size: nextSize };
}

function encode(data: Float32Array): Uint8Array {
  const encoded = new Uint8Array(data.length);
  for (let index = 0; index < data.length; index += 1) {
    encoded[index] = toByte(data[index]);
  }
  return encoded;
}

/** Bakes a deterministic RGBA8 tile independently of mesh vertex density. */
export function bakeTerrainMaterialTile(
  identity: ITerrainMaterialTileIdentity,
  source: ITerrainMaterialTileSource,
  options: ITerrainMaterialTileBakeOptions,
): ITerrainMaterialTilePayload {
  validateTerrainMaterialTileAddress(identity.address);
  validateTerrainMaterialTileBakeOptions(options);
  const mipCount = options.mipLevels ?? 0;
  let size = options.interiorSize + options.gutterSize * 2;
  let level = sampleLevelZero(source, identity.address, options.interiorSize, options.gutterSize);
  const mipData: Uint8Array[] = [encode(level)];

  for (let mip = 0; mip < mipCount && size > 1; mip += 1) {
    const reduced = downsample(level, size);
    level = reduced.data;
    size = reduced.size;
    mipData.push(encode(level));
  }

  return {
    identity,
    interiorSize: options.interiorSize,
    gutterSize: options.gutterSize,
    width: options.interiorSize + options.gutterSize * 2,
    height: options.interiorSize + options.gutterSize * 2,
    mipData,
    byteLength: mipData.reduce((total, mip) => total + mip.byteLength, 0),
  };
}
