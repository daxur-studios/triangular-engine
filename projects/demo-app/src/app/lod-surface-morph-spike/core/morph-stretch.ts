import { bend, blendedProjection } from 'triangular-engine/atmosphere';
import { domainPoint, type LodDomain, type LodSelector, type Vec3 } from 'triangular-engine/lod-surface/core';
import { leafSide, mapVectorToBody, type MorphBasis } from './morph-frame';
import { edgeLongitudes, leafPoleCorner, poleVertexLongitude } from './morph-leaves';

/**
 * Plan 059 morph spike: the stretch-aware LOD metric. The library's selector measures a leaf's cell size and its distance to the
 * camera on the sphere. Between globe and map the ground is bent: near a pole the map stretches a leaf sideways (the pole is a
 * whole edge of the map) and a point a few kilometres from the pole on the sphere is metres from the camera on the map, so the
 * sphere's numbers say "far and small" about leaves that are near and large. This file measures each candidate leaf at its
 * MORPHED position instead: the corners, edge midpoints and centre go through the double-precision morph map, and the selector
 * is fed the bent body-frame positions, the bent normal, the disc radius that holds the morphed leaf, and a cell length that is
 * the larger of the longest morphed cell edge and the morphed chord sag converted to pixels. The camera is the bent camera.
 * It is all CPU, doubles, and lives in the spike: the library's selector is untouched except that its per-node geometry is
 * overwritten (`installStretchMetric`).
 */

/** `'sphere'`: the library's metric (the default); `'stretch'`: the metric of this file. */
export type LodMetric = 'sphere' | 'stretch';

export const LOD_METRICS: readonly LodMetric[] = ['sphere', 'stretch'];

/** The chord sag of a cell that counts as one pixel of error: the sag is turned into an equivalent cell length (`sag * cellPixels / SAG_PX`). */
export const SAG_PX = 1;

/** What the metric needs to place a node in the bent frame; changes (morph, centre, radius) refresh every node. */
export interface StretchContext {
  readonly basis: MorphBasis;
  readonly domain: LodDomain;
  /** Lattice size of the selector's patch cells at its deepest level. */
  readonly steps: number;
  readonly patchCells: number;
  readonly morph: number;
  readonly radiusM: number;
  /** The selector's target cell size on screen, pixels. */
  readonly cellPixels: number;
}

/** A node as the stretch metric sees it, in the bent body frame (metres). */
export interface StretchNode {
  readonly centre: Vec3;
  readonly normal: Vec3;
  /** Radius of the disc around the centre that holds every sample of the morphed leaf. */
  readonly across: number;
  /** Longest morphed edge of the leaf divided by the patch cells. */
  readonly cellEdge: number;
  /** Largest deviation of a morphed edge midpoint (or the centre) from the chord (or the corners' mean), metres, over the whole leaf. */
  readonly leafSag: number;
  /** The cell length the split test uses: `max(cellEdge, cellSag * cellPixels / SAG_PX)`. */
  readonly effectiveEdge: number;
  /** Longest morphed side of the leaf (metres): how much larger than its sphere size the map made it. */
  readonly leafEdge: number;
}

const TWO_PI = 2 * Math.PI;
/** The corners of a leaf in chain order (matches the selector's own edge chain). */
const CORNERS: readonly (readonly [0 | 1, 0 | 1])[] = [[0, 0], [1, 0], [1, 1], [0, 1]];

