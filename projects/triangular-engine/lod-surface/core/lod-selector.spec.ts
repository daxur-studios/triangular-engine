import { domainPoint, type LodDomain, type Vec3 } from './lod-domain';
import { LodSelector, type NodeGeometryHook, type SelectorSettings, type SelectorView } from './lod-selector';

/** Plan 059, step G6c: the selector's per-node geometry hook. The default (no hook) is also covered by the older selector specs. */

const SPHERE: LodDomain = { kind: 'sphere', sizeM: 6_371_000, warp: 'equal-angle' };
const PIXEL = (2 * Math.tan(Math.PI / 6)) / 720;

function settings(extra: Partial<SelectorSettings> = {}): SelectorSettings {
  return { domain: SPHERE, patchCells: 16, mode: 'distance', fixedLevel: 3, cellPixels: 4, leafCap: 16_384, heightBoundM: 0, cull: false, hysteresis: 0.15, ...extra };
}

function view(altitude: number, nudge = 0): SelectorView {
  const r = SPHERE.sizeM + altitude;
  return { camera: [r * 0.2 + nudge, r * 0.9, r * 0.38], pixelAngle: PIXEL, frustum: new Float64Array(12) };
}

const keyOf = (selector: LodSelector, node: number): string => `${selector.root[node]}:${selector.level[node]}:${selector.i[node]}:${selector.j[node]}`;

function treeOf(selector: LodSelector): string {
  const keys: string[] = [];
  for (let k = 0; k < selector.stats.leaves; k++) keys.push(keyOf(selector, selector.leaves[k]));
  return keys.sort().join(' ');
}

/**
 * A hook that re-derives the default sphere geometry from the domain, with the cell length scaled by `cellScale`: with scale 1 it
 * must select what no hook selects; with another scale only the split changes.
 */
