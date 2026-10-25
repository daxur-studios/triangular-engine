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
  readonly folding: boolean;
  /** Share of each leaf's size it is shrunk by (probe validation); 0 in every ordinary case. */
  readonly injectedGap: number;
  readonly pose: PoseId;
  readonly view: LodView;
  readonly wireframe: boolean;
  readonly bounds: boolean;
  /** The scripted ground-to-orbit zoom runs during the window instead of a still pose. */
  readonly motion?: 'zoom';
}

export const DEFAULT_SETTINGS: LodSurfaceTestSettings = {
  domain: 'sphere-600km', warp: 'equal-angle', source: 'bumps', patchCells: 32, mode: 'distance', fixedLevel: 5,
  cellPixels: 4, leafCap: 1024, cull: true, folding: true, injectedGap: 0, pose: 'eye-2m', view: 'lod', wireframe: false,
  bounds: true,
};

/** What a case expects of the crack probe. */
export type CrackExpectation = 'none' | 'some';

export function crackExpectation(settings: LodSurfaceTestSettings): CrackExpectation {
  return settings.injectedGap > 0 || !settings.folding ? 'some' : 'none';
}

const DOMAINS: readonly DomainPresetId[] = ['plane-100km', 'sphere-10km', 'sphere-600km'];
const POSES: readonly PoseId[] = ['eye-2m', 'low-200m', 'mid-5km', 'horizon', 'orbit'];

/** A still case; `quickMs`, when given, caps its quick window below the full 4 s. */
function still(id: string, label: string, change: Partial<LodSurfaceTestSettings>, quickMs?: number): TestScenario<LodSurfaceTestSettings> {
  return { id, label, settings: { ...DEFAULT_SETTINGS, ...change }, warmupMs: 500, durationMs: 4000, ...(quickMs ? { quickMs } : {}) };
}

/** The cases of `lod-surface-baseline`; v1 capped each still window at 1.5 s in quick mode. */
function baselineScenarios(stillQuickMs?: number): TestScenario<LodSurfaceTestSettings>[] {
  const s = (id: string, label: string, change: Partial<LodSurfaceTestSettings>) => still(id, label, change, stillQuickMs);
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
    { id: 'zoom-sphere-600km', label: 'zoom 2 m to orbit · sphere-600km', settings: { ...DEFAULT_SETTINGS, motion: 'zoom' }, warmupMs: 500, durationMs: 12_000, quickMs: 6000 },
    { id: 'zoom-plane-100km', label: 'zoom 2 m to orbit · plane-100km', settings: { ...DEFAULT_SETTINGS, domain: 'plane-100km', motion: 'zoom' }, warmupMs: 500, durationMs: 12_000, quickMs: 6000 },
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
  scenarios: baselineScenarios(1500),
};

/** v2: the same cases; a still window's quick cap is its full 4 s, so a series has time to settle. */
const BASELINE_V2: TestSuite<LodSurfaceTestSettings> = { ...BASELINE_V1, version: 2, scenarios: baselineScenarios() };

/** Terrain sources the suite measures, each with the domains it makes sense on (the cell planet is a sphere only). */
export const TERRAIN_CASES: readonly { readonly source: HeightSourceId; readonly domains: readonly DomainPresetId[] }[] = [
  { source: 'cell-planet', domains: ['sphere-10km', 'sphere-600km'] },
  { source: 'noise', domains: ['plane-100km', 'sphere-600km', 'sphere-10km'] },
  { source: 'cliff', domains: ['plane-100km', 'sphere-10km'] },
];

/** Cell planet 10 km: the world and its sampler are built once and shared with the 600 km bake that follows. */
function terrainScenarios(): TestScenario<LodSurfaceTestSettings>[] {
  const settings = (source: HeightSourceId, domain: DomainPresetId, pose: PoseId): Partial<LodSurfaceTestSettings> => ({ source, domain, pose, view: 'shaded', bounds: false });
  const out: TestScenario<LodSurfaceTestSettings>[] = [];
  for (const { source, domains } of TERRAIN_CASES) {
    for (const domain of domains) {
      for (const pose of POSES) out.push(still(`${source}-${domain}-${pose}`, `${source} · ${domain} · ${pose}`, settings(source, domain, pose)));
      // The control sits in the middle of its source's group, so it reuses that bake instead of making a third one.
      if (source === 'noise' && domain === 'sphere-10km') {
        out.push(still('control-injected-gap', 'control: injected gap over baked noise (probe must find cracks)', { ...settings(source, domain, 'low-200m'), injectedGap: 0.01 }));
      }
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
  scenarios: terrainScenarios(),
};

/** Oldest first; the final entry is "Run latest test". The baseline is still run by its exact version. */
export const LOD_SURFACE_TEST_HISTORY: readonly TestSuite<LodSurfaceTestSettings>[] = [BASELINE_V1, BASELINE_V2, TERRAIN_V1];
