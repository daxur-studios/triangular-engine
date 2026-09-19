import { IPlanetSurfaceSampler } from 'triangular-engine/worldgen';
import { ICellPlanetWorldSnapshot } from './cell-planet-world.service';

/**
 * Terrain composition policy. The world graph and feature instances are shared by both
 * policies; this value only selects how the canonical surface will compose them.
 */
export type CellPlanetTerrainStyle = 'blended' | 'cell-features';

export const CELL_PLANET_TERRAIN_STYLE_VERSION = 1;
export const CELL_PLANET_TERRAIN_STYLE_KINDS: readonly CellPlanetTerrainStyle[] = [
  'blended',
  'cell-features',
];

export const CELL_PLANET_TERRAIN_STYLE_LABELS: Record<CellPlanetTerrainStyle, string> = {
  blended: 'Blended landscape (current)',
  'cell-features': 'Per-cell geology (experimental)',
};

export interface ICellPlanetTerrainStyleDescriptor {
  readonly version: number;
  readonly kind: CellPlanetTerrainStyle;
}

export function isCellPlanetTerrainStyle(value: string | undefined): value is CellPlanetTerrainStyle {
  return value !== undefined && CELL_PLANET_TERRAIN_STYLE_KINDS.includes(value as CellPlanetTerrainStyle);
}

export function createCellPlanetTerrainStyleDescriptor(
  kind: CellPlanetTerrainStyle,
): ICellPlanetTerrainStyleDescriptor {
  return { version: CELL_PLANET_TERRAIN_STYLE_VERSION, kind };
}

/**
 * Resolves the sampler used by a terrain view. Blended preserves the existing authored relief;
 * cell-features uses the explicit single-owning-cell composition. Keeping the selection here
 * gives workers and all renderers one stable handoff point.
 */
export function selectCellPlanetSurfaceSampler(
  world: ICellPlanetWorldSnapshot,
  style: CellPlanetTerrainStyle,
  includeLocalFeatures: boolean,
): IPlanetSurfaceSampler {
  if (!includeLocalFeatures) return world.baseSampler;

  switch (style) {
    case 'blended':
      return world.featureSampler;
    case 'cell-features':
      return world.cellFeatureSampler;
  }
}
