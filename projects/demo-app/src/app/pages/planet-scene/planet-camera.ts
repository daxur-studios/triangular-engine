import { FIXTURE_GROUND, FIXTURE_HEADING_RAD, groundFrame, type Vec3 } from 'triangular-engine/lod-surface/core';

/**
 * Cameras of the planet scene page (Plan 059, step G5). The planet's centre is the scene origin, so a camera is a ground
 * direction, an altitude above the ground under it, a heading from local north and a pitch. Positions are doubles in the scene
 * frame; the terrain draws camera-relative, so the large coordinates are safe.
 *
 * The lod-surface lab's `lod-camera.ts` is built on its domain presets and a `HeightSource`, so this is a small sphere-only
 * counterpart whose ground height comes from a callback (the terrain's `groundAt`).
 */

export type PlanetPoseId = 'orbit' | 'mid-20km' | 'ground';

/** Scripted camera moves; both are pure functions of their progress in 0..1. */
export type PlanetMotion = 'descent' | 'yaw360';

export interface PlanetView {
  /** A ground direction from the planet's centre (normalised when resolved). */
  readonly ground: Vec3;
  readonly altitudeM: number;
  readonly headingRad: number;
  readonly pitchRad: number;
}

export interface ResolvedPlanetCamera {
  readonly position: Vec3;
  readonly forward: Vec3;
  readonly right: Vec3;
  readonly up: Vec3;
  /** Height of the camera above the ground under it, metres (the near plane follows it). */
  readonly clearanceM: number;
}

const DEG = Math.PI / 180;

/** The page's planet radius, metres: the size the cell planet, its height scale and the atmosphere's earth preset are tuned for in the lab and docs. */
export const PLANET_RADIUS_M = 600_000;

/** Orbit altitude above the ground: three radii from the centre, so the whole globe is in a 60 degree view. */
export const ORBIT_ALTITUDE_M = 2 * PLANET_RADIUS_M;
export const MID_ALTITUDE_M = 20_000;
export const EYE_ALTITUDE_M = 2;
export const ORBIT_PITCH_RAD = -90 * DEG;
export const GROUND_PITCH_RAD = -5 * DEG;

/** The poses stand on the lod-surface fixture ground point, which the cell planet puts on land beside a ridge. */
const GROUND: Vec3 = FIXTURE_GROUND.sphere;
const HEADING = FIXTURE_HEADING_RAD.sphere;

export const PLANET_POSES: readonly { readonly id: PlanetPoseId; readonly label: string }[] = [
  { id: 'orbit', label: 'orbit' },
  { id: 'mid-20km', label: '20 km' },
  { id: 'ground', label: '2 m eye' },
];

export function planetPoseView(id: PlanetPoseId): PlanetView {
  switch (id) {
    case 'orbit': return { ground: GROUND, altitudeM: ORBIT_ALTITUDE_M, headingRad: HEADING, pitchRad: ORBIT_PITCH_RAD };
    case 'mid-20km': return { ground: GROUND, altitudeM: MID_ALTITUDE_M, headingRad: HEADING, pitchRad: -25 * DEG };
    case 'ground': return { ground: GROUND, altitudeM: EYE_ALTITUDE_M, headingRad: HEADING, pitchRad: GROUND_PITCH_RAD };
  }
}

/** The descent: orbit to the 2 m eye over the same ground point, altitude logarithmic, the pitch easing from straight down to level. */
export function descentView(t: number): PlanetView {
  const from = planetPoseView('orbit');
  const to = planetPoseView('ground');
  const s = Math.min(1, Math.max(0, t));
  return {
    ...from,
    altitudeM: from.altitudeM * (to.altitudeM / from.altitudeM) ** s,
    pitchRad: from.pitchRad + (to.pitchRad - from.pitchRad) * s * s,
  };
}

/** The turn: the ground pose with the heading going once round (360 degrees). */
export function yawView(t: number): PlanetView {
  const from = planetPoseView('ground');
  return { ...from, headingRad: from.headingRad + 2 * Math.PI * Math.min(1, Math.max(0, t)) };
}

export function motionView(motion: PlanetMotion, t: number): PlanetView {
  return motion === 'descent' ? descentView(t) : yawView(t);
}

/** The sun of the page: a fixed direction that is a late-afternoon sun over the pose ground point (the lab's choice). */
export function sceneSunDirection(): readonly [number, number, number] {
  const { up, east, north } = groundFrame('sphere', GROUND);
  const sun = [0, 1, 2].map((k) => up[k] + 0.6 * east[k] + 0.4 * north[k]);
  const length = Math.hypot(sun[0], sun[1], sun[2]);
  return [sun[0] / length, sun[1] / length, sun[2] / length];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/**
 * The camera of a view. `groundHeightM` is the terrain's height above the sphere under the view's ground direction (from
 * `groundAt`; 0 while the terrain does not exist), so the eye keeps its altitude above the drawn ground.
 */
export function resolvePlanetCamera(view: PlanetView, radiusM: number, groundHeightM: number): ResolvedPlanetCamera {
  const { up, east, north } = groundFrame('sphere', view.ground);
  const lift = radiusM + groundHeightM + view.altitudeM;
  const position: Vec3 = [up[0] * lift, up[1] * lift, up[2] * lift];
  const ch = Math.cos(view.headingRad);
  const sh = Math.sin(view.headingRad);
  const cp = Math.cos(view.pitchRad);
  const sp = Math.sin(view.pitchRad);
  const forward: Vec3 = [0, 1, 2].map((k) => cp * (ch * north[k] + sh * east[k]) + sp * up[k]) as Vec3;
  const right: Vec3 = [0, 1, 2].map((k) => ch * east[k] - sh * north[k]) as Vec3;
  return { position, forward, right, up: cross(right, forward), clearanceM: view.altitudeM };
}

/** The near plane for a clearance: a quarter of it, between 2 cm and 1 km (a reversed depth buffer holds the whole range). */
export function nearPlaneFor(clearanceM: number): number {
  return Math.min(1000, Math.max(0.02, clearanceM * 0.25));
}

/** Normalises a ground direction (used to compare a view's ground point with the terrain's query point). */
export function groundUp(view: PlanetView): Vec3 {
  return groundFrame('sphere', view.ground).up;
}
