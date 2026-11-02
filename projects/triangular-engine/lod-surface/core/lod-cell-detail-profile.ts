import { findCellNear, type ICellPlanetWorld } from 'triangular-engine/worldgen';
import type { DetailProfile } from './lod-detail-profile';

/** Options of {@link cellDetailProfile}. */
export interface CellDetailProfileOptions {
  readonly id: string;
  /** The weight of a cell: 0 is flat, 1 the plain detail noise, above 1 stronger. Read once per cell; `world` gives its biome, elevation and land mask. */
  readonly weightOfCell: (cellId: number, world: ICellPlanetWorld) => number;
  /** Texel exponent of the weight bake, see {@link DetailProfile.k}. */
  readonly k?: number;
}

/**
 * A {@link DetailProfile} that gives every cell of a cell planet its own detail weight, so a game decides per biome how much
 * sub-texel relief a cell gets (meadows flat, hills rolling, mountains rugged). The weights are read once, up front; the
 * profile's `maxWeight` is their maximum, so the terrain's culling bound is as tight as the table allows.
 *
 * Body-fixed `(x, y, z)` maps to a direction the way the planet's lookup does (`y` up), and the nearest-site walk keeps its
 * last cell as a hint, so the bake, which visits neighbouring texels in turn, costs a few cell tests per texel.
 */
export function cellDetailProfile(world: ICellPlanetWorld, options: CellDetailProfileOptions): DetailProfile {
  const weights = world.graph.cells.map((cell) => Math.max(0, options.weightOfCell(cell.id, world)));
  const maxWeight = weights.reduce((a, b) => Math.max(a, b), 0);
  let hint = 0;
  const direction = { x: 0, y: 0, z: 0 };
  return {
    id: options.id,
    maxWeight,
    ...(options.k !== undefined ? { k: options.k } : {}),
    weightAt: (x, y, z) => {
      const length = Math.hypot(x, y, z) || 1;
      direction.x = x / length;
      direction.y = y / length;
      direction.z = z / length;
      hint = findCellNear(world.graph, direction, hint).id;
      return weights[hint];
    },
  };
}
