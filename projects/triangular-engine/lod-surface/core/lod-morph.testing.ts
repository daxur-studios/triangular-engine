import type { LodDomain, Vec3 } from './lod-domain';
import { cubeComponent, cubeLattice, latticeSteps } from './lod-lattice';
import {
  bendPoint, computeMorphFrame, createMorphMap, mapVectorToBody, poleOrigin, referenceVertex,
  type LodMorphSettings, type MorphFrame, type MorphMap, type MorphProjection,
} from './lod-morph-frame';
import {
  latticeOffset, liftAnchor, liftVector, p2Position, type MorphAnchor, type MorphLattice, type Num, type NumLib, type P2Result,
} from './lod-morph-math';
import { maxLevelFor, type PatchCells } from './lod-selector';

/**
 * Test helpers of the morph (Plan 059 G6b): scenarios (a map, a camera, a frame) and the vertex function evaluated over a number library,
 * the CPU twin of the vertex stage. Not shipped: nothing in the public API imports this.
 */

export const TEST_PATCH: PatchCells = 16;
export const TEST_STEPS = latticeSteps(TEST_PATCH, maxLevelFor(TEST_PATCH));
export const sphereDomain = (radiusM: number): LodDomain => ({ kind: 'sphere', sizeM: radiusM, warp: 'equal-angle' });

/** A morph map of a sphere of `radiusM`. */
export function testMap(radiusM: number, morph: number, projection: MorphProjection = 'equal-earth', centreLonDeg = 0, centreLatDeg = 0): MorphMap {
  const settings: LodMorphSettings = { morph, projection, projectionCentre: { lonDeg: centreLonDeg, latDeg: centreLatDeg } };
  return createMorphMap(settings, radiusM);
}

/** The scene position of the bent camera at projected `lon`/`lat` (radians) and `height` metres above the surface. */
export function sceneCameraAt(map: MorphMap, lon: number, lat: number, height: number): Vec3 {
  const x = map.radius * lon * (map.wLin + map.wEE * rowC(lat, map));
  const y = map.radius * (map.wLin * lat + map.wEE * rowY(lat));
  const p = bendPoint(x, y, map.k, height).position;
  return mapVectorToBody(map.basis, [p[0], p[1], p[2] + map.shift]) as Vec3;
}

const EE = { A1: 1.340264, A2: -0.081106, A3: 0.000893, A4: 0.003796, M: Math.sqrt(3) / 2 };
function rowY(lat: number): number {
  const th = Math.asin(EE.M * Math.sin(lat));
  const t2 = th * th;
  const t6 = t2 * t2 * t2;
  return th * (EE.A1 + EE.A2 * t2 + t6 * (EE.A3 + EE.A4 * t2));
}
function rowC(lat: number, map: MorphMap): number {
  if (map.wEE === 0) return 0;
  const th = Math.asin(EE.M * Math.sin(lat));
  const t2 = th * th;
  const t6 = t2 * t2 * t2;
  return Math.cos(th) / (EE.M * (EE.A1 + 3 * EE.A2 * t2 + t6 * (7 * EE.A3 + 9 * EE.A4 * t2)));
}

/** The frame of a bent camera at scene position `camera`. */
export function testFrame(map: MorphMap, domain: LodDomain, camera: Vec3): MorphFrame {
  return computeMorphFrame(map, domain, TEST_STEPS, camera);
}

/** The cube-lattice vector T of lattice point (u, v) of `face`. */
export function latticeVector(face: number, u: number, v: number): Vec3 {
  return cubeLattice(face, u, v, TEST_STEPS);
}

/** Unit direction of cube-lattice vector T, in doubles. */
export function directionOfT(t: Vec3, domain: LodDomain): Vec3 {
  const c = t.map((x) => cubeComponent(x, TEST_STEPS, domain.warp));
  const l = Math.hypot(c[0], c[1], c[2]);
  return [c[0] / l, c[1] / l, c[2] / l];
}

/** What the vertex function gives for a vertex. */
export interface EvaluatedVertex {
  /** Camera-relative body-frame position. */
  readonly rel: [number, number, number];
  readonly p2: P2Result;
  /** True when the pole stage placed it. */
  readonly usedPole: boolean;
}

/** The anchor-side inputs of the vertex function lifted into a number library. */
export interface LiftedFrame {
  readonly A: MorphAnchor<Num>;
  readonly anchorOrigin: { cube: Num[]; error: Num[]; cos: Num[] };
  readonly poleOrigin: { cube: Num[]; error: Num[]; cos: Num[] };
  readonly anchorT: Num[];
  readonly poleHi: Num[];
  readonly poleLo: Num[];
}

