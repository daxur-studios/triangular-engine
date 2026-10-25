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

function still(id: string, label: string, change: Partial<LodSurfaceTestSettings>): TestScenario<LodSurfaceTestSettings> {
  return { id, label, settings: { ...DEFAULT_SETTINGS, ...change }, warmupMs: 500, durationMs: 4000, quickMs: 1500 };
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
  scenarios: [
    ...DOMAINS.flatMap((domain) => POSES.map((pose) => still(`${domain}-${pose}`, `${domain} · ${pose} · bumps`, { domain, pose }))),
    still('plane-100km-eye-2m-flat', 'plane-100km · eye-2m · flat', { domain: 'plane-100km', pose: 'eye-2m', source: 'flat' }),
    still('sphere-600km-eye-2m-flat', 'sphere-600km · eye-2m · flat', { domain: 'sphere-600km', pose: 'eye-2m', source: 'flat' }),
    still('sphere-600km-eye-2m-cells16', 'sphere-600km · eye-2m · 16 cells', { patchCells: 16 }),
    still('sphere-600km-eye-2m-cells64', 'sphere-600km · eye-2m · 64 cells', { patchCells: 64 }),
    still('sphere-600km-mid-5km-nowarp', 'sphere-600km · 5 km · no warp', { pose: 'mid-5km', warp: 'none' }),
    still('sphere-10km-orbit-fixed', 'sphere-10km · orbit · fixed level 5 (uniform baseline)', { domain: 'sphere-10km', pose: 'orbit', mode: 'fixed', fixedLevel: 5 }),
    still('control-injected-gap', 'control: injected gap (probe must find cracks)', { pose: 'low-200m', injectedGap: 0.01 }),
    still('control-folding-off', 'control: folding off over bumps (probe should find cracks)', { pose: 'low-200m', folding: false }),
    { id: 'zoom-sphere-600km', label: 'zoom 2 m to orbit · sphere-600km', settings: { ...DEFAULT_SETTINGS, motion: 'zoom' }, warmupMs: 500, durationMs: 12_000, quickMs: 6000 },
    { id: 'zoom-plane-100km', label: 'zoom 2 m to orbit · plane-100km', settings: { ...DEFAULT_SETTINGS, domain: 'plane-100km', motion: 'zoom' }, warmupMs: 500, durationMs: 12_000, quickMs: 6000 },
  ],
};

export const LOD_SURFACE_TEST_HISTORY: readonly TestSuite<LodSurfaceTestSettings>[] = [BASELINE_V1];
