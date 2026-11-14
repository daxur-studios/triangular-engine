import type { NavUnitClass } from './nav-flags';
import { NAV_UNIT_CLASSES, type NavGoalSide, type NavGoalSides, type NavSectorGraph } from './nav-sectors';

let nextGoalSetId = 1;

interface CachedSide {
  readonly version: number;
  readonly own: number;
  readonly side: NavGoalSide;
}

/**
 * A mutable set of goal cells: every tree, every storehouse, every free house. A flow field built
 * for a goal set (`NavFlowCache.fieldForGoals`) leads each agent to the source with the lowest path
 * cost from where it stands. Add and remove sources as the game changes; only the cached sector
 * fields that depend on the changed sectors are rebuilt.
 *
 * - **Removing** a source marks the sector holding it as changed. Sector fields built there, and
 *   (transitively) the fields that were seeded from them, are dropped and rebuilt lazily.
 * - **Adding** a source marks that sector and its eight neighbours, plus the fields seeded from them.
 *   Fields further away keep leading to their previous nearest source until something else
 *   invalidates them; that source still exists, so the route stays valid, only possibly no longer the
 *   nearest. Call {@link NavGoalSet.touchAll} for an exact refresh.
 * - A source in a cell that is not passable for a unit class (a building cell, say) is ignored for
 *   that class until the cell is passable again. Use the door cell of a building as the source.
 *
 * Per-sector goal sides (the cost from each portal of a sector to its nearest source) are cached per
 * unit class and recomputed only when the sector is rebuilt or its sources change, so a corridor query
 * toward hundreds of sources stays cheap.
 *
 * No Angular or three.js dependency.
 */
export class NavGoalSet implements NavGoalSides {
  /** Unique id (used as part of the cache key). */
  readonly id: number = nextGoalSetId++;
  /** The graph the set lives on. */
  readonly graph: NavSectorGraph;
  /** Increases with every change of the set. */
  revision = 0;

  /**
   * Per sector change counter used for cache invalidation (see the class comment). Read by the
   * flow cache; not meant for consumers.
   * @internal
   */
  readonly stamps: Uint32Array;
  /** Source cell indices grouped by the sector that holds them (insertion order). */
  readonly bySector = new Map<number, number[]>();

  private readonly ownStamps: Uint32Array;
  private readonly cells = new Set<number>();
  private readonly bits: Uint32Array;
  private readonly width: number;
  private readonly height: number;
  private readonly sideCache: Map<number, CachedSide>[] = NAV_UNIT_CLASSES.map(() => new Map());

  /** Creates a set, optionally with source cell indices (`y * width + x`). */
  constructor(graph: NavSectorGraph, cells?: Iterable<number>) {
    this.graph = graph;
    this.width = graph.grid.width;
    this.height = graph.grid.height;
    this.stamps = new Uint32Array(graph.sectorCount);
    this.ownStamps = new Uint32Array(graph.sectorCount);
    this.bits = new Uint32Array(Math.ceil((this.width * this.height) / 32));
    if (cells) for (const c of cells) this.addCell(c);
  }

  /** Number of sources. */
  get size(): number {
    return this.cells.size;
  }

  /** The first source added still in the set, or -1 when empty. */
  get primary(): number {
    for (const c of this.cells) return c;
    return -1;
  }

  /** Adds a source cell. Returns false when it is outside the grid or already in the set. */
  add(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false;
    return this.addCell(y * this.width + x);
  }

  /** Adds a source by cell index. Returns false when out of range or already present. */
  addCell(cell: number): boolean {
    if (!Number.isInteger(cell) || cell < 0 || cell >= this.width * this.height || this.hasCell(cell)) return false;
    this.cells.add(cell);
    this.bits[cell >> 5] |= 1 << (cell & 31);
    const s = this.sectorOfCell(cell);
    const list = this.bySector.get(s);
    if (list) list.push(cell);
    else this.bySector.set(s, [cell]);
    this.ownStamps[s]++;
    const graph = this.graph;
    const sx = s % graph.sectorsX;
    const sy = (s - sx) / graph.sectorsX;
    for (let y = Math.max(0, sy - 1); y <= Math.min(graph.sectorsY - 1, sy + 1); y++) {
      for (let x = Math.max(0, sx - 1); x <= Math.min(graph.sectorsX - 1, sx + 1); x++) {
        this.stamps[y * graph.sectorsX + x]++;
      }
    }
    this.revision++;
    return true;
  }

  /** Removes a source cell. Returns false when it was not in the set. */
  remove(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false;
    return this.removeCell(y * this.width + x);
  }

  /** Removes a source by cell index. Returns false when it was not in the set. */
  removeCell(cell: number): boolean {
    if (!this.hasCell(cell)) return false;
    this.cells.delete(cell);
    this.bits[cell >> 5] &= ~(1 << (cell & 31));
    const s = this.sectorOfCell(cell);
    const list = this.bySector.get(s) as number[];
    list.splice(list.indexOf(cell), 1);
    if (list.length === 0) {
      this.bySector.delete(s);
      for (const m of this.sideCache) m.delete(s);
    }
    this.ownStamps[s]++;
    this.stamps[s]++;
    this.revision++;
    return true;
  }

  /** True when the cell is a source. */
  has(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height && this.hasCell(y * this.width + x);
  }

  /** True when the cell index is a source (a bit test, cheap enough for per-agent checks). */
  hasCell(cell: number): boolean {
    return cell >= 0 && cell < this.width * this.height && (this.bits[cell >> 5] & (1 << (cell & 31))) !== 0;
  }

  /** Removes every source. */
  clear(): void {
    for (const c of [...this.cells]) this.removeCell(c);
  }

  /** Marks every sector changed, so every field built for this set is rebuilt on its next use. */
  touchAll(): void {
    this.stamps.forEach((_, i) => this.stamps[i]++);
    this.revision++;
  }

  /** Calls `fn` with every source cell index, in insertion order. */
  forEachCell(fn: (cell: number) => void): void {
    for (const c of this.cells) fn(c);
  }

  /** @inheritdoc */
  sidesFor(unitClass: NavUnitClass): readonly NavGoalSide[] {
    const graph = this.graph;
    const cache = this.sideCache[NAV_UNIT_CLASSES.indexOf(unitClass)];
    const out: NavGoalSide[] = [];
    for (const [sector, cells] of this.bySector) {
      let c = cache.get(sector);
      if (!c || c.version !== graph.versions[sector] || c.own !== this.ownStamps[sector]) {
        c = {
          version: graph.versions[sector],
          own: this.ownStamps[sector],
          side: graph.goalSide(sector, cells, unitClass),
        };
        cache.set(sector, c);
      }
      if (c.side.cells.length > 0) out.push(c.side);
    }
    return out;
  }

  private sectorOfCell(cell: number): number {
    return this.graph.sectorOf(cell % this.width, Math.floor(cell / this.width));
  }
}
