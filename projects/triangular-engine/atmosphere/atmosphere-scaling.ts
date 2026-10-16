/**
 * Similarity scaling: move an atmosphere profile to a planet of another radius so it looks the same.
 *
 * Real physics fails on small planets: with Earth's coefficients a 100 km planet's air is almost
 * transparent (optical depth = coefficient x path length, and the path shrank). The fix is a pure
 * similarity transform with `k = newRadius / oldRadius`:
 *
 * - every length (radius, scale heights, absorber layers, top altitude) is multiplied by `k`;
 * - every coefficient (1/m) is divided by `k`.
 *
 * Every optical depth, and therefore every sky colour, sunset and limb glow seen from an equivalent
 * viewpoint (altitude scaled by `k`), comes out the same. On top of that there are scale-free art
 * knobs; see {@link AtmosphereScalingOptions}.
 */
import { opticalDepthToTop } from './atmosphere-reference-integrator';
import {
  AtmosphereAbsorber,
  AtmosphereDensityProfile,
  AtmosphereProfile,
  AtmosphereRgb,
  PhysicalAtmosphereProfile,
  assertValidAtmosphereProfile,
} from './atmosphere-profile';

export interface AtmosphereScalingOptions {
  /** Radius of the planet the result is for, metres. */
  radiusM: number;
  /**
   * Atmosphere height divided by planet radius (Earth ~0.0094, a Kerbin-style halo ~0.12). Stretches
   * heights and shrinks coefficients by the same factor, so zenith optical depth does not change.
   */
  thickness?: number;
  /**
   * Raise `thickness` (never lower it) so the top of the air clears the highest terrain by `margin`
   * (default 1.25).
   */
  reliefFit?: { maxReliefM: number; margin?: number };
  /**
   * Target transmittance of green light along the horizontal ray that grazes the ground and leaves
   * through the top of the air (0..1 exclusive). Scales every coefficient to hit it. This is a
   * scale-free proxy for how hazy the horizon is.
   */
  hazeAtHorizon?: number;
  /** Sets {@link PhysicalAtmosphereProfile.nearHazeFadeM}. A world distance; never scaled. */
  nearHazeFadeM?: number;
}

const GREEN = 1;

const scaleRgb = (v: AtmosphereRgb, f: number): AtmosphereRgb => [v[0] * f, v[1] * f, v[2] * f];

function scaleDensity(d: AtmosphereDensityProfile, lengthFactor: number): AtmosphereDensityProfile {
  if (d.kind === 'exponential') return { kind: 'exponential', scaleHeightM: d.scaleHeightM * lengthFactor };
  return { kind: 'tent', centerAltitudeM: d.centerAltitudeM * lengthFactor, halfWidthM: d.halfWidthM * lengthFactor };
}

/**
 * Multiplies every length by `lengthFactor` and every coefficient by `coefficientFactor`.
 * Height-only stretch passes the radius unchanged via `scaleRadius: false`.
 */
function transform(
  p: PhysicalAtmosphereProfile,
  lengthFactor: number,
  coefficientFactor: number,
  scaleRadius: boolean,
): PhysicalAtmosphereProfile {
  const absorbers: AtmosphereAbsorber[] = p.absorbers.map((a) => ({
    name: a.name,
    extinctionPerM: scaleRgb(a.extinctionPerM, coefficientFactor),
    density: scaleDensity(a.density, lengthFactor),
  }));
  return {
    ...p,
    planetRadiusM: scaleRadius ? p.planetRadiusM * lengthFactor : p.planetRadiusM,
    topAltitudeM: p.topAltitudeM * lengthFactor,
    rayleigh: {
      scatteringPerM: scaleRgb(p.rayleigh.scatteringPerM, coefficientFactor),
      scaleHeightM: p.rayleigh.scaleHeightM * lengthFactor,
    },
    mie: {
      ...p.mie,
      scatteringPerM: scaleRgb(p.mie.scatteringPerM, coefficientFactor),
      absorptionPerM: scaleRgb(p.mie.absorptionPerM, coefficientFactor),
      scaleHeightM: p.mie.scaleHeightM * lengthFactor,
    },
    absorbers,
  };
}

/** Pure similarity transform to another radius (no art knobs). */
export function similarityScaleAtmosphere(profile: AtmosphereProfile, radiusM: number): AtmosphereProfile {
  assertValidAtmosphereProfile(profile);
  if (!Number.isFinite(radiusM) || radiusM <= 0) throw new Error('radiusM must be a finite number > 0');
  if (profile.kind === 'none') return profile;
  const k = radiusM / profile.planetRadiusM;
  return transform(profile, k, 1 / k, true);
}

/** Similarity scaling plus the optional art knobs, applied in this order: thickness, reliefFit, hazeAtHorizon. */
export function scaleAtmosphereProfile(profile: AtmosphereProfile, options: AtmosphereScalingOptions): AtmosphereProfile {
  assertValidAtmosphereProfile(profile);
  const { radiusM } = options;
  if (!Number.isFinite(radiusM) || radiusM <= 0) throw new Error('radiusM must be a finite number > 0');
  if (profile.kind === 'none') return profile;

  let p = similarityScaleAtmosphere(profile, radiusM) as PhysicalAtmosphereProfile;

  const stretchTo = (topAltitudeM: number) => {
    const f = topAltitudeM / p.topAltitudeM;
    p = transform(p, f, 1 / f, false);
  };
  if (options.thickness !== undefined) {
    if (!Number.isFinite(options.thickness) || options.thickness <= 0) throw new Error('thickness must be a finite number > 0');
    stretchTo(options.thickness * p.planetRadiusM);
  }
  if (options.reliefFit) {
    const { maxReliefM, margin = 1.25 } = options.reliefFit;
    if (!Number.isFinite(maxReliefM) || maxReliefM < 0) throw new Error('reliefFit.maxReliefM must be a finite number >= 0');
    const needed = maxReliefM * margin;
    if (needed > p.topAltitudeM) stretchTo(needed);
  }
  if (options.hazeAtHorizon !== undefined) {
    const target = options.hazeAtHorizon;
    if (!Number.isFinite(target) || target <= 0 || target >= 1) throw new Error('hazeAtHorizon must be in (0, 1)');
    // Optical depth is linear in the coefficients, so one multiplier hits the target exactly.
    const od = opticalDepthToTop(p, [0, p.planetRadiusM, 0], [1, 0, 0], 512)[GREEN];
    if (od > 0) {
      const m = -Math.log(target) / od;
      p = transform(p, 1, m, false);
    }
  }
  if (options.nearHazeFadeM !== undefined) {
    if (!Number.isFinite(options.nearHazeFadeM) || options.nearHazeFadeM < 0) throw new Error('nearHazeFadeM must be a finite number >= 0');
    p = { ...p, nearHazeFadeM: options.nearHazeFadeM };
  }
  return p;
}
