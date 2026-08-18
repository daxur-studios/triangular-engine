/**
 * Configuration options for procedural 3D galaxy generation.
 *
 * Configures stellar count, galaxy dimensions (scale), spiral structure,
 * and orbital kinematics for realistic or miniature universe scale rendering.
 */
export interface IGalaxyConfig {
  /** Total number of star particles generated in the galaxy. */
  count: number;
  /** Outer radius of the stellar disk in world distance units. */
  radius: number;
  /** Radius of the central galactic bulge. */
  coreRadius: number;
  /** Number of logarithmic spiral arms radiating from the core (e.g., 2, 4). */
  arms: number;
  /** Tightness factor of the logarithmic spiral arm curves. */
  armSpin: number;
  /** Angular dispersion / thickness around spiral arm centers. */
  armScatter: number;
  /** Vertical scale height dispersion (thickness) of the stellar disk. */
  diskHeight: number;
  /** Fraction of stars belonging to the outer spherical stellar halo [0..1]. */
  haloRatio: number;
  /** Base orbital rotation speed multiplier around the galactic core. */
  rotationSpeed: number;
  /** Seed for deterministic pseudo-random star distribution. */
  seed?: number;
}

/**
 * Packed typed arrays representing generated star particles for WebGL buffer streaming.
 */
export interface IGalaxyStarData {
  /** Flat array of 3D star positions [x0, y0, z0, x1, y1, z1, ...]. */
  positions: Float32Array;
  /** Flat array of RGB color values [r0, g0, b0, r1, g1, b1, ...]. */
  colors: Float32Array;
  /** Array of individual star particle sizes. */
  sizes: Float32Array;
  /** Array of initial orbital phase angles in radians [0..2pi]. */
  phases: Float32Array;
  /** Array of orbital distance radii from the galactic center. */
  radii: Float32Array;
  /** Array of angular rotation velocities (rad/s). */
  speeds: Float32Array;
}

/** Default galaxy parameters providing a smooth, realistic 4-arm spiral. */
export const DEFAULT_GALAXY_CONFIG: Readonly<IGalaxyConfig> = {
  count: 40000,
  radius: 1000,
  coreRadius: 150,
  arms: 4,
  armSpin: 1.6,
  armScatter: 0.25,
  diskHeight: 30,
  haloRatio: 0.06,
  rotationSpeed: 0.05,
  seed: 42,
};

/**
 * Simple Mulberry32 PRNG for deterministic procedural galaxy generation.
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
 * Standard Gaussian random variable using full Box-Muller transform pairs.
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

/**
 * Harvard spectral classification colors (RGB 0..1).
 */
const SPECTRAL_COLORS: ReadonlyArray<[number, number, number]> = [
  [0.55, 0.72, 1.0], // O - Deep Cyan / Blue
  [0.72, 0.83, 1.0], // B - Blue White
  [0.88, 0.93, 1.0], // A - White
  [1.0, 0.96, 0.82], // F - Yellow White
  [1.0, 0.88, 0.45], // G - Yellow (Sun-like)
  [1.0, 0.62, 0.25], // K - Orange
  [1.0, 0.32, 0.18], // M - Red Dwarf
];

/**
 * Generates packed star position, color, size, and motion attributes for a 3D galaxy.
 *
 * Uses a density-wave logarithmic spiral model with a smooth central bulge,
 * continuous core-to-arm transitions, tapering arm tips, and an exponential stellar disk.
 *
 * @param config Galaxy parameters (star count, radius, spiral arms, etc.)
 * @returns Packed typed arrays ready for WebGL BufferGeometry attributes
 */
