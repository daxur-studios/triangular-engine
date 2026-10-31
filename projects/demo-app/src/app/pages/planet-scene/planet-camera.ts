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

/**
 * Scripted moves; each is a pure function of its progress in 0..1. `descent` and `yaw360` move the camera. `morphSweep` keeps the
 * orbit pose and runs `<planet [morph]>` from 0 to 1 and back to 0 ({@link morphSweepValue}).
 */
export type PlanetMotion = 'descent' | 'yaw360' | 'morphSweep';

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

/** The morph sweep: the camera stays on the orbit pose for the whole move. */
export function morphSweepView(): PlanetView {
  return planetPoseView('orbit');
}

/**
 * The morph sweep's value of `<planet [morph]>` at progress `t`: 0 at the start, 1 at the middle, 0 at the end. A smoothstep on
 * each half, so the speed is zero at both ends and at the peak, and both ends are exactly 0 (the page's morph check compares
 * the value after the move with the case's 0).
 */
export function morphSweepValue(t: number): number {
  const s = Math.min(1, Math.max(0, t));
  const x = s < 0.5 ? 2 * s : 2 - 2 * s;
  return x * x * (3 - 2 * x);
}

export function motionView(motion: PlanetMotion, t: number): PlanetView {
  if (motion === 'morphSweep') return morphSweepView();
  return motion === 'descent' ? descentView(t) : yawView(t);
}

/** The morph a scripted move sets at progress `t`, or undefined when the move leaves the morph alone. */
export function motionMorph(motion: PlanetMotion, t: number): number | undefined {
  return motion === 'morphSweep' ? morphSweepValue(t) : undefined;
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

/** The lowest altitude the mouse orbit mode reaches: the 2 m eye. */
export const FREE_MIN_ALTITUDE_M = EYE_ALTITUDE_M;
/** The highest altitude the mouse orbit mode reaches: twice the orbit altitude (2.4 million m). */
export const FREE_MAX_ALTITUDE_M = 2 * ORBIT_ALTITUDE_M;
/** The largest ground angle one drag step may move the camera, radians. */
const FREE_MAX_DRAG_STEP_RAD = 0.5;

function wrapAngle(angleRad: number): number {
  const turn = 2 * Math.PI;
  return angleRad - turn * Math.round(angleRad / turn);
}

/**
 * Mouse orbit, drag: grabs the globe. The ground direction turns about the planet's centre so the surface under the cursor
 * roughly follows it: the angle per pixel is the field of view per pixel times the altitude over the radius (the view's
 * ground width per pixel, as an angle at the centre), capped at 0.5 rad per step. Dragging right turns the camera west,
 * dragging down turns it north. Altitude, heading and pitch are unchanged. Returns a new view.
 *
 * @param view The view to move.
 * @param dxPx Horizontal drag, CSS pixels (positive is right).
 * @param dyPx Vertical drag, CSS pixels (positive is down).
 * @param viewportHeightPx The canvas height in CSS pixels.
 * @param fovDeg The vertical field of view, degrees.
 */
export function freeDrag(view: PlanetView, dxPx: number, dyPx: number, viewportHeightPx: number, fovDeg: number): PlanetView {
  const pixels = Math.hypot(dxPx, dyPx);
  if (pixels === 0) return { ...view };
  const { up, east, north } = groundFrame('sphere', view.ground);
  const radPerPx = (fovDeg * DEG / viewportHeightPx) * (Math.max(1, view.altitudeM) / PLANET_RADIUS_M);
  const angle = Math.min(FREE_MAX_DRAG_STEP_RAD, pixels * radPerPx);
  const tangent: Vec3 = [0, 1, 2].map((k) => (-dxPx * east[k] + dyPx * north[k]) / pixels) as Vec3;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const moved = [0, 1, 2].map((k) => c * up[k] + s * tangent[k]);
  const length = Math.hypot(moved[0], moved[1], moved[2]);
  return { ...view, ground: [moved[0] / length, moved[1] / length, moved[2] / length] };
}

/**
 * Mouse orbit, look: turns the heading by the drag's horizontal part and the pitch by its vertical part, at the field of
 * view per pixel. The heading wraps to -PI..PI; the pitch clamps to -PI/2 (straight down) .. PI/2 (straight up). Ground and
 * altitude are unchanged. Returns a new view.
 *
 * @param view The view to turn.
 * @param dxPx Horizontal drag, CSS pixels (positive is right).
 * @param dyPx Vertical drag, CSS pixels (positive is down).
 * @param viewportHeightPx The canvas height in CSS pixels.
 * @param fovDeg The vertical field of view, degrees.
 */
export function freeLook(view: PlanetView, dxPx: number, dyPx: number, viewportHeightPx: number, fovDeg: number): PlanetView {
  const radPerPx = fovDeg * DEG / viewportHeightPx;
  return {
    ...view,
    headingRad: wrapAngle(view.headingRad - dxPx * radPerPx),
    pitchRad: Math.min(Math.PI / 2, Math.max(-Math.PI / 2, view.pitchRad - dyPx * radPerPx)),
  };
}

/**
 * Mouse orbit, zoom: the altitude scales by `exp(wheelDeltaY * 0.001)`, so a wheel step zooms by the same factor whatever the
 * altitude. A positive delta zooms out. The altitude clamps to {@link FREE_MIN_ALTITUDE_M} .. {@link FREE_MAX_ALTITUDE_M}.
 * Returns a new view.
 *
 * @param view The view to zoom.
 * @param wheelDeltaY The wheel event's `deltaY`.
 */
export function freeZoom(view: PlanetView, wheelDeltaY: number): PlanetView {
  const altitude = view.altitudeM * Math.exp(wheelDeltaY * 0.001);
  return { ...view, altitudeM: Math.min(FREE_MAX_ALTITUDE_M, Math.max(FREE_MIN_ALTITUDE_M, altitude)) };
}
