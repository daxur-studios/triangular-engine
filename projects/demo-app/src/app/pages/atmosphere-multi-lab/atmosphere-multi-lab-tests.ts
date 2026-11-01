import type { TestScenario, TestSuite } from 'triangular-engine/testing';

/**
 * Plan 078 spike-measure. Two planets with atmospheres in one scene: planet A (Earth-sized, at the origin, one world unit
 * is one Earth radius) and moon B (1737 km radius, 6 units away). Units: world units; metres divide by the Earth radius.
 */
export const EARTH_RADIUS_M = 6_371_000;
export const MOON_RADIUS_M = 1_737_000;
export const MOON_RADIUS_UNITS = MOON_RADIUS_M / EARTH_RADIUS_M;
export const MOON_CENTRE: readonly [number, number, number] = [6, 0.6, 0];
/** Direction to the sun in both bodies' frames (they are not rotated, so it is also the world direction). */
export const SUN_DIRECTION: readonly [number, number, number] = [0.5, 0.35, 0.8];

/** Camera poses, looking at a target. Positions in world units (one unit = one Earth radius). */
export type MultiView = 'spaceBoth' | 'insideA' | 'insideB' | 'nearA' | 'farA' | 'nearB' | 'farB';
/** Which atmospheres are on: both, only A, only B, or neither (the plain bodies, the cost floor). */
export type MultiArm = 'both' | 'a' | 'b' | 'none';

export interface MultiAtmosphereSettings {
  readonly view: MultiView;
  readonly arm: MultiArm;
  /** Turns off the half-resolution space pass on both atmospheres (every pixel marched). Q1 comparison. */
  readonly fullMarch: boolean;
}

interface Pose {
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
}

const ALT_A_UNITS = 25_000 / EARTH_RADIUS_M;
const ALT_B_UNITS = 5_000 / EARTH_RADIUS_M;
const [MX, MY, MZ] = MOON_CENTRE;

export const VIEW_POSES: Readonly<Record<MultiView, Pose>> = {
  /** Both bodies in view from space. */
  spaceBoth: { position: [3, 1, 6], target: [3, 0.3, 0] },
  /** 25 km above planet A, looking along the ground: the horizon sits at the screen centre. */
  insideA: { position: [0, 0, 1 + ALT_A_UNITS], target: [1, 0, 1 + ALT_A_UNITS] },
  /** 5 km above the moon, looking along its ground. */
  insideB: { position: [MX, MY, MOON_RADIUS_UNITS + ALT_B_UNITS], target: [MX + 1, MY, MOON_RADIUS_UNITS + ALT_B_UNITS] },
  /** Space, close to A (A fills the view), moon far off. */
  nearA: { position: [0, 0.3, 3], target: [0, 0, 0] },
  /** Space, far from A, the moon at its own distance. */
  farA: { position: [4, 1, 9], target: [0, 0, 0] },
  /** Space, close to the moon (it fills the view), planet A far off. */
  nearB: { position: [MX, MY + 0.3, 0.9], target: [MX, MY, 0] },
  /** Space, far from the moon. */
  farB: { position: [9, 1.2, 6], target: [MX, MY, 0] },
};

/** The matrix: each close and far view with every arm, so per-planet cost is the arm difference at the same pose. */
const MATRIX_VIEWS: readonly MultiView[] = ['nearA', 'farA', 'nearB', 'farB'];
const MATRIX_ARMS: readonly MultiArm[] = ['none', 'a', 'b', 'both'];

function scenario(view: MultiView, arm: MultiArm, fullMarch = false): TestScenario<MultiAtmosphereSettings> {
  const suffix = fullMarch ? '-full' : '';
  const label = `${view} · ${arm === 'both' ? 'both atmospheres' : arm === 'none' ? 'no atmosphere' : `only ${arm === 'a' ? 'A' : 'B'}`}${fullMarch ? ' · full-res march' : ''}`;
  return {
    id: `${view}-${arm}${suffix}`,
    label,
    durationMs: 3000,
    warmupMs: 600,
    settings: { view, arm, fullMarch },
  };
}

const SCENARIOS: readonly TestScenario<MultiAtmosphereSettings>[] = [
  // The five required cases, first.
  scenario('spaceBoth', 'both'),
  scenario('insideA', 'both'),
  scenario('insideB', 'both'),
  scenario('nearA', 'both'),
  scenario('nearB', 'both'),
  scenario('spaceBoth', 'a'),
  scenario('spaceBoth', 'b'),
  scenario('spaceBoth', 'none'),
  // Single-atmosphere comparisons from inside the air.
  scenario('insideA', 'a'),
  scenario('insideB', 'b'),
  // Per-planet cost matrix: near and far, every arm.
  ...MATRIX_VIEWS.flatMap((view) => MATRIX_ARMS.map((arm) => scenario(view, arm))),
  // Q1: the same close-to-A view with the half-resolution space pass off (runs after nearA-both, which it compares with).
  scenario('nearA', 'both', true),
];

export const MULTI_ATMOSPHERE_TEST_HISTORY: readonly TestSuite<MultiAtmosphereSettings>[] = [
  {
    id: 'atmosphere-multi-lab',
    version: 1,
    title: 'Plan 078 spike: two atmospheres (planet + moon), black wipe, per-planet space cost',
    purpose: 'performance',
    scenarios: SCENARIOS,
  },
];
