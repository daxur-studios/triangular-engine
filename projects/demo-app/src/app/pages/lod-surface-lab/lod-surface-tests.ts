import type { TestScenario, TestSuite } from 'triangular-engine/testing';
import type { PoseId } from './lod-camera';
import type { CubeWarp, DomainPresetId } from './lod-domain';
import type { HeightSourceId } from './lod-height';
import type { LodMode, PatchCells } from './lod-selector';
import type { LodView } from './lod-surface-mesh';

/** Everything a Plan 059 lab case sets; also the snapshot a run restores. Plain JSON. */
export interface LodSurfaceTestSettings {
  readonly domain: DomainPresetId;
  readonly warp: CubeWarp;
  readonly source: HeightSourceId;
  readonly patchCells: PatchCells;
  readonly mode: LodMode;
  readonly fixedLevel: number;
  readonly cellPixels: number;
  readonly leafCap: number;
  readonly cull: boolean;
  /** Split/merge hysteresis ratio of the distance criterion (`SelectorSettings.hysteresis`); 0 is the single threshold. */
  readonly hysteresis: number;
  readonly folding: boolean;
  /** Share of each leaf's size it is shrunk by (probe validation); 0 in every ordinary case. */
  readonly injectedGap: number;
  readonly pose: PoseId;
  readonly view: LodView;
  readonly wireframe: boolean;
  readonly bounds: boolean;
  readonly lighting: boolean;
  /** Detail noise below the texel size (`lod-detail-noise.ts`): amplitude of its first octave as a share of the texel size; 0 is off. */
  readonly detailNoise: number;
  /**
   * A scripted camera runs during the window instead of a still pose: `zoom` flies the ground-to-orbit path once; `sweep`
   * holds `pose` and swings the camera back and forth; `turn` holds `pose` exactly and swings only the heading (+-90
   * degrees, no distance change); `biome-sweep` traverses the five biome regions.
   */
  readonly motion?: 'zoom' | 'sweep' | 'turn' | 'biome-sweep';
}

/** What `lod-surface-baseline` v3–v4 and `lod-surface-terrain` v2–v6 run with: 32 cells per patch. Their definitions keep it. */
const CELLS_32: LodSurfaceTestSettings = {
  domain: 'sphere-600km', warp: 'equal-angle', source: 'bumps', patchCells: 32, mode: 'distance', fixedLevel: 5,
  cellPixels: 4, leafCap: 1024, cull: true, hysteresis: 0.15, folding: true, injectedGap: 0, pose: 'eye-2m', view: 'lod', wireframe: false,
  bounds: true, lighting: true, detailNoise: 0,
};

/** What `lod-surface-baseline` v5 and `lod-surface-terrain` v7 run with: 16 cells (owner's visual check, 2026-10-27), no detail noise. Their definitions keep it. */
const CELLS_16: LodSurfaceTestSettings = { ...CELLS_32, patchCells: 16 };

/** Default detail noise amplitude, a share of the texel size (about 4 m on the plane's 98 m texel, 37 m on the 600 km sphere's 920 m one). */
export const DEFAULT_DETAIL_SHARE = 0.04;

/** The lab's defaults, and what `lod-surface-terrain` v8 runs with: 16 cells and the detail noise on. */
export const DEFAULT_SETTINGS: LodSurfaceTestSettings = { ...CELLS_16, detailNoise: DEFAULT_DETAIL_SHARE };

/** What suites before the hysteresis existed were measured with: the single threshold. Their definitions keep it. */
const NO_HYSTERESIS: LodSurfaceTestSettings = { ...CELLS_32, hysteresis: 0 };

/** What a case expects of the crack probe. */
export type CrackExpectation = 'none' | 'some';

export function crackExpectation(settings: LodSurfaceTestSettings): CrackExpectation {
  return settings.injectedGap > 0 || !settings.folding ? 'some' : 'none';
}

const DOMAINS: readonly DomainPresetId[] = ['plane-100km', 'sphere-10km', 'sphere-600km'];
const POSES: readonly PoseId[] = ['eye-2m', 'low-200m', 'mid-5km', 'horizon', 'orbit'];

