/**
 * An axis-aligned rectangle of grid cells. `x`/`y` is the first cell (column, row) and
 * `width`/`height` count cells. Rectangles passed to the grid are clipped to the grid.
 */
export interface NavRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * A set of cells to edit: a rectangle, optionally with a mask that selects a shape inside it.
 * `mask` is row-major with `width * height` entries; a non-zero entry includes the cell. Without a
 * mask every cell of the rectangle is included.
 */
export interface NavFootprint extends NavRect {
  readonly mask?: Uint8Array;
}

/**
 * Source heightfield for a navigation grid. Heights are sampled at cell centres, row-major
 * (`index = y * width + x`), in metres. Horizontal axes are grid X (columns) and grid Y (rows); the
 * consumer decides how they map to world axes.
 */
export interface NavHeightfield {
  /** Cells along X. */
  readonly width: number;
  /** Cells along Y. */
  readonly height: number;
  /** Cell edge length in metres (1 by default in the demo). */
  readonly cellSize: number;
  /** `width * height` heights in metres. */
  readonly heights: Float32Array;
  /** Cells at or below this height are water. Omit for no water-level test. */
  readonly waterLevel?: number;
  /** Optional per-cell water mask (non-zero = water), `width * height` entries. */
  readonly waterMask?: Uint8Array;
}

/** Tunable grid parameters. All fields are optional. */
export interface NavGridOptions {
  /**
   * Largest walkable slope as rise over run (`tan` of the angle). Cells at or above it are blocked.
   * Default `0.7` (about 35 degrees).
   */
  readonly maxWalkableSlope?: number;
  /**
   * Cost factor of a full-strength road (road layer value 255). Default `0.4`: roads cost 40 % of
   * the terrain cost.
   */
  readonly roadMinFactor?: number;
  /**
   * Cost factor applied to cells owned by another faction (see `NavGrid.traversalCost`).
   * Default `1.5`.
   */
  readonly hostileTerritoryFactor?: number;
  /**
   * Clearance saturates at this many cells (1 to 255). Must be at least the largest unit-class
   * threshold. Windowed recomputes are exact because of this cap. Default `16`.
   */
  readonly maxClearance?: number;
}
