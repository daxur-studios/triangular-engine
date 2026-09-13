/**
 * Generation inputs shared by the 2D raster view and the 2.5D terrain view.
 *
 * Keep these in one place: the two pages are different renderers of one planet,
 * not two independent world previews. A mismatch here changes the graph or
 * tectonic elevation and therefore changes the apparent continents.
 */
export const CELL_PLANET_GENERATION_DEFAULTS = {
  cellCount: 1500,
  seed: 1,
  relaxationIterations: 2,
  jitter: 0.35,
  plateCount: 14,
} as const;
