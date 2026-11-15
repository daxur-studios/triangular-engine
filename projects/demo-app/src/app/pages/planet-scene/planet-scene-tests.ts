import type { TestScenario, TestSuite } from 'triangular-engine/testing';
import { EARTH_RADIUS_M, EARTH_SCALE_TIERS, type PlanetMotion, type PlanetPoseId } from './planet-camera';

/** Everything a planet-scene case sets; also the snapshot a run restores. Plain JSON. */
export interface PlanetSceneTestSettings {
  readonly pose: PlanetPoseId;
  /** `<planetTerrain>` is in the scene. */
  readonly terrain: boolean;
  /**
   * `<planetAtmosphere [enabled]>`: off hides the sky and takes the lighting and haze off the terrain without a recompile,
   * so the cost of the air is the difference between a case and its `-atmosphere-off` partner.
   */
  readonly atmosphere: boolean;
  /**
   * `<planet [morph]>`: 0 the globe, 1 the flat map. The terrain bends into the map; the pole fan draws a flat colour only;
   * the atmosphere and the clouds do not morph yet, so above 0 the sky is the globe's sky.
   */
  readonly morph: number;
  /**
   * A scripted camera runs during the window instead of a still pose: `descent` flies orbit to the 2 m eye over one ground
   * point; `yaw360` holds the ground pose and turns the heading once round; `morphSweep` holds the case's pose and sweeps the
   * morph 0 to 1 and back to 0 (every case before visual v5 sweeps at orbit).
   */
  readonly motion?: PlanetMotion;
  /**
   * Draw the terrain with a plain unlit `MeshBasicNodeMaterial` instead of the planet material (v4). The vertex stage,
   * the morph and the selection are unchanged; only the fragment stage (the cell lookup, 12 fetches a fragment) and the
   * lighting are gone. The atmosphere cannot attach to it, so plain cases also turn the atmosphere off. Omitted means the
   * planet material, as in v1 to v3.
   */
  readonly plainMaterial?: boolean;
  /**
   * `<planetClouds [enabled]>` (v5): off hides the cloud shell and skips its update, so the cost of the clouds is the difference
   * between a case and its clouds-off partner. Omitted means on, as in v1 to v4, where the shell was always there.
   */
  readonly clouds?: boolean;
  /**
   * The water body (v5): the water spike's `<planetTerrain>` over the sea, mounted beside `<planet>` because it cannot go inside
   * it (it takes its own radius, sun, heights and material). The ultra tier, horizon cull on. It bends with the planet (it shares
   * `<planet>`'s morph uniforms, since visual v4) and gets no atmosphere haze. Omitted means off, as in v1 to v4.
   */
  readonly water?: boolean;
  /** `<planetAtmosphere [sky]>` (visual v4): off hides the backdrop and keeps the surface haze. Omitted means on. */
  readonly sky?: boolean;
  /** `<planetAtmosphere [haze]>` (visual v4): off takes the surface haze off and keeps the backdrop. Omitted means on. */
  readonly haze?: boolean;
  /**
   * `<planetAtmosphere [shellFade]>` (visual v4): off keeps the sky shell at full strength at any morph, so a still shows where
   * the unbent shell sits instead of it dissolving. Omitted means on, as the game runs.
   */
  readonly shellFade?: boolean;
  /**
   * The camera is carried through the morph like the ground under it (visual v5), so the pose keeps its view of the same
   * ground at any morph. Omitted means off: the camera stays where the globe put it, as in every earlier case.
   */
  readonly followBend?: boolean;
  /** The three reference cubes (100 m, 3 km and 100 km) on the ground ahead of the eye, bent with it (visual v5). Omitted means off. */
  readonly references?: boolean;
  /**
   * The planet's radius in metres (the ground-only ladder, `planet-ground-earth-*`). The camera poses, the orbit altitude
   * (two radii) and the cubes that fit the world follow it; the cell planet is baked again for it. Omitted means 600 000, the
   * page's default, as in every suite before the ladder.
   */
  readonly radiusM?: number;
  /**
   * `<planetTerrain [cull]>` of the ground (the selector's own culling of leaves outside the view). Off for the cull A/B, which
   * checks whether the ground flicker in a morph sweep comes from culling against bounds that lag the morph. Omitted means on.
   */
  readonly terrainCull?: boolean;
}

/** The scene as a game would run it: terrain and atmosphere on, the globe. */
export const DEFAULT_PLANET_SCENE_SETTINGS: PlanetSceneTestSettings = {
  pose: 'orbit', terrain: true, atmosphere: true, morph: 0,
};