/** A still case; `quickMs`, when given, caps its quick window below the full 4 s. */
function still(
  id: string, label: string, change: Partial<LodSurfaceTestSettings>, quickMs?: number, base: LodSurfaceTestSettings = CELLS_32,
): TestScenario<LodSurfaceTestSettings> {
  return { id, label, settings: { ...base, ...change }, warmupMs: 500, durationMs: 4000, ...(quickMs ? { quickMs } : {}) };
}

/** A sweep case: the pose held while the camera swings for 8 s (four periods); quick mode shows two. */
function sweep(id: string, label: string, change: Partial<LodSurfaceTestSettings>, base: LodSurfaceTestSettings = CELLS_32): TestScenario<LodSurfaceTestSettings> {
  return { id, label, settings: { ...base, ...change, motion: 'sweep' }, warmupMs: 500, durationMs: 8000, quickMs: 4000 };
}

/** A turn case: the pose held while only the heading swings for 8 s (two periods); quick mode shows one. */
function turn(id: string, label: string, change: Partial<LodSurfaceTestSettings>, base: LodSurfaceTestSettings): TestScenario<LodSurfaceTestSettings> {
  return { id, label, settings: { ...base, ...change, motion: 'turn' }, warmupMs: 500, durationMs: 8000, quickMs: 4000 };
}

/** Leaf cap of the turn A/B that never binds (the lab's largest button is 4096; the sweeps at 16 cells stay far below this). */
export const TURN_UNCAPPED_LEAVES = 16_384;

/**
 * The turn cases added in baseline v6: a pure turn (position and altitude fixed) at the two sweep poses, in three variants.
 * `-cap16k` raises the leaf cap so it never binds, and `-nocull` turns the frustum culling off, so each isolates one
 * suspected cause of patches flickering between split and merged while the camera only turns: a leaf budget reshuffled as
 * culled patches leave and enter the view, and a balance rule that sees different neighbours as they drop out.
 */
function baselineTurns(base: LodSurfaceTestSettings): TestScenario<LodSurfaceTestSettings>[] {
  return ([['plane-100km', 'low-200m'], ['sphere-600km', 'mid-5km']] as const).flatMap(([domain, pose]) => [
    turn(`turn-${domain}-${pose}`, `turn · ${domain} · ${pose}`, { domain, pose }, base),
    turn(`turn-${domain}-${pose}-cap16k`, `turn · ${domain} · ${pose} · leaf cap ${TURN_UNCAPPED_LEAVES} (A/B)`, { domain, pose, leafCap: TURN_UNCAPPED_LEAVES }, base),
    turn(`turn-${domain}-${pose}-nocull`, `turn · ${domain} · ${pose} · culling off (A/B)`, { domain, pose, cull: false }, base),
  ]);
}

/**
 * The cases of `lod-surface-baseline`; v1 capped each still window at 1.5 s in quick mode. `base` is what the cases start
 * from (v1 and v2 predate the hysteresis, so they use {@link NO_HYSTERESIS}).
 */
