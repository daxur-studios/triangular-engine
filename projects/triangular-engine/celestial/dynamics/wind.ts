import { ICelestialBody } from '../bodies/celestial-body';
import { clampUnit } from '../orbits/angles';
import {
  VEC3_ZERO,
  Vec3d,
  vec3Cross,
  vec3Normalize,
  vec3Scale,
} from '../math/vec3';
import { UniversalTime } from '../time/universal-clock';

const NORTH_POLE: Vec3d = [0, 1, 0];

/** Below this altitude, wind ramps toward zero (surface boundary layer). */
const WIND_BOUNDARY_LAYER_TOP_M = 1_000;
/** Wind reaches full strength at this altitude and above. */
const WIND_FULL_STRENGTH_ALTITUDE_M = 9_000;
/** Period of the slow large-scale perturbation term, deterministic in `ut`. */
const WIND_PERTURBATION_PERIOD_S = 6 * 86_400;

/**
 * `windAt(body, dir, altitudeM, ut)` (`weather-seasons-climate.md` W1):
 * latitude-banded zonal flow plus a slow large-scale perturbation plus a
 * surface-boundary-layer altitude ramp. Deliberately "analytic and boring"
 * — no noise texture, no cloud field dependency (those arrive in W2+).
 *
 * Returns a full 3D vector in `body`'s body-fixed frame, vertical component
 * included (currently always 0 — W8's thermals/ridge lift fill it in later
 * without changing this contract). `body.windScaleMPerS` defaults to 0, so
 * every existing scenario is unaffected until a body opts in.
 */
export function windAt(
  body: ICelestialBody,
  dirBodyFixed: Vec3d,
  altitudeM: number,
  ut: UniversalTime,
): Vec3d {
  const scaleMPerS = body.windScaleMPerS ?? 0;
  if (scaleMPerS === 0) return VEC3_ZERO;

  let altitudeProfile01 = Math.min(
    1,
    Math.max(
      0,
      (altitudeM - WIND_BOUNDARY_LAYER_TOP_M) /
        (WIND_FULL_STRENGTH_ALTITUDE_M - WIND_BOUNDARY_LAYER_TOP_M),
    ),
  );
  // The boundary-layer ramp above only ever climbs to "full strength" and stays pinned there — it
  // never came back down, so wind read at full strength at any altitude above 9km, including deep
  // space/orbit. Wind is a lower-atmosphere phenomenon; ramp it back to 0 approaching the top of
  // the atmosphere the same way `airDensity` already goes to exactly 0 at `topAltitudeM`, instead
  // of leaving a wind speed above the atmosphere the vessel isn't actually flying through.
  const topAltitudeM = body.atmosphere?.topAltitudeM;
  if (topAltitudeM !== undefined) {
    const highAltitudeRampStartM = topAltitudeM * 0.8;
    const highAltitudeFade01 = clampUnit(
      (topAltitudeM - altitudeM) / (topAltitudeM - highAltitudeRampStartM),
    );
    altitudeProfile01 *= highAltitudeFade01;
  }
  if (altitudeProfile01 <= 0) return VEC3_ZERO;

  // Degenerates to zero at the poles, where "eastward" is undefined
  // (vec3Normalize returns VEC3_ZERO for a zero-length input). Checked before
  // scaling: 0 scaled by a negative factor produces -0, which fails strict
  // equality against the documented zero-vector contract.
  const eastBodyFixed = vec3Normalize(vec3Cross(NORTH_POLE, dirBodyFixed));
  if (
    eastBodyFixed[0] === 0 &&
    eastBodyFixed[1] === 0 &&
    eastBodyFixed[2] === 0
  ) {
    return VEC3_ZERO;
  }

  const latitudeRad = Math.asin(clampUnit(dirBodyFixed[1]));
  const zonal = Math.sin(latitudeRad * 3);
  const perturbation =
    0.3 *
    Math.sin((2 * Math.PI * ut) / WIND_PERTURBATION_PERIOD_S + latitudeRad * 2);
  const strength01 = clampUnit(zonal + perturbation);

  return vec3Scale(eastBodyFixed, strength01 * altitudeProfile01 * scaleMPerS);
}