/** A still case: a 500 ms warm-up and a 4 s window (quick mode stops once the series settle). */
function still(id: string, label: string, change: Partial<PlanetSceneTestSettings>): TestScenario<PlanetSceneTestSettings> {
  return { id, label, settings: { ...DEFAULT_PLANET_SCENE_SETTINGS, ...change }, warmupMs: 500, durationMs: 4000 };
}

/** A scripted case: the motion runs for `durationMs`, or `quickMs` in quick mode. */
function scripted(id: string, label: string, motion: PlanetMotion, change: Partial<PlanetSceneTestSettings>): TestScenario<PlanetSceneTestSettings> {
  return { id, label, settings: { ...DEFAULT_PLANET_SCENE_SETTINGS, ...change, motion }, warmupMs: 500, durationMs: 12_000, quickMs: 6000 };
}

/**
 * Suite `planet-scene` v1 (Plan 059, step G5): `<planet>` with `<planetTerrain>` and `<planetAtmosphere>` as a game writes
 * it, 600 km radius, a baked cell planet, the globe (morph 0). Clouds are a placeholder: `<planetClouds>` has its own plan.
 *
 * Still poses (orbit, 20 km, the 2 m eye), a scripted descent from orbit to the eye and a scripted 360 degree turn at the eye.
 * The GPU timer splits by render pass, not by layer, so the per-layer cost is read from two atmosphere-off partners (orbit and
 * eye): same view, same terrain, the sky and the lighting and haze stages off. v1 has no morph cases; v2 adds them.
 */
const PLANET_SCENE_V1: TestSuite<PlanetSceneTestSettings> = {
  id: 'planet-scene',
  version: 1,
  title: 'Planet scene: <planet> with terrain and atmosphere at orbit, 20 km and the 2 m eye, a descent and a turn (Plan 059 G5)',
  purpose: 'performance',
  requiresVisualReview: true,
  scenarios: [
    still('orbit', 'orbit · whole planet', { pose: 'orbit' }),
    still('mid-20km', '20 km altitude', { pose: 'mid-20km' }),
    still('ground', '2 m eye', { pose: 'ground' }),
    scripted('descent', 'descent · orbit to the 2 m eye', 'descent', { pose: 'orbit' }),
    scripted('yaw-360', 'turn · 360 degrees at the 2 m eye', 'yaw360', { pose: 'ground' }),
    still('orbit-atmosphere-off', 'orbit · atmosphere off (A/B partner of orbit)', { pose: 'orbit', atmosphere: false }),
    still('ground-atmosphere-off', '2 m eye · atmosphere off (A/B partner of ground)', { pose: 'ground', atmosphere: false }),
  ],
};

/**
 * Suite `planet-scene` v2 (Plan 059, step G6f): v1 unchanged, plus the morph. `<planet [morph]>` at 0.5 (half way: the terrain
 * is part way into the map) and 1 (the flat map) at orbit and at the 2 m eye, and a scripted sweep at orbit that goes 0 to 1
 * and back to 0 over the window with the camera still. The sky does not morph yet, so at morph above 0 the timed sky is the
 * globe's sky. The morph cases keep the atmosphere on and the terrain in the scene, as orbit and ground do.
 */
const PLANET_SCENE_V2: TestSuite<PlanetSceneTestSettings> = {
  id: 'planet-scene',
  version: 2,
  title: 'Planet scene: <planet> with terrain and atmosphere at orbit, 20 km and the 2 m eye, a descent, a turn and the morph 0 to 1 (Plan 059 G6f)',
  purpose: 'performance',
  requiresVisualReview: true,
  scenarios: [
    ...PLANET_SCENE_V1.scenarios,
    still('orbit-morph-0.5', 'orbit · morph 0.5', { pose: 'orbit', morph: 0.5 }),
    still('orbit-morph-1', 'orbit · morph 1', { pose: 'orbit', morph: 1 }),
    still('ground-morph-0.5', '2 m eye · morph 0.5', { pose: 'ground', morph: 0.5 }),
    still('ground-morph-1', '2 m eye · morph 1', { pose: 'ground', morph: 1 }),
    scripted('morph-sweep', 'morph sweep · orbit, 0 to 1 and back to 0', 'morphSweep', { pose: 'orbit' }),
  ],
};

