/**
 * Bits of the navigation grid flag layer (`NavGrid.flags`, one byte per cell).
 *
 * `WATER` and `STEEP` come from the terrain; `STRUCTURE`, `ROAD` and `TERRITORY` mirror the other
 * layers (non-zero); `GATE` is set by gate stamps and survives other edits; `BLOCKED` is derived:
 * `WATER | STEEP | STRUCTURE` (the structure layer of an open gate is 0, so it does not block).
 */
export const NavFlag = {
  /** The cell cannot be entered by any unit class. */
  BLOCKED: 1,
  /** Below the water level or marked in the water mask. */
  WATER: 2,
  /** Slope at or above the maximum walkable slope. */
  STEEP: 4,
  /** A building or wall occupies the cell (structure layer non-zero). */
  STRUCTURE: 8,
  /** The road layer is non-zero. */
  ROAD: 16,
  /** The cell belongs to a gate (open or closed). */
  GATE: 32,
  /** The territory layer is non-zero (owned by a faction). */
  TERRITORY: 64,
  /** Reserved for a later phase. */
  RESERVED: 128,
} as const;

/** Cost byte meaning impassable in `NavGrid.cost` and `NavGrid.terrain`. */
export const NAV_COST_BLOCKED = 255;

/** Terrain cost of flat walkable ground (the base cost unit). */
export const NAV_BASE_TERRAIN_COST = 16;

/** Largest finite cost byte. */
export const NAV_MAX_FINITE_COST = 254;

/** Structure layer value for a solid structure cell. */
export const NAV_STRUCTURE_SOLID = 255;

/** Road layer value of a full-strength road. */
export const NAV_ROAD_FULL = 255;

/** Unit class names. A class is a clearance threshold, not a separate grid. */
export type NavUnitClass = 'villager' | 'catapult' | 'creature';

/**
 * Minimum clearance (cells to the nearest blocked cell, floored) a cell needs for each unit class.
 * Initial values: villager 1 (any free cell), catapult 3, creature 8.
 */
export const NAV_CLEARANCE_THRESHOLDS: Readonly<Record<NavUnitClass, number>> = {
  villager: 1,
  catapult: 3,
  creature: 8,
};

/**
 * Cost factor for a road layer value: `1 - (road / 255) * (1 - roadMinFactor)`.
 * 0 gives 1 (no road), 255 gives `roadMinFactor`.
 */
export function navRoadFactor(road: number, roadMinFactor = 0.4): number {
  return 1 - (road / NAV_ROAD_FULL) * (1 - roadMinFactor);
}
