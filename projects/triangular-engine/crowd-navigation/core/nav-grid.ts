import { computeClearanceWindow } from './nav-clearance';
import {
  NAV_BASE_TERRAIN_COST,
  NAV_CLEARANCE_THRESHOLDS,
  NAV_COST_BLOCKED,
  NAV_MAX_FINITE_COST,
  NAV_ROAD_FULL,
  NAV_STRUCTURE_SOLID,
  NavFlag,
  navRoadFactor,
  type NavUnitClass,
} from './nav-flags';
import type { NavFootprint, NavGridOptions, NavHeightfield, NavRect } from './nav-types';

/**
 * A navigation grid: Uint8 layers (one byte per cell, row-major, `index = y * width + x`) derived
 * from a heightfield, plus the edits that change them.
 *
 * Layers:
 * - `terrain`: slope cost. Flat ground is 16, rising with the square of the slope to 254 just below
 *   the walkable limit; water and too-steep cells are 255 (impassable).
 * - `structure`: 0 free, 255 solid (buildings, walls, closed gates).
 * - `road`: 0 no road, 255 full road; the cost factor falls linearly from 1 to `roadMinFactor`.
 * - `territory`: owner faction id, 0 = unowned. Territory is a per-faction cost, applied at query
 *   time by {@link NavGrid.traversalCost}; it is not part of `cost`, so one composed layer serves
 *   every faction.
 * - `flags`: bits of {@link NavFlag}.
 * - `cost`: the composed traversal cost, see {@link NavGrid.composeCost}. 255 is impassable.
 * - `clearance`: cells to the nearest blocked cell, saturating at `maxClearance`.
 *
 * Create one with {@link NavGrid.fromHeightfield}. The class has no Angular or three.js
 * dependency and keeps its state in typed arrays, so it can run in a worker.
 */
export class NavGrid {
  /** Cells along X. */
  readonly width: number;
  /** Cells along Y. */
  readonly height: number;
  /** Cell edge length in metres. */
  readonly cellSize: number;
  /** Largest walkable slope (rise over run). */
  readonly maxWalkableSlope: number;
  /** Road cost factor at road value 255. */
  readonly roadMinFactor: number;
  /** Cost factor for another faction's territory. */
  readonly hostileTerritoryFactor: number;
  /** Clearance saturation value in cells. */
  readonly maxClearance: number;

  /** Heightfield heights in metres (shared with the source heightfield, not copied). */
  readonly heights: Float32Array;
  /** Terrain/slope cost layer. */
  readonly terrain: Uint8Array;
  /** Structure layer: 0 free, 255 solid. */
  readonly structure: Uint8Array;
  /** Road layer: 0 none, 255 full road. */
  readonly road: Uint8Array;
  /** Territory layer: owner faction id, 0 = unowned. */
  readonly territory: Uint8Array;
  /** Flag layer, bits of {@link NavFlag}. */
  readonly flags: Uint8Array;
  /** Composed traversal cost, 255 = impassable. */
  readonly cost: Uint8Array;
  /** Clearance field in cells. */
  readonly clearance: Uint8Array;

  private readonly waterLevel: number | undefined;
  private readonly waterMask: Uint8Array | undefined;