/**
 * Suite `planet-scene` v3: v2 unchanged, plus the atmosphere-off partners of the two flat-map cases. At morph 1 the terrain
 * has been seen to go missing; with the air off the same view separates a terrain or discard fault (still missing) from a
 * lighting or haze fault (terrain comes back).
 */
const PLANET_SCENE_V3: TestSuite<PlanetSceneTestSettings> = {
  id: 'planet-scene',
  version: 3,
  title: 'Planet scene: v2 plus the atmosphere-off partners of the flat-map cases (Plan 059 G6f)',
  purpose: 'performance',
  requiresVisualReview: true,
  scenarios: [
    ...PLANET_SCENE_V2.scenarios,
    still('orbit-morph-1-atmosphere-off', 'orbit · morph 1 · atmosphere off (A/B partner of orbit-morph-1)', { pose: 'orbit', morph: 1, atmosphere: false }),
    still('ground-morph-1-atmosphere-off', '2 m eye · morph 1 · atmosphere off (A/B partner of ground-morph-1)', { pose: 'ground', morph: 1, atmosphere: false }),
  ],
};

/**
 * Suite `planet-scene` v4 (Plan 059, morph frame cost): v3 unchanged, plus a material A/B. The morph-1 scene pass was 4.15 ms
 * against 1.04 ms at morph 0 (about 2.8 ms per million triangles), while the morph spike, which draws a debug material, costs
 * about 0.4 ms per million triangles at every morph. The `-plain` cases draw the same views with an unlit basic material and
 * the atmosphere off; each partner is the existing atmosphere-off case of the same view with the planet material (one new
 * partner, `orbit-morph-0.5-atmosphere-off`). If a plain case costs about what the spike does and its partner costs the
 * 4.15 ms, the planet material's fragment stage is the cost; if both are high, it is the vertex stage or the page.
 */
const PLANET_SCENE_V4: TestSuite<PlanetSceneTestSettings> = {
  id: 'planet-scene',
  version: 4,
  title: 'Planet scene: v3 plus the plain-material A/B for the morph frame cost (Plan 059 G6)',
  purpose: 'performance',
  requiresVisualReview: true,
  scenarios: [
    ...PLANET_SCENE_V3.scenarios,
    still('orbit-morph-0.5-atmosphere-off', 'orbit · morph 0.5 · atmosphere off (A/B partner of orbit-morph-0.5-plain)', { pose: 'orbit', morph: 0.5, atmosphere: false }),
    still('orbit-plain', 'orbit · plain material (A/B partner of orbit-atmosphere-off)', { pose: 'orbit', atmosphere: false, plainMaterial: true }),
    still('orbit-morph-0.5-plain', 'orbit · morph 0.5 · plain material (A/B partner of orbit-morph-0.5-atmosphere-off)', { pose: 'orbit', morph: 0.5, atmosphere: false, plainMaterial: true }),
    still('orbit-morph-1-plain', 'orbit · morph 1 · plain material (A/B partner of orbit-morph-1-atmosphere-off)', { pose: 'orbit', morph: 1, atmosphere: false, plainMaterial: true }),
    still('ground-morph-1-plain', '2 m eye · morph 1 · plain material (A/B partner of ground-morph-1-atmosphere-off)', { pose: 'ground', morph: 1, atmosphere: false, plainMaterial: true }),
  ],
};

/** The views of the layer ladder (v5). Orbit and 20 km reuse the earlier poses; coast and the eye are new to the ladder. */
const LADDER_VIEWS: readonly { readonly id: string; readonly pose: PlanetPoseId; readonly label: string }[] = [
  { id: 'orbit', pose: 'orbit', label: 'orbit' },
  { id: '20km', pose: 'mid-20km', label: '20 km' },
  { id: 'coast', pose: 'coast', label: 'coast, 50 m' },
  { id: 'eye', pose: 'ground', label: '2 m eye' },
];

/** The layers on at each rung of the ladder, cumulative: every rung keeps what the one before it had. */
const LADDER_RUNGS: Record<'terrain' | 'air' | 'clouds' | 'water', Partial<PlanetSceneTestSettings>> = {
  terrain: { atmosphere: false, clouds: false, water: false },
  air: { atmosphere: true, clouds: false, water: false },
  clouds: { atmosphere: true, clouds: true, water: false },
  water: { atmosphere: true, clouds: true, water: true },
};

