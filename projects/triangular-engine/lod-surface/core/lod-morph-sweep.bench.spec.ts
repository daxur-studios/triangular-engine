import type { TextureHeightSource } from './lod-height-texture';
import { MorphMapResolver, type LodMorphSettings } from './lod-morph-frame';
import { POLE_FAN_DEFAULT_RAYS, PoleFanTopology } from './lod-morph-fan';
import { StretchMetric } from './lod-morph-metric';
import { PIXEL_FLOOR, type SelectorStats } from './lod-selector';
import { LodTerrainBody } from './lod-terrain-body';
import { ASPECT, FRAMES, PIXEL_ANGLE, RADIUS_M, VIEWPORT_PX, orbitView, pageHeights, pageTerrainSettings, sweepMorph, yieldToEventLoop } from './lod-morph-sweep.testing';
import { frustumNormals } from './lod-view';
import type { Vec3 } from './lod-domain';

/**
 * Bench, not a behaviour test (Plan 059, G6 investigation): the demo's `planet-scene` morph sweep on the CPU, headless (set-up in
 * `lod-morph-sweep.testing.ts`).
 *
 * Each frame is timed in parts that mirror `LodTerrainBody.update`:
 * - metric: `StretchMetric.update` and the selector's camera (`placeCamera`);
 * - measure: the time inside `StretchMetric.measure` (node re-measures; it runs inside `select`, so it is reported apart from select);
 * - select: `LodSelector.select` less the measures;
 * - upload: `LodSurfaceMesh.upload` (the instance pack when the drawn leaves changed, the morph frame, the uniforms; it includes the
 *   body's pole fan update);
 * - fan: a second `PoleFanTopology.update` on the frames that packed, timed after the frame. It estimates the fan's share of upload
 *   and is not added to the total.
 *
 * Mode `body` runs `LodTerrainBody.update` itself (the page path, default budget 300) and reports its `selectionMs`, to check the
 * decomposed replica. Mode `static` holds morph 0.5 as a control. Each run prints one `LOD_MORPH_BENCH` line to the console.
 *
 * The budget-300 runs of the page path and of the decomposed replica are asserted: a pack on at most 720 frames, and the per-frame total
 * under 5 ms median and 15 ms 95th percentile. G6i (memoised pack) measured 691 packs, a median of 2.2 to 2.3 ms and a 95th percentile of
 * 7.1 to 7.2 ms in isolation, and 8.0 to 13.4 ms in full-suite runs; the pack count target of 80, the 2 ms median target and (in full-suite runs) the 8 ms 95th percentile target were not met, and their bounds were moved to the measured values with margin (see the comments on them).
 */

interface Dist { median: number; p95: number; max: number; mean: number }

const round = (x: number): number => Math.round(x * 1000) / 1000;

function dist(values: readonly number[]): Dist {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  const at = (q: number): number => s[Math.min(n - 1, Math.max(0, Math.ceil(q * n) - 1))] ?? 0;
  return { median: round(at(0.5)), p95: round(at(0.95)), max: round(s[n - 1] ?? 0), mean: round(s.reduce((a, b) => a + b, 0) / Math.max(1, n)) };
}

type RunMode = 'body' | 'sweep' | 'static';

/** Per-frame counters of the selector, read after each select. */
type Counts = Pick<SelectorStats, 'splits' | 'newSplits' | 'merges' | 'geometryStale' | 'geometryMeasured' | 'leaves' | 'drawn'>;

/** What {@link runSweep} reports. */
interface SweepSummary {
  readonly frames: number;
  /** Frames that wrote the instance buffers (a tree-change pack). */
  readonly packFrames: number;
  /** The timings, in ms per frame (the page path has `total` and `measure` only). */
  readonly ms: Record<string, Dist>;
  readonly [key: string]: unknown;
}

