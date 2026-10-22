import type { TestBaseline, TestScenario, TestSuite } from 'triangular-engine/testing';
import baselineV1 from './planet-shape-baseline.v1.json';
import morphBaselineV1 from './planet-shape-morph-baseline.v1.json';
import { BODIES, FIXED_SEED, type BodyId } from './planet-shape-config';
import { CAMERA_POSES, type CameraPoseId, type CameraView } from './planet-shape-camera';
import { unitM } from './planet-shape-field';
import { defaultFeatureState, withFeature, type FeatureState } from './planet-shape-features';
import type { TerrainEditPresetId } from './planet-shape-edits';
import { DEFAULT_RAY_STEPS } from './planet-shape-raymarch';

export const RAY_BIOMES = ['blend', 'canyons', 'hills'] as const;
export type RayBiome = (typeof RAY_BIOMES)[number];
/** Rock mode of terrain v2: each biome's own, wild (3D noise, floaters possible) or grounded (warped height surface). */
export const RAY_ROCKS = ['biome', 'wild', 'grounded'] as const;
export type RayRock = (typeof RAY_ROCKS)[number];

/** Fully resolved, so a rerun cannot inherit anything from the manual controls. */
export interface PlanetShapeTestSettings {
  /**
   * `empty` draws nothing at all: the noise floor of the machine, browser and renderer. `sphere` is the plain sphere;
   * `raymarch` the first raymarched terrain (Phase 1, contender C minimal: no morph, no shadows); `raymarch-lit` its
   * second try (a 3D density field with canyons and overhangs, sky, optional soft shadow).
   */
  /** `mesh-b`: contender B (`contender-b/`), drawn with terrain v2's field and settings. */
  readonly kind: 'empty' | 'sphere' | 'raymarch' | 'raymarch-lit' | 'mesh-b';
  readonly seed: number;
  readonly bodyId: BodyId;
  readonly poseId: CameraPoseId;
  /** Time warp of the body spin; 0 = paused. */
  readonly spinWarp: number;
  readonly spinAngleDeg: number;
  readonly features: FeatureState;
  /** Sphere (0) to flat map (1): a visual transform only, applied by the engine's `planetMorphGraph`. */
  readonly morph: number;
  /** Most march steps per pixel of the raymarched terrain; ignored by the other kinds. */
  readonly raySteps: number;
  /** Pre-pass resolution divisor of terrain v2 (0 = off); ignored by the other kinds. */
  readonly rayPrepass: number;
  /** Edit list of terrain v2 (`planet-shape-edits.ts`); ignored by the other kinds. */
  readonly rayEdits: TerrainEditPresetId;
  /** Biomes of terrain v2: the blend mask, or one biome everywhere; ignored by the other kinds. */
  readonly rayBiome: RayBiome;
  /** Rock mode of terrain v2; ignored by the other kinds. */
  readonly rayRock: RayRock;
  /**
   * `quality` measures the view against the exact sphere, `terrain-quality` the raymarched terrain's march against its
   * slow reference march (`planet-shape-terrain-quality.ts`), instead of timing it; absent = timing.
   */
  readonly probe?: 'quality' | 'terrain-quality';
  /** A free-camera view that replaces the pose (close-ups of one landform); absent = the pose. */
  readonly view?: CameraView;
  /** Contender B's near volume zone; `false` is the shell alone (contender A). Absent = on; ignored by the other kinds. */
  readonly meshBlocks?: boolean;
}

export const PLANET_SHAPE_DEFAULTS: PlanetShapeTestSettings = {
  kind: 'sphere', seed: FIXED_SEED, bodyId: '600km', poseId: 'orbit', spinWarp: 1000, spinAngleDeg: 0, features: defaultFeatureState(), morph: 0,
  raySteps: DEFAULT_RAY_STEPS, rayPrepass: 0, rayEdits: 'pad', rayBiome: 'blend', rayRock: 'biome',
};

const WARMUP_MS = 1500;
const DURATION_MS = 5000;

/**
 * Whole-frame GPU time (`gpuPassTotal`, p95) limits in ms, from Plan 055's frame budget (6.25 ms at 160 fps; terrain
 * incl. shadows <= 2.0 ms). The quiet standard run of 2026-10-20 measured a plain sphere at 0.09-0.14 ms and the empty
 * frame at 0.046 ms, so these are guards against a broken measurement or a gross regression, not targets; the baseline
 * catches smaller changes. Judgement changes, not the experiment, so the suite version stays 1.
 */
const SPHERE_GPU_P95_MS = 0.5;
const EMPTY_GPU_P95_MS = 0.2;

