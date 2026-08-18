import { ICelestialBody } from '../bodies/celestial-body';

export interface IRocheLimits {
  /** Rigid satellite disruption radius in meters (~1.26 * R_primary for equal density). */
  readonly rigidRadiusM: number;
  /** Fluid/loose rubble satellite disruption radius in meters (~2.44 * R_primary for equal density). */
  readonly fluidRadiusM: number;
}

/**
 * Calculates the rigid and fluid Roche limits for a primary celestial body.
 *
 * - Rigid limit: `d_rigid = R * (2 * rho_M / rho_m)^(1/3) ≈ 1.25992 * R * (rho_M / rho_m)^(1/3)`
 * - Fluid limit: `d_fluid ≈ 2.44 * R * (rho_M / rho_m)^(1/3)`
 *
 * @param primaryBody The celestial body
 * @param densityRatio Optional ratio of primary density to satellite density (`rho_primary / rho_satellite`). Defaults to 1.0.
 */
export function rocheLimits(
  primaryBody: ICelestialBody,
  densityRatio: number = 1.0,
): IRocheLimits {
  if (primaryBody.radiusM <= 0) {
    throw new RangeError(
      `rocheLimits: primaryBody.radiusM must be > 0: got ${primaryBody.radiusM}`,
    );
  }
  const ratio = Math.max(densityRatio, 0.0001);
  const cubeRoot = Math.cbrt(ratio);
  return {
    rigidRadiusM: primaryBody.radiusM * 1.259921 * cubeRoot,
    fluidRadiusM: primaryBody.radiusM * 2.44 * cubeRoot,
  };
}
