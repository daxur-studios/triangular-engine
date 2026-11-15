import {
  bendPointInto, FIXTURE_GROUND, FIXTURE_HEADING_RAD, groundFrame, morphMapXY, type MorphMap, type Vec3,
} from 'triangular-engine/lod-surface/core';

/**
 * Cameras of the planet scene page (Plan 059, step G5). The planet's centre is the scene origin, so a camera is a ground
 * direction, an altitude above the ground under it, a heading from local north and a pitch. Positions are doubles in the scene
 * frame; the terrain draws camera-relative, so the large coordinates are safe.
 *
 * The lod-surface lab's `lod-camera.ts` is built on its domain presets and a `HeightSource`, so this is a small sphere-only
 * counterpart whose ground height comes from a callback (the terrain's `groundAt`).
 */

export type PlanetPoseId = 'orbit' | 'mid-20km' | 'coast' | 'ground';

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

/** Earth's mean radius, metres: 1x of the world-size ladder. */
export const EARTH_RADIUS_M = 6_371_000;
/** The world sizes of the ground-only ladder, as fractions of {@link EARTH_RADIUS_M}. */
export const EARTH_SCALE_TIERS = [0.001, 0.01, 0.1, 1] as const;

/** Orbit altitude above the ground for a planet radius: two radii, so three from the centre. */
export function orbitAltitudeFor(radiusM: number): number {
  return 2 * radiusM;
}

/** Orbit altitude above the ground: three radii from the centre, so the whole globe is in a 60 degree view. */
export const ORBIT_ALTITUDE_M = orbitAltitudeFor(PLANET_RADIUS_M);
export const MID_ALTITUDE_M = 20_000;
export const EYE_ALTITUDE_M = 2;
export const COAST_ALTITUDE_M = 50;
export const ORBIT_PITCH_RAD = -90 * DEG;
export const GROUND_PITCH_RAD = -5 * DEG;

/** The poses stand on the lod-surface fixture ground point, which the cell planet puts on land beside a ridge. */
const GROUND: Vec3 = FIXTURE_GROUND.sphere;
const HEADING = FIXTURE_HEADING_RAD.sphere;

/**
 * The coast pose (suite v5): the nearest shore of the cell planet to {@link GROUND}, found by sampling the planet's own
 * `cellPlanetSampler` on rings round the fixture ground. The shore is 18.75 km from it at bearing 152 degrees (south-east),
 * a gentle beach (about 1.3 percent: 1.2 m of land 100 m inland, 7.7 m at 600 m). The camera stands 600 m inland, 50 m above
 * the ground there, and looks seaward at the shore, so land, beach and sea share the view. Offsets are metres east and north
 * of the fixture ground. Taken from the sampler, not from the baked heights, so the baked shore may sit a few metres off.
 */
const COAST_EAST_M = 8521;
const COAST_NORTH_M = -16026;
const COAST_HEADING_RAD = 152 * DEG;
const COAST_PITCH_RAD = -6 * DEG;

function coastGround(radiusM: number): Vec3 {
  const { up, east, north } = groundFrame('sphere', GROUND);
  const p = [0, 1, 2].map((k) => up[k] * radiusM + east[k] * COAST_EAST_M + north[k] * COAST_NORTH_M);
  const length = Math.hypot(p[0], p[1], p[2]);
  return [p[0] / length, p[1] / length, p[2] / length];
}

export const PLANET_POSES: readonly { readonly id: PlanetPoseId; readonly label: string }[] = [
  { id: 'orbit', label: 'orbit' },
  { id: 'mid-20km', label: '20 km' },
  { id: 'coast', label: 'coast, 50 m' },
  { id: 'ground', label: '2 m eye' },
];

export function planetPoseView(id: PlanetPoseId, radiusM: number = PLANET_RADIUS_M): PlanetView {
  switch (id) {
    case 'orbit': return { ground: GROUND, altitudeM: orbitAltitudeFor(radiusM), headingRad: HEADING, pitchRad: ORBIT_PITCH_RAD };
    case 'mid-20km': return { ground: GROUND, altitudeM: MID_ALTITUDE_M, headingRad: HEADING, pitchRad: -25 * DEG };
    case 'coast': return { ground: coastGround(radiusM), altitudeM: COAST_ALTITUDE_M, headingRad: COAST_HEADING_RAD, pitchRad: COAST_PITCH_RAD };
    case 'ground': return { ground: GROUND, altitudeM: EYE_ALTITUDE_M, headingRad: HEADING, pitchRad: GROUND_PITCH_RAD };
  }
}

