/* eslint-disable @typescript-eslint/no-explicit-any */
import { Vector3 } from 'three';
import { abs, asin, atan, cos, dot, float, floor, max, min, select, sin, sqrt, uniform, vec3, vec4 } from 'three/tsl';
import type { LodDomain } from './lod-domain';
import { latticeSteps } from './lod-lattice';
import type { MorphFrame } from './lod-morph-frame';
import {
  ANCHOR_SCALAR_KEYS,
  ANCHOR_VECTOR_KEYS,
  OUTLINE_WRAP,
  atan2R,
  latticeOffset,
  outlineDistances,
  p2Position,
  type MorphAnchor,
  type MorphLattice,
  type MorphLib,
  type MorphOutline,
  type P2Result,
} from './lod-morph-math';
import { maxLevelFor, type PatchCells } from './lod-selector';

/**
 * Plan 059, step G6b: the GPU side of the morph, TSL nodes over {@link MorphLib} (`lod-morph-math.ts`). It builds the vertex
 * stage's morph part for `createLodSurfaceMesh` (option `morph`): the pole lattice stage, P2 and the outline distances, all reading
 * uniforms the CPU sets once per frame ({@link MorphStage.setFrame}). No recompile happens when the morph, the projection or the
 * centre change.
 */

/** The math library over TSL nodes. */
export const MORPH_TSL_LIB: MorphLib = {
  c: (x) => float(x),
  sqrt: (a) => sqrt(a),
  abs: (a) => abs(a),
  sin: (a) => sin(a),
  cos: (a) => cos(a),
  asin: (a) => asin(a),
  atan2: (y, x) => atan(y, x),
  floor: (a) => floor(a),
  min: (a, b) => min(a, b),
  max: (a, b) => max(a, b),
  lt: (a, b) => a.lessThan(b),
  select: (c, a, b) => select(c, a, b),
};

/** Longitude difference (radians) between a torn leaf's interpolated and true fragment longitude beyond which the fragment is discarded. */
export const TORN_LON_MISMATCH = 0.25;
/** A distance to the top or bottom edge below zero by more than this share of the radius is outside (the y clip is a safety net; y never passes the half-height in exact arithmetic). */
export const TOP_BOTTOM_TOLERANCE_REL = 1e-6;
/** Distance reported when nothing is clipped, and the pole lattice vector of a pole that is not a lattice vertex. */
export const MORPH_FAR = 1e30;

const asVec = (u: any): [any, any, any] => [u.x, u.y, u.z];
const toVec3 = (v: readonly [any, any, any]): any => vec3(v[0], v[1], v[2]);

/** What the stage builds for one vertex. */
export interface MorphStageNodes {
  /** The bent position relative to the bent camera, body frame, with the height already along the bend's up (vec3). Meaningful at morph above 0 only. */
  readonly rel: any;
  /** The P2 result, for specs and for a pole fan (G6d) that builds on the same terms. */
  readonly p2: P2Result;
  /** Signed distances (metres, inside positive) of the vertex to the map's right, left, top and bottom edges (vec4); huge at morph 0. */
  readonly edges: any;
  /** The bend's unit up at the vertex, body frame (vec3). */
  readonly bentUp: any;
  /** 1 for a vertex of a torn leaf (a pole strictly inside it), else 0. */
  readonly torn: any;
}

/** The inputs of {@link MorphStage.vertex}. */
export interface MorphStageInput {
  /** The vertex's cube-lattice vector T (vec3 node, exact integers). */
  readonly t: any;
  /** The injected-gap term of the lattice difference (vec3 node; adds 0 when the gap is 0). */
  readonly gapT: any;
  /** The vertex's unit direction minus the anchor's, from the library's lattice stage (vec3 node). */
  readonly du: any;
  /** `aInfo`: level, edge mask, side (+-1; +-2 for a torn leaf), leaf longitude. */
  readonly info: any;
  /** Height above the base surface, metres (node). */
  readonly height: any;
}

/** The morph part of the vertex stage and its per-frame uniforms. */
export interface MorphStage {
  /** The anchor values as nodes (what `p2Position` reads). */
  readonly anchor: MorphAnchor<any>;
  /** 1 while the morph is 0 (the mesh then draws today's position), else 0: a uniform node. */
  readonly atGlobe: any;
  /** Builds the nodes for a vertex. */
  vertex(input: MorphStageInput): MorphStageNodes;
  /**
   * The fragment check of a torn leaf: the longitude difference of the interpolated direction difference `du` placed within pi of
   * `leafLon` (the true one) against the interpolated vertex value `dlam`; true where they differ by more than {@link TORN_LON_MISMATCH}.
   */
  lonMismatch(dlam: any, du: any, leafLon: any): any;
  /** The fragment keep test: inside the four edges and not a torn-leaf triangle that crosses the leaf's antipodal meridian. */
  keepNode(edges: any, dlam: any, du: any, torn: any, leafLon: any): any;
  /** Writes a frame's uniforms and switches the stage on. */
  setFrame(frame: MorphFrame): void;
  /** Switches the stage off (morph 0): the mesh draws today's position. */
  setGlobe(): void;
}

