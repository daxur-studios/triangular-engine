import { bend, bendFrame, blendedExtents, blendedProjection, equalEarthRow } from 'triangular-engine/atmosphere';
import {
  anchorFor,
  cubeComponent,
  cubeLattice,
  faceOfDirection,
  newAnchor,
  type LatticeAnchor,
  type LodDomain,
  type Vec3,
} from 'triangular-engine/lod-surface/core';
import { EE, OUTLINE_WRAP, type MorphAnchor, type MorphOutline, type NaiveFrame } from './morph-math';

/**
 * Plan 059 morph spike, the CPU half (all doubles): the projection basis, the camera rig that places the engine camera in
 * the bent frame, the per-frame anchor values the vertex function takes as uniforms, and the reference position of a
 * vertex that the precision probe compares the GPU against.
 *
 * Conventions follow `planet-morph-nodes.ts`: the projection basis is (forward, up, right) from
 * `setPlanetProjectionCentre`; longitude and latitude are measured in it (lon = atan2(u . right, u . forward), lat =
 * asin(u . up)); the map frame is x right, y up, z forward, the bent ground is the sphere of radius 1 / k centred on
 * (0, 0, -1 / k), and the map frame turns into the body frame by `right x + up y + forward z` with z shifted by
 * `(1 - morph) R`, so morph 0 is the globe centred on the origin.
 */

const TWO_PI = 2 * Math.PI;
const HALF_PI = Math.PI / 2;
const DEG = Math.PI / 180;

/** The projection basis in the body frame: unit vectors. */
export interface MorphBasis {
  readonly forward: Vec3;
  readonly up: Vec3;
  readonly right: Vec3;
}

/** A camera pose on the sphere, measured in the projection basis (lon, lat from the projection centre). */
export interface MorphPose {
  readonly lonDeg: number;
  readonly latDeg: number;
  /** Metres above the ground (the height source's height at the pose); a negative value stands for that many planet radii. */
  readonly altitudeM: number;
  /** From local north towards east. */
  readonly headingDeg: number;
  /** Above the horizon. */
  readonly pitchDeg: number;
}

/** Named poses of the spike page and the probe. Longitude and latitude are from the projection centre. */
export const MORPH_POSES = {
  'mid-2m': { lonDeg: 40, latDeg: 35, altitudeM: 2, headingDeg: 25, pitchDeg: -5 },
  'cut-2m': { lonDeg: 179.9, latDeg: 20, altitudeM: 2, headingDeg: 25, pitchDeg: -5 },
  'pole-2m': { lonDeg: 20, latDeg: 89.5, altitudeM: 2, headingDeg: 25, pitchDeg: -5 },
  'centre-2m': { lonDeg: 0, latDeg: 0, altitudeM: 2, headingDeg: 25, pitchDeg: -5 },
  'mid-200m': { lonDeg: 40, latDeg: 35, altitudeM: 200, headingDeg: 25, pitchDeg: -15 },
  orbit: { lonDeg: 40, latDeg: 35, altitudeM: -2, headingDeg: 0, pitchDeg: -90 },
  // Part 2 (crack probe) views. 'orbit-map' stands far enough out (3.2 radii) over the projection centre to hold the whole map at
  // 16:9; the cut poses stand 0.01 degrees (about 1.1 km at 6,371 km) from the cut and look along the equator across it; the
  // pole pose stands where the map's pole edge is {@link POLE_EDGE_AHEAD_M} ahead of it and looks at it: the latitude comes from the
  // morph (see {@link poseOf}); the entry here (0.1 degrees, about 11 km on the sphere) is the pose without a morph, where the
  // map's pole edge is only a few metres away at morph 1 (the projection's y is flat at the pole) and the view looks off the map.
  'orbit-map': { lonDeg: 0, latDeg: 0, altitudeM: -3.2, headingDeg: 0, pitchDeg: -90 },
  'cut-east-2m': { lonDeg: 179.99, latDeg: 0, altitudeM: 2, headingDeg: 90, pitchDeg: -5 },
  'cut-west-2m': { lonDeg: -179.99, latDeg: 0, altitudeM: 2, headingDeg: 270, pitchDeg: -5 },
  'pole-200m': { lonDeg: 20, latDeg: 89.9, altitudeM: 200, headingDeg: 0, pitchDeg: -20 },
} as const satisfies Record<string, MorphPose>;
/** Identifier of one of the {@link MORPH_POSES}. */
export type MorphPoseId = keyof typeof MORPH_POSES;
/** Pose ids in menu order. */
export const MORPH_POSE_IDS = Object.keys(MORPH_POSES) as MorphPoseId[];

