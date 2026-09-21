import { IPlanetGraphCore } from './planet-graph';
import { IVec3, normalize } from './vec3';

/** One connected above-water region in a generated planet. */
export interface IPlanetLandmass {
  /** Stable index in `IPlanetLandmasses.landmasses`. */
  id: number;
  /** All above-water cell ids belonging to this landmass. */
  cellIds: number[];
  /** Land cells with at least one below-water neighbour. */
  coastalCellIds: number[];
  /** Normalized mean direction of the landmass' cell centres. */
  center: IVec3;
}

/** Connected land regions derived from one graph and one sea-level classification. */
export interface IPlanetLandmasses {
  /** Landmass index per cell, or -1 for below-water cells. */
  landmassIdByCell: number[];
  /** Flat list of every above-water cell id. */
  landCellIds: number[];
  /** Flat list of every below-water cell id. */
  waterCellIds: number[];
  /** Connected above-water regions, ordered by their lowest cell id. */
  landmasses: IPlanetLandmass[];
}

/**
 * Groups above-water cells into connected landmasses using the planet graph's
 * adjacency. This is a pure O(cells) pass and is safe to cache with a world
 * snapshot; changing sea level requires calling it again.
 */
export function computeLandmasses(
  graph: IPlanetGraphCore,
  isLand: readonly boolean[],
): IPlanetLandmasses {
  const landmassIdByCell = new Array<number>(graph.cells.length).fill(-1);
  const landCellIds: number[] = [];
  const waterCellIds: number[] = [];

  for (const cell of graph.cells) {
    if (isLand[cell.id]) landCellIds.push(cell.id);
    else waterCellIds.push(cell.id);
  }

  const landmasses: IPlanetLandmass[] = [];
  for (const startId of landCellIds) {
    if (landmassIdByCell[startId] !== -1) continue;

    const id = landmasses.length;
    const cellIds: number[] = [];
    const frontier = [startId];
    landmassIdByCell[startId] = id;

    while (frontier.length > 0) {
      const cellId = frontier.pop()!;
      cellIds.push(cellId);
      for (const neighborId of graph.cells[cellId].neighbors) {
        if (!isLand[neighborId] || landmassIdByCell[neighborId] !== -1) continue;
        landmassIdByCell[neighborId] = id;
        frontier.push(neighborId);
      }
    }

    cellIds.sort((left, right) => left - right);
    const coastalCellIds = cellIds.filter((cellId) =>
      graph.cells[cellId].neighbors.some((neighborId) => !isLand[neighborId]),
    );
    let center = { x: 0, y: 0, z: 0 };
    for (const cellId of cellIds) {
      const cellCenter = graph.cells[cellId].center;
      center = {
        x: center.x + cellCenter.x,
        y: center.y + cellCenter.y,
        z: center.z + cellCenter.z,
      };
    }
    landmasses.push({
      id,
      cellIds,
      coastalCellIds,
      center: normalize(center),
    });
  }

  return { landmassIdByCell, landCellIds, waterCellIds, landmasses };
}
