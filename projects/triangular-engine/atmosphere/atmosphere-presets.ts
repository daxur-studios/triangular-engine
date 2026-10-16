import {
  AtmosphereProfile,
  NoAtmosphereProfile,
  PhysicalAtmosphereProfile,
  assertValidAtmosphereProfile,
} from './atmosphere-profile';
import { AtmosphereScalingOptions, scaleAtmosphereProfile } from './atmosphere-scaling';

export const ATMOSPHERE_PRESET_IDS = ['earth', 'mars', 'none'] as const;
export type AtmospherePresetId = (typeof ATMOSPHERE_PRESET_IDS)[number];

/**
 * Earth, with the coefficients Hillaire 2020 uses (which follow Bruneton 2008 / Bodhaine 1999):
 * Rayleigh 5.802 / 13.558 / 33.1 per Mm at 8 km, Mie 3.996 + 0.444 per Mm at 1.2 km (g 0.8), and an
 * ozone tent peaking at 25 km with a 15 km half-width. Radius 6371 km (`WORLD_SIZE_TIER_RADIUS_M`
 * extra-large), top at 60 km.
 */
export function earthAtmosphereProfile(): PhysicalAtmosphereProfile {
  return {
    version: 1,
    kind: 'physical',
    name: 'earth',
    planetRadiusM: 6_371_000,
    topAltitudeM: 60_000,
    rayleigh: { scatteringPerM: [5.802e-6, 13.558e-6, 33.1e-6], scaleHeightM: 8_000 },
    mie: {
      scatteringPerM: [3.996e-6, 3.996e-6, 3.996e-6],
      absorptionPerM: [0.444e-6, 0.444e-6, 0.444e-6],
      scaleHeightM: 1_200,
      phaseG: 0.8,
    },
    absorbers: [
      {
        name: 'ozone',
        extinctionPerM: [0.65e-6, 1.881e-6, 0.085e-6],
        density: { kind: 'tent', centerAltitudeM: 25_000, halfWidthM: 15_000 },
      },
    ],
    groundAlbedo: [0.3, 0.3, 0.3],
    sun: { irradiance: [1, 1, 1], angularRadiusRad: 0.00465 },
  };
}

/**
 * Mars. Art-tuned from published ranges, not a fit to one dataset; review before relying on it.
 *
 * - Rayleigh (CO2): Earth's coefficients x 0.0211. That is the surface number-density ratio
 *   (6.1 mbar at 210 K vs 1013 mbar at 288 K = 0.0083) times CO2's ~2.55x larger Rayleigh cross
 *   section per molecule. Scale height 11.1 km. Zenith optical depth comes out near 0.003.
 * - Dust (Mie): column optical depth ~0.5 at the surface (a typical clear-ish dust load) over an
 *   11 km scale height, extinction a little higher in blue than red, single-scattering albedo
 *   ~0.9 in red falling to ~0.7 in blue (iron oxide absorbs blue).
 * - Dust phase: per-channel Cornette-Shanks g of 0.55 / 0.65 / 0.78 (red / green / blue). Larger
 *   size parameter at shorter wavelength makes blue scatter more sharply forward; this is what
 *   produces the blue glow around the setting sun.
 * - Ground albedo ~0.25 with a red tilt; sun irradiance 0.43 of Earth's (1 / 1.524^2); the sun's
 *   angular radius is 0.00305 rad.
 */
export function marsAtmosphereProfile(): PhysicalAtmosphereProfile {
  return {
    version: 1,
    kind: 'physical',
    name: 'mars',
    planetRadiusM: 3_389_500,
    topAltitudeM: 100_000,
    rayleigh: {
      scatteringPerM: [5.802e-6 * 0.0211, 13.558e-6 * 0.0211, 33.1e-6 * 0.0211],
      scaleHeightM: 11_100,
    },
    mie: {
      scatteringPerM: [3.5e-5, 3.3e-5, 3.0e-5],
      absorptionPerM: [3.9e-6, 7.3e-6, 1.3e-5],
      scaleHeightM: 11_000,
      phaseG: [0.55, 0.65, 0.78],
    },
    absorbers: [],
    groundAlbedo: [0.32, 0.24, 0.16],
    sun: { irradiance: [0.43, 0.43, 0.43], angularRadiusRad: 0.00305 },
  };
}

export function noAtmosphereProfile(): NoAtmosphereProfile {
  return { version: 1, kind: 'none', name: 'none' };
}

/**
 * A fresh copy of a preset (callers may keep it). With `scaling`, the preset is moved to that
 * planet radius; without it, the preset keeps its real radius.
 */
export function createAtmospherePreset(id: AtmospherePresetId, scaling?: AtmosphereScalingOptions): AtmosphereProfile {
  let profile: AtmosphereProfile;
  switch (id) {
    case 'earth':
      profile = earthAtmosphereProfile();
      break;
    case 'mars':
      profile = marsAtmosphereProfile();
      break;
    case 'none':
      profile = noAtmosphereProfile();
      break;
    default:
      throw new Error(`Unknown atmosphere preset: ${String(id)}`);
  }
  assertValidAtmosphereProfile(profile);
  return scaling ? scaleAtmosphereProfile(profile, scaling) : profile;
}