/** Distance, metres along the map's y, from the 'pole-200m' pose to the map's pole edge (when the morph is known). */
export const POLE_EDGE_AHEAD_M = 800;

/**
 * The latitude (degrees) whose map y lies `distanceM` below the map's top edge (the pole edge) at projection blend `morph`. y is flat
 * at the pole at morph 1 (dy/dphi tends to 0), so the same distance is a very different latitude on the globe and on the map.
 */
export function poleEdgeLatitudeDeg(radiusM: number, morph: number, distanceM: number): number {
  const yOf = (lat: number): number => radiusM * ((1 - morph) * lat + morph * equalEarthRow(lat).y);
  const target = yOf(Math.PI / 2) - distanceM;
  let lo = 0;
  let hi = Math.PI / 2;
  for (let it = 0; it < 80; it++) {
    const mid = 0.5 * (lo + hi);
    if (yOf(mid) < target) lo = mid;
    else hi = mid;
  }
  return (0.5 * (lo + hi) * 180) / Math.PI;
}

/**
 * The pose of a preset; a negative altitude (the orbit poses) is that many radii above the ground. 'pole-200m' with a `morph` stands
 * {@link POLE_EDGE_AHEAD_M} below the map's pole edge at that morph, so it is on the map and sees the pole edge at every morph.
 */
export function poseOf(id: MorphPoseId, radiusM: number, morph?: number): MorphPose {
  const pose: MorphPose = MORPH_POSES[id];
  if (id === 'pole-200m' && morph !== undefined) return { ...pose, latDeg: poleEdgeLatitudeDeg(radiusM, morph, POLE_EDGE_AHEAD_M) };
  return pose.altitudeM < 0 ? { ...pose, altitudeM: -pose.altitudeM * radiusM } : pose;
}

/** What a frame is computed from. */
export interface MorphView {
  readonly radiusM: number;
  /** 0 = globe, 1 = map. Also the projection blend p. */
  readonly morph: number;
  /** The projection centre, body frame (lon 0 = +Z, lat 0 = the equator, as `setPlanetProjectionCentre`). */
  readonly centreLonDeg: number;
  readonly centreLatDeg: number;
  readonly pose: MorphPose;
  /** The height source's height under the camera, metres (the pose's altitude is above it). */
  readonly groundHeightM: number;
}

/** Everything the vertex stage and the camera need for one frame, in doubles. */
export interface MorphFrame {
  readonly view: MorphView;
  readonly basis: MorphBasis;
  /** Curvature (1 - morph) / R. */
  readonly k: number;
  /** The camera's longitude and latitude in the projection basis. */
  readonly lambdaC: number;
  readonly phiC: number;
  /** The camera's unbent position (sphere, body frame): what the selector and the lattice anchor see. */
  readonly selectorCamera: Vec3;
  /** The bent camera in the map frame (with its altitude), and in the body (= scene) frame. */
  readonly camMap: Vec3;
  readonly camBody: Vec3;
  /** The camera axes in the body frame. */
  readonly axes: { readonly right: Vec3; readonly up: Vec3; readonly forward: Vec3 };
  /** The lattice anchor (`anchorFor` of the unbent camera). */
  readonly anchor: LatticeAnchor;
  /** The anchor's unit direction: the float cube point of the anchor, normalised, in doubles. */
  readonly anchorDir: Vec3;
  /** The P2 anchor values. */
  readonly values: MorphAnchor<number>;
  /** The naive control's frame. */
  readonly naive: NaiveFrame<number>;
  /** The anchor's distances to the map's edges (doubles), see {@link outlineOf}. */
  readonly outline: MorphOutline<number>;
  /** The lattice vectors T of the basis' two poles (up, down) when they are lattice vertices, else undefined: the vertices that take their leaf's own longitude. */
  readonly poles: readonly [Vec3 | undefined, Vec3 | undefined];
}

