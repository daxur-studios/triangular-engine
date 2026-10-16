/** A linear-RGB triple. For coefficients the unit is 1/m; for radiance it is relative to the sun irradiance. */
export type AtmosphereRgb = readonly [number, number, number];
export type AtmosphereVec3 = readonly [number, number, number];

/** Density of an absorbing layer (e.g. ozone) over altitude. Peak density is 1 at the layer centre. */
export type AtmosphereDensityProfile =
  | { readonly kind: 'exponential'; readonly scaleHeightM: number }
  | {
      /** Triangular layer: 1 at `centerAltitudeM`, falling linearly to 0 at ± `halfWidthM`. */
      readonly kind: 'tent';
      readonly centerAltitudeM: number;
      readonly halfWidthM: number;
    };

export interface AtmosphereAbsorber {
  readonly name: string;
  /** Extinction (pure absorption) at peak density, 1/m, per channel. */
  readonly extinctionPerM: AtmosphereRgb;
  readonly density: AtmosphereDensityProfile;
}

/**
 * Physically based atmosphere, authored for a planet of radius `planetRadiusM`.
 *
 * Lengths are metres, coefficients are 1/m at sea level (density 1). Use
 * {@link scaleAtmosphereProfile} to move a profile to another planet radius.
 */
export interface PhysicalAtmosphereProfile {
  readonly version: 1;
  readonly kind: 'physical';
  readonly name: string;
  /** Radius the profile is authored for; the ground sits at this radius. */
  readonly planetRadiusM: number;
  /** Height of the top of the atmosphere above `planetRadiusM`. Density is zero above it. */
  readonly topAltitudeM: number;
  readonly rayleigh: {
    readonly scatteringPerM: AtmosphereRgb;
    readonly scaleHeightM: number;
  };
  readonly mie: {
    readonly scatteringPerM: AtmosphereRgb;
    readonly absorptionPerM: AtmosphereRgb;
    readonly scaleHeightM: number;
    /** Cornette-Shanks asymmetry in (-1, 1); one value, or one per channel. */
    readonly phaseG: number | AtmosphereRgb;
  };
  readonly absorbers: readonly AtmosphereAbsorber[];
  /** Lambertian ground albedo per channel, 0..1. */
  readonly groundAlbedo: AtmosphereRgb;
  readonly sun: {
    /** Irradiance per channel, relative to Earth at 1 AU = 1. */
    readonly irradiance: AtmosphereRgb;
    readonly angularRadiusRad: number;
  };
  /**
   * Art knob: no haze within this distance of the camera. A world-space distance in metres, so
   * similarity scaling does not change it.
   */
  readonly nearHazeFadeM?: number;
}

/** No atmosphere (moon, protoplanet): consumers take the zero-cost path. */
export interface NoAtmosphereProfile {
  readonly version: 1;
  readonly kind: 'none';
  readonly name: string;
}

export type AtmosphereProfile = PhysicalAtmosphereProfile | NoAtmosphereProfile;

export function isPhysicalAtmosphereProfile(profile: AtmosphereProfile): profile is PhysicalAtmosphereProfile {
  return profile.kind === 'physical';
}

