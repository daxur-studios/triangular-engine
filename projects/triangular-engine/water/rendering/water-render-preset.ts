import type { WaterLodGridOptions } from '../core/water-lod-grid';
import type { WaterShadingOptions } from '../core/water-shading-glsl';
import type { WaterWavePreset } from '../core/water-surface';
import { CALM_LAKE_PRESET, OCEAN_SWELL_PRESET } from '../core/wave-presets';
import {
  WATER_TIER_GRID_DEFAULTS,
  type WaterQualityTier,
} from './water-quality';

export interface WaterFarFieldOptions {
  readonly cascadeCount?: number;
  readonly cascadeSpread?: number;
  readonly glintStrength?: number;
  readonly distanceRoughness?: number;
  readonly horizonBlendDistance?: number;
}

export interface WaterStylizeOptions {
  readonly colorSteps?: number;
  readonly timeQuantizeHz?: number;
  readonly normalMapSize?: number;
}

/** Plain render configuration shared by the renderer and `<waterSurface>`. */
export interface WaterRenderPreset {
  readonly name: string;
  readonly tier: WaterQualityTier;
  readonly waves: WaterWavePreset;
  readonly shading: WaterShadingOptions;
  readonly farField?: WaterFarFieldOptions;
  readonly stylize?: WaterStylizeOptions;
  readonly grid: WaterLodGridOptions;
}

export interface WaterRenderPresetOverrides {
  readonly name?: string;
  readonly tier?: WaterQualityTier;
  readonly waves?: WaterWavePreset;
  readonly shading?: WaterShadingOptions;
  readonly farField?: WaterFarFieldOptions;
  readonly stylize?: WaterStylizeOptions;
  readonly grid?: Partial<WaterLodGridOptions>;
}

export function resolveWaterRenderPreset(
  base: WaterRenderPreset,
  overrides: WaterRenderPresetOverrides = {},
): WaterRenderPreset {
  return {
    ...base,
    ...overrides,
    waves: overrides.waves ?? base.waves,
    shading: { ...base.shading, ...overrides.shading },
    farField:
      base.farField || overrides.farField
        ? { ...base.farField, ...overrides.farField }
        : undefined,
    stylize:
      base.stylize || overrides.stylize
        ? { ...base.stylize, ...overrides.stylize }
        : undefined,
    grid: { ...base.grid, ...overrides.grid },
  };
}

export const WATER_RENDER_PRESETS = {
  performance: {
    name: 'performance',
    tier: 'low',
    waves: CALM_LAKE_PRESET,
    shading: {
      colorShallow: '#4ba9c8',
      colorDeep: '#123e52',
      detailStrength: 0.2,
    },
    grid: WATER_TIER_GRID_DEFAULTS.low,
  },
  balanced: {
    name: 'balanced',
    tier: 'medium',
    waves: OCEAN_SWELL_PRESET,
    shading: {
      colorShallow: '#8fe3ff',
      colorDeep: '#04283f',
      absorptionDistance: 6,
      detailTiling: 8,
      detailStrength: 0.5,
      fresnelPower: 3,
      shoreFadeDistance: 2,
    },
    farField: { cascadeCount: 3, cascadeSpread: 8, distanceRoughness: 0.45 },
    grid: WATER_TIER_GRID_DEFAULTS.medium,
  },
  cinematic: {
    name: 'cinematic',
    tier: 'high',
    waves: OCEAN_SWELL_PRESET,
    shading: {
      colorShallow: '#a9efff',
      colorDeep: '#031e34',
      absorptionDistance: 8,
      detailTiling: 5,
      detailStrength: 0.65,
      fresnelPower: 4,
      shoreFadeDistance: 3,
    },
    farField: {
      cascadeCount: 3,
      cascadeSpread: 8,
      glintStrength: 0.8,
      distanceRoughness: 0.65,
      horizonBlendDistance: 4000,
    },
    grid: WATER_TIER_GRID_DEFAULTS.high,
  },
} as const satisfies Readonly<Record<string, WaterRenderPreset>>;