function scenario(id: string, label: string, settings: Partial<PlanetShapeTestSettings>): TestScenario<PlanetShapeTestSettings> {
  return { id, label, durationMs: DURATION_MS, warmupMs: WARMUP_MS, settings: { ...PLANET_SHAPE_DEFAULTS, ...settings } };
}

/** A scenario of the baseline suite: `scenario` plus its GPU budget. The A/B suite has none (it compares arms). */
function budgeted(id: string, label: string, settings: Partial<PlanetShapeTestSettings>): TestScenario<PlanetShapeTestSettings> {
  const p95 = settings.kind === 'empty' ? EMPTY_GPU_P95_MS : SPHERE_GPU_P95_MS;
  return { ...scenario(id, label, settings), budgets: { gpuPassTotal: { p95 } } };
}

const POSES = ['orbit', 'ground'] as const;

/**
 * A free-camera view of the landforms on the 600 km body: `east` and `north` in relief units from the poses (as
 * `planet-shape-edits.ts` places them), `altitude` in units, heading clockwise from north, pitch above the horizon.
 */
function landformView(east: number, north: number, altitude: number, headingDeg: number, pitchDeg: number): CameraView {
  const radiusM = 600_000;
  const degrees = (units: number) => (units * unitM(radiusM) * 180) / (radiusM * Math.PI);
  return { lonDeg: degrees(east), latDeg: degrees(north), headingDeg, pitchDeg, altitudeM: altitude * unitM(radiusM), altitudeRadii: 0 };
}

/** Close-ups where the march has failed before: the road crossing canyons beside the arch, and the tunnel's mountain. */
const LANDFORM_VIEWS = [
  { id: 'arch-road', label: 'through the arch to the road', view: landformView(13, -10, 2.5, 0, -12) },
  { id: 'road-along', label: 'along the road', view: landformView(0, -1.5, 1.5, 80, -8) },
  { id: 'tunnel', label: 'the tunnel and the mountain', view: landformView(20, -6, 2, 60, -5) },
] as const;
/** Morph values of the morph suite; ids use the percent so they contain no dot. */
const MORPH_VALUES = [0, 0.5, 1] as const;
/** Rounds per arm of an A/B suite: `compareAblation` needs two to measure noise; three survive one bad round. */
const AB_ROUNDS = 3;

/** Alternating rounds A (shadows off), B (shadows on), A, B, ... of one pose, as one ablation group. */
function shadowRounds(group: string, label: string, settings: Partial<PlanetShapeTestSettings>): TestScenario<PlanetShapeTestSettings>[] {
  return Array.from({ length: AB_ROUNDS * 2 }, (_, index) => {
    const arm = index % 2 === 0 ? 'A' : 'B';
    const round = Math.floor(index / 2) + 1;
    const state = arm === 'A' ? 'off' : 'on';
    const features = withFeature(PLANET_SHAPE_DEFAULTS.features, 'shadows', arm === 'B');
    return { ...scenario(`${group}-shadows-${state}-${round}`, `${label}, shadows ${state}, round ${round}`, { ...settings, features }),
      ablation: { group, arm } };
  });
}

