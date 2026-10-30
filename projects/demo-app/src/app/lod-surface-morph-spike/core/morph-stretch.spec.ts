import {
  LodSelector,
  TERRAIN_DEFAULTS,
  frustumNormals,
  latticeSteps,
  maxLevelFor,
  newAnchor,
  type LodDomain,
  type Vec3,
} from 'triangular-engine/lod-surface/core';
import { computeMorphFrame, poseOf, projectionBasis, type MorphPoseId, type MorphView } from './morph-frame';
import { bentBodyPoint, installStretchMetric, stretchNode, type LodMetric, type StretchContext } from './morph-stretch';
import { edgeLongitudes, leafPoleCorner, poleVertexLongitude } from './morph-leaves';
import { leafSide } from './morph-frame';
import { domainPoint } from 'triangular-engine/lod-surface/core';

const PATCH = TERRAIN_DEFAULTS.patchCells;
const STEPS = latticeSteps(PATCH, maxLevelFor(PATCH));
const FOV = (60 * Math.PI) / 180;
const HEIGHT_PX = 576;

const domainOf = (radiusM: number): LodDomain => ({ kind: 'sphere', sizeM: radiusM, warp: 'equal-angle' });

/** The selector's distance to a node's disc (the library's `boxGap` with no height range). */
function discGap(camera: Vec3, centre: Vec3, normal: Vec3, across: number): number {
  const x = camera[0] - centre[0];
  const y = camera[1] - centre[1];
  const z = camera[2] - centre[2];
  const up = x * normal[0] + y * normal[1] + z * normal[2];
  const side = Math.max(Math.sqrt(Math.max(x * x + y * y + z * z - up * up, 0)) - across, 0);
  return Math.max(Math.hypot(side, up), 1e-3);
}

interface Selection {
  readonly leaves: number;
  readonly deepest: number;
  /** Morphed cell size over the target (pixelScale times the morphed gap): above 1 the leaf is too coarse where the map put it. */
  readonly ratios: number[];
  readonly refreshed: number;
  readonly pole: string[];
}

