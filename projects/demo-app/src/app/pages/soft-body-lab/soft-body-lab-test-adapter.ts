import type { TestCheck, TestContext, TestMetric, TestObservation, TestRunAdapter, TestScenario, TestSetting } from 'triangular-engine/testing';
import { waitRenderedFrames } from 'triangular-engine/testing';
import type { SoftBodyExampleId, SoftBodyLabSettings } from './soft-body-lab-tests';

/** What a run changes on the page. */
export interface SoftBodyLabSnapshot {
  readonly example: SoftBodyExampleId;
  readonly seed: number;
}

/** Aggregate over every soft body the current example shows. */
export interface SoftBodyLabAggregate {
  readonly softBodies: number;
  readonly vertices: number;
  readonly shapeErrorRms: number;
  readonly shapeErrorP95: number;
  readonly maxVolumeRatio: number;
  readonly maxPressure: number;
  readonly minVolumeRatio: number;
  readonly volumeRatios: readonly number[];
  readonly minWorldY: number;
  readonly nonFiniteVertices: number;
}

/** The page surface the adapter drives; all Jolt reading stays behind it. */
export interface SoftBodyLabTestHost {
  /** The engine's frame stream, for `waitRenderedFrames`. */
  readonly engine: { readonly beforeRender$: { subscribe(next: () => void): { unsubscribe(): void } } };
  read(): SoftBodyLabSnapshot;
  apply(settings: SoftBodyLabSettings): void;
  restore(snapshot: SoftBodyLabSnapshot): void;
  waitReady(context: TestContext, settings: SoftBodyLabSettings): Promise<void>;
  sample(): SoftBodyLabAggregate;
  onRenderComplete(callback: () => void): () => void;
  errors(): string;
  resetErrors(): void;
  captureThumbnail(signal: AbortSignal): Promise<Blob>;
  environment(): Readonly<Record<string, TestSetting>>;
}

/** Cloth: a P95 edge strain above this is a torn or exploded cloth, not a drop test. */
const MAX_CLOTH_SHAPE_ERROR = 0.35;
/** Pressure: the highest-pressure sphere must hold (most of) its rest volume. */
const MIN_HIGH_PRESSURE_VOLUME_RATIO = 0.9;
/** Pressure: the lowest and highest pressure spheres must differ, which is the point of the demo. */
const MIN_PRESSURE_VOLUME_SPREAD = 0.3;
/** A particle more than this far below the floor (y = 0) is a pass-through. */
const MAX_FLOOR_PENETRATION_M = 0.05;

