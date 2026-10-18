import type { TestScenario, TestSuite } from 'triangular-engine/testing';
import type { WorldProfileKind } from 'triangular-engine/worldgen';
import type { MapProjectionKind, PlanetMapBorderStyle } from 'triangular-engine/worldgen/render';

export type MorphTestVec3 = readonly [number, number, number];
export type MorphTestQuality = 'standard' | 'high' | 'ultra';
export type MorphTestColourMode = 'natural' | 'elevation' | 'plates' | 'lod' | 'material';
export type MorphTestBorderPreset = 'subtle' | 'bold' | 'heavy';

/** Everything the morph page lets a person change that affects what streams or draws. Restorable as a unit. */
export interface MorphWorldSettings {
  readonly seed: number;
  readonly worldProfile: WorldProfileKind;
  readonly projection: MapProjectionKind;
  readonly quality: MorphTestQuality;
  readonly reductionPercent: number;
  readonly heightScale: number;
  readonly colourMode: MorphTestColourMode;
  /** Streamed texture LOD for the active colour mode. */
  readonly streamedTextureLod: boolean;
  readonly materialTileResolution: number;
  readonly cliffInfluence: boolean;
  readonly cliffStrength: number;
  readonly macroVariation: boolean;
  readonly frustumLod: boolean;
  readonly freezeLod: boolean;
  readonly wireframe: boolean;
  readonly oceanVisible: boolean;
  readonly cellGrid: boolean;
  readonly mapBorderPreset: MorphTestBorderPreset;
  readonly mapBorderStyle: PlanetMapBorderStyle;
}

/**
 * Fully resolved scenario inputs. `morphKeys` is the morph state (`[m]`, static) or the
 * keyframes of a sweep (`[0, 1, 0]`: equal time per leg, eased like the page's Animate button).
 * The camera is placed on the line from `cameraAtMorph0` to `cameraAtMorph1` at the current morph,
 * which is the page's overview bookmark made explicit as numbers.
 */
export interface MorphTestSettings extends MorphWorldSettings {
  readonly kind: 'static' | 'sweep';
  readonly morphKeys: readonly number[];
  readonly cameraAtMorph0: MorphTestVec3;
  readonly cameraAtMorph1: MorphTestVec3;
  readonly cameraTarget: MorphTestVec3;
  /** Pointer input is off during a run so a person cannot fight the scripted pose. */
  readonly controls: { readonly enabled: boolean; readonly damping: boolean };
}

/** The page's medium planet radius (`WORLD_SIZE_TIER_RADIUS_M.medium`), written out so a retained suite never drifts. */
const RADIUS_M = 600_000;

export const MORPH_TEST_WORLD: MorphWorldSettings = {
  seed: 1, worldProfile: 'volcanic', projection: 'equalEarth', quality: 'high', reductionPercent: 35, heightScale: 4,
  colourMode: 'material', streamedTextureLod: true, materialTileResolution: 256, cliffInfluence: true, cliffStrength: 1,
  macroVariation: false, frustumLod: true, freezeLod: false, wireframe: false, oceanVisible: true, cellGrid: false,
  mapBorderPreset: 'bold', mapBorderStyle: 'cartographic',
};

const BASE: MorphTestSettings = {
  ...MORPH_TEST_WORLD, kind: 'static', morphKeys: [0],
  // Mirrors the page's overview bookmark: 2.6 radii out on the globe, 3.6 on the flat map.
  cameraAtMorph0: [0, 0, RADIUS_M * 2.6], cameraAtMorph1: [0, 0, RADIUS_M * 3.6], cameraTarget: [0, 0, 0],
  controls: { enabled: false, damping: false },
};

function staticScenario(morph: number, durationMs: number, warmupMs: number, overrides: Partial<MorphTestSettings> = {}): TestScenario<MorphTestSettings> {
  return { id: `morph-${String(morph).replace('.', '_')}`, label: `Static morph ${morph}`, durationMs, warmupMs,
    settings: { ...BASE, morphKeys: [morph], ...overrides } };
}

function sweepScenario(durationMs: number, warmupMs: number, overrides: Partial<MorphTestSettings> = {}): TestScenario<MorphTestSettings> {
  return { id: 'sweep-0-1-0', label: 'Smooth sweep 0 → 1 → 0', durationMs, warmupMs,
    settings: { ...BASE, kind: 'sweep', morphKeys: [0, 1, 0], ...overrides } };
}

/** Append new suites/versions at the end; Run latest resolves the final entry once at launch. */
export const MORPH_TEST_HISTORY: readonly TestSuite<MorphTestSettings>[] = [
  {
    id: 'morph-streaming-smoke', version: 1, title: 'Morph streaming smoke: globe, flat map, quick sweep', purpose: 'functional',
    scenarios: [
      staticScenario(0, 400, 0, { quality: 'standard' }),
      staticScenario(1, 400, 0, { quality: 'standard' }),
      { ...sweepScenario(2400, 0, { quality: 'standard' }), id: 'sweep-quick' },
    ],
  },
  {
    id: 'morph-streaming-morph-cost', version: 1, title: 'Morph streaming cost: states 0 / 0.5 / 1 and a smooth sweep',
    purpose: 'performance', requiresVisualReview: true,
    scenarios: [
      staticScenario(0, 3000, 1000), staticScenario(0.5, 3000, 1000), staticScenario(1, 3000, 1000),
      sweepScenario(6000, 500),
    ],
  },
];
