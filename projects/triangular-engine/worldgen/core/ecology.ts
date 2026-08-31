import { computeBiomes, IBiomeParams, IPlanetBiomes } from './biomes';
import { computeClimate, IClimateParams, IPlanetClimate } from './climate';
import { extractCoastlines } from './coastlines';
import { addFractalDetail, addFractalDetailWithFlow, IFractalDetailParams } from './polyline-detail';
import { IPlanetGraphCore } from './planet-graph';
import { IPlanetRivers, IRiverParams, traceRivers } from './rivers';
import { IPlanetTectonics } from './tectonics';
import { IVec3 } from './vec3';
import { classifyWaterBodies, IPlanetWaterBodies } from './water-bodies';

export interface IPlanetEcology extends IPlanetClimate, IPlanetBiomes, IPlanetRivers, IPlanetWaterBodies {
  /** Closed polylines walking every land/water cell boundary, with fractal midpoint-displacement
   * detail already baked in (see `polyline-detail.ts`) — real added points, not just a smoothed
   * curve through the raw Voronoi corners. */
  coastlines: IVec3[][];
  /** `IPlanetRivers.riverPaths`, with the same fractal midpoint-displacement detail as
   * `coastlines` (subtler by default — see `riverDetail`). `riverFlow` below is expanded in
   * lockstep by `addFractalDetailWithFlow()` so the two stay index-aligned. */
  riverPaths: IVec3[][];
  /** `IPlanetRivers.riverFlow`, resampled to match the detailed `riverPaths` above. */
  riverFlow: number[][];
}

export interface IPlanetEcologyParams {
  climate?: IClimateParams;
  biomes?: IBiomeParams;
  rivers?: IRiverParams;
  /** Fractal detail applied to extracted coastlines. Pass `{ levels: 0 }` to keep the raw Voronoi loops. */
  coastlineDetail?: IFractalDetailParams;
  /** Fractal detail applied to river paths. Defaults subtler than `coastlineDetail` — a river is
   * a thin line, not a filled silhouette, so it doesn't need as much wobble to read as organic.
   * Pass `{ levels: 0 }` to keep the raw corner-graph paths. */
  riverDetail?: IFractalDetailParams;
}

/**
 * M2 ecology pass: climate (temperature/moisture), biomes, rivers, and
 * coastline extraction, all derived from the M1 tectonics output. See
 * runbook 022 for the milestone breakdown.
 */
export function buildPlanetEcology(
  graph: IPlanetGraphCore,
  tectonics: IPlanetTectonics,
  params: IPlanetEcologyParams = {},
): IPlanetEcology {
  const waterBodies = classifyWaterBodies(graph, tectonics.isLand);
  const climate = computeClimate(
    graph,
    tectonics.elevation,
    tectonics.isLand,
    tectonics.seaLevelElevation,
    params.climate,
  );
  const biomes = computeBiomes(
    graph,
    tectonics.elevation,
    tectonics.isLand,
    waterBodies.waterBodyKind,
    tectonics.ridgeCellIds,
    tectonics.seaLevelElevation,
    climate.temperature,
    climate.moisture,
    params.biomes,
  );
  const rivers = traceRivers(
    graph,
    tectonics.elevation,
    tectonics.isLand,
    tectonics.seaLevelElevation,
    climate.moisture,
    { seed: tectonics.seed, ...params.rivers },
  );
  const coastlines = extractCoastlines(graph, tectonics.isLand).map((loop) =>
    addFractalDetail(loop, true, { seed: tectonics.seed, ...params.coastlineDetail }),
  );
  const detailedRivers = rivers.riverPaths.map((path, i) =>
    addFractalDetailWithFlow(path, rivers.riverFlow[i], false, {
      seed: (tectonics.seed + 1) >>> 0,
      levels: 3,
      amplitude: 0.06,
      falloff: 0.45,
      ...params.riverDetail,
    }),
  );
  const riverPaths = detailedRivers.map((d) => d.points);
  const riverFlow = detailedRivers.map((d) => d.flow);

  return { ...climate, ...biomes, ...rivers, ...waterBodies, coastlines, riverPaths, riverFlow };
}
