import { Vector3 } from 'three';
import { CellPlanetMorphCameraRig, type ICellPlanetGroundFrame } from 'triangular-engine/worldgen/render';
import { bodyById, type BodyId } from './planet-shape-config';

/**
 * The camera rig shared by every contender: named poses in the body-fixed frame, resolved to plain numbers so a test can
 * apply one by id and get the same view every time. Longitude 0 is +Z, latitude 0 the equator, +Y the pole (the morph
 * convention); heading is clockwise from north.
 */
export type CameraPoseId = 'orbit' | 'low-flyover' | 'ground' | 'horizon-grazing';

export interface CameraPoseDefinition {
  readonly id: CameraPoseId;
  readonly label: string;
  readonly lonDeg: number;
  readonly latDeg: number;
  readonly headingDeg: number;
  /** Degrees above the local horizon; `'horizon'` looks exactly along the horizon line from this altitude. */
  readonly pitchDeg: number | 'horizon';
  /** Altitude above the sphere: metres plus a multiple of the body radius. */
  readonly altitudeM: number;
  readonly altitudeRadii: number;
}

export const CAMERA_POSES: readonly CameraPoseDefinition[] = [
  { id: 'orbit', label: 'Orbit', lonDeg: 0, latDeg: 0, headingDeg: 0, pitchDeg: -90, altitudeM: 0, altitudeRadii: 2.5 },
  { id: 'low-flyover', label: 'Low flyover', lonDeg: 0, latDeg: 0, headingDeg: 90, pitchDeg: -20, altitudeM: 0, altitudeRadii: 0.02 },
  { id: 'ground', label: 'Ground', lonDeg: 0, latDeg: 0, headingDeg: 90, pitchDeg: 0, altitudeM: 2, altitudeRadii: 0 },
  { id: 'horizon-grazing', label: 'Horizon grazing', lonDeg: 0, latDeg: 0, headingDeg: 90, pitchDeg: 'horizon', altitudeM: 0, altitudeRadii: 0.005 },
];

/** A pose without its name: what the free camera edits. */
export type CameraView = Omit<CameraPoseDefinition, 'id' | 'label'>;

export interface ResolvedCameraPose {
  /** `'free'` for the hand-driven camera; tests only use named poses. */
  readonly id: CameraPoseId | 'free';
  readonly bodyId: BodyId;
  readonly altitudeM: number;
  /** Body-fixed position in metres, in doubles. */
  readonly position: readonly [number, number, number];
  /** Unit view direction and up vector in the body frame. */
  readonly forward: readonly [number, number, number];
  readonly up: readonly [number, number, number];
  readonly pitchDeg: number;
  readonly near: number;
  readonly far: number;
}

export function cameraPoseById(id: CameraPoseId): CameraPoseDefinition {
  const pose = CAMERA_POSES.find((item) => item.id === id);
  if (!pose) throw new Error(`Unknown camera pose: ${id}`);
  return pose;
}

const RAD = Math.PI / 180;

export function resolveCameraPose(id: CameraPoseId, bodyId: BodyId, morph = 0): ResolvedCameraPose {
  return resolveCameraView(cameraPoseById(id), bodyId, id, morph);
}

/** A named pose as an editable view, with `'horizon'` pitch turned into degrees for this body. */
export function cameraViewFromPose(id: CameraPoseId, bodyId: BodyId): CameraView {
  const def = cameraPoseById(id);
  const resolved = resolveCameraPose(id, bodyId);
  return { ...def, pitchDeg: resolved.pitchDeg, altitudeM: resolved.altitudeM, altitudeRadii: 0 };
}

/** Lowest and highest free-camera altitude. */
export const FREE_CAMERA_MIN_ALTITUDE_M = 2;
export const FREE_CAMERA_MAX_ALTITUDE_RADII = 6;

/**
 * Free camera, left drag: slide over the surface along the current heading. The speed follows altitude, so a drag pans
 * about one screen's worth of ground at any height. `dx`/`dy` are in screen heights.
 */
export function panCameraView(view: CameraView, dx: number, dy: number, bodyId: BodyId): CameraView {
  const radius = bodyById(bodyId).radiusM;
  const altitude = view.altitudeM + view.altitudeRadii * radius;
  const metres = Math.min(altitude * 1.5, radius * 2);
  const heading = view.headingDeg * RAD;
  const forward = dy * metres / radius;
  const sideways = -dx * metres / radius;
  // Small-step move on the sphere: north/east components of the heading-relative drag.
  const north = Math.cos(heading) * forward - Math.sin(heading) * sideways;
  const east = Math.sin(heading) * forward + Math.cos(heading) * sideways;
  const latDeg = Math.max(-89.9, Math.min(89.9, view.latDeg + north / RAD));
  const lonDeg = view.lonDeg + east / RAD / Math.max(0.01, Math.cos(view.latDeg * RAD));
  return { ...view, latDeg, lonDeg: ((lonDeg + 540) % 360) - 180 };
}

/** Free camera, right drag: turn (heading) and tilt (pitch, from straight down to slightly above the horizon). */
export function lookCameraView(view: CameraView, dx: number, dy: number): CameraView {
  const pitch = typeof view.pitchDeg === 'number' ? view.pitchDeg : 0;
  return {
    ...view,
    headingDeg: (((view.headingDeg + dx * 180) % 360) + 360) % 360,
    pitchDeg: Math.max(-90, Math.min(30, pitch - dy * 90)),
  };
}

