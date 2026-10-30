import type { LodDomain, LodSelector, PatchCells, Vec3 } from 'triangular-engine/lod-surface/core';
import { latticeSteps, maxLevelFor } from 'triangular-engine/lod-surface/core';
import { latticeDirection, type MorphFrame } from './morph-frame';
import { TORN_EDGE_REL, edgeLongitudes, longitudeOf, poleLattices, poleVertexLongitude } from './morph-leaves';
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

/** A boundary sample in the order the rays sweep: its grid vertex (unfolded), lattice point, longitude, colatitude, and the placed position of its (folded) vertex. */
interface Entry {
  readonly gx: number;
  readonly gy: number;
  readonly u: number;
  readonly v: number;
  readonly lon: number;
  readonly colat: number;
  readonly pos: Vec3;
}

/** One ray: its longitude, the chain entry it is (a ray at a boundary sample) or -1, and 1 or 2 for the corner case's two meridian edges. */
interface Ray {
  readonly lon: number;
  readonly sample: number;
  readonly edge: 0 | 1 | 2;
  readonly progress: number;
}

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

/** Builds the fan of one leaf into `positions` (body-frame doubles, xyz) and `index`. */
function buildLeaf(
  ctx: StretchContext, face: number, u0: number, v0: number, span: number, mask: number, pole: FanPole, rays: number, heightM: number,
  positions: number[], index: number[],
): { first: number; rays: number; rings: number } {
  const { basis, domain, steps, patchCells: pc } = ctx;
  const cell = span / pc;
  const sgn = pole.sign;
  const upS: Vec3 = [basis.up[0] * sgn, basis.up[1] * sgn, basis.up[2] * sgn];
  const unitAt = (u: number, v: number): Vec3 => latticeDirection(face, u, v, steps, domain);
  const latOf = (unit: Vec3): number => Math.atan2(dot(unit, basis.up), Math.hypot(dot(unit, basis.forward), dot(unit, basis.right)));
  const colatOf = (unit: Vec3): number => Math.atan2(Math.hypot(dot(unit, basis.forward), dot(unit, basis.right)), dot(unit, upS));
  const near = (lon: number, ref: number): number => lon + TWO_PI * Math.round((ref - lon) / TWO_PI);
  const place = (lon: number, lat: number): Vec3 => {
    const r = bentLonLat(ctx, lon, lat);
    return heightM === 0 ? r.position : [r.position[0] + r.normal[0] * heightM, r.position[1] + r.normal[1] * heightM, r.position[2] + r.normal[2] * heightM];
  };
  // The vertex stage's folding: an odd vertex on an edge whose neighbour is coarser snaps one cell back along the edge.
  const fold = (gx: number, gy: number): [number, number] => {
    let fx = gx;
    let fy = gy;
    if (gx % 2 !== 0 && ((gy === 0 && (mask & 1)) || (gy === pc && (mask & 4)))) fx = gx - 1;
    if (gy % 2 !== 0 && ((gx === pc && (mask & 2)) || (gx === 0 && (mask & 8)))) fy = gy - 1;
    return [fx, fy];
  };
  const cornerG = pole.kind === 'corner' ? [pole.cx! * pc, pole.cy! * pc] : undefined;
  /** The (folded) grid vertex placed near longitude `ref`; the pole corner takes `poleLon`. */
  const gridPlaced = (gx: number, gy: number, ref: number, poleLon?: number): Vec3 => {
    const [fx, fy] = fold(gx, gy);
    if (cornerG && fx === cornerG[0] && fy === cornerG[1]) return place(poleLon ?? ref, sgn * HALF_PI);
    const unit = unitAt(u0 + fx * cell, v0 + fy * cell);
    return place(near(longitudeOf(basis, unit), ref), latOf(unit));
  };
  const entryOf = (gx: number, gy: number, lon?: number, shift = 0): Entry => {
    const u = u0 + gx * cell;
    const v = v0 + gy * cell;
    const unit = unitAt(u, v);
    const own = lon ?? longitudeOf(basis, unit);
    return { gx, gy, u, v, lon: own + shift, colat: colatOf(unit), pos: gridPlaced(gx, gy, own + shift) };
  };

  let chain: Entry[];
  let rayList: Ray[];
  let edgeChains: [Vec3[], Vec3[]] | undefined;
  if (pole.kind === 'corner') {
    const cx = pole.cx!;
    const cy = pole.cy!;
    const centreUnit = unitAt(u0 + span / 2, v0 + span / 2);
    const leafLon = poleVertexLongitude(basis, centreUnit, longitudeOf(basis, centreUnit) >= 0 ? 1 : -1);
    const edge = edgeLongitudes(basis, domain, steps, face, u0, v0, span, { cx, cy }, leafLon);
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
    const chainOf = (axis: 1 | 2): Vec3[] => {
      const out: Vec3[] = [];
      for (let k = 0; k <= pc; k++) {
        const gx = axis === 1 ? (cx === 0 ? k : pc - k) : cx * pc;
        const gy = axis === 1 ? cy * pc : cy === 0 ? k : pc - k;
        out.push(gridPlaced(gx, gy, leafLon, axis === 1 ? edge.x : edge.y));
      }
      return out;
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
  const base = positions.length / 3;
  const dir = chain[chain.length - 1].lon >= chain[0].lon ? 1 : -1;
  let at = 0;
  for (const ray of rayList) {
    if (ray.edge > 0 && edgeChains) {
      const chainE = edgeChains[ray.edge - 1];
      for (let r = 0; r < ringCount; r++) {
        let p: Vec3;
        if (fs[r] === 0) p = chainE[0];
        else {
          const s = fs[r] * pc;
          const i = Math.min(pc - 1, Math.floor(s));
          p = lerp3(chainE[i], chainE[i + 1], s - i);
        }
        positions.push(p[0], p[1], p[2]);
      }
      continue;
    }
    let outer: Vec3;
    let colat: number;
    if (ray.sample >= 0) {
      outer = chain[ray.sample].pos;
      colat = chain[ray.sample].colat;
    } else {
      while (at < chain.length - 2 && (chain[at + 1].lon - ray.lon) * dir < 0) at++;
      const a = chain[at];
      const b = chain[at + 1];
      const gap = b.lon - a.lon;
      const w = gap === 0 ? 0 : Math.min(1, Math.max(0, (ray.lon - a.lon) / gap));
      outer = lerp3(a.pos, b.pos, w);
      colat = colatOf(unitAt(a.u + (b.u - a.u) * w, a.v + (b.v - a.v) * w));
    }
    positions.push(outer[0], outer[1], outer[2]);
    for (let r = 1; r < ringCount - 1; r++) {
      const p = place(ray.lon, sgn * (HALF_PI - fs[r] * colat));
      positions.push(p[0], p[1], p[2]);
    }
    const tip = place(ray.lon, sgn * HALF_PI);
    positions.push(tip[0], tip[1], tip[2]);
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
 * Builds the fan for the selector's pole leaves (those `packMorphLeaves` leaves out with `skipPoleLeaves`) at the frame's
 * morph, radius and projection centre, as Float32 positions relative to the frame's bent camera. `leafCapacity` is the number of
 * leaves the pack takes at most; `heightM` the constant height of every vertex. Returns the geometry and its cost.
 */
export function buildPoleFan(
  selector: LodSelector, domain: LodDomain, patchCells: PatchCells, leafCapacity: number, frame: MorphFrame, rays: number, heightM: number,
): FanBuild {
  const began = performance.now();
  const maxLevel = maxLevelFor(patchCells);
  const steps = latticeSteps(patchCells, maxLevel);
  const ctx: StretchContext = {
    basis: frame.basis, domain, steps, patchCells, morph: frame.view.morph, radiusM: frame.view.radiusM, cellPixels: 0,
  };
  const { leaves, masks, level, i, j, root } = selector;
  const count = Math.min(selector.stats.drawn, leafCapacity);
  const positions: number[] = [];
  const index: number[] = [];
  let corner = 0;
  let interior = 0;
  const layout: { first: number; rays: number; rings: number }[] = [];
  if (frame.view.morph > 0) {
    for (let k = 0; k < count; k++) {
      const node = leaves[k];
      const span = (1 << (maxLevel - level[node])) * patchCells;
      const u0 = i[node] * span;
      const v0 = j[node] * span;
      const face = root[node];
      const pole = fanLeafPole(frame.basis, steps, face, u0, v0, span, domain.warp);
      if (!pole) continue;
      if (pole.kind === 'corner') corner++;
      else interior++;
      layout.push(buildLeaf(ctx, face, u0, v0, span, masks[k], pole, rays, heightM, positions, index));
    }
  }
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
    index: new Uint32Array(index),
    origin,
    nearestM: Number.isFinite(nearest) ? nearest : Infinity,
    layout,
    stats: {
      leaves: corner + interior, corner, interior, rays, vertices: positions.length / 3, triangles: index.length / 3, buildMs: performance.now() - began,
    },
  };
}