/** The ladder's A/B steps: B turns on the layer the step is named for, A is the rung before it. */
const LADDER_STEPS: readonly { readonly step: 'air' | 'clouds' | 'water'; readonly a: 'terrain' | 'air' | 'clouds' }[] = [
  { step: 'air', a: 'terrain' },
  { step: 'clouds', a: 'air' },
  { step: 'water', a: 'clouds' },
];

/** Full-stack planet total, GPU ms (median), by ladder view; the water-step B arm is the full stack. */
const FULL_STACK_BUDGET_MS: Readonly<Record<string, number>> = { orbit: 2.6, '20km': 4.5, coast: 5.5, eye: 5.5 };
/** Full-stack total on the flat map (morph 1), GPU ms (median). */
const FLAT_MAP_BUDGET_MS = 4.6;

type Budgets = TestScenario<PlanetSceneTestSettings>['budgets'];
interface Arm { readonly label: string; readonly change: Partial<PlanetSceneTestSettings>; readonly budgets?: Budgets }

/** Two rounds of A, B, A, B, as the runner's ablation needs (at least two alternating rounds per arm). */
function rounds(group: string, label: string, a: Arm, b: Arm): TestScenario<PlanetSceneTestSettings>[] {
  const out: TestScenario<PlanetSceneTestSettings>[] = [];
  for (const round of [1, 2]) {
    for (const [arm, side] of [['A', a], ['B', b]] as const) {
      out.push({
        ...still(`${group}-${arm}${round}`, `${label} · ${side.label} (round ${round})`, side.change),
        ablation: { group, arm },
        ...(side.budgets ? { budgets: side.budgets } : {}),
      });
    }
  }
  return out;
}

/** The ladder: in every view, three A/B steps at morph 0, each rung adding one layer to the one before it. */
function ladderScenarios(): TestScenario<PlanetSceneTestSettings>[] {
  return LADDER_VIEWS.flatMap((view) => LADDER_STEPS.flatMap(({ step, a }) => rounds(
    `ladder-${view.id}-${step}`, view.label,
    { label: a, change: { pose: view.pose, ...LADDER_RUNGS[a] } },
    {
      label: `+ ${step}`, change: { pose: view.pose, ...LADDER_RUNGS[step] },
      ...(step === 'water' ? { budgets: { gpuPassTotal: { median: FULL_STACK_BUDGET_MS[view.id] } } } : {}),
    },
  )));
}

/** Where the air is measured, with the clouds on and the water out. */
const AIR_PAIRS: readonly { readonly view: string; readonly pose: PlanetPoseId; readonly morph: number }[] = [
  { view: 'orbit', pose: 'orbit', morph: 0 },
  { view: 'orbit', pose: 'orbit', morph: 0.25 },
  { view: 'orbit', pose: 'orbit', morph: 0.5 },
  { view: 'orbit', pose: 'orbit', morph: 1 },
  { view: '20km', pose: 'mid-20km', morph: 0 },
  { view: '20km', pose: 'mid-20km', morph: 0.5 },
];

function airPairScenarios(): TestScenario<PlanetSceneTestSettings>[] {
  return AIR_PAIRS.flatMap(({ view, pose, morph }) => rounds(
    `air-${view}-morph-${morph}`, `${view} · morph ${morph}`,
    { label: 'air off', change: { pose, morph, atmosphere: false, clouds: true, water: false } },
    {
      label: 'air on', change: { pose, morph, atmosphere: true, clouds: true, water: false },
      ...(view === 'orbit' && morph === 1 ? { budgets: { gpuPassTotal: { median: FLAT_MAP_BUDGET_MS } } } : {}),
    },
  ));
}

