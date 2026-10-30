import type { LodDomain, LodSelector, PatchCells, Vec3 } from 'triangular-engine/lod-surface/core';
import { latticeSteps, maxLevelFor } from 'triangular-engine/lod-surface/core';
import { latticeDirection, type MorphBasis, type MorphFrame } from './morph-frame';
import { TORN_EDGE_REL, analyseLeaf, edgeLongitudes, leafPoleCorner, leafTorn, longitudeOf, poleLattices, poleVertexLongitude } from './morph-leaves';
import { bentLonLat, type StretchContext } from './morph-stretch';

/**
 * Plan 059 morph spike, iteration 4: the pole fan. The leaves that hold a pole of the projection (the pole is the map's whole top
 * or bottom edge, so a patch cell that touches it is stretched across a quarter or all of the map's width) are replaced by a mesh
 * built on the CPU in doubles in polar coordinates around the pole: rays are meridians (constant longitude, `rays` of them per
 * full turn), rings are fractions of the leaf's own reach along each ray (linear like the patch's cells towards the boundary,
 * geometric towards the pole), the innermost ring is the pole itself at each ray's longitude, i.e. the map's edge sampled at
 * 2 pi / rays. The outermost ring is the leaf's own boundary: the vertices of the leaf's edge samples (with the edge masks'
 * folding, the same as the vertex stage), and, for a ray that falls between two samples, the point on the chord between them, so the
 * boundary is the polyline the neighbours draw and no vertex leaves it. Positions are the exact morph map (`bentLonLat`).
 *
 * Two cases: a pole at a corner of the leaf (the projection centre 0, 0: four leaves share the pole at a lattice vertex): rays run
 * from one meridian edge to the other, the two meridian edges are the chains of the leaf's own edge samples; a pole strictly inside
 * the leaf (a tilted centre): rays run over the whole turn, longitude -pi to +pi, the first and last ray are the same meridian on
 * the map's left and right edge.
 *
 * Iteration 5 splits the build in two. {@link buildFanSpecs} makes the fan's topology and one {@link FAN_SPEC_STRIDE}-number
 * description per vertex, none of which depends on the camera, the morph or the height: a vertex is a point on the chord between
 * two grid vertices of its leaf (the boundary ring, the corner case's meridian edges), or a polar point (longitude, colatitude from
 * the pole). {@link placeFanSpecs} puts the descriptions in the bent body frame in doubles: that is the CPU fan (`buildPoleFan`) and
 * the reference of the vertex-stage fan (`morph-fan-vertex.ts`), which evaluates the same descriptions on the GPU with the anchor-relative P2.
 */

/** Rays per full turn offered by the page. */
export const FAN_RAY_OPTIONS: readonly number[] = [256, 1024, 4096];
export const FAN_DEFAULT_RAYS = 1024;
/** The innermost ring that is not the pole is about this far from it (metres). */
const FAN_MIN_RING_M = 1;
const FAN_MIN_GEOMETRIC = 3;
const FAN_MAX_GEOMETRIC = 26;
const TWO_PI = 2 * Math.PI;
const HALF_PI = Math.PI / 2;

/** Which fan the surface draws: the CPU-built positions (rebuilt for the camera) or the vertex-stage fan (positions evaluated on the GPU). */
export type FanMode = 'cpu' | 'vertex';
export const FAN_MODES: readonly FanMode[] = ['cpu', 'vertex'];

/** What a fan build cost and produced. */
export interface FanStats {
  /** Pole leaves replaced, and how many of them had the pole at a corner or inside. */
  readonly leaves: number;
  readonly corner: number;
  readonly interior: number;
  /** Rays per full turn requested. */
  readonly rays: number;
  readonly vertices: number;
  readonly triangles: number;
  /** CPU milliseconds of the build (the fan geometry in doubles and the Float32 pack). */
  readonly buildMs: number;
  /** Which fan this is (absent: the CPU fan of iteration 4). */
  readonly mode?: FanMode;
  /** Builds of this surface's fan since it was created (the vertex-stage fan must not rebuild for a camera or morph change). */
  readonly rebuilds?: number;
}

