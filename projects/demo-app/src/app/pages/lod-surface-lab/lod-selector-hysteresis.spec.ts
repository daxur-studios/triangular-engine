import { SWEEP_ALTITUDE_SHARE, SWEEP_PERIOD_S, SWEEP_YAW_RAD, frustumNormals, panView, poseView, resolveCamera, sweepPathView, turnPathView, TURN_PERIOD_S, TURN_YAW_RAD, type CameraView, type PoseId } from './lod-camera';
import { domainPreset, neighbourCell, type LodDomain, type NeighbourCell } from './lod-domain';
import { createHeightSource } from './lod-height';
import { CAP_SLACK, LodSelector, PIXEL_FLOOR, maxLevelFor, type SelectorSettings, type SelectorView } from './lod-selector';

/**
 * Plan 059: split/merge hysteresis of the distance criterion, the level-churn counters, and the scripted sweep path.
 *
 * Most checks scale `pixelAngle` rather than move the camera: a node's value (`edge / target`) is exactly proportional to
 * 1 / pixelAngle, so scaling it by 1 +- e scales every node's value by the same factor, which is what "the camera is a
 * little nearer or farther" means for every node at once, with none of the nearest nodes (whose gap changes by far more)
 * jumping out of the band.
 */

const sphere600 = domainPreset('sphere-600km');
const plane = domainPreset('plane-100km');
const FOV = Math.PI / 3;

function settingsFor(domain: LodDomain, change: Partial<SelectorSettings> = {}): SelectorSettings {
  return {
    domain, patchCells: 32, mode: 'distance', fixedLevel: 3, cellPixels: 4, leafCap: 60_000,
    heightBoundM: createHeightSource('bumps', domain.kind).boundM, cull: false, ...change,
  };
}

function viewOfCamera(domain: LodDomain, view: CameraView): SelectorView {
  const camera = resolveCamera(view, domain, createHeightSource('bumps', domain.kind));
  return { camera: camera.position, pixelAngle: (2 * Math.tan(FOV / 2)) / 1440, frustum: frustumNormals(camera, FOV, 16 / 9, new Float64Array(12)) };
}

const withPixelAngle = (view: SelectorView, pixelAngle: number): SelectorView => ({ ...view, pixelAngle });

/** The leaves as `root:level:i:j:mask`, sorted: the tree's identity. */
function treeOf(selector: LodSelector): string {
  const keys: string[] = [];
  for (let k = 0; k < selector.stats.leaves; k++) {
    const node = selector.leaves[k];
    keys.push(`${selector.root[node]}:${selector.level[node]}:${selector.i[node]}:${selector.j[node]}:${selector.masks[k]}`);
  }
  return keys.sort().join(' ');
}

/** The node's value the way the selector computes it. */
function valueOf(selector: LodSelector, node: number, view: SelectorView, settings: SelectorSettings): number {
  return selector.edge[node] / settings.patchCells / (Math.max(settings.cellPixels, PIXEL_FLOOR) * view.pixelAngle * selector.gap(node, view.camera));
}

interface Cell { root: number; level: number; i: number; j: number }

/** True when the selector's current tree splits the cell. */
function isSplit(selector: LodSelector, cell: Cell): boolean {
  const node = selector.findCovering(cell.root, cell.level, cell.i, cell.j);
  return selector.level[node] === cell.level && selector.open[node] === 1;
}

/** The leaf closest to splitting (largest value at most 1) of a tree, and the pixel angle that puts it exactly at 1. */
function thresholdLeaf(domain: LodDomain, base: SelectorView): { cell: Cell; pixelAngle: number } {
  const settings = settingsFor(domain);
  const selector = new LodSelector(settings);
  selector.select(base);
  let best = -1;
  let bestValue = 0;
  for (let k = 0; k < selector.stats.leaves; k++) {
    const node = selector.leaves[k];
    if (selector.level[node] >= maxLevelFor(32)) continue;
    const value = valueOf(selector, node, base, settings);
    if (value <= 1 && value > bestValue) { best = node; bestValue = value; }
  }
  expect(best).toBeGreaterThanOrEqual(0);
  return { cell: { root: selector.root[best], level: selector.level[best], i: selector.i[best], j: selector.j[best] }, pixelAngle: base.pixelAngle * bestValue };
}

