import { domainPoint, type LodDomain, type Vec3 } from './lod-domain';
import { LodSelector, NO_NEIGHBOUR, type NodeCoverHook, type NodeGeometryHook, type SelectorSettings, type SelectorView } from './lod-selector';

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

/** Plan 059, step G6e-a: the refresh budget of a geometry hook (the stale nodes measured per pass). */
describe('Plan 059 G6e-a selector refresh budget', () => {
  // No hysteresis: the tree is then a function of the geometry and the view alone, so a spread refresh must settle on the full one.
  const exact = (): SelectorSettings => settings({ hysteresis: 0 });

  /** {@link mirrorHook} with a refresh budget. */
  const budgeted = (budget: number, cellScale: () => number): NodeGeometryHook => ({ ...mirrorHook(16, cellScale), refreshBudget: budget });

  /** Selects `v` until a pass leaves no stale node in the tree; returns the passes and each pass's re-measures. */
  function settle(selector: LodSelector, v: SelectorView, cap = 1000): { passes: number; measured: number[] } {
    const measured: number[] = [];
    do {
      selector.select(v);
      measured.push(selector.stats.geometryMeasured);
    } while (selector.stats.geometryStale > 0 && measured.length < cap);
    return { passes: measured.length, measured };
  }

  it('a budget caps the re-measures of each pass; the spread settles on the full refresh tree; a settled view measures nothing', () => {
    const v = view(5_000);
    let scale = 1;
    const cellScale = (): number => scale;
    const spread = new LodSelector(exact());
    spread.setGeometryHook(budgeted(50, cellScale));
    spread.select(v);
    const full = new LodSelector(exact());
    full.setGeometryHook(mirrorHook(16, cellScale));
    full.select(v);
    scale = 0.5;
    spread.invalidateGeometry();
    full.invalidateGeometry();
    const fullBefore = full.geometryRefreshes;
    full.select(v);
    const fullCount = full.geometryRefreshes - fullBefore;
    const spreadBefore = spread.geometryRefreshes;
    const { passes, measured } = settle(spread, v);
    expect(fullCount).toBeGreaterThan(50);
    expect(Math.max(...measured)).toBeLessThanOrEqual(50);
    expect(measured.reduce((sum, m) => sum + m, 0)).toBe(spread.geometryRefreshes - spreadBefore);
    expect(passes).toBeGreaterThan(1);
    expect(passes).toBeLessThanOrEqual(Math.ceil(fullCount / 50));
    expect(treeOf(spread)).toBe(treeOf(full));
    const version = spread.version;
    spread.select(v);
    expect(spread.version).toBe(version);
    expect(spread.stats.geometryMeasured).toBe(0);
    expect(spread.stats.geometryStale).toBe(0);
  });

  it('with no budget, or an infinite one, a refresh is a single pass: the tree is the one before the budget existed', () => {
    const v = view(5_000);
    let scale = 1;
    const cellScale = (): number => scale;
    for (const hook of [mirrorHook(16, cellScale), budgeted(Infinity, cellScale)]) {
      const selector = new LodSelector(exact());
      selector.setGeometryHook(hook);
      selector.select(v);
      scale = 0.5;
      selector.invalidateGeometry();
      const before = selector.geometryRefreshes;
      selector.select(v);
      expect(selector.stats.geometryStale).toBe(0);
      expect(selector.stats.geometryMeasured).toBe(selector.geometryRefreshes - before);
      expect(selector.stats.geometryMeasured).toBeGreaterThan(50);
      scale = 1;
    }
  });

  it('a new trigger mid-spread restarts the sweep, and the budget still caps every pass, the settled tree being the full one', () => {
    const v = view(5_000);
    let scale = 1;
    const cellScale = (): number => scale;
    const spread = new LodSelector(exact());
    spread.setGeometryHook(budgeted(40, cellScale));
    spread.select(v);
    scale = 0.5;
    spread.invalidateGeometry();
    spread.select(v);
    expect(spread.stats.geometryMeasured).toBe(40);
    expect(spread.stats.geometryStale).toBeGreaterThan(0);
    scale = 0.25;
    spread.invalidateGeometry();
    spread.select(v);
    expect(spread.stats.geometryMeasured).toBeLessThanOrEqual(40);
    expect(spread.stats.geometryStale).toBeGreaterThan(0);
    const { measured } = settle(spread, v);
    expect(Math.max(...measured)).toBeLessThanOrEqual(40);
    const full = new LodSelector(exact());
    full.setGeometryHook(mirrorHook(16, cellScale));
    full.select(v);
    expect(treeOf(spread)).toBe(treeOf(full));
  });

  it('removing the hook mid-spread measures the whole tree in one pass, with the default geometry', () => {
    const v = view(5_000);
    const plain = new LodSelector(exact());
    plain.select(v);
    const selector = new LodSelector(exact());
    selector.setGeometryHook(budgeted(40, () => 0.5));
    selector.select(v);
    selector.invalidateGeometry();
    selector.select(v);
    expect(selector.stats.geometryStale).toBeGreaterThan(0);
    selector.setGeometryHook(undefined);
    selector.select(v);
    expect(selector.stats.geometryStale).toBe(0);
    expect(selector.stats.geometryMeasured).toBeGreaterThan(40);
    expect(treeOf(selector)).toBe(treeOf(plain));
  });
});