/** A fan built for one camera: positions relative to `origin` (the bent camera at build time). */
export interface FanBuild {
  readonly positions: Float32Array;
  readonly index: Uint32Array;
  readonly origin: Vec3;
  /** Distance from the origin to the nearest vertex (metres): how far the camera may move before the Float32 positions are rebuilt. */
  readonly nearestM: number;
  readonly stats: FanStats;
  /** Each fan leaf's grid: its first vertex, rays and rings (ray j, ring r is vertex `first + j * rings + r`; ring 0 is the boundary, the last ring the pole). */
  readonly layout: readonly { readonly first: number; readonly rays: number; readonly rings: number }[];
}

/** Where a pole of the basis sits in a leaf. */
export interface FanPole {
  readonly kind: 'corner' | 'interior';
  /** +1: the basis' up pole; -1: the down pole. */
  readonly sign: 1 | -1;
  readonly cx?: 0 | 1;
  readonly cy?: 0 | 1;
}

/** The pole a leaf replaced by the fan holds at a corner or strictly inside, if any (the same leaves as `leafPoleCorner` and `leafTorn`). */
export function fanLeafPole(basis: StretchContext['basis'], steps: number, face: number, u0: number, v0: number, span: number, warp: LodDomain['warp'] = 'equal-angle'): FanPole | undefined {
  const eps = TORN_EDGE_REL * span;
  for (const { u, v, sign } of poleLattices(basis, steps, face, warp)) {
    const cx = Math.abs(u - u0) <= eps ? 0 : Math.abs(u - (u0 + span)) <= eps ? 1 : -1;
    const cy = Math.abs(v - v0) <= eps ? 0 : Math.abs(v - (v0 + span)) <= eps ? 1 : -1;
    if (cx >= 0 && cy >= 0) return { kind: 'corner', sign, cx: cx as 0 | 1, cy: cy as 0 | 1 };
    if (u > u0 + eps && u < u0 + span - eps && v > v0 + eps && v < v0 + span - eps) return { kind: 'interior', sign };
  }
  return undefined;
}