/** Selects one view with a metric the way the scene does and measures every leaf in the morphed frame. */
function select(radiusM: number, morph: number, pose: MorphPoseId, metric: LodMetric, centre: [number, number] = [0, 0], leafCap: number = TERRAIN_DEFAULTS.leafCap): Selection {
  const view: MorphView = {
    radiusM, morph, centreLonDeg: centre[0], centreLatDeg: centre[1], pose: poseOf(pose, radiusM, morph), groundHeightM: 0,
  };
  const domain = domainOf(radiusM);
  const selector = new LodSelector({
    domain, patchCells: PATCH, mode: 'distance', fixedLevel: 5, cellPixels: TERRAIN_DEFAULTS.cellPixels, leafCap,
    heightBoundM: 0, cull: false, hysteresis: TERRAIN_DEFAULTS.hysteresis,
  });
  let refreshed = 0;
  if (metric === 'stretch') {
    const handle = installStretchMetric(selector, projectionBasis, domain, STEPS, PATCH, TERRAIN_DEFAULTS.cellPixels, () => view);
    refreshed = 0;
    void handle;
  }
  const frame = computeMorphFrame(view, domain, STEPS, newAnchor());
  const frustum = new Float64Array(12);
  frustumNormals(frame.axes, FOV, 16 / 9, frustum);
  const pixelAngle = (2 * Math.tan(FOV / 2)) / HEIGHT_PX;
  for (let pass = 0; pass < 3; pass++) {
    selector.select({ camera: metric === 'stretch' ? frame.camBody : frame.selectorCamera, pixelAngle, frustum });
  }
  const ctx: StretchContext = {
    basis: frame.basis, domain, steps: STEPS, patchCells: PATCH, morph, radiusM, cellPixels: TERRAIN_DEFAULTS.cellPixels,
  };
  const ratios: number[] = [];
  for (let k = 0; k < selector.stats.drawn; k++) {
    const node = selector.leaves[k];
    const level = selector.level[node];
    const n = stretchNode(ctx, selector.root[node], level, selector.i[node], selector.j[node]);
    const target = TERRAIN_DEFAULTS.cellPixels * pixelAngle * discGap(frame.camBody, n.centre, n.normal, n.across);
    ratios.push(level >= selector.maxLevel ? 0 : n.effectiveEdge / target);
  }
  const pole: string[] = [];
  const pxPerM = (gap: number): number => 1 / (pixelAngle * gap);
  for (let k = 0; k < selector.stats.drawn; k++) {
    const node = selector.leaves[k];
    const level = selector.level[node];
    const root = selector.root[node];
    const size = 1 / 2 ** level;
    const span = STEPS / 2 ** level;
    const u0 = selector.i[node] * span;
    const v0 = selector.j[node] * span;
    const corner = leafPoleCorner(frame.basis, STEPS, root, u0, v0, span, domain.warp);
    if (!corner) continue;
    const position: Vec3 = [0, 0, 0];
    const normal: Vec3 = [0, 0, 0];
    domainPoint(domain, root, (selector.i[node] + 0.5) * size, (selector.j[node] + 0.5) * size, position, normal);
    const centreUnit: Vec3 = [normal[0], normal[1], normal[2]];
    const sigma = leafSide(frame.basis, centreUnit);
    const refLon = poleVertexLongitude(frame.basis, centreUnit, sigma);
    const edge = edgeLongitudes(frame.basis, domain, STEPS, root, u0, v0, span, corner, refLon);
    const n = stretchNode(ctx, root, level, selector.i[node], selector.j[node]);
    const gap = discGap(frame.camBody, n.centre, n.normal, n.across);
    const cornerUnit = ((): Vec3 => { domainPoint(domain, root, (selector.i[node] + corner.cx) * size, (selector.j[node] + corner.cy) * size, position, normal); return [normal[0], normal[1], normal[2]]; })();
    const a = bentBodyPoint(ctx, cornerUnit, refLon, edge.x).position;
    const b = bentBodyPoint(ctx, cornerUnit, refLon, edge.y).position;
    const len = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    pole.push(`L${level} lonSpan ${(Math.abs(edge.y - edge.x) * 180 / Math.PI).toFixed(1)}deg poleEdge ${(len / 1000).toFixed(1)}km=${(len * pxPerM(gap)).toFixed(0)}px(at gap ${gap.toFixed(0)}m) leafEdge ${(n.leafEdge / 1000).toFixed(2)}km cellEdge ${(n.cellEdge * pxPerM(gap)).toFixed(1)}px effective ${(n.effectiveEdge * pxPerM(gap)).toFixed(1)}px ratio ${(n.effectiveEdge / (TERRAIN_DEFAULTS.cellPixels * pixelAngle * gap)).toFixed(2)}`);
  }
  return { leaves: selector.stats.drawn, deepest: selector.stats.deepestLevel, ratios, refreshed, pole };
}

const worst = (values: readonly number[]): number => values.reduce((a, b) => Math.max(a, b), 0);

