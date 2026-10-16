/**
 * Per-profile lookup tables, baked on the CPU (Plan 049, Phase 2a). Pure TypeScript: no three.
 *
 * - **Transmittance** (Bruneton/Hillaire parameterization): transmittance from a point at radius `r` to the
 *   top of the atmosphere along a direction with zenith cosine `mu`, ignoring the ground. Consumers
 *   multiply by their own planet-shadow test.
 * - **Multi-scatter**: Hillaire's isotropic multiple-scattering term `psi`, `x = 0.5 + 0.5 * muSun`,
 *   `y = altitude / top`.
 * - **Irradiance**: sky irradiance on an upward-facing surface (single + multiple scattering, no ground
 *   bounce), relative to the sun irradiance, same `x`/`y` convention as the multi-scatter table.
 *
 * The transmittance table is baked first and then used as the sun-transmittance source for the other two,
 * which is what makes baking fast enough to redo when a profile changes. The GPU reads the same data.
 * All tables are RGBA float32 (alpha unused = 1) so they upload as textures without repacking.
 */
import { AtmosphereRgb, AtmosphereVec3, PhysicalAtmosphereProfile } from './atmosphere-profile';
import {
  MultiScatteringTable,
  groundHitDistance,
  integrateRadiance,
  opticalDepthToTop,
  sampleMultiScatteringTable,
  buildMultiScatteringTable,
} from './atmosphere-reference-integrator';

export interface AtmosphereLutOptions {
  /** Transmittance table size. Default 256 x 64. */
  transmittanceSize?: readonly [number, number];
  /** Multi-scatter table size. Default 64 x 32 (finer than the 32 x 32 in the paper: the term bends at the terminator). */
  multiScatterSize?: readonly [number, number];
  /** Irradiance table size. Default 64 x 16. */
  irradianceSize?: readonly [number, number];
  /** Samples per transmittance texel. Default 48. */
  transmittanceSteps?: number;
  /** Directions / steps for each multi-scatter texel. Defaults 64 / 24. */
  multiScatterDirections?: number;
  multiScatterSteps?: number;
  /** Directions / steps for each irradiance texel. Defaults 48 / 24. */
  irradianceDirections?: number;
  irradianceSteps?: number;
}

/** A 2D table of RGBA floats, row-major from y = 0. */
export interface AtmosphereLutImage {
  readonly width: number;
  readonly height: number;
  readonly data: Float32Array;
}

export interface AtmosphereLuts {
  readonly profile: PhysicalAtmosphereProfile;
  readonly transmittance: AtmosphereLutImage;
  readonly multiScatter: AtmosphereLutImage;
  readonly irradiance: AtmosphereLutImage;
}

const DEFAULT_TRANSMITTANCE_SIZE = [256, 64] as const;
const DEFAULT_MULTI_SCATTER_SIZE = [64, 32] as const;
const DEFAULT_IRRADIANCE_SIZE = [64, 16] as const;

/** Distance from the planet centre to the top of the atmosphere, and the horizon distance `H` from the top. */
export function atmosphereRadii(profile: PhysicalAtmosphereProfile) {
  const bottom = profile.planetRadiusM;
  const top = bottom + profile.topAltitudeM;
  return { bottom, top, horizonFromTop: Math.sqrt(top * top - bottom * bottom) };
}

/** Texel centre mapping for a unit-range coordinate (Bruneton): `x = 0` and `x = 1` land on texel centres. */
export const unitRangeToTexcoord = (x: number, size: number) => (0.5 + x * (size - 1)) / size;
export const texcoordToUnitRange = (u: number, size: number) => (u * size - 0.5) / (size - 1);

/**
 * Transmittance-table coordinates `[xMu, xR]` (both in 0..1) for radius `r` and zenith cosine `mu`.
 * `xR` is the horizon distance of the point over the top's; `xMu` is where the distance to the top
 * lies between its minimum (straight up) and maximum (grazing the ground).
 */
export function transmittanceUnitCoords(profile: PhysicalAtmosphereProfile, r: number, mu: number): [number, number] {
  const { bottom, top, horizonFromTop } = atmosphereRadii(profile);
  const rho = Math.sqrt(Math.max(0, r * r - bottom * bottom));
  const altitude = r - bottom;
  // (top - r)(top + r) + r^2 mu^2, written without the cancellation of top^2 - r^2 + r^2 (mu^2 - 1).
  const disc = (profile.topAltitudeM - altitude) * (top + r) + r * r * mu * mu;
  const d = Math.max(0, -r * mu + Math.sqrt(Math.max(0, disc)));
  const dMin = top - r;
  const dMax = rho + horizonFromTop;
  const xMu = dMax > dMin ? (d - dMin) / (dMax - dMin) : 0;
  return [Math.min(Math.max(xMu, 0), 1), Math.min(Math.max(rho / horizonFromTop, 0), 1)];
}

