import type { WaterLodGridOptions } from '../core/water-lod-grid';

/** Performance/capability ladder. Visual style belongs in a render preset. */
export type WaterQualityTier = 'low' | 'medium' | 'high';

export type WaterShaderDefines = Readonly<Record<string, 1>>;

/**
 * Compile-time shader capabilities for each tier. Callers may spread this
 * directly into `ShaderMaterialParameters.defines`.
 */
export function waterTierDefines(tier: WaterQualityTier): WaterShaderDefines {
  switch (tier) {
    case 'low':
      return { WATER_TIER_LOW: 1, WATER_GERSTNER: 1 };
    case 'medium':
      return {
        WATER_TIER_MEDIUM: 1,
        WATER_GERSTNER: 1,
        WATER_DETAIL_NORMALS: 1,
        WATER_DETAIL_CASCADES: 1,
        WATER_DEPTH_PREPASS: 1,
      };
    case 'high':
      return {
        WATER_TIER_HIGH: 1,
        WATER_GERSTNER: 1,
        WATER_DETAIL_NORMALS: 1,
        WATER_DETAIL_CASCADES: 1,
        WATER_DEPTH_PREPASS: 1,
        WATER_FAR_FIELD: 1,
        WATER_GLINT: 1,
      };
  }
}

/** Sensible starting budgets; presets may override individual grid fields. */
export const WATER_TIER_GRID_DEFAULTS: Readonly<
  Record<WaterQualityTier, WaterLodGridOptions>
> = {
  low: {
    baseCellSize: 8,
    patchResolution: 4,
    coreSizePatches: 8,
    ringCount: 4,
  },
  medium: {
    baseCellSize: 4,
    patchResolution: 8,
    coreSizePatches: 16,
    ringCount: 5,
  },
  high: {
    baseCellSize: 2,
    patchResolution: 16,
    coreSizePatches: 16,
    ringCount: 6,
  },
};