const dot = (a: readonly number[], b: readonly number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalised = (v: readonly number[]): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** `setPlanetProjectionCentre`'s basis, in doubles. */
export function projectionBasis(lonDeg: number, latDeg: number): MorphBasis {
  const lon = lonDeg * DEG;
  const lat = latDeg * DEG;
  const forward: Vec3 = [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
  let up: Vec3 = [-forward[1] * forward[0], 1 - forward[1] * forward[1], -forward[1] * forward[2]];
  if (up[0] * up[0] + up[1] * up[1] + up[2] * up[2] < 1e-8) up = [0, 0, forward[1] > 0 ? -1 : 1];
  up = normalised(up);
  return { forward, up, right: cross(up, forward) };
}

/** A map-frame vector in the body frame (no shift): `right x + up y + forward z`. */
export function mapVectorToBody(basis: MorphBasis, v: readonly number[]): Vec3 {
  return [0, 1, 2].map((i) => basis.right[i] * v[0] + basis.up[i] * v[1] + basis.forward[i] * v[2]) as Vec3;
}

/** Unit direction (body frame) of a longitude and latitude in the projection basis. */
export function directionOf(basis: MorphBasis, lon: number, lat: number): Vec3 {
  const cl = Math.cos(lat);
  return [0, 1, 2].map((i) => basis.right[i] * cl * Math.sin(lon) + basis.up[i] * Math.sin(lat) + basis.forward[i] * cl * Math.cos(lon)) as Vec3;
}

/** The unit direction of a face lattice point, in doubles, from the exact integer cube-lattice vector. */
export function latticeDirection(face: number, u: number, v: number, steps: number, domain: LodDomain): Vec3 {
  const t = cubeLattice(face, u, v, steps);
  return normalised([cubeComponent(t[0], steps, domain.warp), cubeComponent(t[1], steps, domain.warp), cubeComponent(t[2], steps, domain.warp)]);
}

/** The window of a leaf side `sigma` (+-1): longitudes in (sigma pi / 2 - pi, sigma pi / 2 + pi]; returns lon + 2 pi n. */
export function unwrapToSide(lon: number, sigma: number): { lon: number; n: number } {
  const lo = sigma * HALF_PI - Math.PI;
  const n = Math.floor((lo - lon) / TWO_PI) + 1;
  return { lon: lon + TWO_PI * n, n };
}

/**
 * One frame: the camera in the bent frame, the lattice anchor of its unbent position, and every anchor value of P2 in
 * doubles. `steps` is the lattice size of the selector's patch cells; `anchorOut` is reused when given.
 */
export function computeMorphFrame(view: MorphView, domain: LodDomain, steps: number, anchorOut: LatticeAnchor = newAnchor()): MorphFrame {
  const { radiusM: R, morph, pose } = view;
  const p = morph;
  const k = (1 - morph) / R;
  const basis = projectionBasis(view.centreLonDeg, view.centreLatDeg);
  const lambdaC = pose.lonDeg * DEG;
  const phiC = pose.latDeg * DEG;
  const heightC = view.groundHeightM + pose.altitudeM;

  // The unbent camera: what the selector and the lattice anchor see.
  const unitC = directionOf(basis, lambdaC, phiC);
  const selectorCamera: Vec3 = [unitC[0] * (R + heightC), unitC[1] * (R + heightC), unitC[2] * (R + heightC)];
  const anchor = anchorFor(domain, selectorCamera, steps, anchorOut);

  // The bent camera: its projected map point, its altitude along the bent up.
  const [xc, yc] = blendedProjection(lambdaC, phiC, p, R);
  const camBent = bend(xc, yc, k, heightC);
  const camMap: Vec3 = [camBent.position[0], camBent.position[1], camBent.position[2]];
  const shift = (1 - morph) * R;
  const camBody = mapVectorToBody(basis, [camMap[0], camMap[1], camMap[2] + shift]);

  // The camera axes from the bent east / north / up.
  const frameC = bendFrame(xc, yc, k);
  const ch = Math.cos(pose.headingDeg * DEG);
  const sh = Math.sin(pose.headingDeg * DEG);
  const cp = Math.cos(pose.pitchDeg * DEG);
  const sp = Math.sin(pose.pitchDeg * DEG);
  const forwardMap: Vec3 = [0, 1, 2].map((i) => cp * (ch * frameC.north[i] + sh * frameC.east[i]) + sp * frameC.up[i]) as Vec3;
  const rightMap: Vec3 = [0, 1, 2].map((i) => ch * frameC.east[i] - sh * frameC.north[i]) as Vec3;
  const upMap = cross(rightMap, forwardMap);
  const axes = { right: mapVectorToBody(basis, rightMap), up: mapVectorToBody(basis, upMap), forward: mapVectorToBody(basis, forwardMap) };

  // The anchor direction: the lattice anchor's float cube point, normalised (the shader's own anchor).
  const anchorDir = normalised(anchor.cube);
  const sA = dot(anchorDir, basis.up);
  const v1 = dot(anchorDir, basis.forward);
  const v2 = dot(anchorDir, basis.right);
  const cA = Math.hypot(v1, v2);
  const lam0 = Math.atan2(v2, v1);
  const lamA = lam0 + TWO_PI * Math.round((lambdaC - lam0) / TWO_PI);
  const phiA = Math.atan2(sA, cA);
  const omsA = sA >= 0 ? (cA * cA) / (1 + sA) : 1 - sA;
  const opsA = sA <= 0 ? (cA * cA) / (1 - sA) : 1 + sA;

  // Equal Earth at the anchor.
  const uA = EE.M * sA;
  const thA = Math.asin(uA);
  const cosThA = Math.sqrt(1 - uA * uA);
  const tA = thA * thA;
  const t3 = tA * tA * tA;
  const t4 = t3 * tA;
  const QA = EE.A1 + EE.A2 * tA + EE.A3 * t3 + EE.A4 * t4;
  const BA = EE.M * (EE.A1 + 3 * EE.A2 * tA + 7 * EE.A3 * t3 + 9 * EE.A4 * t4);
  const gA = 1 - p + (p * cosThA) / BA;

  // The anchor's map point and the bend there.
  const [xA, yA] = blendedProjection(lamA, phiA, p, R);
  const aA = k * xA;
  const bA = k * yA;
  const groundA = bend(xA, yA, k, 0);
  const garel: Vec3 = [groundA.position[0] - camMap[0], groundA.position[1] - camMap[1], groundA.position[2] - camMap[2]];

  const values: MorphAnchor<number> = {
    bRight: basis.right, bUp: basis.up, bForward: basis.forward,
    p, radius: R, k,
    sA, cA, omsA, opsA, vA1: v1, vA2: v2, nA2: v1 * v1 + v2 * v2, lamA,
    thA, tA, uA, cosThA, QA, BA, gA,
    sinAA: Math.sin(aA), cosAA: Math.cos(aA), sinBA: Math.sin(bA), cosBA: Math.cos(bA),
    upA: [groundA.normal[0], groundA.normal[1], groundA.normal[2]],
    garel,
  };
  const naive: NaiveFrame<number> = {
    bRight: basis.right, bUp: basis.up, bForward: basis.forward, p, radius: R, k, zShift: shift, camBody,
  };
  const outline = outlineOf(lamA, yA, p, R);
  const poles = polarLatticeVectors(basis, domain, steps);
  return { view, basis, k, lambdaC, phiC, selectorCamera, camMap, camBody, axes, anchor, anchorDir, values, naive, outline, poles };
}

/**
 * The anchor's distances to the map's edges in doubles: `right[n]` = pi - lamA - 2 pi n and `left[n]` = pi + lamA + 2 pi n for the
 * unwrap integers n = -OUTLINE_WRAP ... OUTLINE_WRAP, and halfHeight -+ yA. The whole turns are subtracted here, where a double
 * keeps the small remainder, so that a camera 1.1 km from the cut hands the GPU a number near 1.7e-4, not a difference of two 6.28s.
 */
export function outlineOf(lamA: number, yA: number, p: number, radiusM: number): MorphOutline<number> {
  const halfHeight = blendedExtents(p, radiusM).halfHeight;
  const right: number[] = [];
  const left: number[] = [];
  for (let n = -OUTLINE_WRAP; n <= OUTLINE_WRAP; n++) {
    right.push(Math.PI - lamA - TWO_PI * n);
    left.push(Math.PI + lamA + TWO_PI * n);
  }
  return { right, left, top: halfHeight - yA, bottom: halfHeight + yA };
}

/** Signed distances (metres, inside positive) of a map point to the edges right, left, top, bottom, in doubles: the reference of the vertex stage's `outlineDistances`. */
export function outlineDistancesAt(lon: number, lat: number, p: number, radiusM: number): [number, number, number, number] {
  const [x, y] = blendedProjection(lon, lat, p, radiusM);
  const halfWidth = Math.PI * radiusM * (1 - p + p * equalEarthRow(lat).c);
  const halfHeight = blendedExtents(p, radiusM).halfHeight;
  return [halfWidth - x, halfWidth + x, halfHeight - y, halfHeight + y];
}

/**
 * The T vector of each of the basis' poles (up, down) when the pole is a lattice vertex of the given lattice size, so that a
 * vertex of the mesh sits on it exactly (the default projection centre puts both on face centres); else undefined.
 */
export function polarLatticeVectors(basis: MorphBasis, domain: LodDomain, steps: number): readonly [Vec3 | undefined, Vec3 | undefined] {
  const one = (sign: number): Vec3 | undefined => {
    const { face, s: a, t: b } = faceOfDirection(basis.up[0] * sign, basis.up[1] * sign, basis.up[2] * sign);
    const lattice = (c: number): number => (domain.warp === 'none' ? c * steps : (Math.atan(c) / (Math.PI / 4)) * steps);
    const ta = lattice(a);
    const tb = lattice(b);
    if (Math.abs(ta - Math.round(ta)) > 1e-6 || Math.abs(tb - Math.round(tb)) > 1e-6) return undefined;
    return cubeLattice(face, (Math.round(ta) + steps) / 2, (Math.round(tb) + steps) / 2, steps);
  };
  return [one(1), one(-1)];
}

/** A vertex's reference position (doubles) and where it sits in the projection. */
export interface ReferenceVertex {
  /** Camera-relative position, body frame. */
  readonly rel: Vec3;
  /** Longitude (in the leaf's side window) and latitude in the projection basis, radians. */
  readonly lon: number;
  readonly lat: number;
  /** The vertex stage's unwrap integer: turns added to the longitude continued from the anchor's. */
  readonly n: number;
}

/**
 * The reference position of the vertex at unit direction `unit` (doubles), on the side `sigma`, at `height` above the base
 * surface: lon, lat in the basis, `blendedProjection`, `bend` of the map point with the given height, minus the bent camera.
 * `poleLon` is given for the exact pole vertex, which has no longitude of its own: the vertex stage places it at its leaf's centre
 * longitude (`poleVertexLongitude`), already inside the side's window, and the reference does the same. `leafLon` is the leaf's centre
 * longitude: the other vertices are placed within pi of it.
 */
export function referenceVertex(frame: MorphFrame, unit: Vec3, sigma: number, height: number, poleLon?: number, leafLon?: number): ReferenceVertex {
  const { basis, view } = frame;
  const v1 = dot(unit, basis.forward);
  const v2 = dot(unit, basis.right);
  const lat = Math.atan2(dot(unit, basis.up), Math.hypot(v1, v2));
  const principal = Math.atan2(v2, v1);
  // `leafLon` places the vertex within pi of the leaf's own centre longitude (the vertex stage's placement); without it the side's window does.
  let side: { lon: number; n: number };
  if (poleLon !== undefined) side = { lon: poleLon, n: 0 };
  else if (leafLon !== undefined) {
    const turns = Math.round((leafLon - principal) / TWO_PI);
    side = { lon: principal + TWO_PI * turns, n: turns };
  } else side = unwrapToSide(principal, sigma);
  // The vertex stage continues the longitude from the anchor's (unwrapped near the camera), so its integer counts the turns
  // added on top of that continuation: the window's turns from the principal longitude, minus the continuation's.
  const continuation = poleLon === undefined ? Math.round((frame.values.lamA - principal) / TWO_PI) : 0;
  const [x, y] = blendedProjection(side.lon, lat, view.morph, view.radiusM);
  const bent = bend(x, y, frame.k, height).position;
  const relMap = [bent[0] - frame.camMap[0], bent[1] - frame.camMap[1], bent[2] - frame.camMap[2]];
  return { rel: mapVectorToBody(basis, relMap), lon: side.lon, lat, n: side.n - continuation };
}

/** The side (+-1) a leaf takes from the longitude of its centre in the projection basis. */
export function leafSide(basis: MorphBasis, unitCentre: Vec3): 1 | -1 {
  return Math.atan2(dot(unitCentre, basis.right), dot(unitCentre, basis.forward)) >= 0 ? 1 : -1;
}
