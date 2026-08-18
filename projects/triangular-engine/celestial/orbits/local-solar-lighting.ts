import { Vec3d, vec3Dot, vec3Normalize, vec3Sub } from '../math/vec3';

/** Renderer-neutral local lighting state shared by world, terrain, and actors. */
export interface ILocalSolarLightingState {
  readonly eclipseVisibility01: number;
  readonly horizonVisibility01: number;
  readonly directSunFactor01: number;
  readonly skyLightFactor01: number;
  readonly solarElevationRad: number;
}

/**
 * Combines apparent eclipse visibility with the local planetary horizon.
 * Direct light fades narrowly at the horizon; sky light fades across twilight.
 */
export function localSolarLighting(
  observerPositionM: Vec3d,
  primaryCenterM: Vec3d,
  sourceCenterM: Vec3d,
  eclipseVisibility01: number,
): ILocalSolarLightingState {
  const normal = vec3Normalize(vec3Sub(observerPositionM, primaryCenterM));
  const toSource = vec3Normalize(vec3Sub(sourceCenterM, observerPositionM));
  const solarElevationRad = Math.asin(clamp(vec3Dot(normal, toSource), -1, 1));
  const horizonVisibility01 = smoothstep(-0.03, 0.03, solarElevationRad);
  const twilight01 = smoothstep(-0.2, 0.12, solarElevationRad);
  return {
    eclipseVisibility01: clamp(eclipseVisibility01, 0, 1),
    horizonVisibility01,
    directSunFactor01: clamp(eclipseVisibility01, 0, 1) * horizonVisibility01,
    skyLightFactor01: 0.08 + twilight01 * 0.42,
    solarElevationRad,
  };
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
