import { ParamMap } from '@angular/router';

export const CELL_PLANET_QUERY_KEYS = [
  'cellCount',
  'seed',
  'relaxation',
  'worldProfile',
  'worldSize',
  'displayScale',
  'projection',
  'terrainQuality',
  'terrainHeightScale',
  'runtimeSimplificationRatio',
  'macroVariation',
  'macroVariationStrength',
  'macroVariationScaleM',
  'fillMode',
  'climate',
  'season',
  'waterLevel',
  'showIcons',
  'showRivers',
  'showRidges',
  'showCellEdges',
  'iconBudget',
  'selectedCell',
  'globeHeightScale',
  'seabedRelief',
  'showOcean',
  'u0Bookmark',
] as const;

export type CellPlanetQueryKey = (typeof CELL_PLANET_QUERY_KEYS)[number];
export type CellPlanetQuery = Partial<Record<CellPlanetQueryKey, string>>;

/** Keeps the two comparison pages on the same deterministic world when switching views. */
export function readCellPlanetQuery(params: ParamMap): CellPlanetQuery {
  const query: CellPlanetQuery = {};
  for (const key of CELL_PLANET_QUERY_KEYS) {
    const value = params.get(key);
    if (value !== null) query[key] = value;
  }
  return query;
}