/**
 * Suite `planet-scene` v5 (Plan 059, the layer ladder): v4 unchanged, plus what each planet layer costs. The planet-stack
 * plan gives every layer a GPU budget; the GPU timer splits by pass, not by layer, so each layer is measured as the difference
 * of two cases that differ only by it.
 *
 * **Ladder** (`ladder-<view>-<step>-A|B<round>`): at morph 0, in four views (orbit, 20 km, the new 50 m coast pose with sea
 * and land in view, the 2 m eye): terrain only, plus air, plus clouds, plus water. Each step is an A/B group of two alternating
 * rounds: A is the rung before, B adds the layer. Read a layer's cost as the ablation outcome of `gpuPassTotal`.
 *
 * **Air pairs** (`air-<view>-morph-<m>-A|B<round>`): the air alone, clouds on and water out, at orbit at morph 0, 0.25, 0.5
 * and 1 and at 20 km at morph 0 and 0.5.
 *
 * **Motion**: the descent with the whole stack on (water included) and the 0 to 1 to 0 morph sweep with air and clouds on and
 * the water out (the water body does not morph, so keeping it would draw a sea sphere round a flattening map).
 *
 * **Water.** The water is the water spike's body (`water-lod-spike/`): a second `<planetTerrain>` beside `<planet>` at the same
 * radius, with the spike rig's heights and material, the ultra tier. It gets no atmosphere haze, and its shore, foam and depth
 * colour read the spike's islands, not this planet's land. Its cost here is the body's mesh and wave material. At the 2 m eye
 * the ground is the fixture's 510 m ridge and the sea is out of view, so the water step there measures hidden-water cost. The
 * coast pose stands where the planet's sampler puts the nearest shore (18.75 km from the fixture ground); whether it frames
 * sea and land well has not been looked at, review it by eye.
 *
 * **Budgets** (`budgets`, ms): the water-step B arm is the full stack and carries the planet total on `gpuPassTotal` (median):
 * 2.6 at orbit, 4.5 at 20 km, 5.5 at the coast and the eye. The air-pair B arm at orbit morph 1 carries 4.6, the flat map's
 * total. Both motion cases carry a GPU p95 of 7 ms and a selection p95 of 4 ms. Not expressible, so read from the results:
 * the air step at most 0.5 ms at morph 0 and 1 and 0.8 at 0.25 and 0.5 (a limit on an A/B difference, not on a case); the
 * selection worst of 4 ms (a budget takes the median or the p95); and the per-layer budgets of the rungs themselves.
 *
 * What a fail means: a full-stack total over budget means the layers together do not fit the frame, and the ladder says
 * which rung overspends; an air step over its limit means the sky and haze are too dear at that morph; a motion budget
 * over means frames during the move, not the average, go over. Budgets assess runs on a clean machine only; a noisy or
 * software run is functional evidence. `requiresVisualReview` stays on: the coast view and the sea have not been looked at.
 */
const PLANET_SCENE_V5: TestSuite<PlanetSceneTestSettings> = {
  id: 'planet-scene',
  version: 5,
  title: 'Planet scene: v4 plus the layer ladder (terrain, air, clouds, water) and the air at four morphs (Plan 059 layer budgets)',
  purpose: 'performance',
  requiresVisualReview: true,
  ablation: { feature: 'the layer a round turns on: air, clouds or water (each A is the rung before it)', metrics: ['gpuPassTotal'] },
  scenarios: [
    ...PLANET_SCENE_V4.scenarios,
    ...ladderScenarios(),
    ...airPairScenarios(),
    {
      ...scripted('descent-full-stack', 'descent · orbit to the 2 m eye · air, clouds and water on', 'descent', { pose: 'orbit', atmosphere: true, clouds: true, water: true }),
      budgets: { gpuPassTotal: { p95: 7 }, selectionCpu: { p95: 4 } },
    },
    {
      ...scripted('morph-sweep-full-stack', 'morph sweep · orbit, 0 to 1 and back · air and clouds on, water out', 'morphSweep', { pose: 'orbit', atmosphere: true, clouds: true, water: false }),
      budgets: { gpuPassTotal: { p95: 7 }, selectionCpu: { p95: 4 } },
    },
  ],
};

/**
 * The two scripted moves of v5 as a functional suite, so the runner may record a clip of each (it never records a performance
 * suite). No budgets and no timing claims: this is for looking at the descent and the morph sweep, which only had numbers.
 * `requiresVisualReview` stays on; a person decides whether the clips look right.
 */
export const PLANET_SCENE_VISUAL_V1: TestSuite<PlanetSceneTestSettings> = {
  id: 'planet-scene-visual',
  version: 1,
  title: 'Planet scene, by eye: the descent and the morph sweep with every layer on, recorded as clips',
  purpose: 'functional',
  requiresVisualReview: true,
  scenarios: [
    scripted('descent-full-stack', 'descent · orbit to the 2 m eye · air, clouds and water on', 'descent', { pose: 'orbit', atmosphere: true, clouds: true, water: true }),
    scripted('morph-sweep-full-stack', 'morph sweep · orbit, 0 to 1 and back · air and clouds on, water out', 'morphSweep', { pose: 'orbit', atmosphere: true, clouds: true, water: false }),
  ],
};