/** Builds the stage for a sphere domain. `domain.sizeM` is the initial radius; the radius is a uniform. */
export function createMorphStage(domain: LodDomain, patchCells: PatchCells): MorphStage {
  const steps = latticeSteps(patchCells, maxLevelFor(patchCells));
  const lattice: MorphLattice = { steps, equalAngle: domain.warp === 'equal-angle' };
  const L = MORPH_TSL_LIB;
  const uAtGlobe = uniform(1) as any;
  const uPoleUp = uniform(new Vector3(MORPH_FAR, MORPH_FAR, MORPH_FAR)) as any;
  const uPoleDown = uniform(new Vector3(MORPH_FAR, MORPH_FAR, MORPH_FAR)) as any;
  const outlineUniforms: { right: any[]; left: any[]; top: any; bottom: any } = {
    right: Array.from({ length: 2 * OUTLINE_WRAP + 1 }, () => uniform(0)),
    left: Array.from({ length: 2 * OUTLINE_WRAP + 1 }, () => uniform(0)),
    top: uniform(0),
    bottom: uniform(0),
  };
  const scalarUniforms: Record<string, any> = {};
  const vectorUniforms: Record<string, any> = {};
  const A: Record<string, any> = {};
  for (const key of ANCHOR_SCALAR_KEYS) A[key] = scalarUniforms[key] = uniform(0);
  for (const key of ANCHOR_VECTOR_KEYS) {
    const node = (vectorUniforms[key] = uniform(new Vector3()));
    A[key] = asVec(node);
  }
  scalarUniforms['radius'].value = domain.sizeM;
  const anchor = A as unknown as MorphAnchor<any>;

  return {
    anchor,
    atGlobe: uAtGlobe,
    vertex({ t, gapT, du, info, height }) {
      const sigma = select(info.z.lessThan(0), float(-1), float(1));
      const torn = select(abs(info.z).greaterThan(1.5), float(1), float(0));
      // The pole stage: the lattice stage with the pole as its origin, from (T - hi) - lo (the pole's lattice vector in doubles from the CPU).
      const dTp = t.sub(vectorUniforms['poleHi']).sub(vectorUniforms['poleLo']).add(gapT);
      const fromPole = latticeOffset(L, lattice, asVec(t), asVec(dTp), {
        cube: anchor.poleCube, error: anchor.poleError, cos: anchor.poleCos,
      });
      // The exact pole vertex (a lattice vertex that is a pole of the basis) takes its leaf's own longitude, `info.w`.
      const onPole = (pole: any) => abs(t.x.sub(pole.x)).add(abs(t.y.sub(pole.y))).add(abs(t.z.sub(pole.z))).lessThan(0.5);
      const p2 = p2Position(L, anchor, asVec(du), fromPole.du, sigma, height, { is: onPole(uPoleUp).or(onPole(uPoleDown)), lon: info.w }, info.w);
      const outline: MorphOutline<any> = outlineUniforms;
      const d = outlineDistances(L, anchor, outline, p2);
      const edges = select(uAtGlobe.greaterThan(0.5), vec4(MORPH_FAR, MORPH_FAR, MORPH_FAR, MORPH_FAR), vec4(d[0], d[1], d[2], d[3]));
      return {
        rel: toVec3(p2.rel),
        p2,
        edges,
        bentUp: toVec3(p2.upBody),
        torn: select(uAtGlobe.greaterThan(0.5), float(0), torn),
      };
    },
    lonMismatch(dlam, du, leafLon) {
      // The same longitude formulas as p2Position, on the fragment's interpolated direction difference.
      const dv1 = dot(du, toVec3(anchor.bForward));
      const dv2 = dot(du, toVec3(anchor.bRight));
      const cross2 = anchor.vA1.mul(dv2).sub(anchor.vA2.mul(dv1));
      const dotv = anchor.nA2.add(anchor.vA1.mul(dv1)).add(anchor.vA2.mul(dv2));
      const raw = atan2R(L, cross2, dotv);
      const n = floor(leafLon.sub(Math.PI).sub(anchor.lamA.add(raw)).div(2 * Math.PI)).add(1);
      return abs(dlam.sub(raw.add(n.mul(2 * Math.PI)))).greaterThan(TORN_LON_MISMATCH);
    },
    keepNode(edges, dlam, du, torn, leafLon) {
      const tolerance = anchor.radius.mul(TOP_BOTTOM_TOLERANCE_REL);
      const crossing = torn.greaterThan(0.5).and(this.lonMismatch(dlam, du, leafLon));
      return edges.x.greaterThanEqual(0).and(edges.y.greaterThanEqual(0))
        .and(edges.z.greaterThanEqual(tolerance.negate())).and(edges.w.greaterThanEqual(tolerance.negate()))
        .and(crossing.not());
    },
    setFrame(frame) {
      const v = frame.values;
      for (const key of ANCHOR_SCALAR_KEYS) scalarUniforms[key].value = v[key];
      for (const key of ANCHOR_VECTOR_KEYS) (vectorUniforms[key].value as Vector3).set(...v[key]);
      const o = frame.outline;
      for (let i = 0; i < 2 * OUTLINE_WRAP + 1; i++) {
        outlineUniforms.right[i].value = o.right[i];
        outlineUniforms.left[i].value = o.left[i];
      }
      outlineUniforms.top.value = o.top;
      outlineUniforms.bottom.value = o.bottom;
      (uPoleUp.value as Vector3).set(...(frame.poles[0] ?? [MORPH_FAR, MORPH_FAR, MORPH_FAR]));
      (uPoleDown.value as Vector3).set(...(frame.poles[1] ?? [MORPH_FAR, MORPH_FAR, MORPH_FAR]));
      uAtGlobe.value = frame.map.morph > 0 ? 0 : 1;
    },
    setGlobe() {
      uAtGlobe.value = 1;
      scalarUniforms['poleOn'].value = 0;
    },
  };
}