export function liftFrame(lib: NumLib, frame: MorphFrame): LiftedFrame {
  const a = frame.anchor;
  const v = frame.values;
  return {
    A: liftAnchor(lib, v),
    anchorOrigin: { cube: [...liftVector(lib, a.cube)], error: [...liftVector(lib, a.error)], cos: [...liftVector(lib, a.cos)] },
    poleOrigin: { cube: [...liftVector(lib, v.poleCube)], error: [...liftVector(lib, v.poleError)], cos: [...liftVector(lib, v.poleCos)] },
    anchorT: [...liftVector(lib, a.t)],
    poleHi: [...liftVector(lib, v.poleHi)],
    poleLo: [...liftVector(lib, v.poleLo)],
  };
}

/**
 * The vertex function over a number library: the lattice stage from the anchor and from the pole, then P2. `t` is the vertex's exact
 * cube-lattice vector, `sigma` its side, `h` its height, `leafLon` its leaf's centre longitude (placement window); `poleLon` the
 * longitude the exact pole vertex takes (when `t` is a pole vertex).
 */
export function evaluateVertex(lib: NumLib, frame: MorphFrame, lifted: LiftedFrame, domain: LodDomain, t: Vec3, sigma: number, h: number, leafLon?: number, poleLon?: number): EvaluatedVertex {
  const lattice: MorphLattice = { steps: TEST_STEPS, equalAngle: domain.warp === 'equal-angle' };
  const tN = [...liftVector(lib, t)] as unknown as Num[];
  const dT = tN.map((x, k) => x.sub(lifted.anchorT[k]));
  const dTp = tN.map((x, k) => x.sub(lifted.poleHi[k]).sub(lifted.poleLo[k]));
  const fromAnchor = latticeOffset(lib, lattice, tN as never, dT as never, lifted.anchorOrigin as never);
  const fromPole = latticeOffset(lib, lattice, tN as never, dTp as never, lifted.poleOrigin as never);
  const isPole = frame.poles.some((p) => p !== undefined && p[0] === t[0] && p[1] === t[1] && p[2] === t[2]);
  const pole = { is: isPole, lon: lib.num(poleLon ?? leafLon ?? 0) };
  const p2 = p2Position(lib, lifted.A, fromAnchor.du, fromPole.du, lib.num(sigma), lib.num(h), pole, leafLon === undefined ? undefined : lib.num(leafLon));
  return { rel: [p2.rel[0].v, p2.rel[1].v, p2.rel[2].v], p2, usedPole: p2.usedPole.v > 0.5 };
}

/** The exact (doubles) camera-relative position of the vertex `t`, by the definition: lon/lat in the basis, the map, the bend. */
export function exactRel(frame: MorphFrame, domain: LodDomain, t: Vec3, sigma: number, h: number, leafLon?: number, poleLon?: number): [number, number, number] {
  const unit = directionOfT(t, domain);
  return [...referenceVertex(frame, unit, sigma, h, poleLon, leafLon).rel] as [number, number, number];
}

/** Metres of ground per lattice unit (`u` or `v`) on a sphere of `radiusM`. */
export const unitMetres = (radiusM: number): number => ((Math.PI / 2) * radiusM) / TEST_STEPS;

/**
 * Lattice vectors `T` of vertices about `metres` from the frame's anchor (on the anchor's face, clamped to it), one per bearing.
 * The anchor's face is the one whose axis component of `T` is +-L; one lattice unit moves `T` by 2 along a face axis.
 */
export function verticesAround(frame: MorphFrame, radiusM: number, metres: number, bearings = 6): Vec3[] {
  const a = frame.anchor.t;
  const axis = a.findIndex((x) => Math.abs(x) === TEST_STEPS);
  const others = [0, 1, 2].filter((i) => i !== axis);
  const units = metres / unitMetres(radiusM);
  const out: Vec3[] = [];
  for (let b = 0; b < bearings; b++) {
    const angle = (b * 2 * Math.PI) / bearings + 0.3;
    const t: Vec3 = [a[0], a[1], a[2]];
    const clamp = (x: number): number => Math.max(-TEST_STEPS, Math.min(TEST_STEPS, x));
    t[others[0]] = clamp(t[others[0]] + 2 * Math.round(units * Math.cos(angle)));
    t[others[1]] = clamp(t[others[1]] + 2 * Math.round(units * Math.sin(angle)));
    out.push(t);
  }
  return out;
}

/** The side (+1/-1) a vertex falls on: the sign of its longitude in the projection basis. */
export function sideOf(map: MorphMap, direction: Vec3): 1 | -1 {
  const lon = Math.atan2(direction[0] * map.basis.right[0] + direction[1] * map.basis.right[1] + direction[2] * map.basis.right[2], direction[0] * map.basis.forward[0] + direction[1] * map.basis.forward[1] + direction[2] * map.basis.forward[2]);
  return lon >= 0 ? 1 : -1;
}

export { poleOrigin };
