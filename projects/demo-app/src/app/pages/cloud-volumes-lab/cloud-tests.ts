import type { TestScenario, TestSuite } from 'triangular-engine/testing';
import { NEXT_TEST, type NextTestMode, type NextTestScenario } from './next-test';

/** Fully resolved settings prevent inherited manual state or previous scenarios from changing a rerun. */
export interface CloudTestSettings {
  readonly kind: 'static' | 'flyby';
  readonly preset: string;
  readonly volumes: number;
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
  /** The planet-wide noise shell (`CloudNoiseShell`) instead of the volumes. */
  readonly noiseShell: boolean;
}

export const CLOUD_TEST_DEFAULTS: CloudTestSettings = {
  kind: 'static', preset: 'outside', volumes: 1, mode: 'proxy', scale: 1, steps: 24,
  animateSun: false, bakeBudget: 1, rebakeEveryFrame: false, spinWarp: 0, spinAngle: 0, clouds: true,
  atmosphereLighting: true, haze: false, sunElevation: 35, sunAzimuth: 40,
  extinction: 0.02, jitter: true, fetch: true, hidden: false, skyBackdrop: false, noiseShell: false,
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

/** Rounds per arm of the A/B suite: `compareAblation` needs two to measure noise; three survive one bad round. */
const AB_ROUNDS = 3;

/**
 * Plan 055 frame budget: what the clouds add to a frame, as one fixed cost. Alternating rounds with clouds off (A) and on
 * (B) at a still camera, 12 volumes, proxies, atmosphere lighting and haze on (the full Plan 051 feature set), sun and
 * spin still so nothing rebakes after settling. Off still draws the rest of the lab, so B - A is the clouds alone.
 */
function cloudRounds(preset: string): TestScenario<CloudTestSettings>[] {
  return Array.from({ length: AB_ROUNDS * 2 }, (_, index) => {
    const on = index % 2 === 1;
    const round = Math.floor(index / 2) + 1;
    return {
      id: `${preset}-clouds-${on ? 'on' : 'off'}-${round}`, label: `${preset}, clouds ${on ? 'on' : 'off'}, round ${round}`,
      durationMs: 5000, warmupMs: 1500,
      settings: { ...CLOUD_TEST_DEFAULTS, preset, volumes: 12, mode: 'proxy', clouds: on, atmosphereLighting: true, haze: true },
      ablation: { group: preset, arm: on ? 'B' : 'A' },
    };
  });
}

/**
 * Plan 051 Phase 6 stress test: a planet covered by noise volumes. Per view, clouds off (the baseline the cost is taken
 * against), then 12, 90 and 180 volumes (90 = about half the globe, 180 = a full tiling), proxies, haze off, still sun.
 */
function globeCoverScenarios(): TestScenario<CloudTestSettings>[] {
  return ['globe orbit', 'globe mid', 'ground'].flatMap((preset) =>
    [0, 12, 90, 180].map((volumes): TestScenario<CloudTestSettings> => ({
      id: `${preset.replace(' ', '-')}-${volumes === 0 ? 'off' : volumes}`,
      label: `${preset}, ${volumes === 0 ? 'clouds off' : `${volumes} volumes`}`,
      durationMs: 4000, warmupMs: 2000,
      settings: { ...CLOUD_TEST_DEFAULTS, preset, volumes: volumes === 0 ? 12 : volumes, mode: 'proxy', clouds: volumes !== 0, atmosphereLighting: true },
    })),
  );
}

/** The views the shell has to hold up from: inside the layer, under it, at the limb and from orbit. */
const SHELL_VIEWS = ['ground', 'horizon', 'globe mid', 'globe orbit'];

/**
 * Plan 051 G6 for the noise shell: alternating rounds with nothing (A) and the shell (B) at a still camera and a still
 * clock, so B - A is the shell alone on the same frames. Budget: typical 1.5 ms, worst 2.5 ms over the baseline.
 */
function shellCostRounds(preset: string): TestScenario<CloudTestSettings>[] {
  return Array.from({ length: AB_ROUNDS * 2 }, (_, index) => {
    const on = index % 2 === 1;
    const round = Math.floor(index / 2) + 1;
    return {
      id: `${preset.replace(' ', '-')}-shell-${on ? 'on' : 'off'}-${round}`, label: `${preset}, shell ${on ? 'on' : 'off'}, round ${round}`,
      durationMs: 4000, warmupMs: 2000,
      settings: { ...CLOUD_TEST_DEFAULTS, preset, clouds: false, noiseShell: on },
      ablation: { group: preset, arm: on ? 'B' : 'A' },
    };
  });
}

/** What the shell has to look like: every view by day, then the dusk and night sides. An observer judges these. */
function shellLookScenarios(skyBackdrop = false): TestScenario<CloudTestSettings>[] {
  const light = [
    { name: 'noon', sunElevation: 60 },
    { name: 'dusk', sunElevation: 4 },
    { name: 'night', sunElevation: -20 },
  ];
  return SHELL_VIEWS.flatMap((preset) => light.map(({ name, sunElevation }): TestScenario<CloudTestSettings> => ({
    id: `${preset.replace(' ', '-')}-${name}`, label: `${preset}, ${name}`,
    durationMs: 300, warmupMs: 1000,
    settings: { ...CLOUD_TEST_DEFAULTS, preset, clouds: false, noiseShell: true, sunElevation, skyBackdrop },
  })));
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
  {
    id: 'cloud-cost-ab', version: 1,
    title: 'Clouds A/B for the Plan 055 frame budget: clouds off (A) and on (B), 12 volumes, haze on, outside / inside / horizon',
    purpose: 'performance',
    expectedGpuVendor: 'nvidia',
    ablation: { feature: 'clouds', metrics: ['gpuWholeRender'] },
    scenarios: ['outside', 'inside', 'horizon'].flatMap(cloudRounds),
  },
  {
    id: 'cloud-globe-cover', version: 1,
    title: 'Planet cover stress test: clouds off vs 12 / 90 / 180 noise volumes, from orbit, mid altitude and the ground',
    purpose: 'performance', requiresVisualReview: true,
    scenarios: globeCoverScenarios(),
  },
  {
    id: 'cloud-shell-look', version: 1,
    title: 'Noise shell look: ground, horizon, mid and orbit at noon, dusk and night',
    purpose: 'functional', requiresVisualReview: true,
    scenarios: shellLookScenarios(),
  },
  {
    id: 'cloud-shell-cost', version: 1,
    title: 'Noise shell A/B against G6: nothing (A) vs shell (B), ground, horizon, mid and orbit',
    purpose: 'performance',
    expectedGpuVendor: 'nvidia',
    ablation: { feature: 'noise shell', metrics: ['gpuWholeRender'] },
    scenarios: SHELL_VIEWS.flatMap(shellCostRounds),
  },
  {
    id: 'cloud-shell-look', version: 2,
    title: 'Noise shell look against the sky: ground, horizon, mid and orbit at noon, dusk and night',
    purpose: 'functional', requiresVisualReview: true,
    scenarios: shellLookScenarios(true),
  },
];
