/**
 * CPU reference integrator: plain float64 TypeScript, no GPU, no three. It is the ground truth the
 * GPU LUTs are compared against (Plan 049, Phase 2), so it favours clarity and accuracy over speed.
 *
 * Geometry: the planet is centred at the origin; positions are metres, directions are unit vectors.
 * Radiance is in units of the sun irradiance (`profile.sun.irradiance`), per steradian.
 *
 * Model: Hillaire 2020 ("A Scalable and Production Ready Sky and Atmosphere Rendering Technique").
 * Single scattering is integrated along the view ray with the sun's transmittance (and the planet's
 * shadow) at each sample. Multiple scattering uses his isotropic second-order approximation,
 * `psi = L2 / (1 - fms)`, added as a source `sigma_s * psi` along the ray.
 */
import { miePhaseRgb, rayleighPhase, sampleMedium } from './atmosphere-medium';
import { AtmosphereRgb, AtmosphereVec3, PhysicalAtmosphereProfile } from './atmosphere-profile';

const FOUR_PI = 4 * Math.PI;

const dot = (a: AtmosphereVec3, b: AtmosphereVec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const along = (o: AtmosphereVec3, d: AtmosphereVec3, t: number): AtmosphereVec3 => [
  o[0] + d[0] * t,
  o[1] + d[1] * t,
  o[2] + d[2] * t,
];
const length = (v: AtmosphereVec3) => Math.sqrt(dot(v, v));

export function normalizeVec3(v: AtmosphereVec3): AtmosphereVec3 {
  const l = length(v);
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Both intersections of a ray with a sphere at the origin, or null when it misses. */
export function raySphere(origin: AtmosphereVec3, dir: AtmosphereVec3, radius: number): { t0: number; t1: number } | null {
  const b = dot(origin, dir);
  const c = dot(origin, origin) - radius * radius;
  const disc = b * b - c;
  if (disc <= 0) return null;
  const s = Math.sqrt(disc);
  return { t0: -b - s, t1: -b + s };
}

/**
 * Distance to the ground along a ray, or null. A ray that starts on the ground and points up (or
 * along the horizon) does not hit it; one that points down hits it at distance 0.
 *
 * Points computed to lie on the ground are off the sphere by float rounding, in either direction
 * (about 4e-3 m^2 in `c` at Earth scale). Without the tolerance below, an upward ray from such a
 * point is randomly treated as starting inside the planet and comes back as a hit at distance 0,
 * shadowing the point from the sun.
 */
export function groundHitDistance(origin: AtmosphereVec3, dir: AtmosphereVec3, groundRadius: number): number | null {
  const b = dot(origin, dir);
  const c = dot(origin, origin) - groundRadius * groundRadius;
  const disc = b * b - c;
  const onSurfaceTolerance = 1e-9 * groundRadius * groundRadius;
  if (disc <= 0 || (b >= 0 && c > -onSurfaceTolerance)) return null;
  return Math.max(0, -b - Math.sqrt(disc));
}

export interface AtmosphereSegment {
  readonly tStart: number;
  readonly tEnd: number;
  readonly hitsGround: boolean;
}

/** The part of a ray inside the atmosphere, ending at the ground when the ray hits it. */
export function traceAtmosphere(
  profile: PhysicalAtmosphereProfile,
  origin: AtmosphereVec3,
  dir: AtmosphereVec3,
): AtmosphereSegment | null {
  const top = raySphere(origin, dir, profile.planetRadiusM + profile.topAltitudeM);
  if (!top || top.t1 <= 0) return null;
  const tStart = Math.max(top.t0, 0);
  const ground = groundHitDistance(origin, dir, profile.planetRadiusM);
  if (ground !== null) return { tStart, tEnd: Math.max(ground, tStart), hitsGround: true };
  return { tStart, tEnd: top.t1, hitsGround: false };
}

/** Sample distances for a midpoint rule over [t0, t1]. `start` clusters samples near `t0`. */
function sampleDistances(t0: number, t1: number, steps: number, bias: 'uniform' | 'start') {
  const out: { t: number; dt: number }[] = [];
  const span = t1 - t0;
  for (let i = 0; i < steps; i++) {
    const u = (i + 0.5) / steps;
    if (bias === 'uniform') out.push({ t: t0 + span * u, dt: span / steps });
    else out.push({ t: t0 + span * u * u, dt: (span * 2 * u) / steps });
  }
  return out;
}

/** Extinction integrated over [t0, t1] along a ray, per channel. Steps cluster near `t0`. */
export function opticalDepth(
  profile: PhysicalAtmosphereProfile,
  origin: AtmosphereVec3,
  dir: AtmosphereVec3,
  t0: number,
  t1: number,
  steps = 64,
): AtmosphereRgb {
  const od: [number, number, number] = [0, 0, 0];
  for (const { t, dt } of sampleDistances(t0, t1, steps, 'start')) {
    const p = along(origin, dir, t);
    const e = sampleMedium(profile, length(p) - profile.planetRadiusM).extinction;
    od[0] += e[0] * dt;
    od[1] += e[1] * dt;
    od[2] += e[2] * dt;
  }
  return od;
}

/** Optical depth from a point to the top of the atmosphere, ignoring the ground. */
export function opticalDepthToTop(
  profile: PhysicalAtmosphereProfile,
  origin: AtmosphereVec3,
  dir: AtmosphereVec3,
  steps = 64,
): AtmosphereRgb {
  const top = raySphere(origin, dir, profile.planetRadiusM + profile.topAltitudeM);
  if (!top || top.t1 <= 0) return [0, 0, 0];
  return opticalDepth(profile, origin, dir, Math.max(0, top.t0), top.t1, steps);
}

const expNeg = (od: AtmosphereRgb): AtmosphereRgb => [Math.exp(-od[0]), Math.exp(-od[1]), Math.exp(-od[2])];

/** Transmittance from a point to the top of the atmosphere in a direction (0 where the ground blocks it). */
export function transmittanceToTop(
  profile: PhysicalAtmosphereProfile,
  origin: AtmosphereVec3,
  dir: AtmosphereVec3,
  steps = 64,
): AtmosphereRgb {
  if (groundHitDistance(origin, dir, profile.planetRadiusM) !== null) return [0, 0, 0];
  return expNeg(opticalDepthToTop(profile, origin, dir, steps));
}

/** Transmittance of sunlight reaching `point`: 0 in the planet's shadow. */
export function sunTransmittance(
  profile: PhysicalAtmosphereProfile,
  point: AtmosphereVec3,
  sunDir: AtmosphereVec3,
  steps = 32,
): AtmosphereRgb {
  return transmittanceToTop(profile, point, sunDir, steps);
}

/** Transmittance along a finite stretch of ray. */
export function transmittanceAlong(
  profile: PhysicalAtmosphereProfile,
  origin: AtmosphereVec3,
  dir: AtmosphereVec3,
  distanceM: number,
  steps = 64,
): AtmosphereRgb {
  const seg = traceAtmosphere(profile, origin, dir);
  if (!seg) return [1, 1, 1];
  const end = Math.min(seg.tEnd, distanceM);
  if (end <= seg.tStart) return [1, 1, 1];
  return expNeg(opticalDepth(profile, origin, dir, seg.tStart, end, steps));
}

/** Optical depth of a ray starting at `altitudeM` and running to the top; `elevation` is the angle above the horizon. */
export function opticalDepthFromAltitude(
  profile: PhysicalAtmosphereProfile,
  altitudeM: number,
  cosZenith: number,
  steps = 256,
): AtmosphereRgb {
  const sin = Math.sqrt(Math.max(0, 1 - cosZenith * cosZenith));
  return opticalDepthToTop(
    profile,
    [0, profile.planetRadiusM + altitudeM, 0],
    [sin, cosZenith, 0],
    steps,
  );
}

// -- multiple scattering ---------------------------------------------------------------------

export interface MultiScatteringTerm {
  /** Isotropic multi-scattered illumination to scatter again: source = `scattering * psi` (sun irradiance = 1). */
  readonly psi: AtmosphereRgb;
  /** Second-order luminance averaged over the sphere. */
  readonly l2: AtmosphereRgb;
  /** Fraction of light scattered again, averaged over the sphere; < 1. */
  readonly fms: AtmosphereRgb;
}

export interface MultiScatteringOptions {
  /** Directions over the sphere (Fibonacci spiral). Default 64. */
  directions?: number;
  /** Samples along each direction. Default 24. */
  steps?: number;
  /** Samples for each sun-transmittance integral. Default 24. */
  sunSteps?: number;
}

/** Hillaire's multiple-scattering term at an altitude and sun-zenith cosine. */
export function computeMultiScattering(
  profile: PhysicalAtmosphereProfile,
  altitudeM: number,
  muSun: number,
  options: MultiScatteringOptions = {},
): MultiScatteringTerm {
  const directions = options.directions ?? 64;
  const steps = options.steps ?? 24;
  const sunSteps = options.sunSteps ?? 24;
  const origin: AtmosphereVec3 = [0, profile.planetRadiusM + altitudeM, 0];
  const sunDir: AtmosphereVec3 = [Math.sqrt(Math.max(0, 1 - muSun * muSun)), muSun, 0];
  const isotropic = 1 / FOUR_PI;
  const l2: [number, number, number] = [0, 0, 0];
  const fms: [number, number, number] = [0, 0, 0];
  const golden = Math.PI * (3 - Math.sqrt(5));

  for (let i = 0; i < directions; i++) {
    const y = 1 - (2 * (i + 0.5)) / directions;
    const r = Math.sqrt(1 - y * y);
    const dir: AtmosphereVec3 = [r * Math.cos(golden * i), y, r * Math.sin(golden * i)];
    const seg = traceAtmosphere(profile, origin, dir);
    if (!seg) continue;
    const throughput: [number, number, number] = [1, 1, 1];
    const samples = sampleDistances(seg.tStart, seg.tEnd, steps, 'uniform');
    for (const { t, dt } of samples) {
      const pos = along(origin, dir, t);
      const m = sampleMedium(profile, length(pos) - profile.planetRadiusM);
      const sunT = sunTransmittance(profile, pos, sunDir, sunSteps);
      for (let c = 0; c < 3; c++) {
        const ext = m.extinction[c];
        const stepT = Math.exp(-ext * dt);
        // Analytic integral across the step for a constant source.
        const k = ext > 1e-30 ? (1 - stepT) / ext : dt;
        l2[c] += throughput[c] * sunT[c] * m.scattering[c] * isotropic * k;
        fms[c] += throughput[c] * m.scattering[c] * k;
        throughput[c] *= stepT;
      }
    }
    if (seg.hitsGround) {
      const pos = along(origin, dir, seg.tEnd);
      const up = normalizeVec3(pos);
      const nDotL = Math.max(0, dot(up, sunDir));
      const sunT = sunTransmittance(profile, pos, sunDir, sunSteps);
      for (let c = 0; c < 3; c++) {
        l2[c] += (throughput[c] * sunT[c] * nDotL * profile.groundAlbedo[c]) / Math.PI;
      }
    }
  }
  const psi: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    l2[c] /= directions;
    fms[c] /= directions;
    psi[c] = l2[c] / (1 - fms[c]);
  }
  return { psi, l2, fms };
}

/** Multi-scattering term baked on a grid: x = 0.5 + 0.5 * muSun, y = altitude / top. */
export interface MultiScatteringTable {
  readonly width: number;
  readonly height: number;
  readonly topAltitudeM: number;
  /** `width * height * 3` floats, row-major by altitude. */
  readonly data: Float64Array;
}

export function buildMultiScatteringTable(
  profile: PhysicalAtmosphereProfile,
  width = 32,
  height = 32,
  options: MultiScatteringOptions = {},
): MultiScatteringTable {
  const data = new Float64Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    const altitude = ((y + 0.5) / height) * profile.topAltitudeM;
    for (let x = 0; x < width; x++) {
      const muSun = ((x + 0.5) / width) * 2 - 1;
      const { psi } = computeMultiScattering(profile, altitude, muSun, options);
      data.set(psi, (y * width + x) * 3);
    }
  }
  return { width, height, topAltitudeM: profile.topAltitudeM, data };
}