async function runSweep(heights: TextureHeightSource, mode: RunMode, budget: number): Promise<SweepSummary> {
  const started = performance.now();
  const body = new LodTerrainBody(pageTerrainSettings(heights));
  // A live morph object, as `<planet>`'s uniforms are: the body reads it on every call.
  const morph: LodMorphSettings & { morph: number } = { morph: 0, projection: 'equal-earth', projectionCentre: { lonDeg: 0, latDeg: 0 } };
  body.setMorph(morph);
  const { camera, axes, position, frustumFov, groundHeightM } = orbitView(body);

  let stretch: StretchMetric;
  if (mode === 'body') {
    body.setMorphMetric(true);
    stretch = (body as unknown as { stretch: StretchMetric }).stretch;
  } else {
    stretch = new StretchMetric(body.selector, { radiusM: RADIUS_M, refreshBudget: budget });
  }
  // Time the node re-measures without changing them.
  let measureAcc = 0;
  let measureCalls = 0;
  const realMeasure = stretch.measure.bind(stretch);
  stretch.measure = (root, level, i, j, lo, hi, out) => {
    const t = performance.now();
    realMeasure(root, level, i, j, lo, hi, out);
    measureAcc += performance.now() - t;
    measureCalls++;
  };

  const selector = body.selector;
  const surface = body.surface;
  const view = { camera: [0, 0, 0] as Vec3, pixelAngle: PIXEL_ANGLE, frustum: new Float64Array(12) };
  const fan = new PoleFanTopology();
  const bent: Vec3 = [0, 0, 0];
  const resolver = new MorphMapResolver();

  const series = {
    metric: [] as number[], measure: [] as number[], select: [] as number[], upload: [] as number[], fan: [] as number[], total: [] as number[],
    splits: [] as number[], newSplits: [] as number[], merges: [] as number[], levelChurn: [] as number[], stale: [] as number[],
    measured: [] as number[], measureCalls: [] as number[], leaves: [] as number[], drawn: [] as number[],
    packed: 0,
  };
  const record = (st: Counts): void => {
    series.splits.push(st.splits);
    series.newSplits.push(st.newSplits);
    series.merges.push(st.merges);
    series.levelChurn.push(st.newSplits + st.merges);
    series.stale.push(st.geometryStale);
    series.measured.push(st.geometryMeasured);
    series.leaves.push(st.leaves);
    series.drawn.push(st.drawn);
  };

  let invalidations = 0;
  let superseded = 0;
  let pending = false;
  let passesThisRefresh = 0;
  const passes: number[] = [];

  for (let f = 0; f < FRAMES; f++) {
    await yieldToEventLoop();
    morph.morph = mode === 'static' ? 0.5 : sweepMorph(f);
    const versionBefore = selector.version;
    const invalidationsBefore = stretch.stats.invalidations;
    const callsBefore = measureCalls;
    const packsBefore = surface.packCount;

    if (mode === 'body') {
      const m0 = measureAcc;
      body.update(camera, VIEWPORT_PX);
      series.total.push(body.selectionMs);
      series.measure.push(measureAcc - m0);
      record(selector.stats);
    } else {
      // Metric: the stretch metric's frame and the selector's camera in it (as `LodTerrainBody.placeStretchCamera`).
      const t0 = performance.now();
      const map = resolver.resolve(morph, RADIUS_M);
      stretch.update({ morph: map.morph, projection: map.projection, radiusM: map.radius, basis: map.basis });
      const cam = map.morph > 0 ? stretch.placeCamera(position, bent) : position;
      const t1 = performance.now();
      // Select: the frustum from the camera's axes, then the selection. The node measures happen inside it and are timed apart.
      view.camera = cam;
      frustumNormals(axes, frustumFov, ASPECT, view.frustum);
      const measureBefore = measureAcc;
      const t2 = performance.now();
      selector.select(view);
      const t3 = performance.now();
      const measured = measureAcc - measureBefore;
      // Upload: the pack on a tree change, the morph frame and the uniforms (the body's pole fan update is inside this).
      view.camera = position;
      surface.setDetailFade(Math.max(4, PIXEL_FLOOR) * view.pixelAngle);
      const t4 = performance.now();
      surface.upload(selector, position);
      const t5 = performance.now();
      const packed = surface.packCount !== packsBefore;
      // The fan's share, from a topology of the bench's own under the same condition (a pack), after the frame.
      let fanOnly = 0;
      if (map.morph > 0) {
        if (packed) {
          const tf = performance.now();
          fan.update(selector, body.settings.domain, 16, selector.stats.drawn, map, POLE_FAN_DEFAULT_RAYS);
          fanOnly = performance.now() - tf;
        }
      } else fan.reset();

      series.metric.push(t1 - t0);
      series.measure.push(measured);
      series.select.push(t3 - t2 - measured);
      series.upload.push(t5 - t4);
      series.fan.push(fanOnly);
      series.total.push(t5 - t0);
      record(selector.stats);
    }
    if (surface.packCount !== packsBefore) series.packed++;
    series.measureCalls.push(measureCalls - callsBefore);

    // Refresh bookkeeping. A refresh settles when the selector reports no stale node left; a refresh that starts before the
    // previous one settled supersedes it.
    if (stretch.stats.invalidations > invalidationsBefore) {
      invalidations++;
      if (pending) superseded++;
      pending = true;
      passesThisRefresh = 0;
    }
    if (pending && selector.version !== versionBefore) passesThisRefresh++;
    if (pending && selector.stats.geometryStale === 0) {
      pending = false;
      passes.push(passesThisRefresh);
    }
  }

  const perFrame: Record<string, Dist> = {};
  for (const key of ['splits', 'newSplits', 'merges', 'levelChurn', 'stale', 'measured', 'measureCalls', 'leaves', 'drawn'] as const) {
    perFrame[key] = dist(series[key]);
  }
  const framesEndingStale = series.stale.filter((s) => s > 0).length;
  const ms: Record<string, Dist> = mode === 'body'
    ? { total: dist(series.total), measure: dist(series.measure) }
    : {
      metric: dist(series.metric), measure: dist(series.measure), select: dist(series.select),
      upload: dist(series.upload), fan: dist(series.fan), total: dist(series.total),
    };
  const out: SweepSummary = {
    label: mode === 'body' ? 'body.update (page path)' : mode === 'static' ? 'static morph 0.5 (control)' : 'sweep (decomposed)',
    budget: String(budget),
    frames: series.total.length,
    packFrames: series.packed,
    elapsedMs: Math.round(performance.now() - started),
    groundHeightM: round(groundHeightM),
    ms,
    perFrame,
    refresh: {
      invalidations,
      settled: passes.length,
      superseded,
      openAtEnd: pending ? 1 : 0,
      passesPerSettled: passes.length ? dist(passes) : null,
      framesEndingStale,
    },
    morphAtEnd: morph.morph,
    stretchStatsAtEnd: stretch.stats,
  };
  console.log(`LOD_MORPH_BENCH ${JSON.stringify(out)}`);
  stretch.dispose();
  body.dispose();
  return out;
}

describe('LOD morph sweep (bench, headless CPU)', () => {
  const cases: [RunMode, number][] = [
    ['body', 300],
    ['sweep', 300],
    ['sweep', 100],
    ['sweep', 1000],
    ['sweep', Infinity],
    ['static', 300],
  ];
  for (const [mode, budget] of cases) {
    it(`morph ${mode} budget ${budget}`, async () => {
      const h = await pageHeights();
      const summary = await runSweep(h, mode, budget);
      expect(summary.frames).toBe(FRAMES);
      if (mode !== 'static' && budget === 300) {
        // Targets from the G6h brief: at most 80 packs of the frames, median under 2 ms, 95th percentile under 8 ms. They are not met after G6i
        // (691 packs; median 2.2 ms isolated and about 4 ms in the full suite; p95 7 ms isolated, 8 to 13 ms in the suite), so these cases fail on purpose.
        // Do not loosen them: they are the measure for the unit that reduces the drawn-set churn.
        expect(summary.packFrames).toBeLessThanOrEqual(80);
        const total = summary.ms['total']!;
        expect(total.median).toBeLessThan(2);
        expect(total.p95).toBeLessThan(8);
      }
    }, 120_000);
  }
});

