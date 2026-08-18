import { DEFAULT_GALAXY_CONFIG, IGalaxyConfig } from './galaxy-generator';

/**
 * Packed typed arrays representing interstellar dust particles for WebGL rendering.
 */
export interface IGalaxyDustData {
  /** Flat array of 3D dust particle positions [x0, y0, z0, x1, y1, z1, ...]. */
  positions: Float32Array;
  /** Flat array of RGB dust opacity/color values [r0, g0, b0, r1, g1, b1, ...]. */
  colors: Float32Array;
  /** Array of dust particle sizes. */
  sizes: Float32Array;
  /** Array of initial orbital phase angles in radians. */
  phases: Float32Array;
  /** Array of orbital distance radii from the galactic center. */
  radii: Float32Array;
  /** Array of angular rotation velocities (rad/s). */
  speeds: Float32Array;
}

/**
 * Simple Mulberry32 PRNG for deterministic procedural dust generation.
 */
function createPrng(seed: number): () => number {
  let state = seed >>> 0;
  return function () {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Standard Gaussian random variable generator using cached Box-Muller pairs.
 */
function createGaussianGenerator(rand: () => number): () => number {
  let cache: number | null = null;
  return function () {
    if (cache !== null) {
      const val = cache;
      cache = null;
      return val;
    }
    let u = 0;
    let v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    const mag = Math.sqrt(-2.0 * Math.log(u));
    cache = mag * Math.sin(2.0 * Math.PI * v);
    return mag * Math.cos(2.0 * Math.PI * v);
  };
}

/** Dark absorption dust color palettes (dark charcoal, reddish brown, deep soot). */
const DUST_COLORS: ReadonlyArray<[number, number, number]> = [
  [0.08, 0.05, 0.04], // Dark reddish brown
  [0.05, 0.05, 0.06], // Dark charcoal gray
  [0.03, 0.02, 0.02], // Dark soot
  [0.1, 0.07, 0.04], // Warm dark dust
  [0.02, 0.04, 0.07], // Dark navy dust
];

/**
 * Generates dark interstellar dust particle positions concentrating along galactic mid-plane
 * and spiral arm dust lanes to absorb background core light.
 *
 * Uses continuous exponential inner bulge tapering to eliminate hard cutoffs or sharp hook artifacts.
 *
 * @param config Galaxy parameters
 * @returns Packed dust particle data
 */
export function generateGalaxyDustData(
  config: Partial<IGalaxyConfig> = {},
): IGalaxyDustData {
  const merged: IGalaxyConfig = { ...DEFAULT_GALAXY_CONFIG, ...config };
  const rand = createPrng((merged.seed ?? 42) + 999);
  const nextGaussian = createGaussianGenerator(rand);

  // Generate ~25% as many dust particles as stars
  const dustCount = Math.floor(merged.count * 0.25);
  const positions = new Float32Array(dustCount * 3);
  const colors = new Float32Array(dustCount * 3);
  const sizes = new Float32Array(dustCount);
  const phases = new Float32Array(dustCount);
  const radii = new Float32Array(dustCount);
  const speeds = new Float32Array(dustCount);

  for (let i = 0; i < dustCount; i++) {
    const rScale = merged.radius * 0.35;
    const r = Math.min(
      merged.radius * 1.05,
      -Math.log(1.0 - rand() * 0.96) * rScale,
    );

    const armIndex = i % merged.arms;
    const armAngleOffset = (armIndex * 2 * Math.PI) / merged.arms;
    const spiralAngle =
      Math.log(r / (merged.coreRadius * 0.5) + 0.2) * merged.armSpin;

    // Smooth continuous inner bulge tapering (Gaussian falloff towards r = 0)
    const innerTaper =
      1.0 - Math.exp(-Math.pow(r / (merged.coreRadius * 0.9), 2.0));
    const rNorm = Math.min(1.0, r / merged.radius);
    const outerTaper = Math.sin(Math.PI * Math.pow(rNorm, 0.75));

    // Increase angular dispersion near the core so dust dissolves into a diffuse ambient haze
    const scatterMultiplier =
      1.0 + 1.8 * Math.exp(-r / (merged.coreRadius * 0.8));
    const dustOffset = -0.1;
    const armThickness = outerTaper * 0.6 + 0.2;
    const angularSpread =
      (dustOffset + nextGaussian() * 0.7) *
      merged.armScatter *
      armThickness *
      scatterMultiplier;

    const totalAngle = armAngleOffset + spiralAngle + angularSpread;

    const x = r * Math.cos(totalAngle);
    const z = r * Math.sin(totalAngle);

    // Dust is confined to the mid-plane (y ~ 0) with core scale height tapering
    const centerH = Math.min(1.0, r / (merged.coreRadius * 0.5));
    const dustH =
      merged.diskHeight * 0.3 * centerH * Math.exp(-r / (merged.radius * 0.6));
    const y = nextGaussian() * dustH;

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    const [cr, cg, cb] = DUST_COLORS[Math.floor(rand() * DUST_COLORS.length)];
    colors[i * 3] = cr;
    colors[i * 3 + 1] = cg;
    colors[i * 3 + 2] = cb;

    // Particle sizes smoothly taper off towards inner core & outer tips
    const particleScale = innerTaper * outerTaper;
    sizes[i] = (1.5 + rand() * 3.0) * (0.25 + 0.75 * particleScale);
    phases[i] = totalAngle;
    radii[i] = r;

    speeds[i] =
      (merged.rotationSpeed * merged.radius) / (r + merged.coreRadius * 0.4);
  }

  return { positions, colors, sizes, phases, radii, speeds };
}