function openNodes(selector: LodSelector): Set<number> {
  const out = new Set<number>();
  for (let k = 0; k < selector.activeCount; k++) if (selector.open[selector.active[k]] === 1) out.add(selector.active[k]);
  return out;
}

/** Every leaf's coarser neighbour is exactly one level up, and its mask says so. */
function balanceIssues(selector: LodSelector, domain: LodDomain): string[] {
  const issues: string[] = [];
  const cell: NeighbourCell = { root: 0, i: 0, j: 0 };
  for (let k = 0; k < selector.stats.leaves; k++) {
    const node = selector.leaves[k];
    const level = selector.level[node];
    for (let e = 0; e < 4; e++) {
      if (!neighbourCell(domain, selector.root[node], level, selector.i[node], selector.j[node], e, cell)) continue;
      const other = selector.findCovering(cell.root, level, cell.i, cell.j);
      const coarser = selector.level[other] < level;
      if (coarser && level - selector.level[other] !== 1) issues.push(`leaf ${node} edge ${e}: neighbour ${level - selector.level[other]} levels up`);
      if (coarser !== ((selector.masks[k] >> e) & 1) > 0) issues.push(`leaf ${node} edge ${e}: mask ${selector.masks[k]} disagrees`);
    }
    if (selector.masks[k] !== selector.edgeMask(node)) issues.push(`leaf ${node}: mask ${selector.masks[k]} differs from the searched ${selector.edgeMask(node)}`);
  }
  return issues;
}

function coveredArea(selector: LodSelector): number {
  let area = 0;
  for (let k = 0; k < selector.stats.leaves; k++) area += 4 ** -selector.level[selector.leaves[k]];
  return area;
}

