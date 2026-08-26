import { computeElevation, IElevationParams } from './elevation';
import { IPlanetGraphCore } from './planet-graph';
import { classifyBoundaries, IPlateBoundaryEdge } from './plate-boundaries';
import { buildPlates, IPlate } from './plate-tectonics';

export interface IPlanetTectonics {
  seed: number;
  plates: IPlate[];
  /** `plateIdByCell[cell.id]` -> owning plate id. */
  plateIdByCell: number[];
  boundaries: IPlateBoundaryEdge[];
  /** Raw elevation per cell id, arbitrary unitless scale. */
  elevation: number[];
  isLand: boolean[];
  seaLevelElevation: number;
  /** Cell ids touching a continent-continent convergent boundary. */
  ridgeCellIds: number[];
}

export interface IPlanetTectonicsParams extends Omit<IElevationParams, 'seed'> {
  plateCount: number;
  seed?: number;
  oceanicFraction?: number;
}

/**
 * M1 tectonics pass: partitions the M0 graph into plates, classifies every
 * cross-plate adjacency as convergent/divergent/transform, then derives
 * elevation (and a percentile-based sea level) from plate type and boundary
 * shaping. See runbook 022 for the milestone breakdown.
 */
export function buildPlanetTectonics(
  graph: IPlanetGraphCore,
  params: IPlanetTectonicsParams,
): IPlanetTectonics {
  const { plateCount, seed = graph.seed, oceanicFraction, ...elevationParams } = params;

  const { plates, plateIdByCell } = buildPlates(graph, { plateCount, seed, oceanicFraction });
  const boundaries = classifyBoundaries(graph, plates, plateIdByCell);
  const { elevation, isLand, seaLevelElevation, ridgeCellIds } = computeElevation(
    graph,
    plates,
    plateIdByCell,
    boundaries,
    { ...elevationParams, seed },
  );

  return { seed, plates, plateIdByCell, boundaries, elevation, isLand, seaLevelElevation, ridgeCellIds };
}
