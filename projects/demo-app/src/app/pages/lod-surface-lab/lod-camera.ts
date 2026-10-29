import { FIXTURE_GROUND, FIXTURE_HEADING_RAD, canyonCentreSlope, canyonCentreV, groundFrame, type HeightSource, type LodDomain, type Vec3 } from 'triangular-engine/lod-surface/core';

/**
 * Plan 059 lab camera: a ground point, an altitude above the surface there (from the height source's CPU twin), a
 * heading from local north and a pitch. Positions are doubles in the domain frame; the engine camera stays at the
 * render origin and only turns (the surface is drawn camera-relative).
 */

export type PoseId = 'eye-2m' | 'low-200m' | 'mid-5km' | 'horizon' | 'orbit' | 'biome-mountain' | 'biome-canyon';

export interface CameraView {
  /** Plane: ground x, z in metres. Sphere: a ground direction (normalised when resolved). */
  readonly ground: Vec3;
  readonly altitudeM: number;
  readonly headingRad: number;
  readonly pitchRad: number;
}

export const POSES: readonly { readonly id: PoseId; readonly label: string }[] = [
  { id: 'eye-2m', label: '2 m eye' },
  { id: 'low-200m', label: '200 m' },
  { id: 'mid-5km', label: '5 km' },
  { id: 'horizon', label: 'horizon grazing' },
  { id: 'orbit', label: 'orbit' },
];

const DEG = Math.PI / 180;
/** The poses stand on the library's fixture ground point (off the root centre on the plane; near the cube corner on the sphere), which the cliff fixture is placed from. */

export function poseView(id: PoseId, domain: LodDomain): CameraView {
  const ground = FIXTURE_GROUND[domain.kind];
  const headingRad = FIXTURE_HEADING_RAD[domain.kind];
  if (id === 'biome-canyon') return canyonView(domain);
  if (id === 'biome-mountain') return biomeView(domain, -0.04);
  switch (id) {
    case 'eye-2m': return { ground, altitudeM: 2, headingRad, pitchRad: -8 * DEG };
    case 'low-200m': return { ground, altitudeM: 200, headingRad, pitchRad: -15 * DEG };
    case 'mid-5km': return { ground, altitudeM: 5000, headingRad, pitchRad: -25 * DEG };
    case 'horizon': return { ground, altitudeM: 50, headingRad, pitchRad: 0 };
    case 'orbit': return { ground, altitudeM: domain.kind === 'plane' ? 120_000 : 2 * domain.sizeM, headingRad, pitchRad: -90 * DEG };
  }
}

/** A camera on the region strip, looking along it. The plane and sphere use the same biome coordinates. */
export function biomeView(domain: LodDomain, u: number): CameraView {
  const angle = 1.8 * u;
  return {
    ground: domain.kind === 'plane' ? [u * domain.sizeM, 0, 0] : [Math.sin(angle), 0, Math.cos(angle)],
    altitudeM: domain.kind === 'plane' ? 3000 : 900,
    headingRad: Math.PI / 2,
    pitchRad: -35 * DEG,
  };
}

/** Plane u of the canyon pose: past the blend (u > 0.34), with the bend at u = 0.458 ahead and the one at 0.327 behind. */
export const CANYON_POSE_U = 0.37;

/**
 * An oblique view down the cut: on the canyon centreline at u = {@link CANYON_POSE_U}, 1,500 m above the floor (600 m above
 * the rim), heading along the centreline's tangent and pitched 30 degrees down, so both walls and the next bend are in frame.
 */
export function canyonView(domain: LodDomain): CameraView {
  const u = CANYON_POSE_U;
  if (domain.kind === 'sphere') {
    // Strip units are 1.8 radians on the sphere and v is latitude (north), so the heading follows the slope the other way round.
    const lon = 1.8 * u;
    const lat = 1.8 * canyonCentreV(u);
    return {
      ground: [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)],
      altitudeM: 500,
      headingRad: Math.atan2(1, canyonCentreSlope(u)),
      pitchRad: -30 * DEG,
    };
  }
  return {
    ground: [u * domain.sizeM, 0, canyonCentreV(u) * domain.sizeM],
    altitudeM: 1500,
    headingRad: Math.atan2(1, -canyonCentreSlope(u)),
    pitchRad: -30 * DEG,
  };
}

/** A single traversal of the five region centres, from meadow to canyon. */
export function biomePathView(domain: LodDomain, t: number): CameraView {
  return biomeView(domain, -0.4 + 0.8 * Math.max(0, Math.min(1, t)));
}

export interface ResolvedCamera {
  readonly position: Vec3;
  readonly forward: Vec3;
  readonly right: Vec3;
  readonly up: Vec3;
  /** Height of the camera above the drawn surface under it. */
  readonly clearanceM: number;
}