/** The descent: orbit to the 2 m eye over the same ground point, altitude logarithmic, the pitch easing from straight down to level. */
export function descentView(t: number, radiusM: number = PLANET_RADIUS_M): PlanetView {
  const from = planetPoseView('orbit', radiusM);
  const to = planetPoseView('ground', radiusM);
  const s = Math.min(1, Math.max(0, t));
  return {
    ...from,
    altitudeM: from.altitudeM * (to.altitudeM / from.altitudeM) ** s,
    pitchRad: from.pitchRad + (to.pitchRad - from.pitchRad) * s * s,
  };
}

/** The turn: the ground pose with the heading going once round (360 degrees). */
export function yawView(t: number, radiusM: number = PLANET_RADIUS_M): PlanetView {
  const from = planetPoseView('ground', radiusM);
  return { ...from, headingRad: from.headingRad + 2 * Math.PI * Math.min(1, Math.max(0, t)) };
}

/**
 * The morph sweep: the camera stays on one pose for the whole move, the orbit pose unless the case names another (suite
 * visual v5 sweeps at 20 km and at the 2 m eye too).
 */
export function morphSweepView(pose: PlanetPoseId = 'orbit', radiusM: number = PLANET_RADIUS_M): PlanetView {
  return planetPoseView(pose, radiusM);
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

/** The view of a scripted move at progress `t`; `sweepPose` is the pose a morph sweep holds (the orbit pose when omitted). */
export function motionView(motion: PlanetMotion, t: number, sweepPose: PlanetPoseId = 'orbit', radiusM: number = PLANET_RADIUS_M): PlanetView {
  if (motion === 'morphSweep') return morphSweepView(sweepPose, radiusM);
  return motion === 'descent' ? descentView(t, radiusM) : yawView(t, radiusM);
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

// -- reference cubes ------------------------------------------------------------------------------------------------

/** A reference cube of the page: its edge, where it stands from the pose ground point, and its colour. */
export interface ReferenceCube {
  readonly sizeM: number;
  /** Metres along the ground pose's heading from the pose ground point (the tangent plane; the point is then put on the sphere). */
  readonly aheadM: number;
  /** Metres to the left of that heading. */
  readonly leftM: number;
  readonly color: number;
}

/**
 * Three cubes about 32 times apart in size (100 m, 3 km, 100 km), in front of the 2 m eye, so each altitude has one to judge
 * scale and the bend by: the small one fills part of the eye's view, the middle one is plain at 20 km, the large one is
 * about 70 pixels across from orbit and its top clears the eye's horizon (the drop at 150 km is about 19 km).
 */
export const REFERENCE_CUBES: readonly ReferenceCube[] = [
  { sizeM: 100, aheadM: 400, leftM: 150, color: 0xff2bd6 },
  { sizeM: 3000, aheadM: 8000, leftM: -3000, color: 0xffd400 },
  { sizeM: 100_000, aheadM: 150_000, leftM: 0, color: 0x00e5ff },
];

/** The reference cubes a planet of this radius shows: those whose distance ahead is at most the radius (a cube past it would stand beyond the horizon of a small world). */
export function referenceCubesFor(radiusM: number): readonly ReferenceCube[] {
  return REFERENCE_CUBES.filter((cube) => cube.aheadM <= radiusM);
}

/** The unit ground direction under a reference cube's centre. */
export function referenceCubeGround(cube: ReferenceCube, radiusM: number = PLANET_RADIUS_M): Vec3 {
  const { up, east, north } = groundFrame('sphere', GROUND);
  const ch = Math.cos(HEADING);
  const sh = Math.sin(HEADING);
  const p = [0, 1, 2].map((k) => up[k] * radiusM
    + (ch * north[k] + sh * east[k]) * cube.aheadM
    - (ch * east[k] - sh * north[k]) * cube.leftM);
  const length = Math.hypot(p[0], p[1], p[2]);
  return [p[0] / length, p[1] / length, p[2] / length];
}

/**
 * How high a cube's centre stands above the ground under it, metres: half its edge, less the sphere's drop at its corners
 * (half the diagonal of its base, `d^2 / 2R`), so its base corners touch the ground rather than float.
 */
export function referenceCubeLift(cube: ReferenceCube, radiusM: number): number {
  const halfDiagonal = cube.sizeM / Math.SQRT2;
  return cube.sizeM / 2 - (halfDiagonal * halfDiagonal) / (2 * radiusM);
}

// -- following the bend ---------------------------------------------------------------------------------------------

/** Scratch of {@link bendGlobePoint} (synchronous, so one set per module is enough). */
const BEND_XY: [number, number] = [0, 0];
const BEND_OUT = { position: [0, 0, 0] as Vec3, normal: [0, 0, 0] as Vec3 };

/**
 * Where the morph puts a point of the unbent globe, in the scene (= body) frame: the point's longitude and latitude in the
 * projection basis go through the map (`morphMapXY`) and the bend (`bendPointInto`), with its height above the base sphere
 * along the bent normal, and the map frame goes back to the body frame (`right x + up y + forward (z + shift)`). The terrain,
 * the water and the atmosphere bend their vertices the same way, so a point placed with this stays on the drawn ground.
 * At morph 0 it returns `p`.
 *
 * @param map The morph map of this frame (`MorphMapResolver.resolve(planet.morphUniforms, R)`).
 * @param p A point of the unbent globe, scene metres from the planet's centre.
 * @param out Where to write the result.
 */
export function bendGlobePoint(map: MorphMap, p: readonly number[], out: Vec3 = [0, 0, 0]): Vec3 {
  const { right, up, forward } = map.basis;
  const r = Math.hypot(p[0], p[1], p[2]);
  const ur = (p[0] * right[0] + p[1] * right[1] + p[2] * right[2]) / r;
  const uu = (p[0] * up[0] + p[1] * up[1] + p[2] * up[2]) / r;
  const uf = (p[0] * forward[0] + p[1] * forward[1] + p[2] * forward[2]) / r;
  const lon = Math.atan2(ur, uf);
  const lat = Math.asin(Math.min(1, Math.max(-1, uu)));
  morphMapXY(lon, lat, map, BEND_XY);
  const q = bendPointInto(BEND_XY[0], BEND_XY[1], map.k, r - map.radius, BEND_OUT).position;
  for (let i = 0; i < 3; i++) out[i] = right[i] * q[0] + up[i] * q[1] + forward[i] * (q[2] + map.shift);
  return out;
}

/** The finite-difference step of {@link bentDirection}, metres: small next to the bend's curvature, large next to rounding. */
const BEND_STEP_M = 1;

/** The direction the bend gives a unit vector `v` at the globe point `p` (the bend's derivative along `v`), normalised. */
export function bentDirection(map: MorphMap, p: readonly number[], v: readonly number[]): Vec3 {
  const a = bendGlobePoint(map, [p[0] + BEND_STEP_M * v[0], p[1] + BEND_STEP_M * v[1], p[2] + BEND_STEP_M * v[2]]);
  const b = bendGlobePoint(map, [p[0] - BEND_STEP_M * v[0], p[1] - BEND_STEP_M * v[1], p[2] - BEND_STEP_M * v[2]]);
  const d: Vec3 = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const length = Math.hypot(d[0], d[1], d[2]);
  return [d[0] / length, d[1] / length, d[2] / length];
}

/**
 * The camera carried through the morph: its position bent like the ground under it, and its forward and up turned by the
 * bend there (up made square to forward again), so it keeps the same view of the ground at every morph. At morph 0 the
 * camera is returned unchanged.
 */
export function bendPlanetCamera(camera: ResolvedPlanetCamera, map: MorphMap): ResolvedPlanetCamera {
  if (map.morph === 0) return camera;
  const position = bendGlobePoint(map, camera.position);
  const forward = bentDirection(map, camera.position, camera.forward);
  const bentUp = bentDirection(map, camera.position, camera.up);
  const along = bentUp[0] * forward[0] + bentUp[1] * forward[1] + bentUp[2] * forward[2];
  const square: Vec3 = [bentUp[0] - along * forward[0], bentUp[1] - along * forward[1], bentUp[2] - along * forward[2]];
  const length = Math.hypot(square[0], square[1], square[2]);
  const up: Vec3 = [square[0] / length, square[1] / length, square[2] / length];
  return { position, forward, up, right: cross(forward, up), clearanceM: camera.clearanceM };
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
/** The highest altitude the mouse orbit mode reaches: four radii (twice the orbit altitude; 2.4 million m at the default radius). */
export function freeMaxAltitudeFor(radiusM: number): number {
  return 4 * radiusM;
}
export const FREE_MAX_ALTITUDE_M = freeMaxAltitudeFor(PLANET_RADIUS_M);
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
export function freeDrag(view: PlanetView, dxPx: number, dyPx: number, viewportHeightPx: number, fovDeg: number, radiusM: number = PLANET_RADIUS_M): PlanetView {
  const pixels = Math.hypot(dxPx, dyPx);
  if (pixels === 0) return { ...view };
  const { up, east, north } = groundFrame('sphere', view.ground);
  const radPerPx = (fovDeg * DEG / viewportHeightPx) * (Math.max(1, view.altitudeM) / radiusM);
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
export function freeZoom(view: PlanetView, wheelDeltaY: number, radiusM: number = PLANET_RADIUS_M): PlanetView {
  const altitude = view.altitudeM * Math.exp(wheelDeltaY * 0.001);
  return { ...view, altitudeM: Math.min(freeMaxAltitudeFor(radiusM), Math.max(FREE_MIN_ALTITUDE_M, altitude)) };
}