describe('Plan 059 selector hysteresis', () => {
  const EPS = 0.01;

  it('flips the leaf set every frame without hysteresis when the target size wobbles by 1% around a threshold', () => {
    const base = viewOfCamera(sphere600, poseView('low-200m', sphere600));
    const { cell, pixelAngle } = thresholdLeaf(sphere600, base);
    const selector = new LodSelector(settingsFor(sphere600, { hysteresis: 0 }));
    const trees: string[] = [];
    for (let frame = 0; frame < 8; frame++) {
      // Even frames: target 1% small (value 1.0101, the cell splits); odd frames: 1% large (value 0.990, it does not).
      selector.select(withPixelAngle(base, pixelAngle * (frame % 2 === 0 ? 1 - EPS : 1 + EPS)));
      expect(isSplit(selector, cell)).withContext(`frame ${frame}`).toBe(frame % 2 === 0);
      trees.push(treeOf(selector));
      if (frame > 0) {
        expect(trees[frame]).withContext(`frame ${frame}`).not.toBe(trees[frame - 1]);
        expect(selector.stats.newSplits + selector.stats.merges).withContext(`frame ${frame}`).toBeGreaterThan(0);
      }
    }
  });

  it('keeps the leaf set fixed after the first frame with 15% hysteresis, with no splits or merges', () => {
    const base = viewOfCamera(sphere600, poseView('low-200m', sphere600));
    const { cell, pixelAngle } = thresholdLeaf(sphere600, base);
    const plain = new LodSelector(settingsFor(sphere600, { hysteresis: 0 }));
    const selector = new LodSelector(settingsFor(sphere600, { hysteresis: 0.15 }));
    let first = '';
    for (let frame = 0; frame < 8; frame++) {
      const view = withPixelAngle(base, pixelAngle * (frame % 2 === 0 ? 1 - EPS : 1 + EPS));
      selector.select(view);
      expect(isSplit(selector, cell)).withContext(`frame ${frame}`).toBeTrue();
      if (frame === 0) {
        // A fresh selector has no history, so the first frame is the single-threshold tree.
        plain.select(view);
        first = treeOf(selector);
        expect(first).toBe(treeOf(plain));
      } else {
        expect(treeOf(selector)).withContext(`frame ${frame}`).toBe(first);
        expect(selector.stats.newSplits).withContext(`frame ${frame}`).toBe(0);
        expect(selector.stats.merges).withContext(`frame ${frame}`).toBe(0);
      }
    }
  });

  it('merges a node once it is moved away far enough, and splits it again only at the original threshold', () => {
    const base = viewOfCamera(plane, poseView('low-200m', plane));
    const { cell, pixelAngle } = thresholdLeaf(plane, base);
    const settings = settingsFor(plane, { hysteresis: 0.15 });
    const selector = new LodSelector(settings);
    const plain = new LodSelector(settingsFor(plane, { hysteresis: 0 }));
    // Away: the target grows 1% a frame from just under the threshold, so the value falls from 1.0101 to 0.68 in 40 frames.
    const steps = 40;
    const pixelAt = (k: number) => pixelAngle * (1 - EPS) * (1 + EPS) ** k;
    const valueAt = (k: number) => 1 / ((1 - EPS) * (1 + EPS) ** k);
    let firstMerged = -1;
    let heldBeyondThreshold = false;
    for (let k = 0; k <= steps; k++) {
      selector.select(withPixelAngle(base, pixelAt(k)));
      plain.select(withPixelAngle(base, pixelAt(k)));
      const split = isSplit(selector, cell);
      if (valueAt(k) > 1 / 1.15) expect(split).withContext(`away ${k} value ${valueAt(k)}`).toBeTrue();
      if (split && !isSplit(plain, cell)) heldBeyondThreshold = true;
      if (!split && firstMerged < 0) firstMerged = k;
      if (firstMerged >= 0) expect(split).withContext(`away ${k}: stays merged`).toBeFalse();
    }
    expect(heldBeyondThreshold).toBeTrue();
    expect(firstMerged).toBeGreaterThan(0);
    // It merged on crossing 1 / 1.15, not at 1 and not never.
    expect(valueAt(firstMerged)).toBeLessThanOrEqual(1 / 1.15);
    expect(valueAt(firstMerged - 1)).toBeGreaterThan(1 / 1.15);
    // Back: it stays merged through the band and splits at the first value above 1, exactly as a node with no history.
    let reSplit = -1;
    for (let k = steps; k >= 0; k--) {
      selector.select(withPixelAngle(base, pixelAt(k)));
      plain.select(withPixelAngle(base, pixelAt(k)));
      expect(isSplit(selector, cell)).withContext(`back ${k} value ${valueAt(k)}`).toBe(valueAt(k) > 1);
      if (reSplit < 0 && isSplit(selector, cell)) reSplit = k;
    }
    // The last step back to still have value above 1 (the first on the way back down).
    let expected = steps;
    while (valueAt(expected) <= 1) expected--;
    expect(reSplit).toBe(expected);
    expect(valueAt(reSplit)).toBeGreaterThan(1);
  });

  it('counts the nodes that changed between split and merged, through repeated views and pose jumps', () => {
    const settings = settingsFor(sphere600, { cull: true, leafCap: 256, hysteresis: 0.15 });
    const selector = new LodSelector(settings, 2);
    let previous = new Set<number>();
    let version = selector.version;
    let rebuilds = 0;
    const check = (view: SelectorView, label: string) => {
      selector.select(view);
      const now = openNodes(selector);
      if (selector.version === version) {
        expect(selector.stats.newSplits).withContext(label).toBe(0);
        expect(selector.stats.merges).withContext(label).toBe(0);
        expect(now).withContext(label).toEqual(previous);
        return;
      }
      version = selector.version;
      rebuilds++;
      let opened = 0;
      let merged = 0;
      for (const node of now) if (!previous.has(node)) opened++;
      for (const node of previous) if (!now.has(node)) merged++;
      expect(selector.stats.newSplits).withContext(label).toBe(opened);
      expect(selector.stats.merges).withContext(label).toBe(merged);
      previous = now;
    };
    for (let round = 0; round < 2; round++) {
      for (const pose of ['eye-2m', 'horizon', 'low-200m', 'mid-5km', 'orbit'] as const) {
        let camera: CameraView = poseView(pose, sphere600);
        for (let frame = 0; frame < 5; frame++) {
          camera = panView(camera, frame % 2 ? 0.004 : 0, 0.01 / 1.5, sphere600);
          const view = viewOfCamera(sphere600, camera);
          check(view, `${pose} frame ${frame}`);
          if (frame === 2) check(view, `${pose} frame ${frame} again`);
        }
      }
    }
    expect(rebuilds).toBeGreaterThan(40);
  });

  it('keeps 2:1 balance, whole cover, right masks and the leaf cap while the camera dives and climbs, with the lab default', () => {
    for (const [label, domain] of [['plane', plane], ['sphere 600 km', sphere600]] as const) {
      for (const cull of [false, true]) {
        for (const leafCap of [200, 4096]) {
          const selector = new LodSelector(settingsFor(domain, { cull, leafCap, hysteresis: 0.15 }), 2);
          const plain = new LodSelector(settingsFor(domain, { cull, leafCap, hysteresis: 0 }), 2);
          // Altitude 2 m up to about 40 km in 1.35x steps, a little pan each frame, then back down.
          const altitudes: number[] = [];
          for (let a = 2; a < 40_000; a *= 1.35) altitudes.push(a);
          const path = [...altitudes, ...altitudes.slice().reverse()];
          let keptFiner = false;
          let camera: CameraView = poseView('eye-2m', domain);
          path.forEach((altitudeM, frame) => {
            camera = panView({ ...camera, altitudeM }, frame % 3 === 2 ? 0.003 : 0, 0.002, domain);
            const view = viewOfCamera(domain, camera);
            selector.select(view);
            plain.select(view);
            const where = `${label} cull ${cull} cap ${leafCap} frame ${frame}`;
            expect(balanceIssues(selector, domain)).withContext(where).toEqual([]);
            expect(coveredArea(selector)).withContext(where).toBeCloseTo(domain.kind === 'plane' ? 1 : 6, 9);
            expect(selector.stats.leaves).withContext(where).toBeLessThanOrEqual(leafCap + CAP_SLACK);
            // Retentions are not requests: unmet is only ever a request the cap stopped.
            if (selector.stats.unmet > 0) expect(selector.stats.capHit).withContext(where).toBeTrue();
            if (frame >= altitudes.length && selector.stats.leaves > plain.stats.leaves) keptFiner = true;
          });
          // Climbing back, the hysteresis keeps splits the single threshold has already merged.
          if (leafCap > 1000 && domain.kind === 'plane') expect(keptFiner).withContext(`${label} cull ${cull} cap ${leafCap}`).toBeTrue();
        }
      }
    }
  });

  describe('at the leaf cap', () => {
    // Plane, 200 m, no culling, a cap the tree reaches: the budget, not the threshold, decides which nodes split.
    const CAP = 1024;
    const MARGIN = 1.15;
    const startView = (): SelectorView => viewOfCamera(plane, poseView('low-200m', plane));
    /** The camera moved by `metres` along the ground (heading-relative), keeping the pose otherwise. */
    const movedView = (metres: number): SelectorView => {
      const pose = poseView('low-200m', plane);
      return viewOfCamera(plane, { ...pose, ground: [pose.ground[0] + metres, pose.ground[1], pose.ground[2] + metres * 0.37] });
    };
    /** Builds the tree of the start view and then of the moved one; returns the second-frame selector. */
    const afterMove = (hysteresis: number, metres: number): LodSelector => {
      const selector = new LodSelector(settingsFor(plane, { cull: false, leafCap: CAP, hysteresis }));
      selector.select(startView());
      selector.select(movedView(metres));
      return selector;
    };
    const churnOf = (selector: LodSelector) => selector.stats.newSplits + selector.stats.merges;

    it('does not let a new request displace a kept split that it beats by less than the margin', () => {
      // Up to 20 m: since the split distance is measured to the node's box rather than its sphere, a 30 m move already
      // re-ranks a few nodes past the margin (the next case covers that).
      for (const metres of [5, 8, 12, 20]) {
        const plain = afterMove(0, metres);
        const hysteretic = afterMove(0.15, metres);
        expect(plain.stats.capHit).withContext(`${metres} m`).toBeTrue();
        expect(hysteretic.stats.capHit).withContext(`${metres} m`).toBeTrue();
        // Single-ranked, the cut moves with the camera; with the margin the nodes near it re-rank by less than 15%, so the kept splits stay.
        expect(churnOf(plain)).withContext(`${metres} m`).toBeGreaterThan(0);
        expect(churnOf(hysteretic)).withContext(`${metres} m`).toBe(0);
      }
    });

    it('lets a new request displace a kept split once it beats it by more than the margin', () => {
      const selector = afterMove(0.15, 60);
      expect(churnOf(selector)).toBeGreaterThan(0);
      expect(selector.stats.newSplits).toBeGreaterThan(0);
      expect(selector.stats.merges).toBeGreaterThan(0);
      // Every request that took budget outranks every kept split that lost it by the margin.
      let weakestNew = Infinity;
      let strongestLost = 0;
      for (let k = 0; k < selector.activeCount; k++) {
        const node = selector.active[k];
        const value = selector.priority[node];
        if (selector.open[node] === 1 && selector.wasOpen[node] === 0 && value > 1) weakestNew = Math.min(weakestNew, value);
        if (selector.open[node] === 0 && selector.wasOpen[node] === 1 && value > 0) strongestLost = Math.max(strongestLost, value * MARGIN);
      }
      expect(weakestNew).toBeGreaterThanOrEqual(strongestLost);
      expect(balanceIssues(selector, plane)).toEqual([]);
      expect(coveredArea(selector)).toBeCloseTo(1, 9);
    });

    it('gives the same tree as the single threshold when the hysteresis is 0, however it was set', () => {
      for (const metres of [0.1, 5, 60]) {
        const absent = new LodSelector(settingsFor(plane, { cull: false, leafCap: CAP }));
        const zero = new LodSelector(settingsFor(plane, { cull: false, leafCap: CAP, hysteresis: 0 }));
        for (const selector of [absent, zero]) {
          selector.select(startView());
          selector.select(movedView(metres));
        }
        expect(treeOf(zero)).toBe(treeOf(absent));
        expect(zero.stats.unmet).toBe(absent.stats.unmet);
      }
    });
  });

  it('serves requests before retentions when the cap is tight, and does not count a dropped retention as unmet', () => {
    const base = viewOfCamera(sphere600, poseView('low-200m', sphere600));
    const near = withPixelAngle(base, base.pixelAngle);
    const far = withPixelAngle(base, base.pixelAngle * 1.1);
    const selector = new LodSelector(settingsFor(sphere600, { leafCap: 150, hysteresis: 0.15 }));
    selector.select(near);
    expect(selector.stats.capHit).toBeTrue();
    // The same view but 10% farther: nothing new is requested beyond what was kept, so the cap is never what stopped a request.
    selector.select(far);
    const fresh = new LodSelector(settingsFor(sphere600, { leafCap: 150, hysteresis: 0 }));
    fresh.select(far);
    expect(selector.stats.leaves).toBeLessThanOrEqual(150 + CAP_SLACK);
    expect(selector.stats.unmet).toBeLessThanOrEqual(fresh.stats.unmet + selector.stats.leaves);
    expect(coveredArea(selector)).toBeCloseTo(6, 9);
  });

  it('allocates nothing after construction: every typed array stays the same object over many rebuilds', () => {
    const selector = new LodSelector(settingsFor(sphere600, { cull: true, leafCap: 256, hysteresis: 0.15 }), 2);
    const arrays = () => [selector.leaves, selector.masks, selector.active, selector.open, selector.wasOpen, selector.stamp, selector.priority, selector.nb, selector.child];
    const before = arrays();
    for (let frame = 0; frame < 60; frame++) {
      const camera: CameraView = sweepPathView(sphere600, frame % 2 ? 'low-200m' : 'eye-2m', frame / 30);
      selector.select(viewOfCamera(sphere600, camera));
    }
    arrays().forEach((array, k) => expect(array).toBe(before[k]));
  });

  it('does not change fixed mode', () => {
    const view = viewOfCamera(sphere600, poseView('low-200m', sphere600));
    const a = new LodSelector(settingsFor(sphere600, { mode: 'fixed', fixedLevel: 3, hysteresis: 0 }));
    const b = new LodSelector(settingsFor(sphere600, { mode: 'fixed', fixedLevel: 3, hysteresis: 0.3 }));
    a.select(view);
    b.select(withPixelAngle(view, view.pixelAngle * 1.2));
    b.select(view);
    expect(treeOf(b)).toBe(treeOf(a));
    expect(b.stats.leaves).toBe(6 * 4 ** 3);
  });
});

