/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LodDomain, Vec3 } from './lod-domain';
import { latticeSteps } from './lod-lattice';
import { latticeDirection, type MorphBasis, type MorphFrame, type MorphMap } from './lod-morph-frame';
import { p2FromAngles, type MorphAnchor, type MorphLib, type P2Result } from './lod-morph-math';
import { TORN_EDGE_REL, analyseLeaf, longitudeOf, poleLattices, poleVertexLongitude, type PoleCorner } from './lod-morph-leaves';
import { maxLevelFor, type LodSelector, type PatchCells } from './lod-selector';

/**
 * Plan 059, step G6d, the CPU half of the pole fan. The leaves that hold a pole of the projection (the pole is the map's whole top or
 * bottom edge, so such a leaf is stretched across a quarter or all of the map's width) are drawn by a fan instead of by the leaf
 * instances: rays are meridians around the pole, rings are fractions of the leaf's own reach along each ray (linear like the cells
 * towards the boundary, geometric towards the pole), and the innermost ring is the pole itself at each ray's longitude. The outermost
 * ring is the leaf's own boundary: a point on the chord between two grid vertices of the leaf, so the boundary is the polyline the
 * neighbours draw.
 *
 * This file holds the topology and the per-vertex parameters only, all in doubles, and nothing in them depends on the camera, the
 * morph or the height. {@link PoleFanTopology} rebuilds them when, and only when, the projection centre (the basis), the planet
 * radius, the ray count or the set of pole leaves (their faces, levels, origins, edge masks and pole corners) changes. The vertex stage
 * (`lod-morph-fan-stage.ts`) evaluates the positions from the per-frame uniforms: a chord point through the lattice stage of the leaf's
 * neighbours (`latticeOffset` and `p2Position` of `lod-morph-math.ts`), a polar point through `p2FromAngles` from double-float
 * differences of longitude and colatitude. {@link fanPolarPosition} is the CPU twin of that polar path; the specs use it with
 * `DOUBLE_LIB` and `FLOAT32_LIB`.
 *
 * A pole leaf that straddles the map's cut (its longitudes run past +-pi) gets a second copy with its longitudes shifted by -+2 pi, so
 * that each copy covers its part of the map; the outline clip of the fragment stage takes off what lies over the edge.
 */

const TWO_PI = 2 * Math.PI;

/** Rays per full turn of the pole fan when none is given. */
export const POLE_FAN_DEFAULT_RAYS = 1024;

/** The innermost ring that is not the pole is about this far from it (metres). */
const FAN_MIN_RING_M = 1;
const FAN_MIN_GEOMETRIC = 3;
const FAN_MAX_GEOMETRIC = 26;

/** Where a pole of the basis sits in a fan leaf: at one of its corners, or strictly inside it. */
export interface PoleFanPole {
  readonly kind: 'corner' | 'interior';
  /** +1: the basis' up pole; -1: the down pole. */
  readonly sign: 1 | -1;
  /** For a corner: which corner (0 is the low end of the axis). */
  readonly cx?: 0 | 1;
  readonly cy?: 0 | 1;
}

/** A pole leaf the fan replaces, with what the leaf instance would have been given for it (`packMorphLeaves`). */
export interface PoleFanLeaf {
  readonly face: number;
  readonly level: number;
  /** The leaf's lattice origin, its span in lattice units and the lattice step of one cell. */
  readonly u0: number;
  readonly v0: number;
  readonly span: number;
  readonly step: number;
  /** The leaf's edge mask (bit e set: the neighbour across edge e is coarser). */
  readonly mask: number;
  readonly pole: PoleFanPole;
  /** The leaf's centre longitude in the side's window (the instance's pole longitude). */
  readonly leafLon: number;
  /** A pole corner: the longitudes of the x and y meridian edges and the corner (cx, cy); undefined for an interior pole. */
  readonly cap?: readonly [number, number, number, number];
}

/** Numbers per vertex of {@link PoleFanSpecs.data}. */
export const FAN_SPEC_STRIDE = 13;
/** Column indices of a vertex description in {@link PoleFanSpecs.data}. */
export const FAN_COLUMN = {
  /** The fan patch (index into {@link PoleFanSpecs.patches}). */
  PATCH: 0,
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
  /** Polar: longitude, colatitude from the leaf's pole and the pole's sign. */
  LON: 10,
  C: 11,
  SGN: 12,
} as const;

/** One drawn copy of a fan leaf: the leaf and the shift added to its longitudes (0, or +-2 pi for a copy across the cut). */
export interface PoleFanPatch {
  readonly leaf: PoleFanLeaf;
  readonly shift: number;
}