function baselineScenarios(base: LodSurfaceTestSettings, stillQuickMs?: number): TestScenario<LodSurfaceTestSettings>[] {
  const s = (id: string, label: string, change: Partial<LodSurfaceTestSettings>) => still(id, label, change, stillQuickMs, base);
  return [
    ...DOMAINS.flatMap((domain) => POSES.map((pose) => s(`${domain}-${pose}`, `${domain} · ${pose} · bumps`, { domain, pose }))),
    s('plane-100km-eye-2m-flat', 'plane-100km · eye-2m · flat', { domain: 'plane-100km', pose: 'eye-2m', source: 'flat' }),
    s('sphere-600km-eye-2m-flat', 'sphere-600km · eye-2m · flat', { domain: 'sphere-600km', pose: 'eye-2m', source: 'flat' }),
    s('sphere-600km-eye-2m-cells16', 'sphere-600km · eye-2m · 16 cells', { patchCells: 16 }),
    s('sphere-600km-eye-2m-cells64', 'sphere-600km · eye-2m · 64 cells', { patchCells: 64 }),
    s('sphere-600km-mid-5km-nowarp', 'sphere-600km · 5 km · no warp', { pose: 'mid-5km', warp: 'none' }),
    s('sphere-10km-orbit-fixed', 'sphere-10km · orbit · fixed level 5 (uniform baseline)', { domain: 'sphere-10km', pose: 'orbit', mode: 'fixed', fixedLevel: 5 }),
    s('control-injected-gap', 'control: injected gap (probe must find cracks)', { pose: 'low-200m', injectedGap: 0.01 }),
    s('control-folding-off', 'control: folding off over bumps (probe should find cracks)', { pose: 'low-200m', folding: false }),
    { id: 'zoom-sphere-600km', label: 'zoom 2 m to orbit · sphere-600km', settings: { ...base, motion: 'zoom' }, warmupMs: 500, durationMs: 12_000, quickMs: 6000 },
    { id: 'zoom-plane-100km', label: 'zoom 2 m to orbit · plane-100km', settings: { ...base, domain: 'plane-100km', motion: 'zoom' }, warmupMs: 500, durationMs: 12_000, quickMs: 6000 },
  ];
}

/**
 * The sweep cases added in baseline v3 and terrain v2. The `-nohyst` case is the A/B partner of the one before it: the same
 * sweep with the single threshold, so `levelChangesPerSecond` shows what the hysteresis removes.
 */
function baselineSweeps(base: LodSurfaceTestSettings = CELLS_32): TestScenario<LodSurfaceTestSettings>[] {
  return [
    sweep('sweep-sphere-600km-eye-2m', 'sweep · sphere-600km · eye-2m', { domain: 'sphere-600km', pose: 'eye-2m' }, base),
    sweep('sweep-plane-100km-low-200m', 'sweep · plane-100km · low-200m', { domain: 'plane-100km', pose: 'low-200m' }, base),
    sweep('sweep-plane-100km-low-200m-nohyst', 'sweep · plane-100km · low-200m · no hysteresis (A/B)', { domain: 'plane-100km', pose: 'low-200m', hysteresis: 0 }, base),
    // The eye-2m sweep never crosses a threshold on the sphere (the tree is at its deepest level); 5 km does, so it carries the sphere A/B.
    sweep('sweep-sphere-600km-mid-5km', 'sweep · sphere-600km · mid-5km', { domain: 'sphere-600km', pose: 'mid-5km' }, base),
    sweep('sweep-sphere-600km-mid-5km-nohyst', 'sweep · sphere-600km · mid-5km · no hysteresis (A/B)', { domain: 'sphere-600km', pose: 'mid-5km', hysteresis: 0 }, base),
  ];
}

/**
 * Suite `lod-surface-baseline` v1 (Plan 059 M1). Every still case runs a timing window, then the crack probe outside
 * the window. Two controls must find cracks (an injected gap; folding off over bumps), which is what shows the probe
 * can see one. The zoom cases fly 2 m eye to orbit and record the selection time of every frame.
 */
const BASELINE_V1: TestSuite<LodSurfaceTestSettings> = {
  id: 'lod-surface-baseline',
  version: 1,
  title: 'LOD surface core M1: cost, cracks and the ground-to-orbit zoom (Plan 059)',
  purpose: 'performance',
  scenarios: baselineScenarios(NO_HYSTERESIS, 1500),
};

/** v2: the same cases; a still window's quick cap is its full 4 s, so a series has time to settle. */
const BASELINE_V2: TestSuite<LodSurfaceTestSettings> = { ...BASELINE_V1, version: 2, scenarios: baselineScenarios(NO_HYSTERESIS) };

/**
 * v3: split/merge hysteresis (0.15, the lab default) is on in every case, the moving cases also record `levelChanges`, and
 * three sweep cases hold a pose while the camera swings back and forth (one of them without hysteresis, for comparison).
 * Existing case ids are unchanged, but their numbers are not comparable with v2: the tree they draw differs.
 */
const BASELINE_V3: TestSuite<LodSurfaceTestSettings> = {
  ...BASELINE_V1,
  version: 3,
  title: 'LOD surface core: cost, cracks, the zoom and the back-and-forth sweep, with split/merge hysteresis (Plan 059)',
  scenarios: [...baselineScenarios(CELLS_32), ...baselineSweeps()],
};