/** A short still for the by-eye suite: a brief warm-up and window, the case is for its picture, not its timing. */
function look(id: string, label: string, change: Partial<PlanetSceneTestSettings>): TestScenario<PlanetSceneTestSettings> {
  return { ...still(id, label, { clouds: true, water: false, ...change }), warmupMs: 800, durationMs: 1000 };
}

/**
 * Suite `planet-scene-visual` v2: the flat-map look at fixed morph values, air on beside air off, as thumbnails. Added after the
 * ground went blue at morph 1 and the sky stayed a sphere at mid-morph (Opus's answer `atmosphere-morph-look`): orbit at morph
 * 0.05, 0.1, 0.25, 0.5, 0.75 and 1 with the air on, the air-off partners at 0.25 and 1, and the 20 km pose at morph 1 (the
 * low view must keep its 0.15 haze floor). No budgets, no timing claims; a person looks at the stills.
 */
export const PLANET_SCENE_VISUAL_V2: TestSuite<PlanetSceneTestSettings> = {
  id: 'planet-scene-visual',
  version: 2,
  title: 'Planet scene, by eye: stills at fixed morph values, air on beside air off',
  purpose: 'functional',
  requiresVisualReview: true,
  scenarios: [
    ...[0.05, 0.1, 0.25, 0.5, 0.75, 1].map((morph) => look(`orbit-morph-${morph}-air`, `orbit · morph ${morph} · air on`, { pose: 'orbit', morph, atmosphere: true })),
    look('orbit-morph-0.25-no-air', 'orbit · morph 0.25 · air off', { pose: 'orbit', morph: 0.25, atmosphere: false }),
    look('orbit-morph-1-no-air', 'orbit · morph 1 · air off', { pose: 'orbit', morph: 1, atmosphere: false }),
    look('20km-morph-1-air', '20 km · morph 1 · air on', { pose: 'mid-20km', morph: 1, atmosphere: true }),
    look('20km-morph-1-no-air', '20 km · morph 1 · air off', { pose: 'mid-20km', morph: 1, atmosphere: false }),
  ],
};

/**
 * Suite `planet-scene-visual` v3: which layer is the ghost sphere. Bruno's screenshot at mid-morph shows a darker round sphere
 * offset behind the bending map. Orbit at morph 0.3 with the water, the air and the clouds switched on and off in turn, so the
 * sphere shows in exactly the cases where its layer is on. No budgets; a person looks at the stills.
 */
export const PLANET_SCENE_VISUAL_V3: TestSuite<PlanetSceneTestSettings> = {
  id: 'planet-scene-visual',
  version: 3,
  title: 'Planet scene, by eye: which layer is the ghost sphere (morph 0.3, water, air, clouds on and off)',
  purpose: 'functional',
  requiresVisualReview: true,
  scenarios: [
    look('ghost-all', 'morph 0.3 · water + air + clouds', { pose: 'orbit', morph: 0.3, atmosphere: true, clouds: true, water: true }),
    look('ghost-water-only', 'morph 0.3 · water only', { pose: 'orbit', morph: 0.3, atmosphere: false, clouds: false, water: true }),
    look('ghost-air-only', 'morph 0.3 · air only', { pose: 'orbit', morph: 0.3, atmosphere: true, clouds: false, water: false }),
    look('ghost-clouds-only', 'morph 0.3 · clouds only', { pose: 'orbit', morph: 0.3, atmosphere: false, clouds: true, water: false }),
    look('ghost-none', 'morph 0.3 · terrain only', { pose: 'orbit', morph: 0.3, atmosphere: false, clouds: false, water: false }),
  ],
};

/** The layer sets of the bent-sky stills (visual v4). */
const BENT_SKY_LAYERS: readonly { id: string; label: string; change: Partial<PlanetSceneTestSettings> }[] = [
  { id: 'air', label: 'air only', change: { atmosphere: true, water: false } },
  { id: 'water', label: 'water only', change: { atmosphere: false, water: true } },
  { id: 'both', label: 'air + water', change: { atmosphere: true, water: true } },
];
const BENT_SKY_POSES: readonly { id: PlanetSceneTestSettings['pose']; label: string }[] = [
  { id: 'orbit', label: 'orbit' },
  { id: 'mid-20km', label: '20 km' },
  { id: 'ground', label: 'ground' },
];

