import { Vector3 } from 'three';

/**
 * Contract every water consumer samples: the displaced mesh's vertex shader,
 * the waterline effect, underwater detection, buoyancy, and enter/leave
 * events. There must be exactly one implementation in play per water body —
 * see docs/runbook/002_water_sublibrary.md ("the one decision to make now").
 */
export interface WaterSurface {
  /** Surface height (local Y) at world XZ and time t, in seconds. */
  getHeight(x: number, z: number, t: number): number;
  /** Outward surface normal at world XZ and time t. */
  getNormal(x: number, z: number, t: number, out?: Vector3): Vector3;
  /** Horizontal flow velocity in m/s; zero for still water (oceans/lakes). */
  getFlow(x: number, z: number, t: number, out?: Vector3): Vector3;
}

export interface GerstnerWaveDefinition {
  /** Horizontal travel direction; does not need to be pre-normalized. */
  readonly direction: readonly [number, number];
  /** Crest-to-crest distance in metres. Must be positive. */
  readonly wavelength: number;
  /** Wave height in metres (crest-to-trough is roughly 2x this). */
  readonly amplitude: number;
  /** 0..1 — fraction of amplitude converted into horizontal (crest-sharpening) displacement. */
  readonly steepness: number;
  /** Multiplies the deep-water phase speed derived from wavelength. 1 = physically plausible. */
  readonly speedMultiplier?: number;
}

export interface WaterWavePreset {
  readonly name: string;
  readonly waves: readonly GerstnerWaveDefinition[];
}

/** Standard gravity, m/s^2 — drives the deep-water dispersion relation ω = sqrt(g·k). */
const GRAVITY = 9.80665;

/** A wave definition resolved to the exact values both the TS and GLSL evaluators consume. */
export interface ResolvedGerstnerWave {
  readonly dirX: number;
  readonly dirZ: number;
  /** Angular wavenumber, 2π / wavelength. */
  readonly k: number;
  readonly amplitude: number;
  readonly steepness: number;
  /** Angular frequency (rad/s). */
  readonly omega: number;
}

/**
 * Resolves raw wave definitions into the exact numbers used for displacement
 * math. Exported so the GLSL uniform builder (gerstner-glsl.ts) derives its
 * per-wave k/omega from this same function as GerstnerSurface — CPU and GPU
 * cannot drift apart because they share this one computation.
 */
export function resolveGerstnerWave(
  def: GerstnerWaveDefinition,
): ResolvedGerstnerWave {
  const { direction, wavelength, amplitude, steepness, speedMultiplier = 1 } =
    def;
  if (!(wavelength > 0)) {
    throw new Error('GerstnerSurface: wavelength must be a positive number.');
  }
  const [dx, dz] = direction;
  const length = Math.hypot(dx, dz);
  if (length === 0) {
    throw new Error('GerstnerSurface: wave direction must be nonzero.');
  }
  const k = (2 * Math.PI) / wavelength;
  const omega = Math.sqrt(GRAVITY * k) * speedMultiplier;
  return {
    dirX: dx / length,
    dirZ: dz / length,
    k,
    amplitude,
    steepness: Math.max(0, Math.min(1, steepness)),
    omega,
  };
}

export function resolveGerstnerWaves(
  defs: readonly GerstnerWaveDefinition[],
): ResolvedGerstnerWave[] {
  return defs.map(resolveGerstnerWave);
}

/**
 * Sum-of-Gerstner-waves WaterSurface. Displacement math follows the
 * standard formulation (GPU Gems, "Effective Water Simulation from Physical
 * Models"); the GLSL vertex shader in gerstner-glsl.ts implements the same
 * `displace()` formula from the same resolved wave list.
 *
 * getHeight/getNormal sample the surface at a *world* XZ position, which
 * Gerstner waves complicate: the mesh is parameterised by an undisplaced
 * base (x0, z0) that maps to world (x, z) only after horizontal
 * displacement is applied. This class inverts that mapping with a bounded
 * fixed-point iteration (solveBase) — it converges reliably as long as
 * preset steepness stays within the documented risk (summed steepness < 1).
 */