/**
 * v4: the same cases as v3. The selector's leaf budget is hysteretic too (a node split in the last tree ranks `hysteresis`
 * higher), which matters at this suite's 1,024-leaf cap where every moving case sits at the cap, so v3's churn numbers are
 * not comparable: at the cap v3 showed no effect from the hysteresis at all.
 */
const BASELINE_V4: TestSuite<LodSurfaceTestSettings> = {
  ...BASELINE_V3,
  version: 4,
  title: 'LOD surface core: cost, cracks, the zoom and the back-and-forth sweep, with split/merge hysteresis in the threshold and the leaf budget (Plan 059)',
};

/** Terrain sources the suite measures, each with the domains it makes sense on (the cell planet is a sphere only). */
export const TERRAIN_CASES: readonly { readonly source: HeightSourceId; readonly domains: readonly DomainPresetId[] }[] = [
  { source: 'cell-planet', domains: ['sphere-10km', 'sphere-600km'] },
  { source: 'noise', domains: ['plane-100km', 'sphere-600km', 'sphere-10km'] },
  { source: 'cliff', domains: ['plane-100km', 'sphere-10km'] },
  { source: 'biome-mix', domains: ['plane-100km', 'sphere-10km'] },
];

/** The sweep each terrain v2 group ends with, keyed `source|domain`; it joins its group so the bake cache is still hit. */
const TERRAIN_SWEEPS: Readonly<Record<string, PoseId>> = {
  'cell-planet|sphere-10km': 'low-200m',
  'cliff|plane-100km': 'low-200m',
};

/**
 * Cell planet 10 km: the world and its sampler are built once and shared with the 600 km bake that follows. `base` is
 * what the cases start from; `sweeps` adds the sweep case at the end of its source and domain group.
 */
function terrainScenarios(base: LodSurfaceTestSettings, sweeps: boolean): TestScenario<LodSurfaceTestSettings>[] {
  const settings = (source: HeightSourceId, domain: DomainPresetId, pose: PoseId): Partial<LodSurfaceTestSettings> => ({ source, domain, pose, view: 'shaded', bounds: false });
  const out: TestScenario<LodSurfaceTestSettings>[] = [];
  for (const { source, domains } of TERRAIN_CASES.filter((entry) => entry.source !== 'biome-mix')) {
    for (const domain of domains) {
      for (const pose of POSES) out.push(still(`${source}-${domain}-${pose}`, `${source} · ${domain} · ${pose}`, settings(source, domain, pose), undefined, base));
      // The control sits in the middle of its source's group, so it reuses that bake instead of making a third one.
      if (source === 'noise' && domain === 'sphere-10km') {
        out.push(still('control-injected-gap', 'control: injected gap over baked noise (probe must find cracks)', { ...settings(source, domain, 'low-200m'), injectedGap: 0.01 }, undefined, base));
      }
      const sweepPose = sweeps ? TERRAIN_SWEEPS[`${source}|${domain}`] : undefined;
      if (sweepPose) out.push(sweep(`sweep-${source}-${domain}-${sweepPose}`, `sweep · ${source} · ${domain} · ${sweepPose}`, settings(source, domain, sweepPose), base));
    }
  }
  return out;
}

/**
 * Suite `lod-surface-terrain` v1 (Plan 059 order step 3): the baseline poses over the baked terrain sources, each case
 * after its bake has landed (the adapter waits for `heightSourceReady`, so no bake falls inside a timing window). Cases
 * run source by source and domain by domain so the page's two-entry bake cache is hit by every case after the first of a
 * group. Besides the baseline metrics each case reports the bake (per face, total, upload, texture MB, world build for the
 * cell planet) and the CPU twin's error against the source at 64 probe points. The cliff is expected to look stretched on the plane:
 * that is what the slope criterion and M6 are for. Settings differ from the baseline (shaded view, no bounds overlay) so
 * thumbnails read as terrain.
 */
