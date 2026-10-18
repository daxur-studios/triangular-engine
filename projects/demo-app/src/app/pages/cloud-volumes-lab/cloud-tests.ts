import type { TestScenario, TestSuite } from 'triangular-engine/testing';
import { NEXT_TEST, type NextTestMode, type NextTestScenario } from './next-test';

/** Fully resolved settings prevent inherited manual state or previous scenarios from changing a rerun. */
export interface CloudTestSettings {
  readonly kind: 'static' | 'flyby';
  readonly preset: string;
  readonly volumes: 1 | 4 | 12;
  readonly mode: NextTestMode;
  readonly scale: number;
  readonly steps: number;
  readonly animateSun: boolean;
  readonly bakeBudget: number;
  readonly rebakeEveryFrame: boolean;
  readonly spinWarp: number;
  readonly spinAngle: number;
  readonly clouds: boolean;
  readonly atmosphereLighting: boolean;
  readonly haze: boolean;
  readonly sunElevation: number;
  readonly sunAzimuth: number;
  readonly extinction: number;
  readonly jitter: boolean;
  readonly fetch: boolean;
  readonly hidden: boolean;
  readonly skyBackdrop: boolean;
}

export const CLOUD_TEST_DEFAULTS: CloudTestSettings = {
  kind: 'static', preset: 'outside', volumes: 1, mode: 'proxy', scale: 1, steps: 24,
  animateSun: false, bakeBudget: 1, rebakeEveryFrame: false, spinWarp: 0, spinAngle: 0, clouds: true,
  atmosphereLighting: true, haze: false, sunElevation: 35, sunAzimuth: 40,
  extinction: 0.02, jitter: true, fetch: true, hidden: false, skyBackdrop: false,
};

function migrateScenario(scenario: NextTestScenario, index: number): TestScenario<CloudTestSettings> {
  return {
    id: `haze-case-${index + 1}`, label: scenario.label,
    durationMs: (scenario.seconds ?? (scenario.kind === 'flyby' ? 12 : 3)) * 1000,
    warmupMs: 1500,
    settings: {
      ...CLOUD_TEST_DEFAULTS,
      kind: scenario.kind,
      preset: scenario.preset ?? 'horizon',
      volumes: scenario.volumes ?? CLOUD_TEST_DEFAULTS.volumes,
      mode: scenario.mode ?? CLOUD_TEST_DEFAULTS.mode,
      scale: scenario.scale ?? CLOUD_TEST_DEFAULTS.scale,
      steps: scenario.steps ?? CLOUD_TEST_DEFAULTS.steps,
      animateSun: scenario.animateSun ?? CLOUD_TEST_DEFAULTS.animateSun,
      bakeBudget: scenario.bakeBudget ?? CLOUD_TEST_DEFAULTS.bakeBudget,
      rebakeEveryFrame: scenario.rebakeEveryFrame ?? CLOUD_TEST_DEFAULTS.rebakeEveryFrame,
      spinWarp: scenario.spinWarp ?? CLOUD_TEST_DEFAULTS.spinWarp,
      clouds: scenario.clouds ?? CLOUD_TEST_DEFAULTS.clouds,
      atmosphereLighting: scenario.atmosphereLighting ?? CLOUD_TEST_DEFAULTS.atmosphereLighting,
      haze: scenario.haze ?? CLOUD_TEST_DEFAULTS.haze,
    },
  };
}

/** Append new suites/versions at the end. Run latest resolves the final entry exactly once at launch. */
export const CLOUD_TEST_HISTORY: readonly TestSuite<CloudTestSettings>[] = [
  {
    id: 'cloud-runner-smoke', version: 1, title: 'Runner smoke: static then moving camera', purpose: 'functional',
    scenarios: [
      { id: 'static', label: 'Static controls and restoration', durationMs: 250, settings: { ...CLOUD_TEST_DEFAULTS, clouds: false } },
      { id: 'flyby', label: 'Timed camera movement', durationMs: 500, settings: { ...CLOUD_TEST_DEFAULTS, kind: 'flyby', clouds: false } },
    ],
  },
  {
    id: 'cloud-haze-cost', version: 1, title: NEXT_TEST.title, purpose: 'performance', requiresVisualReview: true,
    scenarios: NEXT_TEST.scenarios.map(migrateScenario),
  },
];