  private constructor(source: NavHeightfield, options: NavGridOptions) {
    const { width, height } = source;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      throw new Error('NavGrid: width and height must be positive integers');
    }
    if (source.heights.length !== width * height) {
      throw new Error('NavGrid: heights length must equal width * height');
    }
    if (source.waterMask && source.waterMask.length !== width * height) {
      throw new Error('NavGrid: waterMask length must equal width * height');
    }
    this.width = width;
    this.height = height;
    this.cellSize = source.cellSize;
    this.maxWalkableSlope = options.maxWalkableSlope ?? 0.7;
    this.roadMinFactor = options.roadMinFactor ?? 0.4;
    this.hostileTerritoryFactor = options.hostileTerritoryFactor ?? 1.5;
    this.maxClearance = Math.min(255, Math.max(1, Math.floor(options.maxClearance ?? 16)));
    this.heights = source.heights;
    this.waterLevel = source.waterLevel;
    this.waterMask = source.waterMask;
    const n = width * height;
    this.terrain = new Uint8Array(n);
    this.structure = new Uint8Array(n);
    this.road = new Uint8Array(n);
    this.territory = new Uint8Array(n);
    this.flags = new Uint8Array(n);
    this.cost = new Uint8Array(n);
    this.clearance = new Uint8Array(n);
  }

  /**
   * Builds a grid from a heightfield: terrain cost and water/steep flags, flags, composed cost and
   * the clearance field. Structure, road and territory layers start empty.
   */
  static fromHeightfield(source: NavHeightfield, options: NavGridOptions = {}): NavGrid {
    const grid = new NavGrid(source, options);
    grid.updateTerrain();
    return grid;
  }

  /** Slope (rise over run) at a cell, from central differences with clamped borders. */
  slopeAt(x: number, y: number): number {
    const { width, height, heights, cellSize } = this;
    const xl = x > 0 ? x - 1 : x;
    const xr = x < width - 1 ? x + 1 : x;
    const yu = y > 0 ? y - 1 : y;
    const yd = y < height - 1 ? y + 1 : y;
    const gx = (heights[y * width + xr] - heights[y * width + xl]) / ((xr - xl || 1) * cellSize);
    const gy = (heights[yd * width + x] - heights[yu * width + x]) / ((yd - yu || 1) * cellSize);
    return Math.hypot(gx, gy);
  }

  /**
   * Recomputes the terrain layer and the WATER and STEEP flags from the heightfield for a
   * rectangle (default: whole grid), then the flags and composed cost there, then clearance in the
   * grown window. Call after changing `heights` (terrain edits). Returns the rectangle whose
   * clearance may have changed.
   */
  updateTerrain(rect: NavRect = this.bounds()): NavRect {
    // Slopes of the cells around the rectangle depend on its heights as well.
    const r = this.clip(grow(this.clip(rect), 1));
    const { width, heights, terrain, flags } = this;
    const hasLevel = this.waterLevel !== undefined;
    const level = this.waterLevel ?? 0;
    const mask = this.waterMask;
    const limit = this.maxWalkableSlope;
    for (let y = r.y; y < r.y + r.height; y++) {
      for (let x = r.x; x < r.x + r.width; x++) {
        const i = y * width + x;
        const water = (hasLevel && heights[i] <= level) || (mask !== undefined && mask[i] !== 0);
        const slope = this.slopeAt(x, y);
        const steep = slope >= limit;
        let f = flags[i] & ~(NavFlag.WATER | NavFlag.STEEP);
        if (water) f |= NavFlag.WATER;
        if (steep) f |= NavFlag.STEEP;
        flags[i] = f;
        if (water || steep) {
          terrain[i] = NAV_COST_BLOCKED;
        } else {
          const t = slope / limit;
          terrain[i] = Math.min(
            NAV_MAX_FINITE_COST,
            NAV_BASE_TERRAIN_COST + Math.round((NAV_MAX_FINITE_COST - NAV_BASE_TERRAIN_COST) * t * t),
          );
        }
      }
    }
    this.refresh(r);
    return this.computeClearance(r);
  }

  /**
   * Recomputes the structure/road/territory flag bits, BLOCKED and the composed `cost` for a
   * rectangle. The editing methods call it; call it yourself only after writing layers directly.
   * It does not recompute clearance.
   *
   * Composition, per cell:
   * `cost = 255` if BLOCKED (water, too steep, or structure non-zero); otherwise
   * `cost = clamp(round(terrain * navRoadFactor(road, roadMinFactor)), 1, 254)`.
   */
  composeCost(rect: NavRect = this.bounds()): void {
    this.refresh(this.clip(rect));
  }

  /**
   * Recomputes clearance in a rectangle, growing it by `maxClearance` cells because blocked cells
   * that far away can change it. Equal to a full recompute for those cells. Returns the grown,
   * clipped rectangle (everything whose clearance may have changed). With no argument it
   * recomputes the whole grid.
   */
  computeClearance(rect: NavRect = this.bounds()): NavRect {
    const win = this.clip(grow(this.clip(rect), this.maxClearance));
    computeClearanceWindow(this.flags, this.width, this.height, win, this.maxClearance, this.clearance);
    return win;
  }

  /**
   * Stamps a solid structure (building or wall) over a footprint, blocking its cells. Gate cells
   * keep their GATE flag. Returns the rectangle whose clearance changed.
   */
  stampStructure(footprint: NavFootprint): NavRect {
    return this.writeLayer(footprint, this.structure, NAV_STRUCTURE_SOLID);
  }

  /** Removes structures (and open/closed gate state) from a footprint. */
  clearStructure(footprint: NavFootprint): NavRect {
    const r = this.writeLayer(footprint, this.structure, 0);
    this.forEachCell(footprint, (i) => {
      this.flags[i] &= ~NavFlag.GATE;
    });
    this.refresh(this.clip(footprint));
    return r;
  }

  /**
   * Stamps a gate over a footprint. A closed gate is a solid structure; an open gate leaves the
   * cells free. Both set the GATE flag. Toggle with {@link NavGrid.setGateOpen}.
   */
  stampGate(footprint: NavFootprint, open = false): NavRect {
    this.forEachCell(footprint, (i) => {
      this.flags[i] |= NavFlag.GATE;
    });
    return this.writeLayer(footprint, this.structure, open ? 0 : NAV_STRUCTURE_SOLID);
  }

  /** Opens or closes the gate cells in a footprint (cells without the GATE flag are skipped). */
  setGateOpen(footprint: NavFootprint, open: boolean): NavRect {
    this.forEachCell(footprint, (i) => {
      if (this.flags[i] & NavFlag.GATE) this.structure[i] = open ? 0 : NAV_STRUCTURE_SOLID;
    });
    const r = this.clip(footprint);
    this.refresh(r);
    return this.computeClearance(r);
  }

  /** Paints the road layer over a footprint with `value` (0 to 255; 255 is a full road). */
  paintRoad(footprint: NavFootprint, value = NAV_ROAD_FULL): NavRect {
    this.forEachCell(footprint, (i) => {
      this.road[i] = value;
    });
    const r = this.clip(footprint);
    this.refresh(r);
    return r;
  }

  /**
   * Paints a road along the segment from cell (`x0`, `y0`) to (`x1`, `y1`) with a round brush of
   * the given `radius` in cells. Returns the touched rectangle.
   */
  paintRoadLine(x0: number, y0: number, x1: number, y1: number, radius = 1, value = NAV_ROAD_FULL): NavRect {
    const r = Math.max(0, radius);
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
    const bounds = this.bounds();
    for (let s = 0; s <= steps; s++) {
      const px = Math.round(x0 + ((x1 - x0) * s) / steps);
      const py = Math.round(y0 + ((y1 - y0) * s) / steps);
      for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) {
        for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
          const x = px + dx;
          const y = py + dy;
          if (dx * dx + dy * dy > r * r + 0.25) continue;
          if (x < 0 || y < 0 || x >= bounds.width || y >= bounds.height) continue;
          this.road[y * this.width + x] = value;
        }
      }
    }
    const touched = this.clip({
      x: Math.min(x0, x1) - Math.ceil(r),
      y: Math.min(y0, y1) - Math.ceil(r),
      width: Math.abs(x1 - x0) + 1 + 2 * Math.ceil(r),
      height: Math.abs(y1 - y0) + 1 + 2 * Math.ceil(r),
    });
    this.refresh(touched);
    return touched;
  }

  /** Assigns a footprint to a faction (`owner` 1 to 255) or releases it (0). */
  paintTerritory(footprint: NavFootprint, owner: number): NavRect {
    this.forEachCell(footprint, (i) => {
      this.territory[i] = owner;
    });
    const r = this.clip(footprint);
    this.refresh(r);
    return r;
  }

  /** True if the cell is inside the grid. */
  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  /**
   * True if a unit class can stand in a cell: the cell is not BLOCKED and its clearance reaches the
   * class threshold (`NAV_CLEARANCE_THRESHOLDS`: villager 1, catapult 3, creature 8). Cells
   * outside the grid are not passable.
   */
  isPassable(x: number, y: number, unitClass: NavUnitClass): boolean {
    return this.inBounds(x, y) && this.isPassableIndex(y * this.width + x, unitClass);
  }

  /** {@link NavGrid.isPassable} for a cell index. */
  isPassableIndex(index: number, unitClass: NavUnitClass): boolean {
    return (
      (this.flags[index] & NavFlag.BLOCKED) === 0 &&
      this.clearance[index] >= NAV_CLEARANCE_THRESHOLDS[unitClass]
    );
  }

  /**
   * The traversal cost of a cell for a faction: `cost`, multiplied by `hostileTerritoryFactor` when
   * the cell is owned by another faction (territory non-zero and not `faction`), clamped to 254.
   * Faction 0 ignores territory. Impassable cells stay 255.
   */
  traversalCost(index: number, faction = 0): number {
    const c = this.cost[index];
    if (c === NAV_COST_BLOCKED) return c;
    const owner = this.territory[index];
    if (faction !== 0 && owner !== 0 && owner !== faction) {
      return Math.min(NAV_MAX_FINITE_COST, Math.round(c * this.hostileTerritoryFactor));
    }
    return c;
  }

  /** The whole grid as a rectangle. */
  bounds(): NavRect {
    return { x: 0, y: 0, width: this.width, height: this.height };
  }

  private clip(r: NavRect): NavRect {
    const x0 = Math.max(0, r.x);
    const y0 = Math.max(0, r.y);
    const x1 = Math.min(this.width, r.x + r.width);
    const y1 = Math.min(this.height, r.y + r.height);
    return { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
  }

  private forEachCell(fp: NavFootprint, fn: (index: number) => void): void {
    const r = this.clip(fp);
    for (let y = r.y; y < r.y + r.height; y++) {
      for (let x = r.x; x < r.x + r.width; x++) {
        if (fp.mask && fp.mask[(y - fp.y) * fp.width + (x - fp.x)] === 0) continue;
        fn(y * this.width + x);
      }
    }
  }

  private writeLayer(fp: NavFootprint, layer: Uint8Array, value: number): NavRect {
    this.forEachCell(fp, (i) => {
      layer[i] = value;
    });
    const r = this.clip(fp);
    this.refresh(r);
    return this.computeClearance(r);
  }

  /** Derives mirror flag bits, BLOCKED and the composed cost for already-clipped `r`. */
  private refresh(r: NavRect): void {
    const { width, flags, structure, road, territory, terrain, cost } = this;
    for (let y = r.y; y < r.y + r.height; y++) {
      for (let x = r.x; x < r.x + r.width; x++) {
        const i = y * width + x;
        let f = flags[i] & (NavFlag.WATER | NavFlag.STEEP | NavFlag.GATE);
        if (structure[i] !== 0) f |= NavFlag.STRUCTURE;
        if (road[i] !== 0) f |= NavFlag.ROAD;
        if (territory[i] !== 0) f |= NavFlag.TERRITORY;
        if (f & (NavFlag.WATER | NavFlag.STEEP | NavFlag.STRUCTURE)) {
          f |= NavFlag.BLOCKED;
          cost[i] = NAV_COST_BLOCKED;
        } else {
          const c = Math.round(terrain[i] * navRoadFactor(road[i], this.roadMinFactor));
          cost[i] = Math.min(NAV_MAX_FINITE_COST, Math.max(1, c));
        }
        flags[i] = f;
      }
    }
  }
}

function grow(r: NavRect, by: number): NavRect {
  return { x: r.x - by, y: r.y - by, width: r.width + 2 * by, height: r.height + 2 * by };
}