/**
 * Suite `planet-scene-visual` v4: the gate stills for the bent sky and water (Fable's answer `atmosphere-bent-sky`, slices 1-2).
 * Morph 0, 0.3, 0.6 and 1, at orbit, 20 km and on the ground, with air only, water only and both; clouds off and the sky-shell
 * fade off throughout, so a layer that does not bend shows instead of dissolving. Two attribution stills at morph 1 from orbit,
 * backdrop only and surface haze only, settle whether the blue wash is the air counted twice. No budgets; a person looks.
 */
export const PLANET_SCENE_VISUAL_V4: TestSuite<PlanetSceneTestSettings> = {
  id: 'planet-scene-visual',
  version: 4,
  title: 'Planet scene, by eye: bent-sky gate stills (morph × pose × layers, fade off) and the morph-1 wash attribution',
  purpose: 'functional',
  requiresVisualReview: true,
  scenarios: [
    ...[0, 0.3, 0.6, 1].flatMap((morph) =>
      BENT_SKY_POSES.flatMap((pose) =>
        BENT_SKY_LAYERS.map((layers) =>
          look(`${pose.id}-morph-${morph}-${layers.id}`, `${pose.label} · morph ${morph} · ${layers.label}`, {
            pose: pose.id, morph, clouds: false, shellFade: false, ...layers.change,
          }),
        ),
      ),
    ),
    look('orbit-morph-1-backdrop-only', 'orbit · morph 1 · backdrop only (surface haze off)', {
      pose: 'orbit', morph: 1, atmosphere: true, water: false, clouds: false, shellFade: false, haze: false,
    }),
    look('orbit-morph-1-haze-only', 'orbit · morph 1 · surface haze only (backdrop off)', {
      pose: 'orbit', morph: 1, atmosphere: true, water: false, clouds: false, shellFade: false, sky: false,
    }),
  ],
};

/** The layers every visual v5 case draws: air and water, clouds and the sky-shell fade off, the camera on the bend, the cubes in. */
const REFERENCE_LAYERS: Partial<PlanetSceneTestSettings> = {
  atmosphere: true, water: true, clouds: false, shellFade: false, followBend: true, references: true,
};

/**
 * Suite `planet-scene-visual` v5: the morph seen with something to measure it by. Three reference cubes (100 m, 3 km and
 * 100 km, ahead of the eye) sit on the ground and bend with it, and the camera follows the bend, so each pose keeps its view
 * of the same ground from globe to map. A morph sweep (0 to 1 and back) at orbit, 20 km and the 2 m eye, recorded when the
 * page runs with `testRecordings=1`, and stills at morph 0, 0.5 and 1 at each pose for a contact sheet. No budgets.
 */
export const PLANET_SCENE_VISUAL_V5: TestSuite<PlanetSceneTestSettings> = {
  id: 'planet-scene-visual',
  version: 5,
  title: 'Planet scene, by eye: the morph sweep with reference cubes, the camera following the bend (orbit, 20 km, ground)',
  purpose: 'functional',
  requiresVisualReview: true,
  scenarios: [
    ...BENT_SKY_POSES.map((pose) =>
      scripted(`sweep-${pose.id}`, `${pose.label} · morph sweep 0 to 1 and back · cubes, camera on the bend`, 'morphSweep', {
        pose: pose.id, ...REFERENCE_LAYERS,
      }),
    ),
    ...BENT_SKY_POSES.flatMap((pose) =>
      [0, 0.5, 1].map((morph) =>
        look(`cubes-${pose.id}-morph-${morph}`, `${pose.label} · morph ${morph} · cubes, camera on the bend`, {
          pose: pose.id, morph, ...REFERENCE_LAYERS,
        }),
      ),
    ),
  ],
};

/**
 * The layers of the ground-only ladder (step 1): the terrain alone, with the camera on the bend and the reference cubes in.
 * Atmosphere, water, clouds, sky and haze are off; the sky-shell fade is off too, so nothing dissolves.
 */
const GROUND_ONLY_LAYERS: Partial<PlanetSceneTestSettings> = {
  terrain: true, atmosphere: false, water: false, clouds: false, sky: false, haze: false, shellFade: false,
  followBend: true, references: true, plainMaterial: false,
};

/** The label of a ladder tier: `0.001x`. */
function tierLabel(tier: number): string {
  return `${tier}x`;
}

/**
 * One suite of the ground-only ladder (step 1: the ground layer alone) for a world `tier` times Earth's radius (6 371 000 m).
 * Three morph sweeps (orbit, 20 km, ground) and six stills (orbit and ground at morph 0, 0.5 and 1), built like visual v5's.
 * One suite per tier because a run's recordings are capped at 5 MiB.
 */