const dot = (a: readonly number[], b: readonly number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const dist = (a: readonly number[], b: readonly number[]): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** The bent body-frame position and normal of the point at longitude `lon` and latitude `lat` in the projection basis (doubles). */
export function bentLonLat(ctx: StretchContext, lon: number, lat: number): { position: Vec3; normal: Vec3 } {
  const { basis, morph: p, radiusM: R } = ctx;
  const k = (1 - p) / R;
  const [x, y] = blendedProjection(lon, lat, p, R);
  const b = bend(x, y, k, 0);
  return {
    position: mapVectorToBody(basis, [b.position[0], b.position[1], b.position[2] + (1 - p) * R]),
    normal: mapVectorToBody(basis, b.normal),
  };
}

/** The bent body-frame position and normal of the point at unit direction `unit` on the unbent sphere, longitude placed within pi of `refLon` (or `poleLon` exactly). */
export function bentBodyPoint(ctx: StretchContext, unit: Vec3, refLon: number, poleLon?: number): { position: Vec3; normal: Vec3; lat: number } {
  const { basis } = ctx;
  const v1 = dot(unit, basis.forward);
  const v2 = dot(unit, basis.right);
  const lat = Math.atan2(dot(unit, basis.up), Math.hypot(v1, v2));
  let lon: number;
  if (poleLon !== undefined) lon = poleLon;
  else {
    const principal = Math.atan2(v2, v1);
    lon = principal + TWO_PI * Math.round((refLon - principal) / TWO_PI);
  }
  return { ...bentLonLat(ctx, lon, lat), lat };
}

/**
 * The stretch measurements of node (`root`, `level`, `i`, `j`): the corners, four edge midpoints and the centre through the morph
 * map. The pole corner of a leaf (a pole of the basis at one of its corners) is the map's whole edge: it is sampled at the
 * longitudes of its two meridian edges (as the mesh's cap copies are), so the disc holds the 90 degrees of edge the leaf spans.
 */
export function stretchNode(ctx: StretchContext, root: number, level: number, i: number, j: number): StretchNode {
  const { basis, domain, steps, patchCells } = ctx;
  const size = 1 / 2 ** level;
  const position: Vec3 = [0, 0, 0];
  const normal: Vec3 = [0, 0, 0];
  const unitAt = (a: number, b: number): Vec3 => {
    domainPoint(domain, root, (i + a) * size, (j + b) * size, position, normal);
    return [normal[0], normal[1], normal[2]];
  };
  const centreUnit = unitAt(0.5, 0.5);
  const sigma = leafSide(basis, centreUnit);
  const span = steps / 2 ** level;
  const u0 = i * span;
  const v0 = j * span;
  const refLon = poleVertexLongitude(basis, centreUnit, sigma);
  const corner = leafPoleCorner(basis, steps, root, u0, v0, span, domain.warp);
  const edgeLon = corner ? edgeLongitudes(basis, domain, steps, root, u0, v0, span, corner, refLon) : undefined;

  const isPole = (c: readonly [number, number]): boolean => corner !== undefined && c[0] === corner.cx && c[1] === corner.cy;
  const cornerUnits = CORNERS.map(([a, b]) => unitAt(a, b));
  // A corner as one end of the edge towards `other`: the pole corner takes the longitude of that edge's meridian.
  const pointOf = (c: readonly [0 | 1, 0 | 1], unit: Vec3, other: readonly [0 | 1, 0 | 1] | undefined): Vec3 => {
    const pole = isPole(c) && edgeLon !== undefined;
    const lon = pole ? (other && other[1] === c[1] ? edgeLon!.x : other ? edgeLon!.y : refLon) : undefined;
    return bentBodyPoint(ctx, unit, refLon, lon).position;
  };
  const centre = bentBodyPoint(ctx, centreUnit, refLon);
  const around: Vec3[] = [];
  let leafEdge = 0;
  let sag = 0;
  let cornerMean: Vec3 = [0, 0, 0];
  for (let e = 0; e < 4; e++) {
    const a = CORNERS[e];
    const b = CORNERS[(e + 1) % 4];
    const pa = pointOf(a, cornerUnits[e], b);
    const pb = pointOf(b, cornerUnits[(e + 1) % 4], a);
    const mid = bentBodyPoint(ctx, unitAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2), refLon).position;
    leafEdge = Math.max(leafEdge, dist(pa, pb));
    sag = Math.max(sag, dist(mid, [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2]));
    around.push(pa, mid);
    const own = pointOf(a, cornerUnits[e], undefined);
    cornerMean = [cornerMean[0] + own[0] / 4, cornerMean[1] + own[1] / 4, cornerMean[2] + own[2] / 4];
  }
  sag = Math.max(sag, dist(centre.position, cornerMean));
  if (corner && edgeLon) {
    // The two copies of the pole corner that bound the cap: the leaf's reach along the edge.
    for (const lon of [edgeLon.x, edgeLon.y]) {
      const idx = CORNERS.findIndex((c) => isPole(c));
      around.push(bentBodyPoint(ctx, cornerUnits[idx], refLon, lon).position);
    }
  }
  let across = 0;
  for (const point of around) across = Math.max(across, dist(point, centre.position));
  const cellEdge = leafEdge / patchCells;
  const cellSag = sag / (patchCells * patchCells);
  return {
    centre: centre.position, normal: centre.normal, across, cellEdge, leafSag: sag, leafEdge,
    effectiveEdge: Math.max(cellEdge, (cellSag * ctx.cellPixels) / SAG_PX),
  };
}