export function generateGalaxyData(
  config: Partial<IGalaxyConfig> = {},
): IGalaxyStarData {
  const merged: IGalaxyConfig = { ...DEFAULT_GALAXY_CONFIG, ...config };
  const rand = createPrng(merged.seed ?? 42);
  const nextGaussian = createGaussianGenerator(rand);

  const count = merged.count;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  const radii = new Float32Array(count);
  const speeds = new Float32Array(count);

  const haloCount = Math.floor(count * merged.haloRatio);
  const diskCount = count - haloCount;
  // 30% of disk stars form the central bulge; the rest form the spiral disk
  const bulgeCount = Math.floor(diskCount * 0.3);
  const armDiskCount = diskCount - bulgeCount;

  let idx = 0;

  // 1. Central Bulge (Smooth Gaussian 3D core density fading continuously into the disk)
  for (let i = 0; i < bulgeCount; i++, idx++) {
    const r = -Math.log(1.0 - rand() * 0.98) * (merged.coreRadius * 0.45);
    const theta = rand() * Math.PI * 2;
    const phi = Math.acos(2 * rand() - 1);

    const x = r * Math.sin(phi) * Math.cos(theta);
    // Bulge is slightly oblate (flattened along Y)
    const y = r * Math.cos(phi) * 0.55;
    const z = r * Math.sin(phi) * Math.sin(theta);

    positions[idx * 3] = x;
    positions[idx * 3 + 1] = y;
    positions[idx * 3 + 2] = z;

    // Bulge population: warm gold, orange, and yellow stars with soft variance
    const colorIdx = 3 + Math.floor(rand() * 4); // F, G, K, M
    const [cr, cg, cb] = SPECTRAL_COLORS[colorIdx];
    const coreIntensity = Math.max(0.6, 1.0 - r / (merged.coreRadius * 1.5));
    colors[idx * 3] = Math.min(1, (cr + (rand() - 0.5) * 0.08) * coreIntensity);
    colors[idx * 3 + 1] = Math.min(
      1,
      (cg + (rand() - 0.5) * 0.08) * coreIntensity,
    );
    colors[idx * 3 + 2] = Math.min(
      1,
      (cb + (rand() - 0.5) * 0.08) * coreIntensity,
    );

    sizes[idx] = 1.0 + rand() * 2.2;
    phases[idx] = Math.atan2(z, x);
    const orbitalR = Math.sqrt(x * x + z * z) + 0.01;
    radii[idx] = orbitalR;
    // Core differential rotation
    speeds[idx] = merged.rotationSpeed * (1.0 + 0.15 * nextGaussian());
  }

  // 2. Spiral Arms & Exponential Disk Stars
  for (let i = 0; i < armDiskCount; i++, idx++) {
    const rScale = merged.radius * 0.38;
    const u = rand();
    const r = Math.min(
      merged.radius * 1.15,
      -Math.log(1.0 - u * 0.95) * rScale,
    );

    const isArmStar = rand() < 0.72;

    let totalAngle: number;
    let angularSpread: number;

    if (isArmStar) {
      const armIndex = i % merged.arms;
      const armAngleOffset = (armIndex * 2 * Math.PI) / merged.arms;

      // Logarithmic spiral equation: theta(r) = spin * ln(r / r0 + 1)
      const spiralAngle =
        Math.log(r / (merged.coreRadius * 0.5) + 1.0) * merged.armSpin;

      // Arm width tapering: Arms are tight near core, thins at tips
      const rNorm = r / merged.radius;
      const armThicknessEnvelope =
        Math.sin(Math.PI * Math.pow(rNorm, 0.7)) * 0.8 + 0.2;

      // Gaussian angular dispersion off the spiral arm spine
      angularSpread = nextGaussian() * merged.armScatter * armThicknessEnvelope;
      totalAngle = armAngleOffset + spiralAngle + angularSpread;
    } else {
      totalAngle = rand() * Math.PI * 2;
      angularSpread = 1.0;
    }

    const x = r * Math.cos(totalAngle);
    const z = r * Math.sin(totalAngle);

    // Disk scale height hz(r) is strictly proportional to r near the center (centerTaper -> 0 as r -> 0)
    // to prevent vertical stacking poles at small r when viewed from ecliptic plane
    const centerTaper = Math.min(1.0, r / (merged.coreRadius * 0.75));
    const diskH =
      merged.diskHeight * centerTaper * Math.exp(-r / (merged.radius * 0.6));
    const y = nextGaussian() * diskH * 0.45;

    positions[idx * 3] = x;
    positions[idx * 3 + 1] = y;
    positions[idx * 3 + 2] = z;

    // Stellar classification color:
    const distFromArmSpine = Math.abs(angularSpread);
    let colorIdx: number;

    if (
      isArmStar &&
      distFromArmSpine < merged.armScatter * 0.4 &&
      rand() < 0.65
    ) {
      colorIdx = Math.floor(rand() * 3); // O, B, A (Blue/Cyan/White)
    } else if (r > merged.radius * 0.7) {
      colorIdx = 4 + Math.floor(rand() * 3); // G, K, M (Older outer disk stars)
    } else {
      colorIdx = Math.floor(rand() * SPECTRAL_COLORS.length);
    }

    const outerFade = Math.max(
      0.2,
      1.0 - Math.pow(r / (merged.radius * 1.1), 3),
    );
    const [cr, cg, cb] = SPECTRAL_COLORS[colorIdx];

    colors[idx * 3] = Math.min(1, (cr + (rand() - 0.5) * 0.05) * outerFade);
    colors[idx * 3 + 1] = Math.min(1, (cg + (rand() - 0.5) * 0.05) * outerFade);
    colors[idx * 3 + 2] = Math.min(1, (cb + (rand() - 0.5) * 0.05) * outerFade);

    sizes[idx] = (0.7 + rand() * 1.8) * (isArmStar && colorIdx < 3 ? 1.3 : 1.0);
    phases[idx] = totalAngle;
    radii[idx] = r;

    // Galaxy rotation curve: flat rotation curve v(r) ~ const -> omega = v / r
    speeds[idx] =
      (merged.rotationSpeed * merged.radius) / (r + merged.coreRadius * 0.4);
  }

  // 3. Spherical Stellar Halo Stars
  for (let i = 0; i < haloCount; i++, idx++) {
    const r =
      (-Math.log(1.0 - rand() * 0.98) * 0.4 + 0.1) * merged.radius * 1.4;
    const theta = rand() * Math.PI * 2;
    const phi = Math.acos(2 * rand() - 1);

    const x = r * Math.sin(phi) * Math.cos(theta);
    const y = r * Math.cos(phi) * 0.8;
    const z = r * Math.sin(phi) * Math.sin(theta);

    positions[idx * 3] = x;
    positions[idx * 3 + 1] = y;
    positions[idx * 3 + 2] = z;

    // Dim, old halo stars (K, M red/orange dwarfs)
    const [cr, cg, cb] = SPECTRAL_COLORS[5 + Math.floor(rand() * 2)];
    colors[idx * 3] = cr * 0.5;
    colors[idx * 3 + 1] = cg * 0.5;
    colors[idx * 3 + 2] = cb * 0.5;

    sizes[idx] = 0.4 + rand() * 0.8;
    phases[idx] = Math.atan2(z, x);
    radii[idx] = Math.sqrt(x * x + z * z) + 0.01;
    speeds[idx] = merged.rotationSpeed * 0.15;
  }

  return { positions, colors, sizes, phases, radii, speeds };
}