function groundEarthSuite(tier: number): TestSuite<PlanetSceneTestSettings> {
  const layers: Partial<PlanetSceneTestSettings> = { ...GROUND_ONLY_LAYERS, radiusM: tier * EARTH_RADIUS_M };
  const label = tierLabel(tier);
  const stillPoses = BENT_SKY_POSES.filter((pose) => pose.id !== 'mid-20km');
  return {
    // The runner's id rule is lower-case letters, digits and hyphens, so 0.001x is `0-001x` in the id.
    id: `planet-ground-earth-${label.replace('.', '-')}`,
    version: 1,
    title: `Planet ground, ladder step 1 (ground only): ${label} Earth, radius ${(tier * EARTH_RADIUS_M).toLocaleString('en-US')} m, morph sweeps and stills`,
    purpose: 'functional',
    requiresVisualReview: true,
    scenarios: [
      ...BENT_SKY_POSES.map((pose) =>
        scripted(`sweep-${pose.id}`, `${pose.label} · morph sweep 0 to 1 and back · ground only, ${label} Earth`, 'morphSweep', { pose: pose.id, ...layers }),
      ),
      ...stillPoses.flatMap((pose) =>
        [0, 0.5, 1].map((morph) =>
          look(`cubes-${pose.id}-morph-${morph}`, `${pose.label} · morph ${morph} · ground only, ${label} Earth`, { pose: pose.id, morph, ...layers }),
        ),
      ),
    ],
  };
}

/** The ground-only ladder, step 1: one suite per world size, 0.001x to 1x Earth. */
export const PLANET_GROUND_EARTH_SUITES: readonly TestSuite<PlanetSceneTestSettings>[] = EARTH_SCALE_TIERS.map(groundEarthSuite);

/**
 * Suite `planet-ground-cull-ab` v1: the cull A/B for the ladder step 1 ground flicker. At the 0.1x tier (radius 637 100 m), ground
 * only, a morph sweep at 20 km and at the 2 m eye with the terrain's own culling on and off. If the flicker goes with the
 * culling off, the selector's cull works on bounds that lag the morph. Look at the clips; no timing claims.
 */
export const PLANET_GROUND_CULL_AB: TestSuite<PlanetSceneTestSettings> = {
  id: 'planet-ground-cull-ab',
  version: 1,
  title: 'Planet ground, cull A/B for the ladder step 1 flicker: morph sweeps at 0.1x Earth with terrain culling on and off',
  purpose: 'functional',
  requiresVisualReview: true,
  scenarios: [
    ['mid-20km', '20 km'], ['ground', '2 m eye'],
  ].flatMap(([pose, poseLabel]) => [true, false].map((cull) =>
    scripted(`sweep-${pose}-cull-${cull ? 'on' : 'off'}`, `${poseLabel} · morph sweep · ground only, 0.1x Earth · terrain cull ${cull ? 'on' : 'off'}`, 'morphSweep', {
      pose: pose as PlanetPoseId, ...GROUND_ONLY_LAYERS, radiusM: 0.1 * EARTH_RADIUS_M, ...(cull ? {} : { terrainCull: false }),
    }),
  )),
};

/**
 * What the page offers its runner: the visual suites, the ground-only ladder and the cull A/B first. The runner suites append the
 * history after them, so the last entry ("Run latest test") is still planet-scene v5.
 */
export const PLANET_SCENE_PAGE_SUITES: readonly TestSuite<PlanetSceneTestSettings>[] = [
  PLANET_SCENE_VISUAL_V1, PLANET_SCENE_VISUAL_V2, PLANET_SCENE_VISUAL_V3, PLANET_SCENE_VISUAL_V4, PLANET_SCENE_VISUAL_V5,
  ...PLANET_GROUND_EARTH_SUITES, PLANET_GROUND_CULL_AB,
];

/** Oldest first; the final entry is "Run latest test". */
export const PLANET_SCENE_TEST_HISTORY: readonly TestSuite<PlanetSceneTestSettings>[] = [PLANET_SCENE_V1, PLANET_SCENE_V2, PLANET_SCENE_V3, PLANET_SCENE_V4, PLANET_SCENE_V5];

/** The page's runner suites. Declared after the history so the history stays the performance record. */
export const PLANET_SCENE_RUNNER_SUITES: readonly TestSuite<PlanetSceneTestSettings>[] = [...PLANET_SCENE_PAGE_SUITES, ...PLANET_SCENE_TEST_HISTORY];
