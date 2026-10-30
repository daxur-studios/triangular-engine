import {
  LEAF_STRIDE,
  faceOfDirection,
  latticeSteps,
  maxLevelFor,
  type LodDomain,
  type LodSelector,
  type PatchCells,
  type Vec3,
} from 'triangular-engine/lod-surface/core';
import { latticeDirection, unwrapToSide, type MorphBasis } from './morph-frame';

/**
 * Plan 059 morph spike, part 2, the CPU half of the cut: which leaves reach the map's cut, how they are packed (one instance
 * per leaf, two for a leaf that reaches the cut) and which longitude the pole vertex of a leaf takes. All in doubles, from
 * the leaf's exact lattice corners; nothing here depends on the camera.
 *
 * The cut is the meridian opposite the projection centre (longitude +-pi in the projection basis). A leaf is drawn on one
 * side of the map: its side sigma (+1 or -1, `leafSide`) fixes a window of longitudes (sigma pi / 2 - pi, sigma pi / 2 + pi]
 * that its vertices are unwrapped into. A leaf that crosses the cut has vertices on both sides of it, and the one window
 * puts the far ones beyond the map's edge (x past +-W): drawn once the leaf covers one side of the cut and leaves the other
 * side empty. Drawn twice, once per window, each copy covers its side and hangs over the edge, and the outline clip of the
 * fragment stage (`outlineDistances`) takes the overhang off.
 */

const TWO_PI = 2 * Math.PI;

/** Relative and absolute margin (radians) added to a leaf's longitude span before it is tested against the cut. */
export const CUT_MARGIN_REL = 0.1;
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
 * edge midpoints and its centre, takes their longitudes around the centre's, and adds a margin of `CUT_MARGIN_REL` of the span
 * (plus `CUT_MARGIN_ABS`) on both ends. A leaf within `POLE_CAP_FACTOR` of a pole of the basis counts as reaching the cut: its
 * longitudes run through everything and no window holds it.
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

/** The pole's lattice position (u, v: lattice units on its face) for each pole of the basis that lies on `face`. */
function poleLattices(basis: MorphBasis, steps: number, face: number, warp: LodDomain['warp']): { u: number; v: number }[] {
  const out: { u: number; v: number }[] = [];
  for (const sign of [1, -1]) {
    const pole = faceOfDirection(basis.up[0] * sign, basis.up[1] * sign, basis.up[2] * sign);
    if (pole.face !== face) continue;
    const lattice = (c: number): number => (warp === 'none' ? c * steps : (Math.atan(c) / (Math.PI / 4)) * steps);
    out.push({ u: (lattice(pole.s) + steps) / 2, v: (lattice(pole.t) + steps) / 2 });
  }
  return out;
}

/** A corner of a leaf's grid: 0 is the low end of the axis, 1 the high end. */
export interface PoleCorner {
  readonly cx: 0 | 1;
  readonly cy: 0 | 1;
}

/**
 * The corner of the leaf at which a pole of the basis sits (within `TORN_EDGE_REL` of the span), if any. The two edges that meet at
 * the pole run along meridians, so every vertex of one edge has the same longitude: that is what the pole corner's copies take
 * (see `edgeLongitudes`).
 */
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
 * The longitudes of the two meridian edges that meet at a leaf's pole corner, placed within pi of `leafLon` (the leaf's centre
 * longitude in its side's window, as its other vertices are): `x` for the edge along the grid's x axis, `y` for the one along y.
 */
export function edgeLongitudes(
  basis: MorphBasis, domain: LodDomain, steps: number, face: number, u0: number, v0: number, span: number, corner: PoleCorner, leafLon: number,
): { x: number; y: number } {
  const vEdge = v0 + corner.cy * span;
  const uEdge = u0 + corner.cx * span;
  const near = (lon: number): number => lon + TWO_PI * Math.round((leafLon - lon) / TWO_PI);
  return {
    x: near(longitudeOf(basis, latticeDirection(face, u0 + span / 2, vEdge, steps, domain))),
    y: near(longitudeOf(basis, latticeDirection(face, uEdge, v0 + span / 2, steps, domain))),
  };
}

/**
 * Whether the leaf is torn even when its vertices are placed continuously around its own centre longitude: only a leaf with a pole
 * of the basis strictly inside it is, because its longitudes then run through everything and no placement around the centre holds
 * them. A pole on the leaf's boundary (the four leaves that share a pole at a lattice vertex, the default projection centre) leaves
 * the leaf a quarter or a half of the map wide and is not torn. The pole's lattice position is taken from `faceOfDirection`; a pole
 * within `TORN_EDGE_REL` of the leaf's span of a boundary counts as on it.
 */
