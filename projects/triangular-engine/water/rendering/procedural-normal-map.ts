import {
  DataTexture,
  LinearFilter,
  NearestFilter,
  RGBAFormat,
  RepeatWrapping,
  UnsignedByteType,
} from 'three';

export interface ProceduralNormalMapOptions {
  /** Texture resolution in pixels (square). Default 256. */
  readonly size?: number;
  /** Number of summed tileable sine octaves. Default 5. */
  readonly octaves?: number;
  readonly seed?: number;
  /** Sampling mode. Pixel-style water uses nearest; default is linear. */
  readonly filter?: 'linear' | 'nearest';
}

/**
 * Generates a small, seamlessly tileable normal-map texture from summed
 * integer-frequency sine waves — tileable by construction, since any
 * integer spatial frequency completes a whole number of periods across
 * [0, 1). Used as the "fine chop" detail layer for water shading (see the
 * Phase 0 finding in docs/runbook/002_water_sublibrary.md that fine chop
 * must live in texture space, not the vertex grid) without requiring an
 * authored external asset. Swap in a real normal-map texture later by
 * assigning any tileable `Texture` in its place — `WATER_DETAIL_NORMAL_GLSL`
 * only assumes `RepeatWrapping` and the world-aligned (not tangent-space)
 * normal convention documented there.
 */
export function createProceduralNormalMapTexture(
  options: ProceduralNormalMapOptions = {},
): DataTexture {
  const size = options.size ?? 256;
  const octaves = options.octaves ?? 5;
  const seed = options.seed ?? 1;

  const random = mulberry32(seed);
  const waves: { fx: number; fz: number; amplitude: number }[] = [];
  let amplitudeSum = 0;
  for (let i = 0; i < octaves; i++) {
    const spread = 3 + i * 2;
    const fx = Math.round((random() * 2 - 1) * spread);
    const fz = Math.round((random() * 2 - 1) * spread);
    if (fx === 0 && fz === 0) continue;
    const amplitude = 1 / (i + 1);
    waves.push({ fx, fz, amplitude });
    amplitudeSum += amplitude;
  }

  const data = new Uint8Array(size * size * 4);
  const twoPi = Math.PI * 2;
  const gradientScale = 0.35 / Math.max(amplitudeSum, 0.0001);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      let dHdu = 0;
      let dHdv = 0;
      for (const wave of waves) {
        const phase = twoPi * (wave.fx * u + wave.fz * v);
        const c = Math.cos(phase) * wave.amplitude * twoPi;
        dHdu += c * wave.fx;
        dHdv += c * wave.fz;
      }
      const nx = -dHdu * gradientScale;
      const nz = -dHdv * gradientScale;
      const ny = 1;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);

      const i = (y * size + x) * 4;
      data[i] = Math.round(((nx / len) * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round(((nz / len) * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round(((ny / len) * 0.5 + 0.5) * 255);
      data[i + 3] = 255;
    }
  }

  const texture = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.magFilter =
    options.filter === 'nearest' ? NearestFilter : LinearFilter;
  texture.minFilter =
    options.filter === 'nearest' ? NearestFilter : LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Small deterministic PRNG so a given seed always produces the same texture. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