export function createSoftBodyLabTestAdapter(
  host: SoftBodyLabTestHost,
): TestRunAdapter<SoftBodyLabSettings, SoftBodyLabSnapshot> {
  return {
    windowModes: true,
    capture: () => host.read(),
    apply: (scenario) => {
      host.resetErrors();
      host.apply(scenario.settings);
    },
    ready: (context, scenario) => host.waitReady(context, scenario.settings),
    measure: async (scenario, context): Promise<TestObservation> => {
      context.signal.throwIfAborted();
      const example = scenario.settings.example;
      const shapeSamples: number[] = [];
      const minYSamples: number[] = [];
      const stop = host.onRenderComplete(() => {
        const sample = host.sample();
        if (example === 'cloth' && Number.isFinite(sample.shapeErrorRms)) shapeSamples.push(sample.shapeErrorRms * 100);
        if (Number.isFinite(sample.minWorldY)) minYSamples.push(sample.minWorldY);
      });
      try {
        await context.measureWindow(scenario);
      } finally {
        stop();
      }
      await waitRenderedFrames(host, context, 2);
      const final = host.sample();
      const error = host.errors();
      const deepestVertex = minYSamples.length ? Math.min(...minYSamples) : final.minWorldY;
      const penetrationM = Number.isFinite(deepestVertex) ? Math.max(0, -deepestVertex) : Number.NaN;

      const checks: TestCheck[] = [
        {
          name: 'Soft bodies created',
          passed: final.softBodies > 0,
          detail: `${final.softBodies} soft bodies, ${final.vertices} particles`,
        },
        {
          name: 'All particle positions finite',
          passed: final.nonFiniteVertices === 0,
          detail: `${final.nonFiniteVertices} non-finite vertices`,
        },
        {
          name: 'No particle passes through the floor',
          passed: Number.isFinite(penetrationM) && penetrationM <= MAX_FLOOR_PENETRATION_M,
          detail: `deepest particle ${deepestVertex.toFixed(3)} m, penetration ${penetrationM.toFixed(3)} m (limit ${MAX_FLOOR_PENETRATION_M} m)`,
        },
        { name: 'No engine, window or console error', passed: error === '', detail: error || undefined },
      ];
      if (example === 'cloth') {
        checks.push({
          name: 'Cloth keeps its mesh under the spheres',
          passed: final.shapeErrorP95 <= MAX_CLOTH_SHAPE_ERROR,
          detail: `p95 edge strain ${(final.shapeErrorP95 * 100).toFixed(1)}% (limit ${(MAX_CLOTH_SHAPE_ERROR * 100).toFixed(0)}%)`,
        });
      } else {
        const spread = final.maxVolumeRatio - final.minVolumeRatio;
        checks.push({
          name: 'Pressure changes the spheres',
          passed: spread >= MIN_PRESSURE_VOLUME_SPREAD,
          detail: `volume ratio ${final.minVolumeRatio.toFixed(2)} .. ${final.maxVolumeRatio.toFixed(2)} (spread ${spread.toFixed(2)}, limit ${MIN_PRESSURE_VOLUME_SPREAD})`,
        });
        checks.push({
          name: 'The highest pressure holds its volume',
          passed: final.maxVolumeRatio >= MIN_HIGH_PRESSURE_VOLUME_RATIO,
          detail: `max volume ratio ${final.maxVolumeRatio.toFixed(2)} (limit ${MIN_HIGH_PRESSURE_VOLUME_RATIO})`,
        });
      }

      const shapeMetric: TestMetric = {
        name: 'shapeError',
        unit: '%',
        source: 'RMS edge-length strain against the generated rest mesh, per rendered frame',
        samples: shapeSamples,
        unavailableReason: example === 'cloth' ? undefined : 'Shape strain grows by design under pressure; the volume metric covers this example',
      };
      const volumeMetric: TestMetric = {
        name: 'volumeRatio',
        unit: 'ratio',
        source: 'Largest soft body mesh volume / its rest volume at the end of the window',
        samples: example === 'pressure' ? [final.maxVolumeRatio] : [],
        unavailableReason: example === 'pressure' ? undefined : 'A cloth is an open mesh; volume is not meaningful',
      };
      const penetrationMetric: TestMetric = {
        name: 'penetration',
        unit: 'm',
        source: 'Deepest particle below the floor plane (y = 0) over the window',
        samples: Number.isFinite(penetrationM) ? [penetrationM] : [],
      };

      return {
        metrics: [shapeMetric, volumeMetric, penetrationMetric],
        checks,
        details: {
          example,
          seed: scenario.settings.seed,
          particles: final.vertices,
          shapeErrorRmsPct: final.shapeErrorRms * 100,
          shapeErrorP95Pct: final.shapeErrorP95 * 100,
          maxVolumeRatio: final.maxVolumeRatio,
          maxPressure: final.maxPressure,
          minVolumeRatio: final.minVolumeRatio,
          volumeRatios: final.volumeRatios.map((value) => value.toFixed(2)).join(','),
          deepestParticleM: deepestVertex,
          floorPenetrationM: penetrationM,
          renderedFrames: shapeSamples.length,
        },
        limitations: [
          'The engine steps Jolt at a fixed 1/240 s; the official pages step at the rendered delta (clamped to 1/30 s), so trajectories are comparable but not identical.',
          'The ten cloth spheres use a seeded position instead of the official Math.random().',
          'Matching the official pages is primarily a visual judgement; these checks only catch a collapsed, torn, exploding or escaping soft body.',
        ],
      };
    },
    thumbnail: async (_scenario, context) => (context.repetition > 1 ? undefined : [await host.captureThumbnail(context.signal)]),
    restore: async (snapshot, context) => {
      host.restore(snapshot);
      await waitRenderedFrames(host, context, 2);
    },
    environment: () => host.environment(),
  };
}




