import type {
  TestContext,
  TestObservation,
  TestRunAdapter,
} from 'triangular-engine/testing';
import type { IllustrativeSettings } from './illustrative-cell-planet-tests';

export interface IllustrativeTestHost<TSnapshot> {
  capture(): TSnapshot;
  apply(settings: IllustrativeSettings): void;
  restore(snapshot: TSnapshot): void;
  onBeforeFrame(callback: () => void): () => void;
  onFrame(callback: (time: number) => void): () => void;
  move(settings: IllustrativeSettings, fraction: number): void;
  observe(): TestObservation;
  environment(): Readonly<Record<string, string | number | boolean | null>>;
}

/** Only successful renderer completions count. Abort/stall always unsubscribe both frame hooks. */
export function collectIllustrativeFrames<T>(
  host: IllustrativeTestHost<T>,
  context: TestContext,
  durationMs: number,
  settings?: IllustrativeSettings,
): Promise<readonly number[]> {
  return new Promise((resolve, reject) => {
    let start: number | undefined;
    let previous: number | undefined;
    let fraction = 0;
    let completed = 0;
    let nextKey = 0;
    const keys =
      settings?.motion === 'flyover'
        ? [0, 1 / 3, 2 / 3, 1]
        : settings?.motion === 'teleport'
          ? [0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6, 1]
          : settings?.motion === 'zoom'
            ? [0, 0.5, 1]
            : [1];
    let done = false;
    let timer: ReturnType<typeof setTimeout>;
    let offBefore = () => {};
    let offFrame = () => {};
    const samples: number[] = [];
    const clean = () => {
      offBefore();
      offFrame();
      clearTimeout(timer);
      context.signal.removeEventListener('abort', abort);
    };
    const fail = (error: unknown) => {
      if (done) return;
      done = true;
      clean();
      reject(error);
    };
    const abort = () => fail(context.signal.reason ?? new Error('Aborted'));
    const watchdog = () => {
      clearTimeout(timer);
      timer = setTimeout(
        () => fail(new Error('No completed frame for 5 seconds.')),
        5000,
      );
    };
    if (context.signal.aborted) {
      abort();
      return;
    }
    context.signal.addEventListener('abort', abort, { once: true });
    watchdog();
    offBefore = host.onBeforeFrame(() => {
      try {
        const now = performance.now();
        start ??= now;
        fraction =
          durationMs === 0 ? 1 : Math.min(1, (now - start) / durationMs);
        // Present every authored keyframe even if a slow frame overshoots it.
        if (settings && nextKey < keys.length && fraction >= keys[nextKey])
          fraction = keys[nextKey];
        if (settings) host.move(settings, fraction);
      } catch (error) {
        fail(error);
      }
    });
    offFrame = host.onFrame((time) => {
      if (done) return;
      watchdog();
      if (previous !== undefined) samples.push(time - previous);
      previous = time;
      completed++;
      if (settings && fraction === keys[nextKey]) nextKey++;
      // At least three frames after apply, and a completed frame at the final camera position.
      if (completed >= 3 && fraction === 1) {
        done = true;
        clean();
        resolve(samples);
      }
    });
  });
}

export function createIllustrativeAdapter<T>(
  host: IllustrativeTestHost<T>,
): TestRunAdapter<IllustrativeSettings, T> {
  return {
    capture: () => host.capture(),
    apply: (scenario) => host.apply(scenario.settings),
    ready: async (context) => {
      await collectIllustrativeFrames(host, context, 0);
    },
    measure: async (scenario, context) => {
      const samples = await collectIllustrativeFrames(
        host,
        context,
        scenario.durationMs,
        scenario.settings,
      );
      const observed = host.observe();
      return {
        ...observed,
        metrics: [
          {
            name: 'completed-frame-interval',
            unit: 'ms',
            source:
              'EngineService.renderComplete$ timestamps; includes scheduling and CPU work, not GPU time',
            samples,
          },
          ...observed.metrics,
          {
            name: 'gpu-time',
            unit: 'ms',
            source: 'unavailable',
            samples: [],
            optional: true,
            unavailableReason:
              'This WebGL comparison has no GPU timestamp provider.',
          },
        ],
      };
    },
    restore: async (snapshot, context) => {
      host.restore(snapshot);
      await collectIllustrativeFrames(host, context, 0);
    },
    environment: () => host.environment(),
  };
}
