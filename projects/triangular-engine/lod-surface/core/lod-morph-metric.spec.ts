import { bend } from 'triangular-engine/atmosphere';
import { planetMapXY, type PlanetMapProjection } from 'triangular-engine/planet-material';
import { domainPoint, type LodDomain, type Vec3 } from './lod-domain';
import {
  DEFAULT_STRETCH_MORPH_STEP,
  DEFAULT_STRETCH_STALE_PAD_PER_MORPH,
  StretchMetric,
  stretchMapXY,
  stretchProjectionBasis,
  type StretchBasis,
  type StretchProjection,
} from './lod-morph-metric';
import { LodSelector, type NodeGeometry } from './lod-selector';

/**
 * Plan 059, step G6c: the stretch-aware metric. Headless; run with the lod-surface specs.
 */

const R = 6_371_000;
const PATCH = 16;
const CELL_PIXELS = 4;
const FOV = (60 * Math.PI) / 180;
const PIXEL_ANGLE = (2 * Math.tan(FOV / 2)) / 576;
const ZERO_FRUSTUM = new Float64Array(12);
const PROJECTIONS: readonly StretchProjection[] = ['equal-earth', 'equirectangular'];

const domainOf = (radiusM: number): LodDomain => ({ kind: 'sphere', sizeM: radiusM, warp: 'equal-angle' });

function selectorOf(radiusM: number, leafCap = 4096, cull = false, hysteresis = 0.15): LodSelector {
  return new LodSelector({ domain: domainOf(radiusM), patchCells: PATCH, mode: 'distance', fixedLevel: 3, cellPixels: CELL_PIXELS, leafCap, heightBoundM: 0, cull, hysteresis });
}

interface Pose {
  readonly lonDeg: number;
  readonly latDeg: number;
  readonly altitudeM: number;
}

/** The spike's named views (longitude and latitude from the projection centre). */
const POSES = {
  'mid-2m': { lonDeg: 40, latDeg: 35, altitudeM: 2 },
  'pole-2m': { lonDeg: 20, latDeg: 89.5, altitudeM: 2 },
  'pole-200m': { lonDeg: 20, latDeg: 89.9, altitudeM: 200 },
  'cut-2m': { lonDeg: 179.9, latDeg: 20, altitudeM: 2 },
  'centre-2m': { lonDeg: 0, latDeg: 0, altitudeM: 2 },
} as const satisfies Record<string, Pose>;
type PoseId = keyof typeof POSES;

const DEG = Math.PI / 180;

function directionOf(basis: StretchBasis, lonDeg: number, latDeg: number): Vec3 {
  const lon = lonDeg * DEG;
  const lat = latDeg * DEG;
  const cl = Math.cos(lat);
  return [0, 1, 2].map((k) => basis.right[k] * cl * Math.sin(lon) + basis.up[k] * Math.sin(lat) + basis.forward[k] * cl * Math.cos(lon)) as Vec3;
}

const treeOf = (selector: LodSelector): string => {
  const keys: string[] = [];
  for (let k = 0; k < selector.stats.leaves; k++) {
    const node = selector.leaves[k];
    keys.push(`${selector.root[node]}:${selector.level[node]}:${selector.i[node]}:${selector.j[node]}`);
  }
  return keys.sort().join(' ');
};

/** The selector's distance to a node's split box (its `boxGap`), from a node geometry. */
function gapTo(camera: Vec3, g: NodeGeometry): number {
  const x = camera[0] - g.centre[0];
  const y = camera[1] - g.centre[1];
  const z = camera[2] - g.centre[2];
  const up = x * g.normal[0] + y * g.normal[1] + z * g.normal[2];
  const side = Math.max(Math.sqrt(Math.max(x * x + y * y + z * z - up * up, 0)) - g.across, 0);
  const above = Math.max(Math.abs(up) - g.alongHalf, 0);
  return Math.max(Math.hypot(side, above), 1e-3);
}

const newGeometry = (): NodeGeometry => ({ ground: [0, 0, 0], normal: [0, 0, 0], centre: [0, 0, 0], boundRadius: 0, across: 0, alongHalf: 0, leafEdge: 0, cellEdge: 0 });

interface NodeAddress {
  readonly root: number;
  readonly level: number;
  readonly i: number;
  readonly j: number;
}