export function leafTorn(basis: MorphBasis, steps: number, face: number, u0: number, v0: number, span: number, warp: LodDomain['warp'] = 'equal-angle'): boolean {
  const eps = TORN_EDGE_REL * span;
  for (const { u, v } of poleLattices(basis, steps, face, warp)) {
    if (u > u0 + eps && u < u0 + span - eps && v > v0 + eps && v < v0 + span - eps) return true;
  }
  return false;
}

/** What one pack of the selector's leaves produced. */
export interface MorphPack {
  /** Instances written (leaves plus duplicates, minus any dropped for capacity). */
  readonly instances: number;
  /** The selector's leaves taken. */
  readonly leaves: number;
  /** Second instances written for leaves that reach the cut (morph > 0 only). */
  readonly duplicates: number;
  /** Leaves with a pole of the basis in their bounding cap. */
  readonly poleLeaves: number;
  /** Instances of leaves with a pole strictly inside (see {@link leafTorn}): their `aInfo.z` carries magnitude 2 so the fragment stage can drop the triangles that cross the leaf's antipodal meridian. */
  readonly torn: number;
  /** Instances that did not fit in the capacity. */
  readonly dropped: number;
}

/** Slack instances: the most a view can add by duplication is one per leaf, so the instance capacity is twice the leaf capacity. */
export function instanceCapacity(leafCapacity: number): number {
  return 2 * leafCapacity;
}

/**
 * `packLeaves` of the library with the morph spike's two additions. `leafData` as U0, V0, lattice step per cell, face;
 * `infoData` as level, edge mask, side (+-1; +-2 for a torn leaf, see {@link leafTorn}), leaf longitude (the leaf's centre longitude
 * unwrapped into the side's window: the vertices are placed continuously around it, and the pole vertex takes it). `capData`
 * (optional) as the longitudes of the x and y edge that meet at the leaf's pole corner and the corner (0 or 1 per axis, -1 when the
 * leaf has no pole corner): the pole corner's copies take them (`gridGeometry`).
 * At morph 0 each leaf is one instance on the side of its centre; above 0 a leaf that reaches the cut is two, one per side
 * (`duplicate` false keeps one: the precision probe of part 1 compares vertices, not coverage).
 */
export function packMorphLeaves(
  selector: LodSelector, domain: LodDomain, patchCells: PatchCells, capacity: number, basis: MorphBasis, morph: number,
  leafData: Float32Array, infoData: Float32Array, duplicate = true, capData?: Float32Array,
): MorphPack {
  const maxLevel = maxLevelFor(patchCells);
  const steps = latticeSteps(patchCells, maxLevel);
  const leafCount = Math.min(selector.stats.drawn, capacity);
  const { leaves, masks, level, i, j, root } = selector;
  let instances = 0;
  let duplicates = 0;
  let poleLeaves = 0;
  let torn = 0;
  let dropped = 0;
  const emit = (k: number, node: number, u0: number, v0: number, step: number, sigma: number, poleLon: number, cap?: readonly [number, number, number, number]): void => {
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
    infoData[o + 3] = poleLon;
    if (capData) {
      capData[o] = cap ? cap[0] : 0;
      capData[o + 1] = cap ? cap[1] : 0;
      capData[o + 2] = cap ? cap[2] : -1;
      capData[o + 3] = cap ? cap[3] : -1;
    }
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
      const sigma = longitudeOf(basis, centre) >= 0 ? 1 : -1;
      emit(k, node, u0, v0, step, sigma, 0);
      continue;
    }
    const a = analyseLeaf(basis, domain, steps, face, u0, v0, span);
    if (a.containsPole) poleLeaves++;
    const sides: number[] = a.reachesCut && duplicate ? [1, -1] : [a.side];
    if (sides.length === 2) duplicates++;
    for (const sigma of sides) {
      const isTorn = leafTorn(basis, steps, face, u0, v0, span, domain.warp);
      if (isTorn) torn++;
      const leafLon = poleVertexLongitude(basis, a.centre, sigma);
      const corner = leafPoleCorner(basis, steps, face, u0, v0, span, domain.warp);
      const edges = corner ? edgeLongitudes(basis, domain, steps, face, u0, v0, span, corner, leafLon) : undefined;
      emit(k, node, u0, v0, step, isTorn ? 2 * sigma : sigma, leafLon, edges && corner ? [edges.x, edges.y, corner.cx, corner.cy] : undefined);
    }
  }
  return { instances, leaves: leafCount, duplicates, poleLeaves, torn, dropped };
}

/** Whether a leaf at the packed `sigma` sits in a window that holds longitude `lon` (a helper for the specs): `lon` unwrapped lies in the window. */
export function inWindow(lon: number, sigma: number): boolean {
  const lo = (sigma * Math.PI) / 2 - Math.PI;
  return lon > lo && lon <= lo + TWO_PI;
}