/** Free camera, wheel: altitude grows or shrinks by a constant factor per step, so zoom feels the same at every height. */
export function zoomCameraView(view: CameraView, steps: number, bodyId: BodyId): CameraView {
  const radius = bodyById(bodyId).radiusM;
  const altitude = view.altitudeM + view.altitudeRadii * radius;
  const next = Math.max(FREE_CAMERA_MIN_ALTITUDE_M, Math.min(FREE_CAMERA_MAX_ALTITUDE_RADII * radius, altitude * 1.2 ** steps));
  return { ...view, altitudeM: next, altitudeRadii: 0 };
}

/**
 * Far clip plane, in body radii. Large enough for anything the lab draws from any pose (free camera up to 6 radii, the flat
 * map 2πR wide at morph 1), so nothing is clipped. Not `Infinity`: three.js builds the projection matrix from
 * `far + near` / `far - near`, which is NaN for an infinite far plane.
 */
export const CAMERA_FAR_RADII = 100;

export function resolveCameraView(def: CameraView, bodyId: BodyId, id: CameraPoseId | 'free', morph = 0): ResolvedCameraPose {
  const globe = resolveGlobeView(def, bodyId, id);
  return morph > 0 ? followMorph(globe, def, morph) : globe;
}

/**
 * The camera rides the morph: the pose is carried rigidly from the globe's ground frame under it (lon/lat of the pose) to
 * that ground point's frame at `morph`, so height, pitch and heading over the same ground stay as they were and the
 * flat map at morph 1 is seen from the same place. The frame is the engine's `CellPlanetMorphCameraRig.groundFrame`, the
 * CPU twin of the material's bend morph, with the lab's projection: Equal Earth (the material's default
 * `uProjectionType`) centred on longitude 0 (`MORPH_CENTRE`, the rig's default basis +Z/+Y/+X). Ground relief is not
 * modelled (the lab sphere has none). The morphed surface is float32 in the shader, so at planet scale the ground under
 * a 2 m camera can sit a few decimetres off the double-precision frame here; fine for a picture.
 */
function followMorph(globe: ResolvedCameraPose, def: CameraView, morph: number): ResolvedCameraPose {
  const radius = bodyById(globe.bodyId).radiusM;
  const rig = new CellPlanetMorphCameraRig({ radiusM: radius, projection: () => 'equalEarth' });
  const lon = def.lonDeg * RAD;
  const lat = def.latDeg * RAD;
  const anchor = new Vector3(Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon));
  const from = rig.groundFrame(anchor, 0);
  const to = rig.groundFrame(anchor, Math.min(1, morph));
  const position = carryPoint(new Vector3(...globe.position), from, to);
  const forward = carryDirection(new Vector3(...globe.forward), from, to);
  const up = carryDirection(new Vector3(...globe.up), from, to);
  return {
    ...globe,
    position: [position.x, position.y, position.z],
    forward: [forward.x, forward.y, forward.z],
    up: [up.x, up.y, up.z],
  };
}

function carryDirection(v: Vector3, from: ICellPlanetGroundFrame, to: ICellPlanetGroundFrame): Vector3 {
  const east = v.dot(from.east);
  const north = v.dot(from.north);
  const normal = v.dot(from.normal);
  return new Vector3().addScaledVector(to.east, east).addScaledVector(to.north, north).addScaledVector(to.normal, normal);
}

function carryPoint(p: Vector3, from: ICellPlanetGroundFrame, to: ICellPlanetGroundFrame): Vector3 {
  return carryDirection(p.sub(from.position), from, to).add(to.position);
}

function resolveGlobeView(def: CameraView, bodyId: BodyId, id: CameraPoseId | 'free'): ResolvedCameraPose {
  const radius = bodyById(bodyId).radiusM;
  const altitude = def.altitudeM + def.altitudeRadii * radius;
  const lon = def.lonDeg * RAD;
  const lat = def.latDeg * RAD;
  const dir = [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)] as const;
  const east = [Math.cos(lon), 0, -Math.sin(lon)] as const;
  const north = [-Math.sin(lat) * Math.sin(lon), Math.cos(lat), -Math.sin(lat) * Math.cos(lon)] as const;
  const heading = def.headingDeg * RAD;
  const horizontal = [0, 1, 2].map((i) => Math.cos(heading) * north[i] + Math.sin(heading) * east[i]);
  const pitchDeg = def.pitchDeg === 'horizon' ? -Math.acos(radius / (radius + altitude)) / RAD : def.pitchDeg;
  const pitch = pitchDeg * RAD;
  const forward = [0, 1, 2].map((i) => Math.cos(pitch) * horizontal[i] + Math.sin(pitch) * dir[i]);
  const up = [0, 1, 2].map((i) => Math.cos(pitch) * dir[i] - Math.sin(pitch) * horizontal[i]);
  const distance = radius + altitude;
  return {
    id, bodyId, altitudeM: altitude, pitchDeg,
    position: [dir[0] * distance, dir[1] * distance, dir[2] * distance],
    forward: forward as [number, number, number],
    up: up as [number, number, number],
    // The floor keeps a ground view from clipping the flat facet it stands on.
    near: Math.max(0.1, Math.min(altitude * 0.2, radius * 0.05)),
    far: radius * CAMERA_FAR_RADII,
  };
}
