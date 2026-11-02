import { LodSelector } from 'triangular-engine/lod-surface/core';
import {
  COVER_MARGIN_M,
  ISLANDS,
  createLandCoverHook,
  SEABED_M,
  isDryByCentre,
  isDrySquare,
  landHeightM,
  landLowerBoundM,
  measureLeaves,
  planeSelectorSettings,
  selectorViewFor,
  waterCeilingM,
  type ILandView,
} from './water-lod-spike-land';

const PLANE_M = 100_000;
/** The water body's global height bound with the default detail noise: waves (about 2 m) plus 0.04 of a 98 m texel. */
const CEILING_M = waterCeilingM(8);

/** Small deterministic generator, so the random squares are the same every run. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function view(position: [number, number, number], target: [number, number, number]): ILandView {
  return { position, target, fovDeg: 50, aspect: 2527 / 1077, heightPx: 1077 };
}

function leavesFor(landView: ILandView, cellPixels = 4, leafCap = 4096, withHook = false, ceilingM = CEILING_M) {
  const settings = planeSelectorSettings(PLANE_M, cellPixels, leafCap, CEILING_M);
  const selector = new LodSelector(settings);
  if (withHook) selector.setCoverHook(createLandCoverHook());
  selector.select(selectorViewFor(landView));
  return { settings, selector, cull: measureLeaves(selector, settings.domain, ceilingM), audit: measureLeaves(selector, settings.domain, ceilingM, undefined, 'all') };
}

describe('water LOD spike w2: land under the water', () => {
  it('has open sea away from the islands and land above the water at their centres', () => {
    expect(landHeightM(-40_000, 40_000)).toBeCloseTo(SEABED_M, 3);
    expect(landHeightM(4_000, -2_000)).toBeGreaterThan(100);
  });

  it('bounds the land from below over random squares without ever exceeding the true minimum', () => {
    const next = random(80);
    for (let trial = 0; trial < 400; trial++) {
      const x = (next() - 0.5) * 30_000;
      const z = (next() - 0.5) * 30_000;
      const half = 2 ** (next() * 12);
      const bound = landLowerBoundM(x, z, half);
      let minimum = Infinity;
      for (let a = 0; a <= 12; a++) for (let b = 0; b <= 12; b++) minimum = Math.min(minimum, landHeightM(x + (a / 6 - 1) * half, z + (b / 6 - 1) * half));
      expect(bound).toBeLessThanOrEqual(minimum + 1e-9);
    }
  });

  it('never calls a square with a wet point dry, while the centre-only control does', () => {
    const next = random(81);
    let controlWrong = 0;
    let dry = 0;
    for (let trial = 0; trial < 600; trial++) {
      const x = (next() - 0.5) * 20_000;
      const z = (next() - 0.5) * 20_000;
      const half = 2 ** (next() * 11);
      let wet = false;
      for (let a = 0; a <= 16 && !wet; a++) for (let b = 0; b <= 16 && !wet; b++) wet = landHeightM(x + (a / 8 - 1) * half, z + (b / 8 - 1) * half) <= CEILING_M;
      const isDry = isDrySquare(x, z, half, CEILING_M);
      if (isDry) dry++;
      if (isDry) expect(wet).toBe(false);
      if (isDryByCentre(x, z, CEILING_M) && wet) controlWrong++;
    }
    expect(dry).toBeGreaterThan(20);
    expect(controlWrong).toBeGreaterThan(10);
  });

  it('puts a plane leaf footprint on the axis-aligned square the test uses (no warp on a plane)', () => {
    const { cull, settings } = leavesFor(view([0, 200, 600], [0, 0, -600]));
    expect(settings.domain.kind).toBe('plane');
    expect(cull.drawn).toBeGreaterThan(100);
    expect(cull.drawn).toBeLessThanOrEqual(cull.leaves);
  });

  it('skips no wet leaf in any test view, and the centre-only control does', () => {
    const views: Record<string, ILandView> = {
      coast200: view([0, 200, 600], [0, 0, -600]),
      grazing2: view([0, 2, 800], [0, 0, -600]),
      down800: view([0, 800, -600], [0, 0, -600]),
      island5k: view([0, 5_000, 9_000], [3_000, 0, -1_000]),
    };
    let controlWrong = 0;
    for (const [name, landView] of Object.entries(views)) {
      const { cull } = leavesFor(landView);
      expect(cull.conservativeWrongCalls).withContext(name).toBe(0);
      controlWrong += cull.centreWrongCalls;
    }
    expect(controlWrong).toBeGreaterThan(0);
  });

  it('finds no dry leaf over open sea', () => {
    // Looking away from every island, towards the plane's far corner.
    const { cull } = leavesFor(view([-30_000, 200, 30_000], [-30_000, 0, 45_000]));
    expect(cull.drawn).toBeGreaterThan(100);
    expect(cull.dryDrawn).toBe(0);
  });

  it('finds dry leaves where land fills the view', () => {
    const { cull } = leavesFor(view([4_000, 3_000, 3_000], [4_000, 0, -2_000]));
    expect(cull.dryDrawn).toBeGreaterThan(0);
  });
});

describe('water LOD spike w2: the selector cover hook on the water body', () => {
  /** What the hook judges against: the water's bound plus the margin kept for the land mesh's sag. */
  const COVER_CEILING_M = CEILING_M + COVER_MARGIN_M;
  const SHORE_VIEWS: Record<string, ILandView> = {
    coast200: view([0, 200, 600], [0, 0, -600]),
    grazing2: view([0, 2, 800], [0, 0, -600]),
    down800: view([0, 800, -600], [0, 0, -600]),
    island5k: view([0, 5_000, 9_000], [3_000, 0, -1_000]),
  };

  it('covers leaves in every shore view, draws none that lies entirely under land, and calls no wet leaf covered', () => {
    for (const [name, landView] of Object.entries(SHORE_VIEWS)) {
      const { cull, audit } = leavesFor(landView, 4, 4096, true, COVER_CEILING_M);
      expect(cull.covered).withContext(name).toBeGreaterThan(0);
      expect(cull.dryDrawn).withContext(name).toBe(0);
      expect(audit.conservativeWrongCalls).withContext(name).toBe(0);
    }
  });

  it('covers nothing over open sea', () => {
    const { cull } = leavesFor(view([-30_000, 200, 30_000], [-30_000, 0, 45_000]), 4, 4096, true, COVER_CEILING_M);
    expect(cull.covered).toBe(0);
  });

  it('with the hook off, the same views cover nothing and draw the dry leaves', () => {
    const { cull } = leavesFor(SHORE_VIEWS['down800'], 4, 4096, false, COVER_CEILING_M);
    expect(cull.covered).toBe(0);
    expect(cull.dryDrawn).toBeGreaterThan(0);
  });

  it('gives the budget to the water in view: fewer nodes left wanting to split, and finer water on average', () => {
    let improved = 0;
    for (const [name, landView] of Object.entries(SHORE_VIEWS)) {
      const off = leavesFor(landView, 4, 4096, false, COVER_CEILING_M).cull;
      const on = leavesFor(landView, 4, 4096, true, COVER_CEILING_M).cull;
      expect(on.unmet).withContext(name).toBeLessThanOrEqual(off.unmet);
      expect(on.wetEdgeMeanM).withContext(name).toBeLessThanOrEqual(off.wetEdgeMeanM * 1.0001);
      if (on.wetEdgeMeanM < off.wetEdgeMeanM * 0.99) improved++;
    }
    expect(improved).toBeGreaterThan(0);
  });

  it('keeps a margin: land only just above the water does not cover a leaf, land a few metres higher does', () => {
    const selector = new LodSelector(planeSelectorSettings(PLANE_M, 4, 4096, CEILING_M));
    selector.select(selectorViewFor(view([0, 200, 600], [0, 0, -600])));
    // One island so wide it is flat over the plane: its top sits at SEABED_M + peak everywhere.
    const flat = (heightM: number) => createLandCoverHook([{ x: 0, z: 0, sigmaM: 1e9, peakM: heightM - SEABED_M }]);
    const leaf = selector.leaves[0];
    expect(flat(CEILING_M + COVER_MARGIN_M - 1).covered(leaf, selector)).toBe(false);
    expect(flat(CEILING_M + COVER_MARGIN_M + 1).covered(leaf, selector)).toBe(true);
  });
});

describe('PROBE cover hook cost', () => {
  it('LANDPROBE moving camera', () => {
    const run = (withHook: boolean) => {
      const settings = planeSelectorSettings(PLANE_M, 4, 4096, CEILING_M);
      const selector = new LodSelector(settings);
      if (withHook) selector.setCoverHook(createLandCoverHook());
      const times: number[] = [];
      for (let k = 0; k < 600; k++) {
        const x = -2_000 + k * 12;
        const v = selectorViewFor(view([x, 200, 600 + k * 3], [x, 0, -600]));
        const t = performance.now();
        selector.select(v);
        times.push(performance.now() - t);
      }
      times.sort((a, b) => a - b);
      return { median: times[300], p95: times[570], max: times[599], covered: selector.stats.covered };
    };
    run(false); run(true);
    console.log('LANDPROBE', JSON.stringify({ off: run(false), on: run(true) }));
    expect(true).toBe(true);
  });
});
