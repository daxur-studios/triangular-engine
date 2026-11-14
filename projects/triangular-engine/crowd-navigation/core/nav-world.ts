import { NavGrid } from './nav-grid';
import { NavSectorGraph, type NavSectorOptions } from './nav-sectors';
import type { NavFootprint, NavGridOptions, NavHeightfield, NavRect } from './nav-types';
import { NAV_ROAD_FULL } from './nav-flags';

const now: () => number =
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? () => performance.now()
    : () => Date.now();

/** What one {@link NavWorld} edit touched. */
export interface NavEditResult {
  /** The cell rectangle whose layers or clearance may have changed (clipped to the grid). */
  readonly dirty: NavRect;
  /**
   * The sectors that were rebuilt, ascending: the sectors the rectangle touches plus neighbours
   * whose shared portals changed. Their `NavSectorGraph.versions` entries increased; every other
   * sector kept its version.
   */
  readonly sectors: readonly number[];
  /** Time spent updating the grid layers in milliseconds. */
  readonly gridMs: number;
  /** Time spent rebuilding the sectors in milliseconds. */
  readonly sectorMs: number;
}

/** Totals of a {@link NavWorld}. */
export interface NavWorldStats {
  /** Edits applied. */
  edits: number;
  /** Sectors rebuilt over all edits (a sector rebuilt twice counts twice). */
  sectorsRebuilt: number;
  /** Total grid update time in milliseconds. */
  totalGridMs: number;
  /** Total sector rebuild time in milliseconds. */
  totalSectorMs: number;
  /** The most recent edit, if any. */
  last: NavEditResult | undefined;
}

/**
 * One place for game edits. Each method changes the grid layers in a local window, rebuilds only the
 * touched sectors (`NavSectorGraph.rebuildSectors`) and returns a {@link NavEditResult} with the
 * rebuilt sectors, so the caller (or a test) can see exactly what was affected.
 *
 * Everything downstream repairs itself lazily through the sector versions:
 * - Flow field caches ({@link NavFlowCache}) drop the sector fields of rebuilt sectors, and the fields
 *   that were seeded from them, on their next `sync`/`ensure`, and rebuild them on demand. Fields in
 *   other sectors are untouched. A field is repaired where it depends on a changed sector; a field
 *   elsewhere keeps its (still valid) route even when a new shortcut would be cheaper.
 * - A {@link NavCrowd} notices the rebuilt graph at its next step and moves agents that stand in a
 *   cell their class can no longer stand in to the nearest passable cell.
 *
 * Edits are synchronous. Run the world and its crowd in the same thread (or the same worker).
 * `NavWorld` adds no state beyond the grid and the graph, so code that edits the `NavGrid` directly
 * stays valid as long as it passes the returned rectangle to `rebuildSectors`.
 *
 * No Angular or three.js dependency.
 */
export class NavWorld {
  /** The grid being edited. */
  readonly grid: NavGrid;
  /** The sector graph kept in sync with the grid. */
  readonly graph: NavSectorGraph;
  /** Counters over all edits. */
  readonly stats: NavWorldStats = {
    edits: 0,
    sectorsRebuilt: 0,
    totalGridMs: 0,
    totalSectorMs: 0,
    last: undefined,
  };

  /** Wraps an existing graph (and its grid). */
  constructor(graph: NavSectorGraph) {
    this.graph = graph;
    this.grid = graph.grid;
  }

  /** Builds the grid and the sector graph from a heightfield. */
  static fromHeightfield(
    heightfield: NavHeightfield,
    options: NavGridOptions & NavSectorOptions = {},
  ): NavWorld {
    const grid = NavGrid.fromHeightfield(heightfield, options);
    return new NavWorld(NavSectorGraph.build(grid, options));
  }

  /** Places a solid building (or wall) over a footprint. */
  placeBuilding(footprint: NavFootprint): NavEditResult {
    return this.apply(() => this.grid.stampStructure(footprint));
  }

  /** Removes the structures (and gate state) in a footprint. */
  removeBuilding(footprint: NavFootprint): NavEditResult {
    return this.apply(() => this.grid.clearStructure(footprint));
  }

  /** Places a gate over a footprint, closed unless `open` is true. */
  placeGate(footprint: NavFootprint, open = false): NavEditResult {
    return this.apply(() => this.grid.stampGate(footprint, open));
  }

  /** Opens or closes the gate cells of a footprint. */
  setGateOpen(footprint: NavFootprint, open: boolean): NavEditResult {
    return this.apply(() => this.grid.setGateOpen(footprint, open));
  }

  /** Paints a road over a footprint (`value` 0 to 255; 255 is a full road). */
  paintRoad(footprint: NavFootprint, value = NAV_ROAD_FULL): NavEditResult {
    return this.apply(() => this.grid.paintRoad(footprint, value));
  }

  /** Paints a road along a segment with a round brush (see `NavGrid.paintRoadLine`). */
  paintRoadLine(x0: number, y0: number, x1: number, y1: number, radius = 1, value = NAV_ROAD_FULL): NavEditResult {
    return this.apply(() => this.grid.paintRoadLine(x0, y0, x1, y1, radius, value));
  }

  /**
   * A terrain edit: `edit` receives the shared `heights` array and the grid width and changes heights
   * inside `rect`; the slope, water and steepness flags, cost and clearance are then recomputed for
   * `rect` and the ring of cells around it that depends on it. Cells that became water or too steep
   * block like buildings.
   */
  editTerrain(rect: NavRect, edit: (heights: Float32Array, width: number) => void): NavEditResult {
    return this.apply(() => {
      edit(this.grid.heights, this.grid.width);
      return this.grid.updateTerrain(rect);
    });
  }

  /** Recomputes the terrain of a rectangle after the caller changed `grid.heights` itself. */
  updateTerrain(rect: NavRect): NavEditResult {
    return this.apply(() => this.grid.updateTerrain(rect));
  }

  /**
   * Retunes how strongly roads are preferred (the cost factor of a full road, 0.05 to 1; see
   * `NavGrid.setRoadMinFactor`). Global: every sector is rebuilt and every cached field is dropped.
   */
  setRoadPreference(roadMinFactor: number): NavEditResult {
    return this.apply(() => this.grid.setRoadMinFactor(roadMinFactor));
  }

  private apply(edit: () => NavRect): NavEditResult {
    const t0 = now();
    const dirty = edit();
    const t1 = now();
    const sectors = this.graph.rebuildSectors(dirty);
    const t2 = now();
    const result: NavEditResult = { dirty, sectors, gridMs: t1 - t0, sectorMs: t2 - t1 };
    const stats = this.stats;
    stats.edits++;
    stats.sectorsRebuilt += sectors.length;
    stats.totalGridMs += result.gridMs;
    stats.totalSectorMs += result.sectorMs;
    stats.last = result;
    return result;
  }
}