const dot = (a: readonly number[], b: readonly number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const lerp3 = (a: Vec3, b: Vec3, w: number): Vec3 => [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w];

/** The ring fractions from the boundary (1) to the pole (0): linear like the cells down to a half, then geometric. */
export function ringFractions(patchCells: number, colatMax: number, radiusM: number): number[] {
  const fractions: number[] = [];
  for (let q = 0; q <= patchCells / 2; q++) fractions.push(1 - q / patchCells);
  const reach = Math.max(2, (colatMax * radiusM) / FAN_MIN_RING_M);
  const geometric = Math.min(FAN_MAX_GEOMETRIC, Math.max(FAN_MIN_GEOMETRIC, Math.ceil(Math.log2(reach)) - 1));
  for (let m = 1; m <= geometric; m++) fractions.push(0.5 * 2 ** -m);
  fractions.push(0);
  return fractions;
}

// -- the fan's leaves ---------------------------------------------------------------------------------------------------

/** A leaf the fan replaces, with what the vertex stage would have been given for it as an instance (`packMorphLeaves`). */
export interface FanLeaf {
  readonly face: number;
  readonly level: number;
  /** The leaf's lattice origin, its span in lattice units and the lattice step of one cell. */
  readonly u0: number;
  readonly v0: number;
  readonly span: number;
  readonly step: number;
  /** The leaf's edge mask (bit e set: the neighbour across edge e is coarser). */
  readonly mask: number;
  readonly pole: FanPole;
  /** +-1 by the sign of the leaf's centre longitude, +-2 for a leaf with the pole strictly inside it (the packed `aInfo.z`). */
  readonly side: number;
  /** The leaf's centre longitude placed in its side's window (the packed `aInfo.w`). */
  readonly leafLon: number;
  /** A pole corner: the longitudes of the x and y meridian edges and the corner (the packed `aCap`); undefined for an interior pole. */
  readonly cap?: readonly [number, number, number, number];
}

/** The pole leaves of the selector's drawn leaves (those `packMorphLeaves` leaves out with `skipPoleLeaves`), in the selector's order. */
export function fanLeavesOf(selector: LodSelector, domain: LodDomain, patchCells: PatchCells, leafCapacity: number, basis: MorphBasis): FanLeaf[] {
  const maxLevel = maxLevelFor(patchCells);
  const steps = latticeSteps(patchCells, maxLevel);
  const { leaves, masks, level, i, j, root } = selector;
  const count = Math.min(selector.stats.drawn, leafCapacity);
  const out: FanLeaf[] = [];
  for (let k = 0; k < count; k++) {
    const node = leaves[k];
    const step = 1 << (maxLevel - level[node]);
    const span = step * patchCells;
    const u0 = i[node] * span;
    const v0 = j[node] * span;
    const face = root[node];
    const pole = fanLeafPole(basis, steps, face, u0, v0, span, domain.warp);
    if (!pole) continue;
    const a = analyseLeaf(basis, domain, steps, face, u0, v0, span);
    const leafLon = poleVertexLongitude(basis, a.centre, a.side);
    const corner = leafPoleCorner(basis, steps, face, u0, v0, span, domain.warp);
    const edges = corner ? edgeLongitudes(basis, domain, steps, face, u0, v0, span, corner, leafLon) : undefined;
    const torn = leafTorn(basis, steps, face, u0, v0, span, domain.warp);
    out.push({
      face, level: level[node], u0, v0, span, step, mask: masks[k], pole, side: torn ? 2 * a.side : a.side, leafLon,
      ...(edges && corner ? { cap: [edges.x, edges.y, corner.cx, corner.cy] as const } : {}),
    });
  }
  return out;
}

/** A string that is the same for two fan leaf lists exactly when a fan built from them has the same topology and descriptions. */
export function fanLeafSignature(leaves: readonly FanLeaf[]): string {
  return leaves.map((l) => `${l.face}.${l.level}.${l.u0}.${l.v0}.${l.mask}.${l.pole.sign}`).join(';');
}

// -- the vertex descriptions --------------------------------------------------------------------------------------------

/** Numbers per vertex of {@link FanSpecs.data}. */
export const FAN_SPEC_STRIDE = 13;
/** Column indices of a vertex description. */
export const SPEC = {
  /** The fan leaf (index into {@link FanSpecs.leaves}). */
  LEAF: 0,
  /** 0: a point on the chord between two grid vertices; 1: a polar point. */
  KIND: 1,
  /** Chord: grid vertex A (unfolded) and the longitude it is placed near; likewise B. */
  GXA: 2,
  GYA: 3,
  REFA: 4,
  GXB: 5,
  GYB: 6,
  REFB: 7,
  /** Chord: the share of the way from A to B (0: A itself). */
  W: 8,
  /** Chord: the longitude the exact pole vertex takes where the chord runs along a meridian edge, NaN where it is the vertex stage's own choice. */
  POLE_LON: 9,
  /** Polar: longitude, angle from the leaf's pole (colatitude) and the pole's sign. */
  LON: 10,
  C: 11,
  SGN: 12,
} as const;

/** The fan's topology and per-vertex descriptions: nothing in it depends on the camera, the morph or the height. */
export interface FanSpecs {
  readonly leaves: readonly FanLeaf[];
  readonly data: Float64Array;
  readonly vertexCount: number;
  readonly index: Uint32Array;
  readonly layout: readonly { readonly first: number; readonly rays: number; readonly rings: number }[];
  readonly corner: number;
  readonly interior: number;
  readonly rays: number;
  /** CPU milliseconds the descriptions took. */
  readonly buildMs: number;
}

/** A grid vertex of a leaf and the longitude it is placed near. */
interface End {
  readonly gx: number;
  readonly gy: number;
  readonly ref: number;
}

/** A boundary sample in the order the rays sweep. */
interface Entry extends End {
  readonly u: number;
  readonly v: number;
  readonly lon: number;
  readonly colat: number;
}

/** One ray: its longitude, the chain entry it is (a ray at a boundary sample) or -1, and 1 or 2 for the corner case's two meridian edges. */
interface Ray {
  readonly lon: number;
  readonly sample: number;
  readonly edge: 0 | 1 | 2;
  readonly progress: number;
}

/** Writes the fan of one leaf's descriptions into `out` and its triangles into `index`; vertex numbers continue from `base`. */
function leafSpecs(
  ctx: StretchContext, leafIndex: number, leaf: FanLeaf, rays: number, base: number, out: number[], index: number[],
): { first: number; rays: number; rings: number } {
  const { basis, domain, steps, patchCells: pc } = ctx;
  const { face, u0, v0, span, pole } = leaf;
  const cell = span / pc;
  const sgn = pole.sign;
  const upS: Vec3 = [basis.up[0] * sgn, basis.up[1] * sgn, basis.up[2] * sgn];
  const unitAt = (u: number, v: number): Vec3 => latticeDirection(face, u, v, steps, domain);
  const colatOf = (unit: Vec3): number => Math.atan2(Math.hypot(dot(unit, basis.forward), dot(unit, basis.right)), dot(unit, upS));
  const near = (lon: number, ref: number): number => lon + TWO_PI * Math.round((ref - lon) / TWO_PI);
  const chord = (a: End, b: End, w: number, poleLon = NaN): void => {
    out.push(leafIndex, 0, a.gx, a.gy, a.ref, b.gx, b.gy, b.ref, w, poleLon, 0, 0, 0);
  };
  const polar = (lon: number, c: number): void => {
    out.push(leafIndex, 1, 0, 0, 0, 0, 0, 0, 0, NaN, lon, c, sgn);
  };
  const entryOf = (gx: number, gy: number, lon?: number, shift = 0): Entry => {
    const u = u0 + gx * cell;
    const v = v0 + gy * cell;
    const unit = unitAt(u, v);
    const own = lon ?? longitudeOf(basis, unit);
    return { gx, gy, u, v, lon: own + shift, colat: colatOf(unit), ref: own + shift };
  };

  let chain: Entry[];
  let rayList: Ray[];
  let edgeChains: [End[], End[]] | undefined;
  let edgeLon: { x: number; y: number } | undefined;
  if (pole.kind === 'corner') {
    const cx = pole.cx!;
    const cy = pole.cy!;
    const leafLon = leaf.leafLon;
    const edge = { x: leaf.cap![0], y: leaf.cap![1] };
    edgeLon = edge;
    const fx0 = (1 - cx) * pc;
    const fy0 = (1 - cy) * pc;
    const cells: [number, number][] = [];
    for (let t = 0; t <= pc; t++) cells.push([fx0, cy * pc + (cy === 0 ? t : -t)]);
    for (let t = 1; t <= pc; t++) cells.push([fx0 + (cx === 0 ? -t : t), fy0]);
    chain = cells.map(([gx, gy], k) => {
      const unit = unitAt(u0 + gx * cell, v0 + gy * cell);
      const lon = k === 0 ? edge.x : k === cells.length - 1 ? edge.y : near(longitudeOf(basis, unit), leafLon);
      return entryOf(gx, gy, lon);
    });
    const chainOf = (axis: 1 | 2): End[] => {
      const list: End[] = [];
      for (let k = 0; k <= pc; k++) {
        const gx = axis === 1 ? (cx === 0 ? k : pc - k) : cx * pc;
        const gy = axis === 1 ? cy * pc : cy === 0 ? k : pc - k;
        list.push({ gx, gy, ref: leafLon });
      }
      return list;
    };
    edgeChains = [chainOf(1), chainOf(2)];
    const span2 = edge.y - edge.x;
    const quarter = Math.max(2, Math.round((rays * Math.abs(span2)) / TWO_PI));
    const list: Ray[] = [];
    const sampleProgress: number[] = [];
    for (let k = 1; k < chain.length - 1; k++) {
      const progress = (chain[k].lon - edge.x) / span2;
      sampleProgress.push(progress);
      list.push({ lon: chain[k].lon, sample: k, edge: 0, progress });
    }
    for (let k = 0; k <= quarter; k++) {
      const progress = k / quarter;
      if (k > 0 && k < quarter && sampleProgress.some((p) => Math.abs(p - progress) < 1e-9)) continue;
      list.push({ lon: edge.x + span2 * progress, sample: -1, edge: k === 0 ? 1 : k === quarter ? 2 : 0, progress });
    }
    list.sort((a, b) => a.progress - b.progress);
    rayList = list;
  } else {
    const loop: [number, number][] = [];
    for (let g = 0; g < pc; g++) loop.push([g, 0]);
    for (let g = 0; g < pc; g++) loop.push([pc, g]);
    for (let g = 0; g < pc; g++) loop.push([pc - g, pc]);
    for (let g = 0; g < pc; g++) loop.push([0, pc - g]);
    const m = loop.length;
    const lons = loop.map(([gx, gy]) => longitudeOf(basis, unitAt(u0 + gx * cell, v0 + gy * cell)));
    let at = 0;
    for (let k = 1; k < m; k++) if (lons[k] < lons[at]) at = k;
    const direction = lons[(at + 1) % m] < lons[(at - 1 + m) % m] ? 1 : -1;
    const ordered: Entry[] = [];
    for (let k = 0; k < m; k++) {
      const [gx, gy] = loop[(at + direction * k + m * 2) % m];
      ordered.push(entryOf(gx, gy));
    }
    const first = ordered[0];
    const last = ordered[m - 1];
    chain = [entryOf(last.gx, last.gy, last.lon, -TWO_PI), ...ordered, entryOf(first.gx, first.gy, first.lon, TWO_PI)];
    const list: Ray[] = [];
    for (let k = 1; k <= m; k++) list.push({ lon: chain[k].lon, sample: k, edge: 0, progress: chain[k].lon });
    for (let k = 0; k <= rays; k++) {
      const lon = -Math.PI + (TWO_PI * k) / rays;
      list.push({ lon, sample: -1, edge: 0, progress: lon });
    }
    list.sort((a, b) => a.progress - b.progress);
    rayList = list;
  }

  const fs = ringFractions(pc, chain.reduce((acc, e) => Math.max(acc, e.colat), 0), ctx.radiusM);
  const ringCount = fs.length;
  const dir = chain[chain.length - 1].lon >= chain[0].lon ? 1 : -1;
  let at = 0;
  for (const ray of rayList) {
    if (ray.edge > 0 && edgeChains) {
      const chainE = edgeChains[ray.edge - 1];
      const poleLon = ray.edge === 1 ? edgeLon!.x : edgeLon!.y;
      for (let r = 0; r < ringCount; r++) {
        if (fs[r] === 0) chord(chainE[0], chainE[0], 0, poleLon);
        else {
          const s = fs[r] * pc;
          const i = Math.min(pc - 1, Math.floor(s));
          chord(chainE[i], chainE[i + 1], s - i, poleLon);
        }
      }
      continue;
    }
    let colat: number;
    if (ray.sample >= 0) {
      chord(chain[ray.sample], chain[ray.sample], 0);
      colat = chain[ray.sample].colat;
    } else {
      while (at < chain.length - 2 && (chain[at + 1].lon - ray.lon) * dir < 0) at++;
      const a = chain[at];
      const b = chain[at + 1];
      const gap = b.lon - a.lon;
      const w = gap === 0 ? 0 : Math.min(1, Math.max(0, (ray.lon - a.lon) / gap));
      chord(a, b, w);
      colat = colatOf(unitAt(a.u + (b.u - a.u) * w, a.v + (b.v - a.v) * w));
    }
    for (let r = 1; r < ringCount - 1; r++) polar(ray.lon, fs[r] * colat);
    polar(ray.lon, 0);
  }
  for (let j = 0; j < rayList.length - 1; j++) {
    for (let r = 0; r < ringCount - 1; r++) {
      const a = base + j * ringCount + r;
      const b = a + 1;
      const c = a + ringCount;
      const d = c + 1;
      index.push(a, b, d, a, d, c);
    }
  }
  return { first: base, rays: rayList.length, rings: ringCount };
}

/** The stretch context the fan's geometry is built in (the basis, radius and morph of the placement; the descriptions use the basis and radius only). */
export function fanContext(domain: LodDomain, patchCells: PatchCells, basis: MorphBasis, radiusM: number, morph: number): StretchContext {
  return { basis, domain, steps: latticeSteps(patchCells, maxLevelFor(patchCells)), patchCells, morph, radiusM, cellPixels: 0 };
}

/**
 * The fan's topology and vertex descriptions for the given pole leaves: rays per full turn `rays`, the leaves' own boundary samples
 * and the projection basis and radius of `ctx` (the morph of `ctx` is not used).
 */
export function buildFanSpecs(ctx: StretchContext, leaves: readonly FanLeaf[], rays: number): FanSpecs {
  const began = performance.now();
  const out: number[] = [];
  const index: number[] = [];
  const layout: { first: number; rays: number; rings: number }[] = [];
  let corner = 0;
  let interior = 0;
  leaves.forEach((leaf, k) => {
    if (leaf.pole.kind === 'corner') corner++;
    else interior++;
    layout.push(leafSpecs(ctx, k, leaf, rays, out.length / FAN_SPEC_STRIDE, out, index));
  });
  return {
    leaves, data: Float64Array.from(out), vertexCount: out.length / FAN_SPEC_STRIDE, index: Uint32Array.from(index), layout, corner, interior, rays,
    buildMs: performance.now() - began,
  };
}

// -- the placement in doubles --------------------------------------------------------------------------------------------

/**
 * Places the fan's vertices in the bent body frame, absolute, in doubles (xyz per vertex), at `ctx.morph`, `ctx.radiusM`, the
 * projection basis of `ctx` and a constant `heightM` along the bent up: the CPU fan, and the reference the vertex-stage fan is measured against.
 */
export function placeFanSpecs(ctx: StretchContext, specs: FanSpecs, heightM: number, options: { readonly float32Lattice?: boolean } = {}): Float64Array {
  const { basis, domain, steps, patchCells: pc } = ctx;
  // The vertex stage is given the longitudes of the lattice side (the window and the pole's longitude) as float32 attributes, like its neighbours:
  // `float32Lattice` rounds them the same way, so a reference built with it differs from the vertex stage by arithmetic and not by that input.
  const lattice = (x: number): number => (options.float32Lattice ? Math.fround(x) : x);
  const out = new Float64Array(specs.vertexCount * 3);
  const near = (lon: number, ref: number): number => lon + TWO_PI * Math.round((ref - lon) / TWO_PI);
  const place = (lon: number, lat: number): Vec3 => {
    const r = bentLonLat(ctx, lon, lat);
    return heightM === 0 ? r.position : [r.position[0] + r.normal[0] * heightM, r.position[1] + r.normal[1] * heightM, r.position[2] + r.normal[2] * heightM];
  };
  const placers = specs.leaves.map((leaf) => {
    const cell = leaf.span / pc;
    const sgn = leaf.pole.sign;
    const mask = leaf.mask;
    const unitAt = (u: number, v: number): Vec3 => latticeDirection(leaf.face, u, v, steps, domain);
    const latOf = (unit: Vec3): number => Math.atan2(dot(unit, basis.up), Math.hypot(dot(unit, basis.forward), dot(unit, basis.right)));
    // The vertex stage's folding: an odd vertex on an edge whose neighbour is coarser snaps one cell back along the edge.
    const fold = (gx: number, gy: number): [number, number] => {
      let fx = gx;
      let fy = gy;
      if (gx % 2 !== 0 && ((gy === 0 && (mask & 1)) || (gy === pc && (mask & 4)))) fx = gx - 1;
      if (gy % 2 !== 0 && ((gx === pc && (mask & 2)) || (gx === 0 && (mask & 8)))) fy = gy - 1;
      return [fx, fy];
    };
    const cornerG = leaf.pole.kind === 'corner' ? [leaf.pole.cx! * pc, leaf.pole.cy! * pc] : undefined;
    const cache = new Map<string, Vec3>();
    /** The (folded) grid vertex placed near longitude `ref`; the pole corner takes `poleLon`. */
    const end = (gx: number, gy: number, refIn: number, poleIn: number): Vec3 => {
      const ref = lattice(refIn);
      const poleLon = lattice(poleIn);
      const key = `${gx},${gy},${ref},${poleLon}`;
      const hit = cache.get(key);
      if (hit) return hit;
      const [fx, fy] = fold(gx, gy);
      let p: Vec3;
      if (cornerG && fx === cornerG[0] && fy === cornerG[1]) p = place(Number.isNaN(poleLon) ? ref : poleLon, sgn * HALF_PI);
      else {
        const unit = unitAt(leaf.u0 + fx * cell, leaf.v0 + fy * cell);
        p = place(near(longitudeOf(basis, unit), ref), latOf(unit));
      }
      cache.set(key, p);
      return p;
    };
    return { end, sgn };
  });
  for (let v = 0; v < specs.vertexCount; v++) {
    const d = specs.data;
    const o = v * FAN_SPEC_STRIDE;
    const placer = placers[d[o + SPEC.LEAF]];
    let p: Vec3;
    if (d[o + SPEC.KIND] === 0) {
      const a = placer.end(d[o + SPEC.GXA], d[o + SPEC.GYA], d[o + SPEC.REFA], d[o + SPEC.POLE_LON]);
      const w = d[o + SPEC.W];
      p = w === 0 ? a : lerp3(a, placer.end(d[o + SPEC.GXB], d[o + SPEC.GYB], d[o + SPEC.REFB], d[o + SPEC.POLE_LON]), w);
    } else {
      p = place(d[o + SPEC.LON], placer.sgn * (HALF_PI - d[o + SPEC.C]));
    }
    out[v * 3] = p[0];
    out[v * 3 + 1] = p[1];
    out[v * 3 + 2] = p[2];
  }
  return out;
}

/**
 * Builds the CPU fan for the selector's pole leaves (those `packMorphLeaves` leaves out with `skipPoleLeaves`) at the frame's
 * morph, radius and projection centre, as Float32 positions relative to the frame's bent camera. `leafCapacity` is the number of
 * leaves the pack takes at most; `heightM` the constant height of every vertex. Returns the geometry and its cost.
 */
export function buildPoleFan(
  selector: LodSelector, domain: LodDomain, patchCells: PatchCells, leafCapacity: number, frame: MorphFrame, rays: number, heightM: number,
): FanBuild {
  const began = performance.now();
  const ctx = fanContext(domain, patchCells, frame.basis, frame.view.radiusM, frame.view.morph);
  const leaves = frame.view.morph > 0 ? fanLeavesOf(selector, domain, patchCells, leafCapacity, frame.basis) : [];
  const specs = buildFanSpecs(ctx, leaves, rays);
  const positions = placeFanSpecs(ctx, specs, heightM);
  const origin: Vec3 = [frame.camBody[0], frame.camBody[1], frame.camBody[2]];
  const packed = new Float32Array(positions.length);
  let nearest = Infinity;
  for (let v = 0; v < positions.length; v += 3) {
    const x = positions[v] - origin[0];
    const y = positions[v + 1] - origin[1];
    const z = positions[v + 2] - origin[2];
    packed[v] = x;
    packed[v + 1] = y;
    packed[v + 2] = z;
    nearest = Math.min(nearest, Math.hypot(x, y, z));
  }
  return {
    positions: packed,
    index: specs.index,
    origin,
    nearestM: Number.isFinite(nearest) ? nearest : Infinity,
    layout: specs.layout,
    stats: {
      leaves: specs.corner + specs.interior, corner: specs.corner, interior: specs.interior, rays, vertices: specs.vertexCount,
      triangles: specs.index.length / 3, buildMs: performance.now() - began, mode: 'cpu',
    },
  };
}