describe('Plan 059 turn path', () => {
  it('is the pose at the start and a pure function of the time', () => {
    for (const domain of [plane, sphere600]) {
      for (const pose of ['low-200m', 'mid-5km'] as const) {
        expect(turnPathView(domain, pose, 0)).toEqual(poseView(pose, domain));
        expect(turnPathView(domain, pose, 1.3)).toEqual(turnPathView(domain, pose, 1.3));
      }
    }
  });

  it('keeps the position, altitude and pitch fixed and swings only the heading by TURN_YAW_RAD either side', () => {
    for (const domain of [plane, sphere600]) {
      const pose = poseView('mid-5km', domain);
      let low = Infinity;
      let high = -Infinity;
      for (let k = 0; k < 400; k++) {
        const t = (k * TURN_PERIOD_S) / 100;
        const view = turnPathView(domain, 'mid-5km', t);
        expect(view.ground).toEqual(pose.ground);
        expect(view.altitudeM).toBe(pose.altitudeM);
        expect(view.pitchRad).toBe(pose.pitchRad);
        expect(turnPathView(domain, 'mid-5km', t + TURN_PERIOD_S).headingRad).toBeCloseTo(view.headingRad, 9);
        low = Math.min(low, view.headingRad - pose.headingRad);
        high = Math.max(high, view.headingRad - pose.headingRad);
      }
      expect(low).toBeCloseTo(-TURN_YAW_RAD, 3);
      expect(high).toBeCloseTo(TURN_YAW_RAD, 3);
      expect(TURN_YAW_RAD).toBeGreaterThan(SWEEP_YAW_RAD);
    }
  });
});

