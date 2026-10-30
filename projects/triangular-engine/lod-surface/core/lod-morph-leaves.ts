import { faceOfDirection, type LodDomain, type Vec3 } from './lod-domain';
import { LEAF_STRIDE } from './lod-leaf-pack';
import { latticeSteps } from './lod-lattice';
import { latticeDirection, unwrapToSide, type MorphBasis } from './lod-morph-frame';
import { maxLevelFor, type LodSelector, type PatchCells } from './lod-selector';

/**
 * Plan 059, step G6b, the CPU half of the cut: which leaves reach the map's cut, how they are packed (one instance per leaf,
 * two for a leaf that reaches the cut) and which longitude the pole vertex of a leaf takes. All in doubles, from the leaf's exact
 * lattice corners; nothing here depends on the camera.
 *
 * The cut is the meridian opposite the projection centre (longitude +-pi in the projection basis). A leaf is drawn on one side
 * of the map: its side sigma (+1 or -1, {@link leafSide}) fixes a window of longitudes (sigma pi / 2 - pi, sigma pi / 2 + pi]
 * that its vertices are unwrapped into. A leaf that crosses the cut has vertices on both sides of it, and the one window puts the
 * far ones beyond the map's edge (x past +-W): drawn once, the leaf covers one side of the cut and leaves the other side empty.
 * Drawn twice, once per window, each copy covers its side and hangs over the edge, and the outline clip of the fragment stage
 * (`outlineDistances`) takes the overhang off.
 *
 * The pole fan (G6d) replaces the leaves that have a pole of the basis at a corner or inside them; {@link isPoleFanLeaf} says which,
 * and {@link packMorphLeaves} leaves them out when asked (`skipPoleLeaves`).
 */

const TWO_PI = 2 * Math.PI;

/** Relative margin added to a leaf's longitude span (share of the span) before it is tested against the cut. */
export const CUT_MARGIN_REL = 0.1;
/** Absolute margin (radians) added to a leaf's longitude span before it is tested against the cut. */
export const CUT_MARGIN_ABS = 1e-9;
/** A pole this close to a leaf's boundary (share of the span) is on it, not inside it. */
export const TORN_EDGE_REL = 1e-6;
/** A leaf counts as containing a pole when the pole is within this factor of the leaf's bounding cap (centre to farthest sample). */
export const POLE_CAP_FACTOR = 1.1;

/** What the cut test and the packer need to know about one leaf. */
export interface LeafAnalysis {
  /** Longitude of the leaf's centre in the projection basis, in (-pi, pi]. */
  readonly centreLon: number;
  /** The leaf's side by the sign of `centreLon`. */
  readonly side: 1 | -1;
  /** Longitude extent of the leaf around `centreLon` (samples wrapped to (-pi, pi] around the centre): lowest and highest. */
  readonly lo: number;
  readonly hi: number;
  /** The leaf's longitude range, with the margin, reaches +-pi. */
  readonly reachesCut: boolean;
  /** A pole of the basis lies within the leaf's bounding cap (its longitudes span everything). */
  readonly containsPole: boolean;
  /** The leaf's centre direction. */
  readonly centre: Vec3;
}