/** The leaves of a selector's current tree. */
function leavesOf(selector: LodSelector): NodeAddress[] {
  const out: NodeAddress[] = [];
  for (let k = 0; k < selector.stats.leaves; k++) {
    const node = selector.leaves[k];
    out.push({ root: selector.root[node], level: selector.level[node], i: selector.i[node], j: selector.j[node] });
  }
  return out;
}

/** Cell length over the pixel target: above 1 the node is too coarse where the map puts it. */
function splitRatio(metric: StretchMetric, node: NodeAddress, camera: Vec3, scratch = newGeometry()): number {
  metric.measure(node.root, node.level, node.i, node.j, 0, 0, scratch);
  return scratch.cellEdge / (CELL_PIXELS * PIXEL_ANGLE * gapTo(camera, scratch));
}

/** One selection of `pose` at `morph` with (or, with `metric` undefined, without) the stretch metric, as the scene does it. */
function selectPose(selector: LodSelector, metric: StretchMetric | undefined, pose: Pose, morph: number, basis = stretchProjectionBasis(0, 0)): Vec3 {
  const dir = directionOf(basis, pose.lonDeg, pose.latDeg);
  let camera: Vec3;
  if (metric) {
    metric.update({ morph, basis });
    camera = metric.selectionPoint(dir, pose.altitudeM);
  } else {
    const r = selector.settings.domain.sizeM + pose.altitudeM;
    camera = [dir[0] * r, dir[1] * r, dir[2] * r];
  }
  selector.select({ camera, pixelAngle: PIXEL_ANGLE, frustum: ZERO_FRUSTUM });
  return camera;
}