/** Inverse of {@link transmittanceUnitCoords}. */
export function transmittanceRMuFromUnitCoords(
  profile: PhysicalAtmosphereProfile,
  xMu: number,
  xR: number,
): { r: number; mu: number } {
  const { bottom, top, horizonFromTop } = atmosphereRadii(profile);
  const rho = horizonFromTop * xR;
  const r = Math.sqrt(rho * rho + bottom * bottom);
  const dMin = top - r;
  const dMax = rho + horizonFromTop;
  const d = dMin + xMu * (dMax - dMin);
  const mu = d === 0 ? 1 : (horizonFromTop * horizonFromTop - rho * rho - d * d) / (2 * r * d);
  return { r, mu: Math.min(Math.max(mu, -1), 1) };
}

function bakeTransmittance(profile: PhysicalAtmosphereProfile, width: number, height: number, steps: number) {
  const data = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const { r, mu } = transmittanceRMuFromUnitCoords(profile, x / (width - 1), y / (height - 1));
      const sin = Math.sqrt(Math.max(0, 1 - mu * mu));
      const od = opticalDepthToTop(profile, [0, r, 0], [sin, mu, 0], steps);
      const o = (y * width + x) * 4;
      data[o] = Math.exp(-od[0]);
      data[o + 1] = Math.exp(-od[1]);
      data[o + 2] = Math.exp(-od[2]);
      data[o + 3] = 1;
    }
  }
  return { width, height, data } satisfies AtmosphereLutImage;
}

/** Bilinear lookup with edge clamping, matching a GPU linear sampler with clamp-to-edge. */
function sampleImage(image: AtmosphereLutImage, u: number, v: number): AtmosphereRgb {
  const fx = Math.min(Math.max(u * image.width - 0.5, 0), image.width - 1);
  const fy = Math.min(Math.max(v * image.height - 0.5, 0), image.height - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, image.width - 1);
  const y1 = Math.min(y0 + 1, image.height - 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const at = (x: number, y: number) => image.data[(y * image.width + x) * 4 + c];
    out[c] = (at(x0, y0) * (1 - tx) + at(x1, y0) * tx) * (1 - ty) + (at(x0, y1) * (1 - tx) + at(x1, y1) * tx) * ty;
  }
  return out;
}

/** Transmittance from radius `r` to the top along zenith cosine `mu`, ignoring the ground. */
export function sampleTransmittanceLut(luts: AtmosphereLuts, r: number, mu: number): AtmosphereRgb {
  const [xMu, xR] = transmittanceUnitCoords(luts.profile, r, mu);
  const { width, height } = luts.transmittance;
  return sampleImage(luts.transmittance, unitRangeToTexcoord(xMu, width), unitRangeToTexcoord(xR, height));
}

/** Sunlight transmittance at a point (planet centred at the origin), 0 in the planet's shadow. */
export function sunTransmittanceFromLut(luts: AtmosphereLuts, point: AtmosphereVec3, sunDir: AtmosphereVec3): AtmosphereRgb {
  const r = Math.hypot(point[0], point[1], point[2]);
  if (groundHitDistance(point, sunDir, luts.profile.planetRadiusM) !== null) return [0, 0, 0];
  const mu = (point[0] * sunDir[0] + point[1] * sunDir[1] + point[2] * sunDir[2]) / r;
  return sampleTransmittanceLut(luts, r, mu);
}

function bakeMultiScatter(
  profile: PhysicalAtmosphereProfile,
  width: number,
  height: number,
  options: AtmosphereLutOptions,
  sunTransmittance: (p: AtmosphereVec3, s: AtmosphereVec3) => AtmosphereRgb,
) {
  const table = buildMultiScatteringTable(profile, width, height, {
    directions: options.multiScatterDirections ?? 64,
    steps: options.multiScatterSteps ?? 24,
    sunTransmittance,
  });
  const data = new Float32Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = table.data[i * 3];
    data[i * 4 + 1] = table.data[i * 3 + 1];
    data[i * 4 + 2] = table.data[i * 3 + 2];
    data[i * 4 + 3] = 1;
  }
  return { image: { width, height, data } satisfies AtmosphereLutImage, table };
}