const dot = (a: readonly number[], b: readonly number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const wrapPi = (x: number): number => x - TWO_PI * Math.round(x / TWO_PI);

/** Longitude of a unit direction in the projection basis, (-pi, pi]. */
export function longitudeOf(basis: MorphBasis, unit: Vec3): number {
  return Math.atan2(dot(unit, basis.right), dot(unit, basis.forward));
}

/**
 * The longitude the pole vertex of a leaf takes: the leaf's own centre longitude, unwrapped into the window of side `sigma`.
 * The vertex stage substitutes it for the exact pole's meaningless longitude, so the vertex lands on the map's top or bottom
 * edge at the leaf's centre meridian.
 */
export function poleVertexLongitude(basis: MorphBasis, unitCentre: Vec3, sigma: number): number {
  return unwrapToSide(longitudeOf(basis, unitCentre), sigma).lon;
}

/**
 * Tests a leaf (face lattice origin `u0, v0`, `span` lattice units on a side) against the cut. Samples its four corners, four
 * edge midpoints and its centre, takes their longitudes around the centre's, and adds a margin of {@link CUT_MARGIN_REL} of the span
 * (plus {@link CUT_MARGIN_ABS}) on both ends. A leaf within {@link POLE_CAP_FACTOR} of a pole of the basis counts as reaching the cut:
 * its longitudes run through everything and no window holds it.
 */
export function analyseLeaf(basis: MorphBasis, domain: LodDomain, steps: number, face: number, u0: number, v0: number, span: number): LeafAnalysis {
  const samples: Vec3[] = [];
  for (let j = 0; j <= 2; j++) {
    for (let i = 0; i <= 2; i++) samples.push(latticeDirection(face, u0 + (span * i) / 2, v0 + (span * j) / 2, steps, domain));
  }
  const centre = samples[4];
  const centreLon = longitudeOf(basis, centre);
  let lo = 0;
  let hi = 0;
  let cap = 0;
  for (let k = 0; k < samples.length; k++) {
    if (k === 4) continue;
    const delta = wrapPi(longitudeOf(basis, samples[k]) - centreLon);
    lo = Math.min(lo, delta);
    hi = Math.max(hi, delta);
    cap = Math.max(cap, Math.hypot(samples[k][0] - centre[0], samples[k][1] - centre[1], samples[k][2] - centre[2]));
  }
  let containsPole = false;
  for (const sign of [1, -1]) {
    const pole: Vec3 = [basis.up[0] * sign, basis.up[1] * sign, basis.up[2] * sign];
    if (Math.hypot(pole[0] - centre[0], pole[1] - centre[1], pole[2] - centre[2]) <= cap * POLE_CAP_FACTOR + 1e-12) containsPole = true;
  }
  const margin = CUT_MARGIN_REL * (hi - lo) + CUT_MARGIN_ABS;
  const reachesCut = containsPole || centreLon + hi + margin >= Math.PI || centreLon + lo - margin <= -Math.PI;
  return { centreLon, side: centreLon >= 0 ? 1 : -1, lo, hi, reachesCut, containsPole, centre };
}

/** The pole's lattice position (u, v: lattice units on its face; `sign` +1 for the basis' up pole, -1 for the down pole) for each pole of the basis that lies on `face`. */
export function poleLattices(basis: MorphBasis, steps: number, face: number, warp: LodDomain['warp']): { u: number; v: number; sign: 1 | -1 }[] {
  const out: { u: number; v: number; sign: 1 | -1 }[] = [];
  for (const sign of [1, -1]) {
    const pole = faceOfDirection(basis.up[0] * sign, basis.up[1] * sign, basis.up[2] * sign);
    if (pole.face !== face) continue;
    const lattice = (c: number): number => (warp === 'none' ? c * steps : (Math.atan(c) / (Math.PI / 4)) * steps);
    out.push({ u: (lattice(pole.s) + steps) / 2, v: (lattice(pole.t) + steps) / 2, sign: sign as 1 | -1 });
  }
  return out;
}

/** A corner of a leaf's grid: 0 is the low end of the axis, 1 the high end. */
export interface PoleCorner {
  readonly cx: 0 | 1;
  readonly cy: 0 | 1;
}

/** The corner of the leaf at which a pole of the basis sits (within {@link TORN_EDGE_REL} of the span), if any. */
export function leafPoleCorner(basis: MorphBasis, steps: number, face: number, u0: number, v0: number, span: number, warp: LodDomain['warp'] = 'equal-angle'): PoleCorner | undefined {
  const eps = TORN_EDGE_REL * span;
  for (const { u, v } of poleLattices(basis, steps, face, warp)) {
    const cx = Math.abs(u - u0) <= eps ? 0 : Math.abs(u - (u0 + span)) <= eps ? 1 : -1;
    const cy = Math.abs(v - v0) <= eps ? 0 : Math.abs(v - (v0 + span)) <= eps ? 1 : -1;
    if (cx >= 0 && cy >= 0) return { cx: cx as 0 | 1, cy: cy as 0 | 1 };
  }
  return undefined;
}

/**
 * Whether the leaf is torn even when its vertices are placed continuously around its own centre longitude: only a leaf with a pole
 * of the basis strictly inside it is, because its longitudes then run through everything and no placement around the centre holds
 * them. A pole on the leaf's boundary (the four leaves that share a pole at a lattice vertex, the default projection centre) leaves
 * the leaf a quarter or a half of the map wide and is not torn.
 */
export function leafTorn(basis: MorphBasis, steps: number, face: number, u0: number, v0: number, span: number, warp: LodDomain['warp'] = 'equal-angle'): boolean {
  const eps = TORN_EDGE_REL * span;
  for (const { u, v } of poleLattices(basis, steps, face, warp)) {
    if (u > u0 + eps && u < u0 + span - eps && v > v0 + eps && v < v0 + span - eps) return true;
  }
  return false;
}

/** A leaf the pole fan (G6d) replaces: a pole of the basis at its corner or strictly inside it. */
export function isPoleFanLeaf(basis: MorphBasis, steps: number, face: number, u0: number, v0: number, span: number, warp: LodDomain['warp'] = 'equal-angle'): boolean {
  return leafPoleCorner(basis, steps, face, u0, v0, span, warp) !== undefined || leafTorn(basis, steps, face, u0, v0, span, warp);
}

/** What one pack of the selector's leaves produced. */
export interface MorphPack {
  /** Instances written (leaves plus duplicates, minus any dropped for capacity). */
  readonly instances: number;
  /** The selector's leaves taken. */
  readonly leaves: number;
  /** Second instances written for leaves that reach the cut. */
  readonly duplicates: number;
  /** Leaves with a pole of the basis in their bounding cap. */
  readonly poleLeaves: number;
  /** Instances of leaves with a pole strictly inside (see {@link leafTorn}): their `aInfo.z` carries magnitude 2 so the fragment stage can drop the triangles that cross the leaf's antipodal meridian. */
  readonly torn: number;
  /** Instances that did not fit in the capacity. */
  readonly dropped: number;
  /** With `skipPoleLeaves`: the pole leaves left out of the instances (a pole fan draws them). */
  readonly skipped?: number;
}

/**
 * Instance capacity for a leaf capacity: the most a view can add by duplication is one second instance per leaf, so the instance
 * capacity of a morph-capable mesh is twice the leaf capacity.
 */
export function instanceCapacity(leafCapacity: number): number {
  return 2 * leafCapacity;
}

/** What {@link packMorphLeaves} reads besides the selector. */
export interface MorphPackOptions {
  readonly domain: LodDomain;
  readonly patchCells: PatchCells;
  /** Instances the arrays hold. */
  readonly capacity: number;
  readonly basis: MorphBasis;
  /** Above 0 a leaf that reaches the cut is two instances (unless `duplicate` is false); at 0 every leaf is one, on the side of its centre. */
  readonly morph: number;
  /** False keeps one instance per leaf (precision probes compare vertices, not coverage). Default true. */
  readonly duplicate?: boolean;
  /** Leave out the leaves {@link isPoleFanLeaf} says a pole fan draws (G6d). Default false. */
  readonly skipPoleLeaves?: boolean;
}

/**
 * `packLeaves` with the morph's two additions. `leafData` as U0, V0, lattice step per cell, face; `infoData` as level, edge mask,
 * side (+-1; +-2 for a torn leaf, see {@link leafTorn}), leaf longitude (the leaf's centre longitude unwrapped into the side's
 * window: the vertices are placed continuously around it, and the pole vertex takes it). At morph 0 each leaf is one instance on the
 * side of its centre; above 0 a leaf that reaches the cut is two, one per side.
 */
export function packMorphLeaves(selector: LodSelector, options: MorphPackOptions, leafData: Float32Array, infoData: Float32Array): MorphPack {
  const { domain, patchCells, capacity, basis, morph } = options;
  const duplicate = options.duplicate ?? true;
  const skipPoleLeaves = options.skipPoleLeaves ?? false;
  const maxLevel = maxLevelFor(patchCells);
  const steps = latticeSteps(patchCells, maxLevel);
  const leafCount = Math.min(selector.stats.drawn, capacity);
  const { leaves, masks, level, i, j, root } = selector;
  let instances = 0;
  let duplicates = 0;
  let poleLeaves = 0;
  let torn = 0;
  let dropped = 0;
  let skipped = 0;
  const emit = (k: number, node: number, u0: number, v0: number, step: number, sigma: number, leafLon: number): void => {
    if (instances >= capacity) {
      dropped++;
      return;
    }
    const o = instances * LEAF_STRIDE;
    leafData[o] = u0;
    leafData[o + 1] = v0;
    leafData[o + 2] = step;
    leafData[o + 3] = root[node];
    infoData[o] = level[node];
    infoData[o + 1] = masks[k];
    infoData[o + 2] = sigma;
    infoData[o + 3] = leafLon;
    instances++;
  };
  for (let k = 0; k < leafCount; k++) {
    const node = leaves[k];
    const step = 1 << (maxLevel - level[node]);
    const span = step * patchCells;
    const u0 = i[node] * span;
    const v0 = j[node] * span;
    const face = root[node];
    if (morph <= 0) {
      const centre = latticeDirection(face, u0 + span / 2, v0 + span / 2, steps, domain);
      emit(k, node, u0, v0, step, longitudeOf(basis, centre) >= 0 ? 1 : -1, 0);
      continue;
    }
    if (skipPoleLeaves && isPoleFanLeaf(basis, steps, face, u0, v0, span, domain.warp)) {
      skipped++;
      continue;
    }
    const a = analyseLeaf(basis, domain, steps, face, u0, v0, span);
    if (a.containsPole) poleLeaves++;
    const sides: number[] = a.reachesCut && duplicate ? [1, -1] : [a.side];
    if (sides.length === 2) duplicates++;
    const isTorn = leafTorn(basis, steps, face, u0, v0, span, domain.warp);
    for (const sigma of sides) {
      if (isTorn) torn++;
      emit(k, node, u0, v0, step, isTorn ? 2 * sigma : sigma, poleVertexLongitude(basis, a.centre, sigma));
    }
  }
  return { instances, leaves: leafCount, duplicates, poleLeaves, torn, dropped, ...(skipPoleLeaves ? { skipped } : {}) };
}

/** Whether longitude `lon` lies in the window of side `sigma` (a helper for the specs). */
export function inWindow(lon: number, sigma: number): boolean {
  const lo = (sigma * Math.PI) / 2 - Math.PI;
  return lon > lo && lon <= lo + TWO_PI;
}