function mirrorHook(patchCells: number, cellScale: () => number = () => 1): NodeGeometryHook {
  const position: Vec3 = [0, 0, 0];
  const normal: Vec3 = [0, 0, 0];
  const around: Vec3[] = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
  return {
    measure(root, level, i, j, _lo, _hi, out) {
      const size = 1 / 2 ** level;
      domainPoint(SPHERE, root, (i + 0.5) * size, (j + 0.5) * size, position, normal);
      let radius = 0;
      let edge = 0;
      for (let k = 0; k < 4; k++) domainPoint(SPHERE, root, (i + (k === 1 || k === 2 ? 1 : 0)) * size, (j + (k >= 2 ? 1 : 0)) * size, around[k], [0, 0, 0]);
      for (let k = 0; k < 4; k++) {
        const a = around[k];
        const b = around[(k + 1) % 4];
        radius = Math.max(radius, Math.hypot(a[0] - position[0], a[1] - position[1], a[2] - position[2]));
        edge = Math.max(edge, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
      }
      for (let c = 0; c < 3; c++) {
        out.ground[c] = position[c];
        out.normal[c] = normal[c];
        out.centre[c] = position[c];
      }
      out.boundRadius = radius;
      out.across = radius;
      out.alongHalf = 0;
      out.leafEdge = edge;
      out.cellEdge = (edge / patchCells) * cellScale();
    },
  };
}

describe('Plan 059 G6c selector geometry hook', () => {
  it('removing a hook restores the default geometry and tree exactly, with no new selector', () => {
    const plain = new LodSelector(settings());
    const hooked = new LodSelector(settings());
    plain.select(view(5_000));
    hooked.setGeometryHook(mirrorHook(16, () => 0.5));
    hooked.select(view(5_000));
    expect(treeOf(hooked)).not.toBe(treeOf(plain));
    hooked.setGeometryHook(undefined);
    hooked.select(view(5_000));
    expect(treeOf(hooked)).toBe(treeOf(plain));
    const byKey = new Map<string, number>();
    for (let k = 0; k < plain.activeCount; k++) byKey.set(keyOf(plain, plain.active[k]), plain.active[k]);
    let compared = 0;
    for (let k = 0; k < hooked.activeCount; k++) {
      const node = hooked.active[k];
      const other = byKey.get(keyOf(hooked, node));
      if (other === undefined) continue;
      for (let c = 0; c < 3; c++) {
        expect(hooked.center[node * 3 + c]).toBe(plain.center[other * 3 + c]);
        expect(hooked.normal[node * 3 + c]).toBe(plain.normal[other * 3 + c]);
      }
      expect(hooked.radius[node]).toBe(plain.radius[other]);
      expect(hooked.edge[node]).toBe(plain.edge[other]);
      expect(hooked.gap(node, view(5_000).camera)).toBe(plain.gap(other, view(5_000).camera));
      compared++;
    }
    expect(compared).toBeGreaterThan(50);
  });

  it('a hook that re-derives the default geometry selects the default tree at several altitudes', () => {
    const plain = new LodSelector(settings());
    const hooked = new LodSelector(settings());
    hooked.setGeometryHook(mirrorHook(16));
    for (const altitude of [2, 200, 5_000, 50_000, 3_000_000]) {
      plain.select(view(altitude));
      hooked.select(view(altitude));
      expect(treeOf(hooked)).toBe(treeOf(plain));
    }
  });

  // No hysteresis below: with it, merging back lags by design, so the tree would depend on the path.
  it('the hook\'s cell length drives the split: larger cells give more leaves, and removing the hook gives the old count back', () => {
    const selector = new LodSelector(settings({ hysteresis: 0 }));
    selector.select(view(5_000));
    const base = selector.stats.leaves;
    selector.setGeometryHook(mirrorHook(16, () => 2));
    selector.select(view(5_000));
    expect(selector.stats.leaves).toBeGreaterThan(base);
    selector.setGeometryHook(undefined);
    selector.select(view(5_000));
    expect(selector.stats.leaves).toBe(base);
  });

  it('the deepest level never asks for a split, whatever cell length the hook reports', () => {
    const selector = new LodSelector(settings({ leafCap: 256 }));
    selector.setGeometryHook(mirrorHook(16, () => 1e12));
    selector.select(view(5_000));
    expect(selector.stats.deepestLevel).toBeLessThanOrEqual(selector.maxLevel);
    expect(selector.stats.capHit).toBeTrue();
  });

  it('invalidateGeometry rebuilds an unchanged view, and measures again only the nodes that join the tree', () => {
    const selector = new LodSelector(settings());
    let scale = 1;
    selector.setGeometryHook(mirrorHook(16, () => scale));
    const v = view(5_000);
    selector.select(v);
    const version = selector.version;
    selector.select(v);
    expect(selector.version).toBe(version);
    const before = selector.geometryRefreshes;
    scale = 0.5;
    selector.invalidateGeometry();
    selector.select(v);
    expect(selector.version).toBe(version + 1);
    expect(selector.geometryRefreshes - before).toBeGreaterThan(0);
    expect(selector.geometryRefreshes - before).toBeLessThanOrEqual(selector.activeCount);
    const settled = selector.geometryRefreshes;
    selector.select(view(5_000, 0.5));
    expect(selector.geometryRefreshes).toBe(settled);
  });

  it('allocates nothing: the typed arrays stay the same objects over hooked rebuilds and invalidations', () => {
    const selector = new LodSelector(settings());
    selector.setGeometryHook(mirrorHook(16));
    const names = ['center', 'normal', 'radius', 'edge', 'leaves', 'active', 'masks'] as const;
    const before = names.map((name) => selector[name]);
    for (let frame = 0; frame < 20; frame++) {
      if (frame % 3 === 0) selector.invalidateGeometry();
      selector.select(view(2 + frame * 3, frame * 0.01));
    }
    names.forEach((name, k) => expect(selector[name]).toBe(before[k]));
  });
});