function bakeIrradiance(
  profile: PhysicalAtmosphereProfile,
  width: number,
  height: number,
  options: AtmosphereLutOptions,
  sunTransmittance: (p: AtmosphereVec3, s: AtmosphereVec3) => AtmosphereRgb,
  multiScatter: MultiScatteringTable,
) {
  const directions = options.irradianceDirections ?? 48;
  const steps = options.irradianceSteps ?? 24;
  const data = new Float32Array(width * height * 4);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let y = 0; y < height; y++) {
    const altitude = ((y + 0.5) / height) * profile.topAltitudeM;
    for (let x = 0; x < width; x++) {
      const muSun = ((x + 0.5) / width) * 2 - 1;
      const sunDir: AtmosphereVec3 = [Math.sqrt(Math.max(0, 1 - muSun * muSun)), muSun, 0];
      const origin: AtmosphereVec3 = [0, profile.planetRadiusM + altitude, 0];
      const e: [number, number, number] = [0, 0, 0];
      for (let i = 0; i < directions; i++) {
        // Fibonacci hemisphere, cos(theta) = (i + 0.5) / directions gives equal-area cells.
        const cosTheta = (i + 0.5) / directions;
        const sinTheta = Math.sqrt(1 - cosTheta * cosTheta);
        const dir: AtmosphereVec3 = [sinTheta * Math.cos(golden * i), cosTheta, sinTheta * Math.sin(golden * i)];
        const { radiance } = integrateRadiance(profile, origin, dir, sunDir, {
          steps,
          multipleScattering: multiScatter,
          includeGround: false,
          sunTransmittance,
        });
        // radiance is already multiplied by the sun irradiance; the table is relative to it.
        const sun = profile.sun.irradiance;
        for (let c = 0; c < 3; c++) e[c] += (radiance[c] / (sun[c] || 1)) * cosTheta;
      }
      // Equal-area cells over the hemisphere: each covers 2 pi / directions steradians.
      const k = (2 * Math.PI) / directions;
      const o = (y * width + x) * 4;
      data[o] = e[0] * k;
      data[o + 1] = e[1] * k;
      data[o + 2] = e[2] * k;
      data[o + 3] = 1;
    }
  }
  return { width, height, data } satisfies AtmosphereLutImage;
}

/** Bakes the three tables for a profile. About a second at the default sizes. */
export function bakeAtmosphereLuts(profile: PhysicalAtmosphereProfile, options: AtmosphereLutOptions = {}): AtmosphereLuts {
  const [tw, th] = options.transmittanceSize ?? DEFAULT_TRANSMITTANCE_SIZE;
  const [mw, mh] = options.multiScatterSize ?? DEFAULT_MULTI_SCATTER_SIZE;
  const [iw, ih] = options.irradianceSize ?? DEFAULT_IRRADIANCE_SIZE;

  const transmittance = bakeTransmittance(profile, tw, th, options.transmittanceSteps ?? 48);
  const partial = { profile, transmittance } as AtmosphereLuts;
  const sunT = (p: AtmosphereVec3, s: AtmosphereVec3) => sunTransmittanceFromLut(partial, p, s);
  const ms = bakeMultiScatter(profile, mw, mh, options, sunT);
  const irradiance = bakeIrradiance(profile, iw, ih, options, sunT, ms.table);
  return { profile, transmittance, multiScatter: ms.image, irradiance };
}

const multiScatteringTables = new WeakMap<AtmosphereLuts, MultiScatteringTable>();

/** The baked multi-scatter image as the integrator's table type (cached per LUT set). */
export function multiScatteringTableFromLut(luts: AtmosphereLuts): MultiScatteringTable {
  let table = multiScatteringTables.get(luts);
  if (!table) {
    const { width, height, data } = luts.multiScatter;
    const rgb = new Float64Array(width * height * 3);
    for (let i = 0; i < width * height; i++) {
      rgb[i * 3] = data[i * 4];
      rgb[i * 3 + 1] = data[i * 4 + 1];
      rgb[i * 3 + 2] = data[i * 4 + 2];
    }
    table = { width, height, topAltitudeM: luts.profile.topAltitudeM, data: rgb };
    multiScatteringTables.set(luts, table);
  }
  return table;
}

/** Multi-scatter term `psi` at an altitude and sun-zenith cosine, from the baked table. */
export function sampleMultiScatterLut(luts: AtmosphereLuts, altitudeM: number, muSun: number): AtmosphereRgb {
  return sampleMultiScatteringTable(multiScatteringTableFromLut(luts), altitudeM, muSun);
}

/** Sky irradiance on an upward-facing surface, relative to the sun irradiance. */
export function sampleIrradianceLut(luts: AtmosphereLuts, altitudeM: number, muSun: number): AtmosphereRgb {
  return sampleImage(luts.irradiance, 0.5 + 0.5 * muSun, altitudeM / luts.profile.topAltitudeM);
}