export interface AtmosphereProfileIssue {
  /** Dotted path of the offending field, e.g. `mie.phaseG[1]`. */
  readonly path: string;
  readonly message: string;
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Returns every problem found; an empty array means the profile is valid. Never throws. */
export function validateAtmosphereProfile(profile: unknown): AtmosphereProfileIssue[] {
  const issues: AtmosphereProfileIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });

  if (typeof profile !== 'object' || profile === null) {
    add('', 'profile must be an object');
    return issues;
  }
  const p = profile as Record<string, any>;
  if (p['version'] !== 1) add('version', 'must be 1');
  if (typeof p['name'] !== 'string' || p['name'].length === 0) add('name', 'must be a non-empty string');
  if (p['kind'] === 'none') return issues;
  if (p['kind'] !== 'physical') {
    add('kind', "must be 'physical' or 'none'");
    return issues;
  }

  const positive = (path: string, v: unknown) => {
    if (!isFiniteNumber(v) || v <= 0) add(path, 'must be a finite number > 0');
  };
  const nonNegRgb = (path: string, v: unknown, max = Infinity) => {
    if (!Array.isArray(v) || v.length !== 3) {
      add(path, 'must be [r, g, b]');
      return;
    }
    v.forEach((c, i) => {
      if (!isFiniteNumber(c) || c < 0 || c > max) {
        add(`${path}[${i}]`, max === Infinity ? 'must be a finite number >= 0' : `must be a finite number in 0..${max}`);
      }
    });
  };

  positive('planetRadiusM', p['planetRadiusM']);
  positive('topAltitudeM', p['topAltitudeM']);

  const rayleigh = p['rayleigh'];
  if (!rayleigh) add('rayleigh', 'is required');
  else {
    nonNegRgb('rayleigh.scatteringPerM', rayleigh.scatteringPerM);
    positive('rayleigh.scaleHeightM', rayleigh.scaleHeightM);
  }

  const mie = p['mie'];
  if (!mie) add('mie', 'is required');
  else {
    nonNegRgb('mie.scatteringPerM', mie.scatteringPerM);
    nonNegRgb('mie.absorptionPerM', mie.absorptionPerM);
    positive('mie.scaleHeightM', mie.scaleHeightM);
    const g = mie.phaseG;
    const gs: unknown[] = Array.isArray(g) ? g : [g];
    if (Array.isArray(g) && g.length !== 3) add('mie.phaseG', 'must be a number or [r, g, b]');
    else
      gs.forEach((v, i) => {
        if (!isFiniteNumber(v) || v <= -1 || v >= 1) {
          add(Array.isArray(g) ? `mie.phaseG[${i}]` : 'mie.phaseG', 'must be a finite number in (-1, 1)');
        }
      });
  }

  if (!Array.isArray(p['absorbers'])) add('absorbers', 'must be an array');
  else
    p['absorbers'].forEach((a: any, i: number) => {
      const base = `absorbers[${i}]`;
      if (!a || typeof a !== 'object') {
        add(base, 'must be an object');
        return;
      }
      nonNegRgb(`${base}.extinctionPerM`, a.extinctionPerM);
      const d = a.density;
      if (d?.kind === 'exponential') positive(`${base}.density.scaleHeightM`, d.scaleHeightM);
      else if (d?.kind === 'tent') {
        if (!isFiniteNumber(d.centerAltitudeM) || d.centerAltitudeM < 0) {
          add(`${base}.density.centerAltitudeM`, 'must be a finite number >= 0');
        }
        positive(`${base}.density.halfWidthM`, d.halfWidthM);
      } else add(`${base}.density.kind`, "must be 'exponential' or 'tent'");
    });

  nonNegRgb('groundAlbedo', p['groundAlbedo'], 1);
  if (!p['sun']) add('sun', 'is required');
  else {
    nonNegRgb('sun.irradiance', p['sun'].irradiance);
    positive('sun.angularRadiusRad', p['sun'].angularRadiusRad);
  }
  if (p['nearHazeFadeM'] !== undefined && (!isFiniteNumber(p['nearHazeFadeM']) || p['nearHazeFadeM'] < 0)) {
    add('nearHazeFadeM', 'must be a finite number >= 0');
  }
  return issues;
}

/** Throws one error listing every validation issue. */
export function assertValidAtmosphereProfile(profile: unknown): asserts profile is AtmosphereProfile {
  const issues = validateAtmosphereProfile(profile);
  if (issues.length > 0) {
    throw new Error(
      `Invalid atmosphere profile: ${issues.map((i) => (i.path ? `${i.path} ${i.message}` : i.message)).join('; ')}`,
    );
  }
}
