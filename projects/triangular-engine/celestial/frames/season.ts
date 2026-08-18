import { ICelestialBody } from '../bodies/celestial-body';
import { clampUnit } from '../orbits/angles';
import { Vec3d } from '../math/vec3';
import { UniversalTime } from '../time/universal-clock';
import {
  BodyRotationOptions,
  bodyOrientationAt,
  inertialToBodyFixed,
} from './body-rotation';

/**
 * One instant's season signal for a body (`weather-seasons-climate.md` §3,
 * layer 2 of the `climate` × `season` × `weather` spine). Pure function of
 * `body`'s tilt/rotation and the caller-supplied sun direction — no new
 * ephemeris lookup, so it can't drift from the sun direction the renderer
 * already shows (`flight-page.component.ts`'s `sunDirection`).
 */
export interface SeasonState {
  /** Latitude of the subsolar point, radians. ±`axialTiltRad` at solstice, 0 at equinox. */
  readonly declinationRad: number;
  /** 0 at the winter-solstice extreme, 1 at the summer-solstice extreme, 0.5 at either equinox. */
  readonly seasonPhase01: number;
}

/**
 * `season(body, ut)` (§3): declination is the latitude of the body-fixed sun
 * direction (§2 finding 1) — a pure geometric read of `bodyOrientationAt`,
 * not a new simulation. `inertialSunDirection` is the same PCI-frame unit
 * vector `sunDirection` already computes, so seasons can never disagree with
 * the light the player sees.
 */
export function seasonAt(
  body: ICelestialBody,
  ut: UniversalTime,
  inertialSunDirection: Vec3d,
  options?: BodyRotationOptions,
): SeasonState {
  const orientation = bodyOrientationAt(body, ut, options);
  const bodyFixedSunDirection = inertialToBodyFixed(
    inertialSunDirection,
    orientation,
  );
  const declinationRad = Math.asin(clampUnit(bodyFixedSunDirection[1]));

  const axialTiltRad = body.axialTiltRad ?? 0;
  const seasonPhase01 =
    axialTiltRad === 0
      ? 0.5
      : clampUnit(declinationRad / axialTiltRad) * 0.5 + 0.5;

  return { declinationRad, seasonPhase01 };
}

/**
 * Noon (zero hour-angle) insolation at `dirBodyFixed` for `season` — the one
 * shared driver of snow line, ice caps, and seasonal vegetation tint (§3).
 * `dirBodyFixed` is a unit direction in the body-fixed frame, +Y = north
 * pole, matching the biome-mask sampling convention (`surface-query.ts`).
 * 0 in permanent polar night, 1 at the subsolar point.
 */
export function insolation01(dirBodyFixed: Vec3d, season: SeasonState): number {
  const latitudeRad = Math.asin(clampUnit(dirBodyFixed[1]));
  const cosZenith =
    Math.sin(latitudeRad) * Math.sin(season.declinationRad) +
    Math.cos(latitudeRad) * Math.cos(season.declinationRad);
  return Math.max(0, cosZenith);
}