describe('Plan 059 view-independent selection (culling only picks the drawn leaves)', () => {
  const CASES = [[plane, 'low-200m'], [sphere600, 'mid-5km']] as const;
  const cellsOf = (selector: LodSelector, from: number, to: number) => {
    const out: string[] = [];
    for (let k = from; k < to; k++) {
      const node = selector.leaves[k];
      out.push(`${selector.root[node]}:${selector.level[node]}:${selector.i[node]}:${selector.j[node]}`);
    }
    return out;
  };
  const allCells = (selector: LodSelector) => cellsOf(selector, 0, selector.stats.leaves).sort();

  /** Runs a pure turn (heading only) for two periods at 60 fps; returns churn after the first frame and the selected sets. */
  function turn(domain: LodDomain, pose: PoseId, change: Partial<SelectorSettings>) {
    const selector = new LodSelector(settingsFor(domain, { cull: true, leafCap: 1024, hysteresis: 0.15, ...change }));
    selector.select(viewOfCamera(domain, turnPathView(domain, pose, 0)));
    const first = allCells(selector);
    let changes = 0;
    let changesAll = 0;
    let sameSet = true;
    let subset = true;
    let culledSome = false;
    for (let frame = 1; frame <= 2 * TURN_PERIOD_S * 60; frame++) {
      selector.select(viewOfCamera(domain, turnPathView(domain, pose, frame / 60)));
      changes += selector.stats.visibleNewSplits + selector.stats.visibleMerges;
      changesAll += selector.stats.newSplits + selector.stats.merges;
      const selected = allCells(selector);
      if (selected.length !== first.length || selected.some((cell, k) => cell !== first[k])) sameSet = false;
      const drawn = new Set(cellsOf(selector, 0, selector.stats.drawn));
      const all = new Set(selected);
      for (const cell of drawn) if (!all.has(cell)) subset = false;
      expect(selector.stats.drawn).toBeLessThanOrEqual(selector.stats.leaves);
      if (selector.stats.drawn < selector.stats.leaves) culledSome = true;
    }
    return { changes, changesAll, sameSet, subset, culledSome };
  }

  it('makes no level change and selects the same leaves on a pure turn, at the default and larger caps', () => {
    for (const [domain, pose] of CASES) {
      for (const leafCap of [1024, 4096, 8192]) {
        const result = turn(domain, pose, { leafCap });
        const where = `${domain.kind} ${pose} cap ${leafCap}`;
        expect(result.changesAll).withContext(where).toBe(0);
        expect(result.changes).withContext(where).toBe(0);
        expect(result.sameSet).withContext(where).toBeTrue();
        expect(result.subset).withContext(where).toBeTrue();
        expect(result.culledSome).withContext(where).toBeTrue();
      }
    }
  });

  it('still culls inside selection with cullInSelection, and the selection then follows the heading', () => {
    for (const [domain, pose] of CASES) {
      const result = turn(domain, pose, { cullInSelection: true });
      const where = `${domain.kind} ${pose}`;
      expect(result.culledSome).withContext(where).toBeTrue();
      expect(result.subset).withContext(where).toBeTrue();
      expect(result.sameSet).withContext(where).toBeFalse();
      expect(result.changesAll).withContext(where).toBeGreaterThan(0);
      // Culled nodes ask for nothing, so the legacy tree has fewer leaves than the default one at the same cap.
      const legacy = new LodSelector(settingsFor(domain, { cull: true, cullInSelection: true, leafCap: 8192 }));
      const plain = new LodSelector(settingsFor(domain, { cull: true, leafCap: 8192 }));
      const view = viewOfCamera(domain, turnPathView(domain, pose, 0));
      legacy.select(view);
      plain.select(view);
      expect(legacy.stats.leaves).withContext(where).toBeLessThan(plain.stats.leaves);
      expect(legacy.stats.drawn).withContext(where).toBeLessThanOrEqual(plain.stats.drawn);
    }
  });

  it('selects the same tree with culling on or off by default, and draws the in-frustum subset', () => {
    for (const [domain, pose] of CASES) {
      const on = new LodSelector(settingsFor(domain, { cull: true, leafCap: 1024 }));
      const off = new LodSelector(settingsFor(domain, { cull: false, leafCap: 1024 }));
      const view = viewOfCamera(domain, turnPathView(domain, pose, 0.7));
      on.select(view);
      off.select(view);
      expect(allCells(on)).toEqual(allCells(off));
      expect(off.stats.drawn).toBe(off.stats.leaves);
      expect(on.stats.drawn).toBeLessThan(on.stats.leaves);
    }
  });
});

