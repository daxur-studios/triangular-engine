import { DataTexture, LinearFilter, RGBAFormat, RepeatWrapping, UnsignedByteType } from 'three';

/** Texels per side of the noise texture, and so the period of the value noise in each axis, in noise units. */
export const NOISE_SIZE = 256;
export const NOISE_PERIOD = NOISE_SIZE;
/** The G channel is the R channel this many texels away (x, y), so one fetch gives two z-slices (a standard trick). */
export const NOISE_SLICE_SHIFT = { x: 37, y: 17 } as const;

/**
 * The noise bytes: RGBA8, `NOISE_SIZE` x `NOISE_SIZE`, row-major. R is random, G is R shifted by `NOISE_SLICE_SHIFT`,
 * B is zero, A is 255. Deterministic: the GPU texture and the CPU twin read these same bytes.
 */
export function generateNoiseBytes(): Uint8Array {
  const size = NOISE_SIZE;
  let seed = 0x9e3779b9;
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const red = new Uint8Array(size * size);
  for (let i = 0; i < red.length; i++) red[i] = Math.floor(random() * 256);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      data[i] = red[y * size + x];
      data[i + 1] = red[((y - NOISE_SLICE_SHIFT.y + size) % size) * size + ((x - NOISE_SLICE_SHIFT.x + size) % size)];
      data[i + 3] = 255;
    }
  }
  return data;
}

/** The noise texture: repeat-wrapped, linear-filtered, no mipmaps. */
export function createNoiseTexture(data: Uint8Array = generateNoiseBytes()): DataTexture {
  const noise = new DataTexture(data, NOISE_SIZE, NOISE_SIZE, RGBAFormat, UnsignedByteType);
  noise.wrapS = noise.wrapT = RepeatWrapping;
  noise.magFilter = noise.minFilter = LinearFilter;
  noise.generateMipmaps = false;
  noise.needsUpdate = true;
  return noise;
}