/** What the fan's build needs besides its leaves: the basis, the domain and the lattice, and the planet radius. */
export interface PoleFanContext {
  readonly basis: MorphBasis;
  readonly domain: LodDomain;
  readonly steps: number;
  readonly patchCells: PatchCells;
  readonly radiusM: number;
}

/** The fan's topology and per-vertex descriptions: nothing in them depends on the camera, the morph or the height. */
export interface PoleFanSpecs {
  readonly leaves: readonly PoleFanLeaf[];
  readonly patches: readonly PoleFanPatch[];
  /** {@link FAN_SPEC_STRIDE} numbers per vertex (see {@link FAN_COLUMN}). */
  readonly data: Float64Array;
  readonly vertexCount: number;
  readonly index: Uint32Array;
  /** Each patch's grid: its first vertex, rays and rings (ray j, ring r is vertex `first + j * rings + r`; ring 0 is the boundary, the last ring the pole). */
  readonly layout: readonly { readonly first: number; readonly rays: number; readonly rings: number }[];
  /** Leaves with a pole at a corner, and leaves with a pole strictly inside. */
  readonly corner: number;
  readonly interior: number;
  /** Patches beyond one per leaf: the copies of leaves that straddle the cut. */
  readonly copies: number;
  readonly rays: number;
  /** CPU milliseconds the build took. */
  readonly buildMs: number;
}

/** What the fan costs and holds, as {@link LodSurfaceMesh.poleFanStats} reports it. */
export interface PoleFanStats {
  /** Builds of the topology since the surface was made (a camera or morph change adds none). */
  readonly rebuilds: number;
  /** Pole leaves the fan draws, and how many of them have the pole at a corner. */
  readonly leaves: number;
  readonly corner: number;
  /** Copies of leaves that straddle the cut. */
  readonly copies: number;
  readonly rays: number;
  readonly vertices: number;
  readonly triangles: number;
  /** CPU milliseconds of the last build. */
  readonly buildMs: number;
}

/** The context of a fan for a morph map at the lattice of `patchCells`. */
export function poleFanContext(map: MorphMap, domain: LodDomain, patchCells: PatchCells): PoleFanContext {
  return { basis: map.basis, domain, steps: latticeSteps(patchCells, maxLevelFor(patchCells)), patchCells, radiusM: map.radius };
}