export class GerstnerSurface implements WaterSurface {
  readonly waves: readonly ResolvedGerstnerWave[];

  constructor(waves: readonly GerstnerWaveDefinition[]) {
    if (waves.length === 0) {
      throw new Error('GerstnerSurface requires at least one wave.');
    }
    this.waves = resolveGerstnerWaves(waves);
    const steepnessSum = this.waves.reduce((sum, w) => sum + w.steepness, 0);
    if (steepnessSum > 1) {
      console.warn(
        `GerstnerSurface: summed steepness (${steepnessSum.toFixed(2)}) exceeds 1 — ` +
          'waves may self-intersect and getHeight()/getNormal() may converge poorly.',
      );
    }
  }

  /** World-space position after displacement, given an undisplaced base (x0, z0). */
  displace(x0: number, z0: number, t: number, out = new Vector3()): Vector3 {
    let dx = 0;
    let dy = 0;
    let dz = 0;
    for (const w of this.waves) {
      const phase = w.k * (w.dirX * x0 + w.dirZ * z0) - w.omega * t;
      const c = Math.cos(phase);
      const s = Math.sin(phase);
      dx += w.steepness * w.amplitude * w.dirX * c;
      dz += w.steepness * w.amplitude * w.dirZ * c;
      dy += w.amplitude * s;
    }
    return out.set(x0 + dx, dy, z0 + dz);
  }

  getHeight(x: number, z: number, t: number): number {
    const base = this.solveBase(x, z, t);
    return this.heightAtBase(base.x0, base.z0, t);
  }

  getNormal(x: number, z: number, t: number, out = new Vector3()): Vector3 {
    const base = this.solveBase(x, z, t);
    return this.normalAtBase(base.x0, base.z0, t, out);
  }

  getFlow(_x: number, _z: number, _t: number, out = new Vector3()): Vector3 {
    return out.set(0, 0, 0);
  }

  private heightAtBase(x0: number, z0: number, t: number): number {
    let dy = 0;
    for (const w of this.waves) {
      const phase = w.k * (w.dirX * x0 + w.dirZ * z0) - w.omega * t;
      dy += w.amplitude * Math.sin(phase);
    }
    return dy;
  }

  private normalAtBase(
    x0: number,
    z0: number,
    t: number,
    out: Vector3,
  ): Vector3 {
    // Tangent vectors of the displaced surface with respect to the base
    // parameters (x0, z0); the normal is their cross product.
    let dYdx0 = 0;
    let dYdz0 = 0;
    let dxdx0 = 1;
    let dzdz0 = 1;
    let cross0 = 0;
    for (const w of this.waves) {
      const phase = w.k * (w.dirX * x0 + w.dirZ * z0) - w.omega * t;
      const s = Math.sin(phase);
      const c = Math.cos(phase);
      const wa = w.k * w.amplitude;
      dYdx0 += w.dirX * wa * c;
      dYdz0 += w.dirZ * wa * c;
      const qwa = w.steepness * wa;
      dxdx0 -= qwa * w.dirX * w.dirX * s;
      dzdz0 -= qwa * w.dirZ * w.dirZ * s;
      cross0 -= qwa * w.dirX * w.dirZ * s;
    }
    tangentX0.set(dxdx0, dYdx0, cross0);
    tangentZ0.set(cross0, dYdz0, dzdz0);
    return out.crossVectors(tangentZ0, tangentX0).normalize();
  }

  private solveBase(
    x: number,
    z: number,
    t: number,
    iterations = 4,
  ): { x0: number; z0: number } {
    let x0 = x;
    let z0 = z;
    for (let i = 0; i < iterations; i++) {
      this.displace(x0, z0, t, scratchDisplace);
      x0 += x - scratchDisplace.x;
      z0 += z - scratchDisplace.z;
    }
    return { x0, z0 };
  }
}

const scratchDisplace = new Vector3();
const tangentX0 = new Vector3();
const tangentZ0 = new Vector3();