describe('Plan 059 G6c stretch metric: the map', () => {
  it('stretchMapXY is planetMapXY: the worker-safe copy matches the material\'s map exactly', () => {
    const a: [number, number] = [0, 0];
    let checked = 0;
    for (const projection of PROJECTIONS as readonly PlanetMapProjection[]) {
      for (const morph of [0, 0.1, 0.5, 0.9, 1]) {
        for (let lat = -90; lat <= 90; lat += 7.5) {
          for (let lon = -180; lon <= 180; lon += 22.5) {
            const expected = planetMapXY(lon * DEG, lat * DEG, morph, projection, R);
            stretchMapXY(lon * DEG, lat * DEG, morph, projection, R, a);
            expect(a[0]).toBe(expected[0]);
            expect(a[1]).toBe(expected[1]);
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1500);
  });

  it('the bent point is bend() of planetMapXY, and the globe at morph 0', () => {
    const basis = stretchProjectionBasis(35, 20);
    const selector = selectorOf(R, 64);
    for (const projection of PROJECTIONS) {
      for (const morph of [0, 0.3, 0.7, 1]) {
        const metric = new StretchMetric(selector, { radiusM: R, projection, basis, morph });
        for (const [lonDeg, latDeg] of [[0, 0], [50, 30], [-120, -60], [170, 10]]) {
          const dir = directionOf(basis, lonDeg, latDeg);
          const got = metric.bentPoint(dir, 120);
          const [x, y] = planetMapXY(lonDeg * DEG, latDeg * DEG, morph, projection, R);
          const b = bend(x, y, (1 - morph) / R, 120);
          for (let c = 0; c < 3; c++) {
            const map = [b.position[0], b.position[1], b.position[2] + (1 - morph) * R];
            const expected = basis.right[c] * map[0] + basis.up[c] * map[1] + basis.forward[c] * map[2];
            expect(Math.abs(got[c] - expected)).toBeLessThan(1e-4);
          }
          if (morph === 0) for (let c = 0; c < 3; c++) expect(Math.abs(got[c] - dir[c] * (R + 120))).toBeLessThan(1e-4);
        }
        metric.dispose();
      }
    }
  });
});

describe('Plan 059 G6c stretch metric: selection', () => {
  it('at morph 0 no hook is installed and the selection is the sphere selection, before and after a sweep', () => {
    for (const id of Object.keys(POSES) as PoseId[]) {
      // No hysteresis and a cap the view stays under: the tree is then a function of the view alone, not of the path to it.
      const plain = selectorOf(R, 65_536, false, 0);
      selectPose(plain, undefined, POSES[id], 0);
      const selector = selectorOf(R, 65_536, false, 0);
      const metric = new StretchMetric(selector, { radiusM: R });
      expect(selector.hook).toBeUndefined();
      selectPose(selector, metric, POSES[id], 0);
      expect(treeOf(selector)).toBe(treeOf(plain));
      expect(selector.geometryRefreshes).toBe(0);
      // Sweep up and back: same selector, same tree once morph is exactly 0 again.
      for (const morph of [0.2, 0.5, 0.2, 0]) selectPose(selector, metric, POSES[id], morph);
      expect(selector.hook).toBeUndefined();
      expect(treeOf(selector)).toBe(treeOf(plain));
    }
  });

  it('at a tiny morph the node geometry is the sphere\'s (centre, edge, bounds) apart from the stale pad', () => {
    const plain = selectorOf(R);
    selectPose(plain, undefined, POSES['mid-2m'], 0);
    const selector = selectorOf(R);
    const metric = new StretchMetric(selector, { radiusM: R, morph: 1e-9, stalePadPerMorph: 0 });
    const out = newGeometry();
    let checked = 0;
    for (let k = 0; k < plain.stats.leaves && checked < 60; k++) {
      const node = plain.leaves[k];
      metric.measure(plain.root[node], plain.level[node], plain.i[node], plain.j[node], 0, 0, out);
      expect(Math.hypot(out.ground[0] - plain.center[node * 3], out.ground[1] - plain.center[node * 3 + 1], out.ground[2] - plain.center[node * 3 + 2])).toBeLessThan(0.05);
      expect(out.leafEdge / plain.edge[node]).toBeCloseTo(1, 6);
      expect(out.cellEdge / (plain.edge[node] / PATCH)).toBeCloseTo(1, 6);
      checked++;
    }
    expect(checked).toBe(60);
  });

  it('stretches a pole-corner leaf: its pole edge is the map\'s edge, 90 degrees of longitude at every level', () => {
    const selector = selectorOf(R, 64);
    const equirect = new StretchMetric(selector, { radiusM: R, projection: 'equirectangular', morph: 1, stalePadPerMorph: 0 });
    const earth = new StretchMetric(selector, { radiusM: R, projection: 'equal-earth', morph: 1, stalePadPerMorph: 0 });
    const out = newGeometry();
    const sphere = selectorOf(R, 64);
    const poleHalf = planetMapXY(Math.PI / 2, Math.PI / 2, 1, 'equal-earth', R)[0];
    for (let level = 1; level <= 6; level++) {
      // The default basis puts the north pole at the centre of face 2, a corner of the four level 1 leaves.
      const edge = 2 ** level / 2;
      const i = edge - 1;
      const j = edge - 1;
      equirect.measure(2, level, i, j, 0, 0, out);
      expect(out.leafEdge).toBeGreaterThanOrEqual(R * (Math.PI / 2) * (1 - 1e-9));
      earth.measure(2, level, i, j, 0, 0, out);
      expect(out.leafEdge).toBeGreaterThanOrEqual(poleHalf * (1 - 1e-9));
      // The sphere's leaf at that level shrinks with the level; the map's pole edge does not.
      void sphere;
    }
    earth.measure(2, 6, 31, 31, 0, 0, out);
    const mapEdge = out.leafEdge;
    const sphereEdge = (R * Math.PI) / 2 / 2 ** 6;
    expect(mapEdge / sphereEdge).toBeGreaterThan(30);
  });

  it('a leaf with a pole strictly inside is as big as the map: it splits and is never culled', () => {
    const selector = selectorOf(R, 64);
    const metric = new StretchMetric(selector, { radiusM: R, morph: 0.5 });
    const out = newGeometry();
    metric.measure(2, 0, 0, 0, -100, 300, out);
    expect(out.boundRadius).toBeGreaterThan(R * 6);
    expect(out.cellEdge).toBeGreaterThan((R / PATCH) * 6);
  });

  for (const radiusM of [600_000, R]) {
    it(`pole-200m at morph 0.5, ${radiusM / 1000} km: the stretch metric leaves the leaves finer in the morphed frame than the sphere metric`, () => {
      const sphere = selectorOf(radiusM);
      selectPose(sphere, undefined, POSES['pole-200m'], 0);
      const stretchSelector = selectorOf(radiusM);
      const metric = new StretchMetric(stretchSelector, { radiusM, morph: 0.5, stalePadPerMorph: 0 });
      const camera = selectPose(stretchSelector, metric, POSES['pole-200m'], 0.5);
      // Judge both trees in the morphed frame with the bent camera.
      const judge = new StretchMetric(selectorOf(radiusM, 64), { radiusM, morph: 0.5, stalePadPerMorph: 0 });
      const worst = (leaves: NodeAddress[]): number => leaves.reduce((w, node) => (node.level >= 20 ? w : Math.max(w, splitRatio(judge, node, camera))), 0);
      const sphereWorst = worst(leavesOf(sphere));
      const stretchWorst = worst(leavesOf(stretchSelector));
      console.log(`[morph-metric] ${radiusM / 1000} km pole-200m morph 0.5: sphere ${sphere.stats.leaves} leaves worst ratio ${sphereWorst.toFixed(2)} | stretch ${stretchSelector.stats.leaves} leaves worst ${stretchWorst.toFixed(2)}`);
      expect(stretchWorst).toBeLessThan(sphereWorst);
    });
  }
});

describe('Plan 059 G6c stretch metric: refresh policy', () => {
  /** A stretch selector with one selection at `morph`, returning what the policy specs count. */
  function setup(morph: number, options: { morphStep?: number } = {}): { selector: LodSelector; metric: StretchMetric; frame: (morph: number) => void } {
    const selector = selectorOf(R);
    const metric = new StretchMetric(selector, { radiusM: R, morph, ...options });
    const dir = directionOf(stretchProjectionBasis(0, 0), POSES['pole-2m'].lonDeg, POSES['pole-2m'].latDeg);
    const frame = (m: number): void => {
      metric.update({ morph: m });
      selector.select({ camera: metric.selectionPoint(dir, 2), pixelAngle: PIXEL_ANGLE, frustum: ZERO_FRUSTUM });
    };
    frame(morph);
    return { selector, metric, frame };
  }

  it('nothing refreshes while the morph stays within the step of where it was measured', () => {
    const { selector, metric } = setup(0.5);
    const measured = metric.stats.measured;
    const refreshes = selector.geometryRefreshes;
    const version = selector.version;
    const camera = metric.selectionPoint(directionOf(stretchProjectionBasis(0, 0), POSES['pole-2m'].lonDeg, POSES['pole-2m'].latDeg), 2);
    for (const morph of [0.503, 0.497, 0.505, 0.4951, 0.5049, 0.5]) {
      expect(metric.update({ morph })).toBeFalse();
      // The selection frame is the measured one: the camera does not move below the step, so nothing is rebuilt either.
      selector.select({ camera, pixelAngle: PIXEL_ANGLE, frustum: ZERO_FRUSTUM });
    }
    expect(selector.version).toBe(version);
    expect(metric.stats.invalidations).toBe(0);
    expect(metric.stats.measured).toBe(measured);
    expect(selector.geometryRefreshes).toBe(refreshes);
    expect(metric.update({ morph: 0.5 + DEFAULT_STRETCH_MORPH_STEP * 1.01 })).toBeTrue();
    expect(metric.stats.invalidations).toBe(1);
    expect(metric.measuredMorph).toBeCloseTo(0.5101, 6);
  });

  it('a refresh re-measures only the tree\'s nodes, when they join it, and a repeated view costs nothing', () => {
    const { selector, metric, frame } = setup(0.5);
    const before = metric.stats.measured;
    frame(0.52);
    const measured = metric.stats.measured - before;
    expect(measured).toBeGreaterThan(0);
    expect(measured).toBeLessThanOrEqual(selector.activeCount + 4 * 6);
    const again = metric.stats.measured;
    frame(0.52);
    expect(metric.stats.measured).toBe(again);
  });

  it('crossing 0 installs and removes the hook; projection, radius and basis changes refresh only above 0', () => {
    const selector = selectorOf(R, 256);
    const metric = new StretchMetric(selector, { radiusM: R });
    expect(metric.update({ projection: 'equirectangular' })).toBeFalse();
    expect(metric.update({ basis: stretchProjectionBasis(30, 10) })).toBeFalse();
    expect(selector.hook).toBeUndefined();
    expect(metric.update({ morph: 0.0001 })).toBeTrue();
    expect(selector.hook).toBe(metric);
    expect(metric.update({ projection: 'equal-earth' })).toBeTrue();
    expect(metric.update({ basis: stretchProjectionBasis(31, 10) })).toBeTrue();
    expect(metric.update({ radiusM: R * 2 })).toBeTrue();
    expect(metric.update({ morph: 0.0002 })).toBeFalse();
    expect(metric.update({ morph: 0 })).toBeTrue();
    expect(selector.hook).toBeUndefined();
    expect(metric.update({ projection: 'equirectangular' })).toBeFalse();
    metric.update({ morph: 0.5 });
    metric.dispose();
    expect(selector.hook).toBeUndefined();
  });

  it('a scripted sweep 0 to 1 over 100 frames refreshes at most steps x touched nodes, and a coarser step refreshes less', () => {
    const run = (step: number): { invalidations: number; measured: number; touched: number; perFrame: number } => {
      const selector = selectorOf(R);
      const metric = new StretchMetric(selector, { radiusM: R, morphStep: step });
      const dir = directionOf(stretchProjectionBasis(0, 0), POSES['pole-2m'].lonDeg, POSES['pole-2m'].latDeg);
      const touched = new Set<number>();
      let total = 0;
      for (let frame = 0; frame <= 100; frame++) {
        metric.update({ morph: frame / 100 });
        selector.select({ camera: metric.selectionPoint(dir, 2), pixelAngle: PIXEL_ANGLE, frustum: ZERO_FRUSTUM });
        total += selector.activeCount;
        for (let k = 0; k < selector.activeCount; k++) touched.add(selector.active[k]);
      }
      return { invalidations: metric.stats.invalidations, measured: metric.stats.measured, touched: touched.size, perFrame: total / 101 };
    };
    const fine = run(DEFAULT_STRETCH_MORPH_STEP);
    const coarse = run(0.05);
    console.log(`[morph-metric] sweep 0..1 in 100 frames, step 0.01: ${fine.invalidations} refreshes, ${fine.measured} nodes measured, ${fine.touched} nodes touched, ${fine.perFrame.toFixed(0)} per frame | step 0.05: ${coarse.invalidations}, ${coarse.measured}`);
    expect(fine.invalidations).toBeLessThanOrEqual(Math.ceil(1 / DEFAULT_STRETCH_MORPH_STEP) + 1);
    expect(fine.measured).toBeLessThanOrEqual((Math.ceil(1 / DEFAULT_STRETCH_MORPH_STEP) + 1) * fine.touched);
    expect(coarse.invalidations).toBeLessThanOrEqual(Math.ceil(1 / 0.05) + 1);
    expect(coarse.measured).toBeLessThanOrEqual((Math.ceil(1 / 0.05) + 1) * coarse.touched);
    expect(coarse.measured).toBeLessThan(fine.measured / 2);
    // A slow sweep (0.002 a frame) refreshes once per five frames at the default step.
    const selector = selectorOf(R);
    const metric = new StretchMetric(selector, { radiusM: R });
    for (let frame = 0; frame <= 250; frame++) metric.update({ morph: frame * 0.002 });
    expect(metric.stats.invalidations).toBeLessThanOrEqual(Math.ceil(0.5 / 0.01) + 2);
  });
});

describe('Plan 059 G6c stretch metric: stale measurements err on the safe side', () => {
  it('a node measured one step ago, padded, asks for the same refinement as a fresh one (poses x morphs x both directions)', () => {
    const step = DEFAULT_STRETCH_MORPH_STEP;
    const basis = stretchProjectionBasis(0, 0);
    const scratch = newGeometry();
    const stale = newGeometry();
    let nodes = 0;
    let band = 0;
    let misses = 0;
    let worstGrowth = 0;
    let worstMiss = '';
    const growths: number[] = [];
    const perPose = new Map<string, number>();
    for (const projection of PROJECTIONS) {
      for (const id of Object.keys(POSES) as PoseId[]) {
        for (const morph of [0.05, 0.2, 0.5, 0.8, 0.95]) {
          // The realistic node set: the leaves the stretch metric itself selects for this view.
          const selector = selectorOf(R);
          const metric = new StretchMetric(selector, { radiusM: R, projection, basis, morph, stalePadPerMorph: 0 });
          const camera = selectPose(selector, metric, POSES[id], morph, basis);
          const leaves = leavesOf(selector);
          for (const lag of [-step, step]) {
            const old = new StretchMetric(selectorOf(R, 64), { radiusM: R, projection, basis, morph: morph - lag, stalePadPerMorph: 0 });
            const padded = new StretchMetric(selectorOf(R, 64), { radiusM: R, projection, basis, morph: morph - lag });
            const sameCamera = padded.selectionPoint(directionOf(basis, POSES[id].lonDeg, POSES[id].latDeg), POSES[id].altitudeM);
            const paddedGeometry = newGeometry();
            const staleCamera = old.selectionPoint(directionOf(basis, POSES[id].lonDeg, POSES[id].latDeg), POSES[id].altitudeM);
            for (let k = 0; k < leaves.length; k += 3) {
              const node = leaves[k];
              if (node.level >= 20) continue;
              const fresh = splitRatio(metric, node, camera, scratch);
              // The stale measurement against the camera of ITS frame: what the selector sees between refreshes.
              old.measure(node.root, node.level, node.i, node.j, 0, 0, stale);
              const staleRatio = stale.cellEdge / (CELL_PIXELS * PIXEL_ANGLE * gapTo(staleCamera, stale));
              nodes++;
              // Only nodes near the split threshold can flip: far below or above it a few percent change nothing.
              if (staleRatio < 0.2 || staleRatio > 5 || fresh <= 0) continue;
              band++;
              const growth = (fresh / staleRatio - 1) / step;
              growths.push(growth);
              perPose.set(`${projection} ${id}`, Math.max(perPose.get(`${projection} ${id}`) ?? 0, growth));
              worstGrowth = Math.max(worstGrowth, growth);
              padded.measure(node.root, node.level, node.i, node.j, 0, 0, paddedGeometry);
              const paddedRatio = paddedGeometry.cellEdge / (CELL_PIXELS * PIXEL_ANGLE * gapTo(sameCamera, paddedGeometry));
              if (fresh >= 1 && paddedRatio < 1) {
                misses++;
                worstMiss = `${projection} ${id} morph ${morph} level ${node.level}: fresh ${fresh.toFixed(3)} stale ${staleRatio.toFixed(3)}`;
              }
            }
          }
        }
      }
    }
    console.log(`[morph-metric] stale lag of one step: ${nodes} node measurements, ${band} near the threshold (stale ratio 0.2 to 5); worst growth of the fresh ratio over the stale one ${(worstGrowth * 100).toFixed(1)}% per unit morph (pad ${DEFAULT_STRETCH_STALE_PAD_PER_MORPH * 100}%); nodes whose padded stale ratio is under 1 where the fresh one is not: ${misses}${worstMiss ? ' (last: ' + worstMiss + ')' : ''}`);
    growths.sort((a, b) => a - b);
    const pct = (q: number): string => (growths[Math.floor(growths.length * q)] * 100).toFixed(0);
    console.log(`[morph-metric] growth percentiles (percent per unit morph): 50% ${pct(0.5)}, 90% ${pct(0.9)}, 99% ${pct(0.99)}, 99.9% ${pct(0.999)}; worst per pose: ${[...perPose].map(([k, v]) => `${k} ${(v * 100).toFixed(0)}`).join(', ')}`);
    expect(band).toBeGreaterThan(200);
    expect(misses / band).toBeLessThan(0.0005);
  });
});

describe('Plan 059 G6c stretch metric: bent culling bounds', () => {
  /** Samples a leaf on a 9 x 9 grid at three heights, in the bent frame, and returns how far outside its bounds the worst sample is (<= 0: inside). */
  function worstOutside(metric: StretchMetric, basis: StretchBasis, node: NodeAddress, lo: number, hi: number): { sphere: number; across: number; along: number } {
    const g = newGeometry();
    metric.measure(node.root, node.level, node.i, node.j, lo, hi, g);
    const domain = domainOf(R);
    const size = 1 / 2 ** node.level;
    const p: Vec3 = [0, 0, 0];
    const n: Vec3 = [0, 0, 0];
    domainPoint(domain, node.root, (node.i + 0.5) * size, (node.j + 0.5) * size, p, n);
    const refLon = Math.atan2(n[0] * basis.right[0] + n[1] * basis.right[1] + n[2] * basis.right[2], n[0] * basis.forward[0] + n[1] * basis.forward[1] + n[2] * basis.forward[2]);
    const out: Vec3 = [0, 0, 0];
    let sphere = -Infinity;
    let across = -Infinity;
    let along = -Infinity;
    const GRID = 8;
    for (let a = 0; a <= GRID; a++) {
      for (let b = 0; b <= GRID; b++) {
        domainPoint(domain, node.root, (node.i + a / GRID) * size, (node.j + b / GRID) * size, p, n);
        // The exact pole has no longitude of its own: the leaf's pole corner is bounded by its edge copies instead.
        const v1 = n[0] * basis.forward[0] + n[1] * basis.forward[1] + n[2] * basis.forward[2];
        const v2 = n[0] * basis.right[0] + n[1] * basis.right[1] + n[2] * basis.right[2];
        if (v1 * v1 + v2 * v2 < 1e-18) continue;
        for (const h of [lo, (lo + hi) / 2, hi]) {
          metric.bentPoint(n, h, out, refLon);
          sphere = Math.max(sphere, Math.hypot(out[0] - g.centre[0], out[1] - g.centre[1], out[2] - g.centre[2]) - g.boundRadius);
          const dx = out[0] - g.centre[0];
          const dy = out[1] - g.centre[1];
          const dz = out[2] - g.centre[2];
          const up = dx * g.normal[0] + dy * g.normal[1] + dz * g.normal[2];
          across = Math.max(across, Math.sqrt(Math.max(dx * dx + dy * dy + dz * dz - up * up, 0)) - g.across);
          along = Math.max(along, Math.abs(up) - g.alongHalf);
        }
      }
    }
    return { sphere, across, along };
  }

  it('every bent sample of every leaf (levels 0 to 3, both maps, two projection centres) lies inside its bounds, padded by the height range', () => {
    let nodes = 0;
    let worst = -Infinity;
    for (const projection of PROJECTIONS) {
      for (const centre of [[0, 0], [35, 25]]) {
        const basis = stretchProjectionBasis(centre[0], centre[1]);
        for (const morph of [0.3, 1]) {
          const selector = selectorOf(R, 64);
          const metric = new StretchMetric(selector, { radiusM: R, projection, basis, morph });
          for (let level = 0; level <= 3; level++) {
            for (let root = 0; root < 6; root++) {
              for (let i = 0; i < 2 ** level; i++) {
                for (let j = 0; j < 2 ** level; j++) {
                  const r = worstOutside(metric, basis, { root, level, i, j }, -300, 900);
                  worst = Math.max(worst, r.sphere / R, r.across / R, r.along / R);
                  if (r.sphere > 1e-6 || r.across > 1e-6 || r.along > 1e-6) {
                    fail(`${projection} centre ${centre} morph ${morph} node ${root}:${level}:${i}:${j} sample outside: sphere ${r.sphere.toFixed(1)} m, across ${r.across.toFixed(1)} m, along ${r.along.toFixed(1)} m`);
                  }
                  nodes++;
                }
              }
            }
          }
        }
      }
    }
    console.log(`[morph-metric] bounds: ${nodes} nodes, worst sample distance outside the bounds ${(worst * R).toFixed(1)} m (negative: inside)`);
    expect(nodes).toBeGreaterThan(4000);
  });

  it('the deep leaves of a real view (pole 200 m, cut 2 m, mid 2 m at morph 0.5) hold their bent samples', () => {
    const basis = stretchProjectionBasis(0, 0);
    let nodes = 0;
    for (const id of ['pole-200m', 'cut-2m', 'mid-2m'] as PoseId[]) {
      const selector = selectorOf(R);
      const metric = new StretchMetric(selector, { radiusM: R, morph: 0.5 });
      selectPose(selector, metric, POSES[id], 0.5, basis);
      for (const node of leavesOf(selector)) {
        const r = worstOutside(metric, basis, node, -50, 400);
        if (r.sphere > 1e-6 || r.across > 1e-6 || r.along > 1e-6) {
          fail(`${id} node ${node.root}:${node.level}:${node.i}:${node.j} sample outside: sphere ${r.sphere} across ${r.across} along ${r.along}`);
        }
        nodes++;
      }
    }
    expect(nodes).toBeGreaterThan(1500);
  });

  it('a hooked selector culls with the bent bounds: a leaf the camera looks at is drawn, one behind it is not', () => {
    const selector = selectorOf(R, 4096, true);
    const metric = new StretchMetric(selector, { radiusM: R, morph: 0.5 });
    const basis = stretchProjectionBasis(0, 0);
    const dir = directionOf(basis, 40, 35);
    const camera = metric.selectionPoint(dir, 200);
    const up = metric.bentNormal(dir);
    // Look straight down the bent up: right and forward are any perpendicular pair.
    const right: Vec3 = Math.abs(up[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const dotUR = up[0] * right[0] + up[1] * right[1] + up[2] * right[2];
    const r: Vec3 = [right[0] - dotUR * up[0], right[1] - dotUR * up[1], right[2] - dotUR * up[2]];
    const rl = Math.hypot(r[0], r[1], r[2]);
    const rr: Vec3 = [r[0] / rl, r[1] / rl, r[2] / rl];
    const f: Vec3 = [-up[0], -up[1], -up[2]];
    const u: Vec3 = [f[1] * rr[2] - f[2] * rr[1], f[2] * rr[0] - f[0] * rr[2], f[0] * rr[1] - f[1] * rr[0]];
    const frustum = new Float64Array(12);
    const ay = FOV / 2;
    const ax = Math.atan(Math.tan(ay) * (16 / 9));
    for (let k = 0; k < 3; k++) {
      frustum[k] = Math.cos(ax) * rr[k] + Math.sin(ax) * f[k];
      frustum[3 + k] = -Math.cos(ax) * rr[k] + Math.sin(ax) * f[k];
      frustum[6 + k] = Math.cos(ay) * u[k] + Math.sin(ay) * f[k];
      frustum[9 + k] = -Math.cos(ay) * u[k] + Math.sin(ay) * f[k];
    }
    selector.select({ camera, pixelAngle: PIXEL_ANGLE, frustum });
    expect(selector.stats.drawn).toBeGreaterThan(0);
    expect(selector.stats.drawn).toBeLessThan(selector.stats.leaves);
    // The leaf under the camera is drawn.
    const under = metric.selectionPoint(dir, 0);
    let covered = false;
    for (let k = 0; k < selector.stats.drawn; k++) {
      const node = selector.leaves[k];
      const d = Math.hypot(under[0] - selector.center[node * 3], under[1] - selector.center[node * 3 + 1], under[2] - selector.center[node * 3 + 2]);
      if (d <= selector.radius[node]) covered = true;
    }
    expect(covered).toBeTrue();
  });
});

describe('Plan 059 G6c stretch metric: cost', () => {
  it('selection CPU time, 6,371 km, 2 m altitude near the pole, morph 0.5 (printed, not judged)', () => {
    const selector = selectorOf(R);
    const sphere = selectorOf(R);
    const metric = new StretchMetric(selector, { radiusM: R, morph: 0.5 });
    const dir = directionOf(stretchProjectionBasis(0, 0), POSES['pole-2m'].lonDeg, POSES['pole-2m'].latDeg);
    const camera = (nudge: number): Vec3 => metric.selectionPoint(dir, 2 + nudge);
    const sphereCamera = (nudge: number): Vec3 => [dir[0] * (R + 2 + nudge), dir[1] * (R + 2 + nudge), dir[2] * (R + 2 + nudge)];
    const view = (c: Vec3) => ({ camera: c, pixelAngle: PIXEL_ANGLE, frustum: ZERO_FRUSTUM });
    for (let w = 0; w < 30; w++) {
      selector.select(view(camera(w * 0.01)));
      sphere.select(view(sphereCamera(w * 0.01)));
    }
    const steady = (s: LodSelector, cam: (n: number) => Vec3, frames: number): number => {
      const t0 = performance.now();
      for (let f = 0; f < frames; f++) s.select(view(cam(0.5 + (f % 7) * 0.003)));
      return (performance.now() - t0) / frames;
    };
    const sweep = (frames: number): number => {
      let morph = 0.5;
      const t0 = performance.now();
      for (let f = 0; f < frames; f++) {
        morph += f % 2 === 0 ? 0.02 : -0.02;
        metric.update({ morph });
        selector.select(view(camera(0.5)));
      }
      return (performance.now() - t0) / frames;
    };
    const steadyMs = steady(selector, camera, 300);
    const sweepMs = sweep(60);
    const sphereMs = steady(sphere, sphereCamera, 300);
    console.log(`[morph-metric] selection CPU, ${R / 1000} km, 2 m near the pole, morph 0.5, ${selector.stats.leaves} leaves: steady frame ${steadyMs.toFixed(3)} ms, sweep frame (every node re-measured, ${(metric.stats.measured / Math.max(1, metric.stats.invalidations)).toFixed(0)} nodes per refresh) ${sweepMs.toFixed(3)} ms, sphere metric steady ${sphereMs.toFixed(3)} ms`);
    expect(steadyMs).toBeGreaterThan(0);
  });
});