/** Bilinear lookup with edge clamping (texel centres at (i + 0.5) / size). */
export function sampleMultiScatteringTable(table: MultiScatteringTable, altitudeM: number, muSun: number): AtmosphereRgb {
  const fx = Math.min(Math.max((0.5 + 0.5 * muSun) * table.width - 0.5, 0), table.width - 1);
  const fy = Math.min(Math.max((altitudeM / table.topAltitudeM) * table.height - 0.5, 0), table.height - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, table.width - 1);
  const y1 = Math.min(y0 + 1, table.height - 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const at = (x: number, y: number) => table.data[(y * table.width + x) * 3 + c];
    out[c] = (at(x0, y0) * (1 - tx) + at(x1, y0) * tx) * (1 - ty) + (at(x0, y1) * (1 - tx) + at(x1, y1) * tx) * ty;
  }
  return out;
}

// -- radiance along a view ray ------------------------------------------------------------------

export interface RadianceOptions {
  /** Samples along the view ray. Default 128. */
  steps?: number;
  /** Samples for each sun-transmittance integral. Default 32. */
  sunSteps?: number;
  /**
   * `false`: single scattering only (default). `true`: evaluate {@link computeMultiScattering} at
   * every sample (slow, exact). A {@link MultiScatteringTable}: interpolate a baked table.
   */
  multipleScattering?: boolean | MultiScatteringTable;
  /** Add sunlit ground radiance when the ray hits the ground. Default true. */
  includeGround?: boolean;
}

