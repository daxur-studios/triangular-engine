import { computeBiomes, IBiomeParams, IPlanetBiomes } from './biomes';
import { computeClimate, IClimateParams, IPlanetClimate } from './climate';
import { extractCoastlines } from './coastlines';
import { IPlanetGraphCore } from './planet-graph';
import { IPlanetRivers, IRiverParams, traceRivers } from './rivers';
import { IPlanetTectonics } from './tectonics';
import { IVec3 } from './vec3';
import { classifyWaterBodies, IPlanetWaterBodies } from './water-bodies';

export interface IPlanetEcology extends IPlanetClimate, IPlanetBiomes, IPlanetRivers, IPlanetWaterBodies {
  /** Closed polylines walking every land/water cell boundary. */
  coastlines: IVec3[][];
}

export interface IPlanetEcologyParams {
  climate?: IClimateParams;
  biomes?: IBiomeParams;
  rivers?: IRiverParams;
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
  const coastlines = extractCoastlines(graph, tectonics.isLand);

  return { ...climate, ...biomes, ...rivers, ...waterBodies, coastlines };
}