/** Plan 080 w2: the selector's cover hook (nodes hidden by something drawn in front of them take no budget). */
describe('Plan 080 selector cover hook', () => {
  const PLANE: LodDomain = { kind: 'plane', sizeM: 100_000, warp: 'equal-angle' };
  const planeView = (altitude = 200): SelectorView => ({ camera: [0, altitude, 0], pixelAngle: PIXEL, frustum: new Float64Array(12) });
  const planeSettings = (extra: Partial<SelectorSettings> = {}): SelectorSettings => settings({ domain: PLANE, leafCap: 600, ...extra });

  /** Covers a node lying entirely on the x < 0 side of the plane; counts its questions. */
  function westHook(): NodeCoverHook & { asked: number } {
    return {
      asked: 0,
      covered(node, selector) {
        this.asked++;
        return selector.center[node * 3] + selector.edge[node] / 2 < 0;
      },
    };
  }

  /** Drawn leaves whose centre is on the x > 0 side. */
  function eastLeaves(selector: LodSelector): number {
    let count = 0;
    for (let k = 0; k < selector.stats.drawn; k++) if (selector.center[selector.leaves[k] * 3] > 0) count++;
    return count;
  }

  it('a hook that covers nothing selects exactly what no hook selects', () => {
    const plain = new LodSelector(planeSettings());
    const hooked = new LodSelector(planeSettings());
    hooked.setCoverHook({ covered: () => false });
    plain.select(planeView());
    hooked.select(planeView());
    expect(treeOf(hooked)).toBe(treeOf(plain));
    expect(hooked.stats.drawn).toBe(plain.stats.drawn);
    expect(hooked.stats.covered).toBe(0);
  });

  it('covered leaves are not drawn: they follow the drawn ones and are counted', () => {
    const selector = new LodSelector(planeSettings());
    selector.setCoverHook(westHook());
    selector.select(planeView());
    const { drawn, covered, leaves } = selector.stats;
    expect(covered).toBeGreaterThan(0);
    expect(drawn + covered).toBeLessThanOrEqual(leaves);
    for (let k = 0; k < drawn; k++) {
      const node = selector.leaves[k];
      expect(selector.center[node * 3] + selector.edge[node] / 2).toBeGreaterThanOrEqual(0);
    }
    for (let k = drawn; k < drawn + covered; k++) {
      const node = selector.leaves[k];
      expect(selector.center[node * 3] + selector.edge[node] / 2).toBeLessThan(0);
    }
  });

  it('under a binding leaf cap the budget a covered leaf would take goes to the visible side', () => {
    const plain = new LodSelector(planeSettings());
    const hooked = new LodSelector(planeSettings());
    hooked.setCoverHook(westHook());
    plain.select(planeView());
    hooked.select(planeView());
    expect(plain.stats.capHit).toBe(true);
    expect(eastLeaves(hooked)).toBeGreaterThan(eastLeaves(plain));
    expect(hooked.stats.deepestLevel).toBeGreaterThanOrEqual(plain.stats.deepestLevel);
  });

  it('removing the hook restores the plain tree exactly (when the cap does not bind, so history is not a factor)', () => {
    // Under a binding cap the hysteresis ranking remembers the hooked tree; without one the tree depends on the view alone.
    const roomy = planeSettings({ leafCap: 16_384 });
    const plain = new LodSelector(roomy);
    const hooked = new LodSelector(roomy);
    plain.select(planeView(3_000));
    expect(plain.stats.capHit).toBe(false);
    hooked.setCoverHook(westHook());
    hooked.select(planeView(3_000));
    expect(treeOf(hooked)).not.toBe(treeOf(plain));
    hooked.setCoverHook(undefined);
    hooked.select(planeView(3_000));
    expect(treeOf(hooked)).toBe(treeOf(plain));
    expect(hooked.stats.covered).toBe(0);
  });

  it('asks once per node, and again for every node after invalidateCover', () => {
    const selector = new LodSelector(planeSettings());
    const hook = westHook();
    selector.setCoverHook(hook);
    selector.select(planeView());
    const first = hook.asked;
    const nudged = planeView();
    (nudged.camera as Vec3)[0] = 40;
    selector.select(nudged);
    // The nudged view can reach a few new nodes, but the nodes both trees share are not asked again.
    expect(hook.asked - first).toBeLessThan(first / 2);
    const before = hook.asked;
    selector.invalidateCover();
    selector.select(nudged);
    expect(hook.asked - before).toBeGreaterThanOrEqual(selector.activeCount);
  });

  it('invalidateCover makes an unchanged view reselect with the new answers', () => {
    const selector = new LodSelector(planeSettings());
    let covering = false;
    selector.setCoverHook({ covered: (node, s) => covering && s.center[node * 3] + s.edge[node] / 2 < 0 });
    const v = planeView();
    selector.select(v);
    expect(selector.stats.covered).toBe(0);
    covering = true;
    selector.select(v);
    expect(selector.stats.covered).toBe(0);
    selector.invalidateCover();
    selector.select(v);
    expect(selector.stats.covered).toBeGreaterThan(0);
  });

  it('a covered leaf next to a finer one is still split by the 2:1 balance, and stays undrawn', () => {
    const selector = new LodSelector(planeSettings({ leafCap: 4_000 }));
    // Everything on the west is covered; the camera is over the seam, so the finest west leaves touch the finest east ones.
    selector.setCoverHook(westHook());
    selector.select(planeView());
    expect(selector.stats.covered).toBeGreaterThan(0);
    // The tree is still a legal 2:1 tree: every leaf's edge mask only marks a neighbour one level coarser.
    for (let k = 0; k < selector.stats.leaves; k++) {
      const node = selector.leaves[k];
      for (let e = 0; e < 4; e++) {
        if (selector.neighbourRoot[node * 4 + e] === NO_NEIGHBOUR) continue;
        const other = selector.coveringNeighbour(node, e);
        expect(selector.level[node] - selector.level[other]).toBeLessThanOrEqual(1);
      }
    }
  });
});