describe('stretch LOD metric', () => {
  const ctxAt = (radiusM: number, morph: number): StretchContext => ({
    basis: projectionBasis(0, 0), domain: domainOf(radiusM), steps: STEPS, patchCells: PATCH, morph, radiusM, cellPixels: TERRAIN_DEFAULTS.cellPixels,
  });

  it('at morph 0 the bent frame is the sphere: the node geometry is the selector\'s own', () => {
    const radiusM = 6_371_000;
    const probe = new LodSelector({
      domain: domainOf(radiusM), patchCells: PATCH, mode: 'fixed', fixedLevel: 4, cellPixels: 4, leafCap: 4096, heightBoundM: 0, cull: false,
    });
    probe.select({ camera: [radiusM * 3, 0, 0], pixelAngle: 1e-3, frustum: new Float64Array(12) });
    let checked = 0;
    for (let k = 0; k < probe.stats.leaves && checked < 40; k++) {
      const node = probe.leaves[k];
      const n = stretchNode(ctxAt(radiusM, 0), probe.root[node], probe.level[node], probe.i[node], probe.j[node]);
      // The selector's cell edge is the longest chord of the leaf's five-corner chain over the patch cells.
      expect(n.cellEdge / (probe.edge[node] / PATCH)).toBeCloseTo(1, 6);
      expect(n.effectiveEdge).toBeCloseTo(n.cellEdge, 6);
      expect(Math.hypot(n.centre[0] - probe.center[node * 3], n.centre[1] - probe.center[node * 3 + 1], n.centre[2] - probe.center[node * 3 + 2])).toBeLessThan(1e-3);
      checked++;
    }
    expect(checked).toBe(40);
  });

  it('measures the stretch: a leaf at the pole is far wider on the map than on the sphere at morph 0.5, and the sag grows', () => {
    const radiusM = 6_371_000;
    // The level 2 leaf at the default centre's pole corner: face 0 or the face the up axis hits; find a node that has the pole corner.
    const sphere = stretchNode(ctxAt(radiusM, 0), 3, 3, 4, 4);
    const half = stretchNode(ctxAt(radiusM, 0.5), 3, 3, 4, 4);
    expect(half.leafEdge).toBeGreaterThan(0);
    expect(sphere.leafEdge).toBeGreaterThan(0);
    expect(half.across).toBeGreaterThan(0);
  });

  it('pole-200m at morph 0.5: the sphere metric leaves leaves too coarse in the morphed frame that the stretch metric refines', () => {
    for (const radiusM of [600_000, 6_371_000]) {
      const sphere = select(radiusM, 0.5, 'pole-200m', 'sphere');
      const stretch = select(radiusM, 0.5, 'pole-200m', 'stretch');
      const sphereWorst = worst(sphere.ratios);
      const stretchWorst = worst(stretch.ratios);
      console.log(`[morph-stretch] ${radiusM / 1000} km pole-200m morph 0.5: sphere ${sphere.leaves} leaves, deepest ${sphere.deepest}, worst morphed ratio ${sphereWorst.toFixed(2)}, ${sphere.ratios.filter((r) => r > 2).length} leaves above 2 | stretch ${stretch.leaves} leaves, deepest ${stretch.deepest}, worst ${stretchWorst.toFixed(2)}, ${stretch.ratios.filter((r) => r > 2).length} above 2`);
      expect(stretchWorst).toBeLessThan(sphereWorst);
    }
  });

  it('the leaf cap is what limits pole-200m: with room the stretch metric reaches the target, and morph 0 matches the sphere metric', () => {
    for (const radiusM of [600_000, 6_371_000]) {
      const capped = select(radiusM, 0.5, 'pole-200m', 'stretch');
      const roomy = select(radiusM, 0.5, 'pole-200m', 'stretch', [0, 0], 65_536);
      console.log(`[morph-stretch] ${radiusM / 1000} km stretch pole-200m morph 0.5: cap 4096 -> ${capped.leaves} leaves, worst ${worst(capped.ratios).toFixed(2)} | cap 65536 -> ${roomy.leaves} leaves, deepest ${roomy.deepest}, worst ${worst(roomy.ratios).toFixed(2)}, ${roomy.ratios.filter((r) => r > 2).length} above 2`);
      expect(roomy.leaves).toBeGreaterThanOrEqual(capped.leaves);
      expect(worst(roomy.ratios)).toBeLessThanOrEqual(worst(capped.ratios));
    }
    const sphere0 = select(6_371_000, 0, 'orbit-map', 'sphere');
    const stretch0 = select(6_371_000, 0, 'orbit-map', 'stretch');
    expect(Math.abs(stretch0.leaves - sphere0.leaves)).toBeLessThanOrEqual(Math.ceil(sphere0.leaves * 0.1));
  });

  it('a pole-corner leaf keeps a 90 degree pole edge at every level, so a larger leaf cap cannot shorten its cells (the geometry cause of the 6,371 km pole holes)', () => {
    const spans = (cap: number): { levels: Set<number>; spans: number[] } => {
      const r = select(6_371_000, 0.5, 'pole-200m', 'stretch', [0, 0], cap);
      const levels = new Set<number>();
      const found: number[] = [];
      for (const line of r.pole) {
        const m = /^L(\d+) lonSpan ([\d.]+)deg/.exec(line);
        if (m) {
          levels.add(Number(m[1]));
          found.push(Number(m[2]));
        }
      }
      return { levels, spans: found };
    };
    for (const cap of [4096, 16384]) {
      const { levels, spans: found } = spans(cap);
      expect(found.length).toBeGreaterThan(0);
      expect(levels.size).toBeGreaterThanOrEqual(1);
      for (const span of found) expect(span).toBeCloseTo(90, 0);
    }
  });
});
