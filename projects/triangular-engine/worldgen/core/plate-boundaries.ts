import { IPlate } from './plate-tectonics';
import { IPlanetGraphCore } from './planet-graph';
import { add, dot, length, normalize, projectOnTangentPlane, sub } from './vec3';

export type BoundaryType = 'convergent' | 'divergent' | 'transform';

export interface IPlateBoundaryEdge {
  cellA: number;
  cellB: number;
  plateA: number;
  plateB: number;
  type: BoundaryType;
  /** Relative motion of A w.r.t. B projected onto the A->B boundary normal: positive closes the gap (converging), negative opens it (diverging). */
  convergence: number;
}

/** Ratio of |convergence| to relative speed above which a boundary counts as convergent/divergent rather than transform (sliding). */
const CONVERGENCE_RATIO_THRESHOLD = 0.35;

/**
 * Classifies every cell-adjacency edge that crosses a plate boundary as
 * convergent, divergent, or transform, from each plate's rigid tangent-plane
 * `movement` vector projected onto the boundary's local normal.
 */
export function classifyBoundaries(
  graph: IPlanetGraphCore,
  plates: IPlate[],
  plateIdByCell: number[],
): IPlateBoundaryEdge[] {
  const boundaries: IPlateBoundaryEdge[] = [];

  for (const cell of graph.cells) {
    const plateA = plateIdByCell[cell.id];
    for (const neighborId of cell.neighbors) {
      if (neighborId <= cell.id) continue; // visit each undirected edge once

      const plateB = plateIdByCell[neighborId];
      if (plateA === plateB) continue;

      const other = graph.cells[neighborId];
      const mid = normalize(add(cell.center, other.center));
      const normal = normalize(projectOnTangentPlane(sub(other.center, cell.center), mid));
      const relativeVelocity = projectOnTangentPlane(
        sub(plates[plateA].movement, plates[plateB].movement),
        mid,
      );

      const speed = length(relativeVelocity);
      const convergence = dot(relativeVelocity, normal);
      const ratio = speed > 1e-9 ? convergence / speed : 0;

      const type: BoundaryType =
        ratio > CONVERGENCE_RATIO_THRESHOLD
          ? 'convergent'
          : ratio < -CONVERGENCE_RATIO_THRESHOLD
            ? 'divergent'
            : 'transform';

      boundaries.push({ cellA: cell.id, cellB: neighborId, plateA, plateB, type, convergence });
    }
  }

  return boundaries;
}
