import {
  modeActionMs,
  type TestCheck,
  type TestContext,
  type TestMetric,
  type TestObservation,
  type TestRunAdapter,
  type TestScenario,
  type TestSetting,
} from 'triangular-engine/testing';
import type { CharactersLabTestSettings } from './characters-lab-tests';

/**
 * Host interface providing the testing harness direct control and inspection
 * of the Characters Lab page.
 */
export interface CharactersLabTestHost {
  read(): CharactersLabTestSettings;
  apply(settings: CharactersLabTestSettings): void;
  renderedFrames(): number;
  errors(): string;
  resetErrors(): void;
  onRenderComplete(callback: (renderedAt: number) => void): () => void;
  speak(text: string): void;
  isSpeaking(): boolean;
  setTurntableAngle(radians: number | undefined): void;
  environment(): Readonly<Record<string, TestSetting>>;
  thumbnail?(): Promise<Blob | undefined>;
}

const SETTLE_FRAMES = 3;
const TIMER_STEP_MS = 0.1;

export function settingsMismatches(
  actual: CharactersLabTestSettings,
  expected: CharactersLabTestSettings,
): string[] {
  const out: string[] = [];
  if (actual.characterType !== expected.characterType) {
    out.push(`characterType: expected ${expected.characterType}, found ${actual.characterType}`);
  }
  if (actual.presetId !== expected.presetId) {
    out.push(`presetId: expected ${expected.presetId}, found ${actual.presetId}`);
  }
  if (actual.emotion !== expected.emotion) {
    out.push(`emotion: expected ${expected.emotion}, found ${actual.emotion}`);
  }
  if (actual.gait !== expected.gait) {
    out.push(`gait: expected ${expected.gait}, found ${actual.gait}`);
  }
  if (actual.cameraFraming !== expected.cameraFraming) {
    out.push(`cameraFraming: expected ${expected.cameraFraming}, found ${actual.cameraFraming}`);
  }
  return out;
}

/**
 * Creates the TestRunAdapter connecting triangular-engine/testing runner to Characters Lab.
 */
export function createCharactersLabTestAdapter(
  host: CharactersLabTestHost,
): TestRunAdapter<CharactersLabTestSettings, CharactersLabTestSettings> {
  async function waitSettled(
    context: TestContext,
    scenario: TestScenario<CharactersLabTestSettings>,
  ): Promise<void> {
    const startFrames = host.renderedFrames();
    while (host.renderedFrames() - startFrames < SETTLE_FRAMES) {
      context.signal.throwIfAborted();
      await context.wait(16);
    }
  }

  async function runTurntable(
    scenario: TestScenario<CharactersLabTestSettings>,
    context: TestContext,
  ): Promise<number> {
    const durationMs = modeActionMs(scenario, context.mode);
    const began = performance.now();
    host.setTurntableAngle(0);
    while (true) {
      const elapsed = performance.now() - began;
      const t = Math.min(elapsed, durationMs) / durationMs;
      host.setTurntableAngle(t * Math.PI * 2);
      if (elapsed >= durationMs) return elapsed / 1000;
      await context.wait(16);
    }
  }

  return {
    windowModes: true,
    capture: () => host.read(),
    restore: (snapshot) => {
      host.resetErrors();
      host.apply(snapshot);
      host.setTurntableAngle(undefined);
    },
    apply: (scenario) => {
      host.resetErrors();
      host.apply(scenario.settings);
    },
    ready: (context, scenario) => waitSettled(context, scenario),
    measure: async (scenario, context): Promise<TestObservation> => {
      const settings = scenario.settings;
      const intervals: number[] = [];
      let frames = 0;
      let previousAt: number | undefined;

      const offRender = host.onRenderComplete((renderedAt) => {
        frames++;
        if (previousAt !== undefined) {
          intervals.push(renderedAt - previousAt);
        }
        previousAt = renderedAt;
      });

      if (settings.speak && settings.speechText) {
        host.speak(settings.speechText);
      }

      try {
        if (settings.motion === 'turntable') {
          await runTurntable(scenario, context);
        } else {
          await context.measureWindow(scenario);
        }
      } finally {
        offRender();
        if (settings.motion === 'turntable') {
          host.setTurntableAngle(undefined);
        }
      }

      const checks: TestCheck[] = [];
      const mismatches = settingsMismatches(host.read(), settings);
      checks.push({
        name: 'Scenario state applied',
        passed: mismatches.length === 0,
        detail: mismatches.length === 0 ? 'Applied all settings' : mismatches.join('; '),
      });

      const err = host.errors();
      checks.push({
        name: 'No uncaught render errors',
        passed: !err,
        detail: err || undefined,
      });

      checks.push({
        name: 'Rendered frames during measurement',
        passed: frames >= 1,
        detail: `${frames} frames rendered`,
      });

      const metrics: TestMetric[] = [
        {
          name: 'frameInterval',
          unit: 'ms',
          source: 'Inter-frame interval on main render loop (performance.now)',
          samples: intervals,
        },
      ];

      return {
        checks,
        metrics,
      };
    },
  };
}