export interface RadianceResult {
  /** In-scattered radiance (+ ground bounce), relative to the sun irradiance per channel (already multiplied by it). */
  readonly radiance: AtmosphereRgb;
  /** Transmittance along the whole path inside the atmosphere. */
  readonly transmittance: AtmosphereRgb;
  readonly hitsGround: boolean;
}

/** Radiance arriving along a view ray from the atmosphere (and the ground it hits). */
export function integrateRadiance(
  profile: PhysicalAtmosphereProfile,
  origin: AtmosphereVec3,
  viewDir: AtmosphereVec3,
  sunDir: AtmosphereVec3,
  options: RadianceOptions = {},
): RadianceResult {
  const seg = traceAtmosphere(profile, origin, viewDir);
  if (!seg) return { radiance: [0, 0, 0], transmittance: [1, 1, 1], hitsGround: false };

  const steps = options.steps ?? 128;
  const sunSteps = options.sunSteps ?? 32;
  const ms = options.multipleScattering ?? false;
  const cosNu = dot(viewDir, sunDir);
  const phaseR = rayleighPhase(cosNu);
  const phaseM = miePhaseRgb(cosNu, profile.mie.phaseG);
  const throughput: [number, number, number] = [1, 1, 1];
  const L: [number, number, number] = [0, 0, 0];

  for (const { t, dt } of sampleDistances(seg.tStart, seg.tEnd, steps, 'uniform')) {
    const pos = along(origin, viewDir, t);
    const r = length(pos);
    const altitude = r - profile.planetRadiusM;
    const m = sampleMedium(profile, altitude);
    const sunT = sunTransmittance(profile, pos, sunDir, sunSteps);
    let psi: AtmosphereRgb = [0, 0, 0];
    if (ms !== false) {
      const muSun = dot(pos, sunDir) / r;
      psi = ms === true ? computeMultiScattering(profile, altitude, muSun).psi : sampleMultiScatteringTable(ms, altitude, muSun);
    }
    for (let c = 0; c < 3; c++) {
      const ext = m.extinction[c];
      const stepT = Math.exp(-ext * dt);
      const source =
        sunT[c] * (m.rayleighScattering[c] * phaseR + m.mieScattering[c] * phaseM[c]) + m.scattering[c] * psi[c];
      L[c] += throughput[c] * source * (ext > 1e-30 ? (1 - stepT) / ext : dt);
      throughput[c] *= stepT;
    }
  }

  if (seg.hitsGround && (options.includeGround ?? true)) {
    const pos = along(origin, viewDir, seg.tEnd);
    const nDotL = Math.max(0, dot(normalizeVec3(pos), sunDir));
    const sunT = sunTransmittance(profile, pos, sunDir, sunSteps);
    for (let c = 0; c < 3; c++) {
      L[c] += (throughput[c] * sunT[c] * nDotL * profile.groundAlbedo[c]) / Math.PI;
    }
  }

  const e = profile.sun.irradiance;
  return {
    radiance: [L[0] * e[0], L[1] * e[1], L[2] * e[2]],
    transmittance: throughput,
    hitsGround: seg.hitsGround,
  };
}