/** The knobs the metric reads each time a node joins the tree. */
export interface StretchParams {
  readonly morph: number;
  readonly radiusM: number;
  readonly centreLonDeg: number;
  readonly centreLatDeg: number;
}

/** What `installStretchMetric` returns. */
export interface StretchMetricHandle {
  /** Nodes whose geometry was recomputed since the install (a cost figure). */
  readonly refreshed: () => number;
}

/**
 * Makes `selector` measure in the bent frame. Every node that joins the tree gets the stretch geometry of `stretchNode` for the
 * current `params()` (centre, normal, disc radius, effective cell edge) in place of its sphere values; a node whose parameters
 * changed (morph, centre, radius) is refreshed when it next joins. The camera in the view must be the bent camera (`frame.camBody`).
 * Install it on a fresh selector (the sphere geometry of a node is not restored): switching metrics builds a new selector.
 */
export function installStretchMetric(
  selector: LodSelector, basisOf: (centreLonDeg: number, centreLatDeg: number) => MorphBasis, domain: LodDomain, steps: number, patchCells: number,
  cellPixels: number, params: () => StretchParams,
): StretchMetricHandle {
  // The selector's per-node arrays are private fields; this is the spike reaching into them on purpose, on its own selector.
  const s = selector as any;
  const capacity: number = s.level.length;
  const maxLevel: number = selector.maxLevel;
  const stamp = new Int32Array(capacity);
  const hot: Float64Array = s.hot;
  let key = '';
  let keyId = 0;
  let ctx: StretchContext | undefined;
  let refreshed = 0;
  const baseInit = s.initNode.bind(selector);
  s.initNode = (node: number, ...rest: unknown[]) => {
    baseInit(node, ...rest);
    stamp[node] = 0;
  };
  const baseActivate = s.activateRange.bind(selector);
  s.activateRange = (first: number, count: number) => {
    const p = params();
    const k = `${p.radiusM}|${p.morph}|${p.centreLonDeg}|${p.centreLatDeg}`;
    if (k !== key || !ctx) {
      key = k;
      keyId++;
      ctx = { basis: basisOf(p.centreLonDeg, p.centreLatDeg), domain, steps, patchCells, morph: p.morph, radiusM: p.radiusM, cellPixels };
    }
    for (let node = first; node < first + count; node++) {
      if (stamp[node] === keyId) continue;
      stamp[node] = keyId;
      refreshed++;
      const n = stretchNode(ctx, s.root[node], s.level[node], s.i[node], s.j[node]);
      const h = node * 8;
      const c = node * 3;
      for (let a = 0; a < 3; a++) {
        hot[h + a] = n.centre[a];
        s.center[c + a] = n.centre[a];
        s.normal[c + a] = n.normal[a];
      }
      s.radius[node] = n.across;
      s.edge[node] = n.leafEdge;
      hot[h + 3] = n.across;
      hot[h + 4] = s.level[node] >= maxLevel ? 0 : n.effectiveEdge;
      hot[h + 5] = n.across;
      hot[h + 6] = 0;
    }
    baseActivate(first, count);
  };
  return { refreshed: () => refreshed };
}