/** Append new suites and versions at the end; a shared id/version keeps its meaning. */
export const PLANET_SHAPE_TEST_HISTORY: readonly TestSuite<PlanetShapeTestSettings>[] = [
  {
    id: 'planet-shape-baseline', version: 1,
    title: 'Plain sphere baseline: noise floor, orbit and ground at three body sizes',
    purpose: 'performance',
    // Plan 055 D1: timings count only on the reference machine's NVIDIA adapter, not the integrated GPU.
    expectedGpuVendor: 'nvidia',
    // Quiet standard run of 2026-10-20 21:57 on the RTX 3080, made with
    // `npm run test:baseline -- <result.json> --metrics gpuPassTotal,gpuScenePass,gpuOutputPass`. Left out: frameInterval
    // (the display refresh cap, not a cost) and the CPU submit timer (too noisy).
    baseline: baselineV1 as TestBaseline,
    scenarios: [
      budgeted('empty-frame', 'Empty frame (noise floor)', { kind: 'empty' }),
      ...BODIES.flatMap((body) => POSES.map((pose) =>
        budgeted(`plain-sphere-${pose}-${body.id}`, `Plain sphere, ${pose}, ${body.label}`, { bodyId: body.id, poseId: pose }))),
      budgeted('empty-frame-after', 'Empty frame again (did the machine drift?)', { kind: 'empty' }),
    ],
  },
  {
    id: 'planet-shape-morph', version: 1,
    title: 'Morph: plain sphere at morph 0, 0.5 and 1 (sphere, half-bent, flat map) at orbit and ground, 600 km',
    purpose: 'performance',
    expectedGpuVendor: 'nvidia',
    // Quiet standard run of 2026-10-21 11:57 on the RTX 3080 (unattended, `npm run test:run`), same metrics as the
    // baseline suite; a run 35 min earlier agreed within 0.01 ms. Morph 0 is the control: the same sphere as the
    // baseline suite, now through the engine's morph graph. Shadows stay off (the sphere does not cast while morphed),
    // so the cases differ only in the vertex stage. The pose rides the morph (`resolveCameraView`), so the ground cases
    // stay 2 m over the surface at every morph.
    baseline: morphBaselineV1 as TestBaseline,
    scenarios: MORPH_VALUES.flatMap((morph) => POSES.map((pose) =>
      budgeted(`morph-${Math.round(morph * 100).toString().padStart(3, '0')}-${pose}-600km`,
        `Plain sphere, morph ${morph}, ${pose}, 600 km`, { bodyId: '600km', poseId: pose, morph }))),
  },
  {
    id: 'planet-shape-shadows-ab', version: 1,
    title: 'Shadows A/B: plain sphere with shadows off (A) and on (B) in alternating rounds',
    purpose: 'performance',
    expectedGpuVendor: 'nvidia',
    // The whole frame says what shadows cost; the scene pass alone shows the shadow lookups in the planet's shading.
    ablation: { feature: 'shadows', metrics: ['gpuPassTotal', 'gpuScenePass'] },
    scenarios: [
      ...shadowRounds('orbit-600km', 'Orbit, 600 km', { bodyId: '600km', poseId: 'orbit' }),
      ...shadowRounds('ground-600km', 'Ground, 600 km', { bodyId: '600km', poseId: 'ground' }),
    ],
  },
  {
    id: 'planet-shape-quality', version: 1,
    title: 'Quality: the plain sphere against the exact sphere (silhouette, depth, cracks, flicker), every pose and size',
    // Correctness, not timing: the same numbers on any GPU that draws the same triangles, so no vendor is required.
    purpose: 'functional',
    // Spin paused so two frames of a pose are the same view; the probe is unlit, so the sun would not matter anyway.
    scenarios: BODIES.flatMap((body) => CAMERA_POSES.map((pose) =>
      scenario(`quality-${pose.id}-${body.id}`, `Quality, ${pose.label.toLowerCase()}, ${body.label}`,
        { bodyId: body.id, poseId: pose.id, spinWarp: 0, probe: 'quality' }))),
  },
  {
    id: 'planet-shape-raymarch', version: 1,
    title: 'Raymarched terrain (Phase 1, contender C minimal): every pose and size, then 32 / 256 steps at 600 km',
    purpose: 'performance',
    expectedGpuVendor: 'nvidia',
    // No budgets yet: this run sets the first numbers. The scene pass is the terrain (the shell and its march).
    scenarios: [
      ...BODIES.flatMap((body) => CAMERA_POSES.map((pose) =>
        scenario(`raymarch-${pose.id}-${body.id}`, `Raymarch, ${pose.label.toLowerCase()}, ${body.label}`,
          { kind: 'raymarch', bodyId: body.id, poseId: pose.id }))),
      ...[32, 256].flatMap((steps) => (['orbit', 'ground'] as const).map((pose) =>
        scenario(`raymarch-${pose}-600km-${steps}-steps`, `Raymarch, ${pose}, 600 km, ${steps} steps`,
          { kind: 'raymarch', bodyId: '600km', poseId: pose, raySteps: steps }))),
    ],
  },
  {
    id: 'planet-shape-raymarch', version: 2,
    title: 'Raymarched terrain v2 (density field): every pose and size without and with the 1/4 pre-pass, v1 as reference',
    purpose: 'performance',
    expectedGpuVendor: 'nvidia',
    // No budgets yet. The scene pass is the terrain (shell, march and shading) plus its pre-pass when on.
    scenarios: [
      ...BODIES.flatMap((body) => CAMERA_POSES.flatMap((pose) => [0, 4].map((prepass) =>
        scenario(`v2-${pose.id}-${body.id}-prepass-${prepass}`, `Terrain v2, ${pose.label.toLowerCase()}, ${body.label}, pre-pass ${prepass ? `1/${prepass}` : 'off'}`,
          { kind: 'raymarch-lit', bodyId: body.id, poseId: pose.id, rayPrepass: prepass })))),
      ...[2, 8].map((prepass) =>
        scenario(`v2-ground-600km-prepass-${prepass}`, `Terrain v2, ground, 600 km, pre-pass 1/${prepass}`,
          { kind: 'raymarch-lit', bodyId: '600km', poseId: 'ground', rayPrepass: prepass })),
      scenario('v2-ground-600km-prepass-4-shadows', 'Terrain v2, ground, 600 km, pre-pass 1/4, soft shadow',
        { kind: 'raymarch-lit', bodyId: '600km', poseId: 'ground', rayPrepass: 4,
          features: withFeature(PLANET_SHAPE_DEFAULTS.features, 'shadows', true) }),
      ...CAMERA_POSES.map((pose) =>
        scenario(`v1-${pose.id}-600km`, `Terrain v1 (reference), ${pose.label.toLowerCase()}, 600 km`,
          { kind: 'raymarch', bodyId: '600km', poseId: pose.id })),
    ],
  },
  {
    id: 'planet-shape-edits', version: 1,
    title: 'Terrain v2 edits: the pad alone, no edits, and the pad plus three base-site edits, at 600 km with the 1/4 pre-pass',
    purpose: 'performance',
    expectedGpuVendor: 'nvidia',
    // No budgets yet: what the edit loop costs per march step.
    scenarios: CAMERA_POSES.filter((pose) => pose.id !== 'orbit').flatMap((pose) => (['none', 'pad', 'sites'] as const).map((edits) =>
      scenario(`edits-${edits}-${pose.id}-600km`, `Terrain v2, edits ${edits}, ${pose.label.toLowerCase()}, 600 km`,
        { kind: 'raymarch-lit', bodyId: '600km', poseId: pose.id, rayPrepass: 4, rayEdits: edits }))),
  },
  {
    id: 'planet-shape-biomes', version: 1,
    title: 'Terrain v2 biomes: canyons only, hills only and the blend, at 600 km with the 1/4 pre-pass and the pad',
    purpose: 'performance',
    expectedGpuVendor: 'nvidia',
    // No budgets yet: what each biome costs, and what the blend mask adds.
    scenarios: CAMERA_POSES.filter((pose) => pose.id !== 'orbit').flatMap((pose) => RAY_BIOMES.map((biome) =>
      scenario(`biome-${biome}-${pose.id}-600km`, `Terrain v2, biome ${biome}, ${pose.label.toLowerCase()}, 600 km`,
        { kind: 'raymarch-lit', bodyId: '600km', poseId: pose.id, rayPrepass: 4, rayBiome: biome }))),
  },
  {
    id: 'planet-shape-terrain-views', version: 1,
    title: 'Terrain v2 views for review: each biome and the blend at the low, ground and grazing poses, and the base-site edits',
    // Pictures to judge, not timing: spin paused at a fixed sun so every run shows the same views.
    purpose: 'functional',
    requiresVisualReview: true,
    scenarios: [
      ...RAY_BIOMES.flatMap((biome) => CAMERA_POSES.filter((pose) => pose.id !== 'orbit').map((pose) =>
        scenario(`view-${biome}-${pose.id}-600km`, `Terrain v2, ${biome}, ${pose.label.toLowerCase()}, 600 km`,
          { kind: 'raymarch-lit', bodyId: '600km', poseId: pose.id, rayPrepass: 4, rayBiome: biome, spinWarp: 0, spinAngleDeg: 0 }))),
      ...(['low-flyover', 'horizon-grazing'] as const).map((poseId) =>
        scenario(`view-sites-${poseId}-600km`, `Terrain v2, base-site edits, ${poseId.replace('-', ' ')}, 600 km`,
          { kind: 'raymarch-lit', bodyId: '600km', poseId, rayPrepass: 4, rayEdits: 'sites', spinWarp: 0, spinAngleDeg: 0 })),
    ],
  },
  {
    id: 'planet-shape-ops', version: 1,
    title: 'Terrain v2 shape ops on the GPU: the pad alone against the pad plus the landforms (eight ops), at 600 km with the 1/4 pre-pass',
    purpose: 'performance',
    expectedGpuVendor: 'nvidia',
    // No budgets yet: what the per-tile op lookup and the landforms cost per march step. `planet-shape-edits` v1 run
    // again gives the old 8-edit list against the same views through the shape-op path.
    scenarios: CAMERA_POSES.filter((pose) => pose.id !== 'orbit').flatMap((pose) => (['pad', 'landforms'] as const).map((edits) =>
      scenario(`ops-${edits}-${pose.id}-600km`, `Terrain v2, ${edits}, ${pose.label.toLowerCase()}, 600 km`,
        { kind: 'raymarch-lit', bodyId: '600km', poseId: pose.id, rayPrepass: 4, rayEdits: edits }))),
  },
  {
    id: 'planet-shape-landforms-views', version: 1,
    title: 'Terrain v2 landforms for review: mountain, crater, ridge, road, overhang, arch and tunnel from the low and grazing poses',
    purpose: 'functional',
    requiresVisualReview: true,
    scenarios: (['low-flyover', 'horizon-grazing'] as const).map((poseId) =>
      scenario(`view-landforms-${poseId}-600km`, `Terrain v2, landforms, ${poseId.replace('-', ' ')}, 600 km`,
        { kind: 'raymarch-lit', bodyId: '600km', poseId, rayPrepass: 4, rayEdits: 'landforms', spinWarp: 0, spinAngleDeg: 0 })),
  },
  {
    id: 'planet-shape-rock', version: 1,
    title: 'Terrain v2 rock: wild (3D noise density) against grounded (warped height surface), at 600 km with the 1/4 pre-pass and the pad',
    purpose: 'performance',
    expectedGpuVendor: 'nvidia',
    // No budgets yet: what the grounded warp costs per march step against the wild field. The biome blend stays, so a
    // view differs only where the mode changes the field.
    scenarios: CAMERA_POSES.filter((pose) => pose.id !== 'orbit').flatMap((pose) => (['wild', 'grounded'] as const).map((rock) =>
      scenario(`rock-${rock}-${pose.id}-600km`, `Terrain v2, rock ${rock}, ${pose.label.toLowerCase()}, 600 km`,
        { kind: 'raymarch-lit', bodyId: '600km', poseId: pose.id, rayPrepass: 4, rayRock: rock }))),
  },
  {
    id: 'planet-shape-terrain-quality', version: 1,
    title: 'Terrain v2 march against its reference: landforms in canyons and the blend from the low and grazing poses and three close-ups',
    // Correctness, not timing: the fast march (as drawn, without the pre-pass) against a slow reference march of the same
    // field, which is checked in turn against the CPU twin. No vendor required.
    purpose: 'functional',
    scenarios: [
      ...(['canyons', 'blend'] as const).flatMap((biome) => [
        ...(['low-flyover', 'horizon-grazing'] as const).map((poseId) =>
          scenario(`march-${biome}-${poseId}-600km`, `March vs reference, landforms, ${biome}, ${poseId.replace('-', ' ')}, 600 km`,
            { kind: 'raymarch-lit', bodyId: '600km', poseId, rayEdits: 'landforms', rayBiome: biome, spinWarp: 0, spinAngleDeg: 0, probe: 'terrain-quality' })),
        ...LANDFORM_VIEWS.map(({ id, label, view }) =>
          scenario(`march-${biome}-${id}-600km`, `March vs reference, landforms, ${biome}, ${label}, 600 km`,
            { kind: 'raymarch-lit', bodyId: '600km', poseId: 'low-flyover', view, rayEdits: 'landforms', rayBiome: biome, spinWarp: 0, spinAngleDeg: 0, probe: 'terrain-quality' })),
      ]),
    ],
  },
  {
    id: 'planet-shape-terrain-quality-b', version: 1,
    title: 'Contender B against terrain v2\'s reference march: the terrain-quality views, with the near volume zone (B) and without it (A)',
    // Correctness, not timing: B's mesh where terrain v2's fast march stands in the same probe (Plan 055 D18, seam
    // spike stage 2). Each view is built for the screen's pixel angle before it is probed, which takes seconds.
    purpose: 'functional',
    scenarios: (['canyons', 'blend'] as const).flatMap((biome) => [
      ...(['low-flyover', 'horizon-grazing'] as const).map((poseId) => ({ id: poseId as string, label: poseId.replace('-', ' '), poseId, view: undefined as CameraView | undefined })),
      ...LANDFORM_VIEWS.map(({ id, label, view }) => ({ id, label, poseId: 'low-flyover' as const, view })),
    ].flatMap(({ id, label, poseId, view }) => ([true, false] as const).map((blocks) =>
      scenario(`mesh-${blocks ? 'b' : 'a'}-${biome}-${id}-600km`, `${blocks ? 'B (shell + near zone)' : 'A (shell only)'} vs reference, landforms, ${biome}, ${label}, 600 km`,
        { kind: 'mesh-b', bodyId: '600km', poseId, ...(view ? { view } : {}), rayEdits: 'landforms', rayBiome: biome, spinWarp: 0, spinAngleDeg: 0, probe: 'terrain-quality', meshBlocks: blocks })))),
  },
];