const TERRAIN_V1: TestSuite<LodSurfaceTestSettings> = {
  id: 'lod-surface-terrain',
  version: 1,
  title: 'LOD surface core: baked terrain sources (cell planet, noise, cliff) at the baseline poses (Plan 059)',
  purpose: 'performance',
  requiresVisualReview: true,
  scenarios: terrainScenarios(NO_HYSTERESIS, false),
};

/** v2: hysteresis on, plus one back-and-forth sweep on the cell planet and one on the cliff (each in its group). */
const TERRAIN_V2: TestSuite<LodSurfaceTestSettings> = {
  ...TERRAIN_V1,
  version: 2,
  title: 'LOD surface core: baked terrain sources at the baseline poses and a back-and-forth sweep, with split/merge hysteresis (Plan 059)',
  scenarios: terrainScenarios(CELLS_32, true),
};

/** v3: the same cases; the hysteresis also ranks the leaf budget (see {@link BASELINE_V4}), so v2's sweep numbers are not comparable. */
const TERRAIN_V3: TestSuite<LodSurfaceTestSettings> = {
  ...TERRAIN_V2,
  version: 3,
  title: 'LOD surface core: baked terrain sources at the baseline poses and a back-and-forth sweep, with split/merge hysteresis in the threshold and the leaf budget (Plan 059)',
};

/** v4 adds the biome source without changing the historical suite definitions. */
const biomeCases = (base: LodSurfaceTestSettings): TestScenario<LodSurfaceTestSettings>[] => TERRAIN_CASES.find((entry) => entry.source === 'biome-mix')!.domains.flatMap((domain) => {
  const common: Partial<LodSurfaceTestSettings> = { source: 'biome-mix', domain, view: 'shaded', bounds: false };
  return [
    ...POSES.map((pose) => still(`biome-mix-${domain}-${pose}`, `biome mix · ${domain} · ${pose}`, { ...common, pose }, undefined, base)),
    ...(['biome-mountain', 'biome-canyon'] as const).map((pose) => still(`biome-mix-${domain}-${pose}`, `biome mix · ${domain} · ${pose}`, { ...common, pose }, undefined, base)),
    { id: `biome-mix-${domain}-traverse`, label: `biome mix · ${domain} · traversal`, settings: { ...base, ...common, motion: 'biome-sweep' as const }, warmupMs: 500, durationMs: 8000, quickMs: 4000 },
  ];
});
const BIOME_CASES = biomeCases(CELLS_32);
const FLOOR_CASES = [2, 4, 2, 4].map((cellPixels, index) => still(
  `biome-mix-floor-${cellPixels}-${index + 1}`, `biome mix · mountain · ${cellPixels} px · round ${index + 1}`,
  { source: 'biome-mix', domain: 'plane-100km', pose: 'biome-mountain', view: 'shaded', bounds: false, cellPixels },
));
const TERRAIN_V4: TestSuite<LodSurfaceTestSettings> = {
  ...TERRAIN_V3, version: 4,
  title: 'LOD surface core: mixed biome terrain and pixel size (Plan 059)',
  scenarios: [...TERRAIN_V3.scenarios, ...BIOME_CASES, ...FLOOR_CASES],
};

const ABAB_COMMON: Partial<LodSurfaceTestSettings> = { source: 'biome-mix', domain: 'plane-100km', pose: 'biome-mountain', view: 'shaded', bounds: false };
const capAbab = (base: LodSurfaceTestSettings, patchCells: PatchCells) => [1024, 512, 1024, 512].map((leafCap, index) => still(`biome-cap-${leafCap}-${index + 1}`, `biome mountain cap ${leafCap} round ${index + 1}`, { ...ABAB_COMMON, leafCap, patchCells }, undefined, base));
const CAP_ABAB = capAbab(CELLS_32, 32);
const CELLS_ABAB = [32, 16, 32, 16].map((patchCells, index) => still(`biome-cells-${patchCells}-${index + 1}`, `biome mountain cells ${patchCells} round ${index + 1}`, { ...ABAB_COMMON, leafCap: 1024, patchCells: patchCells as PatchCells }));
const TERRAIN_V5: TestSuite<LodSurfaceTestSettings> = { ...TERRAIN_V4, version: 5, title: 'LOD surface core: biome lighting, traversal probes and geometry comparisons (Plan 059)', scenarios: [...TERRAIN_V3.scenarios, ...BIOME_CASES, ...CAP_ABAB, ...CELLS_ABAB] };

