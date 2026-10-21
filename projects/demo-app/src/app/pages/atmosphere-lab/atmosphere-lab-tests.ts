import type { AtmospherePresetId } from 'triangular-engine/atmosphere';
import type { TestScenario, TestSuite } from 'triangular-engine/testing';

export type LabProjection = 'equirect' | 'equalEarth';
export type LabSkyPath = 'auto' | 'table' | 'march';
export type LabDayNight = 'real' | 'alwaysDay';
export type LabPreset = AtmospherePresetId;

/** Everything the lab page lets a person change that a scenario touches. Restorable as a unit. */
export interface AtmosphereLabState {
  readonly bentOn: boolean;
  readonly planetRadiusM: number;
  readonly preset: LabPreset;
  readonly projection: LabProjection;
  readonly skyPath: LabSkyPath;
  readonly maskEnabled: boolean;
  readonly dayNight: LabDayNight;
  readonly morph: number;
  /** The camera's ground point as fractions (-1..1) of the map's half-width and half-height. */
  readonly anchor: readonly [number, number];
  readonly altitudeM: number;
  readonly yawDeg: number;
  readonly pitchDeg: number;
  readonly sunElevationDeg: number;
  readonly sunAzimuthDeg: number;
  readonly exposure: number;
}

/**
 * Fully resolved scenario inputs. `morphKeys` is the morph (`[m]`, static) or the keyframes of a sweep
 * (`[0, 1, 0]`: equal time per leg, eased). `bentOn: false` is the plain globe backdrop, the comparison for the cost suites.
 */
export interface AtmosphereLabTestSettings extends Omit<AtmosphereLabState, 'morph'> {
  readonly kind: 'static' | 'sweep';
  readonly morphKeys: readonly number[];
  /**
   * Whether the half-resolution masked pass should be active on every frame of the window: `true` where the
   * camera is above the air, `false` where it must not be, `null` where it depends on the edge distance.
   */
  readonly expectMaskedPass: boolean | null;
}

/** Earth, written out so a retained suite never drifts from the page's size list. */
const EARTH_RADIUS_M = 6_371_000;

/** The lab's Phase 3a gate views, as explicit numbers (altitude = multiple of the radius times the radius). */
const VIEWS = {
  space: { altitudeM: 3 * EARTH_RADIUS_M, yawDeg: 0, pitchDeg: -90, sunElevationDeg: 40, sunAzimuthDeg: 90, exposure: 6 },
  lowOrbit: { altitudeM: 0.05 * EARTH_RADIUS_M, yawDeg: 0, pitchDeg: -16, sunElevationDeg: 35, sunAzimuthDeg: 90, exposure: 8 },
  /** 25 km up, looking down and out: in the air, above most of it. */
  airHigh: { altitudeM: 25_000, yawDeg: 0, pitchDeg: -16, sunElevationDeg: 35, sunAzimuthDeg: 90, exposure: 8 },
  /** 2 m up: the camera on the ground, where the table path alone is expected. */
  ground: { altitudeM: 2, yawDeg: 0, pitchDeg: 12, sunElevationDeg: 60, sunAzimuthDeg: 90, exposure: 8 },
  sideOnEdge: { altitudeM: 0.004 * EARTH_RADIUS_M, yawDeg: 90, pitchDeg: 1, sunElevationDeg: 35, sunAzimuthDeg: 90, exposure: 8 },
} as const;

const BASE: AtmosphereLabTestSettings = {
  kind: 'static',
  bentOn: true,
  planetRadiusM: EARTH_RADIUS_M,
  preset: 'earth',
  projection: 'equirect',
  skyPath: 'auto',
  maskEnabled: true,
  dayNight: 'real',
  anchor: [0, 0],
  ...VIEWS.lowOrbit,
  morphKeys: [0],
  expectMaskedPass: null,
};

const morphId = (morph: number) => String(morph).replace('.', '_');

function scenario(
  id: string, label: string, durationMs: number, overrides: Partial<AtmosphereLabTestSettings>, warmupMs = 300,
): TestScenario<AtmosphereLabTestSettings> {
  return { id, label, durationMs, warmupMs, settings: { ...BASE, ...overrides } };
}