function normalise(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / length, v[1] / length, v[2] / length];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function resolveCamera(view: CameraView, domain: LodDomain, source: HeightSource): ResolvedCamera {
  const { up, east, north } = groundFrame(domain.kind, view.ground);
  const base: Vec3 = domain.kind === 'plane' ? [view.ground[0], 0, view.ground[2]] : [up[0] * domain.sizeM, up[1] * domain.sizeM, up[2] * domain.sizeM];
  const surface = Math.max(0, source.heightAt(base[0], base[1], base[2]));
  const lift = surface + view.altitudeM;
  const position: Vec3 = [base[0] + up[0] * lift, base[1] + up[1] * lift, base[2] + up[2] * lift];
  const ch = Math.cos(view.headingRad);
  const sh = Math.sin(view.headingRad);
  const cp = Math.cos(view.pitchRad);
  const sp = Math.sin(view.pitchRad);
  const forward: Vec3 = [0, 1, 2].map((k) => cp * (ch * north[k] + sh * east[k]) + sp * up[k]) as Vec3;
  const right: Vec3 = [0, 1, 2].map((k) => ch * east[k] - sh * north[k]) as Vec3;
  return { position, forward, right, up: cross(right, forward), clearanceM: lift - source.heightAt(base[0], base[1], base[2]) };
}

/** Turns the view: dx, dy in screen heights. */
export function lookView(view: CameraView, dx: number, dy: number): CameraView {
  const pitch = Math.min(89.9 * DEG, Math.max(-90 * DEG, view.pitchRad - dy * 1.5));
  return { ...view, headingRad: view.headingRad + dx * 1.5, pitchRad: pitch };
}

/** Moves the ground point along the heading frame, scaled by altitude: dx, dy in screen heights. */
export function panView(view: CameraView, dx: number, dy: number, domain: LodDomain): CameraView {
  const { up, east, north } = groundFrame(domain.kind, view.ground);
  const ch = Math.cos(view.headingRad);
  const sh = Math.sin(view.headingRad);
  const metres = Math.max(5, view.altitudeM) * 1.5;
  const along = dy * metres;
  const side = -dx * metres;
  const move = [0, 1, 2].map((k) => along * (ch * north[k] + sh * east[k]) + side * (ch * east[k] - sh * north[k]));
  if (domain.kind === 'plane') {
    const half = domain.sizeM / 2;
    return { ...view, ground: [Math.min(half, Math.max(-half, view.ground[0] + move[0])), 0, Math.min(half, Math.max(-half, view.ground[2] + move[2]))] };
  }
  const point = up.map((u, k) => u * domain.sizeM + move[k]) as Vec3;
  return { ...view, ground: normalise(point) };
}

export function zoomView(view: CameraView, notches: number, domain: LodDomain): CameraView {
  const ceiling = domain.kind === 'plane' ? 200_000 : 4 * domain.sizeM;
  return { ...view, altitudeM: Math.min(ceiling, Math.max(0.5, view.altitudeM * 1.15 ** notches)) };
}

/** The scripted sweep's period, seconds (0.5 Hz): one swing out, back, over the other side and back to the pose. */
export const SWEEP_PERIOD_S = 2;
/** Heading swing of the scripted sweep, radians either side of the pose (30 degrees). */
export const SWEEP_YAW_RAD = 30 * DEG;
/** Altitude swing of the scripted sweep, as a share of the pose altitude either side of it. */
export const SWEEP_ALTITUDE_SHARE = 0.02;

/**
 * The scripted sweep: holds a pose and swings the camera back and forth, heading +-{@link SWEEP_YAW_RAD} with the
 * altitude changing +-{@link SWEEP_ALTITUDE_SHARE} in step, once every {@link SWEEP_PERIOD_S} seconds. A pure function of
 * `t` (seconds since the sweep began), so every run flies the same path; at t = 0 (and every whole period) it is the pose.
 * Pure turning only changes what the frustum culls, so it is the altitude change that moves the distance thresholds.
 */
export function sweepPathView(domain: LodDomain, pose: PoseId, t: number): CameraView {
  const from = poseView(pose, domain);
  const swing = Math.sin((2 * Math.PI * t) / SWEEP_PERIOD_S);
  return { ...from, headingRad: from.headingRad + SWEEP_YAW_RAD * swing, altitudeM: from.altitudeM * (1 + SWEEP_ALTITUDE_SHARE * swing) };
}

/** The scripted turn's period, seconds (0.25 Hz): one swing out, back, over the other side and back to the pose. */
export const TURN_PERIOD_S = 4;
/** Heading swing of the scripted turn, radians either side of the pose (90 degrees): wide enough that patches leave and enter the view. */
export const TURN_YAW_RAD = 90 * DEG;

/**
 * The scripted turn: holds the pose's position and altitude exactly and swings only the heading, +-{@link TURN_YAW_RAD}
 * once every {@link TURN_PERIOD_S} seconds. A pure function of `t` (seconds since the turn began); at t = 0 (and every
 * whole period) it is the pose. No distance changes, so any split or merge it causes comes from what the view culls
 * (the leaf budget and the balance rule see a different set of nodes), not from the distance criterion.
 */
export function turnPathView(domain: LodDomain, pose: PoseId, t: number): CameraView {
  const from = poseView(pose, domain);
  return { ...from, headingRad: from.headingRad + TURN_YAW_RAD * Math.sin((2 * Math.PI * t) / TURN_PERIOD_S) };
}

/** The scripted zoom: 2 m eye to orbit, altitude logarithmic, pitch from the eye pose to straight down. */
export function zoomPathView(domain: LodDomain, t: number): CameraView {
  const from = poseView('eye-2m', domain);
  const to = poseView('orbit', domain);
  const s = Math.min(1, Math.max(0, t));
  return {
    ...from,
    altitudeM: from.altitudeM * (to.altitudeM / from.altitudeM) ** s,
    pitchRad: from.pitchRad + (to.pitchRad - from.pitchRad) * s * s,
  };
}