describe('Plan 059 sweep path', () => {
  it('is a pure function of the time: the same view every call, and the pose itself at the start', () => {
    for (const domain of [plane, sphere600]) {
      for (const pose of ['eye-2m', 'low-200m'] as const) {
        expect(sweepPathView(domain, pose, 0.37)).toEqual(sweepPathView(domain, pose, 0.37));
        expect(sweepPathView(domain, pose, 0)).toEqual(poseView(pose, domain));
      }
    }
  });

  it('repeats every period and swings the heading and altitude by their amplitudes either side of the pose', () => {
    for (const domain of [plane, sphere600]) {
      const pose = poseView('low-200m', domain);
      let low = Infinity;
      let high = -Infinity;
      let altitudeLow = Infinity;
      let altitudeHigh = -Infinity;
      for (let k = 0; k < 400; k++) {
        const t = (k * SWEEP_PERIOD_S) / 100;
        const view = sweepPathView(domain, 'low-200m', t);
        const later = sweepPathView(domain, 'low-200m', t + SWEEP_PERIOD_S);
        expect(later.headingRad).toBeCloseTo(view.headingRad, 9);
        expect(later.altitudeM).toBeCloseTo(view.altitudeM, 6);
        expect(view.ground).toEqual(pose.ground);
        expect(view.pitchRad).toBe(pose.pitchRad);
        low = Math.min(low, view.headingRad - pose.headingRad);
        high = Math.max(high, view.headingRad - pose.headingRad);
        altitudeLow = Math.min(altitudeLow, view.altitudeM / pose.altitudeM - 1);
        altitudeHigh = Math.max(altitudeHigh, view.altitudeM / pose.altitudeM - 1);
      }
      expect(low).toBeCloseTo(-SWEEP_YAW_RAD, 3);
      expect(high).toBeCloseTo(SWEEP_YAW_RAD, 3);
      expect(altitudeLow).toBeCloseTo(-SWEEP_ALTITUDE_SHARE, 3);
      expect(altitudeHigh).toBeCloseTo(SWEEP_ALTITUDE_SHARE, 3);
    }
  });

  /** [visible, all] level changes of a 60 fps sweep over four periods: the first period, and the three later ones. */
  function sweepChurn(domain: LodDomain, pose: PoseId, cull: boolean, leafCap: number, hysteresis: number) {
    // Legacy selection (culling inside it): these measurements and bounds were made before selection became view-independent.
    const selector = new LodSelector(settingsFor(domain, { cull, cullInSelection: cull, leafCap, hysteresis }));
    selector.select(viewOfCamera(domain, sweepPathView(domain, pose, 0)));
    const out = { first: 0, later: 0, firstAll: 0, laterAll: 0, capped: 0 };
    for (let frame = 1; frame <= 4 * SWEEP_PERIOD_S * 60; frame++) {
      selector.select(viewOfCamera(domain, sweepPathView(domain, pose, frame / 60)));
      const visible = selector.stats.visibleNewSplits + selector.stats.visibleMerges;
      const all = selector.stats.newSplits + selector.stats.merges;
      expect(visible).toBeLessThanOrEqual(all);
      if (selector.stats.capHit) out.capped++;
      if (frame <= SWEEP_PERIOD_S * 60) { out.first += visible; out.firstAll += all; } else { out.later += visible; out.laterAll += all; }
    }
    return out;
  }

  const SWEEP_CASES = [['sphere eye-2m', sphere600, 'eye-2m'], ['sphere low-200m', sphere600, 'low-200m'], ['sphere mid-5km', sphere600, 'mid-5km'], ['plane low-200m', plane, 'low-200m']] as const;

  it('crosses thresholds repeatedly: far more on-screen level changes without hysteresis than with it once the first swing is over', () => {
    const results: string[] = [];
    for (const [label, domain, pose] of SWEEP_CASES) {
      for (const cull of [false, true]) {
        const without = sweepChurn(domain, pose, cull, 20_000, 0);
        const withHysteresis = sweepChurn(domain, pose, cull, 20_000, 0.15);
        results.push(`${label} cull ${cull}: h=0 ${JSON.stringify(without)} h=0.15 ${JSON.stringify(withHysteresis)}`);
        if (label.startsWith('plane')) {
          // The altitude swing crosses thresholds; the hysteresis removes the back-and-forth flips, culling or not.
          expect(without.later).withContext(`${label} cull ${cull}`).toBeGreaterThan(0);
          expect(withHysteresis.later).withContext(`${label} cull ${cull}`).toBeLessThan(without.later);
        }
      }
    }
    console.log(`sweep churn over 4 periods at 60 fps, cap 20000 (first period, three later): ${results.join(' | ')}`);
  });

  it('removes churn at the 1,024-leaf cap of the browser suites too, where the budget decides the tree', () => {
    const results: string[] = [];
    for (const [label, domain, pose] of SWEEP_CASES) {
      for (const cull of [false, true]) {
        const without = sweepChurn(domain, pose, cull, 1024, 0);
        const withHysteresis = sweepChurn(domain, pose, cull, 1024, 0.15);
        results.push(`${label} cull ${cull}: h=0 ${JSON.stringify(without)} h=0.15 ${JSON.stringify(withHysteresis)}`);
        const where = `${label} cull ${cull}`;
        // Every case sits at the cap; the swing still crosses thresholds, so the single ranking churns.
        expect(without.capped).withContext(where).toBe(480);
        if (label === 'sphere eye-2m') continue;
        expect(without.later).withContext(where).toBeGreaterThan(0);
        // Measured: no churn at all unculled; culled, the frustum sweep still brings new nodes in, so about a quarter fewer (0.72 to 0.76).
        if (!cull) expect(withHysteresis.laterAll).withContext(where).toBe(0);
        else expect(withHysteresis.later).withContext(where).toBeLessThan(0.85 * without.later);
      }
    }
    console.log(`sweep churn over 4 periods at 60 fps, cap 1024 (first period, three later): ${results.join(' | ')}`);
  });

  it('with culling on, a camera wobbling around thresholds changes level on screen at h=0 and not at h=0.15', () => {
    for (const [label, domain, pose] of [['plane', plane, 'low-200m'], ['sphere', sphere600, 'low-200m']] as const) {
      const base = viewOfCamera(domain, poseView(pose, domain));
      const run = (hysteresis: number) => {
        const selector = new LodSelector(settingsFor(domain, { cull: true, hysteresis }));
        let visible = 0;
        for (let frame = 0; frame < 12; frame++) {
          selector.select(withPixelAngle(base, base.pixelAngle * (frame % 2 === 0 ? 0.99 : 1.01)));
          if (frame > 0) visible += selector.stats.visibleNewSplits + selector.stats.visibleMerges;
        }
        return visible;
      };
      expect(run(0)).withContext(label).toBeGreaterThan(0);
      expect(run(0.15)).withContext(label).toBe(0);
    }
  });
});
