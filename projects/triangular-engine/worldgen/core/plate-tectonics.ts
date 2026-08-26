import { IPlanetGraphCore } from './planet-graph';
import { createSeededRandom } from './seeded-random';
import { IVec3, length, normalize, projectOnTangentPlane, scale } from './vec3';

export type PlateType = 'oceanic' | 'continental';

export interface IPlate {
  id: number;
  seedCellId: number;
  type: PlateType;
  /** Tangent-plane direction at the plate's seed site; magnitude is relative speed. */
  movement: IVec3;
}

export interface IPlateAssignment {
  plates: IPlate[];
  /** `plateIdByCell[cell.id]` -> owning plate id. */
  plateIdByCell: number[];
}

export interface IBuildPlatesParams {
  plateCount: number;
  seed?: number;
  /** Fraction of plates assigned `'oceanic'`; the rest are `'continental'`. */
  oceanicFraction?: number;
}

const DEFAULT_OCEANIC_FRACTION = 0.6;

/** Uniform-ish random unit vector via rejection sampling in the enclosing cube. */
function randomUnitVector(rng: () => number): IVec3 {
  for (let attempt = 0; attempt < 64; attempt++) {
    const v = { x: rng() * 2 - 1, y: rng() * 2 - 1, z: rng() * 2 - 1 };
    const len = length(v);
    if (len > 1e-6) return scale(v, 1 / len);
  }
  return { x: 1, y: 0, z: 0 };
}

/**
 * Partitions the graph into `plateCount` plates via a randomized multi-source
 * flood fill over the cell-adjacency graph: distinct seed cells grow outward
 * by repeatedly claiming a random unclaimed neighbor from the shared frontier,
 * which produces organically shaped, irregular-boundary regions rather than
 * exact-distance Voronoi cells.
 */
export function buildPlates(graph: IPlanetGraphCore, params: IBuildPlatesParams): IPlateAssignment {
  const { plateCount, seed = graph.seed, oceanicFraction = DEFAULT_OCEANIC_FRACTION } = params;
  const cellCount = graph.cells.length;
  const rng = createSeededRandom(seed);

  const shuffledCellIds = graph.cells.map((cell) => cell.id);
  for (let i = shuffledCellIds.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffledCellIds[i], shuffledCellIds[j]] = [shuffledCellIds[j], shuffledCellIds[i]];
  }
  const seedCellIds = shuffledCellIds.slice(0, Math.min(plateCount, cellCount));

  const plates: IPlate[] = seedCellIds.map((seedCellId, id) => {
    const site = graph.cells[seedCellId].center;
    const type: PlateType = rng() < oceanicFraction ? 'oceanic' : 'continental';
    const speed = 0.5 + rng();
    const movement = scale(normalize(projectOnTangentPlane(randomUnitVector(rng), site)), speed);
    return { id, seedCellId, type, movement };
  });

  const plateIdByCell = new Array<number>(cellCount).fill(-1);
  const frontier: number[][] = plates.map((plate) => {
    plateIdByCell[plate.seedCellId] = plate.id;
    return [plate.seedCellId];
  });

  let remaining = frontier.reduce((sum, list) => sum + list.length, 0);
  while (remaining > 0) {
    const activePlateIds = frontier.reduce<number[]>((acc, list, id) => {
      if (list.length > 0) acc.push(id);
      return acc;
    }, []);
    if (activePlateIds.length === 0) break;

    const plateId = activePlateIds[Math.floor(rng() * activePlateIds.length)];
    const list = frontier[plateId];
    const index = Math.floor(rng() * list.length);
    const cellId = list[index];
    list[index] = list[list.length - 1];
    list.pop();
    remaining--;

    for (const neighborId of graph.cells[cellId].neighbors) {
      if (plateIdByCell[neighborId] !== -1) continue;
      plateIdByCell[neighborId] = plateId;
      frontier[plateId].push(neighborId);
      remaining++;
    }
  }

  return { plates, plateIdByCell };
}
