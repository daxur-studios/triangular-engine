import {
  AtmosphereDensityProfile,
  AtmosphereRgb,
  PhysicalAtmosphereProfile,
} from './atmosphere-profile';

export interface AtmosphereMediumSample {
  readonly rayleighScattering: AtmosphereRgb;
  readonly mieScattering: AtmosphereRgb;
  /** Rayleigh + Mie scattering. */
  readonly scattering: AtmosphereRgb;
  /** Scattering + Mie absorption + absorbers. */
  readonly extinction: AtmosphereRgb;
}

export function densityAt(density: AtmosphereDensityProfile, altitudeM: number): number {
  if (density.kind === 'exponential') return Math.exp(-altitudeM / density.scaleHeightM);
  return Math.max(0, 1 - Math.abs(altitudeM - density.centerAltitudeM) / density.halfWidthM);
}

/** Coefficients (1/m) at an altitude above the ground. Zero at or above the top of the atmosphere. */
export function sampleMedium(profile: PhysicalAtmosphereProfile, altitudeM: number): AtmosphereMediumSample {
  if (altitudeM >= profile.topAltitudeM) {
    return { rayleighScattering: [0, 0, 0], mieScattering: [0, 0, 0], scattering: [0, 0, 0], extinction: [0, 0, 0] };
  }
  const h = Math.max(0, altitudeM);
  const dR = Math.exp(-h / profile.rayleigh.scaleHeightM);
  const dM = Math.exp(-h / profile.mie.scaleHeightM);
  const rs = profile.rayleigh.scatteringPerM;
  const ms = profile.mie.scatteringPerM;
  const ma = profile.mie.absorptionPerM;
  const rayleighScattering: [number, number, number] = [rs[0] * dR, rs[1] * dR, rs[2] * dR];
  const mieScattering: [number, number, number] = [ms[0] * dM, ms[1] * dM, ms[2] * dM];
  const scattering: [number, number, number] = [0, 0, 0];
  const extinction: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    scattering[c] = rayleighScattering[c] + mieScattering[c];
    extinction[c] = scattering[c] + ma[c] * dM;
  }
  for (const a of profile.absorbers) {
    const d = densityAt(a.density, h);
    if (d === 0) continue;
    for (let c = 0; c < 3; c++) extinction[c] += a.extinctionPerM[c] * d;
  }
  return { rayleighScattering, mieScattering, scattering, extinction };
}

export function rayleighPhase(cosTheta: number): number {
  return (3 / (16 * Math.PI)) * (1 + cosTheta * cosTheta);
}

/** Cornette-Shanks phase function; integrates to 1 over the sphere. */
export function cornetteShanksPhase(cosTheta: number, g: number): number {
  const k = (3 / (8 * Math.PI)) * ((1 - g * g) / (2 + g * g));
  return (k * (1 + cosTheta * cosTheta)) / Math.pow(1 + g * g - 2 * g * cosTheta, 1.5);
}

export function miePhaseRgb(cosTheta: number, g: number | AtmosphereRgb): AtmosphereRgb {
  if (typeof g === 'number') {
    const v = cornetteShanksPhase(cosTheta, g);
    return [v, v, v];
  }
  return [cornetteShanksPhase(cosTheta, g[0]), cornetteShanksPhase(cosTheta, g[1]), cornetteShanksPhase(cosTheta, g[2])];
}