/** v6: the canyon is a 900 m deep cut with about 400 m walls and an oblique 1,500 m pose, so the canyon cases measure another surface. */
const TERRAIN_V6: TestSuite<LodSurfaceTestSettings> = { ...TERRAIN_V5, version: 6, title: 'LOD surface core: biome canyon cut and oblique canyon pose (Plan 059)' };

/**
 * Baseline v5 and terrain v7: 16 cells per patch (the new lab default), and the split distance is measured to each node's
 * box (ground radius by height range) instead of its bounding sphere, which over-split nodes near tall walls. Same case ids;
 * numbers are not comparable with v4 / v6. The cap A/B now runs at 16 cells; the cells A/B keeps both sizes.
 */
const BASELINE_V5: TestSuite<LodSurfaceTestSettings> = {
  ...BASELINE_V4, version: 5,
  title: 'LOD surface core: cost, cracks, the zoom and the sweep at 16 cells, box split distance (Plan 059)',
  scenarios: [...baselineScenarios(CELLS_16), ...baselineSweeps(CELLS_16)],
};
const TERRAIN_V7: TestSuite<LodSurfaceTestSettings> = {
  ...TERRAIN_V6, version: 7,
  title: 'LOD surface core: terrain at 16 cells with the box split distance (Plan 059)',
  scenarios: [...terrainScenarios(CELLS_16, true), ...biomeCases(CELLS_16), ...capAbab(CELLS_16, 16), ...CELLS_ABAB],
};
/**
 * v6: v5's cases and six turn cases (see {@link baselineTurns}) at v5's settings (16 cells, detail noise off). Same ids for
 * the earlier cases and the same numbers; the turn cases are new. Read `levelChangesPerSecond` and the visible new
 * splits and merges of the three variants of a pose against each other: if the cap-16k variant is quiet the leaf budget
 * flickers; if the no-cull variant is quiet the culling (the balance rule over the culled set) does.
 */
const BASELINE_V6: TestSuite<LodSurfaceTestSettings> = {
  ...BASELINE_V5, version: 6,
  title: 'LOD surface core: cost, cracks, the zoom and the sweep at 16 cells, plus a pure turn with leaf cap and culling A/B (Plan 059)',
  scenarios: [...BASELINE_V5.scenarios, ...baselineTurns(CELLS_16)],
};

/**
 * v8: terrain v7's cases with the detail noise on (the new default): a few octaves of noise below the texel size, so the
 * ground is no longer flat between texels and the lighting shows it. Same case ids; numbers are not comparable with v7
 * (more vertex work, and the node height ranges are wider by the noise bound).
 */
const TERRAIN_V8: TestSuite<LodSurfaceTestSettings> = {
  ...TERRAIN_V7, version: 8,
  title: 'LOD surface core: terrain at 16 cells with detail noise below the texel size (Plan 059)',
  scenarios: [...terrainScenarios(DEFAULT_SETTINGS, true), ...biomeCases(DEFAULT_SETTINGS), ...capAbab(DEFAULT_SETTINGS, 16), ...CELLS_ABAB.map((scenario) => ({ ...scenario, settings: { ...scenario.settings, detailNoise: DEFAULT_SETTINGS.detailNoise } }))],
};

/** Oldest first; the final entry is "Run latest test". Earlier versions are still run by their exact version. */
export const LOD_SURFACE_TEST_HISTORY: readonly TestSuite<LodSurfaceTestSettings>[] = [BASELINE_V1, BASELINE_V2, BASELINE_V3, BASELINE_V4, BASELINE_V5, BASELINE_V6, TERRAIN_V1, TERRAIN_V2, TERRAIN_V3, TERRAIN_V4, TERRAIN_V5, TERRAIN_V6, TERRAIN_V7, TERRAIN_V8];