const dot = (a: readonly number[], b: readonly number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

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

/** The pole a leaf holds at a corner or strictly inside (the same tests as `leafPoleCorner` and `leafTorn`), if any. */
export function poleFanLeafPole(
  basis: MorphBasis, steps: number, face: number, u0: number, v0: number, span: number, warp: LodDomain['warp'] = 'equal-angle',
): PoleFanPole | undefined {
  const eps = TORN_EDGE_REL * span;
  for (const { u, v, sign } of poleLattices(basis, steps, face, warp)) {
    const cx = Math.abs(u - u0) <= eps ? 0 : Math.abs(u - (u0 + span)) <= eps ? 1 : -1;
    const cy = Math.abs(v - v0) <= eps ? 0 : Math.abs(v - (v0 + span)) <= eps ? 1 : -1;
    if (cx >= 0 && cy >= 0) return { kind: 'corner', sign, cx: cx as 0 | 1, cy: cy as 0 | 1 };
    if (u > u0 + eps && u < u0 + span - eps && v > v0 + eps && v < v0 + span - eps) return { kind: 'interior', sign };
  }
  return undefined;
}

/**
 * The longitudes of a pole corner's two meridian edges (x, y), each near the leaf's centre longitude: the edge's middle sample's longitude.
 * Each edge runs from the pole to the leaf's far corner along a meridian, so its middle sample gives the edge's longitude.
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

/** The pole leaves of the selector's drawn leaves (the first `leafBound` of them), in the selector's order. */
export function poleFanLeavesOf(selector: LodSelector, domain: LodDomain, patchCells: PatchCells, leafBound: number, basis: MorphBasis): PoleFanLeaf[] {
  const maxLevel = maxLevelFor(patchCells);
  const steps = latticeSteps(patchCells, maxLevel);
  const { leaves, masks, level, i, j, root } = selector;
  const count = Math.min(selector.stats.drawn, leafBound);
  const out: PoleFanLeaf[] = [];
  for (let k = 0; k < count; k++) {
    const node = leaves[k];
    const step = 1 << (maxLevel - level[node]);
    const span = step * patchCells;
    const u0 = i[node] * span;
    const v0 = j[node] * span;
    const face = root[node];
    const pole = poleFanLeafPole(basis, steps, face, u0, v0, span, domain.warp);
    if (!pole) continue;
    const a = analyseLeaf(basis, domain, steps, face, u0, v0, span);
    const leafLon = poleVertexLongitude(basis, a.centre, a.side);
    const edges = pole.kind === 'corner' ? edgeLongitudes(basis, domain, steps, face, u0, v0, span, { cx: pole.cx!, cy: pole.cy! }, leafLon) : undefined;
    out.push({
      face, level: level[node], u0, v0, span, step, mask: masks[k], pole, leafLon,
      ...(edges && pole.kind === 'corner' ? { cap: [edges.x, edges.y, pole.cx!, pole.cy!] as const } : {}),
    });
  }
  return out;
}

/** Whether two pole leaves are the same for the fan: the same leaf, edge mask, pole and longitudes. */
export function sameFanLeaf(a: PoleFanLeaf, b: PoleFanLeaf): boolean {
  if (a.face !== b.face || a.level !== b.level || a.u0 !== b.u0 || a.v0 !== b.v0 || a.span !== b.span || a.mask !== b.mask) return false;
  if (a.pole.kind !== b.pole.kind || a.pole.sign !== b.pole.sign || a.pole.cx !== b.pole.cx || a.pole.cy !== b.pole.cy) return false;
  if (a.leafLon !== b.leafLon) return false;
  if (a.cap === undefined || b.cap === undefined) return a.cap === b.cap;
  return a.cap[0] === b.cap[0] && a.cap[1] === b.cap[1];
}

// -- the descriptions ------------------------------------------------------------------------------------------------

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

/**
 * Writes the fan of one patch into `out` (descriptions) and `index` (triangles); vertex numbers continue from `base`. `shift` is added to
 * every longitude written (a copy across the cut); the sweep itself runs unshifted.
 */
function patchSpecs(
  ctx: PoleFanContext, patch: number, leaf: PoleFanLeaf, rays: number, base: number, shift: number, out: number[], index: number[],
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
    out.push(patch, 0, a.gx, a.gy, a.ref + shift, b.gx, b.gy, b.ref + shift, w, Number.isNaN(poleLon) ? NaN : poleLon + shift, 0, 0, 0);
  };
  const polar = (lon: number, c: number): void => {
    out.push(patch, 1, 0, 0, 0, 0, 0, 0, 0, NaN, lon + shift, c, sgn);
  };
  const entryOf = (gx: number, gy: number, lon?: number, turn = 0): Entry => {
    const u = u0 + gx * cell;
    const v = v0 + gy * cell;
    const unit = unitAt(u, v);
    const own = lon ?? longitudeOf(basis, unit);
    return { gx, gy, u, v, lon: own + turn, colat: colatOf(unit), ref: own + turn };
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

/**
 * The fan's topology and vertex descriptions for the given pole leaves: rays per full turn `rays`, the leaves' own boundary samples and
 * the context's basis and radius. A leaf with a pole at a corner whose longitudes run past +-pi is drawn twice: once as it is and once
 * shifted by -+2 pi, which is the second copy of a leaf that straddles the cut.
 */
export function buildPoleFanSpecs(ctx: PoleFanContext, leaves: readonly PoleFanLeaf[], rays: number): PoleFanSpecs {
  const began = performance.now();
  const out: number[] = [];
  const index: number[] = [];
  const patches: PoleFanPatch[] = [];
  const layout: { first: number; rays: number; rings: number }[] = [];
  let corner = 0;
  let interior = 0;
  for (const leaf of leaves) {
    if (leaf.pole.kind === 'corner') corner++;
    else interior++;
    const shifts: number[] = [0];
    if (leaf.pole.kind === 'corner' && leaf.cap) {
      const hi = Math.max(leaf.cap[0], leaf.cap[1]);
      const lo = Math.min(leaf.cap[0], leaf.cap[1]);
      if (hi > Math.PI) shifts.push(-TWO_PI);
      if (lo < -Math.PI) shifts.push(TWO_PI);
    }
    for (const shift of shifts) {
      patches.push({ leaf, shift });
      layout.push(patchSpecs(ctx, patches.length - 1, leaf, rays, out.length / FAN_SPEC_STRIDE, shift, out, index));
    }
  }
  return {
    leaves, patches, data: Float64Array.from(out), vertexCount: out.length / FAN_SPEC_STRIDE, index: Uint32Array.from(index), layout,
    corner, interior, copies: patches.length - leaves.length, rays, buildMs: performance.now() - began,
  };
}

/** The fan's grid vertex after the vertex stage's folding: an odd vertex on an edge whose neighbour is coarser snaps one cell back along it. */
export function foldFanGrid(mask: number, patchCells: number, gx: number, gy: number): [number, number] {
  let fx = gx;
  let fy = gy;
  if (gx % 2 !== 0 && ((gy === 0 && (mask & 1)) || (gy === patchCells && (mask & 4)))) fx = gx - 1;
  if (gy % 2 !== 0 && ((gx === patchCells && (mask & 2)) || (gx === 0 && (mask & 8)))) fy = gy - 1;
  return [fx, fy];
}

// -- the packed vertex attributes -------------------------------------------------------------------------------------

/** The vertex stage's inputs of a fan: six vec4 per vertex and the triangles. */
export interface PoleFanVertexData {
  readonly vertexCount: number;
  /** (U0, V0, lattice step, face) of the vertex's leaf. */
  readonly leaf: Float32Array;
  /** (gxA, gyA, gxB, gyB): the chord's grid vertices (unfolded). */
  readonly grid: Float32Array;
  /** (refA, refB, w, poleLon): the longitudes the ends are placed near, the share from A to B, and the pole's longitude where the chord runs along a meridian edge (0 where none). */
  readonly ref: Float32Array;
  /** (lonHi, lonLo, cHi, cLo) of a polar vertex. */
  readonly polar1: Float32Array;
  /** (eHi, eLo, sgn, kind): kind 1 for a polar vertex, 0 for a chord vertex. */
  readonly polar2: Float32Array;
  /** (edge mask, corner cx, corner cy, 0): the corner is -1 for a leaf whose pole is strictly inside it, and for a chord with no pole longitude. */
  readonly misc: Float32Array;
  readonly index: Uint32Array;
}

/** A double split into a float32 high part and the float32 remainder (the pair sums to x to about 1e-14 relative). */
export function splitDouble(x: number): [number, number] {
  const hi = Math.fround(x);
  return [hi, Math.fround(x - hi)];
}

/** `e = 2 sin^2(c / 2)` = `1 - cos c` without the cancellation. */
export const colatitudeE = (c: number): number => 2 * Math.sin(c / 2) ** 2;

/**
 * The per-frame values of the polar path as float32 double-floats, written into `out` (no allocation): `out[0..3]` is `[psHi+, psHi-, psLo+, psLo-]`,
 * `out[4..7]` the colatitudes in the same layout, `out[8..9]` the anchor's longitude `[lamHi, lamLo]`. The `ps` values are the frame's
 * exact `1 - sin` and `1 + sin` (no cancellation near a pole); the colatitudes are the anchor's from each pole.
 */
export function fanFrameWords(v: { readonly sA: number; readonly cA: number; readonly omsA: number; readonly opsA: number; readonly lamA: number }, out: Float64Array): Float64Array {
  const ps0 = v.omsA;
  const ps1 = v.opsA;
  const c0 = Math.atan2(v.cA, v.sA);
  const c1 = Math.atan2(v.cA, -v.sA);
  const h0 = Math.fround(ps0);
  const h1 = Math.fround(ps1);
  const k0 = Math.fround(c0);
  const k1 = Math.fround(c1);
  const lh = Math.fround(v.lamA);
  out[0] = h0;
  out[1] = h1;
  out[2] = Math.fround(ps0 - h0);
  out[3] = Math.fround(ps1 - h1);
  out[4] = k0;
  out[5] = k1;
  out[6] = Math.fround(c0 - k0);
  out[7] = Math.fround(c1 - k1);
  out[8] = lh;
  out[9] = Math.fround(v.lamA - lh);
  return out;
}

/** A frame's polar words, as {@link fanFrameWords} takes them from a frame. */
export function fanFrameOf(frame: MorphFrame, out: Float64Array = new Float64Array(10)): Float64Array {
  return fanFrameWords(frame.values, out);
}

/** The packed fan: the vertex stage's float32 attributes of every vertex, and the triangles. */
export function packPoleFanVertices(specs: PoleFanSpecs): PoleFanVertexData {
  const n = specs.vertexCount;
  const leaf = new Float32Array(n * 4);
  const grid = new Float32Array(n * 4);
  const ref = new Float32Array(n * 4);
  const polar1 = new Float32Array(n * 4);
  const polar2 = new Float32Array(n * 4);
  const misc = new Float32Array(n * 4);
  const d = specs.data;
  for (let v = 0; v < n; v++) {
    const o = v * FAN_SPEC_STRIDE;
    const l = specs.patches[d[o + FAN_COLUMN.PATCH]].leaf;
    const q = v * 4;
    leaf[q] = l.u0;
    leaf[q + 1] = l.v0;
    leaf[q + 2] = l.step;
    leaf[q + 3] = l.face;
    misc[q] = l.mask;
    misc[q + 1] = l.cap ? l.cap[2] : -1;
    misc[q + 2] = l.cap ? l.cap[3] : -1;
    if (d[o + FAN_COLUMN.KIND] === 0) {
      const toB = d[o + FAN_COLUMN.W] >= 1;
      const w = toB ? 0 : d[o + FAN_COLUMN.W];
      grid[q] = d[o + (toB ? FAN_COLUMN.GXB : FAN_COLUMN.GXA)];
      grid[q + 1] = d[o + (toB ? FAN_COLUMN.GYB : FAN_COLUMN.GYA)];
      grid[q + 2] = d[o + FAN_COLUMN.GXB];
      grid[q + 3] = d[o + FAN_COLUMN.GYB];
      ref[q] = d[o + (toB ? FAN_COLUMN.REFB : FAN_COLUMN.REFA)];
      ref[q + 1] = d[o + FAN_COLUMN.REFB];
      ref[q + 2] = w;
      // No pole longitude (NaN): the exact pole vertex takes the longitude it is placed near, as an instance does when no edge gives it one.
      // The vertex stage reads a leaf with a pole corner from `misc.y >= 0`, so a chord with no pole longitude says it has no pole corner.
      const poleLon = d[o + FAN_COLUMN.POLE_LON];
      if (Number.isNaN(poleLon)) {
        ref[q + 3] = 0;
        misc[q + 1] = -1;
        misc[q + 2] = -1;
      } else ref[q + 3] = poleLon;
    } else {
      const p = polarParamsOf(d[o + FAN_COLUMN.LON], d[o + FAN_COLUMN.C], d[o + FAN_COLUMN.SGN]);
      polar1[q] = p.lonHi;
      polar1[q + 1] = p.lonLo;
      polar1[q + 2] = p.cHi;
      polar1[q + 3] = p.cLo;
      polar2[q] = p.eHi;
      polar2[q + 1] = p.eLo;
      polar2[q + 2] = p.sgn;
      polar2[q + 3] = 1;
    }
  }
  return { vertexCount: n, leaf, grid, ref, polar1, polar2, misc, index: specs.index };
}

// -- the polar path in a number library ---------------------------------------------------------------------------------

/** The per-frame values of the polar path, as the vertex stage reads them (numbers on the CPU, uniform nodes on the GPU). */
export interface FanFrameNodes<T = any> {
  psHiP: T; psHiM: T; psLoP: T; psLoM: T;
  colHiP: T; colHiM: T; colLoP: T; colLoM: T;
  lamHi: T; lamLo: T;
}

/** A polar vertex's description as the vertex stage reads it: double-floats of longitude, colatitude and `e`, and the pole's sign. */
export interface FanPolarParams<T = any> {
  lonHi: T; lonLo: T; cHi: T; cLo: T; eHi: T; eLo: T; sgn: T;
}

/** The second half of P2's inputs for a polar vertex: `ds`, `dphi` and `dlam0` as differences from the anchor, each formed from double-float values. */
export function fanPolarOffsets(L: MorphLib, F: FanFrameNodes<any>, v: FanPolarParams<any>): { ds: any; dphi: any; dlam0: any } {
  const plus = L.lt(L.c(0), v.sgn);
  const psHi = L.select(plus, F.psHiP, F.psHiM);
  const psLo = L.select(plus, F.psLoP, F.psLoM);
  const colHi = L.select(plus, F.colHiP, F.colHiM);
  const colLo = L.select(plus, F.colLoP, F.colLoM);
  return {
    ds: v.sgn.mul(psHi.sub(v.eHi).add(psLo.sub(v.eLo))),
    dphi: v.sgn.mul(colHi.sub(v.cHi).add(colLo.sub(v.cLo))),
    dlam0: v.lonHi.sub(F.lamHi).add(v.lonLo.sub(F.lamLo)),
  };
}

/**
 * A polar vertex through P2, in any number library: the polar path of the vertex stage. The unwrap integer is 0: the vertex sits at
 * its own longitude, which the patch's sweep has already placed continuously (and shifted into a copy across the cut).
 */
export function fanPolarPosition(L: MorphLib, A: MorphAnchor<any>, F: FanFrameNodes<any>, v: FanPolarParams<any>, h: any): P2Result {
  const o = fanPolarOffsets(L, F, v);
  return p2FromAngles(L, A, o.ds, o.dphi, o.dlam0, L.c(0), h);
}

/** The double-float polar parameters of a description as numbers: longitude, colatitude, `e` and the sign. */
export function polarParamsOf(lon: number, c: number, sgn: number): FanPolarParams<number> {
  const [lonHi, lonLo] = splitDouble(lon);
  const [cHi, cLo] = splitDouble(c);
  const [eHi, eLo] = splitDouble(colatitudeE(c));
  return { lonHi, lonLo, cHi, cLo, eHi, eLo, sgn };
}

/** The frame's polar values as numbers in the shape {@link FanFrameNodes} reads, from the words of {@link fanFrameWords}. */
export function fanFrameNumbers(words: Float64Array): FanFrameNodes<number> {
  return {
    psHiP: words[0], psHiM: words[1], psLoP: words[2], psLoM: words[3],
    colHiP: words[4], colHiM: words[5], colLoP: words[6], colLoM: words[7],
    lamHi: words[8], lamLo: words[9],
  };
}

// -- the topology's rebuild rule ----------------------------------------------------------------------------------------

/**
 * The fan's CPU state across frames. {@link PoleFanTopology.update} takes the selector's pole leaves and rebuilds the descriptions only
 * when the basis (the projection centre), the radius, the ray count or the leaves (see {@link sameFanLeaf}) differ from the last build.
 * A camera move or a morph change leaves them as they are: the vertex stage takes those from uniforms.
 */
export class PoleFanTopology {
  /** The descriptions of the last build, or undefined before the first one. */
  specs: PoleFanSpecs | undefined;
  /** Builds since this topology was made. */
  rebuilds = 0;
  private leaves: PoleFanLeaf[] = [];
  private readonly basis = new Float64Array(9);
  private radius = Number.NaN;
  private rays = -1;

  /**
   * Updates the fan for the selector's pole leaves at `map` (the first `leafBound` drawn leaves are looked at), with `rays` rays per turn.
   * Returns true when the descriptions were rebuilt.
   */
  update(selector: LodSelector, domain: LodDomain, patchCells: PatchCells, leafBound: number, map: MorphMap, rays: number): boolean {
    const leaves = poleFanLeavesOf(selector, domain, patchCells, leafBound, map.basis);
    if (this.specs && this.sameBasis(map.basis) && this.radius === map.radius && this.rays === rays && this.sameLeaves(leaves)) return false;
    const specs = buildPoleFanSpecs(poleFanContext(map, domain, patchCells), leaves, rays);
    this.specs = specs;
    this.leaves = leaves;
    this.rays = rays;
    this.radius = map.radius;
    const b = map.basis;
    this.basis.set([b.forward[0], b.forward[1], b.forward[2], b.up[0], b.up[1], b.up[2], b.right[0], b.right[1], b.right[2]]);
    this.rebuilds++;
    return true;
  }

  /** Forgets the descriptions, so that the next {@link update} rebuilds (used when the fan is switched off). */
  reset(): void {
    this.specs = undefined;
    this.leaves = [];
    this.radius = Number.NaN;
    this.rays = -1;
  }

  private sameBasis(b: MorphBasis): boolean {
    const k = this.basis;
    return k[0] === b.forward[0] && k[1] === b.forward[1] && k[2] === b.forward[2] && k[3] === b.up[0] && k[4] === b.up[1] && k[5] === b.up[2]
      && k[6] === b.right[0] && k[7] === b.right[1] && k[8] === b.right[2];
  }

  private sameLeaves(next: readonly PoleFanLeaf[]): boolean {
    if (next.length !== this.leaves.length) return false;
    for (let k = 0; k < next.length; k++) if (!sameFanLeaf(next[k], this.leaves[k])) return false;
    return true;
  }
}

/** The fan's statistics from its descriptions, the topology's rebuild count and the triangles' count. */
export function poleFanStatsOf(specs: PoleFanSpecs, rebuilds: number): PoleFanStats {
  return {
    rebuilds, leaves: specs.leaves.length, corner: specs.corner, copies: specs.copies, rays: specs.rays,
    vertices: specs.vertexCount, triangles: specs.index.length / 3, buildMs: specs.buildMs,
  };
}