/** The Plan 049 Phase 3a checks that were still waiting for a person to scrub and look. */
const LOOK_SCENARIOS: readonly TestScenario<AtmosphereLabTestSettings>[] = [
  scenario('scrub-equirect', 'Morph scrub 0 → 1 → 0, equirect, low orbit', 8000,
    { kind: 'sweep', morphKeys: [0, 1, 0] }),
  scenario('scrub-equal-earth', 'Morph scrub 0 → 1 → 0, Equal Earth, low orbit', 8000,
    { kind: 'sweep', morphKeys: [0, 1, 0], projection: 'equalEarth' }),
  scenario('equal-earth-low-morph', 'Equal Earth near flat: morph 0.05 → 0.3 → 0.05', 6000,
    { kind: 'sweep', morphKeys: [0.05, 0.3, 0.05], projection: 'equalEarth' }),
  scenario('rim-glow-equirect', 'Rim glow from space at the map edge, equirect, morph 0.5', 3000,
    { ...VIEWS.space, morphKeys: [0.5], anchor: [0.9, 0], expectMaskedPass: true }),
  scenario('rim-glow-equal-earth', 'Rim glow from space at the map edge, Equal Earth, morph 0.5', 3000,
    { ...VIEWS.space, morphKeys: [0.5], anchor: [0.9, 0], projection: 'equalEarth', expectMaskedPass: true }),
  scenario('side-on-east-edge', 'Low and side-on at the east edge, morph 0.2', 3000,
    { ...VIEWS.sideOnEdge, morphKeys: [0.2], anchor: [0.6, 0] }),
];

/** Timing rows from the Phase 3a gate (space and low orbit at morph 0 / 0.5 / 1), for the diagnostic GPU frame readout. */
const COST_SCENARIOS: readonly TestScenario<AtmosphereLabTestSettings>[] = [
  ...(['space', 'lowOrbit'] as const).flatMap((view) =>
    [0, 0.5, 1].map((morph) =>
      scenario(`cost-${view === 'space' ? 'space' : 'low-orbit'}-morph-${morphId(morph)}`,
        `${view === 'space' ? 'Space' : 'Low orbit'}, morph ${morph}`, 4000,
        { ...VIEWS[view], morphKeys: [morph], expectMaskedPass: view === 'space' ? true : null }, 600)),
  ),
];

/**
 * Plan 049 Phase 3a follow-up cost matrix: the plain globe, then the bent planet on the table path (`auto`) and the
 * per-pixel march, at morph 0 / 0.5 / 1, for four views. Whole-frame GPU time per render pass, on the target GPU.
 */
const COST_V2_VIEWS = [
  { key: 'space', label: 'Space (3 R)', view: VIEWS.space, march: true },
  { key: 'low-orbit', label: 'Low orbit (0.05 R)', view: VIEWS.lowOrbit, march: true },
  { key: 'air-high', label: '25 km up', view: VIEWS.airHigh, march: true },
  { key: 'ground', label: '2 m up', view: VIEWS.ground, march: false },
] as const;

const COST_V2_SCENARIOS: readonly TestScenario<AtmosphereLabTestSettings>[] = COST_V2_VIEWS.flatMap(({ key, label, view, march }) => {
  const space = key === 'space';
  const run = (id: string, text: string, overrides: Partial<AtmosphereLabTestSettings>) =>
    scenario(`${id}-${key}`, `${label}, ${text}`, 3000, { ...view, ...overrides }, 600);
  return [
    run('plain', 'plain globe', { bentOn: false, morphKeys: [0] }),
    ...[0, 0.5, 1].map((morph) =>
      run(`auto-m${morphId(morph)}`, `bent, table + edges, morph ${morph}`, { morphKeys: [morph], expectMaskedPass: space ? true : null })),
    ...(march ? [0, 0.5, 1].map((morph) =>
      run(`march-m${morphId(morph)}`, `bent, march every pixel, morph ${morph}`, { morphKeys: [morph], skyPath: 'march' as const })) : []),
  ];
});

/** Append new suites/versions at the end; Run latest resolves the final entry once at launch. */
export const ATMOSPHERE_LAB_TEST_HISTORY: readonly TestSuite<AtmosphereLabTestSettings>[] = [
  {
    id: 'bent-atmosphere-look',
    version: 1,
    title: 'Bent atmosphere: morph scrub, Equal Earth near flat, rim glow',
    purpose: 'functional',
    requiresVisualReview: true,
    scenarios: LOOK_SCENARIOS,
  },
  {
    id: 'bent-atmosphere-cost',
    version: 1,
    title: 'Bent atmosphere: GPU frame cost, space and low orbit',
    purpose: 'performance',
    scenarios: COST_SCENARIOS,
  },
  {
    id: 'bent-atmosphere-cost',
    version: 2,
    title: 'Bent atmosphere: GPU cost per pass, plain globe vs table vs march',
    purpose: 'performance',
    expectedGpuVendor: 'nvidia',
    scenarios: COST_V2_SCENARIOS,
  },
];
